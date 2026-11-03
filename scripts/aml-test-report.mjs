// Runs each test scenario through all 13 checkpoints three times and prints a
// Markdown report of the results, including whether the runs were identical.
// Usage: node scripts/aml-test-report.mjs
import { runCase, CHECKPOINTS } from '../src/engine.js';
import { SCENARIOS } from '../test/scenarios.mjs';

const RUNS = 3;
const fingerprint = (rec) => JSON.stringify({ ...rec, audit: rec.audit.export().map((e) => e.hash) });

for (const [name, input] of Object.entries(SCENARIOS)) {
  const runs = Array.from({ length: RUNS }, () => runCase(structuredClone(input)));
  const identical = new Set(runs.map(fingerprint)).size === 1;
  const [r] = runs;
  console.log(`\n### ${name} (${input.caseId}, ${r.sector})\n`);
  console.log(`| Checkpoint | ${runs.map((_, i) => `Run ${i + 1}`).join(' | ')} | Findings (run 1) |`);
  console.log(`|---|${runs.map(() => '---').join('|')}|---|`);
  for (const c of CHECKPOINTS) {
    const cells = runs.map((x) => x.checkpoints[c.id - 1].status);
    console.log(`| ${c.id} ${c.name} | ${cells.join(' | ')} | ${r.checkpoints[c.id - 1].findings.join('; ').replace(/\|/g, '/')} |`);
  }
  console.log(`\nState: ${runs.map((x) => x.state).join(' / ')} · Risk: ${r.risk.level} (score ${r.risk.score}) · ` +
    `Audit head: ${r.auditAnchor.head.slice(0, 16)}… (${r.auditAnchor.length} entries) · Runs identical: ${identical ? 'yes' : 'NO'}`);
  if (r.reports.ttr.length) console.log(`TTR due: ${r.reports.ttr.map((t) => t.dueBy).join(', ')}`);
  if (r.reports.smr) console.log(`SMR due: ${r.reports.smr.dueBy}`);
}
