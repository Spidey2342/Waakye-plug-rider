/** Path under `public/` — served as /new-order-alert.mp3 */
export const NEW_ORDER_ALERT_SRC = '/new-order-alert.mp3';

let audioPrimed = false;
/** @type {AudioContext | null} */
let sharedAudioCtx = null;

export function isOrderAlertAudioReady() {
  return audioPrimed;
}

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
  return sharedAudioCtx;
}

/**
 * Must run synchronously inside a user gesture (tap Log In, Go Online, Enable sound).
 * Async work after this breaks autoplay on iOS / Chrome.
 */
export function unlockOrderAlertAudio() {
  if (typeof window === 'undefined') return Promise.resolve(false);

  const ctx = getAudioContext();
  if (ctx?.state === 'suspended') {
    void ctx.resume();
  }

  const audio = new Audio(NEW_ORDER_ALERT_SRC);
  audio.preload = 'auto';
  audio.volume = 1;

  return audio
    .play()
    .then(() => {
      audio.pause();
      audio.currentTime = 0;
      audioPrimed = true;
      return true;
    })
    .catch(() => {
      audioPrimed = false;
      return false;
    });
}

export function playNewOrderSound() {
  if (typeof window === 'undefined') return;

  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate([200, 100, 200, 100, 400]);
  }

  const audio = new Audio(NEW_ORDER_ALERT_SRC);
  audio.volume = 1;
  audio.currentTime = 0;

  const playPromise = audio.play();
  if (!playPromise) {
    playFallbackBeep();
    return;
  }

  playPromise.catch(() => {
    playFallbackBeep();
  });
}

function playFallbackBeep() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const start = () => {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  };

  if (ctx.state === 'suspended') {
    void ctx.resume().then(start).catch(() => {});
  } else {
    start();
  }
}

/** Play once so the rider can confirm alerts work (call from a button tap). */
export function testOrderAlertSound() {
  return unlockOrderAlertAudio().then((ok) => {
    playNewOrderSound();
    return ok || audioPrimed;
  });
}

export async function requestOrderNotificationPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * @param {{ id: string; vendors?: { business_name?: string }; delivery_fee?: number }[]} newOrders
 */
export function alertRiderNewOrders(newOrders) {
  if (!newOrders.length) return;

  playNewOrderSound();

  const count = newOrders.length;
  const first = newOrders[0];
  const vendor = first.vendors?.business_name ?? 'New order';
  const fee = first.delivery_fee != null ? ` · GH₵${first.delivery_fee} delivery` : '';

  if (typeof document !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    const body =
      count === 1
        ? `${vendor}${fee} — tap to accept.`
        : `${count} new orders near you — open the app to accept.`;
    try {
      new Notification(count === 1 ? 'New delivery available' : `${count} new deliveries`, {
        body,
        tag: 'waakye-new-order',
        renotify: true,
      });
    } catch {
      // Some browsers reject renotify; sound still attempted above.
    }
  }
}
