# Migration: from the old system to the Thunderhead

How everything that matters moves from the old system (the Worker `jarvis-hub-api`, the old static site,
the old public repo) to the new one (`thunderhead-api`, the new site, the new repo) without losing a row,
and how the old system is then retired and cleaned up. It ends with a dated checklist.

## Rules at a glance

1. **Side by side, then import.** The new Worker never deploys over the old one. Data that matters is
   exported once from the old Worker and imported into the new one (decisions, Platform).
2. **The old Worker is the live backup** until every caller has switched. It is retired only after
   **zero callers for 7 days and an owner tap** on a retirement proposal.
3. **Every step that touches the old system is ask-first:** deploying the old Worker (logs, export),
   deploying anything to the old site (the export page), changing old repo files or visibility, deleting
   anything. Each is a Worker proposal the owner approves with a tap.
4. **Sign-in is never migrated.** No password hash, session, pairing or OAuth table is exported. The owner
   signs in fresh on the new site.
5. **Every import proves itself:** manifest counts equal imported counts, 20 random rows per dataset
   deep-equal after normalisation, and a re-run changes 0 rows.
6. **Nothing personal passes through public places:** no export or import runs in GitHub Actions; logs
   carry counts only.
7. **`jarvis-music` is shared, never copied and never deleted from.** The new Worker binds the same
   bucket.
8. **Phone-only data moves through an export page on the old site**, with counts the owner can compare.
9. **Old-repo clean-up and making it private are proposals the owner approves**, listed with exact paths.

---

## 1. What moves, in one table

| Dataset | From | To | When |
|---|---|---|---|
| Chats (threads, messages) | old DO instance `claude-chat-v1` (`cc_threads`, `cc_messages`) | `Core` threads/messages (filed, titled) | P3 |
| The old notebook | `claude-chat-v1` `cc_state['notebook']` | `Core` `imports` (raw), converted once by the mind into facts | P3 |
| Muse conversation, files, work history | `jarvis-shared-v2` `relay_mast_*` | `Core` Muse thread + closed work orders; files to `thunderhead-private/muse/files/` | P3 |
| Daily Board editions and profile | `jarvis-shared-v2` `shared_meta`, `shared_entries`, `shared_briefing_dates` | `thunderhead-private/board/<date>.json` + `Core` `board` index + settings | P3 |
| Chat file attachments | R2 `jarvis-music/chat/files/…` | copied to `thunderhead-private/chat/files/…` (originals stay) | P3 |
| Music catalog | `music-catalog-v1` (`music_tracks`, `music_log`, `music_state`) | `Music` DO ([MUSIC](../product/apps/MUSIC.md)) | P5 |
| Phone-local data (plays, ratings, playlists, prefs, guitar, podcasts, My Media, Astra) | the owner's phone, old origin | `POST /v1/import/phone` → each new app | P5 (one export covers all apps) |
| Error inbox | `claude-chat-v1` `cc_state['errors']` | **Not imported** [proposal]: it describes old pages | — |
| Sign-in | `relay_owner_*` credential tables | **Never** | — |
| Audio | R2 `jarvis-music/native/…` | shared in place | — |

---

## 2. Inventory of the old system

### 2.1 The old Worker

- Name `jarvis-hub-api`, one Durable Object class `Hub` (migration tag `v1`, SQLite), one binding `HUBS`,
  `keep_vars: true`, `observability.enabled: false` (no logs today).
- **72 tables** across named instances. Every table name below comes from the old `backend/*.js` code.

