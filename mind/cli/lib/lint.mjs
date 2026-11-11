// The Worker's phrase lint (shared/contract/lint.ts, via contract.json), checked here before
// sending so a refused message exits 8 without a round trip. Code fences are exempt. A reply's
// shape is not checked: that is the voice's judgement (mind/skills/voice.md).
import {CONTRACT} from './contract.mjs';

const prose = text => text.replace(/```[\s\S]*?```/g, ' ').toLowerCase();

/** The phrase lint: the first problem in a mind message, or null. */
export function lintText(text) {
  const words = prose(text);
  for (const p of CONTRACT.lint.banned_phrases) if (words.includes(p)) return `banned phrase: "${p}"`;
  if (/\p{Extended_Pictographic}/u.test(words)) return 'no emoji';
  return null;
}
