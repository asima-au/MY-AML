// Case engine: runs the 4 phases and 13 checkpoints for one customer case.
// Pure and deterministic: the caller passes `now` and holiday dates, so the
// same input always produces the same output.

import { REGULATORY_PARAMS as P, HIGH_RISK_JURISDICTIONS, ELEVATED_RISK_JURISDICTIONS } from './config.js';
import { SECTORS, validateSectorAnswers } from './sectors.js';
import { addHours, addBusinessDays, daysBetween } from './dates.js';
import { createAuditLog, retentionUntil } from './audit.js';

export const CHECKPOINTS = Object.freeze([
  { id: 1, phase: 1, name: 'AUSTRAC enrolment status' },
  { id: 2, phase: 1, name: 'Compliance officer sign-off' },
  { id: 3, phase: 1, name: 'Sanctions and PEP screening' },
  { id: 4, phase: 2, name: 'Individual identity verification' },
  { id: 5, phase: 2, name: 'Entity and trust verification' },
  { id: 6, phase: 2, name: 'Beneficial ownership (25% threshold)' },
  { id: 7, phase: 2, name: 'Nature of business and baseline profile' },
  { id: 8, phase: 3, name: 'Risk escalation triggers' },
  { id: 9, phase: 3, name: 'Source of wealth' },
  { id: 10, phase: 3, name: 'Source of funds' },
  { id: 11, phase: 4, name: 'Transaction monitoring alert routing' },
  { id: 12, phase: 4, name: 'Suspicious matter report deadline' },
  { id: 13, phase: 4, name: 'Seven-year archive and audit log' },
]);

// Checkpoints whose content is restricted to SMR-cleared roles.
const RESTRICTED_CHECKPOINTS = new Set([8, 11, 12]);

export const CASE_STATES = Object.freeze([
  'BLOCKED_ENROLMENT',   // the reporting entity cannot provide the service
  'BLOCKED_SANCTIONS',   // confirmed sanctions match: do not proceed
  'ON_HOLD_PRESCREEN',   // program or screening incomplete
  'ON_HOLD_CDD',         // KYC incomplete
  'ON_HOLD_EDD',         // EDD evidence or compliance officer approval outstanding
  'APPROVED_MONITORING', // relationship may proceed under ongoing monitoring
]);

const ctxHelpers = {
  isHighRisk: (c) => Boolean(c) && HIGH_RISK_JURISDICTIONS.includes(c),
  isElevated: (c) => Boolean(c) && (HIGH_RISK_JURISDICTIONS.includes(c) || ELEVATED_RISK_JURISDICTIONS.includes(c)),
};

function result(cp, status, findings = [], extra = {}) {
  return { ...CHECKPOINTS[cp - 1], status, findings, restricted: RESTRICTED_CHECKPOINTS.has(cp), ...extra };
}

function individualsInScope(customer) {
  if (customer.type === 'individual') return [{ ...customer.individual, role: 'customer' }];
  return (customer.owners || []).filter(isBeneficialOwner).map((o) => ({ ...o, role: 'beneficial_owner' }));
}

function isBeneficialOwner(o) {
  return Number(o.ownershipPct || 0) >= P.uboOwnershipThresholdPct || o.control === true;
}

function screeningSubjects(customer) {
  const names = [];
  if (customer.type === 'individual') names.push(customer.individual.fullName);
  else {
    names.push(customer.entity.name);
    for (const o of customer.owners || []) names.push(o.name);
    for (const t of customer.entity.trustees || []) names.push(t.name);
  }
  return [...new Set(names.filter(Boolean))];
}

function collectPeps(input) {
  const peps = [];
  const people = input.customer.type === 'individual'
    ? [{ name: input.customer.individual.fullName, pep: input.customer.individual.pep }]
    : (input.customer.owners || []);
  for (const p of people) {
    if (p.pep && p.pep.category && p.pep.category !== 'none') peps.push({ subject: p.name, category: p.pep.category, role: p.pep.role || '' });
  }
  for (const s of input.screening?.pepMatches || []) {
    if (!peps.some((p) => p.subject === s.subject)) peps.push({ subject: s.subject, category: s.category, role: s.role || '' });
  }
  return peps;
}

