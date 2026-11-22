// The phrase lint (shared/contract/lint.ts, via contract.json). Nothing the mind sends is refused
// by it since 2026-11-22 (owner): the Sunday voice test (eval-voice.mjs) grades with it. Code
// fences are exempt.
import {CONTRACT} from './contract.mjs';

const prose = text => text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();

/** The phrase lint: the first problem in a mind message, or null. */
export function lintText(text) {
  const words = prose(text);
  for (const p of CONTRACT.lint.banned_phrases) if (words.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(words)) return 'no emoji';
  return null;
}
