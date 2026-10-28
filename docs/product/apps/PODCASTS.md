# Podcasts

> **Owner ruling 2026-10-28:** this app is first ported over **as it is**, with no changes. This spec describes where it goes *after* that port; nothing here is built until the owner agrees to it.

Follow shows, hear new episodes on the shared audio engine, keep episodes on the phone for offline
listening, and let the Briefing say what's new. This doc is the source of truth for Podcasts:
subscriptions, discovery, feed checking, playback, downloads, the mind's part, and tests.

Status: spec for phase P8 (see [ARCHITECTURE](../../engineering/ARCHITECTURE.md)). Fixed decisions
come from [decisions.md](../../process/decisions.md); anything marked **[proposal]** waits for the
owner's yes.

## Rules at a glance

First the old app comes over **as it is** (owner ruling 2026-10-28; see "First move" below). These
rules describe the later steps.

1. **One engine.** Podcasts play on the same engine as Music ([MUSIC](MUSIC.md) §5), with the same
   Media Session, background playback and audio focus. A podcast and music never sound together.
2. **The Worker checks feeds; the phone parses them.** A cron-dispatched check in the Worker does
   cheap conditional GETs to spot new episodes. Full feeds are passed through the Worker untouched
   and parsed on the phone. This keeps the Worker inside the free plan's 10 ms CPU and 50
   subrequests per invocation.
3. **Polite feed fetching.** Conditional GET (ETag / Last-Modified), honour `Cache-Control` and
   `Retry-After`, never more often than hourly per feed, back off on errors, one honest
   User-Agent.
4. **Downloads live in OPFS** with their own budget (1 GB default **[proposal]**), separate from
   music. Played downloads are cleaned up.
5. **Progress is never lost.** Saved on the phone every 5 s while playing, synced to the server on
   pause, on hide and at most once a minute.
6. **The Briefing gets a tile, never a push.** New episodes are never push-worthy.
7. **Every network address is validated.** Only public `http(s)` hosts; no private ranges, no
   credentials in URLs, bounded redirects and sizes (SSRF guard, harvested).

## First move: the as-is port (owner ruling)

1. Copy the old Podcasts app into the new site at `/podcasts/` **unchanged**: its screens, player,
   search, downloads and wording.
2. Adjust only what it strictly needs to run on the new site:
   - every asset and link path made root-absolute (the host serves `/podcasts` without a redirect);
   - the API address pointed at `thunderhead-api`, which answers the routes the app calls today
     (search, browse, feed and audio passthrough; [MIGRATION](../../engineering/MIGRATION.md) §2);
   - its requests signed in with the new session token (sign-in is rebuilt);
   - the site's `<meta>` security policy first in `<head>` (the host sends no headers), allowing what
     the unchanged page loads.
3. The owner's follows, queue, progress and settings are restored unchanged on the new origin
   **[proposal: through the export page, §10]**.
4. Done when the owner listens on the phone and nothing has changed.

Everything after this section describes later steps. Each is proposed after the port and built only
if the owner agrees.

## Contents

1. Data · 2. Screens · 3. Subscriptions and discovery · 4. Feed checking (who fetches, limits) ·
5. Playback · 6. Chapters and transcripts · 7. Downloads · 8. Senses, verbs, surfaces ·
9. The Briefing tile · 10. Import from the old site · 11. Accessibility · 12. Empty and error
states · 13. New feature ideas · 14. Open questions / tests

---

## 1. Data

| Data | Home | On the phone |
|---|---|---|
| Subscriptions `{show_id, feed_url, title, author, artwork_url, added_at, settings}` | `Core` lists (`podcasts.subscriptions`), max 200 | IndexedDB `th-podcasts/subs` |
| Feed state `{show_id, etag, last_modified, next_check_at, interval_s, fail_count, known_guids[≤ 50], latest_at}` | `Core` table (Worker only) | — |
| New-episode records `{show_id, episode_id, title, published_at, duration_s, enclosure_url, bytes}` | `Core` list `podcasts.new` (last 30 days) | IndexedDB `th-podcasts/new` |
| Parsed feeds (episodes) | — | IndexedDB `th-podcasts/feeds` (per show, newest 300 episodes) |
| Up next (queue) | `Core` lists (`podcasts.queue`), max 100 | IndexedDB `th-podcasts/queue` |
| Progress `{position_s, duration_s, played, updated_at}` per episode | `Core` (`podcasts.progress`), newest 1,000 | IndexedDB `th-podcasts/progress` |
| Downloads | — | OPFS `podcasts/<show_id>/<episode_id>.<ext>`; index in IndexedDB |
| Prefs (speed per show, skip lengths, autoplay, region) | `Core` settings | IndexedDB `th-podcasts/prefs` |

