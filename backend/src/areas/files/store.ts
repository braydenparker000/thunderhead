// SQL for chat files inside Core (DATA.md §4.2): one row per file, read by its id. A message takes
// files by setting their `message_id` in its own commit; nothing else ever changes a row.
import type { Attachment } from '../../../../shared/contract/api';
import type { FileUploader } from '../../../../shared/contract/files.ts';
import type { Db } from '../../objects/base';

export interface FileRow {
  id: string;
  /** The bucket key (`chat/files/<YYYY>/<MM>/<id>.<ext>`): the Worker's alone, never sent. */
  key: string;
  name: string;
  type: string;
  bytes: number;
  sha256: string;
  seconds: number | null;
  text: string | null;
  uploaded_by: FileUploader;
  created_at: number;
  message_id: string | null;
}

const COLS = 'id, key, name, type, bytes, sha256, seconds, text, uploaded_by, created_at, message_id';

/** The file as a message carries it: no key, no hash, no owner bookkeeping. */
export function toAttachment(f: FileRow): Attachment {
  return {
    ref: `file:${f.id}`,
    name: f.name,
    type: f.type,
    bytes: f.bytes,
    ...(f.seconds !== null ? { seconds: f.seconds } : {}),
    ...(f.text ? { text: f.text } : {}),
  };
}

export function byId(db: Db, id: string): FileRow | null {
  return db.one<FileRow>(`SELECT ${COLS} FROM files WHERE id = ?`, id);
}

/** The rows of these ids, missing ids left out. One lookup each: an `IN (…)` list is billed two
 * rows read per id in workerd, a lookup one. */
export function byIds(db: Db, ids: string[]): FileRow[] {
  return ids.map((id) => byId(db, id)).filter((f): f is FileRow => f !== null);
}

export function insert(db: Db, f: FileRow): void {
  db.run(
    `INSERT INTO files (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    f.id,
    f.key,
    f.name,
    f.type,
    f.bytes,
    f.sha256,
    f.seconds,
    f.text,
    f.uploaded_by,
    f.created_at,
    f.message_id,
  );
}

/** Gives these files to a message: only files no message has taken yet (one row read and one
 * written each). Returns rows written. */
export function attach(db: Db, ids: string[], messageId: string): number {
  let written = 0;
  for (const id of ids)
    written += db.run('UPDATE files SET message_id = ? WHERE id = ? AND message_id IS NULL', messageId, id);
  return written;
}
