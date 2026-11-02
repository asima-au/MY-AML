// rules.ts — Legislative rule map for the Tranche 2 AML/CTF readiness assessor.
//
// LEGAL REVIEW REQUIRED: every citation below must be confirmed by a qualified
// Australian AML/CTF practitioner against the current compilation of the
// AML/CTF Act 2006 (as amended by the AML/CTF Amendment Act 2024), the
// AML/CTF Rules 2025 and AUSTRAC guidance before output is relied on.

export const RULESET_VERSION = "2026.11.0";

export const LEGAL_DISCLAIMER =
  "Automated self-assessment aid only — not legal advice. Results indicate readiness gaps against the AML/CTF Act 2006 " +
  "(as amended by the AML/CTF Amendment Act 2024) and the AML/CTF Rules 2025. Confirm obligations with a qualified " +
  "AML/CTF adviser and current AUSTRAC guidance before acting.";

export type SectorId = "legal_tcsp" | "accounting" | "real_estate";

export type PillarId =
  | "designated_services"
  | "cdd_ecdd"
  | "pep_sanctions"
  | "reporting"
  | "governance"
  | "sector_risk";

export type Severity = "critical" | "high" | "medium" | "low";

export type AnswerGroup = "complianceInputs" | "industrySpecifics" | "operationalMetrics";

/** scope: decides whether the Act applies (unscored). control: `false` is a gap. exposure: `true` is an inherent risk factor. */
export type Polarity = "scope" | "control" | "exposure";

export interface LegalReference {
  readonly instrument: string;
  readonly provision: string;
}

export interface PillarDefinition {
  readonly id: PillarId;
  readonly title: string;
  readonly summary: string;
  readonly references: readonly LegalReference[];
  readonly penaltyScope: string;
}

export interface VisibilityCondition {
  /** Question is shown when ANY listed answer matches. */
  readonly anyOf: ReadonlyArray<{ readonly questionId: string; readonly equals: boolean }>;
}

interface QuestionBase {
  /** Payload key inside `group`. */
  readonly id: string;
  /** Stable export identifier used in the tab-delimited data pack. */
  readonly fieldId: string;
  readonly group: AnswerGroup;
  readonly pillar: PillarId;
  readonly prompt: string;
  readonly help: string;
  readonly polarity: Polarity;
  readonly severity: Severity;
  /** Contribution to the 0–100 risk score when triggered. 0 = informational. */
  readonly weight: number;
  /** Shown in the gap register when triggered. */
  readonly finding: string;
  readonly references: readonly LegalReference[];
  readonly showIf?: VisibilityCondition;
}

export interface BooleanQuestion extends QuestionBase {
  readonly input: "boolean";
}

export interface NumericQuestion extends QuestionBase {
  readonly input: "currency" | "count";
  readonly polarity: "exposure";
  /** Exposure is triggered when the answer is >= this value. Omit for informational fields. */
  readonly exposureThreshold?: number;
  readonly max: number;
}

export type QuestionRule = BooleanQuestion | NumericQuestion;

export interface SectorDefinition {
  readonly id: SectorId;
  readonly label: string;
  readonly summary: string;
  readonly questions: readonly QuestionRule[];
}

const ACT = "AML/CTF Act 2006 (Cth)";
const RULES = "AML/CTF Rules 2025";

const CIVIL_PENALTY =
  "Civil penalty provision: up to 100,000 penalty units per contravention for a body corporate and 20,000 for an " +
  "individual (s 175). AUSTRAC may also issue infringement notices, remedial directions and enforceable undertakings.";

