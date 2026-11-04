// The briefing's text helpers (MEMORY.md §9): clock and weekday per zone, one message as a line,
// and the fill rule every list section shares (keep the newest or the oldest, mark the cut). Pure.
import type { Message } from '../../../../shared/contract/api';

/** Formatters made once per zone (one per line cost the briefing tens of ms of CPU). */
const FORMATS = new Map<string, Intl.DateTimeFormat>();
function format(tz: string, kind: 'clock' | 'weekday'): Intl.DateTimeFormat {
  let f = FORMATS.get(`${kind}|${tz}`);
  if (!f) {
    const o: Intl.DateTimeFormatOptions =
      kind === 'clock' ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'long' };
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, ...o });
    FORMATS.set(`${kind}|${tz}`, f);
  }
  return f;
}
export const clock = (at: number, tz: string) => format(tz, 'clock').format(at);
export const weekday = (at: number, tz: string) => format(tz, 'weekday').format(at);

/** A message's files after its words: ref, type, a memo's length, name (quoted as JSON, so a name
 * can't close the bracket and pass for the mind's own text) and words (cut to 600 characters in
 * full, 120 otherwise; `th file <ref>` prints them whole). */
function files(m: Message, full: boolean): string {
  const cut = full ? 600 : 120;
  return (m.attachments ?? [])
    .map((a) => {
      const words = a.text ? a.text.replace(/\s+/g, ' ') : '';
      const chars = [...words];
      const said = words ? `: ${chars.length > cut ? `${chars.slice(0, cut).join('')}…` : words}` : '';
      return ` [${a.ref} ${a.type}${a.seconds ? ` ${Math.round(a.seconds)} s` : ''} ${JSON.stringify(a.name)}${said}]`;
    })
    .join('');
}

/** One message: id, time, who (marked when its conversation is off the record), its words (whole,
 * or 120 characters on one line) and its files. */
export function line(m: Message, tz: string, full = true, offRecord?: string[]): string {
  const who = `${m.author === 'owner' ? 'owner' : m.author}${offRecord?.includes(m.thread_id) ? ' (off the record)' : ''}`;
  const body = full ? m.body : m.body.replace(/\s+/g, ' ').slice(0, 120);
  return `[${m.id}] ${clock(m.created_at, tz)} ${who}${m.kind === 'text' ? '' : ` (${m.kind})`}: ${body}${files(m, full)}`;
}

/** Fits `lines` under `budget` characters, keeping the newest (or oldest) and marking the cut. */
export function budgeted(
  lines: string[],
  budget: number,
  keep: 'newest' | 'oldest',
  more: (n: number) => string,
): string {
  const out: string[] = [];
  let used = 0;
  const ordered = keep === 'newest' ? [...lines].reverse() : lines;
  for (const l of ordered) {
    if (used + l.length + 1 > budget - 60) break;
    out.push(l);
    used += l.length + 1;
  }
  const cut = lines.length - out.length;
  const body = (keep === 'newest' ? out.reverse() : out).join('\n');
  return cut ? `${body}\n${more(cut)}`.trim() : body;
}

/** A list section's lines under `budget`, or nothing at all when there are none. */
export const part = (lines: string[] | undefined, budget: number, more: string): string[] =>
  lines?.length ? [budgeted(lines, budget, 'oldest', (k) => `(+${k} more: ${more})`)] : [];
