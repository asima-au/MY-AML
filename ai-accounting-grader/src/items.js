// Gold-standard item bank: test prompts with the answer a careful professional
// would give, the working, and known model failure patterns ("traps").
//
// Australian context (AASB standards mirror IFRS: AASB 116 = IAS 16 and so on).
// Every gold answer is checked by test/grader.test.mjs: it must grade 5/5.

export const ITEMS = [
  // ---------------------------------------------------------------- Bookkeeping
  {
    id: 'B1', domain: 'Bookkeeping', standard: 'GST (A New Tax System (Goods and Services Tax) Act 1999)',
    title: 'Credit sale including GST',
    prompt: 'A GST-registered Australian business sells goods on credit for $11,000, including GST. Record the journal entry for the sale.',
    working: [
      'The price includes GST, so GST is 1/11 of the total: 11,000 ÷ 11 = 1,000.',
      'Revenue excludes GST: 11,000 − 1,000 = 10,000.',
    ],
    entries: [[['Accounts receivable', 'dr', 11000], ['Sales revenue', 'cr', 10000], ['GST payable', 'cr', 1000]]],
    keyFigures: [],
    mustMention: [],
    traps: [
      { line: ['Sales revenue', 'cr', 11000], category: 'standard', finding: 'Recorded the GST-inclusive price as revenue. GST collected is a liability to the ATO, not income.' },
      { line: ['GST payable', 'cr', 1100], category: 'standard', finding: 'Took 10% of the GST-inclusive price. GST in an inclusive price is 1/11 of it ($1,000).' },
    ],
    flawed: 'Journal entry:\nDr Accounts Receivable $11,000\nCr Sales Revenue $9,900\nCr GST Payable $1,100\n(GST = 11,000 × 10% = 1,100)',
  },
  {
    id: 'B2', domain: 'Bookkeeping', standard: 'Accrual accounting (AASB 101 / Conceptual Framework)',
    title: 'Prepaid insurance adjustment',
    prompt: 'On 1 October a business paid $12,000 for a 12-month insurance policy and debited Prepaid insurance. Prepare the adjusting entry at the 31 December year end.',
    working: [
      'October to December is 3 months of cover used.',
      'Expired portion: 12,000 × 3 ÷ 12 = 3,000.',
      'Prepaid insurance left: 12,000 − 3,000 = 9,000 (9 months).',
    ],
    entries: [[['Insurance expense', 'dr', 3000], ['Prepaid insurance', 'cr', 3000]]],
    keyFigures: [],
    mustMention: [],
    traps: [
      { line: ['Insurance expense', 'dr', 9000], category: 'standard', finding: 'Expensed the unexpired 9 months instead of the 3 months used.' },
      { line: ['Insurance expense', 'dr', 12000], category: 'standard', finding: 'Expensed the whole premium; only the expired 3 months belong in this year.' },
    ],
    flawed: 'Adjusting entry at 31 December:\nDebit Insurance Expense 9,000\nCredit Prepaid Insurance 9,000\nThe policy has 9 months remaining (12,000 × 9/12 = 9,000).',
  },
  {
    id: 'B3', domain: 'Bookkeeping', standard: 'Accrual accounting',
    title: 'Accrued wages at year end',
    prompt: 'Staff work Monday to Friday and are paid $5,000 every Friday for that week. The financial year ends on Wednesday 31 December 2025. Record the accrued wages.',
    working: [
      'Daily wages: 5,000 ÷ 5 = 1,000.',
      'Monday to Wednesday is 3 days worked but unpaid at year end: 1,000 × 3 = 3,000.',
    ],
    entries: [[['Wages expense', 'dr', 3000], ['Wages payable', 'cr', 3000]]],
    keyFigures: [],
    mustMention: [],
    traps: [
      { line: ['Wages expense', 'dr', 2000], category: 'standard', finding: 'Accrued 2 days. Monday to Wednesday is 3 working days.' },
      { line: ['Wages expense', 'dr', 5000], category: 'standard', finding: 'Accrued a full week; only Monday to Wednesday falls in this year.' },
    ],
    flawed: 'Accrued wages = 5,000 / 5 × 2 = 2,000\nDr Wages expense 2,000\nCr Wages payable 2,000',
  },
  {
    id: 'B4', domain: 'Bookkeeping', standard: 'AASB 9 Financial Instruments (loss allowance)',
    title: 'Topping up the doubtful debts allowance',
    prompt: 'Accounts receivable at year end are $200,000 and management expects 3% to be uncollectible. Before adjustment, the allowance for doubtful debts has a credit balance of $2,000. Record the year-end adjustment.',
    working: [
      'Required allowance: 200,000 × 3% = 6,000.',
      'Existing credit balance is 2,000, so the top-up is 6,000 − 2,000 = 4,000.',
    ],
    entries: [[['Bad debts expense', 'dr', 4000], ['Allowance for doubtful debts', 'cr', 4000]]],
    keyFigures: [],
    mustMention: [],
    traps: [
      { line: ['Bad debts expense', 'dr', 6000], category: 'standard', finding: 'Expensed the full required balance and ignored the $2,000 already in the allowance.' },
      { line: ['Bad debts expense', 'dr', 8000], category: 'standard', finding: 'Added the existing $2,000 credit balance instead of deducting it.' },
    ],
    flawed: 'Required allowance = 200,000 × 3% = 6,000\nDr Bad debts expense 6,000\nCr Allowance for doubtful debts 6,000',
  },
  {
    id: 'B5', domain: 'Bookkeeping', standard: 'Bank reconciliation',
    title: 'Bank reconciliation',
    prompt: 'The bank statement shows $25,400 and the cash book shows $24,550. There are deposits in transit of $3,200 and unpresented cheques of $4,100. Bank fees of $50 on the statement are not yet in the cash book. Calculate the reconciled balance and record any entry needed.',
    working: [
      'Bank side: 25,400 + 3,200 − 4,100 = 24,500.',
      'Cash book side: 24,550 − 50 = 24,500. Both sides agree at 24,500.',
      'Only the bank fees need an entry; timing items do not.',
    ],
    entries: [[['Bank fees expense', 'dr', 50], ['Cash at bank', 'cr', 50]]],
    keyFigures: [{ label: 'Reconciled balance', value: 24500 }],
    mustMention: [],
    traps: [
      { figure: 26300, category: 'standard', finding: 'Reversed the timing items: deposits in transit are added to the bank balance and unpresented cheques are deducted.' },
      { line: ['Cash at bank', 'dr', 3200], category: 'standard', finding: 'Journalled a deposit in transit. Timing differences need no cash book entry.' },
    ],
    flawed: 'Adjusted bank balance = 25,400 − 3,200 + 4,100 = 26,300\nDr Bank charges 50\nCr Cash at bank 50',
  },

  // ------------------------------------------------------- Reporting standards
  {
    id: 'R1', domain: 'Reporting standards', standard: 'AASB 116 / IAS 16 Property, Plant and Equipment',
    title: 'Straight-line depreciation with a residual value',
    prompt: 'A machine bought on 1 January cost $50,000, has a residual value of $5,000 and a useful life of 5 years. Record the depreciation for the year ended 31 December using the straight-line method.',
    working: [
      'Depreciable amount is cost less residual value: 50,000 − 5,000 = 45,000.',
      'Annual depreciation: 45,000 ÷ 5 = 9,000.',
    ],
    entries: [[['Depreciation expense', 'dr', 9000], ['Accumulated depreciation', 'cr', 9000]]],
    keyFigures: [],
    mustMention: [{ pattern: /residual/i, label: 'the residual value' }],
    traps: [
      { line: ['Depreciation expense', 'dr', 10000], category: 'standard', finding: 'Ignored the residual value. AASB 116 depreciates cost less residual value.' },
      { line: ['Machinery', 'cr', 9000], category: 'standard', finding: 'Credited the asset directly; depreciation goes to accumulated depreciation.' },
    ],
    flawed: 'Annual depreciation = 50,000 / 5 = 10,000\nDr Depreciation expense 10,000\nCr Accumulated depreciation 10,000',
  },
  {
    id: 'R2', domain: 'Reporting standards', standard: 'AASB 116 / IAS 16 Property, Plant and Equipment',
    title: 'Diminishing balance, year 2',
    prompt: 'Equipment cost $40,000 and is depreciated at 25% a year on the diminishing balance method, with no residual value. Record depreciation for the second year.',
    working: [
      'Year 1: 40,000 × 25% = 10,000, leaving a carrying amount of 40,000 − 10,000 = 30,000.',
      'Year 2: 30,000 × 25% = 7,500.',
    ],
    entries: [[['Depreciation expense', 'dr', 7500], ['Accumulated depreciation', 'cr', 7500]]],
    keyFigures: [],
    mustMention: [],
    traps: [
      { line: ['Depreciation expense', 'dr', 10000], category: 'standard', finding: 'Applied the rate to cost (straight-line style). Diminishing balance applies it to the carrying amount.' },
    ],
    flawed: 'Depreciation = 40,000 × 25% = 10,000 each year\nDr Depreciation 10,000\nCr Accumulated depreciation 10,000',
  },
  {
    id: 'R3', domain: 'Reporting standards', standard: 'AASB 16 / IFRS 16 Leases',
    title: 'Lessee accounting: commencement and year 1',
    prompt: 'A lessee leases equipment for 3 years. Payments are $10,000 a year in arrears and the interest rate implicit in the lease is 5%. There are no initial direct costs, incentives or residual guarantees, and the right-of-use asset is depreciated straight-line over 3 years. Record the commencement entry, the first payment and the first year\'s depreciation. Round to cents.',
    working: [
      'Discount factors at 5%: 0.952381 + 0.907029 + 0.863838 = 2.723248.',
      'Lease liability and right-of-use asset at commencement: 10,000 × 2.723248 = 27,232.48.',
      'Year 1 interest: 27,232.48 × 5% = 1,361.62.',
      'Principal repaid: 10,000 − 1,361.62 = 8,638.38.',
      'Depreciation of the right-of-use asset: 27,232.48 ÷ 3 = 9,077.49.',
    ],
    entries: [
      [['Right-of-use asset', 'dr', 27232.48], ['Lease liability', 'cr', 27232.48]],
      [['Interest expense', 'dr', 1361.62], ['Lease liability', 'dr', 8638.38], ['Cash at bank', 'cr', 10000]],
      [['Depreciation expense', 'dr', 9077.49], ['Accumulated depreciation – right-of-use asset', 'cr', 9077.49]],
    ],
    tolerance: 1,
    keyFigures: [],
    mustMention: [{ pattern: /right[- ]of[- ]use|\bROU\b/i, label: 'the right-of-use asset' }],
    traps: [
      { line: ['Lease expense', 'dr'], category: 'standard', finding: 'Expensed the payment as an operating lease. Under AASB 16 a lessee recognises a right-of-use asset and a lease liability (apart from short-term and low-value exemptions).' },
      { line: ['Interest expense', 'dr', 1500], category: 'standard', finding: 'Charged interest on the undiscounted payments ($30,000). Interest accrues on the discounted lease liability.' },
    ],
    flawed: 'Under AASB 16 this is an operating lease, so each payment is expensed as incurred:\nDr Lease expense 10,000\nCr Cash 10,000',
  },
  {
    id: 'R4', domain: 'Reporting standards', standard: 'AASB 15 / IFRS 15 Revenue from Contracts with Customers',
    title: 'Bundled sale: equipment plus two years of service',
    prompt: 'A company sells equipment with two years of maintenance for a single price of $12,000, received in cash on delivery. Stand-alone selling prices are $10,000 for the equipment and $5,000 for the maintenance. Record the entry on delivery.',
    working: [
      'Total stand-alone prices: 10,000 + 5,000 = 15,000.',
      'Allocate the $12,000 price in proportion. Equipment: 12,000 × 10,000 ÷ 15,000 = 8,000. Maintenance: 12,000 × 5,000 ÷ 15,000 = 4,000.',
      'Equipment revenue is recognised on delivery; maintenance revenue is deferred and recognised over the two years.',
    ],
    entries: [[['Cash at bank', 'dr', 12000], ['Sales revenue', 'cr', 8000], ['Contract liability', 'cr', 4000]]],
    keyFigures: [],
    mustMention: [{ pattern: /allocat|stand-?alone/i, label: 'allocation by stand-alone selling price' }],
    traps: [
      { line: ['Sales revenue', 'cr', 12000], category: 'standard', finding: 'Recognised all revenue on delivery. The maintenance is a separate performance obligation satisfied over two years.' },
      { line: ['Sales revenue', 'cr', 10000], category: 'standard', finding: 'Gave the equipment its full stand-alone price and the residual to maintenance. AASB 15 allocates the price in proportion to stand-alone selling prices.' },
    ],
    flawed: 'Revenue of $12,000 is recognised when the equipment is delivered:\nDr Cash 12,000\nCr Revenue 12,000',
  },
  {
    id: 'R5', domain: 'Reporting standards', standard: 'AASB 102 / IAS 2 Inventories',
    title: 'Inventory at lower of cost and net realisable value',
    prompt: 'Inventory cost $20,000. It is expected to sell for $22,000, with $3,500 of costs to complete and sell. Record any adjustment at year end.',
    working: [
      'Net realisable value: 22,000 − 3,500 = 18,500.',
      'NRV is below cost, so write down by 20,000 − 18,500 = 1,500.',
    ],
    entries: [[['Inventory write-down expense', 'dr', 1500], ['Inventory', 'cr', 1500]]],
    keyFigures: [],
    mustMention: [{ pattern: /net realis(?:a|z)able value|\bNRV\b/i, label: 'net realisable value' }],
    traps: [
      { text: /no (?:write[- ]?down|adjustment) (?:is )?(?:needed|required|necessary)/i, category: 'standard', finding: 'Compared cost with the selling price and ignored costs to sell. AASB 102 compares cost with net realisable value.' },
      { line: ['Inventory write-down expense', 'dr', 3500], category: 'standard', finding: 'Wrote down by the costs to sell instead of the shortfall of NRV below cost.' },
    ],
    flawed: 'The selling price ($22,000) exceeds cost ($20,000), so no write-down is needed. Inventory stays at $20,000.',
  },

  // ------------------------------------------------------------------------ Tax
  {
    id: 'T1', domain: 'Tax', standard: 'GST / Business Activity Statement',
    title: 'Quarterly GST on the BAS',
    prompt: 'For the quarter, a GST-registered business had taxable sales of $55,000 (GST-inclusive), purchases of $22,000 (GST-inclusive, all creditable) and wages of $10,000. Calculate GST on sales (label 1A), GST credits (label 1B) and net GST payable.',
    working: [
      'GST on sales (1A): 55,000 ÷ 11 = 5,000.',
      'GST credits (1B): 22,000 ÷ 11 = 2,000. Wages carry no GST.',
      'Net GST payable: 5,000 − 2,000 = 3,000.',
    ],
    entries: [],
    keyFigures: [{ label: 'GST on sales (1A)', value: 5000 }, { label: 'GST credits (1B)', value: 2000 }, { label: 'Net GST payable', value: 3000 }],
    mustMention: [],
    traps: [
      { figure: 5500, category: 'standard', finding: 'Took 10% of GST-inclusive sales. GST in an inclusive amount is 1/11 ($5,000).' },
      { figure: 2200, category: 'standard', finding: 'Took 10% of GST-inclusive purchases. The credit is 1/11 ($2,000).' },
      { figure: 1000, category: 'standard', finding: 'Treated wages as carrying GST. Wages are not a taxable supply.' },
    ],
    flawed: 'GST on sales = 55,000 × 10% = 5,500\nGST credits = 22,000 × 10% = 2,200\nNet GST payable = 5,500 − 2,200 = 3,300',
  },
  {
    id: 'T2', domain: 'Tax', standard: 'AASB 112 / IAS 12 Income Taxes',
    title: 'Deferred tax on accelerated tax depreciation',
    prompt: 'At year end an asset has a carrying amount of $60,000 and a tax base of $45,000. The tax rate is 30% and there was no opening deferred tax balance. Record the deferred tax entry.',
    working: [
      'Taxable temporary difference: 60,000 − 45,000 = 15,000 (carrying amount above tax base).',
      'Deferred tax liability: 15,000 × 30% = 4,500.',
    ],
    entries: [[['Income tax expense', 'dr', 4500], ['Deferred tax liability', 'cr', 4500]]],
    keyFigures: [],
    mustMention: [{ pattern: /temporary difference/i, label: 'the temporary difference' }],
    traps: [
      { line: ['Deferred tax asset', 'dr'], category: 'standard', finding: 'Recognised a deferred tax asset. A carrying amount above the tax base is a taxable temporary difference, so a liability arises.' },
      { line: ['Deferred tax liability', 'cr', 15000], category: 'standard', finding: 'Recognised the whole temporary difference; apply the 30% tax rate.' },
    ],
    flawed: 'Temporary difference = 60,000 − 45,000 = 15,000\nDeferred tax = 15,000 × 30% = 4,050\nDr Income tax expense 4,050\nCr Deferred tax liability 4,050',
  },
];

export function getItem(id) {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown item ${id}. Items: ${ITEMS.map((i) => i.id).join(', ')}`);
  return item;
}

const money = (n) => n.toLocaleString('en-AU', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

/** The answer a careful professional would give, with working shown. */
export function modelAnswer(item) {
  const parts = ['Working:', ...item.working.map((w) => `- ${w}`)];
  if (item.keyFigures.length) parts.push('', 'Answer:', ...item.keyFigures.map((k) => `- ${k.label}: $${money(k.value)}`));
  item.entries.forEach((entry, i) => {
    parts.push('', item.entries.length > 1 ? `Journal entry ${i + 1}:` : 'Journal entry:');
    for (const [account, side, amount] of entry) parts.push(`${side === 'dr' ? 'Dr' : '    Cr'} ${account} ${money(amount)}`);
  });
  return parts.join('\n');
}
