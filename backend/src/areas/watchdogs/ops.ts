// The watchdogs at work (OPERATIONS.md §8.2, RUNTIME.md §3): each tick runs every built check; a
// trip writes one ledger note and, for a watchdog that wakes, may wake mind-reflex (one open wake
// at a time, at most 4 in any 24 hours); a clear writes one note too. Nothing repeats while the
// state holds. The reflex reports what it did about a trip (`handled`), which the ledger keeps.
import { BUILT_PHASES } from '../../../../shared/contract/routes.ts';
import {
  WATCHDOG_LIMITS,
  WATCHDOG_NAMES,
  WATCHDOGS,
  type WatchdogHandledRequest,
  type WatchdogItem,
  type WatchdogName,
} from '../../../../shared/contract/watchdogs.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail } from '../../lib/result';
import { DAY, HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { insertWake, openWakes, reflexWakes, setWakeStatus } from '../mind/store';
import type { ToFire } from '../mind/wake';
import { CHECKS, type CheckCtx, type Snapshot } from './checks';
import * as store from './store';

const REFLEX_OPEN_MS = 30 * 60_000;
const DRILL_DETAIL = 'a drill: tripped by hand, nothing is wrong';

export const built = (name: WatchdogName) => {
  const s = WATCHDOGS[name];
  return BUILT_PHASES.includes(s.phase) && !('deferred' in s) && CHECKS[name] !== undefined;
};

/** One tick of every built watchdog. Returns the reflex wake to fire, if a trip made one. */
export function watch(w: Writer, ctx: Omit<CheckCtx, 'at'>, reflexOn: boolean): ToFire | null {
  const at = w.at;
  const rows = new Map(store.all(w.db).map((r) => [r.name, r]));
  const woke: WatchdogName[] = [];
  for (const name of WATCHDOG_NAMES.filter(built)) {
    const prev = rows.get(name) ?? null;
    const snap = prev?.snapshot_json ? (JSON.parse(prev.snapshot_json) as Snapshot) : null;
    const out = (CHECKS[name] as NonNullable<(typeof CHECKS)[WatchdogName]>)(w.db, { ...ctx, at }, snap);
    const was = prev?.state === 'tripped';
    // A drill holds until the reflex has reported it (or for an hour), whatever the check says.
    const drillHolds = was && prev?.detail === DRILL_DETAIL && !prev.handled_at && at - (prev.since ?? at) < HOUR;
    if (drillHolds) continue;
    const base = {
      name,
      trips: prev?.trips ?? 0,
      checked_at: at,
      snapshot_json: out.snapshot ? JSON.stringify(out.snapshot) : null,
    };
    if (out.detail && !was) {
      store.put(w.db, {
        ...base,
        state: 'tripped',
        since: at,
        detail: out.detail,
        trips: base.trips + 1,
        handled_at: null,
        handled_outcome: null,
        handled_note: null,
      });
      w.ledger({
        kind: 'note',
        actor: 'worker',
        what: `watchdog ${name} tripped: ${out.detail}`,
        why: `it guards "${WATCHDOGS[name].slo}" (OPERATIONS.md §8.2)`,
        ref: `watchdog:${name}`,
        undoable: false,
      });
      if (WATCHDOGS[name].wakes) woke.push(name);
    } else if (!out.detail && was) {
      store.put(w.db, {
        ...base,
        state: 'ok',
        since: null,
        detail: null,
        handled_at: null,
        handled_outcome: null,
        handled_note: null,
      });
      const minutes = Math.round((at - (prev?.since ?? at)) / 60_000);
      w.ledger({
        kind: 'note',
        actor: 'worker',
        what: `watchdog ${name} cleared after ${minutes} min`,
        why: 'its check passes again',
        ref: `watchdog:${name}`,
        undoable: false,
      });
    } else {
      const detail = was ? (out.detail ?? prev?.detail ?? null) : null;
      // Nothing changed (the usual tick): no write. checked_at moves only with a write.
      if (prev && prev.detail === detail && prev.snapshot_json === base.snapshot_json) continue;
      store.put(w.db, {
        ...base,
        state: was ? 'tripped' : 'ok',
        since: prev?.since ?? null,
        detail,
        handled_at: prev?.handled_at ?? null,
        handled_outcome: prev?.handled_outcome ?? null,
        handled_note: prev?.handled_note ?? null,
      });
    }
  }
  return woke.length && reflexOn ? wakeReflex(w, woke[0]) : null;
}

/** A reflex wake for this trip, unless one is open or 4 woke it in the last 24 hours. */
function wakeReflex(w: Writer, name: WatchdogName): ToFire | null {
  // A reflex wake nobody claimed in 30 minutes has failed (there are no retries): it doesn't block the next.
  for (const o of openWakes(w.db, 'reflex')) if (w.at - o.at >= REFLEX_OPEN_MS) setWakeStatus(w.db, o.id, 'failed');
  const wakes = reflexWakes(w.db, w.at - DAY);
  if (wakes.open > 0 || wakes.n >= WATCHDOG_LIMITS.reflex_wakes_per_day) return null;
  const id = uuidv7(w.at);
  insertWake(w.db, { id, at: w.at, task: 'reflex', reason: `watchdog:${name}` });
  return { id, task: 'reflex' };
}

/** POST /v1/ops/watchdogs/:name/drill: trips one built watchdog that wakes the reflex, by hand (the
 * owner asked: a check that mind-reflex handles a trip end to end). Its check doesn't clear it until
 * the reflex has reported it, or for an hour. */
export function drill(
  w: Writer,
  c: Caller,
  name: WatchdogName,
  reflexOn: boolean,
): { item: WatchdogItem; wake: ToFire | null } {
  if (!built(name) || !WATCHDOGS[name].wakes)
    throw new Fail('validation', [
      { path: 'name', issue: 'only a built watchdog that wakes the reflex can be drilled' },
    ]);
  const prev = store.byName(w.db, name);
  if (prev?.state === 'tripped')
    throw new Fail('conflict', [{ path: 'name', issue: 'this watchdog is tripped already' }]);
  store.put(w.db, {
    name,
    state: 'tripped',
    since: w.at,
    detail: DRILL_DETAIL,
    trips: (prev?.trips ?? 0) + 1,
    checked_at: w.at,
    snapshot_json: prev?.snapshot_json ?? null,
    handled_at: null,
    handled_outcome: null,
    handled_note: null,
  });
  w.ledger({
    kind: 'note',
    actor: c.actor,
    session_id: c.session_id,
    what: `watchdog ${name} tripped: ${DRILL_DETAIL}`,
    why: 'a drill: does mind-reflex handle a trip end to end (OPERATIONS.md §8.2)',
    ref: `watchdog:${name}`,
    undoable: false,
  });
  const wake = reflexOn ? wakeReflex(w, name) : null;
  return { item: list(w.db).find((x) => x.name === name) as WatchdogItem, wake };
}

/** Every watchdog of the registry with its state (`later` for one not built yet). */
export function list(db: Db): WatchdogItem[] {
  const rows = new Map(store.all(db).map((r) => [r.name, r]));
  return WATCHDOG_NAMES.map((name) => {
    const s = WATCHDOGS[name];
    const r = rows.get(name);
    const tripped = built(name) && r?.state === 'tripped';
    return {
      name,
      state: !built(name) ? 'later' : tripped ? 'tripped' : 'ok',
      severity: s.severity,
      slo: s.slo,
      trips: s.trips,
      since: tripped ? (r?.since ?? null) : null,
      detail: tripped ? (r?.detail ?? null) : null,
      handled:
        tripped && r?.handled_at && r.handled_outcome
          ? { at: r.handled_at, outcome: r.handled_outcome, note: r.handled_note ?? '' }
          : null,
      waits: built(name) ? null : 'deferred' in s ? s.deferred : `phase ${s.phase}`,
    } satisfies WatchdogItem;
  });
}

/** POST /v1/ops/watchdogs/:name/handled: what a mind session did about a trip. */
export function handled(w: Writer, c: Caller, name: WatchdogName, r: WatchdogHandledRequest): WatchdogItem {
  const row = store.byName(w.db, name);
  if (row?.state !== 'tripped') throw new Fail('conflict', [{ path: 'name', issue: 'this watchdog has not tripped' }]);
  store.put(w.db, { ...row, handled_at: w.at, handled_outcome: r.outcome, handled_note: r.note });
  w.ledger({
    kind: 'note',
    actor: c.actor,
    session_id: c.session_id,
    what: `handled watchdog ${name} (${r.outcome}): ${r.note}`,
    why: 'the reflex reports each trip it was woken for',
    ref: `watchdog:${name}`,
    undoable: false,
  });
  return list(w.db).find((x) => x.name === name) as WatchdogItem;
}
