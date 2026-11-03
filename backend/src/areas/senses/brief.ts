// What the mind's briefing reads of the owner's senses (MEMORY.md §9): the day's newest song start,
// skip and finish (times and ids only, never a title: a title is a song's tag, which taints), for
// section 1's "music:" line; and the meter's rollups of the day and the next (areas/insight/meter.ts
// METER_SENSES), for how section 7's arrangements were met so far. Index reads only: one seek per
// song type on (day, type), and the day's rollups of those types.
import type { Db } from '../../objects/base';
import { METER_SENSES } from '../insight/meter';
import { rollupsFor } from './store';

export interface BriefReports {
  music: { type: string; at: number; ref: string | null }[];
  rollups: { day: string; type: string; ref: string; n: number }[];
}

export const SONG_SENSES = ['music.play', 'music.skip', 'music.finish'] as const;

export function briefReports(db: Db, o: { day: string; from: string; to: string; music: boolean }): BriefReports {
  const music = o.music
    ? SONG_SENSES.flatMap((type) =>
        db.all<{ type: string; at: number; ref: string | null }>(
          'SELECT type, at, ref FROM events WHERE day = ? AND type = ? AND sensitivity = 0 ORDER BY seq DESC LIMIT 1',
          o.day,
          type,
        ),
      )
    : [];
  return { music, rollups: rollupsFor(db, METER_SENSES, o.from, o.to) };
}
