# AML/CTF Compliance Tool: Blueprint and Test Report

Code: `src/` (engine, sectors, projection, audit, dates, config). Tests: `test/scenarios.test.mjs`. Run `npm test`. Print the 3×3 checkpoint report with `node scripts/aml-test-report.mjs`.

This is a rules engine and data model, not legal advice. Before production use, a compliance officer must confirm every parameter in `src/config.js` and every sector rule in `src/sectors.js` against current AUSTRAC guidance, the AML/CTF Act 2006, the AML/CTF Rules, and the AML/CTF Amendment Act 2024.

---

## 1. Executive logic overview

### How a case flows

1. The reporting entity's sector (one of 9) is fixed on its profile. It selects the questionnaire, the validation rules and the sector risk rules.
2. Every case runs the same 13 checkpoints in 4 phases. The sector changes what each checkpoint asks for and how it scores, not whether it runs.
3. Risk scoring combines sector rules, PEP status, jurisdictions, funds origin, structuring patterns and ownership complexity. The score decides whether Phase 3 (EDD) applies.
4. The case state is derived from the checkpoint results. It is never set by hand.
5. Every view of a case passes through `projectForAudience`. Customers and front-line staff get a fixed, neutral view. Only SMR-cleared roles see risk, alerts, reports or rationale.

### Sector routing

| Sector | Regime | Questions (conditional ones in *italics*) | Sector risk rules | Exemption rule (confirm) |
|---|---|---|---|---|
| Professional services | Tranche 2 | Service type; *formation jurisdiction*; *client funds through trust account*; *nominee request*; *nominee reason* | Offshore formation; elevated-risk jurisdiction; nominee request | Advice only |
| Real estate | Tranche 2 | Service scope; *property type*; *price*; *deposit method*; *third-party payer*; *buyer vehicle*; *FIRB approval* | Entity or trust buyer; third-party, overseas or cash deposit; price of AUD 5m or more; foreign buyer without FIRB | Leasing or property management only |
| Financial services | Existing | Product; *monthly volume*; *international counterparties*; *main counterparty country* | International activity; AUD 1m+ a month; elevated-risk counterparty. Raises IFTI alerts | Advice only |
| Virtual assets | Existing | Service; *wallets declared*; *wallet analytics result*; *travel rule data*; *privacy tools* | Mixers or privacy coins; travel rule gaps; undeclared wallets; direct illicit exposure | Non-custodial software only |
| Remittance | Existing | Business model; *destination*; *amount*; *beneficiary relationship*; *relationship explanation*; *cash funding* | Unestablished beneficiary; cash funding; elevated-risk destination. Raises IFTI alerts | Paying own suppliers |
| Bullion | Existing | Product form; *metal*; order value; cash; *collection*; *courier to customer's address* | Cash AUD 10,000+; high-value in-person collection; delivery elsewhere | Not bullion (coins, jewellery) |
| Precious metals and stones | Tranche 2 | Item type; sale value; cash; *export*; *destination* | Cash AUD 10,000+; loose stones; export | Cash under AUD 10,000 |
| Gambling | Existing | Venue type; *EGM count*; *cash in*; *account funded in own name*; minimal play | Minimal play; cash AUD 10,000+; third-party funding | 15 or fewer EGMs and cash under AUD 10,000 |
| Trust and company service providers | Tranche 2 | Service; jurisdiction; *nominator identified*; *listed client* | Nominee service; nominator unknown; elevated-risk jurisdiction | Registered office for a listed company |

An exempt case (valid answers and the exemption applies) runs only checkpoints 3 (sanctions law applies regardless), 7 (records the exemption) and 13; the others are `not_applicable` and an unenrolled firm is not blocked.

Branching is in two places:
- **Question level:** `required` can be a function of earlier answers. For example, a formation jurisdiction is required only when the service is a formation.
- **Rule level:** each sector's `riskRules` and `designatedServiceExempt` apply only to that sector.

### The 4 phases and 13 checkpoints

