import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { rider_id } = await req.json();
    if (!rider_id) {
      return new Response(
        JSON.stringify({ error: 'rider_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: rider, error: riderFetchError } = await supabaseAdmin
      .from('riders')
      .select('profile_id')
      .eq('id', rider_id)
      .single();

    if (riderFetchError || !rider) {
      return new Response(
        JSON.stringify({ error: 'Rider application not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('riders').delete().eq('id', rider_id);
    await supabaseAdmin.from('profiles').delete().eq('id', rider.profile_id);

    const { error: authDeleteError } = await supabaseAdmin.auth.admin.deleteUser(rider.profile_id);

    if (authDeleteError) {
      return new Response(
        JSON.stringify({ error: `Application removed, but the login account could not be deleted: ${authDeleteError.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});