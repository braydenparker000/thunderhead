// A voice memo's words (HOME.md §6.2): Workers AI Whisper (`@cf/openai/whisper-large-v3-turbo`)
// on the memo as stored, with its media type, so the mind can read what the owner said. Best
// effort, inside one deadline: no binding, a refusal, a failure or the deadline means no words,
// never a failed upload. The audio is sent as a stream with its type (the model's input schema
// takes `{body, contentType}` or base64), so a 10-minute memo costs the Worker no copy and no
// base64 work; if the model refuses the stream form, the same bytes go once more as base64.
import { Buffer } from 'node:buffer';

export const WHISPER = '@cf/openai/whisper-large-v3-turbo';
/** The longest the upload waits for the words. */
export const TRANSCRIBE_MS = 25_000;
/** The largest memo sent for words: a 10-minute memo at the phone's 32 kbit/s is about 2.4 MB, and
 * the base64 retry of a bigger one would cost the Worker too much memory. */
export const TRANSCRIBE_BYTES = 10 * 1024 * 1024;
/** Words kept, in characters (a message body's limit). */
export const TEXT_MAX = 16_000;

/** The one method of the AI binding used here. */
export interface Transcriber {
  run(model: string, inputs: Record<string, unknown>, options?: { signal?: AbortSignal }): Promise<unknown>;
}

/** The binding, when this Worker has one (`ai` in wrangler.jsonc). */
export const aiOf = (env: unknown): Transcriber | null => {
  const ai = (env as { AI?: Transcriber }).AI;
  return ai && typeof ai.run === 'function' ? ai : null;
};

const words = (out: unknown): string | null => {
  const text = (out as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') return null;
  const kept = [...text.trim()].slice(0, TEXT_MAX).join('').trim();
  return kept || null;
};

/** The memo's words, or null. Never throws. */
export async function transcribe(
  ai: Transcriber | null,
  bytes: ArrayBuffer,
  type: string,
  ms = TRANSCRIBE_MS,
): Promise<string | null> {
  if (!ai || bytes.byteLength > TRANSCRIBE_BYTES) return null;
  const deadline = AbortSignal.timeout(ms);
  const late = new Promise<never>((_, reject) => {
    deadline.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
  });
  late.catch(() => undefined); // the deadline may pass after the words came: nobody waits then
  const run = (audio: unknown) => Promise.race([ai.run(WHISPER, { audio }, { signal: deadline }), late]);
  try {
    return words(await run({ body: new Blob([bytes]).stream(), contentType: type }));
  } catch {
    if (deadline.aborted) return null;
  }
  try {
    return words(await run(Buffer.from(bytes).toString('base64')));
  } catch {
    return null;
  }
}
