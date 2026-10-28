# Decisions

The fixed decisions for the Thunderhead, newest last. Each line: date · decision · why.
Owner rulings are marked **(owner)** and are never reopened without the owner asking.
Everything else can be revisited with evidence; record the change as a new line, never by editing an old one.

## Product

- 2026-10-27 · **(owner)** The Thunderhead is one person's app, for life. It reads everything on the platform, acts mostly by arranging things, speaks only when something needs the owner, and is always ready to talk. · The core idea.
- 2026-10-27 · **(owner)** Reading is unlimited; acting has limits. It never decides on prayer, revelation or the owner's leaders' decisions. · Law 8.
- 2026-10-27 · **(owner)** Eyes and ears (camera, microphone) work only when the owner switches them on, never constantly. · Privacy.
- 2026-10-27 · **(owner)** Rebuild everything to current best practice. Old code is reused only when it is genuinely better than a fresh design; "it already exists" is never a reason. · Quality.
- 2026-10-27 · **(owner)** Not before 06:30 local: no pushes, no sounds, nothing that needs the owner. · Quiet hours.
- 2026-10-28 · **(owner)** Home is ONE screen: the Thunderhead chat. Soft drifting colour field with grain; one big italic voice line; the conversation sits low; a quiet ask bar. No chips on home. · Design rounds 1–11.
- 2026-10-28 · **(owner)** Presence is light along the screen edges: calm glow; gold at the bottom = a decision is waiting; a pulse = thinking; brighter = listening. · Design.
- 2026-10-28 · **(owner)** Hold still on an empty spot (220 ms) → a tight ring of six apps opens around the finger; slide toward one and let go to open; letting go in the centre cancels. Ring radius 62 px, 56 px liquid-glass bubbles, 28 px icons. · Prototype v5–v9.
- 2026-10-28 · **(owner)** The ring, clockwise from the top: Music `#2f7df6` (music-notes-simple), Guitar `#e08a1e` (guitar), Podcasts `#e0457b` (microphone), Astra `#8b5cf6` (monitor-play), My Media `#14a39a` (youtube-logo), Study `#2e9e5b` (book-bookmark). Icons: Phosphor regular (MIT). · Prototype v8–v9.
- 2026-10-28 · **(owner)** Swipe right → the Briefing (weather, what's waiting, practice, study, what was built overnight, new media). Swipe left → a menu on the right side (search, conversations, settings). · Prototype v11.
- 2026-10-28 · **(owner)** The ask bar has no placeholder text. `+` on its left folds up an options sheet like iMessage (Camera, Photos, Files, Voice memo, Remind me). The mic sits on the right and becomes send while typing. · Prototype v11.
- 2026-10-28 · **(owner)** The owner never starts or names a chat. A new conversation starts automatically at the start of each day; older ones are filed and titled automatically in the menu; memory carries context across days. · Prototype v11.
- 2026-10-28 · **(owner)** Day theme and a pure-black night theme with the same accents. Fraunces italic is only the Thunderhead's voice; Inter is everything else. · Design system.
- 2026-10-28 · Apps that come over first: Music, Guitar, Podcasts, Astra, My Media, plus the Board (folded into the Briefing) and Settings. Study is new. Other old pages wait for an owner yes. · Plan §9, review.

## Platform

- 2026-10-27 · **(owner)** New PUBLIC GitHub repo `braydenparker000/thunderhead` (Actions minutes are free on public repos). Nothing personal ever goes into it. · Cost.
- 2026-10-27 · **(owner)** $0 extra beyond free tiers and the owner's Claude Max 5x plan. Any cost, however small, is asked first. · Cost.
- 2026-10-28 · **(owner)** The site is hosted on a NEW Azure Storage account using the static website feature, so the address keeps the `…web.core.windows.net` ending. Azure Static Web Apps (different ending) and Cloudflare hosting are ruled out. · Owner, 2026-10-28.
- 2026-10-28 · Consequences of storage hosting: no response headers (security policy goes in a `<meta>` tag first in `<head>`; no `frame-ancestors`, HSTS or `X-Robots-Tag`); no SPA fallback (app routes need real files, e.g. `music/index.html` stubs written at stage time); `/dir` serves `index.html` without a redirect, so every asset path is root-absolute; missing files return `404.html` with status 404; HTTPS only. · Azure docs, live probe.
- 2026-10-28 · Site deploys use GitHub OIDC with the existing Entra app registration `MissionaryTube` (Storage Blob Data Contributor on the new account only) and the ID-based subject `repo:braydenparker000@322498428/thunderhead@<repo_id>:ref:refs/heads/main`. The deploy script refuses any account not named `thunderhead*`. · Report 1, fact-check.
- 2026-10-27 · **(owner)** A new Cloudflare Worker `thunderhead-api` on the free plan, side by side with the old `jarvis-hub-api`. Data that matters is imported; the old Worker stays untouched until every caller has switched. · Plan §17.
- 2026-10-27 · **(owner)** Sign-in is username + password, built right. No passkeys, no pairing, never needing another device. · Plan §17.
- 2026-10-28 · The site (`*.web.core.windows.net`) and the API (`*.workers.dev`) are different sites, and both suffixes are on the Public Suffix List. So: no cookies; an opaque bearer token (stored only as a hash on the server, kept in IndexedDB on the phone) in the `Authorization` header. · Reports 3, 4, 7.
- 2026-10-28 · Owner's phone of record: Samsung Galaxy A15 (SM-A155F, 4G, Helio G99) in Chrome on Android. Budgets and gesture tests assume it. Navigation mode (3-button vs gestures) still to confirm. · Old repo docs; fact-check.

## Engineering

- 2026-10-28 · Repo roots: `frontend/` (plain ES modules, no build, `// @ts-check` + JSDoc), `backend/` (TypeScript Worker), `mind/` (the mind's CLI, hooks, constitution, skills, evals), `shared/` (types only), `scripts/`, `tests/`, `docs/`. · Review §1, §5.
- 2026-10-28 · Frontend: no framework. One shell document (home) with apps as lazily imported modules, so audio keeps playing across screens; Astra stays its own page at `/astra/` at first. Hand-written service worker. Self-hosted fonts. One Phosphor SVG sprite. · Report 4, review.
- 2026-10-28 · Backend: TypeScript (pin 5.9.x), Hono, zod, aws4fetch; Workers RPC to Durable Objects; Vitest + `@cloudflare/vitest-plugin` on real workerd; Biome. · Report 2, review.
- 2026-10-28 · Durable Objects start as two classes, `Core` (conversation, ledger, proposals, verbs, surfaces, memory) and `Auth` (password, sessions, devices, push subscriptions, agent tokens). `Senses`, `Music`, `Library` arrive in their phases, each in its own deploy. Classes declared with the classic `migrations` array. · Review §1 #8.
- 2026-10-28 · No long polls or timers held inside a Durable Object. Live updates: hibernatable WebSockets; the mind waits through `GET /v1/live/wait` (≤25 s per request). · Report 2, review.
- 2026-10-28 · Three R2 buckets: `jarvis-music` (existing audio, shared; never deleted from), `thunderhead-private` (Worker only: backups, events, books, files, imports), `thunderhead-jobs` (only Actions writes; the Worker validates and copies). · Review §1 #12.
- 2026-10-28 · Private media through R2 presigned GET URLs: `POST /v1/media/sign {refs}`, signing time floored to the hour, 3 h expiry, re-sign on 403. · Review §1 #14.
- 2026-10-28 · Password hash: scrypt N=2^15, r=8, p=3 plus an HMAC pepper, run inside the `Auth` Durable Object. Where it runs and its parameters are confirmed by test X3 (DO CPU limit on Free) before launch. · Report 3, fact-check.
- 2026-10-28 · Deferred for v1: per-request device-key proofs, token rotation, step-up re-entry (until destructive features), Trusted Types, Turnstile, the GitHub "guard" approval check, predictions and the meter, embeddings and the Workers AI router, the API-credit fast lane. · Review §3.
- 2026-10-28 · No Cloudflare or Azure credential ever sits inside a Claude session. Agent tokens are issued from Settings on a signed-in device and stored as hashes in `Auth`. · Review §1 #18.
- 2026-10-28 · Everything under `/v1/`; `/v1/health` is the only public route besides sign-in. · Review §1 #17.
- 2026-10-28 · Events: `{id: uuidv7, at, type, ref, data, sensitivity: 0|1}`; the server stamps day, device, origin; dedupe by sealed batch. · Review §1 #11.

## The mind

- 2026-10-28 · The mind runs as Claude Code scheduled tasks on the subscription. v1 has two tasks, `mind-chat` (fired by the Worker) and `mind-night` (fired by the day roll, with a 06:07 fallback), each with its own environment and token role. No standing morning session. `mind-reflex` comes with the watchdogs. · Reports 5, 7.
- 2026-10-28 · Wake text is the constant `wake`; the session claims its reason through an authenticated briefing call. A fired prompt is never approval. · Report 5.
- 2026-10-28 · The briefing is injected by a `SessionStart` hook (core ≤ 9,500 characters, full briefing in a file). · Report 5.
- 2026-10-28 · Memory v1: raw messages and events; one day note per day; facts (typed, bi-temporal, with provenance and decaying confidence); open threads; session notes. The profile is a deterministic render of facts. · Report 5.
- 2026-10-28 · The day rolls at 04:00 local, but only after 60 quiet minutes. · Report 5.
- 2026-10-28 · Ask-first classes (delete/irreversible, money, security/access, reaching other people) are Worker proposals that only a tap on a signed-in device can approve. · Report 5.
- 2026-10-28 · Usage credits stay OFF on the Claude account (scheduled tasks would otherwise run on metered overage). The $100/month API credit is not used for now. · Fact-check, owner Q7 pending.
- 2026-10-28 · Measured: home at 384×832, 4× CPU throttle (rough Galaxy A15 stand-in), local server: first contentful paint ~0.28–0.29 s; zero long animation frames (>50 ms) across hold→ring→pick and three swipes, day and night, after replacing animated blur with radial gradients. Real-device check still required. · Night perf test.
