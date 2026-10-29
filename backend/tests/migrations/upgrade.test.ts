// DATA.md §9: an object made by the previous build upgrades in place. A Core with only the P1
// step and P1 rows in it (settings, the error inbox, the feed, perf) is migrated to the current
// schema: every P1 row is kept as it was, the later steps run once each in order, and the result
// equals the committed snapshot.
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Auth } from '../../src/objects/auth';
import { applyMigrations, Db, Meter } from '../../src/objects/base';
import { CORE_MIGRATIONS } from '../../src/objects/core.migrations';
import { core } from '../helpers';
import coreSchema from './core.schema.sql?raw';

const P1_TABLES = ['settings', 'changes', 'errors', 'perf_days'];
type Row = Record<string, SqlStorageValue>;

describe('upgrade from P1', () => {
  it('keeps every P1 row and adds the P2 steps once each', async () => {
    await runInDurableObject(core() as unknown as DurableObjectStub<Auth>, async (_o, state) => {
      const sql = state.storage.sql;
      const all = (q: string, ...b: unknown[]) => sql.exec(q, ...b).toArray() as Row[];
      // Back to what P1 had: only step 1. (Test-only SQL; migrations never drop.)
      for (const { name } of all(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND sql LIKE 'CREATE VIRTUAL TABLE%'",
      ))
        sql.exec(`DROP TABLE ${name}`);
      for (const { name } of all(
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite_%'",
      ))
        if (!P1_TABLES.includes(String(name))) sql.exec(`DROP TABLE ${name}`);
      sql.exec('DELETE FROM _migrations WHERE version > 1');
      for (const t of P1_TABLES) sql.exec(`DELETE FROM ${t}`);
      // Rows as the P1 build wrote them.
      sql.exec("INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('owner.tz', '\"UTC\"', 1, 'owner')");
      sql.exec("INSERT INTO settings (key, value_json, updated_at, actor) VALUES ('min_client', '3', 1, 'ci')");
      sql.exec(
        "INSERT INTO changes (seq, kind, ref, at) VALUES (41, 'error', NULL, 5), (42, 'setting', 'setting:owner.tz', 6)",
      );
      sql.exec(
        `INSERT INTO errors (fingerprint, source, route, code, message, count, first_at, last_at, last_build, resolved_at)
         VALUES ('fp1', 'client', '/', 'x', 'y', 3, 1, 2, 7, NULL)`,
      );
      sql.exec("INSERT INTO perf_days (day, metric, p50, p75, p95, n) VALUES ('2026-10-28', 'lcp', 1, 2, 3, 9)");
      const before = Object.fromEntries(P1_TABLES.map((t) => [t, all(`SELECT * FROM ${t} ORDER BY 1`)]));

      const applied = await applyMigrations(state.storage, new Db(sql, new Meter()), CORE_MIGRATIONS);
      expect(applied).toBe(Math.max(...CORE_MIGRATIONS.map((m) => m.version)));
      for (const t of P1_TABLES) expect(all(`SELECT * FROM ${t} ORDER BY 1`), t).toEqual(before[t]);
      expect(all('SELECT version FROM _migrations ORDER BY version').map((r) => r.version)).toEqual(
        CORE_MIGRATIONS.map((m) => m.version),
      );
      // A new message lands after the old feed rows, so a client resumes from seq 42.
      sql.exec("INSERT INTO changes (kind, ref, at) VALUES ('message', NULL, 7)");
      expect(all('SELECT max(seq) AS s FROM changes')[0].s).toBe(43);
      const schema = all(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name",
      )
        .map((r) => `${String(r.sql).replace(/\n\s+/g, '\n  ')};`)
        .join('\n\n');
      expect(schema.trim()).toBe(coreSchema.trim());
    });
  });
});

describe('upgrade from P2', () => {
  it('keeps the P2 rows (messages and their index, the ledger) and adds the memory steps once', async () => {
    await runInDurableObject(core() as unknown as DurableObjectStub<Auth>, async (_o, state) => {
      const sql = state.storage.sql;
      const all = (q: string, ...b: unknown[]) => sql.exec(q, ...b).toArray() as Row[];
      // Back to what P2 had: steps 1–7 (test-only SQL; migrations never drop).
      for (const t of [
        'facts_fts',
        'day_notes_fts',
        'facts',
        'fact_tombstones',
        'day_notes',
        'open_threads',
        'op_batches',
      ])
        sql.exec(`DROP TABLE IF EXISTS ${t}`);
      sql.exec('ALTER TABLE surfaces DROP COLUMN facts_json');
      sql.exec('DROP INDEX IF EXISTS mind_sessions_tainted');
      sql.exec('DELETE FROM _migrations WHERE version > 7');
      sql.exec(
        `INSERT INTO messages (id, thread_id, created_at, author, origin, kind, body) VALUES ('m-p2', 't-p2', 1, 'owner', 'owner_device', 'text', 'kept across the upgrade')`,
      );
      sql.exec("INSERT INTO messages_fts (rowid, body) SELECT seq, body FROM messages WHERE id = 'm-p2'");
      sql.exec(
        "INSERT INTO ledger (id, at, actor, kind, what, why, undoable, status, tainted) VALUES ('l-p2', 1, 'owner', 'note', 'a P2 row', 'written before memory', 0, 'done', 0)",
      );
      const applied = await applyMigrations(state.storage, new Db(sql, new Meter()), CORE_MIGRATIONS);
      expect(applied).toBe(Math.max(...CORE_MIGRATIONS.map((m) => m.version)));
      expect(all("SELECT body FROM messages WHERE id = 'm-p2'")).toEqual([{ body: 'kept across the upgrade' }]);
      expect(all(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH '"upgrade"'`)).toHaveLength(1);
      expect(all("SELECT what FROM ledger WHERE id = 'l-p2'")).toEqual([{ what: 'a P2 row' }]);
      expect(all('SELECT version FROM _migrations WHERE version > 7').map((r) => r.version)).toEqual([8, 9, 10]);
      expect(all('SELECT count(*) AS n FROM facts')).toEqual([{ n: 0 }]);
    });
  });
});
