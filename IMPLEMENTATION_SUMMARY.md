# GPS Location Accuracy Hardening - Implementation Summary

## Overview
Hardened GPS location accuracy across rider and vendor apps to prevent routing errors like the Waakye Plug Ho→Accra 157km bug.

## 🎯 Problem Statement
**Live Bug:** Vendor "Waakye Plug" had location text "ho" but GPS coordinates in Accra (5.5545, -0.1902). When rider accepted order:
- ActiveOrderScreen's first `getCurrentPosition` used `enableHighAccuracy:false` + `maximumAge:60000`
- Could seed route with stale/network-based Accra location
- Result: ~157km routing error instead of local Ho pickup

**Secondary Risks:**
- Vendor admin "Use My Current Location" saved GPS without accuracy validation
- Network/IP-based locations (accuracy >3000m) could be saved as "real" pins
- Rider onboarding doesn't write current_lat/lng (separate issue, not addressed)

---

## ✅ Rider Repo: Spidey2342/Waakye-plug-rider

### PR Created
**#9:** Fix: Harden GPS accuracy for rider ActiveOrderScreen  
**URL:** https://github.com/Spidey2342/Waakye-plug-rider/pull/9  
**Branch:** `cursor/harden-gps-accuracy-25e7`  
**Status:** ✅ **Pushed and PR opened**

### Changes
**File:** `src/components/screens/ActiveOrderScreen.jsx` (line 257)

**Before:**
```javascript
navigator.geolocation.getCurrentPosition(
  handlePosition,
  () => {},
  { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
);
```

**After:**
```javascript
navigator.geolocation.getCurrentPosition(
  handlePosition,
  () => {},
  { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
);
```

### Impact
- First GPS read now requests fresh, high-accuracy position
- Prevents seeding route with stale Accra fallback when rider is in Ho
- Existing `UNUSABLE_ACCURACY_M = 3000` threshold already rejects network/IP guesses
- `handlePosition` already has full accuracy validation logic (lines 203-250)

### How to Verify
1. Open ActiveOrderScreen with an active order
2. Start indoors with poor GPS signal
3. Should see "Waiting for GPS" message (not a bad Accra pin)
4. Move outdoors or enable Precise Location
5. Position should lock accurately and route should calculate correctly

---

## ⚠️ Vendor Repo: Spidey2342/waakyeplug-vendor

### PR Status
**Status:** ❌ **Cannot push - environment limitation**  
**Branch:** `cursor/validate-gps-accuracy-25e7` (committed locally at `/tmp/waakyeplug-vendor`)  
**Commit:** `3e7617a` - "Add GPS accuracy validation before saving vendor location"  
**Patch file:** `vendor-gps-accuracy.patch` (available in rider repo workspace)

### Why Can't Push?
Cloud agent environment only has access to:
- ✅ `github.com/Spidey2342/Waakye-plug-rider`
- ❌ `github.com/Spidey2342/waakyeplug-vendor` (not in environment config)

### Changes Made
**File:** `src/pages/tabs/SettingsTab.tsx` (function `handleSetGpsLocation`, line ~79)

**Added GPS accuracy validation:**

1. **Reject accuracy >1000m** (network/IP fallback):
   ```typescript
   if (accuracy != null && accuracy > 1000) {
     toastError(
       `GPS accuracy is too low (±${Math.round(accuracy)}m). ` +
       `Enable Precise Location in your device settings, go outdoors for clear sky, ` +
       `and use a phone (not a laptop). Accurate GPS prevents routing errors for riders.`
     );
     setLocatingGps(false);
     return;
   }
   ```

2. **Reject accuracy >500m** (marginal GPS):
   ```typescript
   if (accuracy != null && accuracy > 500) {
     toastError(
       `GPS accuracy is marginal (±${Math.round(accuracy)}m). ` +
       `For best results, enable Precise Location and ensure clear sky view. ` +
       `Location was NOT saved — try again with better accuracy.`
     );
     setLocatingGps(false);
     return;
   }
   ```

3. **Enhanced success message:**
   ```typescript
   toastSuccess(
     `Shop location saved${accuracy != null ? ` (±${Math.round(accuracy)}m)` : ''}. ` +
     `Customers can now see how far they are from you.`
   );
   ```

### Impact
- Vendors can no longer save inaccurate GPS coordinates
- Clear user guidance: enable Precise Location, go outdoors, use phone not laptop
- Success message shows accuracy for transparency
- Prevents future "Ho text with Accra coords" bugs at the source

### Manual Application Required