| # | Phase | Checkpoint | Passes when | Statuses |
|---|---|---|---|---|
| 1 | Pre-screening | AUSTRAC enrolment | Entity is enrolled, has an enrolment number, and its enrolment covers the sector. Remittance and virtual asset providers also need their registration | pass / blocked / not_applicable |
| 2 | Pre-screening | Compliance officer sign-off | Officer appointed; program approved within 12 calendar months; for EDD cases, approval by the officer on record, dated no later than now | pass / fail / action_required |
| 3 | Pre-screening | Sanctions and PEP screening | Every subject (customer, owners at every layer, trustees) screened; no confirmed sanctions match; no possible match left unreviewed. PEPs recorded | pass / action_required / blocked |
| 4 | Customer due diligence | Individual identity | Name, date of birth and address present; two verified sources, one independent. For entities, every beneficial owner verified | pass / action_required |
| 5 | Customer due diligence | Entity and trust | Registry extract (ASIC or foreign registry) shows registered; registration number held. Trusts: deed sighted, trust type, trustees verified | pass / action_required / not_applicable |
| 6 | Customer due diligence | Beneficial ownership | Ownership at each layer adds up to no more than 100%; entity holders looked through (percentages multiplied per layer, aggregated per person); individuals at 25% or more, or with control, identified | pass / action_required / not_applicable |
| 7 | Customer due diligence | Nature of business and profile | Sector questionnaire valid; nature, purpose and expected activity recorded | pass / action_required |
| 8 | Enhanced due diligence | Risk escalation | Score computed; EDD triggered by high risk, a foreign PEP, a domestic PEP in a medium or high case, or a FATF call-for-action jurisdiction | pass / escalated |
| 9 | Enhanced due diligence | Source of wealth | EDD only: declared, with at least one verified piece of evidence | pass / action_required / not_applicable |
| 10 | Enhanced due diligence | Source of funds | Every origin account verified; traced amount within 1% of the transaction; third parties explained (`thirdPartyExplanation`); cash origin documented | pass / action_required / not_applicable |
| 11 | Finalisation | Transaction monitoring | TTR for cash of AUD 10,000 or more (10 business days); IFTI where the sector lodges them; structuring, PEP and high-risk alerts routed to the right queue | pass / routed |
| 12 | Finalisation | SMR deadline | Suspicion formed: due in 24 hours (terrorism financing) or 3 business days (other). `formedAt` is required; the clock never starts at "now". High-risk cases need a recorded suspicion decision | pass / action_required / fail |
| 13 | Finalisation | Archive and audit log | Retention set to 7 years after the later of record creation and relationship end (provisional while the relationship is ongoing); audit hash chain verifies | pass / fail |

### Case states

```
                ┌─ enrolment blocked ─────────────► BLOCKED_ENROLMENT
 case opened ───┼─ confirmed sanctions match ─────► BLOCKED_SANCTIONS
                ├─ program or screening gap ──────► ON_HOLD_PRESCREEN
                ├─ CDD gap (checkpoints 4–7) ─────► ON_HOLD_CDD
                ├─ EDD gap or officer approval ───► ON_HOLD_EDD
                └─ all clear ─────────────────────► APPROVED_MONITORING
```

States are evaluated in that order, so the most serious blocker wins. Each state change is written to the audit log.

### Tipping-off barrier (AML/CTF Act s 123)

1. **One gate for every view.** `projectForAudience(case, role)`:
   - `amlco` and `compliance_analyst`: the full record.
   - `frontline` and `customer`: exactly three fields, `caseId`, `status` and `documentsRequested`.
