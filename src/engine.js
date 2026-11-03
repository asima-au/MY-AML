// Case engine: runs the 4 phases and 13 checkpoints for one customer case.
// Pure and deterministic: the caller passes `now` and holiday dates, so the
// same input always produces the same output, including audit hashes.

import {
  REGULATORY_PARAMS as P, HIGH_RISK_JURISDICTIONS, ELEVATED_RISK_JURISDICTIONS, IFTI_SECTORS, REGISTRATION_REQUIRED,
} from './config.js';
import { SECTORS, validateSectorAnswers, isExempt } from './sectors.js';
import { addHours, addBusinessDays, addMonths, daysBetween, assertInstant, isAfter } from './dates.js';
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
const RESTRICTED_CHECKPOINTS = new Set([3, 8, 11, 12]);

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

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** Throws a TypeError listing every structural problem with the input. */
export function validateInput(input) {
  const problems = [];
  if (!input || typeof input !== 'object') throw new TypeError('runCase needs an input object');
  if (typeof input.caseId !== 'string' || !input.caseId) problems.push('caseId must be a non-empty string');
  if (typeof input.now !== 'string' || Number.isNaN(Date.parse(input.now))) problems.push('now must be an ISO date-time string');
  if (input.holidays !== undefined && !(Array.isArray(input.holidays) && input.holidays.every((h) => /^\d{4}-\d{2}-\d{2}$/.test(h)))) {
    problems.push('holidays must be an array of local YYYY-MM-DD dates');
  }
  if (!SECTORS[input.reportingEntity?.sector]) problems.push(`reportingEntity.sector must be one of: ${Object.keys(SECTORS).join(', ')}`);
  const type = input.customer?.type;
  if (!['individual', 'company', 'trust'].includes(type)) problems.push('customer.type must be individual, company or trust');
  if (type === 'individual' && !input.customer.individual) problems.push('customer.individual is required for an individual customer');
  if ((type === 'company' || type === 'trust') && !input.customer.entity) problems.push('customer.entity is required for a company or trust customer');
  for (const t of input.transactions || []) {
    if (Number.isNaN(Date.parse(t.at))) problems.push(`transaction time "${t.at}" is not an ISO date-time`);
    if (!(typeof t.amountAud === 'number' && t.amountAud >= 0)) problems.push('transaction amountAud must be a non-negative number');
  }
  if (problems.length) throw new TypeError(`Invalid case input: ${problems.join('; ')}`);
}

// ---------------------------------------------------------------------------
// Ownership: look-through to individuals
// ---------------------------------------------------------------------------

/**
 * Walks the ownership tree. Entity owners (isEntity) are looked through to
 * the individuals behind them, multiplying percentages down each layer.
 * Returns individuals (aggregated across paths), entity holders and findings.
 */
export function lookThroughOwners(owners = []) {
  const individuals = new Map();
  const entities = [];
  const findings = [];

  function walk(list, factor, path, seen) {
    const total = list.reduce((s, o) => s + Number(o.ownershipPct || 0), 0);
    const where = path.length ? `Holding through ${path.join(' > ')}` : 'Declared ownership';
    if (total > 100.0001) findings.push(`${where} adds up to ${round(total)}%; it cannot exceed 100%`);
    for (const o of list) {
      const pct = Number(o.ownershipPct || 0);
      if (!(pct >= 0 && pct <= 100)) findings.push(`${o.name}: ownership of ${o.ownershipPct}% is not between 0 and 100`);
      const effective = round(factor * pct);
      if (o.isEntity) {
        entities.push({ name: o.name, effectivePct: effective, path: [...path] });
        if (seen.has(o.name)) { findings.push(`Circular ownership through ${o.name}`); continue; }
        if (!(o.owners || []).length) {
          if (effective >= P.uboOwnershipThresholdPct) findings.push(`Look through ${o.name}: identify the individuals behind this ${effective}% holding`);
          continue;
        }
        walk(o.owners, factor * (pct / 100), [...path, o.name], new Set([...seen, o.name]));
      } else {
        const prev = individuals.get(o.name);
        individuals.set(o.name, prev
          ? { ...prev, effectivePct: round(prev.effectivePct + effective), control: prev.control || o.control === true, via: [...prev.via, path.join(' > ') || 'direct'] }
          : { ...o, effectivePct: effective, control: o.control === true, via: [path.join(' > ') || 'direct'] });
      }
    }
  }

  walk(owners, 1, [], new Set());
  return { individuals: [...individuals.values()], entities, findings };
}

