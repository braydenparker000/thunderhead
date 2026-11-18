// The lab's TorBox check: from this phone, every step between a stream's address and a film playing, each
// shown as it runs (onStep), then a plain-text report safe to paste into a chat.
//   a. signed in on this phone (the page's Worker helper refuses without a session: "not signed in")
//   b. GET /v1/astra/torbox: whether the Worker holds the TorBox key, whether TorBox accepts it, the plan
//   c. POST /v1/astra/play with the link, mode "play" (the owner's tap): how the Worker got the film's address
//      (`via`), whether the last answer let a page read it, and its steps with their times
//   d. from the phone, the first and the last 64 KiB of that address: status, whether the page could read it,
//      the size, the time to the first byte, and the server group (the label before "tb-cdn", nothing else)
//   e. a 2 MB read, for a speed figure
//   f. four requests at once, then a fifth: what the server does at a link's connection limit (all ended at once)
//   g. the film's container and codecs by the engine's own probe, and the way the planner would play it
// No address, hash, key or file name is ever put in a step's words; the report also goes through scrubSecrets()
// with the link and the film's address named, so they are removed wherever they might appear.

import {scrubSecrets, serverGroup} from './scrub.js';

const PIECE = 64 << 10, SPEED = 2 << 20, WAIT = 15000, LIMIT_WAIT = 10000;
export const STEPS = [
  ['a', 'Signed in'], ['b', 'TorBox key'], ['c', 'Worker'], ['d', 'From this phone'], ['e', 'Speed'], ['f', 'Connection limit'], ['g', 'The film'],
];
const MODE = {remux: 'Astra unpacks it', native: 'the browser plays it as it is', software: 'Astra’s software decoder', hls: 'HLS stream', dash: 'DASH stream', unsupported: 'it cannot play here'};