2. **Status text is the same for every case.** Customers and front-line staff see only "being processed" or "has been processed", whether the case is blocked, on hold, or has an SMR.
3. **Forbidden-term check.** `assertNeutral` throws if a non-restricted view contains any of: smr, suspicion, PEP, sanction, risk, EDD, enhanced, escalation, alert, AUSTRAC, report, investigation, monitor, structuring, blocked, hold.
4. **Notification gate.** `gateNotification` refuses any message to a customer or front-line staff member containing those terms.
5. **Held requests.** Once a suspicion is formed, new document requests reach the customer only after the compliance officer releases them.
6. **Restricted audit entries.** Entries are restricted by default. `audit.view(role)` gives customers nothing and front-line staff only the neutral `case_opened` entry. Case state, risk, alert and SMR entries are restricted.

---

## 2. Test loop verification report

Each scenario was run through all 13 checkpoints three times in a row inside one test, and the three results were compared byte for byte, including the audit log hashes. The whole suite was then run three times.

### Scenario 1: corporate trust buying commercial property (real estate), 30% owner is a domestic PEP

| Checkpoint | Run 1 | Run 2 | Run 3 | Notes |
|---|---|---|---|---|
| 1 Enrolment | pass | pass | pass | |
| 2 Sign-off | pass | pass | pass | EDD approved by the compliance officer |
| 3 Screening | pass | pass | pass | PEP recorded: Alex Morgan (domestic) |
| 4 Identity | pass | pass | pass | All three beneficial owners verified |
| 5 Entity and trust | pass | pass | pass | ASIC extract for the corporate trustee; deed sighted |
| 6 Beneficial ownership | pass | pass | pass | 30% / 40% / 30%, all at or above 25% |
| 7 Profile | pass | pass | pass | |
| 8 Escalation | escalated | escalated | escalated | Score 5, high: trust buyer +1, price over AUD 5m +1, domestic PEP +2, trust structure +1 |
| 9 Source of wealth | pass | pass | pass | Audited financials |
| 10 Source of funds | pass | pass | pass | AUD 850,000 deposit from the customer's own Australian account |
| 11 Monitoring | routed | routed | routed | PEP relationship and high-risk alerts to the compliance officer |
| 12 SMR | pass | pass | pass | Officer recorded no suspicion |
| 13 Archive | pass | pass | pass | Retain until at least 2033-11-03 (relationship ongoing); chain intact |

**Outcome:** `APPROVED_MONITORING` in all three runs. The customer sees "has been processed". A variant without the officer's EDD approval correctly stops at `ON_HOLD_EDD`.

### Scenario 2: accounting firm forming an offshore shelf company (professional services)

Assumption: "out-of-state bank wires" was read as wires from accounts outside the client's home jurisdiction. Here, one from the client's own account in Singapore and one from a third-party company's account in Hong Kong. Wires between Australian states alone would not add risk in this engine.

| Checkpoint | Run 1 | Run 2 | Run 3 | Notes |
|---|---|---|---|---|
| 1 Enrolment | pass | pass | pass | |
| 2 Sign-off | action required | action required | action required | EDD approval outstanding |
| 3 Screening | pass | pass | pass | |
| 4 Identity | pass | pass | pass | Passport plus independent electronic check |
| 5 Entity and trust | not applicable | not applicable | not applicable | Customer is an individual |
| 6 Beneficial ownership | not applicable | not applicable | not applicable | |
| 7 Profile | pass | pass | pass | Formation is a designated service |
| 8 Escalation | escalated | escalated | escalated | Score 7, high: offshore formation +2, British Virgin Islands +2, third-party funds +2, foreign funds +1 |
| 9 Source of wealth | action required | action required | action required | Declared, but no evidence |
| 10 Source of funds | action required | action required | action required | Hong Kong account unverified; third party unexplained |
| 11 Monitoring | routed | routed | routed | High-risk alert to the compliance officer. No IFTI: the firm doesn't send or receive the transfer itself |
| 12 SMR | action required | action required | action required | Officer must record a suspicion decision (added after defect 2 below) |
| 13 Archive | pass | pass | pass | |

**Outcome:** `ON_HOLD_EDD` in all three runs. The customer sees "being processed", with neutral requests for wealth evidence and a bank statement.

### Scenario 3: retail cash bullion purchase over AUD 10,000 (bullion dealer)

