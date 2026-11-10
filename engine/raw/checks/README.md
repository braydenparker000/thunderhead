# Check scripts

The headless checks the editor and engine are built against: Playwright driving Chromium on a software GPU
(`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`), the editor opened with `?readback`. Not run by Test:
they take minutes each and need RAFs that are not in the repository.

To run them: serve the site (`node scripts/serve.mjs`, port 8080), put sample RAFs beside these scripts as
`raf/DSCF0021.RAF` (a landscape frame) and `raf2/X100VI__DSCF0074.RAF` (a portrait one; any X-Trans RAF does, name
it with `FILE`), make `shots/` and `out/`, and run one, or several one at a time:

```bash
node engine/raw/checks/ui2.cjs
engine/raw/checks/snap.sh && engine/raw/checks/sweep.sh A http://127.0.0.1:8081 ui2 g5 m6 z1 z1:p   # ":p": on the portrait RAF
```

Each prints PASS or FAIL lines and ends ALL PASS. One at a time only: two at once on the software GPU give false
failures. A check waits for what it reads (`session.busy()`), never for a fixed time. `.gitignore` here keeps the
RAFs, the snapshot and the outputs out of the repository.

| Script | What it drives |
|---|---|
| `ui2` | Edit: the drum, the dial (drag, flick, two taps, Auto), profiles as a strip, the photo kept across boards |
| `g5` | Curve, mixer, grading, effects, each against what the engine should do |
| `g6` | Looks: importing `.cube` files, wearing and deleting looks (needs `cubes/`: small test tables) |
| `m6`, `b6` | Masks: gradients and ranges; the brush |
| `h7` | Heal, Clone, Visualize, undo and clear |
| `cr`, `cr2` | Crop: what the engine draws against the board; its gestures |
| `z1`, `z7` | Zoom to 55 %, 100 %, 300 % with the detail aligned; the View board; zoom on the tool boards |
| `lb` | Library: import, flags, delete |
| `e5` | A full-size export (slow: about 20 minutes here) |
| `tx` | How far the 100 % view, averaged three by three, is from the editing copy with Texture, Clarity, Shadows on |
| `dz`, `dbg` | A 100 % screenshot about a point; a full-size view driven directly with the GPU's errors printed |
| `sp`, `sp2` | A sample page (no photo) as a picture, plain or after a button |
| `sync.py` | Brings the sample pages' templates up to date with `frontend/lab/editor/index.html`: run it after changing a template |