const size = n => !(n > 0) ? 'unknown size' : n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' kB';
const ms = n => `${Math.round(n)} ms`;
const read = n => n < (1 << 20) ? `${Math.round(n / 1024)} KiB` : `${(n / (1 << 20)).toFixed(1)} MiB`;
const now = () => performance.now();
const reason = error => String(error?.message || 'no reason given').replace(/\.$/, '');
/** A 40-hex run in the link's own path, as the hash the Worker may use; null when none can be read. */
export const hashIn = link => /(?:^|[^0-9a-f])([0-9a-f]{40})(?![0-9a-f])/i.exec(String(link).split(/[?#]/)[0])?.[1].toLowerCase() || null;

/**
 * One Range request from the phone, read to `want` bytes then ended: {status, readable, bytes, length, first, total}
 * (length: the answer's Content-Length; first and total: ms to its headers and to its last byte read), or
 * {readable: false, answers, error} when the page may not read it (`answers`: the server did reply, without CORS).
 */
export async function rangeRead(fetchFn, url, range, want, signal) {
  const ctl = new AbortController(), stop = () => ctl.abort(), timer = setTimeout(stop, WAIT);
  signal?.addEventListener('abort', stop, {once: true});
  const t0 = now();
  try {
    let r;
    try { r = await fetchFn(url, {headers: {Range: range}, signal: ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', mode: 'cors'}); } catch (error) {
      if (ctl.signal.aborted) return {readable: false, answers: false, error: 'no answer in 15 s'};
      return {readable: false, answers: await answersAtAll(fetchFn, url, signal), error: 'the page may not read it'};
    }
    const first = now() - t0, length = Number(r.headers.get('content-length')) || 0;
    let bytes = 0;
    const reader = r.body?.getReader();
    while (reader && bytes < want) { const {done, value} = await reader.read(); if (done) break; bytes += value.length; }
    reader?.cancel().catch(() => {});
    return {status: r.status, readable: true, bytes: Math.min(bytes, want), length, first, total: now() - t0};
  } catch (error) {
    return {readable: false, answers: true, error: ctl.signal.aborted ? 'stopped after 15 s' : 'the answer broke off'};
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
}

/** Whether the server answers a plain (no-cors) request at all, which a page may send but not read. */
async function answersAtAll(fetchFn, url, signal) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), WAIT);
  try { await fetchFn(url, {mode: 'no-cors', signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'}); return true; } catch { return false; } finally { clearTimeout(timer); ctl.abort(); }
}

const readLine = (what, r) => r.readable
  ? `${what}: ${r.status}, readable, ${read(r.bytes)} read (first byte ${ms(r.first)}, all of it ${ms(r.total)})`
  : `${what}: not readable by the page: ${r.error}${r.answers ? ' (the server answers, without letting a page read it)' : ''}`;

/**
 * Runs the check on `link`. `api(path, {method, body, signal})` is the page's Worker helper; `probe` and `plan`
 * are the engine's (engine/probe.js, engine/plan.js) with the planner's `caps`. Resolves the steps: [{id, title,
 * state: 'run'|'ok'|'bad'|'info'|'skip', lines}], each also handed to onStep as it changes.
 */
export async function torboxCheck(link, {api, fetchFn = (...a) => globalThis.fetch(...a), probe, plan, caps, onStep = () => {}, signal, facts: said = null} = {}) {
  const steps = STEPS.map(([id, title]) => ({id, title, state: 'skip', lines: []}));
  const step = id => steps.find(s => s.id === id);
  const set = (id, state, ...lines) => { Object.assign(step(id), {state, lines: lines.flat().filter(Boolean)}); onStep(step(id), steps); };
  const stopped = () => signal?.aborted;
  const facts = {url: null};
  // a, b: the session and the key, from one request.
  set('a', 'run', 'Asking the Worker…');
  let torbox;
  try { torbox = await api('/v1/astra/torbox', {signal}); } catch (error) {
    if (error?.missing) { set('a', 'bad', error.message); return done(steps, facts); }
    if (/not signed in/i.test(error?.message || '') || error?.status === 401) { set('a', 'bad', 'Not signed in on this phone. Sign in on the site, then run the check again.'); return done(steps, facts); }
    set('a', 'ok', 'Signed in on this phone.');
    set('b', 'bad', `The Worker could not answer: ${reason(error)}.`);
    torbox = null;
  }
  if (torbox) {
    set('a', 'ok', 'Signed in on this phone.');
    const t = torbox;
    if (!t.configured) set('b', 'bad', 'No TorBox key is set in the Worker: only the add-on’s own forward can be followed.', t.note);
    else if (t.ok === false) set('b', 'bad', 'A key is set, but TorBox refused it.', t.note);
    else set('b', t.ok ? 'ok' : 'info', `A key is set${t.ok ? ', accepted by TorBox' : ', not confirmed by TorBox now'}${t.plan != null ? `, plan ${t.plan}` : ''}.`, t.note);
  }
  if (stopped()) return done(steps, facts);
  // c: the Worker resolves the link.
  set('c', 'run', 'Asking the Worker for the film’s address…');
  let answer = null;
  // What Astra itself would send for this stream (`said`: its torrent, file number, name and size, when the stream came
  // from the lab's list); a pasted address has only the hash its own text shows.
  const hash = hashIn(link), started = now(), known = Object.fromEntries(Object.entries(said || (hash ? {hash} : {})).filter(([, v]) => v != null));
  try { answer = await api('/v1/astra/play', {method: 'POST', body: {link, ...known, mode: 'play'}, signal}); } catch (error) {
    set('c', 'bad', `${reason(error)} (${ms(now() - started)}).`, stepLines(error?.steps));
    return done(steps, facts);
  }
  facts.url = typeof answer?.url === 'string' ? answer.url : null;
  const how = [`via ${answer?.via || 'nothing'}`, answer?.readable === true ? 'readable by a page' : answer?.readable === false ? 'not readable by a page' : '', answer?.size ? size(answer.size) : '', answer?.type || ''].filter(Boolean).join(' · ');
  set('c', facts.url ? 'ok' : 'bad', facts.url ? `${how} (${ms(now() - started)}).` : `The Worker gave no address (${how}).`, stepLines(answer?.steps));
  if (!facts.url || stopped()) return done(steps, facts);
  // d: the first and the last 64 KiB, from the phone.
  set('d', 'run', 'Reading the start…');
  const start = await rangeRead(fetchFn, facts.url, 'bytes=0-', PIECE, signal);
  const total = answer.size > 0 ? answer.size : start.status === 206 && start.length > 0 ? start.length : 0;
  const group = serverGroup(facts.url);
  const where = group ? `Server group: ${group}` : 'Server: not one of TorBox’s file servers';
  if (!start.readable) {
    set('d', 'bad', readLine('First 64 KiB', start), where);
    set('e', 'skip', 'Not tried: the page cannot read the file.');
    set('f', 'skip', 'Not tried: the page cannot read the answers’ statuses.');
  } else {
    const end = total > PIECE ? await rangeRead(fetchFn, facts.url, `bytes=${total - PIECE}-${total - 1}`, PIECE, signal) : null;
    set('d', start.status === 206 && (!end || end.status === 206) ? 'ok' : 'bad', readLine('First 64 KiB', start), end ? readLine('Last 64 KiB', end) : 'Last 64 KiB: not asked (the size is unknown or small)', `File size: ${size(total)}`, where);
    if (stopped()) return done(steps, facts);
    // e: a speed figure.
    set('e', 'run', 'Reading 2 MB…');
    const from = total > 2 * SPEED ? SPEED : 0;
    const fast = await rangeRead(fetchFn, facts.url, `bytes=${from}-${from + SPEED - 1}`, SPEED, signal);
    const secs = fast.readable ? Math.max(1, fast.total - fast.first) / 1000 : 0;
    set('e', fast.readable && fast.bytes ? 'ok' : 'bad', fast.readable ? `${read(fast.bytes)} in ${secs.toFixed(2)} s: ${(fast.bytes * 8 / secs / 1e6).toFixed(1)} Mbit/s (first byte ${ms(fast.first)})` : readLine('2 MB', fast));
    if (stopped()) return done(steps, facts);
    set('f', 'run', 'Four requests at once, then a fifth…');
    set('f', 'info', ...await limitTest(fetchFn, facts.url, total, signal));
  }
  if (stopped()) return done(steps, facts);
  // g: the engine's own look at the film.
  set('g', 'run', 'Reading what is inside…');
  set('g', ...await describe(facts.url, {probe, plan, caps, signal}));
  return done(steps, facts);
}

/** The Worker's steps, one line each: "key ✓ 81 ms", with its note when it has one. */
const stepLines = list => (Array.isArray(list) ? list : []).map(s => `${String(s.step || '?')} ${s.ok ? '✓' : '✗'} ${ms(+s.ms || 0)}${s.note ? `: ${s.note}` : ''}`);

/** Four open requests, each held until all four have answered, then a fifth; every one ended at once after. */
export async function limitTest(fetchFn, url, total, signal) {
  const open = [];
  const one = async i => {
    const ctl = new AbortController();
    open.push(ctl);
    const from = total > 8 * PIECE ? Math.floor(total / 8) * i : 0;
    const timer = setTimeout(() => ctl.abort(), LIMIT_WAIT);
    try {
      const r = await fetchFn(url, {headers: {Range: `bytes=${from}-`}, signal: signal ? AbortSignal.any([signal, ctl.signal]) : ctl.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer'});
      return String(r.status);
    } catch { return ctl.signal.aborted ? 'no answer in 10 s' : 'refused'; } finally { clearTimeout(timer); }
  };
  try {
    const four = await Promise.all([0, 1, 2, 3].map(one));
    const fifth = await one(4);
    return [`Four at once: ${four.join(' ')}.`, `The fifth, beside them: ${fifth}.`, 'All five ended at once.'];
  } finally { for (const c of open) c.abort(); }
}

/** The probe's description and the planner's way, as [state, ...lines]. */
async function describe(url, {probe, plan, caps, signal}) {
  if (typeof probe !== 'function') return ['skip', 'Not tried: the engine is not here.'];
  let probed;
  // The five connections of the step before were only just let go: a host that counts them (TorBox allows four) can
  // refuse the engine's first ask while they close. One more try after a moment, then it is the film's own trouble.
  try { probed = await probe(url, {signal}); } catch {
    await new Promise(resolve => setTimeout(resolve, 1500));
    try { probed = await probe(url, {signal}); } catch (error) { return ['bad', `The engine could not read it: ${reason(error)}.`]; }
  }
  try {
    const info = probed.info, route = plan ? plan(probed, caps || {}, {}) : null;
    const lines = [];
    if (!probed.readable) lines.push(`Not readable by the page: ${probed.error?.message || 'no reason given'}`);
    if (info) {
      const video = (info.video || []).map(v => [v.label || v.codec, v.width && `${v.width}×${v.height}`, v.hdr && 'HDR'].filter(Boolean).join(' '));
      const audio = (info.audio || []).map(a => [a.label || a.codec, a.channels && `${a.channels} ch`, a.language && `(${a.language})`].filter(Boolean).join(' '));
      lines.push([info.container, size(info.size), info.duration ? `${Math.round(info.duration / 60)} min` : ''].filter(Boolean).join(' · '));
      lines.push(`Picture: ${video.join(', ') || 'none'}`, `Sound: ${audio.join(', ') || 'none'}`, `Subtitles inside: ${(info.subtitles || []).length}`);
    }
    if (route) lines.push(`Route: ${route.mode} (${MODE[route.mode] || route.mode})${route.reason ? `: ${route.reason}` : ''}`, ...(route.notes || []).slice(0, 3));
    return [probed.readable && route?.mode !== 'unsupported' ? 'ok' : 'bad', ...lines];
  } finally { probed.source?.close?.(); probed.input?.dispose?.(); }
}

function done(steps, facts) { return Object.assign(steps, {facts}); }

/** The plain-text report: the steps' words, with every address, hash, key and file name scrubbed out. */
export function checkReport(steps, {link = '', device = ''} = {}) {
  const mark = {ok: 'ok', bad: 'FAILED', info: 'note', skip: 'skipped', run: 'stopped'};
  const text = [`Astra TorBox check, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC${device ? `, ${device}` : ''}`,
    ...steps.flatMap(s => [`(${s.id}) ${s.title}: ${mark[s.state] || s.state}`, ...s.lines.map(l => `    ${l}`)])].join('\n');
  return scrubSecrets(text, {known: [link, steps.facts?.url].filter(Boolean), hosts: false});
}

/** The browser and system in two words each, from the user agent: "Chrome 131, Android 14". */
export function deviceLine(ua = globalThis.navigator?.userAgent || '') {
  const first = list => list.map(r => r.exec(ua)).find(Boolean);
  const browser = first([/(Edg|SamsungBrowser|Firefox)\/(\d+)/, /(Chrome)\/(\d+)/, /(Version)\/(\d+)/]);
  const system = first([/Android [\d.]+/, /iPhone OS [\d_]+/, /Windows NT [\d.]+/, /Mac OS X [\d_]+/, /Linux/]);
  return [browser && `${browser[1] === 'Version' ? 'Safari' : browser[1]} ${browser[2]}`, system && system[0].replace(/_/g, '.')].filter(Boolean).join(', ');
}
