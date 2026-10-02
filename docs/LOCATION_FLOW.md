# Rider Location Flow — Enterprise Implementation

## Overview

Riders need reliable location tracking for order matching and navigation. This flow handles GPS failures gracefully with manual override capability, using only plain language in the UI.

## User Flow

### Home Screen (Available Orders)

#### Scenario 1: GPS works fine
1. Rider goes online
2. GPS locks within a few seconds
3. Order cards show real distances (e.g., "2.3 km away")
4. Location syncs to Supabase every 8 seconds
5. ✅ No rider action needed

#### Scenario 2: GPS denied or weak
1. Rider goes online
2. Banner appears: **"Set your location to see nearby orders"**
   - Sub-text explains: "Location access denied..." or "Location signal too weak..."
3. Button: **"Set my location"**
4. Taps button → LocationPicker opens

#### Scenario 3: Manual override active
1. Rider has previously set location manually
2. Banner shows: **"Using your set location"**
   - "You set this location manually"
3. Button: **"Change"** (opens LocationPicker to adjust)
4. If GPS becomes good:
   - Banner updates: "GPS now available — tap to switch back"
   - Button: **"Use current location instead"** (clears manual override)

### Active Order Screen (Navigation)

#### GPS fails during delivery
1. Map shows error: "Waiting for GPS — current reading is ~5km off..."
2. Button below: **"Set my location instead"**
3. Taps → LocationPicker opens
4. Manual position used for:
   - Route calculation
   - Turn-by-turn directions
   - Arrival detection
   - Live position sync

#### GPS recovers
1. Banner: **"Using your set location"** + "GPS now available..."
2. Button: **"Use current location instead"**
3. One tap switches back to live GPS

## LocationPicker Component

### UI Elements

**Search Bar**
- Placeholder: "Search for a place, landmark, or area..."
- Examples riders type:
  - "Ho Technical University"
  - "Volta Mall"
  - "Tema Station"
  - "Circle, Accra"
- "Go" button triggers search

**Current Location Button**
- **"Use my current location"** (with Navigation icon)
- Requests GPS permission if needed
- Shows "Getting your location..." while waiting

