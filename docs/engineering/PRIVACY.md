# Privacy

This doc lists every kind of data the Thunderhead holds, where it lives, how long it's kept, who can see it, and what may leave the owner's phone or reach a third party. It also fixes what the mind may bring up unprompted, and the rules for camera, mic, notifications, export and deletion.
Security controls are in [SECURITY.md](SECURITY.md). Sign-in data handling is in [../product/SIGN-IN.md](../product/SIGN-IN.md). Memory semantics are in [../mind/MEMORY.md](../mind/MEMORY.md). Per-table storage details are in [DATA.md](DATA.md).

## Rules at a glance

1. **Reading is unlimited; speaking is limited.** The mind may read everything on the platform (owner ruling). What it may *raise unprompted*, and where, depends on `sensitivity` (0 or 1) and the owner's `may_raise` flag (§4).
2. **Personal data lives only behind the owner's sign-in:** the Worker's Durable Objects and the private R2 bucket. Never in the repo, Actions logs, artifacts, commit messages, PR text or issue text.
3. **Eyes and ears only when switched on** (owner ruling). No camera or mic without a tap each time; everything stops when the feature closes or the page hides; live audio and video are analysed on the phone and never uploaded unless the owner sends a capture (§7).
4. **Notifications are lock-screen-safe by default.** A push carries only a kind and an id; the visible text is generic unless the owner turns on details, and sensitivity-1 content never appears in a notification (§8).
5. **Nothing is sold, shared or sent to anyone but the services listed in §5.** Each one gets the minimum it needs.
6. **Sign-in data is never exported and never shown to the mind.**
7. **Deleting is real.** Deleted items leave live storage at once and backups within the stated window (§10). The ledger keeps a content-free tombstone.
8. **The owner can export everything and erase everything** (§9, §10). The music audio bucket is the one deliberate exception to erasing: the system never deletes from it (decisions).
9. **No analytics, no trackers, no third-party scripts, no fingerprinting** in the shell and new pages. The only telemetry is the owner's own error reports and performance senses, stored in the owner's own Worker. The ported apps (P1b, copied as they are) keep the outside services they use today until the owner agrees to a change (§5.1).

---

## 1. Sensitivity

Every event and every memory fact carries `sensitivity`: `0` normal, `1` private (decisions: 0|1). Facts also carry `may_raise`: `1` may be mentioned unprompted, `0` "don't bring this up" (owner-set).

