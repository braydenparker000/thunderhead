# Ink and Lamp

The second look of the Thunderhead's main pages (home and the conversation, the island, the ring,
the Briefing, the menu, Settings, the `+` sheet). It is chosen in Settings › Appearance › Look
(`appearance.look`: `classic`, the default, or `ink-lamp`) and is a skin over the same pages: no
behaviour of theirs changes, and with the look off nothing of it is requested or shown. Music,
Podcasts, Astra, Guitar, Study, Photos, My Media and the sign-in pages keep their own looks.

Day is **Ink** (a grey page, dark ink, engravings); night is **Lamp** (true black, light, paintings).
The existing Theme setting chooses between them, Auto included.

The owner's brief (2026-11-19/20): "Nothing os (with little more of the apple like rounded edges and
liquid glass) plus teenage engineering", then "a huge Christian touch… inspired. Like a piece of
music written by Bach."

## 1. The rules

1. **Home is the conversation.** No widgets: each thing lives in one place (what plays is the
   island's, the day's news the Briefing's).
2. **Two inks.** *Rubric red* is the Thunderhead's own voice: the day's name, the initial of each of
   its messages, `j.j.` and `s.d.g.`, a verse's reference, a lamp. *Key orange* (`#FF4A12`) is what
   is pressed or turned. Nothing else is coloured. On Sundays the rubric is gold.
3. **A day is written like a letter.** It opens with the day's picture and a verse of the King James
   Bible or the Book of Mormon, then `j.j.` (*Jesu juva*); it closes, when at rest, with `s.d.g.`
   (*soli Deo gloria*), as Bach headed and ended his scores. Every message from the Thunderhead
   opens with a red blackletter initial, as a scribe would write it.
4. **Controls are things.** Keys, dials, faders and switches are rendered pictures of hardware (the
   kit), with a pressed state, and they can be dragged where a real one could.
5. **Calm pages.** The Briefing reads like a page from a book of hours: red italic rubrics, the
   Thunderhead's words, no readouts. No staff lines, no decorative rules.

## 2. Colour

| Token | Ink (day) | Lamp (night) |
|---|---|---|
| `--ground` | `#D6D6D2` | `#000000` |
| `--plate` (panel) | `#E4E4E0` | `#101012` |
| `--well` | `#C2C2BD` | `#1B1B1E` |
| `--hairline` | `#A6A6A1` | `#2E2E33` |
| `--text` | `#0A0A0A` | `#FFFFFF` |
| `--text-2` | `#3F3F3C` | `#A8A8AD` |
| `--text-3` | `#5A5A56` | `#7C7C83` |
| `--rubric` | `#B3121A` | `#F0453F` |
| `--rubric` on Sunday | `#7A5A0E` | `#D9B45A` |
| `--key` | `#FF4A12` | `#FF4A12` |

The edge light and the glows round cards are off under the look. Flat glass and Corners still
apply; Accent intensity has no meaning here and its row is hidden while the look is on.
Sunday's gold on Ink measures 4.37:1 on the ground: it is for marks and rubrics, never running text.

## 3. Type

| Use | Face | Token |
|---|---|---|
| The Thunderhead's words, titles | EB Garamond | `--font-say` |
| The day's name, initials | Jacquard 24 (a pixel blackletter) | `--font-day` |
| Verses | IM Fell English italic (shipped as "Lamp Fell") | `--font-verse` |
| Legends on and beside controls, details | Geist Mono | `--font-legend` |
| Times and counts | Doto (dot matrix) | `--font-time` |
| The owner's own words, plain controls | Switzer (the shell's own) | `--font-own` |

All are under the SIL Open Font License, subset to Latin-1 and common signs, with each licence
beside its file in `frontend/look/fonts/`. A reply that opens with a list, a heading, a quotation,
code, a number, an emoji or a link takes no initial.

## 4. The pages

- **Home.** One line at the top (the day's name, date, time, the `rec` switch for off the record)
  over the day's picture, which is the first thing in the conversation and scrolls with it. The
  docked decision is a slim strip with keys for its answers and a small dial for **later**: a tap
  hides that decision on this phone for the time the dial shows (1 h, 3 h, tonight, tomorrow; kept in
  `localStorage`, nothing sent to the Worker; it comes back when the time is up or the look is
  turned off). The ask bar is a glass pill with round keys; the send key is orange.
- **The island.** A black capsule in a glass rim with two tape reels in place of the artwork, and a
  dot meter. Expanded: reels, a dot progress meter, kit keys for the transport.
- **The ring.** The same size and behaviour as the classic ring. Each app is a round key carrying a
  woodcut emblem (harp, trumpet, star, lute, book, arched picture, chest). The choice is shown on
  Ink by a pointing hand that turns to the chosen app, on Lamp by a beam of light that falls on it.
- **The Briefing.** The day's name, its verse with a drop initial, then the Briefing's own pieces as
  quiet rows under red italic rubrics.
- **The menu.** Conversations under red rubrics, the current one as the single panel, a lamb with
  a banner as the page's mark, `s.d.g.` under the list.
- **Settings.** Every one-of-a-few choice is a row of keys with a lamp over the chosen one; every
  switch a slide switch. Text size is a fader, Motion a rotary dial, Haptics a three-position slide
  switch. Each can be dragged and settles on the nearest position, driving the existing control, so
  storing, syncing and the keyboard and screen-reader behaviour are unchanged.

## 5. The daily pictures

72 plates: 36 engravings for Ink and 36 paintings for Lamp. In each set 7 are for Sundays (the
Resurrection and the risen Christ), 5 for Fridays (Gethsemane and the cross) and 24 for the other
days (Old Testament, New Testament and, where free art exists, the Book of Mormon). The plate is
chosen by the calendar alone (`frontend/look/plates.js`), so a day shows the same plate every time
and nothing is stored. An older conversation shows the plate of its own day.

Every work is in the public domain; its source and the licence that source states are recorded in
[LOOK-PICTURES.md](LOOK-PICTURES.md). Each picture is prepared ahead of time: cropped to the
header's shape, and for Ink turned to grey and printed on the Ink ground, so the page does no
blending. Verses are checked word for word against the King James Bible (Pure Cambridge Edition)
and the Book of Mormon (Project Gutenberg #17).

## 6. How it is built

Everything is under `frontend/look/`, with its own size limits (`scripts/look-config.mjs`).

- `ui/theme.js` copies the setting to `<html data-look>` before the first paint and, only when it is
  `ink-lamp`, adds `look/look.css` (the page stays unseen until it has loaded, 400 ms at most) and
  loads `look/look.js` after the first paint. Turning the look on or off in Settings applies at once.
- Every rule is scoped under `:root[data-look="ink-lamp"]`. Each page's part is its own sheet and its
  own module; a module adds what it adds through `whileOn()` and takes all of it away when the look
  goes off. No existing page file carries any of the look.
- **Kept after one load** (the owner, 2026-11-20). The folder is published as `look/<hash of its
  files>/`, out of the release's precache; the service worker keeps `/look/` for good, as it does
  `vendor/`. `look/keep.js` fetches the look's files, then every daily picture, in idle time (never
  with Data Saver on), and clears older folders. The pictures are published unmoved at
  `look/pictures/`, each named with the hash of its own bytes, so a release that changes the look
  never fetches them again.
- The kit (`look/kit/*.webp`) is 28 rendered pictures: keys as nine-slice border images, round keys,
  two dials, a fader cap and switch thumbs, each with its pressed state. The emblems are one SVG
  sprite (`look/emblems.svg`).
