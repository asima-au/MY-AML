// The 9 sector profiles. Each profile changes the questionnaire, the extra
// validation rules and the risk factors the engine applies.
//
// `regime` records whether the sector was regulated before the 2024
// amendments ("existing") or brought in by them ("tranche2"). Tranche 2
// commencement dates come from the AML/CTF Amendment Act 2024 and must be
// checked against AUSTRAC guidance before relying on them.

const yesNo = { type: 'boolean' };

export const SECTORS = Object.freeze({
  professional_services: {
    label: 'Professional Services (accountants, lawyers, conveyancers, insolvency)',
    regime: 'tranche2',
    questions: [
      { id: 'serviceType', prompt: 'Which service is being provided?', type: 'enum', required: true,
        options: ['company_formation', 'trust_setup', 'client_money_handling', 'property_transaction', 'insolvency', 'advice_only'] },
      { id: 'formationJurisdiction', prompt: 'Jurisdiction of any entity being formed (ISO code)', type: 'country',
        required: (a) => ['company_formation', 'trust_setup'].includes(a.serviceType) },
      { id: 'handlesClientFunds', prompt: 'Will funds pass through your trust account?', ...yesNo, required: true },
      { id: 'clientIsAlsoNomineeRequested', prompt: 'Has the client asked you to act as nominee director or shareholder?', ...yesNo, required: true },
    ],
    riskRules: [
      { id: 'offshore_formation', when: (a, ctx) => a.serviceType === 'company_formation' && a.formationJurisdiction && a.formationJurisdiction !== 'AU',
        factor: 'Formation of an entity outside Australia', weight: 2 },
      { id: 'elevated_jurisdiction_formation', when: (a, ctx) => ctx.isElevated(a.formationJurisdiction),
        factor: 'Entity formed in an elevated-risk jurisdiction', weight: 2 },
      { id: 'nominee_requested', when: (a) => a.clientIsAlsoNomineeRequested === true,
        factor: 'Client requested nominee arrangements', weight: 2 },
    ],
    designatedServiceExempt: (a) => a.serviceType === 'advice_only',
  },

  real_estate: {
    label: "Real Estate (agents, buyer's agents, developers)",
    regime: 'tranche2',
    questions: [
      { id: 'propertyType', prompt: 'Property type', type: 'enum', required: true, options: ['residential', 'commercial', 'land', 'off_the_plan'] },
      { id: 'purchasePriceAud', prompt: 'Purchase price (AUD)', type: 'money', required: true },
      { id: 'depositMethod', prompt: 'How is the deposit being paid?', type: 'enum', required: true,
        options: ['bank_transfer_own_account', 'bank_transfer_third_party', 'international_transfer', 'cash', 'crypto'] },
      { id: 'buyerVehicle', prompt: 'Buyer vehicle', type: 'enum', required: true, options: ['individual', 'company', 'trust', 'smsf', 'foreign_entity'] },
    ],
    riskRules: [
      { id: 'trust_or_company_buyer', when: (a) => ['company', 'trust', 'foreign_entity'].includes(a.buyerVehicle),
        factor: 'Property bought through a legal entity or trust', weight: 1 },
      { id: 'third_party_deposit', when: (a) => a.depositMethod === 'bank_transfer_third_party',
        factor: 'Deposit paid by a third party', weight: 2 },
      { id: 'international_deposit', when: (a) => a.depositMethod === 'international_transfer',
        factor: 'Deposit paid from overseas', weight: 1 },
      { id: 'high_value_property', when: (a) => Number(a.purchasePriceAud) >= 5000000,
        factor: 'Purchase price of AUD 5m or more', weight: 1 },
    ],
    designatedServiceExempt: () => false,
  },

  financial_services: {
    label: 'Financial Services (banks, credit unions, AFSL advisers)',
    regime: 'existing',
    questions: [
      { id: 'productType', prompt: 'Product or service', type: 'enum', required: true,
        options: ['deposit_account', 'loan', 'investment', 'international_transfer', 'advice_with_dealing'] },
      { id: 'expectedMonthlyVolumeAud', prompt: 'Expected monthly volume (AUD)', type: 'money', required: true },
      { id: 'internationalCounterparties', prompt: 'Will the customer send or receive international transfers?', ...yesNo, required: true },
    ],
    riskRules: [
      { id: 'intl_counterparties', when: (a) => a.internationalCounterparties === true, factor: 'International transfer activity', weight: 1 },
      { id: 'high_volume', when: (a) => Number(a.expectedMonthlyVolumeAud) >= 1000000, factor: 'Expected volume of AUD 1m or more a month', weight: 1 },
    ],
    designatedServiceExempt: () => false,
  },

  virtual_assets: {
    label: 'Virtual Asset Services (exchanges, wallets)',
    regime: 'existing',
    questions: [
      { id: 'serviceType', prompt: 'Service', type: 'enum', required: true, options: ['exchange_fiat_crypto', 'exchange_crypto_crypto', 'custodial_wallet', 'transfer'] },
      { id: 'walletAddressesDeclared', prompt: 'Has the customer declared all external wallet addresses?', ...yesNo, required: true },
      { id: 'travelRuleDataComplete', prompt: 'Is originator and beneficiary (travel rule) data complete?', ...yesNo, required: true },
      { id: 'usesPrivacyTools', prompt: 'Any mixer, tumbler or privacy-coin exposure identified?', ...yesNo, required: true },
    ],
    riskRules: [
      { id: 'privacy_tools', when: (a) => a.usesPrivacyTools === true, factor: 'Exposure to mixers or privacy coins', weight: 3 },
      { id: 'travel_rule_gap', when: (a) => a.travelRuleDataComplete === false, factor: 'Incomplete travel rule information', weight: 2 },
      { id: 'undeclared_wallets', when: (a) => a.walletAddressesDeclared === false, factor: 'External wallets not declared', weight: 1 },
    ],
    designatedServiceExempt: () => false,
  },

  remittance: {
    label: 'Remittance Services (money transfer operators)',
    regime: 'existing',
    questions: [
      { id: 'destinationCountry', prompt: 'Destination country (ISO code)', type: 'country', required: true },
      { id: 'amountAud', prompt: 'Transfer amount (AUD)', type: 'money', required: true },
      { id: 'beneficiaryRelationship', prompt: 'Relationship to the beneficiary', type: 'enum', required: true, options: ['family', 'business', 'self', 'unknown'] },
      { id: 'paidInCash', prompt: 'Is the transfer funded in cash?', ...yesNo, required: true },
    ],
    riskRules: [
      { id: 'unknown_beneficiary', when: (a) => a.beneficiaryRelationship === 'unknown', factor: 'Relationship to beneficiary not explained', weight: 2 },
      { id: 'cash_funded', when: (a) => a.paidInCash === true, factor: 'Transfer funded in cash', weight: 1 },
    ],
    designatedServiceExempt: () => false,
  },

  bullion: {
    label: 'Bullion Dealers (gold, silver, platinum, palladium)',
    regime: 'existing',
    questions: [
      { id: 'metal', prompt: 'Metal', type: 'enum', required: true, options: ['gold', 'silver', 'platinum', 'palladium'] },
      { id: 'orderValueAud', prompt: 'Order value (AUD)', type: 'money', required: true },
      { id: 'cashComponentAud', prompt: 'Amount paid in physical cash (AUD)', type: 'money', required: true },
      { id: 'collectionMethod', prompt: 'Collection method', type: 'enum', required: true, options: ['in_store', 'courier', 'vault_storage'] },
    ],
    riskRules: [
      { id: 'cash_heavy', when: (a) => Number(a.cashComponentAud) >= 10000, factor: 'Cash payment at or above AUD 10,000', weight: 2 },
      { id: 'anonymous_collection', when: (a) => a.collectionMethod === 'in_store' && Number(a.orderValueAud) >= 50000,
        factor: 'High-value bullion collected in person', weight: 1 },
    ],
    designatedServiceExempt: () => false,
  },

  precious_metals_stones: {
    label: 'Dealers in Precious Metals & Stones (jewellers, high-value goods)',
    regime: 'tranche2',
    questions: [
      { id: 'itemType', prompt: 'Item type', type: 'enum', required: true, options: ['jewellery', 'loose_stones', 'watches', 'precious_metal_items'] },
      { id: 'saleValueAud', prompt: 'Sale value (AUD)', type: 'money', required: true },
      { id: 'cashComponentAud', prompt: 'Amount paid in physical cash (AUD)', type: 'money', required: true },
    ],
    riskRules: [
      { id: 'cash_heavy', when: (a) => Number(a.cashComponentAud) >= 10000, factor: 'Cash payment at or above AUD 10,000', weight: 2 },
      { id: 'loose_stones', when: (a) => a.itemType === 'loose_stones', factor: 'Loose stones are easily moved and hard to value', weight: 1 },
    ],
    // Dealers come into the regime for cash transactions at or above the threshold.
    designatedServiceExempt: (a) => Number(a.cashComponentAud) < 10000,
  },

  gambling: {
    label: 'Gambling and Gaming (casinos, online betting, venues with EGMs)',
    regime: 'existing',
    questions: [
      { id: 'venueType', prompt: 'Venue type', type: 'enum', required: true, options: ['casino', 'online_betting', 'hotel_or_club_egm'] },
      { id: 'egmCount', prompt: 'Number of gaming machines at the venue', type: 'number',
        required: (a) => a.venueType === 'hotel_or_club_egm' },
      { id: 'cashInAud', prompt: 'Cash in for this session (AUD)', type: 'money', required: true },
      { id: 'minimalPlayObserved', prompt: 'Cash in with little or no play before cash out?', ...yesNo, required: true },
    ],
    riskRules: [
      { id: 'minimal_play', when: (a) => a.minimalPlayObserved === true, factor: 'Cash in and out with minimal play (possible refining)', weight: 3 },
      { id: 'cash_heavy', when: (a) => Number(a.cashInAud) >= 10000, factor: 'Cash in at or above AUD 10,000', weight: 1 },
    ],
    // Venues with 15 or fewer gaming machines have reduced obligations; confirm
    // the current AUSTRAC position before relying on this rule.
    designatedServiceExempt: () => false,
  },

  tcsp: {
    label: 'Trust and Company Service Providers (formations, nominees)',
    regime: 'tranche2',
    questions: [
      { id: 'serviceType', prompt: 'Service', type: 'enum', required: true,
        options: ['company_formation', 'trust_formation', 'nominee_director', 'nominee_shareholder', 'registered_office'] },
      { id: 'formationJurisdiction', prompt: 'Jurisdiction (ISO code)', type: 'country', required: true },
    ],
    riskRules: [
      { id: 'nominee', when: (a) => ['nominee_director', 'nominee_shareholder'].includes(a.serviceType), factor: 'Nominee service', weight: 2 },
      { id: 'elevated_jurisdiction', when: (a, ctx) => ctx.isElevated(a.formationJurisdiction), factor: 'Elevated-risk jurisdiction', weight: 2 },
    ],
    designatedServiceExempt: () => false,
  },
});

