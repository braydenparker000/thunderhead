// The list for the builder (shared/contract/issues.ts), inside a commit. An item is the owner's
// complaint, never the mind's own idea: the owner adds one in Settings, or the chat mind files one
// naming the owner-device message of the last 48 hours it came from, from its claimed session that
// read no outside text (a building session reads this list, so outside text never reaches it). The
// owner edits, marks done and reopens; the owner and the chat mind add notes. Nothing is deleted.
import {
  ISSUE_LIMITS,
  type Issue,
  type IssueNoteRequest,
  type IssueState,
  type IssuesResponse,
  type PatchIssueRequest,
  type PutIssueRequest,
} from '../../../../shared/contract/issues.ts';
import { uuidv7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import { HOUR } from '../../lib/time';
import type { Db } from '../../objects/base';
import type { Caller } from '../../objects/caller';
import type { Writer } from '../../objects/commit';
import * as convo from '../conversation/store';
import { claimedSession } from '../mind/guards';
import * as store from './store';

// C0 and C1 controls, bidirectional overrides and line separators: a title or a place is one plain
// line; what happened and a note keep their newlines only.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

/** Trimmed text within its limit, one line or with newlines. */
function words(path: string, raw: string, max: number, lines = false): string {
  const text = raw.replace(/\r\n?/g, '\n').trim();
  if (!text) throw invalid(path, 'required');
  if (text.length > max) throw invalid(path, `at most ${max.toLocaleString('en-GB')} characters`);
  if ((lines ? CONTROL_BUT_NEWLINE : CONTROL).test(text)) throw invalid(path, 'no control characters');
  return text;
}

const place = (raw: string | null | undefined) =>
  raw === undefined || raw === null || !raw.trim() ? null : words('where', raw, ISSUE_LIMITS.where);

/** The chat mind's claimed session, clean: else 403. */
function cleanChat(w: Writer, c: Caller): void {
  if (claimedSession(w.db, c.session_id, 'chat').tainted)
    throw new Fail('session_tainted', { reason: 'after outside text, nothing goes on the list for the builder' });
}

/** PUT /v1/issues/:id. The same request again answers the stored item; another body is a conflict. */
export function put(
  w: Writer,
  c: Caller,
  id: string,
  r: PutIssueRequest,
  hash: string,
  release: string | null,
): { issue: Issue; created: boolean } {
  const had = store.byId(w.db, id);
  if (had) {
    if (had.req_sha256 !== hash) throw new Fail('conflict');
    return { issue: store.shown(w.db, had), created: false };
  }
  const mind = c.who === 'C';
  if (!mind && c.who !== 'D') throw new Fail('forbidden');
  if (!mind && r.from_message_id !== undefined) throw invalid('from_message_id', 'only the mind names one');
  if (mind && r.from_message_id === undefined) throw invalid('from_message_id', "the owner's message it came from");
  const title = words('title', r.title, ISSUE_LIMITS.title);
  const what = words('what', r.what, ISSUE_LIMITS.what, true);
  const where = place(r.where);
  if (mind) {
    const m = convo.messageOrigin(w.db, r.from_message_id as string);
    if (m?.author !== 'owner' || m.origin !== 'owner_device')
      throw invalid('from_message_id', "not one of the owner's messages");
    if (m.created_at < w.at - ISSUE_LIMITS.from_hours * HOUR)
      throw invalid('from_message_id', `older than ${ISSUE_LIMITS.from_hours} hours`);
    cleanChat(w, c);
  }
  store.insert(w.db, {
    id,
    at: w.at,
    title,
    what,
    place: where,
    kind: r.kind ?? 'annoying',
    origin: mind ? 'mind' : 'owner_device',
    from_message_id: r.from_message_id ?? null,
    release,
    seen: store.seenFor(w.db, where, w.at),
    state: 'open',
    done_at: null,
    updated_at: w.at,
    req_sha256: hash,
  });
  return { issue: store.shown(w.db, store.byId(w.db, id) as store.IssueRow), created: true };
}

/** PATCH /v1/issues/:id: the owner's edit, marking done or reopening. */
export function patch(w: Writer, c: Caller, id: string, r: PatchIssueRequest): Issue {
  if (c.who !== 'D') throw new Fail('forbidden');
  const had = store.byId(w.db, id);
  if (!had) throw new Fail('not_found');
  const state = r.state ?? had.state;
  const next: store.IssueRow = {
    ...had,
    title: r.title === undefined ? had.title : words('title', r.title, ISSUE_LIMITS.title),
    what: r.what === undefined ? had.what : words('what', r.what, ISSUE_LIMITS.what, true),
    place: r.where === undefined ? had.place : place(r.where),
    kind: r.kind ?? had.kind,
    state,
    done_at: state === had.state ? had.done_at : state === 'done' ? w.at : null,
    updated_at: w.at,
  };
  store.update(w.db, next);
  return store.shown(w.db, next);
}

/** POST /v1/issues/:id/notes: a note added, by the owner or the chat mind (from a clean session). */
export function note(w: Writer, c: Caller, id: string, r: IssueNoteRequest): Issue {
  if (c.who !== 'D' && c.who !== 'C') throw new Fail('forbidden');
  const had = store.byId(w.db, id);
  if (!had) throw new Fail('not_found');
  const text = words('text', r.text, ISSUE_LIMITS.note, true);
  if (c.who === 'C') cleanChat(w, c);
  if (store.noteCount(w.db, id) >= ISSUE_LIMITS.notes)
    throw invalid('text', `at most ${ISSUE_LIMITS.notes} notes on one item`);
  store.addNote(w.db, id, { id: uuidv7(w.at), at: w.at, by: c.who === 'D' ? 'owner' : 'mind', text });
  return store.shown(w.db, had);
}

/** GET /v1/issues: one state's items (or all), newest first. */
export function list(db: Db, state: IssueState | null): IssuesResponse {
  const rows = store.list(db, state, ISSUE_LIMITS.list + 1);
  return {
    items: rows.slice(0, ISSUE_LIMITS.list).map((r) => store.shown(db, r)),
    more: rows.length > ISSUE_LIMITS.list,
  };
}

export function one(db: Db, id: string): Issue {
  const r = store.byId(db, id);
  if (!r) throw new Fail('not_found');
  return store.shown(db, r);
}
