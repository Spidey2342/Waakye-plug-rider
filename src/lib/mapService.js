const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';
// v2: positive hits only in the permanent map; failures live in a separate
// negative map with a short TTL so a transient Nominatim miss can recover.
const GEOCODE_CACHE_KEY = 'waakye_geocode_cache_v2';
const GEOCODE_NEG_CACHE_KEY = 'waakye_geocode_neg_cache_v2';
const NEG_CACHE_TTL_MS = 15 * 60 * 1000;

// Roughly covers Ghana (west, south, east, north). Used both as a country
// filter and a bounding box so a bare address like "ho" or "tema" matches
// the Ghanaian town instead of a same-named place somewhere else in the
// world (this previously sent riders to "Ho, France" and similar).
const GHANA_VIEWBOX = '-3.262,4.5,1.199,11.173';

const NOMINATIM_HEADERS = {
  Accept: 'application/json',
  'Accept-Language': 'en',
  // Nominatim usage policy requires a valid identifying User-Agent.
  'User-Agent': 'WaakyePlugRider/1.0 (rider-app; contact: support@waakyeplug.app)',
};

function readCache(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

function writeCache(key, cache) {
  try {
    localStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable — caching is a speed optimization,
    // not something worth failing the whole flow over.
  }
}

function cacheKey(address, bias) {
  const a = (address || '').trim().toLowerCase();
  const b = (bias || '').trim().toLowerCase();
  return b ? `${a}|bias:${b}` : a;
}

function readPositive(key) {
  const cache = readCache(GEOCODE_CACHE_KEY);
  return cache[key] || null;
}

function writePositive(key, coords) {
  const cache = readCache(GEOCODE_CACHE_KEY);
  cache[key] = coords;
  writeCache(GEOCODE_CACHE_KEY, cache);
}

function readNegative(key) {
  const cache = readCache(GEOCODE_NEG_CACHE_KEY);
  const entry = cache[key];
  if (!entry || typeof entry.expiresAt !== 'number') return false;
  if (Date.now() > entry.expiresAt) {
    delete cache[key];
    writeCache(GEOCODE_NEG_CACHE_KEY, cache);
    return false;
  }
  return true;
}

function writeNegative(key) {
  const cache = readCache(GEOCODE_NEG_CACHE_KEY);
  cache[key] = { expiresAt: Date.now() + NEG_CACHE_TTL_MS };
  writeCache(GEOCODE_NEG_CACHE_KEY, cache);
}

async function nominatimSearch(query, { bounded } = {}) {
  let url =
    `${NOMINATIM_BASE}?format=json&q=${encodeURIComponent(query)}` +
    `&limit=1&countrycodes=gh`;
  if (bounded) {
    url += `&viewbox=${GHANA_VIEWBOX}&bounded=1`;
  }
  const res = await fetch(url, { headers: NOMINATIM_HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data || data.length === 0) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/**
 * Geocode a plain address via Nominatim, Ghana-biased.
 *
 * @param {string} address
 * @param {{ bias?: string }} [opts] optional locality string (e.g. vendor.location)
 *   appended on ladder steps 2+ to help resolve short delivery addresses.
 * @returns {Promise<{lat:number,lng:number}|null>}
 *
 * Query ladder (stop on first hit):
 *   1. raw address
 *   2. address + bias (if provided and different)
 *   3. address + "Ghana"
 * For each query, try bounded=1 (strict Ghana viewbox) then countrycodes=gh
 * without bounded (wider, still Ghana-tagged).
 */
export async function geocodeAddress(address, opts = {}) {
  const raw = (address || '').trim();
  if (!raw) return null;

  const bias = (opts.bias || '').trim();
  const key = cacheKey(raw, bias);

  const hit = readPositive(key);
  if (hit) return hit;
  if (readNegative(key)) return null;

  const queries = [raw];
  if (bias && bias.toLowerCase() !== raw.toLowerCase()) {
    queries.push(`${raw}, ${bias}`);
  }
  const withGhana = /ghana/i.test(raw) ? null : `${raw}, Ghana`;
  if (withGhana && !queries.some((q) => q.toLowerCase() === withGhana.toLowerCase())) {
    queries.push(withGhana);
  }

  for (const query of queries) {
    for (const bounded of [true, false]) {
      try {
        const coords = await nominatimSearch(query, { bounded });
        if (coords) {
          writePositive(key, coords);
          return coords;
        }
      } catch {
        // Network / parse failure on this attempt — try the next ladder step.
      }
    }
  }

  writeNegative(key);
  return null;
}

// Real driving route + turn-by-turn steps between two points, using OSRM's
// free public demo server. Good enough for MVP volume; can be self-hosted
// later if order volume grows large enough to need it.
export async function getRoute(from, to) {
  const url = `${OSRM_BASE}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  const data = await res.json();
  if (!data.routes || data.routes.length === 0) return null;

  const route = data.routes[0];
  const coordinates = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
  const steps = route.legs.flatMap((leg) =>
    leg.steps
      .filter((step) => step.distance > 0)
      .map((step) => ({
        instruction: formatInstruction(step),
        distance: Math.round(step.distance),
        location: { lat: step.maneuver.location[1], lng: step.maneuver.location[0] },
      }))
  );

  return { coordinates, steps, durationSec: route.duration, distanceM: route.distance };
}

function formatInstruction(step) {
  const { type, modifier } = step.maneuver;
  const name = step.name || 'the road ahead';
  if (type === 'arrive') return 'You have arrived';
  if (type === 'depart') return `Head out on ${name}`;
  if (modifier) return `Turn ${modifier} onto ${name}`;
  return `Continue on ${name}`;
}

// Straight-line distance in meters between two lat/lng points.
export function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Speaks a turn instruction out loud using the browser's built-in voice —
// free, no API key, works offline once the page has loaded.
export function speak(text) {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}