| Instance | Tables | Verdict | Action |
|---|---|---|---|
| `claude-chat-v1` | `cc_threads`, `cc_messages`, `cc_changes`, `cc_state` (notebook, listener lease, last wake, error inbox) | **Keep** threads, messages, notebook. Drop `cc_changes` (a feed), lease, wake. Error inbox: drop [proposal]. | Export all; import as §4. |
| `music-catalog-v1` | `music_tracks`, `music_log`, `music_state` | **Keep** all three. | Export; import in P5. |
| `jarvis-shared-v2` — Muse | `relay_mast_entries`, `relay_mast_files`, `relay_mast_file_rates`, `relay_mast_presence`, `relay_mast_work`, `relay_mast_work_events` | **Keep** entries, files, work, work_events. Drop rates and presence. | Export; import. |
| `jarvis-shared-v2` — Board | `shared_meta`, `shared_entries`, `shared_briefing_dates` | **Keep.** | Export; import. |
| `jarvis-shared-v2` — owner sign-in | `relay_owner_credentials`, `relay_owner_sessions`, `relay_owner_pairings`, `relay_owner_password_rates`, `relay_owner_pair_rates`, `relay_owner_credential_consents`, `relay_owner_session_audit`, `relay_owner_meta` | **Never exported** (secrets). | Row counts only in the manifest. |
| `jarvis-shared-v2` — owner messages and jobs | `relay_owner_entries`, `relay_owner_event_bodies`, `relay_owner_attachments`, `relay_owner_attachment_attempts`, `relay_owner_attachment_rates`, `relay_owner_assistant_attachment_targets`, `relay_owner_assistant_deliveries`, `relay_owner_jobs`, `relay_owner_job_changes`, `relay_owner_job_deadlines`, `relay_owner_job_events`, `relay_owner_job_refresh`, `relay_owner_job_result_corrections` | **Decide from counts** [proposal]: export all; import `relay_owner_entries` (+ bodies, attachments) only if the export shows owner-written messages not already in `cc_messages` or `relay_mast_entries`. Default: keep in the archive only. | Export to archive. |
| `jarvis-shared-v2` — old relay / events | `relay_events`, `relay_event_meta`, `relay_outbox`, `relay_outbox_recoveries`, `relay_subscriptions`, `relay_subscription_scans`, `relay_delivery_receipts`, `relay_activations`, `relay_core_alarm_wakes`, `relay_verified` | **Drop.** | Export to archive (cheap), never import. |
| `jarvis-shared-v2` — OAuth | `relay_oauth` | **Never exported** (tokens). | Counts only. |
| `jarvis-shared-v2` — agent board, projects, public coordination, publications | `board_activation`, `board_membership_history`, `board_memberships`, `board_messages`, `board_operations`, `board_tasks`, `project_bindings`, `project_events`, `project_grants`, `project_messages`, `project_recoveries`, `project_work`, `public_artifact_state`, `public_changes`, `public_coordination_events`, `public_import_hints`, `publication_recovery`, `publication_source_comments`, `publication_source_recovery`, `imported_comments` | **Drop.** | Export to archive, never import. |
| `jarvis-makima-v1` (+ diagnostics) | `makima_messages`, `makima_message_provenance`, `makima_oauth_diagnostics`, `makima_token_diagnostics` | **Drop.** Token diagnostics never exported. | Archive messages only. |
| Other names in code: connector-named objects (`connector.js`), the legacy `hash(PUBLIC_KEY)` inbox, `jarvis-coordination-v2`, `public-coordination-v2`, `jarvis-publication-v1` | Legacy | **Drop.** Verify during export whether each is a live instance (table counts > 0). | Archive if non-empty. |

Check: the export manifest lists every instance and table above with a row count, and the import report
lists, per dataset, `exported / imported / skipped (reason)`.

### 2.2 Worker variables and secrets (names only)

| Name | Used by | Fate |
|---|---|---|
| `CLAUDE_CHAT_AGENT_KEY` | `jc` | Retired with `jc` (P4). Used once more to run the export (§3). |
| `CLAUDE_ROUTINE_FIRE_URL`, `CLAUDE_ROUTINE_TOKEN` | wake | Replaced by the new Worker's own (P2). |
| `RELAY_OWNER_ENABLED`, `RELAY_MCP_ENABLED`, `RELAY_MAST_ENABLED`, `RELAY_MAST_TOKEN_SHA256`, `RELAY_MAST_WORK_ENABLED` | sign-in, Muse | Retire with the old Worker. |
| `MUSIC_ROOT_ID`, `MUSIC_PUBLIC_READ` (=`true`: audio is public today), `MUSIC_UPLOAD_PUBLIC_KEYS` | music | `MUSIC_PUBLIC_READ` off at the Music switch (ask first, [MUSIC](../product/apps/MUSIC.md)). |
| Makima, Lucy, project, board, `RELAY_GITHUB_*`, `RELAY_MAKIMA_*`, `RELAY_WEBHOOK_EGRESS_*`, `RELAY_AGENT_MUSE_TOKEN_SHA256`, `RELAY_BOARD_ENABLED` | dead systems | Deleted with the Worker. |

