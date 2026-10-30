# Security

This doc says what the Thunderhead protects, from whom, and exactly how. It covers the threat model, the full security checklist, tokens and scopes, the secrets inventory, CORS, rate limits, password hashing, media URLs, push, GitHub and supply-chain hardening, and incident runbooks.
Sign-in screens and flows are in [../product/SIGN-IN.md](../product/SIGN-IN.md). Data handling is in [PRIVACY.md](PRIVACY.md). Fixed decisions are in [../process/decisions.md](../process/decisions.md) and are not reopened here.

## Rules at a glance

1. **The repo is public, so security never depends on hiding code, URLs, limits or formats.** Only secrets and personal data are hidden, and none of them are in the repo.
2. **Default deny.** Every route except `GET /v1/health` and the public sign-in routes needs a token, and every route declares the scope it needs. A test lists every route and proves it.
3. **No cookies.** One opaque bearer token per device, stored on the server only as SHA-256. Agents get their own role-scoped keys.
4. **No Cloudflare or Azure credential ever sits in a Claude session.** Deploy credentials live in GitHub; Worker secrets live in the Worker; agent keys are made by the owner from a signed-in device.
5. **The password hash (scrypt 2^15/8/3 + pepper) runs in the `Auth` Durable Object**, and only after test X3 proves it fits. If it doesn't, the same hash runs on the phone and the server keeps only a keyed hash of the result (§6.4).
6. **Storage hosting sends no headers.** So: a meta CSP first in every `<head>`. The shell and every new page: no inline script, a JavaScript frame guard that fails closed, and no third-party origins at all. Each ported app page (P1b, copied as it is) keeps its own meta CSP that allows exactly what that app loads today, from a per-app allowlist (§4.4).
7. **Ask-first actions (delete, money, access, reaching people) execute only after the owner approves:** a tap on a signed-in device, or the owner's own words in the conversation, which the Worker verifies (an owner-device message sent after the card, the owner's latest in that thread; decisions 2026-10-28). A fired prompt, Muse output, a web page or any other text the mind read is never approval.
8. **Logs and public places never hold secrets or personal data:** no tokens in URLs (except 30-second single-use tickets and presigned media URLs, never logged), no request bodies from `/v1/auth/*`, no titles in Actions logs.
9. **Pin everything:** exact npm versions, a lockfile, `npm ci --ignore-scripts`, Actions by full commit SHA, vendored files by SHA-256.
10. **Every runbook in §14 can be run by the owner from the phone.**

---

## 1. Threat model

### 1.1 What we protect

| # | Asset | Why it matters |
|---|---|---|
| A1 | Private data: conversation, memory, events, files, library, listening and practice history | The whole point; the owner's inner life |
| A2 | The power to act: verbs on the phone, proposals, deploys, merges, pushes | A hijacked actor could do harm in the owner's name |
| A3 | Credentials: password, recovery code, session tokens, agent keys, Worker secrets, the Cloudflare deploy token, the Claude account | Keys to A1 and A2 |
| A4 | Availability: 100k Worker requests a day, 100k DO row writes a day, Claude usage limits | Free tiers can be exhausted by others |
| A5 | Memory integrity | Outside text must never become a "fact" about the owner (taint rule, [../mind/MEMORY.md](../mind/MEMORY.md)) |
| A6 | The music audio in `jarvis-music` | One copy; irreplaceable. Never deleted from (decisions). |

### 1.2 Who might attack, and what they can do

| # | Adversary | Capability | Main defenses |
|---|---|---|---|
| R1 | A stranger who reads the repo | Knows every endpoint, the Worker and site URLs, token formats, limits, CORS origins, the R2 account ID, bucket names | Strong password + back-off; default deny; nothing secret in the repo |
| R2 | A neighbour on the shared Azure zone (`*.zNN.web.core.windows.net` is one "site") | Can frame our pages **with our real storage** (§4.3), set cookies on the shared domain, host look-alike pages | Frame guard that fails closed; no cookies; owner fills passwords only on the real host |
| R3 | Malicious content: web pages, song tags, PR comments, Muse output, email | Prompt injection into mind sessions | Code-enforced gates: wake text is constant, taint rules in the Worker, role-scoped keys, ask-first proposals ([../mind/CONSTITUTION.md](../mind/CONSTITUTION.md)) |
| R4 | A thief with the phone | Locked: nothing (the OS lock). Unlocked: the signed-in app | Device list and sign-out from any browser; remote wipe on next contact; inline password for new keys and recovery codes |
| R5 | A compromised dependency or Action | Code execution in CI or in the page | Pinning, `--ignore-scripts`, tiny dependency set, no third-party script in pages, CSP |
| R6 | A leaked credential (screenshot, log, paste) | Uses it until revoked | Hash-only storage, prefixes for secret scanning, revocation ≤60 s, runbooks |
| R7 | The agent itself, mistaken or hijacked | Pushes code, calls the API with its role | Role scopes; Worker-side proposals; ledger + undo; break-glass only with the owner's fingerprint |
| R8 | Platform providers (Cloudflare, Microsoft, GitHub, Anthropic, Google push) | Can see what they host | Trusted by necessity; exposure kept minimal ([PRIVACY.md §5](PRIVACY.md)) |

Out of scope: a compromised phone OS, provider insiders, nation-state attackers, physical coercion.

### 1.3 Trust boundaries

```
 Phone (Chrome / installed app) ──HTTPS + bearer──▶ Worker thunderhead-api ──RPC──▶ Auth DO / Core DO
   │  static files only                                │ presign (read-only key)        │
   ▼                                                   ▼                                ▼
 Azure Storage static website ($web)            R2 S3 endpoint (presigned GET)     R2 buckets
 Mind sessions (Claude) ──HTTPS + agent key──▶ Worker          GitHub Actions ──CF API token──▶ deploy
 Muse ──HTTPS + muse key──▶ Worker              Actions ──R2 job keys──▶ thunderhead-jobs (write) / jarvis-music (read)
```

Each arrow is authenticated separately. Nothing trusts the network position of a caller.

### 1.4 Public by design
Code, endpoints, the site and Worker URLs, token prefixes, throttle numbers, CSP origins, the R2 account ID, and bucket names. Acceptance: a reviewer with the repo and no secrets can't sign in, read data, or deploy.

---

## 2. Security checklist (whole project)

Phase tags follow [ARCHITECTURE.md](ARCHITECTURE.md). Each line is testable; the test or check is in brackets.

