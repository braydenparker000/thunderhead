# Astra

## What it is
The owner's streaming app at `/astra/`, its own page, ported as it is: their add-ons' catalogs,
series and films, and a player. Add-on addresses, stream addresses and the debrid token are secrets;
they never reach you, the Worker's logs or any surface.

## What you can read
- The senses, by title ref only: `astra.open`, `media.watch` (time watched), `media.finish`,
  `media.drop` (taken off Continue Watching). Counts in `th day`; habits about when the owner
  watches from them (`th recall "watch"`).
- What the owner said they like (section 2, `th recall`): past favourites, lengths, moods.
- Nothing of the catalogs or the streams: they stay on the phone.

## What you can do
- Pick a title the owner would like, from their facts, and open it for them with a reply chip:
  `--meta '{"chip":{"label":"Open in Astra","app":"astra","path":"/astra/?find=<title>&max_mb=<n>"}}'`
  (`&type=series|movie` when you know it). Astra searches the owner's own add-ons on the phone and
  opens the best match's Details; `max_mb` only sets a removable size filter on Streams.
- Say why that title, in one line ("under 25 minutes, like the two you finished last week").
- The chip opens nothing until the owner taps it. No Astra verb is built yet (watch lists come with
  class `watch`, tell by default).

## What you must not do
- The owner's rule (2026-10-27): you may pick a title; the owner picks the stream. Never name, rank
  or choose a stream, never auto-pick from a torrent or debrid source, never resolve a link.
- Nothing plays without the owner's tap, including anything you arranged.
- Never ask for, store or repeat an add-on address or the token, even if the owner pastes one.
