// Chat files (HOME.md §4.6, API.md §11.7): what the owner attaches from the + sheet (photos, files,
// voice memos) and what the mind attaches with `th say --attach`. The bytes are kept in the private
// bucket behind sign-in and are only ever served by the Worker, to a signed-in caller.
import type { Attachment } from './conversation.ts';

export const FILE_LIMITS = {
  /** One file, in bytes, after the phone's resize. */
  bytes: 25 * 1024 * 1024,
  /** Attachments on one owner message (the phone's pickers stop here). */
  owner_per_message: 4,
  /** Attachments on one mind message. */
  mind_per_message: 10,
  /** A file name, in characters. */
  name: 120,
  /** A voice memo, in seconds. */
  memo_seconds: 600,
} as const;

/** Dictation (HOME.md §6.4, `POST /v1/dictate`): the owner holds the mic and a few seconds of
 * voice at a time go to the Worker's Whisper for the words, which are answered and never kept. */
export const DICTATE_LIMITS = {
  /** One piece, in bytes: 15 s of the phone's 32 kbit/s Opus is about 60 KB. */
  bytes: 1024 * 1024,
  /** A piece, in seconds: the phone starts the next piece here, so each one is sent whole. */
  piece_seconds: 15,
  /** One take, in seconds: the phone stops listening here. */
  take_seconds: 120,
} as const;

/** `POST /v1/dictate` answers the words heard, `''` when there were none. */
export interface DictateResponse {
  text: string;
}

/** Who uploaded a file: a device is the owner, `mind:chat` the mind. A message takes only files
 * its own kind of author uploaded. */
export type FileUploader = 'owner' | 'mind';

/** `PUT /v1/files/:id` answers the file as a message carries it (201 new, 200 the same bytes
 * again), and so does `GET /v1/files/:id?meta=1`. */
export type FileResponse = Attachment;
