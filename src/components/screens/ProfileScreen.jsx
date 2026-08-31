'use client';

import { useState } from 'react';
import { motion } from 'motion/react';
import {
  User,
  Phone,
  MapPin,
  IdCard,
  Bike,
  Footprints,
  Users,
  LogOut,
  Home,
  History,
  Wallet,
  Loader2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';

function InfoRow({ icon: Icon, label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="w-9 h-9 rounded-xl bg-[#faf6ee] flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-[#7a1d1d]" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="font-medium text-sm truncate">{value}</p>
      </div>
    </div>
  );
}

export function ProfileScreen({ rider, onNavigate, onLoggedOut }) {
  const [loggingOut, setLoggingOut] = useState(false);

  const fullName = rider?.profiles?.full_name ?? 'Rider';
  const phone = rider?.profiles?.phone;
  const photoUrl = rider?.photo_url;

  const transportLabel =
    rider?.transport_type === 'motorbike' ? 'Motorbike' :
    rider?.transport_type === 'bicycle' ? 'Bicycle' :
    rider?.transport_type === 'foot' ? 'On Foot' : null;

  const TransportIcon = rider?.transport_type === 'foot' ? Footprints : Bike;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await supabase.auth.signOut();
      onLoggedOut();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-[#fefaf4] flex flex-col [webkit-tap-highlight-color:transparent]">
      <div className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-md mx-auto px-4 pt-6">

          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center text-center mb-6"
          >
            <div className="w-20 h-20 rounded-full bg-gray-200 overflow-hidden flex items-center justify-center mb-3">
              {photoUrl ? (
                <img src={photoUrl} alt={fullName} className="w-full h-full object-cover" />
              ) : (
                <User className="w-8 h-8 text-gray-400" />
              )}
            </div>
            <h1 className="text-xl font-extrabold">{fullName}</h1>
            {phone && <p className="text-sm text-gray-400 mt-0.5">{phone}</p>}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 mb-4"
          >
            <InfoRow icon={Phone} label="Phone Number" value={phone} />
            <InfoRow icon={TransportIcon} label="Transport" value={transportLabel} />
            <InfoRow icon={MapPin} label="Home Area" value={rider?.home_area} />
            <InfoRow icon={IdCard} label="Ghana Card" value={rider?.ghana_card_number} />
          </motion.div>

          {(rider?.emergency_contact_name || rider?.emergency_contact_phone) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 mb-4"
            >
              <InfoRow icon={Users} label="Emergency Contact" value={rider?.emergency_contact_name} />
              <InfoRow icon={Phone} label="Emergency Phone" value={rider?.emergency_contact_phone} />
            </motion.div>
          )}

          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full flex items-center justify-center gap-2 bg-white border border-red-100 text-red-500 font-bold text-sm py-3.5 rounded-2xl disabled:opacity-60"
          >
            {loggingOut ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Log Out
          </motion.button>

          <p className="text-center text-[10px] font-bold text-gray-300 uppercase tracking-wide mt-6">
            Waakye Plug Riders
          </p>
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
            const isActive = tab.key === 'profile';
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