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

export async function payWithPaystack({ email, amountGHS, reference, onSuccess, onClose }) {
  await loadPaystackScript();

  const publicKey = import.meta.env.VITE_PAYSTACK_PUBLIC_KEY;
  if (!publicKey) throw new Error('Missing VITE_PAYSTACK_PUBLIC_KEY in .env');

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