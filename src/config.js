// Regulatory parameters used by the engine. Each value names its source in
// PARAM_SOURCES so a compliance officer can check it. Values that change over
// time (country lists, commencement dates) are configuration, not code, and
// must be reviewed against current AUSTRAC and FATF publications before go-live.
//
// This is a rules engine, not legal advice. See TO_CONFIRM.

export const REGULATORY_PARAMS = Object.freeze({
  // AML/CTF Act 2006 s 43: threshold transaction report for physical currency
  // of AUD 10,000 or more, due within 10 business days.
  cashThresholdAud: 10000,
  ttrDeadlineBusinessDays: 10,

  // AML/CTF Act 2006 s 45: international funds transfer instruction report,
  // due within 10 business days. Only the sectors in IFTI_SECTORS lodge them.
  iftiDeadlineBusinessDays: 10,

  // AML/CTF Act 2006 s 41: SMR within 24 hours where the suspicion relates to
  // terrorism financing, otherwise within 3 business days.
  smrTerrorismFinancingHours: 24,
  smrOtherBusinessDays: 3,

  // Beneficial owner: an individual who owns 25% or more, or otherwise
  // controls the customer (AML/CTF Rules).
  uboOwnershipThresholdPct: 25,

  // AML/CTF Act 2006 Part 10: records kept for 7 years.
  recordRetentionYears: 7,

  // Structuring detection: several cash amounts just under the threshold
  // inside a rolling window (AML/CTF Act s 142 offence of structuring).
  structuringLowerBoundPct: 80,
  structuringWindowDays: 7,
  structuringMinCount: 2,

  // Compliance officer approval of the AML/CTF program is stale after this
  // many calendar months (firm policy).
  programSignoffMaxAgeMonths: 12,

  // Source of funds must be traced to within this percentage of the
  // transaction amount (firm policy).
  sourceOfFundsTolerancePct: 1,
});

// Machine-readable source for every parameter above.
export const PARAM_SOURCES = Object.freeze({
  cashThresholdAud: 'AML/CTF Act 2006 (Cth) s 43',
  ttrDeadlineBusinessDays: 'AML/CTF Act 2006 (Cth) s 43',
  iftiDeadlineBusinessDays: 'AML/CTF Act 2006 (Cth) s 45',
  smrTerrorismFinancingHours: 'AML/CTF Act 2006 (Cth) s 41',
  smrOtherBusinessDays: 'AML/CTF Act 2006 (Cth) s 41',
  uboOwnershipThresholdPct: 'AML/CTF Rules: beneficial owner definition (25% or control)',
  recordRetentionYears: 'AML/CTF Act 2006 (Cth) Part 10',
  structuringLowerBoundPct: 'Firm detection parameter supporting AML/CTF Act s 142 (structuring)',
  structuringWindowDays: 'Firm detection parameter supporting AML/CTF Act s 142 (structuring)',
  structuringMinCount: 'Firm detection parameter supporting AML/CTF Act s 142 (structuring)',
  programSignoffMaxAgeMonths: 'Firm policy',
  sourceOfFundsTolerancePct: 'Firm policy',
});

// FATF "high-risk jurisdictions subject to a call for action". Review at each
// FATF plenary (February, June, October). Stored as ISO 3166-1 alpha-2 codes.
export const HIGH_RISK_JURISDICTIONS = Object.freeze(['KP', 'IR', 'MM']);

// Jurisdictions the firm's own risk assessment treats as elevated (for
// example, secrecy or nominee-friendly company registries). Firm-specific:
// these are example values the firm must replace with its own list.
export const ELEVATED_RISK_JURISDICTIONS = Object.freeze(['VG', 'KY', 'PA', 'SC', 'BZ']);

// Sectors that lodge IFTI reports for international transfers they send or receive.
export const IFTI_SECTORS = Object.freeze(['financial_services', 'remittance']);

// Sectors that need an AUSTRAC registration in addition to enrolment before
// providing the service. Confirm the current registration scheme for each.
export const REGISTRATION_REQUIRED = Object.freeze({
  remittance: 'Remittance Sector Register',
  virtual_assets: 'Virtual asset service provider registration',
});

export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high']);

// Staff roles and what each may see. Only these two roles may see suspicion,
// SMR or EDD rationale. Everyone else, and every customer, sees the neutral view.
export const ROLES = Object.freeze({
  amlco: { label: 'AML/CTF Compliance Officer', restrictedAccess: true },
  compliance_analyst: { label: 'Compliance analyst (SMR-cleared)', restrictedAccess: true },
  frontline: { label: 'Front-line staff', restrictedAccess: false },
  customer: { label: 'Customer', restrictedAccess: false },
});

// The only status text a customer or front-line staff member ever sees. It is
// identical for every case, so it cannot signal a review or a report.
export const NEUTRAL_STATUS = Object.freeze({
  open: 'Your application is being processed.',
  complete: 'Your application has been processed.',
});

// Must be confirmed against current legislation and AUSTRAC guidance before production.
export const TO_CONFIRM = Object.freeze([
  'Tranche 2 commencement dates and the exact designated services for each new sector (AML/CTF Amendment Act 2024).',
  'Reduced obligations for gaming venues with 15 or fewer gaming machines (gambling exemption rule in sectors.js).',
  'Every designated-service exemption rule in sectors.js.',
  'Registration schemes in REGISTRATION_REQUIRED (remittance and virtual asset services).',
  'The current FATF call-for-action list, and the firm\'s own ELEVATED_RISK_JURISDICTIONS.',
  'Each state\'s public holidays: the engine only skips the holidays it is given.',
  'Connectors to the screening provider, ASIC and identity verification: the engine only reads their results.',
  'Risk weights and bands against the firm\'s own ML/TF risk assessment.',
]);