export const PILLARS: readonly PillarDefinition[] = [
  {
    id: "designated_services",
    title: "Designated Services & Enrolment",
    summary: "Confirms whether you provide a designated service and are enrolled and risk-assessed accordingly.",
    references: [
      { instrument: ACT, provision: "s 6 — designated services (incl. Tranche 2 services inserted by the 2024 Amendment Act)" },
      { instrument: ACT, provision: "s 51B — enrolment on the Reporting Entities Roster" },
    ],
    penaltyScope: `${CIVIL_PENALTY} Providing a designated service while unenrolled is a separate contravention.`,
  },
  {
    id: "cdd_ecdd",
    title: "Customer Due Diligence (CDD / ECDD)",
    summary: "Identification, verification, beneficial ownership and enhanced due diligence for higher-risk customers.",
    references: [
      { instrument: ACT, provision: "Part 2 — customer due diligence" },
      { instrument: RULES, provision: "CDD and enhanced CDD requirements (replacing Chapter 4 of the AML/CTF Rules 2007)" },
    ],
    penaltyScope: `${CIVIL_PENALTY} Each customer onboarded without required CDD can be a separate contravention.`,
  },
  {
    id: "pep_sanctions",
    title: "PEP & Sanctions Screening",
    summary: "Detecting politically exposed persons and designated (sanctioned) persons or entities.",
    references: [
      { instrument: RULES, provision: "PEP identification and enhanced CDD requirements" },
      { instrument: "Autonomous Sanctions Act 2011 (Cth)", provision: "s 16 — sanctions offences" },
      { instrument: "Charter of the United Nations Act 1945 (Cth)", provision: "Part 4 — UN sanctions offences" },
    ],
    penaltyScope:
      `${CIVIL_PENALTY} Dealing with a designated person or entity is a criminal offence under Australian sanctions law, ` +
      "with strict liability for bodies corporate.",
  },
  {
    id: "reporting",
    title: "Reporting Obligations (TTR / SMR)",
    summary: "Threshold transaction reports for physical currency of AUD 10,000+ and suspicious matter reports.",
    references: [
      { instrument: ACT, provision: "s 41 — suspicious matter reports (3 business days; 24 hours for terrorism financing)" },
      { instrument: ACT, provision: "s 43 — threshold transaction reports (10 business days)" },
      { instrument: ACT, provision: "s 123 — tipping-off offence" },
      { instrument: ACT, provision: "Part 10 — record keeping (7 years)" },
    ],
    penaltyScope: `${CIVIL_PENALTY} Every unreported matter or transaction is a separate contravention.`,
  },
  {
    id: "governance",
    title: "Internal Governance",
    summary: "AML/CTF compliance officer, staff training, employee due diligence and independent evaluation.",
    references: [
      { instrument: ACT, provision: "Part 1A — AML/CTF programs, policies and compliance officer (as inserted by the 2024 Amendment Act)" },
      { instrument: RULES, provision: "Compliance officer, personnel due diligence, training and independent evaluation" },
    ],
    penaltyScope: `${CIVIL_PENALTY} Senior managers carry personal oversight accountability under the amended Act.`,
  },
  {
    id: "sector_risk",
    title: "Sector-Specific Risk",
    summary: "Vertical-specific money laundering typologies identified by AUSTRAC for your sector.",
    references: [
      { instrument: ACT, provision: "s 6 — Tranche 2 designated services for your sector" },
      { instrument: "AUSTRAC", provision: "Sector ML/TF risk assessments and Tranche 2 starter guidance" },
    ],
    penaltyScope: `${CIVIL_PENALTY} Unmitigated sector risks undermine the adequacy of your AML/CTF program.`,
  },
];

