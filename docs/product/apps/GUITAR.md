# Guitar

> **Owner ruling 2026-10-28:** this app is first ported over **as it is**, with no changes. This spec describes where it goes *after* that port; nothing here is built until the owner agrees to it.

A tab reader and practice room for the owner's guitar playing, with a
quiet teacher in the margins and optional "ears" that listen only when switched on. This doc is
the source of truth for the reader, the practice flow, the teacher, the ears, data and tests.

Status: spec for phase P6 (see [ARCHITECTURE](../../engineering/ARCHITECTURE.md)). Fixed decisions
come from [decisions.md](../../process/decisions.md); anything marked **[proposal]** waits for the
owner's yes.

## Rules at a glance

1. **First the old app comes over as it is** (owner ruling 2026-10-28; see "First move" below).
   **alphaTab stays the engine** for reading, layout and the timeline (MPL-2.0, version 1.8.4,
   vendored unmodified under `frontend/vendor/alphatab-1.8.4/`). Later, only if the owner agrees,
   the old app's hard-won pieces (timeline maths, loops, speed trainer, sample voice) move into the
   new screens below **[proposal]**.
2. **Practice is measured in bars and BPM**, never in vague progress. Every loop pass, tempo step
   and session is a sense with a `tab:` ref.
3. **The teacher speaks in the margin, not in a chat box.** Tips sit beside the bars they are about,
   carry an attribution, and are hints first (the answer only on request).
4. **Ears are off unless the owner switches them on**, every session (owner ruling). Mic audio is
   analysed on the phone. Nothing is uploaded unless the owner taps "Send this take".
5. **Health beats progress.** A tension stop is one tap and always honoured; blocks are capped at
   75 minutes.
6. **The screen stays on while practising**, and only then.
7. **Tabs work offline** once opened or kept.
8. **Tab sources:** Songsterr (the owner has written permission for this project), plus the owner's
   own files. Other third-party sites stay off unless the owner adds them (§11).
9. **Music pauses when Guitar makes sound**, and does not resume by itself.

## First move: the as-is port (owner ruling)

1. Copy the old Guitar app into the new site at `/guitar/` **unchanged**: its screens, alphaTab,
   player, samples, Songsterr search and saved tabs.
2. Adjust only what it strictly needs to run on the new site:
   - every asset and link path made root-absolute (the host serves `/guitar` without a redirect);
   - the API address left as it is: the ported app keeps calling the old Worker (`jarvis-hub-api`),
     including the Songsterr fetch (§11), until its data moves in P6; the new site's origin is added
     to the old Worker's allowed origins (ask first; [MIGRATION](../../engineering/MIGRATION.md) §6);
   - its own `<meta>` security policy kept first in `<head>`, unchanged except for the new paths
     ([SECURITY](../../engineering/SECURITY.md) §4.4).
3. The owner's songs, loops, speeds, practice log and prefs are restored unchanged on the new origin
   **[proposal: through the export page, §12]**.
4. Done when the owner practises on the phone and nothing has changed.
5. **The data move (P6, built).** Guitar's tab sources (Songsterr search, songs and tracks, GProTab
   search and downloads, the samples) come through the new Worker for the owner's device
   (`/v1/guitar/*`, the old routes ported). The app is unchanged but for its sources module: when
   the owner is signed in on this site it asks the new Worker with that session
   (`frontend/th/ported/session.js`, a top-level page only), else the old Worker as before. Its
   page's CSP gains the API host at deploy; the old host leaves it when the old Worker retires.

Everything after this section describes later steps. Each is proposed after the port and built only
if the owner agrees.

## Contents

1. Data · 2. Screens · 3. The reader · 4. Practice flow · 5. Sound (playback voice, metronome,
count-in) · 6. The teacher · 7. The ears · 8. Senses, verbs, surfaces · 9. Wake lock and
background · 10. Offline · 11. Tab sources · 12. Import from the old site · 13. Accessibility ·
14. Empty and error states · 15. New feature ideas · 16. Open questions / tests

---

## 1. Data