### 2.3 R2

| Bucket / prefix | Fate |
|---|---|
| `jarvis-music/native/audio/`, `native/art/`, catalog files | Shared by both Workers. Never deleted from (decisions). |
| `jarvis-music/chat/files/` | Copied to `thunderhead-private/chat/files/` by a new-Worker job (P3); originals left in place until the owner approves deleting them after retirement. |
| r2.dev public access on `jarvis-music` | Check now (owner, dashboard); turn off at the Music switch (ask first). |

### 2.4 Shared free-plan limits

Both Workers run on **one Cloudflare account**, so they share the Free plan's daily limits: 100,000
Worker requests, 100,000 Durable Object rows written, 5M rows read. Imports are scheduled so that
**old traffic + new traffic + import writes stay under 70% of each limit** (the watchdog threshold,
[OPERATIONS](OPERATIONS.md)). Bulk import jobs cap at 40,000 rows written per day ([JOBS](JOBS.md)).

### 2.5 Callers of the old Worker

| Caller | Routes it uses | Switches when |
|---|---|---|
| Old site pages: Chats | `/claude-chat/*`, `/relay/owner/*` (sign-in, Muse line) | The owner uses the new Home daily (P2–P3) |
| Old site: Daily Board reader | `/shared/state`, `/shared/board-draft` | Board folded into the Briefing (P8) |
| Old site: Music player (`claude-player`) | `/music/*` (library, audio, partial reads) | P5 |
| Old site: Podcasts | `/podcasts/search`, `/browse`, `/feed`, `/audio` (proxy) | P8 |
| Old site: Guitar | `/guitar/*` (tab sources and search proxy) | P6 |
| Old site: every page's error reporter | `POST /claude-chat/errors` | When its page retires |
| `jc` (the old CLI in Claude sessions) | `/claude-chat/*` agent ops | P4 (replaced by `th`) |
| Muse | `/relay/mast/*` (chat, files, work, Board publish) | P4 |
| Music upload tools (`scripts/upload-music-r2.py`, `music-upload-canary.py`, `manage-r2-library.py`) | `/music/uploads/*` (signed ops) | P5 |

---

## 3. The one-time export (old Worker deploy — ask first)

The old Worker has no export today (the old `scripts/backup-jarvis-storage.mjs` backs up the old *site*,
not the Worker). One deploy of the old repo's Worker adds it.

**The proposal the owner approves** (class `access`, because it changes a live system):
"Deploy the old Worker once more to turn on its logs and add a read-only export. It changes no data.
Rollback target: version <id>."

| Part of that deploy | Exact content |
|---|---|
| Logs | `observability.enabled: true` (gives the caller evidence for §8). |
| No new binding | The old Worker never gets `thunderhead-private` (decisions 2026-10-28: the export is **pulled**). |
| Route | `POST /ops/export/step {run_id, instance, table, cursor}` guarded by the existing agent key (`CLAUDE_CHAT_AGENT_KEY`, already in the Claude environment; no new secret). |
| Behaviour | Reads ≤ 2,000 rows of one table after `cursor` (by `rowid`) and **returns them** as one gzip JSONL part with headers `X-Rows`, `X-Next-Cursor`, `X-Sha256`. **Writes nothing anywhere.** Refuses the never-export tables (§2.1) with 403. |
| Driver | A script in the mind's session (`mind/jobs/old-export.mjs` [proposal]) loops the steps, posts each part unchanged to the new Worker's `POST /v1/ops/import/parts` (ci scope), which checks the SHA-256 and stores it at `imports/old/<run_id>/<instance>/<table>/part-<nnnn>.jsonl.gz` in `thunderhead-private`, then writes `imports/old/<run_id>/manifest.json`: `{run_id, worker_version, started_at, finished_at, instances: {<name>: {tables: {<table>: {rows, parts, columns, sha256s}}}}}`, including counts (only) for never-export tables. It prints counts only. |
| Version record | Before deploying: the current old Worker version ID and the old site's commit are written to [STATUS](../process/STATUS.md) as rollback targets. |
| Rollback | `wrangler rollback <previous version>` from the old repo's deploy workflow. No schema changes, so data is safe either way. |
| Wait | A Durable Object keeps old code for about 4 minutes after a deploy; the driver waits 5 minutes before the first step. |