The fixture includes two earlier cash purchases of AUD 9,500 and AUD 9,800 within the week. The compliance officer has formed a suspicion that is not terrorism financing.

| Checkpoint | Run 1 | Run 2 | Run 3 | Notes |
|---|---|---|---|---|
| 1 Enrolment | pass | pass | pass | |
| 2 Sign-off | action required | action required | action required | EDD approval outstanding |
| 3 Screening | pass | pass | pass | |
| 4 Identity | pass | pass | pass | |
| 5–6 | not applicable | not applicable | not applicable | Individual |
| 7 Profile | pass | pass | pass | |
| 8 Escalation | escalated | escalated | escalated | Score 5, high: cash over AUD 10,000 +2, structuring pattern +3 |
| 9 Source of wealth | action required | action required | action required | No evidence |
| 10 Source of funds | action required | action required | action required | AUD 48,000 cash with no documented origin |
| 11 Monitoring | routed | routed | routed | TTR due 17 Nov 2026; structuring and high-risk alerts to the compliance officer |
| 12 SMR | action required | action required | action required | Due 6 Nov 2026, end of day Melbourne time (3 business days). Tipping-off controls active |
| 13 Archive | pass | pass | pass | |

**Outcome:** `ON_HOLD_EDD` in all three runs. The customer sees "being processed" with **no** document requests, because requests are held until the compliance officer releases them.

### Defects found and fixed

All three runs of each scenario matched on the first pass. Reviewing for cases the scenarios didn't cover found three real defects. Each one now has a test that failed before the fix.

| # | Defect | Effect before the fix | Fix |
|---|---|---|---|
| 1 | Business days counted on the UTC calendar | A suspicion formed at 10:00 Tuesday in Melbourne (Monday in UTC) got an SMR deadline one business day early, at the wrong hour | `addBusinessDays` counts days on the Australia/Melbourne calendar and ends at 23:59:59 local time. Test: "Business-day deadlines count Melbourne local days" |
| 2 | High-risk cases without a structuring, sanctions or FATF signal never asked the officer to decide on suspicion | Scenario 2 passed checkpoint 12 with no decision on record | High risk now counts as a red flag needing a recorded decision |
| 3 | Automatic document requests reached the customer after a suspicion was formed | Requests sent without review could alert the customer | Held until the compliance officer releases them. Test: "document requests are held" |

### Defects found in review of the uploaded version, and fixed

| # | Defect | Effect before the fix | Fix and test |
|---|---|---|---|
| 4 | The audit log exposed its internal array (`_entries`) | Any caller could edit, insert or delete entries | Entries are deep-frozen and private; `export()` returns a frozen copy; `verifyChain()` checks persisted copies, and head/length anchors catch truncation |
| 5 | The `state_set` audit entry was non-restricted | `audit.view` showed front-line staff states such as `BLOCKED_SANCTIONS` (tipping-off leak) | Entries restricted by default; `view(role)` gives customers nothing |
| 6 | Unconfirmed sanctions matches were ignored | A possible DFAT match passed screening unreviewed | Holds the case at `ON_HOLD_PRESCREEN` until confirmed or cleared |
| 7 | No ownership look-through | Individuals behind a holding company were never identified, verified or screened | `lookThroughOwners` multiplies percentages through each layer and aggregates per person |
| 8 | An explained third-party payment always failed checkpoint 10 | Legitimate family-company funding could never pass | Passes when explained and verified; still adds risk weight |
| 9 | A suspicion without `formedAt` used "now" | The SMR deadline moved every time the case was re-run | Checkpoint 12 fails until `formedAt` is recorded |
| 10 | Deadlines compared as strings | `…59Z` and `…59.000Z` compared wrongly | Compared as instants |
| 11 | EDD approval not checked for who or when | Anyone, or a future-dated approval, satisfied it | Must be the officer on record, dated no later than now |
| 12 | Exemption rules unused, mostly `() => false`; few conditional questions | Advice-only and other out-of-scope work ran full CDD and could be blocked for enrolment | Every sector has an exemption rule and conditional questions; exempt cases run only checkpoints 3, 7 and 13 |
| 13 | Remittance and virtual asset registration not checked | An enrolled but unregistered remitter passed checkpoint 1 | `REGISTRATION_REQUIRED` in config |

