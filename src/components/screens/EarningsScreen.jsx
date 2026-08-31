'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  History,
  Calendar,
  Wallet,
  HandCoins,
  Store,
  Home,
  User,
  Loader2,
} from 'lucide-react';
import { fetchTodayEarnings, fetchCommissionOwed, fetchRecentDeliveries } from '../../lib/earningsApi';

function timeAgo(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function EarningsScreen({ rider, onNavigate }) {
  const [loading, setLoading] = useState(true);
  const [earnedToday, setEarnedToday] = useState(0);
  const [commissionOwed, setCommissionOwed] = useState(0);
  const [deliveries, setDeliveries] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [today, owedData, recent] = await Promise.all([
        fetchTodayEarnings(rider.id),
        fetchCommissionOwed(rider.id),
        fetchRecentDeliveries(rider.id, 5),
      ]);
      setEarnedToday(today);
      setCommissionOwed(owedData.commissionOwed);
      setDeliveries(recent);
    } finally {
      setLoading(false);
    }
  }, [rider.id]);

  useEffect(() => {
    load();
  }, [load]);

  const todayLabel = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-md mx-auto px-4 pt-6">

          {/* ── Header ── */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-[#7a1d1d]" />
              <h1 className="text-2xl font-extrabold">Earnings</h1>
            </div>
            <button className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-7 h-7 text-[#7a1d1d] animate-spin" />
            </div>
          ) : (
            <>
              {/* ── Earned today ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Earned Today</p>
                  </div>
                  <p className="text-3xl font-extrabold font-mono">GH₵{earnedToday.toFixed(2)}</p>
                </div>
                <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                  <Wallet className="w-5 h-5 text-emerald-600" />
                </div>
              </motion.div>

              {/* ── Commission owed ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 }}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6 flex items-center justify-between"
              >
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7a1d1d]" />
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Commission Owed</p>
                  </div>
                  <p className="text-3xl font-extrabold font-mono text-[#7a1d1d]">GH₵{commissionOwed.toFixed(2)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Due by midnight</p>
                </div>
                <div className="w-11 h-11 rounded-xl bg-[#faf6ee] flex items-center justify-center shrink-0">
                  <HandCoins className="w-5 h-5 text-[#7a1d1d]" />
                </div>
              </motion.div>

              {/* ── Recent deliveries ── */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-lg">Recent Deliveries</h2>
                <span className="bg-[#faf6ee] text-gray-500 text-xs font-bold px-3 py-1 rounded-full">
                  Today, {todayLabel}
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
                {deliveries.length === 0 ? (
                  <div className="text-center py-10 text-gray-400 text-sm">No deliveries yet today.</div>
                ) : (
                  deliveries.map((d, i) => (
                    <motion.div
                      key={d.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.05 }}
                      className={`flex items-center gap-3 p-4 ${i > 0 ? 'border-t border-gray-100' : ''}`}
                    >
                      <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
                        <Store className="w-4 h-4 text-gray-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{d.vendors?.business_name ?? 'Vendor'}</p>
                        <p className="text-xs text-gray-400">{timeAgo(d.delivered_at)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-bold text-sm font-mono">GH₵{Number(d.delivery_fee).toFixed(2)}</p>
                        <p className="text-[10px] font-bold text-emerald-600 uppercase">Completed</p>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>

              <button className="w-full border-2 border-dashed border-gray-200 text-gray-400 font-bold text-sm py-3 rounded-2xl">
                View Older History
              </button>
            </>
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
            const isActive = tab.key === 'earnings';
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