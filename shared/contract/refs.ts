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
  | 'board';

export type Ref = `${RefKind}:${string}`;
