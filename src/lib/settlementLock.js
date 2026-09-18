const CUTOFF_HOUR = 12;
const ACCRA_TZ = 'Africa/Accra';

/** Calendar Y-M-D + hour in Africa/Accra (UTC+0, no DST). */
function accraParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ACCRA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
  };
}

/** Accra local calendar day as YYYY-MM-DD for comparisons. */
function accraDayKey(date = new Date()) {
  const { year, month, day } = accraParts(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Instant of today's Accra noon (12:00) as a Date.
 * Accra is always UTC+0, so noon Accra == 12:00Z on that calendar day.
 */
export function todaysAccraCutoff(now = new Date()) {
  const { year, month, day } = accraParts(now);
  return new Date(Date.UTC(year, month - 1, day, CUTOFF_HOUR, 0, 0, 0));
}

/** Whether the current instant is at or after today's Accra noon cutoff. */
export function isPastAccraCutoff(now = new Date()) {
  return accraParts(now).hour >= CUTOFF_HOUR;
}

/**
 * Lock the rider to Settle Up after Accra noon when they still owe
 * commission and have not settled since today's Accra cutoff.
 */
export function shouldLockForSettlement(commissionOwed, lastSettledAt, now = new Date()) {
  if (!commissionOwed || commissionOwed <= 0) return false;

  if (!isPastAccraCutoff(now)) return false;

  const cutoff = todaysAccraCutoff(now);

  if (lastSettledAt) {
    const lastSettled = new Date(lastSettledAt);
    if (lastSettled >= cutoff) return false;
  }

  return true;
}

// Exported for tests / callers that want the Accra day key.
export { accraDayKey, ACCRA_TZ, CUTOFF_HOUR };
