# Design system

The tokens, components and rules every Thunderhead screen is built from: colour, type, space, shape, glass, grain, motion, layers, icons and the six app colours, with the contrast checks that keep them readable.
Values marked "built" are in the build: every shell page takes its tokens from `frontend/ui/tokens.css` and its shared rules (field, grain, focus ring, press, page cross-fade) from `frontend/ui/shell.css`, loaded last; everything else is marked **[proposal]** until the owner accepts it.
Scope: the shell (home, Briefing, menu, settings, sign-in) and new apps (Study). The ported apps (Music, Guitar, Podcasts, Astra, My Media) come over **as they are** with their own look, fonts and icons (owner ruling 2026-10-28); the rules and lint tests here apply to one of them only after the owner agrees to bring it into the system.
Sibling docs: [HOME](../product/HOME.md), [GESTURES](GESTURES.md), [COPY](COPY.md), [BRIEFING](../product/BRIEFING.md), [MENU-AND-SETTINGS](../product/MENU-AND-SETTINGS.md), [PERFORMANCE](../engineering/PERFORMANCE.md), [decisions](../process/decisions.md).

## Rules at a glance

1. **One typeface.** Switzer, a tall x-height grotesk (owner, 2026-10-31, after Quicksand the same day, which replaced Fraunces and Inter): text 400, controls and labels 500, titles and big numbers 600, nothing lighter or heavier; tighter tracking from 24 px up. His words are told apart by having no bubble (the owner's have one) and his home lines by a tinted card, not by a face.
2. **Two themes, same accents.** Day: a soft drifting colour field with grain. Night: pure black with faint accent light (owner ruling). Every colour token is defined once with `light-dark()`.
3. **One primary action per screen.** On home it is the ask bar. At most **one gold element** is visible at a time.
4. **Contrast is tested, not eyeballed.** Text ≥ 4.5:1, large text (≥ 24 px, or ≥ 18.66 px bold) and icons/UI parts ≥ 3:1, measured against the **worst** background each token can sit on. A node test fails the build otherwise.
5. **Targets ≥ 44×44 CSS px** (hit area, not necessarily the drawn shape). WCAG 2.2 AA's floor is 24×24.
6. **Motion is quick and springy, never slow**, carries meaning, and collapses under `prefers-reduced-motion`.
7. **Token shape is checked.** `tests/feel.test.mjs` scans its fifteen shell CSS files for nonzero literal times shorter than 2 s in `transition*`/`animation*` declarations. Outside `ui/tokens.css`, it rejects raw `cubic-bezier()` and `linear()` curves and timing keywords (`ease`, `ease-in`, `ease-out`, `ease-in-out`, `linear`). A `font-size` value must be `var(--fs-…)`; a `font` shorthand must be `inherit` or use `var(--fs-…)` in the size position, with either a `var(--lh-…)` line height or no line height. Standalone `line-height` declarations are not checked. A `/* T1: … */` comment exempts only its own line; the test prints the exempt-line count (currently zero). It checks shape, never token values. Hex colours, radii and z-index are not yet enforced.
8. **Icons are Phosphor regular** (MIT), from one SVG sprite, `fill: currentColor`, always `aria-hidden` with a text label on the control.
9. **Glass is expensive on the A15.** At most **2** live `backdrop-filter` surfaces on screen at once; everything else uses "flat glass" (§6).
10. **No chrome:** no header bar, tab bar, badges, counters of other people, or dividers. Space does the grouping.

## 1. Colour tokens

All colour tokens live in `ui/tokens.css`:

```css
:root { color-scheme: light dark; }
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
:root { --ink: light-dark(#152231, #eceff4); /* … */ }
```

`light-dark()` is Baseline (Chrome 123+). It only works for colours; non-colour values that differ by theme (blob opacity, shadows that become "none") use a `:root[data-theme="dark"]` rule. `theme.js` always sets `data-theme` before first paint, so the system setting only matters if scripts fail.

This replaces the first build's three copies of every dark token (media query, `[data-theme=dark]`, and repeats).

### 1.1 Surfaces and ink

| Token | Day | Night | Use | Status |
|---|---|---|---|---|
| `--bg` | `#eef1f7` | `#000000` | Page background, `theme-color` | built |
| `--field-1` / `-2` / `-3` | `#cfe0f7` / `#e9dff3` / `#f7e7d6` | `#000` / `#000` / `#000` | 160° gradient of the day field | built |
| `--blob-1` / `--blob-2` | `#b9d0fa` / `#f5d6c0` | `#1d4fb8` / `#6b4a0c` | The two drifting lights | built |
| `--blob-opacity` | `0.6` | `0.22` | (non-colour; per-theme rule) | built |
| `--ink` | `#152231` | `#eceff4` | Primary text, the voice | built |
| `--ink-2` | `#46566a` | `#a6b0bc` | Secondary text, icons on controls | built |
| `--ink-3` | **`#525d6b`** (built: `#6d7988`) | `#77828f` | Tertiary text: date line, hint, meta, labels | **Decided (owner, 2026-10-28)**; the built one fails 4.5:1 (§9) |
| `--glow` | `#5b8ff0` | `#4d84ff` | Edge light (calm, thinking, listening) | built |

### 1.2 Accent, gold, alarm

| Token | Day | Night | Use | Status |
|---|---|---|---|---|
| `--accent-fill` | `#2468d8` | `#2468d8` | Send button, selected states, focus ring. White on it is 5.19:1. | built in day; **[proposal]** night (built uses `#6aa2ff`, where white is only 2.55:1) |
| `--accent-text` | **`#1a56bb`** (built: `#2468d8`) | `#6aa2ff` | Links and accent text on the field | **Decided (owner, 2026-10-28)**; the built one is 3.54:1 on the field's darkest point |
| `--accent-icon` | `#2f7df6` | `#6aa2ff` | Accent icons only (never text) | built (as Music colour) |
| `--gold` | `#f2b632` | `#f2b632` | The decision: dot, yes-button fill, bottom edge light. **Never text on light.** | built |
| `--gold-ink` | `#2b1d00` | `#2b1d00` | Text on a gold fill (9.0:1) | built |
| `--gold-text` | **`#734a00`** (built: `#8a5a00`) | `#f2b632` | Gold-meaning text ("Waiting on you" label) | **Decided (owner, 2026-10-28)**; the built one is 4.04:1 on the field |
| `--alarm` | `#b42318` | `#ff6b5e` | Error text ("Didn't send") | **[proposal]** |
| `--alarm-glow` | `#d6453d` | `#ff6b5e` | Error edge light | **[proposal]** |

### 1.3 Glass and overlays

| Token | Day | Night | Use | Status |
|---|---|---|---|---|
| `--glass` | `rgba(255,255,255,.55)` | `rgba(255,255,255,.07)` | Bubbles, chips, card, tiles | built (`--chip`) |
| `--glass-line` | `rgba(21,34,49,.07)` | `rgba(255,255,255,.08)` | 1 px borders of glass | built (`--chipLine`) |
| `--bar` | `rgba(255,255,255,.5)` | `rgba(255,255,255,.07)` | Ask bar fill | built |
| `--bar-line` | `rgba(255,255,255,.65)` | `rgba(255,255,255,.12)` | Ask bar and ring-bubble border | built (inline) |
| `--sheet` | `rgba(247,249,253,.84)` | `rgba(18,20,24,.86)` | `+` sheet, menu panel, action menus | built |
| `--disc` | `rgba(255,255,255,.82)` | `rgba(22,26,32,.92)` | Toast, ring label, selected segment | built |
| `--disc-line` | `rgba(21,34,49,.10)` | `rgba(255,255,255,.12)` | Their borders | built |
| `--scrim` | `rgba(238,241,247,.35)` | `rgba(0,0,0,.35)` | Behind the ring | built |
| `--dim` | `rgba(10,14,22,.30)` | `rgba(10,14,22,.30)` | Beside the open menu; behind sheets | built (inline) |
| `--tint` | `color-mix(in srgb, var(--ink) 6%, transparent)` | same | Hover/pressed rows, search field, segmented track | built (inline) |

## 2. Type

**Built (Switzer):** the shell uses one self-hosted variable face, `ui/fonts/Switzer.woff2` (wght 100–900, 43.2 KB), from Indian Type Foundry's Fontshare under the ITF Free Font License. The official file is fetched by `scripts/fonts.mjs`, checked against its SHA-256, and never committed or modified. Stage requires it when `TH_FONTS=required`; a local checkout fetches it once (README). `font-display: swap` and the page preload remain in place. Code retains its existing monospace families.

### Baseline (2026-11-01), redesigned in T1b

Type uses two independent axes in `frontend/ui/tokens.css`: size (`--fs-*`) and line height (`--lh-*`). Sites compose them with their existing weight and family, for example `font:500 var(--fs-small)/var(--lh-loose) var(--ui)`. The values are provisional and preserve the existing appearance exactly, without size, line-height, weight or family changes. Tracking, emphasis, numeric variants and wrapping stay at their sites.

`frontend/th/type.js` generates all thirty size tokens from a base and modular ratio, rounds to half pixels, and optionally snaps the off-ramp sizes to the nearest role. Its density factor scales the seventeen line-height classes while keeping the flat and ask values fixed. The file's current values are a frozen baseline; only the open `/?feel` panel previews generated values, and a later freeze replaces them after tuning. Appearance changes only reply and input sizes, and the tuning ramp keeps the input at least 16 px.

`--ui` and `--voice` both resolve to `"Switzer",system-ui,-apple-system,"Segoe UI",sans-serif`. `--mono` resolves to `ui-monospace,"SF Mono","Roboto Mono",Menlo,Consolas,monospace`. A shorthand that previously omitted line height still omits it and uses CSS's `normal` line height. A size-only rule uses `font-size:var(--fs-…)`, preserving the other font properties it inherits. `font:inherit` remains a valid way to inherit the complete font.

The thirteen role names are the core ramp:

| Token | Exact value | Sites (examples) |
|---|---|---|
| `--fs-label` | `12px` | `.fld .help`, `.foot`, `.why` |
| `--fs-small` | `13px` | `.fld label`, `.lbl`, `.inp .show` |
| `--fs-chip` | `14px` | `.check`, `.link`, `.line` |
| `--fs-body` | `15px` | `.btn`, `.auth .lead`, `.home` |
| `--fs-input` | `16px` | `.you`; follows Appearance |
| `--fs-reply` | `16.5px` | `.reply`; follows Appearance |
| `--fs-strong` | `17px` | `.panel h2`, `#now .tl`, `.b-quote blockquote` |
| `--fs-section` | `21px` | `.codebox` |
| `--fs-heading` | `24px` | `.allconvos .gl`, `.bsv` |
| `--fs-page-title` | `30px` | `.auth h1`, `.tile .big`, `.sidetitle` |
| `--fs-title` | `34px` | `.btitle` base rule; superseded by `--fs-hero` |
| `--fs-big` | `36px` | `.tile .big` |
| `--fs-hero` | `clamp(38px,11vw,46px)` | `.btitle` |

There are thirteen `x-` sizes outside that ramp. The large Appearance sizes, 18 px and 18.5 px, are included because the setting uses them. These values remain distinct until a later design decision changes them.

| Token | Exact value | Sites (examples) |
|---|---|---|
| `--fs-x-10-5` | `10.5px` | `.gn` |
| `--fs-x-11` | `11px` | `.talk .reply a.cite`, `.tag`, `.bcite` |
| `--fs-x-11-5` | `11.5px` | `.talk .turn[data-time]::before`, `.bsa`, `.book .bs` |
| `--fs-x-12-5` | `12.5px` | `.status`, `.otrmark`, `.otrmark button` |
| `--fs-x-13-5` | `13.5px` | `.talk .follow`, `.cited .hit b` |
| `--fs-x-14-5` | `14.5px` | `.row` |
| `--fs-x-15-5` | `15.5px` | `.talk .reply.progress`, `.talk .note .nt`, `.slink` |
| `--fs-x-18` | `18px` | Appearance: large owner bubbles |
| `--fs-x-18-5` | `18.5px` | Appearance: large replies |
| `--fs-x-22` | `22px` | `.gl` |
| `--fs-x-28` | `28px` | `.verse h1` |
| `--fs-x-64` | `64px` | `.tile.weather .big` |
| `--fs-x-not-found` | `clamp(32px,9vw,40px)` | `.voice` |

The three relative sizes scale with their parent reply. `--fs-ask` supplies all fixed 16 px text: the ask bar, form controls, card questions (`.card .q`), confirm-sheet headings (`.csheet h2`) and the other sites that must not follow the conversation setting. These bring the size-token total to thirty.

| Token | Exact value | Sites (examples) |
|---|---|---|
| `--fs-rel-code` | `.84em` | `.talk .reply code` |
| `--fs-rel-marker` | `.88em` | `.talk .reply ol>li::marker` |
| `--fs-rel-heading` | `1.06em` | `.talk .reply h3` |
| `--fs-ask` | `16px` | Ask textarea, fixed-size form fields and other fixed 16 px text |

The seventeen line-height values below occur in the existing styles. There is no unused 1.2 step. Unitless values scale with the element's font size; `--lh-ask` is the existing fixed 22 px line height.

| Token | Exact value | Sites (examples) |
|---|---|---|
| `--lh-flat` | `1` | `.tile.weather .big`, `.talk .reply a.cite`, `.talk .turn[data-time]::before` |
| `--lh-dense` | `1.1` | `.voice`, `.sidetitle`, `.bsv` |
| `--lh-snug` | `1.25` | `#now .tl` |
| `--lh-tight` | `1.3` | `.fld label`, `.lbl`, `.inp input` |
| `--lh-compact` | `1.35` | `.csheet h2`, `.panel h2`, `.toast` |
| `--lh-body` | `1.4` | `.tile .s`, `.sh small`, `.talk .sys` |
| `--lh-card` | `1.42` | `.card .q`, `.card.news ul.q li` |
| `--lh-reading` | `1.45` | `.fld .help`, `.line`, `.csheet p` |
| `--lh-loose` | `1.5` | `.codebox`, `.auth .lead`, `.panel p` |
| `--lh-reply` | `1.55` | `.codebox.small`, `.reply`, `.vtext p` |
| `--lh-badge` | `1.6` | `.counts`, `.tag`, `.badge` |
| `--lh-tall` | `2` | `.whours li` |
| `--lh-hero` | `1.06` | `.btitle` |
| `--lh-big` | `1.05` | `.tile .big` |
| `--lh-title` | `1.12` | `.btitle` |
| `--lh-page-title` | `1.15` | `.auth h1`, `.gl`, `.verse h1` |
| `--lh-ask` | `22px` | `.ask textarea` |

Appearance overrides only the conversation size tokens:

| Setting | `--fs-reply` | `--fs-input` |
|---|---|---|
| Small (`data-text="s"`) | `var(--fs-body)` = 15 px | `var(--fs-body)` = 15 px |
| Large (`data-text="l"`) | `var(--fs-x-18-5)` = 18.5 px | `var(--fs-x-18)` = 18 px |

The `.you` bubble uses `--fs-input`; `.reply` uses `--fs-reply`. The existing `:root[data-text] .reply` and `.you` rules in `ui/shell.css` retain their specificity and set `font-size` through those tokens, so progress replies still follow the setting over their default 15.5 px size. The ask bar stays at `var(--fs-ask)/var(--lh-ask)`, 16 px / 22 px, in every setting. Other fixed 16 px sites also use `--fs-ask`, preventing the setting from changing form controls.

The former composite type tokens are no longer defined. The old uppercase 11 px / +0.14em caps style remains **not built**. Sizes are px, with `em` and `clamp()` where the existing styles use them; Appearance is the shell's text-size mechanism. **[proposal]** Adopt `<meta name="text-scale" content="scale">` when it is supported by the target browsers.

`tests/feel.test.mjs` requires size tokens in `font-size` declarations and the size position of `font` shorthands; an explicit shorthand line height must use a `--lh-*` token. `font:inherit` needs no exception. Standalone `line-height` declarations are not checked in this task. The shell currently has zero exempt lines.

Keep `font-variant-numeric: tabular-nums` on times, durations and counts, `text-wrap: balance` on titles and `text-wrap: pretty` on replies. Mark second-language passages with their language's `lang` code for hyphenation and screen readers.

## 3. Space

The 4/8 scale [proposal: the first build uses many in-between values; map them to the nearest step when touched].

| Token | px | Typical use |
|---|---|---|
| `--s-1` | 4 | Icon-to-text nudge, segmented padding |
| `--s-2` | 8 | Gap between chips and sheet items; turn inner gap |
| `--s-3` | 12 | Row padding, tile gap (built 10) |
| `--s-4` | 16 | Ask bar side inset, card padding (built 14/16), menu padding (built 14) |
| `--s-5` | 20 | Space under the date line |
| `--s-6` | 24 | Page side gutter (built 24 on home, 18 on briefing), ask bar above safe area |
| `--s-7` | 32 | Between sections |
| `--s-8` | 40 | Minimum spacer at the top of the conversation |
| `--s-9` | 56 | Conversation top inset (built `top: 56px`) |

Layout constants (built): conversation `top: 56px; bottom: 98px`; ask bar `height: 54px`, `left/right: max(16px, safe-area)`, `bottom: 24px + safe-area`; app max width **460 px**, centred.

## 4. Shape

| Token | px | Use | Status |
|---|---|---|---|
| `--r-xs` | 6 | Bubble tail corner (owner bubble: 19 19 6 19) | built |
| `--r-s` | 10 | Ring label pill, segmented item (built 9) | built |
| `--r-m` | 12 | Rows, toast, segmented track | built |
| `--r-chip` | 14 | Action chips, attachment thumbnails | built |
| `--r-row` | 16 | Rows inside a group (Settings lists and actions, sheet items) | built |
| `--r-bubble` | 19 | Owner bubble | built |
| `--r-l` | 22 | Decision card, briefing tiles | built |
| `--r-xl` | 26 | `+` sheet, action menu, bottom sheets | built |
| `--r-bar` | 27 | Ask bar (half its height) | built |
| `--r-full` | 999 | Pills, buttons, circles | built |

Nesting rule: an inner radius = outer radius − the padding between them (sheet 26 − 8 = 18 → sheet items use 16).

## 5. Elevation

There is no elevation scale of grey shadows. Depth comes from glass, a 1 px top highlight and one soft ink-tinted shadow.

| Level | Day | Night | Used by |
|---|---|---|---|
| E0 flat | none | none | Text on the field, rows |
| E1 rest | `inset 0 1px 0 rgba(255,255,255,.7)` | `inset 0 1px 0 rgba(255,255,255,.07)` | Tiles, chips |
| E2 raised | E1 + `0 10px 28px -16px rgba(20,30,60,.25)` | E1 + `0 10px 28px -16px #000` | Decision card, ask bar (`0 12px 30px -16px`) |
| E3 floating | `0 24px 50px -22px rgba(10,20,40,.4)` | same with `#000` | `+` sheet, action menus, menu panel (`-24px 0 50px -24px` sideways) |

Built as `--e1`, `--e2` and `--e3`. Settings groups (lists, actions, the memory fold) are flat glass at E1, so Settings reads as the same material as home's tiles.

## 6. Glass

| Kind | Recipe | Where |
|---|---|---|
| **Live glass** (G1) | Fill token + `backdrop-filter: blur(16–28px) saturate(1.5–1.8)` + 1 px line + E1/E2 | Ask bar (18 px), menu panel (28), `+` sheet (24), decision card (16), ring bubbles (14, only while the ring is open) |
| **Flat glass** (G0) | `--glass-flat` (the fill 2% lighter) and the same line, **no** `backdrop-filter`. Built | Owner bubbles, action chips, briefing tiles, `.past` pill, Settings groups and buttons, the 404's link |
| **Liquid glass bubble** | Ring only: radial highlight at 30% 15%, a wash of the app colour from below (22% day, 30% night), 1 px white line (65% day, 18% night), inner top highlight, inner bottom app-colour glow. Selected: app colour at 88%, white icon, 6 px app-colour halo | Compass ring |

Budget: at most **2 live-glass surfaces visible at once** (ask bar + one of: card, sheet, menu, ring). The first build gave every owner bubble, chip and tile its own `backdrop-filter`, which broke the budget once a conversation had a few turns; they are flat glass now, and Settings opens on an opaque page with no blur at all. Acceptance (built, `tests/shell-look-browser.test.mjs`): a test counts elements with a computed `backdrop-filter` other than `none` that intersect the viewport, in each view: ≤ 2 (ring open: the six bubbles count as one layer, ≤ 3 total).

## 7. Field and grain

- **Field:** `linear-gradient(160deg, field-1 0%, field-2 48%, field-3 100%)` plus two 130%-wide radial-gradient "blobs" (blob-1 top-left, blob-2 bottom-right) that drift with `transform: translate(16%, 9%) scale(1.15)` over **38 s** and **47 s** (alternate, ease-in-out). Built.
- Only `transform` animates. No animated `filter: blur()` (the prototype's `blur(90px)` blobs were replaced by radial gradients in the first build).
- **Night:** the gradient is pure black; the blobs at 22% give the "faint accent light".
- **Grain:** an SVG `feTurbulence` (fractalNoise, baseFrequency 0.85, 2 octaves, desaturated) tile of **160 px**, `opacity: .09`, `mix-blend-mode: overlay`, over the whole field. Built. It also stops gradient banding.
- **Still background** setting (built 2026-10-30): Settings → Appearance → "Still background" stops the drift (WCAG 2.2.2 asks for a way to stop motion that runs longer than 5 s). Reduced motion also stops it.
- **The app icon** (built 2026-10-30): the night field (black to deep navy, a blue glow top-left, a gold warmth bottom-right), the presence light rising from the bottom, and the Thunderhead's italic T from Fraunces (wght 420, opsz 72) drawn as a path, so it needs no font; `icon.svg`, 192 and 512 PNGs, and a maskable 512 with the T inside the safe circle. The splash and its status bar are the icon's black (`#03050a`), so opening at night never flashes white.
- **Accents**: removed 2026-10-31 (owner: "an accent color picker is dumb"); blue is the only accent, gold keeps meaning "needs you". `ui/theme.js` drops an old stored choice.
- The field and grain pause when the document is hidden (`animation-play-state: paused` on `visibilitychange`).

## 8. Motion

### 8.1 Durations and curves

**Baseline (2026-11-01), redesigned in T1b.** These are the exact motion tokens in `ui/tokens.css`. Values remain provisional; durations and delays derived with `calc()` retain their existing timings except for the explicit T1a motion changes.

| Token | Exact value | Use |
|---|---|---|
| `--d-instant` | `90ms` | Level meters and short delays |
| `--d-fast` | `160ms` | Ring collapse, presses and short fades |
| `--d-quick` | `240ms` | Press ring and chosen-pet fly-out |
| `--d-base` | `300ms` | Conversation fades and card transitions |
| `--d-sheet` | `380ms` | Sheets and inherited sheet timings |
| `--d-page` | `460ms` | Briefing, menu and Settings settle |
| `--d-rise` | `900ms` | Island level-bar base and rise timings |
| `--d-edge` | `1400ms` | Edge crossfade, mic breath, recording dot and flash |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | Existing outward curve; edge crossfade and card pulse |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | Ring close |
| `--ease-rise` | `cubic-bezier(.2,.7,.2,1)` | Defined for tuning; no current site |
| `--ease-emph` | `cubic-bezier(.2,0,0,1)` | Press ring and chosen-pet fly-out |
| `--ease-pop` | `cubic-bezier(.34,1.45,.64,1)` | Defined for tuning; no current site |
| `--ease-sheet` | `cubic-bezier(.34,1.3,.64,1)` | Defined for tuning; no current site |
| `--ease-ambient` | `ease-in-out` | Drift, thinking, mic breath, recording and level-bar loops |
| `--ease-linear` | `linear` | Meters and constant-speed loops |
| `--ease-default` | `ease` | Preserves the CSS `ease` keyword, including implicit defaults |
| `--ease-standard-out` | `ease-out` | Preserves the CSS `ease-out` keyword where its original curve stays |

`--ease-out` is a custom bezier, while `--ease-standard-out` is CSS's `ease-out`; they are different curves. `--ease-default` preserves CSS's explicit or implicit `ease`. Ambient animations may retain literal durations of at least 2 s, and zero delays may remain literal. Shorter durations and delays use `--d-*` tokens directly or through `calc()`.

Under reduced motion, `--d-instant`, `--d-fast`, `--d-quick`, `--d-base`, `--d-rise` and `--d-edge` become `0ms`; `--d-sheet` and `--d-page` become `150ms`. Existing per-file reduced-motion rules remain in force.

### 8.2 Springs

**Baseline (2026-11-01), redesigned in T1b.** The shell has two sampled CSS `linear()` curves. Their duration is supplied separately by a `--d-*` token; these definitions do not establish an engine response or stiffness.

| Token | Exact value | Meaning |
|---|---|---|
| `--settle` | `linear(0, .047, .156, .292, .433, .563, .678, .772, .847, .904, .946, .975, .994, 1.006, 1.012, 1.015, 1.015, 1.014, 1.012, 1.01, 1.008, 1.006, 1.004, 1.003, 1)` | Pages, sheets, cards and settling motion; sampled peak 1.015 (1.5% overshoot) |
| `--pop` | `linear(0, .071, .235, .436, .632, .801, .93, 1.018, 1.069, 1.092, 1.094, 1.082, 1.065, 1.046, 1.028, 1.013, 1.003, .996, .992, .991, .991, .993, .995, .996, 1)` | Ring pets, presses and the confirm sheet; sampled peak 1.094 (9.4% overshoot) |

Both become the `linear` timing keyword under reduced motion. T1b will supply the tuning engine and generate frozen curves from the chosen springs; this baseline preserves the current samples.

### 8.3 Named animations

| Name | Keyframes | Duration | Where |
|---|---|---|---|
| `rise` | from `opacity 0; translateY(10px); blur(4px)` to none | 900 ms (voice), 800 ms (card, +300 ms delay), 500 ms (turn) | Voice line spans (2nd span +160 ms), card, turns, hint (+600 ms) |
| `think` | the bottom glow's opacity .45 → 1 → .45 (HOME.md §7) | 3.2 s | Thinking edge light. (`breathe`, the calm edge's 9 s pulse, is gone: calm is steady, owner 2026-10-30) |
| `drift` | §7 | 38 s / 47 s | Field |
| `press` | scale 0.4 → 2.2, opacity 0 → 0.55 | 220 ms | Hold feedback |

The `rise` blur is small text-only `filter: blur(4px)`; keep it only if the A15 trace shows no long frame (see Open questions).

### 8.4 Reduced motion

Under `prefers-reduced-motion: reduce`:

| Thing | Becomes |
|---|---|
| Rise, breathe, think, drift, press | Off. Elements appear in their final state. |
| Edge light | Static at the state's resting value; thinking shows a steady brighter glow instead of a pulse. |
| Page and sheet moves | 150 ms opacity crossfade; swipes still track the finger. |
| Moving between shell pages (sign-in → home, the 404 → home) | Built: a 150 ms cross-fade instead of the default. Toward an app's page there is none (apps don't take part). |
| Press scale | Off. |
| Ring | Bubbles appear in place with a 120 ms fade. |
| Reply reveal | Whole text at once. |
| Haptics | Unchanged. |