function round(n) { return Math.round(n * 10000) / 10000; }

function isBeneficialOwner(o) {
  return o.effectivePct >= P.uboOwnershipThresholdPct || o.control === true;
}

function individualsInScope(customer, ownership) {
  if (customer.type === 'individual') return [{ ...customer.individual, role: 'customer' }];
  return ownership.individuals.filter(isBeneficialOwner).map((o) => ({ ...o, role: 'beneficial_owner' }));
}

function screeningSubjects(customer, ownership) {
  const names = [];
  if (customer.type === 'individual') names.push(customer.individual.fullName);
  else {
    names.push(customer.entity.name);
    for (const e of ownership.entities) names.push(e.name);
    for (const o of ownership.individuals) names.push(o.name);
    for (const t of customer.entity.trustees || []) names.push(t.name);
  }
  return [...new Set(names.filter(Boolean))];
}

function collectPeps(input, ownership) {
  const peps = [];
  const people = input.customer.type === 'individual'
    ? [{ name: input.customer.individual.fullName, pep: input.customer.individual.pep }]
    : ownership.individuals;
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
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (let i = 0; i < near.length; i += 1) {
    const window = near.filter((t) => daysBetween(near[i].at, t.at) >= 0 && daysBetween(near[i].at, t.at) <= P.structuringWindowDays);
    if (window.length >= P.structuringMinCount) return { detected: true, count: window.length, totalAud: window.reduce((s, t) => s + t.amountAud, 0) };
  }
  return { detected: false };
}

/** Every country the case touches, apart from sector answers (which sector rules score). */
function connectionCountries(input, ownership) {
  const c = input.customer;
  return new Set([
    c.countryOfResidence,
    c.individual?.nationality,
    c.entity?.jurisdiction,
    ...ownership.individuals.flatMap((o) => [o.countryOfResidence, o.nationality]),
    ...(input.sourceOfFunds?.originAccounts || []).map((a) => a.country),
    ...(input.transactions || []).map((t) => t.country),
  ].filter(Boolean));
}

/** Scores the case and decides whether EDD is required. */
export function assessRisk(input, ownership = lookThroughOwners(input.customer.owners || [])) {
  const sector = SECTORS[input.reportingEntity.sector];
  const answers = input.sectorAnswers || {};
  const factors = [];
  const add = (id, factor, weight) => factors.push({ id, factor, weight });

  for (const rule of sector.riskRules) {
    if (rule.when(answers, ctxHelpers)) add(rule.id, rule.factor, rule.weight);
  }

  const peps = collectPeps(input, ownership);
  for (const p of peps) {
    if (p.category === 'foreign' || p.category === 'international_organisation') add(`pep_${p.subject}`, `Foreign or international PEP: ${p.subject}`, 4);
    else if (p.category === 'domestic') add(`pep_${p.subject}`, `Domestic PEP: ${p.subject}`, 2);
  }

  const connections = connectionCountries(input, ownership);
  const allCountries = new Set([...connections, answers.formationJurisdiction, answers.destinationCountry, answers.mainCounterpartyCountry].filter(Boolean));
  const highRiskCountries = [...allCountries].filter(ctxHelpers.isHighRisk);
  for (const c of highRiskCountries) add(`country_${c}`, `FATF call-for-action jurisdiction: ${c}`, 4);

  const elevated = [...connections].filter((c) => !ctxHelpers.isHighRisk(c) && ELEVATED_RISK_JURISDICTIONS.includes(c));
  if (elevated.length) add('elevated_connection', `Connection to an elevated-risk jurisdiction: ${elevated.join(', ')}`, 2);

  const thirdParty = (input.sourceOfFunds?.originAccounts || []).some((a) => a.holderIsCustomer === false);
  if (thirdParty && !factors.some((f) => f.id === 'third_party_deposit')) add('third_party_funds', 'Funds from an account not held by the customer', 2);

  const crossBorderFunds = (input.sourceOfFunds?.originAccounts || []).some((a) => a.country && a.country !== 'AU');
  if (crossBorderFunds) add('cross_border_funds', 'Funds originate outside Australia', 1);

  const structuring = detectStructuring(input.transactions);
  if (structuring.detected) add('structuring', `Possible structuring: ${structuring.count} cash amounts just under AUD ${P.cashThresholdAud}`, 3);

  if (input.customer.type === 'trust' || ownership.entities.length) add('complex_structure', 'Layered or trust ownership structure', 1);

  const score = factors.reduce((s, f) => s + f.weight, 0);
  const level = highRiskCountries.length ? 'high' : score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low';

  const hasForeignPep = peps.some((p) => p.category === 'foreign' || p.category === 'international_organisation');
  const hasDomesticPep = peps.some((p) => p.category === 'domestic');
  // Foreign PEPs always need EDD; domestic PEPs need EDD when the case is
  // otherwise medium or high risk (risk-based approach).
  const eddRequired = level === 'high' || hasForeignPep || (hasDomesticPep && level !== 'low') || highRiskCountries.length > 0;

  return { factors, score, level, eddRequired, peps, structuring, highRiskCountries };
}

