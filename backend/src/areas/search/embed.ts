// Text to vectors for recall by meaning (MEMORY.md §10.6): Workers AI's small English embedding
// model, on the free tier (no Vectorize: the vectors live in the Library object). At most 100
// texts a call, each cut to what the model reads; the answer is checked (one vector a text, 384
// numbers each) and made unit length, so cosine is a dot product. A failure, a refusal or the
// deadline throws: the indexer retries its step, and the recall returns nothing (FTS answers).

import type { Transcriber } from '../files/transcribe';
import { DIMS } from '../library/vectors';

export const EMBED_MODEL = '@cf/baai/bge-small-en-v1.5';
/** Texts in one call. */
export const EMBED_BATCH = 100;
/** Characters of a text sent: the model reads about 512 tokens. */
export const EMBED_CHARS = 2_000;
/** Characters a hit shows. */
export const SNIPPET_CHARS = 200;
/** The query's wait (a person is waiting) and a batch's. */
export const QUERY_MS = 3_000;
export const BATCH_MS = 20_000;

const squash = (t: string) => t.replace(/\s+/g, ' ').trim();

/** The text as sent to the model. */
export const clip = (t: string) => [...squash(t)].slice(0, EMBED_CHARS).join('');

/** What a hit shows: the start of the text, ≤ 200 characters. */
export function snippetOf(t: string): string {
  const c = [...squash(t)];
  return c.length <= SNIPPET_CHARS ? c.join('') : `${c.slice(0, SNIPPET_CHARS - 1).join('')}…`;
}

function unit(v: unknown): Float32Array {
  if (!Array.isArray(v) || v.length !== DIMS || !v.every((x) => typeof x === 'number' && Number.isFinite(x)))
    throw new Error('bad vector');
  const out = Float32Array.from(v as number[]);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n);
  if (!n) throw new Error('bad vector');
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

/** One vector per text, in order. Throws on any failure. */
export async function embed(ai: Transcriber, texts: string[], ms: number): Promise<Float32Array[]> {
  if (!texts.length) return [];
  if (texts.length > EMBED_BATCH) throw new Error('batch too big');
  const deadline = AbortSignal.timeout(ms);
  const late = new Promise<never>((_, reject) => {
    deadline.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
  late.catch(() => undefined);
  const out = await Promise.race([ai.run(EMBED_MODEL, { text: texts.map(clip) }, { signal: deadline }), late]);
  const data = (out as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== texts.length) throw new Error('no vectors');
  return data.map(unit);
}
