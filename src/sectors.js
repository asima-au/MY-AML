// The 9 sector profiles. Each profile changes the questionnaire, the extra
// validation rules, the risk factors and the designated-service exemption the
// engine applies.
//
// `regime` records whether the sector was regulated before the 2024
// amendments ("existing") or brought in by them ("tranche2"). Tranche 2
// commencement dates come from the AML/CTF Amendment Act 2024 and must be
// checked against AUSTRAC guidance before relying on them.
//
// `required` is either true/false or a function of the answers given so far,
// which is how the questionnaire branches. `designatedServiceExempt` returns
// true when the answers show the service is outside the designated services
// (every exemption rule is listed in TO_CONFIRM in config.js).

const yesNo = { type: 'boolean' };
const THRESHOLD = 10000;

export const SECTORS = Object.freeze({
  professional_services: {
    label: 'Professional Services (accountants, lawyers, conveyancers, insolvency)',
    regime: 'tranche2',
    questions: [
      { id: 'serviceType', prompt: 'Which service is being provided?', type: 'enum', required: true,
        options: ['company_formation', 'trust_setup', 'client_money_handling', 'property_transaction', 'insolvency', 'advice_only'] },
      { id: 'formationJurisdiction', prompt: 'Jurisdiction of any entity being formed (ISO code)', type: 'country',
        required: (a) => ['company_formation', 'trust_setup'].includes(a.serviceType) },
      { id: 'handlesClientFunds', prompt: 'Will funds pass through your trust account?', ...yesNo, required: (a) => a.serviceType !== 'advice_only' },
      { id: 'clientIsAlsoNomineeRequested', prompt: 'Has the client asked you to act as nominee director or shareholder?', ...yesNo,
        required: (a) => ['company_formation', 'trust_setup'].includes(a.serviceType) },
      { id: 'nomineeArrangementReason', prompt: 'Why does the client want a nominee?', type: 'text',
        required: (a) => a.clientIsAlsoNomineeRequested === true },
    ],
    riskRules: [
      { id: 'offshore_formation', when: (a) => a.serviceType === 'company_formation' && a.formationJurisdiction && a.formationJurisdiction !== 'AU',
        factor: 'Formation of an entity outside Australia', weight: 2 },
      { id: 'elevated_jurisdiction_formation', when: (a, ctx) => ctx.isElevated(a.formationJurisdiction),
        factor: 'Entity formed in an elevated-risk jurisdiction', weight: 2 },
      { id: 'nominee_requested', when: (a) => a.clientIsAlsoNomineeRequested === true,
        factor: 'Client requested nominee arrangements', weight: 2 },
    ],
    designatedServiceExempt: (a) => a.serviceType === 'advice_only',
    exemptionNote: 'Advice only, with no formation, client money, property or business transaction, is outside the professional-services designated services.',
  },

  real_estate: {
    label: "Real Estate (agents, buyer's agents, developers)",
    regime: 'tranche2',
    questions: [
      { id: 'serviceScope', prompt: 'What is the agency doing?', type: 'enum', required: false,
        options: ['sale_or_purchase', 'leasing_only', 'property_management_only'] },
      { id: 'propertyType', prompt: 'Property type', type: 'enum', required: (a) => !isLeasingOnly(a), options: ['residential', 'commercial', 'land', 'off_the_plan'] },
      { id: 'purchasePriceAud', prompt: 'Purchase price (AUD)', type: 'money', required: (a) => !isLeasingOnly(a) },
      { id: 'depositMethod', prompt: 'How is the deposit being paid?', type: 'enum', required: (a) => !isLeasingOnly(a),
        options: ['bank_transfer_own_account', 'bank_transfer_third_party', 'international_transfer', 'cash', 'crypto'] },
      { id: 'thirdPartyPayerRelationship', prompt: 'Who is the third party paying the deposit?', type: 'enum',
        required: (a) => a.depositMethod === 'bank_transfer_third_party', options: ['family_member', 'related_company', 'lender', 'other'] },
      { id: 'buyerVehicle', prompt: 'Buyer vehicle', type: 'enum', required: (a) => !isLeasingOnly(a), options: ['individual', 'company', 'trust', 'smsf', 'foreign_entity'] },
      { id: 'firbApprovalHeld', prompt: 'Does the foreign buyer hold FIRB approval?', ...yesNo, required: (a) => a.buyerVehicle === 'foreign_entity' },
    ],
    riskRules: [
      { id: 'trust_or_company_buyer', when: (a) => ['company', 'trust', 'foreign_entity'].includes(a.buyerVehicle),
        factor: 'Property bought through a legal entity or trust', weight: 1 },
      { id: 'third_party_deposit', when: (a) => a.depositMethod === 'bank_transfer_third_party',
        factor: 'Deposit paid by a third party', weight: 2 },
      { id: 'international_deposit', when: (a) => a.depositMethod === 'international_transfer',
        factor: 'Deposit paid from overseas', weight: 1 },
      { id: 'cash_deposit', when: (a) => a.depositMethod === 'cash', factor: 'Deposit paid in cash', weight: 2 },
      { id: 'high_value_property', when: (a) => Number(a.purchasePriceAud) >= 5000000,
        factor: 'Purchase price of AUD 5m or more', weight: 1 },
      { id: 'foreign_buyer_without_firb', when: (a) => a.buyerVehicle === 'foreign_entity' && a.firbApprovalHeld === false,
        factor: 'Foreign buyer without FIRB approval', weight: 2 },
    ],
    designatedServiceExempt: (a) => isLeasingOnly(a),
    exemptionNote: 'Leasing and property management are outside the real estate designated services, which cover brokering a sale, purchase or transfer.',
  },

  financial_services: {
    label: 'Financial Services (banks, credit unions, AFSL advisers)',
    regime: 'existing',
    questions: [
      { id: 'productType', prompt: 'Product or service', type: 'enum', required: true,
        options: ['deposit_account', 'loan', 'investment', 'international_transfer', 'advice_with_dealing', 'advice_only'] },
      { id: 'expectedMonthlyVolumeAud', prompt: 'Expected monthly volume (AUD)', type: 'money', required: (a) => a.productType !== 'advice_only' },
      { id: 'internationalCounterparties', prompt: 'Will the customer send or receive international transfers?', ...yesNo, required: (a) => a.productType !== 'advice_only' },
      { id: 'mainCounterpartyCountry', prompt: 'Main overseas counterparty country (ISO code)', type: 'country',
        required: (a) => a.internationalCounterparties === true },
    ],
    riskRules: [
      { id: 'intl_counterparties', when: (a) => a.internationalCounterparties === true, factor: 'International transfer activity', weight: 1 },
      { id: 'high_volume', when: (a) => Number(a.expectedMonthlyVolumeAud) >= 1000000, factor: 'Expected volume of AUD 1m or more a month', weight: 1 },
      { id: 'elevated_counterparty', when: (a, ctx) => ctx.isElevated(a.mainCounterpartyCountry), factor: 'Main counterparty in an elevated-risk jurisdiction', weight: 2 },
    ],
    designatedServiceExempt: (a) => a.productType === 'advice_only',
    exemptionNote: 'Personal advice that does not arrange or deal in a designated service is not itself a designated service.',
  },

  virtual_assets: {
    label: 'Virtual Asset Services (exchanges, wallets)',
    regime: 'existing',
    questions: [
      { id: 'serviceType', prompt: 'Service', type: 'enum', required: true,
        options: ['exchange_fiat_crypto', 'exchange_crypto_crypto', 'custodial_wallet', 'transfer', 'non_custodial_software_only'] },
      { id: 'walletAddressesDeclared', prompt: 'Has the customer declared all external wallet addresses?', ...yesNo, required: (a) => a.serviceType !== 'non_custodial_software_only' },
      { id: 'walletScreeningResult', prompt: 'Result of blockchain analytics on declared wallets', type: 'enum',
        required: (a) => a.walletAddressesDeclared === true, options: ['no_exposure', 'indirect_exposure', 'direct_exposure'] },
      { id: 'travelRuleDataComplete', prompt: 'Is originator and beneficiary (travel rule) data complete?', ...yesNo,
        required: (a) => ['transfer', 'exchange_crypto_crypto'].includes(a.serviceType) },
      { id: 'usesPrivacyTools', prompt: 'Any mixer, tumbler or privacy-coin exposure identified?', ...yesNo, required: (a) => a.serviceType !== 'non_custodial_software_only' },
    ],
    riskRules: [
      { id: 'privacy_tools', when: (a) => a.usesPrivacyTools === true, factor: 'Exposure to mixers or privacy coins', weight: 3 },
      { id: 'travel_rule_gap', when: (a) => a.travelRuleDataComplete === false, factor: 'Incomplete travel rule information', weight: 2 },
      { id: 'undeclared_wallets', when: (a) => a.walletAddressesDeclared === false, factor: 'External wallets not declared', weight: 1 },
      { id: 'wallet_exposure', when: (a) => a.walletScreeningResult === 'direct_exposure', factor: 'Direct exposure to illicit wallets', weight: 3 },
    ],
    designatedServiceExempt: (a) => a.serviceType === 'non_custodial_software_only',
    exemptionNote: 'Publishing non-custodial software, without exchanging, holding or transferring assets for customers, is outside the virtual asset services.',
  },

  remittance: {
    label: 'Remittance Services (money transfer operators)',
    regime: 'existing',
    questions: [
      { id: 'businessModel', prompt: 'Who is the money being sent for?', type: 'enum', required: false,
        options: ['customers', 'own_supplier_payments'] },
      { id: 'destinationCountry', prompt: 'Destination country (ISO code)', type: 'country', required: (a) => a.businessModel !== 'own_supplier_payments' },
      { id: 'amountAud', prompt: 'Transfer amount (AUD)', type: 'money', required: (a) => a.businessModel !== 'own_supplier_payments' },
      { id: 'beneficiaryRelationship', prompt: 'Relationship to the beneficiary', type: 'enum', required: (a) => a.businessModel !== 'own_supplier_payments',
        options: ['family', 'business', 'self', 'unknown'] },
      { id: 'relationshipExplanation', prompt: 'Explain the relationship to the beneficiary', type: 'text',
        required: (a) => a.beneficiaryRelationship === 'unknown' },
      { id: 'paidInCash', prompt: 'Is the transfer funded in cash?', ...yesNo, required: (a) => a.businessModel !== 'own_supplier_payments' },
    ],
    riskRules: [
      { id: 'unknown_beneficiary', when: (a) => a.beneficiaryRelationship === 'unknown', factor: 'Relationship to beneficiary not established', weight: 2 },
      { id: 'cash_funded', when: (a) => a.paidInCash === true, factor: 'Transfer funded in cash', weight: 1 },
      { id: 'elevated_destination', when: (a, ctx) => ctx.isElevated(a.destinationCountry), factor: 'Destination in an elevated-risk jurisdiction', weight: 2 },
    ],
    designatedServiceExempt: (a) => a.businessModel === 'own_supplier_payments',
    exemptionNote: 'Paying the business\'s own suppliers is not a remittance service provided to a customer.',
  },

  bullion: {
    label: 'Bullion Dealers (gold, silver, platinum, palladium)',
    regime: 'existing',
    questions: [
      { id: 'productForm', prompt: 'What is being sold?', type: 'enum', required: false, options: ['bullion', 'numismatic_coins', 'jewellery'] },
      { id: 'metal', prompt: 'Metal', type: 'enum', required: (a) => isBullion(a), options: ['gold', 'silver', 'platinum', 'palladium'] },
      { id: 'orderValueAud', prompt: 'Order value (AUD)', type: 'money', required: true },
      { id: 'cashComponentAud', prompt: 'Amount paid in physical cash (AUD)', type: 'money', required: true },
      { id: 'collectionMethod', prompt: 'Collection method', type: 'enum', required: (a) => isBullion(a), options: ['in_store', 'courier', 'vault_storage'] },
      { id: 'deliveryToCustomerAddress', prompt: 'Is the courier delivering to the customer\'s verified address?', ...yesNo,
        required: (a) => a.collectionMethod === 'courier' },
    ],
    riskRules: [
      { id: 'cash_heavy', when: (a) => Number(a.cashComponentAud) >= THRESHOLD, factor: 'Cash payment at or above AUD 10,000', weight: 2 },
      { id: 'anonymous_collection', when: (a) => a.collectionMethod === 'in_store' && Number(a.orderValueAud) >= 50000,
        factor: 'High-value bullion collected in person', weight: 1 },
      { id: 'third_party_delivery', when: (a) => a.deliveryToCustomerAddress === false, factor: 'Delivery to an address other than the customer\'s', weight: 2 },
    ],
    designatedServiceExempt: (a) => !isBullion(a),
    exemptionNote: 'Numismatic coins and jewellery are not bullion. Assess them under the precious metals and stones sector instead.',
  },

  precious_metals_stones: {
    label: 'Dealers in Precious Metals & Stones (jewellers, high-value goods)',
    regime: 'tranche2',
    questions: [
      { id: 'itemType', prompt: 'Item type', type: 'enum', required: true, options: ['jewellery', 'loose_stones', 'watches', 'precious_metal_items'] },
      { id: 'saleValueAud', prompt: 'Sale value (AUD)', type: 'money', required: true },
      { id: 'cashComponentAud', prompt: 'Amount paid in physical cash (AUD)', type: 'money', required: true },
      { id: 'exportIntended', prompt: 'Is the item leaving Australia?', ...yesNo, required: (a) => Number(a.cashComponentAud) >= THRESHOLD },
      { id: 'destinationCountry', prompt: 'Destination country (ISO code)', type: 'country', required: (a) => a.exportIntended === true },
    ],
    riskRules: [
      { id: 'cash_heavy', when: (a) => Number(a.cashComponentAud) >= THRESHOLD, factor: 'Cash payment at or above AUD 10,000', weight: 2 },
      { id: 'loose_stones', when: (a) => a.itemType === 'loose_stones', factor: 'Loose stones are easily moved and hard to value', weight: 1 },
      { id: 'export', when: (a) => a.exportIntended === true, factor: 'Item to be exported', weight: 1 },
    ],
    // Dealers come into the regime for cash transactions at or above the threshold.
    designatedServiceExempt: (a) => Number(a.cashComponentAud) < THRESHOLD,
    exemptionNote: 'Dealers are in scope only for transactions with AUD 10,000 or more in physical cash.',
  },

  gambling: {
    label: 'Gambling and Gaming (casinos, online betting, venues with EGMs)',
    regime: 'existing',
    questions: [
      { id: 'venueType', prompt: 'Venue type', type: 'enum', required: true, options: ['casino', 'online_betting', 'hotel_or_club_egm'] },
      { id: 'egmCount', prompt: 'Number of gaming machines at the venue', type: 'number',
        required: (a) => a.venueType === 'hotel_or_club_egm' },
      { id: 'cashInAud', prompt: 'Cash in for this session (AUD)', type: 'money', required: (a) => a.venueType !== 'online_betting' },
      { id: 'fundingAccountInCustomerName', prompt: 'Is the betting account funded from an account in the customer\'s name?', ...yesNo,
        required: (a) => a.venueType === 'online_betting' },
      { id: 'minimalPlayObserved', prompt: 'Cash in with little or no play before cash out?', ...yesNo, required: true },
    ],
    riskRules: [
      { id: 'minimal_play', when: (a) => a.minimalPlayObserved === true, factor: 'Cash in and out with minimal play (possible refining)', weight: 3 },
      { id: 'cash_heavy', when: (a) => Number(a.cashInAud) >= THRESHOLD, factor: 'Cash in at or above AUD 10,000', weight: 1 },
      { id: 'third_party_funding', when: (a) => a.fundingAccountInCustomerName === false, factor: 'Betting account funded by a third party', weight: 2 },
    ],
    // Reduced obligations for venues with 15 or fewer machines. Applied only
    // below the cash threshold, so threshold cash is always handled. Confirm
    // the current AUSTRAC position before relying on this rule.
    designatedServiceExempt: (a) => a.venueType === 'hotel_or_club_egm' && Number(a.egmCount) <= 15 && Number(a.cashInAud) < THRESHOLD,
    exemptionNote: 'Venues with 15 or fewer gaming machines have reduced obligations (applied here only below AUD 10,000 cash).',
  },

  tcsp: {
    label: 'Trust and Company Service Providers (formations, nominees)',
    regime: 'tranche2',
    questions: [
      { id: 'serviceType', prompt: 'Service', type: 'enum', required: true,
        options: ['company_formation', 'trust_formation', 'nominee_director', 'nominee_shareholder', 'registered_office'] },
      { id: 'formationJurisdiction', prompt: 'Jurisdiction (ISO code)', type: 'country', required: true },
      { id: 'nominatorIdentified', prompt: 'Have you identified the person the nominee acts for?', ...yesNo,
        required: (a) => ['nominee_director', 'nominee_shareholder'].includes(a.serviceType) },
      { id: 'clientIsListedCompany', prompt: 'Is the client an ASX-listed company or its subsidiary?', ...yesNo,
        required: (a) => a.serviceType === 'registered_office' },
    ],
    riskRules: [
      { id: 'nominee', when: (a) => ['nominee_director', 'nominee_shareholder'].includes(a.serviceType), factor: 'Nominee service', weight: 2 },
      { id: 'nominator_unknown', when: (a) => a.nominatorIdentified === false, factor: 'Person behind the nominee not identified', weight: 3 },
      { id: 'elevated_jurisdiction', when: (a, ctx) => ctx.isElevated(a.formationJurisdiction), factor: 'Elevated-risk jurisdiction', weight: 2 },
    ],
    designatedServiceExempt: (a) => a.serviceType === 'registered_office' && a.clientIsListedCompany === true,
    exemptionNote: 'Registered office services for a listed company or its subsidiary are treated as outside scope.',
  },
});

