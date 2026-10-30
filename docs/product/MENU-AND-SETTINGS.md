# Menu and Settings

The menu is the panel one swipe left of home, on the right side: search, the conversations list, and settings (owner ruling).
This file specifies the panel, search (scope and behaviour), the conversations list (grouping, titles, continue, rename, delete-with-ask-first) and every settings page with exact behaviour.
Sibling docs: [HOME](HOME.md), [GESTURES](../design/GESTURES.md), [DESIGN-SYSTEM](../design/DESIGN-SYSTEM.md), [COPY](../design/COPY.md), [SIGN-IN](SIGN-IN.md), [SECURITY](../engineering/SECURITY.md), [PRIVACY](../engineering/PRIVACY.md), [MEMORY](../mind/MEMORY.md), [DATA](../engineering/DATA.md), [API](../engineering/API.md).

## Rules at a glance

1. **Open:** swipe left on home or the hidden "Menu" button. **Close:** swipe right, tap the dimmed home beside it, Back, Escape, or pick a row that navigates.
2. Three sections, always in this order: **Search**, **Conversations**, **Settings**.
3. The owner **never starts or names** a conversation (owner ruling). Titles are automatic; renaming is optional and wins forever.
4. **Deleting is ask-first** (decisions.md): a confirm sheet, then a 30-day "recently deleted" window [proposal]. Nothing in the menu deletes in one tap.
5. **Access changes are ask-first too:** signing out other devices, new or revoked agent tokens, and turning off push need a confirm on this signed-in device.
6. Settings pages change things **immediately**; there is no Save button except where text is typed.
7. Everything personal shown here comes from behind sign-in; nothing is cached in `localStorage` (only IndexedDB, cleared on sign-out).

## 1. The panel

| Part | Values (built) |
|---|---|
| Panel | Right side, `width: min(84%, 360px)`, full height, live glass `--sheet` with blur 28 px saturate 1.6, 1 px left border `--glass-line`, sideways E3 shadow when open |
| Padding | top `16px + safe-area`, sides 14 px, bottom `24px + safe-area`; scrolls vertically, no scrollbar |
| Home behind it | Moves left by 20% of the panel width; a dim layer `rgba(10,14,22,.3)` fades in with the drag |
| Section heads | Inter 600 11 px caps, +0.12em, `--ink-3`, 24 px above, with an optional sentence under (Inter 400 12, sentence case) |
| Group labels | Inter 500 12, `--ink-3`, 14 px above |
| Rows | See [DESIGN-SYSTEM](../design/DESIGN-SYSTEM.md) §12 (row): 18 px icon, Inter 500 15 title with ellipsis, meta on the right, chevron for pages |
| Settings sub-pages [proposal] | Open full screen over everything (not inside the narrow panel), slide in from the right (`--spring-slow`), with a back row "‹ Settings" at the top. Back returns to the open menu. |

## 2. Search

Built: the field, local-first results, the Worker's search appended, offline, nothing found and the groups Go to, Conversations and What I remember (`frontend/th/convos/search.js`, loaded with the menu; `tests/convos-browser.test.mjs`). This phone's part covers app and settings names, thread titles and today's messages; a cache of the last 30 days of messages is not built yet. Day notes are listed under What I remember ("Day note · 28 Oct") and open that page filtered by the query.

### 2.1 Behaviour

| Step | Rule |
|---|---|
| Field | A pill at the top (42 px tall, radius 21, `--tint` fill, magnifier icon) reading "Search everything" (a label, not a placeholder in the ask bar sense). (built) |
| Tap | It becomes a real `<input type="search">`, focused, keyboard up. The rest of the panel is replaced by results. An × clears; Back or Escape leaves search mode. |
| Query | Case-insensitive and accent-folded ("cancion" finds "canción"). Minimum **2** characters. Debounce **150 ms**. |
| Local first | Results from this phone's cache (thread titles, the last 30 days of messages, settings and app names) show within one frame. |
| Server | The Worker's full-text search (SQLite FTS5, bm25) over all messages, day notes and facts answers next; its results are **appended** within their groups, never reordering rows already on screen. |
| Offline | Local results only, with a line at the top: "Offline: searching this phone only." |
| Nothing found | "Nothing found for "<query>"." and a button **Ask me instead**, which closes the menu and puts the query into the ask bar. |
| History | No search history is kept [proposal]. |

