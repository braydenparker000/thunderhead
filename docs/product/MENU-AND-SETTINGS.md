# Menu and Settings

The menu keeps conversations within reach. Settings uses the same controls, with room to read
and a fixed back button and title. These are plain ES modules; there is no component framework.
The implementation lives in `th/convos/`, `apps/settings/`, and `ui/forms.css`.

## 1. Structure and shared controls

Swipe left or use Menu to open the panel. Its background is `--panel`; the bottom bar is flat
glass, with Search everything and a circular Settings button. The conversation list scrolls
above that bar. Now has a steady accent glow. Closing and reopening does not replay a cascade.

Settings opens over the shell. A sub-page opened from Settings returns there; a direct route
returns to the menu. The header stays above the scrolling content, showing a hairline after
content has scrolled underneath. Its title takes focus to announce the page.

All control presentation lives in `ui/forms.css`. The shared DOM helpers are in
`apps/settings/components.js`. Page styles only arrange content.

| Primitive | As built |
|---|---|
| `.group`, `.group-title` | Inset flat glass card, 1 px glass border, `--r-l`; separators start 16 px in. Titles use `--fs-label`/`--lh-compact`, weight 600, uppercase, .08em tracking and `--ink-3`. Adjacent groups are 12 px apart. |
| `.row` | At least 52 px, 16 px side padding; optional 24 px Phosphor icon, body title, small detail, trailing value and 16 px caret when opening another surface. Destructive titles use `--alarm`. |
| `.switch` | A labelled row with `role="switch"` and `aria-checked`. Track 46×28; white 24 px knob moves 18 px on `--pop`/`--d-quick`. The row supplies the hit area. |
| `.seg` | 36 px pill track, 2–4 labelled radio buttons, a sliding flat glass thumb on `--settle`/`--d-base`; arrow keys change selection. Transparent hit areas reach 44 px. |
| `.sheet` | Bottom glass sheet, `--r-xl` top corners, 20 px padding, dim and 36×4 grabber. Downward drag past 30% or a flick dismisses; shorter drags settle back. Escape, Cancel and dim tap also close. |
| `.field` | Text, search and time inputs, at least 48 px, flat glass, `--r-row`, glass border and accent focus. Type uses `--fs-input`; Smaller falls back to the fixed input token so fields never drop below 16 px. |
| `.btn` | 48 px pill, body type at weight 600: accent primary, flat glass secondary, text-only quiet; destructive actions use alarm text. |
| `.sback` | 40 px flat glass circle with a 44 px hit area and `caret-left`; `gear-six` uses the same circle in the menu. Title beside it uses `--fs-page-title`/`--lh-page-title`, weight 600. |

Presses tint and scale on `--d-fast`; releases use `--pop`. Focus uses the shell ring. All type,
curves and motion durations come from `tokens.css`; its values are unchanged. Reduced motion
removes control travel. No native select is rendered. Pickers open sheets with a check on the
current choice. Legacy sign-in fields share these surfaces without changing sign-in behavior.

## 2. Search

The Search everything button becomes a field in the bottom bar; Clear empties it and Escape or
Back exits. Results appear in titled groups: Go to, Conversations and What I remember. This
phone answers first; Worker results append after typing pauses. Each group has Show all when
needed. Accent folding, the two-character minimum, offline results and the error line remain.

Settings names and other words find the same pages: password finds Password · Account, dark
finds Theme, font finds Text size, backup finds Export. Appearance hits bring the relevant
control into view. Connected apps and the legacy Agents administration route are not advertised
in navigation or search. App shortcuts still open their existing destinations.

## 3. Conversations

### 3.1 Day cards

Pinned conversations come first with a pin glyph. The rest are grouped as Today, Yesterday,
Earlier this week (Monday onward), and Last week. Each heading uses the group-title treatment
and can fold its card; folded rows leave the tab order. This phone remembers folded groups.

Now shows today's date, message count and part of day. An older row shows its title, summary or
message count, and a trailing time/date. Imported threads retain Old Chats; off-the-record
threads retain their marker. Untitled threads show their date. Titles are always text.

All conversations opens a page with the same fixed header, grouped by month, 30 rows at a time.
Show more preserves pagination. Tapping an older row opens its read-only conversation on home;
Back to now and Now return to the current conversation.

### 3.2 Preparation

`prepare()` imports search, installs listeners once, and builds from the cached list without
opening the menu or reading the Worker. Concurrent and repeated calls share its promise and
retain the built DOM. It uses today's already-loaded chat when available. Task A can call this
export during idle time. `startMenu()` joins preparation and refreshes stale data in the
background; a prepared first open only has to reveal the list. Online and feed changes still
refresh the visible list. The existing boot caller is unchanged in this task.

### 3.3 Actions

Hold a conversation for Continue this, Rename, Pin/Unpin and Delete in the shared sheet. Now
offers Delete alone. A left swipe retains the existing Pin and full Summary actions.

Rename uses a shared field and Save, allows 60 characters, and an empty title returns naming to
the mind. Continue this links the older thread to today's context. Pinning is local to this phone
and can be undone. These data operations retain their existing API calls.

