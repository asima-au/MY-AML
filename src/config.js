// Regulatory parameters used by the engine. Each value names its source so a
// compliance officer can check it. Values that change over time (country
// lists, commencement dates) are configuration, not code, and must be
// reviewed against current AUSTRAC and FATF publications before go-live.

export const REGULATORY_PARAMS = Object.freeze({
  // AML/CTF Act 2006 s 43: threshold transaction report for physical currency
  // of AUD 10,000 or more, due within 10 business days.
  cashThresholdAud: 10000,
  ttrDeadlineBusinessDays: 10,

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

  // Compliance officer sign-off on the AML/CTF program is treated as stale
  // after this many days, prompting re-approval.
  programSignoffMaxAgeDays: 365,
});

// FATF "high-risk jurisdictions subject to a call for action". Review at each
// FATF plenary (February, June, October). Stored as ISO 3166-1 alpha-2 codes.
export const HIGH_RISK_JURISDICTIONS = Object.freeze(['KP', 'IR', 'MM']);

// Jurisdictions the firm's own risk assessment treats as elevated (for
// example, secrecy or nominee-friendly company registries). Firm-specific.
export const ELEVATED_RISK_JURISDICTIONS = Object.freeze(['VG', 'KY', 'PA', 'SC', 'BZ']);

export const RISK_LEVELS = Object.freeze(['low', 'medium', 'high', 'prohibited']);

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
