// A mind message that cites the owner's books (`[[book:<id>#p<n>.b<k>]]`, STUDY.md §8) is checked
// before it is stored: it names the question in `meta.cite.q`, the Worker finds that question's
// candidates again and keeps only what they back (cite.ts). The owner's own messages are not
// touched. The stored `meta.cite` holds the question, the blocks kept with their labels, and how
// many sentences were dropped (counted in the evals, never shown as an error).
import type { JsonObject } from '../../../../shared/contract/api';
import type { CiteMeta } from '../../../../shared/contract/library.ts';
import { principalOf } from '../../http/auth';
import { ApiError } from '../../http/errors';
import { checkAnswer } from './cite';
import { candidatesFor } from './scripture';

export async function cited(
  c: { env: Env; get(key: 'principal'): ReturnType<typeof principalOf> } & Parameters<typeof principalOf>[0],
  body: string,
  meta: JsonObject | undefined,
): Promise<{ body: string; meta: JsonObject | undefined }> {
  if (principalOf(c).kind === 'device' || !body.includes('[[book:')) return { body, meta };
  const q = (meta?.cite as { q?: unknown } | undefined)?.q;
  if (typeof q !== 'string' || !q.trim() || q.length > 500)
    throw new ApiError('validation', [
      { path: 'meta.cite.q', issue: 'the question the answer cites for (1–500 characters)' },
    ]);
  const r = checkAnswer(body, await candidatesFor(c.env, q.trim()));
  const cite: CiteMeta = { q: q.trim(), ...r.cite };
  return { body: r.body, meta: { ...meta, cite: cite as unknown as JsonObject } };
}
