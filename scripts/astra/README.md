# Astra playback checks

What Astra really does with a file, measured in a real Chrome rather than argued. Nothing here runs
in CI: the films are made on the spot (about 250 MB) and the runs take minutes.

Needs `ffmpeg` with the usual encoders, Playwright (the repo's), and a Chrome that decodes H.264 and
AAC (Chrome or Chrome for Testing, not plain Chromium): `CHROME=/path/to/chrome`, default
`/usr/bin/google-chrome`.

```bash
bash scripts/astra/gen.sh scripts/astra/media
```

```bash
node scripts/astra/serve.cjs scripts/astra/media 8090 &
```

```bash
npm run serve &
```

| Script | What it answers |
|---|---|
| `gen.sh <dir>` | Makes the test films: 8 s of a moving test picture with a clock and a tone, one for each container and codec pairing worth trying, plus a three-minute 1080p film. |
| `serve.cjs <dir> [port]` | Serves them the way a file host does: byte ranges, readable from another origin. |
| `run.cjs [name filter]` | Plays each film through `/astra/lab/`: the mode chosen, whether the picture and the sound really ran, the first frame, a seek, the first error. Writes `out/matrix.json`. |
| `one.cjs <file> [seconds] [seek to]` | One film with the player's own log (`ALL=1` adds the software decoder's). |
| `smooth.cjs <file> [cpu slowdown] [bytes per second]` | Start-up, frame pacing, stalls, long tasks on the page's thread, far and near seeks, an audio switch. `6 2500000` is close to a slow phone on 20 Mbit/s. |
| `seektrace.cjs <file> <to> [cpu] [net]` | What one far seek waits for: the blocks asked for, each download, when picture and sound are buffered again. |
| `hops.cjs <file> [count]` | Many seeks, most of them inside the buffer and at any frame: each must show a picture at the place, with no decode error. |
| `heard.cjs <file>...` | The sound that really reaches the speakers, whichever way the film is played (the software decoder has its own audio graph, which `tone.cjs` cannot hear): the loudest pitch and the level. |
| `tone.cjs <file>...` | The sound a film really makes: its loudest pitch and its level on each side (the test tone is 440 Hz; 5.1 sound is mixed to stereo with the centre at -3 dB). |
| `rewrap.mjs <in> <out>` | A film's video re-wrapped as Astra does it, saved as a file for `ffmpeg -v error -i <out> -f null -` (no output means every frame decoded). The check for HEVC, which desktop Chrome cannot play. |

`run.cjs` calls a film STILL or BLACK from two looks at the picture half a second apart; a film it
marks FAILS for that alone (MPEG-PS, a four-second film) is worth one look with `one.cjs` before it
is believed. Results and what is still not playing are in `frontend/astra/README.md`.
