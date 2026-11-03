// Deterministic date helpers. All times are UTC ISO strings; the caller passes
// "now" so runs are reproducible.

const DAY_MS = 86400000;

/** Throws unless the value is a parseable ISO date-time. */
export function assertInstant(iso, label = 'timestamp') {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) throw new TypeError(`${label} must be an ISO date-time string (got ${iso})`);
  return iso;
}

/** Compares instants numerically, so "…Z" and "…000Z" forms compare correctly. */
export function isAfter(aIso, bIso) {
  return Date.parse(aIso) > Date.parse(bIso);
}

export function addMonths(iso, months) {
  const d = new Date(iso);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString();
}

export function addHours(iso, hours) {
  return new Date(Date.parse(iso) + hours * 3600000).toISOString();
}

export function addDays(iso, days) {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

export function addYears(iso, years) {
  const d = new Date(iso);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d.toISOString();
}

// Business days are counted on the reporting entity's local calendar.
export const DEFAULT_TIME_ZONE = 'Australia/Melbourne';

function localDate(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

// Offset of the time zone from UTC, in minutes, at the given instant.
function offsetMinutes(instantMs, timeZone) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(new Date(instantMs)).find((p) => p.type === 'timeZoneName').value;
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

// 23:59:59 local time on the given calendar date, as a UTC ISO string.
function endOfLocalDay({ y, m, d }, timeZone) {
  const naive = Date.UTC(y, m - 1, d, 23, 59, 59);
  const offset = offsetMinutes(naive - offsetMinutes(naive, timeZone) * 60000, timeZone);
  return new Date(naive - offset * 60000).toISOString();
}

/**
 * Adds business days on the local calendar, skipping weekends and the given
 * public holidays (local YYYY-MM-DD). The day the event happens is day zero.
 * The deadline is the end of the final business day, local time.
 */
export function addBusinessDays(iso, days, holidays = [], timeZone = DEFAULT_TIME_ZONE) {
  assertInstant(iso, 'Business-day start');
  for (const h of holidays) if (!/^\d{4}-\d{2}-\d{2}$/.test(h)) throw new TypeError(`Holiday must be a local YYYY-MM-DD date (got ${h})`);
  const start = localDate(iso, timeZone);
  const cursor = new Date(Date.UTC(start.y, start.m - 1, start.d, 12));
  let added = 0;
  while (added < days) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const dow = cursor.getUTCDay();
    const key = cursor.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.includes(key)) added += 1;
  }
  return endOfLocalDay({ y: cursor.getUTCFullYear(), m: cursor.getUTCMonth() + 1, d: cursor.getUTCDate() }, timeZone);
}

export function daysBetween(fromIso, toIso) {
  return (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
}
