// The owner's own words (the owner's decision of 2026-11-11, docs/process/decisions.md). A mind
// session that has read outside text is quarantined: it may not set a reminder or keep a rule,
// because the outside text may have told it to. One thing stays safe after such a read: saying
// back what the owner themself typed. So a reminder or a rule goes through from a labelled session
// when its words are the owner's, from the owner-device message it names: at least `SHARE` of its
// words (three letters or more, any case) stand in that message. Words the outside text supplied
// cannot pass, because they are not in the owner's message.

/** The share of a text's words that must stand in the owner's message. */
export const SHARE = 0.75;

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];

/** Whether `text` is the owner's own words from `said` (a message the owner typed). A text with no
 * word of three letters is nobody's words. */
export function ownersWords(text: string, said: string): boolean {
  const mine = new Set(words(said));
  const asked = words(text);
  if (!asked.length) return false;
  return asked.filter((w) => mine.has(w)).length >= SHARE * asked.length;
}
