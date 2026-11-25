# Migration: retiring the old Worker

The data has moved from the old system (the Worker `jarvis-hub-api`, the old static site, the old
public repo): it was exported and imported, and the ported apps call the new Worker. What is still
live is retiring the old Worker, below. The rest of the migration spec (what moved, the inventory, the
export and import jobs, the as-is port, the caller switch-over, the old repo's clean-up and making it
private, which are ask-first proposals not yet made, and the dated checklist) is kept with its section
numbers in [archive/MIGRATION.md](../archive/MIGRATION.md); code comments that cite "MIGRATION.md §2"
to "§7" or "§9" to "§12" mean that file.

Rules that still hold: the old Worker is the live backup until it is retired; every step that touches
the old system is ask-first; `jarvis-music` is shared and never deleted from (AGENTS.md).

---

## 8. Retiring the old Worker

**2026-11-25: the owner deleted the old Worker (`jarvis-hub-api`).** Its share of the Free plan's daily rows is no longer kept back from this Worker's budget (`shared/contract/meter.ts`).

**Gate:** zero requests to the old Worker for **7 consecutive days**, then the owner's approval (a tap or their own words).

**Nothing on the site sends a request to the old Worker (2026-11-22).** Live it still had 60 to 100 an
hour while Music was in use. Every path that could reach it, and what closed it:

| Path | Now |
|---|---|
| Music's worker answering "not ready" (signed out, no catalog, no signing key, the bucket refusing a fresh link, a frame home didn't open) by asking the old Worker, then for 5 minutes | The player gets the refusal as it is (its status and plain words, `{error}`); any other address on that origin is a 404. Every request to the origin is the worker's to answer (`frontend/th/music/bridge.js`). |
| Music's page before its worker controls it (a first visit, a reload that skipped it, a worker that failed to install) asking the old Worker's URLs directly | On the site (https) the player starts only once its worker controls the page; a reload that skipped it reloads once more; if the worker can't run, the page says "Music couldn't start. Close it and open it again." (`music/src/library/r2.js`). |
| Music and Podcasts signed out | The sign-in door, `/signin/?next=…`, as the site's other pages. |
| Podcasts' worker answering "not ready" by asking the old Worker; its page before the worker controls it | The app's addresses are this site's own (`/podcasts/search`, `/browse`, `/feed`, `/audio`), so nothing can leave for the old origin; the page waits for its worker; refusals come back in the app's shape (`frontend/th/podcasts/bridge.js`, `podcasts/app.js`). |
| Guitar's sources falling back to the old Worker (signed out, a refusal) | The new Worker's `/v1/guitar/` only; signed out the source is unavailable with its own message; a refusal is shown as it is (`guitar/sources.js`). |
| Error reports signed out (to `/claude-chat/errors`) | Dropped (`assets/error-report.js`). |
| The CSPs of My Media and Guitar | No longer name the old origin: the browser itself refuses it. |

The names stay where they are keys: the player's library addresses, under which its offline copies and
song heads are kept (so copies made before still play), and Guitar's samples in its cache
(`assets/config.js`). **Music's CSP still names the old origin**, because a page's CSP is checked before
its service worker sees a request: dropping it would refuse the player's own addresses, which its worker
answers. Removing it means giving the player addresses on this site and moving its offline copies to
them. `tests/old-worker-browser.test.mjs` fails on any request to the old origin.

**What remains before the gate can start counting:** the old Worker's own traffic. About 12 requests an
hour come at all hours, with no one using the site: most likely its own scheduled job (a cron trigger)
or another caller outside this site (the old site, Muse). Find it in the old Worker's dashboard (its
triggers and the requests' paths); a cron stops only with an old-Worker change (ask first). Check that
Muse uploads to the new Worker only (the repository's uploader, `scripts/music/upload.py`, does). Nothing has been deleted or
switched off: retiring the old Worker is the owner's own decision, below.

| Step | Exact rule | Ask first? |
|---|---|---|
| 1. Evidence | Daily: the request count of the old Worker for the previous day, from the Cloudflare dashboard (owner glance) or from Workers Logs. Logs keep 3 days on Free until 2026-12-01 and 7 days after, so the count is read daily and written to STATUS (counts only). No Cloudflare credential ever goes into a session (decisions); if no automatic source exists, the owner reads the dashboard number once on day 7. [proposal] | No |
| 2. Final export | Run the one-time export ([archive §3](../archive/MIGRATION.md#3-the-one-time-export-old-worker-deploy--ask-first)) again with a new `run_id`; diff its manifest against the first. Rows added since the first export (expected: new chats until P2, Muse until P4, the ported apps' server data until their moves) are imported by re-running the idempotent jobs. | No (read-only, same deploy) |
| 2b. Deferred tables | The tables the driver counted only as too large to post (its `deferred` list: base64 BLOBs, such as `jarvis-shared-v2/relay_owner_attachments`) are archived to `thunderhead-private/imports/old/` in byte-bounded parts before the old Worker goes. **Follow-up:** that needs the old export's step to take a row limit (an old-Worker change and deploy, ask first), so the driver can ask for fewer rows than 2,000 until a part fits in 25 MiB. Until then those rows stay in the old Worker, which keeps them. | Yes (old-Worker deploy) |
| 3. Proposal | Home decision: "The old Worker has had no callers for 7 days. Its data is exported twice and imported. Retire it?" **Retire** / **Not yet**. | Yes (owner approval: tap or own words) |
| 4. Gone mode | Deploy a version of the old Worker that answers every route with `410 Gone` and `{"moved": true}`, removes the export route and drops the new site's origin from `FRONTEND_ORIGINS`. Keep it 14 days. Reversible with `wrangler rollback`. | Covered by step 3 |
| 5. Delete | After 14 quiet days in gone mode: a second proposal "Delete the old Worker and its storage? This can't be undone. Both exports stay in your private storage." On tap: delete the Worker (its Durable Object storage goes with it), its secrets, and the old repo's Worker deploy workflow. | Yes (class `delete`) |
| 6. Old site | The old Azure site and storage account stay with a "Moved" page until the owner approves deleting the account (separate proposal, class `delete`). | Yes |
| 7. Leftovers | `jarvis-music/chat/files/` originals: proposal to delete after a verified copy (size + ETag). The old federated credential for the old repo in the Entra app registration: proposal to remove (class `access`). | Yes |

The two exports stay in `thunderhead-private/imports/old/` for good (included in backups).

---

## Open question

| # | Question | How to settle |
|---|---|---|
| 1 | Is there an automatic, credential-free way for the new system to read the old Worker's request count? | Ask whether the owner is fine reading the dashboard on day 7; otherwise add a counter in the old Worker's export deploy (costs DO writes on the shared account). |
