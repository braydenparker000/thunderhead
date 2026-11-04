// The owner's tiles (Settings → Briefing, `briefing.tiles`, MENU-AND-SETTINGS.md §6.5): which of the
// tiles the Worker places show, and in what order. Unset, the page keeps the Worker's own order (the
// night's report first). Set, a tile whose name is missing from the list is left off, the rest go in
// the owner's order, and "Waiting on you" leads them unless the report is first; the mind's pins then
// move within that order (pins.ts). One read by the key.
import type { BriefingTile } from '../../../../shared/contract/briefing.ts';
import { settingSpec, validSetting } from '../../../../shared/contract/settings.ts';
import type { Db } from '../../objects/base';
import { getSetting } from '../settings/store';

export const TILES_KEY = 'briefing.tiles';

/** A tile's name in the owner's list, or null for "Waiting on you" (always shown). */
export function tileName(t: BriefingTile): string | null {
  if (t.kind === 'waiting') return null;
  if (t.kind === 'calendar') return 'today';
  if (t.kind === 'holiday') return 'holidays';
  if (t.kind === 'night') return t.slot.startsWith('note.') ? 'notes' : t.slot;
  return t.kind;
}

/** The owner's list as kept, or null while it is unset (or no longer one the catalogue allows). */
export function ownerTiles(db: Db): string[] | null {
  const spec = settingSpec(TILES_KEY);
  const v = getSetting(db, TILES_KEY);
  return spec && validSetting(spec, v) ? [...(v as readonly string[])] : null;
}

/** The owner's shown tiles in their order (stable: equal names keep the Worker's order), the rest out. */
export function byOwner(tiles: BriefingTile[], order: string[]): BriefingTile[] {
  const rank = (t: BriefingTile) => order.indexOf(tileName(t) ?? '');
  return tiles
    .map((t, i) => [t, i] as const)
    .filter(([t]) => rank(t) >= 0)
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([t]) => t);
}