Checks:
- Before deploy: a test in the old repo runs the step route against a local workerd with fixture tables
  and asserts: parts round-trip; never-export tables return 403; no `INSERT/UPDATE/DELETE` executed
  (rows written = 0).
- After the run: the manifest's table count equals the count of tables the old code creates (72) plus any
  extra live tables found; every `rows` equals `SELECT count(*)` read at the start of that table's export
  (± rows added during the export for live tables, which the second export in §8 catches).

---

## 4. Import jobs (new Worker)

All imports are chunked, resumable, idempotent upsert jobs on the target Durable Object's alarm
([JOBS](JOBS.md)), reading parts from `thunderhead-private/imports/old/<run_id>/`.

| # | Dataset | Mapping | Normalisation for spot checks |
|---|---|---|---|
| I1 | Threads | `cc_threads` → `threads` with `kind='imported'`, `filed_at` = last message time, original title kept, `day` from the first message in owner-local time | trim, ms timestamps |
| I2 | Messages | `cc_messages` → `messages` (role `owner`/`mind`; old Claude replies → `mind`), body unchanged, attachments rewritten to `thunderhead-private/chat/files/…` refs | body byte-equal |
| I3 | Notebook | `cc_state['notebook']` → `imports(kind='notebook', body, version, imported_at)` raw; the mind converts it once into facts (each fact cites `import:<id>` as evidence, source `user`) ([MEMORY](../mind/MEMORY.md)) | body byte-equal |
| I4 | Muse | `relay_mast_entries` → one `muse` thread's messages; `relay_mast_work` + `_events` → `work_orders` with `status` `done`/`expired`, `result_valid` NULL; `relay_mast_files` → file refs, bytes copied | ids, bodies |
| I5 | Board | each edition (v1 and v2 JSON) → `thunderhead-private/board/<date>.json` + `Core.board(date, r2_key, top_line)`; profile and draft → `settings` | edition JSON deep-equal |
| I6 | Chat files | copy job `jarvis-music/chat/files/*` → `thunderhead-private/chat/files/*` (R2 to R2 inside the Worker), verifying size and ETag | size + ETag |
| I7 | Music catalog (P5) | `music_tracks` → `Music.tracks` keeping track IDs and `native/audio/<sha256>.opus` keys; `music_log` → `catalog_log` | ids, sha256, title fields |

**Proof, per dataset** (the import test, decisions/plan §17):
1. `imported + skipped = manifest rows`, and every skip has a reason code (`duplicate`, `empty`,
   `invalid_ref`).
2. 20 random source IDs (chosen by the job with a seeded RNG; the seed is stored) deep-equal their imported
   rows after normalisation.
3. Running the import again changes 0 rows (the cost meter shows 0 rows written for that job).
4. Owner check on the phone: the menu shows the old chats filed by date with their titles; the 3 most
   recent old conversations open and read correctly; the Board history shows the last 7 editions.

Order and budget: I1–I6 run on day 1 of P3 (estimate well under 40,000 rows); I7 on its own day in P5.
Each job reports `{dataset, exported, imported, skipped, ms}` to the Ledger and to STATUS.

Failure: a job that fails 3 times in a row stops, records `last_error`, and shows a Home line "The import
of <dataset> stopped. Nothing was lost; the old system still has it." The old Worker is untouched, so the
fix is a code change and a re-run.

---

## 5. Phone-local data: the export page on the old site

Storage is per origin; the new site is a new origin, so nothing on the phone carries over by itself.

### 5.1 What is read (verified against the old code)

