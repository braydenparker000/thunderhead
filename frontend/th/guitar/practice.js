// @ts-check
// Guitar's practice loop in the reader (NEXT-BATCH.md part 9, the owner's yes; GUITAR.md §4.3,
// §8.1). With the tempo ladder on, after each pass of a loop a strip asks Clean or Not yet for 3 s
// (keys C and N; no answer is not counted), and the speed climbs by the ladder (ladder.js). Each
// section's record stays on this phone (`th.p.guitar.ladder`, cleared on sign-out with the rest of
// `th.p.*`), so the next day starts near the last ceiling and opens on the bars that went worst.
// Signed in, each marked pass, each new best and each session go to the Worker as practice senses
// (numbers and bar ranges only), so the mind's tips and plan come from how the owner plays.
// Loaded by the ported reader (frontend/guitar/reader.js, a recorded improvement in ported.json).
import { climb, judge, noted, sectionKey, weakest } from './ladder.js';

const KEY = 'th.p.guitar.ladder';
const STRIP_MS = 3000;
/** @type {import('./ladder.js').LadderPrefs} */
const PREFS = { on: false, start: 70, step: 4, target: 100 };

/** @typedef {import('./ladder.js').Rec} Rec */
/** @typedef {{ prefs: import('./ladder.js').LadderPrefs, songs: Record<string, Record<string, Rec>> }} Kept */

/** @param {any} oldTrainer the speed trainer's prefs, which the ladder replaces @returns {Kept} */
function load(oldTrainer) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && typeof v === 'object' && v.prefs) return { prefs: { ...PREFS, ...v.prefs }, songs: v.songs && typeof v.songs === 'object' ? v.songs : {} };
  } catch {}
  // Someone who had the speed trainer on gets the ladder on, up to the same speed.
  const target = Math.min(150, Math.max(50, Number(oldTrainer?.target) || 100));
  return { prefs: { ...PREFS, on: !!oldTrainer?.on, target }, songs: {} };
}
/** @param {Kept} k */
function save(k) {
  try {
    localStorage.setItem(KEY, JSON.stringify(k));
  } catch {}
}
const today = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
/** @param {string} type @param {string} ref @param {Record<string, unknown> | null} data */
const sense = (type, ref, data) => import('/th/senses/send.js').then((m) => m.sense(type, ref, data)).catch(() => {});

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
  const records = () => (kept.songs[reader.song.key] ??= {});
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
    const prev = records()[sec.key];
    records()[sec.key] = noted(prev, pct, clean, today());
    save(kept);
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
      save(kept);
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

  /** The reader closed: one session sense, if anything was played or marked, with the best clean
   * tempo reached in it (the tempo the session got to; none when no pass was clean). */
  function end() {
    clearInterval(tick);
    hide();
    if (played >= 5 || marked.size)
      sense('guitar.session', `tab:${reader.song.key}`, { seconds: Math.round((Date.now() - opened) / 1000), played_seconds: played, sections: [...marked], ...(reached ? { bpm: reached } : {}) });
  }

  return { passed, section, ready, controls, end };
}

// Solid, with a shadow: the strip sits over the fretboard for 3 s and must read at a glance.
const BTN = 'flex:1;min-height:56px;border:0;border-radius:16px;font:inherit;font-size:17px;font-weight:600;box-shadow:0 10px 28px rgba(0,0,0,.5);';
