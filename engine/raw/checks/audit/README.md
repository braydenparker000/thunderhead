# The audit's scripts (2026-11-15)

What [../../AUDIT.md](../../AUDIT.md)'s measurements were made with, kept so a finding can be shown again and a
fix proved against the same numbers. Run by hand; none is part of Test. They drive the real editor in headless
Chromium on a software GPU, as the browser tests do.

```bash
export CHROMIUM_PATH=/opt/pw-browsers/chromium
export AUDIT_OUT=/tmp/audit/out        # where pictures are written: never inside the repository
export AUDIT_RAF=/tmp/audit/raf/DSCF0021.RAF   # a 40 MP X-Trans RAF kept outside the repository (HANDOFF.md says where from)
mkdir -p "$AUDIT_OUT"
node engine/raw/checks/audit/raf4.mjs
```

| Script | What it shows | Finding |
|---|---|---|
| `open.mjs` | the editor at a phone's size with a JPEG drawn by the page; the others build on it | |
| `rafkit.mjs` | a real RAF opened through the Library's Import sheet, and `crop()`: any rectangle at full size, by the usual demosaic (`false`), the network (`true`) or the first look alone (`'once'`) | |
| `dial2.mjs` | the dial's wheel watched for three seconds after a finger lifts | 1.1 |
| `exact.mjs` | every grey level and strong colours exported with nothing moved, against themselves | 1.3 |
| `resize.mjs` | a zone plate reduced by an area average and by Lanczos (plain node, no browser) | 1.4 |
| `raf3.mjs <file> <tag>` then `speckle.py <tag>` (run in `$AUDIT_OUT`) | the usual demosaic against the network at the left edge, centre, right edge and a corner; fine colour speckle of each | 3.1 |
| `raf4.mjs` | the same place made from two rectangles (a seam?), and what a dial's frame costs zoomed in: fitted pass, full-size view, both | 3.2, P.1 |
| `raf6.mjs` | Auto level pressed three times | 4.1 |
| `raf7.mjs` | every kind of file an export writes, from a crop of the RAF, into `$AUDIT_OUT/files` for checking with other tools | Part 5 |
| `raf8.mjs` | before/after and press-and-hold on a cropped photo; the Looks and Export boards | 8.4 |
| `lib.mjs` | twelve RAFs in the Library (`AUDIT_RAFS`: a folder of them): the decodes its tiles cost | 8.1 |
| `dial-fix.patch` | the fix for 1.1 and 1.2 that was written and set aside, with its test: `git apply` it | 1.1, 1.2 |

`speckle.py` needs Pillow and numpy. A RAF of the owner's is fetched with `node scripts/workshop.mjs` and stays
outside the repository, with every picture made from it.
