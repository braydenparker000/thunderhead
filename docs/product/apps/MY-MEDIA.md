# My Media

> **Owner ruling 2026-10-28:** this app is first ported over **as it is**, with no changes. This spec describes where it goes *after* that port; nothing here is built until the owner agrees to it.

My Media is the owner's saved-video library: YouTube videos the owner archived to a Google Drive folder
(downloaded with their YouTube IDs in the file names, plus subtitle and thumbnail sidecars), browsed and
played like a calm, private YouTube. This doc records what exists, the new data model, what replaces the
"Drive catalog job", and the screens, search, progress, senses, verbs and surfaces.
Ring colour `#14a39a`, icon Phosphor `youtube-logo`, route `/media/`, phase **P8**.

## Rules at a glance

1. **First the old app comes over as it is** (owner ruling 2026-10-28; see "First move" below). Later,
   only if the owner agrees: `library.js`, `discovery.js` and `metadata.js` ideas carry over as tested
   pure modules and the screens move onto the shell and the design system **[proposal]**.
2. **The catalog lives in the Worker** (later step), refreshed **on demand** (pull to refresh, or opening the app
   when the catalog is older than 6 h) and **once a night** by a Worker job. **No GitHub Actions job,
   no hourly job.**
3. **Nothing identifying goes into the public repo or public logs:** no Drive folder IDs, no API key, no
   titles, no creators. (Today the old public repo commits the Drive folder IDs; see §2.3.)
4. **Progress follows the owner across devices**: local first, synced through the Worker.
5. **The mind may arrange and suggest; it never starts playback.** A verb can open a video's page or
   queue videos; play is always a tap.
6. **Senses carry Drive file IDs as refs, never titles.**

## First move: the as-is port (owner ruling)

1. Copy the old My Media app into the new site at `/media/` **unchanged**: its screens, phone-side
   Drive listing, player, Quick watches and wording.
2. Adjust only what it strictly needs to run on the new site:
   - every asset and link path made root-absolute (the host serves `/media` without a redirect);
   - the Drive key and folder IDs are not committed to the public repo (owner rule). How the ported
     page gets them is an owner decision before its port ([MIGRATION](../../engineering/MIGRATION.md)
     open question 8): (a) read from the new Worker after sign-in (`GET /v1/media/config`, §2.3
     Stage A), a small change beyond the P1b adjustment list, or (b) `/assets/drive-config.json`
     written into `$web` at stage time from a GitHub secret (out of the repo, world-readable on the
     site as today) **[proposal]**;
   - everything else keeps calling the old Worker until the data moves in P8 (the new site's origin
     is added to its allowed origins, ask first);
   - its own `<meta>` security policy kept first in `<head>`, unchanged except for the new paths
     ([SECURITY](../../engineering/SECURITY.md) §4.4).
3. The owner's `mymedia.*` progress, saved, queue and preferences are restored unchanged on the new
   origin **[proposal: through the export page, §5]**.
4. Done when the owner watches on the phone and nothing has changed.

Everything after §1 describes later steps. Each is proposed after the port and built only if the
owner agrees.

---

## 1. What exists today (old repo, `frontend/mymedia/`, ~2.1k lines JS + 42 KB CSS)

