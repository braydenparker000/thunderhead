"""The listening pass's analyzer (docs/engineering/JOBS.md §3): one song's numbers from its audio.

`python -m jobs.audio --job <id>` is what .github/workflows/jobs-audio.yml runs; `--local <dir>` analyses
WAV or Opus files on this machine and prints the results; `--selftest` checks the analyzer on synthetic
tones before a job touches any real song. NAME and VERSION are the analyzer every result names; the
Worker's ANALYZER (shared/contract/listen.ts) must equal them (tests/jobs-audio.test.mjs), and a new
VERSION makes every song due again.
"""

NAME = "th-audio"
VERSION = "2.0.0"
