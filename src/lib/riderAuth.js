import { supabase } from './supabase';

export async function riderLogin(phone, pin) {
  const syntheticEmail = `${phone}@riders.waakyeplug.app`;
  const realPassword = `${pin}${phone.slice(-4)}`;

  const { data, error } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: realPassword,
  });

  if (error) throw new Error('Incorrect phone number or PIN');

  const { data: rider, error: riderError } = await supabase
    .from('riders')
    .select('*, profiles(full_name, phone)')
    .eq('profile_id', data.user.id)
    .single();

  if (riderError || !rider) throw new Error('No rider profile found for this account');
  if (!rider.is_approved) throw new Error('Your account is pending approval');

  return rider;
}

// Checks whether a Supabase session already exists (e.g. after a page
// reload) and, if so, restores the full rider record from it — this is
// what stops a reload from bouncing an already-logged-in rider back to
// the Login screen for no reason.
export async function getCurrentRider() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data: rider, error } = await supabase
    .from('riders')
    .select('*, profiles(full_name, phone)')
    .eq('profile_id', session.user.id)
    .single();

  if (error || !rider || !rider.is_approved) return null;
  return rider;
}

export async function resetPin(phone, ghanaCardNumber, newPin) {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/reset-pin`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ phone, ghana_card_number: ghanaCardNumber, new_pin: newPin }),
    }
  );

  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Could not reset PIN');
  return result;
}