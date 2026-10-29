// @ts-check
// Home's conversation once signed in (HOME.md §2, §4, §6.3, §7): paints from cache at once, then
// today's thread from the Worker; one live socket brings every change (API.md §12) and the
// phone pulls what changed; messages go out through an outbox that survives being offline; the
// reply slot, the voice line and the edge light follow the mind's presence; the Worker's verbs
// for this phone run through the verb registry. Loaded lazily by boot.js after the first paint.
import { CONFIG } from '../../config.js';
import { api, signedIn } from '../client.js';
import { failure } from '../flow.js';
import { homeLine, fallbackCards } from '../registry/surfaces.js';
import { appFor } from '../registry/apps.js';
import { run as runVerb } from '../registry/verbs.js';
import { toast } from '../ui.js';
import { createLive } from './live.js';
import * as model from './model.js';
import { cache, OUTBOX_MAX, outbox } from './store.js';
import { createView, voice } from './view.js';

/** @typedef {import('../../../shared/contract/api.ts').TodayResponse} TodayResponse */
/** @typedef {import('../../../shared/contract/api.ts').MindPresence} MindPresence */
/** @typedef {import('../../../shared/contract/api.ts').Surface} Surface */
/** @typedef {import('../../../shared/contract/api.ts').Message} Message */

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));

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

  const state = {
    /** @type {TodayResponse | null} */ today: null,
    /** @type {import('./model.js').Local[]} */ local: await outbox.list(),
    /** @type {MindPresence | null} */ presence: null,
    /** @type {{ seq: number, cleared_at: number | null } | null} */ stop: null,
    stopping: false,
    /** @type {Surface[]} */ surfaces: [],
    seq: 0,
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
    const sentAt = waiting ? (waiting.local ? waiting.created_at : waiting.created_at) : 0;
    const slot = waiting ? model.slot({ sentAt, now, presence: state.presence, progress: model.hasProgress(shown, waiting) }) : 'none';
    const working = state.presence?.state === 'working';
    const standing = state.stop !== null && state.stop.cleared_at === null;
    const stop = waiting && (working || standing) && !waiting.local ? (standing || state.stopping ? 'stopping' : 'button') : 'none';
    view.render({ shown, slot, stop, cards: fallbackCards(state.surfaces).map((c) => ({ text: c.text, kind: 'kind' in c ? c.kind : '' })), fresh: state.fresh, now });
    let sent = false;
    try {
      sent = localStorage.getItem('th.p.sent') === '1';
    } catch {}
    const firstRun = !sent && shown.length === 0;
    const line = model.voiceLine({ presence: state.presence, firstRun, homeLine: homeLine(state.surfaces)?.text ?? null });
    // Never while typing (HOME.md §2.3): a change waits until the bar is empty and blurred, except
    // one the owner's own action caused (the first message ends the first-run line at once).
    const own = wasFirstRun && !firstRun;
    wasFirstRun = firstRun;
    if (!own && (document.activeElement === q || q.value.trim())) pendingVoice = line;
    else {
      pendingVoice = null;
      setVoice(line, state.loaded);
    }
    const e = model.edge({ presence: state.presence, waiting: waiting !== null, typingUntil: state.typingUntil, offline: state.offline, now });
    edgeEl.dataset.state = e;
    edgeEl.classList.toggle('think', e === 'think');
    edgeEl.classList.toggle('breathe', e === 'calm' || e === 'offline');
    edgeEl.classList.toggle('err', e === 'error');
    edgeEl.classList.toggle('off', e === 'offline');
    $('#date').toggleAttribute('data-offline', state.offline);
    // A ticking clock only while something on screen changes with time.
    if (waiting || state.local.some((m) => m.state === 'sending')) tick();
  }
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let ticker;
  const tick = () => {
    clearTimeout(ticker);
    ticker = setTimeout(paint, 1000);
  };
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
  async function loadToday() {
    const t = await signedIn((tok) => api.today(tok));
    const known = new Set((state.today?.messages ?? []).map((m) => m.id));
    if (state.loaded) for (const m of t.messages) if (!known.has(m.id) && m.author !== 'owner') state.fresh.add(m.id);
    state.today = t;
    state.seq = Math.max(state.seq, t.seq);
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
  const save = () => cache.write({ today: state.today, presence: state.presence, surfaces: state.surfaces, seq: state.seq, at: Date.now() });

  /** Pulls what changed since the last seq and reloads only what it touches. */
  let syncing = /** @type {Promise<void> | null} */ (null);
  async function sync(/** @type {Set<string> | null} */ kinds = null) {
    if (syncing) return syncing;
    syncing = (async () => {
      let k = kinds;
      if (!k) {
        k = new Set();
        try {
          let more = true;
          while (more) {
            const page = await signedIn((tok) => api.changes(tok, state.seq));
            for (const c of page.items) k.add(c.kind);
            state.seq = page.next_after;
            more = page.more;
          }
        } catch (e) {
          if (failure(e).code !== 'resync_required') throw e;
          k = new Set(['message', 'thread', 'setting', 'mind_status', 'surface', 'verb']); // reload everything
          state.seq = 0;
        }
      }
      const jobs = [];
      if (k.has('message') || k.has('thread') || state.seq === 0) jobs.push(loadToday());
      if (k.has('setting') || k.has('mind_status')) jobs.push(loadSettings());
      if (k.has('surface')) jobs.push(loadSurfaces());
      await Promise.all(jobs);
      if (k.has('verb')) runVerbs();
      paint();
      save();
    })().finally(() => {
      syncing = null;
    });
    return syncing;
  }

  // --- the live channel -----------------------------------------------------------------------
  const wsBase = CONFIG.api.replace(/\/+$/, '').replace(/^http/, 'ws');
  const live = createLive({
    connect: async () => {
      const { ticket } = await signedIn((tok) => api.liveTicket(tok));
      return /** @type {any} */ (new WebSocket(`${wsBase}/v1/live?ticket=${encodeURIComponent(ticket)}`));
    },
    onFrame: (f) => {
      if (f.t === 'hello' && f.seq !== state.seq) sync().catch(() => {});
      else if (f.t === 'changed' && f.seq > state.seq) {
        state.seq = f.seq;
        sync(new Set(f.kinds)).catch(() => {});
      } else if (f.t === 'typing') {
        state.typingUntil = f.until;
        paint();
      }
    },
    onState: (s) => {
      if (s === 'signed_out') signedIn((tok) => api.me(tok)).catch(() => {}); // the 401 path wipes and leaves
    },
  });

  // --- sending --------------------------------------------------------------------------------
  /** @type {Set<string>} */
  const inFlight = new Set();
  /** @param {import('./model.js').Local} m */
  async function send(m) {
    if (inFlight.has(m.id)) return;
    inFlight.add(m.id);
    try {
      const out = await signedIn((tok) => api.say(tok, m.id, m.body));
      await outbox.remove(m.id);
      state.local = state.local.filter((x) => x.id !== m.id);
      if (state.today && !state.today.messages.some((x) => x.id === out.id)) state.today.messages.push(out);
      try {
        localStorage.setItem('th.p.sent', '1');
      } catch {}
    } catch (e) {
      const f = failure(e);
      const retryable = f.kind !== 'api' || f.status >= 500 || f.status === 429;
      m.tries++;
      m.state = !retryable ? 'failed' : !navigator.onLine ? 'queued' : m.tries >= model.RETRY_MS.length + 1 ? 'failed' : 'sending';
      if (m.state === 'sending') setTimeout(() => send(m), model.RETRY_MS[m.tries - 1]);
      await outbox.put(m);
    } finally {
      inFlight.delete(m.id);
      paint();
    }
  }
  /** Sends the outbox in order, one at a time (HOME.md §4.7). */
  async function flush() {
    for (const m of state.local) if (m.state === 'queued' || m.state === 'sending') await send(m);
  }
  /** @param {string} id */
  function retry(id) {
    const m = state.local.find((x) => x.id === id);
    if (!m) return;
    m.state = 'sending';
    m.tries = 0;
    send(m);
  }
  ask.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = q.value.trim();
    if (!body) return;
    if (body.length > model.MAX_CHARS) return toast('Too long to send. Try sending it as a file.');
    if (state.local.length >= OUTBOX_MAX) return toast('Too much waiting to send. Connect to send the rest.');
    q.value = '';
    ask.classList.remove('typing');
    $('#hint')?.classList.add('gone');
    const now = Date.now();
    /** @type {import('./model.js').Local} */
    const m = { id: model.uuidv7(now), body, created_at: now, state: navigator.onLine ? 'sending' : 'queued', tries: 0 };
    state.local.push(m);
    await outbox.put(m);
    paint();
    if (m.state === 'sending') send(m);
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
    Object.assign(state, { today: cached.today, presence: cached.presence, surfaces: cached.surfaces ?? [], seq: 0 });
    paint();
  }
  try {
    await Promise.all([loadToday(), loadSettings(), loadSurfaces()]);
  } catch {
    // offline or the Worker is away: the cached state stands and the outbox waits
  }
  state.loaded = true;
  paint();
  save();
  live.start();
  runVerbs();
  flush();
  addEventListener('online', () => {
    state.offline = false;
    for (const m of state.local) if (m.state === 'queued') m.state = 'sending';
    live.wake();
    flush();
    paint();
  });
  addEventListener('offline', () => {
    state.offline = true;
    paint();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    live.wake();
    sync().catch(() => {});
    flush();
  });
}
