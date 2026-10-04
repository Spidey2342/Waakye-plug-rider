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
  MapPin,
  StickyNote,
  ArrowRight,
  Loader2,
  Check,
  Lock,
  X,
} from 'lucide-react';
import {
  isValidGhPhone,
  isWeakPin,
  restrictNotesInput,
  restrictPersonNameInput,
  restrictPhoneInput,
  restrictPinInput,
} from '../../lib/formValidation';
import { APP_ICON_SRC } from '../../lib/constants';
import { loadFilePreview, readPickedImageFile } from '../../lib/imagePick';

const STEPS = ['Your Details', 'ID Verification', 'Work Details', 'Emergency Contact', 'Almost Done'];

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

function PhotoCaptureTile({ label, hint, preview, capture, onPick, onError }) {
  return (
    <div className="flex flex-col items-center">
      <label className="w-full aspect-[4/3] max-h-36 rounded-2xl border-2 border-dashed border-gray-300 bg-[#faf6ee] flex flex-col items-center justify-center gap-1 overflow-hidden cursor-pointer active:scale-[0.98] transition-transform relative">
        {preview ? (
          <img src={preview} className="w-full h-full object-cover" alt={label} />
        ) : (
          <>
            <Camera className="w-7 h-7 text-gray-400" />
            <span className="text-[10px] font-bold text-gray-500 uppercase text-center px-2">{label}</span>
          </>
        )}
        <input
          type="file"
          accept="image/*"
          capture={capture}
          onChange={async (e) => {
            try {
              const file = readPickedImageFile(e.target);
              if (!file) return;
              const url = await loadFilePreview(file);
              onPick(file, url);
            } catch (err) {
              onError(err.message || 'Could not use that photo.');
              e.target.value = '';
            }
          }}
          className="hidden"
        />
        {!preview && (
          <span className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-[#7a1d1d] flex items-center justify-center shadow-md pointer-events-none">
            <Plus className="w-4 h-4 text-white" />
          </span>
        )}
      </label>
      {hint && <p className="text-[10px] text-gray-400 text-center mt-1.5 leading-snug px-1">{hint}</p>}
    </div>
  );
}

export function AddRiderScreen({ onBack, onSubmit, mode = 'admin', error, onErrorDismiss }) {
  const isApply = mode === 'apply';

  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [pickError, setPickError] = useState(null);
  const [previews, setPreviews] = useState({
    selfie: null,
    ghana_card_front: null,
    ghana_card_back: null,
  });

  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    pin: '',
    confirm_pin: '',
    selfie: null,
    ghana_card_front: null,
    ghana_card_back: null,
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

  function setKycPhoto(field, file, previewUrl) {
    setPickError(null);
    update(field, file);
    setPreviews((p) => ({ ...p, [field]: previewUrl }));
  }

  function isStepValid() {
    if (stepIndex === 0) {
      return (
        form.full_name.trim().length >= 2 &&
        isValidGhPhone(form.phone) &&
        form.pin.length === 4 &&
        form.pin === form.confirm_pin &&
        !isWeakPin(form.pin)
      );
    }
    if (stepIndex === 1) {
      return form.selfie && form.ghana_card_front && form.ghana_card_back;
    }
    if (stepIndex === 2) return form.home_area.trim().length >= 2;
    if (stepIndex === 3) {
      const ecPhone = form.emergency_contact_phone.trim();
      if (ecPhone && !isValidGhPhone(ecPhone)) return false;
      return true;
    }
    if (!isApply && stepIndex === 4) {
      const amt = form.deposit_amount;
      if (amt !== '' && (Number.isNaN(Number(amt)) || Number(amt) < 0)) return false;
    }
    return true;
  }

  function goNext() {
    if (!isStepValid()) return;
    if (onErrorDismiss) onErrorDismiss();
    setDirection(1);
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  function goBack() {
    if (onErrorDismiss) onErrorDismiss();
    if (stepIndex === 0) {
      onBack();
      return;
    }
    setDirection(-1);
    setStepIndex((i) => i - 1);
  }

  async function handleSubmit() {
    if (onErrorDismiss) onErrorDismiss();
    setSubmitting(true);
    try {
      await onSubmit(form);
    } catch {
      // Error surfaces via the `error` prop (inline banner above).
    } finally {
      setSubmitting(false);
    }
  }

  const isLastStep = stepIndex === STEPS.length - 1;

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">

      <div className="sticky top-0 z-20 bg-[#fefaf4]/95 backdrop-blur-sm border-b border-gray-200 shrink-0">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={goBack}
            className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center active:scale-90 transition-transform"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-lg">{isApply ? 'Apply to Ride' : 'Add Rider'}</h1>
          <img
            src={APP_ICON_SRC}
            alt=""
            className="w-9 h-9 rounded-full object-cover bg-white border border-gray-200"
          />
        </div>

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
              {stepIndex === 0 && (
                <>
                  <div>
                    <FieldLabel>Full Name</FieldLabel>
                    <div className="relative">
                      <User className="w-4 h-4 text-gray-400 absolute left-4 top-1/2 -translate-y-1/2" />
                      <input
                        value={form.full_name}
                        onChange={(e) => update('full_name', restrictPersonNameInput(e.target.value))}
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
                        onChange={(e) => update('phone', restrictPhoneInput(e.target.value))}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="024 XXX XXXX"
                        className={fieldClassIcon}
                      />
                    </div>
                    <p className="text-[11px] text-gray-400 italic mt-1">* Must match Mobile Money account name</p>
                  </div>

                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                      {isApply ? 'Choose a login PIN' : "Have the rider set their own login PIN"}
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
                            onChange={(e) => update('pin', restrictPinInput(e.target.value))}
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
                          onChange={(e) => update('confirm_pin', restrictPinInput(e.target.value))}
                          placeholder="••••"
                          className={`${fieldClass} tracking-[0.4em]`}
                        />
                      </div>
                    </div>
                    {form.confirm_pin.length === 4 && form.pin !== form.confirm_pin && (
                      <p className="text-[11px] text-red-500 font-medium mt-1.5">PINs don't match</p>
                    )}
                    {form.pin.length === 4 && form.confirm_pin.length === 4 && form.pin === form.confirm_pin && isWeakPin(form.pin) && (
                      <p className="text-[11px] text-red-500 font-medium mt-1.5">
                        Choose a stronger PIN — avoid repeats (1111) or sequences (1234).
                      </p>
                    )}
                    {isApply && (
                      <p className="text-[11px] text-gray-400 mt-1.5">
                        You'll use this to log in once your application is approved.
                      </p>
                    )}
                  </div>
                </>
              )}

              {stepIndex === 1 && (
                <>
                  <div>
                    <p className="font-bold text-base mb-1">Verify your identity</p>
                    <p className="text-xs text-gray-500 mb-4 leading-relaxed">
                      Take a clear selfie and photos of the front and back of your Ghana Card. Make sure details are readable and glare-free.
                    </p>
                    <div className="grid grid-cols-1 gap-3">
                      <PhotoCaptureTile
                        label="Selfie"
                        hint="Face the camera, good lighting"
                        preview={previews.selfie}
                        capture="user"
                        onPick={(file, url) => setKycPhoto('selfie', file, url)}
                        onError={setPickError}
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <PhotoCaptureTile
                          label="Card front"
                          hint="All corners visible"
                          preview={previews.ghana_card_front}
                          capture="environment"
                          onPick={(file, url) => setKycPhoto('ghana_card_front', file, url)}
                          onError={setPickError}
                        />
                        <PhotoCaptureTile
                          label="Card back"
                          hint="All corners visible"
                          preview={previews.ghana_card_back}
                          capture="environment"
                          onPick={(file, url) => setKycPhoto('ghana_card_back', file, url)}
                          onError={setPickError}
                        />
                      </div>
                    </div>
                    {pickError && (
                      <p className="text-[11px] text-red-500 font-medium mt-2">{pickError}</p>
                    )}
                  </div>
                </>
              )}

              {stepIndex === 2 && (
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

              {stepIndex === 3 && (
                <>
                  <div>
                    <FieldLabel>Contact Name</FieldLabel>
                    <input
                      value={form.emergency_contact_name}
                      onChange={(e) => update('emergency_contact_name', restrictPersonNameInput(e.target.value))}
                      placeholder="Full Name"
                      className={fieldClass}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <FieldLabel>Phone Number</FieldLabel>
                      <input
                        value={form.emergency_contact_phone}
                        onChange={(e) => update('emergency_contact_phone', restrictPhoneInput(e.target.value))}
                        inputMode="tel"
                        placeholder="024 XXX XXXX"
                        className={fieldClass}
                      />
                    </div>
                    <div>
                      <FieldLabel>Relationship</FieldLabel>
                      <input
                        value={form.emergency_contact_relationship}
                        onChange={(e) => update('emergency_contact_relationship', restrictPersonNameInput(e.target.value))}
                        placeholder="Brother"
                        className={fieldClass}
                      />
                    </div>
                  </div>
                </>
              )}

              {stepIndex === 4 && (
                isApply ? (
                  <>
                    <div className="text-center pb-2">
                      <p className="font-bold text-base mb-1">Almost done!</p>
                      <p className="text-sm text-gray-500 leading-relaxed">
                        We'll review your application and reach out to arrange next steps, including your starter deposit.
                      </p>
                    </div>
                    <div>
                      <FieldLabel>Anything else you'd like us to know? (Optional)</FieldLabel>
                      <div className="relative">
                        <StickyNote className="w-4 h-4 text-gray-400 absolute left-4 top-4" />
                        <textarea
                          value={form.notes}
                          onChange={(e) => update('notes', restrictNotesInput(e.target.value))}
                          placeholder="e.g. availability, experience..."
                          maxLength={500}
                          rows={4}
                          className={`${fieldClassIcon} resize-none`}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel>Deposit Collected</FieldLabel>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#7a1d1d]">GH₵</span>
                          <input
                            type="number"
                            value={form.deposit_amount}
                            onChange={(e) => {
                              const v = e.target.value.replace(/[^\d.]/g, '');
                              const parts = v.split('.');
                              const normalized =
                                parts.length <= 1 ? parts[0] : `${parts[0]}.${parts.slice(1).join('').slice(0, 2)}`;
                              update('deposit_amount', normalized);
                            }}
                            min="0"
                            step="0.01"
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
                          onChange={(e) => update('notes', restrictNotesInput(e.target.value))}
                          placeholder="Any additional remarks..."
                          maxLength={500}
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
                )
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {error && (
        <div className="px-4 pb-2">
          <div className="max-w-md mx-auto flex items-start justify-between gap-3 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <p className="text-sm text-red-700 leading-snug">{error}</p>
            <button
              type="button"
              onClick={onErrorDismiss}
              className="text-red-400 hover:text-red-600 shrink-0 mt-0.5"
              aria-label="Dismiss error"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

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
              disabled={submitting || !isStepValid()}
              whileTap={{ scale: 0.98 }}
              className="flex-1 bg-[#7a1d1d] text-white py-4 rounded-2xl font-bold text-base flex items-center justify-center gap-2 disabled:opacity-70"
            >
              <AnimatePresence mode="wait">
                {submitting ? (
                  <motion.span key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isApply ? 'Submitting...' : 'Adding Rider...'}
                  </motion.span>
                ) : (
                  <motion.span key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    {isApply ? 'Submit Application' : 'Add Rider'}
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