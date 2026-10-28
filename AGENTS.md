# Repository guidance

This is the canonical guidance for anyone (person or agent) working here.
[README.md](README.md) has the commands.

## What this is

The Thunderhead is one person's app, for life. It reads everything on the platform,
acts mostly by arranging things, and speaks only when something needs the owner.
Home is a single quiet chat screen; everything else is one gesture away.

## How work happens

- Once the owner and the agent agree on **what** to build, that agreement is the
  go-ahead: build it, test it (including the phone-size browser checks), merge to
  `main`, let it deploy, and report that it is live. No extra review gates.
- Ask the owner first only for: deleting data or anything irreversible, anything
  that costs money, security or access changes, and anything that reaches other people.
- Talk to the owner in plain words. Address them as "you"; otherwise use they/them.
- Build every system as well as it can be built. Existing code elsewhere is not the
  standard; research and design the best approach, then build that.

## Privacy (this repository is public)

- Never commit secrets, tokens, keys, private URLs, or personal content: names of
  people or places, notes, messages, memory, scripture copies, PDFs, listening history.
- Personal data lives only in private storage behind the owner's sign-in (the Worker
  and R2). It never goes into this repository, GitHub Actions logs, or artifacts.
- Example content in code and tests stays generic.
- No GPL, AGPL, or non-commercial dependencies. Icons: Phosphor (MIT). Fonts:
  Fraunces and Inter (OFL).

## Layout

`frontend/` is the site, `backend/` the Worker, `scripts/` the tools, `tests/` the
tests. Plain HTML, CSS and JavaScript; add a build step only when it clearly pays.

## Design system

- **Home:** one screen. The voice line (Fraunces italic) says what matters; the
  conversation sits low, above a liquid-glass ask bar with `+` (options sheet) and a
  mic that turns into send while typing. No placeholder text, no chips on home.
- **Compass:** hold still on an empty spot (220 ms) and a tight ring of six apps
  opens around the finger; slide toward one and let go. Clockwise from the top:
  Music `#2f7df6`, Guitar `#e08a1e`, Podcasts `#e0457b`, Astra `#8b5cf6`,
  My Media `#14a39a`, Study `#2e9e5b`. Icons (Phosphor regular): music-notes-simple,
  guitar, microphone, monitor-play, youtube-logo, book-bookmark.
- **Swipe right:** the briefing (weather, what's waiting, practice, study, what was
  built overnight). **Swipe left:** the menu on the right (search, conversations,
  settings).
- **Conversations:** a new one starts on its own each day; old ones are filed and
  titled automatically in the menu. The owner never starts or names a chat.
- **Presence:** the Thunderhead is light along the screen edges. Gold at the bottom
  means a decision is waiting; a pulse means it is thinking.
- **Type:** Fraunces italic only for the Thunderhead's voice; Inter for everything else.
- **Colour:** day uses soft drifting colour fields with grain; night is pure black
  with faint accent light. Accent `#2468d8` (text) / `#2f7df6` (fills); gold
  `#f2b632` (fills) / `#8a5a00` (text on light).
- **Motion:** quick and springy, never slow; everything respects reduced motion.

## Checks before pushing

- `npm test` passes (static checks plus Chromium at 390×844).
- Read the whole diff for secrets and personal content.
