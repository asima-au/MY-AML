import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256Hex } from '../scripts/demo/node-crypto-shim.js';

test('Browser SHA-256 shim matches node:crypto', () => {
  const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000),
    'Ünïcødé — AML/CTF s 123 ✓', JSON.stringify({ seq: 1, detail: { caseId: 'RE-2026-0001' } })];
  for (const s of inputs) assert.equal(sha256Hex(s), createHash('sha256').update(s).digest('hex'), JSON.stringify(s.slice(0, 20)));
});
