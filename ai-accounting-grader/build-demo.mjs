// Builds one HTML page that runs the grader in the browser.
// Usage: node ai-accounting-grader/build-demo.mjs [outFile]
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outFile = process.argv[2] ?? join(here, '..', 'dist', 'accounting-grader.html');
const { outputFiles } = await build({ entryPoints: [join(here, 'demo/entry.js')], bundle: true, format: 'iife', globalName: 'Grader', target: 'es2020', minify: true, write: false });
const page = readFileSync(join(here, 'demo/page.html'), 'utf8').replace('/*__GRADER_BUNDLE__*/', () => outputFiles[0].text);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, page);
console.log(`Wrote ${outFile} (${(page.length / 1024).toFixed(1)} KiB)`);
