// Chat files' rules inside Core (API.md §11.7): a file's record, kept once under its client id, and
// the check that a message's attachments are files its own kind of author uploaded, not yet on
// another message, which hands them to that message in the message's own commit.
import type { Attachment, Issue } from '../../../../shared/contract/api';
import { FILE_LIMITS, type FileUploader } from '../../../../shared/contract/files.ts';
import { UUIDV7 } from '../../lib/ids';
import { Fail, invalid } from '../../lib/result';
import type { Db } from '../../objects/base';
import type { Writer } from '../../objects/commit';
import * as store from './store';

/** What the route knows once the bytes are in the bucket. */
export type NewFile = Omit<store.FileRow, 'uploaded_by' | 'created_at' | 'message_id'>;

/** Records an uploaded file: the same id with the same bytes is the same file (a retry), with
 * other bytes a conflict. */
export function put(w: Writer, by: FileUploader, f: NewFile): { file: Attachment; created: boolean } {
  const had = store.byId(w.db, f.id);
  if (had) {
    if (had.sha256 !== f.sha256) throw new Fail('conflict');
    return { file: store.toAttachment(had), created: false };
  }
  const row: store.FileRow = { ...f, uploaded_by: by, created_at: w.at, message_id: null };
  store.insert(w.db, row);
  return { file: store.toAttachment(row), created: true };
}

const issue = (i: number, text: string): Issue => ({ path: `attachments.${i}`, issue: text });

/** A message's `attachments` (refs, in its order) as the message stores them; each file is given
 * to `messageId`. Refused: more than the author's limit, a ref that is not `file:<id>`, one listed
 * twice, a file nobody uploaded or that the other kind of author uploaded (422), and a file already
 * on another message (409). */
export function attach(db: Db, refs: string[], by: FileUploader, messageId: string): Attachment[] {
  const max = by === 'owner' ? FILE_LIMITS.owner_per_message : FILE_LIMITS.mind_per_message;
  if (refs.length > max)
    throw invalid('attachments', `at most ${max} on ${by === 'owner' ? 'an owner' : 'a mind'} message`);
  const ids = refs.map((r) => (r.startsWith('file:') && UUIDV7.test(r.slice(5)) ? r.slice(5) : ''));
  const shape = ids.flatMap((id, i) =>
    !id ? [issue(i, 'a file:<id> ref')] : ids.indexOf(id) !== i ? [issue(i, 'listed twice')] : [],
  );
  if (shape.length) throw new Fail('validation', shape);
  const rows = new Map(store.byIds(db, ids).map((f) => [f.id, f]));
  const wrong = ids.flatMap((id, i) => {
    const f = rows.get(id);
    if (!f) return [issue(i, 'no such file')];
    return f.uploaded_by !== by ? [issue(i, `uploaded by the ${f.uploaded_by}, not this message's author`)] : [];
  });
  if (wrong.length) throw new Fail('validation', wrong);
  const taken = ids.flatMap((id, i) => {
    const on = rows.get(id)?.message_id;
    return on && on !== messageId ? [issue(i, 'already on another message')] : [];
  });
  if (taken.length) throw new Fail('conflict', taken);
  store.attach(db, ids, messageId);
  return ids.map((id) => store.toAttachment(rows.get(id) as store.FileRow));
}
