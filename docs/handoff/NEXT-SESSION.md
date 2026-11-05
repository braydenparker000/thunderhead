# NEXT SESSION — Thunderhead Photos, handoff 2026-11-05 (end of day 2)

This folder is the loop's working state, kept in the repository so a fresh session anywhere (a codespace, a laptop, a cloud session) can pick up without the previous session's scratch files. Nothing private lives here.

Read this first. The repo is braydenparker000/thunderhead, main at 714cb15 (all PRs through #68 merged, all deploys green).

## State
Photos first version is live end to end: shelf + Drive store (#57), RAW engine + Light/Color/Effects/Detail (#58), crop/optics/versions/export (#59), copy/paste (#60), From Drive picker (#61), background upload (#62), zoom/export fixes (#63), shelf stacks/stars/filters/culling (#64), colour foundation (#65: matrix fitted from the camera JPEG, ΔE 24→5, local highlights/shadows, hold-to-compare, wipe), looks library (#66: saved looks, .xmp import, paste a recipe), speed (#67: half-size first frame, four-core decode via a COOP/COEP service-worker shim on the editor page only, wasm 108→40 MiB), info panel (#68: EXIF + Fuji maker notes, no GPS ever). Core schema at step 46.

Design prototype (dial, screens, spacing, variants) is published privately: (a private artifact link the owner holds) — keep private (Switzer licence). Icon options page: (a private artifact link the owner holds) Owner chose icon option 2 (our own set, Photos first).

## Owner rulings (do not re-ask)
Neutral default for RAW (no film sim); every slider a dial (ruler under a fixed pointer, snap at 0 and round numbers, fine on slow drags, double-tap reset keeps, no haptics); RAW+JPEG pairs as one tile; stars/heart; grading both ways (three wheels + Fuji-style panel); recipes from Fuji X Weekly by pasting text, .xmp presets by import, no leaving the site; info = everything, but no location/map; A35 is the benchmark phone; 2–3 s to a frame is the target, 5 max; no Adobe asset/icon/name/preset name; no model names in the repo; no real photos committed; drive.file scope only.

## Awaiting the owner
Phone checks: "Decoded in" number in the editor title on the A35; From Drive; locked-screen RAF import; Looks; Info; stars/filters. Prototype picks: tool row A/B, dial A/B, panel bar A/B, accent (teal/blue/gold), exposure tick (1/30 EV in the prototype), 2 px tile gap.

## Next steps, in order (each: builder (the mid-tier model at extra-high effort) → verifier (the small model) → PR → merge on green → Deploy → "live")
1. P3a icons + dial: option 2 icons (docs/handoff/icons-custom.json + icons-proto.json, 65 icons) into Photos; every slider as the dial per the prototype's numbers (6 px/unit, detents, gain curve); dial A unless the owner picked B.
2. P3b layout + spacing from the prototype's Spec screen, after the picks.
3. P6 grading both ways. 4. P8 masks (linear, radial, brush). 5. P5b learned film simulations from RAW+JPEG pairs (read film mode 0x1401; learn only from Provia/Astia; running median over 5 photos). 6. Colour-checker calibration (optional, true colour).
Tidy pass: wall-clock tests (settings-second brief claim near 04:00 UTC), back-button/scroll test across the editor's full page load, five biome warnings, convos-browser scroll wait, Settings › Photos browser test under load.
Stray branch for the owner to delete: claude/mind-verbs-2-ci.

## Loop rules learned (keep)
- Every agent works in its own git worktree (../wt/<branch>), links node_modules, copies the gitignored Switzer font; never the shared checkout.
- Builders: read brief-common.md then their brief; branch from origin/main; every source file ≤299 lines; run what CI runs; merge origin/main before push and re-run only touched suites; report once, after all their runs finish; cost pins measured, never guessed; What's new card ≤4 lines ≤120 chars dated today.
- Lead: open the PR the moment a builder pushes (CI parallel with the verifier); merge only when both are green; merge commits never squash; after a resolution script, grep for conflict markers before committing; a known flake not touched by the diff gets one re-run, a second failure is real; keep a standing 20–30 min check-in while agents run so a container restart never strands the loop.
- Usage: a builder run ≈ 250–400k tokens (the mid-tier model), a verifier ≈ 70–100k (the small model). At most two builders in parallel, on disjoint files.

## Files beside this one (docs/handoff/)
brief-common.md, verifier.md, progress.md, brief-design-photos.md, PHOTOS-PLAN.md, photos-proto.html (the interactive prototype), icons-custom.json, icons-proto.json. The owner holds the private prototype link; the HTML here is the same page.