function detectStructuring(transactions = []) {
  const lower = P.cashThresholdAud * (P.structuringLowerBoundPct / 100);
  const near = transactions.filter((t) => t.cash && t.amountAud >= lower && t.amountAud < P.cashThresholdAud)
    .sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 0; i < near.length; i += 1) {
    const window = near.filter((t) => daysBetween(near[i].at, t.at) >= 0 && daysBetween(near[i].at, t.at) <= P.structuringWindowDays);
    if (window.length >= P.structuringMinCount) return { detected: true, count: window.length, totalAud: window.reduce((s, t) => s + t.amountAud, 0) };
  }
  return { detected: false };
}

/** Scores the case and decides whether EDD is required. */
export function assessRisk(input) {
  const sector = SECTORS[input.reportingEntity.sector];
  const factors = [];
  const add = (id, factor, weight) => factors.push({ id, factor, weight });

  for (const rule of sector.riskRules) {
    if (rule.when(input.sectorAnswers || {}, ctxHelpers)) add(rule.id, rule.factor, rule.weight);
  }

  const peps = collectPeps(input);
  for (const p of peps) {
    if (p.category === 'foreign' || p.category === 'international_organisation') add(`pep_${p.subject}`, `Foreign or international PEP: ${p.subject}`, 4);
    else if (p.category === 'domestic') add(`pep_${p.subject}`, `Domestic PEP: ${p.subject}`, 2);
  }

  const countries = new Set([
    input.customer.countryOfResidence,
    input.customer.entity?.jurisdiction,
    ...(input.sourceOfFunds?.originAccounts || []).map((a) => a.country),
    input.sectorAnswers?.formationJurisdiction,
    input.sectorAnswers?.destinationCountry,
  ].filter(Boolean));
  const highRiskCountries = [...countries].filter(ctxHelpers.isHighRisk);
  for (const c of highRiskCountries) add(`country_${c}`, `FATF call-for-action jurisdiction: ${c}`, 4);

  const thirdParty = (input.sourceOfFunds?.originAccounts || []).some((a) => a.holderIsCustomer === false);
  if (thirdParty && !factors.some((f) => f.id === 'third_party_deposit')) add('third_party_funds', 'Funds from an account not held by the customer', 2);

  const crossBorderFunds = (input.sourceOfFunds?.originAccounts || []).some((a) => a.country && a.country !== 'AU');
  if (crossBorderFunds) add('cross_border_funds', 'Funds originate outside Australia', 1);

  const structuring = detectStructuring(input.transactions);
  if (structuring.detected) add('structuring', `Possible structuring: ${structuring.count} cash amounts just under AUD ${P.cashThresholdAud}`, 3);

  if (input.customer.type === 'trust' || (input.customer.owners || []).some((o) => o.isEntity)) add('complex_structure', 'Layered or trust ownership structure', 1);

  const score = factors.reduce((s, f) => s + f.weight, 0);
  const level = highRiskCountries.length ? 'high' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  const hasForeignPep = peps.some((p) => p.category === 'foreign' || p.category === 'international_organisation');
  const hasDomesticPep = peps.some((p) => p.category === 'domestic');
  // Foreign PEPs always need EDD; domestic PEPs need EDD when the case is
  // otherwise medium or high risk (risk-based approach).
  const eddRequired = level === 'high' || hasForeignPep || (hasDomesticPep && level !== 'low') || highRiskCountries.length > 0;

  return { factors, score, level, eddRequired, peps, structuring, highRiskCountries };
}