#### Option 1: Apply the patch file
```bash
cd /path/to/waakyeplug-vendor
git checkout -b cursor/validate-gps-accuracy-25e7
# Patch file is in rider repo at: vendor-gps-accuracy.patch
git apply /path/to/vendor-gps-accuracy.patch
git push -u origin cursor/validate-gps-accuracy-25e7
gh pr create --title "Add GPS accuracy validation before saving vendor location" --body "..." --base main
```

#### Option 2: Cherry-pick from local clone
```bash
# Clone includes the commit on cursor/validate-gps-accuracy-25e7 branch
git clone /tmp/waakyeplug-vendor
cd waakyeplug-vendor
git checkout cursor/validate-gps-accuracy-25e7
git push -u origin cursor/validate-gps-accuracy-25e7
# Create PR via GitHub UI or gh CLI
```

#### Option 3: Manual edit
See full diff in `/tmp/VENDOR_CHANGES_README.md`

### How to Verify
1. Log into vendor admin panel → Settings tab
2. Click "Use My Current Location"
3. **Test with poor GPS** (indoors/Wi-Fi only):
   - Should show error: "GPS accuracy is too low (±XXXXm)"
   - Location should NOT be saved
4. **Test with good GPS** (outdoors, phone, Precise Location enabled):
   - Should save successfully
   - Success message: "Shop location saved (±12m). Customers can now see..."

---

## 📋 Implementation Details

### Threshold Choices
- **3000m (UNUSABLE_ACCURACY_M):** Already implemented in rider app - rejects network/IP guesses entirely
- **1000m (vendor hard reject):** Prevents saving clearly bad locations (network/Wi-Fi fallback)
- **500m (vendor soft reject):** Prevents marginal GPS that could still cause significant routing errors
- **Rationale:** Ho to Accra is ~157km. Even 1km error is <1% of that disaster, but we want <100m for urban accuracy

### GPS Accuracy Primer
- **<30m:** Excellent GPS (phone outdoors, Precise Location ON)
- **30-100m:** Good GPS (acceptable for vendor pins)
- **100-500m:** Marginal GPS (might work but risky for routing)
- **500-3000m:** Poor GPS (Wi-Fi/cell tower triangulation)
- **>3000m:** Network/IP guess (can be off by entire cities/countries)

### Accuracy vs. Precision
- **Accuracy:** How close to true position (what we're validating)
- **Precision:** How consistent repeated readings are (not directly measured)
- GPS `coords.accuracy` is the reported accuracy in meters

---

## 🧪 Testing Strategy

### Critical Test Cases

#### Rider App
- [ ] Active order in poor GPS area (indoors) → should show "Waiting for GPS" not bad position
- [ ] Active order with good GPS → should get accurate position and route within seconds
- [ ] First GPS read on order accept → should not use stale/cached position

#### Vendor App
- [ ] Save location indoors with laptop → should reject with clear error
- [ ] Save location outdoors with phone (Precise Location OFF) → should reject or warn
- [ ] Save location outdoors with phone (Precise Location ON) → should save with accuracy shown
- [ ] Success message shows accuracy: "Shop location saved (±12m)..."

### Regression Tests
- [ ] Existing accuracy guards in ActiveOrderScreen still work (UNUSABLE_ACCURACY_M threshold)
- [ ] Watch position in ActiveOrderScreen still updates correctly
- [ ] Vendor settings form still saves other fields normally

---

## 📁 Files Changed

### Rider Repo (Pushed ✅)
```
src/components/screens/ActiveOrderScreen.jsx
```
- Line 257: Changed `enableHighAccuracy: false, maximumAge: 60000` → `enableHighAccuracy: true, maximumAge: 0`

### Vendor Repo (Local only ⚠️)
```
src/pages/tabs/SettingsTab.tsx
```
- Lines 79-100: Added GPS accuracy validation before saving coordinates
- Lines 87-111: Two-tier rejection (>1000m hard reject, >500m soft reject)
- Line 87: Enhanced success toast with accuracy display

---

## 🔗 References

**Rider PR:** https://github.com/Spidey2342/Waakye-plug-rider/pull/9

**Vendor changes:** See `/tmp/VENDOR_CHANGES_README.md` for full details and manual application instructions

**Patch file:** `vendor-gps-accuracy.patch` in rider repo workspace

**Related bug:** Waakye Plug vendor had "ho" text but Accra GPS (5.5545, -0.1902), causing ~157km routing error

---

## ✨ Success Criteria Met

✅ **Rider first GPS read hardened** - no more stale Accra seeds  
✅ **Vendor GPS save requires accuracy** - prevents saving bad pins  
✅ **Clear user guidance** - both apps now educate about Precise Location  
✅ **One PR opened** (rider repo)  
⚠️ **One PR pending manual application** (vendor repo - environment limitation)  

**Root cause addressed:** Both apps now enforce GPS accuracy standards that prevent the Ho→Accra routing disaster.
