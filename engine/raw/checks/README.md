# Check scripts

The headless checks the editor and engine were built against (Playwright, Chromium with a software GPU), kept here so they outlive a session. Not run by Test. They expect the site served locally (`node scripts/serve.mjs`), sample RAFs beside them under `raf/` and `raf2/` (not in the repository), and take `BASE`, `FILE` and `TAG` from the environment. `sweep.sh` runs a list of them one at a time; `sync.py` brings the sample pages up to date with the editor's templates. To be pruned.
