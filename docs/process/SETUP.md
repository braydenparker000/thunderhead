# Owner setup (P0: phone, about 25 minutes; later phases: sections G–L)

The one-time steps only the owner can do. Each step is one action. Labels are the ones the
Azure portal and GitHub showed in October 2026; if a label differs slightly, pick the closest.
Nothing here is secret except where it says so.

## A. GitHub repository (3 minutes)

1. Open `github.com/new`.
2. **Owner:** `braydenparker000` (an organization). **Name:** `thunderhead`. Choose **Public**.
3. Leave **Add README**, **.gitignore** and **license** all off. The prepared first build is pushed into an empty repository.
4. Tap **Create repository**.
5. Open `https://api.github.com/repos/braydenparker000/thunderhead` in the browser.
6. Write down the **first** `"id"` number near the top. That is the **repo ID**. Check that `"owner"` → `"id"` is `322498428`.
7. Open `github.com/organizations/braydenparker000/settings/installations` → **Configure** next to **Claude**.
8. If it says **All repositories**, go on. Otherwise add **thunderhead** under **Only select repositories** and tap **Save**.

## B. Azure storage account (10 minutes, portal.azure.com)

1. Search **Storage accounts** → **+ Create**.
2. **Subscription** and **Resource group:** the same ones the `missionarytube` account uses.
3. **Storage account name:** `thunderhead`. If it is taken, use `thunderheadsite` (any name starting with `thunderhead` works).
4. **Region:** (US) East US. **Preferred storage type:** Azure Blob Storage or Azure Data Lake Storage Gen 2.
5. **Performance:** Standard. **Redundancy:** Locally-redundant storage (LRS).
6. Leave every other tab at its defaults. Tap **Review + create**. Check that the summary shows no paid add-on such as Microsoft Defender for Storage. Tap **Create**, then **Go to resource**.
7. **Data management → Static website → Enabled.** Index document name: `index.html`. Error document path: `404.html`. **Save**.
8. Copy the **Primary endpoint** (it ends in `.web.core.windows.net/`).
9. **Overview** → copy the **Subscription ID**.
10. **Access control (IAM) → + Add → Add role assignment.**
11. Search **Storage Blob Data Contributor** → select it → **Next**.
12. **User, group, or service principal → + Select members** → search **MissionaryTube** → select it → **Select** → **Review + assign** → **Review + assign**.
13. Note the time: the role takes up to 10 minutes to start working.

## C. Let the new repository sign in to Azure (3 minutes)

1. Search **App registrations → All applications → MissionaryTube**.
2. **Overview:** copy the **Application (client) ID** and the **Directory (tenant) ID**.
3. **Certificates & secrets → Federated credentials → + Add credential.**
4. **Federated credential scenario:** **Other issuer** (not the GitHub option).
5. **Issuer:** `https://token.actions.githubusercontent.com`
6. If a choice appears, pick **Explicit subject identifier**.
7. **Subject identifier:** `repo:braydenparker000@322498428/thunderhead@REPOID:ref:refs/heads/main`, with the repo ID from A6 in place of `REPOID`.
8. **Name:** `thunderhead-main`. Leave **Audience** as it is. Tap **Add**.

Why "Other issuer": repositories created after July 15, 2026 sign in with an ID-based subject, and the GitHub option fills in the old name-only form, which would fail.

## D. Repository settings (5 minutes, the new repo → Settings)

1. **Secrets and variables → Actions → New repository secret** three times: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (values from C2 and B9).
2. **Variables** tab → **New repository variable:** `AZURE_STORAGE_ACCOUNT` = the name from B3.
3. **New repository variable:** `SITE_URL` = the Primary endpoint from B8.
4. **Actions → General:** under **Workflow permissions** choose **Read repository contents and packages permissions** → **Save**. Under fork pull request approvals choose **Require approval for all external contributors** → **Save**.
5. **Rules → Rulesets → New ruleset → New branch ruleset.** Name `main`, **Active**, leave the bypass list empty, **Add target → Include default branch**, tick only **Restrict deletions** and **Block force pushes**, tap **Create**.
6. When 10 minutes have passed since B13: **Variables → New repository variable:** `AZURE_DEPLOY_ENABLED` = `true`.

## E. Claude (2 minutes)

1. claude.ai/code → scheduled tasks → **Jarvis Claude** → **Edit** → **Repository** → add `braydenparker000/thunderhead` → **Save**.
2. claude.ai settings → **Usage**: check that usage credits / extra usage is **off**, so scheduled tasks can never run on paid overage.

## F. Tell the agent

Send "done" with the Primary endpoint URL. The agent pushes the first build and runs the first deploy. A green run means the site is live.

- Red at **azure/login**: the next step prints the exact subject Azure expects; compare it with C7.
- Red with **AuthorizationPermissionMismatch**: the role isn't active yet; wait 10 minutes and re-run.

## G. The Worker (P1, about 15 minutes)

