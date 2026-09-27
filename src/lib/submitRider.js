/**
 * Submits rider onboarding / self-apply with KYC photos (multipart).
 * @param {object} formData — from AddRiderScreen state
 * @param {{ isSelfApply?: boolean, accessToken?: string|null }} options
 */
export async function submitRiderApplication(formData, { isSelfApply = false, accessToken = null } = {}) {
  const body = new FormData();
  body.append('full_name', formData.full_name.trim());
  body.append('phone', formData.phone.trim());
  body.append('pin', formData.pin);
  body.append('transport_type', formData.transport_type || 'motorbike');
  body.append('home_area', formData.home_area.trim());
  body.append('emergency_contact_name', formData.emergency_contact_name.trim());
  body.append('emergency_contact_phone', formData.emergency_contact_phone.trim());
  if (isSelfApply) body.append('is_self_apply', 'true');
  if (!isSelfApply && formData.deposit_amount !== '') {
    body.append('deposit_amount', String(formData.deposit_amount));
  }

  body.append('selfie', formData.selfie);
  body.append('ghana_card_front', formData.ghana_card_front);
  body.append('ghana_card_back', formData.ghana_card_back);

  const headers = {
    Authorization: `Bearer ${accessToken || import.meta.env.VITE_SUPABASE_ANON_KEY}`,
  };

  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-rider`, {
    method: 'POST',
    headers,
    body,
  });

  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(result.error || 'Request failed');
  }
  return result;
}
