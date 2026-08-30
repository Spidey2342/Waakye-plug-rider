'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ChevronLeft,
  Bike,
  Footprints,
  Camera,
  Plus,
  User,
  Phone,
  IdCard,
  MapPin,
  StickyNote,
  ArrowRight,
  Loader2,
  Check,
  Lock,
} from 'lucide-react';

const STEPS = ['Identity', 'Work Details', 'Emergency Contact', 'Float & Status'];

const TRANSPORT_OPTIONS = [
  { key: 'motorbike', label: 'Motorbike', icon: Bike },
  { key: 'bicycle', label: 'Bicycle', icon: Bike },
  { key: 'foot', label: 'On Foot', icon: Footprints },
];

function FieldLabel({ children }) {
  return <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">{children}</label>;
}

const fieldClass =
  'w-full bg-[#faf6ee] border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none transition-all focus:border-[#7a1d1d]/50 focus:bg-white focus:shadow-[0_0_0_3px_rgba(122,29,29,0.08)]';
const fieldClassIcon =
  'w-full bg-[#faf6ee] border border-gray-200 rounded-xl pl-11 pr-4 py-3 text-sm outline-none transition-all focus:border-[#7a1d1d]/50 focus:bg-white focus:shadow-[0_0_0_3px_rgba(122,29,29,0.08)]';

const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction > 0 ? -40 : 40, opacity: 0 }),
};

