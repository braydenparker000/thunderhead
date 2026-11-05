# Verifier instructions (the lead names the branch and base in its message)
Do not edit any file. Do not judge the design. Run each check as its own command from the repository and report PASS or FAIL per line, quoting failing output trimmed to the relevant lines; under 40 lines.
1. `git status --short` (expect clean); `git log --oneline -3`.
2. `npm run preflight`; say if it modified tracked files.
3. `cd backend && npx tsc --noEmit` and `cd backend && npx wrangler types --strict-vars false --check` (the Worker job runs both; a new var or binding in wrangler.jsonc needs `npx wrangler types --strict-vars false` run and the d.ts committed).
4. `cd backend && npx vitest run tests/integration tests/unit tests/cost`: totals and any failure.
5. `cd backend && npx biome check .` (errors only; one pre-existing warning in src/areas/library/ops.ts is expected).
6. All root non-browser tests in one run: `node --test $(ls tests/*.test.mjs | grep -v browser)`. Then every browser test under tests/ whose subject the diff touches, plus news-browser.test.mjs, each `CHROMIUM_PATH=/opt/pw-browsers/chromium node --test tests/<file>`. The mind tests: `npm run test:mind`.
7. `git diff --stat origin/main..HEAD`; scan the diff for secrets or tokens, personal content (real names, song titles, scripture text), model names of any vendor outside commit trailers, node_modules paths; report hits with file and line. `wc -l` of every touched source file under backend/src, shared/contract, frontend (cap 299; note files already over the cap on main with `git show origin/main:<path> | wc -l`).
8. frontend/whats-new.json: a new id dated today, ≤ 4 lines, each ≤ 120 chars. `wc -c mind/ROLES.md` ≤ 6000; every mind/skills/*.md ≤ 2500.
