// @ts-check
// Web Push on this phone (SECURITY.md §10, MENU-AND-SETTINGS.md §4.3). The browser is asked for
// permission only from a tap on "Let me reach you"; the subscription is made with the Worker's
// VAPID key and sent to it for this session. At start (`recheck`), a subscription made with an
// older key is made again (the key was replaced), and one the Worker hasn't had from this session
// is sent, so pushes keep arriving after a new sign-in. Off: unsubscribed here, removed there.
import { api, signedIn } from '/th/client.js';
import { store } from '/th/session.js';

/** Which session this phone's subscription was last sent for, with its endpoint. */
const SENT = 'th.push.sent';

export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** @returns {Promise<'unsupported' | 'blocked' | 'on' | 'off'>} */
export async function state() {
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

/** @param {ArrayBuffer | null} buf */
const b64u = (buf) =>
  buf
    ? btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    : '';
/** @param {string} s */
const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** @returns {Promise<string>} */
const serverKey = async () => (await signedIn((t) => api.call('/v1/push/key', { token: t }))).vapid_public_key;

async function marker() {
  try {
    return localStorage.getItem(SENT);
  } catch {
    return null;
  }
}
/** @param {string | null} value */
function mark(value) {
  try {
    if (value) localStorage.setItem(SENT, value);
    else localStorage.removeItem(SENT);
  } catch {}
}

/** @param {PushSubscription} sub */
async function send(sub) {
  const j = sub.toJSON();
  const body = { endpoint: j.endpoint, keys: { p256dh: j.keys?.p256dh, auth: j.keys?.auth } };
  await signedIn((t) => api.call('/v1/push/subscription', { method: 'PUT', token: t, body }));
  mark(`${(await store.read())?.session_id ?? ''}|${j.endpoint}`);
}

/** This phone's subscription under the Worker's current key, made (or made again) if needed.
 * @param {ServiceWorkerRegistration} reg */
async function current(reg) {
  const key = await serverKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub && b64u(sub.options.applicationServerKey) !== key) {
    await sub.unsubscribe();
    sub = null;
  }
  return { sub: sub ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(key) })), made: !sub };
}

/** From a tap only: asks for permission, subscribes, tells the Worker. */
export async function turnOn() {
  if ((await Notification.requestPermission()) !== 'granted') return state();
  await send((await current(await navigator.serviceWorker.ready)).sub);
  return 'on';
}

export async function turnOff() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  await (await reg?.pushManager.getSubscription())?.unsubscribe();
  mark(null);
  await signedIn((t) => api.call('/v1/push/subscription', { method: 'DELETE', token: t }));
}

/** One test push to this phone now; how many phones it went to (0 or 1). @returns {Promise<number>} */
export const test = async () => (await signedIn((t) => api.call('/v1/push/test', { method: 'POST', token: t }))).sent;

/** At start, when push is on: the subscription is under the current key and the Worker has it for this session. */
export async function recheck() {
  if (!supported() || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg || !(await reg.pushManager.getSubscription())) return;
  const { sub, made } = await current(reg);
  if (made || (await marker()) !== `${(await store.read())?.session_id ?? ''}|${sub.endpoint}`) await send(sub);
}