export const SECTOR_IDS = Object.freeze(Object.keys(SECTORS));

/** Returns the questions that apply given the answers so far. */
export function questionnaireFor(sectorId, answers = {}) {
  const sector = SECTORS[sectorId];
  if (!sector) throw new Error(`Unknown sector: ${sectorId}`);
  return sector.questions.map((q) => ({
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    options: q.options,
    required: typeof q.required === 'function' ? q.required(answers) : Boolean(q.required),
  }));
}

/** Validates sector answers against the questionnaire. Returns a list of errors. */
export function validateSectorAnswers(sectorId, answers) {
  const errors = [];
  for (const q of questionnaireFor(sectorId, answers)) {
    const v = answers[q.id];
    const missing = v === undefined || v === null || v === '';
    if (q.required && missing) { errors.push(`${q.id} is required`); continue; }
    if (missing) continue;
    if (q.type === 'enum' && !q.options.includes(v)) errors.push(`${q.id} must be one of ${q.options.join(', ')}`);
    if (q.type === 'boolean' && typeof v !== 'boolean') errors.push(`${q.id} must be true or false`);
    if ((q.type === 'money' || q.type === 'number') && !(Number.isFinite(Number(v)) && Number(v) >= 0)) errors.push(`${q.id} must be a non-negative number`);
    if (q.type === 'country' && !/^[A-Z]{2}$/.test(String(v))) errors.push(`${q.id} must be a two-letter ISO country code`);
  }
  return errors;
}
