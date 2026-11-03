// Builds a single-file demo page that runs the real case engine in the browser.
// node:crypto is swapped for a pure-JS SHA-256 so audit hashes match Node's.
// Usage: node scripts/build-engine-demo.mjs [outFile]   (default: dist/engine-demo.html)
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const outFile = process.argv[2] ?? 'dist/engine-demo.html';
const shim = resolve('scripts/demo/node-crypto-shim.js');

const { outputFiles } = await build({
  entryPoints: ['scripts/demo/engine-demo-entry.js'],
  bundle: true,
  format: 'iife',
  globalName: 'AmlEngine',
  target: 'es2020',
  minify: true,
  write: false,
  plugins: [{
    name: 'node-crypto-shim',
    setup(b) { b.onResolve({ filter: /^node:crypto$/ }, () => ({ path: shim })); },
  }],
});

const template = readFileSync('scripts/demo/engine-demo.html', 'utf8');
const page = template.replace('/*__ENGINE_BUNDLE__*/', () => outputFiles[0].text);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, page);
console.log(`Wrote ${outFile} (${(page.length / 1024).toFixed(1)} KiB)`);