**Sign-in and sessions (P1)**
- [ ] `Auth` DO holds credential, sessions, notices, throttle, tickets, agent keys, push subscriptions. [backend tests]
- [ ] scrypt 2^15/8/3 + HMAC pepper; parameters stored per record; upgraded on next sign-in. [unit test with stored lower params]
- [ ] X3 passed and recorded in decisions.md before any auth code ships. [§6.3]
- [ ] Setup only via installed fingerprint; `410` after setup. [SIGN-IN §4.3]
- [ ] Recovery code: 125 bits, shown once, confirmed, single use, regenerated after use. [SIGN-IN §7]
- [ ] Reset ticket: chat-role key or GitHub path only; 24 h delay; cancel from any session. [SIGN-IN §10.4]
- [ ] Back-off table exactly as SIGN-IN §6.1; one error message; dummy KDF on wrong username; `timingSafeEqual`. [backend tests with fake clock]
- [ ] Tokens hashed at rest; 90-day idle expiry; revocation ≤60 s; wipe on 401. [backend + Playwright]
- [ ] Device list; sign out one / others / all, no password. [Playwright]
- [ ] Notices for new device, password change, reset; generic push text. [backend tests]
- [ ] Form markup as SIGN-IN §12. [static test greps the attributes]
- [ ] `/v1/auth/*` handlers log only outcome codes. [test spies on `console.*`]

**API (P1)**
- [ ] CORS exact-origin allowlist; no credentials; `Vary: Origin`. [§7 tests]
- [ ] Route table test: every route except the public list returns `401` without a token and `403` with a wrong-role key. [generated test over the router]
- [ ] Body limits per route; zod validation; parameterized SQL only; errors never echo bodies. [tests]
- [ ] Response headers as §8 on every response, including errors and preflights. [test]
- [ ] Agent keys: role scopes hard-coded; `last_used_at` hourly. [tests]

**Data and storage (P1, P5)**
- [ ] Three buckets; Actions never hold `thunderhead-private` credentials. [secrets inventory review]
- [ ] No public access on any bucket; r2.dev URL off on all buckets; the old `MUSIC_PUBLIC_READ` path never exists in the new Worker. [T14 owner check; grep test]
- [ ] No code path deletes or overwrites `jarvis-music` objects outside one reviewed upload module. [static test]
- [ ] Presigned GETs as §9; never logged. [tests]
- [ ] Backups and exports only in `thunderhead-private`; `Auth` tables never exported. [export test]

**Front end (P0–P1; ported pages P1b)**
- [ ] Meta CSP first in `<head>` on every HTML file. Shell and new pages: no inline script; no `on*=` attributes; no third-party origins. Ported pages: their own CSP, and no outside host beyond their row in §4.4. [`tests/site.test.mjs`]
- [ ] Frame guard fails closed on every shell and new page (ported pages get it when the owner agrees to change them). [Playwright frames the page from another origin]
- [ ] `referrer` `no-referrer` and `robots` `noindex,nofollow` meta on every page; no `Disallow` in robots.txt. [static test]
- [ ] `securitypolicyviolation` listener posts to `POST /v1/ops/errors` when signed in. [Playwright triggers a violation]
- [ ] No `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write` outside `ui/dom.js`, which only takes trusted templates. **[proposal]** [lint test]
- [ ] Private data only in IndexedDB `th-data`, OPFS and named caches, all wiped on sign-out. [Playwright]
- [ ] Deployed files have correct `Content-Type` (no `nosniff` possible). [`tests/live.test.mjs`]

**Repo and CI (P0)**
- [ ] §12.1 settings applied; secret scanning + push protection on. [owner screenshot check once; agent rechecks quarterly via `gh api`]
- [ ] Actions pinned by SHA; `npm ci --ignore-scripts`; lockfile committed. [test greps workflows]
- [ ] No artifacts, no `set -x`, no printing of secrets or personal data. [workflow lint test]

**Agents and push (P1, P8)**
- [ ] Each mind task has its own environment and role key; Muse and CI have their own. [Settings → Agents shows them]
- [ ] Push payloads are `{k, id}` only, encrypted; notification text generic by default. [unit test of the payload builder]

---

## 3. Hosting constraints (Azure Storage static website)

Decisions fix the host. Consequences for security:
- **No response headers at all.** No `Content-Security-Policy` header, no `frame-ancestors`, no HSTS, no `X-Content-Type-Options`, no `Permissions-Policy`, no `X-Robots-Tag`, no COOP/COEP.
- **HTTPS only** (secure transfer required on the account). HTTP requests fail rather than redirect. `upgrade-insecure-requests` covers sub-resources.
- **Shared site.** The Public Suffix List lists `web.core.windows.net`, so the registrable domain is `zNN.web.core.windows.net`, shared with every other static website in that zone. Origins stay separate (storage, IndexedDB, service workers); "site" checks (SameSite, storage partitioning, password-manager matching) treat strangers as same-site.
- **No user content in `$web`.** Only files built from the repo go there. Owner files live in R2 and are opened through presigned URLs on the R2 host, a different origin, so even an uploaded HTML file can't script the app.

## 4. Front-end security

### 4.1 CSP (meta, first element after `<meta charset>`)

App shell (`/index.html` and app stubs):
```
default-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data: blob: https://<acct>.r2.cloudflarestorage.com;
media-src 'self' blob: https://<acct>.r2.cloudflarestorage.com;
connect-src 'self' https://thunderhead-api.<sub>.workers.dev wss://thunderhead-api.<sub>.workers.dev https://<acct>.r2.cloudflarestorage.com;
font-src 'self'; worker-src 'self'; manifest-src 'self'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests
```

Sign-in pages (`/signin/`, `/setup/`, `/recover/`):
```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src https://thunderhead-api.<sub>.workers.dev; manifest-src 'self'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'self'; upgrade-insecure-requests
```

Rules:
- `<acct>` and `<sub>` are filled at stage time from `config` (not secret). Presigned URLs use **path style** (`https://<acct>.r2.cloudflarestorage.com/<bucket>/<key>`) so one host covers every bucket.
- `'wasm-unsafe-eval'` is added only on pages that compile WebAssembly (pdf.js if it needs it; the client-side KDF mode of §6.4), never site-wide.
- `style-src-attr 'unsafe-inline'` exists for `style="--i:1;--c:#…"` custom properties on Home. Attribute styles can't use selectors, so CSS exfiltration through them is not practical. Removing it later (classes instead) is welcome.
- A meta CSP ignores `frame-ancestors`, `report-uri`/`report-to` and `sandbox`. Never write them (the old site did; they did nothing).
- Reporting: `ui/` registers a `securitypolicyviolation` listener that batches `{directive, blocked, source}` (no page content) to `POST /v1/ops/errors` when signed in.
- Trusted Types: deferred (decisions). When it comes: `require-trusted-types-for 'script'; trusted-types th-html`.
- Acceptance: `tests/site.test.mjs` parses every HTML file and checks that the first element after `<meta charset>` is the CSP meta, that it matches the expected text for its page type, that no `<script>` has inline content, and that no attribute starts with `on`.