### 2.2 Scope and result groups

Groups appear in this order; empty groups are hidden.

| Group | What it finds | Shows | Max before "Show all N" | Tap |
|---|---|---|---|---|
| **Go to** | App names, settings page names, exact commands ("quiet hours") | Icon + name | 4 | Opens the app or settings page |
| **Conversations** | Messages (owner's and the mind's) and thread titles | Thread title · date, and a snippet of ±40 characters around the match with the match in **bold** | 5 | Closes the menu, shows that thread on home scrolled to the message, highlighted with an accent tint for 2 s ([HOME](HOME.md) §4.9) |
| **What I remember** | Facts | The fact's text and its source ("you said", "I noticed", "I inferred") | 3 | Opens What I remember at that fact |
| **App results** [proposal, not built] | Each app registers a search provider as it moves over (songs and artists in Music, pieces in Guitar, books and pages in Study, saved videos in My Media, episodes in Podcasts) | App-specific row | 3 per app | Opens the item in its app |

Every search follows the owner's rule: intelligent search must be genuinely better than plain search and never worse. Exact and prefix matches come first, then typo-tolerant, and smarter results never reorder them ([MUSIC](apps/MUSIC.md) §8).

Acceptance: with fixture threads, "canción" and "cancion" return the same hits; a query of 1 character shows nothing; offline shows the offline line and only cached hits; tapping a message hit opens home on that thread with the message highlighted.

## 3. Conversations

The section head reads "Conversations" with the line "A fresh one starts on its own each morning. Nothing to start or name." (built).

Built: the groups, titles with their fallback, the row metas and the taps below (`frontend/th/convos/`, loaded when the menu first opens; `tests/convos-browser.test.mjs`, `tests/convos-logic.test.mjs`). Now is a glass card with today's date and message count. Each group under it has a heading with its count and a chevron; a tap folds its rows away (the height eases, the rows cascade back in on opening), and what is folded is remembered on this phone. A row is an icon tile, the title with its date on the right, and a second line: the night shift's summary, else how many messages. Imported old chats (`kind = 'imported'`) land by their own day like any thread, tagged gold "Old Chats" with a clock icon, and open read-only like any past thread. The list is read newest first, 30 a page, again on opening the menu after 30 s or when the feed reports a thread change; the first pages are kept on this phone (IndexedDB) for offline, with the line "Offline: showing what this phone has." Not built yet: the long-press actions (decisions.md) and the per-app icons (every older row uses `chat-circle` in `--ink-3`).

### 3.1 Grouping

| Group | Contains | Row meta |
|---|---|---|
| **Today** | Only the current thread, titled **Now** (built), accent icon | "this morning" / "this afternoon" / "this evening" / "tonight" by the time of its last message (05–12 / 12–18 / 18–22 / 22–05) |
| **Yesterday** (built) | The previous day's thread (and any old chat of that day) | Time of its last message ("21:40", 24-hour) |
| **Earlier this week** (built) | From Monday of this week to the day before yesterday (weeks run Monday to Sunday, so a Saturday is never "this week" on a Thursday) | Weekday and date ("Mon 26") |
| **Last week** (built) | Monday to Sunday of the week before | Weekday and date ("Sat 24") |
| **All conversations ›** (built) | One row that opens a full-screen list of every thread but Now, grouped by month ("October", "December 2025" outside this year), each month folding like the menu's groups, newest first, 30 at a time ("Show more"), with "‹ Menu" back | Weekday and date ("Sat 19") |

