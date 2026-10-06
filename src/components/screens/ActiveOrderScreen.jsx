'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  ChevronLeft,
  Phone,
  Navigation,
  Wallet,
  CheckCircle2,
  AlertCircle,
  MessageCircle,
  Loader2,
  Check,
  Store,
} from 'lucide-react';
import {
  markPickedUp,
  updateRiderLocation,
  verifyDelivery,
  cancelOrderVendorClosed,
  fetchCustomerContactForOrder,
  fetchOrderDetails,
  releaseOrder,
} from '../../lib/ordersApi';
import { supabase } from '../../lib/supabase';
import {
  formatCustomerPhoneDisplay,
  formatCustomerTelHref,
  getCustomerFromOrder,
} from '../../lib/customerContact';
import { geocodeAddress, getRoute, distanceMeters, speak, parseLatLng, resolveCustomerDropoff } from '../../lib/mapService';
import { reportIssue } from '../../lib/issuesApi';
import { SUPPORT_WHATSAPP_NUMBER } from '../../lib/constants';
import { restrictNotesInput } from '../../lib/formValidation';
import { OrderItemsList } from '../OrderItemsList';
import { parseOrderItems } from '../../lib/orderItems';
import { UNUSABLE_ACCURACY_M, gpsErrorKind, gpsProblemMessage } from '../../lib/riderGps';

const STAGES = ['Heading to Vendor', 'At Vendor', 'Heading to Customer', 'Delivered'];
const ARRIVAL_THRESHOLD_M = 100;
const STEP_THRESHOLD_M = 40;

// A GPS fix worse than this (in meters, from pos.coords.accuracy) is treated
// as unreliable — this is what a network/Wi-Fi-based fallback location looks
// like, versus a real GPS fix which is normally well under 100m. We still
// use a low-accuracy fix if it's the only one we have (better than nothing
// on first load), but we won't let it override an already-good fix, and we
// warn the rider instead of silently trusting it.
const MIN_USABLE_ACCURACY_M = 400;

// A fix worse than UNUSABLE_ACCURACY_M (~3 km, from lib/riderGps) is not a
// "low-accuracy GPS reading" anymore — it's
// an IP/network-based guess (can be off by entire cities, e.g. reporting
// Accra while the rider is actually in Ho). We never use a fix this bad for
// anything, even as a first-load fallback: no marker, no route, no ETA.
// Better to show "waiting for GPS" than to plot the rider hundreds of
// kilometers from where they actually are.

// Default map center when no vendor/delivery pin is known yet. NEVER Accra —
// production riders operate in Ho / Volta. Prefer vendor coords on mount when
// already present on the order object (see map init below).
const HO_DEFAULT = { lat: 6.6008, lng: 0.4713 };

// If the rider is this far from the currently plotted route, the route is
// considered stale (missed turn, took a different road, etc.) and gets
// recalculated from the rider's current position.
const ROUTE_DEVIATION_THRESHOLD_M = 150;

// Don't hit OSRM more often than this even if the rider is off-route the
// whole time — avoids hammering the free public routing server.
const ROUTE_RECALC_COOLDOWN_MS = 20000;

// How often the rider's live position gets written to Supabase. GPS ticks
// arrive far more often than this (every few seconds with watchPosition) —
// without a throttle here every single tick would be a DB write. This is
// the piece that was previously missing entirely: the rider's position
// existed only in this component's local state and was never persisted,
// so nothing else on the platform (a customer tracking map, a vendor or
// admin dashboard) could ever see where the rider actually was.
const LOCATION_SYNC_INTERVAL_MS = 8000;

function makeDivIcon(color, pulse = false) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:16px;height:16px;border-radius:50%;
      background:${color};border:3px solid white;
      box-shadow:0 1px 4px rgba(0,0,0,0.4);
      ${pulse ? 'animation:pulseDot 1.5s ease-in-out infinite;' : ''}
    "></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

// Shortest distance from a point to a polyline, in meters — used to detect
// whether the rider has drifted off the plotted route.
function distanceToPolylineMeters(point, coordinates) {
  if (!coordinates || coordinates.length === 0) return Infinity;
  let min = Infinity;
  for (const [lat, lng] of coordinates) {
    const d = distanceMeters(point, { lat, lng });
    if (d < min) min = d;
  }
  return min;
}

