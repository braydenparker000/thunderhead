# The next batch (agreed with the owner, 2026-10-31)

Three parts, in this order: playback reporting first (so every change after it is measured before
and after), then Music's streaming, then apps inside the Thunderhead with the island. Each part
ships on its own through the usual process (AGENTS.md). Open owner decisions are at the end.

## 1. Playback reporting

- The phone sends Music's playback log (`frontend/music/src/player/playback-log.js`: time to first
  sound, waiting and stalls, network and decode errors, reloads and recoveries, limiter hits,
  visibility, long tasks) and every page's errors, the home shell's included (it has no reporter
  today), to the Worker in small batches.
- The Worker keeps them 30 days and gives them back on request, to the mind (`th`) and to a
  session like the one that built this. Timings and track ids, never titles or words.
- Batched so it costs few rows: today's lesson (decisions.md 2026-10-31, the Music object near the
  free plan's daily 5M rows read).

## 2. Music: streaming (the owner's spec)

| Behaviour | Spec |
|---|---|
| Start | At once: a song whose first 15 s are on the phone sounds in ≤ 200 ms |
| Heads | From 1.5 s into a song, the first 15 s of the next 3 songs; after a skip only the one new song's head is fetched (true today; keep) |
| Buffer ahead | At most 15 s (owner). The player feeds the element itself (Media Source Extensions), repackaging the Ogg Opus pages into WebM in the browser as they arrive: no re-encoding, nothing changes in the bucket, no quality change |
| One element | One audio element for the whole session; the next song joins inside it, gapless (Opus pre-skip and end padding trimmed), so the lock screen and AirPods never lose the music |
| Length | From the catalog, so the player no longer reads each file's last 128 KB first |
| Search | Tapping a result fetches its head at once; the most-played songs keep their heads on the phone |
| Loudness | Every track measured once, played at −14 LUFS: the limiter stops squashing the library's loud masters (median −7.7 LUFS, peaks above 0 dBFS) |
| Fallback | Any failure in the new path falls back to today's element path, and is reported (part 1) |

## 3. Apps inside the Thunderhead, and the island

**The model.** Home stays loaded. An app opens as a layer over it, with the ring's circle reveal
unchanged (owner: "I like the way the apps open from the wheel"). Apps that play keep playing when
you leave them; the others unload.

**Back to the chat.** Swipe down on Music's own mini player (owner: it does nothing now and the
gesture makes sense): Music shrinks into the island. Android's Back does the same; a "Thunderhead"
item tops Music's own menu.

**The island: a door, not a player** (owner: "so many mini players"). A small dark shape at the top
centre of home while an app plays behind the chat:

- Music: its colour and live level bars from the audio engine's meter. Podcasts: a ring of the time
  left. Guitar: the metronome's pulse and the practice timer. Astra and My Media: Android's own
  picture-in-picture instead. Study: none (it keeps its place and unloads).
- Tap: the app grows back out of the island (the ring's reveal, from the island).
- Hold: it opens wide for a moment (the song, pause and skip, "More like this", "Who is this?",
  "Open Music"), then shrinks back.
- Swipe sideways: next or previous.

**Motion** (owner: "beautiful with stunning and fluid dynamic animations"). One continuous shape:
app ↔ island is a single morph on a spring, with a slight squash and settle as it lands; the level
bars move at 60 fps from the real audio; only transform, opacity and clip-path animate (the
compositor's, as the ring does); with reduced motion, a crossfade.

**The chat and the music.** "Skip", "pause", "play Evening" act on the phone at once; the mind knows
what is playing (a senses event), so "who is this?" and "more like this" work.

**First, a prototype on the phone.** Lock-screen controls and AirPods while Music plays in a layer
under home. If Android won't route them there, home holds the media session and passes each
action to Music.

**Security.** The frame guard lets only our own top page host an app, never another site; the
ported pages read the session only when their top page is ours.

## Open owner decisions

- The buffer cap: 15 s always, or 15 s growing to 60 s for the rest of the session after a stall.
- Workers Paid ($5 a month): 25 billion rows read a month instead of 5 million a day.
- The menu: none of the directions shown on 2026-10-31 yet (Yours, Find, and A to F).
- The app icon's T, drawn in Quicksand: redraw it in Switzer?