### 4.2 Other page rules
- `<meta name="referrer" content="no-referrer">` and `<meta name="robots" content="noindex,nofollow">` on every shell and new page.
- No third-party origin in new code: fonts and icons are self-hosted (decisions). The test fails on any `http(s)://` URL in new HTML/CSS/JS that isn't the API, R2, or a link the owner taps (allowlisted links open in a new tab with `rel="noopener noreferrer"`). Ported folders are checked against their own allowlist instead (§4.4).
- Camera, mic and other device APIs: requested only from a tap inside the feature that needs them ([PRIVACY.md §7](PRIVACY.md)). No iframes exist, so `allow` attributes are moot.

### 4.3 Clickjacking analysis and the frame guard

Without `frame-ancestors` (impossible on this host), any page can put ours in an `<iframe>`. What it gets depends on who frames it:

| Framer | Our frame's storage | Risk |
|---|---|---|
| A cross-site page (any other registrable domain) | Partitioned: empty IndexedDB, so signed out | Low: nothing private to click. Could show our sign-in form; password managers don't autofill cross-origin frames reliably, and the guard hides it anyway. |
| **A neighbour on the same `zNN.web.core.windows.net` site** | **Our real, first-party storage.** Chrome's partition key is (origin, top-level site, cross-site-ancestor bit); a same-site top-level page sets no bit, so the key equals our own. Our frame is signed in. | **Real**: a neighbour could overlay our signed-in app and trick taps, e.g. "Not me — sign it out" or approving a proposal. Report 3 assumed all framers see empty storage; that is wrong for zone neighbours. |
| A sandboxed frame without `allow-same-origin` | Opaque origin, no storage | None |
| A sandboxed frame without `allow-scripts` | Our scripts don't run; the app renders nothing (everything is built by JS) | None |

**The guard (fails closed):**
1. The first stylesheet on every page (`ui/plain.css` or the page's own) starts with `html:not(.th-top){visibility:hidden}`.
2. The first script (`ui/theme.js`, a blocking classic script in `<head>`) runs `if (window.top === window.self) document.documentElement.classList.add('th-top'); else { document.documentElement.replaceChildren(); throw new Error('framed'); }`.
3. `th/auth.js` refuses to read the token, and the sign-in pages refuse to submit, unless `window.top === window.self`.
4. Approve-type buttons (proposals, "Not me — sign it out", revoke, sign out) also ignore taps that arrive within 500 ms of the page becoming visible. **[proposal]**

`window.top` can't be spoofed by the framer. If scripts are blocked, the page stays hidden. Acceptance: Playwright serves a page on a second local origin that frames `/` with and without `sandbox="allow-scripts allow-same-origin"`; the frame's `<html>` has no children and no `th-top` class, and no API request is made.

---

### 4.4 Ported app pages (P1b)

Owner ruling 2026-10-28: Music, Guitar, Podcasts, Astra and My Media are copied as they are. Each keeps its own meta CSP and loads what it loads today. Rules:

1. The shell and every new page keep the strict CSP of §4.1, with no outside hosts.
2. Each ported page's CSP is its old CSP, changed only for the P1b adjustments (new folder paths; nothing is added for convenience). It allows exactly the hosts in its row below, which `frontend/ported.json` records and the static test enforces.
3. A ported page holds no new-site token at P1b (it calls the old Worker without the new sign-in), so a frame or a script on it can't reach the new API. It must not import anything from `th/` until it moves.
4. When an app's data moves to the new Worker, its CSP's `connect-src` swaps the old Worker host for `thunderhead-api`, it gains the frame guard, and only then may it read the new session token. Dropping an outside host (vendoring hls.js, dash.js or butterchurn) is a later change the owner agrees to.
   **Music (P5) moved through its own service worker instead**, so the page itself is unchanged: it still addresses its library by the old Worker's URLs (its offline copies and song heads are keyed by them), and `music/sw.js` loads `th/music/bridge.js`, which answers those requests from the new Worker with the session read from `th-auth`, and only for a top-level page (a framed copy of the player never gets the session: the worker's own frame guard). The page holds no token and calls no new host, so its CSP is unchanged; the old host leaves it with N5. The bucket gets signed links, never the session. `tests/ported.test.mjs` allows exactly that one `th/` file, and only in `music/sw.js`.
   **Guitar (P6)** follows this rule as written: its page's CSP gains the API host at deploy (`MOVED_PAGES` in `scripts/site-config.mjs`), and its sources module reads the session through `th/ported/session.js` (top-level pages only, never creating the database), asking the new Worker when signed in and the old one otherwise; the test allows that file in `guitar/sources.js` only.

