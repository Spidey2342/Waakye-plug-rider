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
} from 'lucide-react';
import { markPickedUp, markDelivered } from '../../lib/ordersApi';
import { geocodeAddress, getRoute, distanceMeters, speak } from '../../lib/mapService';

const STAGES = ['Heading to Vendor', 'At Vendor', 'Heading to Customer', 'Delivered'];
const ARRIVAL_THRESHOLD_M = 100; // "close enough" to vendor/customer to flip stage
const STEP_THRESHOLD_M = 40; // "close enough" to a turn to announce the next one

// Small colored dot markers built from plain divs — avoids the classic
// Leaflet-in-a-bundler broken-default-icon problem entirely, no image assets needed.
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

export function ActiveOrderScreen({ order: initialOrder, onDelivered, onBack }) {
  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const riderMarkerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const vendorMarkerRef = useRef(null);
  const customerMarkerRef = useRef(null);
  const spokenStepIndexRef = useRef(-1);

  const [order, setOrder] = useState(initialOrder);
  const [vendorCoords, setVendorCoords] = useState(null);
  const [customerCoords, setCustomerCoords] = useState(null);
  const [riderPosition, setRiderPosition] = useState(null);
  const [route, setRoute] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isAtVendor, setIsAtVendor] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const [mapError, setMapError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showDeliverConfirm, setShowDeliverConfirm] = useState(false);

  const target = order.status === 'picked_up' ? customerCoords : vendorCoords;

  // ── One-time setup: inject the pulse keyframe + init the Leaflet map ──
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `@keyframes pulseDot { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.6); opacity: 0.6; } }`;
    document.head.appendChild(style);

    const map = L.map(mapContainerRef.current, { zoomControl: false }).setView([5.6037, -0.1870], 13); // default: Accra
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

  // ── Geocode vendor + customer addresses once, on mount ──
  useEffect(() => {
    async function geocodeBoth() {
      try {
        const [vendor, customer] = await Promise.all([
          geocodeAddress(order.vendors?.location || ''),
          geocodeAddress(order.delivery_address || ''),
        ]);
        if (!vendor || !customer) {
          setMapError('Could not locate one of the addresses on the map. You can still navigate manually.');
        }
        setVendorCoords(vendor);
        setCustomerCoords(customer);
      } catch {
        setMapError('Map service is temporarily unavailable.');
      }
    }
    geocodeBoth();
  }, [order.vendors?.location, order.delivery_address]);

  // ── Track the rider's live GPS position ──
  useEffect(() => {
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setRiderPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setMapError('Location access is off — turn it on to see your live position and get directions.'),
      { enableHighAccuracy: true, maximumAge: 5000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ── Fetch/refresh the route whenever the target (vendor → then customer) or rider position changes meaningfully ──
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
  }, [target?.lat, target?.lng, order.status]);

  // ── Update map markers, route line, and rider dot whenever data changes ──
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
    }
  }, [vendorCoords, customerCoords, riderPosition, route]);

  // ── Check proximity: flip "At Vendor" stage, advance turn-by-turn steps, and speak them ──
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
    setActionLoading(true);
    try {
      const updated = await markDelivered(order.id);
      setShowDeliverConfirm(false);
      onDelivered(updated);
    } catch (err) {
      setMapError(err.message);
    } finally {
      setActionLoading(false);
    }
  }, [order.id, onDelivered]);

  function callVendor() {
    if (order.vendors?.phone) window.location.href = `tel:${order.vendors.phone}`;
    else setMapError('No phone number on file for this vendor.');
  }

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">

      {/* ── Header ── */}
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

        {/* ── Status stepper ── */}
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

      {/* ── Next-turn banner ── */}
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

      {/* ── Map ── */}
      <div className="relative flex-1 min-h-[260px] mx-4 rounded-2xl overflow-hidden border border-gray-200">
        <div ref={mapContainerRef} className="absolute inset-0" />
        {(loadingRoute && !route) && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-[#7a1d1d] animate-spin" />
          </div>
        )}
      </div>

      {mapError && (
        <div className="mx-4 mt-2 flex items-start gap-2 bg-amber-50 text-amber-700 text-xs font-medium px-3 py-2 rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{mapError}</span>
        </div>
      )}

      {/* ── Order + money panel ── */}
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

        <div className="bg-[#faf6ee] rounded-2xl p-4 flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-gray-400" />
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase">Pay Vendor</p>
              <p className="font-bold text-sm">GH₵{order.total_amount}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold text-gray-400 uppercase">Earning</p>
            <p className="font-bold text-sm text-emerald-600">+{order.delivery_fee}</p>
          </div>
        </div>

        {order.status === 'rider_assigned' && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleMarkPickedUp}
            disabled={actionLoading}
            className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60 mb-3"
          >
            {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Mark Picked Up
          </motion.button>
        )}

        {order.status === 'picked_up' && (
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowDeliverConfirm(true)}
            disabled={actionLoading}
            className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60 mb-3"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark Delivered
          </motion.button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button className="flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 text-sm font-bold text-gray-600">
            <AlertCircle className="w-4 h-4" />
            Report Issue
          </button>
          <button className="flex items-center justify-center gap-2 border border-gray-200 rounded-xl py-3 text-sm font-bold text-gray-600">
            <MessageCircle className="w-4 h-4" />
            Chat Support
          </button>
        </div>
      </div>

      {/* ── Cash confirmation modal ── */}
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
              <p className="font-bold text-lg mb-1">Confirm cash collected</p>
              <p className="text-sm text-gray-500 mb-5">
                Confirm you've collected <span className="font-bold text-gray-900">GH₵{Number(order.total_amount) + Number(order.delivery_fee)}</span> from the customer (food + delivery fee) before marking this delivered.
              </p>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleConfirmDelivered}
                disabled={actionLoading}
                className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Yes, Cash Collected
              </motion.button>
              <button
                onClick={() => setShowDeliverConfirm(false)}
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