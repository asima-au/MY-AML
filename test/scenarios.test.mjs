import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase, lookThroughOwners } from '../src/engine.js';
import { verifyChain, createAuditLog, retentionUntil } from '../src/audit.js';
import { projectForAudience, gateNotification, assertNeutral } from '../src/projection.js';
import { questionnaireFor, validateSectorAnswers, SECTOR_IDS, SECTORS } from '../src/sectors.js';
import { scenario1, scenario2, scenario3 } from './scenarios.mjs';

const RUNS = 3;

// Everything except the audit object, which holds functions; its entries are compared separately.
function snapshot(rec) {
  const { audit, ...rest } = rec;
  return JSON.stringify({ ...rest, audit: audit.export().map((e) => e.hash) });
}

function runThrice(input) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) runs.push(runCase(structuredClone(input)));
  return runs;
}

function cp(rec, id) { return rec.checkpoints[id - 1]; }

function assertBarrier(rec) {
  for (const role of ['customer', 'frontline']) {
    const view = projectForAudience(rec, role);
    assert.doesNotThrow(() => assertNeutral(view), `${role} view must be neutral`);
    assert.deepEqual(Object.keys(view).sort(), ['caseId', 'documentsRequested', 'status'], `${role} view must hold only allow-listed fields`);
  }
  const full = projectForAudience(rec, 'amlco');
  assert.ok(full.checkpoints.length === 13, 'compliance officer sees all 13 checkpoints');
}

test('Scenario 1: trust buying commercial property, 30% UBO is a domestic PEP (x3)', () => {
  const runs = runThrice(scenario1);
  assert.equal(new Set(runs.map(snapshot)).size, 1, 'three runs must produce identical results');
  for (const rec of runs) {
    assert.equal(rec.checkpoints.length, 13);
    assert.equal(cp(rec, 1).status, 'pass');
    assert.match(cp(rec, 3).findings.join(' '), /PEP identified: Alex Morgan \(domestic\)/);
    assert.equal(cp(rec, 4).status, 'pass');
    assert.equal(cp(rec, 5).status, 'pass');
    assert.equal(cp(rec, 6).status, 'pass');
    assert.deepEqual(cp(rec, 6).beneficialOwners.map((b) => b.name), ['Alex Morgan', 'Priya Nair', 'Sam Chen']);
    assert.equal(rec.risk.level, 'high');
    assert.equal(rec.risk.eddRequired, true, 'domestic PEP plus trust structure and value must trigger EDD');
    assert.equal(cp(rec, 9).status, 'pass');
    assert.equal(cp(rec, 10).status, 'pass');
    assert.ok(rec.alerts.some((a) => a.type === 'PEP_RELATIONSHIP' && a.queue === 'amlco'));
    assert.equal(rec.reports.ttr.length, 0, 'no cash, so no TTR');
    assert.equal(rec.reports.smr, null);
    assert.equal(rec.state, 'APPROVED_MONITORING');
    assert.equal(rec.retainUntil.slice(0, 10), '2033-11-03');
    assert.equal(rec.audit.verify().ok, true);
    assertBarrier(rec);
  }
});

test('Scenario 1 variant: without compliance officer EDD approval the case is held', () => {
  const input = structuredClone(scenario1);
  delete input.amlcoSignoff;
  const rec = runCase(input);
  assert.equal(cp(rec, 2).status, 'action_required');
  assert.equal(rec.state, 'ON_HOLD_EDD');
  assertBarrier(rec);
});

