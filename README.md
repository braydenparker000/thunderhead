# Thunderhead

One personal app: a quiet chat home that knows everything on the platform, with the
apps (Music, Guitar, Podcasts, Astra, My Media, Study) one hold away.

## Layout

| Path | What it is |
| --- | --- |
| `frontend/` | The site. Plain HTML, CSS and JavaScript, no build step. |
| `backend/` | The Cloudflare Worker `thunderhead-api` (TypeScript). See [backend/README.md](backend/README.md). |
| `shared/` | The API contract: its types, checked from the backend and the frontend, and the data and code all sides must agree on (the route table, zod schemas, the phrase lint, the report cleaner), copied for the phone and the mind by `scripts/contract.mjs`. |
| `scripts/` | Tools: `serve.mjs` (local server, behaves like Azure), `stage.mjs` (release folder + budgets), `deploy.sh` (publish to Azure); `music/upload.py` (the owner's music upload tool, signed with a key that stays on the owner's computer; needs Python 3 with mutagen, openssl, and ffmpeg for `--analyze`; SETUP.md N4). |
| `tests/` | `node --test` suites: static checks, the contract check, phone-size browser checks. |

## Commands

```sh
npm ci                                  # install (workspaces: root + backend)
node scripts/fonts.mjs                  # fetch Switzer from Fontshare (not kept here: its licence forbids a public repository)
npx playwright install chromium         # once, if Chromium isn't installed
npm run serve                           # the site: http://127.0.0.1:8080
npm run dev                             # the Worker, local workerd: http://127.0.0.1:8787
npm test                                # everything (site, contract, backend on workerd)
node scripts/test-part.mjs 1 4          # one of CI's four site-and-mind parts (checks.yml)
node scripts/test-part.mjs --measure    # re-time every file into scripts/test-durations.json (the parts' deal)
SITE_URL=https://<site> node --test tests/home-browser.test.mjs   # check the live site
```

## Photos' RAW engine

`engine/photos` is a small Rust crate (LightCraft's decoders, pinned, with our memory patches); its
build is committed in `frontend/photos/engine/` with hashes in `engine/photos/build.json`. To rebuild after
changing it: Rust with the `wasm32-unknown-unknown` target and the `rust-src` component
(`rustup component add rust-src`), and `wasm-bindgen-cli` 0.2.129, then `node scripts/photos-engine.mjs`
(it checks LightCraft out at the pinned commit into `engine/photos/vendor/`, applies the patch, builds
twice, binds and records the hashes), then update the engine line in `scripts/stage.mjs` to the two
modules' total. The second build is `threads/`: the same stable rustc rebuilding its std with atomics
(`-Z build-std` through `RUSTC_BOOTSTRAP=1`, shared memory capped at 1 GiB) for wasm-bindgen-rayon. `node scripts/photos-engine.mjs --check` checks
the committed files. Details: [engine/photos/README.md](engine/photos/README.md).

## Before you push

`npm run preflight` is the one command (about a minute): it rewrites the contract copies, then runs the
type check, the contract check, the site budgets (`stage.mjs`), the Worker's static and line-cap tests
and the mind's tests. Run it again after merging `origin/main`: those are the checks a merge most often
breaks. `npm test` stays the full suite.

## Release and rollback

The Worker deploys from the same workflow (job `api`, before `site`; off until
`WORKER_DEPLOY_ENABLED=true`), with a smoke check and `wrangler rollback` on failure; see
[backend/README.md](backend/README.md). The site:

- **Release:** push to `main`. The Deploy workflow tests (once, in five parallel jobs; skipped when Test already
  passed on exactly the merged files), publishes `frontend/` to the
  storage account's `$web` container, waits until the live `release.json` names the
  commit, and runs the browser checks against the live site.
- **Automatic rollback:** if the live check fails, the workflow puts the previous live
  commit back up and marks the run failed.
- **Manual rollback:** Actions → Deploy → Run workflow, with the commit to put live.
  Or revert the bad commit on `main`.
- **What's live:** `<site>/release.json`.

**Rolling the Worker back across Core step 32 (memory provenance, 2026-11-03).** The schema stays (steps
only add), but a Worker from before it ignores the `provenance` column: its profile and briefing then
take facts labelled `outside` (written after reading outside text, waiting for the owner's Keep) in as
the owner's, and a confirm or supersede it writes leaves a `user` row with no label, which reads as the
owner's own once the newer Worker is back. Roll back across it only for a real outage, keep it short,
and after rolling forward review Settings › Memory (Learned from outside, and the facts written while
the older Worker ran); [MEMORY.md §6](docs/mind/MEMORY.md#6-provenance-and-taint-rules-worker-enforced).

Deploys need these repository settings: secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`; variables `AZURE_STORAGE_ACCOUNT`, `SITE_URL`,
`AZURE_DEPLOY_ENABLED=true`.

The Azure app registration trusts this repository through a federated credential
(issuer `https://token.actions.githubusercontent.com`, audience
`api://AzureADTokenExchange`). Repositories created after July 15, 2026 sign in with
GitHub's ID-based subject, `repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main`,
so the credential uses that exact subject. If sign-in ever fails, the Deploy run prints
the subject Azure has to trust.
