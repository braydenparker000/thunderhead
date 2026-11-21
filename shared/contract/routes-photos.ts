// Photos' routes (photos.ts, API.md §11.26), kept beside routes.ts, which spreads them into ROUTES:
// no import here, so the registry stays importable on its own. Only the owner's phone calls them;
// the callback is Google's redirect back with the consent, checked by its one-use state.
// The workshop's files (workshop.ts, API.md §11.27) and Astra's relay (astra.ts, API.md §11.21) are
// listed here too: routes.ts is at its length. So is Guitar's progress (guitar.ts, API.md §11.28).
export const PHOTO_ROUTES = {
  'GET /v1/photos/drive': { who: ['D'], phase: 'P9', note: 'connected or not, the folder by name, a revoked grant' },
  'POST /v1/photos/drive/connect': { who: ['D'], phase: 'P9', note: "Google's consent address, scope drive.file, a state good for 10 minutes" },
  'GET /v1/photos/drive/callback': { who: 'P', phase: 'P9', note: "Google's redirect: ?code=&state=; stores the grant sealed, makes the folder, back to /photos/" },
  'DELETE /v1/photos/drive': { who: ['D'], phase: 'P9', note: 'forgets the grant (the files stay in Drive)' },
  'POST /v1/photos/upload-token': { who: ['D'], phase: 'P9', note: 'a Drive access token for the phone’s own upload, and the folder id' },
  'POST /v1/photos/from-drive': { who: ['D'], phase: 'P9', note: '{ids ≤ 20}: files picked in Google’s picker, registered by reference with what Drive says of each (one Drive call a file); a known one is `already`' },
  'GET /v1/photos': { who: ['D'], phase: 'P9', note: '?before=<day>: days newest first, 4 photos and a count each; ?day=: one day; ?filter= all|favorites|stars3|stars4|stars5|raw|jpeg|edited|unedited (a stack once, as its RAW)' },
  'GET /v1/photos/looks': { who: ['D'], phase: 'P9', note: 'every look, newest first: at most 500' },
  'PUT /v1/photos/looks': { who: ['D'], phase: 'P9', note: '{items ≤ 50: id, name, source mine|xmp|recipe|camera, recipe ≤ 4 KB in its panels, panels, tag?, film?, credit?}: each added or replaced by id; past 500 refused' },
  'PATCH /v1/photos/looks/:lid': { who: ['D'], phase: 'P9', note: '{name?, recipe?, panels?}: renames, or updates it from the current edit' },
  'DELETE /v1/photos/looks/:lid': { who: ['D'], phase: 'P9' },
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
  // The workshop's files: the owner's phone only.
  'GET /v1/workshop': { who: ['D'], phase: 'P9', note: 'the files sent for the workshop, newest first, and how much room they take' },
  'PUT /v1/workshop/:id/parts/:n': { who: ['D'], phase: 'P9', note: '?bytes=<the whole file>; one piece, bytes: 8 MiB but the last; TH-File-Name, TH-Sha256 of the piece' },
  'DELETE /v1/workshop/:id': { who: ['D'], phase: 'P9', note: 'removes a file, every piece' },
  // Astra's copy of the owner's data (astra.ts, ASTRA.md §5.3): the owner's phone only (agent keys 403); sealed, never read or logged.
  'GET /v1/astra/backup': { who: ['D'], phase: 'P8', note: '?known=<version>: {version, saved_at, copy}: the copy kept for every phone, opened; all null when none; copy null when it does not open; {version, saved_at, same: true} when known is the version kept' },
  'PUT /v1/astra/backup': { who: ['D'], phase: 'P8', note: '?base=<version>; the body is the copy (≤ 1 MiB as sent, tagged sync/1, known keys only), sealed as sent in place of the copy base names; another kept now is 409 conflict' },
  'DELETE /v1/astra/backup': { who: ['D'], phase: 'P8', note: 'removes the copy and its daily copies: 204' },
  // Astra's relay: the owner's phone only (agent keys 403); addresses in transit, never kept or logged.
  'POST /v1/astra/play': { who: ['D'], phase: 'P8', note: "{link, hash?, fileIndex?, fileName?, fileSize?, mode play|ahead}: a film's direct address from TorBox with the Worker's key, else url null (the page plays the add-on's link); not cached for certain: 503; ahead never adds; add-on links are not opened unless ASTRA_FOLLOW is on" },
  'GET /v1/astra/torbox': { who: ['D'], phase: 'P8', note: 'whether the TorBox key is set and accepted, and the plan number' },
  'GET /v1/astra/torbox/servers': { who: ['D'], phase: 'P8', note: "TorBox's public speed-test files: each server group's label, region and test file (none carrying a token), for the lab; 6 a minute" },
  // Guitar's progress, one record per song (guitar.ts): the owner's phone only; the newer updated_at wins.
  'PUT /v1/guitar/progress': { who: ['D'], phase: 'P6', note: '1–50 songs, each ≤ 16,000 characters; the newer updated_at wins' },
  'GET /v1/guitar/progress': { who: ['D'], phase: 'P6', note: '?since=&cursor=: what changed since, oldest first, ≤ 100 a page' },
} as const;