export function AddRiderScreen({ onBack, onSubmit }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [photoPreview, setPhotoPreview] = useState(null);

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    ghana_card_number: '',
    pin: '',
    confirm_pin: '',
    photo: null,
    transport_type: 'motorbike',
    home_area: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    emergency_contact_relationship: '',
    deposit_amount: '',
    deposit_date: new Date().toISOString().slice(0, 10),
    notes: '',
    is_active: true,
  });

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handlePhotoPick(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    update('photo', file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(file);
  }

  function isStepValid() {
    if (stepIndex === 0) {
      return (
        form.full_name.trim() &&
        form.phone.trim() &&
        form.ghana_card_number.trim() &&
        form.pin.length === 4 &&
        form.pin === form.confirm_pin
      );
    }
    if (stepIndex === 1) return form.home_area.trim();
    return true;
  }

  function goNext() {
    if (!isStepValid()) return;
    setDirection(1);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    if (stepIndex === 0) {
      onBack();
      return;
    }
    setDirection(-1);
    setStepIndex((i) => i - 1);
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(form);
    } finally {
      setSubmitting(false);
    }
  }

  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">

      {/* ── Header ── */}
      <div className="sticky top-0 z-20 bg-[#fefaf4]/95 backdrop-blur-sm border-b border-gray-200 shrink-0">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={goBack}
            className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center active:scale-90 transition-transform"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-lg">Add Rider</h1>
          <motion.div
            animate={{ rotate: [-8, 8, -8] }}
            transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
            className="w-9 h-9 rounded-full bg-[#7a1d1d]/10 flex items-center justify-center"
          >
            <Bike className="w-4 h-4 text-[#7a1d1d]" />
          </motion.div>
        </div>

        {/* ── Progress dots + label ── */}
        <div className="max-w-md mx-auto px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            {STEPS.map((_, i) => (
              <div key={i} className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <motion.div
                  className="h-full bg-[#7a1d1d] rounded-full"
                  initial={false}
                  animate={{ width: i <= stepIndex ? '100%' : '0%' }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                />
              </div>
            ))}
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">
            Step {stepIndex + 1} of {STEPS.length} · {STEPS[stepIndex]}
          </p>
        </div>
      </div>

      {/* ── Step content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 py-6 pb-8">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={stepIndex}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4"
            >
              {/* ── Step 1: Identity ── */}
              {stepIndex === 0 && (
                <>
                  <div className="flex justify-center mb-2">
                    <div className="relative">
                      <label className="w-24 h-24 rounded-2xl border-2 border-dashed border-gray-300 bg-[#faf6ee] flex flex-col items-center justify-center gap-1 overflow-hidden cursor-pointer active:scale-95 transition-transform">
                        {photoPreview ? (
                          <img src={photoPreview} className="w-full h-full object-cover" alt="Rider" />
                        ) : (
                          <>
                            <Camera className="w-6 h-6 text-gray-400" />
                            <span className="text-[10px] font-bold text-gray-400 uppercase">Photo</span>
                          </>
                        )}
                        <input type="file" accept="image/*" onChange={handlePhotoPick} className="hidden" />
                      </label>
                      <motion.div
                        animate={{ scale: [1, 1.12, 1] }}
                        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                        className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-[#7a1d1d] flex items-center justify-center shadow-md pointer-events-none"
                      >
                        <Plus className="w-4 h-4 text-white" />
                      </motion.div>
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Full Name</FieldLabel>
                    <div className="relative">
                      <User className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={form.full_name}
                        onChange={(e) => update('full_name', e.target.value)}
                        placeholder="John Doe"
                        className={fieldClassIcon}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Phone Number</FieldLabel>
                    <div className="relative">
                      <Phone className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={form.phone}
                        onChange={(e) => update('phone', e.target.value)}
                        placeholder="024 XXX XXXX"
                        className={fieldClassIcon}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 italic mt-1">* Must match Mobile Money account name</p>
                  </div>

                  <div>
                    <FieldLabel>Ghana Card Number</FieldLabel>
                    <div className="relative">
                      <IdCard className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={form.ghana_card_number}
                        onChange={(e) => update('ghana_card_number', e.target.value)}
                        placeholder="GHA-123456789-0"
                        className={fieldClassIcon}
                      />
                    </div>
                  </div>

                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                      Have the rider set their own login PIN
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel>Set PIN</FieldLabel>
                        <div className="relative">
                          <Lock className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                          <input
                            type="password"
                            inputMode="numeric"
                            maxLength={4}
                            value={form.pin}
                            onChange={(e) => update('pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
                            placeholder="••••"
                            className={`${fieldClassIcon} tracking-[0.4em]`}
                          />
                        </div>
                      </div>
                      <div>
                        <FieldLabel>Confirm PIN</FieldLabel>
                        <input
                          type="password"
                          inputMode="numeric"
                          maxLength={4}
                          value={form.confirm_pin}
                          onChange={(e) => update('confirm_pin', e.target.value.replace(/\D/g, '').slice(0, 4))}
                          placeholder="••••"
                          className={`${fieldClass} tracking-[0.4em]`}
                        />
                      </div>
                    </div>
                    {form.confirm_pin.length === 4 && form.pin !== form.confirm_pin && (
                      <p className="text-[11px] text-red-500 font-medium mt-1.5">PINs don't match</p>
                    )}
                  </div>
                </>
              )}

              {/* ── Step 2: Work Details ── */}
              {stepIndex === 1 && (
                <>
                  <div>
                    <FieldLabel>Transport Type</FieldLabel>
                    <div className="grid grid-cols-3 gap-2">
                      {TRANSPORT_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const isActive = form.transport_type === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            onClick={() => update('transport_type', opt.key)}
                            className="relative py-3 rounded-xl flex flex-col items-center gap-1.5 overflow-hidden"
                          >
                            {isActive && (
                              <motion.div
                                layoutId="transport-highlight"
                                className="absolute inset-0 bg-[#7a1d1d] rounded-xl"
                                transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                              />
                            )}
                            <Icon className={`w-4 h-4 relative z-10 transition-colors ${isActive ? 'text-white' : 'text-gray-400'}`} />
                            <span className={`text-[10px] font-bold uppercase relative z-10 transition-colors ${isActive ? 'text-white' : 'text-gray-500'}`}>
                              {opt.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Home Area / Location</FieldLabel>
                    <div className="relative">
                      <MapPin className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={form.home_area}
                        onChange={(e) => update('home_area', e.target.value)}
                        placeholder="East Legon, Accra"
                        className={fieldClassIcon}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ── Step 3: Emergency Contact ── */}
              {stepIndex === 2 && (
                <>
                  <div>
                    <FieldLabel>Contact Name</FieldLabel>
                    <input
                      value={form.emergency_contact_name}
                      onChange={(e) => update('emergency_contact_name', e.target.value)}
                      placeholder="Full Name"
                      className={fieldClass}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Phone Number</FieldLabel>
                      <input
                        value={form.emergency_contact_phone}
                        onChange={(e) => update('emergency_contact_phone', e.target.value)}
                        placeholder="024 XXX XXXX"
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <FieldLabel>Relationship</FieldLabel>
                      <input
                        value={form.emergency_contact_relationship}
                        onChange={(e) => update('emergency_contact_relationship', e.target.value)}
                        placeholder="Brother"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* ── Step 4: Float / Deposit + Status ── */}
              {stepIndex === 3 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Deposit Collected</FieldLabel>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#7a1d1d]">GH₵</span>
                        <input
                          type="number"
                          value={form.deposit_amount}
                          onChange={(e) => update('deposit_amount', e.target.value)}
                          placeholder="200.00"
                          className="w-full bg-[#faf6ee] border border-gray-200 rounded-xl pl-11 pr-3 py-3 text-sm outline-none transition-all focus:border-[#7a1d1d]/50 focus:bg-white focus:shadow-[0_0_0_3px_rgba(122,29,29,0.08)]"
                        />
                      </div>
                    </div>
                    <div>
                      <FieldLabel>Date Collected</FieldLabel>
                      <input
                        type="date"
                        value={form.deposit_date}
                        onChange={(e) => update('deposit_date', e.target.value)}
                        className={fieldClass}
                      />
                    </div>
                  </div>

                  <div>
                    <FieldLabel>Notes (Optional)</FieldLabel>
                    <div className="relative">
                      <StickyNote className="w-4 h-4 text-gray-400 absolute left-4 top-4" />
                      <textarea
                        value={form.notes}
                        onChange={(e) => update('notes', e.target.value)}
                        placeholder="Any additional remarks..."
                        rows={3}
                        className={`${fieldClassIcon} resize-none`}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-gray-100">
                    <div>
                      <p className="font-bold text-sm">Active</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                        Controls whether they show up as available to accept orders.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => update('is_active', !form.is_active)}
                      className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${form.is_active ? 'bg-[#7a1d1d]' : 'bg-gray-300'}`}
                    >
                      <motion.span
                        layout
                        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                        className="absolute top-1 w-5 h-5 rounded-full bg-white shadow-md"
                        style={{ left: form.is_active ? 22 : 4 }}
                      />
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* ── Sticky footer: Back / Next / Add Rider ── */}
      <div className="sticky bottom-0 bg-[#fefaf4]/95 backdrop-blur-sm border-t border-gray-200 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+16px)] shrink-0">
        <div className="max-w-md mx-auto flex gap-3">
          {stepIndex > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="px-6 py-4 rounded-2xl font-bold text-sm bg-white border border-gray-200 text-gray-600 active:scale-95 transition-transform"
            >
              Back
            </button>
          )}

          {!isLastStep ? (
            <motion.button
              type="button"
              onClick={goNext}
              disabled={!isStepValid()}
              whileTap={{ scale: 0.98 }}
              className="flex-1 bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-40"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          ) : (
            <motion.button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              whileTap={{ scale: 0.98 }}
              className="flex-1 bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-70"
            >
              <AnimatePresence mode="wait">
                {submitting ? (
                  <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Adding Rider...
                  </motion.span>
                ) : (
                  <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    Add Rider
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )}
        </div>
      </div>
    </div>
  );
}