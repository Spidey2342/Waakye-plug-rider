// E2E regression test for the rider settlement dedupe fix.
// Creates a throwaway rider, logs in through rider-login, calls
// create-settlement TWICE, asserts ONE pending row + SAME reference, then
// cleans up ALL test data. Run: node scripts/test-settlement-dedupe.cjs
const fs = require('node:fs');

const URL = 'https://verncapitxzsgcughvil.supabase.co';
const svc = fs.readFileSync('C:/Users/user/supabase-cli/waakye-service.txt', 'utf8').trim();
const anon = (() => {
  const line = fs.readFileSync('C:/Users/user/Desktop/Waakye-plug-rider/.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('VITE_SUPABASE_ANON_KEY='));
  return line.slice('VITE_SUPABASE_ANON_KEY='.length);
})();

const PHONE = '0550000017';
const PIN = '1234';
const syntheticEmail = `${PHONE}@riders.waakyeplug.app`;
const realPassword = `${PIN}${PHONE.slice(-4)}`;

const svcH = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const anonH = { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };

const out = (...a) => console.log('[test]', ...a);
let authUid = null;
let riderRowId = null;

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function createAuthUser() {
  const res = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: svcH,
    body: JSON.stringify({ email: syntheticEmail, password: realPassword, email_confirm: true }),
  });
  const body = await res.json();
  assert(res.ok && body?.id, `auth user create failed: ${JSON.stringify(body)}`);
  authUid = body.id;
  out('auth user:', authUid);
}

async function seedDbRows() {
  const p = await fetch(`${URL}/rest/v1/profiles`, {
    method: 'POST',
    headers: svcH,
    body: JSON.stringify({ id: authUid, full_name: 'TEST WALLET FIX', phone: PHONE, email: syntheticEmail, role: 'rider' }),
  });
  if (!p.ok) throw new Error(`profiles insert failed: ${await p.text()}`);

  const r = await fetch(`${URL}/rest/v1/riders`, {
    method: 'POST',
    headers: svcH,
    body: JSON.stringify({ profile_id: authUid, status: 'offline', is_approved: true, commission_owed: 1.0 }),
  });
  if (!r.ok) throw new Error(`riders insert failed: ${await r.text()}`);
  const rider = (await r.json())[0];
  riderRowId = rider.id;
  out('rider row:', riderRowId);
}

async function login() {
  const res = await fetch(`${URL}/functions/v1/rider-login`, {
    method: 'POST',
    headers: anonH,
    body: JSON.stringify({ phone: PHONE, pin: PIN }),
  });
  const body = await res.json();
  assert(res.ok && body?.session?.access_token, `login failed: ${JSON.stringify(body)}`);
  out('login OK');
  return body.session.access_token;
}

async function createSettlement(token) {
  const res = await fetch(`${URL}/functions/v1/create-settlement`, {
    method: 'POST',
    headers: { ...anonH, Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  const body = await res.json();
  out('create-settlement status', res.status);
  return body;
}

async function verifySettlement(token, reference) {
  const res = await fetch(`${URL}/functions/v1/verify-settlement`, {
    method: 'POST',
    headers: { ...anonH, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reference }),
  });
  const body = await res.json();
  out('verify-settlement (unpaid ref) status', res.status, JSON.stringify(body).slice(0, 160));
  return res.status;
}

async function pendingRows() {
  const res = await fetch(`${URL}/rest/v1/rider_settlements?rider_id=eq.${riderRowId}&select=id,paystack_reference,status,total_commission_owed&order=created_at.asc`, {
    headers: svcH,
  });
  return await res.json();
}

async function cleanup() {
  if (riderRowId) {
    await fetch(`${URL}/rest/v1/rider_settlements?rider_id=eq.${riderRowId}`, { method: 'DELETE', headers: svcH });
    await fetch(`${URL}/rest/v1/riders?profile_id=eq.${authUid}`, { method: 'DELETE', headers: svcH });
  }
  if (authUid) {
    await fetch(`${URL}/rest/v1/profiles?id=eq.${authUid}`, { method: 'DELETE', headers: svcH });
    await fetch(`${URL}/auth/v1/admin/users/${authUid}`, { method: 'DELETE', headers: svcH });
  }
  out('cleanup done');
}

(async () => {
  try {
    await createAuthUser();
    await seedDbRows();
    const token = await login();

    const first = await createSettlement(token);
    assert(first?.reference, `first intent failed: ${JSON.stringify(first)}`);
    assert(Number(first.amount) === 1, `amount should be 1.00, got ${first.amount}`);
    out('first reference:', first.reference, 'reused:', first.reused);

    const second = await createSettlement(token);
    assert(second?.reused === true, 'second call must be flagged reused:true');
    assert(second.reference === first.reference, 'second call must return the SAME reference');
    assert(Number(second.amount) === 1, `second amount should stay 1.00, got ${second.amount}`);
    out('second reference (must equal first):', second.reference);

    const rows = await pendingRows();
    out('pending rows in DB now:', rows.length);
    assert(rows.length === 1, `expected exactly ONE pending row, found ${rows.length}`);
    assert(rows[0].paystack_reference === first.reference, 'the single row must carry the shared reference');

    // Wiring check: verify-settlement with an unpaid reference must answer a
    // clean 4xx (Paystack "no such transaction"), not a 500.
    const verifyStatus = await verifySettlement(token, first.reference);
    assert(verifyStatus >= 400 && verifyStatus < 500, `expected clean 4xx from verify on unpaid ref, got ${verifyStatus}`);

    out('RESULT: dedupe fix verified — one pending row, one stable reference.');
    await cleanup();
    process.exit(0);
  } catch (err) {
    out('FAILED:', err.message);
    await cleanup();
    process.exit(1);
  }
})();