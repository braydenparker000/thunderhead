# Gestures

This is the complete touch grammar of the Thunderhead: what each gesture does, its exact thresholds, how it gets along with Android's own back and home gestures, and how to test it.
If a gesture is not in this file, the app does not have it. Every gesture also has a non-gesture route (§9).
Sibling docs: [HOME](../product/HOME.md), [BRIEFING](../product/BRIEFING.md), [MENU-AND-SETTINGS](../product/MENU-AND-SETTINGS.md), [DESIGN-SYSTEM](DESIGN-SYSTEM.md), [COPY](COPY.md), [decisions](../process/decisions.md).

## Rules at a glance

1. Six gestures, no more: **tap**, **hold** (Compass ring), **horizontal swipe** (briefing / menu), **vertical scroll**, **long-press on an item** ("Ask about this"), and **system Back**.
2. One pointer at a time. A second finger cancels whatever the first finger started, silently.
3. **Hold 220 ms** without moving more than **10 px** opens the ring. Moving more than 10 px first makes it a swipe or a scroll.
4. Every scroller on home (the conversation, the Briefing, the menu) is `touch-action: pan-y` as well as `.app`: Chrome lets a scroller pan sideways again inside a pan-y parent, which handed sideways drags to Chrome (a `pointercancel`) and cost swipes and row actions (found 2026-10-30). A move is **horizontal**, a swipe, once it is **6 px** from the start with `|dx| > |dy|` (within 45° of horizontal): the same split Chrome makes under `touch-action: pan-y`, and before Chrome's own slop (8 dp), so a thumb that arcs a little as it starts is still a swipe and no touch is left to neither. Otherwise, past the 10 px slop, the page scrolls. (The first build used `|dx| > 1.2·|dy|` at 10 px, which left a dead band between it and Chrome's split and lost arcs to the scroller; owner, 2026-10-30: "too hard to initiate sometimes".)
5. A swipe **commits** at **28%** of the travel distance **or** a release velocity of **0.45 px/ms** in the swipe's direction. Otherwise it springs back.
6. The ring picks by **direction**, not by touching a bubble: dead zone **12 px** (always), **18 px** before the first pick, measured from where the thumb went down, **~7°** hysteresis at sector boundaries, lift-off direction taken from **≥ 40 ms** before release.
7. **Edge guard:** a touch that starts within **24 px** of the left or right edge, or within **32 px + safe-area inset** of the bottom, never starts a ring or a swipe. Android owns those zones.
8. Long-press "Ask about this" fires at **450 ms**, and only on elements marked `[data-ask]`. The ring starts only on empty space. The two never compete.
9. System Back closes the topmost layer. At the home root it leaves the app. **Back is never trapped.**
10. Feedback lands within one frame (11 ms at 90 Hz). Haptics are short, Android only, and can be switched off.

## 1. The surfaces and what may start there

