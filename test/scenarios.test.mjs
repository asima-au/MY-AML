import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCase } from '../src/engine.js';
import { projectForAudience, gateNotification, assertNeutral } from '../src/projection.js';
import { questionnaireFor, SECTOR_IDS } from '../src/sectors.js';
import { scenario1, scenario2, scenario3 } from './scenarios.mjs';

const RUNS = 3;

// Everything except the audit object, which holds functions; its entries are compared separately.
function snapshot(rec) {
  const { audit, ...rest } = rec;
  return JSON.stringify({ ...rest, audit: audit._entries.map((e) => e.hash) });
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
  rec.audit._entries[1] = { ...rec.audit._entries[1], actor: 'someone_else' };
  const v = rec.audit.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
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
  assert.ok(shapes.size >= 8, 'questionnaires should differ by sector');
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
