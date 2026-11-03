// The three test scenarios. All names and figures are fictional.

const NOW = '2026-11-03T02:00:00.000Z'; // Tuesday
const HOLIDAYS = ['2026-11-03', '2026-12-25', '2026-12-28']; // VIC Melbourne Cup, Christmas, Boxing Day (observed)

const enrolledEntity = (sector, name) => ({
  name,
  sector,
  austracEnrolment: { status: 'enrolled', enrolmentNumber: 'AUSTRAC-100001', sectorsRegistered: [sector] },
  program: { amlcoAppointed: true, amlcoName: 'J. Rivera', approvedAt: '2026-07-01T00:00:00.000Z' },
});

// Scenario 1: corporate trust buying commercial property; a 30% beneficial owner is a domestic PEP.
export const scenario1 = {
  caseId: 'RE-2026-0001',
  now: NOW,
  holidays: HOLIDAYS,
  reportingEntity: enrolledEntity('real_estate', 'Southbank Commercial Realty'),
  customer: {
    type: 'trust',
    countryOfResidence: 'AU',
    entity: {
      name: 'Harbourline Property Trust',
      jurisdiction: 'AU',
      trustType: 'discretionary',
      trustDeedSighted: true,
      trusteeIsCompany: true,
      registrationNumber: 'ACN 600 000 001',
      registryExtract: { source: 'ASIC', status: 'registered', fetchedAt: NOW },
      trustees: [{ name: 'Harbourline Nominees Pty Ltd', verified: true }],
    },
    owners: [
      { name: 'Alex Morgan', ownershipPct: 30, identityVerified: true, pep: { category: 'domestic', role: 'State parliamentarian' } },
      { name: 'Priya Nair', ownershipPct: 40, identityVerified: true },
      { name: 'Sam Chen', ownershipPct: 30, identityVerified: true },
    ],
  },
  screening: {
    screenedSubjects: ['Harbourline Property Trust', 'Alex Morgan', 'Priya Nair', 'Sam Chen', 'Harbourline Nominees Pty Ltd'],
    sanctionsMatches: [],
    pepMatches: [{ subject: 'Alex Morgan', category: 'domestic', role: 'State parliamentarian' }],
  },
  sectorAnswers: { propertyType: 'commercial', purchasePriceAud: 8500000, depositMethod: 'bank_transfer_own_account', buyerVehicle: 'trust' },
  profile: {
    natureOfBusiness: 'Property investment trust holding commercial assets',
    purposeOfRelationship: 'Purchase of a commercial office building',
    expectedActivity: 'Single acquisition; deposit then settlement',
  },
  sourceOfWealth: { declared: 'Accumulated rental income and prior property sales', evidence: [{ type: 'audited_financials', verified: true }] },
  sourceOfFunds: {
    amountAud: 850000,
    originAccounts: [{ institution: 'Major AU bank', country: 'AU', holderIsCustomer: true, amountAud: 850000, verified: true }],
  },
  amlcoSignoff: { edd: { approved: true, by: 'J. Rivera', at: '2026-11-02T23:00:00.000Z' } },
  transactions: [{ at: NOW, amountAud: 850000, cash: false, international: false }],
  suspicion: { formed: false, assessedNoSuspicion: true },
};

// Scenario 2: accounting firm forming an overseas shelf company for a high-net-worth client,
// funded by wires from accounts outside the client's home state and country.
export const scenario2 = {
  caseId: 'PS-2026-0002',
  now: NOW,
  holidays: HOLIDAYS,
  reportingEntity: enrolledEntity('professional_services', 'Collins Street Accounting'),
  customer: {
    type: 'individual',
    countryOfResidence: 'AU',
    individual: {
      fullName: 'Morgan Ellis',
      dob: '1971-04-12',
      address: '10 Example Street, Toorak VIC 3142',
      idSources: [
        { type: 'passport', verified: true, independent: false },
        { type: 'electronic_verification', verified: true, independent: true },
      ],
    },
  },
  screening: { screenedSubjects: ['Morgan Ellis'], sanctionsMatches: [], pepMatches: [] },
  sectorAnswers: { serviceType: 'company_formation', formationJurisdiction: 'VG', handlesClientFunds: true, clientIsAlsoNomineeRequested: false },
  profile: {
    natureOfBusiness: 'Private investor',
    purposeOfRelationship: 'Incorporate a holding company for offshore investments',
    expectedActivity: 'One formation, ongoing annual compliance',
  },
  sourceOfWealth: { declared: 'Sale of a technology business in 2019', evidence: [] },
  sourceOfFunds: {
    amountAud: 120000,
    originAccounts: [
      { institution: 'Bank in Singapore', country: 'SG', holderIsCustomer: true, amountAud: 70000, verified: true },
      { institution: 'Bank in Hong Kong', country: 'HK', holderIsCustomer: false, holderName: 'Ellis Family Holdings Ltd', amountAud: 50000, verified: false },
    ],
  },
  transactions: [
    { at: '2026-11-02T01:00:00.000Z', amountAud: 70000, cash: false, international: true },
    { at: '2026-11-02T03:00:00.000Z', amountAud: 50000, cash: false, international: true },
  ],
  suspicion: { formed: false },
};

// Scenario 3: retail customer buying physical bullion with a large cash payment after two
// recent cash purchases just under the threshold.
export const scenario3 = {
  caseId: 'BD-2026-0003',
  now: NOW,
  holidays: HOLIDAYS,
  reportingEntity: enrolledEntity('bullion', 'Collins Bullion Exchange'),
  customer: {
    type: 'individual',
    countryOfResidence: 'AU',
    individual: {
      fullName: 'Jordan Blake',
      dob: '1988-09-30',
      address: '22 Sample Road, Footscray VIC 3011',
      idSources: [
        { type: 'drivers_licence', verified: true, independent: false },
        { type: 'electronic_verification', verified: true, independent: true },
      ],
    },
  },
  screening: { screenedSubjects: ['Jordan Blake'], sanctionsMatches: [], pepMatches: [] },
  sectorAnswers: { metal: 'gold', orderValueAud: 48000, cashComponentAud: 48000, collectionMethod: 'in_store' },
  profile: {
    natureOfBusiness: 'Retail purchaser',
    purposeOfRelationship: 'Personal bullion investment',
    expectedActivity: 'Occasional purchases',
  },
  sourceOfWealth: { declared: 'Salary and savings', evidence: [] },
  sourceOfFunds: { amountAud: 48000, cashAud: 48000, cashOriginExplained: false, originAccounts: [] },
  transactions: [
    { at: '2026-10-28T03:00:00.000Z', amountAud: 9500, cash: true, international: false },
    { at: '2026-10-30T03:00:00.000Z', amountAud: 9800, cash: true, international: false },
    { at: NOW, amountAud: 48000, cash: true, international: false },
  ],
  suspicion: { formed: true, formedAt: NOW, terrorismFinancing: false, grounds: ['Cash amounts just under the threshold before a large cash purchase'] },
};

export const SCENARIOS = { scenario1, scenario2, scenario3 };
