// index.ts — Cloudflare Worker: AUSTRAC Tranche 2 AML/CTF readiness assessment API.
//
// Routes
//   GET  /v1/questionnaire   Sectors, pillars and question rules for the client wizard.
//   POST /v1/assess          Scores a questionnaire payload and returns the gap register + data pack.
//   GET  /v1/health          Liveness probe.

import {
  LEGAL_DISCLAIMER,
  PILLARS,
  RULESET_VERSION,
  SECTORS,
  SECTOR_ALIASES,
  SEVERITY_ORDER,
  getPillar,
  getQuestionSet,
  type AnswerGroup,
  type PillarId,
  type QuestionRule,
  type SectorId,
  type Severity,
} from "./rules.ts";

export interface Env {
  /** Comma-separated list of allowed browser origins. Empty or unset allows any origin. */
  ALLOWED_ORIGINS?: string;
}

const ENGINE_VERSION = "aml-tranche2-assessor/1.0.0";
const MAX_BODY_BYTES = 16_384;
const MAX_TEXT_LENGTH = 160;
const ANSWER_GROUPS: readonly AnswerGroup[] = ["complianceInputs", "industrySpecifics", "operationalMetrics"];
const DATA_PACK_COLUMNS = ["FIELD_ID", "VALUE", "AUDIT_TRAIL"] as const;

type AnswerValue = boolean | number;
type AnswerMap = Readonly<Record<AnswerGroup, Readonly<Record<string, AnswerValue>>>>;

export interface AssessmentInput {
  readonly sector: SectorId;
  readonly organizationName: string;
  readonly location: string;
  readonly assessmentTarget: string;
  readonly answers: AnswerMap;
}

export type RiskTier = "CRITICAL" | "HIGH" | "MODERATE" | "LOW" | "SCOPE_UNCONFIRMED";
type QuestionStatus = "GAP" | "RISK_FACTOR" | "CONTROL_IN_PLACE" | "NOT_TRIGGERED" | "NOT_APPLICABLE" | "INFORMATIONAL";

export interface GapDetail {
  readonly fieldId: string;
  readonly pillar: PillarId;
  readonly pillarTitle: string;
  readonly severity: Severity;
  readonly finding: string;
  readonly references: readonly string[];
  readonly answered: boolean;
}

export interface PillarSummary {
  readonly pillar: PillarId;
  readonly title: string;
  readonly score: number;
  readonly gapCount: number;
  readonly riskFactorCount: number;
  readonly penaltyScope: string;
}

export interface AssessmentResult {
  readonly meta: {
    readonly engine: string;
    readonly rulesetVersion: string;
    readonly jurisdiction: string;
    readonly statutoryFramework: string;
    readonly assessmentId: string;
    readonly assessedAt: string;
    readonly disclaimer: string;
  };
  readonly entity: {
    readonly organizationName: string;
    readonly location: string;
    readonly assessmentTarget: string;
    readonly sector: SectorId;
    readonly sectorLabel: string;
  };
  readonly results: {
    readonly riskScore: number;
    readonly riskTier: RiskTier;
    readonly criticalGapCount: number;
    readonly unansweredCount: number;
    readonly identifiedGaps: readonly string[];
    readonly riskFactors: readonly string[];
    readonly gapDetails: readonly GapDetail[];
    readonly pillarSummary: readonly PillarSummary[];
  };
  readonly exportData: {
    readonly columns: readonly string[];
    readonly copyPastePayload: string;
  };
}

class RequestError extends Error {
  readonly status: number;
  readonly details: readonly string[];

  constructor(status: number, message: string, details: readonly string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, field: string, errors: string[], required: boolean): string {
  if (value === undefined || value === null || value === "") {
    if (required) errors.push(`${field} is required.`);
    return "";
  }
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return "";
  }
  // Strip control characters (incl. tabs/newlines) so values cannot break the tab-delimited matrix.
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length > MAX_TEXT_LENGTH) errors.push(`${field} must be ${MAX_TEXT_LENGTH} characters or fewer.`);
  return cleaned.slice(0, MAX_TEXT_LENGTH);
}