/** Runs every checkpoint and returns the full internal case record. */
export function runCase(input) {
  const audit = createAuditLog();
  const now = input.now;
  const holidays = input.holidays || [];
  const sectorId = input.reportingEntity.sector;
  const sector = SECTORS[sectorId];
  if (!sector) throw new Error(`Unknown sector: ${sectorId}`);
  const answers = input.sectorAnswers || {};
  const cps = [];
  const documentsToCollect = new Set();

  audit.append({ at: now, actor: 'system', action: 'case_opened', detail: { caseId: input.caseId, sector: sectorId } });

  // 1. Enrolment
  {
    const e = input.reportingEntity.austracEnrolment || {};
    const findings = [];
    if (e.status !== 'enrolled') findings.push(`Reporting entity enrolment status is "${e.status || 'none'}"; enrol with AUSTRAC before providing a designated service`);
    if (e.status === 'enrolled' && !e.enrolmentNumber) findings.push('Enrolment number missing from the record');
    if (e.status === 'enrolled' && !(e.sectorsRegistered || []).includes(sectorId)) findings.push(`Enrolment does not list the ${sectorId} designated services`);
    cps.push(result(1, findings.length ? 'blocked' : 'pass', findings));
  }

  // 2. Compliance officer sign-off (program level here; case-level EDD approval is checked after risk scoring)
  const program = input.reportingEntity.program || {};
  {
    const findings = [];
    if (!program.amlcoAppointed || !program.amlcoName) findings.push('No AML/CTF compliance officer recorded');
    if (!program.approvedAt) findings.push('AML/CTF program has no recorded approval');
    else if (daysBetween(program.approvedAt, now) > P.programSignoffMaxAgeDays) findings.push('AML/CTF program approval is more than 12 months old; re-approve');
    cps.push(result(2, findings.length ? 'fail' : 'pass', findings));
  }

  // 3. Screening
  const subjects = screeningSubjects(input.customer);
  const screened = new Set(input.screening?.screenedSubjects || []);
  const sanctionsHits = (input.screening?.sanctionsMatches || []).filter((m) => m.confirmed);
  const peps = collectPeps(input);
  {
    const findings = [];
    const unscreened = subjects.filter((s) => !screened.has(s));
    for (const s of unscreened) findings.push(`Not yet screened: ${s}`);
    for (const h of sanctionsHits) findings.push(`Confirmed sanctions match: ${h.subject} (${h.list})`);
    for (const p of peps) findings.push(`PEP identified: ${p.subject} (${p.category})`);
    const status = sanctionsHits.length ? 'blocked' : unscreened.length ? 'action_required' : 'pass';
    cps.push(result(3, status, findings, { restricted: true }));
  }

  // 4. Individual identity
  {
    const findings = [];
    const people = individualsInScope(input.customer);
    if (!people.length) findings.push('No individual identified to verify');
    for (const person of people) {
      const label = `${person.role === 'customer' ? 'Customer' : 'Beneficial owner'} ${person.fullName || person.name}`;
      if (person.role === 'customer') {
        for (const f of ['fullName', 'dob', 'address']) if (!person[f]) findings.push(`${label}: ${f} missing`);
        const verified = (person.idSources || []).filter((s) => s.verified);
        const independent = verified.filter((s) => s.independent);
        if (verified.length < 2 || independent.length < 1) {
          findings.push(`${label}: needs two verified sources, at least one independent of the customer`);
          documentsToCollect.add('Photo identification and proof of address');
        }
      } else if (!person.identityVerified) {
        findings.push(`${label}: identity not yet verified`);
        documentsToCollect.add(`Identification for ${person.name}`);
      }
    }
    cps.push(result(4, findings.length ? 'action_required' : 'pass', findings));
  }

  // 5. Entity / trust
  {
    const c = input.customer;
    const findings = [];
    if (c.type === 'individual') cps.push(result(5, 'not_applicable', ['Customer is an individual']));
    else {
      const ent = c.entity || {};
      const reg = ent.registryExtract || {};
      if (c.type === 'company' || ent.trusteeIsCompany) {
        if (!reg.source) findings.push('Registry extract missing (ASIC for Australian companies, official registry for foreign ones)');
        else if (reg.status !== 'registered') findings.push(`Registry status is "${reg.status}"`);
        if (!ent.registrationNumber) findings.push('ACN or foreign registration number missing');
      }
      if (c.type === 'trust') {
        if (!ent.trustDeedSighted) { findings.push('Certified trust deed not sighted'); documentsToCollect.add('Certified copy of the trust deed'); }
        if (!(ent.trustees || []).length) findings.push('Trustees not recorded');
        for (const t of ent.trustees || []) if (!t.verified) findings.push(`Trustee ${t.name} not verified`);
        if (!ent.trustType) findings.push('Trust type not recorded');
      }
      cps.push(result(5, findings.length ? 'action_required' : 'pass', findings));
    }
  }

  // 6. Beneficial ownership
  {
    const c = input.customer;
    if (c.type === 'individual') cps.push(result(6, 'not_applicable', ['Customer is the beneficial owner']));
    else {
      const findings = [];
      const owners = c.owners || [];
      const total = owners.reduce((s, o) => s + Number(o.ownershipPct || 0), 0);
      if (total > 100.0001) findings.push(`Declared ownership adds up to ${total}%; it cannot exceed 100%`);
      const ubos = owners.filter(isBeneficialOwner).filter((o) => !o.isEntity);
      const layered = owners.filter((o) => o.isEntity && Number(o.ownershipPct || 0) >= P.uboOwnershipThresholdPct);
      for (const l of layered) findings.push(`Look through ${l.name}: identify the individuals behind this ${l.ownershipPct}% holding`);
      if (!ubos.length) findings.push('No individual meets the 25% or control test; record the senior managing official');
      cps.push(result(6, findings.length ? 'action_required' : 'pass', findings, { beneficialOwners: ubos.map((u) => ({ name: u.name, ownershipPct: u.ownershipPct, control: Boolean(u.control) })) }));
    }
  }

  // 7. Nature of business and sector questionnaire
  {
    const findings = validateSectorAnswers(sectorId, answers);
    const prof = input.profile || {};
    for (const f of ['natureOfBusiness', 'purposeOfRelationship', 'expectedActivity']) if (!prof[f]) findings.push(`${f} not recorded`);
    const exempt = sector.designatedServiceExempt(answers);
    cps.push(result(7, findings.length ? 'action_required' : 'pass', findings, { designatedService: !exempt }));
  }

  // 8. Risk escalation
  const risk = assessRisk(input);
  cps.push(result(8, risk.eddRequired ? 'escalated' : 'pass',
    risk.factors.map((f) => `${f.factor} (+${f.weight})`), { riskLevel: risk.level, score: risk.score, eddRequired: risk.eddRequired }));
  audit.append({ at: now, actor: 'system', action: 'risk_assessed', checkpoint: 8, restricted: true,
    detail: { level: risk.level, score: risk.score, eddRequired: risk.eddRequired } });

  // 9. Source of wealth
  {
    if (!risk.eddRequired) cps.push(result(9, 'not_applicable', ['EDD not triggered']));
    else {
      const sow = input.sourceOfWealth || {};
      const findings = [];
      if (!sow.declared) findings.push('Source of wealth not declared');
      const verified = (sow.evidence || []).filter((e) => e.verified);
      if (!verified.length) { findings.push('No verified evidence of source of wealth'); documentsToCollect.add('Evidence of how your wealth was accumulated'); }
      cps.push(result(9, findings.length ? 'action_required' : 'pass', findings));
    }
  }

  // 10. Source of funds
  {
    const sof = input.sourceOfFunds || {};
    const needed = risk.eddRequired || Number(sof.amountAud || 0) > 0;
    if (!needed) cps.push(result(10, 'not_applicable', ['No transaction funds to trace']));
    else {
      const findings = [];
      const accounts = sof.originAccounts || [];
      const cash = Number(sof.cashAud || 0);
      const traced = accounts.reduce((s, a) => s + Number(a.amountAud || 0), 0) + cash;
      if (!accounts.length && !cash) findings.push('Origin of funds not recorded');
      if (Number(sof.amountAud || 0) > 0 && Math.abs(traced - Number(sof.amountAud)) > Number(sof.amountAud) * 0.01) {
        findings.push(`Traced funds (AUD ${traced}) do not match the transaction amount (AUD ${sof.amountAud})`);
      }
      for (const a of accounts) {
        if (!a.verified) { findings.push(`Origin account at ${a.institution || 'unknown institution'} not verified`); documentsToCollect.add('Bank statement showing the source account'); }
        if (a.holderIsCustomer === false) findings.push(`Funds from a third party (${a.holderName || 'unnamed'}): relationship must be explained and verified`);
      }
      if (cash > 0 && !sof.cashOriginExplained) { findings.push(`Cash component of AUD ${cash} has no documented origin`); documentsToCollect.add('Evidence of where the cash came from (for example a withdrawal receipt)'); }
      cps.push(result(10, findings.length ? 'action_required' : 'pass', findings));
    }
  }

  // EDD sign-off is a checkpoint 2 requirement once EDD applies.
  if (risk.eddRequired) {
    const s = input.amlcoSignoff?.edd;
    const cp2 = cps[1];
    if (!s?.approved) {
      cps[1] = { ...cp2, status: cp2.status === 'fail' ? 'fail' : 'action_required',
        findings: [...cp2.findings, 'EDD case: compliance officer approval required before the relationship proceeds'] };
    } else {
      cps[1] = { ...cp2, findings: [...cp2.findings, `EDD approved by ${s.by} on ${s.at.slice(0, 10)}`] };
    }
  }

  // 11. Transaction monitoring and routing
  const alerts = [];
  const reports = { ttr: [], smr: null };
  {
    const txs = input.transactions || [];
    for (const t of txs) {
      if (t.cash && t.amountAud >= P.cashThresholdAud) {
        const due = addBusinessDays(t.at, P.ttrDeadlineBusinessDays, holidays);
        reports.ttr.push({ transactionAt: t.at, amountAud: t.amountAud, dueBy: due, status: 'to_lodge' });
        alerts.push({ type: 'TTR_REQUIRED', severity: 'medium', queue: 'reporting', dueBy: due });
      }
      if (t.international && ['financial_services', 'remittance'].includes(sectorId)) {
        alerts.push({ type: 'IFTI_REQUIRED', severity: 'medium', queue: 'reporting', dueBy: addBusinessDays(t.at, 10, holidays) });
      }
    }
    if (risk.structuring.detected) alerts.push({ type: 'STRUCTURING_PATTERN', severity: 'high', queue: 'amlco' });
    if (risk.peps.length) alerts.push({ type: 'PEP_RELATIONSHIP', severity: risk.eddRequired ? 'high' : 'medium', queue: risk.eddRequired ? 'amlco' : 'analyst' });
    if (risk.level === 'high') alerts.push({ type: 'HIGH_RISK_CUSTOMER', severity: 'high', queue: 'amlco' });
    const findings = alerts.map((a) => `${a.type} to ${a.queue} queue${a.dueBy ? ` (due ${a.dueBy.slice(0, 10)})` : ''}`);
    cps.push(result(11, alerts.length ? 'routed' : 'pass', findings.length ? findings : ['No alerts']));
    for (const a of alerts) audit.append({ at: now, actor: 'system', action: 'alert_routed', checkpoint: 11, restricted: true, detail: a });
  }

  // 12. SMR assessment and deadline (restricted)
  {
    const s = input.suspicion || {};
    const findings = [];
    let status = 'pass';
    // Any high-risk case needs a recorded decision on suspicion, not only the
    // cases with a structuring, sanctions or FATF jurisdiction signal.
    const redFlags = risk.structuring.detected || risk.highRiskCountries.length > 0 || sanctionsHits.length > 0 || risk.level === 'high';
    if (s.formed) {
      const formedAt = s.formedAt || now;
      const dueBy = s.terrorismFinancing
        ? addHours(formedAt, P.smrTerrorismFinancingHours)
        : addBusinessDays(formedAt, P.smrOtherBusinessDays, holidays);
      reports.smr = { formedAt, terrorismFinancing: Boolean(s.terrorismFinancing), dueBy, submittedAt: s.submittedAt || null, grounds: s.grounds || [] };
      if (s.submittedAt) { status = s.submittedAt <= dueBy ? 'pass' : 'fail'; findings.push(`SMR lodged ${s.submittedAt}${s.submittedAt > dueBy ? ' after the deadline' : ''}`); }
      else if (now > dueBy) { status = 'fail'; findings.push(`SMR overdue: was due ${dueBy}`); }
      else { status = 'action_required'; findings.push(`SMR due by ${dueBy} (${s.terrorismFinancing ? '24 hours, terrorism financing' : '3 business days'})`); }
      findings.push('Tipping-off controls active: no customer or front-line indication permitted (AML/CTF Act s 123)');
      audit.append({ at: now, actor: 'amlco', action: 'smr_deadline_set', checkpoint: 12, restricted: true, detail: { dueBy } });
    } else if (redFlags && !s.assessedNoSuspicion) {
      status = 'action_required';
      findings.push('Red flags present: compliance officer must record whether a suspicion is formed');
    } else {
      findings.push(s.assessedNoSuspicion ? 'Assessed: no suspicion formed' : 'No suspicion indicators');
    }
    cps.push(result(12, status, findings));
  }

  // 13. Archive and audit log
  const retention = retentionUntil({ createdAt: now, relationshipEndedAt: input.relationshipEndedAt });
  audit.append({ at: now, actor: 'system', action: 'retention_set', checkpoint: 13, detail: { retainUntil: retention } });
  const chain = audit.verify();
  cps.push(result(13, chain.ok ? 'pass' : 'fail', [`Retain until ${retention.slice(0, 10)}`, chain.ok ? `Audit chain intact (${chain.length} entries)` : `Audit chain broken at entry ${chain.brokenAt}`],
    { retainUntil: retention }));

  const state = deriveState(cps);
  audit.append({ at: now, actor: 'system', action: 'state_set', detail: { state } });

  return {
    caseId: input.caseId,
    sector: sectorId,
    state,
    risk: { level: risk.level, score: risk.score, eddRequired: risk.eddRequired, factors: risk.factors },
    checkpoints: cps,
    alerts,
    reports,
    documentsToCollect: [...documentsToCollect],
    // Once a suspicion is formed, document requests reach the customer only
    // after the compliance officer releases them (tipping-off control).
    releasedRequests: reports.smr ? (input.amlcoReleasedRequests || []).filter((d) => documentsToCollect.has(d)) : null,
    retainUntil: retention,
    audit,
  };
}

function deriveState(cps) {
  const by = (id) => cps[id - 1].status;
  if (by(1) === 'blocked') return 'BLOCKED_ENROLMENT';
  if (by(3) === 'blocked') return 'BLOCKED_SANCTIONS';
  if (by(2) === 'fail' || by(3) === 'action_required') return 'ON_HOLD_PRESCREEN';
  if ([4, 5, 6, 7].some((id) => by(id) === 'action_required' || by(id) === 'fail')) return 'ON_HOLD_CDD';
  if (by(2) === 'action_required' || [9, 10].some((id) => by(id) === 'action_required')) return 'ON_HOLD_EDD';
  return 'APPROVED_MONITORING';
}