**Ids (harvested so imported data lines up):** `show_id` = the old Worker's `episodeID()` hash
(FNV-1a + djb2, 16 hex characters) of the feed URL; `episode_id` = the same hash of the item's
`<guid>` (or its enclosure URL when there is no guid).

**Refs [proposal]:** `podcast:<show_id>` for a show and `podcast:<show_id>/<episode_id>` for an
episode (to be added to [GLOSSARY](../GLOSSARY.md)).

---

## 2. Screens

```
Podcasts (route /podcasts/)
├── Listen      new from your shows (newest first), Up next, Continue listening
├── Shows       your subscriptions (grid), sorted by latest episode
├── Discover    search the directory; add by feed address
├── Downloads   what's on this phone, space used
├── Show        artwork, about, settings, episodes                     (/podcasts/show/<show_id>)
├── Episode     notes, chapters, transcript, actions          (/podcasts/episode/<show_id>/<episode_id>)
└── Now Playing full screen                                             (/podcasts/now)
```

Look (later redesign, only if the owner agrees; the ported app keeps its own look):
[DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md); Podcasts' accent is `#e0457b`. The mini player
is the same component as Music's ([MUSIC](MUSIC.md) §2.3) and shows on Podcasts and Music screens.
The mind's lines are Fraunces italic; everything else Inter.

### 2.1 Listen (default tab)

1. **Continue** — at most 3 episodes started and not finished, most recent first, each with a
   progress bar and "18 min left".
2. **Up next** — the queue (first 5; "See all" opens the full queue).
3. **New** — episodes from subscriptions published in the last 14 days and not played, newest
   first, grouped by day ("Today", "Yesterday", "Monday 26").

Episode row: 56 px artwork, title (Inter 500 16/22, 2 lines max), meta (show · date · duration or
"12 min left"), and on the right a play button (44 px) with a ring showing progress. A downloaded
episode shows a small check glyph in the meta line. Long-press: Play next · Add to Up next ·
Download / Remove download · Mark played / unplayed · Go to show · Ask about this.

### 2.2 Now Playing

Same skeleton as Music's Now Playing with podcast controls:

| Element | Spec |
|---|---|
| Artwork | Episode art, else show art; square, radius 28 |
| Title / show | Inter 600 20/26 (3 lines max) / Inter 400 15/20 ink-2 |
| Chapter | Current chapter title under the show name when chapters exist; tap → chapter sheet |
| Seek bar | Plain line (no waveform), chapter ticks on it; elapsed and remaining in tabular figures |
| Transport | Back 15 s · Play/Pause (72 px) · Forward 30 s |
| Second row | Speed ("1.2×") · Sleep timer · Up next · ··· |

The ··· menu: Episode notes · Chapters · Transcript · Download / Remove download · Mark played ·
Share link (the episode's web page or enclosure, through the system share sheet) · Ask about this.

---

## 3. Subscriptions and discovery

### 3.1 Directory search

1. A search field on Discover. Minimum 2 characters, maximum 120; runs 400 ms after typing stops.
2. **First:** the phone calls Apple's public iTunes Search API directly (`media=podcast`,
   `entity=podcast`, `limit=36`, region from settings), with `credentials: 'omit'`,
   `referrerPolicy: 'no-referrer'`, a 7 s timeout and a 1 MB response cap (harvested). Results are
   validated and normalised (title, author, feed URL, artwork URL, genres); entries without a
   valid public feed URL are dropped.
3. **Fallback:** if Apple fails or returns nothing, `GET /v1/podcasts/directory?q=&region=` on the
   Worker, which tries Apple's second endpoint and then gpodder.net search (each with a 5.5 s
   budget). The Worker caches answers for 30 minutes.
