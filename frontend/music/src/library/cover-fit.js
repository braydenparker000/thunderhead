// Wide covers shown as their square (owner, 2026-11-26). A cover at least 1.3 times as wide as it is high is
// looked at once on the phone (a 64 px high copy, cover-crop.js coverCrop): a square picture with filler sides
// is shown as that square everywhere (the grid's 256 px thumbnails, made from the square; the player's full
// cover; the lock screen's artwork, MediaSession; downloads), a genuinely wide picture stays whole. Nothing in
// the owner's storage changes. What was decided is remembered per cover in this phone's cp-cover-fit (the
// cover's own key, as the cover caches keep it: the bucket cover's when songs share one, else the song's
// address), at most CAP covers, the least recently decided out first:
//   key → {a: aspect, r: [x, y, w, h] the square as fractions, c: 1 when its sides are filler, o: the owner's
//   pick, 'crop' or 'full', when he chose one}.
// "Show Full Cover" / "Crop Cover" in the playing song's menu and an album page's menu flips one cover's (an
// album's covers) and keeps it; Settings › Album Art › "Crop wide covers to the centre" (cp_crop_wide_covers,
// on unless switched off) turns the automatic crop off or on at once (library.js refreshArt). A pick of the
// owner's stands either way.
import {coverCrop, cropPixels, isWide, packRect, smallSize, unpackRect} from './cover-crop.js';
import {busy} from '../view/idle-work.js';
import {GONE, VISIBLE} from '../res/values.js';

export const FIT_KEY = 'cp_crop_wide_covers';
export const WORDS = {
  full: 'Show Full Cover', crop: 'Crop Cover', setting: 'Crop wide covers to the centre',
  summary: 'A wide cover that is a square picture with plain or blurred sides shows as the square. Off: every cover whole.',
};
const STORE = 'cp-cover-fit', CAP = 3000, SAVE_MS = 400;
// The menus' Album Art glyph.
const ICON = '?album_art';

let map = null, saveTimer = 0;
// The page's preference reader (installCoverFit); before it, the crop is on.
let prefOf = () => undefined;

function load() {
  if (map) return map;
  map = new Map();
  try {
    const o = JSON.parse(localStorage.getItem(STORE) ?? '{}');
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (v && unpackRect(v.r)) map.set(k, v);
  } catch { /* storage unavailable */ }
  return map;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE, JSON.stringify(Object.fromEntries(map))); } catch { /* storage full or unavailable */ }
  }, SAVE_MS);
}

/** What is remembered for a cover, or null (not looked at, or not wide). */
export const fitEntry = key => load().get(key) ?? null;

/** Keeps coverCrop's answer for a cover (the most recent last; past CAP the oldest go). */
export function remember(key, res, pick) {
  const m = load(), e = {a: Math.round(res.aspect * 100) / 100, r: packRect(res.square), c: res.crop ? 1 : 0};
  if (pick ?? m.get(key)?.o) e.o = pick ?? m.get(key).o;
  m.delete(key);
  m.set(key, e);
  for (const k of m.keys()) { if (m.size <= CAP) break; m.delete(k); }
  save();
  return e;
}

/** The owner's pick for covers: 'crop', 'full', or null (back to the rule). */
export function choose(keys, pick) {
  const m = load();
  for (const k of keys) {
    const e = m.get(k);
    if (!e) continue;
    if (pick) e.o = pick; else delete e.o;
  }
  save();
}

/** Whether the automatic crop is on (Settings; on unless switched off). */
export const fitOn = () => prefOf(FIT_KEY) !== false;

/** The rectangle (fractions) to show a cover as now, or null for the whole cover. */
export function cropRect(key) {
  const e = fitEntry(key);
  if (!e) return null;
  return (e.o ? e.o === 'crop' : e.c && fitOn()) ? unpackRect(e.r) : null;
}

/** The cover's key as library.js keeps it (Library.coverOf), from the song alone. */
export const trackCoverKey = t => (t?.remote && t.artUrl && t.coverKey ? 'cover:' + t.coverKey : t?.artId ?? null);

/** A song's cover crop for a download (packed fractions), or null to embed the cover whole. */
export function trackCrop(t) {
  const key = trackCoverKey(t), r = key ? cropRect(key) : null;
  return r ? packRect(r) : null;
}

const canvasOf = (w, h) => (typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), {width: w, height: h}));

/**
 * Looks at a wide cover once (its w×h from the header): the entry kept for it, or null when it is not wide or
 * cannot be read here. One already decided is not looked at again.
 */
export async function decide(key, blob, w, h) {
  if (!isWide(w, h)) return null;
  const have = fitEntry(key);
  if (have) return have;
  const s = smallSize(w, h);
  try {
    const bmp = await createImageBitmap(blob, {resizeWidth: s.width, resizeHeight: s.height, resizeQuality: 'medium'});
    const g = canvasOf(s.width, s.height).getContext('2d', {willReadFrequently: true});
    g.drawImage(bmp, 0, 0, s.width, s.height);
    bmp.close?.();
    const res = coverCrop(g.getImageData(0, 0, s.width, s.height));
    return res ? remember(key, res) : null;
  } catch {
    return null;
  }
}

/** A w×h image cut to `rect` (fractions), at most `side` px on its longer side, as a JPEG; null when it cannot be. */
export async function cropBlob(blob, rect, w, h, side) {
  const p = cropPixels(rect, w, h);
  if (!p) return null;
  try {
    const k = Math.min(1, side / Math.max(p.sw, p.sh));
    const ow = Math.max(1, Math.round(p.sw * k)), oh = Math.max(1, Math.round(p.sh * k));
    const bmp = await createImageBitmap(blob, p.sx, p.sy, p.sw, p.sh, k < 1 ? {resizeWidth: ow, resizeHeight: oh, resizeQuality: 'high'} : undefined);
    const canvas = canvasOf(ow, oh), g = canvas.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, ow, oh);
    bmp.close?.();
    return canvas.convertToBlob ? await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9}) : await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.9));
  } catch {
    return null;
  }
}

