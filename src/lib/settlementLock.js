const CUTOFF_HOUR = 0;

export function shouldLockForSettlement(commissionOwed, lastSettledAt) {
  if (!commissionOwed || commissionOwed <= 0) return false;

  const now = new Date();
  if (now.getHours() < CUTOFF_HOUR) return false;

  const todaysCutoff = new Date();
  todaysCutoff.setHours(CUTOFF_HOUR, 0, 0, 0);

  if (lastSettledAt) {
    const lastSettled = new Date(lastSettledAt);
    if (lastSettled >= todaysCutoff) return false;
  }

  return true;
}