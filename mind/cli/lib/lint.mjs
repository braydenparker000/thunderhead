// The Worker's phrase and shape lints (shared/contract/lint.ts, via contract.json), checked here
// before sending so a refused message exits 8 without a round trip. Code fences are exempt.
import {CONTRACT} from './contract.mjs';

const prose = text => text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();
const LIST_ITEM = /^\s*(?:[-*+•]|\d+[.)])\s+/;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Where in a reply each place looks (the same patterns as the Worker's). */
const PLACE = {
  start: p => new RegExp(`^\\s*${esc(p)}(?![\\p{L}\\p{N}])`, 'u'),
  sentence: p => new RegExp(`(?:^|[.!?:]\\s+|\\n\\s*)${esc(p)}(?![\\p{L}\\p{N}])`, 'u'),
  end: p => new RegExp(`(?:^|[.!?;,:\\n—–]\\s*|\\s-\\s+)${esc(p)}(?![\\p{L}\\p{N}])[^.!?\\n]*[.!?]?\\s*$`, 'u'),
  anywhere: p => new RegExp(esc(p), 'u'),
};

/** The phrase lint: the first problem in a mind message, or null. */
export function lintText(text) {
  const words = prose(text);
  for (const p of CONTRACT.lint.banned_phrases) if (words.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(words)) return 'no emoji';
  return null;
}

/** The shape lint on a chat reply: a list alone, an opener, a closer that offers more; or null. */
export function lintShape(text) {
  const words = prose(text);
  const lines = words.split('\n').filter(l => l.trim());
  if (lines.length && lines.every(l => LIST_ITEM.test(l))) return CONTRACT.lint.only_a_list;
  for (const s of CONTRACT.lint.banned_shapes) if (PLACE[s.at](s.phrase).test(words.trim())) return `banned shape: "${s.phrase}" (${s.at})`;
  return null;
}

/** A chat text message: both lints, as the Worker checks it. */
export const lintReply = text => lintText(text) ?? lintShape(text);
