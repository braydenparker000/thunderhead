# For Muse: a song from file in hand to live in Music (2026-11-25)

The standing procedure for the upload tool. It starts where the tool already has an audio file. The
calls and their signing are in [MUSE-PROTOCOL.md](MUSE-PROTOCOL.md); the waveform's recipe in full is in
[MUSE-WAVEFORMS.md](MUSE-WAVEFORMS.md).

## Prep: one decode a song

1. Decode the source once to PCM (float32, 48 kHz, all channels). From that one decode: encode the Opus
   (libopus, 192k VBR, 48 kHz), make the waveform, measure loudness. Never decode a file twice.
2. Embed no cover and rely on no file tags: the server reads only the JSON sent with the song. An
   embedded cover only makes the file larger (the phone reads one only when no cover was registered).
3. The waveform (`rms`): 1,000 equal bins over the whole song; per bin the mean square of all samples;
   `byte = min(255, round(255 · ms^(1/4)))`; standard base64 (1,336 characters). The decoded length is
   within 0.5 s of `dur`. Always send `"waveformKind": "rms"`: without it the phone draws it as peaks.

## Metadata (JSON, per song)

4. Always: `title`, `artist`, `album`, `albumArtist`, `track`, `disc` (1 for one disc), `year`, `dur`,
   and `genre` when known. The server requires only `title`, `artist` and `dur`, which is how an album
   that sorts badly gets in: a missing `track` sorts before track 1.
5. `albumArtist` is the album's artist, the same on every song of the album: the phone groups an album
   by its title and album artist. Featured artists go in `artist` only. A compilation: "Various Artists".
6. `isrc`, `label` and `tracktotal` are dropped by the server: do not send them.
7. Loudness: `rgTrack`, `rgAlbum`, `rgTrackPeak`, `rgAlbumPeak`. Measured, never applied to the audio.
8. MusicBrainz ids when found with confidence (by the recording's ISRC, one request a second, a
   User-Agent naming the app): `mbRecording`, `mbArtist`, and `mbReleaseGroup`, the same for every song
   of the album. Unsure: send none. Never a guessed id.

## Cover

9. One cover an album: JPEG, about 1,000 to 1,400 px, under 2 MiB. Uploaded once per album, then the
   same `cover` object sent with every song of it (there is no album-level record).

## Upload

10. The audio PUTs, then the album's cover PUT, then `register-batch` (up to 100) with each song's
    waveform in its item. An album's songs go together in one batch, in disc then track order: the album
    appears whole, and the music knowledge reads it once (ten minutes after the catalog last changed).
11. `register-batch` answers 200 even when single songs fail: check every `results[i].registered` and
    `status`. Audio the server already has answers `duplicate: true` with its id and writes nothing.
12. Per wave: spot checks with `links` (a range fetch), then one `audit` at the end. Not per batch.

## Fixes after upload

13. Wrong tags or cover: `patch` by id. Wrong audio: `replace-audio`, which keeps the id, so plays and
    ratings stay. Never delete and register again to correct a song; `delete` is for removing one.

## Limits

14. The audio and cover PUTs are never refused for the day's limit; the catalog operations are. On 429,
    read `retry_after` (seconds to 00:00 UTC), stop the catalog operations, keep uploading files, and
    register the queue when the day reopens. `quota` says how much of the day is left and is never refused.
15. The limit is the account's rows written a day, not a count of songs: a new song in a batch writes
    about 4 rows (the track, its two indexes, the undo log), and a batch moves the catalog's version once.
