# Sign-in

This doc defines how the owner gets into the Thunderhead and stays in: every screen, flow, timing, copy line and error.
It covers one account (the owner's), owner devices, and keys for agents (the mind, Muse, CI).
The threat model, token formats and secrets are in [../engineering/SECURITY.md](../engineering/SECURITY.md). What happens to data is in [../engineering/PRIVACY.md](../engineering/PRIVACY.md).

Fixed by [../process/decisions.md](../process/decisions.md): username + password, no passkeys, no pairing, never another device (owner ruling). Opaque bearer token, no cookies. scrypt N=2^15, r=8, p=3 plus a pepper, inside the `Auth` Durable Object, confirmed by test X3. No Cloudflare or Azure credential in a Claude session. Device-key proofs, token rotation and step-up re-entry are deferred for v1.

## Rules at a glance

1. One account. Username + password from any browser, on any device, with nothing else needed.
2. A device stays signed in until it has been idle for **90 days**, the owner signs it out, or the password or recovery path signs everything out.
3. Wrong passwords slow down; they never lock the account. A stranger can never make the owner wait more than **30 s**.
4. The only error for a bad sign-in is "That username and password don't match." It never says which part was wrong.
5. One **recovery code** (25 characters) resets the password. It is shown once, works once, and a new one is shown right after it is used.
6. If both the password and the recovery code are lost, a **reset ticket** works only after **24 h**, and every signed-in device can cancel it. Nobody needs a Cloudflare credential to start one.
7. First-time setup needs a **setup fingerprint** that only the owner can install, from the phone. A fresh Worker can never be claimed by whoever reaches it first.
8. Signing out (one device, others, or all) never asks for the password and takes effect within **60 s**.
9. Signing out wipes every private thing the device cached. App code and the theme choice stay.
10. Agent keys are made in **Settings → Agents** on a signed-in device. Each key is shown once.
11. Security notices (new device, password changed, reset pending) appear on Home on every other signed-in device. Their push text is always generic.
12. The forms work with password-manager autofill: stable `id`/`name`, correct `autocomplete`, both fields on one page.

---

## 1. Words used here

| Word | Meaning |
|---|---|
| Account | The single credential row: username, password hash, recovery code hash. |
| Session | One signed-in browser storage on one device. It has an id (public handle) and a token (secret). |
| Device | What the owner sees in the device list. One session = one row. An installed Android app and Chrome on the same phone share one session (§13). |
| Agent key | A long-lived token for the mind (roles `chat`, `night`, `reflex`), Muse or CI. Not a session. |
| Recovery code | 25 Crockford base32 characters, written on paper. Resets the password once. |
| Setup code / reset code | 25-character codes made **in the browser** during setup or reset. They never leave that browser except as a fingerprint hash, and finally in the one request that uses them. |
| Fingerprint | `thfp_` + base64url(SHA-256(code)), where code is the 25 characters as made (upper case, no hyphens); 48 characters. Safe to paste anywhere: it can't be turned back into the code. |
| Notice | A security message the `Auth` object creates for the owner's other devices. |

## 2. Pages and routes

Sign-in pages are small standalone documents, not part of the Home shell, so they load fast, need no private data, and carry the strictest CSP ([SECURITY.md §4](../engineering/SECURITY.md)). Each is a real file (storage hosting has no SPA fallback).

| Path | File | Shown when |
|---|---|---|
| `/signin/` | `frontend/signin/index.html` | No valid session. The shell sends the browser here with `location.replace('/signin/?next=<path>')`. |
| `/setup/` | `frontend/setup/index.html` | `GET /v1/auth/state` says `setup: "open"`. `/signin/` redirects here in that state. |
| `/recover/` | `frontend/recover/index.html` | "Forgot password?" link. Two tabs: recovery code, reset ticket. |
| `/settings/password/` | stub into the shell's Settings app | Change password. Target of `/.well-known/change-password` (§12). |
| Settings → Sign-in & devices | shell | Device list, sign-out buttons, new recovery code. See [MENU-AND-SETTINGS.md](MENU-AND-SETTINGS.md). |
| Settings → Agents | shell | Agent keys. |

Rules:
- `next` is accepted only if it starts with `/` and not `//`; otherwise Home. Acceptance: `/signin/?next=//evil.example` lands on `/` after sign-in.
- All sign-in pages refuse to show inside a frame (frame guard, [SECURITY.md §4.3](../engineering/SECURITY.md)).
- All three pages work in the installed app; the manifest `scope` is `/`, so they never open in a Custom Tab.

## 3. State machines

### 3.1 Account (server, `Auth` object)

```
            setup with matching fingerprint
 UNCLAIMED ───────────────────────────────▶ ACTIVE ◀──────────────────────────────┐
 (no credential;                              │  reset ticket requested            │ cancelled from any device,
  /setup open)                                ▼                                    │ or expired after 72 h unused
                                         RESET_PENDING ──(24 h pass)──▶ RESET_READY ┘
                                              │                          │ ticket used at /recover/
                                              └──────────────────────────┴──▶ ACTIVE (all sessions revoked,
                                                                                  new recovery code)
```

- There is no transition back to UNCLAIMED from inside the product. A full reset of the account means wiping the `Auth` object, which is an ask-first operation ([SECURITY.md §14.10](../engineering/SECURITY.md)).
- In UNCLAIMED, every auth endpoint except `GET /v1/auth/state` and `POST /v1/auth/setup` answers `409 setup_required`.

### 3.2 Session (server)

| State | Enters when | Leaves to |
|---|---|---|
| `active` | Sign-in, setup or recovery succeeds on this device | `revoked` (sign-out, password change with "sign out others", recovery, reset, device cap), `expired` (90 days idle) |
| `revoked` | As above; the row keeps `revoked_reason` | Row deleted 30 days later |
| `expired` | `now > last_seen_at + 90 d` (checked on use and by a daily sweep) | Row deleted 30 days later |

`revoked_reason` ∈ `signed_out_here`, `signed_out_elsewhere`, `password_changed`, `recovery_used`, `reset_used`, `device_limit`. Within those 30 days a request with the old token gets `401` with that reason, so the device can say why. After 30 days it gets plain `401 unauthorized`.

### 3.3 Client (each browser)

```
 BOOT ──read IndexedDB th-auth──▶ no token ─────────────▶ SIGNED_OUT (/signin/)
   │                              token ──▶ SIGNED_IN (works offline from cache)
   │                                           │ any 401 session_* / unauthorized
   │                                           ▼
   │                                        WIPING (§11) ──▶ SIGNED_OUT with reason line
 SIGNED_OUT ──submit──▶ SUBMITTING ──200──▶ SIGNED_IN (store token, go to next)
                           │ 401 ──▶ SIGNED_OUT + error line
                           │ 429 ──▶ WAITING(retry_at) ──countdown 0──▶ SIGNED_OUT (button live again)
                           │ network/5xx ──▶ SIGNED_OUT + "couldn't reach" line
```

- While SIGNED_IN, the app never checks the token on a timer. It learns about revocation on its next API call, or from a `signout` push once Web Push exists (§11.3).
- Acceptance: a unit test drives the client state machine through every arrow with a fake API.

---

## 4. First-time setup (once, from the phone)

**Why a fingerprint:** the Worker URL is public (the repo is public). Without a secret that only the owner controls, a stranger could set the first password. Decisions forbid putting Cloudflare credentials in a Claude session, and an unauthenticated "issue a setup ticket" endpoint would recreate the race. So the owner proves control by installing a fingerprint through a channel only they hold: GitHub (which already deploys the Worker) or the Cloudflare dashboard. **[proposal]**

### 4.1 Screens

**S1. `/setup/` — "Set up the Thunderhead"**
- On load the page calls `GET /v1/auth/state`. If `setup: "done"`, it redirects to `/signin/`.
- It makes a setup code with `crypto.getRandomValues` (25 Crockford base32 characters), keeps it in IndexedDB `th-setup` on this device (so a reload doesn't lose it), and shows only the fingerprint.
- Copy:
  - Title: "Set up the Thunderhead"
  - Body: "This happens once. First, prove this is your project. Then choose a username and password."
  - Box label: "Setup fingerprint" — value `thfp_…` (monospace, wraps) — button "Copy".
  - "Do one of these:"
    - "**GitHub** (easiest): add a repository secret named `TH_SETUP_FINGERPRINT` with this value, then run the **Open setup** workflow." Two links: the repo's new-secret page and the workflow page (from `config.js`, not personal).
    - "**Cloudflare dashboard**: Workers → thunderhead-api → Settings → Variables and Secrets → Add → Secret, name `AUTH_SETUP_FP`, value as above → Deploy."
  - Button: "I've done that"
  - Small link: "Start over with a new fingerprint" (deletes `th-setup` and makes a new code).
- "I've done that" calls `GET /v1/auth/state?fp=<fingerprint>` every 5 s for up to 10 min. The answer `setup_fp: "ready" | "missing" | "mismatch"` drives the line under the button:
  - `missing`: "Waiting for the fingerprint to arrive… (this can take a minute after the workflow finishes)"
  - `mismatch`: "A different fingerprint is installed. Copy this one again, or start over."
  - `ready`: go to S2.
  - After 10 min: "Still not there. Check that the workflow run is green, then tap I've done that again."

**The Open setup workflow** (`.github/workflows/auth-setup.yml`, `workflow_dispatch` only, job `environment: worker`, which only `main` can use) **[proposal]**
1. Reads secret `TH_SETUP_FINGERPRINT`. Fails unless it matches `^thfp_[A-Za-z0-9_-]{43}$`.
2. Pipes it to `wrangler secret put AUTH_SETUP_FP` on stdin. It never echoes the value; it prints only "Setup fingerprint installed (ends …<last 4>)".
3. Writes nothing else. The same workflow with input `clear: true` pipes the literal `none` instead (never `wrangler secret delete`: the name is listed in `secrets.required`, so a deleted secret would block every later deploy). The Worker treats an unset value, an empty value and `none` alike: `setup_fp: "missing"`, `409 setup_fp_missing`. The first Worker deploy sets it to `none` ([OPERATIONS.md §5.1](../engineering/OPERATIONS.md)).

**S2. "Choose your sign-in"**
- Fields (one form, §12 markup): Username (`autocomplete="username"`), New password (`id="new-password"`, `autocomplete="new-password"`, show/hide toggle).
- Hint under the password: "At least 15 characters. A long phrase works well, or let your password manager make one."
- Button: "Create account".
- Request: `POST /v1/auth/setup {setup_code, username, password, device}`. The server checks, in order:
  1. A credential already exists → `410 setup_done`.
  2. `AUTH_SETUP_FP` not set → `409 setup_fp_missing`.
  3. `SHA-256(setup_code)` ≠ fingerprint → `401 setup_code_wrong` (5 tries per source per hour, then `429`).
  4. Username rules: 3–32 characters after NFKC + lowercase + trim, only `a–z 0–9 . _ -` → else `422 username_invalid`. **[proposal]**
  5. Password rules (§9.2) → `422 password_*`.
  6. Creates the credential, the recovery code and this device's session in one transaction. Records the fingerprint as used, so it can never set up again.
- Response: `{token, session_id, recovery_code}`.

**S3. "Your recovery code"** (§7.1 screen, first-time variant).

**S4. "You're in"**
- Copy: "You're in. Next, give the mind its key so it can work for you." Buttons: "Set up the mind" (→ Settings → Agents → New key, role chat) and "Later" (→ Home).
- Line at the bottom: "You can now delete the `TH_SETUP_FINGERPRINT` secret in GitHub, or run Open setup with clear."

### 4.2 Rules
- The first session after setup gets **no** new-device notice (there is no other device).
- `/v1/auth/setup` answers `410 setup_done` forever after success, even if the secret is still set.
- Local development uses `.dev.vars` (git-ignored) with `AUTH_SETUP_FP` = the fingerprint of a fixed dev code that lives only in test fixtures.

### 4.3 Acceptance
- With no `AUTH_SETUP_FP`, setup returns `409 setup_fp_missing`, and no credential row exists.
- With a fingerprint of code A, setup with code B returns `401 setup_code_wrong`.
- After success, a second setup with the same code returns `410 setup_done`.
- The Open setup workflow log contains no `thfp_` value except the last 4 characters (CI greps its own log in a test run with a dummy value).
- On the phone: setup to Home in under 3 minutes, with no laptop.

---

## 5. Sign in

### 5.1 Screen `/signin/`

- Title: "Thunderhead" (Fraunces italic is reserved for the Thunderhead's voice, so the title is Inter; see [../design/DESIGN-SYSTEM.md](../design/DESIGN-SYSTEM.md)).
- Fields: Username, Password (with Show/Hide). Button: "Sign in". Link: "Forgot password?" → `/recover/`.
- A `reason` query parameter shows one line above the form (copy in §11.2).
- If offline (`navigator.onLine === false` or the request fails with a network error): "You're offline. Signing in needs a connection." The button stays enabled.

### 5.2 What happens on submit

1. The client sends `POST /v1/auth/login {username, password, device}` with `credentials: 'omit'`, a 15 s timeout, and header `TH-Client: <release>`.
   - `device` = `{platform, browser, model?, standalone}` from `navigator.userAgentData` (Chromium: `getHighEntropyValues(['model','platformVersion'])`) or the UA string; `standalone` from `matchMedia('(display-mode: standalone)')`.
2. The button reads "Signing in…" and is disabled. Fields stay editable.
3. The Worker checks the origin (exact allowlist), rejects bodies over 4 KB, and calls `Auth.login()`.
4. `Auth`:
   1. Checks back-off (§6). Too early → `429 rate_limited` with `retry_after` (seconds) and `scope` (`source` or `account`). An early attempt is **not** counted and does not extend the wait. **[proposal]**
   2. Commits the attempt to the throttle table **before** hashing, so a crash still counts it.
   3. Runs scrypt + HMAC against the stored record, or against a dummy record when the username doesn't match, so timing is the same.
   4. Compares with `crypto.subtle.timingSafeEqual` and requires an exact username match.
   5. Failure → `401 wrong_username_or_password`.
   6. Success → resets this source's counter; upgrades the hash if its stored parameters are below current; creates the session; creates a `new_device` notice for the other active sessions; returns `{token, session_id, idle_days: 90}`.
5. The client stores `{session_id, token, signed_in_at}` in IndexedDB `th-auth`, calls `navigator.storage.persist()`, and in Chromium calls `navigator.credentials.store(new PasswordCredential({id: username, password}))` so Google Password Manager offers to save after a fetch-based sign-in. Then `location.replace(next || '/')`.

Typical time on the phone: ~0.3–0.8 s (about 235 ms of scrypt plus the network). Acceptance: p95 under 1.5 s on the owner's phone over 20 sign-ins, measured once at P1.

### 5.3 Copy for results

| Result | Line under the button (live region, polite) | Fields |
|---|---|---|
| 401 wrong | "That username and password don't match." | Both kept; the password is selected so typing replaces it. |
| 3rd wrong in a row on this device | Same line, plus the "Forgot password?" link turns accent-coloured. | |
| 429 source | Button becomes "Try again in 8 s" (countdown, §6.2). Line: "Too many tries from here. Wait a moment." | Editable |
| 429 account | Button "Try again in 30 s". Line: "Too many tries on this account. Wait a moment." | Editable |
| Timeout (15 s) | "That took too long. Check your connection and try again." | Kept |
| Network error | "Can't reach the Thunderhead right now. Check your connection." | Kept |
| 503 `auth_unavailable` or a non-JSON 5xx (e.g. Cloudflare error 1102 or 1027 pages) | "Sign-in is having trouble on our side. Try again in a minute." | Kept |
| 409 `setup_required` | Redirect to `/setup/`. | — |
| 426 `client_outdated` | "A newer version is ready." with a "Reload" button that reloads past the service worker. | — |

---

## 6. Wrong password and back-off

### 6.1 Numbers (no lockout)

| Counter | Free tries | Then | Longest wait | Resets |
|---|---|---|---|---|
| Per source: HMAC of the IPv4 /32 or IPv6 /64 with a daily key | 5 | wait 2^(n−5) s after failure n: 2, 4, 8, 16 … | 15 min | A success from that source, or 24 h with no failure |
| Account-wide (all sources together) | 20 failures in a rolling 24 h | at most 1 attempt every 30 s, all sources together | 30 s | Any success |
| Recovery code, reset code, setup code (each) | 5 per source per hour; 20 failures in a rolling 24 h account-wide | Per source: wait until the hour window ends. Account-wide: after failure n ≥ 20, wait min(30 s × 2^(n−20), 5 min): 30 s, 60 s, 120 s, 240 s, then 300 s | 1 h per source; 5 min account-wide (never a day) | Per source: window end. Account-wide: a success, or 24 h after the window's first failure |
| Password check inside Settings (change password, new recovery code, new agent key) | 5 per session | 2^(n−5) s | 15 min | Success. Never touches the account-wide counter, so an attacker can't block the owner's own signed-in phone. |

- Worst case for the owner: a stranger spraying guesses makes the owner wait at most **30 s** on a fresh source.
- Worst case for an attacker: about 2,900 guesses a day across all sources against a password of 15+ characters that passed a breach check.
- Acceptance (backend tests on real workerd with a fake clock):
  - 5 failures from source A, then the 6th is rejected for 2 s with `retry_after: 2`; an attempt at 1 s gets `429` and the wait is still 1 s.
  - Failure 6 then waits 4 s, failure 7 waits 8 s, and the wait never exceeds 900 s.
  - 20 failures spread over sources B–U, then a correct password from source V within 30 s of the last failure gets `429 scope: account` with `retry_after ≤ 30`.
  - A success from source A clears A's counter and the account counter.

### 6.2 Countdown UI
- The button shows the remaining time and is disabled. Format: under 60 s, "Try again in 8 s"; 60 s or more, "Try again in 2:08".
- The countdown uses `retry_after` from the response body (not `Retry-After` alone) and `performance.now()`, so changing the phone's clock doesn't affect it.
- It ticks once a second. Screen readers hear it only at the start ("Too many tries from here. You can try again in 8 seconds.") and at the end ("You can try again now.").
- When it reaches 0 the button reads "Sign in" again. Nothing is submitted automatically.
- If the page reloads during a wait, the next attempt gets `429` with the true remainder, and the countdown resumes.
- Acceptance: Playwright with a mocked 429 `retry_after: 3` shows "Try again in 3 s", then 2, then 1, then "Sign in", and the button is disabled throughout.

---

## 7. Recovery code

### 7.1 Format and screens
- 25 characters from the Crockford base32 alphabet (`0–9`, `A–Z` without `I L O U`), 125 bits from `crypto.getRandomValues`.
- Shown as five groups: `7KQ2M-XW4TR-9DHPA-3NB6E-QY8VC` (example only).
- Typed input is forgiving: case-insensitive; spaces and hyphens ignored; `O`→`0`; `I` and `L`→`1`; `U` is invalid.
- Stored as `HMAC-SHA256(AUTH_PEPPER, "recovery:" + normalized)`. A 125-bit secret needs no slow hash.
- **Screen "Your recovery code"** (after setup, after recovery or a reset, and after "New recovery code"):
  - Title: "Your recovery code"
  - Body: "Write this down on paper and keep it somewhere safe. It's the only way back in if you forget your password. You won't see it again."
  - The code, large, monospace, with its five groups.
  - No Copy button. Clipboard history can sync to the cloud. **[proposal]**
  - Confirm field: "Type the last 5 characters to confirm you saved it" (`autocomplete="off"`, `autocapitalize="characters"`, `spellcheck="false"`). Button "Continue" is enabled only when they match. **[proposal]**
  - Leaving the page without confirming: the code is still valid (it was already stored). Settings → Sign-in & devices then shows "You haven't confirmed your recovery code. Make a new one." until the owner makes and confirms a new code.

### 7.2 New recovery code (Settings → Sign-in & devices)
- Button "Make a new recovery code". A sheet asks for the current password (`autocomplete="current-password"`). **[proposal: inline password check; see §15]**
- `POST /v1/auth/recovery-code {current_password}` → `{recovery_code}`. The old code stops working at once.
- Then the "Your recovery code" screen.
- Acceptance: after regeneration, the old code returns `401 wrong_username_or_code`, and the new one works once.

---

## 8. Forgot password (recovery code)

**Screen `/recover/`, tab "I have my recovery code"**
- Fields: Username, Recovery code, New password (`id="new-password"`, `autocomplete="new-password"`). Button "Reset password".
- `POST /v1/auth/recover {username, code, new_password, device}`.
- On success the server, in one transaction:
  1. sets the new password (rules §9.2);
  2. marks the recovery code used;
  3. revokes **every** session (`revoked_reason = recovery_used`) and deletes their push subscriptions, after queuing a generic "You were signed out of Thunderhead" push to them (§11.3);
  4. creates this device's session;
  5. creates a new recovery code;
  6. records `auth.recovery_used` in the ledger.
- Agent keys are **not** revoked. Home shows a notice: "Your password was reset. Check your agent keys." with a button to Settings → Agents. **[proposal]**
- Then "Your recovery code" (the new one), then Home.
- Errors: `401 wrong_username_or_code` ("That username and recovery code don't match."), `429` (§6), `422 password_*`.
- Acceptance: after recovery, every other session's next request returns `401 session_revoked` with `reason: recovery_used`, and the used code fails.

## 9. Passwords

### 9.1 Change password (`/settings/password/`)
- Fields: hidden Username (`autocomplete="username"`, value pre-filled, so the password manager updates the right entry); Current password (`autocomplete="current-password"`); New password (`autocomplete="new-password"`, show/hide; no confirm field).
- Checkbox: "Sign out all other devices", **checked by default**.
- Button: "Change password".
- `POST /v1/auth/password {current_password, new_password, sign_out_others}`.
- On success: the credential version goes up; if the box was checked, other sessions are revoked with `password_changed`; if it wasn't, they get a `password_changed` notice instead. The form is cleared and replaced by "Password changed." so the password manager records the update.
- Errors: `401 current_password_wrong` ("That's not your current password."), `422 password_same` ("That's your current password. Choose a new one."), plus §9.2.

### 9.2 Password rules (setup, change, recovery)
| Rule | Error code | Copy |
|---|---|---|
| 15–128 characters after NFKC normalization | `password_too_short` / `password_too_long` | "Use at least 15 characters." / "Use at most 128 characters." |
| Doesn't contain the username or "thunderhead" (case-insensitive) | `password_guessable` | "Don't use your username or the app's name in it." |
| Not in Have I Been Pwned (k-anonymity range query; see [PRIVACY.md §5](../engineering/PRIVACY.md)) | `password_breached` | "This password has appeared in a data breach. Choose another." |
| Different from the current one (change only) | `password_same` | as above |

- Any Unicode, spaces allowed, no composition rules, no forced periodic change.
- If the breach service doesn't answer within 2 s, the password is accepted and Settings shows "We couldn't check your password against known breaches. Check now." **[proposal]**
- The sign-in form never applies `minlength`, so an old valid password can always be typed.

---

## 10. Both lost: the reset ticket (break-glass)

For when the owner has neither the password nor the recovery code. It is the one access change that doesn't need a tap on a signed-in device, because there may be none. The 24 h delay and the cancel button replace that tap.

### 10.1 Starting a reset
**Screen `/recover/`, tab "I've lost it too"**
- Copy: "You can reset with a reset ticket. It takes 24 hours, and any device that's still signed in can cancel it."
- The page makes a reset code (same format as §7.1), keeps it in IndexedDB `th-recover` on this device, and shows:
  - "Reset fingerprint" `thfp_…` + "Copy"
  - "Reset code (write it down if you might switch devices)" — hidden behind "Show".
- "Start it one of these ways:"
  1. "**Ask the mind in Claude Code**: open a Claude Code session and say: *Start a Thunderhead reset with fingerprint thfp_…*"
  2. "**GitHub**: add a repository secret `TH_RESET_FINGERPRINT` with this value and run the **Request reset** workflow."
- The page then calls `GET /v1/auth/state?reset_fp=<fp>` every 30 s while open and shows the state (§10.3).

**Path 1: the mind's endpoint** — `POST /v1/auth/breakglass {fingerprint}`
- Accepted only with an agent key of role `chat` (403 for every other principal, owner sessions included).
- The mind may call it **only** when the owner asks for it in a live Claude Code session and gives the fingerprint in their own words. It never calls it on its own, from a wake, from the Thunderhead chat, or because any other text asks. This rule belongs in [../mind/CONSTITUTION.md](../mind/CONSTITUTION.md).
- The mind never sees the reset code, only its hash, so even a hijacked session can't use a ticket it starts.
- Responses: `201 {ticket_id, usable_after, expires_at}`; `409 reset_already_pending`; `429` if 3 tickets were requested in the last 30 days **[proposal]**; `409 setup_required`.

**Path 2: GitHub** — `.github/workflows/auth-reset.yml` (`workflow_dispatch`, `environment: worker`) pipes `TH_RESET_FINGERPRINT` into the Worker secret `AUTH_RESET_FP`, exactly like Open setup. `Auth` notices a new `AUTH_RESET_FP` value on its next call or on the 15-minute cron, and opens a ticket with `requested_at` = the moment it first saw it. **[proposal]**

### 10.2 The wait and cancel
- `usable_after = requested_at + 24 h`; `expires_at = usable_after + 72 h`.
- Every active session gets a `reset_pending` notice. It is red and sits on Home until acted on:
  - "Someone asked to reset your password. It can be used after {weekday} {HH:MM}. **Cancel it**" · secondary "That was me" (hides it on this device only; it doesn't cancel).
  - "Cancel it" needs only a valid session: `POST /v1/auth/breakglass/cancel {ticket_id}`. It voids the ticket for good, and the same fingerprint can never open another ticket.
- Push (once Web Push exists): "A password reset was requested for Thunderhead." Held until 06:30 local if it falls in quiet hours (owner ruling), so the owner always has at least 15.5 waking hours to cancel.
- The ledger records `auth.reset_requested`, `auth.reset_cancelled` or `auth.reset_used`.

### 10.3 Using it
The `/recover/` page, reset tab, shows by state:
| State | Copy |
|---|---|
| Not seen yet | "Waiting for the ticket. Ask the mind, or run the workflow." |
| Pending | "Your reset will be ready {weekday} {HH:MM} ({N} h {M} min). Any signed-in device can cancel it." |
| Cancelled | "This reset was cancelled from a signed-in device. If that wasn't you, start again." |
| Ready | The form: Username, Reset code (filled from `th-recover` if present), New password. Button "Reset password". |
| Expired | "This reset expired. Start a new one." |

Using it follows §8 exactly (sign everyone out, new recovery code, notice to check agent keys), with `revoked_reason = reset_used`. Throttle: 5 tries per source per hour.

### 10.4 Acceptance
- A ticket used at 23 h 59 min returns `425 reset_not_ready` with `usable_after`; at 24 h 00 min it works.
- A cancel from any session makes later use return `410 reset_cancelled`.
- A `night`, `reflex`, `muse` or `ci` key, or an owner session, calling `POST /v1/auth/breakglass` gets `403 forbidden`.
- The `reset_pending` notice appears on every active session within one request.

---

## 11. Sessions, devices and sign-out

### 11.1 Device list (Settings → Sign-in & devices)
Each row (current device first, marked **This device**):
- Line 1: the label, editable inline (≤40 characters). Default: `<model or platform> · <browser>[ app]`, e.g. "Android phone · Chrome app", "Windows · Edge". Model codes are shown as given (e.g. a model number) until renamed.
- Line 2: "{Region}, {CC}" from Cloudflare's `request.cf` at sign-in, then the last country seen, marked "approximate". Never a city. If unknown: "Location unknown".
- Line 3: "Signed in {d MMM} · {last active}". Last active: "active now" (this hour), "active today", "yesterday", "{N} days ago" (≤30), else "{d MMM}".
- Button "Sign out" on each row (none on This device; see below).

Under the list:
- "Sign out of this device"
- "Sign out all other devices"
- "Sign out everywhere" (confirm sheet: "Sign out everywhere, including this phone?" · "Sign out" · "Cancel")

Rules:
- None of these ask for the password. They take effect within 60 s everywhere (the Worker's validation cache).
- Each revoke deletes that session's push subscription in the same transaction, after queuing the generic sign-out push (§11.3).
- The server caps active sessions at 50. Sign-in #51 revokes the session idle longest, with `device_limit`. **[proposal]**
- `last_seen_at` is written at most once an hour per session (row-write budget).
- Acceptance: signing out device B from device A makes B's next request return `401 session_revoked, reason: signed_out_elsewhere` within 60 s.

### 11.2 Expiry and revocation on the device
Any API response `401` with code `session_expired`, `session_revoked` or `unauthorized` moves the client to WIPING (§11.3), then to `/signin/?reason=<reason>`, which shows:
| reason | Line above the form |
|---|---|
| `expired` | "You were signed out after 90 days away. Sign in again." |
| `signed_out_here` | (no line) |
| `signed_out_elsewhere` | "This device was signed out from another device." |
| `password_changed` | "Your password was changed on another device. If that wasn't you, use your recovery code now." + link "Use recovery code" |
| `recovery_used` / `reset_used` | "Your password was reset, so every device was signed out. If that wasn't you, use your recovery code now." |
| `device_limit` | "This device was signed out because too many devices were signed in." |
| `unauthorized` | "Please sign in." |

### 11.3 What signing out wipes
Run in this order, for owner sign-out on this device and for any revocation the device learns about:
1. Stop audio and capture; clear Media Session; revoke object URLs.
2. Unsubscribe the push subscription.
3. Delete IndexedDB `th-auth` and `th-data` (conversation cache, briefing, surfaces, outbox, personal settings, the music index and play state).
4. Delete every Cache Storage cache except code caches (`th-<release>`, `th-vendor`).
5. Empty the Origin Private File System (offline songs, podcast downloads, Study PDFs).
6. Remove `localStorage` keys starting `th.p.`. Keep `th.ui.` keys (theme and other non-personal UI choices).
7. Post `signed_out` on BroadcastChannel `th-auth` so other tabs wipe and go to `/signin/`; tell the service worker to drop its in-memory token.

- **Owner sign-out with things pending:** if the outbox has unsent items or offline files exist, a confirm sheet first: "Sign out of this phone? {N} unsent messages and {size} of offline files will be removed." · "Sign out" · "Cancel".
- **Offline sign-out:** the wipe happens at once; the token is kept in a `pending_signout` record (and nothing else) until the revoke request succeeds, then deleted.
- **Remote revocation while the phone is off or offline:** the private data stays on the phone until it next reaches the API. Once Web Push exists, revocation also sends `{"k":"signout"}`; the service worker runs the wipe on receipt and shows "You were signed out of Thunderhead." **[proposal]**
- Not wiped: app code, fonts, the `th.ui.` keys, and the browser's password-manager entry (the browser owns it).
- Acceptance (Playwright): after sign-out, `indexedDB.databases()` has neither `th-auth` nor `th-data`; `caches.keys()` contains only code caches; the OPFS root has no entries; a second open tab lands on `/signin/` within 1 s.

### 11.4 Notices on Home
Notices are created by `Auth`, never by the mind, and only owner sessions can acknowledge them. They appear on Home as a system card in the conversation, with the bottom edge glowing gold (a decision is waiting) until acknowledged. The exact card styling is in [HOME.md](HOME.md). **[proposal: card form]**

| Kind | Who sees it | Card text | Buttons | Ends |
|---|---|---|---|---|
| `new_device` | Every other active session | "New sign-in: {label} · {Region, CC} · {today HH:MM}" | "Not me — sign it out" (revokes that session at once, no dialog) · "That was me" | Acknowledged on any device, or 14 days |
| `password_changed` | Other sessions left signed in | "Your password was changed on {label} at {HH:MM}." | "Not me — sign out everywhere" · "OK" | Ack or 14 days |
| `recovery_used` / `reset_used` | The new session | "Your password was reset. Check your agent keys." | "Agent keys" · "OK" | Ack |
| `reset_pending` | Every active session | §10.2 | "Cancel it" · "That was me" (this device only) | Cancel, use or expiry |
| `reset_cancelled` | Every active session | "The password reset was cancelled from {label}." | "OK" | Ack or 7 days |
| `agent_key_created` | Every other active session | "A new agent key '{name}' ({role}) was made on {label}." | "Not me — revoke it" · "OK" | Ack or 14 days **[proposal]** |

- No notice for the very first session after setup, and none to the device that caused it.
- Push text (once Web Push exists) is always generic: "New sign-in to Thunderhead", "Your Thunderhead password was changed", "A password reset was requested for Thunderhead". See [PRIVACY.md §8](../engineering/PRIVACY.md).
- Acceptance: signing in on device B creates exactly one `new_device` card on device A and none on B; "Not me — sign it out" on A revokes B.

---

## 12. Password-manager markup

```html
<form id="signin" method="post" action="/signin/" novalidate>
  <label for="username">Username</label>
  <input id="username" name="username" type="text" autocomplete="username"
         autocapitalize="none" autocorrect="off" spellcheck="false" required>
  <label for="current-password">Password</label>
  <input id="current-password" name="password" type="password"
         autocomplete="current-password" required>
  <button type="button" id="show" aria-pressed="false"
          aria-label="Show password as plain text. Warning: this will display your password on the screen.">Show</button>
  <button type="submit">Sign in</button>
  <a href="/recover/">Forgot password?</a>
</form>
```

- `id` and `name` never change: Google Password Manager keys on them.
- Both fields on one page. Paste works. No confirm fields anywhere.
- New-password fields: `id="new-password"`, `name="new-password"`, `autocomplete="new-password"`. Chrome then offers a generated strong password.
- Recovery and reset code fields: `autocomplete="off"`, `autocapitalize="characters"`, `spellcheck="false"`.
- Submit handlers call `preventDefault()` and use `fetch`. After success, Chromium calls `PasswordCredential.store`, then navigates (both help the save prompt).
- Saved passwords belong to the **origin**. `/.well-known/change-password/index.html` sends the browser to `/settings/password/` with a `<meta http-equiv="refresh">` (storage hosting can't send a redirect; test T7).
- Acceptance: on the owner's phone, Google Password Manager offers to save after the first sign-in, fills both fields next time, and updates the entry after a password change.

## 13. Installed app vs browser tab

| Platform | Storage | Result |
|---|---|---|
| Android, Chrome tab and the installed app | Shared (same origin, same Chrome profile) | One session. Signing in either signs in both; signing out either signs out both. One row in the device list, labelled "… app" if it last signed in from the installed app. |
| iPhone, Safari and a Home Screen app | Separate | Two sessions, two rows. Safari may delete storage after 7 days without a visit unless the site is installed. |
| Desktop browsers | Per browser profile | One session per profile. |

- Installing the app after signing in needs no new sign-in on Android.
- Google Password Manager autofill works the same in the installed app.
- Acceptance: sign in in a Chrome tab on the phone, open the installed app: it opens signed in, and the device list shows one row.

## 14. Moving from the old site

- The new site is a new origin with a new account. Nothing from the old sign-in is imported; old device tokens and agent secrets are never reused ([MIGRATION.md](../engineering/MIGRATION.md)).
- The owner sets the new password once during setup (§4), preferably the strong one Chrome offers, and saves it in the password manager. The old entry stays tied to the old origin and is deleted when the old site is retired.
- The old site keeps its own sign-in until it is retired.
- The one-time phone-data export never signs in to the new Worker from the old origin. The old site's `/export/` page only downloads a file; the owner opens it in the new site's `/import/` page, which restores the data on the new origin and uploads the raw copy with the normal device token ([MIGRATION.md §5](../engineering/MIGRATION.md)). The new Worker's CORS never allows the old origin.

## 15. Deliberate departures and proposals to confirm

- **Inline password check** for "New recovery code" and "New agent key". Decisions defer *step-up* (a 10-minute re-entry window held on the session). This is narrower: the password goes in the same request, and no session state is kept. Both actions hand out a credential, so a phone left unlocked shouldn't be enough. **[proposal]**
- **Reset ticket UI in v1.** The architecture review moved the break-glass UI to P4. This doc ships the endpoint, the GitHub path, the `/recover/` reset tab and the cancel notice together in P1, because an endpoint without a cancel button loses its safety. **[proposal]**
- **The review's `POST /v1/auth/setup-ticket`** ("allowed only while no credential exists") is replaced by the fingerprint (§4). Without authentication, that endpoint lets the first caller claim the account.

## 16. Auth endpoints

All under `/v1/auth/`. Public = no token. Full shapes go in [API.md](../engineering/API.md); this table is the source for behavior.

| Method and path | Who | Body → response |
|---|---|---|
| `GET state[?fp=…][&reset_fp=…]` | public | → `{setup: "open"|"done", setup_fp?: "ready"|"missing"|"mismatch", reset?: "none"|"pending"|"ready"|"cancelled"|"expired"|"used", usable_after?}` (reset fields only when `reset_fp` matches a ticket) |
| `POST setup` | public | `{setup_code, username, password, device}` → `{token, session_id, recovery_code}` |
| `POST login` | public | `{username, password, device}` → `{token, session_id, idle_days}` |
| `POST recover` | public | `{username, code, new_password, device}` (code = recovery or reset code) → `{token, session_id, recovery_code}` |
| `GET me` | owner | → `{session_id, label, notices[], recovery_confirmed}` |
| `POST signout` | owner | `{scope: "this"|"others"|"all"}` → `204` |
| `GET sessions` | owner | → `{items:[{id, label, platform, browser, standalone, region, country, last_country, signed_in_at, last_seen_at, this_device}]}` |
| `PATCH sessions/:id` | owner | `{label}` → `200` |
| `DELETE sessions/:id` | owner | → `204` (also `204` if already gone) |
| `POST password` | owner | `{current_password, new_password, sign_out_others}` → `{token?}` |
| `POST recovery-code` | owner | `{current_password}` → `{recovery_code}` |
| `POST recovery-code/confirm` | owner | `{last5}` → `204` |
| `POST notices/:id/ack` | owner | `{answer: "me"|"not_me"|"ok"}` → `204` |
| `GET agents` | owner | → `{items:[{id, name, role, created_at, last_used_at, last_country, created_on}]}` |
| `POST agents` | owner | `{name, role, current_password}` → `{id, token}` (shown once) |
| `DELETE agents/:id` | owner | → `204` |
| `POST breakglass` | agent `chat` | `{fingerprint}` → `{ticket_id, usable_after, expires_at}` |
| `POST breakglass/cancel` | owner | `{ticket_id}` → `204` |

## 17. Agent keys (Settings → Agents)

- **List rows:** name · role badge · "Made {d MMM} on {device label} · last used {relative} · {CC}". Unused for 90 days adds "Not used for 90 days — revoke?". **[proposal]**
- **"New agent key"** sheet:
  - Name (default from the role: `mind-chat`, `mind-night`, `mind-reflex`, `muse`, `ci`; unique; ≤32 characters).
  - Role: Mind · chat / Mind · night / Mind · reflex (from P4) / Muse / CI. Each shows one line on what it can do ([SECURITY.md §5.3](../engineering/SECURITY.md)).
  - Current password (§15).
  - Button "Make key".
- **Shown once:** the token in monospace with a **Copy** button (needed for pasting), plus where it goes:
  - chat / night / reflex: "Paste it into the Claude environment `th-chat` / `th-night` / `th-reflex` as the secret `TH_TOKEN`."
  - Muse: "Send it to Muse in its settings."
  - CI: "Add it in GitHub as the environment secret `TH_CI_TOKEN`."
  - "You won't see it again." Button "Done" clears it from memory and the DOM.
- **Revoke:** confirm sheet "Revoke '{name}'? Anything using it stops working within a minute." · "Revoke" · "Cancel". No password needed.
- **Limits:** 20 active keys. Keys don't expire by age. `last_used_at` is written at most once an hour.
- **Rotating a key:** make a new key, paste it, check the new key's "last used", revoke the old one.
- **Acceptance:** a key made, used once by the CLI against `GET /v1/ops/health/deep`, shows "last used now". After revoking, the same call returns `401` within 60 s.

---

## 18. Error codes the UI must handle

Every error body is `{"error": {"code", "message", "details"?, "request_id"}}` ([API.md](../engineering/API.md)). The UI keys on `code`, never on `message`. Codes not listed here fall back to the generic line for their HTTP class.

| Code | HTTP | Where | UI |
|---|---|---|---|
| `wrong_username_or_password` | 401 | login | §5.3 |
| `wrong_username_or_code` | 401 | recover | "That username and code don't match." |
| `current_password_wrong` | 401 | password, recovery-code, agents | "That's not your current password." |
| `setup_code_wrong` | 401 | setup | "This page's setup code doesn't match the installed fingerprint. Start over." |
| `rate_limited` | 429 | all auth | countdown §6.2 (`retry_after`, `scope`) |
| `session_expired` / `session_revoked` / `unauthorized` | 401 | any | wipe → `/signin/?reason=` §11.2 |
| `forbidden` | 403 | any | "You can't do that from here." (should never happen to the owner; log it) |
| `origin_not_allowed` | 403 | any | "This page isn't allowed to talk to the Thunderhead." |
| `setup_required` | 409 | login, recover | redirect to `/setup/` |
| `setup_fp_missing` | 409 | setup | S1 "Waiting for the fingerprint…" |
| `setup_done` | 410 | setup | redirect to `/signin/` |
| `username_invalid` | 422 | setup | "Use 3–32 letters, numbers, dots, dashes or underscores." |
| `password_too_short` / `password_too_long` / `password_guessable` / `password_breached` / `password_same` | 422 | setup, password, recover | §9.2 |
| `reset_already_pending` | 409 | breakglass | (the mind tells the owner) "A reset is already waiting. Cancel it first or wait for it." |
| `reset_not_ready` | 425 | recover | §10.3 Pending copy |
| `reset_cancelled` / `reset_expired` / `reset_used` | 410 | recover | §10.3 |
| `agent_name_taken` | 409 | agents | "You already have a key with that name." |
| `agent_limit` | 409 | agents | "You have 20 keys. Revoke one first." |
| `validation` | 422 | any | "Something in the form isn't right." + field highlights from `details` |
| `too_large` | 413 | any | "That's too long." |
| `client_outdated` | 426 | any | "A newer version is ready." + Reload |
| `auth_unavailable` | 503 | login, setup, recover, password | "Sign-in is having trouble on our side. Try again in a minute." |
| `budget_exhausted` | 503 | any | "The Thunderhead hit today's free limit. It resets at {local time of 00:00 UTC}." |
| `internal` | 500 | any | "Something went wrong on our side." |
| (non-JSON 5xx, Cloudflare 1027/1102 pages) | 5xx | any | treat as `auth_unavailable` on auth pages, else `internal` |
| (network error / timeout) | — | any | §5.3 offline and timeout lines |

## 19. Open questions / tests

| # | Question | How to settle |
|---|---|---|
| X3 | Does `Auth` get enough CPU on Free for scrypt 2^15/8/3? | [SECURITY.md §6.3](../engineering/SECURITY.md). If not, sign-in switches to the client-side KDF mode described there; the screens above don't change, except "Signing in…" can last up to ~2 s. |
| T6 | Does Chrome suggest the saved password on a neighbouring `*.z13.web.core.windows.net` site? | Save a credential on the test site, open another z13 site with a login form, note whether it's suggested. Either way, never auto-filled; the owner picks only entries whose host they recognise. |
| T7 | Does the static website serve `/.well-known/change-password/index.html`? | Upload and fetch at P1. If not, drop it (low value). |
| T9 | IndexedDB on the owner's phone survives app kills, reboots and the installed app/tab switch | Sign in, kill, reboot, open both; still signed in. |
| T11 | Are `request.cf.country` and `request.cf.region` present on `workers.dev` requests on Free? | Log them once in preview (country and region only). If region is missing, show country only. |
| T17 | Does `navigator.userAgentData.getHighEntropyValues(['model'])` return the model on the owner's phone? | Read it once on the phone; otherwise default labels use the platform. |
| T18 | Can a service worker on the owner's Chrome clear OPFS on a `signout` push? | Push test at P8. If not, the wipe waits for the next app open. |
| T19 | Do Chrome's generated passwords meet the 15-character minimum? | Accept a generated password at setup on the phone; if it's shorter, adjust the hint. |
