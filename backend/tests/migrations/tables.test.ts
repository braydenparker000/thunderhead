// Guardrail (EXTENDING.md rule 9, DATA.md §10): every table the Core migrations create has a
// retention entry in its area (CORE_TABLES) and a row in DATA.md §10, every entry names a table
// that exists, and every retention short of forever has a prune that the daily pass runs. FTS
// shadow tables and runtime tables are not ours to list.
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { Auth } from '../../src/objects/auth';
import type { Core } from '../../src/objects/core';
import { CORE_TABLES } from '../../src/objects/core.migrations';
import { core, coreSql } from '../helpers';

const docs = Object.values(
  import.meta.glob('../../../docs/engineering/DATA.md', { query: '?raw', import: 'default', eager: true }),
)[0] as string;
const retention = docs.slice(docs.indexOf('## 10. Retention'), docs.indexOf('## 11. Backup'));

describe('Core tables', () => {
  it('each table has a retention entry and a DATA.md §10 row, and nothing extra is listed', async () => {
    const tables = await runInDurableObject(core() as unknown as DurableObjectStub<Auth>, (_o, s) =>
      s.storage.sql
        .exec("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
        .toArray()
        .map((r) => String(r.name))
        .filter(
          (n) => n !== '_migrations' && !n.startsWith('_cf_') && !/_fts_(config|data|docsize|idx|content)$/.test(n),
        ),
    );
    expect(tables.sort()).toEqual(Object.keys(CORE_TABLES).sort());
    const rows = retention.split('\n').filter((l) => l.startsWith('| Core.'));
    for (const t of tables)
      expect(
        rows.some((l) => new RegExp(`\\b${t}\\b`).test(l.split('|')[1] ?? '')),
        `DATA.md §10 has no row for Core.${t}`,
      ).toBe(true);
  });
});

describe('retention is enforced, not only written down', () => {
  it('every table kept for less than forever has a prune', () => {
    for (const [name, t] of Object.entries(CORE_TABLES))
      if (!/^(forever|derived)/.test(t.retention))
        expect(typeof t.prune, `Core.${name} (${t.retention})`).toBe('function');
  });

  it('the daily pass removes rows past their retention and keeps the rest, once a day', async () => {
    const day = 86_400_000;
    const now = Date.now();
    await coreSql(
      `INSERT INTO wakes (id, at, task, reason, status) VALUES ('old', ?, 'chat', 'message', 'failed'), ('new', ?, 'chat', 'message', 'failed')`,
      now - 31 * day,
      now - 10 * day,
    );
    await coreSql("INSERT INTO live_tickets (hash, session_id, expires_at) VALUES ('t1', 's', ?)", now - 2 * 3_600_000);
    await coreSql("DELETE FROM settings WHERE key = 'prune.day'");
    const first = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(now));
    expect(first.pruned).toBeGreaterThanOrEqual(2);
    expect((await coreSql<{ id: string }>('SELECT id FROM wakes')).map((r) => r.id)).toEqual(['new']);
    expect(await coreSql('SELECT hash FROM live_tickets')).toEqual([]);
    const again = await runInDurableObject(core() as unknown as DurableObjectStub<Core>, (o: Core) => o.tick(now));
    expect(again.pruned).toBe(0);
  });
});
