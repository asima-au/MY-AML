#!/usr/bin/env node
// Usage:
//   node ai-accounting-grader/cli.mjs list
//   node ai-accounting-grader/cli.mjs prompt B1          the test prompt to give a model
//   node ai-accounting-grader/cli.mjs answer B1          the model answer with working
//   node ai-accounting-grader/cli.mjs grade B1 file.txt  grade an AI answer (or pipe it on stdin)
import { readFileSync } from 'node:fs';
import { ITEMS, getItem, modelAnswer } from './src/items.js';
import { grade } from './src/grade.js';

const [cmd, id, file] = process.argv.slice(2);
if (cmd === 'list') for (const i of ITEMS) console.log(`${i.id}  ${i.domain.padEnd(20)} ${i.title}  (${i.standard})`);
else if (cmd === 'prompt') console.log(getItem(id).prompt);
else if (cmd === 'answer') console.log(modelAnswer(getItem(id)));
else if (cmd === 'grade') {
  const text = readFileSync(file ?? 0, 'utf8');
  const r = grade(getItem(id), text);
  console.log(`Rating: ${r.rating}/5. ${r.verdict}`);
  for (const f of r.findings) console.log(`- [${f.label}] ${f.message}`);
  if (r.rating < 5) console.log(`\nCorrect answer:\n${r.modelAnswer}`);
} else {
  console.log('Commands: list | prompt <id> | answer <id> | grade <id> [file]');
  process.exitCode = 1;
}