Acceptance (built): with `reducedMotion: 'reduce'`, `document.getAnimations().filter(a => a.playState === 'running')` is empty 1 s after load on home.

### 8.5 The engine

**Built (T1b):** `frontend/th/motion.js` advances the exact damped oscillator from its current position and velocity over each real frame interval, clamped to 32 ms. Mass is 1, stiffness is `k` in 1/s², damping is the ratio `ζ`, angular frequency is `sqrt(k)`, and response is `2π/sqrt(k)` seconds. Underdamped, critical and overdamped cases share one requestAnimationFrame loop, which stops when idle. Retargeting carries velocity; a gesture can override it in units per second.

| Spring | k | ζ | Reference |
|---|---:|---:|---|
| page | 320 | .86 | Softer swipe settle; home scale and dim follow the same progress |
| pop | 900 | .55 | Ring opening, selection and chosen-pet fly-out; about 12.6% relative overshoot |
| ring | 1100 | .7 | Unchosen pets fall back to the finger on release |
| island | 130 | .82 | Fitted to the existing island expansion, including its shape hold |

Rest requires position within 1% of the move's travel and speed within 2% of travel per second; pixel moves have floors of .1 px and .5 px/s. Position-only time to 1% in trajectory comparisons is measured separately, after the last crossing, so overshoot is included. Scalar moves use relative thresholds without pixel floors. Reduced motion sets non-opacity values immediately; opacity reaches its target linearly in 150 ms. Haptics use existing call sites only: open `[8]`, choose `[4]`, commit `[10]`.

