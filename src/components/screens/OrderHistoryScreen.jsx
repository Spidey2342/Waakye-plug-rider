'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import { Store, Loader2, PackageX, Home, History, Wallet, User } from 'lucide-react';
import { fetchOrderHistory } from '../../lib/historyApi';

function formatDateLabel(isoString) {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatTime(isoString) {
  return new Date(isoString).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function OrderHistoryScreen({ rider, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await fetchOrderHistory(rider.id);
        setOrders(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [rider.id]);

  const groups = useMemo(() => {
    const map = new Map();
    orders.forEach((order) => {
      const key = formatDateLabel(order.created_at);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(order);
    });
    return Array.from(map.entries());
  }, [orders]);

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-md mx-auto px-4 pt-6">

          <h1 className="text-2xl font-extrabold mb-6">Order History</h1>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-7 h-7 text-[#7a1d1d] animate-spin" />
            </div>
          ) : error ? (
            <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          ) : orders.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <PackageX className="w-8 h-8 mx-auto mb-2 text-gray-300" />
              <p className="font-bold text-sm text-gray-500">No orders yet</p>
              <p className="text-xs mt-1">Your completed deliveries will show up here.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map(([dateLabel, dateOrders], groupIndex) => (
                <div key={dateLabel}>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">{dateLabel}</p>
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    {dateOrders.map((order, i) => {
                      const isDelivered = order.status === 'delivered';
                      return (
                        <motion.div
                          key={order.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: Math.min((groupIndex * dateOrders.length + i) * 0.03, 0.3) }}
                          className={`flex items-center gap-3 p-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}
                        >
                          <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                            <Store className="w-4 h-4 text-gray-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-sm truncate">{order.vendors?.business_name ?? 'Vendor'}</p>
                            <p className="text-xs text-gray-400">
                              {formatTime(order.delivered_at ?? order.created_at)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            {isDelivered ? (
                              <p className="font-bold text-sm font-mono text-gray-900">GH₵{Number(order.delivery_fee).toFixed(2)}</p>
                            ) : (
                              <p className="font-bold text-sm text-gray-300">—</p>
                            )}
                            <p className={`text-[10px] font-bold uppercase ${isDelivered ? 'text-emerald-600' : 'text-red-400'}`}>
                              {isDelivered ? 'Delivered' : 'Cancelled'}
                            </p>
                          </div>
                        </motion.div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-md mx-auto grid grid-cols-4 px-2 py-2">
          {[
            { key: 'home', label: 'Home', icon: Home },
            { key: 'history', label: 'History', icon: History },
            { key: 'earnings', label: 'Earnings', icon: Wallet },
            { key: 'profile', label: 'Profile', icon: User },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === 'history';
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