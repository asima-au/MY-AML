// Checkpoint 13: append-only, hash-chained audit log with 7-year retention.
// Each entry includes the hash of the previous entry, so any edit or deletion
// breaks verification. Entries are frozen on write.

import { createHash } from 'node:crypto';
import { REGULATORY_PARAMS } from './config.js';
import { addYears } from './dates.js';

const GENESIS = '0'.repeat(64);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function createAuditLog() {
  const entries = [];

  function append({ at, actor, action, checkpoint = null, detail = {}, restricted = false }) {
    const prevHash = entries.length ? entries[entries.length - 1].hash : GENESIS;
    const body = { seq: entries.length + 1, at, actor, action, checkpoint, detail, restricted, prevHash };
    const hash = createHash('sha256').update(stableStringify(body)).digest('hex');
    const entry = Object.freeze({ ...body, detail: Object.freeze({ ...detail }), hash });
    entries.push(entry);
    return entry;
  }

  function verify() {
    let prev = GENESIS;
    for (const e of entries) {
      const { hash, ...body } = e;
      if (body.prevHash !== prev) return { ok: false, brokenAt: e.seq, reason: 'chain link mismatch' };
      const expected = createHash('sha256').update(stableStringify(body)).digest('hex');
      if (expected !== hash) return { ok: false, brokenAt: e.seq, reason: 'entry content changed' };
      prev = hash;
    }
    return { ok: true, length: entries.length, head: prev };
  }

  /** Restricted entries are visible only to roles with restricted access. */
  function view({ restrictedAccess }) {
    return entries.filter((e) => restrictedAccess || !e.restricted);
  }

  return { append, verify, view, get length() { return entries.length; }, _entries: entries };
}

/**
 * Retention: keep records for 7 years after the later of record creation and
 * the end of the business relationship.
 */
export function retentionUntil({ createdAt, relationshipEndedAt = null }) {
  const anchor = relationshipEndedAt && relationshipEndedAt > createdAt ? relationshipEndedAt : createdAt;
  return addYears(anchor, REGULATORY_PARAMS.recordRetentionYears);
}
