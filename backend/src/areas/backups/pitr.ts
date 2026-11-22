// Point-in-time recovery (OPERATIONS.md §4.1), behind one interface so tests use a fake. Cloudflare
// keeps 30 days of each SQLite Durable Object's history: `getBookmarkForTime(t)` names a point in
// it, `onNextSessionRestoreBookmark(b)` arms a restore to it (returning the bookmark just before
// the restore, the undo point) and the object must restart (`ctx.abort()`) for it to happen
// (developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).
// The API is not supported in local development, so the real calls are proven only live, by the
// check below on each class's scratch copy `pitr-proof` (the drill runs it; never on Auth). Nothing in
// the site arms a restore on a real object: the object methods refuse every other instance.
import type { PitrOutcome } from '../../../../shared/contract/backups.ts';
import type { Db } from '../../objects/base';

export interface Pitr {
  current(): Promise<string>;
  forTime(at: number): Promise<string>;
  /** Arms the restore; returns the bookmark just before it (the undo point). */
  arm(bookmark: string): Promise<string>;
  /** Restarts the object so an armed restore takes effect (the real one aborts the object). */
  restart(): void;
}

export const realPitr = (ctx: DurableObjectState): Pitr => ({
  current: () => ctx.storage.getCurrentBookmark(),
  forTime: (at) => ctx.storage.getBookmarkForTime(at),
  arm: (b) => ctx.storage.onNextSessionRestoreBookmark(b),
  restart: () => ctx.abort('point-in-time restore'),
});

type Factory = (ctx: DurableObjectState, cls: string, name: string) => Pitr;
let factory: Factory = (ctx) => realPitr(ctx);

/** Tests only: every object made after this uses `f` (null puts the real API back). */
export function usePitr(f: Factory | null): void {
  factory = f ?? ((ctx) => realPitr(ctx));
}

export const pitrOf = (ctx: DurableObjectState, cls: string, name: string): Pitr => factory(ctx, cls, name);

/** The instance name of each class's scratch copy for the check. */
export const PROOF_INSTANCE = 'pitr-proof';

export interface ProofResult {
  outcome: PitrOutcome;
  code: string | null;
}

/** An error from the API as an outcome: `unsupported` when the runtime says it has no PITR (local
 * development, or a plan without it), else `failed` with the error's name (never its message). */
export function pitrFailure(e: unknown): ProofResult {
  const msg = e instanceof Error ? e.message : '';
  // workerd here: "This Durable Object's storage back-end does not implement point-in-time recovery."
  if (/not implement|not (be )?(supported|available)|unsupported/i.test(msg))
    return { outcome: 'unsupported', code: 'unsupported' };
  const name = e instanceof Error ? e.name : 'Error';
  return { outcome: 'failed', code: /^[A-Za-z_]{1,40}$/.test(name) ? name : 'Error' };
}

// The check's own table, only ever in a scratch copy: a row before the bookmark, a marker after it.
const TABLE = '_pitr_proof';

/** Step 1 on the scratch copy: a row, the bookmark, the marker, then the restore armed. */
export async function proofArm(db: Db, pitr: Pitr): Promise<ProofResult | { outcome: 'armed'; code: null }> {
  db.run(`DROP TABLE IF EXISTS ${TABLE}`);
  db.run(`CREATE TABLE ${TABLE} (k TEXT PRIMARY KEY)`);
  db.run(`INSERT INTO ${TABLE} (k) VALUES ('before')`);
  try {
    const bookmark = await pitr.current();
    db.run(`INSERT INTO ${TABLE} (k) VALUES ('marker')`);
    await pitr.arm(bookmark);
    return { outcome: 'armed', code: null };
  } catch (e) {
    return pitrFailure(e);
  }
}

/** Step 2, after the restart: the marker is gone and the row before it is there. */
export function proofCheck(db: Db): ProofResult {
  const has = db.one<{ n: number }>("SELECT count(*) AS n FROM sqlite_schema WHERE type = 'table' AND name = ?", TABLE);
  if (!has?.n) return { outcome: 'failed', code: 'rows_lost' };
  const keys = new Set(db.all<{ k: string }>(`SELECT k FROM ${TABLE}`).map((r) => r.k));
  if (keys.has('marker')) return { outcome: 'failed', code: 'marker_kept' };
  if (!keys.has('before')) return { outcome: 'failed', code: 'rows_lost' };
  return { outcome: 'ok', code: null };
}
