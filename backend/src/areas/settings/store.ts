// SQL for Core settings (DATA.md §4.1). Values are JSON; the owner's time zone lives only here,
// never in the public repo (ARCHITECTURE.md §9).
import type { Db } from '../../objects/base';

export function allSettings(db: Db): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of db.all<{ key: string; value_json: string }>('SELECT key, value_json FROM settings'))
    out[r.key] = JSON.parse(r.value_json);
  return out;
}

export function getSetting(db: Db, key: string): unknown {
  const r = db.one<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key);
  return r ? JSON.parse(r.value_json) : undefined;
}

export function putSetting(db: Db, key: string, value: unknown, actor: string, at: number): void {
  db.run(
    `INSERT INTO settings (key, value_json, updated_at, actor) VALUES (?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, actor = excluded.actor`,
    key,
    JSON.stringify(value),
    at,
    actor,
  );
}
