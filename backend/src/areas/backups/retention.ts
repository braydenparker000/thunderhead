// Old backups (JOBS.md §4.4 `backups.prune`, DATA.md §11.3): keep 8 weekly and 12 monthly, delete
// the rest, only once the owner turns it on (Settings › Privacy and data, `privacy.backups.prune`,
// default off: deleting needs the owner's word; turned on, it starts on the next day). Decided from
// the bucket's own listing, not from Core's rows (a restored Core forgets backups it made later),
// once a day. What it never does:
//   - delete the newest complete backup (one with its manifest) of any part;
//   - delete outside `backups/` of the private bucket (VAULT); the music bucket is never passed in;
//   - decide on a partial listing: if the listing is cut short, it deletes nothing that day.
// A set is `backups/<date>/`, dated `YYYY-MM-DD`; a set under a name of any other shape is never
// deleted.
import type { BackupClass } from '../../../../shared/contract/backups.ts';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import { getSetting, putSetting } from '../settings/store';

export const PRUNE_SETTING = 'privacy.backups.prune';
const DAY_KEY = 'backups.pruned_day';
export const RETENTION = { weekly: 8, monthly: 12, pages: 20, deletes: 1000 } as const;

const KEY = /^backups\/([^/]+)\/(core|music|senses|library)\/([^/]+)$/;
const WEEKLY = /^\d{4}-\d{2}-\d{2}$/;

export const pruneOn = (db: Db): boolean => getSetting(db, PRUNE_SETTING) === true;

/** Due once a day while it is on. */
export const pruneDue = (db: Db, day: string): boolean => pruneOn(db) && getSetting(db, DAY_KEY) !== day;

/** Which keys go: every key of a set the rule doesn't keep. Pure, so the rule is tested alone. */
export function prunePlan(keys: string[]): { drop: string[]; dates: string[] } {
  const sets = new Map<string, { keys: string[]; complete: Set<BackupClass> }>();
  for (const k of keys) {
    const m = KEY.exec(k);
    if (!m) continue; // never anything it doesn't recognise
    const s = sets.get(m[1]) ?? { keys: [], complete: new Set<BackupClass>() };
    s.keys.push(k);
    if (m[3] === 'manifest.json') s.complete.add(m[2] as BackupClass);
    sets.set(m[1], s);
  }
  const keep = new Set<string>();
  const dates = [...sets.keys()].sort().reverse(); // newest first
  const weekly = dates.filter((d) => WEEKLY.test(d));
  for (const d of weekly.slice(0, RETENTION.weekly)) keep.add(d);
  const months = new Set<string>();
  for (const d of weekly) {
    const m = d.slice(0, 7);
    if (months.has(m)) continue;
    if (months.size >= RETENTION.monthly) break;
    months.add(m);
    keep.add(d);
  }
  for (const d of dates) if (!WEEKLY.test(d)) keep.add(d); // a name of any other shape is never deleted
  // The newest complete backup of each part (a set still being written is among the newest 8).
  for (const cls of ['core', 'music', 'senses', 'library'] as const) {
    const newest = dates.find((d) => sets.get(d)?.complete.has(cls));
    if (newest) keep.add(newest);
  }
  const gone = dates.filter((d) => !keep.has(d));
  return { drop: gone.flatMap((d) => sets.get(d)?.keys ?? []), dates: gone };
}

/** Lists `backups/`, deletes what the plan drops (at most 1,000 keys a day), and says what went. */
export async function pruneBackups(vault: R2Bucket): Promise<{ dates: string[]; keys: number } | null> {
  const keys: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; ; i++) {
    if (i >= RETENTION.pages) return null; // cut short: decide nothing today
    const page = await vault.list({ prefix: 'backups/', cursor });
    keys.push(...page.objects.map((o) => o.key));
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  const plan = prunePlan(keys);
  const drop = plan.drop.filter((k) => k.startsWith('backups/')).slice(0, RETENTION.deletes);
  if (drop.length) await vault.delete(drop);
  return { dates: plan.dates, keys: drop.length };
}

export function recordPrune(w: Writer, day: string, out: { dates: string[]; keys: number } | null): void {
  putSetting(w.db, DAY_KEY, day, 'worker', w.at);
  if (!out?.keys) return;
  w.ledger({
    kind: 'note',
    actor: 'worker',
    what: `deleted ${out.keys} files of old backups (${out.dates.length} dates, oldest ${out.dates.at(-1)})`,
    why: 'you turned on "Keep 8 weekly and 12 monthly backups" in Settings (DATA.md §11.3)',
    ref: 'backups:prune',
    undoable: false,
  });
}
