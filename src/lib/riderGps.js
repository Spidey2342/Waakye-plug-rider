// Rider position comes ONLY from the device's real GPS. There is no manual
// override: live location sharing to the customer depends on it, a manually
// set pin goes stale as soon as the rider moves, and it would let a rider
// claim to be somewhere they are not. A phone that can't produce a usable
// fix is treated as a device problem the rider has to fix (or replace).

// A fix worse than this (meters) is an IP/network guess, not GPS — it can be
// off by entire cities. Same threshold the screens use for live readings.
export const UNUSABLE_ACCURACY_M = 3000;

// Fresh, high-accuracy read: never accept a cached position.
export const FRESH_GPS_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };

const GPS_HELP =
  'Turn on Location, set it to high-accuracy (Precise) mode, and allow this app to use your location. ' +
  'If your phone keeps showing the wrong location, please use a device with working GPS.';

/**
 * Plain-language explanation of why we can't use the rider's location.
 * Every message starts with "Location" so screens can recognise and clear
 * it once a good fix arrives.
 * @param {'denied'|'unavailable'|'timeout'|'inaccurate'|'unsupported'} kind
 * @param {number|null} [accuracyM]
 */
export function gpsProblemMessage(kind, accuracyM = null) {
  switch (kind) {
    case 'denied':
      return `Location permission is off. ${GPS_HELP}`;
    case 'unsupported':
      return 'Location (GPS) is not available on this device. Please use a phone with working GPS.';
    case 'inaccurate': {
      const off = accuracyM != null ? ` (about ${Math.max(1, Math.round(accuracyM / 1000))} km off)` : '';
      return `Location is too inaccurate to use${off}. ${GPS_HELP}`;
    }
    case 'timeout':
      return `Location could not be found in time. Go outdoors or near a window and try again. ${GPS_HELP}`;
    case 'unavailable':
    default:
      return `Location is unavailable right now. ${GPS_HELP}`;
  }
}

/** Map a GeolocationPositionError to a gpsProblemMessage kind. */
export function gpsErrorKind(err) {
  if (!err) return 'unavailable';
  if (err.code === 1) return 'denied'; // PERMISSION_DENIED
  if (err.code === 3) return 'timeout'; // TIMEOUT
  return 'unavailable'; // POSITION_UNAVAILABLE or unknown
}

/**
 * Ask the device for one fresh, high-accuracy GPS fix.
 * Resolves { ok: true, position: {lat, lng}, accuracy } or
 * { ok: false, kind, message }. Never rejects.
 */
export function getUsableGpsFix(options = FRESH_GPS_OPTIONS) {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      resolve({ ok: false, kind: 'unsupported', message: gpsProblemMessage('unsupported') });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const accuracy = pos.coords.accuracy ?? null;
        if (accuracy != null && accuracy > UNUSABLE_ACCURACY_M) {
          resolve({ ok: false, kind: 'inaccurate', message: gpsProblemMessage('inaccurate', accuracy) });
          return;
        }
        resolve({
          ok: true,
          position: { lat: pos.coords.latitude, lng: pos.coords.longitude },
          accuracy,
        });
      },
      (err) => {
        const kind = gpsErrorKind(err);
        resolve({ ok: false, kind, message: gpsProblemMessage(kind) });
      },
      options
    );
  });
}
