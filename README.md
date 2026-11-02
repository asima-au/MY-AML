# AML TurboTax for Tranche 2

AUSTRAC Tranche 2 AML/CTF readiness assessor: a conditional questionnaire that returns a 0–100 risk score, a gap register with legal references, and a tab-delimited data pack.

| Path | Purpose |
| --- | --- |
| `src/rules.ts` | Legislative rule map — pillars, sector question sets, references, penalty scope |
| `src/index.ts` | Cloudflare Worker API (`GET /v1/questionnaire`, `POST /v1/assess`, `GET /v1/health`) |
| `public/index.html` | Zero-framework Tailwind (CDN) wizard + results dashboard for Cloudflare Pages |
| `fixtures/` | Sample payloads |

Runtime has **zero npm dependencies**; `devDependencies` are build/test tooling only.

## Develop

```sh
npm install --include=dev
npm test               # engine + HTTP tests
npm run typecheck
npm run dev            # Worker on http://localhost:8787
npx serve public       # or any static server; localhost pages call :8787 automatically
```

## Deploy

```sh
npx wrangler login
npm run deploy         # Worker → https://aml-tranche2-assessor.<account>.workers.dev
```

1. Put the Worker URL in `<meta name="aml-api-base">` in `public/index.html`.
2. `npm run pages:deploy`.
3. Set `ALLOWED_ORIGINS` in `wrangler.toml` to your Pages origin and redeploy the Worker.

## Scoring

`score = triggered weight ÷ applicable weight × 100`. Missing controls and present exposures trigger their weight; questions hidden by conditional logic are excluded; **unanswered questions are scored conservatively** (as a missing control / present exposure). Any missing critical control floors the tier at `HIGH`. `designatedServices = false` returns `SCOPE_UNCONFIRMED`.

## Before production

- Legal citations in `src/rules.ts` need sign-off from a qualified AML/CTF practitioner against current legislation, the AML/CTF Rules 2025 and AUSTRAC guidance.
- The data pack is a structured record of the assessment, not an AUSTRAC-published import schema. AUSTRAC Online enrolment and reporting forms define their own fields.
- The Tailwind Play CDN suits a launch; switch to a compiled stylesheet for production performance.
