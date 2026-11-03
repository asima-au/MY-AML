// Tipping-off barrier. The only way any audience sees a case is through
// projectForAudience. Restricted roles get the full record; everyone else
// gets an allow-listed, neutral view that is identical in shape for every
// case, whatever its risk, alerts or reports.

import { ROLES, NEUTRAL_STATUS } from './config.js';

// Words that must never reach a customer or front-line staff member.
export const FORBIDDEN_TERMS = Object.freeze([
  'smr', 'suspicio', 'pep', 'politically', 'sanction', 'risk', 'edd', 'enhanced',
  'escalat', 'alert', 'austrac', 'report', 'investigat', 'monitor', 'structur', 'blocked', 'hold',
]);

export function projectForAudience(caseRecord, role) {
  const r = ROLES[role];
  if (!r) throw new Error(`Unknown role: ${role}`);

  if (r.restrictedAccess) {
    return {
      caseId: caseRecord.caseId,
      sector: caseRecord.sector,
      state: caseRecord.state,
      risk: caseRecord.risk,
      checkpoints: caseRecord.checkpoints,
      alerts: caseRecord.alerts,
      reports: caseRecord.reports,
      documentsToCollect: caseRecord.documentsToCollect,
      retainUntil: caseRecord.retainUntil,
      auditTrail: caseRecord.audit.view({ restrictedAccess: true }),
    };
  }

  const open = caseRecord.state !== 'APPROVED_MONITORING';
  // With a suspicion on file, only requests the compliance officer released are shown.
  const requests = caseRecord.releasedRequests ?? caseRecord.documentsToCollect;
  const view = {
    caseId: caseRecord.caseId,
    status: open ? NEUTRAL_STATUS.open : NEUTRAL_STATUS.complete,
    documentsRequested: requests.map(neutralise),
  };
  assertNeutral(view);
  return view;
}

// Document requests are already written in neutral language; this strips any
// term that would slip through if a future rule added one.
function neutralise(text) {
  return FORBIDDEN_TERMS.some((t) => text.toLowerCase().includes(t)) ? 'Supporting documents' : text;
}

/** Throws if any forbidden term appears anywhere in a non-restricted view. */
export function assertNeutral(view) {
  const text = JSON.stringify(view).toLowerCase();
  const leaked = FORBIDDEN_TERMS.filter((t) => text.includes(t));
  if (leaked.length) throw new Error(`Tipping-off barrier: restricted terms in a non-restricted view: ${leaked.join(', ')}`);
}

/**
 * Notification gate. Any message to a customer or non-restricted staff member
 * passes through here; restricted content is refused.
 */
export function gateNotification({ audienceRole, text }) {
  const r = ROLES[audienceRole];
  if (!r) throw new Error(`Unknown role: ${audienceRole}`);
  if (r.restrictedAccess) return { allowed: true, text };
  const lower = text.toLowerCase();
  const leaked = FORBIDDEN_TERMS.filter((t) => lower.includes(t));
  return leaked.length ? { allowed: false, reason: 'restricted content', leaked } : { allowed: true, text };
}