function isLeasingOnly(a) {
  return a.serviceScope === 'leasing_only' || a.serviceScope === 'property_management_only';
}

function isBullion(a) {
  return a.productForm === undefined || a.productForm === 'bullion';
}

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
  const questions = questionnaireFor(sectorId, answers);
  const known = new Set(questions.map((q) => q.id));
  for (const key of Object.keys(answers)) if (!known.has(key)) errors.push(`${key} is not a question for this sector`);
  for (const q of questions) {
    const v = answers[q.id];
    const missing = v === undefined || v === null || v === '';
    if (q.required && missing) { errors.push(`${q.id} is required`); continue; }
    if (missing) continue;
    if (q.type === 'enum' && !q.options.includes(v)) errors.push(`${q.id} must be one of ${q.options.join(', ')}`);
    if (q.type === 'boolean' && typeof v !== 'boolean') errors.push(`${q.id} must be true or false`);
    if ((q.type === 'money' || q.type === 'number') && !(typeof v === 'number' && Number.isFinite(v) && v >= 0)) errors.push(`${q.id} must be a non-negative number`);
    if (q.type === 'country' && !/^[A-Z]{2}$/.test(String(v))) errors.push(`${q.id} must be a two-letter ISO country code`);
    if (q.type === 'text' && (typeof v !== 'string' || !v.trim())) errors.push(`${q.id} must be text`);
  }
  return errors;
}

/** True only when the answers are valid and the sector's exemption applies. */
export function isExempt(sectorId, answers) {
  return validateSectorAnswers(sectorId, answers).length === 0 && SECTORS[sectorId].designatedServiceExempt(answers);
}
