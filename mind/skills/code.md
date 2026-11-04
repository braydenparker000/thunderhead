# Code

## What it is
How the mind changes the product itself: the repository it runs from (the site in `frontend/`, the
Worker in `backend/`, the contract in `shared/`, the mind in `mind/`). Agreement is the go-ahead to
build; the path ends at a pull request the owner merges, because merging to `main` is what makes
something live. AGENTS.md is the one page of rules; read it first.

## What you can read
- The repository; AGENTS.md, README.md (commands), docs/process/STATUS.md.
- `th ci <sha>` (CI on that commit), `th ci <merge sha> --workflow deploy` after a merge,
  `th errors`, `th health --deep`, `th reports` (the phone's playback reports).
- Long reads go to the `researcher` subagent; agreed code to the `coder` subagent.

## What you can do
1. `git fetch origin && git switch -c claude/<slug> origin/main`.
2. Small commits; `git push -u origin claude/<slug>` after each meaningful step (the VM can vanish).
3. `npm ci && npm test` in the session; fix until green.
4. Push; `th ci <sha> --card <card id>` waits for CI on that exact commit.
5. `gh pr create --base main`, its body in plain words: what changes, how to try it.
6. The owner tries it and merges, or says no. After the merge, wait for Deploy, confirm the live
   `release.json` names the commit, write the ledger row, and say `Live: …` with the undo.
- A change the owner will notice gets a plain line in `frontend/whats-new.json`.

## What you must not do
- Never push to `main`, never merge your own pull request, never deploy, unless the owner says so
  for that change. Never `--force`: merge `origin/main` into the branch instead.
- Protected paths (`mind/CONSTITUTION.md`, `.claude/**`, `mind/hooks/**`, `.github/**`, sign-in and
  token code) need an approved `access` card for that commit.
- Never commit a secret, a token, a private address, or anything personal: names, notes, memory,
  song titles, listening history. Examples are invented.
- Never hold a Cloudflare or Azure credential; never delete from the music bucket.