// ---------------------------------------------------------------------------
// runCase
// ---------------------------------------------------------------------------

/** Runs every checkpoint and returns the full internal case record. */
export function runCase(input) {
  validateInput(input);
  const audit = createAuditLog();
  const now = input.now;
  const holidays = input.holidays || [];
  const sectorId = input.reportingEntity.sector;
  const sector = SECTORS[sectorId];
  const answers = input.sectorAnswers || {};
  const ownership = input.customer.type === 'individual' ? { individuals: [], entities: [], findings: [] } : lookThroughOwners(input.customer.owners || []);
  const exempt = isExempt(sectorId, answers);
  const cps = [];
  const documentsToCollect = new Set();
  const na = (id, why) => result(id, 'not_applicable', [why]);
  const exemptWhy = `Not a designated service: ${sector.exemptionNote}`;

  audit.append({ at: now, actor: 'system', action: 'case_opened', restricted: false, detail: { caseId: input.caseId, sector: sectorId } });

  // 1. Enrolment (and registration where the sector needs it)
  if (exempt) cps.push(na(1, exemptWhy));
  else {
    const e = input.reportingEntity.austracEnrolment || {};
    const findings = [];
    if (e.status !== 'enrolled') findings.push(`Reporting entity enrolment status is "${e.status || 'none'}"; enrol with AUSTRAC before providing a designated service`);
    if (e.status === 'enrolled' && !e.enrolmentNumber) findings.push('Enrolment number missing from the record');
    if (e.status === 'enrolled' && !(e.sectorsRegistered || []).includes(sectorId)) findings.push(`Enrolment does not list the ${sectorId} designated services`);
    const registration = REGISTRATION_REQUIRED[sectorId];
    if (registration && input.reportingEntity.registration?.status !== 'registered') {
      findings.push(`${registration} is required for ${sectorId}; registration status is "${input.reportingEntity.registration?.status || 'none'}"`);
    }
    cps.push(result(1, findings.length ? 'blocked' : 'pass', findings));
  }

  // 2. Compliance officer sign-off (program level here; case-level EDD approval is added after risk scoring)
  const program = input.reportingEntity.program || {};
  if (exempt) cps.push(na(2, exemptWhy));
  else {
    const findings = [];
    if (!program.amlcoAppointed || !program.amlcoName) findings.push('No AML/CTF compliance officer recorded');
    if (!program.approvedAt) findings.push('AML/CTF program has no recorded approval');
    else if (isAfter(program.approvedAt, now)) findings.push('AML/CTF program approval is dated in the future');
    else if (isAfter(now, addMonths(program.approvedAt, P.programSignoffMaxAgeMonths))) findings.push('AML/CTF program approval is more than 12 months old; re-approve');
    cps.push(result(2, findings.length ? 'fail' : 'pass', findings));
  }

  // 3. Screening (always runs: sanctions law applies whether or not the service is designated)
  const subjects = screeningSubjects(input.customer, ownership);
  const screened = new Set(input.screening?.screenedSubjects || []);
  const sanctionsMatches = input.screening?.sanctionsMatches || [];
  const sanctionsHits = sanctionsMatches.filter((m) => m.confirmed === true);
  const unresolved = sanctionsMatches.filter((m) => m.confirmed !== true && m.cleared !== true);
  const peps = collectPeps(input, ownership);
  {
    const findings = [];
    const unscreened = subjects.filter((s) => !screened.has(s));
    for (const s of unscreened) findings.push(`Not yet screened: ${s}`);
    for (const h of sanctionsHits) findings.push(`Confirmed sanctions match: ${h.subject} (${h.list})`);
    for (const u of unresolved) findings.push(`Possible sanctions match awaiting review: ${u.subject} (${u.list})`);
    for (const c of sanctionsMatches.filter((m) => m.cleared === true && m.confirmed !== true)) findings.push(`Possible match cleared as a false positive: ${c.subject}`);
    for (const p of peps) findings.push(`PEP identified: ${p.subject} (${p.category})`);
    const status = sanctionsHits.length ? 'blocked' : (unscreened.length || unresolved.length) ? 'action_required' : 'pass';
    cps.push(result(3, status, findings));
  }

  // 4. Individual identity
  if (exempt) cps.push(na(4, exemptWhy));
  else {
    const findings = [];
    const people = individualsInScope(input.customer, ownership);
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
  if (exempt) cps.push(na(5, exemptWhy));
  else if (input.customer.type === 'individual') cps.push(na(5, 'Customer is an individual'));
  else {
    const c = input.customer;
    const ent = c.entity;
    const findings = [];
    const checkRegistry = (label, reg = {}, number) => {
      if (!reg.source) findings.push(`${label}: registry extract missing (ASIC for Australian companies, official registry for foreign ones)`);
      else if (reg.status !== 'registered') findings.push(`${label}: registry status is "${reg.status}"`);
      if (!number) findings.push(`${label}: ACN or foreign registration number missing`);
    };
    if (c.type === 'company') checkRegistry(ent.name, ent.registryExtract, ent.registrationNumber);
    if (c.type === 'trust') {
      if (!ent.trustDeedSighted) { findings.push('Certified trust deed not sighted'); documentsToCollect.add('Certified copy of the trust deed'); }
      if (!ent.trustType) findings.push('Trust type not recorded');
      if (!(ent.trustees || []).length) findings.push('Trustees not recorded');
      for (const t of ent.trustees || []) {
        if (!t.verified) findings.push(`Trustee ${t.name} not verified`);
        // A corporate trustee carries its own registry extract; older records hold it on the trust (trusteeIsCompany).
        if (t.type === 'company') checkRegistry(`Trustee ${t.name}`, t.registryExtract, t.registrationNumber);
      }
      if (ent.trusteeIsCompany && !(ent.trustees || []).some((t) => t.type === 'company')) {
        checkRegistry('Corporate trustee', ent.registryExtract, ent.registrationNumber);
      }
    }
    cps.push(result(5, findings.length ? 'action_required' : 'pass', findings));
  }

  // 6. Beneficial ownership (look-through)
  if (exempt) cps.push(na(6, exemptWhy));
  else if (input.customer.type === 'individual') cps.push(na(6, 'Customer is the beneficial owner'));
  else {
    const findings = [...ownership.findings];
    const ubos = ownership.individuals.filter(isBeneficialOwner);
    if (!ubos.length) findings.push('No individual meets the 25% or control test; record the senior managing official');
    if (findings.length) documentsToCollect.add('Details of everyone who owns or controls the entity');
    cps.push(result(6, findings.length ? 'action_required' : 'pass', findings, {
      beneficialOwners: ubos.map((u) => ({ name: u.name, ownershipPct: u.effectivePct, control: Boolean(u.control), via: u.via })),
    }));
  }

  // 7. Nature of business and sector questionnaire
  {
    const findings = validateSectorAnswers(sectorId, answers);
    const prof = input.profile || {};
    for (const f of ['natureOfBusiness', 'purposeOfRelationship', 'expectedActivity']) if (!prof[f]) findings.push(`${f} not recorded`);
    if (exempt) findings.length = 0;
    cps.push(result(7, findings.length ? 'action_required' : 'pass', exempt ? [exemptWhy] : findings, { designatedService: !exempt }));
  }

  if (exempt) {
    for (const id of [8, 9, 10, 11]) cps.push(na(id, exemptWhy));
    cps.push(na(12, input.suspicion?.formed
      ? `${exemptWhy} A suspicion is on file: check reporting duties outside the AML/CTF Act (for example sanctions or police reporting).`
      : exemptWhy));
    return finish({ input, audit, cps, documentsToCollect, risk: { level: 'not_assessed', score: 0, eddRequired: false, factors: [] }, alerts: [], reports: { ttr: [], smr: null } });
  }

  // 8. Risk escalation
  const risk = assessRisk(input, ownership);
  cps.push(result(8, risk.eddRequired ? 'escalated' : 'pass',
    risk.factors.map((f) => `${f.factor} (+${f.weight})`), { riskLevel: risk.level, score: risk.score, eddRequired: risk.eddRequired }));
  audit.append({ at: now, actor: 'system', action: 'risk_assessed', checkpoint: 8,
    detail: { level: risk.level, score: risk.score, eddRequired: risk.eddRequired } });

  // 9. Source of wealth
  if (!risk.eddRequired) cps.push(result(9, 'not_applicable', ['EDD not triggered']));
  else {
    const sow = input.sourceOfWealth || {};
    const findings = [];
    if (!sow.declared) findings.push('Source of wealth not declared');
    const verified = (sow.evidence || []).filter((e) => e.verified);
    if (!verified.length) { findings.push('No verified evidence of source of wealth'); documentsToCollect.add('Evidence of how your wealth was accumulated'); }
    cps.push(result(9, findings.length ? 'action_required' : 'pass', findings));
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
      const amount = Number(sof.amountAud || 0);
      const traced = accounts.reduce((s, a) => s + Number(a.amountAud || 0), 0) + cash;
      if (!accounts.length && !cash) findings.push('Origin of funds not recorded');
      if (amount > 0 && Math.abs(traced - amount) > amount * (P.sourceOfFundsTolerancePct / 100)) {
        findings.push(`Traced funds (AUD ${traced}) do not match the transaction amount (AUD ${amount})`);
      }
      for (const a of accounts) {
        if (!a.verified) { findings.push(`Origin account at ${a.institution || 'unknown institution'} not verified`); documentsToCollect.add('Bank statement showing the source account'); }
        if (a.holderIsCustomer === false && !a.thirdPartyExplanation) {
          findings.push(`Funds from a third party (${a.holderName || 'unnamed'}): relationship must be explained and verified`);
          documentsToCollect.add('Explanation of payments made by other people or companies');
        }
      }
      if (cash > 0 && !sof.cashOriginExplained) { findings.push(`Cash component of AUD ${cash} has no documented origin`); documentsToCollect.add('Evidence of where the cash came from (for example a withdrawal receipt)'); }
      cps.push(result(10, findings.length ? 'action_required' : 'pass', findings));
    }
  }

  // EDD sign-off is a checkpoint 2 requirement once EDD applies.
  if (risk.eddRequired) {
    const s = input.amlcoSignoff?.edd;
    const cp2 = cps[1];
    const problems = [];
    if (!s?.approved) problems.push('EDD case: compliance officer approval required before the relationship proceeds');
    else {
      if (s.by !== program.amlcoName) problems.push(`EDD approval recorded by "${s.by}", who is not the compliance officer on record`);
      if (!s.at || Number.isNaN(Date.parse(s.at)) || isAfter(s.at, now)) problems.push('EDD approval has no valid date on or before the assessment time');
    }
    cps[1] = problems.length
      ? { ...cp2, status: cp2.status === 'fail' ? 'fail' : 'action_required', findings: [...cp2.findings, ...problems] }
      : { ...cp2, findings: [...cp2.findings, `EDD approved by ${s.by} on ${s.at.slice(0, 10)}`] };
  }

  // 11. Transaction monitoring and routing
  const alerts = [];
  const reports = { ttr: [], smr: null };
  {
    for (const t of input.transactions || []) {
      if (t.cash && t.amountAud >= P.cashThresholdAud) {
        const due = addBusinessDays(t.at, P.ttrDeadlineBusinessDays, holidays);
        reports.ttr.push({ transactionAt: t.at, amountAud: t.amountAud, dueBy: due, status: 'to_lodge' });
        alerts.push({ type: 'TTR_REQUIRED', severity: 'medium', queue: 'reporting', dueBy: due });
      }
      if (t.international && IFTI_SECTORS.includes(sectorId)) {
        alerts.push({ type: 'IFTI_REQUIRED', severity: 'medium', queue: 'reporting', dueBy: addBusinessDays(t.at, P.iftiDeadlineBusinessDays, holidays) });
      }
    }
    if (risk.structuring.detected) alerts.push({ type: 'STRUCTURING_PATTERN', severity: 'high', queue: 'amlco' });
    if (risk.peps.length) alerts.push({ type: 'PEP_RELATIONSHIP', severity: risk.eddRequired ? 'high' : 'medium', queue: risk.eddRequired ? 'amlco' : 'analyst' });
    if (risk.level === 'high') alerts.push({ type: 'HIGH_RISK_CUSTOMER', severity: 'high', queue: 'amlco' });
    const findings = alerts.map((a) => `${a.type} to ${a.queue} queue${a.dueBy ? ` (due ${a.dueBy.slice(0, 10)})` : ''}`);
    cps.push(result(11, alerts.length ? 'routed' : 'pass', findings.length ? findings : ['No alerts']));
    for (const a of alerts) audit.append({ at: now, actor: 'system', action: 'alert_routed', checkpoint: 11, detail: a });
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
      if (!s.formedAt || Number.isNaN(Date.parse(s.formedAt))) {
        // Never default to "now": the deadline would move every time the case is re-run.
        status = 'fail';
        findings.push('Suspicion recorded without a valid formedAt time: record when it was formed so the deadline can be set');
      } else {
        const dueBy = s.terrorismFinancing
          ? addHours(s.formedAt, P.smrTerrorismFinancingHours)
          : addBusinessDays(s.formedAt, P.smrOtherBusinessDays, holidays);
        reports.smr = { formedAt: s.formedAt, terrorismFinancing: Boolean(s.terrorismFinancing), dueBy, submittedAt: s.submittedAt || null, grounds: s.grounds || [] };
        if (s.submittedAt) {
          const late = isAfter(s.submittedAt, dueBy);
          status = late ? 'fail' : 'pass';
          findings.push(`SMR lodged ${s.submittedAt}${late ? ' after the deadline' : ''}`);
        } else if (isAfter(now, dueBy)) { status = 'fail'; findings.push(`SMR overdue: was due ${dueBy}`); }
        else { status = 'action_required'; findings.push(`SMR due by ${dueBy} (${s.terrorismFinancing ? '24 hours, terrorism financing' : '3 business days'})`); }
        audit.append({ at: now, actor: 'amlco', action: 'smr_deadline_set', checkpoint: 12, detail: { dueBy } });
      }
      findings.push('Tipping-off controls active: no customer or front-line indication permitted (AML/CTF Act s 123)');
    } else if (redFlags && !s.assessedNoSuspicion) {
      status = 'action_required';
      findings.push('Red flags present: compliance officer must record whether a suspicion is formed');
    } else {
      findings.push(s.assessedNoSuspicion ? 'Assessed: no suspicion formed' : 'No suspicion indicators');
    }
    cps.push(result(12, status, findings));
  }

  return finish({ input, audit, cps, documentsToCollect, risk, alerts, reports });
}