**Map**
- OpenStreetMap tiles
- Red teardrop pin (draggable)
- Bounds restricted to Ghana (can't accidentally pan to another continent)
- Default center: Ho (6.6008, 0.4713) — never Accra
- Zoom controls enabled

**Bottom Bar**
- Instruction: "Drag the pin to adjust your exact location"
- **"Confirm location"** button (green checkmark)

### Error Handling

**Search fails**
- "Place not found. Try a nearby landmark or city."
- Rider can:
  - Try different search term
  - Use current location button instead
  - Manually drag pin

**GPS times out**
- "Location request timed out. Try again or search for a place."
- Search still works (no GPS needed for Nominatim)

**Permission denied**
- "Location access denied. Enable location in your device settings."
- Rider can still:
  - Search for place
  - Manually position pin

## Technical Flow

### Data Flow

```
GPS watch (live) ──┐
                   ├─→ activePosition = manualPosition || riderPosition
Manual override ───┘
                   │
                   ├─→ Order card distances (HomeScreen)
                   ├─→ Route calculation (ActiveOrderScreen)
                   ├─→ Turn-by-turn navigation
                   ├─→ Supabase riders.current_lat/lng (every 8s)
                   └─→ Nearby order matching (backend uses these coords)
```

### Position Precedence

1. **Manual position set?** → Use it
2. **No manual position?** → Use live GPS
3. **Neither?** → Show prompt to set location

### GPS Quality Detection

```javascript
const UNUSABLE_ACCURACY_M = 3000;  // Network/IP guess, not GPS
const MIN_USABLE_ACCURACY_M = 400; // Weak GPS but still usable

if (accuracy > UNUSABLE_ACCURACY_M) {
  // Don't show rider marker at all — this is a city-scale guess
  // Show prompt: "Waiting for GPS..." with manual override button
}
else if (accuracy > MIN_USABLE_ACCURACY_M) {
  // Show marker but warn rider
  // "Location is approximate (±XXXm). Move to open sky..."
}
else {
  // Good GPS — use it without warnings
}
```

### Nominatim Search

- Queries: `{raw query} → {query}, {bias} → {query}, Ghana`
- Bounded to Ghana viewbox (strict first, then country code)
- Results cached in localStorage (15min negative cache for misses)
- User-Agent header: `WaakyePlugRider/1.0 (rider-app; contact: support@waakyeplug.app)`

## Why This Approach

### Product Requirements
- **GPS preferred** — riders expect "use my current location" to just work
- **Manual fallback essential** — riders operate in GPS-denied areas (inside buildings, weak signal zones)
- **No hardcoded defaults** — never silently substitute Accra when rider is in Ho
- **Plain language only** — "Set my location", not "Enter coordinates" or "Geocode address"

### Technical Constraints
- **Reuse existing stack** — Nominatim already in mapService.js
- **No new dependencies** — LocationPicker uses Leaflet (already imported)
- **Work with Supabase schema** — riders.current_lat/lng already exist
- **Respect rate limits** — Nominatim throttled via cache; Supabase syncs every 8s

### Historical Context

**Before this PR:**
- GPS fails → rider sees "Distance unavailable", no way to fix
- Weak signal (~3km accuracy) → app used it anyway, placed rider in wrong city
- Map init hardcoded HO_DEFAULT as fallback → confusing when rider is elsewhere
- No indication to rider that position was stale/inaccurate

**After this PR:**
- GPS fails → clear prompt with manual override
- Weak signal → warning + manual override option
- Manual override → explicit "Using your set location" banner
- GPS recovery → rider can switch back with one tap

## Rider-Facing Language

### ✅ Good (what we use)
- "Use my current location"
- "Search for a place, landmark, or area"
- "Set my location"
- "Drag the pin to adjust your exact location"
- "Confirm location"
- "Using your set location"
- "GPS now available — tap to switch back"

### ❌ Bad (avoid)
- "Enter coordinates"
- "Geocode address"
- "Set lat/lng"
- "GPS accuracy: 45m"
- "Manual override active"
- "Nominatim search"

### Error Messages (user-friendly)
- ✅ "Location access denied. Enable location in your device settings."
- ❌ "Geolocation permission denied (error code 1)"

- ✅ "Place not found. Try a nearby landmark or city."
- ❌ "Nominatim returned 0 results for query"

- ✅ "Location request timed out. Try again or search for a place."
- ❌ "getCurrentPosition timeout (10000ms)"

## Testing Scenarios

### Functional Tests

1. **GPS happy path**
   - Go online → GPS locks → distances show → no manual override needed

2. **GPS denied**
   - Deny location permission → prompt appears → set location manually → distances show

3. **Search**
   - Type "Ho Technical University" → tap Go → pin moves to result → drag to adjust → confirm

4. **Manual override persistence**
   - Set location → switch to another screen → return → still using set location

5. **GPS recovery**
   - Manual override active → GPS signal improves → banner offers switch → tap → uses GPS

6. **Weak GPS**
   - Indoor/weak signal → warning + manual option → rider chooses GPS or manual

### Edge Cases

1. **Search no results**
   - Type gibberish → error message → still can drag pin manually

2. **Network offline**
   - No connection → search fails → can still use GPS or drag pin on cached map tiles

3. **Goes offline**
   - Manual override active → rider goes offline → override clears on next online

4. **Multiple riders**
   - Each rider's manual override is local (not synced to other devices)
   - Supabase writes still happen (other systems see the chosen position)

## Future Enhancements (Out of Scope)

- **Save favorite locations** (home base, common pickup areas)
- **Auto-suggest recent locations** when opening picker
- **Offline map tiles** (currently requires network for tiles)
- **Address reverse geocoding** (show address for manual pin, not just coords)
- **Share location via SMS** (for rider support / coordination)

## Monitoring & Support

### Logs to Check
- `updateRiderLocation` failures (network errors)
- Nominatim search failures (quota / network)
- GPS permission denials (iOS vs Android patterns)

### Support Scenarios

**Rider: "Orders not showing up"**
→ Check: Is location set? Banner says what?
→ Action: Walk through LocationPicker flow

**Rider: "Distances are wrong"**
→ Check: Manual override active? GPS accuracy?
→ Action: Clear manual override if stale

**Rider: "Map stuck on wrong city"**
→ Was: Hardcoded Accra fallback
→ Now: Manual override stale — rider can change it themselves

## Related Files

- `src/components/LocationPicker.jsx` — modal component
- `src/components/screens/HomeScreen.jsx` — integrates picker for order list
- `src/components/screens/ActiveOrderScreen.jsx` — integrates picker for navigation
- `src/lib/mapService.js` — Nominatim geocoder (unchanged)
- `src/lib/ordersApi.js` — `updateRiderLocation()` (unchanged)
- `docs/MAP_TRACKING.md` — explains GPS accuracy thresholds (existing)
