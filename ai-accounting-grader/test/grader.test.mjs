import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ITEMS, getItem, modelAnswer } from '../src/items.js';
import { grade } from '../src/grade.js';
import { parseJournalLines, canonicalAccount, checkArithmetic, extractNumbers } from '../src/parse.js';

const categories = (r) => r.findings.map((f) => f.category);

test('Every gold answer grades 5 with no findings (the bank checks itself)', () => {
  for (const item of ITEMS) {
    const r = grade(item, modelAnswer(item));
    assert.equal(r.rating, 5, `${item.id}: ${JSON.stringify(r.findings)}`);
    assert.deepEqual(r.findings, [], item.id);
    assert.ok(r.arithmetic.every((a) => a.ok), `${item.id} working arithmetic`);
  }
});

test('Gold journal entries balance', () => {
  for (const item of ITEMS) for (const entry of item.entries) {
    const dr = entry.filter((l) => l[1] === 'dr').reduce((s, l) => s + l[2], 0);
    const cr = entry.filter((l) => l[1] === 'cr').reduce((s, l) => s + l[2], 0);
    assert.ok(Math.abs(dr - cr) < 0.005, `${item.id} ${dr} vs ${cr}`);
  }
});

test('Every flawed sample is caught with a specific diagnosis and rated 2 or below', () => {
  for (const item of ITEMS) {
    const r = grade(item, item.flawed);
    assert.ok(r.rating <= 2, `${item.id} rated ${r.rating}`);
    assert.ok(categories(r).some((c) => ['standard', 'arithmetic'].includes(c)), `${item.id}: ${categories(r)}`);
  }
});

test('Item bank covers bookkeeping, reporting standards and tax', () => {
  assert.deepEqual([...new Set(ITEMS.map((i) => i.domain))].sort(), ['Bookkeeping', 'Reporting standards', 'Tax']);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, ITEMS.length);
});

test('Parser reads the formats models use', () => {
  const formats = [
    'Dr Accounts receivable 11,000\nCr Sales revenue 10,000\nCr GST payable 1,000',
    'Debit: Accounts Receivable – $11,000\nCredit: Sales – $10,000\nCredit: GST Collected – $1,000',
    '| Account | Debit | Credit |\n|---|---|---|\n| Trade receivables | 11,000 | |\n| Revenue | | 10,000 |\n| GST payable | | 1,000 |',
    'Accounts receivable Dr 11,000\nTo Sales a/c Cr 10,000\nTo GST payable Cr 1,000',
    '1. **Dr** Debtors $11,000; Cr Sales $10,000; Cr GST liability $1,000',
  ];
  for (const f of formats) {
    const r = grade(getItem('B1'), `${f}\nGST = 11,000 ÷ 11 = 1,000`);
    assert.equal(r.rating, 5, `${f}\n${JSON.stringify(r.findings)}`);
  }
});

test('Account names map by longest match', () => {
  assert.equal(canonicalAccount('Accumulated depreciation – machinery'), 'Accumulated depreciation');
  assert.equal(canonicalAccount('Depreciation'), 'Depreciation expense');
  assert.equal(canonicalAccount('Bank charges'), 'Bank fees expense');
  assert.equal(canonicalAccount('Cost of sales'), 'Inventory write-down expense');
  assert.equal(canonicalAccount('Unearned revenue'), 'Contract liability');
  assert.equal(canonicalAccount('Interest on lease liability'), 'Interest expense');
  assert.equal(canonicalAccount('Petty cash float voucher'), 'Cash at bank');
  assert.equal(canonicalAccount('Goodwill'), null);
});

test('Unbalanced entries, wrong sides and missing lines are reported', () => {
  const item = getItem('B2');
  const unbalanced = grade(item, 'Working: 12,000 × 3 ÷ 12 = 3,000\nDr Insurance expense 3,000\nCr Prepaid insurance 2,000');
  assert.ok(categories(unbalanced).includes('balance'));
  assert.ok(unbalanced.rating <= 2);
  const reversed = grade(item, 'Working: 12,000 × 3 ÷ 12 = 3,000\nDr Prepaid insurance 3,000\nCr Insurance expense 3,000');
  assert.deepEqual(categories(reversed).filter((c) => c === 'side').length, 2);
  const half = grade(item, 'Working: 12,000 × 3 ÷ 12 = 3,000\nDr Insurance expense 3,000');
  assert.ok(categories(half).includes('missing') && categories(half).includes('balance'));
});

test('Arithmetic checker recomputes stated calculations, with precedence and percentages', () => {
  const r = checkArithmetic('a) 12,000 × 3 ÷ 12 = 3,000 b) 25,400 + 3,200 − 4,100 = 24,500 c) 15,000 × 30% = 4,050 d) 2 + 3 x 4 = 14 e) $27,232.48 × 5% = $1,361.62');
  assert.deepEqual(r.map((x) => x.ok), [true, true, false, true, true]);
  assert.equal(r[2].actual, 4500);
});

test('Numbers are read whole, not as fragments of labels or larger numbers', () => {
  assert.deepEqual(extractNumbers('Label 1A: $5,000; wages $10,000; 2.5%'), [5000, 10000, 2.5]);
});

test('A correct answer in different words still scores full marks', () => {
  const answer = `Under AASB 16 the lessee recognises a right-of-use asset.
PV = 10,000 × 2.723248 = 27,232.48
| Account | Debit | Credit |
|---|---|---|
| ROU asset | 27,232.48 | |
| Lease liabilities | | 27,232.48 |
| Finance costs | 1,361.62 | |
| Lease liabilities | 8,638.38 | |
| Cash | | 10,000.00 |
| Depreciation | 9,077.49 | |
| Accumulated depreciation | | 9,077.49 |`;
  assert.equal(grade(getItem('R3'), answer).rating, 5);
});

test('Prose lines are not mistaken for journal lines', () => {
  assert.deepEqual(parseJournalLines('Credit sales are recognised when control of the goods passes to the customer in 2025'), []);
});
