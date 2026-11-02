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

## 4. Settings pages

### 4.1 Appearance

The top group starts with a live reply-bubble and row preview. Theme (Auto, Day, Night) and Text
size (Smaller, Default, Larger) use segments; Still background uses a switch. They update the
preview and shell immediately and keep the existing local preferences. Larger remains 18.5 px
on replies. Auto still follows the existing clock rules. About remains a group at the bottom
of Settings, with the running short commit and Check for update.

Navigation order: Quiet hours, Notifications, What I remember, Password, Devices, Export,
Recently deleted. Connected apps stays hidden until it has a working surface.

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
and the shared-control contract across every Settings route and the menu in both themes.
They reject native selects and unstyled checks/radios, require primitive classes and rows at
least 44 px high, and verify 18.5 px large replies, live preview and the fixed header hairline.

Visual inspection uses real Switzer at 390×844. Before/after timing is recorded from Chromium
traces because Task A's readout is not in the base revision. Host Chromium measurements are not
Galaxy A15 measurements; device judgment and final feel tuning remain with the owner.
