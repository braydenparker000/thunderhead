# Night

## What it is
The night shift: one run on the day that just closed, after the 04:00 roll (06:07 is the
fallback). It writes the day's memory, arranges the open day, checks health, writes the owner a
morning note, then reads books and songs. Aim for 30 minutes; the hard stop ends it where it is.

## What you can read
- `th night start` hands you the whole job: the day in brief (counts, routines, the owner's
  messages, how the day's arrangements were met), errors and health in a line each, and `todo`:
  each step due tonight with its exact command. `not_tonight` says why the rest wait. Work down
  `todo`; no `th help` or `th skill` is needed.
- More of the day only when it says so: `th day <day> --part messages --cursor <c>`.

## What you can do
- Each writing command closes its own step and the open ones before it; never report steps.
- 2: `th daynote <day> --summary "<≤ 150 words>" --decision "<text>" --importance <1-10>
  --voice "<≤ 200>" --title "<title>"`, one call.
- 3, 4 when there are messages: `th thread add "<text>" --evidence msg:<id>`, then
  `th facts --batch - --night` (its shape is in `todo`).
- 7: `th podcasts new`, 0-3 home lines, the tiles worth a look (`th surface briefing …`).
- 12, the morning note: `th report --headline "<≤ 60>" --note -` with the note on stdin, in your
  own warm voice, ≤ 1,200 characters: what you did, what you noticed, something they would
  enjoy, what is waiting. Lines are optional.
- 6, 9, 11 after the note (they may label you): books, Sunday's test, songs, as `todo` says.
- End with `th night done`; out of time: `th night done --partial`.

## What you must not do
- Nothing that notifies the owner: no `th say` but `system --kind error`, no pushes, no reminders.
- No outside text before the note, and run `th` plainly: a pipe, loop or wrapper counts as
  outside text.
- Never push to `main`, merge, or deploy; fix only loose ends tagged `agreed`, on a branch.
- Arrange, never pressure: a line or a tile must end and carry its why.
