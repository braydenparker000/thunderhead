// Tiles the mind pinned on the Briefing (`briefing.pin_tile`, `briefing.unpin_tile`; BRIEFING.md §4):
// a short list in the Worker's settings (`briefing.pins`, newest first, at most PINS_MAX), read by
// the page's assembly, which puts a pinned tile right after "Waiting on you". Weather stays first
// and "Waiting on you" second, so neither can be pinned; a pinned tile still shows only when it has
// something to say, and the owner's own arrangement on the phone is applied over the Worker's order.
import type { BriefingTile } from '../../../../shared/contract/briefing.ts';
import { PINNABLE_TILES, PINS_MAX } from '../../../../shared/contract/verbs.ts';
import type { Db } from '../../objects/base';
import { getSetting } from '../settings/store';

/** The settings row that holds them (not in the catalogue: the owner never sets it by hand). */
export const PINS_KEY = 'briefing.pins';

/** The pins as kept, newest first; anything else in the row is left out. One read by the key. */
export function pinsOf(db: Db): string[] {
  const v = getSetting(db, PINS_KEY);
  return Array.isArray(v)
    ? v.filter((t): t is string => (PINNABLE_TILES as readonly unknown[]).includes(t)).slice(0, PINS_MAX)
    : [];
}

/** The pins after pinning `tile` (first; the oldest past PINS_MAX goes) or unpinning it. */
export const withPin = (pins: string[], tile: string, on: boolean): string[] =>
  on ? [tile, ...pins.filter((t) => t !== tile)].slice(0, PINS_MAX) : pins.filter((t) => t !== tile);

/** A tile's name for pinning: Due, Holidays, or the night shift's slot. */
const nameOf = (t: BriefingTile): string | null =>
  t.kind === 'due' ? 'due' : t.kind === 'holiday' ? 'holidays' : t.kind === 'night' ? t.slot : null;

/** The tiles with the pinned ones right after "Waiting on you", in pin order; the rest keep theirs. */
export function arrange(tiles: BriefingTile[], pins: string[]): BriefingTile[] {
  if (!pins.length) return tiles;
  const rank = (t: BriefingTile) => {
    const i = pins.indexOf(nameOf(t) ?? '');
    return i < 0 ? pins.length : i;
  };
  const waiting = tiles.filter((t) => t.kind === 'waiting');
  const rest = tiles
    .filter((t) => t.kind !== 'waiting')
    .map((t, i) => [t, i] as const)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([t]) => t);
  return [...waiting, ...rest];
}
