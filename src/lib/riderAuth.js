import { supabase } from './supabase';

// PIN verification now happens inside the `rider-login` edge function with
// DB-backed rate limiting (5 wrong tries per phone / 15 min, plus an IP cap)
// — the raw 4-digit PIN space is no longer guessable with the public anon
// key (audit S1). This client just relays phone + PIN and restores the
// session the server hands back.
export async function riderLogin(phone, pin) {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rider-login`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ phone, pin }),
    }
  );

  const result = await res.json();

  if (!res.ok) throw new Error(result.error || 'Incorrect phone number or PIN');

  // Restore the server-created session so supabase-js (realtime, RLS-scoped
  // queries, storage) behaves exactly as it did with a client-side login.
  const { error: sessionError } = await supabase.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  });
  if (sessionError) throw new Error('Logged in, but the session could not be restored. Try again.');

  return result.rider;
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
