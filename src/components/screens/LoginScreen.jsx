'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bike, Phone, Lock, Eye, EyeOff, ArrowRight, Loader2 } from 'lucide-react';
import { riderLogin } from '../../lib/riderAuth';

export function LoginScreen({ onSuccess, onForgotPin, onApply }) {
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [shake, setShake] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const rider = await riderLogin(phone, pin);
      onSuccess(rider);
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = phone.trim().length > 0 && pin.length === 4;

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col items-center justify-center px-6 [webkit-tap-highlight-color:transparent]">
      <div className="w-full max-w-sm">

        {/* ── Logo + title ── */}
        <motion.div
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center mb-8"
        >
          <motion.div
            initial={{ scale: 0.6, rotate: -12 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
            className="w-20 h-20 rounded-3xl bg-[#7a1d1d] flex items-center justify-center shadow-lg mb-5"
          >
            <Bike className="w-9 h-9 text-white" strokeWidth={2} />
          </motion.div>

          <h1 className="text-2xl font-extrabold text-center leading-tight">
            Waakye Plug
            <br />
            <span className="text-[#7a1d1d]">Riders</span>
          </h1>
          <p className="text-sm text-gray-500 mt-2 text-center">Deliver joy, one bowl at a time</p>
        </motion.div>

        {/* ── Form ── */}
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: shake ? [0, -6, 6, -6, 6, 0] : 0 }}
          transition={{ duration: shake ? 0.4 : 0.4, delay: shake ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-3"
        >
          <div className="relative">
            <Phone className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Phone Number"
              className="w-full bg-white border border-gray-200 rounded-2xl pl-11 pr-4 py-4 text-sm outline-none shadow-sm transition-all focus:border-[#7a1d1d]/50 focus:shadow-[0_0_0_3px_rgba(122,29,29,0.08)]"
            />
          </div>

          <div className="relative">
            <Lock className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type={showPin ? 'text' : 'password'}
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-Digit PIN"
              className="w-full bg-white border border-gray-200 rounded-2xl pl-11 pr-11 py-4 text-sm outline-none shadow-sm tracking-[0.4em] transition-all focus:border-[#7a1d1d]/50 focus:shadow-[0_0_0_3px_rgba(122,29,29,0.08)]"
            />
            <button
              type="button"
              onClick={() => setShowPin((v) => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400"
            >
              {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="text-xs text-red-500 font-medium px-1"
              >
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onForgotPin}
              className="text-xs font-bold text-[#7a1d1d]"
            >
              Forgot PIN?
            </button>
          </div>

          <motion.button
            type="submit"
            disabled={!canSubmit || loading}
            whileTap={{ scale: 0.98 }}
            className="w-full bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 shadow-md disabled:opacity-50 mt-2"
          >
            <AnimatePresence mode="wait">
              {loading ? (
                <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Logging in...
                </motion.span>
              ) : (
                <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                  Log In
                  <ArrowRight className="w-4 h-4" />
                </motion.span>
              )}
            </AnimatePresence>
          </motion.button>
        </motion.form>

        {/* ── Footer ── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8"
        >
          <div className="border-t border-gray-200 mb-6" />
          <p className="text-center text-sm text-gray-500">
            Don't have an account?{' '}
            <button type="button" onClick={onApply} className="font-bold text-[#7a1d1d]">
              Apply to Ride
            </button>
          </p>
          <p className="text-center text-[10px] font-bold text-gray-300 uppercase tracking-wide mt-6">
            Powered by Waakye Plug Tech
          </p>
        </motion.div>
      </div>
    </div>
  );
}