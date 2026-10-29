// The phrase lint on the mind's words (BEHAVIOR.md §10, check TONE-1), as data: the Worker
// refuses a mind message that trips it (422 validation, reason `phrase`) and `th say` checks it
// before sending (exit 8). Matching is case-insensitive on whole phrases. Code is exempt: lines
// inside ``` fences are not checked.

export const BANNED_PHRASES = [
  'great question',
  'amazing work',
  "you're a natural",
  "don't break your streak",
  'i deeply apologize',
  "i'm so sorry",
  'i have successfully',
  'keep pushing forward',
  'as an ai language model',
  'i will now run',
  'using the bash tool',
] as const;

/** The first lint problem in a mind message, or null. */
export function lintMindText(text: string): string | null {
  const prose = text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();
  for (const p of BANNED_PHRASES) if (prose.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(prose)) return 'no emoji';
  return null;
}
