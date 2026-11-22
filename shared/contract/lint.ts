// The phrase lint on the mind's words (BEHAVIOR.md §10, check TONE-1), as data. Since 2026-11-22
// (owner) nothing the mind writes is refused by it: the Sunday voice test grades with it, and the
// owner's name for the mind (`mind.name`) is still held to it. Matching is case-insensitive on
// whole phrases. Code is exempt: lines inside ``` fences are not checked.
//
// It holds only what the owner's laws rule out whatever the moment: flattery (law 6), streak and
// screen pressure (law 16), and talk about the machinery. How a reply is shaped (its length, a
// list, an opener, an offer at the end, a word of sympathy) is the voice's judgement
// (the owner's voice page), not a refusal: the shape lint that stood here was taken out on
// 2026-11-11 (docs/process/decisions.md).

export const BANNED_PHRASES = [
  'great question',
  'amazing work',
  "you're a natural",
  "don't break your streak",
  'i have successfully',
  'keep pushing forward',
  'as an ai language model',
  'i will now run',
  'using the bash tool',
] as const;

const prose = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();

/** The first lint problem in a mind message, or null. */
export function lintMindText(text: string): string | null {
  const words = prose(text);
  for (const p of BANNED_PHRASES) if (words.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(words)) return 'no emoji';
  return null;
}
