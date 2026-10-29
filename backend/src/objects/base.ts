// The base every Durable Object class extends: ordered expand-only migrations applied once at
// start-up, a `Db` wrapper that meters rows read and written, and a health report.
// Rules for objects (enforced by tests): no setTimeout/setInterval, no long polls. A timer keeps
// an object awake and billed for duration; the free plan allows ~3.6 object-hours a day.
import { DurableObject } from 'cloudflare:workers';

/** One schema step. Expand only: add tables, columns or indexes; drops wait for a later deploy
 * so `wrangler rollback` to the previous version still finds everything it reads. */
export interface Migration {
  version: number;
  name: string;
  kind: 'expand' | 'contract';
  sql: string[];
}

/** A table's place in DATA.md §10: how long rows live and which exports carry them. A table kept
 * for less than forever names the prune that enforces it, which the daily pass in Core.tick runs
 * (at most `max` deletes a call, returning how many rows went); a guardrail test checks that
 * every such table has one. */
export interface TableInfo {
  retention: string;
  backup: boolean;
  export: boolean;
  prune?: (db: Db, now: number, max: number) => number;
}

/** What one object reports to deep health: counts only, never content. */
export interface ClassHealth {
  schema: number;
  expected: number;
  db_bytes: number;
  rows_read: number;
  rows_written: number;
}

type Bindings = unknown[];

/** Sums `rowsRead`/`rowsWritten` from every cursor. These are the numbers the free plan bills
 * (5M rows read, 100k rows written per day), so cost tests assert on them. In memory only:
 * persisting the meter would itself cost a write per request. */
export class Meter {
  rowsRead = 0;
  rowsWritten = 0;
  add(cursor: SqlStorageCursor<Record<string, SqlStorageValue>>): void {
    this.rowsRead += cursor.rowsRead;
    this.rowsWritten += cursor.rowsWritten;
  }
}

/** Thin SQL helper. Every query is fully consumed before it is metered, because a cursor's
 * row counts are final only after its last row. All SQL text lives in the areas' store.ts. */
export class Db {
  constructor(
    private readonly sql: SqlStorage,
    readonly meter: Meter,
  ) {}

  all<T>(query: string, ...bindings: Bindings): T[] {
    const cursor = this.sql.exec(query, ...bindings);
    const rows = cursor.toArray() as T[];
    this.meter.add(cursor);
    return rows;
  }

  one<T>(query: string, ...bindings: Bindings): T | null {
    return this.all<T>(query, ...bindings)[0] ?? null;
  }

  /** Runs a write; returns the rows it wrote (index entries included). */
  run(query: string, ...bindings: Bindings): number {
    const cursor = this.sql.exec(query, ...bindings);
    cursor.toArray();
    this.meter.add(cursor);
    return cursor.rowsWritten;
  }

  get size(): number {
    return this.sql.databaseSize;
  }
}

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  applied_at INTEGER NOT NULL,
  bookmark TEXT
)`;

/** Applies every step after the recorded version, one transaction each, and returns the version
 * now applied. Each step is preceded by a point-in-time-recovery bookmark, so a bad migration can
 * be undone with onNextSessionRestoreBookmark (see MEASUREMENTS.md). */
export async function applyMigrations(storage: DurableObjectStorage, db: Db, migrations: Migration[]): Promise<number> {
  db.run(MIGRATIONS_TABLE);
  let applied = db.one<{ v: number | null }>('SELECT max(version) AS v FROM _migrations')?.v ?? 0;
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= applied) continue;
    const bookmark = await storage.getCurrentBookmark();
    storage.transactionSync(() => {
      for (const statement of m.sql) db.run(statement);
      db.run(
        'INSERT INTO _migrations (version, name, kind, applied_at, bookmark) VALUES (?, ?, ?, ?, ?)',
        m.version,
        m.name,
        m.kind,
        Date.now(),
        bookmark,
      );
    });
    applied = m.version;
  }
  return applied;
}

export abstract class OwnerObject extends DurableObject<Env> {
  readonly meter = new Meter();
  protected readonly db: Db;
  protected migration = 0;
  private readonly expected: number;

  constructor(ctx: DurableObjectState, env: Env, migrations: Migration[]) {
    super(ctx, env);
    this.expected = Math.max(0, ...migrations.map((m) => m.version));
    this.db = new Db(ctx.storage.sql, this.meter);
    // blockConcurrencyWhile holds every request until the schema is current, so no handler
    // ever sees a half-migrated database. It runs once per object start, not per request.
    void ctx.blockConcurrencyWhile(() => this.migrate(migrations));
  }

  private async migrate(migrations: Migration[]): Promise<void> {
    this.migration = await applyMigrations(this.ctx.storage, this.db, migrations);
  }

  /** Schema version (applied and expected), database size, metered rows since start. RPC. */
  health(): ClassHealth {
    return {
      schema: this.migration,
      expected: this.expected,
      db_bytes: this.db.size,
      rows_read: this.meter.rowsRead,
      rows_written: this.meter.rowsWritten,
    };
  }
}
