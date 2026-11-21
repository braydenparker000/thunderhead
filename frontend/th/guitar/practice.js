// @ts-check
// Guitar's practice loop in the reader (NEXT-BATCH.md part 9, the owner's yes; GUITAR.md §4.3,
// §8.1). With the tempo ladder on, after each pass of a loop a strip asks Clean or Not yet for 3 s
// (keys C and N; no answer is not counted), and the speed climbs by the ladder (ladder.js). Each
// section's record stays on this phone (`th.p.guitar.ladder`, cleared on sign-out with the rest of
// `th.p.*`), so the next day starts near the last ceiling and opens on the bars that went worst;
// signed in, it goes to the Worker with the song's progress and comes back after a sign-in or on
// another phone (th/guitar/progress.js, GUITAR.md §1.1). A song's sections are read from storage
// each time and written over what is stored then, so the sync's writes are never lost.
// Signed in, each marked pass, each new best and each session go to the Worker as practice senses
// (numbers and bar ranges only), so the mind's tips and plan come from how the owner plays. The
// session is sent once: when the reader closes, or, when the owner leaves the page first, kept on
// the phone as the page goes (`th.p.guitar.session`: a page going away can't finish a send) and
// sent when the page comes back or Guitar next opens.
// Loaded by the ported reader (frontend/guitar/reader.js, a recorded improvement in ported.json).
import { climb, judge, noted, sectionKey, weakest } from './ladder.js';

export const KEY = 'th.p.guitar.ladder';
const STRIP_MS = 3000;
/** @type {import('./ladder.js').LadderPrefs} */
const PREFS = { on: false, start: 70, step: 4, target: 100 };

/** @typedef {import('./ladder.js').Rec} Rec */
/** @typedef {{ prefs: import('./ladder.js').LadderPrefs }} Kept */