| Part | Today |
|---|---|
| Source of videos | One Google Drive folder (and up to 500 subfolders, up to 20,000 videos) shared as **"Anyone with the link → Viewer"**. Files: `Title [<11-char YouTube ID>].mp4/.m4v/.webm/.mkv/.mov`, with yt-dlp sidecars sharing the stem: subtitles `Title [id].<lang>.vtt/.srt`, thumbnail `Title [id].webp/.jpg/.png`. |
| Optional metadata | `jarvis-video-metadata.json` (< 2 MB) in the root folder: per video `creator`, `description` (≤ 2,000 chars used), `topics` (≤ 12), `upload_date`/`timestamp`, matched by Drive ID, YouTube ID or file name. |
| How it lists | The **phone** walks the whole folder tree on every open through the Drive API with a public API key from `/assets/drive-config.json` (key and folder IDs), then caches the listing in `localStorage` `mymedia.library.v1`. A **Refresh** button ("Check Drive for new videos") re-walks it. |
| How it plays | `<video src>` = Drive `files/<id>?alt=media&key=<key>` (works only because the files are link-shared). Files Chrome refuses go to Astra's engine (`/astra/src/engine/player.js`). |
| Tabs | Home (`#explore`), Creators, Collections (one per subfolder), You (History, Saved, Queue, stats). |
| Home | Continue watching (resume between 10 s and 93%), a daily "Quick watches" row (12 videos ≤ 10 min, stable per day, round-robin across creators, unwatched only), a spotlight, Recently added; filter chips All / Unwatched / Under 10 min / Long watches (≥ 20 min); 7 sorts (Recently added, Oldest added, Newest on YouTube, Oldest on YouTube, Title, Shortest first, Longest first). |
| Watch | Full / mini (docked above tabs) / full screen; tap toggles controls (hide after 3 s), double-tap ±10 s, drag down to minimise; speed 0.5–2×; captions from sidecars (SRT converted to VTT); Up next with **Autoplay** switch (on by default); PiP; Media Session with the YouTube thumbnail. |
| Progress | `mymedia.progress.v1`: `{<driveId>: {t, d, done, at}}`; watched at 93% or on end; resume only if 10 s < t < 93%. |
| Phone keys | `mymedia.progress.v1`, `mymedia.library.v1` (cache), `mymedia.saved.v1`, `mymedia.queue.v1`, `mymedia.searches.v1` (≤ 12), `mymedia.sort.v1`, `mymedia.speed.v1`, `mymedia.captions.v1`, `mymedia.autoplay.v1`, `mymedia.view.v1`. (Report 4 lists 7; there are 10.) |
| Search | Every word must appear in title + folder + creator + topics (lowercase substring). |

### 1.1 The "hourly Drive catalog job" is not My Media's

The hourly workflow in the old repo (`publish-drive-catalog.yml`, cron `17 * * * *`) is the **Music**
player's Drive catalog publisher ("Publish Poweramp Drive catalog"): it reads the music Drive folder with
an OAuth refresh token, extracts tags and covers with ffmpeg, and publishes a catalog to the old Azure
site. My Media never used it; it lists Drive live from the phone. The plan's "drop the hourly Drive
catalog job" therefore belongs to Music's switch-over ([MUSIC](MUSIC.md),
[MIGRATION](../../engineering/MIGRATION.md) §7). This doc replaces **My Media's live phone-side
listing** with a Worker catalog.

---

## 2. The new catalog

### 2.1 Where it lives

Tables in the `Library` Durable Object (the owner's saved things: books and videos) **[proposal: Library
rather than a new class]**. If My Media ships before Study's `Library` class, the class arrives with My
Media in its own deploy.

| Table | Columns (key first) | Notes |
|---|---|---|
| `videos` | `id` (Drive file ID), name, title, youtube_id, folder_path, mime, bytes, duration_s, width, height, drive_created_at, drive_modified_at, youtube_at, youtube_date_kind (`upload\|published\|''`), creator, description, topics_json, image_id, subtitles_json (`[{id, lang, format}]`), seen_at (last catalog run that saw it), gone_at | `gone_at` set when a run no longer sees it. |
| `videos_fts` | FTS5 over title, creator, topics, folder_path (`unicode61 remove_diacritics 2`) | For server search and the mind. |
| `video_progress` | (`video_id`) WITHOUT ROWID, t_s, d_s, done, at, device | Last `at` wins. |
| `video_lists` | (`list`, `pos`) WITHOUT ROWID, video_id, added_at | `list` ∈ `saved`, `queue`. |
| `catalog_runs` | `id`, started_at, finished_at, trigger (`open\|pull\|night`), folders, videos, added, removed, changed, state, error_code | Counts only. |

Ref: `media:<driveFileId>` (e.g. `media:1AbC…`). Data in refs and senses never includes the title.

### 2.2 How the catalog is built (replaces the phone-side walk)

A **Worker job** (`media.catalog`), chunked on the `Library` DO's alarm ([JOBS](../../engineering/JOBS.md)):

