// The recall indexer (MEMORY.md §10.6): a lane job of Core's (`search.embed`, JOBS.md §4) queued
// on the day roll and again when the night is done, never per write. Each run takes what is new in
// each source since its stored place (`recall.index` in Core's settings): messages, facts, day
// notes, then Study's pages. A step is at most 100 texts and one model call; its vectors go to the
// Library object, then the step's commit moves the place, so a crash re-embeds one batch (the same
// rows again, replaced). At most 1,000 texts a run; the rest waits for the next. The last steps
// sweep the whole index, 500 refs a step, for rows gone from their source (forgotten, superseded,
// deleted or held) and drop them, and past 10,000 rows the oldest go. It shares the bulk lane and waits from 80 % of the day's rows, as the
// night's other jobs do (jobs/runner.ts).

import type { Db } from '../../objects/base';
import { libraryObject } from '../../objects/library';
import { messagesAfter, messagesStart } from '../conversation/recall-rows';
import { aiOf } from '../files/transcribe';
import { JobError, type JobHandler, useLane } from '../jobs/runner';
import { requeueJob } from '../jobs/store';
import type { VectorIn } from '../library/vectors';
import { factsAfter, notesAfter } from '../memory/recall-rows';
import * as settings from '../settings/store';
import { BATCH_MS, EMBED_BATCH, embed, snippetOf } from './embed';
import { liveRefs } from './live';

export const EMBED_JOB = 'search.embed';
/** Texts embedded in one run, at most. */
export const PER_RUN = 1_000;
/** Index refs the sweep checks a step (every one, each run). */
export const SWEEP = 500;
/** A first run starts this many messages from the newest. */
const FIRST_MESSAGES = 5_000;
const PLACE = 'recall.index';

type Phase = 'messages' | 'facts' | 'day_notes' | 'library' | 'sweep';
const NEXT: Record<Phase, Phase | null> = {
  messages: 'facts',
  facts: 'day_notes',
  day_notes: 'library',
  library: 'sweep',
  sweep: null,
};

export interface Place {
  messages: number;
  facts: number;
  day_notes: [number, string];
  library: number;
}
interface Cursor {
  phase: Phase;
  texts: number;
  /** The sweep's place in the index (key order). */
  after?: string;
}
interface Input {
  written: number;
  place: Partial<Place> | null;
  next: Cursor | null;
}

export function placeOf(db: Db): Place {
  const p = settings.getSetting(db, PLACE) as Partial<Place> | undefined;
  return {
    messages: p?.messages ?? messagesStart(db, FIRST_MESSAGES),
    facts: p?.facts ?? 0,
    day_notes: p?.day_notes ?? [0, ''],
    library: p?.library ?? 0,
  };
}

/** Queues a run now (once: a run queued or running is left as it is). */
export const queueEmbed = (db: Db, at: number) => requeueJob(db, { id: EMBED_JOB, kind: EMBED_JOB, payload: {}, at });

type Item = Omit<VectorIn, 'vector'> & { text: string };

/** The next batch of a source after its place, and the place after it. */
async function batchOf(env: Env, db: Db, phase: Phase, p: Place): Promise<{ items: Item[]; place: Partial<Place> }> {
  if (phase === 'messages') {
    const rows = messagesAfter(db, p.messages, EMBED_BATCH);
    const items = rows.map((m) => ({
      ref: `msg:${m.id}`,
      source: 'messages',
      text: m.body,
      snippet: snippetOf(m.body),
      at: m.created_at,
      // As the messages source labels them (search/sources.ts).
      provenance: m.author === 'owner' && (m.origin === 'owner_device' || m.origin === 'import') ? 'owner' : 'outside',
    }));
    return { items, place: { messages: rows.at(-1)?.seq ?? p.messages } };
  }
  if (phase === 'facts') {
    const rows = factsAfter(db, p.facts, EMBED_BATCH);
    const items = rows.map((f) => ({
      ref: `fact:${f.id}`,
      source: 'facts',
      text: f.text,
      snippet: snippetOf(f.text),
      at: f.recorded_at,
      provenance: f.provenance,
    }));
    return { items, place: { facts: rows.at(-1)?.seq ?? p.facts } };
  }
  if (phase === 'day_notes') {
    const rows = notesAfter(db, p.day_notes, EMBED_BATCH);
    const items = rows.map((n) => ({
      ref: `day:${n.day}`,
      source: 'day_notes',
      text: n.summary,
      snippet: snippetOf(n.summary),
      at: n.written_at,
      provenance: n.provenance,
    }));
    const last = rows.at(-1);
    return { items, place: { day_notes: last ? [last.written_at, last.day] : p.day_notes } };
  }
  const r = await libraryObject(env).embedPages(p.library, EMBED_BATCH);
  const items = r.pages.map((g) => ({
    ref: `book:${g.book_id}#p${g.pdf_page}`,
    source: 'library',
    text: g.text,
    snippet: snippetOf(g.text),
    at: g.at,
    provenance: null,
  }));
  return { items, place: { library: r.next } };
}

/** One page of the index checked against its sources; the next page follows until a short one. */
async function sweep(env: Env, db: Db, c: Cursor): Promise<Input> {
  const lib = libraryObject(env);
  const refs = await lib.embeddingRefs(c.after ?? '', SWEEP);
  const live = liveRefs(db, refs);
  const gone = refs.filter((r) => !r.startsWith('book:') && !live.has(r));
  const last = refs.length < SWEEP;
  const written = gone.length || last ? await lib.dropEmbeddings(gone, last) : 0;
  const next = last ? null : { phase: 'sweep' as const, texts: c.texts, after: refs.at(-1) };
  return { written, place: null, next };
}

export const embedJob: JobHandler = {
  kind: EMBED_JOB,
  lane: true,
  async load(env, db, _payload, cursor): Promise<Input> {
    const c = (cursor as Cursor | null) ?? { phase: 'messages', texts: 0 };
    const p = placeOf(db);
    if (c.phase === 'sweep' || c.texts >= PER_RUN) return sweep(env, db, c);
    const { items, place } = await batchOf(env, db, c.phase, p);
    const after = NEXT[c.phase] as Phase;
    const full = items.length === EMBED_BATCH || (c.phase === 'library' && place.library !== p.library);
    const next = { phase: full ? c.phase : after, texts: c.texts + items.length };
    if (!items.length) return { written: 0, place, next };
    const ai = aiOf(env);
    if (!ai) throw new JobError('not_configured');
    const vectors = await embed(
      ai,
      items.map((i) => i.text),
      BATCH_MS,
    );
    const rows: VectorIn[] = items.map(({ text: _t, ...i }, n) => ({ ...i, vector: vectors[n] }));
    return { written: await libraryObject(env).putEmbeddings(rows), place, next };
  },
  step(w, _payload, _cursor, input) {
    const i = input as Input;
    // Rows written in the Library object count on the lane here; its own meter counts them for the day.
    useLane(w, i.written, w.at);
    if (i.place) settings.putSetting(w.db, PLACE, { ...placeOf(w.db), ...i.place }, 'worker', w.at);
    return i.next ? { next: i.next } : { done: true };
  },
};
