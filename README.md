# Thunderhead

One personal app: a quiet chat home that knows everything on the platform, with the
apps (Music, Guitar, Podcasts, Astra, My Media, Study) one hold away.

## Layout

| Path | What it is |
| --- | --- |
| `frontend/` | The site. Plain HTML, CSS and JavaScript, no build step. |
| `backend/` | The Cloudflare Worker (coming next). |
| `scripts/` | Tools: `serve.mjs` (local server, behaves like Azure), `stage.mjs` (release folder + budgets), `deploy.sh` (publish to Azure). |
| `tests/` | `node --test` suites: static checks and phone-size browser checks. |

## Commands

```sh
npm ci                                  # install (Playwright for the browser tests)
npx playwright install chromium         # once, if Chromium isn't installed
npm run serve                           # http://127.0.0.1:8080
npm test                                # everything
SITE_URL=https://<site> node --test tests/home-browser.test.mjs   # check the live site
```

## Release and rollback

- **Release:** push to `main`. The Deploy workflow tests, publishes `frontend/` to the
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