| Data | Home | On the phone |
|---|---|---|
| Tab files (Guitar Pro `.gp`/`.gp5`/`.gpx`, MusicXML, alphaTex) | `thunderhead-private/tabs/<sha256>.<ext>` | OPFS `guitar/tabs/<sha256>.<ext>` |
| Song records (title, artist, file, chosen track, status, star, last bar, loop, speed, best BPM, sections) | `Core` lists (`guitar.songs`) | IndexedDB `th-guitar/songs` |
| Sections (named bar ranges) | Inside the song record | same |
| Practice log | Senses, rolled up nightly | IndexedDB `th-guitar/log` (last 400 days) |
| Prefs (voice, click volume, tab size, latency) | `Core` settings | IndexedDB `th-guitar/prefs` |
| Ears calibration per output route | Phone only | IndexedDB `th-guitar/calibration` |
| Takes (recordings) | Only if sent: `thunderhead-private/takes/<uuid>.opus` | OPFS `guitar/takes/` until sent or deleted |
| Teacher tips and the weekly plan | `Core` surfaces | IndexedDB surface cache |

Refs: a song is `tab:<songId>`; a bar range is `tab:<songId>#b12-16` (bars are 1-based, as printed);
a take is `take:<uuid>` **[proposal for the take form]**.

Song status values (harvested): `learning` · `practicing` · `canplay` (shown as Learning ·
Practising · Can play), plus a star.

---

## 2. Screens

```
Guitar (route /guitar/)
├── Today            the plan for today (from the teacher), Continue button, this week's minutes
├── Songs            Learning · Practising · Can play · All (segmented); search
├── Song             sections list, best BPM per section, history sparkline, Open tab
├── Reader           full-screen tab with the practice transport            (/guitar/song/<id>)
│   ├── Speed sheet  speed, tempo ladder
│   ├── Click sheet  metronome, count-in, visual click
│   ├── Ears sheet   switch on, calibrate, last results
│   └── Display      tab size, fretboard, notation on/off, track
└── Add a tab        from a file, from the + sheet's Files, or from a public-domain source
```

Look (later redesign, only if the owner agrees; the ported app keeps its own look):
[DESIGN-SYSTEM](../../design/DESIGN-SYSTEM.md). Guitar's accent is `#e08a1e`. Teacher text is
the Thunderhead speaking, so it is Fraunces italic; everything else is Inter. The tab itself is
drawn by alphaTab with Bravura (OFL) in ink on the page background; night theme draws it in
`#e6e6e6` on black.

### 2.1 Today

Top to bottom:
1. Voice line (Fraunces italic 20/26), at most 2 lines, from the `guitar.plan` surface: "Today:
   the second section at 84, then a slow run of the whole piece."
2. **Continue** button (filled, Guitar accent): opens the reader on the first planned block, loop
   and speed already set.
3. Plan blocks for today (max 4): section name, bars, target BPM, minutes. Tap = open that block.
4. This week: 7 day dots (filled when ≥ 1 minute practised) and total minutes; no streak count (GROW-1).
5. Recent songs (max 6).

With no plan (teacher off or no songs): Continue opens the last song at its last bar.

### 2.2 Song page

Header (cover or initials tile, title, artist), status chooser, **Open tab** button, then:
- **Sections:** rows of name · bars · best clean BPM / target BPM · a 14-day sparkline. Add a
  section from the reader (§4.1).
- **History:** minutes per day for 12 weeks (bar chart per [dataviz rules](../../design/DESIGN-SYSTEM.md)).
- Menu: Change track · Keep offline · Export PDF · Remove from my songs (asks; the file stays in
  private storage for 30 days **[proposal]**).

---

## 3. The reader

### 3.1 Layout (390 × 844)

| Zone | Spec |
|---|---|
| Top bar (auto-hides after 3 s of playback, returns on tap) | Back, song title, section chip ("B 12–16"), ··· |
| Tab | alphaTab render, horizontal page layout off, vertical scroll. The playing system sits in the upper third, always fully above the fretboard |
| Margin | A 40 px right gutter where teacher tips appear as small Fraunces-italic marks (§6.2) |
| Chord strip | The current and next chord names when the score has chord symbols |
| Fretboard (optional) | Bottom strip, 72 px, shows the notes sounding now and the next beat's notes in a lighter tone. Tap to hide (undo toast) |
| Transport | Loop · Speed (shows "84%" and BPM) · Play/Pause (64 px) · Click · Ears (dot when on) |