Gesture surfaces use `motion.js`; existing CSS state changes keep their frozen curve tokens. Home has one progress animator per swipe axis, direct finger tracking, velocity at release and continuous takeover. A time scale preserves the old page curve's 410 ms reference played over `--d-page`, including the existing 180–460 ms flick clock. The seven ring pets start together at scale .2 and radius 0: radius on `springs.pop` (~12.6% past 62 px and back), size on `springs.lift` (.2 → 1.06 → 1), each face's fade on `springs.fade`; they separately spring their chosen/other scale offsets to .12/−.06. Release sends the chosen pet to 1.25 radii and fades it; others return on `springs.ring`. A disc's flat face flies; its glass layer fades in on `--d-fast` (`.glassy`) once the discs pass 85% of the way out with falling speed, before they rest, and the disc itself never fades (GESTURES.md §3, "Motion route"). `.ring.moving` follows the engines’ resting flags. No filter is animated and the ring has no `will-change`. The name fades up under the ring as a compositor animation; the press ripple stops at the hold. Cleanup waits for every pet, with a generation guard for reopening; `whenResting()` also exposes engine-wide completion to browser checks. The island uses one scalar for its four clip insets and radius; swipe-down supplies velocity, and the existing decorative opacity/pill keyframes use token durations. Its hidden collapse uses a .622 time scale to fit the old, earlier clip endpoint. Settings pages slide on `springs.page` with the menu's clock and leave by a sideways drag too (GESTURES.md §4.4). The menu and Settings move on an opaque fill (`--panel` over `--bg`); their frosted layer fades in over it from 85% of the way in (`.frost`), then the fill fades out under it, so nothing behind ever shows through unblurred; held or covered, the fill comes back first. Under the ring, the menu and Settings the field's drift pauses (`.hush`). Boot imports menu and Settings code after the first paint and chat load, during idle (2 s timeout); menu preparation runs only when it exports `prepare()`. Settings home content is also parsed before opening, and menu rows have no entrance delay.

