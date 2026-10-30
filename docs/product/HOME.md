# Home

Home is the one screen the Thunderhead lives on: a quiet chat with a big italic voice line, a decision card when something needs the owner, the day's conversation sitting low, and a quiet ask bar.
This file specifies every element and state on it, with exact values and an acceptance check for each behaviour. Numbers come from the locked prototype (`proto/thunderhead-prototype.html`, v11) and the first build (`frontend/apps/home/`), unless marked **[proposal]**.
Sibling docs: [GESTURES](../design/GESTURES.md), [DESIGN-SYSTEM](../design/DESIGN-SYSTEM.md), [COPY](../design/COPY.md), [BRIEFING](BRIEFING.md), [MENU-AND-SETTINGS](MENU-AND-SETTINGS.md), [SIGN-IN](SIGN-IN.md), [mind BEHAVIOR](../mind/BEHAVIOR.md), [API](../engineering/API.md), [decisions](../process/decisions.md).

## Rules at a glance

1. **One screen** (owner ruling). Top to bottom: date line, voice line, decision card (only when one waits), today's conversation, hint (only while learning), ask bar. Nothing else. **No chips on home** except the action chip under a reply (§4.5).
2. The **voice line** says what matters in ≤ 2 short lines of Fraunces italic. "Nothing needs you." is the normal state, not an empty state.
3. A **decision** is one gold card with at most two buttons. Only one is shown at a time; the rest queue behind it.
4. The **conversation** is today's thread. It starts on its own each day (04:00, after 60 quiet minutes). The owner never starts, names or clears one (owner ruling).
5. The **ask bar** has no placeholder. `+` on the left folds up the options sheet; the mic on the right turns into send while typing (owner ruling).
6. **Presence is edge light** (owner ruling): calm glow, gold at the bottom when a decision waits, a pulse while thinking, brighter while listening.
7. **Everything works offline** that can: the last state paints from IndexedDB in < 1 s, messages queue with "Sends when you're back online".
8. **Nothing that needs the owner before 06:30** local (owner ruling): no new decisions shown, no sounds, no pushes in quiet hours.
9. Every gesture has a button equivalent ([GESTURES](../design/GESTURES.md) §9).

## 1. Layout