**Final result:** 27 engine tests (plus 9 for the readiness assessor), all passing in each of three consecutive full runs. Each scenario runs through all 13 checkpoints three times, and the three runs must be identical, including the audit hashes. `node scripts/aml-test-report.mjs` prints the checkpoint-by-checkpoint table.

---

## 3. Technical architecture

### Entities

```
ReportingEntity 1───* Case *───1 Customer 1───* Owner
      │                │  │                      
      │                │  └──* Transaction        
      │                ├──1 Screening (subjects, sanctions, PEP matches)
      │                ├──1 SourceOfWealth 1──* Evidence
      │                ├──1 SourceOfFunds  1──* OriginAccount
      │                ├──0..1 Suspicion ──0..1 SMR
      │                ├──* Alert
      │                ├──* TTR
      │                └──1 AuditLog 1──* AuditEntry (hash-chained)
      └──1 Program (AMLCO, approval date)
```

### Data model (fields the engine reads and writes)

**ReportingEntity**

| Field | Type | Rule |
|---|---|---|
| name | string | required |
| sector | enum of 9 | required; selects questionnaire and rules |
| austracEnrolment.status | `enrolled` / `pending` / `none` | must be `enrolled` (CP1) |
| austracEnrolment.enrolmentNumber | string | required when enrolled |
| austracEnrolment.sectorsRegistered | sector[] | must include `sector` |
| registration.status | `registered` / other | required for remittance and virtual assets (CP1) |
| program.amlcoAppointed, amlcoName | boolean, string | required (CP2) |
| program.approvedAt | ISO datetime | within 12 calendar months, not in the future (CP2) |

**Customer**

| Field | Type | Rule |
|---|---|---|
| type | `individual` / `company` / `trust` | required |
| countryOfResidence | ISO alpha-2 | used for jurisdiction risk |
| individual.fullName, dob, address | string | required for individuals (CP4) |
| individual.idSources[] | {type, verified, independent} | at least 2 verified, at least 1 independent |
| individual.pep | {category: none/domestic/foreign/international_organisation, role} | feeds CP3 and CP8 |
| entity.name, jurisdiction, registrationNumber | string | CP5 |
| entity.registryExtract | {source, status, fetchedAt} | status must be `registered` |
| entity.trustType, trustDeedSighted, trustees[] | string, boolean, {name, verified, type, registryExtract, registrationNumber}[] | trusts (CP5); a `type: 'company'` trustee needs its own registry extract |
| owners[] | {name, ownershipPct, control, isEntity, owners[], identityVerified, pep, countryOfResidence} | 25% or control test; `isEntity` holders looked through via their own `owners[]` (CP6) |

**Case inputs**

| Field | Type | Used by |
|---|---|---|
| screening.screenedSubjects | string[] | CP3 completeness |
| screening.sanctionsMatches | {subject, list, confirmed, cleared}[] | CP3: block when confirmed; hold until confirmed or cleared |
| screening.pepMatches | {subject, category, role}[] | CP3, CP8 |
| sectorAnswers | object, per sector | CP7, sector risk rules |
| profile.natureOfBusiness, purposeOfRelationship, expectedActivity | string | CP7 |
| sourceOfWealth.declared, evidence[] | string, {type, verified}[] | CP9 |
| sourceOfFunds.amountAud, cashAud, cashOriginExplained, originAccounts[] | number, number, boolean, {institution, country, holderIsCustomer, holderName, thirdPartyExplanation, amountAud, verified}[] | CP10 |
| transactions[] | {at, amountAud, cash, international} | CP11, structuring |
| amlcoSignoff.edd | {approved, by, at} | CP2 for EDD cases |
| suspicion | {formed, formedAt, terrorismFinancing, grounds[], submittedAt, assessedNoSuspicion} | CP12 (restricted) |
| amlcoReleasedRequests | string[] | held requests after suspicion |
| relationshipEndedAt | ISO datetime | CP13 retention anchor |
| now, holidays | ISO datetime, local YYYY-MM-DD[] | deterministic dates |