// 13. Archive and audit log, then state.
function finish({ input, audit, cps, documentsToCollect, risk, alerts, reports }) {
  const now = input.now;
  const retention = retentionUntil({ createdAt: now, relationshipEndedAt: input.relationshipEndedAt || null });
  audit.append({ at: now, actor: 'system', action: 'retention_set', checkpoint: 13, detail: retention });
  const chain = audit.verify();
  cps.push(result(13, chain.ok ? 'pass' : 'fail', [
    `Retain until ${retention.retainUntil.slice(0, 10)}${retention.provisional ? ' at least (relationship ongoing)' : ''}`,
    chain.ok ? `Audit chain intact (${chain.length} entries)` : `Audit chain broken at entry ${chain.brokenAt}`,
  ], { retainUntil: retention.retainUntil, retentionProvisional: retention.provisional }));

  const state = deriveState(cps);
  audit.append({ at: now, actor: 'system', action: 'state_set', detail: { state } });

  const suspicionFormed = Boolean(reports.smr) || input.suspicion?.formed === true;
  const docs = [...documentsToCollect];
  return {
    caseId: input.caseId,
    sector: input.reportingEntity.sector,
    designatedService: cps[6].designatedService,
    state,
    risk: { level: risk.level, score: risk.score, eddRequired: risk.eddRequired, factors: risk.factors },
    checkpoints: cps,
    alerts,
    reports,
    documentsToCollect: docs,
    // Once a suspicion is formed, document requests reach the customer only
    // after the compliance officer releases them (tipping-off control).
    releasedRequests: suspicionFormed ? (input.amlcoReleasedRequests || []).filter((d) => docs.includes(d)) : null,
    retainUntil: retention.retainUntil,
    retention,
    auditAnchor: { head: audit.head, length: audit.length },
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