// Work for later, one at a time, each in an idle callback once nothing moves or was touched lately (view/idle-work.js
// busy): no burst of decodes. (Not the idle-work queue itself: its long jobs, the spare rows, would hold a cover's
// swap back for many seconds.) A phone that is never idle runs one every IDLE_WAIT_MS at the latest.
const queue = [];
let draining = false;
const IDLE_WAIT_MS = 1500, TRIES = 8;
const idle = () => new Promise(r => (globalThis.requestIdleCallback ? requestIdleCallback(() => r(), {timeout: IDLE_WAIT_MS}) : setTimeout(r, 50)));
export function later(ctx, fn) {
  queue.push(fn);
  if (draining) return;
  draining = true;
  (async () => {
    while (queue.length) {
      for (let i = 0; i < TRIES; i++) { await idle(); if (!busy(ctx)) break; }
      await Promise.resolve().then(queue.shift()).catch(() => {});
    }
    draining = false;
  })();
}

/** The covers a menu row stands for: the playing song's, or an album page's songs'. */
function menuTracks(ctx, layout) {
  if (layout === 'merge_menu_items_aa') return ctx.player?.track ? [ctx.player.track] : [];
  const src = ctx.listWidget?.stack?.at(-1);
  return src?.group?.kind === 'album' && !src.playlist ? src.group.tracks ?? [] : [];
}

/** The covers of these songs that were looked at and are wide (no picked image over them). */
function wideKeys(ctx, tracks) {
  const lib = ctx.library, keys = new Set();
  for (const t of tracks) {
    if (!t?.artId || (lib?.customArt?.size && lib.customArtFor(t))) continue;
    const k = lib?.coverOf?.(t.artId) ?? t.artId;
    if (fitEntry(k)) keys.add(k);
  }
  return keys;
}

/** "Show Full Cover" / "Crop Cover", a row of the menu's own (?PopupMenuItem), in the playing song's menu and an album page's. */
export function coverFitItem(ctx, items, layout) {
  if (!items || items.findViewById('cover_fit') || !/^merge_menu_items_(aa|tracks)$/.test(layout ?? '')) return;
  const aa = layout === 'merge_menu_items_aa', sep = aa ? items.findViewById('download_song') : null;
  ctx.inflater.inflateNode(['com.maxmpz.widget.base.BusActionButton', {
    'android:id': '@id/cover_fit', 'android:visibility': 'gone', 'android:text': WORDS.full, 'android:drawable': ICON,
    'w:busId': aa ? '@id/bus_gui' : '@id/list', 'w:msgId': aa ? '@id/cmd_cover_fit_playing' : '@id/cmd_list_cover_fit', style: '?PopupMenuItem',
  }], items, null, sep ? {at: items.children.indexOf(sep) + 1} : undefined);
}

/** At each opening: the row shown for a wide cover, saying what it will do. */
export function prepareCoverFit(ctx, items, layout) {
  const row = items?.findViewById('cover_fit');
  if (!row) return;
  const keys = [...wideKeys(ctx, menuTracks(ctx, layout))];
  row.setVisibility(keys.length && !ctx.pref?.('aa_force_default') ? VISIBLE : GONE);
  if (keys.length) row.setText(keys.some(k => cropRect(k)) ? WORDS.full : WORDS.crop);
}

/** Flips the covers a menu stands for: shown cropped, all whole; else all cropped. Kept (cp-cover-fit). */
function flip(ctx, tracks) {
  const keys = wideKeys(ctx, tracks);
  if (!keys.size) return;
  choose(keys, [...keys].some(k => cropRect(k)) ? 'full' : 'crop');
  ctx.library?.refreshCovers?.(keys);
}

/**
 * Settings › Album Art with "Crop wide covers to the centre" (cp_crop_wide_covers, on unless switched off), the
 * first of its Advanced Tweaks, before Force Default Image (settings.js screen 'aa').
 */
export function withCropSwitch(tree) {
  const nested = Array.isArray(tree[0]), root = nested ? tree[0] : tree, kids = root[2] ?? [];
  const key = n => n?.[1]?.['android:key'];
  const at = kids.findIndex(c => (c[2] ?? []).some(n => key(n) === 'aa_force_default'));
  if (at < 0) return tree;
  const cat = kids[at], rows = cat[2];
  const row = ['com.maxmpz.audioplayer.preference.MultilineSwitchPreference', {
    'android:title': WORDS.setting, 'android:key': FIT_KEY, 'android:defaultValue': 'true', 'android:summary': WORDS.summary,
  }];
  const i = rows.findIndex(n => key(n) === 'aa_force_default');
  const copy = [root[0], root[1], kids.map((c, k) => (k === at ? [cat[0], cat[1], [...rows.slice(0, i), row, ...rows.slice(i)]] : c))];
  return nested ? [copy, ...tree.slice(1)] : copy;
}

export function installCoverFit(ctx) {
  prefOf = k => ctx.pref?.(k);
  ctx.bus.subscribe('bus_gui', msg => { if (msg === 'cmd_cover_fit_playing') flip(ctx, menuTracks(ctx, 'merge_menu_items_aa')); });
  ctx.bus.subscribe('list', msg => { if (msg === 'cmd_list_cover_fit') flip(ctx, menuTracks(ctx, 'merge_menu_items_tracks')); });
}