Open `/?feel` while signed in for the draggable, collapsible tuning sheet. It tunes all four springs, press scale/time, type base/ratio/hero/snap, density, haptics and reduced motion. Opening without saved tuning preserves the file values; changing a spring regenerates `--settle`, `--pop` and the page/pop duration tokens. Changes are stored locally at `th.lab.feel` and apply only while the panel is open. Collapse restores the prior inline styles and engine settings; Reset restores file defaults and removes saved tuning; `/?feel=off` clears it without loading the lab. Lab files are outside the offline precache. The collapsed **Frames** group records the last gesture: intervals over 16.7 ms and 32 ms, longest and p95 interval, long tasks where supported, and content-ready times for menu, Settings and all seven ring pets at 90% radius. It samples from app touch-down until 1,200 ms after the last pointer event. The first interval is the partial touch-down-to-first-frame delay, also shown separately, so a startup stall is counted. Menu and Settings slide timing starts at their first visible sampled frame; the ring hold marker comes from its opening class change. Copy tokens includes its JSON line. Collapsing the whole sheet removes the sampler and its listeners; without `?feel` none are installed. These are local rAF/content visibility observations; only a run on the Galaxy A15 establishes that phone’s frame budget.

**Freeze procedure:** tune on the phone, use **Copy tokens**, and review the complete CSS block (both type axes and the small/large Appearance overrides) plus its engine parameter comment. A follow-up PR copies the chosen values into `ui/tokens.css` and the four spring defaults into `motion.js`, then reruns the motion/type checks and phone trajectory comparison. Task A changes only the engine defaults; the frozen CSS curves and token values remain untouched. The original CSS curve tests use their original spring parameters. With the strict engine position-and-speed rest thresholds, the new pop rests at about 367 ms analytically (not the rough 250 ms target); it reaches 90% radius within 120 ms. The first ramp preview remains a deliberate tuning action.