function resolveSector(value: unknown): SectorId | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.trim().toLowerCase();
  if (key in SECTORS) return key as SectorId;
  return SECTOR_ALIASES[key];
}

export function parseAssessmentInput(body: unknown): AssessmentInput {
  if (!isRecord(body)) throw new RequestError(400, "Request body must be a JSON object.");

  const errors: string[] = [];
  const sector = resolveSector(body.businessType);
  if (!sector) {
    errors.push(`businessType must be one of: ${Object.keys(SECTORS).join(", ")}.`);
  }

  const meta = isRecord(body.meta) ? body.meta : {};
  const organizationName = cleanText(meta.organizationName, "meta.organizationName", errors, true);
  const location = cleanText(meta.location, "meta.location", errors, false);
  const assessmentTarget = cleanText(meta.assessmentTarget, "meta.assessmentTarget", errors, false);

  const knownQuestions = sector ? getQuestionSet(sector) : [];
  const answers = {} as Record<AnswerGroup, Record<string, AnswerValue>>;

  for (const group of ANSWER_GROUPS) {
    answers[group] = {};
    const raw = body[group];
    if (raw === undefined) continue;
    if (!isRecord(raw)) {
      errors.push(`${group} must be an object.`);
      continue;
    }
    for (const [key, value] of Object.entries(raw)) {
      const rule = knownQuestions.find((q) => q.id === key);
      if (!rule) continue; // Unknown keys are ignored, never echoed back.
      if (value === null || value === undefined) continue;
      if (rule.input === "boolean") {
        if (typeof value !== "boolean") errors.push(`${group}.${key} must be true or false.`);
        else answers[group][key] = value;
      } else if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > rule.max) {
        errors.push(`${group}.${key} must be a number between 0 and ${rule.max}.`);
      } else {
        answers[group][key] = rule.input === "count" ? Math.floor(value) : value;
      }
    }
  }

  if (errors.length > 0 || !sector) throw new RequestError(400, "Payload validation failed.", errors);

  return { sector, organizationName, location, assessmentTarget, answers };
}

// ---------------------------------------------------------------------------
// Scoring engine
// ---------------------------------------------------------------------------

/** Looks up an answer in its declared group first, then any group (tolerates clients that file keys elsewhere). */
function lookupAnswer(answers: AnswerMap, rule: QuestionRule): AnswerValue | undefined {
  const direct = answers[rule.group][rule.id];
  if (direct !== undefined) return direct;
  for (const group of ANSWER_GROUPS) {
    const value = answers[group][rule.id];
    if (value !== undefined) return value;
  }
  return undefined;
}

function isVisible(rule: QuestionRule, answers: AnswerMap, rules: readonly QuestionRule[]): boolean {
  if (!rule.showIf) return true;
  return rule.showIf.anyOf.some(({ questionId, equals }) => {
    const parent = rules.find((q) => q.id === questionId);
    return parent !== undefined && lookupAnswer(answers, parent) === equals;
  });
}

function formatReference(ref: { instrument: string; provision: string }): string {
  return `${ref.instrument} ${ref.provision}`;
}

function formatValue(rule: QuestionRule, value: AnswerValue | undefined, visible: boolean): string {
  if (!visible) return "N/A";
  if (value === undefined) return "NOT_ANSWERED";
  if (typeof value === "boolean") return value ? "YES" : "NO";
  return rule.input === "currency" ? `AUD ${Math.round(value)}` : String(value);
}

function tierFor(score: number, criticalGapCount: number, scopeConfirmed: boolean): RiskTier {
  if (!scopeConfirmed) return "SCOPE_UNCONFIRMED";
  const byScore: RiskTier = score >= 70 ? "CRITICAL" : score >= 45 ? "HIGH" : score >= 20 ? "MODERATE" : "LOW";
  // Any missing critical control floors the tier at HIGH regardless of score.
  if (criticalGapCount > 0 && (byScore === "MODERATE" || byScore === "LOW")) return "HIGH";
  return byScore;
}