export function ActiveOrderScreen({ order: initialOrder, riderId, onDelivered, onReleased, onBack }) {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const vendorMarkerRef = useRef(null);
  const customerMarkerRef = useRef(null);
  const spokenStepIndexRef = useRef(-1);
  const lastRouteFetchAtRef = useRef(0);
  const lastLocationSyncAtRef = useRef(0);

  const [order, setOrder] = useState(initialOrder);
  const [vendorCoords, setVendorCoords] = useState(null);
  const [customerCoords, setCustomerCoords] = useState(null);
  const [riderPosition, setRiderPosition] = useState(null);
  const positionAccuracyRef = useRef(null);
  // True when the device stopped giving GPS (permission revoked, no signal).
  // Position comes only from device GPS — there is no manual override.
  const [gpsLost, setGpsLost] = useState(false);
  const [route, setRoute] = useState(null);
  const [routeRefetchTick, setRouteRefetchTick] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isAtVendor, setIsAtVendor] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [mapError, setMapError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);
  const [deliveryCodeInput, setDeliveryCodeInput] = useState('');
  const [showReportIssue, setShowReportIssue] = useState(false);
  const [issueText, setIssueText] = useState('');
  const [issueSubmitting, setIssueSubmitting] = useState(false);
  const [issueSubmitted, setIssueSubmitted] = useState(false);
  const [showVendorClosedConfirm, setShowVendorClosedConfirm] = useState(false);
  const [showCallCustomerPrompt, setShowCallCustomerPrompt] = useState(false);
  const [releasedCustomerContact, setReleasedCustomerContact] = useState(null);
  const [customerContact, setCustomerContact] = useState(() => getCustomerFromOrder(initialOrder));
  const [customerContactError, setCustomerContactError] = useState(null);
  const [showReturnToPool, setShowReturnToPool] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  const target = order.status === 'picked_up' ? customerCoords : vendorCoords;
  const callCustomerContact = releasedCustomerContact ?? customerContact;
  const customerTelHref = formatCustomerTelHref(callCustomerContact?.phone);
  const customerPhoneLabel = formatCustomerPhoneDisplay(callCustomerContact?.phone);

  useEffect(() => {
    let alive = true;
    const embedded = getCustomerFromOrder(order);
    if (embedded?.phone) {
      setCustomerContact(embedded);
      setCustomerContactError(null);
      return undefined;
    }
    (async () => {
      try {
        const c = await fetchCustomerContactForOrder(order.id);
        if (alive) {
          setCustomerContact(c);
          setCustomerContactError(null);
        }
      } catch (err) {
        if (alive) setCustomerContactError(err.message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [order.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`active-order-${order.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${order.id}` },
        async () => {
          try {
            const fresh = await fetchOrderDetails(order.id);
            if (!fresh) return;
            setOrder((prev) => ({
              ...fresh,
              vendors: fresh.vendors ?? prev.vendors,
              customer: fresh.customer ?? prev.customer,
            }));
            if (fresh.status === 'cancelled') {
              setMapError('This order was cancelled.');
              onReleased?.();
            }
          } catch {
            // keep last known state if refetch fails
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [order.id, onReleased]);

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes pulseDot { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: 0.6; } }`;
    document.head.appendChild(style);

    // Initial center: vendor GPS if already on the order, else Ho — never Accra.
    const vendorStart = parseLatLng(initialOrder?.vendors?.latitude, initialOrder?.vendors?.longitude);
    const start = vendorStart || HO_DEFAULT;
    const map = L.map(mapContainerRef.current, { zoomControl: false }).setView([start.lat, start.lng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    async function resolveVendorAndCustomer() {
      try {
        // Uber-style: saved GPS columns first; Nominatim only when coords are
        // missing (old orders / vendors who never saved a pin). Never geocode
        // first — that previously sent riders to wrong cities/countries.
        const { latitude, longitude, location: vendorLocation } = order.vendors || {};
        const bias = (vendorLocation || '').trim() || undefined;

        const savedVendor = parseLatLng(latitude, longitude);
        const vendorPromise = savedVendor
          ? Promise.resolve(savedVendor)
          : geocodeAddress(vendorLocation || '');

        // Customer pin ladder: delivery_lat/lng → Maps-link / bare coords in
        // delivery_address → Nominatim (vendor-locality bias for short addrs).
        // OrderSummary often writes "street…\n🗺️ https://…maps?q=LAT,LNG"
        // without filling delivery_lat/lng; parsing that link avoids a failed
        // Nominatim call on the whole emoji+URL string.
        const customerPromise = resolveCustomerDropoff(order, { bias });

        const [vendor, customer] = await Promise.all([vendorPromise, customerPromise]);

        // Always apply whatever resolved so a partial success still pans the
        // map (fitBounds/setView in the markers effect).
        setVendorCoords(vendor);
        setCustomerCoords(customer);

        if (!vendor && !customer) {
          setMapError(
            'Could not locate the vendor or the delivery address on the map. You can still navigate manually.'
          );
        } else if (!vendor) {
          setMapError(
            'Could not locate the vendor on the map. Check the shop address or ask the vendor to save GPS coordinates.'
          );
        } else if (!customer) {
          setMapError(
            'Could not locate the delivery address on the map. Vendor pin is shown — navigate to the customer manually if needed.'
          );
        } else {
          // Clear a prior address-locate error once both pins resolve.
          setMapError((prev) =>
            prev && prev.startsWith('Could not locate') ? null : prev
          );
        }
      } catch {
        setMapError('Map service is temporarily unavailable.');
      }
    }
    resolveVendorAndCustomer();
  }, [
    order.vendors?.latitude,
    order.vendors?.longitude,
    order.vendors?.location,
    order.delivery_address,
    order.delivery_lat,
    order.delivery_lng,
  ]);

  // Accepts a raw geolocation reading and decides whether it's good enough
  // to trust. A low-accuracy fix (typically a network/IP-based fallback,
  // not real GPS) is only used if we don't have anything better yet; once
  // we have a decent fix, we ignore worse ones instead of jumping the
  // rider's marker onto a bad guess.
  const handlePosition = useCallback((pos) => {
    const accuracy = pos.coords.accuracy ?? null;
    const next = { lat: pos.coords.latitude, lng: pos.coords.longitude };

    // Reject outright: this isn't "a bit noisy GPS", it's an IP/network
    // guess that can be off by entire cities. Never plot it, even as a
    // first-load placeholder — show "waiting for GPS" instead.
    if (accuracy != null && accuracy > UNUSABLE_ACCURACY_M) {
      // Do not plot the rider marker — a multi-km network guess can place
      // them in another city (e.g. Accra while they are in Ho).
      setMapError(gpsProblemMessage('inaccurate', accuracy));
      return;
    }

    const prevAccuracy = positionAccuracyRef.current;
    const havePosition = prevAccuracy !== null;
    const isLowAccuracy = accuracy != null && accuracy > MIN_USABLE_ACCURACY_M;

    if (isLowAccuracy && havePosition && prevAccuracy <= MIN_USABLE_ACCURACY_M) {
      setMapError(`Location signal is weak (±${Math.round(accuracy)}m) — using your last good position.`);
      return;
    }

    positionAccuracyRef.current = accuracy;
    setRiderPosition(next);
    setGpsLost(false);
    if (isLowAccuracy) {
      setMapError(`Location is approximate (±${Math.round(accuracy)}m). Move to open sky or enable precise/GPS location for accurate directions.`);
    } else if (accuracy != null) {
      setMapError((prevError) =>
        prevError &&
        (prevError.startsWith('Location') || prevError.startsWith('Waiting for GPS'))
          ? null
          : prevError
      );
    }
  }, []);

  useEffect(() => {
    if (!('geolocation' in navigator)) return;

    navigator.geolocation.getCurrentPosition(
      handlePosition,
      () => {},
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );

    const watchId = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => {
        setGpsLost(true);
        setMapError(gpsProblemMessage(gpsErrorKind(err)));
      },
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [handlePosition]);

  // Push the rider's live position to Supabase, throttled. This is what
  // actually makes the location "real" outside this browser tab — without
  // it, riderPosition only ever drove this screen's own map/route and was
  // never visible to a customer tracking their order, a vendor, or admin.
  useEffect(() => {
    if (!riderId || !riderPosition) return;

    const now = Date.now();
    if (now - lastLocationSyncAtRef.current < LOCATION_SYNC_INTERVAL_MS) return;
    lastLocationSyncAtRef.current = now;

    updateRiderLocation(riderId, riderPosition.lat, riderPosition.lng);
  }, [riderId, riderPosition]);

  const hasPosition = Boolean(riderPosition);
  // Orders can only move forward (picked up / delivered) with a usable fix
  // from the device's own GPS.
  const gpsUsable = hasPosition && !gpsLost;
  const noGeolocation = typeof navigator === 'undefined' || !('geolocation' in navigator);
  useEffect(() => {
    if (!riderPosition || !target) return;

    let cancelled = false;
    async function fetchRoute() {
      setLoadingRoute(true);
      try {
        const r = await getRoute(riderPosition, target);
        if (!cancelled && r) {
          setRoute(r);
          spokenStepIndexRef.current = -1;
          setCurrentStepIndex(0);
          lastRouteFetchAtRef.current = Date.now();
        }
      } catch {
        if (!cancelled) setMapError('Could not calculate a route right now.');
      } finally {
        if (!cancelled) setLoadingRoute(false);
      }
    }
    fetchRoute();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.lat, target?.lng, order.status, hasPosition, routeRefetchTick]);

  // Watches for the rider drifting away from the plotted route (missed
  // turn, different road, etc.) and triggers a fresh route calculation,
  // throttled so we don't spam OSRM on every GPS tick.
  useEffect(() => {
    if (!riderPosition || !route?.coordinates?.length) return;

    const deviation = distanceToPolylineMeters(riderPosition, route.coordinates);
    if (deviation <= ROUTE_DEVIATION_THRESHOLD_M) return;

    const now = Date.now();
    if (now - lastRouteFetchAtRef.current < ROUTE_RECALC_COOLDOWN_MS) return;

    lastRouteFetchAtRef.current = now;
    setRouteRefetchTick((t) => t + 1);
  }, [riderPosition, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (vendorCoords) {
      if (vendorMarkerRef.current) vendorMarkerRef.current.setLatLng(vendorCoords);
      else vendorMarkerRef.current = L.marker(vendorCoords, { icon: makeDivIcon('#7a1d1d') }).addTo(map);
    }
    if (customerCoords) {
      if (customerMarkerRef.current) customerMarkerRef.current.setLatLng(customerCoords);
      else customerMarkerRef.current = L.marker(customerCoords, { icon: makeDivIcon('#1f2937') }).addTo(map);
    }
    if (riderPosition) {
      if (riderMarkerRef.current) riderMarkerRef.current.setLatLng(riderPosition);
      else riderMarkerRef.current = L.marker(riderPosition, { icon: makeDivIcon('#2563eb', true) }).addTo(map);
    }
    if (route?.coordinates) {
      if (routeLayerRef.current) map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = L.polyline(route.coordinates, { color: '#7a1d1d', weight: 5 }).addTo(map);
      map.fitBounds(routeLayerRef.current.getBounds(), { padding: [40, 40] });
    } else {
      // No route yet — fitBounds/setView to whatever pins we have so the map
      // leaves the Ho default as soon as vendor and/or delivery coords resolve.
      const points = [];
      if (vendorCoords) points.push([vendorCoords.lat, vendorCoords.lng]);
      if (customerCoords) points.push([customerCoords.lat, customerCoords.lng]);
      if (riderPosition) points.push([riderPosition.lat, riderPosition.lng]);
      if (points.length >= 2) {
        map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
      } else if (points.length === 1) {
        map.setView(points[0], 14);
      }
    }
  }, [vendorCoords, customerCoords, riderPosition, route]);

  useEffect(() => {
    if (!riderPosition) return;

    if (order.status === 'rider_assigned' && vendorCoords) {
      setIsAtVendor(distanceMeters(riderPosition, vendorCoords) <= ARRIVAL_THRESHOLD_M);
    }

    if (route?.steps?.length) {
      const nextStep = route.steps[currentStepIndex];
      if (nextStep && distanceMeters(riderPosition, nextStep.location) <= STEP_THRESHOLD_M) {
        if (currentStepIndex < route.steps.length - 1) {
          setCurrentStepIndex((i) => i + 1);
        }
      }
      if (spokenStepIndexRef.current !== currentStepIndex && route.steps[currentStepIndex]) {
        speak(route.steps[currentStepIndex].instruction);
        spokenStepIndexRef.current = currentStepIndex;
      }
    }
  }, [riderPosition, route, currentStepIndex, order.status, vendorCoords]);

  const stageIndex = order.status === 'delivered'
    ? 3
    : order.status === 'picked_up'
      ? 2
      : isAtVendor ? 1 : 0;

  const etaMins = route ? Math.round(route.durationSec / 60) : null;
  const nextStep = route?.steps?.[currentStepIndex];
  const orderCode = `WP-${order.id.slice(0, 4).toUpperCase()}`;
  const orderLineItems = parseOrderItems(order);
  const paymentLabel =
    order.payment_method === 'momo'
      ? 'MoMo at door'
      : order.payment_method === 'cash'
        ? 'Cash at door'
        : null;

  const handleMarkPickedUp = useCallback(async () => {
    setActionLoading(true);
    try {
      const updated = await markPickedUp(order.id);
      setOrder(updated);
    } catch (err) {
      setMapError(err.message);
    } finally {
      setActionLoading(false);
    }
  }, [order.id]);

  const handleConfirmDelivered = useCallback(async () => {
    if (deliveryCodeInput.length !== 4) {
      setMapError('Enter all 4 numbers the customer shows you.');
      return;
    }

    setActionLoading(true);
    try {
      const result = await verifyDelivery(order.id, deliveryCodeInput);
      const updated = result.order ?? result;
      setShowDeliverConfirm(false);
      setDeliveryCodeInput('');
      onDelivered(updated);
    } catch (err) {
      setMapError(err.message);
    } finally {
      setActionLoading(false);
    }
  }, [order.id, deliveryCodeInput, onDelivered]);

  const handleVendorClosedCancel = useCallback(async () => {
    setActionLoading(true);
    try {
      const result = await cancelOrderVendorClosed(order.id);
      const contact =
        result.customer ??
        getCustomerFromOrder(order) ??
        customerContact ??
        (await fetchCustomerContactForOrder(order.id).catch(() => null));
      setShowVendorClosedConfirm(false);
      setReleasedCustomerContact(contact);
      if (contact?.phone) setCustomerContact(contact);
      setShowCallCustomerPrompt(true);
    } catch (err) {
      setMapError(err.message);
    } finally {
      setActionLoading(false);
    }
  }, [order, customerContact]);

  function finishReleaseAndGoHome() {
    setShowCallCustomerPrompt(false);
    onReleased?.();
  }

  function callVendor() {
    if (order.vendors?.phone) window.location.href = `tel:${order.vendors.phone}`;
    else setMapError('No phone number on file for this vendor.');
  }

  function openChatSupport() {
    const message = encodeURIComponent(`Hi, I need help with order #WP-${order.id.slice(0, 4).toUpperCase()}`);
    window.open(`https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${message}`, '_blank');
  }

  async function handleSubmitIssue() {
    if (!issueText.trim()) return;
    setIssueSubmitting(true);
    try {
      await reportIssue(order.id, order.rider_id, issueText.trim());
      setIssueSubmitted(true);
    } catch (err) {
      setMapError(err.message);
    } finally {
      setIssueSubmitting(false);
    }
  }

  async function handleReturnToPool() {
    setReturnSubmitting(true);
    try {
      await releaseOrder(order.id, returnReason.trim() || undefined);
      setShowReturnToPool(false);
      onBack();
    } catch (err) {
      setMapError(err.message);
      setReturnSubmitting(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">

      <div className="px-4 pt-4 pb-3 bg-[#fefaf4] z-10">
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center active:scale-90 transition-transform">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="text-center">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Order #{orderCode}</p>
            <p className="text-sm font-bold text-[#7a1d1d]">
              {loadingRoute ? 'Calculating ETA...' : etaMins != null ? `ETA: ${etaMins} mins` : 'ETA unavailable'}
            </p>
          </div>
          <button onClick={callVendor} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center active:scale-90 transition-transform">
            <Phone className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center">
          {STAGES.map((stage, i) => (
            <div key={stage} className="flex-1 flex items-center">
              <div className="flex flex-col items-center flex-1">
                <motion.div
                  animate={{
                    scale: i === stageIndex ? [1, 1.15, 1] : 1,
                    backgroundColor: i <= stageIndex ? '#7a1d1d' : '#e5e7eb',
                  }}
                  transition={{ duration: 0.4 }}
                  className="w-7 h-7 rounded-full flex items-center justify-center"
                >
                  {i < stageIndex ? (
                    <Check className="w-3.5 h-3.5 text-white" />
                  ) : (
                    <Navigation className={`w-3 h-3 ${i <= stageIndex ? 'text-white' : 'text-gray-400'}`} />
                  )}
                </motion.div>
                <p className={`text-[9px] font-bold uppercase mt-1 text-center leading-tight ${i <= stageIndex ? 'text-[#7a1d1d]' : 'text-gray-400'}`}>
                  {stage}
                </p>
              </div>
              {i < STAGES.length - 1 && (
                <div className={`h-0.5 flex-1 -mt-4 ${i < stageIndex ? 'bg-[#7a1d1d]' : 'bg-gray-200'}`} />
              )}
            </div>
          ))}
        </div>
      </div>

      <AnimatePresence>
        {nextStep && order.status !== 'delivered' && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mx-4 mb-2 bg-white rounded-2xl shadow-md border border-gray-100 p-3 flex items-center gap-3 z-10"
          >
            <div className="w-9 h-9 rounded-xl bg-[#7a1d1d] flex items-center justify-center shrink-0">
              <Navigation className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Next Turn</p>
              <p className="text-sm font-bold truncate">{nextStep.distance}m · {nextStep.instruction}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex-1 min-h-[260px] mx-4 rounded-2xl overflow-hidden border border-gray-200">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {(loadingRoute && !route) && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-[#7a1d1d] animate-spin" />
          </div>
        )}
      </div>

      {(mapError || noGeolocation) && (
        <div className="mx-4 mt-2 flex items-start gap-2 bg-amber-50 text-amber-700 text-xs font-medium px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{mapError || gpsProblemMessage('unsupported')}</span>
        </div>
      )}

      <div className="bg-white rounded-t-3xl shadow-[0_-4px_20px_rgba(0,0,0,0.04)] mt-3 px-5 pt-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
        <div className="flex items-center justify-between mb-4">
          <div className="min-w-0">
            <p className="font-bold text-base truncate">{order.vendors?.business_name ?? 'Vendor'}</p>
            <p className="text-xs text-gray-500 truncate">
              {order.status === 'picked_up' ? order.delivery_address : order.vendors?.location}
            </p>
          </div>
          {route?.distanceM && (
            <span className="shrink-0 bg-[#faf6ee] text-[#7a1d1d] text-xs font-bold px-2.5 py-1 rounded-full">
              {(route.distanceM / 1000).toFixed(1)}km
            </span>
          )}
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl p-4 mb-3">
          <OrderItemsList order={order} title="Buy this at the vendor" />
          {orderLineItems.length > 0 && (
            <p className="text-[10px] text-gray-500 mt-3 pt-3 border-t border-gray-100">
              {orderLineItems.reduce((n, it) => n + it.quantity, 0)} piece
              {orderLineItems.reduce((n, it) => n + it.quantity, 0) === 1 ? '' : 's'} · show this list when you pay
            </p>
          )}
        </div>

        <div className="bg-[#faf6ee] rounded-2xl p-4 flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Pay vendor (food only)</p>
              <p className="font-bold text-sm">GH₵{order.total_amount}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-gray-400 uppercase">Your delivery fee</p>
            <p className="font-bold text-sm text-emerald-600">+{order.delivery_fee}</p>
            {paymentLabel && (
              <p className="text-[10px] font-bold text-gray-500 mt-0.5">{paymentLabel}</p>
            )}
          </div>
        </div>


        {!gpsUsable && (order.status === 'rider_assigned' || order.status === 'picked_up') && (
          <p className="text-xs font-medium text-amber-700 bg-amber-50 rounded-xl px-3 py-2 mb-3">
            Waiting for a usable GPS fix from your phone before you can continue this order.
          </p>
        )}

        {order.status === 'rider_assigned' && (
          <>
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleMarkPickedUp}
              disabled={actionLoading || !gpsUsable}
              className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60 mb-3"
            >
              {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Mark Picked Up
            </motion.button>
            <button
              type="button"
              onClick={() => setShowVendorClosedConfirm(true)}
              disabled={actionLoading}
              className="w-full mb-3 border-2 border-amber-200 bg-amber-50 text-amber-950 py-3.5 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Store className="w-4 h-4" />
              Vendor closed — cancel order
            </button>
          </>
        )}

        {order.status === 'picked_up' && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              setDeliveryCodeInput('');
              setShowDeliverConfirm(true);
            }}
            disabled={actionLoading || !gpsUsable}
            className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60 mb-3"
          >
            <CheckCircle2 className="w-4 h-4" />
            Confirm delivery code
          </motion.button>
        )}

        {customerPhoneLabel && customerTelHref && order.status !== 'delivered' && (
          <a
            href={customerTelHref}
            className="flex items-center justify-between gap-3 w-full mb-3 bg-white border border-gray-200 rounded-2xl px-4 py-3 active:scale-[0.99] transition-transform"
          >
            <div className="min-w-0 text-left">
              <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wide">Customer</p>
              <p className="font-bold text-sm truncate">{callCustomerContact?.full_name ?? 'Customer'}</p>
              <p className="text-lg font-bold text-[#7a1d1d] tabular-nums tracking-wide">{customerPhoneLabel}</p>
            </div>
            <div className="shrink-0 w-11 h-11 rounded-full bg-emerald-50 flex items-center justify-center">
              <Phone className="w-5 h-5 text-emerald-700" />
            </div>
          </a>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setShowReportIssue(true)}
            className="flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 text-sm font-bold text-gray-600"
          >
            <AlertCircle className="w-4 h-4" />
            Report Issue
          </button>
          <button
            onClick={openChatSupport}
            className="flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 text-sm font-bold text-gray-600"
          >
            <MessageCircle className="w-4 h-4" />
            Chat Support
          </button>
        </div>

        {order.status === 'rider_assigned' && (
          <button
            onClick={() => setShowReturnToPool(true)}
            className="w-full mt-3 flex items-center justify-center gap-2 border-2 border-amber-200 bg-amber-50 rounded-xl py-3 text-sm font-bold text-amber-700"
          >
            <AlertCircle className="w-4 h-4" />
            Need to return this order?
          </button>
        )}
      </div>

      <AnimatePresence>
        {showDeliverConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
            onClick={() => setShowDeliverConfirm(false)}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]"
            >
              <p className="font-bold text-lg mb-1">Confirm delivery</p>
              <p className="text-sm text-gray-500 mb-5">
                Ask the customer for their <span className="font-bold text-gray-900">4-digit code</span>, then type it below to complete the delivery.
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={4}
                value={deliveryCodeInput}
                onChange={(e) => setDeliveryCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="• • • •"
                className="w-full text-center font-mono text-4xl tracking-[0.5em] border-2 border-gray-200 rounded-2xl py-4 mb-4 outline-none focus:border-[#7a1d1d] tabular-nums"
                autoComplete="one-time-code"
              />
              <p className="text-xs text-gray-500 mb-5">
                Also confirm cash collected:{' '}
                <span className="font-bold text-gray-900">
                  GH₵{Number(order.total_amount) + Number(order.delivery_fee)}
                </span>{' '}
                (food + delivery).
              </p>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirmDelivered}
                disabled={actionLoading}
                className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Complete delivery
              </motion.button>
              <button
                onClick={() => {
                  setShowDeliverConfirm(false);
                  setDeliveryCodeInput('');
                }}
                className="w-full text-center text-sm font-bold text-gray-400 mt-3 py-2"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReportIssue && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
            onClick={() => { setShowReportIssue(false); setIssueSubmitted(false); setIssueText(''); }}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]"
            >
              {issueSubmitted ? (
                <div className="text-center py-4">
                  <Check className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
                  <p className="font-bold text-lg mb-1">Issue reported</p>
                  <p className="text-sm text-gray-500 mb-5">We've logged this and will follow up if needed.</p>
                  <button
                    onClick={() => { setShowReportIssue(false); setIssueSubmitted(false); setIssueText(''); }}
                    className="w-full bg-[#7a1d1d] text-white py-3.5 rounded-2xl font-bold"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <p className="font-bold text-lg mb-1">Report an issue</p>
                  <p className="text-sm text-gray-500 mb-4">
                    Let us know what's wrong with this order — wrong address, vendor closed, anything.
                  </p>
                  <textarea
                    value={issueText}
                    onChange={(e) => setIssueText(restrictNotesInput(e.target.value, 1000))}
                    placeholder="Describe the issue..."
                    maxLength={1000}
                    rows={4}
                    className="w-full bg-[#faf6ee] border border-gray-200 rounded-xl p-3 text-sm outline-none resize-none mb-4 focus:border-[#7a1d1d]/50"
                  />
                  <motion.button
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSubmitIssue}
                    disabled={issueSubmitting || !issueText.trim()}
                    className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {issueSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Submit Report
                  </motion.button>
                  <button
                    onClick={() => { setShowReportIssue(false); setIssueText(''); }}
                    className="w-full text-center text-sm font-bold text-gray-400 mt-3 py-2"
                  >
                    Cancel
                  </button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showVendorClosedConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
            onClick={() => !actionLoading && setShowVendorClosedConfirm(false)}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]"
            >
              <p className="font-bold text-lg mb-1">Vendor not open?</p>
              <p className="text-sm text-gray-500 mb-5">
                This <span className="font-bold text-gray-800">cancels the customer&apos;s order</span> in Waakye Plug
                (it will not go to another rider). You must{' '}
                <span className="font-bold text-gray-800">call the customer</span> to explain.
              </p>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleVendorClosedCancel}
                disabled={actionLoading}
                className="w-full bg-amber-600 text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Store className="w-4 h-4" />}
                Yes — cancel this order
              </motion.button>
              <button
                type="button"
                onClick={() => setShowVendorClosedConfirm(false)}
                disabled={actionLoading}
                className="w-full text-center text-sm font-bold text-gray-400 mt-3 py-2"
              >
                Go back
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCallCustomerPrompt && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]"
            >
              <p className="font-bold text-lg mb-1">Call the customer</p>
              <p className="text-sm text-gray-500 mb-4">
                Tell them the vendor was closed and their order is{' '}
                <span className="font-bold text-gray-800">cancelled</span> in the app. Apologize and suggest they order
                again later or from another vendor.
              </p>
              {customerPhoneLabel && customerTelHref ? (
                <a
                  href={customerTelHref}
                  className="block w-full bg-[#7a1d1d] text-white py-4 px-4 rounded-2xl font-bold text-base mb-3 active:scale-[0.98] transition-transform"
                >
                  <span className="flex items-center justify-center gap-2">
                    <Phone className="w-4 h-4" />
                    Tap to call
                  </span>
                  <span className="block text-center text-lg tabular-nums tracking-wide mt-1">
                    {customerPhoneLabel}
                  </span>
                  {callCustomerContact?.full_name && (
                    <span className="block text-center text-xs font-medium opacity-90 mt-0.5">
                      {callCustomerContact.full_name}
                    </span>
                  )}
                </a>
              ) : (
                <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <p className="font-bold">Customer number not loaded</p>
                  <p className="text-xs mt-1 opacity-90">
                    {customerContactError ??
                      'Deploy rider-order-contact on Supabase, or ask support for the customer phone.'}
                  </p>
                </div>
              )}
              <button
                type="button"
                onClick={finishReleaseAndGoHome}
                className="w-full text-center text-sm font-bold text-gray-500 py-2"
              >
                I&apos;ve called them — back to orders
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showReturnToPool && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-end justify-center z-50"
            onClick={() => { setShowReturnToPool(false); setReturnReason(''); }}
          >
            <motion.div
              initial={{ y: 100 }}
              animate={{ y: 0 }}
              exit={{ y: 100 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-t-3xl w-full max-w-md p-6 pb-[calc(env(safe-area-inset-bottom)+24px)]"
            >
              <p className="font-bold text-lg mb-1">Return order to pool?</p>
              <p className="text-sm text-gray-500 mb-4">
                This will make the order available for other riders. Only do this if you can't reach the vendor or need to cancel for another reason.
              </p>
              <textarea
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                placeholder="Why are you returning this order? (optional)"
                rows={3}
                className="w-full bg-[#faf6ee] border border-gray-200 rounded-xl p-3 text-sm outline-none resize-none mb-4 focus:border-[#7a1d1d]/50"
              />
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleReturnToPool}
                disabled={returnSubmitting}
                className="w-full bg-amber-600 text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {returnSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Yes, Return to Pool
              </motion.button>
              <button
                onClick={() => { setShowReturnToPool(false); setReturnReason(''); }}
                className="w-full text-center text-sm font-bold text-gray-400 mt-3 py-2"
              >
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}