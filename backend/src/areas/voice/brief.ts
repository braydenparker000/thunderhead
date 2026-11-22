// The briefing's voice section (shared/contract/voice.ts): the page whole, right after "Now", so
// every session starts knowing how to talk. A correction about HOW the mind talks goes to the page.
import type { Db } from '../../objects/base';
import { voiceText } from './ops';

export const VOICE_HEADING = '## How you talk';

/** `## How you talk` and the page (the default while the owner and the mind have written none). */
export const voiceSection = (db: Db): string => `${VOICE_HEADING}\n${voiceText(db)}`;

/** The briefing with the voice section placed right after section 1 ("Now"), in the core and the full file. */
export function withVoice<T extends { core: string; full: string }>(b: T, section: string): T {
  const place = (text: string) => {
    const at = text.indexOf('\n\n## 2. ');
    return at < 0 ? `${text}\n\n${section}` : `${text.slice(0, at)}\n\n${section}${text.slice(at)}`;
  };
  return { ...b, core: place(b.core), full: place(b.full) };
}