| Step | Rule |
|---|---|
| Triggers | (a) the owner pulls to refresh on My Media Home; (b) My Media opens and the last finished run is older than **6 h**; (c) the nightly `Core.tick()` after the day roll. Never more than one run at a time; a trigger during a run is ignored. |
| Credential | A Google OAuth refresh token with the `drive.readonly` scope, stored as a Worker secret (name and rotation in [SECURITY](../../engineering/SECURITY.md)). The folder ID is a Worker secret too. Neither is in the repo or sent to the phone. **[proposal; adding the OAuth grant is an access change, so ask first]** |
| Walk | Breadth-first over folders, ≤ 500 folders, ≤ 20,000 videos (same limits as today). One Drive `files.list` page (pageSize 1000, the same field list as today) per alarm step, **at most 30 Drive calls per step** (Free plan: 50 subrequests per invocation). |
| Sidecars | Same matching as today (`stem` equality or `stem.` prefix; subtitles `.vtt/.srt` with language from the suffix; first image wins). |
| Metadata file | `jarvis-video-metadata.json` in the root, if present, read once per run and merged as today (`enrichVideos`). **[proposal: rename to `media-metadata.json` once the producer is known; accept both]** |
| Writes | Only changed rows: new videos inserted, changed fields updated, unseen videos get `gone_at`. A run that would mark more than **20%** of videos gone stops with `state = 'held'` and creates a Home decision card "Drive shows 35% fewer videos than yesterday. Apply?" (**Apply** / **Keep the old list**) — the same guard as the old music publisher. |
| Logs | One line per run: `{evt:"media.catalog", trigger, ms, folders, videos, added, removed, changed, state}`. No IDs, names or titles. |
| Errors | Drive 401/403 → `state='failed'`, `error_code='drive_auth'`, Home shows (once) "My Media can't read Drive anymore. Reconnect it in Settings." 429/5xx → retry the step after 30 s, 2 min, 10 min, then fail with `drive_busy`. The previous catalog keeps working in every failure. |

**Why not GitHub Actions:** there is no heavy CPU work, and Actions logs are public; titles must never be
near them. **Why not the phone:** a link-shared folder and a public API key are needed for the phone to
list Drive, and the walk costs the A15 seconds on every open.

Checks:
- Store test with a fake Drive (fixture folders: 3 levels, 2,500 videos, sidecars, metadata file): a full
  run, a re-run with zero changes writes 0 rows, a run with 25% removed is held.
- Cost test: rows written for a no-change run = number of `catalog_runs` rows written (1–2).
- Log test: run output contains no fixture title or ID.

### 2.3 How videos play

Two stages. Stage A ships first; Stage B removes the public link sharing.

| | Stage A (P8 launch) | Stage B **[proposal; ask first: access change]** |
|---|---|---|
| Drive sharing | Unchanged ("Anyone with the link") | Folder sharing turned **off** by the owner |
| Byte source | `https://www.googleapis.com/drive/v3/files/<id>?alt=media&key=<key>` as today | The Worker streams bytes: `GET /v1/media/drive/<id>?t=<ticket>` |
| Key / ticket | The browser API key is served only to a signed-in device by `GET /v1/media/config`, never committed | A ticket: HMAC over `(id, expires)` signed by the Worker, valid **3 h**, issued in batches by `POST /v1/media/sign {refs:["media:<id>"]}` — same lifetime and re-sign-on-403 rule as presigned R2 URLs |
| Range | Drive handles `Range` | The Worker forwards `Range` / `If-Range` to Drive with an OAuth access token it caches for 50 min, and streams the response body unchanged (no buffering) |
| Cost | Zero Worker requests per byte | One Worker request per range request (a 30-minute video with seeks ≈ 20–60 requests; well inside 100k/day) |
| Fallback | — | If the proxy test (Open question 2) fails, stay on Stage A |