## 9. Components

Built for the menu and Settings in Task B. `ui/forms.css` is the one control stylesheet;
`apps/settings/components.js` supplies shared DOM and sheet gestures. The older control entries
in §12 describe the earlier baseline; this table is authoritative for menu and Settings.

| Component | Anatomy | States and behavior |
|---|---|---|
| `.group` | `--glass-flat`, 1 px `--glass-line`, `--r-l` (22 px); hairlines inset 16 px; 12 px between adjacent groups | Title above: `--fs-label`/`--lh-compact`, weight 600, uppercase, .08em tracking, `--ink-3`, 16 px left inset and 8 px below |
| `.row` | Minimum 52 px, 16 px side padding; optional 24 px Phosphor icon in `--ink-2`; title `--fs-body`/`--lh-compact` weight 500, detail `--fs-small`/`--lh-compact` in `--ink-3`; trailing body-size value and 16 px caret | Press tint `--press` and `scale(var(--press-scale,.97))` on `--d-fast`; release `--pop`; shell focus ring. Destructive title in `--alarm`, no caret. Pinned conversation glyph is 16 px inside the icon column. |
| `.switch` | Labelled row, 46×28 track, full radius, off `--tint` with glass border, on `--accent-fill`; 24 px white knob with `--e2` | `role=switch`, `aria-checked`; knob travels 18 px on `--pop`/`--d-quick`; the full row supplies at least 44 px hit height |
| `.seg` | 36 px pill track in `--tint`; 2–4 options in `--fs-chip` weight 500; `--glass-flat` thumb with `--e1` | Thumb moves on `--settle`/`--d-base`; radio roles, checked state and arrow keys; option hit areas extend to 44 px |
| `.sheet` | Bottom sheet in `--sheet`, blur, `--r-xl` top corners, 20 px padding; 36×4 `--ink-3` grabber at .4 opacity; `--dim` backdrop | Page spring scaled to `--d-sheet`; drag past 30% or downward flick dismisses with its velocity, shorter drag returns. Escape, Cancel and backdrop dismiss; focus trapped while open and restored on close. |
| `.field` | At least 48 px, `--glass-flat`, `--r-row`, 1 px glass border, `--fs-input`/`--lh-compact`, `--ink-3` placeholder | Accent focus border/ring. Smaller uses the fixed `--fs-ask` input token to retain the 16 px floor. Textareas may grow. Qualified selectors distinguish inputs from the shell's ambient `.field`. |
| `.btn` | 48 px, full radius, body type weight 600. Primary accent/white, secondary flat glass/ink, quiet text-only accent | Same press/release as rows; disabled state; inline actions keep the same height |
| `.sback` | 40 px circle, flat glass, `caret-left`; invisible 2 px extension supplies 44 px hit area | Shell ring and press. Page title beside it: `--fs-page-title`/`--lh-page-title`, weight 600. Menu Settings uses `gear-six` in the same circle. |