const CORE_QUESTIONS: readonly QuestionRule[] = [
  // Pillar 1 — Designated services
  {
    id: "designatedServices",
    fieldId: "DS_PROVIDES_DESIGNATED_SERVICE",
    group: "complianceInputs",
    pillar: "designated_services",
    input: "boolean",
    polarity: "scope",
    severity: "critical",
    weight: 0,
    prompt: "Does your business provide a designated service listed in s 6 of the AML/CTF Act?",
    help: "Tranche 2 services include brokering real estate sales, creating or restructuring legal persons and arrangements, managing client money, and assisting with buying or selling businesses.",
    finding: "Designated-service status not confirmed. If no designated service is provided, AML/CTF obligations may not apply — document the basis for that conclusion.",
    references: [{ instrument: ACT, provision: "s 6" }],
  },
  {
    id: "austracEnrolled",
    fieldId: "DS_AUSTRAC_ENROLLED",
    group: "complianceInputs",
    pillar: "designated_services",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 10,
    prompt: "Is the business enrolled with AUSTRAC on the Reporting Entities Roster?",
    help: "Enrolment is required before, or within 28 days of, first providing a designated service.",
    finding: "Business is not enrolled with AUSTRAC while providing designated services.",
    references: [{ instrument: ACT, provision: "s 51B" }],
    showIf: { anyOf: [{ questionId: "designatedServices", equals: true }] },
  },
  {
    id: "mlTfRiskAssessment",
    fieldId: "DS_ML_TF_RISK_ASSESSMENT",
    group: "complianceInputs",
    pillar: "designated_services",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 10,
    prompt: "Have you documented an ML/TF risk assessment covering customers, services, delivery channels and jurisdictions?",
    help: "The risk assessment is the foundation of the AML/CTF program and must be reviewed when risks change.",
    finding: "No documented ML/TF risk assessment underpinning the AML/CTF program.",
    references: [{ instrument: ACT, provision: "Part 1A — ML/TF risk assessment" }],
    showIf: { anyOf: [{ questionId: "designatedServices", equals: true }] },
  },

  // Pillar 2 — CDD / ECDD
  {
    id: "cddProcedures",
    fieldId: "CDD_IDENTIFY_VERIFY",
    group: "complianceInputs",
    pillar: "cdd_ecdd",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 10,
    prompt: "Do you identify and verify every customer, and anyone acting on their behalf, before providing a designated service?",
    help: "Verification must use reliable and independent data or documents, scaled to the customer's ML/TF risk.",
    finding: "Customer identification and verification is not performed before providing designated services.",
    references: [
      { instrument: ACT, provision: "Part 2 — initial CDD" },
      { instrument: RULES, provision: "Customer identification and verification" },
    ],
  },
  {
    id: "beneficialOwnershipVerification",
    fieldId: "CDD_BENEFICIAL_OWNERSHIP",
    group: "complianceInputs",
    pillar: "cdd_ecdd",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 7,
    prompt: "Do you identify and verify the beneficial owners of companies, trusts and other non-individual customers?",
    help: "Look through to individuals holding 25% or more, or exercising control, including via trusts and nominees.",
    finding: "Beneficial ownership of non-individual customers is not identified and verified.",
    references: [{ instrument: RULES, provision: "Beneficial owner identification and verification" }],
  },
  {
    id: "ecddProcedure",
    fieldId: "CDD_ENHANCED_DUE_DILIGENCE",
    group: "complianceInputs",
    pillar: "cdd_ecdd",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 7,
    prompt: "Do you have documented ECDD triggers and steps for high-risk customers, PEPs and high-risk jurisdictions?",
    help: "ECDD typically includes source of funds and wealth verification and senior management approval.",
    finding: "No documented enhanced customer due diligence (ECDD) procedure for high-risk customers.",
    references: [{ instrument: RULES, provision: "Enhanced customer due diligence" }],
  },
  {
    id: "ongoingCdd",
    fieldId: "CDD_ONGOING_MONITORING",
    group: "complianceInputs",
    pillar: "cdd_ecdd",
    input: "boolean",
    polarity: "control",
    severity: "medium",
    weight: 5,
    prompt: "Do you monitor existing customers and update their CDD information when their risk profile changes?",
    help: "Ongoing CDD includes transaction monitoring and periodic refresh of customer information.",
    finding: "No ongoing customer due diligence or transaction monitoring program.",
    references: [{ instrument: ACT, provision: "Part 2 — ongoing CDD" }],
  },

  // Pillar 3 — PEP & sanctions
  {
    id: "pepScreening",
    fieldId: "PEP_SCREENING",
    group: "complianceInputs",
    pillar: "pep_sanctions",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 9,
    prompt: "Do you screen customers and beneficial owners to determine whether they are politically exposed persons (PEPs)?",
    help: "Covers domestic, foreign and international organisation PEPs, plus their family members and close associates.",
    finding: "No PEP screening of customers and beneficial owners.",
    references: [{ instrument: RULES, provision: "Politically exposed persons" }],
  },
  {
    id: "sanctionsScreening",
    fieldId: "SANCTIONS_SCREENING",
    group: "complianceInputs",
    pillar: "pep_sanctions",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 9,
    prompt: "Do you screen customers and counterparties against the DFAT Consolidated Sanctions List before transacting?",
    help: "Screen at onboarding and whenever the list is updated; escalate potential matches before any funds move.",
    finding: "No targeted financial sanctions screening against the DFAT Consolidated List.",
    references: [
      { instrument: "Autonomous Sanctions Act 2011 (Cth)", provision: "s 16" },
      { instrument: "Charter of the United Nations Act 1945 (Cth)", provision: "Part 4" },
    ],
  },

  // Pillar 4 — Reporting
  {
    id: "cashOver10k",
    fieldId: "TTR_CASH_EXPOSURE",
    group: "complianceInputs",
    pillar: "reporting",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 6,
    prompt: "Do you receive or pay physical currency of AUD 10,000 or more in a single transaction?",
    help: "Physical currency includes notes and coins in any currency (AUD equivalent).",
    finding: "Handles physical currency of AUD 10,000 or more — threshold transaction reporting applies.",
    references: [{ instrument: ACT, provision: "s 43" }],
  },
  {
    id: "ttrProcess",
    fieldId: "TTR_LODGEMENT_PROCESS",
    group: "complianceInputs",
    pillar: "reporting",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 8,
    prompt: "Do you have a process to lodge a TTR with AUSTRAC within 10 business days of each qualifying cash transaction?",
    help: "Include cash register controls and a named person accountable for lodgement.",
    finding: "No threshold transaction report (TTR) lodgement process despite cash exposure.",
    references: [{ instrument: ACT, provision: "s 43" }],
    showIf: { anyOf: [{ questionId: "cashOver10k", equals: true }] },
  },
  {
    id: "smrProcess",
    fieldId: "SMR_LODGEMENT_PROCESS",
    group: "complianceInputs",
    pillar: "reporting",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 9,
    prompt: "Do staff know how to escalate suspicions, and can you lodge SMRs within 3 business days (24 hours for terrorism financing)?",
    help: "The process must also prevent tipping off the customer.",
    finding: "No suspicious matter report (SMR) escalation and lodgement process.",
    references: [
      { instrument: ACT, provision: "s 41" },
      { instrument: ACT, provision: "s 123" },
    ],
  },
  {
    id: "recordKeeping",
    fieldId: "RECORD_KEEPING_7Y",
    group: "complianceInputs",
    pillar: "reporting",
    input: "boolean",
    polarity: "control",
    severity: "medium",
    weight: 5,
    prompt: "Do you retain CDD records, transaction records and program documents for at least 7 years?",
    help: "Records must be retrievable for AUSTRAC on request.",
    finding: "Record retention does not meet the 7-year requirement.",
    references: [{ instrument: ACT, provision: "Part 10" }],
  },

  // Pillar 5 — Governance
  {
    id: "hasAppointedComplianceOfficer",
    fieldId: "GOV_COMPLIANCE_OFFICER",
    group: "operationalMetrics",
    pillar: "governance",
    input: "boolean",
    polarity: "control",
    severity: "critical",
    weight: 9,
    prompt: "Have you appointed an AML/CTF compliance officer at management level?",
    help: "The officer must be fit and proper, have sufficient authority and resources, and be notified to AUSTRAC.",
    finding: "No AML/CTF compliance officer appointed at management level.",
    references: [{ instrument: ACT, provision: "Part 1A — AML/CTF compliance officer" }],
  },
  {
    id: "staffTraining",
    fieldId: "GOV_STAFF_TRAINING",
    group: "complianceInputs",
    pillar: "governance",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 6,
    prompt: "Do you deliver AML/CTF risk-awareness training to relevant staff and keep training logs?",
    help: "Training should be role-specific and refreshed at least annually, with attendance records retained.",
    finding: "No documented AML/CTF staff training program or training logs.",
    references: [{ instrument: RULES, provision: "Personnel training" }],
  },
  {
    id: "employeeDueDiligence",
    fieldId: "GOV_EMPLOYEE_DUE_DILIGENCE",
    group: "complianceInputs",
    pillar: "governance",
    input: "boolean",
    polarity: "control",
    severity: "medium",
    weight: 4,
    prompt: "Do you screen staff in AML/CTF-relevant roles before hiring and periodically afterwards?",
    help: "Personnel due diligence typically covers identity, references and relevant integrity checks.",
    finding: "No personnel due diligence for staff in AML/CTF-relevant roles.",
    references: [{ instrument: RULES, provision: "Personnel due diligence" }],
  },
  {
    id: "independentAuditCycle",
    fieldId: "GOV_INDEPENDENT_EVALUATION",
    group: "complianceInputs",
    pillar: "governance",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 6,
    prompt: "Is your AML/CTF program scheduled for independent evaluation at least every 3 years?",
    help: "The evaluator must be independent of the program's design and operation.",
    finding: "No independent evaluation cycle for the AML/CTF program.",
    references: [{ instrument: ACT, provision: "Part 1A — independent evaluation" }],
  },
  {
    id: "annualTransactionVolume",
    fieldId: "OPS_ANNUAL_TRANSACTION_VOLUME_AUD",
    group: "operationalMetrics",
    pillar: "governance",
    input: "currency",
    polarity: "exposure",
    severity: "medium",
    weight: 4,
    exposureThreshold: 10_000_000,
    max: 1_000_000_000_000,
    prompt: "Approximate annual value of transactions you facilitate (AUD)",
    help: "Volume above AUD 10 million raises inherent exposure and the scale of controls AUSTRAC will expect.",
    finding: "Annual transaction volume of AUD 10 million or more increases inherent ML/TF exposure.",
    references: [{ instrument: ACT, provision: "Part 1A — risk-based program scaled to size and nature" }],
  },
  {
    id: "totalActiveStaff",
    fieldId: "OPS_TOTAL_ACTIVE_STAFF",
    group: "operationalMetrics",
    pillar: "governance",
    input: "count",
    polarity: "exposure",
    severity: "low",
    weight: 0,
    max: 1_000_000,
    prompt: "Number of active staff",
    help: "Used to size training and compliance resourcing. Not scored.",
    finding: "",
    references: [],
  },
];

