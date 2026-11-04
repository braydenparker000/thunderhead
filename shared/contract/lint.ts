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

/** The shapes a chat reply may not take (BEHAVIOR.md §2.2, mind/skills/voice.md), checked on the
 * chat's text messages only: cards, home lines and the night's lines keep the phrase lint alone.
 * `start`: the reply opens with it; `sentence`: any sentence or line opens with it; `end`: the last
 * sentence has it at the start of a clause; `anywhere`: anywhere. A reply that is only a list is
 * refused too (`ONLY_A_LIST`). */
export const BANNED_SHAPES = [
  { phrase: 'sure', at: 'start' },
  { phrase: 'certainly', at: 'start' },
  { phrase: 'absolutely', at: 'start' },
  { phrase: 'of course', at: 'start' },
  { phrase: 'here are', at: 'sentence' },
  { phrase: 'options:', at: 'anywhere' },
  { phrase: 'let me know if', at: 'end' },
  { phrase: 'want me to', at: 'end' },
  { phrase: 'would you like me to', at: 'end' },
  { phrase: 'feel free to', at: 'end' },
] as const;
export type ShapePlace = (typeof BANNED_SHAPES)[number]['at'];

export const ONLY_A_LIST = 'only a list: say it in sentences';

const prose = (text: string) => text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Where in a reply each place looks: the phrase must start there and end at a word boundary. */
const PLACE: Record<ShapePlace, (p: string) => RegExp> = {
  start: (p) => new RegExp(`^\\s*${esc(p)}(?![\\p{L}\\p{N}])`, 'u'),
  sentence: (p) => new RegExp(`(?:^|[.!?:]\\s+|\\n\\s*)${esc(p)}(?![\\p{L}\\p{N}])`, 'u'),
  end: (p) => new RegExp(`(?:^|[.!?;,:\\n—–]\\s*|\\s-\\s+)${esc(p)}(?![\\p{L}\\p{N}])[^.!?\\n]*[.!?]?\\s*$`, 'u'),
  anywhere: (p) => new RegExp(esc(p), 'u'),
};

/** The first lint problem in a mind message, or null. */
export function lintMindText(text: string): string | null {
  const words = prose(text);
  for (const p of BANNED_PHRASES) if (words.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(words)) return 'no emoji';
  return null;
}

/** The first shape problem in a chat reply, or null (the phrase lint is separate). */
export function lintShape(text: string): string | null {
  const words = prose(text);
  const lines = words.split('\n').filter((l) => l.trim());
  if (lines.length && lines.every((l) => LIST_ITEM.test(l))) return ONLY_A_LIST;
  for (const s of BANNED_SHAPES) if (PLACE[s.at](s.phrase).test(words.trim())) return `banned shape: "${s.phrase}" (${s.at})`;
  return null;
}

/** A chat text message: the phrase lint, then the shape lint. */
export const lintChatReply = (text: string): string | null => lintMindText(text) ?? lintShape(text);
