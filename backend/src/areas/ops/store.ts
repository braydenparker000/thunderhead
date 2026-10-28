// SQL for ops inside the Core object: the error inbox (deduplicated by fingerprint), the daily
// performance summary and the change feed rows that P1 writes (DATA.md §4.1).
import type { ErrorReport, ErrorRow, PerfRequest } from '../../../../shared/contract/api';
import type { Db } from '../../objects/base';

/** Server-side scrub: no URLs with query strings, nothing token-shaped, ≤ 300 characters. */
export function scrub(message: string): string {
  return message
    .replace(/\bhttps?:\/\/[^\s?#]*\?\S*/g, '[url]')
    .replace(/\b(th1|thm|ths|thc|thw|thfp)_[A-Za-z0-9_-]{8,}/g, '[token]')
    .replace(/[A-Za-z0-9+/_-]{32,}={0,2}/g, '[redacted]')
    .slice(0, 300);
}

/** One row per fingerprint: a repeat adds its count, keeps the newest build and reopens it. */
export function upsertError(db: Db, fingerprint: string, e: ErrorReport, at: number): void {
  db.run(
    `INSERT INTO errors (fingerprint, source, route, code, message, count, first_at, last_at, last_build)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (fingerprint) DO UPDATE SET count = count + excluded.count, last_at = max(last_at, excluded.last_at),
       message = excluded.message, last_build = max(coalesce(last_build, 0), excluded.last_build), resolved_at = NULL`,
    fingerprint,
    e.source,
    e.route ?? null,
    e.code,
    scrub(e.message),
    e.count ?? 1,
    at,
    at,
    e.build,
  );
}

export function countOpenErrors(db: Db): number {
  return db.one<{ n: number }>('SELECT count(*) AS n FROM errors WHERE resolved_at IS NULL')?.n ?? 0;
}

/** Newest `last_at` first; `after` is the [last_at, fingerprint] of the previous page's end. */
export function listErrors(db: Db, open: boolean, limit: number, after: [number, string] | null): ErrorRow[] {
  return db.all<ErrorRow>(
    `SELECT fingerprint, source, route, code, message, count, first_at, last_at, last_build, resolved_at FROM errors
     WHERE (resolved_at IS NULL) = ? AND (? IS NULL OR last_at < ? OR (last_at = ? AND fingerprint < ?))
     ORDER BY last_at DESC, fingerprint DESC LIMIT ?`,
    open ? 1 : 0,
    after?.[0] ?? null,
    after?.[0] ?? null,
    after?.[0] ?? null,
    after?.[1] ?? null,
    limit,
  );
}

export function resolveError(db: Db, fingerprint: string, at: number): number {
  return db.all('UPDATE errors SET resolved_at = ? WHERE fingerprint = ? RETURNING fingerprint', at, fingerprint)
    .length;
}

export function putPerf(db: Db, p: PerfRequest): void {
  for (const [metric, v] of Object.entries(p.metrics)) {
    if (!v) continue;
    db.run(
      `INSERT INTO perf_days (day, metric, p50, p75, p95, n) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (day, metric) DO UPDATE SET p50 = excluded.p50, p75 = excluded.p75, p95 = excluded.p95, n = excluded.n`,
      p.day,
      metric,
      v.p50,
      v.p75,
      v.p95,
      v.n,
    );
  }
}

/** One row in the change feed (read from P2 by `GET /v1/changes`). */
export function addChange(db: Db, kind: string, ref: string | null, at: number): void {
  db.run('INSERT INTO changes (kind, ref, at) VALUES (?, ?, ?)', kind, ref, at);
}