One thread per day (decisions.md). The prototype showed two "Today" rows (topics within a day); this doc does not, see Open questions.

### 3.2 Titles and icons

1. At the day roll the Worker gives the old thread a **provisional title**: the first owner message trimmed to 40 characters at a word boundary ([MEMORY](../mind/MEMORY.md) §11; Workers AI titles are deferred).
2. The night shift rewrites it as the **final title**, unless the owner renamed it.
3. Titles are ≤ **40** characters, sentence case, no date, no quotes ("A calm playlist for the evening", "Bars 9 to 12, slow then up to tempo").
4. The row's icon and colour are those of the app the thread was mostly about (from its action chips and senses); a general thread uses `chat-circle` in `--ink-3` [proposal; built: every older row uses `chat-circle`].
6. Until a thread has a title, its row shows its date ("Monday 26 October") (built).
5. An empty day (no messages) has no thread and no row.

### 3.3 Tap and long-press

| Gesture on a row | Result |
|---|---|
| Tap "Now" | Closes the menu; home shows today (built: toast "This is the current conversation" when already there) |
| Tap an older row | Closes the menu; home shows that thread read-only with the "Back to now" pill ([HOME](HOME.md) §4.9) (built) |
| Long-press an older row (450 ms) | Action sheet: **Continue this** · **Rename** · **Delete** [not built yet; Delete waits as a proposal, decisions.md] |
| Long-press "Now" | Nothing (today cannot be renamed or deleted from here) |

**Continue this.** Links the old thread to today: the mind's next briefing loads that thread's summary and its last 15 messages ([RUNTIME](../mind/RUNTIME.md)). Today's thread gets a system line "Continuing: <title>". Toast: "I'll keep that in mind today." Reversible (the link can be removed by long-pressing again: "Stop continuing").

**Rename.** The title becomes an inline text field (Inter 15), selected. Enter or tapping outside saves; Escape cancels; an empty title reverts to the automatic one. Max **60** characters. After a rename, the night shift never changes it.

**Delete (ask first).**

1. A bottom confirm sheet opens: title "Delete this conversation?"; body "<title> · <date>. Its messages are removed now and gone for good after 30 days. What I learned from it stays in What I remember, where you can remove it too." Buttons: **Delete** (`--alarm` text) and **Keep**.
2. Tapping Delete on this signed-in device is the approval. The thread disappears from the list at once.
3. A toast "Deleted. Undo" stays **8 s**; Undo restores it fully.
4. For **30 days** it is listed under Settings → Account → Recently deleted, where it can be restored or removed for good (a second confirm). After 30 days it is purged from storage and from search, including the next weekly backup cycle. [proposal: the 30-day window; decisions.md only requires asking first]
5. The mind can never delete a conversation itself; it can only propose it (a decision card of class "Can't be undone").

Acceptance: deleting needs two taps (row action, then Delete); the thread is gone from search immediately; Undo within 8 s restores it with all messages; a mind token calling the delete route directly gets 403.

## 4. Settings

The list, in order [proposal]. Before sign-in, rows show the meta "soon" and tap to the toast "<Name> comes with sign-in" (built).

| Row | Icon | Opens |
|---|---|---|
| **Appearance** | (inline control) | §4.1 |
| **Quiet hours** | `moon-stars` (built uses `bell`) | §4.2 |
| **Notifications** | `bell` | §4.3 |
| **What I remember** | `brain` | §4.4 |
| **Connected apps** | `plugs-connected` | §4.5 |
| **Devices** | `devices` | §4.6 |
| **Agents** | `key` | §4.7 |
| **Account** | `user-circle` | §4.8 |
| **Export** | `download-simple` | §4.9 |
| **On this phone** [proposal] | `device-mobile` | §4.10 |
| **About** | `info` | §4.11 |

### 4.1 Appearance

Shown inline in the menu, not as a page.

