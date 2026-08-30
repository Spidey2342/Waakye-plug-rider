// A rider gets locked once it's past this hour (24h format) AND they still
// owe commission. Adjust to whenever your delivery day actually ends.
const CUTOFF_HOUR = 12; // 8 PM

export function shouldLockForSettlement(commissionOwed) {
  if (!commissionOwed || commissionOwed <= 0) return false;
  return new Date().getHours() >= CUTOFF_HOUR;
}