test('Scenario 2: accountant forming an offshore shelf company, wires from foreign and third-party accounts (x3)', () => {
  const runs = runThrice(scenario2);
  assert.equal(new Set(runs.map(snapshot)).size, 1, 'three runs must produce identical results');
  for (const rec of runs) {
    assert.equal(cp(rec, 4).status, 'pass');
    assert.equal(cp(rec, 5).status, 'not_applicable');
    assert.equal(cp(rec, 6).status, 'not_applicable');
    assert.equal(cp(rec, 7).status, 'pass');
    assert.equal(cp(rec, 7).designatedService, true);
    const ids = rec.risk.factors.map((f) => f.id);
    for (const id of ['offshore_formation', 'elevated_jurisdiction_formation', 'third_party_funds', 'cross_border_funds']) assert.ok(ids.includes(id), `missing factor ${id}`);
    assert.equal(rec.risk.level, 'high');
    assert.equal(cp(rec, 9).status, 'action_required', 'source of wealth evidence missing');
    assert.equal(cp(rec, 10).status, 'action_required', 'unverified third-party account');
    assert.match(cp(rec, 10).findings.join(' '), /third party \(Ellis Family Holdings Ltd\)/);
    assert.equal(cp(rec, 2).status, 'action_required', 'EDD approval outstanding');
    assert.equal(rec.reports.ttr.length, 0);
    assert.ok(!rec.alerts.some((a) => a.type === 'IFTI_REQUIRED'), 'an accounting firm does not lodge IFTIs for wires it receives through a bank');
    assert.equal(cp(rec, 12).status, 'action_required', 'high-risk case needs a recorded suspicion decision');
    assert.equal(rec.state, 'ON_HOLD_EDD');
    assertBarrier(rec);
  }
});

test('Scenario 3: retail cash bullion purchase over AUD 10,000 after near-threshold purchases (x3)', () => {
  const runs = runThrice(scenario3);
  assert.equal(new Set(runs.map(snapshot)).size, 1, 'three runs must produce identical results');
  for (const rec of runs) {
    assert.equal(cp(rec, 4).status, 'pass');
    assert.ok(rec.risk.factors.some((f) => f.id === 'structuring'));
    assert.ok(rec.risk.factors.some((f) => f.id === 'cash_heavy'));
    assert.equal(rec.reports.ttr.length, 1, 'one cash transaction at or above AUD 10,000');
    assert.equal(rec.reports.ttr[0].amountAud, 48000);
    assert.equal(rec.reports.ttr[0].dueBy, '2026-11-17T12:59:59.000Z', '10 business days, end of day Melbourne time');
    assert.ok(rec.alerts.some((a) => a.type === 'STRUCTURING_PATTERN' && a.queue === 'amlco'));
    assert.equal(rec.reports.smr.dueBy, '2026-11-06T12:59:59.000Z', '3 business days for a non-TF suspicion, end of day Melbourne time');
    assert.equal(cp(rec, 12).status, 'action_required');
    assert.equal(cp(rec, 10).status, 'action_required', 'cash origin not explained');
    assert.equal(rec.state, 'ON_HOLD_EDD');
    assertBarrier(rec);
    const custView = JSON.stringify(projectForAudience(rec, 'customer')).toLowerCase();
    assert.ok(!custView.includes('2026-11-06'), 'SMR deadline must not leak');
  }
});

test('SMR with a terrorism-financing suspicion is due in 24 hours', () => {
  const input = structuredClone(scenario3);
  input.suspicion = { formed: true, formedAt: '2026-11-06T10:00:00.000Z', terrorismFinancing: true };
  const rec = runCase(input);
  assert.equal(rec.reports.smr.dueBy, '2026-11-07T10:00:00.000Z');
});

test('Notification gate refuses restricted wording to customers and front-line staff', () => {
  assert.equal(gateNotification({ audienceRole: 'customer', text: 'We have lodged an SMR' }).allowed, false);
  assert.equal(gateNotification({ audienceRole: 'frontline', text: 'Customer is a PEP' }).allowed, false);
  assert.equal(gateNotification({ audienceRole: 'customer', text: 'Please upload a bank statement' }).allowed, true);
  assert.equal(gateNotification({ audienceRole: 'amlco', text: 'SMR due Friday' }).allowed, true);
});