4. **[proposal]** Podcast Index API as a further source (free; key and secret held as Worker
   secrets), only if the owner wants broader results.
5. Apple's API is unofficial in its limits (roughly 20 calls a minute per address); one search per
   400 ms pause stays far below that.

Region: a two-letter code; default from the device locale; changeable in Podcasts settings.
Categories on Discover (harvested): All shows · History · Science · Technology · Culture · Stories ·
Faith · Music, each a fixed directory query.

### 3.2 Add by address

"Add by feed address" on Discover accepts an `http(s)` RSS URL. The Worker validates it (public
host, no credentials, no port, ≤ 2,000 characters, not an IP literal or a local/test domain), fetches
it once, and the phone parses it. If it isn't an RSS feed with `<channel>`: "That address isn't a
podcast feed."

### 3.3 Subscribe / unsubscribe

- **Follow** on a show page subscribes: the record goes to `Core`, the feed state is created with
  `next_check_at = now + interval`, and a `podcasts.subscribe` sense is sent.
- **Unfollow**: asks nothing; an undo toast for 10 s. Downloads of that show stay until removed or
  until the cleanup rule (§7.3) deletes them.
- Per-show settings: Playback speed (inherit or a value) · Skip intro (0–120 s, default 0) ·
  Auto-download (Off · Latest 1 · Latest 3; default Off) · Add new episodes to Up next (default
  off) · Notifications: never (podcasts don't push).

**Acceptance:** Playwright with a fixture directory: search "history" → results render; Follow →
the show appears in Shows; Unfollow → gone, Undo → back with its settings.

---

## 4. Feed checking (who fetches, limits)

### 4.1 Who does what

| Job | Who | Why |
|---|---|---|
| Spot new episodes in the background | Worker, from the one cron dispatcher | Runs while the phone sleeps; feeds aren't CORS-readable from the phone |
| Fetch a full feed for a show page | Worker passthrough (`GET /v1/podcasts/feed?url=`), parsed on the phone | Full XML parsing in the Worker could exceed 10 ms CPU on large feeds |
| Fetch chapters / transcripts | Worker passthrough (≤ 256 KB / ≤ 2 MB) | CORS |
| Directory search | Phone first, Worker fallback | Saves Worker requests |

### 4.2 The background check

Runs inside the Worker's single cron dispatcher (every 15 minutes; the free plan allows 5 cron
triggers per account and the design uses one).

1. Select feeds with `next_check_at ≤ now`, oldest first, **at most 20 per tick** (each check may
   follow up to 2 redirects, staying under 50 subrequests).
2. Request with `If-None-Match` / `If-Modified-Since`, `Accept-Encoding: gzip`,
   `User-Agent: Thunderhead-Podcasts/1.0 (personal app; 1 listener)`, a 10 s timeout.
3. **304** → set `next_check_at = now + interval`. Nothing else.
4. **200** → read at most the first **128 KB** of the body, cut at the last complete `</item>`,
   and pull from the first 10 items only: `guid`, `title`, `pubDate`, `enclosure url/length/type`,
   `itunes:duration`. Bounded, CDATA-aware pattern matching (harvested from the old parser); DTDs
   and entities are refused. Items whose `episode_id` is not in `known_guids` and whose
   `pubDate` is newer than `latest_at − 1 day` become new-episode records.
5. Store the new ETag / Last-Modified, update `known_guids` (keep 50) and `latest_at`.
6. **301/308** → update the stored feed URL (and the subscription) after 2 consecutive permanent
   redirects. **302/307** → follow, don't store.
7. **404/410** → `fail_count += 1`; after 5 failures across ≥ 3 days, mark the show "Feed gone"
   and stop checking (the owner sees it on the show page).
8. **429/5xx/timeouts** → honour `Retry-After` if present, else double the interval (up to 24 h).
9. Every check writes one row (the feed state). 200 feeds × 8 checks a day = 1,600 rows, well
   inside the 100k daily write limit.

### 4.3 Interval

- Default 3 h. **Adaptive [proposal]:** interval = median gap between the last 10 episodes ÷ 8,
  clamped to 1 h … 24 h. A daily show is checked every 3 h; a monthly one every 24 h.
