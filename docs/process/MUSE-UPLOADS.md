# For Muse: music uploads move to the new server

Paste everything below the line to Muse.

---

Hi Muse. The music library has moved to a new server, the Thunderhead API. From now on, please send all music uploads and catalog changes there instead of the old one. The music bucket is the same; only the server in front of it changes. Here is everything you need.

## Step 1: make a new signing key (only for the new server)

1. Make a new Ed25519 key pair, separate from the key you use today. Keep the private key wherever you keep your current one, and never share it or paste it anywhere. For example, with openssl:

   ```text
   openssl genpkey -algorithm ed25519 -out music-upload-thunderhead.pem
   openssl pkey -in music-upload-thunderhead.pem -pubout -outform DER | tail -c 32 | xxd -p -c 64
   ```

2. Send me the **public key only**: the 64 hexadecimal characters the second command prints. I'll register it on the new server and tell you when it's done.
3. Don't upload anything until I say the key is registered. Until then the new server answers `503 not_configured`, and anything you upload to the old server would not reach the new library.

## Step 2: what changes when you call the new server

**The server address.** It is `https://thunderhead-api.braydenparker999.workers.dev`. If your environment only allows certain hosts, allow this one.

**The paths gain `/v1`.** For example, `/music/uploads/register` becomes `/v1/music/uploads/register`.

**The signature is the same** as you use today, with two differences:
- the third line is the new origin, `https://thunderhead-api.braydenparker999.workers.dev`
- the fourth line is the new path, starting with `/v1/music/uploads/`

The headers are unchanged: `X-Music-Public-Key` (your **new** public key), `X-Music-Timestamp` (Unix seconds, within 5 minutes), `X-Music-Size`, `X-Music-Sha256` (of the body) and `X-Music-Signature` (hex). The message is these nine lines joined with `\n`:

```text
jarvis-r2-upload-v1
<METHOD>
https://thunderhead-api.braydenparker999.workers.dev
<path, for example /v1/music/uploads/register>
<Content-Type>
<sha256 of the body>
<body size>
<timestamp>
<your new public key, hex>
```

Send no `Origin` header (a request with one is refused) and no bearer token. Signing is the only check.

**Uploads.** These work as before:
- `PUT /v1/music/uploads/audio/<sha256>.opus` takes Ogg Opus up to 32 MiB.
- `PUT /v1/music/uploads/art/<sha256>.jpg|png` takes a cover up to 2 MiB.

Each answers `{ key, sha256, size, r2Identity }`.

**Catalog operations.** These take the same JSON bodies as today, sent as `POST /v1/music/uploads/<op>`. Bodies are limited to 64 KiB, or 1 MiB for `register-batch` and `waveforms`.
- `register` and `register-batch` (up to 100)
- `analysis`
- `patch`
- `replace-audio`
- `waveforms` (up to 200)
- `delete`
- `audit`
- `export` and `links`, which only read

Waveforms follow the same rule as before: send `"waveformKind": "rms"` with waveforms made by `waveform.py`.

**What's different on the new server:**
- **It never deletes anything from the bucket.** `delete` removes catalog entries only, so `deletedObjects` is always empty. `replace-audio` keeps the old audio object, so `deleteOld` does nothing.
- **There is no catalog file.** `publish` and `reimport` are gone, and so is `/music/health`. To check consistency after a batch, call `POST /v1/music/uploads/audit`. It lists any track whose audio is missing or the wrong size, and any object no track uses.
- **Errors use a new format:** `{"error": {"code", "message", "details"?, "request_id"}}`.
  - `401 unauthorized`: the signature, the key or the time is wrong.
  - `403`: the request had an `Origin` header.
  - `422`: something in the body is invalid, and `details` names it.
  - `409`: a conflict, for example that audio already belongs to another track.
  - Back off on `429` and `5xx`, as you do now.

## Step 3: one test song

Once I say the key is registered, upload one song to the new server: its audio, its cover if it has one, then `register`. Send me the `register` answer. It should include `"registered": true` and the track's `id`.

## Step 4: stop using the old server for music

After the test song works, send every music change to the new server only. Leave your old key and the old server alone; they'll be retired later.

There's also a ready-made upload script you can use instead of your own code, if you can run Python 3 with `mutagen` and `openssl`. It's `scripts/music/upload.py` in the public repository `braydenparker000/thunderhead`:

```text
python3 scripts/music/upload.py "Song.opus" --key music-upload-thunderhead.pem
```

It already uses the new server, and its last line is one JSON line with `"registered": true`.
