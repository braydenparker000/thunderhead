# For Muse: measuring the seek-bar waveforms again

Music's seek bar draws each song's waveform from bytes you send. The phone's drawing has been checked
against its own rule (MUSIC.md §2.4) and is right; what it is given is not. This page says exactly
what to measure, how to send it, how to redo the songs already uploaded without using up the
Worker's day, and how to check one song before the rest. Uploads and their signing stay as in
[archive/MUSE-UPLOADS.md](../archive/MUSE-UPLOADS.md); work orders as in
[MUSE-PROTOCOL.md](MUSE-PROTOCOL.md).

## 1. Why

- The recipe was never written down here: the phone expects "rms" bytes made by a `waveform.py`
  that is not in this repository, and the upload tool (`scripts/music/upload.py`) sends none.
- The Worker takes any 16 to 1,000 bytes, with no length of time beside them, so a waveform measured
  from a decode cut short, or from a file longer or shorter than the one uploaded, is stretched over
  the whole song. The phone already finds some: bytes with fewer than 100 changes, which it draws
  but does not keep (`MIN_WAVE_STEPS` in `frontend/music/src/library/waveform.js`).
- `register` without `waveformKind` stores the waveform as `"peak"`. The phone then draws "rms"
  bytes as peaks: low and flat, with quiet passages hardly lower than loud ones.
- Older songs still carry the old catalog's peak bars, which measure something else.

So every song is measured again, one way, from the very file the phone plays.

## 2. What to compute, for each song

1. **Input:** the song's uploaded Ogg Opus file itself (§4 gets you a link), never the source you
   encoded it from: the waveform must span exactly the audio the phone plays.
2. **Decode** to 32-bit float PCM at **48,000 Hz**, keeping every channel (no mono mix: a mix can
   cancel out-of-phase sound). With FFmpeg: `ffmpeg -v error -i song.opus -f f32le -acodec pcm_f32le -ar 48000 -`,
   reading the channel count from the file.
3. **Check the length:** `S` = samples per channel. `S / 48000` must be within 0.5 s of the track's
   `metadata.dur` in the catalog. If not, do not send that song; list its id in your report.
4. **1,000 bins over the whole song**, silence at either end included (never trimmed): bin `k`
   (0 to 999) holds samples `floor(k·S/1000)` up to, not including, `floor((k+1)·S/1000)`.
5. **Mean square** of each bin over every sample of every channel:
   `ms_k = Σ x² / (samples in the bin × channels)`, full scale 1.0. Not the peak.
6. **One byte a bin:** `byte_k = min(255, round(255 · ms_k^(1/4)))` (that is `255 · sqrt(rms)`).
   No normalising, no curve: the phone divides each song by its own loudest part and shapes it.
7. **Encode** the 1,000 bytes as standard base64 with padding: 1,336 characters (the Worker takes
   at most 1,400).

What the phone then draws (for your check in §6, not to send): 100 bars, bar `i` = the square root
of the mean of `(byte/255)^4` over bins `floor(i·10)` to `floor((i+1)·10)`; each bar divided by
`sqrt(max² + 0.01)`, where `max` is the largest bar, then raised to the power 1.35.

## 3. Where to send it

`POST /v1/music/uploads/waveforms`, signed exactly like every upload operation (the nine-line message
in archive/MUSE-UPLOADS.md, your upload key, no `Origin`, no bearer token):

```json
{ "items": [ { "id": "r2_native_…", "waveform": "<base64>", "kind": "rms" } ] }
```

- 1 to 200 items a request, body at most 1 MiB. `kind` is always `"rms"`.
- Answer: `{ "updated": n, "notFound": [ids], "count": tracks }`. The previous waveform of each song is
  kept in the catalog's log, so a batch can be undone.
- A song you upload from now on: send its waveform with `"waveformKind": "rms"` in `register`, or in
  this operation right after. Never register a waveform without the kind.

## 4. Redoing the songs already uploaded

1. **Once:** `POST /v1/music/uploads/export` (body `{}`): the whole catalog, each track with its
   id and `metadata.dur`. Keep the list; do not call it again during the redo (it reads every track).
2. **For each 100 songs:** `POST /v1/music/uploads/links` with `{ "ids": [up to 100] }` gives signed
   links to their audio, good for 3 hours. Download straight from those links (the bucket, not the
   Worker), measure (§2), delete your copy.
3. **Send** in batches of 200 (§3).
4. **The day's budget:** the Worker shares 100,000 rows written a day with everything else, and each
   song costs about four (the track, its indexes, the undo log). Do **at most 2,000 songs a day**
   (10 batches). On `429` stop at once and start again after the `Retry-After` it gives (00:00 UTC);
   on `5xx` wait and retry the same batch: it is safe to send twice.
5. Order: songs with no waveform first, then those whose catalog record has no `"waveformKind":
   "rms"`, then the rest. Keep a list of the ids done, so a restart goes on where it stopped.
6. When all are done, `POST /v1/music/uploads/audit` once: `withoutWaveform` should be only the songs
   you listed as not sent.

## 5. Before the first batch

The phone keeps a waveform it has already drawn, tagged with the catalog's `waveformAt` for it (the
track row's last change, MUSIC.md §1.4): a waveform registered again moves it, so every redone song,
`"rms"` before or not, is fetched again and shows the new one. This is in once the release with
`waveformAt` is live; wait for the owner's word that it is before §4.

## 6. Check one song before the rest

1. Pick one song with a quiet start or a quiet break, and one with silence at the end if you can.
2. Before sending, check your own result: 1,000 bytes; base64 ≤ 1,400 characters; at least 100
   places where a byte differs from the one before; the length check in §2.3 passed; and, drawn as
   in §2, the quiet part's bars below 0.7 while the loudest bar is at least 0.9 (it is whenever the
   loudest part's RMS is above about 0.25, −12 dBFS; for a quieter master, the quiet part's bars
   clearly below the loud part's). If a real song has fewer than 100 changes, report it and do not
   send it.
3. Send that one song alone (`items` of one). The answer must say `"updated": 1` and an empty
   `notFound`.
4. Tell the owner the song's id only, and wait for their word that it looks right on the phone
   before you start §4.

## 7. What never goes anywhere

No titles, artists or file names in your messages to the owner or in work-order lines: ids and
counts only. Your upload key never leaves where you keep it.