Settings content scrolls under a stationary header whose hairline appears when scrolled. The
Appearance preview inherits the current theme and reply size. The menu keeps `--panel`, a steady
Now glow, day groups and a flat bottom bar. There are no native select controls; option pickers
use checked rows in the same sheet. Hidden Agents administration retains five radio rows for its
existing role flow. Page CSS contains layout and reading surfaces, not alternate controls.

No token values change. Spacing tokens (`--s-*`) do not exist in the current token file, so
geometry uses pixels. Motion and type always use existing tokens. Under reduced motion controls
appear in place; sheet opacity uses the shared engine's reduced-motion path.

### 9.1 Contrast requirements and checks

Measured with the WCAG 2.x formula against each token's worst background. "Worst field" is blob-1 at 60% over field-1 = `#c2d6f9`. "Glass" is `--glass` composited over that.

| Pair | Ratio | Needs | Result |
|---|---|---|---|
| ink `#152231` on bg | 14.22 | 4.5 | pass |
| ink on worst field | 10.3 | 4.5 | pass |
| ink-2 `#46566a` on worst field | 5.11 | 4.5 | pass |
| ink-3 built `#6d7988` on bg | 3.92 | 4.5 | **fail** |
| ink-3 built on worst field | 3.02 | 4.5 | **fail** |
| ink-3 proposed `#525d6b` on bg / worst field | 5.92 / 4.56 | 4.5 | pass |
| accent text built `#2468d8` on bg / worst field | 4.59 / 3.54 | 4.5 | **fail** on field |
| accent text proposed `#1a56bb` on bg / worst field | 6.00 / 4.63 | 4.5 | pass |
| white on `--accent-fill` `#2468d8` | 5.19 | 4.5 | pass |
| white on night accent built `#6aa2ff` (send button) | 2.55 | 3.0 (icon) | **fail** |
| gold-text built `#8a5a00` on worst field / glass | 4.04 / 5.02 | 4.5 | **fail** bare, pass on glass |
| gold-text proposed `#734a00` on worst field | 5.28 | 4.5 | pass |
| `#2b1d00` on gold | 9.01 | 4.5 | pass |
| gold `#f2b632` on day bg | 1.61 | — | never text; dot only (paired with text) |
| Night: ink / ink-2 / ink-3 on `#000` | 18.2 / 9.56 / 5.37 | 4.5 | pass |
| Night: ink-3 on night glass | 4.80 | 4.5 | pass |
| Night: accent `#6aa2ff`, gold on `#000` | 8.22 / 11.51 | 4.5 | pass |

