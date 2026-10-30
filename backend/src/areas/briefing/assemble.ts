// The Briefing page's data (BRIEFING.md §2–§5, MUSE.md §9): the weather tile (weather.ts), "Waiting on you" from the decision
// cards the owner can see now (a card held for quiet hours stays off it), the Board tile from
// today's edition (else yesterday's, marked; none older), and Muse's line. Pure in `db`.
import {
  type BoardTile,
  type BriefingResponse,
  titleLine,
  type WaitingTile,
  type WeatherTile,
} from '../../../../shared/contract/briefing.ts';
import { WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { DAY, HOUR, wallMinute } from '../../lib/time';
import type { Db } from '../../objects/base';
import * as pstore from '../proposals/store';
import * as work from '../work/ops';

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const WPM = 230;

/** Words a reader goes through in an edition: titles, deks, why it matters, block text. */
function words(edition: unknown): number {
  let n = 0;
  const walk = (v: unknown, key = '') => {
    if (typeof v === 'string') {
      if (
        ![
          'id',
          'url',
          'type',
          'composition',
          'claim',
          'kind',
          'schema',
          'date',
          'timezone',
          'visibility',
          'theme',
        ].includes(key)
      )
        n += v.split(/\s+/).filter(Boolean).length;
    } else if (Array.isArray(v)) for (const x of v) walk(x, key);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'sources') walk(x, k);
  };
  walk(edition);
  return n;
}

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

function boardTile(db: Db, day: string, yesterday: string): BoardTile | null {
  const e = work.edition(db, day, yesterday);
  if (!e?.row.result_json) return null;
  const ed = JSON.parse(e.row.result_json) as { title?: string; stories?: unknown[] };
  const stories = ed.stories?.length ?? 0;
  const minutes = Math.max(1, Math.round(words(ed) / WPM));
  return {
    day: e.row.day ?? day,
    title: ed.title ?? 'The Board',
    detail: `${e.stale ? "Yesterday's edition · " : ''}${stories} ${stories === 1 ? 'story' : 'stories'} · ${minutes} min read`,
    stories,
    minutes,
    stale: e.stale,
  };
}

function museLine(db: Db, now: number): string | null {
  const s = work.seen(db);
  if (!s) return null;
  if (now - s.last > WORK_LIMITS.silent_h * HOUR) return "Muse hasn't checked in since yesterday.";
  if (now - s.first < DAY) return 'Muse is connected to the new Worker.';
  return null;
}

export function briefing(
  db: Db,
  c: { now: number; tz: string; day: string; yesterday: string; weather: WeatherTile },
): BriefingResponse {
  const tiles = [waitingTile(db, c.now)].filter((t): t is WaitingTile => t !== null);
  const board = boardTile(db, c.day, c.yesterday);
  return {
    day: c.day,
    title: titleLine(Math.floor(wallMinute(c.now, c.tz) / 60), !tiles.length && !board),
    weather: c.weather,
    tiles,
    board,
    muse: museLine(db, c.now),
  };
}