const REAL_ESTATE_QUESTIONS: readonly QuestionRule[] = [
  {
    id: "internationalBuyerOnboarding",
    fieldId: "RE_INTERNATIONAL_BUYERS",
    group: "complianceInputs",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 6,
    prompt: "Do you act for buyers or sellers who are overseas residents or use foreign-sourced funds?",
    help: "Cross-border funds and non-face-to-face onboarding are recognised real estate laundering risks.",
    finding: "Onboards international buyers — elevated cross-border and source-of-funds risk.",
    references: [{ instrument: "AUSTRAC", provision: "Real estate sector ML/TF risk assessment" }],
  },
  {
    id: "acceptsCashDeposits",
    fieldId: "RE_CASH_DEPOSITS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 5,
    prompt: "Do you accept cash deposits or part-payments for property transactions?",
    help: "Cash deposits are a primary placement typology in property-based laundering.",
    finding: "Accepts cash deposits for property transactions.",
    references: [{ instrument: ACT, provision: "s 43" }],
  },
  {
    id: "handlesConveyancingTrustAccounts",
    fieldId: "RE_TRUST_ACCOUNT_DEPOSITS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 5,
    prompt: "Do you hold purchaser deposits or conveyancing funds in a trust account?",
    help: "Trust accounts can lend legitimacy to illicit funds moving through a transaction.",
    finding: "Holds purchaser or conveyancing funds in trust.",
    references: [{ instrument: "AUSTRAC", provision: "Real estate sector ML/TF risk assessment" }],
  },
  {
    id: "preparesHighValueAssetSales",
    fieldId: "RE_HIGH_VALUE_SALES",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "medium",
    weight: 4,
    prompt: "Do you broker high-value residential or commercial property sales (e.g., AUD 2 million or more)?",
    help: "High-value property allows large sums to be integrated in a single transaction.",
    finding: "Brokers high-value property sales.",
    references: [{ instrument: ACT, provision: "s 6 — real estate designated services" }],
  },
  {
    id: "propertyDevelopmentInvestments",
    fieldId: "RE_DEVELOPMENT_INVESTMENT",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "medium",
    weight: 4,
    prompt: "Do you sell off-the-plan stock or property development investment interests?",
    help: "Off-the-plan and development deals can involve complex investor structures and staged funding.",
    finding: "Sells off-the-plan or development investment interests.",
    references: [{ instrument: "AUSTRAC", provision: "Real estate sector ML/TF risk assessment" }],
  },
  {
    id: "managesCommercialLeasing",
    fieldId: "RE_COMMERCIAL_LEASING",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "low",
    weight: 2,
    prompt: "Do you manage commercial leasing?",
    help: "Leasing is generally outside the real estate designated services (which cover brokering sale, purchase or transfer), but lease funds flows should still inform your risk assessment. Confirm scope with your adviser.",
    finding: "Manages commercial leasing — consider rent prepayment and front-company risks in the risk assessment.",
    references: [{ instrument: ACT, provision: "s 6 — confirm scope of real estate designated services" }],
  },
  {
    id: "proxyPurchaseControls",
    fieldId: "RE_PROXY_PURCHASER_CONTROLS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 6,
    prompt: "Do you verify the true purchaser when a buyer acts through a nominee, proxy, company, trust or power of attorney?",
    help: "Proxy and nominee purchases are used to conceal the beneficial owner of property.",
    finding: "No controls to identify the true purchaser behind proxy, nominee or entity purchases.",
    references: [{ instrument: RULES, provision: "Persons acting on behalf of a customer; beneficial owners" }],
  },
  {
    id: "sourceOfFundsChecks",
    fieldId: "RE_SOURCE_OF_FUNDS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 6,
    prompt: "Do you verify the source of funds for international, cash-funded or high-value purchases?",
    help: "Obtain evidence such as bank statements, sale contracts or loan approvals before settlement.",
    finding: "No source-of-funds verification for high-risk property transactions.",
    references: [{ instrument: RULES, provision: "Enhanced customer due diligence — source of funds" }],
    showIf: {
      anyOf: [
        { questionId: "internationalBuyerOnboarding", equals: true },
        { questionId: "acceptsCashDeposits", equals: true },
        { questionId: "preparesHighValueAssetSales", equals: true },
      ],
    },
  },
];

