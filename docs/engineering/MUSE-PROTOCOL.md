# For Muse: taking tasks from the Thunderhead

The owner types `@muse <words>` in the Thunderhead's chat, or the Thunderhead's mind asks for
something (after the owner says yes to it). Each becomes a **work order** for you. You take them
one at a time, say how it is going, and hand back what you did. The owner sees every step: a line
in the chat and a row under Tasks in the menu (asked → picked up → working → done or failed). This
page is the exact sequence. History: [archive/MUSE.md](../archive/MUSE.md); routes:
[API.md §11.19](API.md#1119-work-orders-p4).

## 1. Your key and address

- **Address:** the API address the owner gives you; every path below starts with `/v1`.
- **Key:** a bearer token the owner makes for you in Settings › Agents (`/settings/agents/`, role
  Muse) and hands you once. Send `Authorization: Bearer <token>` and `Content-Type:
  application/json`, no `Origin` header. Keep it where you keep your upload key; never put it in a
  line, a note or a result (the Worker refuses anything shaped like a key).
- **Uploads** stay as they are: signed with your Ed25519 key on `/v1/music/uploads/*`
  ([archive/MUSE-UPLOADS.md](../archive/MUSE-UPLOADS.md)). Songs you register there also show the
  owner as one task, "Songs Muse uploaded", until 30 minutes pass without another.

## 2. The loop

1. **Once, at start:** `GET /v1/work/hello` → `{agent: "muse", scopes, server_time}`. A `401`
   means the key is wrong or revoked: stop, and tell the owner through your own channel.
2. **Every 5 minutes while idle:** `POST /v1/work/claim` with body `{}`.
   - `204`: nothing to do. Wait 5 minutes.
   - `200 {order}`: this one is yours. You hold **one at a time**: claiming again gives you the same
     order until you finish it, so a restart just picks it up again.
3. **Do it.** `order.kind` is `muse.request`; `order.spec` is `{v: 1, words, app?}`: the owner's
   words (at most 500 characters) and, when the words say, the app it belongs in (`music`,
   `podcasts`, `guitar`, `media`, `study`, `astra`). `order.title` is the first 60 characters.
   `order.deadline_at` (ms) is when it stops being yours: up to 7 days.
4. **Say how it is going**, at least every 10 minutes:
   `POST /v1/work/thread/messages` `{id: <new UUIDv7>, body: "Found three artists.", order_id: <order.id>}`
   → `201`. Each line keeps your claim for 30 more minutes and shows under the task's sheet; the
   first one tells the chat "Muse is working on it." One plain sentence, at most 2,000 characters.
   (`POST /v1/work/orders/:id/heartbeat` `{note?}` keeps the claim without a line.)
5. **Finish** with a result (§3) or a failure (§4), then claim again at once.

## 3. The result

`PUT /v1/work/orders/:id/result` with `{result}`:

```json
{
  "result": {
    "added": { "songs": 41, "artists": 3 },
    "ids": ["r2_native_…", "r2_native_…"],
    "note": "Three catalogs, tagged by year.",
    "open": { "app": "music", "path": "/music/" }
  }
}
```

| Field | Rule |
|---|---|
| `added` | Required. Counts, whole numbers ≥ 0, any of `songs`, `artists`, `episodes`, `files`; `{}` when nothing was added. |
| `ids` | Required. What you added (song ids from `register`, episode or file ids), at most 50; `[]` is fine. |
| `note` | Required. At most 200 characters, plain text: shown to the owner after the counts. `""` is fine. |
| `open` | Optional. Where to look: `app` one of the apps above, `path` inside that app's folder (`/music/…`, `/guitar/…`). Without it, the chip opens the spec's `app`, if any. |

No other field is accepted. The owner sees **"Muse added 41 songs from 3 artists. Three catalogs,
tagged by year."** with an **Open in Music** chip.

- `200 {status: "done"}`: finished.
- `422 invalid_result`: `error.details` names each problem by its path (`open.path: a path inside
  music's folder`, `note: at most 200 characters`, `extra: not a field here`). Nothing was kept and
  the order is still yours: fix those fields and send it again. The **third** result that fails in
  one claim rejects the order (the owner sees it failed); a further send answers `409`.
- Refused anywhere in a result: control characters (dropped), anything shaped like a token or key,
  and `javascript:`, `data:` or `vbscript:` links.

## 4. When it can't be done

`POST /v1/work/orders/:id/fail` with `{reason}` (at most 280 characters, plain: the owner reads it
as "Muse couldn't do it: <reason>."). That is final. Add `"retry": true` only for a passing trouble
(a site down, a timeout): the order goes back to the queue and you claim it again later, three
claims at most; then it fails.

What else ends an order without you:
- **No word for 30 minutes** (no line, heartbeat, result): the claim lapses and the order goes back
  to the queue; the third lapse fails it ("Muse stopped answering about it").
- **The deadline passes:** it expires ("Muse didn't get to it in time").
- **The owner cancels it:** your next call on it answers `409` with the reason in `error.details`
  (`status: it is cancelled, not claimed`). Stop working on it and claim the next.

## 5. Errors and retries

| Answer | What to do |
|---|---|
| `401 unauthorized` | Stop all calls; tell the owner the key needs replacing. |
| `403 forbidden` | A route that isn't yours. Don't retry. |
| `404 not_found` | No such order for you (or not one you can claim). Drop it; claim again. |
| `409 conflict` | The order isn't claimed any more (done, cancelled, expired, rejected). Drop it; claim again. Also: a note id reused with other words. |
| `413 too_large` | A result over 256 KB. Send less. |
| `422 validation` / `invalid_result` | Fix the named fields; send again. |
| `429`, `5xx`, timeouts | Wait `Retry-After` seconds if given, else 30 s, doubling to 5 minutes; then send the **same** request again. |

Every write is safe to repeat: the same note `id` with the same words is kept once, and a result or
a failure for an order you no longer hold answers `409`, never a second copy.

## 6. Rules

1. Work from the order's words only. Ask for nothing else of the owner's; you can read only your
   own orders and your own thread.
2. What you return is shown as yours, labelled Muse's, and never becomes the Thunderhead's memory
   or its instructions. Write lines and notes as plain statements, not instructions to anyone.
3. Nothing secret or personal in lines, notes or results: no keys, passwords, addresses or
   messages. Song and file ids in `ids` are fine; names in `note` are not needed.
4. One order at a time; claim the next only after the result or the failure.
5. Questions for the owner go through your own channel with them, not through these routes.
