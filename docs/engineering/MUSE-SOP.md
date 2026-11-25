# For Muse: a song from file in hand to live in Music (2026-11-25)

The standing procedure for the upload tool. It starts where the tool already has an audio file. The
calls and their signing are in [MUSE-PROTOCOL.md](MUSE-PROTOCOL.md); the waveform's recipe in full is in
[MUSE-WAVEFORMS.md](MUSE-WAVEFORMS.md).

## Prep: one decode a song

1. Decode the source once to PCM (float32, 48 kHz, all channels). From that one decode: encode the Opus
   (libopus, 192k VBR, 48 kHz), make the waveform, measure loudness. Never decode a file twice.
2. Write plain text tags into the file (Vorbis comments: title, artist, album, album artist, track and
   disc numbers and totals, year, original year, genre, label, ISRC, the MusicBrainz ids and the
   ReplayGain values sent in the JSON), before its sha256 and size are taken. Embed no cover. The
   server reads only the JSON sent with the song, so the tags change nothing in the app: they let a
   file say what it is should the catalog be lost or the library moved. An embedded cover only makes
   the file larger (the phone reads one only when no cover was registered).
3. The waveform (`rms`): 1,000 equal bins over the whole song; per bin the mean square of all samples;
   `byte = min(255, round(255 · ms^(1/4)))`; standard base64 (1,336 characters). The decoded length is
   within 0.5 s of `dur`. Always send `"waveformKind": "rms"`. One sent without it is taken as `rms`
   too, but say what you mean.

## Metadata (JSON, per song)

4. Always: `title`, `artist`, `album`, `albumArtist`, `track`, `disc` (1 for one disc), `year`, `dur`,
   and `genre` when known. The server requires `title`, `artist`, `dur`, `album` and `track` (a whole
   number from 1): a song without `album` or `track` is refused with `422` naming the field (in a
   batch, that item alone: `registered: false, status: 422`). A missing `disc` is taken as 1.
5. `albumArtist` is the album's artist, the same on every song of the album: the phone groups an album
   by its title and album artist. Featured artists go in `artist` only. A compilation: "Various Artists".
   The server gives every song `metadata.albumId` (`rg:<mbReleaseGroup>`, else the album's artist and
   title folded): never send it.
6. Also send, when known: `isrc` (12 letters or digits; the server keeps it upper-case), `label`,
   `trackTotal`, `discTotal` (whole numbers from 1), `compilation` (true or false) and `originalYear`.
   The server keeps them (`tracktotal`, `disctotal` and `originalyear` are taken for the same fields).
   A bad value is `422` naming the field. Any other key is not stored: the answer lists it in
   `ignored: [...]` (on each batch result). Read it, and stop sending what it names.
7. Loudness: `rgTrack`, `rgAlbum`, `rgTrackPeak`, `rgAlbumPeak`. Measured, never applied to the audio.
8. MusicBrainz ids (`mbRecording`, `mbArtist`, and `mbReleaseGroup`, the same for every song of the
   album), one request a second, a User-Agent naming the app, every lookup cached:
   - first by the recording's ISRC;
   - if that finds nothing, a name search (recording, artist and release), accepted when the artist
     and title match after folding (case, accents, punctuation), the length is within 3 s, and the
     recording is on a release group whose title matches the album;
   - if still nothing, the same search without the album, accepted only when it leaves a single
     candidate; then send `mbReleaseGroup` only if another song of the album gave one.
   Send none only when nothing is found or several candidates remain that cannot be told apart. Never
   a guessed id.

## Cover

9. One cover an album: JPEG, about 1,000 to 1,400 px, under 2 MiB. Uploaded once per album, then the
   same `cover` object sent with every song of it (there is no album-level record).

## Upload

10. The audio PUTs, then the album's cover PUT, then `register-batch` (up to 100) with each song's
    waveform in its item. An album's songs go together in one batch, in disc then track order: the album
    appears whole, and the music knowledge reads it once (ten minutes after the catalog last changed).
11. `register-batch` answers 200 even when single songs fail: check every `results[i].registered`,
    `status` and `ignored`. Audio the server already has answers `duplicate: true` with its id and
    writes nothing (or fills a missing waveform).
12. Per wave: spot checks with `track` (one song's record read back, `{ id }` or `{ sha256, size }`)
    and `links` (a range fetch), then one `audit` at the end. Not per batch. To read the catalog, use
    `export` in pages (`limit`, `after`, `waveforms: false`), never the whole of it at once.

## Fixes after upload

13. Wrong tags or cover: `patch` by id (the same fields and checks as a registration; `album` and
    `track` can be changed, never removed). Wrong audio: `replace-audio`, which keeps the id, so plays
    and ratings stay. Never delete and register again to correct a song; `delete` is for removing one.

## Limits

14. The audio and cover PUTs are never refused for the day's limit; the catalog operations are, from
    85% of the day's budget. Never trust a stored "held until" marker: call `quota` (never refused) on
    each pass, and register whenever it says `held: false`. On a 429 mid-pass, stop the catalog
    operations, keep uploading files, and ask `quota` again on the next pass.
15. The limit is the account's rows written a day, not a count of songs: a new song in a batch writes
    about 4 rows (the track, its two indexes, the undo log), and a batch moves the catalog's version once.