The node test `tests/tokens-contrast.test.mjs` [proposal] parses `ui/tokens.css`, composites the glass tokens over the worst field, and asserts every pair listed in a `contrast-pairs.json`. Adding a text token without a pair fails the test.

## 10. The six app colours

Owner ruling: the ring, clockwise from the top, with Phosphor regular icons; seven since 2026-10-31 (Photos, between Study and Music).

| App | Colour (fill, icon) | Icon | On day bg | On `#000` | White icon on it | Text variant, day [proposal] |
|---|---|---|---|---|---|---|
| Music | `#2f7df6` | `music-notes-simple` | 3.45 | 5.39 | 3.90 | `#1f63d6` (4.87) |
| Guitar | `#e08a1e` | `guitar` | 2.37 | 7.82 | **2.68** | `#9a5800` (4.92) |
| Podcasts | `#e0457b` | `microphone` | 3.50 | 5.31 | 3.96 | `#b8295e` (5.28) |
| Astra | `#8b5cf6` | `monitor-play` | 3.74 | 4.96 | 4.23 | `#6d3fe0` (5.40) |
| My Media | `#14a39a` | `youtube-logo` | 2.76 | 6.74 | **3.12** | `#0a6f69` (5.32) |
| Study | `#2e9e5b` | `book-bookmark` | 3.01 | 6.16 | 3.41 | `#1c703e` (5.40) |
| Photos (2026-10-31; the photo editor comes later, so it says so when chosen) | `#0891b2` | `aperture` | 3.25 | 5.70 | 3.68 | [proposal] `#0e6f8a` |

Rules:

1. The six hex values are locked. They are used as **fills and icon colours** only.
2. When an app colour is used as **text** (briefing tile labels, chip labels) in day theme, use its `--app-<id>-text` variant above. In night theme the base colour is used, except Astra's label on night glass (4.43:1), which needs a lighter variant [proposal: `#9f7bf8`, to be confirmed by the contrast test].
3. **Selected ring bubble:** the first build draws a white icon on the colour at 88%. Over the day background that is 2.42:1 for Guitar, 2.77 for My Media and 2.97 for Study, under the 3:1 needed for icons. The label pill under the ring names the app, so the choice is still readable, but [proposal] fill the selected bubble at 100% and use `--ink` icons on Guitar, My Media and Study (5.99, 5.16, 4.72). Owner to choose; see Open questions.
4. Unselected bubble icons on day glass are 2.6–4.1:1. They are identified by position and by the label on selection; this is accepted for the ring only.

## 11. Layers (z-index)

| Token | Value | What |
|---|---|---|
| `--z-field` | 0 | Field and grain |
| `--z-page` | 2 | Home and briefing pages, conversation |
| `--z-top` | 5 | Date line |
| `--z-edge` | 6 | Edge light (pointer-events none) |
| `--z-bar` | 7 | Ask bar |
| `--z-sheet` | 8 | `+` sheet, ring scrim |
| `--z-ring` | 9 | Ring, press feedback |
| `--z-menu-dim` | 11 | Dim beside the menu |
| `--z-menu` | 12 | Menu panel |
| `--z-popover` | 13 | Long-press action menu, confirm sheets [proposal] |
| `--z-toast` | 14 | Toast |
| `--z-skip` | 15 | Visually hidden skip buttons when focused [proposal] |

## 12. Components

Each component lives in `ui/components.css` (and a tiny JS helper where needed). Sizes are hit areas.

