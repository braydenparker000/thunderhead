// What lands inside Core (BEHAVIOR.md §3.6, API.md §11.12): the pass that counts each topic's last
// 30 days from the ledger and the Senses object's rollups (lands.ts), keeps the counts on the topic's
// row for the briefing and sends a topic passed over three times in a row to rest for 30 days (a
// ledger row says so); the owner reopening one (a tap, or their own words, checked as a card's); the
// mind recording that it said so, once. The pass runs on the day roll (before the night's wake) and
// whenever GET /v1/insight/topics is read.
import { LANDS, type TopicLands, type TopicsResponse } from '../../../../shared/contract/lands.ts';
import { Fail, invalid } from '../../lib/result';
import { DAY, ownerDay } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { currentDay } from '../conversation/day';
import { latestOwnerMessage } from '../conversation/stats';
import * as convo from '../conversation/store';
import { topicArrangements } from '../ledger/store';
import { claimedSession } from '../mind/guards';
import * as store from '../surfaces/store';
import {
  byDay,
  cacheOf,
  countTopics,
  type LandsCache,
  type Placed,
  quietUntil,
  restingFields,
  type TopicMarks,
  trips,
  worstFirst,
} from './lands';
import type { Rollup } from './meter';

const marksOf = (rows: store.TopicState[]) => new Map<string, TopicMarks>(rows.map((r) => [r.topic_key, r]));

/** The pass: every topic placed in the window, counted; the counts kept on each row (a topic that
 * fell out of the window loses them); a topic whose streak reached the rule's goes to rest. */
export function pass(w: Writer, senses: Rollup[], tz: string): TopicsResponse {
  const rows: Placed[] = topicArrangements(w.db, w.at - LANDS.window_days * DAY);
  const known = store.topicStates(w.db, w.at);
  const marks = marksOf(known);
  for (const k of new Set(rows.map((r) => r.topic_key)))
    if (!marks.has(k)) {
      const s = store.topicState(w.db, k);
      if (s) marks.set(k, s);
    }
  const items = countTopics(rows, byDay(senses), marks, w.at, tz);
  for (const t of items) {
    if (trips(t)) {
      const until = quietUntil(w.at);
      store.topicQuiet(w.db, t.topic_key, w.at, until);
      w.ledger({
        kind: 'arrangement',
        actor: 'worker',
        what: `topic ${t.topic_key} rests until ${ownerDay(until, tz)}`,
        why: `ignored or undone ${t.streak} times in a row, nothing kept between`,
        topic_key: t.topic_key,
        ref: `topic:${t.topic_key}`,
        undoable: false,
      });
      w.change('surface', `topic:${t.topic_key}`);
      Object.assign(t, { quiet_until: until, reopens: ownerDay(until, tz), said: false });
    }
    const cache = JSON.stringify(cacheOf(t));
    const had = known.find((k) => k.topic_key === t.topic_key)?.lands_json;
    if (had !== cache) store.topicLands(w.db, t.topic_key, cache);
  }
  // Resting topics with nothing placed in the window still show, with zero counts; others lose theirs.
  const counted = new Set(items.map((t) => t.topic_key));
  for (const k of known.filter((r) => !counted.has(r.topic_key))) {
    if (k.lands_json !== null) store.topicLands(w.db, k.topic_key, null);
    if ((k.quiet_until ?? 0) > w.at) items.push(empty(k, w.at, tz));
  }
  return { window_days: LANDS.window_days, items: items.sort(worstFirst) };
}

const empty = (m: store.TopicState, now: number, tz: string): TopicLands => ({
  topic_key: m.topic_key,
  places: [],
  kept: 0,
  undone: 0,
  ignored: 0,
  unseen: 0,
  waiting: 0,
  streak: 0,
  ...restingFields(m, now, tz),
});

/** The topics as the last pass left them (the briefing reads these: no Senses object in reach),
 * worst first. */
export function lastPass(db: Db, now: number, tz: string): TopicLands[] {
  return store
    .topicStates(db, now)
    .map((m) => {
      let c: Partial<LandsCache> = {};
      try {
        c = m.lands_json ? JSON.parse(m.lands_json) : {};
      } catch {}
      return { ...empty(m, now, tz), ...c, ...restingFields(m, now, tz) };
    })
    .sort(worstFirst);
}

/** POST /v1/surfaces/topics/:key/reopen: a tap on a device, or the owner's own words recorded by the
 * chat session that holds the lease (never a tainted one), checked as a card's (proposals/decide.ts):
 * the owner's message from a device, in the open day's thread, after the topic went quiet, and still
 * their latest there. */
export function reopen(w: Writer, c: Caller, key: string, byMessage: string | undefined, tz: string) {
  const t = store.topicState(w.db, key);
  if (!t) throw new Fail('not_found');
  if (!((t.quiet_until ?? 0) > w.at)) throw new Fail('conflict', { reason: 'not_resting' });
  const device = c.who === 'D';
  if (device && byMessage !== undefined) throw invalid('by_message', 'a device reopens by a tap');
  if (!device) {
    if (c.who !== 'C') throw new Fail('forbidden');
    if (byMessage === undefined) throw invalid('by_message', "mind:chat reopens only with the owner's own words");
    if (claimedSession(w.db, c.session_id, 'chat').tainted) throw new Fail('session_tainted');
    const m = convo.messageById(w.db, byMessage);
    if (m?.author !== 'owner' || m.origin !== 'owner_device') throw new Fail('not_owner_words');
    if (m.thread_id !== convo.dailyThread(w.db, currentDay(w.db, tz, w.at))?.id) throw new Fail('not_owner_words');
    if (m.created_at <= (t.quiet_from ?? 0) || m.created_at > w.at) throw new Fail('not_owner_words');
    if (latestOwnerMessage(w.db, m.thread_id)?.id !== m.id) throw new Fail('not_owner_words');
  }
  // Its streak starts again from here: the briefing's counts say so at once.
  let lands: string | null = t.lands_json;
  try {
    if (lands) lands = JSON.stringify({ ...JSON.parse(lands), streak: 0 });
  } catch {}
  store.topicReopened(w.db, key, w.at, lands);
  const ledgerId = w.ledger({
    kind: 'arrangement',
    actor: 'owner',
    session_id: c.session_id,
    what: `topic ${key} reopened`,
    why: device ? 'the owner reopened it in Settings' : 'mind:chat recorded the owner’s message, checked by the Worker',
    ref: device ? `topic:${key}` : `msg:${byMessage}`,
    topic_key: key,
    undoable: false,
  });
  w.change('surface', `topic:${key}`);
  return { topic_key: key, ledger_id: ledgerId };
}

/** POST /v1/surfaces/topics/:key/said: the mind said, once, that a topic went quiet. */
export function said(w: Writer, key: string): { topic_key: string; said_at: number } {
  const t = store.topicState(w.db, key);
  if (!t || !((t.quiet_until ?? 0) > w.at)) throw new Fail('not_found', { reason: 'not_resting' });
  if (t.said_at !== null) throw new Fail('already_said');
  store.topicSaid(w.db, key, w.at);
  w.change('surface', `topic:${key}`);
  return { topic_key: key, said_at: w.at };
}