const LEGAL_TCSP_QUESTIONS: readonly QuestionRule[] = [
  {
    id: "conveyancingServices",
    fieldId: "LGL_CONVEYANCING",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 6,
    prompt: "Do you act on the buying, selling or transfer of real estate (conveyancing)?",
    help: "Property conveyancing is the highest-risk Tranche 2 legal service identified by AUSTRAC.",
    finding: "Provides conveyancing services — high-risk property transfer exposure.",
    references: [{ instrument: ACT, provision: "s 6 — professional services designated services" }],
  },
  {
    id: "clientTrustAccountReceipts",
    fieldId: "LGL_TRUST_ACCOUNT_RECEIPTS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 6,
    prompt: "Do you receive, hold or disburse client money through a trust account?",
    help: "Trust accounts are a recognised gatekeeper vulnerability for moving and legitimising funds.",
    finding: "Receives and disburses client money through trust accounts.",
    references: [{ instrument: ACT, provision: "s 6 — receiving, holding and controlling client money" }],
  },
  {
    id: "trustAccountControls",
    fieldId: "LGL_TRUST_ACCOUNT_CONTROLS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 6,
    prompt: "Do you refuse trust-account movements that have no underlying legal service or a clear commercial purpose?",
    help: "Includes third-party payments, early terminations with refunds and round-tripping of funds.",
    finding: "Trust account controls do not prevent pass-through transactions without an underlying legal service.",
    references: [{ instrument: "AUSTRAC", provision: "Legal sector Tranche 2 guidance — trust account risk" }],
    showIf: { anyOf: [{ questionId: "clientTrustAccountReceipts", equals: true }] },
  },
  {
    id: "companyTrustFormation",
    fieldId: "TCSP_ENTITY_FORMATION",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 5,
    prompt: "Do you create, restructure or administer companies, trusts or shelf companies, or provide nominee services?",
    help: "Complex structures and nominee arrangements are used to obscure beneficial ownership.",
    finding: "Forms or administers legal persons and arrangements — beneficial ownership concealment risk.",
    references: [{ instrument: ACT, provision: "s 6 — trust and company service designated services" }],
  },
  {
    id: "foreignClients",
    fieldId: "LGL_FOREIGN_CLIENTS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "medium",
    weight: 4,
    prompt: "Do you act for clients based overseas or for entities controlled from overseas?",
    help: "Foreign clients increase verification difficulty and jurisdictional risk.",
    finding: "Acts for foreign clients or foreign-controlled entities.",
    references: [{ instrument: RULES, provision: "Jurisdictional risk in CDD" }],
  },
  {
    id: "gatekeeperEscalation",
    fieldId: "LGL_GATEKEEPER_ESCALATION",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "control",
    severity: "medium",
    weight: 4,
    prompt: "Do matter-intake checks escalate unusual instructions (no legal rationale, urgency, unexplained third-party funding)?",
    help: "Gatekeeper red flags must reach the compliance officer before the matter proceeds.",
    finding: "No matter-intake escalation for gatekeeper red flags.",
    references: [{ instrument: ACT, provision: "s 41" }],
  },
];