- Never before the feed's `Cache-Control: max-age`, and never more often than hourly.
- Opening a show page triggers a passthrough fetch only if the phone's copy is older than 15
  minutes; pull-to-refresh on Listen forces a check of all shows via
  `POST /v1/podcasts/check` (rate-limited to once per 5 minutes; the Worker runs it in chunks of
  20).

### 4.4 Passthrough rules (`/v1/podcasts/feed`, `/v1/podcasts/audio`, `/v1/podcasts/file`)

- Signed-in only. URL validation as §3.2 on every hop; at most 16 redirects (measurement services
  chain several); a loop is an error.
- Feed bodies capped at 4 MB, cut at the last complete `</item>` (harvested). Chapters ≤ 256 KB,
  transcripts ≤ 2 MB.
- `audio` resolves the enclosure **from the feed** (`?feed=&id=`), never from a caller-supplied
  audio URL, then streams the bytes with `Range` support and exposes `Content-Length`,
  `Content-Range`, `Accept-Ranges` to the site origin. Resolved CDN addresses are remembered for 10
  minutes; a 401/403/404/410 on a remembered address re-resolves from the publisher's URL once.
- Content types allowed for audio: `audio/*`, `application/octet-stream`, `application/ogg`,
  `video/mp4` (audio-only MP4).

**Acceptance (Vitest on workerd):** fixture upstreams return 304, 200 with a new item, 301×2, 410×5
and 429 with `Retry-After: 7200`; the stored state after each matches a table. A redirect to
`http://127.0.0.1/` or `http://10.0.0.1/` is refused. CPU per tick with 20 changed 128 KB fixtures
stays under 10 ms (measured in the test).

---

## 5. Playback

### 5.1 On the shared engine

- `audio.load('podcast', upNext, i, {positionMs})`. Starting a podcast pauses Music and vice versa.
- **Streaming from the publisher:** episode audio is cross-origin without CORS, so streaming decks
  run in **direct mode** — the element plays straight to the output, not through the Web Audio
  graph (a non-CORS source would come out silent there). Speed, seeking, Media Session and
  background playback all work in direct mode; EQ and loudness don't apply.
- **Downloaded episodes** play from OPFS blob URLs, which are same-origin, so they can use the
  graph (§5.4).
- No gapless or crossfade for podcasts: an episode ends, 1 s of silence, the next one in Up next
  starts if Autoplay is on (default on, harvested).

### 5.2 Controls

| Control | Values | Default |
|---|---|---|
| Speed | 0.8–3.0× in 0.1 steps; presets 1.0 · 1.2 · 1.5 · 1.8 · 2.0 | 1.0×; per-show override |
| Pitch | Preserved at every speed (`preservesPitch = true`) | — |
| Skip back / forward | Back 5 · 10 · 15 · 30 s; forward 10 · 15 · 30 · 45 · 60 s | 15 s / 30 s |
| Resume | After a pause longer than 5 minutes, resume 3 s earlier **[proposal]** | on |
| Skip intro | Per show, 0–120 s, applied when an episode starts at 0 | 0 |
| Sleep timer | 5 · 10 · 15 · 30 · 45 · 60 min · End of episode; the last 10 s fade out | — |
| Autoplay Up next | on/off | on |

### 5.3 Media Session

- Metadata: episode title, show as artist, show title as album, artwork (episode or show image,
  via its URL).
- Handlers: `play`, `pause`, `seekbackward` (skip-back length, honouring `seekOffset`),
  `seekforward` (skip-forward length), `seekto`, `previoustrack` (restart the episode if > 3 s in,
  else the previous chapter if any **[proposal]**), `nexttrack` (next in Up next), `stop`.
- `setPositionState` with the playback rate, updated on rate change.
- **Chapters:** when `MediaMetadata` supports `chapterInfo` (experimental; feature-detected), pass
  `[{title, startTime, artwork}]`; otherwise nothing.

### 5.4 Played, progress and sync

1. Position saved to IndexedDB every 5 s while playing, and on pause, seek and hide.
2. Synced to `Core` (`PUT /v1/podcasts/progress` with a batch) on pause, on `visibilitychange →
   hidden` (with `keepalive`), and at most once every 60 s while playing.
3. **Played** when the position is within the last 30 s or past 95 % (whichever is earlier), or
   when the episode ends. A played episode restarts from 0 if played again.
