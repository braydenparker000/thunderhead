// What this device has learnt about its own decoders, kept in localStorage
// (per device, never per film) so the next film does not stumble the same way:
//
//   fallback  picture codec strings ('hvc1.2.4.L120.90') that failed to decode
//             through the browser and then played in the software decoder; such
//             films are planned straight to software (plan.js, caps.failedRoute).
//   pass      sound codecs ('ac3', 'eac3', 'dts') the browser said it plays as
//             they are but did not; such sound is converted (caps.passFailed).
//
// Each entry expires after 30 days, so a browser update gets another chance;
// at most 40 picture entries are kept (the oldest go first). Storage that is
// missing or refuses (a private window) simply means nothing is remembered.

const KEY = 'astra-routes';
const TTL = 30 * 864e5, MAX = 40;

function store() { try { return globalThis.localStorage || null; } catch { return null; } }

/** The remembered routes, expired entries left out: {fallback: {codec: {at, ok}}, pass: {codec: at}}. */
export function readRoutes(s = store(), now = Date.now()) {
  let raw = null;
  try { raw = JSON.parse(s?.getItem(KEY) || 'null'); } catch {}
  const fresh = at => Number.isFinite(at) && at <= now + 864e5 && now - at < TTL;
  const fallback = {}, pass = {};
  for (const [k, v] of Object.entries(raw?.fallback || {})) if (v && fresh(v.at)) fallback[k] = {at: v.at, ok: !!v.ok};
  for (const [k, at] of Object.entries(raw?.pass || {})) if (fresh(at)) pass[k] = at;
  return {fallback, pass};
}

function write(routes, s = store()) {
  const kept = Object.entries(routes.fallback).sort((a, b) => b[1].at - a[1].at).slice(0, MAX);
  try { s?.setItem(KEY, JSON.stringify({fallback: Object.fromEntries(kept), pass: routes.pass})); } catch {}
}

/** A picture codec fell back to the software decoder: remembered, not yet used until software plays it (confirmRoute). */
export function rememberFallback(codec, s = store(), now = Date.now()) {
  if (!codec) return;
  const r = readRoutes(s, now);
  r.fallback[codec] = {at: r.fallback[codec]?.at ?? now, ok: !!r.fallback[codec]?.ok};
  write(r, s);
}

/** The software decoder played it: later films with this codec start there. The 30 days still run from the failure. */
export function confirmRoute(codec, s = store(), now = Date.now()) {
  const r = readRoutes(s, now);
  if (!r.fallback[codec] || r.fallback[codec].ok) return;
  r.fallback[codec].ok = true;
  write(r, s);
}

/** Forgets a picture codec: software failed too (so the browser's decoder was not the cause), or the owner tried again. */
export function forgetRoute(codec, s = store(), now = Date.now()) {
  const r = readRoutes(s, now);
  if (!codec || !r.fallback[codec]) return;
  delete r.fallback[codec];
  write(r, s);
}

/** True when films with this picture codec string should start in the software decoder. */
export function failedRoute(codec, s = store(), now = Date.now()) {
  return !!codec && !!readRoutes(s, now).fallback[codec]?.ok;
}

/** Sound the browser claimed and failed: remembered (true) or forgotten (false, it was not the sound after all). */
export function rememberPass(codec, failed = true, s = store(), now = Date.now()) {
  const r = readRoutes(s, now);
  if (failed) r.pass[codec] = now; else if (codec in r.pass) delete r.pass[codec]; else return;
  write(r, s);
}

/** True when this device failed to play this sound codec as it is. */
export function passFailed(codec, s = store(), now = Date.now()) { return !!readRoutes(s, now).pass[codec]; }