const ACCOUNTING_QUESTIONS: readonly QuestionRule[] = [
  {
    id: "businessStructuresAdvisory",
    fieldId: "ACC_STRUCTURES_ADVISORY",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 5,
    prompt: "Do you assist clients to create or restructure companies, trusts or other legal arrangements?",
    help: "Tax-only advice is generally not a designated service; establishing or restructuring entities can be.",
    finding: "Creates or restructures legal persons and arrangements for clients.",
    references: [{ instrument: ACT, provision: "s 6 — professional services designated services" }],
  },
  {
    id: "preparesHighValueAssetSales",
    fieldId: "ACC_ASSET_SALE_PREPARATION",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "medium",
    weight: 4,
    prompt: "Do you assist with the sale or purchase of businesses or other high-value assets?",
    help: "Business sales can integrate illicit funds through inflated valuations or unexplained buyer funding.",
    finding: "Assists with sale or purchase of businesses or high-value assets.",
    references: [{ instrument: ACT, provision: "s 6 — buying and selling bodies corporate or business entities" }],
  },
  {
    id: "handlesClientFunds",
    fieldId: "ACC_CLIENT_FUNDS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "high",
    weight: 6,
    prompt: "Do you receive, hold or disburse client money, including via a trust or clearing account?",
    help: "Handling client money makes the practice a direct conduit for funds.",
    finding: "Receives, holds or disburses client money.",
    references: [{ instrument: ACT, provision: "s 6 — receiving, holding and controlling client money" }],
  },
  {
    id: "clientFundsControls",
    fieldId: "ACC_CLIENT_FUNDS_CONTROLS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "control",
    severity: "high",
    weight: 6,
    prompt: "Do you verify the purpose of every client money movement and block third-party or pass-through payments?",
    help: "Funds should only move where a documented engagement requires it.",
    finding: "No controls over the purpose of client money movements.",
    references: [{ instrument: "AUSTRAC", provision: "Accounting sector Tranche 2 guidance" }],
    showIf: { anyOf: [{ questionId: "handlesClientFunds", equals: true }] },
  },
  {
    id: "taxVarianceMonitoring",
    fieldId: "ACC_TAX_VARIANCE_MONITORING",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "control",
    severity: "medium",
    weight: 4,
    prompt: "Do you flag unexplained variances between clients' declared income or assets and their transaction activity?",
    help: "Unexplained wealth relative to declared income is a key suspicious-matter indicator for accountants.",
    finding: "No monitoring of variances between declared income and transaction activity.",
    references: [{ instrument: ACT, provision: "s 41" }],
  },
  {
    id: "highValueClientTransactions",
    fieldId: "ACC_HIGH_VALUE_TRANSACTIONS",
    group: "industrySpecifics",
    pillar: "sector_risk",
    input: "boolean",
    polarity: "exposure",
    severity: "medium",
    weight: 4,
    prompt: "Do you facilitate individual client transactions of AUD 1 million or more?",
    help: "High-value transactions warrant enhanced scrutiny of source of funds.",
    finding: "Facilitates high-value client transactions.",
    references: [{ instrument: RULES, provision: "Enhanced customer due diligence" }],
  },
];

