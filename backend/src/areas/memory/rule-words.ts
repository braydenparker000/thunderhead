// A rule steers every later session, so the mind writes one only in the owner's own words from the
// owner-device message it cites, in any session, marked or not (owner, 2026-11-22): what a walled
// reader's answer asked for never becomes one. The one rule the Worker composes itself, "never play
// this song again" (verbs/worker.ts `music.never`: a fixed sentence around a song's ref), is not
// held to it: its words are the Worker's, and its evidence is still the owner's message.
import type { FactSource } from '../../../../shared/contract/memory.ts';
import { MUSIC_NEVER_SUBJECT } from '../../../../shared/contract/music.ts';
import { type OpContext, ownWords, Reject } from './validate';

const NEVER_PLAY = /^Never play music:r2_[A-Za-z0-9_-]{10,200} again\.$/;

/** Throws `rule_not_owner_words` for a rule from the mind that is not the owner's wording. */
export function ruleInOwnersWords(
  ctx: OpContext,
  kind: string,
  source: FactSource,
  subject: string | null | undefined,
  text: string,
  evidence: string[] | undefined,
): void {
  if (kind !== 'rule' || source !== 'user' || ctx.device) return;
  if (subject === MUSIC_NEVER_SUBJECT && NEVER_PLAY.test(text)) return;
  if (!ownWords(ctx, source, text, evidence)) throw new Reject('rule_not_owner_words');
}