test('Audit log detects tampering', () => {
  const rec = runCase(structuredClone(scenario1));
  assert.equal(rec.audit.verify().ok, true);
  // Tamper with a persisted copy, as an attacker with storage access would.
  const stored = rec.audit.export().map((e) => ({ ...e }));
  stored[1] = { ...stored[1], actor: 'someone_else' };
  const v = verifyChain(stored);
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
  // Deleting the last entry is caught against the recorded anchor.
  const truncated = rec.audit.export().slice(0, -1);
  assert.equal(verifyChain(truncated).ok, true, 'a truncated chain is internally consistent...');
  assert.equal(verifyChain(truncated, { expectedHead: rec.auditAnchor.head, expectedLength: rec.auditAnchor.length }).ok, false, '...but fails against the anchor');
});

test('Confirmed sanctions match blocks the case and stays neutral to the customer', () => {
  const input = structuredClone(scenario2);
  input.screening.sanctionsMatches = [{ subject: 'Morgan Ellis', list: 'DFAT Consolidated List', confirmed: true }];
  const rec = runCase(input);
  assert.equal(rec.state, 'BLOCKED_SANCTIONS');
  assertBarrier(rec);
});

test('Each of the 9 sectors has a distinct questionnaire', () => {
  assert.equal(SECTOR_IDS.length, 9);
  const shapes = new Set(SECTOR_IDS.map((s) => questionnaireFor(s).map((q) => q.id).join(',')));
  assert.equal(shapes.size, 9, 'every sector has its own questionnaire');
  for (const id of SECTOR_IDS) {
    assert.ok(['existing', 'tranche2'].includes(SECTORS[id].regime), `${id} regime`);
    assert.equal(typeof SECTORS[id].designatedServiceExempt, 'function', `${id} exemption rule`);
    assert.ok(SECTORS[id].exemptionNote, `${id} exemption note`);
    assert.ok(SECTORS[id].questions.some((q) => typeof q.required === 'function'), `${id} has a conditional question`);
    assert.ok(SECTORS[id].riskRules.every((r) => Number.isInteger(r.weight) && r.weight > 0), `${id} rule weights`);
  }
  const q = questionnaireFor('professional_services', { serviceType: 'advice_only' });
  assert.equal(q.find((x) => x.id === 'formationJurisdiction').required, false, 'branching: jurisdiction only required for formations');
});

test('Business-day deadlines count Melbourne local days, not UTC days', () => {
  const input = structuredClone(scenario3);
  // 23:00Z Monday 9 Nov = 10:00 AEDT Tuesday 10 Nov. Three business days from Tuesday: Fri 13 Nov, end of day Melbourne time.
  input.suspicion = { formed: true, formedAt: '2026-11-09T23:00:00.000Z', terrorismFinancing: false };
  const rec = runCase(input);
  assert.equal(rec.reports.smr.dueBy, '2026-11-13T12:59:59.000Z');
});

test('After a suspicion is formed, document requests are held until the compliance officer releases them', () => {
  const held = runCase(structuredClone(scenario3));
  assert.deepEqual(projectForAudience(held, 'customer').documentsRequested, []);
  const input = structuredClone(scenario3);
  input.amlcoReleasedRequests = ['Evidence of where the cash came from (for example a withdrawal receipt)'];
  const released = runCase(input);
  assert.deepEqual(projectForAudience(released, 'customer').documentsRequested, input.amlcoReleasedRequests);
  assert.ok(projectForAudience(held, 'amlco').documentsToCollect.length >= 2, 'compliance officer still sees every outstanding item');
});

// ---------------------------------------------------------------------------
// Defects found reviewing the uploaded version, and the behaviour that fixes them.
// ---------------------------------------------------------------------------

test('Audit log is append-only: entries are deep-frozen and the internal list is not exposed', () => {
  const rec = runCase(structuredClone(scenario1));
  assert.equal(rec.audit._entries, undefined);
  const [first] = rec.audit.export();
  assert.throws(() => { first.actor = 'x'; }, TypeError);
  assert.throws(() => { first.detail.caseId = 'x'; }, TypeError);
  assert.throws(() => { rec.audit.export().push({}); }, TypeError);
  assert.equal(rec.audit.verify().ok, true);
});