4. Conflict between devices: the newest `updated_at` wins.
5. **[proposal]** "Voice boost" for downloaded episodes only: a gentle compressor and a +3 dB
   presence lift in the engine's worklet. Off by default.

**Acceptance:** browser test with a fixture MP3: play, skip forward twice, pause → position =
60 s ± 0.5; reload → resumes at 60 s; play to 96 % → marked played; at 1.5× the Media Session
position state reports `playbackRate: 1.5`.

---

## 6. Chapters and transcripts

| Source | Read from | Notes |
|---|---|---|
| `<podcast:chapters url type="application/json+chapters">` | Passthrough fetch on episode open | JSON `{version, chapters: [{startTime, title, img?, url?, toc?}]}`; `toc: false` chapters are hidden from the list but kept for artwork |
| Podlove Simple Chapters `<psc:chapters>` inline | The parsed feed | `start` as `HH:MM:SS(.mmm)` |
| ID3 `CHAP`/`CTOC` frames in a downloaded MP3 **[proposal]** | The OPFS file | Read only the tag header bytes |
| `<podcast:transcript>` (VTT, SRT, JSON) | Passthrough fetch when the owner opens Transcript | HTML transcripts are shown as a link only |

- Chapters sheet: list with start times; the current one highlighted; tap = seek. Chapter images
  replace the artwork on Now Playing while that chapter plays.
- Transcript: scrolling text with the current cue highlighted; tap a cue = seek; in-transcript
  search.
- Chapters sorted by `startTime`; a chapter list with any `startTime` past the duration is
  truncated there.

**Acceptance:** unit tests parse a JSON chapters fixture, a PSC fixture and a VTT fixture to the
expected arrays; an out-of-order chapters file is sorted.

---

## 7. Downloads

### 7.1 How

1. "Download" on an episode → `GET /v1/podcasts/audio?feed=&id=` streamed into OPFS with
   `createWritable()`; progress shown on the row ("42 % · 31.0 MB of 74.2 MB").
2. Interrupted downloads resume with a `Range` request from the bytes already written (only if the
   server returned `Accept-Ranges: bytes` and the same `ETag`/length); else restart.
3. Maximum 500 MB per episode; 2 downloads at a time; others queue.
4. **[proposal]** Use Background Fetch (feature-detected; Chrome on Android supports it) for
   episodes over 20 MB, so a download survives leaving the app; the service worker moves the
   finished file into OPFS. Without it: "Keep Podcasts open until downloads finish."
