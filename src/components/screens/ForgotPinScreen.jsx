'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Phone, IdCard, Lock, CheckCircle2, Loader2, ArrowRight } from 'lucide-react';
import { resetPin } from '../../lib/riderAuth';

const fieldClassIcon =
  'w-full bg-white border border-gray-200 rounded-2xl pl-11 pr-4 py-4 text-sm outline-none shadow-sm transition-all focus:border-[#7a1d1d]/50 focus:shadow-[0_0_0_3px_rgba(122,29,29,0.08)]';

export function ForgotPinScreen({ onBack }) {
  const [phone, setPhone] = useState('');
  const [ghanaCard, setGhanaCard] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const pinsMatch = newPin.length === 4 && newPin === confirmPin;
  const canSubmit = phone.trim() && ghanaCard.trim() && pinsMatch;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setLoading(true);
    try {
      await resetPin(phone.trim(), ghanaCard.trim(), newPin);
      setDone(true);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ scale: 0.6 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-5"
        >
          <CheckCircle2 className="w-8 h-8 text-emerald-500" />
        </motion.div>
        <h1 className="text-xl font-extrabold mb-2">PIN Reset</h1>
        <p className="text-sm text-gray-500 mb-8 max-w-xs">
          Your PIN has been updated. You can log in now with your phone number and new PIN.
        </p>
        <button
          onClick={onBack}
          className="bg-[#7a1d1d] text-white font-bold px-6 py-3 rounded-2xl flex items-center gap-2"
        >
          Back to Login
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col items-center px-6 pt-10 pb-10 [webkit-tap-highlight-color:transparent]">
      <div className="w-full max-w-sm">
        <button onClick={onBack} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center mb-6">
          <ChevronLeft className="w-5 h-5" />
        </button>

        <h1 className="text-2xl font-extrabold mb-1">Reset Your PIN</h1>
        <p className="text-sm text-gray-500 mb-6">
          Confirm your details and choose a new PIN. We'll notify Waakye Plug whenever this happens.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <Phone className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone Number"
              className={fieldClassIcon}
            />
          </div>

          <div className="relative">
            <IdCard className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              value={ghanaCard}
              onChange={(e) => setGhanaCard(e.target.value)}
              placeholder="Ghana Card Number"
              className={fieldClassIcon}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="New PIN"
                className={`${fieldClassIcon} tracking-[0.4em]`}
              />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                inputMode="numeric"
                maxLength={4}
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Confirm PIN"
                className={`${fieldClassIcon} tracking-[0.4em]`}
              />
            </div>
          </div>
          {confirmPin.length === 4 && !pinsMatch && (
            <p className="text-xs text-red-500 font-medium px-1">PINs don't match</p>
          )}

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-red-500 font-medium bg-red-50 px-3 py-2 rounded-lg"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <motion.button
            type="submit"
            whileTap={{ scale: 0.98 }}
            disabled={!canSubmit || loading}
            className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-md disabled:opacity-50 mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Resetting...
              </>
            ) : (
              <>
                Reset PIN
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </motion.button>
        </form>
      </div>
    </div>
  );
}