import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const KYC_BUCKET = 'rider-kyc';
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function requireAdmin(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<{ ok: true; adminId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return { ok: false, response: jsonResponse(401, { error: 'Missing authorization token' }) };
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, response: jsonResponse(401, { error: 'Invalid or expired token' }) };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle();

  if (profileError || !profile || profile.role !== 'admin') {
    return { ok: false, response: jsonResponse(403, { error: 'Admin access required' }) };
  }

  return { ok: true, adminId: data.user.id };
}

type RiderPayload = {
  full_name: string;
  phone: string;
  pin: string;
  transport_type?: string;
  home_area?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  deposit_amount?: number;
  photo_url?: string | null;
  ghana_card_front_url?: string | null;
  ghana_card_back_url?: string | null;
  ghana_card_number?: string | null;
};

async function parseMultipartRiderRequest(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<
  | { ok: true; payload: RiderPayload; cleanupPaths: string[] }
  | { ok: false; response: Response }
> {
    const form = await req.formData();
    const full_name = String(form.get('full_name') ?? '').trim();
    const phone = String(form.get('phone') ?? '').trim();
    const pin = String(form.get('pin') ?? '');
    const transport_type = String(form.get('transport_type') ?? 'motorbike');
    const home_area = String(form.get('home_area') ?? '').trim();
    const emergency_contact_name = String(form.get('emergency_contact_name') ?? '').trim();
    const emergency_contact_phone = String(form.get('emergency_contact_phone') ?? '').trim();
    const depositRaw = form.get('deposit_amount');
    const deposit_amount =
      depositRaw != null && String(depositRaw) !== ''
        ? Number(depositRaw)
        : undefined;

    const selfie = form.get('selfie');
    const ghana_card_front = form.get('ghana_card_front');
    const ghana_card_back = form.get('ghana_card_back');

    if (!full_name || !phone || !pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return {
        ok: false,
        response: jsonResponse(400, {
          error: 'full_name, phone, and a 4-digit numeric pin are required',
        }),
      };
    }

    if (!(selfie instanceof File) || !(ghana_card_front instanceof File) || !(ghana_card_back instanceof File)) {
      return {
        ok: false,
        response: jsonResponse(400, {
          error: 'Selfie plus front and back photos of your Ghana Card are required',
        }),
      };
    }

    const folder = crypto.randomUUID();
    const cleanupPaths: string[] = [];

    try {
      const photo_url = await uploadKycPhoto(supabaseAdmin, folder, 'selfie', selfie);
      cleanupPaths.push(`${folder}/selfie`);
      const ghana_card_front_url = await uploadKycPhoto(supabaseAdmin, folder, 'front', ghana_card_front);
      cleanupPaths.push(`${folder}/front`);
      const ghana_card_back_url = await uploadKycPhoto(supabaseAdmin, folder, 'back', ghana_card_back);
      cleanupPaths.push(`${folder}/back`);

      return {
        ok: true,
        cleanupPaths,
        payload: {
          full_name,
          phone,
          pin,
          transport_type,
          home_area,
          emergency_contact_name,
          emergency_contact_phone,
          deposit_amount,
          photo_url,
          ghana_card_front_url,
          ghana_card_back_url,
          ghana_card_number: null,
        },
      };
    } catch (err) {
      await removeStoragePrefix(supabaseAdmin, folder);
      return {
        ok: false,
        response: jsonResponse(400, {
          error: err instanceof Error ? err.message : 'Could not upload ID photos',
        }),
      };
    }
}

async function parseRiderRequest(
  req: Request,
  supabaseAdmin: SupabaseClient
): Promise<
  | { ok: true; payload: RiderPayload; cleanupPaths: string[] }
  | { ok: false; response: Response }
> {
  const contentType = (req.headers.get('content-type') ?? '').toLowerCase();

  // Photo apply/onboard uses multipart. Only parse JSON when the client
  // explicitly sends application/json — otherwise req.json() tries to read
  // the multipart boundary (starts with "--") and throws a confusing error.
  const useJson = contentType.includes('application/json');
  if (!useJson) {
    return parseMultipartRiderRequest(req, supabaseAdmin);
  }

  const body = await req.json();
  const {
    full_name,
    phone,
    pin,
    photo_url,
    transport_type,
    ghana_card_number,
    home_area,
    emergency_contact_name,
    emergency_contact_phone,
    deposit_amount,
    ghana_card_front_url,
    ghana_card_back_url,
  } = body;

  if (!full_name || !phone || !pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
    return {
      ok: false,
      response: jsonResponse(400, {
        error: 'full_name, phone, and a 4-digit numeric pin are required',
      }),
    };
  }

  return {
    ok: true,
    cleanupPaths: [],
    payload: {
      full_name,
      phone,
      pin,
      photo_url: photo_url ?? null,
      transport_type,
      ghana_card_number: ghana_card_number ?? null,
      ghana_card_front_url: ghana_card_front_url ?? null,
      ghana_card_back_url: ghana_card_back_url ?? null,
      home_area,
      emergency_contact_name,
      emergency_contact_phone,
      deposit_amount,
    },
  };
}

async function uploadKycPhoto(
  supabaseAdmin: SupabaseClient,
  folder: string,
  slot: 'selfie' | 'front' | 'back',
  file: File
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Each upload must be a photo');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Each photo must be 5 MB or smaller');
  }

  const extFromName = file.name.split('.').pop()?.toLowerCase() ?? '';
  const ext =
    extFromName === 'png' || extFromName === 'webp' || extFromName === 'jpeg' || extFromName === 'jpg'
      ? extFromName === 'jpeg'
        ? 'jpg'
        : extFromName
      : file.type.includes('png')
        ? 'png'
        : file.type.includes('webp')
          ? 'webp'
          : 'jpg';

  const path = `${folder}/${slot}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(KYC_BUCKET).upload(path, bytes, {
    contentType: file.type || 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(error.message);

  const { data } = supabaseAdmin.storage.from(KYC_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function removeStoragePrefix(supabaseAdmin: SupabaseClient, folder: string) {
  const slots = ['selfie', 'front', 'back'];
  const exts = ['jpg', 'png', 'webp'];
  const paths = slots.flatMap((slot) => exts.map((ext) => `${folder}/${slot}.${ext}`));
  await supabaseAdmin.storage.from(KYC_BUCKET).remove(paths);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const parsed = await parseRiderRequest(req, supabaseAdmin);
    if (!parsed.ok) return parsed.response;

    const {
      full_name,
      phone,
      pin,
      photo_url,
      transport_type,
      ghana_card_number,
      ghana_card_front_url,
      ghana_card_back_url,
      home_area,
      emergency_contact_name,
      emergency_contact_phone,
      deposit_amount,
    } = parsed.payload;

    const adminCheck = await requireAdmin(req, supabaseAdmin);
    const isApprovedByAdmin = adminCheck.ok;

    const syntheticEmail = `${phone.trim()}@riders.waakyeplug.app`;
    const realPassword = `${pin}${phone.trim().slice(-4)}`;

    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: realPassword,
      email_confirm: true,
    });

    if (authError) {
      return jsonResponse(400, { error: authError.message });
    }

    const { error: profileError } = await supabaseAdmin.from('profiles').insert({
      id: authUser.user.id,
      full_name,
      phone: phone.trim(),
      email: syntheticEmail,
      role: 'rider',
    });

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return jsonResponse(400, { error: profileError.message });
    }

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .insert({
        profile_id: authUser.user.id,
        status: isApprovedByAdmin ? 'approved' : 'pending',
        is_approved: isApprovedByAdmin,
        photo_url,
        transport_type,
        ghana_card_number,
        ghana_card_front_url,
        ghana_card_back_url,
        home_area,
        emergency_contact_name,
        emergency_contact_phone,
        deposit_amount: deposit_amount ?? 0,
        deposit_collected_at:
          isApprovedByAdmin && deposit_amount ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (riderError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id);
      return jsonResponse(400, { error: riderError.message });
    }

    return jsonResponse(200, {
      success: true,
      rider,
      approved: isApprovedByAdmin,
      message: isApprovedByAdmin
        ? undefined
        : 'Application received — pending admin approval before login works.',
    });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
