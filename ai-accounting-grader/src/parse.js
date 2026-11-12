// Reads a free-text AI answer: journal lines, every number, and stated calculations.

// Canonical accounts and the names models use for them. The longest matching
// name wins, so "accumulated depreciation" beats "depreciation" and
// "bank fees" beats "bank".
export const ACCOUNTS = {
  'Accounts receivable': ['accounts receivable', 'trade receivables', 'trade debtors', 'debtors', 'receivables', 'ar'],
  'Sales revenue': ['sales revenue', 'sales', 'revenue', 'sales income', 'income'],
  'GST payable': ['gst payable', 'gst collected', 'gst liability', 'gst on sales', 'output gst', 'gst'],
  'Insurance expense': ['insurance expense', 'insurance'],
  'Prepaid insurance': ['prepaid insurance', 'prepayments', 'prepaid expenses', 'insurance prepaid'],
  'Wages expense': ['wages expense', 'wages', 'salaries expense', 'salaries and wages expense', 'wages and salaries'],
  'Wages payable': ['wages payable', 'accrued wages', 'salaries payable', 'accrued salaries', 'accrued expenses'],
  'Bad debts expense': ['bad debts expense', 'bad debt expense', 'bad debts', 'doubtful debts expense', 'impairment expense', 'impairment loss on receivables', 'expected credit loss expense', 'credit loss expense'],
  'Allowance for doubtful debts': ['allowance for doubtful debts', 'allowance for expected credit losses', 'provision for doubtful debts', 'allowance for impairment', 'loss allowance', 'allowance for doubtful accounts'],
  'Bank fees expense': ['bank fees expense', 'bank fees', 'bank charges', 'bank charges expense', 'bank service charges'],
  'Cash at bank': ['cash at bank', 'cash', 'bank', 'bank account', 'cash at bank account'],
  'Depreciation expense': ['depreciation expense', 'depreciation'],
  'Accumulated depreciation': ['accumulated depreciation'],
  Machinery: ['machinery', 'machine', 'equipment', 'plant and equipment'],
  'Right-of-use asset': ['right of use asset', 'rou asset', 'right of use'],
  'Lease liability': ['lease liability', 'lease liabilities', 'finance lease liability'],
  'Interest expense': ['interest expense', 'finance cost', 'finance costs', 'interest on lease liability', 'interest'],
  'Lease expense': ['lease expense', 'rent expense', 'rental expense', 'operating lease expense', 'rent'],
  'Contract liability': ['contract liability', 'deferred revenue', 'unearned revenue', 'unearned service revenue', 'unearned income'],
  'Inventory write-down expense': ['inventory write down expense', 'inventory write down', 'write down of inventory', 'cost of goods sold', 'cost of sales', 'loss on inventory', 'inventory impairment'],
  Inventory: ['inventory', 'inventories', 'stock'],
  'Income tax expense': ['income tax expense', 'tax expense', 'deferred tax expense'],
  'Deferred tax liability': ['deferred tax liability', 'dtl'],
  'Deferred tax asset': ['deferred tax asset', 'dta'],
};

const normalise = (s) => ` ${s.toLowerCase().replace(/&/g, ' and ').replace(/\ba\/c\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const SYNONYMS = Object.entries(ACCOUNTS).flatMap(([canonical, names]) => names.map((n) => ({ canonical, key: normalise(n) })));

/** Maps an account name to its canonical form, or null if unrecognised. */
export function canonicalAccount(name) {
  const n = normalise(name.replace(/\([^)]*\)/g, ' ').replace(/^\s*to\s+/i, ' ').replace(/\baccount\b/gi, ' '));
  let best = null;
  for (const s of SYNONYMS) if (n.includes(s.key) && (!best || s.key.length > best.key.length)) best = s;
  return best ? best.canonical : null;
}

const AMOUNT = String.raw`\(?-?\$?\s?(?:AUD\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\)?`;
const toNumber = (s) => Number(s.replace(/,/g, ''));

function cleanLine(raw) {
  return raw.replace(/\*\*|__|`/g, '').replace(/^\s*(?:[-*•]|\d+[.)])\s+(?=\D)/, '').trim();
}

