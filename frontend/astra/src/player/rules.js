// The player's small pure rules for its newer features, kept apart so they
// are unit-tested (tests/astra-player.test.mjs): speed, the sleep timer,
// A–B repeat, zoom, chapters, subtitle search, a still's file name and the
// source line.

import {SPEEDS} from './prefs.js';

/** A saved or asked speed as one of the menu's (the nearest), so a damaged pref cannot play at 16×. */
export function normalSpeed(x) {
  if (!Number.isFinite(x) || x <= 0) return 1;
  return SPEEDS.reduce((best, s) => Math.abs(s - x) < Math.abs(best - x) ? s : best, 1);
}

export const SLEEP_CHOICES = [0, 15, 30, 45, 60, 'episode'];

/**
 * A sleep timer from a choice: {minutes, until} counted on the wall clock, or
 * {episode: true}; null for Off.
 */
export function sleepTimer(choice, now) {
  if (choice === 'episode') return {episode: true};
  return choice > 0 ? {minutes: choice, until: now + choice * 60000} : null;
}

/**
 * Seconds left on a timer: the wall clock for minutes; for "end of episode"
 * the film's own time left at its speed (null when the length is unknown).
 */
export function sleepLeft(timer, {now, time = 0, duration = NaN, rate = 1}) {
  if (!timer) return null;
  if (!timer.episode) return Math.max(0, (timer.until - now) / 1000);
  return Number.isFinite(duration) && duration > 0 ? Math.max(0, (duration - time) / (rate || 1)) : null;
}

/** "29:59", "1:00:00" (whole seconds, rounded up so it never shows 0:00 before it fires). */
export function sleepLabel(seconds) {
  const s = Math.ceil(Math.max(0, seconds)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  return (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
}

export const MIN_REPEAT = 1;
/** The part to repeat from two marks, in either order; null when shorter than a second. */
export function repeatRange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const start = Math.min(a, b), end = Math.max(a, b);
  return end - start >= MIN_REPEAT ? {start, end} : null;
}
/** Whether a seek to `t` leaves the part (the owner went elsewhere: the loop ends). Half a second of slack. */
export const outsideRange = (t, r) => !!r && (t < r.start - 0.5 || t > r.end + 0.5);

export const MAX_ZOOM = 4;
/**
 * Zoom keeps the picture covering its box: the shift (from the centre, in
 * px) may move an edge only as far as the enlargement lets it.
 */
export function clampPan({x, y}, scale, w, h) {
  const mx = (scale - 1) * w / 2, my = (scale - 1) * h / 2;
  return {x: Math.max(-mx, Math.min(mx, x)) || 0, y: Math.max(-my, Math.min(my, y)) || 0};
}
/**
 * A pinch: from the zoom at its start {scale, x, y}, the fingers' distance
 * grown by `ratio` about `focus` (px from the box's centre, where the fingers
 * started). The point under the fingers stays under them.
 */
export function pinchZoom(start, ratio, focus, w, h) {
  const scale = Math.max(1, Math.min(MAX_ZOOM, start.scale * ratio));
  const k = scale / start.scale;
  return {scale, ...clampPan({x: focus.x - (focus.x - start.x) * k, y: focus.y - (focus.y - start.y) * k}, scale, w, h)};
}

/** The chapter playing at `t`, or null. */
export function chapterAt(chapters, t) {
  if (!Array.isArray(chapters)) return null;
  return chapters.find(c => t >= c.start && t < c.end) || null;
}

/** Where chapter boundaries go on a bar `width` px wide (fractions), dropping any closer than `gap` px to the last kept. */
export function chapterTicks(chapters, duration, width, gap = 6) {
  if (!Array.isArray(chapters) || !(duration > 0) || !(width > 0)) return [];
  const out = [];
  let last = 0; // the bar's own start counts as a tick
  for (const c of chapters) {
    const f = c.start / duration;
    if (!(f > 0 && f < 1)) continue;
    if ((f - last) * width < gap || (1 - f) * width < gap) continue;
    out.push(f); last = f;
  }
  return out;
}

/** Lower case without accents, for matching "Éte" with "ete". */
export const fold = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A cue's text as one line. */
export const cueText = c => (c.spans || []).map(s => s.text || '').join('').replace(/\s+/g, ' ').trim();

/**
 * The subtitle lines matching `query` (all of them for an empty one), in
 * time order: at most `limit` rows, and how many matched.
 */
export function findLines(cues, query, limit = 200) {
  const q = fold(query.trim()), rows = [];
  let total = 0;
  for (const c of [...(cues || [])].sort((a, b) => a.start - b.start)) {
    const text = cueText(c);
    if (!text || (q && !fold(text).includes(q))) continue;
    if (total++ < limit) rows.push({start: c.start, text});
  }
  return {rows, total};
}

/** One frame forwards or back: the file's frame rate when known, else 24. */
export function frameStep(time, direction, fps) {
  const rate = Number.isFinite(fps) && fps > 1 ? fps : 24;
  return Math.max(0, time + direction / rate);
}

/** A still's file name: "<title> <time>.png", with nothing a file system refuses (the clock's colons become dots). */
export function stillName(title, time, clock) {
  const name = String(title || 'Astra').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Astra';
  return `${name} ${clock(time).replace(/:/g, '.')}.png`;
}

/**
 * The source line without the add-on's name twice: the app puts the add-on's
 * name before the stream's, and many add-ons start the stream's name with
 * their own ("Example Example 1080p", "Example · Example 4K"). A leading run
 * of up to three words that appears again later is dropped, with any
 * separator left in front.
 */
export function viaName(name) {
  const words = String(name || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const key = w => w.toLowerCase();
  for (let n = Math.min(3, Math.floor(words.length / 2)); n >= 1; n--) {
    const lead = words.slice(0, n).map(key);
    if (lead.join('').replace(/[^\p{L}\p{N}]/gu, '').length < 2) continue;
    for (let i = n; i + n <= words.length; i++) {
      if (lead.every((w, j) => key(words[i + j]) === w)) {
        const rest = words.slice(n);
        while (rest.length && !/[\p{L}\p{N}]/u.test(rest[0])) rest.shift();
        return rest.join(' ');
      }
    }
  }
  return words.join(' ');
}
