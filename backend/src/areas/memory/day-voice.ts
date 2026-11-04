// The night's one line (MEMORY.md §3.1, mind/skills/night.md): `th note --day-voice`, once a night,
// at most 200 characters in the mind's own voice about the day that closed ("what I noticed"). It
// is kept with that day's note (`day_notes.voice`, Core step 40) and indexed with its summary, so
// `th recall` finds it; the next morning's chat reads it in its briefing's section 7; the owner
// sees it only by looking: on the Memory page, under the day. Only a clean night session writes
// it, after the day note, so no outside text reaches the chat through it.
import { lintMindText } from '../../../../shared/contract/lint.ts';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import { claimedSession } from '../mind/guards';
import type { DayNoteRow } from './notes';

export const DAY_VOICE_MAX = 200;

/** What the day note's FTS entry holds: the summary, then the night's line when there is one. */
export const indexed = (r: { summary: string; voice?: string | null }) =>
  r.voice ? `${r.summary}\n${r.voice}` : r.summary;

/** PUT /v1/memory/day-notes/:day/voice: the night's line on a day whose note it wrote. */
export function putDayVoice(
  w: Writer,
  c: Caller,
  note: DayNoteRow | null,
  line: string,
): { day: string; voice: string } {
  const s = claimedSession(w.db, c.session_id, 'night');
  if (s.offRecord) throw new Fail('off_record');
  if (s.tainted)
    throw new Fail('session_tainted', { reason: 'write the line after the day note, before any outside text' });
  const voice = line.replace(/\s+/g, ' ').trim();
  if (!voice || voice.length > DAY_VOICE_MAX) throw invalid('line', `1 to ${DAY_VOICE_MAX} characters`);
  const lint = lintMindText(voice);
  if (lint) throw new Fail('validation', [{ path: 'line', issue: lint }]);
  if (!note) throw new Fail('not_found', { reason: 'no day note for that day yet: th daynote first' });
  if (note.voice !== voice) setVoice(w.db, note, voice);
  w.change('day_note', `day:${note.day}`);
  return { day: note.day, voice };
}

function setVoice(db: Db, note: DayNoteRow, voice: string): void {
  db.run(`INSERT INTO day_notes_fts (day_notes_fts, rowid, summary) VALUES ('delete', ?, ?)`, note.seq, indexed(note));
  db.run('UPDATE day_notes SET voice = ? WHERE seq = ?', voice, note.seq);
  db.run('INSERT INTO day_notes_fts (rowid, summary) VALUES (?, ?)', note.seq, indexed({ ...note, voice }));
}