**Folder IDs in the old public repo:** the old repo commits `frontend/assets/drive-config.json` with the
music and video folder IDs. With link sharing on, anyone who reads that file can list the owner's videos.
Removing it is in the old-repo clean-up ([MIGRATION](../../engineering/MIGRATION.md) §9), and Stage B is
the real fix (moving the files to a new, unshared folder also works, because files inherit the new
folder's sharing). This contradicts nothing in decisions, but note: decisions name **R2 presigned URLs**
as the private-media pattern; Stage B adds a second pattern for Drive and needs a decisions line.

Files Chrome refuses (MKV with AC-3/DTS, etc.) use Astra's engine as today, loaded on demand from
`/astra/`, including libmedia's software decoders (they stay with Astra by owner ruling 2026-10-28;
[ASTRA](ASTRA.md) §6).

### 2.4 Progress

| Rule | Value | Check |
|---|---|---|
| Local | IndexedDB `th-media` progress map, written every 5 s while playing and on pause/end/hide | Browser test |
| Server | `PUT /v1/media/progress/<id>` at most every 15 s while playing, and on pause, end and `visibilitychange → hidden` (keepalive) | API test |
| Watched | `t ≥ 93%` of duration or `ended` (kept from today) | Unit test |
| Resume | Only if 10 s < t < 93% (kept) | Unit test |
| Conflicts | Later `at` wins per video; a device's own newer local entry is never overwritten by an older server entry | Unit test |
| Mark watched / unwatched | Video menu; writes `done` and `at` | Browser test |

---

## 3. Screens

Later step, only if the owner agrees: rebuilt on the shell ([DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md));
behavior kept unless noted. Until then the ported screens stay exactly as they are.

