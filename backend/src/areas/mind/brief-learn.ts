// The briefing's lines on what lands and on speaking (BEHAVIOR.md §3.6–3.7): section 1's speech line
// (the owner's position and, while quiet, what today has spent), and the arrangements' short table:
// what lands per topic over 30 days (worst first, at most 8), the topics that rest (with the one
// sentence to say once, until it is recorded), and the odds claimed against what happened over 28
// days. Pure, each its own small function, so a briefing laid out differently takes them as they are;
// until the briefing has a section for the day's arrangements they close section 1 (learnTail).
import { LANDS, SPEECH_QUIET, type SpeechSpent, type TopicLands } from '../../../../shared/contract/lands.ts';
import type { Calibration } from '../../../../shared/contract/predictions.ts';

/** Section 1: how the mind may speak today. */
export function speechLine(s: SpeechSpent): string {
  if (s.speech === 'silent')
    return 'speech: silent (the owner chose it) · no home line, tile, card or push unless they ask (--asked-by <their message>); reminders still ring';
  if (s.speech === 'quiet')
    return `speech: quiet (the owner chose it) · today ${s.lines} of ${SPEECH_QUIET.lines} home line, ${s.cards} of ${SPEECH_QUIET.cards} card · a push only for what they asked for (--asked-by)`;
  return 'speech: as needed · no daily caps: the voice ladder, nudge_repeat and what lands govern';
}

const counts = (t: TopicLands) => `${t.kept}/${t.undone}/${t.ignored}/${t.unseen}`;
const where = (t: TopicLands) => (t.places.length ? ` (${t.places.join(', ')})` : '');

/** One table row: `episodes.new (home) 0/1/2/0 · 3 in a row · rests until 2026-12-04`. */
export function landsRow(t: TopicLands): string {
  const streak = t.streak ? ` · ${t.streak} in a row` : '';
  const rests = t.reopens ? ` · rests until ${t.reopens}${t.said ? '' : ', not said yet'}` : '';
  const waiting = t.waiting ? ` · ${t.waiting} new` : '';
  return `${t.topic_key}${where(t)} ${counts(t)}${streak}${waiting}${rests}`;
}

/** What to do about a topic that rests and was not said yet: say it once, then record it. */
export const SAY_ONCE = (keys: string[]) =>
  `Say once, in your words, that you stopped (e.g. "I've stopped suggesting episodes on home. Say the word to bring them back."), then: th surface said <topic> (${keys.join(', ')}). th surface on a resting topic is 422 topic_quiet; the owner reopens one in Settings, or in words: th surface reopen <topic> --by-message <id>.`;

/** "Your odds last 28 days: chat.any 62 % right of 70 % claimed · cards 50 % right of 80 % claimed". */
export function oddsLine(items: Calibration[]): string | null {
  if (!items.length) return null;
  const pct = (x: number) => `${Math.round(x * 100)} %`;
  return `Your odds last 28 days: ${items.map((c) => `${c.category} ${pct(c.right)} right of ${pct(c.claimed)} claimed (${c.n})`).join(' · ')}`;
}

/** The arrangements' lines: the table (none when nothing was placed), the say-once line, the odds. */
export function landsLines(topics: TopicLands[], calibration: Calibration[]): string[] {
  const shown = topics.slice(0, LANDS.brief_rows);
  const unsaid = topics.filter((t) => t.reopens && !t.said).map((t) => t.topic_key);
  const odds = oddsLine(calibration);
  return [
    ...(shown.length
      ? [
          `What lands, ${LANDS.window_days} days (kept/undone/ignored/unseen), worst first; ${LANDS.streak} ignored or undone in a row and a topic rests ${LANDS.quiet_days} days:`,
          ...shown.map(landsRow),
          ...(topics.length > shown.length ? [`(+${topics.length - shown.length} more: th surface topics)`] : []),
        ]
      : []),
    ...(unsaid.length ? [SAY_ONCE(unsaid)] : []),
    ...(odds ? [odds] : []),
  ];
}

/** The speech line, then the arrangements' lines within 1,400 characters (whole lines, the oldest
 * kept), as section 1's tail: each on its own line after what is above it. */
export function learnTail(speech: string, lands: string[]): string {
  const out = [speech.slice(0, 240)];
  let used = out[0].length;
  for (const [k, l] of lands.entries()) {
    if (used + l.length + 1 > 1_340) {
      out.push(`(+${lands.length - k} more: th surface topics)`);
      break;
    }
    out.push(l);
    used += l.length + 1;
  }
  return `\n${out.join('\n')}`;
}