Delete asks in a second sheet. Keep is focused; cancellation does nothing. On confirmation,
the conversation is hidden and Undo can restore it. Recently deleted retains it for 30 days,
after which the existing server purge applies. Deleting Now lets the next message start a fresh
conversation. Facts learned from a conversation are managed separately in Memory.

### 3.4 Tasks

What Muse was asked (the owner's `@muse` in the chat, or the mind's order) and Muse's own music
uploads, as a **Tasks** group right under Now, before Pinned (`th/convos/tasks.js`). It reads
`GET /v1/work/orders` (newest first, 20 at most) when the menu opens and whenever the feed says
`work` changed; while there are none the group isn't there at all. Each row uses the conversations'
row anatomy: the state's icon (asked `clock`, picked up `hand-pointing`, working `arrow-clockwise`,
done `check`, failed `warning-circle`, cancelled `x`), the title (the owner's first 60 characters of
words), the state in words and the age (now, 12 min, 3 h, then the day). The heading folds like the
others and is remembered.

A tap opens the shared sheet: the title, the state and age, what came of it (Muse's note when done,
its reason when it failed), then Muse's progress lines with their times (`GET
/v1/work/thread?order=`), and **Cancel task** while it is asked, picked up or working (the owner's
cancel is never gated; the chat says "Cancelled. Muse won't do it."). The sheet's own button reads
Close. Nothing new in Settings: Muse orders the mind places ask first under `mind.permit.muse`.

## 4. Settings pages

### 4.1 Appearance

The top group starts with a live reply-bubble and row preview. Theme (Auto, Day, Night) and Text
size (Smaller, Default, Larger) use segments; Still background uses a switch. They update the
preview and shell immediately and keep the existing local preferences. Larger remains 18.5 px
on replies. Auto still follows the existing clock rules. About remains a group at the bottom
of Settings, with the running short commit and Check for update.

Navigation order (2026-11-02): More appearance, Home and chat, Ring and gestures, Island,
Briefing, The mind, Quiet hours, Notifications, What I remember, Privacy and data, Password,
Devices, Export, Recently deleted, Files for the workshop (2026-11-12, §6.9), About and
diagnostics. The catalogue's pages (§6), Files for the workshop and About open over Settings like
the others. Connected apps stays hidden until it has a working surface.

### 4.2 Quiet hours

The Every day group has Starts and Ends rows. Each opens a time field in a shared sheet.
Save keeps the existing `PATCH /v1/settings` behavior, including the 06:30 minimum end time.
Go quiet now offers 1 hour, Until tomorrow and Until I turn it off, or End now while quiet.
The status line and held-notification rules are unchanged.

### 4.3 Notifications

The phone's permission/subscription status sits above the Notifications on this phone switch.
Its checked state means notifications are on; Send a test appears while they are on.
Only the owner's enable tap requests browser permission.
The existing budget and quiet-hours explanation stays. Per-kind toggles remain deferred;
all currently supported kinds retain their existing policy.

### 4.4 What I remember

Search, Add something I should know, Profile, fact groups, Loose ends, Days, Fading and Imported
to review keep their existing queries and ordering. Profile and the meter stay folded until
opened. Sensitive text remains blurred and excluded from the accessibility tree until revealed.

Facts are inset cards with a shared row and meaningful icon, source/confidence/age metadata,
badges and expandable evidence/history. Fix uses a shared field; Pin and Bring this up use
switches. Forget retains its confirmation and ten-second Undo window, offline queue, retries
and focus continuation. Leaving the page flushes pending Forget operations as before.

Add opens a form with a sheet picker for Kind. Loose-end editing uses segments for whose turn
it is, plus existing date/text fields. Day-note editing retains its content and operations.
The How well I know you meter keeps its existing calculations and display; only its surrounding
surfaces change.

Learned from outside (2026-11-02, MEMORY.md §6 M11, §12) comes first when it has anything: the
facts a session wrote after reading outside text, or the mind's guesses, newest first, each with
"waiting for you" and the day. Two actions only: Keep (makes it the owner's) and Forget (the same
confirmation and Undo as above). Loose ends and days a session wrote after reading outside text say
so in their line.

### 4.5 Connected apps

Hidden. This task does not add a connection, status integration or access grant.

### 4.6 Devices

Signed in lists the current phone first, its badge, dates and location description. Device names
remain editable. Access groups sign-out actions; destructive actions use alarm text and keep
confirmation. Recovery-code creation still requires the current password and the existing
shown-once confirmation flow. Nothing changes which sessions or credentials are affected.

### 4.7 Legacy Agents route

The direct route remains available for existing links but is hidden from navigation. It uses
shared rows, fields and buttons. Five role choices remain a radio-row group with check marks,
preserving the existing administration flow. Creating a key still requires the password; keys
are still shown once. Revoke still confirms. No new role or access behavior is introduced.

### 4.8 Password and Recently deleted

Password is the existing Account route. Current/new password fields keep their password-manager
autocomplete, Show control and submit behavior. Sign out all other devices is a switch, on by
default. This phone keeps import and sign-out actions.

Recently deleted lists conversations with deletion date, remaining days and message count.
Restore uses the shared button and the existing API; it does not add a permanent-delete action.

### 4.9 Export

Shared groups, password fields and buttons surround the existing export job. Download everything
still requires the password. The gathering bar, resuming a pending export, download link and
backup explanation keep their logic. This task does not start an export outside test fixtures.

## 5. Accessibility and verification

Controls have visible labels, shared focus rings, radio/switch state, and designed hit areas.
Sheets trap keyboard focus and restore it on close. Keep is the initial focus for confirmations.
The noninteractive page heading receives focus without a decorative ring.

The browser suites check conversation grouping/search/actions, Memory and Undo, export and push,
and the shared-control contract across every Settings route and the menu in both themes; the
catalogue's pages are checked in `tests/settings-browser.test.mjs` (§6).
They reject native selects and unstyled checks/radios, require primitive classes and rows at
least 44 px high, and verify 18.5 px large replies, live preview and the fixed header hairline.

Visual inspection uses real Switzer at 390×844. Before/after timing is recorded from Chromium
traces because Task A's readout is not in the base revision. Host Chromium measurements are not
Galaxy A15 measurements; device judgment and final feel tuning remain with the owner.

## 6. The settings catalogue

The owner asked for Settings full of things to change (2026-11-02). Every such setting is one
entry of a catalogue, [`shared/contract/settings.ts`](../../shared/contract/settings.ts), and that
list is the only place a setting is declared:

- **An entry** is `{ key, group, section?, label, detail, kind, options?, default, scope, mind }`,
  plus `unit` for a range and `attr` for an Appearance key. `group` is the page; `section` a heading
  inside it; `detail` the one line under the row.
- **Kinds.** `switch` (true or false), `choice` (one option's string: segments up to four
  options, a sheet picker past that), `range` (one option's number, shown with its unit as
  segments), `order` (some option values, each once, in the owner's order: move up, move down, hide
  and show, all buttons), `text` (a string in a sheet, with `max` and `pattern`; none is
  catalogued yet) and `links` (2026-11-02: up to `items` links `{ url, mine }`, each address at
  most `max` characters, once, and one `linkProblem` in the contract passes: https, no user,
  password or port, a public host that is neither numeric nor local; a row each with its host,
  Mine or Shared, and Remove, then Add, which opens a sheet that says why it refuses a link; the
  Worker refuses one with the same words, naming `<key>.<n>.url`).
- **Scope `worker`.** Kept in Core's settings table. `PATCH /v1/settings` takes exactly P1's keys
  and the catalogue's worker keys, each checked by its kind
  (`backend/src/areas/settings/catalog.ts`, spread into `areas/ops/schema.ts`); a phone key, an
  unknown key or a value its kind refuses is still `422 validation` naming the key. A key is stored
  only once changed: readers take the catalogue's default for a missing one.
- **Scope `phone`.** This phone's localStorage, `th.s.<key>` (`'true'`/`'false'`, a number, a
  string, or JSON for an order), removed at the default; it survives signing out, like `th-theme`.
  An Appearance key also sets its `attr` on `<html>` while it is not the default.
- **`mind: true`.** Listed in the mind's briefing, section 13 "Your settings", as `key: value`
  lines in catalogue order, `(default)` while unset, each one the mind may change followed by its
  detail line (2026-11-04; section 13 holds 3,000 characters), after a legend for the permissions (`ask`,
  `tell`, `quiet`). The core's section 8 points at it, and section 2 carries the standing
  permissions' positions in one line. All `mind.*` keys and `briefing.tiles` are
  mind keys; only worker keys may be.
- **The phone's copy.** `node scripts/contract.mjs` writes `frontend/apps/settings/catalog-data.js`
  from the contract (`tests/contract-gen.test.mjs` fails while it is stale). One renderer,
  `apps/settings/catalog.js`, draws any group with the shared controls (§1) and saves by scope:
  phone keys at once; worker keys by PATCH, one key per request, one request after another, the page
  showing the Worker's answer once `GET /v1/settings` returns (the group is inert until then) and
  putting a control back, with the error line, when a PATCH fails. Worker values are kept in
  `th.p.settings` meanwhile, so a page opens with them; signing out wipes it.
- **Reading a setting elsewhere.** `phoneValue(key)` from `apps/settings/catalog.js` gives a phone
  key's value or its default; every change is the document event `th:setting`
  (`{ key, value, scope }`). Worker keys are in `GET /v1/settings`. `applyPhone()` puts the
  Appearance attributes on `<html>`: catalog.js runs it when it loads and on every change; before the
  first paint `ui/theme.js` sets the same attributes from `th.s.<key>` (2026-11-04; its list is held
  equal to the catalogue's by `tests/settings-depth-browser.test.mjs`).

Each page is a module of a few lines (`apps/settings/<page>.js` exporting `page(body)`, which calls
`renderGroup(body, '<group>')`); `settings.js` opens it by name. Adding a setting: add its entry,
run `node scripts/contract.mjs`, add its row to the table below; the page, PATCH and the briefing
follow. `tests/settings-browser.test.mjs` fails when a page shows a row that is not in the
catalogue, misses one that is, or a key here lacks its row, scope or default;
`backend/tests/integration/settings-catalog.test.ts` checks PATCH and the briefing.

"Read by" says who uses each one today. **Exposed** means the value is kept and readable but no
code acts on it yet: the shell, chat, island and Briefing were being changed by others the night
these were added, so wiring them is the next step.

### 6.1 Appearance (`appearance.js`, "More appearance")

Below the Theme, Text size and Still background at the top of Settings (§4.1), which keep their
own keys (`th-theme`, `th-text`, `th-still`). The accent stays blue (owner, 2026-10-31): the
intensity only says how strongly.

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `appearance.accent` | segments: soft / calm / vivid | phone | `calm` | `ui/tokens.css`: `--accent-fill`, `--accent-text`, `--accent-icon`, `--glow` (each keeps 4.5:1) |
| `appearance.glass` | segments: frosted / flat | phone | `frosted` | `ui/tokens.css`: flat drops every `backdrop-filter` and makes the glass, bar, sheet and panel fills opaque enough to read |
| `appearance.corners` | segments: sharper / soft / rounder | phone | `soft` | `ui/tokens.css`: every `--r-*` token but the full pill |
| `appearance.glyphs` | segments: filled / outline | phone | `filled` | `apps/home/home.js`: the ring's icons, Phosphor fill or regular |
| `appearance.ring` | segments: compact / regular / large | phone | `regular` | `ui/tokens.css` scales `.ring` (.86 / 1 / 1.16); `home.js` keeps it clear of the edges by the same factor |
| `appearance.haptics` | segments: off / light / full | phone | `light` | `th/motion.js` `buzz()`: off none, full pulses twice as long; the ring, swipes, dictation, the decision card and the Briefing's hold |
| `appearance.motion` | segments: follow system / on / off | phone | `system` | `ui/tokens.css` (the duration tokens) and `th/motion.js` `motionReduced()`; off keeps the tokens and springs, while a few decorative loops still follow the phone's own setting |
| `appearance.field` | segments: glow / plain | phone | `glow` | `ui/prefs.css`: plain drops the two drifting glows behind home |
| `appearance.grain` | switch | phone | `on` | `ui/prefs.css`: off hides the film grain |
| `appearance.idle_glow` | switch | phone | `on` | `ui/prefs.css`: off hides the edge light while nothing happens; thinking, listening, working and a waiting card still light it |
| `appearance.feel` | segments: calm / regular / lively | phone | `regular` | `th/motion.js`: every spring, as the module loads (calm: stiffness × 0.85, damping + 0.14; lively: × 1.1, − 0.1) |
| `appearance.launch` | segments: circle / fade / none | phone | `circle` | `ui/launch.js`: the cover an app opens under; none resolves at once |
| `appearance.launch_ms` | range (ms): 200 / 300 / 420 | phone | `300` | `ui/launch.js`: the circle's or the fade's length |
| `appearance.ring_dim` | segments: light / regular / deep | phone | `regular` | `ui/prefs.css`: the scrim behind the open ring, half as strong or 45% darker |
| `appearance.ring_label` | switch | phone | `on` | `ui/prefs.css`: off hides the app's name by the ring |
| `appearance.press` | switch | phone | `on` | `ui/prefs.css`: off hides the circle that closes in during the hold |
| `appearance.toast` | segments: bottom / top | phone | `bottom` | `ui/prefs.css`: where home's short notice shows |
| `appearance.toast_ms` | range (s): 2 / 3 / 5 | phone | `2` | `home.js`: how long home's short notice stays |
| `appearance.clock` | segments: 24-hour / 12-hour | phone | `24` | `th/pref.js` `clock()`: the times over turns in the chat, on the weather and Due tiles and in security notices |
| `appearance.status` | switch | phone | `on` | `ui/prefs.css`: off hides the status chip at the top of home |
| `appearance.menu_width` | segments: narrow / regular / full | phone | `regular` | `ui/prefs.css`: the menu at most 300 px wide, as it was, or the whole screen (`home.js` measures it as it moves) |
| `appearance.brief_tiles` | segments: comfortable / compact | phone | `comfortable` | `ui/prefs.css`: the Briefing's tiles with less padding and smaller gaps |
| `appearance.brief_greeting` | switch | phone | `on` | `ui/prefs.css`: off hides the line at the top of the Briefing |

### 6.2 Home and chat (`chat.js`)

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `chat.density` | segments: comfortable / compact | phone | `comfortable` | `ui/tokens.css`: compact turns sit 12 px apart, not 22 |
| `chat.time_markers` | switch | phone | `on` | `ui/prefs.css`: off hides the time over a turn |
| `chat.fold` | switch | phone | `on` | `th/chat/view.js`: off never folds an older long reply |
| `chat.reveal` | segments: words / instant | phone | `words` | `th/chat/view.js`: instant draws a new reply whole and shows what is under it at once |
| `chat.followups` | segments: two / none | phone | `two` | `ui/prefs.css`: none hides the suggested follow-ups (a choice the reply asks for still shows) |
| `chat.enter_sends` | switch | phone | `on` | `home.js`: off, Enter starts a new line and only the send button sends |
| `chat.mic` | switch | phone | `on` | `ui/tokens.css`: off hides the mic, and the send button stands alone |
| `chat.dictation` | segments: auto / en / es | phone | `auto` | `th/dictate/mic.js`: English or Spanish go to the Worker as `?lang=` (`POST /v1/dictate`, Whisper's `language`); auto sends none |
| `chat.date` | segments: short / long / hidden | phone | `short` | `apps/home/prefs.js` (the long form) and `ui/prefs.css` (hidden) |
| `chat.hint` | switch | phone | `on` | `ui/prefs.css`: off hides the gesture hint at once |
| `chat.placeholder` | text in a sheet, ≤ 30 characters | phone | `Ask anything` | `apps/home/prefs.js`: the empty ask bar's words, and what dictation puts back after listening |
| `chat.autofocus` | switch | phone | `off` | `apps/home/prefs.js`: the ask bar takes the keyboard as home opens |
| `chat.spellcheck` | switch | phone | `on` | `apps/home/prefs.js`: the ask bar's `spellcheck` |
| `chat.autocap` | segments: sentences / off | phone | `sentences` | `apps/home/prefs.js`: the ask bar's `autocapitalize` |
| `chat.draft` | switch | phone | `on` | `home.js`: off neither keeps nor restores an unsent draft |
| `chat.code_wrap` | switch | phone | `off` | `ui/prefs.css`: code blocks wrap instead of scrolling sideways |
| `chat.news` | switch | phone | `on` | `apps/home/boot.js`: off never loads the What's new note |

### 6.3 Ring and gestures (`gestures.js`)

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `gestures.ring_apps` | order of music, guitar, podcasts, astra, media, study | phone | `music, guitar, podcasts, astra, media, study` | `th/registry/apps.js` `ringApps()` and `home.js`: the shown apps clockwise from the top, then Photos in the seventh place, kept for it; the ring is built again on a change |
| `gestures.hold_ms` | range (ms): 160 / 220 / 300 | phone | `220` | `home.js`: the hold before the ring opens |
| `gestures.swipe_px` | range (px): 6 / 10 | phone | `6` | `home.js`: how far a drag goes before it is a swipe |
| `gestures.edge_guard` | switch | phone | `on` | `home.js`: a sideways drag that starts within 20 px of the screen's side never becomes a page swipe |
| `gestures.prewarm` | switch | phone | `on` | `apps/home/prewarm.js`: the app under the finger in the ring loads out of sight, so it opens already built (HOME.md §12) |
| `gestures.swipe_commit` | range (%): 20 / 28 / 40 | phone | `28` | `home.js`: how far a slow swipe goes before the page turns |
| `gestures.hold_slop` | range (px): 10 / 18 / 28 | phone | `10` | `home.js`: how far the finger may drift during the hold |
| `gestures.pull_find` | switch | phone | `on` | `home.js`: off, pulling down at the top of the conversation does nothing |
| `gestures.ring_ticks` | switch | phone | `on` | `home.js`: off, no tap back as the finger crosses apps in the ring |

### 6.4 Island (`island.js`)

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `island.mode` | segments: capsule / bar / off | phone | `capsule` | `ui/tokens.css` (bar: the capsule across the top, its clip following the measured box) and `th/island/island.js` (off: `openApp` declines, so Music and Podcasts open as their own pages) |
| `island.art` | switch | phone | `on` | `ui/prefs.css`: off shows the app's colour dot in place of the art |
| `island.titles` | segments: scroll / fade | phone | `scroll` | `th/island/island.js`: fade never scrolls a long title |
| `island.controls` | segments: prev-play-next / play-next-sleep | phone | `prev-play-next` | `th/island/island.js`: with play, next, sleep the first button is the sleep timer and sits last |
| `island.alerts` | switch | phone | `on` | `th/island/island.js`: off, the capsule shows no alert dot for a line or a card about what plays |
| `island.sleep_min` | range (min): 15 / 30 / 45 | phone | `30` | `th/island/island.js`: the minutes the capsule's sleep timer starts with |
| `island.bars` | switch | phone | `on` | `ui/prefs.css`: off hides the level bars |
| `island.progress` | switch | phone | `on` | `ui/prefs.css`: off hides the progress line |
| `island.swipe` | switch | phone | `on` | `th/island/island.js`: off, a sideways swipe on the capsule does not skip |

### 6.5 Briefing (`briefing.js`)

Tiles, in order lists the shown tiles top first, each with move up, move down and hide; hidden tiles
wait in a group below with show. Focus stays with the tile that moved. The holiday countries are
the ones the Holidays tile has lists for; auto takes the weather place's country. Calendars
(2026-11-02) holds up to three ICS links for the Today tile ([BRIEFING.md](BRIEFING.md) "Today"):
Add takes a pasted link (a `webcal://` one as `https://`), each row's person button marks it Mine
(the default) or Shared (someone else's or an organisation's feed: its titles reach the mind as
outside text), and Remove takes it out. The links are a key to each calendar: only the owner's
devices see them; an agent's `GET /v1/settings` has each link's host and mark only.

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `briefing.tiles` | order of report, today, due, practice, study, built, notes, holidays (the tiles the Worker places) | worker | `report, today, due, practice, study, built, notes, holidays` | the Worker (`briefing/owner-tiles.ts`, 2026-11-04): unset, its own order; set, a tile left out is not served and the rest go in the owner's order, "Waiting on you" first unless Overnight is, the mind's pins moving within it; the weather stays above them all; the mind (briefing section 13) |
| `briefing.calendars` | links: up to 3 ICS links, each Mine or Shared | worker | `none` | the Worker (the Today tile, the day's line, the brief's section 1 for Mine links, section 7 for Shared ones); agents see hosts only |
| `briefing.units` | segments: c / f | worker | `c` | exposed: `GET /v1/settings`; nothing reads it yet |
| `briefing.due_days` | range (days): 1 / 3 / 7 | worker | `3` | exposed: `GET /v1/settings`; nothing reads it yet |
| `briefing.holidays` | picker: auto / AU / CA / FR / DE / MX / ES / GB / US | worker | `auto` | exposed: `GET /v1/settings`; nothing reads it yet |

