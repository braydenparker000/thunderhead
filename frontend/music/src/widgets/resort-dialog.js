// Re-Sort (PlaylistSortActivity, dialog_content_resort; notebook F66): the
// Queue's entries take a new stored order; a playlist shows in the order
// chosen while it is open, and "Save this order" stores it (owner,
// 2026-11-25). Each choice re-sorts at once (cmd_data_resort); Reverse (bit
// 30) flips every key.
// The orders are cm2.q's: names case folded (COLLATE NOCASE), album and
// artist by their sort fields (no leading article unless no_sort_field),
// ties broken by the title; Random ignores Reverse. "By added to list"
// (14) is the Queue's entry time; playlists have none and hide it.
import {openDialog} from './dialog.js';
import {GONE} from '../res/values.js';
import {FastRadioButton, FastCheckBox} from '../view/text.js';

export const REVERSE = 0x40000000;
const ARTICLE = /^(the|a|an)\s+/i;

const fold = s => String(s ?? '').toLowerCase();
const cmpText = (a, b) => { const x = fold(a), y = fold(b); return x < y ? -1 : x > y ? 1 : 0; };
const cmpNum = (a, b) => (a ?? 0) - (b ?? 0);
const fileName = t => { const p = t.fileName || t.path || ''; return p.slice(p.lastIndexOf('/') + 1); };

/** Sort keys per value: [compare(a, b) of entries, descending by default]. */
function keys(ctx, value) {
  const sortField = s => (ctx.pref?.('no_sort_field') ? s : String(s ?? '').replace(ARTICLE, ''));
  const album = e => sortField(e.track.album), artist = e => sortField(e.track.albumArtist || e.track.artist);
  const T = (f, desc = false) => [(a, b) => cmpText(f(a), f(b)), desc];
  const N = (f, desc = false) => [(a, b) => cmpNum(f(a), f(b)), desc];
  const title = T(e => e.track.title);
  switch (value) {
    case 0: return [N(e => e.track.track), title];
    case 1: return [title];
    case 2: return [T(e => fileName(e.track))];
    case 3: return [T(album), T(artist), title];
    case 4: case 5: return [T(artist), T(album), title];
    case 6: return [N(e => e.track.year), title];
    case 7: return [N(e => e.track.modified || e.track.added), title];
    case 8: return [N(e => e.track.rating, true), title];
    case 10: return [N(e => e.track.added), title];
    case 11: return [N(e => e.track.durationMs, true), title];
    case 12: return [N(e => e.track.plays, true), title];
    case 13: return [N(e => e.track.lastPlayed, true), title];
    case 14: return [N(e => e.created)];
    case 16: return [T(e => e.track.path || fileName(e.track))];
    case 17: return [T(artist), T(album), N(e => e.track.track)];
    case 18: return [T(album), N(e => e.track.track)];
    default: return null;
  }
}

/** The entries ({track, created?}) in the order of a sort value, or null for none. */
export function resortEntries(ctx, entries, value) {
  const v = value & ~REVERSE, rev = (value & REVERSE) !== 0;
  if (v === 9) {
    const out = [...entries];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  const ks = keys(ctx, v);
  if (!ks) return null;
  return [...entries].sort((a, b) => {
    for (const [cmp, desc] of ks) {
      const c = cmp(a, b);
      if (c) return desc !== rev ? -c : c;
    }
    return 0;
  });
}

export const SAVE_ORDER = 'Save this order';
const VIEW_HINT = 'The playlist shows in this order while it is open. Save this order to keep it.';
// The hint's size (Settings_textAppearanceListItemSecondary's) and each choice's height (a touch target).
const HINT_SIZE = '14.0sp', ROW_HEIGHT = '44.0dip';

/**
 * Opens Re-Sort for a list: name (the title's %s), entries, hasAddedTime
 * (shows "by added to list"), apply(sorted entries, sort value). A playlist's
 * choice only shows it in that order (owner, 2026-11-25): it passes the sort
 * shown (current, the radio and Reverse checked) and save(), which "Save this
 * order" calls to keep the order shown; the dialog then closes.
 */
export function openResortDialog(ctx, {name, entries, hasAddedTime = false, apply, current = null, save = null}) {
  const str = (k, f = k) => ctx.res.stringByName(k) ?? f;
  // Reverse alone re-sorts by the last order, track number at first (h = 0).
  let value = current == null ? 0 : current & ~REVERSE, reverse = current != null && (current & REVERSE) !== 0;
  let dialog = null;
  const saveButton = () => {
    if (!save || !dialog) return;
    dialog.setButton(2, SAVE_ORDER, () => { save(); dialog.close(); });
    dialog.host.forceLayoutTree?.();
    ctx.scheduleLayout();
  };
  const run = () => {
    const v = value | (reverse ? REVERSE : 0);
    const sorted = resortEntries(ctx, entries(), v);
    if (!sorted) return;
    apply(sorted, v);
    saveButton();
  };
  dialog = openDialog(ctx, {
    style: 'dialog_PlaylistSortActivity', title: str('sort_s', 'Re-Sort %s').replace('%s', name), back: true,
    buttons: {positive: str('close', 'Close')},
    setup: d => {
      const group = d.find('song_sorting_group');
      if (!group) return;
      const radios = [], hint = str('resort_hint');
      const hintSize = ctx.res.dimensionPixelSize(HINT_SIZE, d.theme), rowHeight = ctx.res.dimensionPixelSize(ROW_HEIGHT, d.theme);
      group.walk?.(v => {
        if (v instanceof FastRadioButton) radios.push(v);
        else if (v.text === hint) {
          // The hint says what a choice does: for a playlist, nothing permanent until saved. It reads at
          // the app's secondary text size (its settings' summaries), not the small hint size.
          if (save) v.setText(VIEW_HINT);
          v.textSize = hintSize;
          v.updateFont?.();
          v.requestLayout();
        }
        // Each choice (and Reverse) is a finger's height, its gap taken into it.
        if (v instanceof FastCheckBox && v.lp) {
          v.minHeight = rowHeight;
          v.lp.bottomMargin = 0;
          v.requestLayout();
        }
      });
      for (const r of radios) {
        const tag = parseInt(String(r.tag ?? ''), 10);
        if (tag === 14 && !hasAddedTime) { r.setVisibility(GONE); continue; }
        if (current != null && tag === value) r.setChecked(true);
        r.onCheckedChanged = on => {
          if (!on) return;
          for (const x of radios) if (x !== r) x.setChecked(false);
          value = tag;
          run();
        };
      }
      const rev = d.find('song_sort_reverse');
      if (rev instanceof FastCheckBox) {
        if (reverse) rev.setChecked(true);
        rev.onCheckedChanged = on => { reverse = on; run(); };
      }
    },
  });
  // A playlist shown in a sort already: it can be kept from the start.
  if (current != null) saveButton();
  return dialog;
}
