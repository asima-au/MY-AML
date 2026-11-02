import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { assess, parseAssessmentInput } from "../src/index.ts";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/boutique-prestige-realty.json", import.meta.url), "utf8"));
const NOW = new Date("2026-11-02T00:00:00.000Z");

function post(body: unknown, headers: Record<string, string> = { "Content-Type": "application/json" }) {
  return worker.fetch(
    new Request("https://api.test/v1/assess", { method: "POST", headers, body: JSON.stringify(body) }),
    {},
  );
}

test("Boutique Prestige Realty fixture scores as CRITICAL with expected gaps", () => {
  const result = assess(parseAssessmentInput(fixture), NOW, "test-id");
  assert.equal(result.entity.sector, "real_estate");
  assert.equal(result.results.riskTier, "CRITICAL");
  assert.ok(result.results.riskScore >= 70 && result.results.riskScore <= 100);
  const gapFields = result.results.gapDetails.map((g) => g.fieldId);
  for (const field of ["PEP_SCREENING", "GOV_COMPLIANCE_OFFICER", "GOV_STAFF_TRAINING", "GOV_INDEPENDENT_EVALUATION", "TTR_LODGEMENT_PROCESS", "RE_SOURCE_OF_FUNDS"]) {
    assert.ok(gapFields.includes(field), `expected gap ${field}`);
  }
  assert.equal(result.results.gapDetails[0].severity, "critical");
});

test("data pack is a clean 3-column tab-delimited matrix", () => {
  const result = assess(parseAssessmentInput(fixture), NOW, "test-id");
  const rows = result.exportData.copyPastePayload.split("\n");
  assert.equal(rows[0], "FIELD_ID\tVALUE\tAUDIT_TRAIL");
  for (const row of rows) assert.equal(row.split("\t").length, 3, row);
  assert.ok(rows.includes("PEP_SCREENING\tNO\tGAP | PEP & Sanctions Screening | Do you screen customers and beneficial owners to determine whether they are politically exposed persons (PEPs)? | Ref: AML/CTF Rules 2025 Politically exposed persons"));
  assert.ok(rows.some((r) => r.startsWith("OPS_ANNUAL_TRANSACTION_VOLUME_AUD\tAUD 42000000\tRISK_FACTOR")));
  assert.ok(rows.some((r) => r.startsWith("RE_PROXY_PURCHASER_CONTROLS\tNOT_ANSWERED\tGAP")));
});

test("conditional questions are N/A when their trigger is not met", () => {
  const input = structuredClone(fixture);
  input.complianceInputs.cashOver10k = false;
  const result = assess(parseAssessmentInput(input), NOW, "id");
  assert.ok(result.exportData.copyPastePayload.includes("TTR_LODGEMENT_PROCESS\tN/A\tNOT_APPLICABLE"));
});

test("fully controlled, low-exposure entity scores LOW", () => {
  const controls = Object.fromEntries(
    ["designatedServices", "austracEnrolled", "mlTfRiskAssessment", "cddProcedures", "beneficialOwnershipVerification", "ecddProcedure", "ongoingCdd", "pepScreening", "sanctionsScreening", "smrProcess", "recordKeeping", "staffTraining", "employeeDueDiligence", "independentAuditCycle"].map((k) => [k, true]),
  );
  const result = assess(
    parseAssessmentInput({
      meta: { organizationName: "Clean Co" },
      businessType: "accounting",
      complianceInputs: { ...controls, cashOver10k: false },
      operationalMetrics: { hasAppointedComplianceOfficer: true, annualTransactionVolume: 500000, totalActiveStaff: 3 },
      industrySpecifics: { businessStructuresAdvisory: false, preparesHighValueAssetSales: false, handlesClientFunds: false, taxVarianceMonitoring: true, highValueClientTransactions: false },
    }),
    NOW,
    "id",
  );
  assert.equal(result.results.riskScore, 0);
  assert.equal(result.results.riskTier, "LOW");
  assert.equal(result.results.identifiedGaps.length, 0);
});

test("designatedServices=false yields SCOPE_UNCONFIRMED", () => {
  const input = structuredClone(fixture);
  input.complianceInputs.designatedServices = false;
  assert.equal(assess(parseAssessmentInput(input), NOW, "id").results.riskTier, "SCOPE_UNCONFIRMED");
});

test("tabs and newlines in entity name cannot break the matrix", () => {
  const input = structuredClone(fixture);
  input.meta.organizationName = "Evil\tCo\nINJECTED\tROW";
  const rows = assess(parseAssessmentInput(input), NOW, "id").exportData.copyPastePayload.split("\n");
  assert.equal(rows[1], "ENTITY_NAME\tEvil Co INJECTED ROW\tDeclared by assessed entity");
});

test("HTTP: valid POST returns 200 with CORS", async () => {
  const res = await post(fixture);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const body = (await res.json()) as { results: { riskTier: string } };
  assert.equal(body.results.riskTier, "CRITICAL");
});

test("HTTP: validation, content-type and routing errors carry CORS headers", async () => {
  const bad = await post({ businessType: "casino", complianceInputs: { pepScreening: "yes" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await post(fixture, { "Content-Type": "text/plain" })).status, 415);
  const notFound = await worker.fetch(new Request("https://api.test/nope"), {});
  assert.equal(notFound.status, 404);
  const preflight = await worker.fetch(new Request("https://api.test/v1/assess", { method: "OPTIONS" }), {});
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("Access-Control-Allow-Methods") ?? "", /POST/);
});

test("HTTP: ALLOWED_ORIGINS restricts CORS", async () => {
  const env = { ALLOWED_ORIGINS: "https://app.example" };
  const req = (origin: string) =>
    worker.fetch(new Request("https://api.test/v1/health", { headers: { Origin: origin } }), env);
  assert.equal((await req("https://app.example")).headers.get("Access-Control-Allow-Origin"), "https://app.example");
  assert.equal((await req("https://evil.example")).headers.get("Access-Control-Allow-Origin"), null);
});