/** What is stored, or null. @param {Storage} storage @returns {{ prefs?: any, songs?: any } | null} */
function stored(storage) {
  try {
    const v = JSON.parse(storage.getItem(KEY) || 'null');
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
/** One song's sections as stored now ({} for none). @param {Storage} storage @param {string} song
 * @returns {Record<string, Rec>} */
export function ladderOf(storage, song) {
  const r = stored(storage)?.songs?.[song];
  return r && typeof r === 'object' ? r : {};
}
/** Writes the prefs (when given) and one song's sections (when given) over what is stored now.
 * @param {Storage} storage @param {import('./ladder.js').LadderPrefs | null} prefs
 * @param {string} [song] @param {Record<string, Rec>} [sections] */
export function saveLadder(storage, prefs, song, sections) {
  const v = stored(storage);
  const songs = v?.songs && typeof v.songs === 'object' ? v.songs : {};
  if (song && sections) songs[song] = sections;
  const kept = prefs ?? v?.prefs;
  try {
    storage.setItem(KEY, JSON.stringify(kept ? { prefs: kept, songs } : { songs }));
  } catch {}
}

/** @param {any} oldTrainer the speed trainer's prefs, which the ladder replaces @returns {Kept} */
function load(oldTrainer) {
  const v = stored(localStorage);
  if (v?.prefs && typeof v.prefs === 'object') return { prefs: { ...PREFS, ...v.prefs } };
  // Someone who had the speed trainer on gets the ladder on, up to the same speed.
  const target = Math.min(150, Math.max(50, Number(oldTrainer?.target) || 100));
  return { prefs: { ...PREFS, on: !!oldTrainer?.on, target } };
}
const today = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
/** @param {string} type @param {string} ref @param {Record<string, unknown> | null} data */
const sense = (type, ref, data) => import('/th/senses/send.js').then((m) => m.sense(type, ref, data)).catch(() => {});

/** Sessions kept as the page went away, not sent yet. */
export const PENDING = 'th.p.guitar.session';
/** Sends the kept sessions, each once: taken out of storage before it is sent. */
function sendPending() {
  /** @type {unknown} */
  let kept = null;
  try {
    kept = JSON.parse(localStorage.getItem(PENDING) || 'null');
    localStorage.removeItem(PENDING);
  } catch {}
  for (const p of Array.isArray(kept) ? kept : []) if (typeof p?.ref === 'string' && p.data && typeof p.data === 'object') sense('guitar.session', p.ref, p.data);
}
if (typeof window !== 'undefined') {
  sendPending();
  addEventListener('pageshow', (e) => e.persisted && sendPending());
}

/**
 * @param {any} reader the ported reader: song, timeline, root, store, prefs, setLoopBars, clearLoop, updateSpeedLabel, say
 * @param {any} player the ported player: bars, speed, playing, setSpeed, seek
 * @param {{ el: Function, slider: Function, toast: Function }} ui the ported app's own helpers
 */
export function practiceLoop(reader, player, ui) {
  const kept = load(reader.prefs?.trainer);
  /** @type {{ a: number, b: number, key: string } | null} */
  let sec = null;
  /** @type {import('./ladder.js').Climb | null} */
  let c = null;
  /** @type {HTMLElement | null} */
  let strip = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let stripTimer;
  /** @type {((e: KeyboardEvent) => void) | null} */
  let keys = null;
  const opened = Date.now();
  let played = 0;
  /** The best clean tempo this session, in BPM. */
  let reached = 0;
  const marked = new Set();
  const tick = setInterval(() => {
    if (player.playing && document.visibilityState === 'visible') played += 5;
  }, 5000);

  const tempo = () => reader.timeline?.tempos?.[0]?.[1] || 120;
  const bpm = (/** @type {number} */ pct) => Math.round((tempo() * pct) / 100);
  const bar = (/** @type {number} */ i) => (player.bars?.[i]?.mb ?? i) + 1;
  const bars = (/** @type {number} */ a, /** @type {number} */ b) => (a === b ? `bar ${bar(a)}` : `bars ${bar(a)}–${bar(b)}`);
  const ref = () => `tab:${reader.song.key}${sec ? `#b${bar(sec.a)}-${bar(sec.b)}` : ''}`;
  /** This song's sections, as stored now. */
  const records = () => ladderOf(localStorage, reader.song.key);
  /** Plays at `pct` % from now and remembers it as the song's speed. @param {number} pct */
  const play = (pct) => {
    player.setSpeed(pct / 100);
    reader.store.update(reader.song.key, { speed: pct });
    reader.updateSpeedLabel();
  };

  function hide() {
    clearTimeout(stripTimer);
    strip?.remove();
    strip = null;
    if (keys) removeEventListener('keydown', keys, true);
    keys = null;
  }

  /** @param {boolean} clean @param {number} pct the speed the pass was played at */
  function mark(clean, pct) {
    hide();
    if (!sec || !c) return;
    const recs = records();
    const prev = recs[sec.key];
    recs[sec.key] = noted(prev, pct, clean, today());
    saveLadder(localStorage, kept.prefs, reader.song.key, recs);
    reader.store.touch?.(reader.song.key);
    marked.add(sec.key);
    sense('guitar.pass', ref(), { bpm: bpm(pct), speed_pct: pct, clean, by: 'owner' });
    if (clean && pct > (prev?.best || 0)) sense('guitar.bpm', ref(), { bpm: bpm(pct) });
    if (clean) reached = Math.max(reached, bpm(pct));
    c = judge(c, clean, kept.prefs.step);
    if (c.moved) {
      play(c.speed);
      reader.say(c.moved === 'up' ? `Up to ${bpm(c.speed)} BPM.` : `Back to ${bpm(c.speed)} BPM.`);
    } else if (c.slower && !clean) reader.say('Most passes are rough. Next time, start slower.');
  }

  /** A loop's pass ended at `speed` (a fraction): ask how it went. @param {number} speed */
  function passed(speed) {
    if (!kept.prefs.on || !sec || !c) return;
    hide();
    const pct = Math.round(speed * 100);
    strip = ui.el(
      'div.th-judge',
      { role: 'group', 'aria-label': `How was that pass at ${bpm(pct)} BPM?`, style: 'position:fixed;left:12px;right:12px;bottom:calc(150px + env(safe-area-inset-bottom,0px));z-index:30;display:flex;gap:10px' },
      ui.el('button.th-clean', { type: 'button', style: BTN + 'background:#2f9e6b;color:#fff', onclick: () => mark(true, pct) }, 'Clean'),
      ui.el('button.th-not', { type: 'button', style: BTN + 'background:#30333a;color:#f4f4f5', onclick: () => mark(false, pct) }, 'Not yet'),
    );
    reader.root.append(strip);
    keys = (e) => {
      const k = e.key.toLowerCase();
      if (k !== 'c' && k !== 'n') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      mark(k === 'c', pct);
    };
    addEventListener('keydown', keys, true);
    stripTimer = setTimeout(hide, STRIP_MS);
  }

  /** The loop is now bars a–b (null: no loop). `start` plays its climb's speed at once.
   * @param {number | null} a @param {number} [b] @param {boolean} [start] */
  function section(a, b = a ?? 0, start = true) {
    hide();
    if (a === null) {
      sec = null;
      c = null;
      return;
    }
    sec = { a, b, key: sectionKey(a, b) };
    c = kept.prefs.on ? climb(kept.prefs, records()[sec.key]) : null;
    if (c && start) {
      play(c.speed);
      reader.say(`${bpm(c.speed)} BPM. Mark each pass Clean or Not yet.`);
    }
  }

  /** The song is open: one sense that this piece opened; a new day opens on the bars that went worst
   * last time, at its climb's speed. */
  function ready() {
    sense('guitar.piece_opened', `tab:${reader.song.key}`, null);
    if (!kept.prefs.on || !player.bars) return;
    const w = weakest(records(), today());
    if (w && w.key !== sec?.key) {
      const [a, b] = w.key.split('-').map(Number);
      if (b < player.bars.length) {
        const before = sec && [sec.a, sec.b];
        reader.setLoopBars(a, b, false);
        player.seek(player.bars[a].s);
        ui.toast(`Starting on ${bars(a, b)}, the hardest last time (${w.clean} of ${w.passes} clean).`, {
          label: 'Undo',
          ms: 6000,
          action: () => (before ? reader.setLoopBars(before[0], before[1], true) : reader.clearLoop(true)),
        });
      }
    }
    if (sec) section(sec.a, sec.b, true);
  }

  /** The ladder's switch and settings, in the Speed sheet where the speed trainer was. */
  function controls() {
    const p = kept.prefs;
    const set = (/** @type {Partial<import('./ladder.js').LadderPrefs>} */ patch) => {
      kept.prefs = { ...kept.prefs, ...patch };
      saveLadder(localStorage, kept.prefs);
      if (sec) section(sec.a, sec.b, 'on' in patch);
    };
    return ui.el(
      'div.trainer',
      {},
      ui.el(
        'label.switch',
        {},
        ui.el('span', {}, ui.el('strong', {}, 'Tempo ladder'), ui.el('small', {}, 'Mark each loop Clean or Not yet; two clean in a row go faster')),
        ui.el('input', { type: 'checkbox', role: 'switch', checked: !!p.on, onchange: (/** @type {any} */ e) => set({ on: e.target.checked }) }),
      ),
      ui.slider({ label: 'Start', min: 40, max: 100, step: 5, value: p.start, format: (/** @type {number} */ v) => `${v}%`, oninput: (/** @type {number} */ v) => set({ start: v }) }),
      ui.slider({ label: 'Step', min: 2, max: 10, value: p.step, format: (/** @type {number} */ v) => `+${v}%`, oninput: (/** @type {number} */ v) => set({ step: v }) }),
      ui.slider({ label: 'Up to', min: 50, max: 150, step: 5, value: p.target, format: (/** @type {number} */ v) => `${v}%`, oninput: (/** @type {number} */ v) => set({ target: v }) }),
    );
  }

  let sent = false;
  /** One session sense, if anything was played or marked, with the best clean tempo reached in it
   * (the tempo the session got to; none when no pass was clean); never twice. As the page goes
   * (`pagehide`) it is kept to send later (sendPending). @param {Event} [e] */
  function session(e) {
    if (sent || !(played >= 5 || marked.size)) return;
    sent = true;
    const ref = `tab:${reader.song.key}`;
    const data = { seconds: Math.round((Date.now() - opened) / 1000), played_seconds: played, sections: [...marked], ...(reached ? { bpm: reached } : {}) };
    if (e?.type !== 'pagehide') return void sense('guitar.session', ref, data);
    try {
      const kept = JSON.parse(localStorage.getItem(PENDING) || '[]');
      localStorage.setItem(PENDING, JSON.stringify([...(Array.isArray(kept) ? kept : []), { ref, data }].slice(-20)));
    } catch {}
  }
  // The owner leaves the page with the reader open (home, another app, the tab closed):
  // the session is recorded then, not only when the reader closes.
  addEventListener('pagehide', session);

  /** The reader closed: the session, unless the page's leaving sent it already. */
  function end() {
    clearInterval(tick);
    hide();
    removeEventListener('pagehide', session);
    session();
  }

  return { passed, section, ready, controls, end };
}

// Solid, with a shadow: the strip sits over the fretboard for 3 s and must read at a glance.
const BTN = 'flex:1;min-height:56px;border:0;border-radius:16px;font:inherit;font-size:17px;font-weight:600;box-shadow:0 10px 28px rgba(0,0,0,.5);';
