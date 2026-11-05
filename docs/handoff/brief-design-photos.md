# Design step — Photos: the editor prototype (dial, screens, spacing) as one interactive page

Not a repository change. Deliverable: ONE self-contained HTML file at docs/handoff/photos-proto/index.html (inline CSS and JS, no external scripts, fonts inlined as data URIs from the repository/frontend/ui/fonts/ with a real fallback stack, images drawn in CSS or canvas, never a real photograph). The lead publishes it as an artifact the owner opens on a Samsung A35 (390×844) in Chrome. It must work by touch.

## Why (owner, 2026-11-05)
The app works but its layout "feels simple": spacing and hierarchy are the giveaway, not the rounded cards. The owner chose a custom icon set (option 2) and wants the dial, the screens and the spacing decided properly on the phone before any of it is built. Lightroom mobile's layout is the reference the owner knows (study: docs/handoff/PHOTOS-STUDY-lightroom-mobile.md §1); we clone the ideas in our design system, never Adobe's assets, icons, names or preset names.

## Read first
- The study above (layout, gestures, panel order) and PHOTOS-DESIGN-2026-11-04.md (our earlier design page) in the same folder.
- Our tokens: the repository/frontend/ui/tokens.css (type scale `--fs-*`, motion `--ease-*`, durations), shell.css, fonts.css (Switzer). Reuse the names; propose new Photos-only tokens where needed and list them on the Spec screen.
- The icon set: docs/handoff/icons-demo/custom.json (40 icons, 24 grid, 1.6 stroke, round caps) and the published page's look (icons-demo/photos-icon-options.html). Draw any missing icon in the same style and add it to a copy of custom.json beside the prototype.
- The app as built, for what exists: the repository/frontend/apps/photos/*.js, edit/*.js, photos.css, edit.css (read, do not change).

## Owner rulings to design to
- Neutral dark editing UI: greys with no tint so colour reads true; one accent for the active control.
- Every slider is a dial: a ruler scrolling under a fixed pointer, ticks per unit, major ticks at round numbers, magnetic snap at 0 and at sensible numbers (±10, ±25, ±50, ±100 for ±100 ranges; whole stops and thirds for exposure ±5), a tiny overshoot on each detent so a tick reads as a click, slow drag = fine (about 1 unit per 6 px), fast drag accelerates, double-tap resets, the value shown above the pointer while dragging. No haptics. It should feel like the X-E5's clicky command dial. Make it REAL in the prototype: pointer events, inertia, snapping, the value live.
- Screens to prototype, all at 390×844 with safe areas: Shelf (grid, day headers, RAW+JPEG pairs as one tile with a small badge, stars, select mode bar), Editor (photo area, the dial, the tool row, the panel bar: Light, Color, Effects, Detail, Optics, Crop, Looks; one tool at a time), Crop (frame, aspect presets, rotate dial, level, flip, perspective), Looks (a grid of looks with thumbnails, sections: Camera, Recipes, Imported), Info (all metadata: camera, lens, exposure triangle, film simulation, dynamic range, white-balance shift, grain, colour chrome, histogram, file, Drive status), Export sheet, Versions filmstrip + compare, Copy sheet. Plausible example content, clearly example (no personal data).
- Variants where the decision is open, switchable from a small toggle at the top of the prototype so the owner can compare on the phone: (A) tool row = icon over label vs (B) label only in a horizontal scroller; dial (A) ruler under pointer vs (B) ruler with a value bubble that follows the pointer; panel bar (A) icon over label vs (B) icons only with the active one labelled.
- Spacing on a 4-pt grid with a stated rhythm: write the exact measures (heights of the panel bar, tool row, dial; gutters; tile gaps; type sizes and weights; radii; the accent and the five greys) on a final "Spec" screen in the prototype itself, so a builder can implement from it.
- Motion: panel changes, sheet rise, dial detents, with our easings; respect prefers-reduced-motion.
- Copy: short, plain, ours. No Adobe names, no preset names, no model names anywhere in the file.

## How to work
Build, then look at it in headless Chromium at 390×844 (Playwright is installed; screenshots of every screen and both variants), fix what is wrong, look once more. Keep the file under 600 KB with fonts. Report in at most 15 lines: the path, the screens and variants, the dial's exact behaviour (numbers), the spec's key measures, and anything you decided that the owner should rule on.

Budget: about 80 tool calls; stop at 120 and report.