### 3.2 Reading behaviours (harvested)

1. The cursor moves beat to beat, interpolated inside the bar, compensated for output latency
   (`outputLatency`) plus the owner's cursor offset (−300 to +300 ms, 10 ms steps).
2. Auto-scroll keeps the playing line in the upper third. A manual scroll pauses auto-scroll for
   4 s, then it eases back.
3. Tap a bar → the cursor jumps there (paused) or playback continues from there (playing). With
   repeats, a tap goes to the next occurrence of that written bar at or after the cursor.
4. The song remembers: last bar, loop, speed, chosen track. Reopening restores all four.
5. Tab size: 70 % · 85 % · 100 % (default 85 %). Notation staff on/off (default off for tab-only
   reading **[proposal]**).
6. Track choice: for multi-track files, a chooser lists guitar tracks first; "All guitar tracks"
   plays them one after another (harvested).
7. Export PDF: renders notation and tab to A4 pages locally (alphaTab's SVG output printed through
   the system print dialog) **[proposal: replaces the old 500 KB PDF writer]**.

### 3.3 Engine split

- alphaTab runs in its web worker for layout and score parsing. Its built-in synth is not used
  **[harvested decision]**; the timeline it produces drives our own player (§5).
- alphaTab's `EnabledExternalMedia` mode (since 1.6) is used for play-along with a recording
  (§15 idea 1).

**Acceptance:** a generic public-domain fixture tab (written for the repo) opens in ≤ 1.5 s warm
on 4× CPU; tapping bar 9 then Play starts at bar 9 within 100 ms of the count-in end; reopening
restores bar, loop and speed.

---

## 4. Practice flow

### 4.1 Sections

- A section is a named bar range (e.g. "Intro", "Part B"; names ≤ 30 characters).
- Make one: Loop → tap first bar → tap last bar → "Save as section" in the loop menu.
- The teacher may propose sections from the score's own markers (rehearsal marks, repeats); they
  arrive as surfaces and become real only on the owner's tap **[proposal]**.

### 4.2 Loops (harvested, extended)

| Action | Result |
|---|---|
| Loop button (no loop) | "Tap the first bar to loop." → tap → "From bar 12. Now tap the last bar." → tap → loop set, bars tinted |
| Loop button (loop on) | Menu: Choose other bars · Loop this bar only · Save as section · Stop looping |
| Loop pass | Playback jumps from the loop end to the loop start; the count-in plays again only if "Count in every pass" is on (default off) |
| Gap between passes | 0 · 1 bar of rest **[proposal]** (default 0) |

### 4.3 Tempo ladder

The old speed trainer (+5 % each pass up to 100 %) becomes a ladder gated on clean passes
**[proposal]**.

| Setting | Range | Default |
|---|---|---|
| Start | 40–100 % of the target BPM | 70 % |
| Target | BPM, defaults to the score's tempo or the plan's target | score tempo |
| Step | 2–10 % | 4 % |
| Clean passes to step up | 1–5 | 2 |
| Step down after | 2 failed passes in a row | −8 % |
| Ceiling | Target, or 110 % for "overspeed" practice | Target |

How a pass is judged:
- **Ears off:** after each pass a two-button strip shows for 3 s: **Clean** · **Not yet** (big,
  bottom of screen, reachable with the right thumb; keys `C`/`N`). No answer = not counted.
- **Ears on:** a pass is clean when ≥ 90 % of onsets fall within ±30 ms of expected and the
  expected-note check passes on ≥ 90 % of notes (§7.4). The owner can override with the same
  buttons.

The ladder aims for a success rate around 70–85 % (a heuristic, not a law; plan §16.10). If the
last 10 passes are ≥ 95 % clean, the step doubles once; if ≤ 40 %, the teacher suggests a slower
start next time.

Best clean BPM per section is recorded when a clean pass completes at a new high.

**Acceptance (unit, fake clock):** a scripted run of passes (C, C, N, C, C, N, N) produces the
exact speed sequence in a table; best BPM updates only on clean passes.

### 4.4 Tension stop

