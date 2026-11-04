// What night step 13 reads before Core places anything (growth.ts): the Senses object's two week
// questions (`guitar_week`, `study_week`, ending on the night's day) and, for each book that moved,
// its place in the Library (library/place.ts) with a day's pace of pages ahead. Counts, ids and page
// labels only; the sandbox has no senses.
import type { GuitarWeek, StudyWeek } from '../../../../shared/contract/growth.ts';
import type { SenseQueryResponse } from '../../../../shared/contract/senses.ts';
import { DAY } from '../../lib/time';
import { libraryObject } from '../../objects/library';
import { fresh } from '../../objects/rpc';
import { sensesObject } from '../../objects/senses';
import type { GrowthInput } from './growth';

export async function gatherGrowth(env: Env, day: string): Promise<GrowthInput> {
  const senses = sensesObject(env);
  const [g, s] = (await Promise.all([
    fresh(senses.query('guitar_week', { to: day })),
    fresh(senses.query('study_week', { to: day })),
  ])) as SenseQueryResponse[];
  const study = s.rows[0] as StudyWeek;
  const moved = study.items
    .filter((b) => b.pages > 0)
    .map((b) => ({ id: b.ref.slice('book:'.length), ahead: Math.round(b.pages / Math.max(1, b.days)) }));
  // The week's first logical day, a day early for the owner's zone: highlights made in it.
  const since = Date.parse(`${study.from}T00:00:00Z`) - DAY;
  const places = moved.length ? await fresh(libraryObject(env).places(moved, since)) : [];
  return { guitar: g.rows[0] as GuitarWeek, study, places, rows_read: g.rows_read + s.rows_read };
}