5. Auto-download (per show): when the app opens or the background check reports new episodes
   **and** the phone is on Wi-Fi (`navigator.connection.type`, else unknown = don't) and Data saver
   is off.
6. A download counts only when its size matches `Content-Length` (or the server's final size).

### 7.2 Budget

- **1 GB by default [proposal]**; choices 256 MB · 512 MB · 1 GB · 2 GB · 4 GB, never above 90 % of
  the quota. Separate from Music's offline budget.
- `navigator.storage.persist()` is requested after the first download.
- Downloads screen: "12 episodes · 640 MB on this phone", the list, and **Remove played
  downloads**.

### 7.3 Cleanup

- A played download is deleted 24 h after it was marked played **[proposal]**.
- When the budget is full: delete played downloads first, then the oldest unplayed auto-downloads.
  Manual downloads are never deleted automatically; if they alone fill the budget, new downloads
  wait with "Podcast space is full."
- Deleting a download never deletes progress.

**Acceptance:** Playwright: download a 3 MB fixture, go offline, play it, seek to 2:00; mark played,
advance the fake clock 24 h → the file is gone and progress remains.

---

## 8. Senses, verbs, surfaces

### 8.1 Senses

| Type | When | `ref` | `data` |
|---|---|---|---|
| `podcasts.play` | An episode starts sounding | `podcast:<s>/<e>` | `{position_s, source: 'listen'|'show'|'queue'|'briefing'|'verb', offline}` |
| `podcasts.listen` | On pause, end, episode change or hide: what was heard since the last report | `podcast:<s>/<e>` | `{from_s, to_s, rate, skips_back, skips_forward}` |
| `podcasts.finish` | Marked played | `podcast:<s>/<e>` | `{listened_s, duration_s}` |
| `podcasts.abandon` | Another episode started with this one < 50 % heard and not resumed within 7 days **[proposal]**; emitted by the nightly rollup, not the phone | `podcast:<s>/<e>` | `{heard_pct}` |
| `podcasts.subscribe` / `podcasts.unsubscribe` | Follow / unfollow | `podcast:<s>` | `{feed_url}` |
| `podcasts.search` | A directory search is committed | `null` | `{q, results}` |
| `podcasts.download` | Download done or removed | `podcast:<s>/<e>` | `{op, bytes, auto}` |
| `podcasts.speed` | Speed changed | `podcast:<s>` | `{rate}` |
| `podcasts.new` | The Worker found a new episode (server-origin sense) | `podcast:<s>/<e>` | `{published_at}` |

All sensitivity 0. Senses go through the outbox ([DATA](../../engineering/DATA.md)).

### 8.2 Verbs (`frontend/apps/podcasts/verbs.js`)

| Verb | Args | Does | Undo |
|---|---|---|---|
| `podcasts.queue` | `{refs, at: 'next'|'end'}` | Adds to Up next | Remove those entries |
| `podcasts.download` | `{refs}` | Downloads on Wi-Fi only | Delete the downloads |
| `podcasts.mark_played` | `{refs, played}` | Marks | Restore previous progress |
| `podcasts.subscribe` | `{feed_url}` | Follows (the Worker validates the URL) | `podcasts.unsubscribe` |
| `podcasts.play` | `{ref}` | Plays under the same owner-gesture rule as Music ([MUSIC](MUSIC.md) §10.3) | Restore the previous program and position |

Unsubscribing is a verb only as an undo; the mind does not unfollow shows by itself.

### 8.3 Surfaces

| Slot | Content |
|---|---|
| `podcasts.note` | One Fraunces line at the top of Listen ("Two of your shows covered the same story; the shorter one is first in Up next.") — ≤ 120 characters, expires in 24 h |
| `podcasts.why` | A why chip on an episode the mind queued or picked for the Briefing |
| `podcasts.suggest` | Up to 3 faded rows after Up next ("Suggested"), only from subscribed shows or episodes the owner asked about |
| `briefing.podcasts` | The tile in §9 |

---

## 9. The Briefing tile

The [Briefing](../BRIEFING.md) (swipe right from home) has a "new media" area. Podcasts supplies
one tile through the `briefing.podcasts` surface; the Briefing owns layout and placement.

| Rule | Value |
|---|---|
| Shown when | ≥ 1 unplayed episode from a subscription published in the last 48 h |
| Rows | Up to 3: 40 px artwork · episode title (1 line) · "Show · 42 min" plus a check glyph if downloaded |
| Order | Shows the owner finishes most often first (30-day completion rate), then newest |
| Footer | "7 new" link when there are more than 3 → opens Listen |
| Tap a row | Opens Podcasts Now Playing and plays it (the tap is the owner's gesture) |
| Long-press a row | Add to Up next · Download · Mark played |
| Why | If the mind picked the order, a why chip on the first row ("You finish this show every week") |
| Offline | Shows cached rows; rows not downloaded are dimmed with "Needs internet" |
| Built by | The phone, from `podcasts.new` plus local progress, so it is current without the mind; the mind may reorder and add a why |

**Acceptance:** with 5 fixture new episodes from 3 shows, the tile shows 3 rows in the specified
order and "5 new"; tapping row 1 starts playback within 1.5 s on the fixture server.

---

## 10. Import from the old site

From localStorage `jarvis.podcasts.v1` via the old site's `/export/`
([MIGRATION](../../engineering/MIGRATION.md)).

| Old field | New | Rule |
|---|---|---|
| `follows` (≤ 100 shows with feed URLs) | Subscriptions | Same `show_id` (same hash) |
| `queue` (≤ 100 episodes) | Up next | Order kept |
| `progress` (≤ 300 entries keyed `feedUrl#id`) | Progress | `played`, `position`, `duration`, `updatedAt` kept; newer wins on conflict |
| `speed` | Default speed | — |
| `autoplay` | Autoplay | — |
| `country` | Region | — |
| `recentSearches`, `downloads`, `current` | Not imported | Downloads are re-downloaded on demand; the old audio cache (`jarvis-podcast-audio-v1`) is not moved |
| IndexedDB `jarvis-podcasts.feeds` | Not imported | Feeds are refetched |

**Acceptance:** import counts (shows, queue entries, progress entries) equal the export's; 5
random progress entries match.

---

## 11. Accessibility

1. Episode rows are single focusable items with actions in a menu; the play button has a name
   ("Play *title*, 18 minutes left").
2. Seek slider `aria-valuetext` spoken as time ("12 minutes 5 seconds of 48 minutes"), harvested
   from the old app's `positionText`.
3. Skip buttons named with their lengths ("Back 15 seconds"); speed button announces "Speed 1.2
   times".
4. Queue reorder: drag handle plus Move up / Move down / Play next menu items; keyboard Up/Down/
   Home/End on a focused handle (harvested).
5. Download progress is a `progress` element with a text label; finished downloads announce once.
6. Transcript text is selectable and scales with text size.
7. Show and episode text from feeds keeps its language when the feed declares one
   (`<language>` → `lang` on the notes).

---

## 12. Empty and error states (copy)

| State | Text | Action |
|---|---|---|
| No subscriptions | "Follow a show to see new episodes here." | Discover |
| Nothing new | "You're up to date." | — |
| Up next empty | "Add episodes from their menu. They play in order." | — |
| No downloads | "Download an episode to listen without internet." | — |
| Search failed | "Podcast search isn't answering. Try again in a moment." | Try again |
| Feed unreachable | "This show's feed isn't answering right now. Showing what I had." | Try again |
| Feed gone | "This show's feed has gone away. Episodes you downloaded still play." | Unfollow |
| Not a feed | "That address isn't a podcast feed." | — |
| Episode no longer in feed | "This episode isn't in the show's feed any more." | — |
| Offline, not downloaded | "Needs internet. Download it next time to listen offline." | — |
| Space full | "Podcast space is full. Remove played downloads or raise the limit." | Settings |
| Unsupported audio | "This episode's audio format can't play here." | — |

---

## 13. New feature ideas (all [proposal])

1. **Catch-up length.** On Listen, "You have 3 h 20 min of new episodes" with a "Fit into 45
   minutes" button: the phone builds Up next from the owner's most-finished shows to fill the time,
   at the owner's usual speed.
2. **Chapter skipping by habit.** If the owner skips the same chapter title pattern ("Sponsor",
   "Housekeeping") in a show 3 times, the show offers "Skip chapters like this automatically" —
   one tap to turn on, shown in show settings, never silent.
3. **Ask about the moment.** Long-press the seek bar or a transcript cue → "Ask about this" sends
   the episode ref with the timestamp and the surrounding transcript lines (when a transcript
   exists) to home.
4. **Morning walk queue.** If the owner tends to listen at a regular time (from senses), the mind
   pre-downloads that morning's Up next on Wi-Fi the night before and says so in the Briefing tile.
5. **Show health.** The Shows grid marks shows not opened in 60 days with a soft "Still want
   this?" so the list stays meaningful; unfollow stays the owner's tap.

---

## 14. Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Worker CPU for a 20-feed tick with 128 KB reads stays under 10 ms on the free plan | Measure in the workerd test and with `wrangler tail` after deploy |
| 2 | Direct-mode decks (non-CORS) in background with the screen locked on the phone of record: media notification, seek buttons, 60 min soak | Device test before P8 ships |
| 3 | Background Fetch on the installed app: survives leaving the app; moving to OPFS from the service worker | Spike on the device |
| 4 | Apple iTunes Search CORS and limits from the new origin | Browser check on the new site; watch for 403/429 |
| 5 | `MediaMetadata.chapterInfo` support in the phone's Chrome | Feature-detect and log once to the playback log |
| 6 | DOMParser time for a 4 MB feed on the A15 (main thread) | Measure; if over 150 ms, move parsing to a worker with a streaming XML parser |
| 7 | Whether the owner wants the Podcast Index API (needs a free account and two Worker secrets) | Owner decision |
| 8 | Refs `podcast:<s>/<e>` agreed in [GLOSSARY](../GLOSSARY.md) | Coordinator |
