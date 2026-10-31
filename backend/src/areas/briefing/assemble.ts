// The Briefing page's data (BRIEFING.md §2–§4, MUSE.md §9): the weather tile (weather.ts), "Waiting on you" from the decision
// cards the owner can see now (a card held for quiet hours stays off it), the night shift's tiles
// and Muse's line. Pure in `db`.
import {
  type BriefingResponse,
  type NightTile,
  titleLine,
  type WaitingTile,
  type WeatherTile,
} from '../../../../shared/contract/briefing.ts';
import { WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { DAY, HOUR, wallMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import * as pstore from '../proposals/store';
import * as surfaces from '../surfaces/store';
import * as work from '../work/ops';

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function waitingTile(db: Db, now: number): WaitingTile | null {
  const cards = pstore.waiting(db).filter((p) => p.visible_from <= now && p.show_from <= now);
  if (!cards.length) return null;
  return {
    kind: 'waiting',
    label: 'Waiting on you',
    value: short(cards[0].question, 32),
    detail: cards.length === 1 ? 'One tap on home' : `${cards.length} waiting · one tap each on home`,
    count: cards.length,
  };
}

const SLOTS = ['practice', 'study', 'built', 'note.1', 'note.2', 'note.3'];

/** The night shift's tiles (`tile` surfaces in app `briefing`) by slot; one without an expiry goes after a day. */
function nightTiles(db: Db, now: number): NightTile[] {
  return surfaces
    .list(db, 0, now)
    .filter(
      (s) =>
        s.app === 'briefing' &&
        s.kind === 'tile' &&
        s.schema === 1 &&
        (s.expires_at !== null || now - s.written_at < DAY),
    )
    .sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot))
    .map((s) => {
      const p = s.payload as Record<string, unknown>;
      const text = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
      return {
        kind: 'night',
        slot: s.slot,
        label: text('label') ?? '',
        value: text('value') ?? '',
        detail: text('detail'),
        big: text('big'),
        wide: p.wide === true,
        app: text('app'),
        path: text('path'),
        why: s.why,
        ledger_id: s.ledger_id,
      };
    });
}

function museLine(db: Db, now: number): string | null {
  const s = work.seen(db);
  if (!s) return null;
  if (now - s.last > WORK_LIMITS.silent_h * HOUR) return "Muse hasn't checked in since yesterday.";
  if (now - s.first < DAY) return 'Muse is connected to the new Worker.';
  return null;
}

export function briefing(db: Db, c: { now: number; tz: string; day: string; weather: WeatherTile }): BriefingResponse {
  const waiting = waitingTile(db, c.now);
  // BRIEFING.md §4: at most 8 tiles.
  const tiles = [...(waiting ? [waiting] : []), ...nightTiles(db, c.now)].slice(0, 8);
  return {
    day: c.day,
    title: titleLine(Math.floor(wallMinute(c.now, c.tz) / 60), !tiles.length),
    weather: c.weather,
    tiles,
    muse: museLine(db, c.now),
  };
}
