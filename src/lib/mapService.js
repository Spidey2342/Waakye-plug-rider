const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';

// Turns a plain address string ("Labone, Opposite Zen Garden") into
// coordinates, using OpenStreetMap's free Nominatim service. No API key.
export async function geocodeAddress(address) {
  const url = `${NOMINATIM_BASE}?format=json&q=${encodeURIComponent(address)}&limit=1`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  const data = await res.json();
  if (!data || data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
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