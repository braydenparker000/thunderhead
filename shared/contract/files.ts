// Chat files (HOME.md §4.6, API.md §11.7): what the owner attaches from the + sheet (photos, files,
// voice memos) and what the mind attaches with `th say --attach`. The bytes are kept in the private
// bucket behind sign-in and are only ever served by the Worker, to a signed-in caller.

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
