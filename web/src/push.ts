import { api, type PushKeys } from './api/client';

/**
 * Talking to the browser's push subscription.
 *
 * Two things have to agree for a notification to arrive: the browser holds a
 * subscription with the push service, and we hold the same one server-side. They
 * drift on their own (a browser can drop a subscription, and clearing site data
 * takes ours with it), so everything here re-reads the browser's state rather
 * than trusting a stored flag.
 */

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/**
 * iOS and iPadOS only expose push to a web app that has been added to the home
 * screen, and report no support at all otherwise. Worth saying out loud rather
 * than letting the toggle look broken.
 *
 * An iPad calls itself a Macintosh, so the user agent alone cannot tell them
 * apart; a Mac has no touch points, which is what separates them.
 */
export function needsInstall(): boolean {
  const agent = navigator.userAgent;
  const apple =
    /iP(hone|ad|od)/.test(agent) || (/Macintosh/.test(agent) && navigator.maxTouchPoints > 1);
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return apple && !installed;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

/** Asks for permission if needed, subscribes, and registers it with the server. */
export async function enablePush(): Promise<void> {
  // Asked before anything else is awaited: Safari only honours the prompt while
  // the gesture that triggered it is still on the stack.
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('denied');

  const registration = await workerReady();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      // Every payload we send carries a visible notification, which is what the
      // browsers that require this flag are asking us to promise.
      userVisibleOnly: true,
      applicationServerKey: decodeKey((await api.pushKey()).publicKey),
    }));

  await api.subscribePush(keysOf(subscription));
}

export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;

  // Server first: if unsubscribing succeeds but the call fails, we would keep
  // sending to an endpoint that no longer exists.
  await api.unsubscribePush(keysOf(subscription));
  await subscription.unsubscribe();
}

/**
 * `serviceWorker.ready` never rejects: with nothing registered it simply never
 * settles, which would leave the toggle stuck half-way with no way back.
 */
function workerReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('no-worker')), 10_000),
    ),
  ]);
}

function keysOf(subscription: PushSubscription): PushKeys {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? '',
    auth: json.keys?.auth ?? '',
  };
}

/** The subscribe call wants the raw bytes, not the base64url the server sends. */
function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
