// The Senses object (DATA.md §6.1, MEMORY.md L0): what the owner does, as events from the phone's
// sealed batches (`music.skip`, …), each day's rollups, and the record of each day's archive in the
// private bucket. The class shipped alone in its own deploy (a Durable Object class change cannot
// be rolled back). It takes the phone's sealed batches (one row a batch for the dedupe, each event
// with its day's rollup), answers the agents' fixed questions, writes each day's archive to the
// private bucket, and prunes events past 90 days once their day is archived.
import { MUSIC_NOTE_LIMITS } from '../../../shared/contract/music.ts';
import {
  type EventsSummary,
  SENSE_LIMITS,
  type SenseBatchResponse,
  type SenseEvent,
} from '../../../shared/contract/senses.ts';
import type { BackupOf } from '../areas/backups/ops';
import { gzip, page, type Row } from '../areas/backups/rows';
import { logicalDay } from '../areas/conversation/day';
import { sha256 } from '../areas/import/vault';
import { METER_DAYS_SQL } from '../areas/meter/migrations';
import * as queries from '../areas/senses/queries';
import * as store from '../areas/senses/store';
import { checkEvent, msOf } from '../areas/senses/validate';
import { DAY } from '../lib/time';
import { type Migration, OwnerObject } from './base';

export const SENSES_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'senses',
    kind: 'expand',
    sql: [
      `CREATE TABLE batches (
        batch_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        n INTEGER NOT NULL,
        sha256 TEXT NOT NULL
      ) WITHOUT ROWID`,
      `CREATE TABLE events (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL,
        at INTEGER NOT NULL,
        day TEXT NOT NULL,
        app TEXT NOT NULL,
        type TEXT NOT NULL,
        ref TEXT,
        data_json TEXT,
        device_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        sensitivity INTEGER NOT NULL DEFAULT 0
      )`,
      // One index only (DATA.md §6.1): each index entry is a row written per event.
      'CREATE INDEX events_day_type ON events (day, type)',
      `CREATE TABLE rollups (
        day TEXT NOT NULL,
        type TEXT NOT NULL,
        ref TEXT NOT NULL,
        n INTEGER NOT NULL,
        sum_ms INTEGER NOT NULL,
        PRIMARY KEY (day, type, ref)
      ) WITHOUT ROWID`,
      `CREATE TABLE exports (
        day TEXT PRIMARY KEY,
        r2_key TEXT NOT NULL,
        n INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        at INTEGER NOT NULL
      ) WITHOUT ROWID`,
    ],
  },
  {
    version: 2,
    name: 'meter_days',
    kind: 'expand',
    sql: [METER_DAYS_SQL],
  },
];

/** The one instance: the owner's. */
export const SENSES_INSTANCE = 'owner';

/** In the weekly backup and "download everything" (DATA.md §10); events go to the daily archive. */
export const SENSES_BACKUP = ['rollups', 'exports'] as const;
export const SENSES_EXPORT = ['rollups'] as const;

export function sensesObject(env: Env): DurableObjectStub<Senses> {
  return env.SENSES.getByName(SENSES_INSTANCE);
}

const PRUNE_STEP = 2_000;
const ARCHIVE_PAGE = 2_000;
export const archiveKey = (day: string) => `senses/${day}.jsonl.gz`;