test('Audit view never shows case state or compliance entries to front-line staff or customers', () => {
  for (const s of [scenario1, scenario2, scenario3]) {
    const rec = runCase(structuredClone(s));
    assert.deepEqual(rec.audit.view('customer'), []);
    const frontline = rec.audit.view('frontline');
    assert.deepEqual(frontline.map((e) => e.action), ['case_opened']);
    assert.doesNotThrow(() => assertNeutral(frontline));
    assert.ok(rec.audit.view('amlco').some((e) => e.action === 'state_set'));
  }
});

test('An unresolved possible sanctions match holds the case; a cleared one does not', () => {
  const input = structuredClone(scenario2);
  input.screening.sanctionsMatches = [{ subject: 'Morgan Ellis', list: 'DFAT Consolidated List', confirmed: false }];
  const held = runCase(input);
  assert.equal(cp(held, 3).status, 'action_required');
  assert.equal(held.state, 'ON_HOLD_PRESCREEN');
  assertBarrier(held);
  input.screening.sanctionsMatches[0].cleared = true;
  const cleared = runCase(input);
  assert.equal(cp(cleared, 3).status, 'pass');
  assert.match(cp(cleared, 3).findings.join(' '), /cleared as a false positive/);
});

test('Ownership is looked through entity holders, multiplying each layer', () => {
  const input = structuredClone(scenario1);
  input.customer.owners = [
    { name: 'Priya Nair', ownershipPct: 40, identityVerified: true },
    { name: 'Morningside Investments Pty Ltd', isEntity: true, ownershipPct: 60, owners: [
      { name: 'Sam Chen', ownershipPct: 50, identityVerified: true },           // 30% effective: owner
      { name: 'Lee Park', ownershipPct: 40, identityVerified: false },          // 24% effective: not an owner
      { name: 'Ari Gold', ownershipPct: 10, identityVerified: true, control: true }, // control: owner
    ] },
  ];
  input.screening.screenedSubjects = ['Harbourline Property Trust', 'Harbourline Nominees Pty Ltd', 'Morningside Investments Pty Ltd', 'Priya Nair', 'Sam Chen', 'Lee Park', 'Ari Gold'];
  input.screening.pepMatches = [];
  const rec = runCase(input);
  assert.deepEqual(cp(rec, 6).beneficialOwners.map((b) => [b.name, b.ownershipPct, b.control]),
    [['Priya Nair', 40, false], ['Sam Chen', 30, false], ['Ari Gold', 6, true]]);
  assert.equal(cp(rec, 6).status, 'pass');
  assert.equal(cp(rec, 4).status, 'pass', 'Lee Park is below 25% and not verified, so is not required');
  assert.equal(cp(rec, 3).status, 'pass', 'every layer was screened');

  input.screening.screenedSubjects.pop();
  assert.equal(runCase(input).state, 'ON_HOLD_PRESCREEN', 'an unscreened individual inside a holding company holds the case');
});

test('Ownership above 100% at any layer, and entity holders with nobody behind them, are flagged', () => {
  const over = lookThroughOwners([
    { name: 'A', ownershipPct: 60 },
    { name: 'HoldCo', isEntity: true, ownershipPct: 40, owners: [{ name: 'B', ownershipPct: 70 }, { name: 'C', ownershipPct: 40 }] },
  ]);
  assert.match(over.findings.join(' '), /HoldCo adds up to 110%/);
  const opaque = lookThroughOwners([{ name: 'Opaque Ltd', isEntity: true, ownershipPct: 100 }]);
  assert.match(opaque.findings.join(' '), /Look through Opaque Ltd/);
  assert.equal(lookThroughOwners([{ name: 'D', ownershipPct: 24.99 }]).individuals[0].effectivePct, 24.99);
});

