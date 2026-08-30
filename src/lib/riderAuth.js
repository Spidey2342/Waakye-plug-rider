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