Measured in Chromium at 390×844 (the A15's CSS viewport is likely ~384×832, unverified).

| Element | Position and size | Scrolls? |
|---|---|---|
| Field + grain | Full screen, behind everything | No |
| Date line | `top: 14px`, left inset `max(24px, safe-area)`, Inter 600 11 px caps | No |
| Conversation column (`.convo`) | `top: 56px`, `bottom: 98px`, side padding 24 px, `flex-direction: column` with a growing spacer on top (min 40 px), so content sits **low** | Yes (vertical) |
| ↳ Voice line | First item after the spacer | With the column |
| ↳ Decision card | 18 px under the voice line | With the column |
| ↳ Turns | 22 px between turns (8 px before the first) | With the column |
| ↳ Hint | 22 px under the last item | With the column |
| Ask bar | `bottom: 24px + safe-area`, `left/right: max(16px, safe-area)`, 54 px tall | No |
| `+` sheet | Above the ask bar, `bottom: 90px + safe-area`, left 16 px, min-width 220 px | No |
| Edge light | Full-screen inset glow, above content, `pointer-events: none` | No |
| Toast | Centred, `top: 58px + safe-area` | No |

The app is at most **460 px** wide and centred on wider screens.

## 2. The voice line

### 2.1 What it says

The client chooses the line from state, top row first. Fixed lines are written in [COPY](../design/COPY.md); the mind can supply only the **second** line, through a `home.line` surface written by the night shift or a chat session.

| # | Situation | Line 1 | Line 2 |
|---|---|---|---|
| 1 | Signed out | (Home is replaced by sign-in, see [SIGN-IN](SIGN-IN.md)) | |
| 2 | First run: signed in, no message ever sent [proposal] | *I'm here.* | *Ask me anything, any time.* |
| 3 | The mind can't wake (Worker flag `mind_unavailable`, §4.4), and the Worker's "isn't waking" line isn't already in the thread | *I can't wake just now.* | *I'll answer when I'm back.* |
| 4 | 1 decision waiting, outside quiet hours | *One thing needs you.* | the `home.line` if any, else *The rest is handled.* |
| 5 | 2–9 decisions waiting | *Two things need you.* … *Nine things need you.* | same as row 4 |
| 6 | 10 or more decisions waiting | *Many things need you.* | same as row 4 |
| 7 | A `home.line` exists for today, nothing waiting | *Nothing needs you.* | the `home.line` (e.g. *Your new playlist is in Music.*) |
| 8 | Just answered the last decision (shown for the rest of the session) | *Nothing needs you now.* | the `home.line`, else none. After "yes": *Everything is handled.* |
| 9 | Quiet hours, nothing waiting [proposal] | *Nothing needs you.* | *It can all wait until morning.* |
| 10 | Default | *Nothing needs you.* | none |
| 11 | The owner said "go quiet" ([BEHAVIOR.md §8](../mind/BEHAVIOR.md#8-go-quiet)); ahead of every row but 3 | *Quiet until 06:30.* (*Quiet until Monday 06:30.* over a day away) | *I'll hold everything until then.* |

States that **do not** change the voice line:

| State | Shown instead |
|---|---|
| Thinking (a reply is on its way) | The edge pulse and the reply placeholder (§4.4) |
| Mind asleep (no session running) | Nothing. This is the normal state; the Worker and the instant tier answer what they can. |
| Mind waking (fire sent, not claimed yet) | "Waking up…" in the reply slot (§4.4) |
| Offline | "· Offline" after the date (§9); the line keeps its last value |
| Typing in the ask bar | Nothing; a pending line change waits (§2.3) |

### 2.2 Length limits

Measured: the voice line fits **22 characters per visual line** at every phone width (360–412 px), because its size scales with width (`clamp(32px, 9vw, 40px)`).

| Part | Limit | Enforced by |
|---|---|---|
| Line 1 | ≤ **22** characters (one visual line). All fixed line-1 strings fit. | COPY table test |
| Line 2 | ≤ **44** characters (≤ 2 visual lines) | The Worker rejects a longer `home.line` (422) |
| Whole line | ≤ **3** visual lines at 360 px | Browser test: `#say` height ≤ 3 × line-height |
| Words | No exclamation marks, no emoji, no counts of other people, ends with a full stop | Worker validation + mind evals |
| Language | The owner's language of the day; second-language lines get `lang` set to that language's code (a private setting) | Surface field `lang` |

### 2.3 When and how it changes

1. It is computed on load, on every live update (WebSocket), on `visibilitychange → visible`, and on a decision being answered.
2. **Debounce:** at most one change every **10 s**, except row 4–8 transitions caused by the owner's own tap, which change at once, and the end of the first-run line when the owner sends the first message (built). [proposal]
3. **Never while typing:** if the ask bar has text or focus, a pending change waits until the input is empty and blurred for 2 s. [proposal]
4. **Change animation:** the old line fades to opacity 0 over **400 ms**; at **320 ms** the new spans replace it and play `rise`: from `opacity 0; translateY(10px); blur(4px)` to rest over **900 ms** `cubic-bezier(.2,.7,.2,1)`, line 2 delayed **160 ms**. Haptic: none.
5. **On cold start and the first open of the day** the line plays `rise` once. Returning to the app within the same day shows it instantly (no animation).
6. Reduced motion: instant swap, no rise.

Acceptance: a test sets 0, 1, 3 and 12 pending decisions through a mocked live channel and asserts the exact text of `#say` for each, that a `home.line` of 45 characters is rejected by the Worker, and that `#say` height ≤ 3 lines at 360 px for every fixed string.

## 3. The decision card

A decision is a proposal or question from the mind that needs the owner's answer (data model: [API](../engineering/API.md), `proposals`). Ask-first classes (delete, money, access, reaching other people) are approved by a tap on this card on a signed-in device, or by the owner's own words in the conversation, which the Worker verifies (owner ruling; [BEHAVIOR](../mind/BEHAVIOR.md) §4).

### 3.1 Anatomy

| Part | Content | Limit |
|---|---|---|
| Why line | Gold dot · `<source> · <reason>`, Inter 500 12, `--ink-3`. For ask-first classes, the class label is appended: "Can't be undone", "Costs money", "Changes access", "Reaches someone else". With more than one waiting: "1 of 3" right-aligned [proposal]. | ≤ 60 characters before the class label |
| Question | Inter 500 16/1.42, `--ink`. A plain question that can be answered yes or no. | ≤ 80 characters |
| Target | Inter 500 13, `--ink-2`, under the question: what a Yes changes, in the Worker's words, never the mind's ("key ci-deploy (CI)", "preference: Likes calm music in the evening"), so a question worded otherwise can't hide it (P4 stage A.5). | the Worker's line |
| Yes button | Gold fill, `--gold-ink` text, Inter 600 14. Label from the proposal (e.g. "Yes, take it"). | ≤ 18 characters |
| Secondary button | Neutral. Either **"Not yet"** (snooze) or **"No"** (reject), as the proposal's `safe` says; the label never comes from the proposal's words. | fixed |

### 3.2 States and behaviour

| State | Looks like | Happens when |
|---|---|---|
| Rising | `rise` 800 ms after a 300 ms delay (it follows the voice line); its buttons take a tap only 500 ms after the rise ends, so a tap never lands on a card the owner hasn't seen | First render of a waiting decision |
| Waiting | Card visible; bottom edge turns gold (§7) | Proposal `status=waiting` and not inside quiet hours |
| Deciding | Pressed button shows a 16 px spinner; both buttons disabled | Tap sent, waiting for the Worker (timeout 15 s) |
| Folded | Opacity 0, scale .97, height and padding → 0 over **450 ms** (+120 ms delay); removed at 650 ms | Worker confirmed |
| Error | Card stays; a line under the buttons: "Didn't go through. Try again." (`--alarm`); buttons re-enabled; haptic `[30,60,30]` | Worker error or timeout |
| Offline | Buttons look normal; a tap shows the toast "Needs a connection. Nothing was decided." and nothing else | No network |
| Expired | Folds as above; toast "That one expired. Nothing was done." | `expires` passes while visible |

**Yes:** sends the approval with the device's session. On success: the card folds; the gold edge fades over 1.4 s (unless another decision waits); the voice line moves to row 8; a toast shows the proposal's confirmation line in the mind's words (e.g. "I'll run that job tonight.", ≤ 40 characters); haptic `[12,40,12]`. The action itself runs on the server (ledger entry with its undo where one exists).

**Not yet:** snoozes. The proposal comes back the next day at the first open after 06:30, at most **3** times, then it expires. Toast: "I'll ask again tomorrow."

**No:** rejects. Nothing is done. Toast: "Okay. I won't." The mind sees the rejection in its next briefing.

Answering in chat ("no, don't") can **reject** or snooze a decision (the mind calls reject); it approves an ask-first one only when the owner's words clearly answer this card and the Worker verifies them (`th decide --by-message`, [BEHAVIOR](../mind/BEHAVIOR.md) §4 rule 4); otherwise the card stays.

### 3.3 Several decisions

1. Only **one card** is visible (one gold element at a time).
2. Order: soonest `expires` first, then oldest `at`.
3. After one is answered, the next rises **300 ms** after the fold finishes, never sooner (not even when the feed brings the list back first), so a second tap of the same finger lands on nothing.
4. The voice line counts all waiting decisions (rows 4–6).

### 3.4 Expiry and quiet hours

- Every decision has an `expires`: **7 days** after creation ([BEHAVIOR](../mind/BEHAVIOR.md) §3.5, [API](../engineering/API.md) §11.10).
- Decisions created during quiet hours are **held**: not shown, no gold edge, no push, until the first open after 06:30 (or 06:30 itself for the push). A decision already visible before quiet hours began stays visible.

### 3.5 Finding the card

When a decision waits but the card is scrolled out of view, the date line gains a gold-text suffix "· 1 waiting" (44 px tall hit area); tapping it scrolls the card into view and pulses its border once (300 ms). The briefing's "Waiting on you" tile does the same from the briefing. (Built in P4 stage B: `frontend/th/decide/card.js`, its logic in `model.js` with `tests/decide-logic.test.mjs`, the browser checks in `tests/decide-browser.test.mjs`. The why line's source is "From our chat", "Night shift", "Watchdog" or "Safety check" (the Worker's own cards, such as the laws pin); the card also shows the proposal's why, its odds and what happens if ignored, in small type under the question. Yes toasts "Done." and, if the Worker's executor refused, "That didn't work. Nothing changed.")

Acceptance: with two mocked proposals, the first card shows "1 of 2"; tapping Yes calls the approve endpoint once, folds within 700 ms, and the second card appears; with the network offline the tap shows the toast and makes no request.

## 4. The conversation

### 4.1 What is shown

- Today's thread only, from the last day roll. Older days live in the menu ([MENU-AND-SETTINGS](MENU-AND-SETTINGS.md)).
- Rendered from IndexedDB first, then reconciled with the server. The last **40 turns** are rendered; scrolling to the top loads 40 more (instant from cache, then server).
- Above the first message of today, once scrolled to the very top: a quiet line "Earlier conversations are in the menu" (Inter 12, `--ink-3`) [proposal].

### 4.2 Owner messages

- Glass bubble on the right: max-width 80%, padding 9/14, radius 19 19 6 19, Inter 400 15/1.4.
- Text is shown exactly as typed (`textContent`, line breaks kept). Never parsed as markup.
- A meta line under the bubble (Inter 12, `--ink-3`) appears only when something is not normal:

| Meta | When |
|---|---|
| (none) | Sent and acknowledged |
| "Sending…" | Not acknowledged after 2 s |
| "Sends when you're back online" (with a clock icon) | Queued in the outbox while offline |
| "Didn't send · **Retry**" (`--alarm`, Retry is a 44 px text button) | Three automatic retries failed (2 s, 5 s, 15 s) or a non-retryable error |
| "Too long to send" | Over the length limit (§6.3) |

### 4.3 The mind's replies

- **Upright** Fraunces 400, 17.5/1.5, `--ink`, left-aligned, no bubble, `text-wrap: pretty` (owner, 2026-10-30: "the Thunderhead text is always italic"; replies were italic 340 at 20/1.4). Serif still means the Thunderhead said it; italic is kept for his short lines (the voice line) and, inside a reply, for emphasis and quotes.
- **Rich text** (`th/chat/rich.js`, the same on home and in an older conversation): `###` headings (600, 18.5), "- " "• " "* " "– " bullets shown with an en dash, "1. " numbered lists, "> " quotes (italic, a thin accent rule), **bold** (600), *italic*, `code` and fenced code (monospace), `| tables |` (Inter 14: data reads in Inter), `---` rules, `https://` links and cited blocks of the owner's books. Lines without a blank line between them stay one paragraph, broken where they were; a "– " straight after a full stop, question mark or colon starts a list item, so a list never runs into the sentence before it. Text is set as text, never markup.
- **Shown, not only told:** a reply may carry up to four of the Board's blocks in `meta.blocks` (stats, chart, timeline, comparison, agenda, explanation, callout; [BRIEFING](BRIEFING.md) §5), drawn under the words by the Board's own code, in Inter, loaded only when a reply has them. The mind finds the format in `th help say`. It does not choose fonts: one set of type styles keeps the voice consistent.
- **Links:** underlined, `--accent-text`, open in a new tab with `rel="noopener noreferrer"`. Only `https:` URLs become links. Long URLs show the host plus "…".
- **Length:** the mind's default is ≤ 3 sentences ([COPY](../design/COPY.md)). The **latest** reply is always shown in full. Older replies taller than **14 lines** collapse to 10 lines with a fade and a "Show all" text button [proposal].
- Copy: long-press → "Copy" ([GESTURES](../design/GESTURES.md) §5).

### 4.4 A reply's life

| Time after send | Shown in the reply slot | Edge |
|---|---|---|
| 0 | The owner bubble rises (500 ms). Hint fades out for the session. | starts `think` pulse |
| 0–1.2 s | Nothing yet (most instant-tier answers land here) | think |
| ≥ 1.2 s | **Thinking words** (owner, 2026-10-30), Inter 500 14 in `--ink-3` with a light passing across them every 2.6 s, each new line fading in: the mind's own note while it works (`th status working --note "<3-6 words>"`, ROLES.md chat step 1), else words from what the owner asked ("Thinking about your music…", "…guitar…", "…your books…", "…your day…", "Thinking back…", or "Thinking…"), then "Working it out…" and "Putting it together…", 3 s each, the last staying. Reduced motion: no light, no fade (`model.thinking`) | think |
| ≥ 8 s and the session has not claimed the wake | "Waking up…" (Inter 13, `--ink-3`) | think |
| ≥ 60 s, still unclaimed | "Still waking. This can take a minute." | think |
| 240 s, still unclaimed | The Worker posts a system line: "The mind isn't waking (likely a usage limit or an outage). I'll answer when it's back." While that line stands in the thread with no reply after it, the voice line keeps its usual row: it never says the same thing twice. Row 3 shows when the mind can't wake and the thread doesn't say so (opening home during the back-off). | error (§7) |
| Reply arrives | Text reveals (§4.4.1); then any action chip fades in (400 ms) | back to calm |

The wake timings come from the mind's loop: the page fires a pre-warm on the first keystroke, the Worker retries an unclaimed fire once at 120 s and gives up at 240 s ([RUNTIME](../mind/RUNTIME.md)). Cold replies are expected to take 20–60 s and are not yet measured.

**Reveal.** The reply is delivered whole (the mind posts complete messages; there is no token streaming). The client reveals it at **160 characters per second**, capped at **1.2 s** total (longer replies reveal faster), then shows it all. The first build reveals 2 characters per animation frame, which is 180 per second on the A15's 90 Hz screen and frame-rate dependent. [proposal: time-based]. Reduced motion: no reveal. A screen reader gets the whole reply at once (`aria-live="polite"` on the turns list, text set in one go, the visual reveal done with a clip mask, not by changing the text).

**Stop (built, P2).** While the mind works on an answer (presence `working`), the reply slot carries a quiet **Stop** text button (Inter 13, accent, 44 px hit area) beside the "…". A tap sends `POST /v1/mind/stop`; the slot reads "Stopping…" until the mind's reply ("Stopped. Done: … Not done: …", [BEHAVIOR.md](../mind/BEHAVIOR.md)). Stop ends the work, not the session. The ask bar does not change.

**Not connected yet (built, P2).** Until the owner connects the mind-chat task (SETUP.md K), the reply slot reads "Saved. I'll answer once I'm connected." instead of the waking lines, and the edge stays calm; messages wait and are answered once a session runs.

**Progress posts.** For long work the mind may post a short status ("On it. About 5 minutes.") and keep working. The edge keeps pulsing while the session reports `working`, for at most **30 min**, then returns to calm. [proposal]

### 4.5 Action chips under replies

- A reply may carry **one** action chip (prototype v11). It is the only chip on home.
- Glass chip: 17 px app-coloured icon + label (Inter 500 14), ≤ 28 characters, e.g. "Open in Music", "Open bars 9–12".
- Tap runs a verb on the phone (open an app at a place). It fades in 400 ms after the reply finishes revealing.
- If the verb's app is not available yet: toast "That app isn't here yet."
- Action chips in filed conversations still work.

### 4.6 Attachments

| Kind | In the owner bubble |
|---|---|
| Photo | Thumbnails above the text, 2 columns, 120 px tall, radius 14. At most 4 attachments per message; the picker stops at 4. |
| File | A row: file icon, name (ellipsis), size ("2.4 MB") |
| Voice memo | A row: play button, waveform, duration ("0:42") |
| Uploading | A 2 px progress ring on the thumbnail / row icon |
| Failed upload | The bubble's meta: "Didn't send · Retry" |

Attachments go to private storage behind sign-in (R2 `thunderhead-private`), never to the public repo, and are shown through short-lived signed links (decisions.md). Photos are resized on the phone to **2,048 px** on the long edge, JPEG quality 0.85, with location data stripped [proposal].

### 4.7 Offline outbox

1. A message sent offline is written to the IndexedDB outbox at once and shown with "Sends when you're back online". It is drawn before the ask bar empties, one outbox key per message; if IndexedDB can't write, the message still sends from memory.
2. On `online`, on `visibilitychange → visible`, and through Background Sync where Chrome allows, the outbox sends in order, one message at a time; a message waiting on a retry holds the ones after it, and a failed one waits for Retry without holding them. Each has a client id, so a retry never duplicates. A queued or failed message shows only its meta line: no reply slot under it.
3. On acknowledgement the meta disappears.
4. If the day rolled while a message waited, it is filed into the thread whose day matches the message's own time if that thread is still open, otherwise into today's thread with the meta "Written yesterday, 23:40" [proposal].
5. Limits: 200 queued messages or 20 MB of attachments; beyond that, the send button shows the toast "Too much waiting to send. Connect to send the rest." [proposal]

### 4.8 Scrolling

- New owner messages always scroll to the bottom.
- A new reply scrolls to the bottom only if the owner is within **80 px** of the bottom; otherwise a small "New reply ↓" pill appears 8 px above the ask bar, and tapping it scrolls down [proposal].
- Returning from an app restores the exact scroll position. Returning after **≥ 30 min** away scrolls to the bottom.
- `overscroll-behavior: contain`; no scrollbar is drawn.

### 4.9 Viewing an older conversation

Opened from the menu (prototype v11; built, `frontend/th/convos/past.js`). The thread loads its newest 200 messages, with "Show earlier" above for the rest; a search hit further back is found by reading back up to 1,000. Messages show as on home, without chips, Retry or Stop. If it can't load, a line says why with **Retry** ("You're offline. This conversation shows once you're back." offline).

- The voice line and the decision card hide. A glass card at the top of the column holds the title (two lines at most), "<when> · <N> messages" under it (the day left out when the title is the day; an imported one tagged gold "Old Chats"), and a **Back to now** button (accent fill, Inter 600 12).
- The mind's short replies keep the voice. A reply of an imported old chat, one of 280 characters or more, or one written in Markdown reads as text instead (Inter 16, `frontend/th/convos/prose.js`): headings, bullet and numbered lists, bold, `code`, fenced code, tables and https links, built as elements with text only.
- The filed thread shows read-only, scrolled to the bottom (or to the search hit, highlighted for 2 s).
- Typing and sending returns to now first, then sends.
- Back, the pill's button, or a menu tap on "Now" returns to today.

### 4.10 The daily split

Decided: the day rolls at **04:00 local**, but only after **60 quiet minutes** (no message from either side). A new conversation starts; the old one is filed and titled automatically.

| Owner's view | What they see |
|---|---|
| App closed through the roll | Next open: an empty column with the voice line (the night shift's line if ready). Yesterday is the top row under "Yesterday" in the menu, with a provisional title. |
| App open and idle at the roll | The turns fade out over 300 ms, the voice line re-rises, the date updates. No toast. |
| Mid-conversation at 04:00 | Nothing: the roll waits until 60 quiet minutes have passed. |
| First three days after first run | Once, under the voice line on the first open after a roll: "Yesterday is filed in the menu." (Inter 12, `--ink-3`) [proposal] |

Memory carries context across days ([MEMORY](../mind/MEMORY.md)); the owner never has to repeat themselves.

Acceptance: with a mocked clock, a thread with its last message at 03:30 rolls at 04:30, not 04:00; a message at 04:20 pushes the roll to 05:20; after the roll, home shows no turns and the menu lists the old thread under "Yesterday".

## 5. Edge cases in the conversation

| Case | Behaviour |
|---|---|
| Owner sends while a reply is pending | Allowed. Both messages go to the mind together; one reply may answer both. |
| Two devices | Messages sync through the live channel within 1 s; the outbox on each device is independent. |
| The same message arrives twice | Deduped by client id; shown once. |
| Reply arrives while viewing a filed conversation | Not shown there; the "Back to now" button gets a small accent dot [proposal]. |
| Reply contains a link to the app itself | Rendered as an action chip if the mind supplied one, else as a plain link. |
| Message from the Worker (system) | Inter 13, `--ink-3`, centred, no bubble; e.g. the not-waking line, "New sign-in on another device · Sign it out" ([SIGN-IN](SIGN-IN.md)). |

## 6. The ask bar

### 6.1 Anatomy

| Part | Values |
|---|---|
| Bar | 54 px tall pill, radius 27, live glass (`--bar`, blur 18 px saturate 1.6), 1 px `--bar-line`, E2 shadow; padding-left 7 px; gap 6 px |
| `+` | 40 px disc (44 px hit area), `--tint` fill, 20 px plus icon, `--ink-2`. Rotates 45° (into an ×) while the sheet is open, 320 ms `--ease-pop`. `aria-expanded` mirrors the sheet. |
| Input | Inter 16, `--ink`, no border, no placeholder (owner ruling), `aria-label="Message the Thunderhead"`. [proposal] An auto-growing `<textarea>` up to **6 lines**, the bar growing upward (max 160 px), `enterkeyhint="send"`. |
| Mic / send slot | 42 px; the mic (`--ink-2`, no fill) and send (accent fill, white arrow-up) share it. While the input has non-space text, send scales in (220 ms `--ease-pop`) and the mic scales out. |

### 6.2 The `+` sheet

Folds up out of the bar like iMessage (owner ruling): scales from 0.5 at its bottom-left corner with `transform .34s cubic-bezier(.34,1.3,.64,1)`; items fade up bottom-first, 28 ms apart. While it is open the conversation blurs (8 px) and fades to 30%.

| Item (top to bottom) | Icon colour | Does |
|---|---|---|
| **Camera** | `#8b5cf6` | Opens the phone's camera app through `<input type="file" accept="image/*" capture="environment">`. The photo comes back as an attachment preview in the bar (40 px thumbnail with ×). The camera is used only for that one photo (ears and eyes only when switched on). |
| **Photos** | `#2f7df6` | Opens Android's photo picker (`accept="image/*" multiple`), up to 4 photos. |
| **Files** | `#14a39a` | Opens the file picker (any type), up to 4 files, ≤ **25 MB** each [proposal]. |
| **Voice memo** | `#e0457b` | Turns the bar into a recording strip: pink dot, timer, live level bars, **Stop** (send-slot) and **×** (cancel, in the `+` slot). Stop attaches the audio (Opus in WebM) to the next message; the owner can add text and send. Max **10 min**; at 9:30 the timer turns `--alarm`. The Worker transcribes it so the mind can read it; the audio is kept with the message. |
| **Remind me** | `#e08a1e` | Opens a small sheet: "What" (prefilled with the bar's text), then **In 1 hour** · **This evening** (19:00; hidden after 18:30) · **Tomorrow morning** (08:00) · **Pick a time**. Saving creates a reminder (a reversible action with undo). Toast: "I'll remind you at 19:00." At that time: a push (not counted against the push budget) and a line in the conversation. A time inside quiet hours moves to 06:30, and the toast says so. |

Closing: tap `+` again, tap anywhere outside, pick an item, Back, or Escape. Before sign-in, every item shows its "comes with sign-in" toast (first build).

### 6.3 Sending

- Send by the send button, the keyboard's Send/Enter key, or Ctrl/Cmd+Enter on a hardware keyboard (Shift+Enter is a new line).
- Whitespace-only input never sends.
- Limit: **8,000 characters** [proposal]. From 7,500 a counter "500 left" shows at the bar's top-right; over the limit send is disabled and the toast reads "Too long to send. Try sending it as a file."
- On send: the input clears, the bubble appears at once (optimistic), haptic none (typing is not a gesture).
- Pre-warm: the first keystroke after ≥ 90 s of no typing tells the Worker the owner is typing, so the mind can start waking ([RUNTIME](../mind/RUNTIME.md)). No text is sent with it.

### 6.4 The mic (dictation)

Decided: ears work only when the owner switches them on.

| State | Looks like | Notes |
|---|---|---|
| Off | Mic icon, `--ink-2` | |
| Listening | Mic button filled `--accent-fill`, white icon; input shows the placeholder "Listening…" in accent (the one placeholder the bar ever shows); edge light **listening**; haptic 18 ms | Toast: "Listening. Tap again to stop" |
| Transcribing [proposal] | Spinner in the mic slot; "…" in the input | On-device speech recognition only ([PRIVACY](../engineering/PRIVACY.md) §7.7); if the phone can't, the mic records a voice memo instead and says so |
| Done | The text lands in the input for the owner to check and send | Toast on stop: "Stopped. Nothing is kept unless you send it" |

Limits and rules:

- Max **120 s** per take; at 120 s it stops by itself (haptic 8 ms).
- A take under **0.6 s** is discarded with the toast "Too short. Nothing was kept."
- Leaving the page, locking the phone or opening another app **stops** listening immediately.
- Permission denied: toast "The mic is blocked. Allow it in Chrome's site settings." The mic stays visible.
- Offline: tap shows "Voice needs a connection. Voice memos work offline." Nothing records.
- Phase: speech-to-text is a later phase (Workers AI voice was deferred for v1); until it ships, tapping the mic does not listen; it shows the toast "Voice comes later. Type for now." [proposal] (The first build lights the listening state as a demo; that goes once sign-in ships.)

### 6.5 Keyboard on Android

- The viewport meta includes `interactive-widget=resizes-content`, so the layout shrinks above the keyboard and the ask bar stays visible, 24 px above the keyboard (to verify on the A15).
- When the keyboard opens, the conversation keeps its bottom anchored (the latest turn stays visible).
- Tapping empty space closes the keyboard (blurs the input). The ring does not open while the keyboard is up.
- System Back closes the keyboard first.
- The input never auto-focuses on load (the keyboard would cover the voice line). It focuses after "Ask about this" and after picking Remind me.

Acceptance: in Playwright with a mobile Chrome emulation, typing "hello" swaps mic → send within 250 ms; Enter sends; the input is empty afterwards; `#q` has no `placeholder` attribute except while listening.

## 7. Edge light

The Thunderhead's presence (owner ruling): light rising from the **bottom** of the screen, behind the ask bar (owner, 2026-10-30: "the pulsing is too much. It should only be at bottom"; it was an inset glow on all four edges with a 1.5 s pulse). One layer `#edge`, the bottom 40% of the screen, `pointer-events: none`, above the conversation (z 6), with two bands: the **glow** (`::after`, its colour by state) and the **gold** (`::before`) under it while a card waits, so the gold stays under a thinking pulse. Each band is a radial gradient from the bottom centre; only their opacity animates, so the compositor moves them and nothing is repainted (the old box-shadow pulse repainted the whole screen every frame).

| State | Glow | Gold | Motion |
|---|---|---|---|
| **Calm** | `--glow` at 30%, opacity .6 | off | steady |
| **Gold** (a card waits) | opacity .3 | `--gold` at 38%, opacity 1 | steady |
| **Thinking** | `--glow` | as it was | `think`: opacity .45 ↔ 1 over **3.2 s**, ease-in-out |
| **Listening** | `--glow`, opacity 1 | as it was | steady |
| **Error** | `#ff6b5e`, opacity .8 | as it was | steady |
| **Offline** | opacity .2 | as it was | steady |

- Changes between states crossfade over **1.4 s** (opacity, and the glow's colour through the registered `--edge-c`).
- **Priority** when several apply: listening > thinking > error > calm; **gold** is drawn under all of them whenever a decision is shown.
- Error is shown while: the mind can't wake, the session is signed out, or a message failed to send (until retried or 60 s pass).
- Reduced motion: no pulse; thinking shows a steady .85.

Acceptance: the state classes on `#edge` per state (mocked, `tests/chat-browser.test.mjs`); with reduced motion nothing on home animates (`tests/shell-look-browser.test.mjs`).

## 8. Day and night

- Settings → Appearance: **Auto · Day · Night** (owner ruling: a day theme and a pure-black night theme).
- **Auto** follows the clock: night from **19:00 to 07:00** local (`ui/theme.js`, built). It is set before first paint, so night never flashes white.
- Auto re-checks every minute while visible and on `visibilitychange`; a change crossfades the field over 600 ms [proposal: built only checks at load].
- Day or Night stick until changed. The choice is kept in `localStorage` (`th-theme`) on this device [proposal: also sync it to the account so a new device starts with it].
- `theme-color` follows the theme (`#eef1f7` / `#000000`).
- [proposal] Auto by sunrise and sunset at the weather location, once the briefing knows it.

## 9. The date line

- Top-left, Inter 600 11 px, uppercase, +0.14em, `--ink-3`.
- `toLocaleDateString(undefined, {weekday: 'short', day: 'numeric', month: 'short'})` in the phone's locale, e.g. "TUE, 28 OCT".
- Updates at local midnight and on `visibilitychange`.
- Suffixes, in this order, separated by " · ": **"1 waiting"** (gold text, when the card is off-screen; §3.5) and **"Offline"** (when there is no connection).
- It is a calendar date. The conversation's day rolls at 04:00, so between midnight and the roll the date reads tomorrow's date while yesterday's thread is still open; this is accepted.

## 10. The hint

- "Hold for apps · swipe for more", with a 14 px ring icon, Inter 500 12, `--ink-3`, 22 px under the last item, rises 600 ms after load.
- Shown until the owner has opened the ring **3** times and opened both the briefing and the menu once by swiping [proposal]. Counters are kept per device.
- Hidden for the session once the owner sends a message or opens the ring.
- Settings → About → "Show gesture hints again" resets the counters.

## 11. Whole-screen states

| State | What home shows |
|---|---|
| **Cold start, cache present** | Paints from IndexedDB within 1 s on the A15 (warm start budget). Voice line rises; edge calm. Live data reconciles silently: changes under 400 ms after paint are applied without animation. |
| **Cold start, no cache** (first visit after sign-in) | Field, date, voice line row 2, hint, ask bar. No skeletons; the voice line never shows a skeleton. |
| **Loading older turns** | Nothing visible; they appear above. |
| **Offline** | Last state; "· Offline" on the date line; edge offline; messages queue (§4.7); decisions can't be answered (§3.2); the briefing shows its cached tiles with "as of" times. |
| **Server error** (5xx, timeout) | Same as offline for sending (auto-retry); a toast only when the owner's own action failed. |
| **Signed out or token rejected** | Sign-in replaces home ([SIGN-IN](SIGN-IN.md)). Queued outbox messages stay and send after sign-in. |
| **Mind can't wake** | Voice line row 3, error edge, system line in the conversation (§4.4). The instant tier still answers what it can. |
| **Quiet hours** | Voice line row 9 if nothing waits; new decisions held; no sounds; the page itself works normally. |
| **Update ready** | Nothing visible. The new version applies only when it is safe (nothing playing, ask bar empty, on home or an idle app), behind a 150 ms fade. |
| **404 / unknown path** | `404.html`: "Nothing here." and a "Back home" link. |

## 12. Opening apps from home

- From the ring ([GESTURES](../design/GESTURES.md) §3), an action chip, or a plain request in the chat.
- **Plain requests** (owner ruling 2026-10-27): the chat opens apps and completes requests from normal text. "An anime I'd like, 20 min, under 200 MB" → the mind picks a fitting title from the Astra add-ons using past favourites and opens it in Astra; the owner picks the stream ([ASTRA](apps/ASTRA.md) §4). "A nostalgic playlist" → the mind builds it in the Music player and sends the owner there ([MUSIC](apps/MUSIC.md) §4.2). The reply carries the action chip; anything an app can't do yet is said plainly.
- The ported apps (Music, Guitar, Podcasts, Astra, My Media) first open **as they are**, each at its own page (owner ruling 2026-10-28). Later, only if the owner agrees, an app module loads lazily into the shell (decisions.md), so audio keeps playing. [proposal] The chosen ring bubble morphs into the app's header icon with a same-document View Transition (`view-transition-name`), 300 ms; Astra, which is its own page at `/astra/`, uses a cross-document transition.
- While the module loads (> 400 ms), the bubble's icon pulses once; on failure: toast "Couldn't open Music. Try again." and home stays.
- Back from the app's root returns to home at the same scroll position.

## 13. Accessibility

| Need | How |
|---|---|
| Ring, briefing, menu without gestures | Visually hidden "Apps", "Briefing", "Menu" buttons first in the focus order ([GESTURES](../design/GESTURES.md) §9) |
| Opening an app announced | `aria-live`: "Opening Music" |
| New replies announced | Turns list is `aria-live="polite"`; each reply is announced once, whole |
| Voice line changes announced | `#say` is `role="status"` [proposal]; announced only on change, not on load |
| Decision card | `role="group"` with `aria-labelledby` the question; buttons are real `<button>`s |
| Edge light meaning | Never the only signal: gold ↔ the card and voice line; thinking ↔ the reply placeholder; listening ↔ the mic state; error ↔ text |
| Targets | All ≥ 44 px hit areas |
| Focus | `:focus-visible` 2 px `--accent-fill` outline, offset 2 px; focus returns to the opener when a sheet closes |
| Text size | rem-based type follows Android's font size; layout tested at 200% |
| Motion | [DESIGN-SYSTEM](../design/DESIGN-SYSTEM.md) §8.4; "Still background" setting |

## 14. Acceptance summary

| # | Check |
|---|---|
| H1 | Every fixed voice line in [COPY](../design/COPY.md) fits ≤ 3 visual lines at 360 px and line 1 ≤ 22 characters |
| H2 | Voice line text matches §2.1 for each mocked state |
| H3 | Decision: yes / not yet / no / error / offline / expiry flows as §3.2 |
| H4 | Reply lifecycle: "…" at 1.2 s, "Waking up…" at 8 s, the honest line at 240 s (mocked clock) |
| H5 | Offline send → meta → reconnect → sent once (no duplicate) |
| H6 | Day roll timing with a mocked clock (§4.10) |
| H7 | `+` sheet opens/closes by each route in §6.2; conversation blurs while open |
| H8 | Mic: listening state, 120 s auto-stop, < 0.6 s discard, stops on `visibilitychange` |
| H9 | Edge light values per state; paused when hidden; static under reduced motion |
| H10 | Axe: no violations on home in day and night |
| H11 | Warm start to interactive ≤ 1.0 s on the A15 (device check) |

## Open questions / tests

| Question | How to settle it |
|---|---|
| "No chips on home" vs the prototype's one action chip under a reply. This doc keeps the reply chip (max one). | Owner confirms. |
| Is a 72 h default expiry right for decisions? | Look at how long real decisions wait in the first month; set the default at the 90th percentile. |
| Cold-reply latency (estimated 20–60 s) and the "Waking up…" timings | Measure 10+ cold wakes (mind research test 1) and tune 8 s / 60 s. |
| Does `interactive-widget=resizes-content` keep the bar above the keyboard in the installed app on the A15? | Device test. |
| Should the night shift's home line rotate during the day (several lines) or stay one line? This doc allows one per day. | Owner preference after a week. |
| Speech-to-text: Workers AI Whisper (free tier) vs Chrome's on-device recognition | Test both on the A15 for English and second-language accuracy; on-device keeps audio on the phone. |