| App | Read | Not read (regenerated or re-downloaded) |
|---|---|---|
| Music (`claude-player`) | IndexedDB `claude-player`: store `tracks` (plays, last played, rating; **waveforms stripped**), store `state` (playlists, list memory). localStorage `cp-settings`, `cp-settings-tags`, `cp-list-opts`, `cp-search-history`, `cp-first-run` | IndexedDB `files` (imported local audio: count only, listed as "N phone-only songs to re-import"), `art`; `cp-audio-cache`, `cp-offline-ahead`, `cp-offline-retired`; all Cache Storage |
| Guitar | localStorage `jarvis.guitar.v2` (and `jarvis.guitar.library.v1` if still present) | — |
| Podcasts | localStorage `jarvis.podcasts.v1`; IndexedDB `jarvis-podcasts` store `feeds` | Cache `jarvis-podcast-audio-v1` (downloads) |
| My Media | `mymedia.progress.v1`, `.saved.v1`, `.queue.v1`, `.searches.v1`, `.sort.v1`, `.speed.v1`, `.captions.v1`, `.autoplay.v1`, `.view.v1` | `mymedia.library.v1` (a cache) |
| Astra | `astra.v2.*` as a `backup/1` object (`BACKUP_KEYS`) plus `astra.v2.player` | `astra-data-v1` cache |
| Chats | nothing (server data is imported; the device session is never migrated) | `chats.*`, `jarvis.relay.owner-session.v1` |

(Report 4 §7.2 listed seven My Media keys and no Music key names; this table is the corrected list.)

### 5.2 The page

- Path `/export/` on the old site, published as a **partial upload of only `export/*`** (the old repo
  already has partial publishers), so the rest of the old site is not redeployed. Ask first (old-site
  deploy).
- It shows counts before sending, e.g. "Music: 412 rated, 9 playlists, 7,000 play counts · Guitar: 37
  songs · Podcasts: 4 shows · My Media: 51 in progress, 12 saved · Astra: 4 add-ons, 37 saved, 6 in
  progress".
- Two buttons:
  1. **Download export (.json)** — the owner's own copy, always available, needs nothing new.
  2. **Send to Thunderhead** — asks for an **import code** made in the new app under Settings → Bring
     data from the old site [proposal]: 12 characters, valid 30 minutes, usable for one import, scope
     `import:phone` only. The owner never types their password on the old origin.
- Payload: JSON `{format: "th-phone-export/1", exported_at, device_label, apps: {music, guitar, podcasts,
  mymedia, astra}}`, sent gzip-compressed in chunks of at most 5 MB to `POST /v1/import/phone` with
  `Authorization: Bearer <import code>` and `{import_id, part, parts}`.
- Astra's add-on list is moved by the Worker into its sealed store on arrival and replaced in the stored
  import by a count ([ASTRA](../product/apps/ASTRA.md) §5).
- The Worker stores the raw import gzip at `thunderhead-private/imports/phone/<import_id>.json.gz` and an
  `imports` row with counts. Each new app seeds itself from it on first run and shows "Imported from the
  old site on <date>: <counts>."
- The **Settings → Import a file** path accepts the downloaded `.json` too (no CORS involved), so the
  data can always be moved even if the send path fails.
- Nothing on the old origin is cleared. After the owner confirms counts in the new apps, the old pages may
  show a "Moved to the Thunderhead" banner (another old-site partial publish, ask first).

Checks: a Playwright test seeds an old-origin fixture page with invented data in every key above, runs the
export, imports into a local new Worker, and asserts the counts in each new app; a second send with the
same code returns 410 `code_used`.

---

## 6. CORS for the old origin (temporary)

| Rule | Value |
|---|---|
| Where | New Worker, routes `OPTIONS` and `POST /v1/import/phone` **only** |
| Origin | The old site's exact origin, configured as the Worker var `OLD_SITE_ORIGIN` |
| Methods / headers | `POST`; `Authorization, Content-Type, Content-Encoding`; `Access-Control-Max-Age: 7200`; no credentials |
| Lifetime | Removed in the first deploy after **either** the owner confirms the phone import **or** 30 days after it was added, whichever is first. A test fails the build if the var is set and `OLD_SITE_IMPORT_UNTIL` (an ISO date) has passed. |
| Everything else | The old origin is rejected (403) on every other route. |

Check: route-scope test sends the old origin to every route and expects 403 except the two above.

---

## 7. Caller switch-over order

Each step is "done" only when the old route's traffic from that caller is zero in the old Worker's logs
for 3 consecutive days.

