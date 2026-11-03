// Browser entry for the case engine demo. Bundled by scripts/build-engine-demo.mjs.
import { runCase, CHECKPOINTS } from '../../src/engine.js';
import { projectForAudience, gateNotification } from '../../src/projection.js';
import { verifyChain } from '../../src/audit.js';
import { SECTORS } from '../../src/sectors.js';
import { TO_CONFIRM } from '../../src/config.js';
import { scenario1, scenario2, scenario3 } from '../../test/scenarios.mjs';

const clone = (x) => structuredClone(x);

function variant(base, change) {
  const input = clone(base);
  change(input);
  return input;
}

export const DEMO_SCENARIOS = [
  { id: 'trust-property', title: 'Trust buys a commercial building', sector: 'real_estate',
    summary: 'AUD 8.5m purchase. A 30% owner is a state MP. Officer has approved EDD.', input: clone(scenario1) },
  { id: 'trust-property-pending', title: 'Same trust, before officer approval', sector: 'real_estate',
    summary: 'Identical facts, but the compliance officer has not signed off EDD yet.',
    input: variant(scenario1, (i) => { delete i.amlcoSignoff; }) },
  { id: 'offshore-shelf', title: 'Accountant forms a BVI shelf company', sector: 'professional_services',
    summary: 'High-net-worth client. Wires from Singapore and an unverified Hong Kong third party.', input: clone(scenario2) },
  { id: 'offshore-shelf-sanctions', title: 'Same client, confirmed sanctions match', sector: 'professional_services',
    summary: 'Screening confirms the client on the DFAT Consolidated List.',
    input: variant(scenario2, (i) => { i.screening.sanctionsMatches = [{ subject: 'Morgan Ellis', list: 'DFAT Consolidated List', confirmed: true }]; }) },
  { id: 'cash-bullion', title: 'AUD 48,000 of gold, paid in cash', sector: 'bullion',
    summary: 'Follows cash buys of AUD 9,500 and 9,800 that week. Suspicion formed Tuesday.', input: clone(scenario3) },
  { id: 'cash-bullion-tf', title: 'Same purchase, terrorism-financing suspicion', sector: 'bullion',
    summary: 'The suspicion relates to terrorism financing, so the SMR clock is 24 hours.',
    input: variant(scenario3, (i) => { i.suspicion.terrorismFinancing = true; }) },
];

export { runCase, CHECKPOINTS, projectForAudience, gateNotification, verifyChain, SECTORS, TO_CONFIRM };
