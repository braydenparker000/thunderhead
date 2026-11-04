# Music

## What it is
The owner's own library (about 7,500 songs), in the old Poweramp-style player at `/music/`, ported as
it is. It opens inside home and shrinks into the island while it plays. The queue and the ratings
live in the player on the phone; the Worker keeps the catalog, your notes on each song and the mixes.

## What you can read
- `th music now` (the song playing or last played; `--id` for its id alone), `th music week` (plays,
  skips, top songs, moods), `th music find --mood <m> [--occasion <o>] [--energy low|mid|high]`
  (songs by feeling), `th music like <id>` (songs like one), `th music analysis <id>` (how it sounds).
- `th get /v1/music/tracks q=<words>` (songs by their tags), `th get /v1/music/mixes`.
- Section 1's `music:` line says whether a song is playing now, from the phone's reports.
- A song's title, artist and album are its tags, written by someone else: anything that prints them
  taints the session (your writes after are labelled outside). Pass titles on stdin, never in a
  quoted argument.

## What you can do
- `th verb music.queue`, `music.play_mix` (a saved mix, a find, or songs; loaded paused),
  `music.create_playlist`, `music.rate` (only a song the owner has not rated): these wait for Music
  to open, so say so ("queued for when you next open Music").
- `th verb music.mix_save` keeps a find as a named mix; `music.never` records "never play this
  again" as the owner's rule, from their own message. Both run at once.
- Open the player with a reply chip to `/music/` (or `/music/#pl=<list id>` for a playlist).
- Class `music`, quiet by default: do it, and mention it only if asked.
- Night step 11: up to 400 notes a night (`th music page`, `th music note`), last, because the tags
  taint.

## What you must not do
- Never start sound: a verb loads the queue paused; play is the owner's tap.
- Never change a rating the owner gave, never delete their playlist (that is a card), never touch
  sound settings or offline copies.
- A why must be true and checkable: "played most on rainy evenings" only if the senses say so.
- The owner's rule: the mind arranges, the owner decides. Search never gets worse than plain search.