| Component | Anatomy and exact values | States |
|---|---|---|
| **Owner bubble** | Right-aligned, max-width 80%, padding 9/14, radius 19 19 6 19, flat glass, `--t-body`, `--ink` | sending (opacity .7), sent, queued offline (meta line "Sends when you're back online"), failed (meta "Didn't send · Retry" in `--alarm`) |
| **Mind reply** | Left, no bubble, `--t-voice-reply`, `--ink`, `text-wrap: pretty`, rich text and up to four blocks (HOME.md §4.3) | waiting (thinking words, HOME.md §4.4), revealing, done, collapsed long reply ("Show all") |
| **Decision card** | Docked just above the ask bar while one waits (owner, 2026-10-31, option C; th/decide/card.js), the conversation ending above it. Live glass, radius 22, padding 14/16, E2. "Why" line: 7 px gold dot with 3 px 28% gold halo + `--t-label` `--ink-3`. Question: Inter 500 16/1.42. Buttons row gap 8, margin-top 13 | rising, waiting, deciding (spinner in the pressed button), folded (opacity 0, scale .97, height 0 over 450 ms, +120 ms delay), error (inline line under buttons) |
| **Decision buttons** | Pills, padding 10/17 (≥ 44 px tall hit area), Inter 600 14. Yes: gold fill, `--gold-ink`, inner highlight, gold shadow. Secondary: `--tint` fill, `--ink-2` | rest, pressed (scale .96, 150 ms), busy, disabled (opacity .5) |
| **Action chip** | Inline-flex, padding 8/12/8/10, radius 14, flat glass, `--t-chip`, 17 px app-coloured icon, gap 7 | rest, pressed (scale .97), opening |
| **Ask bar** | See [HOME](../product/HOME.md) §6. 54 px pill, live glass, `+` 40 px disc left, input, 42 px mic/send slot right | idle, focused, typing (send shown), listening, recording-memo, offline, disabled (signed out) |
| **Sheet (`+` and action menu)** | Live glass `--sheet`, radius 26, padding 8, E3, min-width 220, items: 36 px tinted icon disc + Inter 500 16, padding 8/14/8/8, radius 16 | closed (`translateY(16px) scale(.5)`, opacity 0, origin bottom-left), open (spring), items stagger 28 ms bottom-up |
| **Bottom confirm sheet** [proposal] | Full width minus 16 px, radius 26, live glass, title Inter 600 16, body `--t-small`, two full-width 48 px buttons: destructive action in `--alarm` text, "Keep" in `--ink` | open, busy, closed |
| **Toast** | Built 2026-10-31: just above the ask bar (or a docked card), under the thumb with its Undo, z above Settings pages. Was top centre, `top: 58px + safe-area`, padding 9/14, radius 12, `--disc` + `--disc-line`, `--t-chip`, centred text, max width `calc(100% - 32px)`, **at most 2 lines** (built 2026-10-30, with an optional action such as Undo, which keeps it 3 s: hiding a Briefing tile, pinning a conversation), `role="status"`, `aria-live="polite"`. Copy limits in [COPY](COPY.md) §3 | in (opacity + 8 px slide, 250 ms), shown 1,700 ms (built) / 3,000 ms when it carries an action [proposal], out. One at a time; a new toast replaces the old |
| **Row** | Full width, padding 10/8, radius 12, 18 px icon (`--c`), title Inter 500 15 ellipsis, optional meta `--t-label` `--ink-3`, optional 14 px chevron | rest, hover/pressed (`--tint`), current (`--tint`), disabled ("soon" meta) |
| **Segmented control** | Track `--tint`, padding 3, radius 12; items flex 1, padding 8/0, radius 9, Inter 500 13 `--ink-2`; selected: `--disc` fill, `--ink`, `0 1px 3px rgba(0,0,0,.14)` | as `role="radiogroup"` with `aria-checked` [proposal: built uses plain buttons] |
| **Tile** | Flat glass, radius 22, padding 14/15, E1; key line (16 px icon + Inter 600 12 in app text colour), value `--t-body` 500, detail `--t-small` `--ink-3`, optional `--t-big`. `.wide` spans both columns | rest, pressed, gold (1 px inset gold ring at 50%), stale (detail shows "as of 14:10"), empty (hidden) |
| **Buttons** | Primary filled: `--accent-fill`, white, pill, 44 px min. Gold: decision only. Secondary: `--tint`. Text button: `--accent-text`, no fill, 44 px hit area. Icon button: 44 px circle, 20 px icon | rest, pressed scale .96, focus-visible 2 px `--accent-fill` outline offset 2, disabled .5 |
| **Toggle** [proposal] | `<input type="checkbox" role="switch">`, 51×31 track, `--accent-fill` when on | on, off, disabled |
| **Settings page** | Built. Slides in over home on `--settle`, opaque `--bg` with the field still behind it (no drift, no blur). 44 px round flat-glass back button (arrow-left, "Back to Settings"), title Inter 600 30/1.15 that takes focus on open. Section labels small caps 11 px `--ink-3`. Lists and actions are flat-glass groups (radius 22, E1) of 48 px rows; a destructive row in `--alarm` | open, closing (480 ms, then removed) |
| **404** | Built. The field and grain, the voice line "Nothing here." in Fraunces italic, one flat-glass pill "Back home" | — |
| **Visually hidden skip buttons** | "Apps", "Briefing", "Menu": clipped until focused; then a 44 px glass pill at top-left | hidden, focused |

## 13. Icons

- Source: `@phosphor-icons/core` (MIT), **regular** weight only. Names used are listed in `ui/icons.txt`; `scripts/icons.mjs` builds `ui/icons.svg` (`<symbol id="<name>">`), committed.
- Use: `<svg class="i" aria-hidden="true"><use href="/ui/icons.svg#guitar"/></svg>`. No inline path maps (the first build's inline `<path>`s and the `I` map in `home.js` go).
- Sizes: 16 (tile key), 17 (chip), 18 (rows, search), 19 (sheet discs), 20 (buttons), 28 (ring).
- Colour: `fill: currentColor`. Never a second colour in one icon.
- Every icon-only button has `aria-label`.
- Current set: the six app icons, `plus`, `microphone`, `arrow-up` (send), `camera`, `image`, `file-text`, `waveform`, `alarm`, `magnifying-glass`, `moon-stars`, `bell`, `brain`, `plugs-connected`, `user-circle`, `caret-right`, `arrow-left`, `x`, `copy`, `question`, `cloud-sun` (weather), `warning-circle`, `wifi-slash`, `devices`, `key`, `download-simple`, `info`, `trash`, `pencil-simple`, `push-pin`, `device-mobile`, `chat-circle`, `newspaper`, `clock`, `play`, `stop`, `check`.

## 14. Hit areas

Every interactive icon gets a 44×44 hit area even when drawn smaller (the `+` disc is drawn at 40 px; its hit area is extended with a transparent 2 px outline region or `::before` inset −2 px).

## Open questions / tests

| Question | How to settle it |
|---|---|
| Accept the darker day `--ink-3`, `--accent-text` and `--gold-text`? They change the look slightly. | Owner looks at a side-by-side screenshot (built vs proposed) in day theme. |
| Selected ring bubble for Guitar, My Media and Study: keep white icons (2.4–3.0:1) or switch to ink icons (≥ 4.7:1)? | Owner picks from two screenshots. |
| Does the `rise` animation's `blur(4px)` or the `+`-sheet `blur(8px)` behind it cost a long frame on the A15? | DevTools performance trace on the device during a voice-line change and `+` open; drop the blur if any frame > 16 ms. |
| How many live-glass layers can the A15 hold at 60 fps? | Trace scrolling a 30-turn conversation with 0, 2 and 6 `backdrop-filter` layers. |
| Fraunces SOFT axis: the prototype set `"SOFT" 50`; the self-hosted file is instanced at SOFT 50. Confirm the shipped file looks identical to the prototype. | Screenshot diff of the voice line, prototype vs build. |

Accessibility (2026-10-30): axe-core 4.10 finds no violations on home, the menu, the Briefing, Settings (Devices, What I remember), sign-in, setup, recover and the 404 (contrast checked by hand, as axe misreads text over gradients). The `+` sheet's buttons are menu items; home is a `main` landmark and the Briefing a labelled region; the theme, text size and accent controls are radio groups that move with the arrow keys; Still background is a switch. `.app` clips rather than hides its overflow, so focus or scrolling into the closed menu can never shift the page sideways.
