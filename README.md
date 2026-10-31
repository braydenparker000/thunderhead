# Thunderhead

One personal app: a quiet chat home that knows everything on the platform, with the
apps (Music, Guitar, Podcasts, Astra, My Media, Study) one hold away.

## Layout

| Path | What it is |
| --- | --- |
| `frontend/` | The site. Plain HTML, CSS and JavaScript, no build step. |
| `backend/` | The Cloudflare Worker `thunderhead-api` (TypeScript). See [backend/README.md](backend/README.md). |
| `shared/` | Types only: the API contract, checked from the backend and the frontend. |
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
node scripts/test-part.mjs 1 3          # one of CI's three site-and-mind parts (checks.yml)
SITE_URL=https://<site> node --test tests/home-browser.test.mjs   # check the live site
```

## Release and rollback

The Worker deploys from the same workflow (job `api`, before `site`; off until
`WORKER_DEPLOY_ENABLED=true`), with a smoke check and `wrangler rollback` on failure; see
[backend/README.md](backend/README.md). The site:

- **Release:** push to `main`. The Deploy workflow tests (once, in four parallel jobs), publishes `frontend/` to the
  storage account's `$web` container, waits until the live `release.json` names the
  commit, and runs the browser checks against the live site.
- **Automatic rollback:** if the live check fails, the workflow puts the previous live
  commit back up and marks the run failed.
- **Manual rollback:** Actions → Deploy → Run workflow, with the commit to put live.
  Or revert the bad commit on `main`.
- **What's live:** `<site>/release.json`.

Deploys need these repository settings: secrets `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`,
`AZURE_SUBSCRIPTION_ID`; variables `AZURE_STORAGE_ACCOUNT`, `SITE_URL`,
`AZURE_DEPLOY_ENABLED=true`.

The Azure app registration trusts this repository through a federated credential
(issuer `https://token.actions.githubusercontent.com`, audience
`api://AzureADTokenExchange`). Repositories created after July 15, 2026 sign in with
GitHub's ID-based subject, `repo:<owner>@<owner_id>/<repo>@<repo_id>:ref:refs/heads/main`,
so the credential uses that exact subject. If sign-in ever fails, the Deploy run prints
the subject Azure has to trust.
