// `@muse` in an owner's message (PutMessageRequest.mention): what the words are and whether the
// message may carry the mention at all, checked by the conversation before it stores anything
// (conversation/ops.ts), so a refusal leaves neither the message nor an order. The phone reads the
// same shape (th/commands/commands.js `mentionOf`): "@muse <words>", "@Muse, <words>".
import { WORK_LIMITS } from '../../../../shared/contract/work.ts';
import { invalid } from '../../lib/result';

const MENTION = /^@muse(?:\s*[,:]\s*|\s+)(\S[\s\S]*)$/i;

/** The words after "@muse", or null when the message doesn't start with it. */
export const mentionWords = (body: string) => MENTION.exec(body.trim())?.[1].trim() ?? null;

/** Refuses a mention that can't become an order: from anyone but the owner, off the record (a
 * conversation never remembered sends nothing on), with files (Muse gets words only), or with no
 * words or more than 500 of them for Muse. */
export function checkMention(p: { body: string; files: number; owner: boolean; offRecord: boolean }): void {
  if (!p.owner) throw invalid('mention', 'only the owner asks Muse');
  if (p.offRecord) throw invalid('mention', 'not off the record');
  if (p.files) throw invalid('mention', 'words only: Muse gets no files');
  const words = mentionWords(p.body) ?? p.body.trim();
  if (!words) throw invalid('body', 'what to ask Muse');
  if (words.length > WORK_LIMITS.words) throw invalid('body', `at most ${WORK_LIMITS.words} characters for Muse`);
}
