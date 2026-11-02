// Builds a single self-contained demo page: the Worker is bundled into the page and
// /v1/* requests are served in-browser, so the UI runs with no deployed backend.
// Usage: node scripts/build-demo.mjs [outFile]   (default: dist/demo.html)
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const outFile = process.argv[2] ?? "dist/demo.html";
const html = readFileSync("public/index.html", "utf8");
const sample = readFileSync("fixtures/boutique-prestige-realty.json", "utf8");

const { outputFiles } = await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  format: "iife",
  globalName: "AmlWorker",
  target: "es2020",
  minify: true,
  write: false,
});

const shim = `<script>
${outputFiles[0].text}
window.AML_DEMO_MODE = true;
window.AML_SAMPLE_PAYLOAD = ${JSON.stringify(JSON.parse(sample))};
(() => {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/v1/")) return nativeFetch(input, init);
    return AmlWorker.default.fetch(new Request("https://demo.local" + url.pathname, init), {});
  };
})();
</script>`;

const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*/g, "");
const bodyMatch = html.match(/<body class="([^"]*)">([\s\S]*?)<\/body>/);
const body = bodyMatch[2].replace(/<script>\s*"use strict";/, `${shim}\n  <script>\n  "use strict";`);

const page = `${head.trim()}
<div class="${bodyMatch[1]}">
${body.trim()}
</div>
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, page);
console.log(`Wrote ${outFile} (${(page.length / 1024).toFixed(1)} KiB)`);
