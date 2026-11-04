# Repository guidance

The one page of rules for anyone, person or agent, working here. Commands are in
[README.md](README.md). The plan is [docs/process/PLAN.md](docs/process/PLAN.md); where things stand
is [docs/process/STATUS.md](docs/process/STATUS.md). Everything else in `docs/` is reference: read it
when it helps, update it when you change what it describes, but it is not law.

## Who does what (owner, 2026-11-01)

- **The owner enjoys the product.** They say what they want and try what comes back.
- **The agent is the lead.** It decides everything technical, builds it as well as it can be built,
  and keeps the owner's time free: short, plain updates; no questions it can answer itself.
- **Work lands as pull requests.** The owner tries them (a preview link when there is one) and merges
  what they like. Merging to `main` is what makes something live; agents never push to `main` or
  deploy unless the owner says so for that change.
- **Ask the owner only for:** spending money, deleting data or anything irreversible, giving access
  or keys to anything, and anything that reaches other people. Approval is the owner's own words.
- Talk to the owner in plain words; address them as "you"; otherwise use they/them.

## Privacy (this repository is public)

- Never commit secrets, tokens, keys, private URLs, the username, where the owner lives, or personal
  content: names, notes, messages, memory, scripture copies, PDFs, song titles, listening history.
- Personal data lives only behind the owner's sign-in (the Worker and the private bucket). It never goes
  into this repository, GitHub Actions logs, or artifacts.
- Examples in code, tests and docs are invented.
- No GPL, AGPL or non-commercial dependencies, except named exceptions in decisions.md (libmedia in
  Astra). Icons: Phosphor (MIT). Font: Switzer, fetched at build and never committed
  (`node scripts/fonts.mjs`).

## Never

- Delete from the `jarvis-music` bucket.
- Put a Cloudflare or Azure credential inside an agent session.
- Point a deploy at a storage account not named `thunderhead*` (the old site shares the identity).
- Use `wrangler dev --remote`, `pull_request_target` with a checkout, or long polls in Durable Objects.

## Facts that shape the code

- **The site** is an Azure Storage static website: no response headers, so every page carries its
  CSP as its first tag (`frontend/ui/csp.txt` for the shell); no SPA fallback, so paths are
  root-absolute and every route is a real `index.html`.
- **The Worker** (`backend/`, Cloudflare, Hono, SQLite Durable Objects) is on the Free plan: 5,000,000
  rows read and 100,000 written a day, shared with the old Worker. Anything that reads or writes in
  bulk is chunked, measured (`backend/tests/cost`) and held by the rows guard from 80 %.
- **Every source file stays under 300 lines** (`backend/tests/unit/static.test.ts` counts a trailing
  newline, so 299 by `wc -l`): a change that adds to a file near the cap moves the new piece to its
  own module in the same area, since the mind's, the conversation's and the contract's files sit at it.
- **Schema steps** only ever add, and run in number order: a step numbered below one already applied
  never runs, so two branches with new steps ship in number order.
- **The phone** (`frontend/`): plain ES modules, no build. `music/` `guitar/` `podcasts/` `astra/`
  `media/` came from the old site and are our code now: change them like any other file.
- **The mind** (`mind/`): the `th` CLI, the roles and the skills (`mind/skills/`, each ≤ 2,500 characters). Its laws are `mind/CONSTITUTION.md`; keep
  `mind/ROLES.md` under its 6,000-character cap (it is the mind's own prompt).

## Before a pull request

- `npm test` passes (from the repo root; `CHROMIUM_PATH=/opt/pw-browsers/chromium` in agent sessions).
- Read the whole diff for secrets and personal content.
- Changes to sign-in, keys, or what is stored get a second, independent read before the owner is asked
  to merge; everything else just needs its tests.
- Look at anything on screen at phone size (390×844) before calling it done.

## How it ships (after the owner merges)

`npm run preflight` is the one command before you push, and again after merging `origin/main` into a
branch (about a minute): it rewrites the contract copies, then runs the type check, the contract check,
the site budgets, the Worker's static and line-cap tests and the mind's tests, the checks a merge most
often breaks. Merging to `main` runs Deploy: checks (skipped when Test already passed on exactly the
merged files, `scripts/tree-tested.mjs`), the Worker, then the site. Confirm the live `release.json` names
the commit. Rollback: Actions → Deploy → Run workflow with the previous commit. A change the owner will
notice gets a plain line in `frontend/whats-new.json` (a new `id`, at most four lines): home shows them
once as a card after the update.

## Design, briefly

The full system is [docs/design/DESIGN-SYSTEM.md](docs/design/DESIGN-SYSTEM.md). Home is one screen,
a chat; nothing stands on it to say all is well. Hold on an empty spot for the ring of seven apps.
Swipe right for the Briefing, left for the menu. Switzer only. Quick, springy motion that respects
reduced motion. Apps that play (Music, Podcasts) open inside home and shrink into the island.
