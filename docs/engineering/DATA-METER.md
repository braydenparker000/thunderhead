# Data meter

What Settings › Data use counts ([MENU-AND-SETTINGS.md §6.10](../product/MENU-AND-SETTINGS.md)), from
where, and what it cannot see. The numbers stay on the phone: nothing in `frontend/th/data/` fetches
or sends anything (`tests/data-meter.test.mjs` checks), and the Worker knows nothing of them. The
meter only counts; it changes nothing about what the site downloads.

## Sources, per kind

| Kind | Counted by | Size |
|---|---|---|
| Every file a page loads, and the page itself | `th/data/page.js`, in each document: home, Photos and Study through `ui/errors.js`; Music, Podcasts, Astra and Guitar through `assets/error-report.js`. `PerformanceObserver` on `resource` and `navigation` | `transferSize`; when 0 for a cross-origin answer without Timing-Allow-Origin, `encodedBodySize`; else a Content-Length the code holds (`th/api.js`); else not counted |
| An answer from a cache or a service worker | nothing on the page (`deliveryType` `cache`): the worker counts what it fetched | 0 |
| Music's songs, covers, waveforms, catalog and links | `th/music/bridge.js` in Music's worker, through `th/data/worker.js` | Content-Length (a range answer's is its range), else the span of Content-Range, plus 300 bytes of headers; a 304 is 300 bytes |
| Podcasts' directory, feeds and episodes through the Worker | `th/podcasts/bridge.js` in Podcasts' worker | the same |
| A release's files (the shell's precache), the editor's offline files, the shell worker's other fetches | `frontend/sw.js` through `th/data/worker.js` | the same; precache counts as Updates |
| Astra's films the engine reads itself | `astra/src/engine/source-stream.js`, `side-read.js` (`thData.add`), as the pieces arrive | the bytes read |
| Talking to Thunderhead | the page's timeline (the Worker sends no Timing-Allow-Origin), with `th/api.js` holding each answer's Content-Length | Content-Length plus 300 |

300 bytes is Chrome's own figure for an answer's headers in `transferSize`; a worker never sees the
real header size, so it uses the same. A worker counts when an answer's headers arrive: a song the
player lets go of early is counted for the whole range it asked. Each document counts its own
timeline; a parent leaves a same-origin frame's load to the frame, so a framed app and the same app
open on its own never count the same bytes. A document's navigation entry counts once: Chrome hands a `buffered`
observer started before the load ends that entry twice (`tally.js` `firstSight`).

**Parts.** A file on this site goes by its path (`/music/` Music, `/apps/photos/` Photos, release
files Updates, and so on); anything else by the document that loaded it. Calls to the Worker's API
from home are Talking to Thunderhead; from an app's own page, that app's.

**Network.** `navigator.connection.type` at the time of each count: `wifi` is Wi-Fi, `cellular` is
mobile data, anything else or nothing is Unknown (never inferred from speed). A count lands on the
network of the moment it is made: a page's file at its end; Astra's film piece by piece; a worker's
answer when its headers arrive.

## Not counted

What the phone sends (uploads); a film Astra hands to the browser's own `<video>` (the page is told
nothing); the live connection's frames (a WebSocket's are not visible); the files Music's, Podcasts'
and Astra's own workers fetch to keep themselves up to date; Podcasts' artwork (opaque answers); and any
answer that gives no size, which is only counted as a number of answers. The page lists these.

## Where it is kept

localStorage `th.p.data` (`th/data/store.js`): `{ v: 1, since, unsized, days: { 'YYYY-MM-DD': { part:
[wifi, mobile, unknown] } } }`, days by the owner's local midnight, 62 kept. localStorage, not
IndexedDB: a page going away must still write its last counts inside `pagehide`, which only a
synchronous store does; it is shared by home, framed apps and an app open on its own; the `th.p.`
prefix means signing out clears it. A page batches its counts and writes at most once every 5 s and
when hidden; workers never open it: they post `{type: 'th-data', items}` to one page (the one that
asked, else one that said `th-data-hello`, else any), and hold counts while no page is open (lost if
the worker stops first). Reset writes an empty tally from now.

Tests: `tests/data-meter.test.mjs` (the arithmetic, the worker's side, search, nothing sent) and
`tests/data-meter-browser.test.mjs` (home, a framed app, a song through the bridge; both looks).