test('A third-party payment that is explained and verified no longer blocks source of funds', () => {
  const input = structuredClone(scenario2);
  Object.assign(input.sourceOfFunds.originAccounts[1], { verified: true, thirdPartyExplanation: "Client's family company; board minute and statement held" });
  const rec = runCase(input);
  assert.equal(cp(rec, 10).status, 'pass');
  assert.ok(rec.risk.factors.some((f) => f.id === 'third_party_funds'), 'third-party funding still adds risk');
});

test('A suspicion without formedAt fails checkpoint 12 instead of starting the clock at "now"', () => {
  const input = structuredClone(scenario3);
  delete input.suspicion.formedAt;
  const a = runCase(input);
  const b = runCase({ ...structuredClone(input), now: '2026-11-20T02:00:00.000Z', reportingEntity: input.reportingEntity });
  assert.equal(cp(a, 12).status, 'fail');
  assert.equal(a.reports.smr, null);
  assert.equal(cp(b, 12).status, 'fail', 'deadline does not drift when re-run later');
});

test('SMR deadline comparisons use instants, not string order', () => {
  const input = structuredClone(scenario3);
  input.suspicion.submittedAt = '2026-11-06T12:59:59Z'; // no milliseconds; exactly on the deadline
  assert.equal(cp(runCase(input), 12).status, 'pass');
  input.suspicion.submittedAt = '2026-11-06T13:00:00Z';
  assert.equal(cp(runCase(input), 12).status, 'fail');
});

test('EDD approval must come from the compliance officer on record, dated no later than now', () => {
  const wrongPerson = structuredClone(scenario1);
  wrongPerson.amlcoSignoff.edd.by = 'A. Frontline';
  assert.equal(runCase(wrongPerson).state, 'ON_HOLD_EDD');
  const future = structuredClone(scenario1);
  future.amlcoSignoff.edd.at = '2026-12-01T00:00:00.000Z';
  assert.equal(runCase(future).state, 'ON_HOLD_EDD');
});

test('Program approval uses calendar months', () => {
  const input = structuredClone(scenario1);
  input.reportingEntity.program.approvedAt = '2025-11-03T02:00:00.000Z'; // exactly 12 months
  assert.equal(cp(runCase(input), 2).status, 'pass');
  input.reportingEntity.program.approvedAt = '2025-11-03T01:59:59.000Z';
  assert.equal(runCase(input).state, 'ON_HOLD_PRESCREEN');
});

test('Remittance and virtual asset providers also need their AUSTRAC registration', () => {
  const input = structuredClone(scenario2);
  input.reportingEntity.sector = 'remittance';
  input.reportingEntity.austracEnrolment.sectorsRegistered = ['remittance'];
  input.sectorAnswers = { destinationCountry: 'PH', amountAud: 2000, beneficiaryRelationship: 'family', paidInCash: false };
  assert.equal(runCase(input).state, 'BLOCKED_ENROLMENT');
  input.reportingEntity.registration = { status: 'registered' };
  const rec = runCase(input);
  assert.notEqual(rec.state, 'BLOCKED_ENROLMENT');
  assert.ok(rec.alerts.some((a) => a.type === 'IFTI_REQUIRED'), 'remitters lodge IFTIs');
});

test('Exempt services skip AML/CTF checkpoints but still screen for sanctions', () => {
  const input = structuredClone(scenario2);
  input.reportingEntity.austracEnrolment = { status: 'none' };
  input.sectorAnswers = { serviceType: 'advice_only' };
  const rec = runCase(input);
  assert.equal(rec.designatedService, false);
  assert.equal(rec.state, 'APPROVED_MONITORING', 'an unenrolled firm is not blocked for advice-only work');
  assert.deepEqual(rec.checkpoints.map((c) => c.status),
    ['not_applicable', 'not_applicable', 'pass', 'not_applicable', 'not_applicable', 'not_applicable', 'pass',
      'not_applicable', 'not_applicable', 'not_applicable', 'not_applicable', 'not_applicable', 'pass']);
  input.screening.sanctionsMatches = [{ subject: 'Morgan Ellis', list: 'DFAT Consolidated List', confirmed: true }];
  assert.equal(runCase(input).state, 'BLOCKED_SANCTIONS');
});

