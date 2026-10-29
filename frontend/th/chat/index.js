// @ts-check
// Home's conversation once signed in (HOME.md §2, §4, §6.3, §7): paints from cache at once, then
// today's thread from the Worker; one live socket brings every change (API.md §12) and the
// phone pulls what changed; messages go out through an outbox that survives being offline; the
// reply slot, the voice line and the edge light follow the mind's presence; the Worker's verbs
// for this phone run through the verb registry. Nothing repaints on a timer while the page is
// hidden. Loaded lazily by boot.js after the first paint.
import { CONFIG } from '../../config.js';
import { api, signedIn } from '../client.js';
import { failure } from '../flow.js';
import { homeLine, fallbackCards } from '../registry/surfaces.js';
import { appFor } from '../registry/apps.js';
import { decisions } from '../decide/state.js';
import { run as runVerb } from '../registry/verbs.js';
import { toast } from '../ui.js';
import { BACKOFF_S, createLive } from './live.js';
import * as model from './model.js';
import { cache, OUTBOX_MAX, outbox } from './store.js';
import { createView, voice } from './view.js';

/** @typedef {import('../../../shared/contract/api.ts').TodayResponse} TodayResponse */
/** @typedef {import('../../../shared/contract/api.ts').MindPresence} MindPresence */
/** @typedef {import('../../../shared/contract/api.ts').Surface} Surface */
/** @typedef {import('../../../shared/contract/api.ts').Message} Message */
/** @typedef {import('./model.js').Local} Local */

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));

/** What home holds of today, for the menu's conversations and search (th/convos).
 * @type {{ today: TodayResponse | null }} */
export const current = { today: null };