- A **Rest** button sits in the ··· menu and as a long-press on Play (600 ms). Tapping it: pause,
  log `guitar.tension`, show "Hands down for a minute. Shake them out." with a 60 s ring timer.
- Rule (plan §16.10): stop if a finger curls or drags involuntarily. The teacher repeats the rule
  in the first session of each week, once.
- Two tension stops in one session → the teacher suggests ending the session; the ladder will not
  step up for the rest of that day.
- **Blocks:** after 25 minutes of continuous practice a gentle margin note suggests a 3-minute
  break **[proposal]**; a session over 75 minutes shows "Good place to stop for today." once
  (the Segovia guideline from the plan's knowledge base).

---

## 5. Sound

### 5.1 Playback voice (harvested)

- Our own Web Audio player plays the alphaTab timeline on real guitar samples: one voice per
  string (a new note on a string stops the last), strummed chords, let-ring, palm mute, dead notes,
  harmonics, bends, slides, vibrato.
- Instruments: Nylon (default **[proposal]**) · Steel acoustic ·
  Electric (Clean · Jazz · Crunch · Drive).
- Samples: FluidR3 GM (CC BY 3.0). **[proposal]** Vendor the nylon set into
  `frontend/vendor/fluidr3-nylon/` with its attribution in the credits page, instead of proxying a
  third-party host at run time; other sets download on first use into Cache Storage `th-guitar-samples`.
- Voice shaping per set (shelf, presence, air, cabinet low-pass, level), a light compressor and a
  room reverb (0–100 %, default 22 %).
- Its own `AudioContext({latencyHint: 'interactive'})`, separate from the music engine, for tight
  click timing. Starting it pauses Music ([MUSIC](MUSIC.md) §5.8).

### 5.2 Speed

25–150 % in 5 % steps; presets 50 · 70 · 85 · 100 %. The sheet shows the BPM at the current speed
("84 BPM at 82 %").

### 5.3 Metronome and count-in

| Setting | Values | Default |
|---|---|---|
| Click while playing | on/off | off |
| Click only (mute the guitar voice) | on/off | off |
| Count-in | Off · 1 bar · 2 bars | 1 bar **[proposal: the old default was off]** |
| Click volume | 0–100 % | 70 % |
| Accent | First beat louder (+6 dB, higher pitch) | on |
| Compound meters | 6/8, 9/8, 12/8 click on the dotted quarter | always |
| Visual click | A soft edge pulse in the Guitar accent on each beat; stronger on beat 1 | off; forced on with Bluetooth output (§7.1) |
| Subdivision | none · 2 · 3 · 4 | none |

Clicks are scheduled with the audio clock 160 ms ahead (lookahead), never with timers.

**Acceptance:** an OfflineAudioContext render of 8 bars at 102 BPM with click on places every
click within ±1 ms of the expected sample; compound 6/8 produces 2 clicks per bar.

---

## 6. The teacher

**Built first on the phone (2026-10-30, the owner's day-1 request: "guitar tips per section like a
real teacher"):** `frontend/th/guitar/teacher.js` reads the reader's own tab timeline section by
section (the tab's sections, else 8 bars) for what makes it hard (fast runs, wide reaches, big
shifts, barres, slurs, bends, slides, vibrato, palm mutes, harmonics, strummed chords, quick chord
changes, length) and gives at most three tips a section from 14 attributed templates, each a hint
with "Show me" for the concrete step and whose approach it follows (in our words, no quotations).
A section's label in the reader opens them (one recorded `improvement` edit to `reader.js`). The
mind's tips from practice data (§6.2's margin, §6.3's plan, §6.4's metrics) come with the practice
senses and the ears, beside these.

The teacher is the mind's `guitar-teacher` skill (`mind/skills/guitar-teacher/`), working from the
owner's practice senses. It writes surfaces at night (`mind-night`) and, when the owner asks, in
chat. It never writes into the score itself. See [BEHAVIOR](../../mind/BEHAVIOR.md).

### 6.1 Knowledge base

- **24 attributed tip templates** (plan §16.10): approaches drawn from the published teaching of
  Segovia, Parkening and de Lucía, and from practice research (deliberate practice, interleaving,
  slow practice, rest). Each template:

  ```json
  {"id": "slow-hands-first", "source": "Practice research: slow, accurate repetition",
   "attribution": "after Segovia's advice on slow practice", "text": "Play {bars} at {bpm} until three passes are even, then move up.",
   "when": {"metric": "evenness_cv", "above": 0.12}, "kind": "hint"}
  ```

- Attributions are "after X" summaries in our own words. **No invented quotations**; a direct
  quote is used only if its published source is cited in the template file.
- Templates live in the repo (generic; no personal data). The owner's progress lives only in
  private storage.
- The current piece's facts (key, harmony, target tempo) live in the song record and private
  memory, never in the repo. Example in tests: a generic two-chord vamp at a mid tempo.

### 6.2 Margin tips

| Rule | Value |
|---|---|
| Anchored to | A bar range ref (`tab:<id>#b12-16`); shown in the right gutter beside the first bar of the range |
| Look | A 6 px dot in the Guitar accent in the gutter; tap → a small card (Fraunces italic 15/22, ≤ 160 characters) with the attribution line in Inter 12/16 ink-3 |
| Per screen | At most 2 tips visible at once; at most 5 per song |
| Hint first | The card shows a hint; "Show me" reveals the concrete fix (fingering, rhythm count), and that tap is a sense |
| Lifetime | Expires after 14 days or when its metric goal is met |
| Feedback | "Helpful" / "Not now" on the card; "Not now" hides it for 7 days |

### 6.3 Weekly plan

- Built by `mind-night` on the first night of the owner's week (Monday 04:00 roll) and adjustable
  by asking in chat.
- Shape: 5 practice days, each 20–60 minutes (never over 75), made of blocks:
  `{song_ref, section_ref, minutes, start_bpm, target_bpm, focus: 'timing'|'evenness'|'notes'|'memory'|'run-through'}`.
- Each day ends with one slow full run-through of the current piece **[proposal]**.
- Targets rise at most 6 BPM per section per week **[proposal]**.
- Shown on Today (§2.1) and as the Briefing's practice line ([BRIEFING](../BRIEFING.md)).

**Acceptance:** an eval in [EVALS](../../mind/EVALS.md) feeds a week of synthetic practice senses
and checks the plan: no day over 75 minutes, every block has a ref that exists, targets rise ≤ 6
BPM, and a section with two tension stops gets no target increase.

### 6.4 Recording metrics (what the teacher reads)

| Metric | From | Good target **[proposal]** |
|---|---|---|
| Timing offset (mean, ms; negative = rushing) | Ears | within ±10 ms |
| Timing spread (SD, ms) | Ears | ≤ 15 ms |
| On-time share (±30 ms) | Ears | ≥ 90 % |
| Evenness (coefficient of variation of gaps in scalar runs) | Ears | ≤ 0.08 |
| i/m loudness balance (dB difference between alternating strokes) | Ears | within ±2 dB |
| Expected-note accuracy | Ears | ≥ 95 % |
| Clean-pass rate | Ladder | 70–85 % |
| Best clean BPM per section | Ladder | the plan's target |
| Minutes per day | Practice log | the plan's minutes |

---

## 7. The ears

### 7.1 Switching on

1. Ears button in the transport → sheet: "Listen while I practise" switch, the last calibration,
   and "What happens to the sound: it's analysed on this phone and thrown away. Nothing is sent
   unless you tap Send this take."
2. Switching on calls `getUserMedia({audio: {echoCancellation: false, noiseSuppression: false,
   autoGainControl: false, channelCount: 1}})`. The browser's mic prompt appears only the first
   time.
3. While on: a small amber dot in the transport and the edge light's "listening" state
   (brighter edge, per the presence ruling).
4. Ears switch **off by themselves**: leaving the reader, the page going hidden, 10 minutes with no
   playback **[proposal]**, or a tension stop. The mic track is stopped (`track.stop()`), not muted.
5. Bluetooth output: if `outputLatency` > 60 ms or the output label says Bluetooth, show "Timing
   feedback needs the phone speaker or wired earphones. Note checks still work." Timing metrics are
   then hidden and the visual click turns on.

**Acceptance:** browser test with a fake media stream: switching on starts exactly one track;
navigating away stops it (`readyState === 'ended'`) within 100 ms; no network request carries audio.

### 7.2 Calibration

Measures the loop delay from click out to mic in, per output route.

1. "Put the phone on a table, speaker up, room quiet." → Start.
2. Play 12 clicks (1 kHz, 5 ms, −6 dBFS) at random intervals 600–900 ms.
3. Detect each click's onset in the mic signal (AudioWorklet); the delay = onset time − scheduled
   time.
4. Drop the 2 highest and 2 lowest; accept if the remaining 8 have SD ≤ 3 ms. Else retry once,
   then show "Too noisy to measure. Try a quieter spot."
5. Store `{route, delay_ms, sd_ms, at}`. Recalibrate when the route changes or after 30 days.

Not yet measured on the owner's phone; this is the first test of P6 (§16).

### 7.3 Onset timing and evenness

- An onset detector in an AudioWorklet: spectral flux on 1024-sample frames, hop 128 (2.7 ms at
  48 kHz), adaptive threshold (median of the last 0.5 s × 1.5 + floor), minimum gap 40 ms. Our own
  code; no GPL detectors (aubio and similar are excluded by licence).
- Detected onsets are matched to expected note starts from the alphaTab timeline at the current
  speed, shifted by the calibration delay. Match window ±80 ms; nearest wins; each expected note
  matches at most one onset.
- Reported per pass: mean offset, SD, on-time share, missed notes, extra onsets.
- Evenness: for runs of ≥ 6 single notes of equal written value, the coefficient of variation of
  inter-onset gaps; loudness difference between odd and even strokes (proxy for i/m alternation).
- Target resolution ±10 ms for rushing and dragging (plan §16.7).

### 7.4 Expected-note check

- We check the note the tab expects; we never try to transcribe. Pitch from pitchy (MIT) over a
  46 ms window starting 20 ms after the onset; pass if within ±50 cents of the expected pitch
  (any octave error counts as a miss).
- Chords: a 12-bin chroma vector over 120 ms, cosine against the expected chord template; pass at
  ≥ 0.8.
- Strummed and percussive strokes are skipped for the pitch check (no single expected pitch).

### 7.5 Takes

- "Record a take" (in the Ears sheet): records the mic (Opus via `MediaRecorder`, ≤ 10 minutes)
  together with the expected timeline, into OPFS.
- After recording: "Keep on phone" · "Send this take" · "Delete". Send uploads to
  `thunderhead-private/takes/` and emits `guitar.take`. Only then can the mind listen (an
  after-take polyphonic report with Basic Pitch, Apache-2.0, run in the mind's sandbox or an
  Actions job that never logs content **[proposal]**).
- Unsent takes are deleted after 7 days **[proposal]**, with a note on Today 1 day before.

---

## 8. Senses, verbs, surfaces

### 8.1 Senses

| Type | When | `ref` | `data` |
|---|---|---|---|
| `guitar.open` | Reader opened | `tab:<id>` | `{bar}` |
| `guitar.session` | Reader closed or 10 min idle | `tab:<id>` | `{seconds, played_seconds, sections: [refs]}` |
| `guitar.pass` | A loop pass ends | `tab:<id>#b12-16` | `{bpm, speed_pct, clean: true|false|null, by: 'owner'|'ears', metrics?}` |
| `guitar.bpm` | A new best clean BPM | `tab:<id>#b12-16` | `{bpm}` |
| `guitar.tension` | Rest tapped | `tab:<id>#bN-M` | `{minutes_in}` |
| `guitar.tip` | A tip shown, "Show me", Helpful, Not now | tip surface id | `{op}` |
| `guitar.ears` | Ears on/off, calibration result | `tab:<id>` | `{on, delay_ms?, sd_ms?, route}` |
| `guitar.take` | A take is sent | `take:<uuid>` | `{song_ref, seconds}` |
| `guitar.song` | Status, star, section created/renamed | `tab:<id>` | `{op, value}` |

`metrics` holds numbers only (offsets, SD, shares), never audio. Practice time counts in 5 s steps
while playing or with a touch, scroll or key in the last 90 s (harvested), and only while visible.

**Acceptance:** a scripted session of 3 loop passes produces exactly 3 `guitar.pass` events, one
`guitar.session` with `seconds` within ±5 of the scripted time, and no event contains audio data.

### 8.2 Verbs (`frontend/apps/guitar/verbs.js`)

| Verb | Args | Does | Undo |
|---|---|---|---|
| `guitar.open` | `{ref, speed_pct?, loop?}` | Opens the reader at the bars with loop and speed set (needs the owner present; otherwise it becomes Today's Continue target) | Restore the previous Continue target |
| `guitar.set_section` | `{song_ref, name, bars}` | Adds a proposed section (shown dashed until the owner taps Keep) | Remove it |
| `guitar.set_plan` | `{week, days}` | Replaces this week's plan | Restore the previous plan |
| `guitar.set_status` | `{ref, status}` | Only when the owner asked in chat | Restore |

### 8.3 Surfaces

| Slot | Content |
|---|---|
| `guitar.margin` | Tips per bar range (§6.2) |
| `guitar.plan` | This week's plan and today's voice line (§6.3) |
| `guitar.section` | Proposed sections |
| `briefing.practice` | One line for the Briefing: "Practice: second section at 84 · 25 min" (no streak, GROW-1) |

---

## 9. Wake lock and background

1. `navigator.wakeLock.request('screen')` while the reader is visible **and** (playing, or touched
   in the last 90 s). Released when idle 90 s, on leaving the reader, or when hidden.
2. Re-acquired on `visibilitychange → visible` if the conditions still hold.
3. Guitar playback stops when the page is hidden (practice needs the screen); it does not use Media
   Session **[proposal]**. The owner can still play Music in the background before opening Guitar;
   it pauses when Guitar makes sound.

**Acceptance:** browser test: playing → `wakeLock` held; pause and wait 90 s (fake clock) →
released; hide → released and the mic (if on) stopped.

---

## 10. Offline

- Opening a tab stores its file in OPFS; "Keep offline" pins it (never evicted). Unpinned tabs are
  kept for 90 days since last open **[proposal]**; tabs are small (typically under 1 MB).
- Song records, sections, prefs and the plan are in IndexedDB; the reader works fully offline.
- Senses queue in the outbox and flush later.
- Samples for the chosen instrument are cached after first use (nylon is precached with the app if
  vendored).

**Acceptance:** Playwright offline after one open: the tab opens, plays, loops, and logs passes.

---

## 11. Tab sources

| Source | Status | Notes |
|---|---|---|
| Owner's own files (Guitar Pro, MusicXML, alphaTex), added through Guitar's "Add a tab" or the home `+` sheet › Files | **v1** | Stored privately; the owner is responsible for having the right to use them |
| Public-domain or openly licensed scores (e.g. older classical works the owner downloads) | **v1**, as files | Same path as above |
| Songsterr, fetched through the old Worker by the ported app (P1b), then through the new Worker from P6, as the old app did | **v1** | Owner ruling 2026-10-28: the owner has written permission from Songsterr for this project. Search, open, and keep offline copies work as in the old app. The Worker caches responses privately and never puts tab data in logs |
| gprotab.net (proxied by the old Worker) | **Owner decision before the port** | The old app uses it, so an as-is port brings it along; its terms are not reviewed. Ask the owner whether it comes over |
| "Open on the site" links | **v1** | A song record may hold a plain link the owner opens in the browser; no fetching |

The old app's song list (titles, status, loops, speeds, practice log) is imported (§12); Songsterr
tabs reopen from Songsterr by their song id.

---

## 12. Import from the old site

From the old origin's localStorage `jarvis.guitar.v2` via the old site's `/export/`
([MIGRATION](../../engineering/MIGRATION.md)).

| Old field | New | Rule |
|---|---|---|
| `songs[key]` title, artist, status, star, added, opened | Song record | Kept; source marked `imported` |
| `bar`, `loop` (bar indices), `speed`, `best` | Song record | Kept; loops shown once a tab file is attached |
| `seconds` per song, `log[day].total` and per-song seconds | Practice history (`imported` rows) | Shown in history and the week's day dots; not re-emitted as senses |
| `prefs` (instrument, tone, reverb, click volume, count-in, latency, tab scale, trainer) | Prefs | `latency` becomes the cursor offset; trainer step/target become ladder step/target |
| `searches` | Not imported | — |
| Saved tab copies (Cache Storage `jarvis-guitar-v1`) | Not moved | Songsterr is permitted (§11): they re-fetch from Songsterr by song id on first open |

Imported songs without a file show "Add the tab file to practise this song".
**Acceptance:** counts (songs, days of log, total minutes) match the export.

---

## 13. Accessibility

1. The tab is visual by nature; the reader still exposes bar numbers, the current chord and the
   section through an `aria-live` polite region at bar changes when TalkBack is on.
2. All transport controls are buttons with names ("Loop bars 12 to 16", "Speed 84 percent").
3. Keyboard (harvested): Space play/pause, `L` loop, `[` / `]` speed −/+5 %, ←/→ previous/next bar,
   `C`/`N` clean/not yet.
4. Visual click for anyone who can't hear the click or uses Bluetooth.
5. Reduced motion: no smooth auto-scroll (jump per system), no edge pulse (a static dot blinks
   instead).
6. Targets ≥ 44 px; Clean/Not yet buttons are 56 px tall.

---

## 14. Empty and error states (copy)

| State | Text | Action |
|---|---|---|
| No songs | "Add a tab to start practising." | Add a tab |
| File not readable | "This file isn't a tab I can read. Guitar Pro, MusicXML or alphaTex files work." | Choose another |
| Imported song without a file | "Add the tab file to practise this song." | Add file |
| Mic permission denied | "The ears need the microphone. You can allow it in the browser's site settings." | — |
| Calibration failed | "Too noisy to measure. Try a quieter spot." | Try again |
| Samples failed to load | "Couldn't load the guitar sound. The click still works." | Try again |
| Offline, tab not on phone | "This tab isn't on this phone yet. Open it once while online." | — |
| No plan | Today shows the last song with Continue; no voice line | — |

---

## 15. New feature ideas (all [proposal])

1. **Play along with the real recording.** If the piece is in the owner's Music library, attach it:
   the owner taps once on the downbeat of each section while it plays to create sync points;
   alphaTab's external-media mode then moves the cursor with the recording, slowed with
   pitch-preserving `playbackRate` (down to 50 %). Loops work on the recording too.
2. **Hard-bar finder.** From ears data, the bars with the most timing misses across the last 5
   sessions are tinted faintly in the tab, and the teacher's next plan starts there.
3. **Interleaved warm-up.** Today begins with a 5-minute warm-up that rotates three short sections
   from different songs every 90 s (interleaving research), at 80 % of best.
4. **Memory mode.** Fades the tab bar by bar for a section the owner can play cleanly at target;
   the cursor still moves, and a tap reveals the bar for 2 s. Passes in memory mode are logged
   with `focus: 'memory'`.
5. **Take-to-take compare.** Two sent takes of the same section shown as a timing strip (offset per
   note), so the owner sees rushing shrink week to week.

---

## 16. Open questions / tests

| # | Question | How to settle |
|---|---|---|
| 1 | Mic loop delay and its stability on the phone of record (speaker and wired) | Calibration screen in P6, 10 runs each; accept if SD ≤ 3 ms |
| 2 | Can the onset detector reach ±10 ms on nylon-string attacks in a normal room? | Record 20 metronome-locked passes, compare against hand-marked onsets |
| 3 | Basic Pitch without `SharedArrayBuffer` (no COOP/COEP on the host): speed of a 60 s take | Run single-threaded in the mind's sandbox or an Actions job; measure |
| 4 | alphaTab 1.8.4 worker and fonts under the site's CSP (no `unsafe-eval`) | Browser test with the production CSP |
| 5 | FluidR3 sample redistribution: confirm CC BY 3.0 wording and attribution | Read the upstream licence file before vendoring |
| 6 | alphaTab's bundled Sonivox SoundFont licence (only matters if its synth is ever used) | Read the alphaTab repo notices |
| 7 | gprotab.net: keep it as a second source? (Songsterr is settled: permitted) | Owner decision before the port (the old app uses it) |
| 8 | Does the Clean / Not yet strip slow practice down? | Owner tries 3 sessions; option to auto-count passes as clean |
| 9 | Pass criteria (90 % within ±30 ms) too strict or loose for the current piece | Compare with the owner's own judgement over 50 passes |
