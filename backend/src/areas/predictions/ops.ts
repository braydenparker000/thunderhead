// Predictions (P9, EVALS.md M-18; RUNTIME.md §12 step 7b): the night shift's are kept under their
// own id and resolved by the tick once their day is over; the skill per category is the Brier score
// against the base rate of the 28 days before each predicted day.
import {
  type CategorySkill,
  PREDICTION_CATEGORIES,
  PREDICTION_LIMITS,
  type Prediction,
  type PredictionCategory,
  type PutPredictionRequest,
} from '../../../../shared/contract/predictions.ts';
import { Fail, invalid } from '../../lib/result';
import { DAY, dayBefore } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import * as pstore from '../proposals/store';
import { appOpen, RESOLVERS, type Sensed } from './resolvers';

interface Row {
  id: string;
  made_at: number;
  made_by: string;
  category: PredictionCategory;
  args_json: string;
  day: string;
  p: number;
  why: string;
  outcome: 0 | 1 | null;
  base: number | null;
  resolved_at: number | null;
  req_sha256: string;
}

const COLS = 'id, made_at, made_by, category, args_json, day, p, why, outcome, base, resolved_at, req_sha256';
const shown = ({ args_json, req_sha256: _h, ...r }: Row): Prediction => ({ ...r, args: JSON.parse(args_json) });

/** `opened`: the app of an `app.open` prediction was already opened on the open day (Senses). */
export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutPredictionRequest,
  hash: string,
  tz: string,
  opened = false,
): Prediction {
  const had = w.db.one<Row>(`SELECT ${COLS} FROM predictions WHERE id = ?`, id);
  if (had) {
    if (had.req_sha256 !== hash) throw new Fail('conflict');
    return shown(had);
  }
  const resolver = RESOLVERS[r.category];
  const args = resolver.args(r.args);
  if (typeof args === 'string') throw invalid('args', args);
  const open = currentDay(w.db, tz, w.at);
  if (r.day !== open && r.day !== dayBefore(open, -1)) throw invalid('day', 'the open day or the next');
  // Said before the owner's day shows it: a chat prediction only before their first message of it.
  if (r.category.startsWith('chat.') && r.day === open && RESOLVERS['chat.any'].outcome?.(w.db, open, {}, tz))
    throw invalid('day', 'the owner has already written that day');
  if (opened && r.day === open) throw invalid('day', 'the owner has already opened it that day');
  if (r.category === 'decision.answered' && pstore.byId(w.db, String(args.id))?.status !== 'waiting')
    throw invalid('args.id', 'not a waiting card');
  const today = w.db.one<{ n: number }>('SELECT count(*) AS n FROM predictions WHERE made_at > ?', w.at - DAY)?.n ?? 0;
  if (today >= PREDICTION_LIMITS.per_day) throw invalid('id', `at most ${PREDICTION_LIMITS.per_day} a day`);
  const row: Row = {
    id,
    made_at: w.at,
    made_by: c.actor,
    category: r.category,
    args_json: JSON.stringify(args),
    day: r.day,
    p: r.p,
    why: r.why,
    outcome: null,
    base: null,
    resolved_at: null,
    req_sha256: hash,
  };
  w.db.run(`INSERT INTO predictions (${COLS}) VALUES (${COLS.replace(/\w+/g, '?')})`, ...Object.values(row));
  return shown(row);
}

/** Whether any prediction's day is over and it waits for its outcome (one index probe). */
export const anyDue = (db: Db, open: string) =>
  db.one('SELECT 1 AS x FROM predictions WHERE resolved_at IS NULL AND day < ? LIMIT 1', open) !== null;

const DUE = `SELECT ${COLS} FROM predictions WHERE resolved_at IS NULL AND day < ? ORDER BY day LIMIT 50`;

/** The due `app.open` predictions, for the Senses object's answers before the write. */
export const dueApps = (db: Db, open: string) =>
  db
    .all<Row>(DUE, open)
    .filter((r) => r.category === 'app.open')
    .map((r) => ({ id: r.id, day: r.day, app: String(JSON.parse(r.args_json).app) }));

/** The tick's pass: predictions whose day is over get their outcome and base rate (≤ 50 a tick); an
 * `app.open` one only once the Senses object has answered for it (`sensed`, by id). */
export function resolve(w: Writer, open: string, tz: string, sensed: Map<string, Sensed> = new Map()): number {
  let n = 0;
  for (const r of w.db.all<Row>(DUE, open)) {
    const resolver = RESOLVERS[r.category];
    const args = JSON.parse(r.args_json);
    const base = dayBefore(r.day, PREDICTION_LIMITS.base_days);
    const s = sensed.get(r.id);
    const got = s
      ? appOpen(r.day, base, s)
      : resolver.outcome && resolver.history
        ? { outcome: resolver.outcome(w.db, r.day, args, tz), ...resolver.history(w.db, base, r.day, args, tz) }
        : null;
    if (!got) continue;
    w.db.run(
      'UPDATE predictions SET outcome = ?, base = ?, resolved_at = ? WHERE id = ?',
      got.outcome,
      (got.k + 1) / (got.n + 2),
      w.at,
      r.id,
    );
    n++;
  }
  return n;
}

export function list(db: Db, open: boolean, limit: number): Prediction[] {
  return db
    .all<Row>(
      `SELECT ${COLS} FROM predictions ${open ? 'WHERE resolved_at IS NULL' : ''} ORDER BY made_at DESC LIMIT ?`,
      limit,
    )
    .map(shown);
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 1000);

/** EVALS.md M-18 for each category: Brier, the base rate's Brier, skill from 30, 5 bins. */
export function skill(db: Db): CategorySkill[] {
  const rows = db.all<{ category: PredictionCategory; p: number; outcome: 0 | 1 | null; base: number | null }>(
    'SELECT category, p, outcome, base FROM predictions',
  );
  return Object.keys(PREDICTION_CATEGORIES).map((category) => {
    const mine = rows.filter((r) => r.category === category);
    const done = mine.filter((r) => r.outcome !== null) as { p: number; outcome: 0 | 1; base: number }[];
    const brier = mean(done.map((r) => (r.p - r.outcome) ** 2));
    const brierBase = mean(done.map((r) => (r.base - r.outcome) ** 2));
    const bins = [0, 1, 2, 3, 4].map((b) => {
      const inBin = done.filter((r) => Math.min(4, Math.floor(r.p * 5)) === b);
      return { n: inBin.length, p: round(mean(inBin.map((r) => r.p))), hit: round(mean(inBin.map((r) => r.outcome))) };
    });
    return {
      category: category as PredictionCategory,
      open: mine.length - done.length,
      resolved: done.length,
      brier: round(brier),
      brier_base: round(brierBase),
      skill:
        done.length >= PREDICTION_LIMITS.shown_from && brier !== null && brierBase
          ? round(1 - brier / brierBase)
          : null,
      bins,
    };
  });
}
