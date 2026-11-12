// Grades an AI answer against a gold item and writes the reviewer's report.

import { parseJournalLines, extractNumbers, checkArithmetic, canonicalAccount } from './parse.js';
import { modelAnswer } from './items.js';

const fmt = (n) => n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
const SIDE = { dr: 'debit', cr: 'credit' };

export const CATEGORIES = {
  standard: 'Misapplied standard',
  balance: 'Does not balance',
  amount: 'Wrong amount',
  side: 'Wrong side',
  missing: 'Missing',
  arithmetic: 'Arithmetic slip',
  figure: 'Wrong or missing figure',
  extra: 'Unexpected line',
  concept: 'Reasoning gap',
};

/**
 * Returns { rating (1-5), verdict, accuracy, findings[], parsedLines[], arithmetic[], modelAnswer }.
 * Rating: 5 = matches a careful professional; 4 = correct with a gap in reasoning or presentation;
 * 3 = partly correct; 2 = materially wrong or misapplies a standard; 1 = little of value.
 */
export function grade(item, answer) {
  const tol = item.tolerance ?? 0.5;
  const near = (a, b) => Math.abs(a - b) <= tol;
  const parsed = parseJournalLines(answer);
  const numbers = extractNumbers(answer);
  const arithmetic = checkArithmetic(answer);
  const findings = [];
  const add = (category, message, severity = 'major') => findings.push({ category, label: CATEGORIES[category], severity, message });

  // Known failure patterns first, so their specific diagnosis leads the report.
  const trapLines = new Set();
  let trapHit = false;
  for (const trap of item.traps) {
    let hit = false;
    if (trap.line) {
      const [account, side, amount] = trap.line;
      const canonical = canonicalAccount(account);
      parsed.forEach((p, i) => {
        if (p.canonical === canonical && p.side === side && (amount === undefined || near(p.amount, amount))) { hit = true; trapLines.add(i); }
      });
    } else if (trap.figure !== undefined) hit = numbers.some((n) => near(n, trap.figure));
    else if (trap.text) hit = trap.text.test(answer);
    if (hit) { trapHit = true; add(trap.category, trap.finding); }
  }

  // Journal entries: match each gold line to one parsed line (account, side, amount).
  const goldLines = item.entries.flat().map(([account, side, amount]) => ({ account, canonical: canonicalAccount(account), side, amount }));
  const used = new Set();
  let matched = 0;
  let partly = 0; // right account and side, wrong amount: half credit
  for (const g of goldLines) {
    const exact = parsed.findIndex((p, i) => !used.has(i) && p.canonical === g.canonical && p.side === g.side && near(p.amount, g.amount));
    if (exact >= 0) { used.add(exact); matched += 1; continue; }
    const sameSide = parsed.findIndex((p, i) => !used.has(i) && p.canonical === g.canonical && p.side === g.side);
    if (sameSide >= 0) {
      used.add(sameSide);
      partly += 1;
      if (!trapLines.has(sameSide)) add('amount', `${g.account} ${SIDE[g.side]} is ${fmt(parsed[sameSide].amount)}; it should be ${fmt(g.amount)}.`);
      continue;
    }
    const otherSide = parsed.findIndex((p, i) => !used.has(i) && p.canonical === g.canonical && p.side !== g.side);
    if (otherSide >= 0) { used.add(otherSide); add('side', `${g.account} is ${SIDE[parsed[otherSide].side]}ed; it should be a ${SIDE[g.side]} of ${fmt(g.amount)}.`); continue; }
    add('missing', `No ${SIDE[g.side]} to ${g.account} (${fmt(g.amount)}).`);
  }
  parsed.forEach((p, i) => {
    if (used.has(i) || trapLines.has(i)) return;
    add('extra', p.canonical ? `Unexpected ${SIDE[p.side]} to ${p.account} (${fmt(p.amount)}).` : `Unrecognised account "${p.account}" (${SIDE[p.side]} ${fmt(p.amount)}).`, 'minor');
  });

  // Debits must equal credits.
  if (parsed.length) {
    const dr = parsed.filter((p) => p.side === 'dr').reduce((s, p) => s + p.amount, 0);
    const cr = parsed.filter((p) => p.side === 'cr').reduce((s, p) => s + p.amount, 0);
    if (Math.abs(dr - cr) > 0.005) add('balance', `Debits total ${fmt(dr)} but credits total ${fmt(cr)}.`);
  }

  // Required figures.
  let figuresFound = 0;
  for (const k of item.keyFigures) {
    if (numbers.some((n) => near(n, k.value))) figuresFound += 1;
    else add('figure', `${k.label} should be ${fmt(k.value)}; that figure does not appear.`);
  }

  // Stated calculations.
  for (const a of arithmetic.filter((x) => !x.ok)) add('arithmetic', `"${a.expression}" is wrong: it comes to ${fmt(a.actual)}.`);

  // Reasoning the answer should show.
  for (const c of item.mustMention) if (!c.pattern.test(answer)) add('concept', `Does not mention ${c.label}.`, 'minor');
  if (!/[=÷×]|because|so that|therefore|working/i.test(answer)) add('concept', 'No working shown.', 'minor');

  const total = goldLines.length + item.keyFigures.length;
  const accuracy = total ? (matched + partly / 2 + figuresFound) / total : 1;
  const major = new Set(findings.filter((f) => f.severity === 'major').map((f) => f.category));
  let rating;
  if (!major.size) rating = findings.length ? 4 : 5;
  else if (trapHit || major.has('balance')) rating = accuracy >= 0.3 ? 2 : 1;
  else if (accuracy === 1) rating = 3; // entries right, but a stated calculation is wrong
  else if (major.has('arithmetic') && !major.has('side') && !major.has('missing')) rating = 2; // right method, slip carried through
  else rating = accuracy >= 0.6 ? 3 : accuracy >= 0.3 ? 2 : 1;

  const verdict = {
    5: 'Correct. Matches what a careful professional would give.',
    4: 'Correct figures, but the reasoning or presentation has gaps.',
    3: 'Partly correct. Some entries or figures are wrong or missing.',
    2: 'Materially wrong. Misapplies a standard or does not balance.',
    1: 'Not usable. Little of the answer is correct.',
  }[rating];

  return { itemId: item.id, rating, verdict, accuracy, findings, parsedLines: parsed, arithmetic, modelAnswer: modelAnswer(item) };
}