| Control | Values | Behaviour |
|---|---|---|
| Theme (segmented, built) | **Auto** · **Day** · **Night** | Applies at once. Auto = night from 19:00 to 07:00 local. Stored per device (`th-theme`) [proposal: also synced to the account as the default for new devices]. |
| Still background [proposal] | toggle, default off | Stops the field's drift and the edge breathing (the motion that otherwise runs forever). Also forced on by the system's reduced-motion setting. |
| Vibration [proposal] | toggle, default on | Turns off all haptics in the app. |

### 4.2 Quiet hours

Owner ruling: nothing before 06:30 local, no pushes, no sounds, nothing that needs the owner.

| Control | Values | Behaviour |
|---|---|---|
| Starts | time, default **22:00** [proposal] | From this time: no pushes, no sounds, new decisions held, the voice line's quiet variant. |
| Ends | time, **06:30 or later** | The picker does not offer anything earlier than 06:30. Shown as "06:30 (the earliest)". |
| Go quiet now (plan law 9) | **1 hour** · **Until tomorrow** · **Until I turn it off** | Same as quiet hours, starting now, for that long. A line at the top of the page says "Quiet until 14:20" with **End now**. No penalty: the mind keeps working; it just holds anything that would need the owner. |

What quiet hours hold back, and when it comes back:

| Thing | During quiet hours | Afterwards |
|---|---|---|
| Push notifications | Not sent | Decisions: one push at the end, if any still wait (counts against the daily budget). Reminders set in quiet hours move to 06:30. |
| Decision cards | New ones not shown | Shown at the first open after the end |
| Sounds | None (the app makes no sounds of its own anyway, except media the owner plays) | n/a |
| The conversation | Works normally if the owner writes | n/a |

Acceptance: with the clock at 05:00 and a waiting decision created at 23:00, home shows no card and no gold edge; at 06:31 it shows both; the end-time picker rejects 06:00.

### 4.3 Notifications

| Element | Behaviour |
|---|---|
| **Let me reach you** | A button. Only this tap ever asks the browser for notification permission (never on load). |
| State line | "Not set up" · "On" · "Blocked in Chrome. Turn it on in Chrome's site settings for this site." |
| Budget | Fixed text: "At most 2 a day, never in quiet hours." (plan §6) Reminders the owner set do not count. |
| Kinds (toggles) | **Decisions waiting** (on) · **Reminders you set** (on) · **Something broke** (on) · **New sign-in on another device** (on, cannot be turned off: security) |
| Send a test | Sends one test push now ("This is a test. Nothing needs you.") |
| Turning push off | Unsubscribes this device at once (removes its push subscription). |

Every push shows a visible notification (no silent pushes). Tapping a notification opens the app at the relevant place (the decision card, the reminder line, the device list). Delivery itself is specified in [API](../engineering/API.md) and [SECURITY](../engineering/SECURITY.md).

