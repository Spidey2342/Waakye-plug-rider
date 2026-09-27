/** Path under `public/` — served as /new-order-alert.mp3 */
export const NEW_ORDER_ALERT_SRC = '/new-order-alert.mp3';

/** @type {HTMLAudioElement | null} */
let alertAudio = null;

/** Call after a user gesture (e.g. Go Online) so mobile browsers allow sound. */
export function unlockOrderAlertAudio() {
  if (typeof window === 'undefined') return;
  if (!alertAudio) {
    alertAudio = new Audio(NEW_ORDER_ALERT_SRC);
    alertAudio.preload = 'auto';
  }
  // Prime playback on user gesture (required on iOS / Chrome).
  alertAudio.load();
  const playPromise = alertAudio.play();
  if (playPromise) {
    playPromise
      .then(() => {
        alertAudio.pause();
        alertAudio.currentTime = 0;
      })
      .catch(() => {});
  }
}

export function playNewOrderSound() {
  if (typeof window === 'undefined') return;
  if (!alertAudio) {
    alertAudio = new Audio(NEW_ORDER_ALERT_SRC);
    alertAudio.preload = 'auto';
  }
  alertAudio.currentTime = 0;
  const playPromise = alertAudio.play();
  if (playPromise) {
    playPromise.catch(() => {
      // Fallback if autoplay still blocked — silent beep via Web Audio.
      playFallbackBeep();
    });
  }
}

function playFallbackBeep() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  const ctx = new Ctx();
  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
  void ctx.close();
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
