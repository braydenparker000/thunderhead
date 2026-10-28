# Owner setup for P0 (phone, about 25 minutes)

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

## Later (not for P0)

When the Worker starts (P1): a Cloudflare API token with only **Workers Scripts: Edit** on the account, saved as the secret `CLOUDFLARE_API_TOKEN`, plus the account ID as the variable `CLOUDFLARE_ACCOUNT_ID`. The agent gives exact steps then.