export class Senses extends OwnerObject {
  /** What Music's find holds against songs (MUSIC.md §10.5), each part kept for the UTC day it was
   * read on until a batch brings a new event of its type: a find costs these rows once, not every
   * time. The early skips by track id, and the songs whose newest rating is 1 ("not for me"). */
  private skips: { day: string; by: Record<string, number> } | null = null;
  private rated: { day: string; out: string[] } | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, SENSES_MIGRATIONS, 'senses');
  }

  /** One sealed batch: its events stored with their day's rollups, in one transaction. The same
   * batch again (same bytes) stores nothing; other bytes under its id are a conflict. */
  putBatch(
    id: string,
    sha: string,
    device: string,
    events: SenseEvent[],
    tz: string,
    now = Date.now(),
  ): SenseBatchResponse | { conflict: true } {
    return this.ctx.storage.transactionSync(() => {
      const had = store.batch(this.db, id);
      if (had) return had.sha256 === sha ? { accepted: had.n, rejected: [] } : { conflict: true as const };
      const rejected: SenseBatchResponse['rejected'] = [];
      const days = new Set<string>();
      let accepted = 0;
      events.forEach((e, i) => {
        const c = checkEvent(e, now);
        if (typeof c === 'string') {
          rejected.push({ i, reason: c });
          return;
        }
        const day = logicalDay(c.at, tz);
        store.putEvent(this.db, c, day, device, 'device');
        store.roll(this.db, day, c.type, c.ref ?? '', 1, msOf(c.data_json));
        if (c.type === 'music.skip') this.skips = null;
        if (c.type === 'music.rate') this.rated = null;
        days.add(day);
        accepted++;
      });
      // A late event for a day already archived: that day's archive is written again.
      for (const day of days) if (store.exported(this.db, day)) store.unmarkExport(this.db, day);
      store.putBatch(this.db, id, device, now, accepted, sha);
      return { accepted, rejected };
    });
  }

  /** One of the agents' fixed questions, its parameters checked by the route, with the rows it read. */
  query(name: string, args: Record<string, unknown>): { rows: unknown[]; rows_read: number } {
    const before = this.meter.rowsRead;
    const rows = queries.run(this.db, name, args);
    return { rows, rows_read: this.meter.rowsRead - before };
  }

  /** What Music's find leaves out or holds against a song: each song's skips before 30 s in the last
   * 30 days (MUSIC_NOTE_LIMITS) by track id, and the songs whose newest `music.rate` is 1 (the
   * phone's "not for me", also what "never play this again" said to the phone does), read from
   * the 90 days of events kept (SENSE_LIMITS.hot_days). The days are every date the owner's logical
   * day can fall on in the window, so the (day, type) index reads only those events. */
  musicSignals(now = Date.now()): { skips: Record<string, number>; rated_out: string[] } {
    const today = new Date(now).toISOString().slice(0, 10);
    const days = (span: number) =>
      Array.from({ length: span + 3 }, (_, k) => new Date(now + (1 - k) * DAY).toISOString().slice(0, 10));
    if (this.skips?.day !== today) {
      const span = MUSIC_NOTE_LIMITS.skip_days;
      const by: Record<string, number> = {};
      for (const r of store.earlySkips(this.db, days(span), now - span * DAY, MUSIC_NOTE_LIMITS.early_skip_ms))
        if (r.ref.startsWith('music:')) by[r.ref.slice(6)] = (by[r.ref.slice(6)] ?? 0) + r.n;
      this.skips = { day: today, by };
    }
    if (this.rated?.day !== today) {
      const span = SENSE_LIMITS.hot_days;
      const newest = new Map<string, number | null>();
      // In time order, so the last rating seen for a song is its newest.
      for (const r of store.ratings(this.db, days(span), now - span * DAY))
        if (r.ref.startsWith('music:')) newest.set(r.ref.slice(6), r.rating);
      this.rated = { day: today, out: [...newest].filter(([, v]) => v === 1).map(([id]) => id) };
    }
    return { skips: this.skips.by, rated_out: this.rated.out };
  }

  /** Some types' rollups for the meter (P9): counts by day and ref only. */
  rollupsFor(types: string[], from: string, to: string): { day: string; type: string; ref: string; n: number }[] {
    return store.rollupsFor(this.db, types, from, to);
  }

  /** A type's days for the predictions' resolvers (P9): counts only. */
  typeDays(type: string, from: string, to: string): { days: { day: string; n: number }[]; first: string | null } {
    return store.typeDays(this.db, type, from, to);
  }

  /** One day's events for the night's input: counts by type, never content. */
  summary(day: string): EventsSummary {
    const by_type = store.summary(this.db, day);
    return { day, total: by_type.reduce((n, t) => n + t.n, 0), by_type };
  }

  /** The tick's daily pass: each finished day's archive in the private bucket (gzip JSONL, its
   * SHA-256 recorded), then events past 90 days whose day is archived, and old batch records. */
  async daily(now: number, today: string): Promise<{ archived: string[]; pruned: number; rows_read: number }> {
    const before = this.meter.rowsRead;
    const vault = this.env.VAULT;
    const archived: string[] = [];
    // The last 31 days (events may arrive up to 30 days late): two index seeks a day.
    const start = Date.parse(`${today}T00:00:00Z`);
    const days = Array.from({ length: 31 }, (_, k) => new Date(start - (k + 1) * DAY).toISOString().slice(0, 10));
    if (vault)
      for (const day of days.filter((d) => !store.exported(this.db, d) && store.hasEvents(this.db, d))) {
        const lines: string[] = [];
        let after = 0;
        for (;;) {
          const page = store.dayEvents(this.db, day, after, ARCHIVE_PAGE);
          for (const e of page) lines.push(JSON.stringify(e));
          if (page.length < ARCHIVE_PAGE) break;
          after = page[page.length - 1].seq;
        }
        const bytes = await gzip(`${lines.join('\n')}\n`);
        const sha = await sha256(bytes);
        await vault.put(archiveKey(day), bytes, {
          sha256: sha,
          httpMetadata: { contentType: 'application/gzip' },
          customMetadata: { sha256: sha, events: String(lines.length) },
        });
        store.putExport(this.db, day, archiveKey(day), lines.length, sha, now);
        archived.push(day);
      }
    const cutoff = new Date(now - SENSE_LIMITS.hot_days * DAY).toISOString().slice(0, 10);
    let pruned = 0;
    this.ctx.storage.transactionSync(() => {
      for (const day of store.prunableDays(this.db, cutoff)) pruned += store.pruneEvents(this.db, day, PRUNE_STEP);
      pruned += store.pruneBatches(this.db, now - SENSE_LIMITS.batch_days * DAY, PRUNE_STEP);
    });
    // The rows read, so Core's meter has the archive's reads at once (core-backups.ts).
    return { archived, pruned, rows_read: this.meter.rowsRead - before };
  }

  /** What the weekly backup of this object needs when it starts (areas/backups). */
  async backupOf(): Promise<BackupOf> {
    const bookmark = await this.ctx.storage.getCurrentBookmark().catch(() => null);
    return { tables: [...SENSES_BACKUP], schema_version: this.migration, bookmark };
  }

  /** One page of a table in key order, for the backup and the export. */
  page(table: string, after: unknown[] | null, limit: number): { rows: Row[]; last: unknown[] | null } {
    if (!(SENSES_BACKUP as readonly string[]).includes(table)) throw new Error('not a Senses table it backs up');
    return page(this.db, table, after, limit);
  }
}