**Outputs (internal record)**

| Field | Contents |
|---|---|
| state | one of the six case states |
| risk | level, score, eddRequired, factors[] |
| checkpoints[13] | id, phase, name, status, findings[], restricted, plus extras (beneficialOwners, designatedService, riskLevel, retainUntil) |
| alerts[] | type, severity, queue, dueBy |
| reports.ttr[] | transactionAt, amountAud, dueBy, status |
| reports.smr | formedAt, terrorismFinancing, dueBy, submittedAt, grounds |
| documentsToCollect[], releasedRequests | neutral request text |
| designatedService | false when the sector exemption applies |
| retainUntil, retention | ISO datetime; {retainUntil, provisional, basis} |
| auditAnchor | {head, length} to store outside the log, so truncation is detectable |
| audit | append-only log: append(), verify(anchors), export(), view(role) |

### Alert routing

| Alert | Trigger | Queue | Deadline |
|---|---|---|---|
| TTR_REQUIRED | Physical cash of AUD 10,000 or more | reporting | 10 business days |
| IFTI_REQUIRED | International transfer, financial services or remittance only | reporting | 10 business days |
| STRUCTURING_PATTERN | 2 or more cash amounts between AUD 8,000 and 9,999 within 7 days | amlco | none (feeds suspicion decision) |
| PEP_RELATIONSHIP | Any PEP | amlco if EDD, otherwise analyst | none |
| HIGH_RISK_CUSTOMER | Risk level high | amlco | none |

### Risk scoring

- **Score:** the sum of factor weights. 0–1 is low, 2–3 medium, 4 or more high. Any FATF call-for-action jurisdiction makes the case high regardless of score.
- **EDD:** applies when the level is high, there is a foreign or international-organisation PEP, there is a domestic PEP in a medium or high case, or there is a FATF call-for-action jurisdiction.

### Audit log

- Each entry has `seq`, `at`, `actor`, `action`, `checkpoint`, `detail`, `restricted`, `prevHash` and `hash`, where `hash` is SHA-256 over a stable serialisation of the entry, including `prevHash`.
- Entries are deep-frozen when written and the internal list is never exposed. `verify()` and `verifyChain(entries, {expectedHead, expectedLength})` recompute the chain and report the first broken entry; the anchors catch deletion of the newest entries.
- In production, write entries to WORM storage (for example, object storage with a compliance-mode retention lock) set to `retainUntil`.

---

## Items to confirm before production

1. **Tranche 2 dates and scope.** The 2024 amendments bring lawyers, accountants, conveyancers, real estate, trust and company service providers, and dealers in precious metals and stones into the regime. Confirm the commencement dates and the exact designated services.
2. **Gaming venues.** Venues with 15 or fewer machines are treated as exempt below AUD 10,000 cash. Confirm the current reduced-obligation rules.
2a. **Exemptions and registration.** Confirm every `designatedServiceExempt` rule in `sectors.js` and the schemes in `REGISTRATION_REQUIRED`.
3. **FATF and firm lists.** Review `HIGH_RISK_JURISDICTIONS` after every FATF plenary, and set `ELEVATED_RISK_JURISDICTIONS` from the firm's own risk assessment.
4. **Public holidays.** Load the calendar for each office's state. The fixture uses Victoria.
5. **Integrations.** The engine reads screening results, ASIC extracts and electronic verification outcomes as inputs. Calling the providers (screening vendor, ASIC, a document verification service) is a separate adapter layer, not included here.
6. **Sanctions matches.** A confirmed match blocks the case. Freezing assets and reporting to DFAT are separate obligations from AUSTRAC reporting.
