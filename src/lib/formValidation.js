/** Ghana mobile: 10 digits starting with 0, or 12 digits starting with 233. */
export function normalizePhoneDigits(phone) {
  return String(phone ?? '').replace(/\D/g, '');
}

export function isValidGhPhone(phone) {
  const d = normalizePhoneDigits(phone);
  if (d.length === 10 && d.startsWith('0')) return true;
  if (d.length === 12 && d.startsWith('233')) return true;
  return false;
}

/** Strip to digits/plus while typing; cap length for local/international formats. */
export function restrictPhoneInput(raw) {
  const cleaned = String(raw ?? '').replace(/[^\d+\s-]/g, '');
  const digits = cleaned.replace(/\D/g, '');
  if (digits.startsWith('233')) {
    return cleaned.replace(/\s/g, '').slice(0, 15);
  }
  return cleaned.replace(/\s/g, '').slice(0, 14);
}

/** Ghana Card: GHA-123456789-0 (9 digits + 1 check digit). */
const GHANA_CARD_RE = /^GHA-\d{9}-\d$/i;

export function formatGhanaCardInput(raw) {
  let s = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');
  if (!s.startsWith('GHA')) {
    const digits = s.replace(/\D/g, '');
    if (digits.length === 0) return '';
    s = `GHA-${digits}`;
  }
  const afterPrefix = s.slice(3).replace(/^-/, '');
  const digits = afterPrefix.replace(/\D/g, '').slice(0, 10);
  if (digits.length <= 9) return `GHA-${digits}`;
  return `GHA-${digits.slice(0, 9)}-${digits.slice(9)}`;
}

export function isValidGhanaCard(value) {
  return GHANA_CARD_RE.test(String(value ?? '').trim());
}

/** Matches reset-pin edge function weak-PIN rules. */
export function isWeakPin(pin) {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin)) return true;
  return false;
}

export function restrictPersonNameInput(raw) {
  return String(raw ?? '')
    .replace(/[^\p{L}\p{M}\s'.-]/gu, '')
    .slice(0, 80);
}

export function restrictNotesInput(raw, maxLen = 500) {
  return String(raw ?? '').slice(0, maxLen);
}

export function restrictPinInput(raw) {
  return String(raw ?? '')
    .replace(/\D/g, '')
    .slice(0, 4);
}
