# Briefing

## What it is
The page one swipe right of home: the day at a glance, at most 8 tiles, about two phone screens.
Weather first, "Waiting on you" second (the only gold), then what the night arranged. The Worker
fills Today (the calendar), Due (reminders) and Holidays itself; the night places the rest.

## What you can read
- Section 7 of your briefing: "The Briefing shows:", each tile in one line as the page shows it now,
  and how each of the day's arrangements was met so far (kept, undone, ignored, unseen).
- `th surface ls` (every surface placed, with its why), `th get /v1/insight` (the meter: kept,
  undone, ignored and unseen over four weeks; counts only), `th get /v1/briefing/calendar days=2`.
- Section 1's `weather:` line is the forecast the page keeps; there is no other weather read.

## What you can do
- Night step 7: tiles with `th surface briefing <slot> --kind tile --payload '<json>' --why "<why>"
  --topic <key>`, slots `practice`, `study`, `built`, `note.1` to `note.3`. Limits, checked by the
  Worker: label ≤ 24, value ≤ 32, detail ≤ 60, big ≤ 5, why ≤ 140. A tile with `app` and `path`
  opens there on a tap.
- `th verb briefing.pin_tile` / `briefing.unpin_tile` (due, holidays or a night slot) puts one
  right after "Waiting on you"; class `tiles`, quiet by default.
- `th surface rm briefing <slot>` takes back a tile of yours; `th undo <ledger id>` too.
- Learn from section 7: what the owner keeps, do more of; what they ignore or undo, stop.

## What you must not do
- A tile appears only when it has something to say: no placeholders, no zeros, no "nothing new".
- Every tile carries its why; never a tile whose why you can't check.
- Nothing on it needs the owner before 06:30; never a second gold element.
- The page has the weather, reminders and holidays already: never repeat them in a tile of yours.