| Where the finger lands | Tap | Hold 220 ms | Horizontal swipe | Vertical drag | Long-press 450 ms |
|---|---|---|---|---|---|
| Empty home space (field, spacer, gaps between turns) | Dismisses the keyboard or the `+` sheet if open; otherwise nothing | **Ring** | Briefing (right) or menu (left) | Scrolls the conversation | n/a (the hold won at 220 ms) |
| Voice line (`.say`) | Nothing | Nothing | Briefing / menu | Scrolls | `[data-ask]`: "Ask about this" [proposal] |
| Owner bubble, mind reply, action chip, decision card, `.past` pill | The element's own action | Nothing (blocked) | Briefing / menu | Scrolls | `[data-ask]` items only |
| Ask bar, `+` sheet, any button or input | The control | Nothing | Nothing | Nothing | Nothing (inputs keep Android's own text long-press) |
| Briefing page | Tile action | Nothing | Left swipe → home | Scrolls the briefing | `[data-ask]` tiles |
| Menu panel | Row action | Nothing | Right swipe → closes | Scrolls the menu | Conversation rows (row actions sheet) |
| Dim layer beside the open menu | Closes the menu | Nothing | Right swipe → closes | Nothing | Nothing |
| Inside an app | App-defined | **Never the ring** (apps own their surface) | App-defined, but never from the edge zones | App-defined | `[data-ask]` items |

Ported apps keep their own gestures exactly as they are (owner ruling 2026-10-28); the edge-zone and `[data-ask]` rules apply to them only after a later change the owner agrees to.

The blocked list in code is `button, input, textarea, form, a, [data-ask], .chip, .card, .say, .you, .reply, .opts, .past` plus any element with its own `touch-action` other than `none`.

Acceptance: a Playwright test holds 320 ms on each blocked element type and asserts `#ring` never gets `.show`; the same hold on the spacer opens it.

## 2. The pointer pipeline (one state machine)

States: `idle → pressed → (holding | swiping | scrolling | longpress) → idle`.

| Step | Rule |
|---|---|
| `pointerdown` | Primary pointer only (`isPrimary`, mouse button 0). Ignored inside the edge guard (§6). Records `x, y, t, pointerId`. Calls `setPointerCapture` only once a gesture is claimed (hold or swipe), so taps and native scrolls behave normally. |
| Press feedback | On empty home space a 16 px ring (`.press`) grows from scale 0.4 to 2.2 and opacity 0 → 0.55 over **220 ms**, `cubic-bezier(.2,0,0,1)`. It tells the owner "keep still". |
| Slop | **10 px** (Euclidean). Android's own touch slop is 8 dp; 10 CSS px leaves room for a resting thumb on the A15. |
| Hold | A timer of **220 ms** starts at `pointerdown`. If the pointer is still within the slop when it fires, the ring opens at the press point (§3). |
| Leaving the slop before 220 ms | From 6 px with `|dx| > |dy|`: cancels the hold timer and the press feedback and becomes a swipe (§4). Past 10 px otherwise: cancels them and the pointer is released to the scroller (no `preventDefault`). |
| Second pointer | Any `pointerdown` with a different `pointerId` while a gesture is live cancels it (ring closes without opening anything; a swipe springs back). |
| `pointercancel` / `lostpointercapture` | Cancels silently. A swipe springs back to where it started; the ring closes without a pick. |
| Click after a swipe | The `click` that follows a committed or abandoned swipe is swallowed for **60 ms** so a swipe that ends on a tile does not also tap it. |

`touch-action` does the blocking, not `preventDefault` [from research 4 §5]:

- The empty home stage: `touch-action: none` (we handle every move).
- Scrollers (conversation, briefing, menu, app lists): `touch-action: pan-y` with `overscroll-behavior: contain`.
- `html, body { overscroll-behavior: none }`: no pull-to-refresh, no edge glow, no Chrome horizontal-overscroll "back arrow".
- Every pointer and touch listener is `{passive: true}`. The first build's non-passive `touchmove` listener (`home.js`) is removed.

**Known gap in the first build:** `.app` has `touch-action: pan-y` everywhere and a non-passive `touchmove` that calls `preventDefault`. That works in Chromium tests but can delay scroll start on the phone. Fix as above.

## 3. The Compass ring (hold)

**Built 2026-10-31:** seven apps (Photos, the photo editor that comes later, between Study and Music), radius **62 px** with **50 px** discs and **24 px** bold icons, about 4 px apart (owner, 2026-10-31: tighter, sharper, a shorter swipe), each its own live-glass disc (owner: "what makes it so good"). The hold before a neighbour takes over stays ~7° past the sector's edge for any number of apps (`HOLD = 0.5 + 7·N/360` sectors). Only transform and opacity move, and nothing is held in a layer by `will-change` (Chrome keeps such a layer at the 0.2 scale it rests at and stretches it, which blurred the icons): the discs spring out on `--pop`, the chosen one swells to 1.12 while the others ease to 0.94, and its colour and white icon fade in on layers inside it instead of repainting the disc under its blur; the label keeps its place and crossfades up, tinted by the app. By keyboard (the focused "Apps" button): the ring opens in the middle, the arrows move round it, Enter opens, Escape closes. The geometry table below is the six-app original.

Owner ruling: hold still on an empty spot for 220 ms → a tight ring of six apps opens around the finger; slide toward one and let go to open it; letting go in the centre cancels. Radius 62 px, 56 px liquid-glass bubbles, 28 px icons. Order clockwise from the top: Music, Guitar, Podcasts, Astra, My Media, Study.

### 3.1 Geometry

| Quantity | Value | Source |
|---|---|---|
| Ring radius (centre to bubble centre) | **62 px** | decisions.md |
| Bubble | **50 px** circle, icon **24 px** in Phosphor bold (2026-10-31; was 56 and 28 regular) | decisions.md |
| Sectors | 6 × 60°, sector `i` centred at `i·60°` clockwise from straight up | `home.js` |
| Centre clamp | The ring centre is clamped to **≥ 92 px** from the left and right edges (`R + 30`), **≥ 122 px** from the top (`R + 60`) and **≥ 132 px** from the bottom (`R + 70`), so no bubble or label is ever cut off | `home.js place()` |
| Label | App name pill, Inter 600 13 px, **92 px** below the centre (`R + 30`), shown only for the selected sector | `home.js` |
| Hub | 12 px dot at 28% ink opacity. It follows the finger, capped at **34 px** from the centre (`0.55·R`), so the thumb can see which way it leans | `home.js` |
| Measured from | Where the thumb went down, never the ring's drawn centre. Near an edge the clamp moves the ring inward; measuring from its centre made a straight swipe up from a thumb at the right edge pick Guitar (owner, 2026-10-31: quick swipes missed). The hub still sits at the drawn centre and leans the way the thumb moves. | `home.js` |

### 3.2 Choosing a direction

1. Distance `d` from where the thumb went down. If `d < 12 px` → no selection (the "centre": letting go here cancels).
2. Before anything has been selected, `d < 18 px` → still no selection. This stops a resting thumb from selecting by accident.
3. Otherwise the sector is `round(angle / 60°) mod 6`.
4. **Hysteresis:** once a sector is selected, it stays selected until the finger is more than **37°** from that sector's centre (30° boundary + **7°**). Only then does the neighbour take over.
5. **Lift-off filter:** on `pointerup`, use the selection that was current at the last move event **≥ 40 ms** before the lift, not the lift event's own position. A thumb rolls a few pixels as it lifts.
6. Each change of selection: the selected bubble fills with its app colour (white icon), the others fade to 40% opacity, the label shows the app name, and a **8 ms** vibration ticks.

**Bug in the first build (and the prototype):** the hysteresis check in `dirOf()` is inverted. It reads `if (off > N/2 - .62) return dir`, which keeps the old sector only when the finger is nearly opposite it (≥ 143° away), and switches immediately at the 30° boundary. Measured: with sector 0 selected, 31° already returns sector 1, and 170° still returns sector 0. The intended rule is `if (off < 0.5 + 7/60) return dir` (keep while within 37°). Acceptance: unit test of `dirOf` over angles 0–359° in 1° steps, for each current sector, asserts the switch happens at exactly ±37° from the current centre and never sticks past it.

### 3.3 Timeline

| t | What happens |
|---|---|
| 0 ms | `pointerdown` on empty space. Press ring starts growing (220 ms). |
| 220 ms | Ring opens. Scrim fades in over **160 ms** (`--scrim`, 35% bg). Bubbles fly out from the centre with `transform .28s cubic-bezier(.34,1.45,.64,1)`, staggered **14 ms** each in clockwise order. Haptic **6 ms**. The hint (if shown) fades out for good this session. |
| any | Direction changes per §3.2, with the 8 ms tick. |
| release on a sector | The chosen bubble flies outward to `1.25·R` and scales to **1.7** while fading over **220 ms** (`cubic-bezier(.2,0,0,1)`); the others collapse to the centre (scale 0.2) over **140 ms**. Haptic `[12, 40, 12]`. The app opens (see [HOME](../product/HOME.md) §12 for the app transition). `aria-live` announces "Opening Music". |
| release in the centre / no selection | Everything collapses (140 ms), scrim fades out, no haptic, nothing opens. |
| 230 ms after release | Ring DOM resets. |

### 3.4 Where the ring never opens

- Any view other than home (briefing, menu, an app, a sheet).
- While the `+` sheet, a long-press menu, a dialog, or the keyboard is open. A tap on empty space with the keyboard open only closes the keyboard.
- In the edge guard zones.

It **does** open while a filed conversation is shown read-only on home (the ring is navigation, not conversation), and under `prefers-reduced-motion` (only the animation changes, §10).

## 4. Horizontal swipes: briefing and menu

Owner ruling: swipe right → the Briefing; swipe left → a menu on the right side.

### 4.1 Positions

There are three positions. Only one is "at rest" at any time.

| Position | Briefing | Home | Menu | Dim |
|---|---|---|---|---|
| Home | `translateX(-100%)` | 0 | `translateX(100%)` | 0 |
| Briefing | 0 | `translateX(+W)` (pushed fully right) | hidden | 0 |
| Menu | hidden | `translateX(-0.2·M)` (parallax) | 0 | 0.3 black at 100% |

`W` is the app width (max 460 px). `M` is the menu width, `min(84%, 360px)`. Progress during a drag is `p = clamp(travel / W, 0, 1)` for the briefing and `travel / M` for the menu, applied in `requestAnimationFrame` with transitions switched off.

### 4.2 Commit and spring back

| From | Gesture | Commits when | Otherwise |
|---|---|---|---|
| Home | Drag right | `p ≥ 0.28` **or** release velocity **≥ 0.45 px/ms** rightwards | Springs back home |
| Home | Drag left | `p ≥ 0.28` **or** velocity ≥ 0.45 px/ms leftwards | Springs back home |
| Briefing | Drag left | `p ≤ 0.72` (28% of the way back) **or** velocity ≥ 0.45 px/ms leftwards | Springs back to the briefing |
| Menu | Drag right | `p ≤ 0.72` **or** velocity ≥ 0.45 px/ms rightwards | Springs back open |
| Briefing | Drag right | Nothing further: a rubber band (built 2026-10-30: past the end the page moves 0.22 of the overshoot, easing off, about 25 px at most on a phone) and springs back on release | n/a |
| Menu | Drag left | Nothing further: the same rubber band | n/a |

- **Velocity** is measured over the last **80 ms** of moves before release (at least 2 samples). A fling against the drag direction cancels even past 28%.
- **One hop per gesture.** A single drag from the briefing can never pass home and open the menu.
- **Settle animation:** the `--settle` spring (`linear()`, damping 0.8) over `--d-page` (460 ms). Built (2026-10-30): a flick finishes at the finger's speed: the distance left over the release speed, times 1.8 for the spring's tail, between 180 and 460 ms, so a fast flick doesn't slow down at release; a commit ticks 5 ms.
- Built (2026-10-30): the velocity is the finger's over its last 100 ms of moves, and 0 if it rested more than 60 ms before lifting. Acceptance: `tests/shell-look-browser.test.mjs` drives a real touchscreen with timed events: an arc start, a 90 px flick each way, a slow 80 px drag that springs back, and a vertical drag that still scrolls.

### 4.3 Closing without a swipe

- Menu: tap the dim layer, press system Back, or pick a row that navigates.
- Briefing: system Back, a left swipe, or tapping a tile that goes home ("Waiting on you").
- Both: the Escape key.

## 5. Long-press "Ask about this"

From the plan (§6): long-press anything anywhere (a song, a bar, a verse, a story) and choose "Ask about this"; home opens with that item already attached.

| Rule | Value |
|---|---|
| Fires on | Elements with `[data-ask]` only. The attribute's value is a `ref` string (grammar owned by [API](../engineering/API.md)), e.g. `music.song:<id>` or `briefing.tile:practice`. |
| Time | **450 ms** within the 10 px slop. Ring hold is 220 ms but never starts on `[data-ask]`, so there is no race. |
| Feedback at 450 ms | The item scales to **1.02** over 120 ms with a soft shadow, haptic **10 ms**, and a small action menu opens next to it (above if there is room, else below), never under the thumb. |
| Menu items (in order) | **Ask about this** (always) · **Copy** (when the item has text) · **Why this?** (when the item carries a `why`) · app-specific extras (max 2 more). Max 5 items. |
| "Ask about this" | Goes home (or stays there), puts a context pill inside the ask bar ("About: <item title, ≤ 32 chars>", with an × to remove), and focuses the input. Sending attaches the `ref`. |
| Dismiss | Tap outside, system Back, Escape. |
| Text selection | `[data-ask]` elements set `-webkit-user-select: none; -webkit-touch-callout: none` and the app cancels `contextmenu`, so Chrome's own text-selection long-press (about 400–500 ms on Android) never fires first. Plain conversation text keeps "Copy" through this menu instead. |
| Inputs | Never `[data-ask]`. Text fields keep Android's own long-press (paste, select). |

## 6. Edge guard and Android system navigation

The Android back gesture (inward swipe from the left or right edge) and the home / recents gestures (bottom edge) cannot be switched off by a web page. Only native code can opt out of the side edges, and nothing can opt out of the bottom ([Android: gesture navigation](https://developer.android.com/develop/ui/views/touch-and-input/gestures/gesturenav), updated 2026-10-23).

| Zone | Size | Rule |
|---|---|---|
| Left edge | **24 px** | No ring, no swipe starts here. Taps on controls still work. |
| Right edge | **24 px** | Same. |
| Bottom | **32 px + `env(safe-area-inset-bottom)`** | Same. The ask bar sits 24 px above the safe area, so its lower part overlaps this zone; its buttons still take taps. |
| Top | none | The status bar is outside the page. |

These numbers are research heuristics, constants in `ui/gestures.js`, and are **tuned on the Galaxy A15** (test G7 below).

### 6.1 The two navigation modes on the Galaxy A15

Samsung ships **3-button navigation by default**; gesture navigation is opt-in (secondary sources only). The owner's mode is still unconfirmed (decisions.md).

| Mode | What Android does | What the Thunderhead does |
|---|---|---|
| **3-button** | Back is a button. No edge swipes. Chrome may show its own horizontal-overscroll "back" arrow at the left edge of a tab. | `overscroll-behavior: none` on `html, body` stops Chrome's overscroll arrow. Swipes may start anywhere outside the guard. Nothing conflicts. |
| **Gestures** | A swipe in from the left or right edge is Back. A swipe up from the bottom is Home; up and hold is Recents. Samsung lets the owner change back-gesture sensitivity, which changes the edge width. | The edge guard keeps our swipes out of the system zones. **Known conflict:** a right-swipe meant for the briefing that starts at the very left edge is a system Back, and at the home root that leaves the app. Mitigation: the guard, plus the first-run hint teaching swipes from mid-screen. Measured on the A15 (test G7). |

### 6.2 Predictive back

- Chrome on Android has been testing a predictive-back preview of the previous page (A/B tested in stable in 2025, behind a flag otherwise); its rollout state in a WebAPK on the A15 is **unverified**.
- Our overlays (briefing, menu, sheets) are same-document history entries. When the Navigation API reports `event.hasUAVisualTransition === true` for a Back, skip our own slide animation so the two do not play twice.
- No custom predictive-back animation is built in v1.

## 7. Back semantics

Owner-visible rule: **Back closes the thing on top.** At the home root it leaves the app as normal.

| Layer stack (top first) | System Back / Escape does |
|---|---|
| Keyboard open | Android closes the keyboard (the page does nothing). |
| Long-press action menu | Closes it. |
| Confirm sheet (e.g. delete) | Closes it, choosing "Keep". |
| `+` sheet | Closes it. |
| Sub-page inside Settings | Back to the settings list in the menu. |
| Menu | Closes it (home). |
| Briefing | Closes it (home). |
| An open app | Back inside the app's own stack first; at the app's root, back to home. Audio keeps playing once apps run inside the shell; a ported app that is still its own page behaves as it does today (owner ruling: apps come over as they are). |
| A filed conversation shown on home | Back to now (same as "Back to now"). |
| Home root | Leaves the app (Chrome tab: previous page; installed app: Android launcher). Never trapped, never "Press again to exit". |

Implementation rules (`lib/router.js`):

1. Briefing, menu, the `+` sheet, sheets, settings sub-pages and each open app are **history entries**, created only inside a user activation (Chrome skips history entries added without one: [Chromium history-manipulation intervention](https://chromium.googlesource.com/chromium/src/+/127.0.6533.99/docs/history_manipulation_intervention.md)).
2. Closing a layer by tap (dim, ×, swipe) calls `history.back()` so the stack never gets out of step.
3. Sheets use `CloseWatcher` when present (feature-detected; Chrome says 120, compatibility tables say Android support came later) and fall back to history entries.
4. A cold start at a deep link (`/music/`) has no home entry below it. Back from that app's root goes to home (`navigation.navigate('/', {history: 'replace'})`), and the next Back leaves.

Acceptance: test G5 below drives each row with `page.goBack()` and asserts the expected layer state.

## 8. Haptics

`navigator.vibrate` works in Chrome on Android after the first user activation; iOS has none. Every call is feature-detected and wrapped in `try`.

| Moment | Pattern (ms) |
|---|---|
| Ring opens | `6` |
| Ring selection changes | `8` |
| App opens from the ring, a decision is answered, a message is sent from voice | `[12, 40, 12]` |
| `+` pressed | `6` |
| Mic starts / stops | `18` / `8` [proposal: first build uses 8 for both] |
| Long-press fires | `10` |
| Error (send failed, sign-in needed) | `[30, 60, 30]` |
| Swipe commit | none (motion is enough) |

- Setting: **Settings → Appearance → Vibration** on/off, default on [proposal].
- Haptics stay on under reduced motion (Apple recommends haptics as a supplement to motion).
- Quiet hours do not mute haptics: they only follow the owner's own touches.

## 9. Equivalents for every gesture (accessibility)

WCAG 2.2 requires a single-pointer, non-path alternative for path-based and dragging gestures (SC 2.5.1 Pointer Gestures, SC 2.5.7 Dragging Movements) and 24×24 CSS px minimum targets (SC 2.5.8). We aim for 44 px.

| Gesture | Equivalent |
|---|---|
| Hold → ring | A visually hidden **"Apps"** button, first in focus order, opens the ring as a keyboard menu centred on screen: `role="menu"`, six `menuitem`s in ring order, arrow keys move clockwise/anticlockwise, Enter opens, Escape closes. TalkBack reads "Apps, menu, 6 items". Also: every app is reachable by asking ("open music"). |
| Swipe right → briefing | Visually hidden **"Briefing"** button, second in focus order. |
| Swipe left → menu | Visually hidden **"Menu"** button, third in focus order. |
| Long-press "Ask about this" | The focused `[data-ask]` element opens the same action menu with the ContextMenu key or Shift+F10. With TalkBack, double-tap-and-hold passes a long-press through. |
| Drag a sheet down to close | The sheet's close button and Back. |
| Ring direction "slide" | Never needed: the keyboard menu is pick-by-focus. |

The hidden buttons become visible (a small glass pill at the top) when focused with a keyboard or switch.

## 10. Reduced motion

Under `prefers-reduced-motion: reduce`:

- The ring opens with bubbles **already in place** and a 120 ms opacity fade; selection changes are instant; no fly-out on commit.
- Swipes still follow the finger (that is direct manipulation, not animation); the settle after release is a **150 ms** crossfade-free snap (`transition-duration: 150ms`, no overshoot).
- Press ring, rise, breathe and pulse animations are off.
- Haptics are unchanged.

## 11. Test plan

Automated tests run in `@playwright/test` at 390×844 and 360×740, day and night, with and without reduced motion. Touch is emulated with CDP `Input.dispatchTouchEvent` so `pointerType` is `touch`.

| # | Test | Pass when |
|---|---|---|
| G1 | Hold 300 ms on the spacer | `#ring.show` at ≥ 220 ms and not before 200 ms; label empty until a move ≥ 18 px |
| G2 | Hold then move 70 px up, release | Music opens; `aria-live` says "Opening Music"; haptic called with `[12,40,12]` (stubbed `navigator.vibrate`) |
| G3 | Hold, move 70 px at each of 0°, 60°…300° | Opens Music, Guitar, Podcasts, Astra, My Media, Study in that order |
| G4 | Hysteresis sweep (unit) | `dirOf` switches at ±37° from the current centre, never sticks past it |
| G5 | Back stack | Each row of §7 produces the listed state after `page.goBack()` / Escape |
| G6 | Swipe commit | 27% drag → springs back; 29% → commits; a 15% flick at 0.6 px/ms → commits; a 40% drag ending with a 0.6 px/ms reverse fling → springs back |
| G7 | Edge guard | `pointerdown` at x = 10 and x = W − 10, and at 20 px above the bottom safe area: no ring, no swipe |
| G8 | Blocked targets | Hold on every blocked selector (§1): no ring |
| G9 | Long-press | 450 ms on a `[data-ask]` item opens the action menu; 440 ms does not; no text selection appears |
| G10 | Second finger | Two-pointer touch during a hold cancels with nothing opened |
| G11 | Click swallow | A swipe ending on a briefing tile does not trigger the tile |
| G12 | Lift-off jitter | Hold, move to Music, then a 6 px sideways move in the last 20 ms before release: Music still opens |
| G13 | CPU budget | With 4× CPU throttling, no long animation frame > 50 ms during the ring or a swipe (LoAF observer) |
| G14 | Reduced motion | Ring bubbles are at their final transform within 1 frame of opening |

**Real-device checklist (Galaxy A15, Chrome and the installed app), before any release that touches gestures:**

1. 20 holds in a row on different empty spots: 20 rings, 0 accidental scrolls.
2. 20 ring picks at speed (no pause): ≥ 19 correct.
3. 10 right-swipes started mid-screen: 10 briefings, 0 app exits. Repeat from 30 px off the left edge.
4. With gesture navigation on (if the owner uses it): 10 deliberate edge back-swipes from the briefing, menu and an app: each closes exactly one layer.
5. Keyboard open: tap empty space closes it; Back closes it; the ask bar stays above the keyboard.
6. Long-press a briefing tile: the action menu appears, no text selection, no Chrome context menu.

## Open questions / tests

| Question | How to settle it |
|---|---|
| Does the owner use 3-button or gesture navigation? | Ask the owner (one line in chat). Until then, build for gestures (the stricter case). |
| Are 24 px sides / 32 px bottom right for the A15 at the owner's back-sensitivity setting? | A gesture log page on the device: record start x/y of 50 system back-swipes and 50 of ours; set the guard at the 95th percentile of system starts. |
| Is 220 ms too fast for one-handed use (accidental rings while reading)? | Count `ring opened → cancelled with no pick` per day from `sys.gesture` senses for a week. If > 3/day, try 260 ms. |
| Does Chrome's predictive back preview appear in the installed WebAPK on the A15, and does `hasUAVisualTransition` fire? | Device test with a back from the briefing. |
| `CloseWatcher` on the A15's Chrome version | Feature-detect and log `typeof CloseWatcher` once as a `sys` sense. |
| Is 0.45 px/ms the right fling threshold on a 90 Hz screen? | Log release velocities of committed and abandoned swipes for a week; pick the value that separates them. |