1. dash.cloudflare.com → **Workers & Pages** → copy the **Account ID** and note your **workers.dev subdomain**. The API address will be `https://thunderhead-api.<subdomain>.workers.dev`.
2. **My Profile → API Tokens → Create Token → Custom token.** Name `thunderhead-deploy`. Permissions: **Account · Workers Scripts · Edit**, nothing else. Account resources: only your account. No IP filter, no expiry. **Create** and copy it (shown once).
3. GitHub, the repo → **Settings → Environments → New environment** `worker`. **Deployment branches and tags → Selected branches and tags → Add** `main`. No reviewers.
4. In `worker`: secret `CLOUDFLARE_API_TOKEN` (from G2). Variables: `CLOUDFLARE_ACCOUNT_ID` (G1), `SITE_ORIGINS` (the Primary endpoint from B8 without the trailing `/`), `WORKER_BOOTSTRAP` = `true`.
5. **Secrets and variables → Actions → Variables → New repository variable** twice: `WORKER_URL` = the API address from G1 (a repository variable, not in `worker`, because the site's deploy needs it too: it turns sign-in on), and `WORKER_DEPLOY_ENABLED` = `true`.
6. Tell the agent "worker ready". The agent runs Deploy with target `api`. This first run makes `AUTH_PEPPER` and `IP_HASH_KEY` inside the run (nobody ever sees them) and sets every other Worker secret to `none` ([OPERATIONS.md §5.1](../engineering/OPERATIONS.md)).
7. When the run is green, delete `WORKER_BOOTSTRAP` from the `worker` environment. From then on a run that finds no live Worker fails instead of making a new pepper.

## H. First sign-in (P1, phone, about 5 minutes)

1. Open `<site>/setup/` and tap **Copy** next to the setup fingerprint (`thfp_…`).
2. The repo → **Settings → Secrets and variables → Actions → New repository secret** `TH_SETUP_FINGERPRINT` = the fingerprint.
3. **Actions → Open setup → Run workflow** (branch `main`, `clear` off). Wait for green.
4. Back on `/setup/`: **I've done that**, then a username and a password (let Chrome suggest one; 15+ characters) and save it when Chrome offers.
5. Write the recovery code on paper and type its last 5 characters.
6. Run **Open setup** again with `clear` on (it sets the Worker secret back to `none`), then delete the `TH_SETUP_FINGERPRINT` secret.

## I. Keys for CI and the mind (P1, Settings → Agents)

1. **New agent key**, role **CI**, name `ci` → copy → GitHub environment `worker` → secret `TH_CI_TOKEN`.
2. claude.ai/code → environments → new environment `th-chat` with the values in [RUNTIME.md §7](../mind/RUNTIME.md) (allowed hosts: the API host, the site host, `api.github.com`, plus the default package list; variables `TH_ROLE=chat`, `TH_API`, `TH_SITE`, `NODE_USE_ENV_PROXY=1`, `BASH_MAX_TIMEOUT_MS=7200000`; setup script `cd /home/user/thunderhead && npm ci --ignore-scripts`: the script runs as root outside the repository, so `~` is `/root`). The **API key goes in the environment's network secret for the API host, never in the variables**: variables are readable inside the session.
3. **New agent key**, role **Mind · chat**, name `mind-chat` → paste it at once into `th-chat` as the network secret for the API host (`Authorization: Bearer <key>`); it is shown once.
4. Tell the agent; it checks from a `th-chat` session that the key reaches `/v1/ops/health/deep` (P1 "done when").

## J. Apps ported as they are (P1b)

1. Approve the proposal "Let the new site's apps use the old Worker until their data moves" ([MIGRATION.md §6](../engineering/MIGRATION.md)).
2. Approve the proposal to create the private bucket (R2 storage can cost money above the free 10 GB-month), then Cloudflare → **R2 → Create bucket** `thunderhead-private`, location Automatic, Standard; leave public access and the r2.dev address off. Tell the agent; it adds the Worker's `VAULT` binding.
3. Approve the old-site `/export/` publish. Then on the phone: old site `/export/` → **Download export**; new site `/import/` → pick the file → compare the counts.

## K. The mind's chat (P2)

1. claude.ai/code/routines → **New**: `mind-chat` exactly as [RUNTIME.md §2](../mind/RUNTIME.md) says (repository `thunderhead` only, environment `th-chat`, no connectors, the saved prompt word for word, trigger **API**). Copy its trigger URL and token.
2. Cloudflare → **Workers & Pages → thunderhead-api → Settings → Variables and Secrets**: set `ROUTINE_CHAT_URL` and `ROUTINE_CHAT_TOKEN` (each replaces its `none`) → **Deploy**.
3. Tell the agent; it fires the task once and checks the claim.

## L. Night shift and import (P3)

1. Environment `th-night` (as I2 with `TH_ROLE=night`) with a **Mind · night** key `mind-night`; task `mind-night` as K1 plus the schedule `CRON_TZ=<your time zone> 7 6 * * *`; secrets `ROUTINE_NIGHT_URL` and `ROUTINE_NIGHT_TOKEN` as K2.
2. Approve the old-Worker export deploy ([MIGRATION.md §3](../engineering/MIGRATION.md)).
3. For the export run only: in the existing Claude environment that already reaches the old Worker with `CLAUDE_CHAT_AGENT_KEY`, add the API host to its allowed hosts with a network secret holding a new **Mind · chat** key named `import-once`. When the import report is green, revoke `import-once` and remove the host.