| Order | Caller | New target | How | Phase |
|---|---|---|---|---|
| 1 | **The site** (owner's daily use) | New site + `thunderhead-api` | The owner installs the new site and signs in. Old pages keep working on the old Worker until each app moves; nothing is cut early. | P1–P8 |
| 2 | **`jc` → `th`** | `GET /v1/live/wait`, `th` CLI | The mind's sessions use `th` with an agent token from Settings → Agents; `jc` stays installed but unused for 7 days, then the network secret for the old host is removed from the Claude environment (owner step). | P2 → retire in P4 |
| 3 | **Muse** | New address + a new Muse token (work orders, Board publish) | A written brief to Muse (reaching another agent is not "reaching people", but the brief is shown to the owner first); 7 days of overlap where the old `/relay/mast/*` still answers. | P4 |
| 4 | **Upload tools** | `/v1/music/uploads/*` with new signing keys | Change the tools' host and keys; one canary upload; verify the track appears in the new catalog. | P5 |
| 5 | **Old pages one by one** | — | Each old page is retired when its new app has been used for 7 days: Music (P5), Guitar (P6), Board, Astra, Podcasts, My Media (P8). | P5–P8 |
| 6 | **The hourly Drive catalog job** (old repo `publish-drive-catalog.yml`) | none | Disable the workflow when the old Music page retires (P5). It feeds only the old player. | P5 |

**Contradiction to resolve:** [ROADMAP](../process/ROADMAP.md) P4 says "the old Worker has had zero
callers for 7 days" at the end of P4. That can't hold: the old Music, Podcasts, Guitar and Board pages
call the old Worker until P5–P8. The retirement gate in §8 therefore falls **after P8**, not in P4.
Proposal: P4's "done when" becomes "`jc` and Muse have made zero calls to the old Worker for 7 days".

---

## 8. Retiring the old Worker

**Gate:** zero requests to the old Worker for **7 consecutive days**, then an owner tap.

| Step | Exact rule | Ask first? |
|---|---|---|
| 1. Evidence | Daily: the request count of the old Worker for the previous day, from the Cloudflare dashboard (owner glance) or from Workers Logs. Logs keep 3 days on Free until 2026-12-01 and 7 days after, so the count is read daily and written to STATUS (counts only). No Cloudflare credential ever goes into a session (decisions); if no automatic source exists, the owner reads the dashboard number once on day 7. [proposal] | No |
| 2. Final export | Run §3 again with a new `run_id`; diff its manifest against the first. Rows added since the first export (expected: new chats until P2, Muse until P4) are imported by re-running the idempotent jobs. | No (read-only, same deploy) |
| 3. Proposal | Home decision: "The old Worker has had no callers for 7 days. Its data is exported twice and imported. Retire it?" **Retire** / **Not yet**. | Yes (owner tap) |
| 4. Gone mode | Deploy a version of the old Worker that answers every route with `410 Gone` and `{"moved": true}` and removes the export route. Keep it 14 days. Reversible with `wrangler rollback`. | Covered by step 3 |
| 5. Delete | After 14 quiet days in gone mode: a second proposal "Delete the old Worker and its storage? This can't be undone. Both exports stay in your private storage." On tap: delete the Worker (its Durable Object storage goes with it), its secrets, and the old repo's Worker deploy workflow. | Yes (class `delete`) |
| 6. Old site | The old Azure site and storage account stay with a "Moved" page until the owner approves deleting the account (separate proposal, class `delete`). | Yes |
| 7. Leftovers | `jarvis-music/chat/files/` originals: proposal to delete after a verified copy (size + ETag). The old federated credential for the old repo in the Entra app registration: proposal to remove (class `access`). | Yes |

The two exports stay in `thunderhead-private/imports/old/` for good (included in backups).

---

## 9. Old repo clean-up (ask-first proposal)

The old repo is **public**. It contains material that must not be public. This section is the exact
proposal; nothing here is done without the owner's tap.

### 9.1 Files to remove from the old repo

| Path | Why |
|---|---|
| `frontend/claude-player/model/reference.json.gz` | Resource model extracted from the Poweramp APK (layouts, styles, dimensions, EQ presets) by `scripts/claude-player/extract-reference.mjs`. |
| `frontend/claude-player/model/auto-eq.json.gz` | Extracted from the Poweramp APK's `assets/auto_eq.db` by `scripts/claude-player/extract-auto-eq.mjs`. (The upstream AutoEq data is MIT; this copy came from the APK.) |
| `frontend/claude-player/fonts/tt-norms-pro-bold.otf`, `frontend/claude-player/fonts/tt-norms-pro-medium.otf` | TT Norms Pro, a commercial typeface. Its own `LICENSES.md` says "used in this **private** project under permission … not licensed for any other use"; the repo is public. |
| `frontend/drawercast/fonts/poweramp-norms-500.woff`, `frontend/drawercast/fonts/poweramp-norms-700.woff` | TT Norms derivatives (found by the fact-checker). |
| `frontend/drawercast/fonts/poweramp-manrope-400.woff`, `-500.woff`, `-800.woff` | Poweramp-named Manrope builds, apparently taken from the app. Manrope is OFL, but these copies carry no licence notice. |
| `frontend/claude-player/fonts/manrope3-regular.otf`, `-medium.otf`, `-extrabold.otf` | **Review:** "modified Manrope" with an OFL notice. Keep only if the source is upstream Manrope; remove if it came from the APK. |
| `frontend/assets/drive-config.json` | Commits the music and video Google Drive folder IDs. With link sharing on, anyone reading it can list the owner's files. |
| `scripts/claude-player/extract-reference.mjs`, `extract-auto-eq.mjs`, `arsc-nulls.mjs`, `xml.mjs`, `png.mjs` | Optional: the APK extraction tools (our code, not third-party material); removed for clarity. |
| `docs/poweramp-*.png`, `docs/poweramp-*.jpg`, `docs/evidence/poweramp-*` | **Review:** screenshots; remove any that show the real Poweramp app rather than our own page. |

### 9.2 How, without breaking the old site the owner still uses

1. One commit on a branch in the old repo removes the files; merged by the agent after the owner's tap.
2. **The old site is not redeployed in full afterwards** (a full deploy would drop the player's model and
   fonts and break the old Music page before P5). Until the old Music page retires, only partial
   publishes (the export page, the "Moved" banner) are allowed. A guard in the old repo's deploy workflow
   refuses a full deploy while `frontend/claude-player/model/reference.json.gz` is missing [proposal].
3. The files stay **live on the old site** (already uploaded) until the old Music page retires (P5); then a
   proposal deletes them from the old storage account.
4. **Removing files does not remove Git history.** The real fix is §10 (private). A history rewrite (force
   push) is not proposed: it is irreversible and making the repo private covers it.

### 9.3 Workflows in the old repo

| Workflow | Action | When |
|---|---|---|
| `publish-drive-catalog.yml` (hourly, cron `17 * * * *`) | Disable | P5 (old Music page retired). **Must be off before the repo goes private**: 720 runs a month at an estimated ~3 minutes each is about 2,000 minutes, the whole free private allowance [verify: Open question 5]. |
| `analyze-r2-audio.yml` | Disable now [proposal] | Uploads a report artifact; artifacts on a public repo are public. |
| Workflows uploading artifacts (`deploy-azure-storage.yml`, `deploy-music-worker.yml`, `migrate-music-r2.yml`, `publish-daily-board.yml`, `daily-board-reader-cutover.yml`, `qualify-jarvis.yml`) | Leave until private; run only with owner OK | Their artifacts are public while the repo is public. |
| `deploy-music-worker.yml` (deploys the old Worker) | Used for §3 and §8; deleted with the Worker | §8 step 5 |

---

## 10. Making the old repo private

- Proposal (class `access`), recommended **as soon as the hourly workflow is disabled** (§9.3), and at the
  latest when the old Worker is retired: "Make the old repo private. The old site keeps working; deploys
  from it keep working; Actions minutes become limited, which is fine once the hourly job is off."
- After it is private: archive it (read-only) once the old site is deleted.
- Check: `gh api repos/<owner>/<old repo>` shows `"private": true`; the old site still loads; the export
  bundle and both Worker exports are listed in STATUS.

---

## 11. Dated checklist

Dates are targets, set today (2026-10-28) from the [ROADMAP](../process/ROADMAP.md) phases; a step moves
when its phase moves. Ask-first steps are marked **[ask]**.

| Target date | Step | Done when |
|---|---|---|
| 2026-10-28 | Owner reads this doc; decisions on §9 (clean-up now?) and §10 (private when?) are requested **[ask]** | Answers in decisions.md |
| 2026-10-29 | Owner checks r2.dev public access on `jarvis-music` in the dashboard (read-only) | Result in STATUS |
| 2026-10-30 | Disable `analyze-r2-audio.yml` in the old repo **[ask]** | Workflow shows disabled |
| 2026-10-30 | §9.1 clean-up commit in the old repo (no full site redeploy afterwards) **[ask]** | Files absent from HEAD; old Music page still plays |
| P1 (≈ 2026-11-02 → 11-08) | New Worker live with CORS for the new site only | `/v1/health` green |
| P2 (≈ 2026-11-09 → 11-15) | `th` replaces `jc` in mind sessions; old Chats still work | 3 days on the new Home |
| P3 start (≈ 2026-11-16) | Old Worker deploy: logs on + read-only export route **[ask]**; record rollback version | Deploy green; 5-minute wait done |
| P3 (≈ 2026-11-16) | Run export #1; manifest written | Manifest counts = live counts |
| P3 (≈ 2026-11-17) | Imports I1–I6; chat files copied | Proof §4 passes; owner check passes |
| P4 (≈ 2026-11-23 → 12-06) | Muse switched (brief shown to owner first); `jc` unused 7 days, then its secret removed by the owner | Zero `/relay/mast/*` and `/claude-chat/*` agent calls for 7 days |
| 2026-12-01 | Workers Logs on Free change to 0.5 GB/day, 7-day retention | Note in OPERATIONS |
| P5 (≈ December) | Old-site `/export/` partial publish **[ask]**; import code in Settings; CORS for the old origin on one route | Owner confirms counts in every new app |
| P5 | Upload tools switched; I7 music catalog import; `MUSIC_PUBLIC_READ` off **[ask]**; hourly Drive workflow disabled **[ask]** | Canary upload visible in the new catalog |
| P5 + 7 days | Old Music page retired ("Moved" banner, partial publish **[ask]**); commercial fonts and APK model deleted from the old storage account **[ask]** | Old player unused 7 days |
| After P5 hourly job off | Make the old repo private **[ask]** | `private: true` |
| P6 | Old Guitar page retired | 7 days unused |
| P8 (≈ early 2027) | Old Board, Astra, Podcasts, My Media pages retired | 7 days unused each |
| P8 + 7 days | Zero callers for 7 days → export #2 → retirement proposal **[ask]** → gone mode (14 days) | Proposal approved |
| Gone mode + 14 days | Delete the old Worker and its storage **[ask]**; remove the old federated credential **[ask]**; propose deleting `jarvis-music/chat/files/` originals **[ask]** | Worker absent in the dashboard |
| Later | Delete the old storage account **[ask]**; archive the old repo | Old origin gone |

---

## 12. Things that can go wrong

| Failure | Response |
|---|---|
| The export deploy breaks something on the old Worker | `wrangler rollback` to the recorded version (§3); the export route is additive and changes no data. |
| Counts don't match | The import job stops; the old Worker still has everything; fix the importer; re-run (idempotent). |
| The phone export fails on the old origin | Use **Download export (.json)** and **Settings → Import a file** (no CORS). |
| The owner's phone storage was cleared before export | Only phone-only data is lost (ratings, playlists, prefs); server data is unaffected. The import report says what was missing. |
| Free-plan limits get close during imports | Jobs pause at their daily cap and continue the next day; the watchdog line names the job. |
| A caller reappears during gone mode (410s in logs) | Roll back to the export version, find the caller, switch it, restart the 7-day count. |

---

## Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Is there an automatic, credential-free way for the new system to read the old Worker's request count? | Ask whether the owner is fine reading the dashboard on day 7; otherwise add a counter in the old Worker's export deploy (costs DO writes on the shared account). |
| 2 | Do `relay_owner_entries` hold owner messages that exist nowhere else? | Counts and a 20-row sample in the export manifest review (inside the private session). |
| 3 | Are `jarvis-coordination-v2`, `public-coordination-v2`, `jarvis-publication-v1` live instances or schema tags? | The export driver lists non-empty instances. |
| 4 | Are `manrope3-*.otf` upstream Manrope or APK-extracted? | Compare glyph tables with upstream Manrope (fontTools) locally. |
| 5 | Actions minutes the old repo would use once private, with the hourly job off | Sum the last 30 days of run minutes per workflow from the Actions usage page. |
| 6 | Does a partial publish to the old site keep the rest of the old site byte-identical? | Diff the old storage listing (ETags) before and after the export-page publish. |
| 7 | Settled 2026-10-28: the export is pulled through the mind's session into the new Worker; the old Worker gets no new binding | — |
