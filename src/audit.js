// Checkpoint 13: append-only, hash-chained audit log with 7-year retention.
// Each entry includes the hash of the previous entry, so any edit, reorder or
// deletion breaks verification. Entries are deep-frozen on write and the
// internal list is never handed out, so the only way to change the log is
// append(). Persisted copies are checked with verifyChain().

import { createHash } from 'node:crypto';
import { REGULATORY_PARAMS, ROLES } from './config.js';
import { addYears } from './dates.js';

export const GENESIS_HASH = '0'.repeat(64);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).filter((k) => value[k] !== undefined).sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value)) deepFreeze(value[k]);
  }
  return value;
}

function hashOf(body) {
  return createHash('sha256').update(stableStringify(body)).digest('hex');
}

/**
 * Verifies a list of entries (live or persisted). Optional anchors detect
 * truncation: pass the head hash and length recorded elsewhere (for example
 * on the case record or in WORM storage).
 */
export function verifyChain(entries, { expectedHead, expectedLength } = {}) {
  let prev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    const { hash, ...body } = e;
    if (body.seq !== i + 1) return { ok: false, brokenAt: i + 1, reason: 'sequence gap or reordering' };
    if (body.prevHash !== prev) return { ok: false, brokenAt: body.seq, reason: 'chain link mismatch' };
    if (hashOf(body) !== hash) return { ok: false, brokenAt: body.seq, reason: 'entry content changed' };
    prev = hash;
  }
  if (expectedLength !== undefined && entries.length !== expectedLength) {
    return { ok: false, brokenAt: Math.min(entries.length, expectedLength) + 1, reason: `expected ${expectedLength} entries, found ${entries.length}` };
  }
  if (expectedHead !== undefined && prev !== expectedHead) {
    return { ok: false, brokenAt: entries.length, reason: 'head hash does not match the recorded anchor' };
  }
  return { ok: true, length: entries.length, head: prev };
}

export function createAuditLog() {
  const entries = [];

  function append({ at, actor, action, checkpoint = null, detail = {}, restricted = true }) {
    if (!at || Number.isNaN(Date.parse(at))) throw new TypeError(`Audit entry needs a valid "at" timestamp (got ${at})`);
    const prevHash = entries.length ? entries[entries.length - 1].hash : GENESIS_HASH;
    const body = { seq: entries.length + 1, at, actor, action, checkpoint, detail: structuredClone(detail), restricted, prevHash };
    const entry = deepFreeze({ ...body, hash: hashOf(body) });
    entries.push(entry);
    return entry;
  }

  /**
   * Role-filtered view. Restricted roles see every entry. Front-line staff see
   * only entries written as non-restricted. Customers see none.
   */
  function view(role) {
    const r = ROLES[role];
    if (!r) throw new Error(`Unknown role: ${role}`);
    if (r.restrictedAccess) return Object.freeze(entries.slice());
    if (role === 'customer') return Object.freeze([]);
    return Object.freeze(entries.filter((e) => !e.restricted));
  }

  return Object.freeze({
    append,
    view,
    verify: (anchors) => verifyChain(entries, anchors),
    /** A frozen copy for persistence or export. Entries are already frozen. */
    export: () => Object.freeze(entries.slice()),
    get length() { return entries.length; },
    get head() { return entries.length ? entries[entries.length - 1].hash : GENESIS_HASH; },
  });
}

/**
 * Retention: keep records for 7 years after the later of record creation and
 * the end of the business relationship. While the relationship is ongoing the
 * date is a floor only (`provisional: true`) and must be recalculated when the
 * relationship ends.
 */
export function retentionUntil({ createdAt, relationshipEndedAt = null }) {
  const anchor = relationshipEndedAt && Date.parse(relationshipEndedAt) > Date.parse(createdAt) ? relationshipEndedAt : createdAt;
  return {
    retainUntil: addYears(anchor, REGULATORY_PARAMS.recordRetentionYears),
    provisional: !relationshipEndedAt,
    basis: relationshipEndedAt
      ? `${REGULATORY_PARAMS.recordRetentionYears} years after the relationship ended`
      : `At least ${REGULATORY_PARAMS.recordRetentionYears} years after creation; recalculate when the relationship ends`,
  };
}