function sanitizeCell(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

/**
 * Score = triggered weight ÷ applicable weight × 100, rounded.
 * Applicable = visible questions with weight > 0. Triggered = missing controls, present exposures,
 * and unanswered questions (scored conservatively as a missing control / present exposure).
 */
export function assess(input: AssessmentInput, now: Date, assessmentId: string): AssessmentResult {
  const rules = getQuestionSet(input.sector);
  const sector = SECTORS[input.sector];
  const assessedAt = now.toISOString();

  const gapDetails: GapDetail[] = [];
  const riskFactors: string[] = [];
  const auditRows: string[][] = [];
  const pillarTotals = new Map<PillarId, { applicable: number; triggered: number; gaps: number; risks: number }>(
    PILLARS.map((p) => [p.id, { applicable: 0, triggered: 0, gaps: 0, risks: 0 }]),
  );

  let applicableWeight = 0;
  let triggeredWeight = 0;
  let unansweredCount = 0;
  let scopeConfirmed = true;

  for (const rule of rules) {
    const visible = isVisible(rule, input.answers, rules);
    const value = lookupAnswer(input.answers, rule);
    const answered = value !== undefined;
    const pillar = getPillar(rule.pillar);
    const totals = pillarTotals.get(rule.pillar)!;
    let status: QuestionStatus;

    if (!visible) {
      status = "NOT_APPLICABLE";
    } else if (rule.polarity === "scope") {
      scopeConfirmed = value === true;
      status = scopeConfirmed ? "CONTROL_IN_PLACE" : "GAP";
      if (!scopeConfirmed) {
        gapDetails.push({
          fieldId: rule.fieldId,
          pillar: rule.pillar,
          pillarTitle: pillar.title,
          severity: rule.severity,
          finding: rule.finding,
          references: rule.references.map(formatReference),
          answered,
        });
        totals.gaps += 1;
      }
    } else if (rule.weight === 0) {
      status = "INFORMATIONAL";
    } else {
      if (!answered) unansweredCount += 1;
      const triggered =
        rule.polarity === "control"
          ? value !== true
          : rule.input === "boolean"
            ? value !== false
            : !answered || (rule.exposureThreshold !== undefined && (value as number) >= rule.exposureThreshold);

      applicableWeight += rule.weight;
      totals.applicable += rule.weight;
      if (triggered) {
        triggeredWeight += rule.weight;
        totals.triggered += rule.weight;
      }

      if (!triggered) {
        status = rule.polarity === "control" ? "CONTROL_IN_PLACE" : "NOT_TRIGGERED";
      } else if (rule.polarity === "control") {
        status = "GAP";
        totals.gaps += 1;
        gapDetails.push({
          fieldId: rule.fieldId,
          pillar: rule.pillar,
          pillarTitle: pillar.title,
          severity: rule.severity,
          finding: answered ? rule.finding : `Not answered — scored as missing control: ${rule.finding}`,
          references: rule.references.map(formatReference),
          answered,
        });
      } else {
        status = "RISK_FACTOR";
        totals.risks += 1;
        riskFactors.push(answered ? rule.finding : `Not answered — scored as present: ${rule.finding}`);
      }
    }

    const primaryRef = rule.references[0] ? formatReference(rule.references[0]) : "Operational metric";
    auditRows.push([
      rule.fieldId,
      formatValue(rule, value, visible),
      `${status} | ${pillar.title} | ${rule.prompt} | Ref: ${primaryRef}`,
    ]);
  }

  gapDetails.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const riskScore = applicableWeight === 0 ? 0 : Math.round((triggeredWeight / applicableWeight) * 100);
  const criticalGapCount = gapDetails.filter((g) => g.severity === "critical").length;
  const riskTier = tierFor(riskScore, criticalGapCount, scopeConfirmed);

  const identifiedGaps = gapDetails.map(
    (g) => `[${g.severity.toUpperCase()}] ${g.finding} (Ref: ${g.references.join("; ") || "n/a"})`,
  );

  const pillarSummary: PillarSummary[] = PILLARS.map((p) => {
    const t = pillarTotals.get(p.id)!;
    return {
      pillar: p.id,
      title: p.title,
      score: t.applicable === 0 ? 0 : Math.round((t.triggered / t.applicable) * 100),
      gapCount: t.gaps,
      riskFactorCount: t.risks,
      penaltyScope: p.penaltyScope,
    };
  });

  const headerRows: string[][] = [
    ["ENTITY_NAME", input.organizationName, "Declared by assessed entity"],
    ["ENTITY_LOCATION", input.location || "NOT_PROVIDED", "Declared by assessed entity"],
    ["ASSESSMENT_TARGET", input.assessmentTarget || "AUSTRAC Tranche 2 Readiness Review", "Declared by assessed entity"],
    ["REPORTING_SECTOR", sector.label.toUpperCase(), "Selected industry vertical"],
    ["ASSESSMENT_ID", assessmentId, `${ENGINE_VERSION} | ruleset ${RULESET_VERSION}`],
    ["ASSESSED_AT_UTC", assessedAt, "Server timestamp"],
    ["RISK_SCORE", `${riskScore}/100`, `Weighted: ${triggeredWeight} of ${applicableWeight} applicable points triggered`],
    ["RISK_TIER", riskTier, `${criticalGapCount} critical gap(s); ${unansweredCount} unanswered`],
  ];

  const copyPastePayload = [DATA_PACK_COLUMNS, ...headerRows, ...auditRows]
    .map((row) => row.map(sanitizeCell).join("\t"))
    .join("\n");

  return {
    meta: {
      engine: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      jurisdiction: "Australia (AUSTRAC)",
      statutoryFramework: "AML/CTF Act 2006 as amended by the AML/CTF Amendment Act 2024; AML/CTF Rules 2025",
      assessmentId,
      assessedAt,
      disclaimer: LEGAL_DISCLAIMER,
    },
    entity: {
      organizationName: input.organizationName,
      location: input.location,
      assessmentTarget: input.assessmentTarget,
      sector: input.sector,
      sectorLabel: sector.label,
    },
    results: {
      riskScore,
      riskTier,
      criticalGapCount,
      unansweredCount,
      identifiedGaps,
      riskFactors,
      gapDetails,
      pillarSummary,
    },
    exportData: { columns: DATA_PACK_COLUMNS, copyPastePayload },
  };
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  const allowList = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  if (allowList.length === 0) {
    headers["Access-Control-Allow-Origin"] = "*";
  } else {
    const origin = request.headers.get("Origin");
    if (origin && allowList.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new RequestError(415, "Content-Type must be application/json.");
  }
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) throw new RequestError(413, `Payload exceeds ${MAX_BODY_BYTES} bytes.`);

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new RequestError(413, `Payload exceeds ${MAX_BODY_BYTES} bytes.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new RequestError(400, "Body is not valid JSON.");
  }
}

function questionnaire(): unknown {
  return {
    rulesetVersion: RULESET_VERSION,
    disclaimer: LEGAL_DISCLAIMER,
    pillars: PILLARS,
    sectors: Object.values(SECTORS).map((s) => ({
      id: s.id,
      label: s.label,
      summary: s.summary,
      questions: getQuestionSet(s.id),
    })),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const { pathname } = new URL(request.url);

    try {
      if (pathname === "/v1/health") {
        if (request.method !== "GET") throw new RequestError(405, "Use GET.");
        return json({ status: "ok", engine: ENGINE_VERSION, rulesetVersion: RULESET_VERSION }, 200, cors);
      }
      if (pathname === "/v1/questionnaire") {
        if (request.method !== "GET") throw new RequestError(405, "Use GET.");
        return json(questionnaire(), 200, cors);
      }
      if (pathname === "/v1/assess") {
        if (request.method !== "POST") throw new RequestError(405, "Use POST.");
        const input = parseAssessmentInput(await readJsonBody(request));
        return json(assess(input, new Date(), crypto.randomUUID()), 200, cors);
      }
      throw new RequestError(404, "Not found.");
    } catch (error) {
      if (error instanceof RequestError) {
        return json({ error: error.message, details: error.details }, error.status, cors);
      }
      return json({ error: "Internal error." }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