export async function startChat() {
  const convo = $('#convo');
  const edgeEl = $('#edge');
  const q = /** @type {HTMLInputElement} */ ($('#q'));
  const ask = /** @type {HTMLFormElement} */ ($('#ask'));
  const talk = document.createElement('div');
  talk.id = 'talk';
  talk.className = 'turns talk';
  talk.setAttribute('aria-live', 'polite');
  $('#turns').after(talk);
  $('#say').setAttribute('role', 'status');
  $('#say').setAttribute('lang', 'en');

  const state = {
    /** @type {TodayResponse | null} */ today: null,
    /** @type {import('./model.js').Local[]} */ local: await outbox.list(),
    /** @type {MindPresence | null} */ presence: null,
    /** @type {{ seq: number, cleared_at: number | null } | null} */ stop: null,
    stopping: false,
    /** @type {Surface[]} */ surfaces: [],
    /** The newest change on screen: the feed is pulled from here, and it moves only once the
     * loads a change needs have succeeded (API.md §12). */
    applied: 0,
    typingUntil: 0,
    offline: !navigator.onLine,
    /** Replies that arrived while open reveal; ones painted from cache or on load don't. */
    fresh: new Set(),
    loaded: false,
  };
  const view = createView({ talk, convo, onRetry: retry, onChip: openChip, onStop: stopMind });
  const setVoice = voice($('#say'));
  let pendingVoice = /** @type {[string, string | null] | null} */ (null);
  let wasFirstRun = false;

  // --- paint ----------------------------------------------------------------------------------
  function paint() {
    const now = Date.now();
    const shown = model.merge(state.today?.messages ?? [], state.local);
    const waiting = model.waitingFor(shown);
    const slot = waiting ? model.slot({ sentAt: waiting.created_at, now, presence: state.presence, progress: model.hasProgress(shown, waiting) }) : 'none';
    const working = state.presence?.state === 'working';
    const standing = state.stop !== null && state.stop.cleared_at === null;
    const stop = waiting && (working || standing) && !waiting.local ? (standing || state.stopping ? 'stopping' : 'button') : 'none';
    view.render({ shown, slot, stop, cards: fallbackCards(state.surfaces).map((c) => ({ text: c.text, kind: 'kind' in c ? c.kind : '' })), fresh: state.fresh, now });
    let sent = false;
    try {
      sent = localStorage.getItem('th.p.sent') === '1';
    } catch {}
    const firstRun = !sent && shown.length === 0;
    const line = model.voiceLine({ presence: state.presence, firstRun, homeLine: homeLine(state.surfaces)?.text ?? null, noWake: model.noWakeShown(shown), decisions: decisions.waiting, answered: decisions.answered });
    // Never while typing (HOME.md §2.3): a change waits until the bar is empty and blurred, except
    // one the owner's own action caused (the first message ends the first-run line at once).
    const own = wasFirstRun && !firstRun;
    wasFirstRun = firstRun;
    if (!own && (document.activeElement === q || q.value.trim())) pendingVoice = line;
    else {
      pendingVoice = null;
      setVoice(line, state.loaded);
    }
    const failedAt = Math.max(0, ...state.local.map((m) => (m.state === 'failed' ? m.failed_at ?? 0 : 0)));
    const e = model.edge({ presence: state.presence, waiting: waiting !== null, typingUntil: state.typingUntil, offline: state.offline, now, failedAt });
    edgeEl.dataset.state = e;
    edgeEl.classList.toggle('think', e === 'think');
    edgeEl.classList.toggle('breathe', e === 'calm');
    edgeEl.classList.toggle('err', e === 'error');
    edgeEl.classList.toggle('off', e === 'offline');
    $('#date').toggleAttribute('data-offline', state.offline);
    // A ticking clock only while something on screen changes with time, and only while it's seen:
    // each second while a reply is on its way, else once when an error or a typing pulse ends.
    clearTimeout(ticker);
    if (document.hidden) return;
    const ends = [failedAt + model.FAILED_EDGE_MS, state.typingUntil].filter((t) => t > now);
    if (waiting || state.local.some((m) => m.state === 'sending')) ticker = setTimeout(paint, 1000);
    else if (ends.length) ticker = setTimeout(paint, Math.min(...ends) - now + 50);
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let ticker;
  q.addEventListener('blur', () =>
    setTimeout(() => {
      if (pendingVoice && document.activeElement !== q && !q.value.trim()) {
        setVoice(pendingVoice);
        pendingVoice = null;
      }
    }, 2000),
  );

  // --- data -----------------------------------------------------------------------------------
  const presenceOf = (/** @type {Record<string, unknown>} */ s) => /** @type {MindPresence | null} */ (s['mind.status'] ?? null);
  /** @returns {Promise<number>} the seq today's read reflects */
  async function loadToday() {
    const t = await signedIn((tok) => api.today(tok));
    const known = new Set((state.today?.messages ?? []).map((m) => m.id));
    if (state.loaded) for (const m of t.messages) if (!known.has(m.id) && m.author !== 'owner') state.fresh.add(m.id);
    state.today = current.today = t;
    return t.seq;
  }
  async function loadSettings() {
    const s = /** @type {Record<string, unknown>} */ (await signedIn((tok) => api.settings(tok)));
    state.presence = presenceOf(s);
    state.stop = /** @type {any} */ (s['mind.stop']) ?? null;
    if (state.stop?.cleared_at) state.stopping = false;
  }
  async function loadSurfaces() {
    state.surfaces = (await signedIn((tok) => api.surfaces(tok))).items;
  }
  let verbsBusy = false;
  async function runVerbs() {
    if (verbsBusy) return;
    verbsBusy = true;
    try {
      for (const v of (await signedIn((tok) => api.pendingVerbs(tok))).items) {
        if (v.status !== 'pending') continue;
        try {
          await signedIn((tok) => api.claimVerb(tok, v.id));
        } catch {
          continue; // another phone took it
        }
        const out = await runVerb(v);
        await signedIn((tok) => api.verbResult(tok, v.id, out.ok ? { ok: true, result: /** @type {any} */ (out.result), undo: /** @type {any} */ (out.undo) } : { ok: false, error: out.error }));
      }
    } catch {
      // the next change or visit retries
    } finally {
      verbsBusy = false;
    }
  }
  const save = () => cache.write({ today: state.today, presence: state.presence, surfaces: state.surfaces, seq: state.applied, at: Date.now() });

  // --- sync -----------------------------------------------------------------------------------
  // Each pass pulls the feed from `applied` and reloads only what it touches; a frame that comes
  // during a pass runs another after it, and a pass that fails tries again on the live channel's
  // back-off. Never rejects.
  let syncing = false;
  let again = false;
  let fails = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let syncRetry;
  async function sync() {
    if (syncing) return void (again = true);
    syncing = true;
    clearTimeout(syncRetry);
    try {
      do {
        again = false;
        await pass();
      } while (again);
      fails = 0;
    } catch {
      const s = BACKOFF_S[Math.min(fails++, BACKOFF_S.length - 1)];
      syncRetry = setTimeout(sync, s * 1000 * (0.75 + Math.random() * 0.5));
    } finally {
      syncing = false;
    }
  }
  async function pass() {
    if (!state.applied) return full();
    /** @type {Set<string>} */
    const kinds = new Set();
    let to = state.applied;
    try {
      for (let more = true; more; ) {
        const page = await signedIn((tok) => api.changes(tok, to));
        for (const c of page.items) kinds.add(c.kind);
        to = page.next_after;
        more = page.more;
      }
    } catch (e) {
      if (failure(e).code === 'resync_required') return full();
      throw e;
    }
    // Other views (the Memory page) hear which kinds changed, without a socket of their own.
    document.dispatchEvent(new CustomEvent('th:changed', { detail: [...kinds] }));
    const jobs = [];
    if (kinds.has('message') || kinds.has('thread')) jobs.push(loadToday());
    if (kinds.has('setting') || kinds.has('mind_status')) jobs.push(loadSettings());
    if (kinds.has('surface')) jobs.push(loadSurfaces());
    await Promise.all(jobs);
    state.applied = to;
    if (kinds.has('verb')) runVerbs();
    paint();
    save();
  }
  /** Everything (the first load, or the feed asked for a resync). Today goes first and its seq is
   * where the feed picks up; the other loads start after it, so they hold all of that too. */
  async function full() {
    const seq = await loadToday();
    await Promise.all([loadSettings(), loadSurfaces()]);
    state.applied = seq;
    document.dispatchEvent(new CustomEvent('th:changed', { detail: ['*'] }));
    runVerbs();
    paint();
    save();
  }

  // --- the live channel -----------------------------------------------------------------------
  const wsBase = CONFIG.api.replace(/\/+$/, '').replace(/^http/, 'ws');
  const live = createLive({
    connect: async () => {
      const { ticket } = await signedIn((tok) => api.liveTicket(tok));
      return /** @type {any} */ (new WebSocket(`${wsBase}/v1/live?ticket=${encodeURIComponent(ticket)}`));
    },
    onFrame: (f) => {
      if ((f.t === 'hello' && f.seq !== state.applied) || (f.t === 'changed' && f.seq > state.applied)) sync();
      else if (f.t === 'typing') {
        state.typingUntil = f.until;
        paint(); // and once more when the pulse ends
      }
    },
    onState: (s) => {
      if (s === 'signed_out') signedIn((tok) => api.me(tok)).catch(() => {}); // the 401 path wipes and leaves
    },
    hidden: () => document.hidden,
  });

  // --- sending (HOME.md §4.7) -----------------------------------------------------------------
  // The outbox goes out in order, one at a time: a message waiting on a retry holds the ones after
  // it. IndexedDB keeps a copy only; if it can't write, the message still sends from memory. Each
  // message's writes go one after another, so a removal never lands before the write before it.
  /** @type {Map<string, Promise<void>>} */
  const writes = new Map();
  /** @param {string} id @param {() => Promise<void>} fn */
  const write = (id, fn) => {
    const p = (writes.get(id) ?? Promise.resolve()).then(fn).catch(() => {});
    writes.set(id, p);
    return p;
  };
  const keep = (/** @type {Local} */ m) => write(m.id, () => outbox.put(m));
  const drop = (/** @type {string} */ id) => write(id, () => outbox.remove(id)).then(() => writes.delete(id));

  /** @param {Local} m @returns {Promise<boolean>} whether it went */
  async function send(m) {
    try {
      const out = await signedIn((tok) => api.say(tok, m.id, m.body));
      state.local = state.local.filter((x) => x.id !== m.id);
      if (state.today && !state.today.messages.some((x) => x.id === out.id)) state.today.messages.push(out);
      drop(m.id);
      try {
        localStorage.setItem('th.p.sent', '1');
      } catch {}
      return true;
    } catch (e) {
      const f = failure(e);
      const retryable = f.kind !== 'api' || f.status >= 500 || f.status === 429;
      m.tries++;
      m.state = !retryable ? 'failed' : !navigator.onLine ? 'queued' : m.tries > model.RETRY_MS.length ? 'failed' : 'sending';
      if (m.state === 'failed') m.failed_at = Date.now();
      if (m.state === 'sending') flushRetry = setTimeout(flush, model.RETRY_MS[m.tries - 1]);
      keep(m);
      return false;
    } finally {
      paint();
    }
  }
  let flushing = false;
  let flushAgain = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let flushRetry;
  async function flush() {
    if (flushing) return void (flushAgain = true);
    flushing = true;
    clearTimeout(flushRetry);
    try {
      let held = false;
      do {
        flushAgain = false;
        for (const m of [...state.local]) {
          if (m.state === 'queued' && navigator.onLine) m.state = 'sending';
          if (m.state !== 'sending' || (await send(m))) continue; // a failed one waits for Retry
          held = m.state === 'sending'; // a retry is due: the ones after it wait for it
          if (held) break;
        }
      } while (flushAgain && !held);
    } finally {
      flushing = false;
    }
  }
  /** @param {string} id */
  function retry(id) {
    const m = state.local.find((x) => x.id === id);
    if (!m) return;
    m.state = navigator.onLine ? 'sending' : 'queued';
    m.tries = 0;
    delete m.failed_at;
    keep(m);
    paint();
    flush();
  }
  ask.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = q.value.trim();
    if (!body) return;
    if (body.length > model.MAX_CHARS) return toast('Too long to send. Try sending it as a file.');
    if (state.local.length >= OUTBOX_MAX) return toast('Too much waiting to send. Connect to send the rest.');
    const now = Date.now();
    /** @type {Local} */
    const m = { id: model.uuidv7(now), body, created_at: now, state: navigator.onLine ? 'sending' : 'queued', tries: 0 };
    state.local.push(m);
    paint();
    // Painted first: the words are never only in the bar, or only in IndexedDB.
    q.value = '';
    ask.classList.remove('typing');
    $('#hint')?.classList.add('gone');
    keep(m);
    flush();
  });

  // The pre-warm: the first keystroke after a quiet spell tells the Worker, so the mind wakes.
  let lastKey = 0;
  let lastSent = 0;
  q.addEventListener('input', () => {
    const now = Date.now();
    if (q.value.trim() && model.shouldPrewarm({ now, lastKey, lastSent })) {
      lastSent = now;
      signedIn((tok) => api.typing(tok)).catch(() => {});
    }
    lastKey = now;
  });

  // --- taps -----------------------------------------------------------------------------------
  /** @param {{ app: string, path: string, label: string }} chip */
  async function openChip(chip) {
    const app = appFor(chip.app);
    const out = await runVerb({ verb: 'app.open', schema: 1, args: { app: chip.app, path: chip.path } });
    toast(out.ok && app ? `Opening ${app.name}` : "That app isn't here yet.");
  }
  async function stopMind() {
    state.stopping = true;
    paint();
    try {
      await signedIn((tok) => api.stop(tok));
      toast('Stopping after this step.');
    } catch {
      state.stopping = false;
      toast("Couldn't reach the mind. Try again.");
      paint();
    }
  }

  // --- life ---------------------------------------------------------------------------------
  const cached = await cache.read();
  if (cached) {
    Object.assign(state, { today: cached.today, presence: cached.presence, surfaces: cached.surfaces ?? [] });
    current.today ??= cached.today;
    paint();
  }
  // The first pass loads everything; offline or with the Worker away, the cache stands, the
  // outbox waits and the pass tries again.
  await sync();
  state.loaded = true;
  paint();
  live.start();
  flush();
  addEventListener('online', () => {
    state.offline = false;
    live.wake();
    flush();
    paint();
  });
  addEventListener('offline', () => {
    state.offline = true;
    paint();
  });
  document.addEventListener('th:decisions', () => paint());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    live.wake();
    sync();
    flush();
    paint();
  });
}