/** Extracts journal lines: Dr/Cr or Debit/Credit lines and markdown tables with Debit/Credit columns. */
export function parseJournalLines(text) {
  const lines = [];
  let table = null; // { account, debit, credit } column indexes
  const rows = text.split(/\r?\n|;\s+(?=(?:dr|cr|debit|credit)\b)/i);
  for (const raw of rows) {
    const line = cleanLine(raw);
    if (!line) { table = null; continue; }

    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      const lower = cells.map((c) => c.toLowerCase());
      const debit = lower.findIndex((c) => /^(debit|dr)\b/.test(c));
      const credit = lower.findIndex((c) => /^(credit|cr)\b/.test(c));
      if (debit >= 0 && credit >= 0) {
        table = { debit, credit, account: lower.findIndex((c, i) => i !== debit && i !== credit && /account|particulars|description|ledger/.test(c)) };
        if (table.account < 0) table.account = [0, 1, 2].find((i) => i !== debit && i !== credit);
        continue;
      }
      if (table) {
        const account = cells[table.account] || '';
        for (const [side, idx] of [['dr', table.debit], ['cr', table.credit]]) {
          const m = new RegExp(`^${AMOUNT}$`).exec((cells[idx] || '').trim());
          if (m && account) lines.push({ account, canonical: canonicalAccount(account), side, amount: toNumber(m[1]), source: line });
        }
      }
      continue;
    }
    table = null;

    // "Dr Account 1,000", "Debit: Account – $1,000", "Cr. To Account 1,000"
    let m = new RegExp(String.raw`^(dr|debit|cr|credit)\b\.?\s*[:\-–]?\s*(.+?)[\s:\-–]*${AMOUNT}\s*\.?$`, 'i').exec(line);
    // "Account Dr 1,000" or "Account (Dr) 1,000"
    if (!m) {
      const alt = new RegExp(String.raw`^(.+?)\s+\(?(dr|debit|cr|credit)\)?\.?\s*[:\-–]?\s*${AMOUNT}\s*\.?$`, 'i').exec(line);
      if (alt) m = [alt[0], alt[2], alt[1], alt[3]];
    }
    if (!m) continue;
    const account = m[2].trim();
    if (account.split(/\s+/).length > 8) continue; // prose, not a journal line
    lines.push({ account, canonical: canonicalAccount(account), side: /^d/i.test(m[1]) ? 'dr' : 'cr', amount: toNumber(m[3]), source: line });
  }
  return lines;
}

/** Every number written in the answer. */
export function extractNumbers(text) {
  return [...text.replace(/\$/g, '').matchAll(/(?<![\w.])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\w])/g)].map((m) => toNumber(m[1]));
}

const OP = String.raw`[×x*\/÷+\-−–]`;
const NUM = String.raw`\d[\d,]*(?:\.\d+)?%?`;

function evaluate(tokens) {
  const vals = [];
  const ops = [];
  const value = (t) => (t.endsWith('%') ? toNumber(t.slice(0, -1)) / 100 : toNumber(t));
  vals.push(value(tokens[0]));
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const v = value(tokens[i + 1]);
    if ('×x*'.includes(op)) vals.push(vals.pop() * v);
    else if ('/÷'.includes(op)) vals.push(vals.pop() / v);
    else { ops.push(op); vals.push(v); }
  }
  let total = vals[0];
  ops.forEach((op, i) => { total = op === '+' ? total + vals[i + 1] : total - vals[i + 1]; });
  return total;
}

/** Finds stated calculations such as "12,000 × 3 ÷ 12 = 3,000" and recomputes them. */
export function checkArithmetic(text) {
  const prepared = text.replace(/\$/g, '').replace(/(\d)\s+x\s+(\d)/g, '$1 × $2');
  const re = new RegExp(String.raw`(${NUM}(?:\s*${OP}\s*${NUM})+)\s*=\s*(${NUM.replace('%?', '')})`, 'g');
  const results = [];
  for (const m of prepared.matchAll(re)) {
    const tokens = m[1].match(new RegExp(String.raw`${NUM}|${OP}`, 'g'));
    const stated = toNumber(m[2]);
    const actual = evaluate(tokens);
    const ok = Math.abs(actual - stated) <= Math.max(0.01, Math.abs(actual) * 0.0005);
    results.push({ expression: `${m[1].trim()} = ${m[2]}`, stated, actual: Math.round(actual * 100) / 100, ok });
  }
  return results;
}