| Screen | Contents |
|---|---|
| **Home** | Optional "For you" row (mind surface, §6.3) → Continue watching (up to 10) → Quick watches (12, ≤ 10 min, daily stable, round-robin by creator, unwatched) → Recently added → All videos (infinite list, 24 per page) with chips All / Unwatched / Under 10 min / Long watches (≥ 20 min) and the 7 sorts. Pull to refresh starts a catalog run; a thin line under the header shows "Checking Drive…" and then "3 new videos" or nothing. |
| **Creators** | Creators by latest video, each with count and newest thumbnail. |
| **Collections** | One per Drive subfolder; root first, then by name (numeric order). |
| **You** | Stats (watched count, hours, saved count), History, Saved, Queue. |
| **Watch** | Full / mini / full screen modes as today; speed (0.5, 0.75, 1, 1.25, 1.5, 1.75, 2); captions; Up next with **Autoplay next** (owner's setting, default on, kept); PiP; Media Session. |
| **Search** | §4. |
| **Empty / error** | No catalog yet: "Your videos will appear here after the first check of Drive." with **Check now**. Drive failing: the saved list stays, with the error line from §2.2. A video gone from Drive: "That video is no longer in your Drive folder." |

Images: YouTube thumbnails from `i.ytimg.com` (by YouTube ID) first, then the Drive sidecar image (Stage
A: by key; Stage B: through the ticket route), then Drive's `thumbnailLink`. The shell CSP's `img-src`
adds `https://i.ytimg.com` and `https://*.googleusercontent.com` **[note: this tells Google which IDs
are being browsed; accepted for now, Open question 4]**.

---

## 4. Search

| Rule | Value |
|---|---|
| Where it runs | On the phone, over the catalog snapshot (`GET /v1/media/catalog?since=<seq>` delta-synced into IndexedDB). Works offline. |
| Fields | title, creator, topics, collection name |
| Tiers (same rule as Music: never worse than plain search) | Tier 0: exact and prefix matches, accent-folded, all words present. Tier 1: typo-tolerant (uFuzzy, MIT). Tier 1 never reorders tier 0. |
| Debounce | 150 ms |
| Recent searches | Up to 12, stored on the phone only (`th-media` `searches`), clearable |
| Results | Videos (up to 50, then "Show more"), then Creators, then Collections |
| Sense | `media.search` with `{q_len, results}`; never the query text |

Check: a fixture catalog of 2,000 invented titles and a query list proving tier 0 results always appear
first and in the same order as plain substring search.

---

## 5. Migration of phone data

From the old site's export page ([MIGRATION](../../engineering/MIGRATION.md) §5):

| Old key | New home |
|---|---|
| `mymedia.progress.v1` | `video_progress` (server) + local |
| `mymedia.saved.v1` | `video_lists` `saved` |
| `mymedia.queue.v1` | `video_lists` `queue` |
| `mymedia.searches.v1` | local `th-media` searches |
| `mymedia.sort.v1`, `.speed.v1`, `.captions.v1`, `.autoplay.v1`, `.view.v1` | local preferences |
| `mymedia.library.v1` | **Not moved** (a cache; the Worker catalog replaces it) |

IDs are the same Drive file IDs, so no mapping is needed. Entries whose ID isn't in the new catalog are
kept for 30 days (the catalog may still be filling) and then dropped, with the count in the import report.
Check: invented export with 50 progress entries → 50 rows; 3 unknown IDs reported.

---

## 6. Senses, verbs, surfaces

### 6.1 Senses

| Type | When | `ref` | `data` | Sensitivity |
|---|---|---|---|---|
| `media.watch` | Pause, end, close, hide, and every 5 min while playing | `media:<id>` | `{pos_s, dur_s, delta_s, completed, speed}` | 0 |
| `media.open` | Watch page opened | `media:<id>` | `{from: "home"\|"search"\|"creator"\|"collection"\|"you"\|"verb"\|"upnext"}` | 0 |
| `media.save` / `media.unsave` | Saved toggled | `media:<id>` | `{}` | 0 |
| `media.queue` / `media.unqueue` | Queue changed | `media:<id>` | `{}` | 0 |
| `media.search` | Search run | — | `{q_len, results}` | 0 |

### 6.2 Verbs (`frontend/apps/media/verbs.js`)

| Verb | Args | Does | Undo |
|---|---|---|---|
| `media.open` | `{ref, at_s?}` | Opens the watch page **paused** at `at_s` (or the resume point). Same visibility rule as `astra.open`: navigate only if the owner is on Home or My Media and asked in the last 10 min; otherwise a "Ready in My Media" card. | `media.close` |
| `media.queue` | `{refs: [≤ 20]}` | Appends to the queue (skips duplicates) | `media.unqueue {refs}` |
| `media.save` | `{ref}` | Adds to Saved | `media.unsave` |

No verb starts playback or changes progress.

### 6.3 Surfaces

| Slot | Kind | Where |
|---|---|---|
| `media.home` | Arranged list of up to 10 videos with a one-line why ("under 20 minutes, from a creator you finished last week") | "For you" row on Home |
| `briefing.media` | "New in My Media: 3 videos" (since the owner last opened My Media) | Briefing page ([BRIEFING](../BRIEFING.md)) |

The mind reads the catalog through `th media search` / `th media get` (titles allowed inside the private
session, never in logs), plus `media.watch` events.

---

## 7. Where new videos come from

Today, something outside this app (yt-dlp, run by the owner or a helper) puts files into the Drive folder.
The new My Media only reads. **[proposal]** A later "Save this video" flow: share a YouTube link to the
installed app (share target) → a work order for Muse to archive it into the folder → the next catalog
run picks it up. Needs the owner's yes and a check of the source's terms ([IDEAS](../../process/IDEAS.md)).

---

## Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Who produces the files and `jarvis-video-metadata.json` today, and will it keep running? | Ask the owner; inspect the metadata file's newest `addedAt`. |
| 2 | Worker streaming a Drive video with Range on the Free plan (CPU per request, seek latency, 1-hour token renewal) | Spike in P8 with a synthetic test video in a test Drive folder; measure CPU ms per request and time-to-first-frame on the A15. Decides Stage B. |
| 3 | Size of the archive (videos, bytes) | First catalog run's counts. Moving it to R2 instead of Drive would cost money (ask first); only if Drive becomes unreliable. |
| 4 | Thumbnails from `i.ytimg.com` reveal browsed video IDs to Google | Owner decision; alternative is sidecar images only (slower, through Drive). |
| 5 | Whether Drive's API key download still works for large files on link-shared folders (abuse-scan interstitials) | Play the 5 largest files in Stage A on the A15. |
| 6 | Name | Settled: "My Media" is the new, more fitting name (owner, 2026-10-27). |