test('Each sector exemption rule fires only on its own answers', () => {
  const cases = {
    professional_services: { serviceType: 'advice_only' },
    real_estate: { serviceScope: 'leasing_only' },
    financial_services: { productType: 'advice_only' },
    virtual_assets: { serviceType: 'non_custodial_software_only' },
    remittance: { businessModel: 'own_supplier_payments' },
    bullion: { productForm: 'jewellery', orderValueAud: 3000, cashComponentAud: 0 },
    precious_metals_stones: { itemType: 'jewellery', saleValueAud: 9000, cashComponentAud: 9000 },
    gambling: { venueType: 'hotel_or_club_egm', egmCount: 12, cashInAud: 500, minimalPlayObserved: false },
    tcsp: { serviceType: 'registered_office', formationJurisdiction: 'AU', clientIsListedCompany: true },
  };
  for (const [id, a] of Object.entries(cases)) {
    assert.deepEqual(validateSectorAnswers(id, a), [], `${id} exemption answers are valid`);
    assert.equal(SECTORS[id].designatedServiceExempt(a), true, `${id} exemption applies`);
  }
  assert.equal(SECTORS.gambling.designatedServiceExempt({ ...cases.gambling, cashInAud: 10000 }), false, 'threshold cash is never exempt');
  assert.equal(SECTORS.gambling.designatedServiceExempt({ ...cases.gambling, egmCount: 16 }), false);
  assert.equal(SECTORS.precious_metals_stones.designatedServiceExempt({ ...cases.precious_metals_stones, cashComponentAud: 10000 }), false);
});

test('Conditional questions become required from earlier answers, and unknown answers are rejected', () => {
  assert.ok(validateSectorAnswers('real_estate', { ...scenario1.sectorAnswers, buyerVehicle: 'foreign_entity' }).includes('firbApprovalHeld is required'));
  assert.ok(validateSectorAnswers('remittance', { destinationCountry: 'PH', amountAud: 1, beneficiaryRelationship: 'unknown', paidInCash: false }).includes('relationshipExplanation is required'));
  assert.ok(validateSectorAnswers('bullion', { ...scenario3.sectorAnswers, collectionMethod: 'courier' }).includes('deliveryToCustomerAddress is required'));
  assert.ok(validateSectorAnswers('bullion', { ...scenario3.sectorAnswers, cashComponentAud: '48000' }).includes('cashComponentAud must be a non-negative number'));
  assert.ok(validateSectorAnswers('tcsp', { serviceType: 'company_formation', formationJurisdiction: 'AU', favouriteColour: 'blue' }).includes('favouriteColour is not a question for this sector'));
});

test('Retention is provisional while the relationship is ongoing', () => {
  assert.deepEqual(retentionUntil({ createdAt: '2026-11-03T02:00:00.000Z' }).provisional, true);
  const ended = retentionUntil({ createdAt: '2026-11-03T02:00:00.000Z', relationshipEndedAt: '2028-02-29T00:00:00.000Z' });
  assert.equal(ended.provisional, false);
  assert.equal(ended.retainUntil.slice(0, 10), '2035-03-01');
});

test('Invalid input is rejected with every problem listed', () => {
  assert.throws(() => runCase({ caseId: '', now: 'yesterday', reportingEntity: { sector: 'casino' }, customer: { type: 'robot' } }),
    /caseId must be a non-empty string; now must be an ISO date-time string; reportingEntity.sector must be one of: .*; customer.type must be individual, company or trust/);
  assert.throws(() => createAuditLog().append({ at: 'not a date', actor: 'x', action: 'y' }), TypeError);
});
