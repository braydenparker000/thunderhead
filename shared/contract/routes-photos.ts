// Photos' routes (photos.ts, API.md §11.26), kept beside routes.ts, which spreads them into ROUTES:
// no import here, so the registry stays importable on its own. Only the owner's phone calls them;
// the callback is Google's redirect back with the consent, checked by its one-use state.
export const PHOTO_ROUTES = {
  'GET /v1/photos/drive': { who: ['D'], phase: 'P9', note: 'connected or not, the folder by name, a revoked grant' },
  'POST /v1/photos/drive/connect': { who: ['D'], phase: 'P9', note: "Google's consent address, scope drive.file, a state good for 10 minutes" },
  'GET /v1/photos/drive/callback': { who: 'P', phase: 'P9', note: "Google's redirect: ?code=&state=; stores the grant sealed, makes the folder, back to /photos/" },
  'DELETE /v1/photos/drive': { who: ['D'], phase: 'P9', note: 'forgets the grant (the files stay in Drive)' },
  'POST /v1/photos/upload-token': { who: ['D'], phase: 'P9', note: 'a Drive access token for the phone’s own upload, and the folder id' },
  'POST /v1/photos/from-drive': { who: ['D'], phase: 'P9', note: '{ids ≤ 20}: files picked in Google’s picker, registered by reference with what Drive says of each (one Drive call a file); a known one is `already`' },
  'GET /v1/photos': { who: ['D'], phase: 'P9', note: '?before=<day>: days newest first, 4 photos and a count each; ?day=: one day; ?filter= all|favorites|stars3|stars4|stars5|raw|jpeg|edited|unedited (a stack once, as its RAW)' },
  'GET /v1/photos/deleted': { who: ['D'], phase: 'P9', note: 'Recently deleted, newest first: 30 days' },
  'GET /v1/photos/pending': { who: ['D'], phase: 'P9', note: 'photos whose background upload has no Drive id yet, newest first: at most 200' },
  'PUT /v1/photos/:id': { who: ['D'], phase: 'P9', note: 'registers an upload: Drive id (null: pending, a background upload), size, hash, camera, capture time, format' },
  'GET /v1/photos/:id/around': { who: ['D'], phase: 'P9', note: '?filter=: the newer and older photo beside this one in the shelf’s order, for culling' },
  'GET /v1/photos/:id': { who: ['D'], phase: 'P9', note: 'the photo and its recipe' },
  'PATCH /v1/photos/:id': { who: ['D'], phase: 'P9', note: '{rating 0–5, favorite, flag pick|reject|null (a stack’s on both its photos), drive_id: a pending photo’s, checked with Drive}' },
  'DELETE /v1/photos/:id': { who: ['D'], phase: 'P9', note: 'to Recently deleted (a stack with both its photos)' },
  'POST /v1/photos/:id/restore': { who: ['D'], phase: 'P9' },
  'PUT /v1/photos/:id/recipe': { who: ['D'], phase: 'P9', note: 'the edit as a recipe (crs names); the same hash again writes nothing; a ledger row, undo = the recipe before' },
  'POST /v1/photos/paste': { who: ['D'], phase: 'P9', note: '{ids ≤ 20, panels, recipe}: each photo’s recipe with those panels replaced, an automatic version of an edit it replaces; one ledger row, undo = every recipe before' },
  'GET /v1/photos/:id/versions': { who: ['D'], phase: 'P9', note: 'the versions, newest first: 20 automatic and 20 named at most' },
  'POST /v1/photos/:id/versions': { who: ['D'], phase: 'P9', note: '{id, kind auto|named, name?, recipe}; an automatic one equal to the newest writes nothing; the oldest automatic goes past 20' },
  'PATCH /v1/photos/:id/versions/:vid': { who: ['D'], phase: 'P9', note: '{name}: renames (an automatic one becomes named)' },
  'DELETE /v1/photos/:id/versions/:vid': { who: ['D'], phase: 'P9' },
  'PUT /v1/photos/:id/info': { who: ['D'], phase: 'P9', note: '{info, camera?, film?}: what the file says (an allowlist, ≤ 2 KB; unknown keys dropped; never GPS) for a photo registered without it; camera and film only where it has none' },
  'PUT /v1/photos/:id/preview': { who: ['D'], phase: 'P9', note: 'the JPEG preview, ≤ 400 KB' },
  'GET /v1/photos/:id/preview': { who: ['D'], phase: 'P9', note: 'the preview bytes, private; an ETag' },
} as const;