### 6.6 The mind (`mind.js`)

**Today** sits at the top, above the parts (`mind-meter.js`, from `GET /v1/mind/usage`, read as
the page opens; [API.md §11.8](../engineering/API.md#118-mind)): the wakes the mind set itself today
against the wake budget ("4 of 12 wakes I set myself", with any refused and how many watches wait),
the minutes it was awake and the times it woke for the owner, the night shift's minutes, and one
row for the 7 days before (wakes a day). Counts only: never why it woke or what it looked at. With
the budget at Off it says so; when the Worker can't answer it says that, and the settings below
still work. The day is the owner's logical day (it ends at 04:00).

Six parts: How I talk, Day and evening, Nights, Reaching you, Waking, Standing permissions. The name
the owner gives the mind (2026-11-04) is what the shell says wherever it would say "the mind" (the
page's title and its row in Settings, the copy in `th/copy.js` `mindName()`), from `th.p.settings`,
which home's read of the settings keeps (`keepShell`); the briefing says it in one line of section 1. Each permission is Ask (a
decision card first), Do and tell, or Do quietly (the ledger only), and the Worker enforces it
([API.md §11.11](../engineering/API.md#standing-permissions)). The page says under them: "Always
asks first: money, deleting your data, keys and access, reaching another person." (the floors no
setting lowers). The briefing's section 2 gives each class's position on every wake, in the first
2,000 characters; section 13 says what each position asks of it and lists every verb.

**What lands** comes near the end of the page (`mind-lands.js`, 2026-11-04, [BEHAVIOR.md §3.6](../mind/BEHAVIOR.md)):
a fold read when it opens (`GET /v1/insight/topics`), a row per topic the mind placed in the last 30
days, worst first, with its counts in words ("Used 3 · took back 0 · left 1 · not seen 0 · on the
Briefing and home"). A topic the owner passed over three times in a row says "Resting until 4
December" and has Reopen (`POST /v1/surfaces/topics/:key/reopen`), after which the fold reads again;
"Counts only, never a score for you."

**Routines** follows it (`mind-routines.js`, 2026-11-04, MIND-PLAN §3.6, API.md §11.11 "Routines"): a
fold read when it opens (`GET /v1/routines`), one box per routine the owner approved on a card: its
switch with the name and its condition in words ("Weekdays at 07:30"), then when it last ran ("Last
ran 4 Nov, 07:30.") with Undo for that run, or why the last try stopped. A routine that is off shows
Remove. Each switch, Undo or Remove reads the list again. "No routines yet. I ask before I set one up."

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `mind.name` | text in a sheet, ≤ 20 characters, no control characters | worker | empty (``) | the shell's copy, in place of "the mind"; the mind (briefing sections 1 and 13); the Worker's PATCH holds it to the phrase lint (`shared/contract/lint.ts`, `422 validation`); the owner's alone (the mind's `settings.set` is refused) |
| `mind.voice` | segments: plain / warmer / drier | worker | `plain` | the mind (briefing section 13); the Worker does not enforce it yet |
| `mind.verbosity` | segments: short / normal / full | worker | `normal` | the mind (briefing section 13); the Worker does not enforce it yet |
| `mind.day_start` | a sheet picker: 05:00 to 10:00 | worker | `07:00` | `ui/theme.js` (Auto turns day at it, also while the page is open); the mind (briefing section 1's "now": the owner's day or evening, `brief-day.ts` `dayPart`; section 13) |
| `mind.night_start` | a sheet picker: 18:00 to 23:00 | worker | `22:00` | `ui/theme.js` (Auto turns night at it); the mind (briefing sections 1 and 13) |
| `mind.night_scope` | segments: bookkeeping / arrange / full | worker | `full` | the mind (briefing section 13); the Worker does not enforce it yet |
| `mind.night_budget` | range (min): 5 / 15 / 30 | worker | `30` | the mind (briefing section 13); the Worker does not enforce it yet |
| `mind.idle` | range (min): 10 / 30 / 120 | worker | `120` | the mind (briefing section 13); the Worker does not enforce it yet |
| `mind.pushes` | segments: never / urgent / normal | worker | `normal` | the mind (briefing section 13); the Worker does not enforce it yet |
| `mind.speech` | segments: as needed / quiet / silent | worker | `as_needed` | the Worker, at each `th surface`, `th propose` and `th push`: quiet takes 1 home line change and 1 card a day and a push only for what the owner asked for, silent none (`422 speech_budget`); as needed holds nothing back ([BEHAVIOR.md §3.7](../mind/BEHAVIOR.md)); the owner's alone (the mind's `settings.set` is refused); the mind (briefing sections 1 and 13) |
| `mind.home_lines` | range (lines): none / 1 / 2 / 3 / 4 | worker | `4` | the Worker, at each `PUT /v1/surfaces/home/line.N`: a slot past the count is `422 validation` on `slot` (`settings/home-lines.ts`); the mind (briefing section 13) |
| `mind.ask_outside` | switch | worker | `off` | the mind (briefing section 13, and `mind/skills/voice.md`: off, it looks things up unasked; on, it asks first); the Worker does not enforce it |
| `mind.wake_budget` | range (a day): Off / 6 / 12 / 24 / 40, a sheet picker | worker | `12` | the Worker, at each watch's wake: past it the watch is refused (`over_budget`), Off refuses new watches; the owner's own messages never count ([RUNTIME.md §3, §11](../mind/RUNTIME.md)); the mind (briefing sections 1 and 13) |
| `mind.permit.music` | segments: ask / tell / quiet | worker | `quiet` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.podcasts` | segments: ask / tell / quiet | worker | `quiet` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.reminders` | segments: ask / tell / quiet | worker | `tell` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.settings` | segments: ask / tell / quiet | worker | `tell` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.muse` | segments: ask / tell / quiet | worker | `ask` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.watch` | segments: ask / tell / quiet | worker | `tell` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.practice` | segments: ask / tell / quiet | worker | `tell` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.tiles` | segments: ask / tell / quiet | worker | `quiet` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.titles` | segments: ask / tell / quiet | worker | `quiet` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13) |
| `mind.permit.outside` | segments: ask / tell / quiet | worker | `ask` | the Worker, at each write the mind makes (API.md §11.11); the mind (briefing section 13). Keeping an outside fact (`memory.outside_keep`) asks at every position: the owner's tap on its card is the keep |

### 6.6b Music (`music.js`)

Whether find and the brief use the owner's listening history, then Listening history
(`music-history.js`, [MUSIC.md §16](apps/MUSIC.md)): the exports picked or dropped, each sent with its
SHA-256 (`PUT /v1/music/history`) and counted once, and what was counted (counts only).

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `music.history` | switch | worker | `on` | the mind (briefing section 13) and the brief's taste line (`areas/mind/assemble.ts`: off leaves it out); the DJ shuffle's weights (`GET /v1/music/taste/weights` answers none while off) and a `music.play_mix` find ("playlist from words") weigh by history only while on; find's `history=1` is the mind's to skip |

### 6.6c Photos (`photos.js`)

Google Drive first ([PHOTOS.md §3.6](apps/PHOTOS.md)): Connect (Google's consent for the
`drive.file` scope, back to `/photos/`), or "Connected as" the Google account, the folder by name and Disconnect; a plain line when
Google took the access back, and one when the Worker has no OAuth client yet. Then the two keys
below (recent originals come with editing: shown, not yet chosen), and Recently deleted, which
opens Photos' own list (`/photos/?deleted=1`). `/settings/photos/` opens this page.

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `photos.preview_size` | segments: 1,024 / 2,048 px (On this phone) | worker | `2048` | the phone, when it makes a photo's preview on import or first open (`apps/photos/data.js` `previewSide`, from `th.p.settings`) |
| `photos.editor` | segments: the new editor / classic (Editor) | phone | `new` | `th/registry/apps.js` `landing()`: Photos' front page is the new editor's Library (`/lab/editor/`) from the ring, chips, tiles and `app.open`; classic lands on the shelf before (`/photos/`), whose Edit then opens the editor before |
| `photos.new_profile` | segments: Adobe Color / the camera's film simulation (Editor) | phone | `adobe-color` | the new editor, the first time a photo opens (`lab/editor/app/session.js`): its profile is set to Adobe Color when the owner's set has one, unless the setting says the film simulation; a photo opened before keeps its own |
| `photos.new_noise` | switch (Editor) | phone | `on` | the new editor, the first time a photo opens: Noise starts at what its ISO calls for (`session.js` `noiseStart`), or at 0 when off |
| `photos.new_auto` | switch (Editor) | phone | `off` | the new editor, the first time a photo opens: Auto is applied to its Light controls once it is drawn (`app/adjust.js` `auto`), as a step of its history |
| `photos.double_tap` | segments: 100 % / 200 % (Editor) | phone | `100` | the new editor's zoom (`lab/editor/app/zoom.js` `tapTo`): where a double-tap on the photo goes |
| `photos.offline` | switch (Editor) | phone | `on` | the new editor at start (`lab/editor/boot.js`): with a signal it asks the service worker to keep this release's editor (`sw.js` `keepEditor`, from `/lab/offline.json`), so it opens with none; off, or on a phone saving data, nothing is kept |
| `photos.demosaic` | segments: Best / Faster (Editor) | phone | `best` | the new editor's full-size view and export, from the next photo opened (`session.js` sets `meta.quick`; `lab/engine/demosaic.js` then runs the first look alone: about half the work, 0.3 dB less true on the engine's known photo) |
| `photos.neural` | switch (Editor) | phone | `on` | the sensor's colours by the network (`lab/engine/neural.js`): an export (`app/save.js`; if it fails on this phone the export is made the usual way and the network is left alone for a week), and from 100 % in, what shows, once the photo rests (`app/zoom.js` `finer`; from 200 % until the owner compared them on 2026-11-12 and found the network best) |
| `photos.haptics` | switch (Editor) | phone | `on` | the new editor's ticks under the finger (`lab/editor/app/haptic.js` `tick`, read at each tick): the dial passing its start or reaching an end (`boards/DialPlate.js`), the drum's face clicking into place (`boards/Drum.js`), Undo and Redo (`app/told.js`), an export done (`boards/ExportPlate.js`, `app/save.js`); off, or on a phone set to reduce motion, or with no vibration in the browser, nothing |
| `photos.export_size` | segments: full size / 2,048 / 1,080 px (Export) | worker | `2048` | the Export sheet, as the size it starts with (`apps/photos/edit/export.js`, from `th.p.settings`) |
| `photos.export_format` | segments: JPEG / HEIC where the phone writes it (Export) | worker | `jpeg` | the Export sheet, as the format it starts with; HEIC only where the browser encodes it, up to 2,048 px |
| `photos.keep` | segments: previews only / recent originals too (On this phone) | worker | `previews` | nothing yet: previews are kept on every phone; recent originals come with editing (P1c) |


Senses per app and error reports, then Keep conversations, then a read-only group, What leaves this phone, then Your data
with Export, which opens the Export page (§4.9) over this one: the weather
town (by name and as its coordinates, to Open-Meteo), the feed addresses of followed podcasts, and
nothing else. `th/senses/send.js` and the error reporter do not read the switches yet: a check on
the phone alone would only hold on the phone where it was switched, so the Worker's senses and
errors routes are the place to honour them.

| Key | Control | Scope | Default | Read by |
|---|---|---|---|---|
| `privacy.senses.music` | switch | worker | `on` | the phone's senses (`th/senses/send.js`, from `th.p.settings`) and `PUT /v1/senses/batches` (B1): off sends and keeps nothing of Music |
| `privacy.senses.podcasts` | switch | worker | `on` | the same, for Podcasts |
| `privacy.senses.guitar` | switch | worker | `on` | the same, for Guitar |
| `privacy.senses.study` | switch | worker | `on` | the same, for Study |
| `privacy.senses.photos` | switch | worker | `on` | the same, for Photos: imports, ratings and deletes, ids and formats only |
| `privacy.senses.media` | switch | worker | `on` | the same, for Astra and My Media (B1) |
| `privacy.senses.home` | switch | worker | `on` | the same, for home: lines seen, tiles and chips tapped, cards answered |
| `privacy.senses.shell` | switch | worker | `on` | the same, for the ring, the island, Music and Podcasts in front, settings changed (B1) |
| `privacy.errors` | switch | worker | `on` | exposed: `GET /v1/settings`; nothing reads it yet |
| `privacy.editor_timings` | switch (Reports) | phone | `on` | home passes the editor's timings on to the owner's storage (`th/workshop/timings.js`): how long an open, the full-size pixels, the first full-size view and an export took, with the decoder's start-up, as numbers and a few fixed words only, at most once in ten minutes, as `editor-timings.json` in the workshop's folder ([API.md §11.27](../engineering/API.md)) |
| `privacy.retention` | segments: forever / 1 year / 90 days (Conversations) | worker | `forever` | the prune pass, once a logical day (`areas/conversation/retention.ts`, [DATA.md §10](../engineering/DATA.md)): a conversation unchanged for longer is purged as a deleted one is, with a ledger row; one filed under a topic is kept; the owner's alone |

### 6.8 About and diagnostics (`about.js`)

Read-only, no catalogue keys: Release (the build, a preview's branch, the short commit from
`config.js`), Worker (`GET /v1/health`: its tag, or the first 8 characters of its version id),
Rows today (`GET /v1/ops/meter?days=1`: rows read and written since 00:00 UTC with their percentages
of the free plan's day), and the last Frames readout if the feel lab left one on this phone under
`th.lab.frames` (the lab does not store it yet; until then the row says how to record one).

### 6.9 Files for the workshop (`workshop.js`)

No catalogue keys. The owner sends a file of any kind to the agent that builds Thunderhead with
them: a RAW to test the editor on, a photo another app made to compare with
([API.md §11.27](../engineering/API.md)). Choose files picks any number; each goes to the owner's
private storage in pieces of 8 MiB, each with its SHA-256, each tried up to four times
(`workshop-send.js`), with a bar and a line saying how far it is; the screen is kept on while it
goes. A file that stopped part way says how many pieces are in, and the same file chosen again
sends only the rest. Below, what is there: the name, the size and the day, Remove (asked first),
and the room used of 4 GB. A file over 512 MB, or one there is no room for, is refused in words.
Files stay until the owner removes them. `/settings/workshop/` opens this page.
