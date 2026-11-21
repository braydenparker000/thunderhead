// The base every Durable Object class extends: ordered expand-only migrations applied once at
// start-up, a `Db` wrapper that meters rows read and written (meter.ts, kept per UTC day in the
// object's own `meter_days` row), and a health report.
// Rules for objects (enforced by tests): no setTimeout/setInterval, no long polls. A timer keeps
// an object awake and billed for duration; the free plan allows ~3.6 object-hours a day.
import { DurableObject } from 'cloudflare:workers';
import { METER_DAYS_SQL } from '../areas/meter/migrations';
import { Meter, type MeterDay } from './meter';

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

/** What one object reports to deep health: counts only, never content. `rows_*`: today's (UTC). */
export interface ClassHealth {
  schema: number;
  expected: number;
  /** Steps this code has that the object hasn't applied (a step merged out of order shows here). */
  missing: number[];
  db_bytes: number;
  rows_read: number;
  rows_written: number;
}

type Bindings = unknown[];

export { Meter };

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

/** Applies every step whose version `_migrations` doesn't hold, in number order, one transaction
 * each (a step merged after a higher one still runs), and returns the highest version now applied.
 * Each step is preceded by a point-in-time-recovery bookmark, so a bad migration can be undone
 * with onNextSessionRestoreBookmark (see MEASUREMENTS.md). */
export async function applyMigrations(storage: DurableObjectStorage, db: Db, migrations: Migration[]): Promise<number> {
  db.run(MIGRATIONS_TABLE);
  const done = appliedVersions(db);
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (done.has(m.version)) continue;
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
    done.add(m.version);
  }
  return Math.max(0, ...done);
}

const appliedVersions = (db: Db) =>
  new Set(db.all<{ version: number }>('SELECT version FROM _migrations').map((r) => r.version));

/** The steps this code has that `_migrations` doesn't hold (none once the schema is current). */
export function missingVersions(db: Db, migrations: Migration[]): number[] {
  const done = appliedVersions(db);
  return migrations
    .map((m) => m.version)
    .filter((v) => !done.has(v))
    .sort((a, b) => a - b);
}

export abstract class OwnerObject extends DurableObject<Env> {
  readonly meter = new Meter();
  protected readonly db: Db;
  protected migration = 0;
  private readonly expected: number;
  /** Steps still unapplied after start-up (read once there: the schema only changes then). */
  private missing: number[] = [];

  /** `cls`: the class's name in the meter (`core`, `auth`, `music`, `senses`, `library`). */
  constructor(
    ctx: DurableObjectState,
    env: Env,
    migrations: Migration[],
    private readonly cls: string,
  ) {
    super(ctx, env);
    this.expected = Math.max(0, ...migrations.map((m) => m.version));
    this.db = new Db(ctx.storage.sql, this.meter);
    // blockConcurrencyWhile holds every request until the schema is current, so no handler
    // ever sees a half-migrated database. It runs once per object start, not per request.
    void ctx.blockConcurrencyWhile(() => this.migrate(migrations));
  }

  private async migrate(migrations: Migration[]): Promise<void> {
    this.migration = await applyMigrations(this.ctx.storage, this.db, migrations);
    this.missing = missingVersions(this.db, migrations);
    // The meter keeps its day once the schema has its table.
    if (migrations.some((m) => m.sql.includes(METER_DAYS_SQL))) this.meter.attach(this.db, this.cls);
  }

  /** Schema version (applied and expected), database size, and today's rows (UTC day), stored and
   * not yet stored. RPC. */
  health(): ClassHealth {
    const today = this.meter.today();
    return {
      schema: this.migration,
      expected: this.expected,
      missing: this.missing,
      db_bytes: this.db.size,
      rows_read: today.rows_read,
      rows_written: today.rows_written,
    };
  }

  /** Core's tick (and GET /v1/ops/meter) asks each object for its meter: today's totals and the day
   * before's, the day's row written first if it grew and a minute has passed. RPC. */
  meterFlush(): MeterDay[] {
    return this.meter.report();
  }
}