**Default sensitivity 1** (set by the code that creates the item, never lowered by the mind; only the owner can lower it) **[proposal]**:
- faith and spiritual practice: prayer, personal spiritual notes, study highlights and notes (the Study app's library content itself is 1);
- health, body, sleep, mood;
- money;
- other people: names, relationships, messages about them;
- location beyond the coarse weather setting;
- contents of the owner's private files and photos;
- camera and mic captures and voice memos;
- sign-in and security events.

**Default sensitivity 0:** music played and skipped, guitar practice stats, podcast and video progress, app usage, weather, what was built overnight, system health.

Acceptance: a backend test creates one event of each type listed in [DATA.md](DATA.md) and checks its default sensitivity against this list.

## 2. Data inventory

Retention marked **[proposal]** is new; the rest comes from decisions, the plan or the architecture review.

| Data | Where | Written by | Kept | In export | Mind can read |
|---|---|---|---|---|---|
| Conversation messages | `Core` DO (+ FTS index) | owner devices, mind | Until deleted | yes | yes |
| Threads (daily conversations, titles) | `Core` | Worker, mind | Until deleted | yes | yes |
| Memory: facts (bi-temporal; superseded rows kept as history) | `Core` | mind (taint rules), owner | Until forgotten | yes | yes |
| Memory: day notes | `Core` | night shift | Until deleted | yes | yes |
| Memory: open threads | `Core` | mind, owner | Open: until closed; closed: 1 year **[proposal]** | yes | yes |
| Memory: session notes | `Core` | mind | 180 days **[proposal]** | yes | yes |
| Ledger (actions with why and undo) | `Core` | Worker | Forever; content removed from rows that point at deleted items (tombstone) | yes | yes |
| Proposals | `Core` | mind, Worker | 1 year after decided **[proposal]** | yes | yes |
| Reminders the owner set (the words, the time, and the owner's message the mind set it from) | `Core` | owner devices, mind (only from the owner's own message) | Until deleted, like the conversation line each becomes | yes | yes |
| Surfaces (what apps show) | `Core` | mind | Until `expires`, deleted within 24 h after | no | yes |
| Wakes (why the mind was woken) | `Core` | Worker | 30 days **[proposal]** | no | yes |
| Errors (client and server, fingerprinted) | `Core` | devices, Worker | 30 days **[proposal]** | no | yes |
| Meter (daily request and row counts) | `Core` | Worker | 400 days **[proposal]** | yes | yes |
| Events (senses) | `Senses` DO (P5) | owner devices | 90 days in SQLite, then daily JSONL in `thunderhead-private/events/` forever | yes | yes |
| Music catalog, play stats, ratings, playlists | `Music` DO (P5) | owner devices, mind (reversible fixes) | Until deleted | yes | yes |
| Music audio and art | `jarvis-music` R2 | upload tools | Never deleted by the system (decisions) | links only (optional) | via presigned URL |
| Library: PDFs and extracted text | `thunderhead-private` + `Library` DO (P7) | owner, mind (extraction in session) | Until deleted | yes | yes |
| Chat files: photos, files, voice memos | `thunderhead-private/chat/files/` | owner devices | Until the message or file is deleted | yes | yes |
| Imports from the old Worker and old site | `thunderhead-private/imports/` | migration jobs; the `/import/` page (P1b) | Until the owner approves deletion, after the last app's data move (P8) and the old Worker's retirement **[proposal]** | no (already merged) | yes |
| Scripture texts (the owner's licensed copies of the canon scriptures) | `thunderhead-private/books/` + `Library` (P7) | owner | Until deleted | yes | yes |
| The ported apps' own phone data (P1b until each app's data move) | localStorage and IndexedDB on the new origin, under the apps' old names | the ported apps | As on the old site, until the app's data moves | via the raw import copy | via the raw import copy |
| Backups (weekly, per table) | `thunderhead-private/backups/` | Worker jobs | 8 weekly + 12 monthly | — | no |
| Job results from Actions | `thunderhead-jobs` | Actions | 30 days after the Worker copies them **[proposal]** | no | yes |
| **Sign-in:** credential (verifier only), recovery hash | `Auth` DO | Auth | Current only; old verifiers overwritten | **never** | **never** |
| **Sign-in:** sessions (label, platform, browser, region, country, times) | `Auth` | Auth | Active; then 30 days after revoke or expiry | **never** | **never** |
| **Sign-in:** back-off counters (hashed source keys) | `Auth` | Auth | 24 h after the last failure | **never** | **never** |
| **Sign-in:** notices, tickets | `Auth` | Auth | Notices 14 days after ack; tickets 30 days after use or expiry | **never** | **never** |
| Agent keys (hash, name, role, last used hour, last country) | `Auth` | owner | Active; revoked 30 days | **never** | **never** |
| Push subscriptions | `Auth` | owner devices | While the session is active | **never** | **never** |
| Worker request logs | Cloudflare Workers Logs | Cloudflare | 3 days (7 days from 2026-12-01), Cloudflare-controlled | no | no |

Never stored anywhere: raw IP addresses, full user-agent strings, cities, passwords, recovery codes, request bodies of `/v1/auth/*`, presigned URLs, push endpoints in logs.

Acceptance: [DATA.md](DATA.md) has a row for every table, and a test fails if a table exists without a retention rule and an export flag.

## 3. On the phone

### 3.1 What the phone keeps
| Data | Store | Kept | Wiped on sign-out |
|---|---|---|---|
| Session token | IndexedDB `th-auth` | Until sign-out or revocation | yes |
| Recent conversation, last briefing, surfaces | IndexedDB `th-data` | Last 7 days **[proposal]** | yes |
| Outbox (messages and events not sent yet; a message's photos, files and voice memos with it, bytes and all, at most 20 MB, or one file up to 25 MB alone) | IndexedDB `th-data` | Until sent | yes |
| App openings and tile taps not sent yet (P9; names and times only) | `localStorage` `th.p.senses`, `th.p.senses.batch` (at most 200) | Until the Worker takes them | yes |
| "Go quiet"'s end (P8) | `localStorage` `th.p.quiet.until`, `th.p.quiet.pending` | Until it ends | yes |
| Unsent text in the ask bar | memory, then IndexedDB `th-data` draft | Until sent or cleared | yes |
| Offline songs, podcast downloads, Study PDFs | OPFS | Until removed or evicted (song budget 512 MB, LRU) | yes |
| Covers, music index, song heads | Cache Storage (named caches) | Until replaced | yes |
| App code and fonts | Cache Storage `th-<release>`, `th-vendor` | Current release | no |
| Theme and other UI choices | `localStorage` `th.ui.*` | Always | no |
| Shuffle learner weights, EQ settings | `localStorage` `th.p.*` / `th-data` | Always | yes |
| Forgets not yet sent (Memory page) | `localStorage` `th.p.forget`: fact ids only, never their text | Until the Worker has each one (sent again when the Memory page or Home opens, and before a sign-out, which asks while any can't go) | yes |
| The ported apps' own stores (P1b): `claude-player`, `jarvis.guitar.v2`, `jarvis.podcasts.v1`, `jarvis-podcasts`, `mymedia.*`, `astra.v2.*` and their caches | localStorage, IndexedDB, Cache Storage | As the unchanged apps keep them | **no** at P1b (the unchanged apps don't know the new sign-in); yes once an app moves and joins the wipe list **[proposal]** |

### 3.2 What never leaves the phone
1. Live mic audio and camera frames, unless the owner sends a capture or a take (§7).
2. Guitar listening analysis: onsets, pitch and timing are computed on the phone; only the resulting practice numbers are sent as events.
3. Text in the ask bar until the owner sends it. The typing signal that pre-warms the mind contains no text.
4. Reset and setup codes made on `/recover/` and `/setup/` (only their fingerprints leave, until the one request that uses the code).
5. The clipboard (read only on an explicit paste), the photo library and files (only the item the owner picks), contacts (never requested).
6. Precise location: never requested. The CSP and the code never call the geolocation API.

Acceptance: a Playwright test runs the guitar listening screen with a fake mic for 60 s and asserts no request body contains audio data (only JSON events under 4 KB).

## 4. What the mind may raise unprompted

"Raise" means bringing something up without the owner having asked about that topic in the current conversation. Answering a direct question is always allowed (reading is unlimited), and the mind says plainly if it is holding something back (law 1).

| | Home voice line | Briefing cards | Mind-started message in the conversation | Push or lock screen |
|---|---|---|---|---|
| Sensitivity 0, `may_raise=1` | yes | yes | yes | generic text; details only if the owner turned details on (§8) |
| Sensitivity 1, `may_raise=1` | no | only as a neutral count with no content, e.g. "1 private reminder" **[proposal]** | yes, while the owner has the app open (not as the reason for a push) | never any content |
| `may_raise=0` (any sensitivity) | no | no | no | never |

Rules:
- `may_raise=0` items may still inform quiet arrangements (for example, not scheduling practice at a time the owner said is off-limits), but the arrangement's "why" must not reveal the item. If it can't be explained without revealing it, the mind doesn't make the arrangement. **[proposal]**
- The mind may never lower an item's sensitivity or set `may_raise=1` on its own; only the owner can.
- Events from other people (anything about someone else) are sensitivity 1 and never raised in a push, even generically.
- Nothing about faith practice is ever the subject of a nudge or a prediction (law 8; [../mind/CONSTITUTION.md](../mind/CONSTITUTION.md)).
- Acceptance: eval fixtures in [../mind/EVALS.md](../mind/EVALS.md) include a sensitivity-1 fact and a `may_raise=0` fact; across 20 runs of the morning briefing and voice-line generation, neither appears. The Worker also filters: surfaces for Home and pushes whose `ref` points at sensitivity-1 data are rejected with `422 too_sensitive`.

## 5. Third parties

| Service | Gets | Why | Limits on it |
|---|---|---|---|
| **Cloudflare** (Workers, Durable Objects, R2, Workers Logs) | Everything server-side, plus the client IP of every API request | Runs the backend | Logs kept 3–7 days; no raw IPs stored by us |
| **Microsoft Azure** (Storage static website) | Requests for static files: IP, path, user agent | Hosts the site | No personal data in `$web`; storage analytics logging off **[proposal]** |
| **Anthropic** (Claude, the mind) | What each mind session reads: briefings, messages, memory, events, file and PDF text it opens | The mind runs as Claude Code scheduled tasks on the owner's plan | Owner setting: turn **off** "Help improve Claude" (Settings → Privacy in Claude). Anthropic's consumer terms: with it off, chats and coding sessions are kept 30 days; with it on, up to 5 years and used for training. Safety-flagged conversations may be kept longer. **[owner action; verify the live setting]** |
| **GitHub** | Code, workflow logs, PR and commit text, all public | Repo and Actions | Nothing personal, ever (§6) |
| **Have I Been Pwned** (Pwned Passwords range API, served via Cloudflare) | The first 5 hex characters of the SHA-1 of a new password, with `Add-Padding: true` | Breach check when a password is set | Called from the Worker, so it sees Cloudflare's IP, not the phone's; never at sign-in |
| **Google push service** (Chrome on Android; Apple's on iOS) | The endpoint, timing and size of each push; the payload is encrypted | Delivering pushes | Payload is only `{k, id}` (§8) |
| **Weather provider** for the Briefing | The town's name the owner types, once, to its geocoder; then coordinates rounded to 0.1° (about 11 km), never device GPS | Weather card | Open-Meteo (built, P8), called from the Worker; no key, nothing that identifies the owner. The place is kept only in Core's settings |
| **Muse** (a separate AI agent on its own plan) | Only the work orders and briefs addressed to it, and its own thread | Routine jobs (none yet; the Daily Board was cut, 2026-10-31) and the music uploads | Its key reaches only `/v1/work/*` and its own thread; never memory, events or files |
| **Workers AI** (deferred for v1) | When enabled: only the text a task needs | Small fast models | Same processor as the backend (Cloudflare); no sensitivity-1 text in v1 of that feature **[proposal]** |
| **Scripture source site** (Study) | Nothing, until the owner taps a link | Scripture text comes from the owner's own licensed copies, stored privately in `thunderhead-private` behind sign-in, never in the repo (owner ruling 2026-10-27). Talks and other published source material are cited by paragraph with a link to the source | Link only for talks |

Not used by the shell or new pages: Google Fonts or any CDN, analytics, ads, error-tracking services, CAPTCHA (no Turnstile at launch), any LLM other than Claude (and later Workers AI).

### 5.1 Services the ported apps keep using (P1b)

Copied as they are (owner ruling), the ported apps keep reaching what they reach today. Each list is enforced per app ([SECURITY.md §4.4](SECURITY.md#44-ported-app-pages-p1b)); removing one is a later change the owner agrees to.

| Ported app | Reaches | Gets |
|---|---|---|
| All five | The old Worker `jarvis-hub-api` (same Cloudflare account) until the app's data moves | The requests the app makes today, and error reports (`/assets/error-report.js`) |
| Music | `cdn.jsdelivr.net` (visualiser scripts) | The phone's IP and the script request |
| Guitar | Songsterr (through the old Worker; permitted, owner ruling); `itunes.apple.com`, `*.mzstatic.com` | Search text and cover requests |
| Podcasts | Podcast directories, feed hosts and audio hosts (via the old Worker's proxy or directly) | Search text; which feeds and episodes are fetched |
| Astra | `cdn.jsdelivr.net` (hls.js, dash.js); the owner's add-on and stream hosts | The phone's IP; titles requested from add-ons |
| My Media | Google Drive API, `*.googleusercontent.com`, `i.ytimg.com` | The phone's IP and the Drive files listed and played |

## 6. The public repo and public logs

Repo and Actions content is readable by anyone. Rules (enforced by tests where possible):
1. No names of people or places, no faith-specific personal details, no notes, messages, memory, listening or reading history, no titles of the owner's songs, books or files, no username, no secrets.
2. Example content in code, tests and docs is invented and neutral.
3. Actions jobs address audio only by `sha256` key, received through the job spec and never printed: logs show counts and durations only, never hashes, titles or tags ([JOBS.md §2](JOBS.md#2-public-log-rules-actions)).
4. No artifacts. No job summaries with data. No `set -x`, `env` or `printenv`. Masked derived values.
5. Actions never hold credentials for `thunderhead-private` (they write `thunderhead-jobs` and read `jarvis-music` only).
6. Evals with personal data run inside mind sessions, never in Actions; Actions use synthetic fixtures only.
7. PDFs and personal text are processed in the mind's private session, never in Actions.
8. Commit messages, PR titles and bodies written by the agent describe code, never personal content ("Add playlist sort" not the playlist's name).
9. Failing tests print fixture ids, not personal values.

Acceptance: a CI test greps workflow files for `upload-artifact`, `set -x`, `printenv`, unmasked `${{ secrets.* }}` in `run:`; a pre-push check in [TESTING.md](TESTING.md) greps the diff for the patterns in [SECURITY.md §5.2](SECURITY.md).

## 7. Camera and mic

1. Each use starts from a tap inside the feature (the `+` sheet's Camera or Voice memo, the mic in the ask bar, Guitar's "Listen"). Never at page load, never from a timer, never from the mind.
2. The browser permission prompt appears only on that first tap. If denied, the feature explains how to allow it in Chrome's site settings and does nothing else.
3. While capturing, the screen edges brighten (the "listening" presence, decisions) and the feature shows its own on-indicator.
4. All tracks stop (`track.stop()`) when the feature closes, the capture ends, the page becomes hidden, or after 10 minutes without a tap (Guitar: 75 minutes, the practice block length) **[proposal: timeouts]**.
5. No background recording, no wake word, no always-on listening, ever.
6. Captures stay in memory until the owner sends them; discarding drops them. Sent captures go to `thunderhead-private/chat/files/` as sensitivity 1.
7. Dictation (holding the ask bar's mic, built 2026-10-31; the owner chose this in the agreed batch, NEXT-BATCH.md part 8) uses the Worker's own speech-to-text: short pieces go to `POST /v1/dictate`, which hands them to Workers AI Whisper, the same as voice memos, and answers the words. Nothing is kept on the Worker: no audio, no words, no row. Never the browser's own recogniser (Chrome's Web Speech API sends audio to Google). The microphone is open only while the finger is down: letting go, the page hidden or two minutes stop it; a take under 0.6 s is thrown away unsent. The words land in the bar, and go anywhere only if the owner sends them.
8. The mind cannot turn on the camera or mic, and no verb exists for it.

Built for the `+` sheet (2026-10-30): Camera is the phone's own camera app through a file input, so this page never holds a camera track. Voice memo opens the microphone on the tap, shows its strip and the edge's listening glow while open, and stops every track when it is kept, thrown away, reaches 10 minutes, or the page is hidden (what was recorded until then is kept). Photos are redrawn on the phone before upload, which drops their location and other EXIF data; an image the phone can't decode goes as it is, and a toast says it keeps any location data in it. A chat file the Worker serves is never stored in the browser's cache (`Cache-Control: private, no-store`); the page keeps what it showed in memory until it closes. A browser test covers the hidden page with Chrome's fake microphone.

Acceptance: Playwright with a fake media device opens Camera, then switches the page to hidden; every track's `readyState` is `ended` within 500 ms.

## 8. Notifications and the lock screen

Web notifications can't tell whether the phone is locked, so **every notification must be safe to show on a lock screen.**
1. Payload: `{k, id}` only, encrypted (SECURITY.md §10).
2. Title is always "Thunderhead". Body by kind, default (details off):
   | Kind | Body |
   |---|---|
   | `nudge` | "Something needs you." |
   | `reminder` | "Your reminder." |
   | `security` | "New sign-in to Thunderhead." / "Your Thunderhead password was changed." / "A password reset was requested for Thunderhead." |
   | `signout` | "You were signed out of Thunderhead." |
   | fallback (fetch failed) | "Thunderhead has something for you." |
3. **Details toggle** (Settings → Notifications, default **off**) **[proposal]**: when on, a `nudge` or `reminder` about sensitivity-0 data may show up to 60 characters of its own text (for example the reminder the owner wrote). Sensitivity-1 items and security notices stay generic regardless.
4. No images, no sender names, no action buttons that complete an ask-first action from the notification.
5. Quiet hours: nothing before 06:30 local (owner ruling); held pushes are delivered at 06:30, collapsed by `tag` so the owner gets at most one per kind.
6. Opening a notification goes to the app, which shows the full content only after the app is open (and the phone is unlocked).

Acceptance: a unit test of the notification builder over every kind, with details on and off and sensitivity 0 and 1, matches this table exactly.

## 9. Export ("Download everything", P4)

- Where: Settings → Privacy → "Download everything". Requires a fresh password entry (step-up arrives with this feature, per decisions).
- What: a fresh backup set built by a chunked job: one `table.jsonl.gz` per table (all `Core`, `Senses`, `Music`, `Library` tables), the events archive, every file in `thunderhead-private` that belongs to the owner (chat files, library PDFs), a `manifest.json` (counts, SHA-256, schema versions) and a plain `README.txt` explaining each file. Music audio is offered as a separate optional link list ("about 35–45 GB").
- Not included: `Auth` tables (the manifest says "sign-in data: not exported, by design"), logs, imports already merged, job scratch.
- Delivery: when ready (target under 30 minutes), a Home notice "Your download is ready." The Settings page lists presigned links (3 h, as all media URLs). Nothing is emailed.
- The export itself is recorded in the ledger.
- Acceptance: on fixtures, export → import into a fresh local Worker → deep-equal on every table (the restore test in [TESTING.md](TESTING.md)).

## 10. Deleting

### 10.1 Single items
| Action | Effect |
|---|---|
| Delete a message | Removed from `Core` and the FTS index at once; any file it carried is deleted from R2; ledger keeps "message deleted" without content. |
| Forget a fact (Memory page) | Hard delete of the fact and every version of it (even one an undo unlinked), its FTS entries rewritten away; surfaces citing it cleared, and the ledger rows of every surface that drew on it lose their words; the ledger rows about it keep only time and kind; one tombstone without content, and the ids kept so they are never reused. Durable Object point-in-time recovery still holds the deleted pages for up to 30 days (the Memory page says so). |
| Delete a day's conversation | Messages, thread, day note and session notes of that day. |
| Delete a file or book | R2 object and its extracted text and index rows. |
| Delete events | By app and date range in Settings → Privacy; SQLite rows and the matching lines in the daily archives are rewritten. |

Deletes are `delete`-class proposals when the **mind** asks for them; when the **owner** does them from the UI, the tap is the approval. Each owner delete has a 10-second Undo toast, then it's final. **[proposal]**

### 10.2 Erase everything **[proposal]**
- Settings → Privacy → "Erase everything". The sheet asks for the password and the typed word `ERASE`.
- What goes: every `Core`, `Senses`, `Music` and `Library` table; everything in `thunderhead-private` (including backups and the events archive); `thunderhead-jobs`; all sessions except this one; all agent keys; all push subscriptions.
- What stays, said plainly on the sheet: the account itself (so the owner can still sign in); the music audio in `jarvis-music` (the system never deletes from it, by decision); Cloudflare's own logs (expire in 3–7 days); the owner's Claude session history (delete it in Claude); the old Worker until it is retired; the ported apps' own phone storage until their data moves (cleared from the phone's site settings).
- Timing: 7 days during which everything is hidden and "Cancel erase" is offered on every device; then a chunked job deletes, and the ledger keeps one line: "Everything was erased on {date}."

### 10.3 Backups and deleted data
Backups keep 8 weekly and 12 monthly sets, so a single deleted item can survive in a backup for up to 12 months. Restoring a backup re-applies the ledger's delete tombstones made since that backup, so deleted items don't come back. **[proposal]** Erase everything deletes the backups too.

Acceptance: delete a message on fixtures, take a backup, restore an older backup that contains it; the restored store doesn't contain it.

## 11. Owner actions that protect privacy (one-time)
- Claude → Settings → Privacy: turn **off** "Help improve Claude".
- Cloudflare R2: confirm public access and the r2.dev URL are off on every bucket (T14).
- GitHub: secret scanning and push protection on (SECURITY.md §12.1).
- The old repo still contains files the owner may not want public (architecture review Q5); that is tracked in [MIGRATION.md](MIGRATION.md).

## 12. Open questions / tests

| # | Question | How to settle |
|---|---|---|
| T24 | ~~On-device speech recognition~~ Settled 2026-10-31: dictation uses the Worker's Whisper (rule 7.7), not the browser's | Check the owner's second language with Whisper on the phone |
| T25 | Can the service worker always fetch notification text before showing it (time limit on Android)? | Push test at P8; fallback text is already generic |
| T26 | Is Azure Storage analytics logging off by default on the new account? | Owner checks Monitoring → Diagnostic settings on the account |
| T27 | Which weather provider, and does its terms allow personal use at $0? | Writer of BRIEFING.md decides; record in decisions.md |
| T28 | Exact current Anthropic retention for consumer Claude Code sessions with "Help improve Claude" off | Read the live privacy settings and policy page once; record the answer here |
