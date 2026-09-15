import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Verifies the caller's JWT and confirms they hold an admin profile.
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

// Approves a pending rider application. This replaces the old direct
// `update is_approved = true` write from the admin panel — that write went
// through the public anon key, so once RLS is locked down it would fail, and
// before RLS is locked down anyone could self-approve. Going through this
// admin-verified function fixes both problems.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const adminCheck = await requireAdmin(req, supabaseAdmin);
    if (!adminCheck.ok) return adminCheck.response;

    const { rider_id } = await req.json();
    if (!rider_id) {
      return jsonResponse(400, { error: 'rider_id is required' });
    }

    const { data: rider, error: riderError } = await supabaseAdmin
      .from('riders')
      .update({ is_approved: true, status: 'approved' })
      .eq('id', rider_id)
      .select()
      .single();

    if (riderError || !rider) {
      return jsonResponse(404, { error: 'Rider application not found' });
    }

    return jsonResponse(200, { success: true, rider });
  } catch (err) {
    return jsonResponse(500, {
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
});
