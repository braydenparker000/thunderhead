// An app's arrangement placed by a verb (verbs/apps.ts; BEHAVIOR.md §3.1, rung 0): the slot's kind
// and payload checked against the contract, the topic's 14-day quiet and 30-day rest honoured as
// for `th surface` (ops.ts), and the slot written with its own ledger row (kind `arrangement`, the
// verb's row: run.ts links it), whose undo puts back what was there. The verb's gate decided the
// permit; a silent arrangement is no speech, so the speech setting holds none back.
import { surfaceKind } from '../../../../shared/contract/surfaces.ts';
import { Fail, invalid } from '../../lib/result';
import { ownerDay } from '../../lib/time';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as store from './store';

const QUIET_MS = 14 * 86_400_000;

/** A topic the owner dismissed in the last 14 days (409 nudge_repeat), or one at rest (422 topic_quiet). */
export function topicOpen(w: Writer, topicKey: string, tz: () => string): void {
  const topic = store.topicState(w.db, topicKey);
  if (topic?.ignored_at != null && w.at - topic.ignored_at < QUIET_MS) throw new Fail('nudge_repeat');
  if (topic?.quiet_until != null && topic.quiet_until > w.at)
    throw new Fail('topic_quiet', { until: topic.quiet_until, reopens: ownerDay(topic.quiet_until, tz()) });
}

export interface Arrange {
  app: string;
  slot: string;
  kind: string;
  payload: unknown;
  why: string;
  topic_key: string;
  ref: string | null;
}

/** Places it; its ledger row's id and the undo that row keeps. */
export function arrange(
  w: Writer,
  c: Caller,
  a: Arrange,
  tz: () => string,
): { ledgerId: string; undo: { op: string; args: Record<string, unknown> } } {
  const kind = surfaceKind(a.kind);
  const slots = kind && Object.hasOwn(kind.slots, a.app) ? (kind.slots as Record<string, RegExp>)[a.app] : null;
  if (!kind || !slots?.test(a.slot)) throw invalid('slot', `no ${a.kind} in ${a.app}/${a.slot}`);
  const payload = kind.versions[1].safeParse(a.payload);
  if (!payload.success) throw invalid('args', payload.error.issues[0]?.message ?? 'not this kind');
  topicOpen(w, a.topic_key, tz);
  const before = store.get(w.db, a.app, a.slot);
  const undo = before
    ? { op: 'surface.restore', args: { app: a.app, slot: a.slot, row: before, was: 'put' } }
    : { op: 'surface.delete', args: { app: a.app, slot: a.slot, was: 'put' } };
  const ledgerId = w.ledger({
    kind: 'arrangement',
    actor: c.actor,
    session_id: c.session_id,
    what: `${a.app}/${a.slot} ← ${a.kind}`,
    why: a.why,
    ref: a.ref,
    topic_key: a.topic_key,
    undo,
  });
  w.change('surface', `app:${a.app}#${a.slot}`);
  store.put(w.db, {
    app: a.app,
    slot: a.slot,
    kind: a.kind,
    schema: 1,
    payload_json: JSON.stringify({ v: 1, ...(payload.data as object) }),
    why: a.why,
    topic_key: a.topic_key,
    ref: a.ref,
    expires_at: null,
    written_at: w.at,
    actor: c.actor,
    ledger_id: ledgerId,
    seq: w.seq,
    facts_json: null,
  });
  store.topicShown(w.db, a.topic_key, w.at);
  return { ledgerId, undo };
}
