'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Store,
  UtensilsCrossed,
  MapPin,
  Zap,
  Home,
  History,
  Wallet,
  User,
  Loader2,
} from 'lucide-react';
import { fetchAvailableOrders, acceptOrder, setRiderOnlineStatus } from '../../lib/ordersApi';
import { supabase } from '../../lib/supabase';

function OrderCard({ order, index, onAccept, accepting }) {
  const vendorName = order.vendors?.business_name ?? 'Vendor';
  const vendorLocation = order.vendors?.location ?? '';
  // Distance/ETA aren't wired to real geolocation yet — that needs vendor
  // coordinates + the rider's live position (planned for the OSM/OSRM map
  // work). Until then we show whatever the order actually carries, or a
  // plain fallback rather than a made-up number.
  const distanceLabel = order.distance_km ? `${order.distance_km} km away` : 'Distance unavailable';
  const etaLabel = order.eta_mins ? `${order.eta_mins} mins` : '—';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-[#faf6ee] flex items-center justify-center shrink-0">
            <UtensilsCrossed className="w-5 h-5 text-[#7a1d1d]" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-base leading-tight truncate">{vendorName}</p>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
              <MapPin className="w-3 h-3 shrink-0" />
              <span className="truncate">{vendorLocation ? `${vendorLocation} · ` : ''}{distanceLabel}</span>
            </div>
          </div>
        </div>
        <span className="shrink-0 bg-emerald-50 text-emerald-600 text-[10px] font-bold px-2.5 py-1 rounded-full">
          INSTANT PAY
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 border-t border-gray-100 pt-3 mb-4">
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Food Cost</p>
          <p className="font-bold text-sm mt-0.5">GH₵{order.total_amount ?? '—'}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Delivery</p>
          <p className="font-bold text-sm mt-0.5 text-[#7a1d1d]">GH₵{order.delivery_fee ?? '—'}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Est. Time</p>
          <p className="font-bold text-sm mt-0.5">{etaLabel}</p>
        </div>
      </div>

      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => onAccept(order.id)}
        disabled={accepting === order.id}
        className="w-full bg-[#7a1d1d] text-white py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {accepting === order.id ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Accepting...
          </>
        ) : (
          <>
            Accept Order
            <Zap className="w-4 h-4 fill-white" />
          </>
        )}
      </motion.button>
    </motion.div>
  );
}

export function HomeScreen({ rider, onNavigate, onOrderAccepted }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(rider?.is_online ?? false);
  const [accepting, setAccepting] = useState(null);
  const [error, setError] = useState(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAvailableOrders();
      setOrders(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();

    // Real-time: any change to the orders table (a new order appears, or
    // another rider claims one) refetches immediately — no more waiting on
    // a manual refresh to see current availability.
    const channel = supabase
      .channel('available-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        loadOrders();
      })
      .subscribe();

    // Kept as a fallback safety net in case the realtime connection ever
    // drops silently (e.g. brief network loss) — cheap insurance, not the
    // primary update mechanism anymore.
    const interval = setInterval(loadOrders, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [loadOrders]);

  async function toggleOnline() {
    const next = !isOnline;
    setIsOnline(next);
    try {
      await setRiderOnlineStatus(rider.id, next);
    } catch {
      setIsOnline(!next); // revert on failure
    }
  }

  async function handleAccept(orderId) {
    setAccepting(orderId);
    setError(null);
    try {
      const accepted = await acceptOrder(orderId, rider.id);
      onOrderAccepted(accepted);
    } catch (err) {
      setError(err.message);
      loadOrders(); // refresh the list since it may already be stale
    } finally {
      setAccepting(null);
    }
  }

  const fullName = rider?.profiles?.full_name ?? 'Rider';
  const photoUrl = rider?.photo_url;

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-md mx-auto px-4 pt-6">

          {/* ── Header ── */}
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-between mb-6"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-full bg-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                {photoUrl ? (
                  <img src={photoUrl} alt={fullName} className="w-full h-full object-cover" />
                ) : (
                  <User className="w-5 h-5 text-gray-400" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Welcome Back</p>
                <p className="font-bold text-base truncate">{fullName}</p>
              </div>
            </div>

            <button
              onClick={toggleOnline}
              className={`relative flex items-center gap-2 pl-3 pr-1 py-1 rounded-full shrink-0 transition-colors ${
                isOnline ? 'bg-[#7a1d1d]/10' : 'bg-gray-100'
              }`}
            >
              <span className={`text-[10px] font-bold uppercase ${isOnline ? 'text-[#7a1d1d]' : 'text-gray-400'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
              <span className={`relative w-9 h-5 rounded-full transition-colors ${isOnline ? 'bg-[#7a1d1d]' : 'bg-gray-300'}`}>
                <motion.span
                  layout
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm"
                  style={{ left: isOnline ? 18 : 2 }}
                />
              </span>
            </button>
          </motion.div>

          {/* ── Title + count badge ── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="flex items-center justify-between mb-5"
          >
            <h1 className="text-2xl font-extrabold">Available Orders</h1>
            <AnimatePresence mode="wait">
              <motion.span
                key={orders.length}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-[#7a1d1d] text-white text-xs font-bold px-3 py-1.5 rounded-full shrink-0"
              >
                {orders.length} Near You
              </motion.span>
            </AnimatePresence>
          </motion.div>

          {error && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-xs text-red-500 font-medium mb-4 bg-red-50 px-3 py-2 rounded-lg"
            >
              {error}
            </motion.p>
          )}

          {!isOnline ? (
            <div className="text-center py-16 text-gray-400">
              <Store className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="font-bold text-sm text-gray-500">You're offline</p>
              <p className="text-xs mt-1">Go online to start seeing orders.</p>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-7 h-7 text-[#7a1d1d] animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Store className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="font-bold text-sm text-gray-500">No orders right now</p>
              <p className="text-xs mt-1">New orders will show up here automatically.</p>
            </div>
          ) : (
            <AnimatePresence>
              {orders.map((order, i) => (
                <OrderCard key={order.id} order={order} index={i} onAccept={handleAccept} accepting={accepting} />
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* ── Bottom nav ── */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-4 px-2 py-2">
          {[
            { key: 'home', label: 'Home', icon: Home },
            { key: 'history', label: 'History', icon: History },
            { key: 'earnings', label: 'Earnings', icon: Wallet },
            { key: 'profile', label: 'Profile', icon: User },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === 'home';
            return (
              <button
                key={tab.key}
                onClick={() => onNavigate(tab.key)}
                className="flex flex-col items-center gap-1 py-1"
              >
                <Icon className={`w-5 h-5 ${isActive ? 'text-[#7a1d1d]' : 'text-gray-300'}`} />
                <span className={`text-[10px] font-bold uppercase ${isActive ? 'text-[#7a1d1d]' : 'text-gray-300'}`}>
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}