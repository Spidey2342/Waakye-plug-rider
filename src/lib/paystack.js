const PAYSTACK_SCRIPT_URL = 'https://js.paystack.co/v1/inline.js';

function loadPaystackScript() {
  return new Promise((resolve, reject) => {
    if (window.PaystackPop) return resolve();
    const script = document.createElement('script');
    script.src = PAYSTACK_SCRIPT_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Paystack — check your internet connection.'));
    document.body.appendChild(script);
  });
}

function resolvePaystackPublicKey() {
  const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY?.trim();
  if (!publicKey) {
    throw new Error(
      'Settlement payments are not configured yet (missing the Paystack public key). Please contact support and tell them the wallet is not set up on your build.'
    );
  }
  if (!publicKey.startsWith('pk_live_') && !publicKey.startsWith('pk_test_')) {
    throw new Error('Invalid Paystack public key — it should start with pk_live_ or pk_test_.');
  }
  if (import.meta.env.PROD && publicKey.startsWith('pk_test_')) {
    throw new Error(
      'Paystack is still on TEST keys in production. Set VITE_PAYSTACK_PUBLIC_KEY to pk_live_… on Vercel and redeploy.'
    );
  }
  return publicKey;
}

export async function payWithPaystack({ email, amountGHS, reference, onSuccess, onClose }) {
  await loadPaystackScript();

  const publicKey = resolvePaystackPublicKey();

  const handler = window.PaystackPop.setup({
    key: publicKey,
    email,
    amount: Math.round(amountGHS * 100),
    currency: 'GHS',
    ref: reference,
    callback: (response) => onSuccess(response.reference),
    onClose,
  });

  handler.openIframe();
}