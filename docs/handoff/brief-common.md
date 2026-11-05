## Rules that bite (every step)
- Read AGENTS.md first; it is the law. Branch from `origin/main` (`git fetch origin main && git checkout -B <branch> origin/main`). Never merge main mid-task. Never push to main. Never commit `backend/node_modules`.
- Every source file ≤ 299 lines by `wc -l` (the static test counts the trailing newline): split into modules in the same area. No SQL across areas. Schema steps only add, in number order (Core is past step 35; Library at 3).
- No personal content, titles or real text in code, tests or docs: invented examples only. No model names of any vendor anywhere in the repo.
- Rows are metered (DATA.md): chunk and measure bulk work; cost pins in backend/tests/cost/budgets.json are measured values with 10 % headroom.
- Browser tests wait for conditions, never fixed timeouts (CHROMIUM_PATH=/opt/pw-browsers/chromium). Anything on screen: look at it at 390×844 (a Playwright screenshot is enough).
- mind/ROLES.md stays under 6,000 characters; each mind/skills/*.md ≤ 2,500. Phrase lint applies to every mind-written text (shared/contract/lint.ts).
- A What's new card in frontend/whats-new.json: new `id` dated today (date -u +%F), ≤ 4 lines, each ≤ 120 characters, plain words, one card per release (replace the current one).
- Before pushing, run what CI runs, not a subset: `npm run preflight`; `cd backend && npx tsc --noEmit` and `npx wrangler types --strict-vars false --check` (the Worker job runs both; after changing wrangler.jsonc regenerate and commit worker-configuration.d.ts); the backend suites you touched (`npx vitest run <files>`); biome; every root non-browser test (`node --test $(ls tests/*.test.mjs | grep -v browser)`: feel.test.mjs checks the shell's CSS for motion and type tokens, site.test.mjs the budgets, news-browser the card), and every browser test whose subject you touched (`CHROMIUM_PATH=/opt/pw-browsers/chromium node --test tests/<file>`).
- Commit message: plain words, why and what; end with exactly these two trailer lines:
  the Co-Authored-By trailer your session's attribution reminder gives
  `Claude-Session: https://claude.ai/code/session_01Dq8SF81yMukBRe8fQXj27A`
- Push with `git push -u origin <branch>`. Do not open the pull request; the lead does.
- Budget: about 100 tool calls; stop at 150 and report where you are. Final report under 20 lines: branch and commit, what shipped, checks run with results, cost pins measured, departures from the brief and why, anything left out.

## Your own worktree (rule added 2026-11-05 after agents collided in the shared checkout)
Never work in the repository directly: other agents run there at the same time. Make your own worktree and work only in it:
  cd the repository && git fetch origin main && git worktree add -B <branch> ../wt/<branch> origin/main
  ln -s the repository/node_modules ../wt/<branch>/node_modules
  ln -s the repository/backend/node_modules ../wt/<branch>/backend/node_modules
  mkdir -p ../wt/<branch>/frontend/ui/fonts && cp the repository/frontend/ui/fonts/*.woff2 ../wt/<branch>/frontend/ui/fonts/   # gitignored, the site test needs it
Run every command from ../wt/<branch>. After the final push: cd the repository && git worktree remove --force ../wt/<branch>. A verifier does the same with its own path (../wt/verify-<branch>).

## After merging origin/main before your push (rule 2026-11-05)
Re-run only what the merge touched: preflight, plus the backend suite only if a backend file changed in the merge, plus the browser tests for the pages the merge touched. CI runs the whole suite on the PR; do not run it all a second time.

## Report once (rule 2026-11-05)
Never hand back while a test run of yours is still going in the background: wait for every run you started (or stop it) before your report, and report exactly once. A hand-back with runs still going re-sends your report each time one ends, which costs the lead a wake-up every time.
