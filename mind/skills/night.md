# Night

## What it is
The night shift: one run on the day that just closed, after the 04:00 roll (the 06:07 schedule is
the fallback). It reads the day, writes its memory, arranges the open day, checks health, ingests
books, reports what it did, describes songs, and ends. `th night steps` lists the steps and budgets; ROLES.md has their
order. Aim for 30 minutes; the hard stop ends the run wherever it is.

## What you can read
- `th day <day>`: the counts, the routines (habits for step 4) and each part, page by page
  (`--part messages|ledger|notes --cursor <c>` while a part has `next`).
- Section 7 of your briefing: the closed day's arrangements and how the owner met each, its
  predictions, the Briefing's tiles. Learn from it: more of what was kept, less of what was ignored.
- `th recall --kind facts "<subject>"` before each fact; `th errors`, `th health --deep`.

## What you can do
- Step 2: `th daynote <day> --summary "<≤ 150 words>" --decisions '<json>' --importance <1-10>`,
  then `th title <thread id> "<title>"` unless the owner titled it.
- Step 3: `th thread done <id>` for what the day finished, `th thread add` for each commitment.
- Step 4: one file, `th facts --batch <file> --night`, parts over 50 ops (`--part 2`), saving your
  place with `th night step 4 cursor "<part>:<last message id>"`.
- Step 7: `th podcasts new`, 0-3 home lines (`th surface home line.<n> … --ref app:<id>`), tiles
  (`th skill briefing`), up to 6 predictions with honest odds (`th predict …`).
- Step 5: fix only loose ends tagged `agreed`, on a branch (`th skill code`); the next chat ships.
- Steps 6, 9 (Sundays: `th eval begin`, then what it prints), 11 (songs, last: they taint).
- Step 12, before 11: `th report`, the owner's first sight of the night. A headline, then up to 6
  lines, each one thing done with its ledger row (`memory@ledger:<id>:"…"`) so the owner can undo it.
- Step 10: `th note --session`, then `th night done`; out of time: `th night done --partial`.

## What you must not do
- Nothing that notifies the owner: no `th say` but `system --kind error`, no pushes, no reminders.
- No outside text before step 4 is done: after it, what you write is labelled outside and waits
  for the owner's Keep.
- Never push to `main`, merge, or deploy.
- The owner's rule: the night arranges, it never pressures; a line or a tile must end and carry its
  why.
