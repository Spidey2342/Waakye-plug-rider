'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Lock, Bike, Banknote, HandCoins, ShieldCheck, ArrowRight, Loader2 } from 'lucide-react';
import { fetchTodaySettlementSummary, createSettlementIntent, verifySettlement } from '../../lib/settlementApi';
import { payWithPaystack } from '../../lib/paystack';

export function SettleUpScreen({ rider, onSettled }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchTodaySettlementSummary(rider.id);
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [rider.id]);

  useEffect(() => {
    load();
  }, [load]);

    async function handlePay() {
    if (!summary) return;
    setError(null);
    setPaying(true);

    const email = `${rider.profiles?.phone}@riders.waakyeplug.app`;

    try {
      const { reference, amount } = await createSettlementIntent(rider.id);

      await payWithPaystack({
        email,
        amountGHS: amount,
        reference,
        onSuccess: async (paidReference) => {
          try {
            await verifySettlement(paidReference, rider.id);
            onSettled();
          } catch (err) {
            setError(err.message);
          } finally {
            setPaying(false);
          }
        },
        onClose: () => setPaying(false),
      });
    } catch (err) {
      setError(err.message);
      setPaying(false);
    }
  }
  
  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col items-center px-6 pt-16 pb-10 [webkit-tap-highlight-color:transparent]">
      <div className="w-full max-w-sm flex flex-col items-center">

        {/* ── Lock icon + heading ── */}
        <motion.div
          initial={{ scale: 0.6, rotate: -8 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="w-16 h-16 rounded-2xl bg-white shadow-md flex items-center justify-center mb-6"
        >
          <Lock className="w-7 h-7 text-[#7a1d1d]" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-8"
        >
          <h1 className="text-2xl font-extrabold leading-tight">Daily Settlement<br />Required</h1>
          <p className="text-sm text-gray-500 mt-3 leading-relaxed">
            Your account is temporarily locked until today's commission is settled.
          </p>
        </motion.div>

        {/* ── Summary card ── */}
        {loading ? (
          <div className="py-12">
            <Loader2 className="w-6 h-6 text-[#7a1d1d] animate-spin" />
          </div>
        ) : summary ? (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-6"
          >
            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#faf6ee] flex items-center justify-center">
                  <Bike className="w-4 h-4 text-[#7a1d1d]" />
                </div>
                <p className="text-sm font-medium text-gray-600">Orders Completed</p>
              </div>
              <p className="font-extrabold text-lg">{summary.ordersCompleted}</p>
            </div>

            <div className="h-px bg-gray-100" />

            <div className="flex items-center justify-between py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Banknote className="w-4 h-4 text-blue-500" />
                </div>
                <p className="text-sm font-medium text-gray-600">Total Collected</p>
              </div>
              <p className="font-extrabold text-lg font-mono">GH₵{summary.totalCollected.toFixed(2)}</p>
            </div>

            <div className="h-px bg-gray-100" />

            <div className="flex items-center justify-between pt-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#faf6ee] flex items-center justify-center">
                  <HandCoins className="w-4 h-4 text-[#7a1d1d]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-600">Commission (10% of delivery fees)</p>
                  <span className="inline-block text-[9px] font-bold text-gray-400 uppercase bg-gray-100 px-1.5 py-0.5 rounded mt-1">
                    Due Now
                  </span>
                </div>
              </div>
              <p className="font-extrabold text-2xl text-[#7a1d1d] font-mono">GH₵{summary.commissionOwed.toFixed(2)}</p>
            </div>
          </motion.div>
        ) : null}

        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="text-xs text-red-500 font-medium bg-red-50 px-3 py-2 rounded-lg mb-4 w-full text-center"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        {/* ── Pay button ── */}
        <motion.button
          whileTap={{ scale: 0.98 }}
          onClick={handlePay}
          disabled={loading || paying || !summary || summary.commissionOwed <= 0}
          className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
        >
          {paying ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              Pay with Paystack
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </motion.button>

        <div className="flex flex-col items-center gap-1 mt-6">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
            Secure transaction via Paystack
          </p>
          <div className="flex items-center gap-1.5 text-gray-300">
            <ShieldCheck className="w-3 h-3" />
            <p className="text-[9px] font-bold uppercase tracking-wide">Encrypted payment gateway</p>
          </div>
        </div>
      </div>
    </div>
  );
}