Built (P8: `apps/settings/notifications.js`, `th/push/phone.js`, the shell's `sw.js`): the row, the state line, the budget line, "Let me reach you", "Send a test" and "Turn off on this phone". At start, a phone with push on makes its subscription again under a replaced key and sends it after a new sign-in. The per-kind toggles wait (IDEAS.md, parked): every kind that exists today is on.

### 4.4 What I remember

The owner's window into the mind's memory ([MEMORY](../mind/MEMORY.md)). "You can open, fix or delete anything" (plan §3).

| Part | Behaviour |
|---|---|
| Top | A filter field, **Add something I should know**, then **Profile** ("What a new session reads first": the deterministic summary of the strongest facts, read-only, folded) |
| Groups | Built (P3): How to talk to me (rules) · Beliefs (facts tagged `faith`, whatever their kind) · Right now · Goals · Preferences · Routines · Facts · Other (a kind this phone doesn't know yet), then Loose ends · Days · Fading · Imported, to review. Sensitive facts are listed but their text is blurred until tapped. |
| A fact row | The fact's text; its source ("You said" / "I noticed" / "I inferred"); its confidence now as words with odds ("Pretty sure, about 8 in 10", COPY.md §1.2); since when |
| Tap a fact | Detail: what it rests on (who said it, when, and the start of what was said), the mind's reason when it gave one, history (earlier versions), and actions |
| **Fix** | Edit the text; saves as a new version in the owner's words that replaces the old one (the old one is kept as history) |
| **Pin** | The mind treats it as true until unpinned and never lets it fade |
| **Forget** | Asks once ("Forget this? It can't be brought back."), then the fact leaves the page and the toast "Forgotten. Undo" shows for 10 s; only then is it deleted for good with every version (MEMORY.md §3). Leaving the page inside those 10 s sends it at once. There is no Recently deleted for facts: forgetting is the point. The owner's tap is the approval. |
| How well I know you (P9) | Folded at the end, read when opened: corrections in the last 4 weeks by week, the last memory checks, what the mind arranged and what the owner did with it, and its guesses about the owner's day against their usual pattern (from 30 checked). A check on the mind, never a score for the owner (EVALS.md §9) |
| Proposals | Facts the night shift wants to add or replace that need the owner (e.g. replacing something the owner said) appear as decision cards on home, not here |

### 4.5 Connected apps

Read-only status in v1 [proposal]; one row per connection, with a status dot (green: fine; amber: late; red: failing) and its last contact time.

| Row | Status means |
|---|---|
| The mind | Last wake, today's wakes, and whether it is awake now |
| Muse (the Board, routine jobs) | Last work order delivered |
| Weather | Place and last update |
| Site deploys | Last release and whether its live check passed |
| Old system (during migration) | Whether anything still calls it |

Tapping a row shows its last 10 events. Changing a connection is done by asking the Thunderhead (and is an access change: ask-first).

### 4.6 Devices

Per [SIGN-IN](SIGN-IN.md) and [SECURITY](../engineering/SECURITY.md) (writer B owns the rules; this is the screen).

| Element | Behaviour |
|---|---|
| List | Each signed-in device: a name ("Chrome on Android"), "This device" on the current one, signed in date, last used |
| **Sign out** (per device) | Confirm sheet "Sign out <name>?"; on confirm the session ends at once and its push subscription is removed |
| **Sign out everywhere** | Confirm sheet; signs out every device including this one, then shows sign-in |

### 4.7 Agents

Agent tokens let the mind's sessions and helper agents call the Worker (decisions.md: issued and revoked only from here, stored as hashes).

| Element | Behaviour |
|---|---|
| List | Name, role (chat, night, reflex, Muse, CI; [SIGN-IN](SIGN-IN.md) §17), created, last used |
| **New token** | Pick a role, confirm (access change). The token is shown **once** with a Copy button and the line "This shows once. Paste it where it's needed, then close this." |
| **Revoke** | Confirm sheet; effective at once |

### 4.8 Account

| Element | Behaviour |
|---|---|
| Username | Shown |
| Change password | Current + new + confirm, password-manager friendly ([SIGN-IN](SIGN-IN.md)) |
| Recovery code | Make a new one (shown once); the old one stops working |
| Recently deleted [proposal] | Conversations and facts deleted in the last 30 days: Restore, or Delete now (second confirm) |
| Sign out | Signs out this device only; the outbox and caches on this phone are cleared after a confirm if anything is still unsent ("2 messages haven't sent yet. Sign out anyway?") |

### 4.9 Export

"Download everything" (plan §8). Built in P4 stage F (`frontend/apps/settings/export.js`, `tests/export-browser.test.mjs`; the Worker side in `backend/src/areas/backups/`): the row **Export** with `download-simple` after Account.

| Step | Behaviour |
|---|---|
| Start | **Download everything**. Asks for the password again (step-up; a wrong one says so and asks again, throttled like every password check). |
| Building | A bar and the line "Gathering everything… 40%"; the page can be left: coming back finds it still building (this phone remembers which). The push when it is ready waits for Web Push (P8). |
| Ready | **Download (2.3 MB)**, saving one ZIP to the phone, with the line "The link works for an hour, on this phone only.": `tables/<table>.jsonl` for each table DATA.md §10 marks for export (JSON Lines; a big table continues in `<table>-2.jsonl`), `README.md` explaining the format, and `export.json` with the counts. Attachments come with the files feature (none are stored yet). Only the device that asked can see or download it. |
| Backups | A line: "Last automatic backup: Sunday 03:20 (weekly, private)." or, before the first, "Automatic backups run every Sunday at 02:30 (weekly, private)." |

### 4.10 On this phone [proposal]

| Element | Behaviour |
|---|---|
| Storage | "Using 1.2 GB of about 20 GB" from `navigator.storage.estimate()`; whether storage is persistent |
| Offline music | Budget (default 512 MB), slider; **Clear offline music** (confirm; removes local copies only, nothing on the server) |
| Offline files | Podcast downloads and Study PDFs kept on the phone; clear each |
| Waiting to send | Outbox count; **Send now** |

### 4.11 About

| Element | Behaviour |
|---|---|
| Version | The live release from `release.json`: short commit and date ("a1b2c3d · 28 Oct 2026") |
| Check for update | Checks the service worker; "Up to date" or "Updating when it's safe" |
| Show gesture hints again | Resets the hint counters ([HOME](HOME.md) §10) |
| Licences | Phosphor Icons (MIT); Fraunces and Inter (SIL Open Font License); any other shipped library with its licence |
| Source | Link to the public repository |

## 5. Accessibility

- The panel is a `<nav aria-label="Menu">`; opening it moves focus to the search field's button; closing returns focus to the "Menu" button.
- The segmented theme control is a `role="radiogroup"` [proposal: built uses plain buttons].
- Every confirm sheet traps focus while open and puts initial focus on **Keep** (the safe choice).
- Toggles are `<input type="checkbox" role="switch">` with visible labels.
- All rows ≥ 44 px tall.

## 6. Acceptance summary

| # | Check |
|---|---|
| M1 | Swipe, Menu button, Back, Escape and dim-tap all open/close the panel as in Rules 1 |
| M2 | Search: accent folding, 2-character minimum, offline line, server results appended without reordering (built: `tests/convos-browser.test.mjs`) |
| M3 | Grouping by the calendar: on a Thursday, fixture threads of today, yesterday, Monday, last Saturday and 40 days ago land in Today/Now, Yesterday, Earlier this week, Last week and All conversations; Monday and Sunday edges, month and year crossings; a folded group stays folded on reload (built: `tests/convos-logic.test.mjs`, `tests/convos-browser.test.mjs`) |
| M4 | Rename: 61 characters is cut to 60; empty reverts; the night shift does not overwrite (`title_source=owner`) |
| M5 | Delete: confirm sheet, Undo for 8 s, Recently deleted for 30 days, purge after |
| M6 | Quiet hours: end time cannot be before 06:30; decisions held as §4.2 |
| M7 | Notifications: no permission prompt without a tap on "Let me reach you" |
| M8 | Agents: a new token is shown once and cannot be shown again |
| M9 | Axe: no violations on the menu and each settings page, day and night |

## Open questions / tests

| Question | How to settle it |
|---|---|
| The prototype's menu showed two rows under "Today" (topics within a day). Decisions.md says one conversation per day. This doc shows one row per day. Should the night shift split a day into topic rows? | Owner choice. If yes: topic rows are sub-rows under the day, titled by topic, all pointing into the same thread. |
| A 30-day "Recently deleted" window | Owner accepts or prefers immediate deletion after the confirm. |
| Default quiet-hours start (22:00 proposed) | Ask the owner. |
| Should settings sub-pages open full screen (proposed) or inside the 360 px panel (prototype)? | Build both for "What I remember" and look on the A15. |
| Search over messages in English and the second language: is FTS5 with accent folding enough, or is cross-language recall needed? | The mind research's later embedding phase; measure missed searches first. |
