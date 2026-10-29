// SQL for ops inside the Core object: the error inbox (deduplicated by fingerprint) and the daily
// performance summary (DATA.md §4.1). The change feed is the feed area's.
import type { ErrorReport, ErrorRow, PerfRequest } from '../../../../shared/contract/api';
import { DAY } from '../../lib/time';
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
export function listErrors(
  db: Db,
  open: boolean,
  limit: number,
  after: [number, string] | null,
  since: number | null = null,
): ErrorRow[] {
  return db.all<ErrorRow>(
    `SELECT fingerprint, source, route, code, message, count, first_at, last_at, last_build, resolved_at FROM errors
     WHERE (resolved_at IS NULL) = ? AND last_at >= ? AND (? IS NULL OR last_at < ? OR (last_at = ? AND fingerprint < ?))
     ORDER BY last_at DESC, fingerprint DESC LIMIT ?`,
    open ? 1 : 0,
    since ?? 0,
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

/** Errors go 30 days after their last sighting, and past 1,000 fingerprints the oldest go,
 * resolved ones first (DATA.md §10). At most `max` a call. */
export function pruneErrors(db: Db, now: number, max: number): number {
  const old = db.all(
    'DELETE FROM errors WHERE fingerprint IN (SELECT fingerprint FROM errors WHERE last_at < ? LIMIT ?) RETURNING 1',
    now - 30 * DAY,
    max,
  ).length;
  const over = (db.one<{ n: number }>('SELECT count(*) AS n FROM errors')?.n ?? 0) - 1_000;
  if (over <= 0 || old >= max) return old;
  return (
    old +
    db.all(
      `DELETE FROM errors WHERE fingerprint IN
         (SELECT fingerprint FROM errors ORDER BY resolved_at IS NULL, last_at LIMIT ?) RETURNING 1`,
      Math.min(over, max - old),
    ).length
  );
}

/** Daily summaries are kept 400 days (DATA.md §10). */
export function prunePerf(db: Db, now: number, max: number): number {
  return db.all(
    'DELETE FROM perf_days WHERE (day, metric) IN (SELECT day, metric FROM perf_days WHERE day < ? LIMIT ?) RETURNING 1',
    new Date(now - 400 * DAY).toISOString().slice(0, 10),
    max,
  ).length;
}

/** Every fingerprint's count for these sources (the errors table is a few hundred rows at most; the watchdogs). */
export function errorCounts(db: Db, sources: readonly string[]): { fingerprint: string; count: number }[] {
  return db.all(
    `SELECT fingerprint, count FROM errors WHERE source IN (${sources.map(() => '?').join(', ')}) LIMIT 500`,
    ...sources,
  );
}
