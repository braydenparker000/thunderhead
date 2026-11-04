// The ref grammar of DATA.md §2.3, as types only:
//   ref = kind ":" id [ "#" fragment ];  kind = [a-z][a-z0-9]{1,15};  id = [A-Za-z0-9._:/-]{1,160}
// A new kind is added here together with the app doc that defines it.

export type RefKind =
  | 'msg'
  | 'thread'
  | 'day'
  | 'fact'
  | 'open'
  | 'ledger'
  | 'proposal'
  | 'verb'
  | 'event'
  | 'file'
  | 'import'
  | 'app'
  | 'setting'
  | 'music'
  | 'tab'
  | 'book'
  | 'verse'
  | 'podcast'
  | 'astra'
  | 'media'
  // A photo on the shelf (PHOTOS.md): its Worker id.
  | 'photo'
  // A count the Worker can make again: a routine of the senses (senses.ts routineRef), cited by a habit.
  | 'rollup';

export type Ref = `${RefKind}:${string}`;