| Ported page | Outside hosts it uses today (from its old CSP and code, 2026-10-28) | Notable allowances it keeps |
|---|---|---|
| `/music/` | `https://cdn.jsdelivr.net` (two visualiser scripts: butterchurn 2.6.7 and its presets 2.4.7); the old Worker (library, audio, art) | `'unsafe-eval'` (visualiser), `blob:` workers |
| `/guitar/` | The old Worker (Songsterr and tab-source proxy; Songsterr permitted, owner ruling); `https://itunes.apple.com`, `https://*.mzstatic.com` (search and covers) | `style-src 'unsafe-inline'`, `font-src data:` |
| `/podcasts/` | `https:` for images, media and connect (any feed and audio host), plus the old Worker | broad `https:` sources, as today |
| `/astra/` | `https://cdn.jsdelivr.net` (hls.js 1.6.13 and dash.js 5.2.0, loaded with SRI); `https:` for media, images and connect (the owner's add-ons and streams) | `'wasm-unsafe-eval'` and `blob:` for libmedia (stays, owner ruling); `http://localhost:*` and `http://127.0.0.1:*` (local players), as today |
| `/media/` | `https://www.googleapis.com`, `https://*.googleusercontent.com`, `https://i.ytimg.com`; the old Worker | `'wasm-unsafe-eval'`, `blob:` |

Acceptance: `tests/site.test.mjs` finds every `http(s)://` host in each ported folder and in its CSP and fails on any host not in that folder's `ported.json` row; the shell and new pages still fail on any outside host at all.

## 5. Tokens and scopes

### 5.1 Formats

| Token | Format | Entropy | Server stores | Lifetime | Held by |
|---|---|---|---|---|---|
| Owner session | `th1_` + 43 base62 random + 6 base62 CRC32 checksum **[proposal: base62 + checksum, like GitHub's]**. The CRC32 covers `<prefix>_<43 random>`, so a prefix swap fails the checksum; 6 base62 digits, big-endian, zero-padded | 256 bits | SHA-256 (the `sessions` primary key) | 90 days idle; no rotation in v1 | IndexedDB `th-auth` on the device |
| Mind key (chat/night/reflex) | `thm_` + same body | 256 bits | SHA-256 + role | Until revoked | Claude environment network secret `TH_TOKEN` |
| Muse key | `ths_` + same body | 256 bits | SHA-256 + role | Until revoked | Muse's settings |
| CI key | `thc_` + same body | 256 bits | SHA-256 + role | Until revoked | GitHub environment secret `TH_CI_TOKEN` |
| Live ticket | `thw_` + 22 base62 | 128 bits | SHA-256, 30 s, single use | 30 s | URL of the WebSocket (`wss://…/v1/live?ticket=`) |
| Recovery / setup / reset code | 25 Crockford base32 | 125 bits | HMAC(pepper) or SHA-256 fingerprint | Single use | Paper / the browser that made it |
| Fingerprint | `thfp_` + base64url(SHA-256(code)) | — (public) | as given | Single use | GitHub secret, Worker secret, or the request |
| Presigned media URL | SigV4 query string | — | nothing | 3 h | Memory only; never stored or logged |

Rules:
- The Worker checks the prefix and checksum before any lookup. A bad checksum is `401 unauthorized` with no DO call. That makes garbage tokens cost no DO request.
- Lookup is by `SHA-256(token)`; no constant-time comparison is needed for a hash lookup. Agent keys use the same table design (an `agents` table in `Auth`).
- Validation results are cached per isolate for 60 s (positive only). Revocation therefore takes ≤60 s everywhere.
- Deferred (decisions): per-request device-key proofs and token rotation. The session row keeps a nullable `pop_jwk` column so proofs can be added behind a flag later.
- Acceptance: a CI test generates 1,000 tokens and checks format, uniqueness and checksum; a mutated character fails the checksum.

### 5.2 Secret scanning
- GitHub secret scanning and push protection are on (free for public repos).
- A repo test greps the tree for `\b(th1|thm|ths|thc)_[0-9A-Za-z]{49}\b`, `thfp_[A-Za-z0-9_-]{43}`, and 25-character Crockford groups in the `XXXXX-XXXXX-…` shape, and fails on any hit outside fixtures that are marked fake. **[proposal]**
- Custom secret-scanning patterns on GitHub may need a paid feature; see Open questions.

### 5.3 Scopes by principal

`R` read, `W` write, `—` refused (`403 forbidden`). The Worker enforces this table; prompts never do.

| Area | owner | chat | night | reflex (P4) | muse | ci |
|---|---|---|---|---|---|---|
| `auth/*` sessions, password, recovery, agents, notices | RW | — | — | — | — | — |
| `auth/breakglass` (start) | — | W (owner-asked only) | — | — | — | — |
| `auth/breakglass/cancel` | W | — | — | — | — | — |
| Conversation, threads | RW | RW | R + home lines | R (last 24 h) + one system notice | own Muse thread | — |
| Memory (facts, day notes, open threads) | RW (edit, forget) | R + remember (taint rules) | R + observed/inferred facts, day notes | — | — | — |
| Ledger | R + undo | R + W via actions | R + W via actions | R | — | — |
| Proposals | approve/reject (device tap) | create; record the owner's own words (`by_message`, Worker-verified) | create | create | — | — |
| Verbs, surfaces | R | W | W | — | — | — |
| Senses (events) | W | R (query) | R (query) | — | — | — |
| Music, library catalog | RW | R + reversible fixes | R | — | — | — |
| `media/sign` | yes | yes | yes | — | — | — |
| Work orders | R | create | create | — | read assigned, post result | — |
| `live/wait`, briefing claim | — | yes | yes (brief) | yes (brief) | — | — |
| `ops/health/deep` | R | R | R | R | — | R |
| `ops/errors` | W (client errors) | R | R | R | — | — |
| `jobs/*/result` | — | — | — | — | — | W |
| Export everything (P4) | yes (step-up when it ships) | — | — | — | — | — |
| Run deploy rollback | — | via GitHub | — | via GitHub workflow | — | — |

- No principal can send a push directly. The Worker decides what becomes a push ([PRIVACY.md §8](PRIVACY.md)).
- Ask-first classes (`delete`, `money`, `access`, `reach_people`) are proposals. Only the owner approves one: a tap from an owner session, or the owner's own words recorded by `mind:chat` and checked by the Worker against the message itself ([API.md §11.10](API.md#1110-proposals-decisions)). Either way the approval is bound to the proposal id and the hash of its spec.
- Acceptance: the generated route test asserts this matrix cell by cell.

---

## 6. Password hashing in the `Auth` Durable Object

### 6.1 The construction
- `verifier = HMAC-SHA256(AUTH_PEPPER_v, scrypt(NFKC(password), salt16, N=2^15, r=8, p=3, dkLen=32, maxmem=64 MiB))`.
- Stored per record: `algo`, `n`, `r`, `p`, `salt`, `verifier`, `pepper_v`, `version`, `changed_at`.
- Upgrade on login: if stored `n/r/p` are below current, re-hash with the password just verified. Pepper rotation works the same way: verify with the old pepper, store with the new one (§14.6).
- Input caps: 128 characters and 1,024 bytes after NFKC; anything longer is `422` before hashing.
- Wrong username: hash against a dummy record with the same parameters so timing matches.
- Measured locally (report 3, fact-check C40): 235 ms in workerd, 263–269 ms in Node on a 2.1 GHz Xeon; 32 MiB. workerd caps N·r·p at 2^20, so N=2^18 errors; N=2^16, p=2 (64 MiB) is the next step up, pending T2.
- `scrypt()` in workerd is synchronous, so all of that is CPU time on the isolate.

### 6.2 Why the DO, and what the evidence says about its CPU limit on Free

The Worker on Free has **10 ms CPU per request**. Even scrypt N=2^14, p=1 costs ~37 ms. So the hash can't run in the stateless Worker. Whether a **Durable Object** on Free gets more is not stated plainly anywhere. Evidence, re-researched 2026-10-28:

| # | Source | What it says | Points to |
|---|---|---|---|
| E1 | [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/) (page dated 2026-06-01), SQLite table | "CPU per request: 30 seconds (default) / configurable to 5 minutes". No plan column. Free can only use SQLite-backed objects, so this is the table that applies to Free. | 30 s |
| E2 | Same page, footnote 4 | "Each incoming HTTP request or WebSocket message resets the remaining available CPU time to 30 seconds." | 30 s |
| E3 | Same page, FAQ "Can I increase Durable Objects' CPU limit?" | "Durable Objects are Worker scripts, and have the same per invocation CPU limits as any Workers do." Then: "By default, the maximum CPU time per Durable Objects invocation … is set to 30 seconds." | Ambiguous: first sentence suggests 10 ms on Free; second says 30 s |
| E4 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (2026-10-12), "Error: exceeded CPU time limit" | Remedy 3: "Offload work: Move expensive computation to Durable Objects or process data in smaller chunks." Remedy 1 (raise the limit) is marked Paid-only; remedy 3 isn't. | DOs have a larger budget |
| E5 | Workers limits, same page | Free: 10 ms per HTTP request and per cron. "Each isolate has some built-in flexibility to allow for cases where your Worker infrequently runs over the configured limit." Consistent overruns → error 1102 / outcome `exceededCpu`. | Even at 10 ms, rare overruns may pass; not something to rely on |
| E6 | [cloudflare.com/plans](https://www.cloudflare.com/plans.md) | Workers Free: "CPU Time 10 ms / request". Durable Objects: only a Duration row (13,000 GB-s/day), no CPU row. | No DO CPU limit by plan is published |
| E7 | Cloudflare blog, DOs on Free (2025-04-07) | Free DOs announced; limits listed are requests, duration, rows, storage. Nothing on CPU. | Silent |
| E8 | A public free-plan measurement (GitHub issue in an unrelated project, 2026-09-13), read via `wrangler tail` | DO invocations of 16–17 ms CPU succeeded on a Free account; Worker invocations of 21–48 ms also succeeded (flexibility). | Weak: both over 10 ms passed, so it doesn't separate the cases |
| E9 | The old Worker on this same Free account | Ran scrypt 2^15/8/3 inside a DO for owner sign-in (old `relay-owner-password.js`). CPU was never logged, and no failure is recorded in the old repo. | Weak but local evidence for 30 s |
| E10 | Third-party blogs and guides | Repeat "10 ms on Free" for Workers; none measures DO CPU on Free. | Nothing new |

**Best evidence today:** probably 30 s (E1, E2, E4, E9), with one contrary sentence (E3). Not proven. So test X3 decides, and the fallback (§6.4) is designed so that neither outcome needs a re-design.

### 6.3 Test X3 (run before any auth code ships) **[proposal: run it from Actions]**

No Claude session holds a Cloudflare credential, so X3 runs as a GitHub workflow:
1. `.github/workflows/bench.yml` (test `x3`), `workflow_dispatch`, job `environment: worker`. The same workflow runs X1 and X4.
2. It deploys a throwaway Worker `thunderhead-x3` from `backend/bench/` (a Worker plus a SQLite DO class `Bench` with one RPC method `kdf(n, r, p)` that hashes a fixed dummy password). The bench code never ships in `thunderhead-api`.
3. It starts `wrangler tail thunderhead-x3 --format json` in the background.
4. It calls the bench 20 times in a row with (2^15, 8, 3), then 20 times with (2^16, 8, 2), each call a separate request to the same DO instance.
5. It prints only numbers: count per `outcome`, and p50/p95/p99/max of `cpuTime` and `wallTime` per setting, from the tail events for the DO.
6. It deletes the throwaway Worker (`wrangler delete thunderhead-x3`).

**Pass:** 20/20 `ok` outcomes, zero `exceededCpu`, p99 `cpuTime` ≤ 600 ms for 2^15/8/3. Record the numbers as a new line in decisions.md.
**Upgrade (T2):** if 2^16/8/2 also gives 20/20 with no memory errors and p99 ≤ 600 ms, adopt it (records upgrade on the next sign-in).
**Fail:** any `exceededCpu`, error 1102, or DO reset → switch to client-side KDF mode (§6.4). Don't rely on "flexibility": a once-a-quarter sign-in that sometimes fails is not acceptable.

If `wrangler tail` doesn't show DO `cpuTime` on Free (open question), read **Workers → thunderhead-x3 → Metrics** in the dashboard on the phone; outcome counts alone still decide pass/fail.

### 6.4 Fallback: client-side KDF ("server relief") **[proposal]**

If X3 fails, scrypt moves to the phone and the server does only a keyed hash. The stored verifier is **identical**, so switching between modes needs no password reset.

1. `POST /v1/auth/prelogin {username}` (public, same back-off as login) returns `{kdf: "scrypt", n, r, p, salt}`. For a wrong username it returns a deterministic fake salt `HMAC(AUTH_PEPPER, "fake-salt:" + username)[0..16]` with the same parameters, so the answer never reveals whether the username exists.
2. The page computes `dk = scrypt(NFKC(password), salt, n, r, p, 32)` in a dedicated Web Worker using a vendored WASM build (hash-wasm, MIT, pinned with SHA-256). Those pages add `'wasm-unsafe-eval'` to their CSP.
3. The page sends `{username, dk}` instead of `password`. The server computes `HMAC-SHA256(AUTH_PEPPER, dk)` and compares it with the stored verifier (~0.01 ms of CPU).
4. Setting a password: the page also checks length and blocklist, and does the breach check through the Worker (`GET /v1/auth/pwned/:prefix5`, a pass-through of the k-anonymity range API), because the server no longer sees the password.
5. A Worker variable `AUTH_KDF_WHERE = "server" | "client"` picks the mode. The server accepts only the configured field, so there's one path in production; CI tests both.

Trade-offs: `dk` is password-equivalent for this site (as the password is). Against a stolen database, an attacker still needs the pepper and then one scrypt per guess, exactly as before. Password rules move to the client, which is acceptable for a one-person app. Cost: about 0.5–2 s of phone CPU per sign-in on the owner's phone (measure at P1; target p95 ≤ 2 s).

Not fallbacks:
- The architecture review's interim "N=2^14, p=1" still costs ~37–42 ms, which doesn't fit a 10 ms budget either.
- Workers Paid ($5/month) would settle it, but costs money; ask the owner first.

---

## 7. CORS

- **Allowlist:** `SITE_ORIGINS` (a Worker variable): the exact new site origin. The old site's origin is never added: the phone export travels as a file and is uploaded from the new origin ([MIGRATION.md §5](MIGRATION.md#5-the-as-is-port-and-phone-local-data-p1b)), so the owner never signs in to the new Worker from the old origin. `http://127.0.0.1:8080` exists only in the dev config.
- **The other direction (P1b):** the old Worker allows the new site's origin (its `FRONTEND_ORIGINS` set) so the ported pages work until their data moves. That is an ask-first old-Worker deploy, and the entry goes when the old Worker retires ([MIGRATION.md §6](MIGRATION.md#6-cors-the-new-site-on-the-old-worker-p1b-temporary)).
- **Allowed origin:** `Access-Control-Allow-Origin: <that exact origin>` and `Vary: Origin`. Never `*`. Never `Access-Control-Allow-Credentials`.
- **Preflight:** methods `GET, POST, PUT, PATCH, DELETE`; headers `Authorization, Content-Type, TH-Client, TH-File-Name, TH-Sha256, If-None-Match`; `Access-Control-Max-Age: 7200` (Chrome's cap). [API.md §4](API.md#4-cors) is canonical.
- **Exposed:** `TH-Request-Id`, `TH-Server`, `TH-Min-Client`, `Retry-After`, `ETag` (not CORS-safelisted, so they must be listed to be readable).
- **Not allowed:** a request whose `Origin` is present and not on the list gets `403 origin_not_allowed` before any auth work, with no CORS headers.
- **No `Origin`** (CLI, mind, Muse, Actions): allowed through to token checks. Agents never send `Origin`.
- **R2 bucket CORS** (for presigned GETs used by `fetch`, pdf.js and Web Audio): allowed origin = the site origin; methods `GET, HEAD`; allowed header `Range`; exposed `Content-Range, Content-Length, Accept-Ranges, ETag`; max age 7200. Setting it is ask-first (decisions: changes to `jarvis-music`).
- Acceptance: tests send preflights from the allowed origin, a neighbour z13 origin and `null`; only the first gets CORS headers, and the others get `403`.

## 8. Worker response rules

Every response, errors and preflights included:
- `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex, nofollow`, `Cross-Origin-Resource-Policy: same-origin` (CORP doesn't affect CORS fetches; it stops no-cors embedding of our JSON). **[proposal: CORP]**
- `Content-Type: application/json; charset=utf-8`; JSON only, except the WebSocket upgrade.
- `TH-Request-Id` = the `cf-ray` value; the same id is in the error body and the log line.
- Bodies: 64 KB by default; 4 KB on `/v1/auth/*`; 256 KB for event batches. Over the limit → `413 too_large` before parsing.
- Errors never echo the request body or a token.

## 9. Presigned media URLs

Fixed by decisions: `POST /v1/media/sign {refs}`, signing time floored to the hour, 3 h expiry, re-sign on 403.
- Up to 50 refs per call. Refs (`music:<id>`, `book:<id>`, `file:<id>`) are resolved to keys on the server, so the client never sees the bucket layout. A ref the principal may not read is refused.
- Signed with a **read-only R2 API token scoped to the buckets the site reads** (`jarvis-music`, `thunderhead-private`), held as `R2_SIGN_ACCESS_KEY_ID` / `R2_SIGN_SECRET`. Signing is SigV4 on WebCrypto (aws4fetch), ~0.1 ms per URL.
- Flooring `X-Amz-Date` to the hour makes the same object sign to the same URL for that hour, so the HTTP cache works. With a 3 h expiry, every URL is valid for at least 2 h after it's handed out.
- Files that aren't audio, images or PDFs are signed with `response-content-disposition=attachment` so the browser downloads them rather than rendering. **[proposal]**
- Never put a presigned URL in the address bar, a link, `history`, a pdf.js `?file=` parameter, a log line or an event.
- Revoking every outstanding URL at once: roll the signing token (§14.5).
- Acceptance: a test signs the same ref twice within an hour and gets identical URLs; a URL at 3 h + 1 s returns 403 from R2 (preview check, T16).

## 10. Web Push

- VAPID key pair (P-256). The private key is the Worker secret `VAPID_PRIVATE_JWK`; the public key is served by `GET /v1/push/key`. `sub` is the site URL, never an email.
- Subscriptions live in `Auth`, one per session, and are deleted in the same transaction as the session's revocation (after a sign-out push is queued) or on `404`/`410` from the push service. Endpoint URLs are capability URLs: never logged.
- **Payload:** RFC 8291 `aes128gcm`, and only `{"k":"<kind>","id":"<id>"}`. Kinds: `nudge`, `reminder`, `security`, `signout`. No titles, names, verses, songs or message text, ever.
- The service worker fetches the text with the device's own token, then shows it under [PRIVACY.md §8](PRIVACY.md). If the fetch fails: "Thunderhead has something for you." Chrome requires a visible notification for every push.
- At most 2 non-security pushes a day; none before 06:30 local (owner ruling), security pushes included; they wait until 06:30.
- Rotating VAPID invalidates every subscription. The shell compares the server key with its subscription's key at start and re-subscribes if they differ.
- Measured elsewhere on a Free account: ~1.6 ms CPU per push inside a DO. Send pushes from a DO, not from the stateless Worker.

## 11. Secrets inventory

Names only. "Rotate" says who does it and how; runbooks are in §14. A test checks that every `env.X` used in `backend/src` is either a non-secret variable in `wrangler.jsonc` (such as `AUTH_HIBP`, `on`|`off`: the breach check, off in tests) or listed here, and that no name below appears in `vars`.

| Secret | Lives in | Used for | Who rotates, how |
|---|---|---|---|
| `AUTH_PEPPER` (v1, later `AUTH_PEPPER_V2`) | Worker secret | Keyed hash of password and recovery code | Never overwritten: the password and recovery code are keyed by it, so replacing the value locks the owner out. Rotate only by adding `AUTH_PEPPER_V2` next to it (§14.6). Owner via the "Rotate secret" workflow **[proposal]**; lazy re-hash at sign-in (§14.6) |
| `AUTH_SETUP_FP` | Worker secret (`none` except during first setup) | First setup | Set by the Open setup workflow; set back to `none` after setup (never deleted: it is in `secrets.required`) |
| `AUTH_RESET_FP` | Worker secret (`none` except during a reset) | Reset ticket via GitHub | Request reset workflow; set back to `none` after use |
| `IP_HASH_KEY` | Worker secret | Source keys for back-off; the daily key is `HMAC(IP_HASH_KEY, UTC date)` | First value generated inside the bootstrap deploy run, like `AUTH_PEPPER` ([OPERATIONS.md §5.1](OPERATIONS.md)). Yearly or on suspicion; rotation only resets back-off counters |
| `ASTRA_SEAL_KEY` (P1b) | Worker secret | AES-256-GCM key sealing Astra's add-on list and backups ([ASTRA.md §5.3](../product/apps/ASTRA.md)) | Made once by `rotate-secret.yml` with `generate: ASTRA_SEAL_KEY` (32 random bytes, never printed) before the first `/import/` run; while it is `none`, `POST /v1/import/phone` answers `503 unavailable` with `details.reason = "seal_key_missing"` and stores nothing. Rotation re-seals lazily (open with the old key, seal with the new), like the pepper (§14.6) |
| `R2_SIGN_ACCESS_KEY_ID`, `R2_SIGN_SECRET` | Worker secrets | Presigning (read-only, two buckets) | Owner: new R2 API token in the Cloudflare dashboard, paste both, delete the old token |
| `VAPID_PRIVATE_JWK` | Worker secret | Web Push | Agent proposes; owner approves; devices re-subscribe automatically |
| `ROUTINE_CHAT_URL` + `ROUTINE_CHAT_TOKEN`, `ROUTINE_NIGHT_URL` + `ROUTINE_NIGHT_TOKEN` (+ `ROUTINE_REFLEX_URL` + `ROUTINE_REFLEX_TOKEN` in P4); names as in [RUNTIME.md §2](../mind/RUNTIME.md) | Worker secrets | Firing the Claude scheduled tasks (wake text `wake` only) | Owner regenerates the trigger token in the task's settings in Claude, pastes into the Cloudflare dashboard |
| `CLOUDFLARE_API_TOKEN` | GitHub environment `worker` (only `main`) | `wrangler deploy`, secret puts, X3 | Owner in the Cloudflare dashboard: account-scoped, Workers Scripts Edit only, no zones, no expiry (review §1 #24), yearly rotation note in [OPERATIONS.md](OPERATIONS.md) |
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` | GitHub repo secrets | OIDC sign-in for site deploys (identifiers, not credentials) | Not secret in practice; no rotation. The trust is the federated credential (subject `…:ref:refs/heads/main`). |
| `TH_CI_TOKEN` | GitHub environment `worker` | `thc_` key for deep health checks and job results | Owner in Settings → Agents |
| `R2_JOBS_ACCESS_KEY_ID`/`_SECRET`, `R2_MUSIC_RO_ACCESS_KEY_ID`/`_SECRET` (P5) | GitHub environment `jobs` **[proposal]** | Actions: write `thunderhead-jobs`; read `jarvis-music` | Owner: new bucket-scoped R2 tokens in the dashboard |
| `TH_SETUP_FINGERPRINT`, `TH_RESET_FINGERPRINT` | GitHub repo secrets (temporary) | Inputs to the setup/reset workflows | Owner deletes after use |
| `TH_TOKEN` | Claude environments `th-chat`, `th-night` (`th-reflex` in P4), network secret | Mind keys (`thm_`) | Owner: new key in Settings → Agents, paste, revoke the old |
| Muse key | Muse's own settings | `ths_` key | Owner in Settings → Agents |
| Session tokens, agent-key hashes, password verifier, recovery hash | `Auth` DO (hashes only) | — | Through the product (sign-out, change password, revoke) |
| Password, recovery code | Owner's password manager / paper | — | Owner |

Never: Cloudflare, Azure or R2 credentials in any Claude environment; any secret as a `wrangler.jsonc` var; old-Worker secret values reused (new keys are issued at the switch).

## 12. GitHub, Actions and supply chain

### 12.1 Repository settings (owner, once, from the phone)
- Actions → General → Workflow permissions: **Read repository contents**. Each workflow starts `permissions: {}` and each job asks for only what it needs.
- Fork pull request workflows: **Require approval for all external contributors**.
- Rules → ruleset on `main`: **Restrict deletions**, **Block force pushes**, empty bypass list. No required status checks in v1 (decisions: the agent fast-forwards `main` after CI passes on the same SHA; `deploy.yml` tests again).
- Environment `worker`: deployment branches = `main` only; holds `CLOUDFLARE_API_TOKEN` and `TH_CI_TOKEN`.
- The **site deploy job uses no environment.** Azure's federated credential trusts the subject `repo:…/thunderhead@<repo_id>:ref:refs/heads/main`; adding `environment:` would change the subject to `…:environment:<name>` and break the sign-in.
- Secret scanning and push protection: on. Private vulnerability reporting: on, so a stranger can report privately. **[proposal]**
- Actions log retention: 30 days (default 90). **[proposal]**

### 12.2 Workflow rules
- Never `pull_request_target`, and never `workflow_run` with a checkout of PR code.
- `actions/checkout` always with `persist-credentials: false`.
- Every `uses:` pinned by full commit SHA with a version comment (test enforced).
- Untrusted values (`inputs.*`, `github.event.*`) go through `env:`, never inline in `run:` (`${{ }}` inside shell is template injection).
- `shell: bash` (gives `-eo pipefail`); never `set -x`; never `env`/`printenv`.
- No `actions/upload-artifact`, no caches with personal content, no job summaries with personal content.
- `::add-mask::` for any derived value that could be sensitive.
- Scheduled workflows are avoided (GitHub disables them after 60 days of repo inactivity); the Worker or the agent dispatches jobs.
- `zizmor` (workflow linter) in CI **[optional]**.

### 12.3 Supply chain
- Exact versions in `package.json`, lockfile committed, `npm ci --ignore-scripts` everywhere.
- Runtime dependencies kept tiny: backend `hono`, `zod`, `aws4fetch`; frontend none. VAPID/RFC 8291, SigV4 and the push builder are small, own code or a pinned single dependency.
- Vendored frontend files (`frontend/vendor/<lib>-<version>/`) carry a recorded SHA-256 and a LICENSE; CI recomputes and compares.
- Dependabot: monthly, grouped, plus security alerts (decisions/review). The agent merges an update only after `npm test` passes, and reads the changelog of any new major version.
- New dependency checklist: licence (no GPL/AGPL/non-commercial; the one named exception is libmedia, which stays in Astra by owner ruling and is used nowhere else), no install scripts, maintainer and download history, size, whether 50 lines of own code would do. **[proposal]**
- Ported folders (P1b) keep their files as they are, each listed with its sha256 in `ported.json`; CI recomputes them, so a ported file changes only through a recorded adjustment.
- `npm audit signatures` in CI to check registry signatures. **[proposal]**
- The Static Web Apps deploy action is not used (storage hosting), so no Docker image tag is trusted.

## 13. Logging rules

- One structured line per request: `{evt, route, status, ms, rows_w, rows_r, principal_kind}`. Never bodies, tokens, push endpoints, presigned URLs, titles, message text or the username.
- `/v1/auth/*` logs only the outcome code.
- Workers Logs may record request headers (T5). Tokens are in headers, not URLs; if T5 shows `Authorization` is recorded, note it in [OPERATIONS.md](OPERATIONS.md) and keep logs on (route counts are needed). The 30-second live ticket in the WebSocket URL is single-use, so a logged one is useless.
- Client errors go to `POST /v1/ops/errors` with a fingerprint, message and stack; no page content.

---

## 14. Incident runbooks

Each ends with a ledger entry and a line in `docs/process/STATUS.md` (no personal content). "Owner" steps work from the phone.

### 14.1 A session token leaked (e.g. a screenshot of storage)
1. Owner: Settings → Sign-in & devices → **Sign out** that device (or **Sign out everywhere**). Effective ≤60 s.
2. Check the device list and the ledger for actions in the window.
3. If the device is still in hand, sign in again.

### 14.2 An agent key leaked (`thm_`, `ths_`, `thc_`)
1. Owner: Settings → Agents → **Revoke** the key. Effective ≤60 s.
2. Make a new key; paste it where it lives (§11).
3. The agent reviews the ledger for calls by that key since its `last_used` before the leak and proposes undo for anything wrong.

### 14.3 The password leaked
1. Owner: `/settings/password/`, new password, keep **Sign out all other devices** checked.
2. Settings → Sign-in & devices: confirm only this device remains.
3. Make a new recovery code if the code may have been seen too.
4. Review Settings → Agents for keys made recently (`agent_key_created` notices).

### 14.4 The phone is lost or stolen
1. From any browser: sign in at `/signin/` → Settings → Sign-in & devices → **Sign out** the lost phone (or **Sign out everywhere else**).
2. If the password isn't available: `/recover/` with the recovery code; that signs out everything.
3. The phone wipes its private data the next time it reaches the API (or on the `signout` push once Web Push exists). Use Android's own Find My Device erase if needed.
4. Agent keys are not on the phone; leave them.

### 14.5 A repository or Worker secret leaked
| Leaked | Do |
|---|---|
| `CLOUDFLARE_API_TOKEN` | **Treat as full compromise** (it can deploy code that reads everything). Owner: roll it in the Cloudflare dashboard at once; update the GitHub environment secret. Check Workers → thunderhead-api → Deployments for unknown versions; roll back. Then rotate `AUTH_PEPPER` (§14.6), `R2_SIGN_*`, `VAPID_PRIVATE_JWK`, the fire tokens; sign out everywhere; revoke and re-make agent keys. |
| `R2_SIGN_*` | Owner: delete the R2 API token in the dashboard (kills every outstanding URL), make a new read-only token, update the Worker secrets. |
| R2 job keys | Delete and re-make the bucket-scoped tokens; audit `thunderhead-jobs` (the Worker validates everything from it anyway). |
| `VAPID_PRIVATE_JWK` | New key pair; devices re-subscribe at next start. An attacker with it alone can't reach devices without their endpoints. |
| `ROUTINE_*_TOKEN` / `ROUTINE_*_URL` | Regenerate in the task's settings in Claude. Impact: someone can wake the mind with the text `wake` (burns usage, capped at 30/h). |
| Any secret pushed to the repo | Rotate first, then remove from history isn't enough on a public repo: assume it's copied. |

### 14.6 Pepper rotation (lazy, no forced reset) **[proposal]**
1. Add `AUTH_PEPPER_V2`; deploy with `AUTH_PEPPER_CURRENT=2`.
2. On the next sign-in, the password is verified with v1 and re-stored with v2.
3. Settings shows "Make a new recovery code" (it can't be re-hashed lazily).
4. When `pepper_v=1` no longer appears in `Auth`, delete `AUTH_PEPPER`.

### 14.7 A stranger used up the free quota
Symptoms: the app shows `budget_exhausted` or Cloudflare error 1027; the watchdog fires at 70% of the daily 100k Worker requests before 18:00 UTC.
1. Nothing is lost; quotas reset at 00:00 UTC. The shell keeps working from cache; the outbox holds messages.
2. The agent checks the meter for the pattern (one source? unauthenticated?).
3. If it repeats: options are (a) deploy the API under a new Worker name and update `config.js` (cheap, but the new URL is public again once the site loads it); (b) a custom domain with a WAF rate rule; (c) Workers Paid. (b) and (c) cost money: ask the owner.

### 14.8 Suspected prompt injection or a misbehaving mind
1. Owner: Settings → Agents → revoke the role's key (stops it within 60 s).
2. The agent (in a fresh session with a new key) reviews the ledger and undoes what's wrong; tainted facts are superseded.
3. Add the input to the injection fixtures in [../mind/EVALS.md](../mind/EVALS.md).

### 14.9 Someone else signed in (new-device notice says "Not me")
1. Tapping "Not me — sign it out" already revoked it.
2. Change the password (§14.3); review agent keys and the ledger.

### 14.10 Start the account over (last resort, ask-first) **[proposal]**
For when the reset ticket can't work (for example, no mind key and no GitHub access). It wipes only `Auth`: credential, sessions, agent keys, notices and push subscriptions. Core data is untouched.
1. The owner asks in a session; the agent opens a PR adding a one-shot migration that clears the `Auth` tables when the Worker secret `AUTH_WIPE_FP` matches a fingerprint the owner made on `/setup/`.
2. The owner installs that fingerprint through GitHub (as in Open setup) and merges.
3. After deploy, `Auth` waits 24 h (same delay as a reset), then clears itself; `/setup/` opens again. Every still-signed-in device sees a red notice and can cancel during the wait.
4. Setup runs as on day one; agent keys are re-made.

---

## 15. Open questions / tests

| # | Question | How to settle |
|---|---|---|
| X3 | DO CPU on Free; scrypt 2^15/8/3 at the edge | §6.3 workflow |
| T2 | How native scrypt memory counts against the 128 MB isolate limit | X3 step with 2^16/8/2 |
| T5 | Do Workers Logs record the `Authorization` header? | Send a dummy token to preview; query the logs in the dashboard |
| T14 | Is r2.dev public access off on every bucket? | Owner checks R2 → bucket → Settings on the phone |
| T15 | Are R2 API tokens bucket-scoped only (not prefix)? | Make a token in the dashboard |
| T16 | Presigned GET + `Range` + CORS from the Azure origin; hour flooring stays valid | Preview check with pdf.js and an `<audio>` seek |
| T20 | Does `wrangler tail --format json` include `cpuTime` for DO invocations on Free? | First X3 run; fall back to dashboard metrics |
| T21 | Are GitHub custom secret-scanning patterns available for this public repo at $0? | Settings → Code security; if not, rely on the repo test (§5.2) |
| T22 | Does a same-site neighbour frame really get our first-party storage in the owner's Chrome? | Two storage-account test sites in the same zone (or two local origins sharing a site via a hosts entry); expect yes, which the guard already handles |
| T23 | Can Actions log retention be set to 30 days on this repo? | Settings → Actions → General |
