// The other objects' meters (DATA.md §3), asked by Core's tick and by GET /v1/ops/meter: each answers
// today's totals and the day before's (objects/meter.ts). One that can't answer (out of reach, or on
// the release before the meter for a moment of a deploy) is left out, and Core keeps its last row.
import { authObject } from '../../objects/auth';
import { libraryObject } from '../../objects/library';
import { musicObject } from '../../objects/music';
import { sensesObject } from '../../objects/senses';
import type { DayRow } from './store';

const OTHERS = { auth: authObject, music: musicObject, senses: sensesObject, library: libraryObject } as const;

export async function gather(env: Env): Promise<DayRow[]> {
  const answers = await Promise.all(
    Object.entries(OTHERS).map(async ([cls, stub]) => {
      try {
        const days = await stub(env).meterFlush();
        return days.map((d) => ({ day: d.day, class: cls, rows_read: d.rows_read, rows_written: d.rows_written }));
      } catch {
        return [];
      }
    }),
  );
  return answers.flat();
}