export const SECTORS: Readonly<Record<SectorId, SectorDefinition>> = {
  legal_tcsp: {
    id: "legal_tcsp",
    label: "Legal Services & Trust/Company Providers",
    summary: "Conveyancing, client trust accounts, gatekeeper risk and beneficial ownership structures.",
    questions: LEGAL_TCSP_QUESTIONS,
  },
  accounting: {
    id: "accounting",
    label: "Accounting & Bookkeeping Practices",
    summary: "Structures advisory, asset sales, client funds and tax variance monitoring.",
    questions: ACCOUNTING_QUESTIONS,
  },
  real_estate: {
    id: "real_estate",
    label: "Real Estate Agencies",
    summary: "Cash deposits, international buyers, proxy purchases, leasing and development investment.",
    questions: REAL_ESTATE_QUESTIONS,
  },
};

/** Accepted aliases for `businessType` so older clients keep working. */
export const SECTOR_ALIASES: Readonly<Record<string, SectorId>> = {
  legal: "legal_tcsp",
  legal_services: "legal_tcsp",
  tcsp: "legal_tcsp",
  trust_company_provider: "legal_tcsp",
  accountant: "accounting",
  bookkeeping: "accounting",
  realestate: "real_estate",
  real_estate_agency: "real_estate",
};

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { critical: 0, high: 1, medium: 2, low: 3 };

export function getQuestionSet(sector: SectorId): readonly QuestionRule[] {
  return [...CORE_QUESTIONS, ...SECTORS[sector].questions];
}

export function getPillar(id: PillarId): PillarDefinition {
  const pillar = PILLARS.find((p) => p.id === id);
  if (!pillar) throw new Error(`Unknown pillar: ${id}`);
  return pillar;
}
