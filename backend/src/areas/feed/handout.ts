// What the Worker adds when GET /v1/live/wait hands owner messages to the chat session (API.md
// §11.5): the mind's presence set to working at once (what `th status working` does, with no note),
// so the phone shows it is thinking without a model step; and with each message up to 5 memories
// that match it (`recall`), from the search `th recall "<the message>"` runs (words matched, and
// hits by meaning fused in). The handout never waits on it: the whole search gets 400 ms; a meaning
// search not back by then leaves the words' matches alone; any error hands the message out without
// `recall`. A failed presence write changes nothing: the session's own `th status` still sets it.
import type { LiveWaitResponse, SearchHit } from '../../../../shared/contract/api';
import { RECALL_LIMITS } from '../../../../shared/contract/mind-brief';
import type { Caller } from '../../objects/caller';
import { coreObject } from '../../objects/core';
import { ftsMatch, fuse, plain, SEMANTIC, SOURCES, type SourceQuery } from '../search/sources';
import { pickRecall, wantsRecall } from './recall';

type Hit = Omit<SearchHit, 'score'>;
const LATE = Symbol('late');
/** The stores asked by words, and by meaning (Study's pages too, as GET /v1/search asks). */
const BY_WORDS = ['messages', 'facts', 'day_notes'] as const;
const BY_MEANING = ['messages', 'facts', 'day_notes', 'library'] as const;

/** One message's memories within the shared deadline; undefined when none may be given. */
async function recallFor(env: Env, body: string, thread: string, late: Promise<typeof LATE>) {
  const match = ftsMatch(body);
  if (!match) return undefined;
  const q: SourceQuery = { match, text: plain(body), since: null, until: null, thread: null, limit: 10 };
  const words = Promise.all(BY_WORDS.map((s) => SOURCES[s]?.run(env, q) ?? Promise.resolve([] as Hit[])));
  const meaning = SEMANTIC.recall ? SEMANTIC.recall.run(env, q, [...BY_MEANING]) : Promise.resolve([] as Hit[]);
  // An answer that comes after the deadline is dropped; its error must not go unhandled.
  meaning.catch(() => undefined);
  const lists = await Promise.race([words, late]);
  if (lists === LATE) return undefined;
  const meant = await Promise.race([meaning, late]);
  const fused = fuse(meant === LATE ? lists : [...lists, meant], 20);
  const items = pickRecall(fused, thread);
  return items.length ? items : undefined;
}

/** The take as handed out: presence set and each message's `recall`, within `ms` in all. */
export async function handOut(
  env: Env,
  who: Caller,
  take: LiveWaitResponse,
  ms: number = RECALL_LIMITS.ms,
): Promise<LiveWaitResponse> {
  if (!take.messages.length) return take;
  // Reported under no session: the session's own 3-second repeat slot stays free, so its first
  // `th status working --title …` right after this still lands (areas/mind/ops.ts status).
  const presence = Promise.resolve()
    .then(() => coreObject(env).mindStatus({ ...who, session_id: null }, { state: 'working' }))
    .catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<typeof LATE>((r) => {
    timer = setTimeout(() => r(LATE), ms);
  });
  const offRecord = take.off_record ?? [];
  const messages = await Promise.all(
    take.messages.map(async (m) => {
      if (!wantsRecall(m.body, m.thread_id, offRecord)) return m;
      const recall = await recallFor(env, m.body, m.thread_id, late).catch(() => undefined);
      return recall ? { ...m, recall } : m;
    }),
  );
  clearTimeout(timer);
  await presence;
  return { ...take, messages };
}
