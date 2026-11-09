# The editor's command dial (docs/design/EDITOR.md, "The dial"), ray traced: a matte black anodized
# wheel with a cut diamond knurl standing proud of the camera plate through a slot, with the dial's soft
# shadow on the plate, the lip's shadow on the dial and the dark gap traced together. The plate is
# view-independent, so the dial strip and the plain plate meet without a seam.
#   python3 -I render.py <name> <scale> <frames> <radius css px>      writes <name>-sprite.png, <name>-frame0.png
# The two assets in docs/design/editor/assets/ (then to .webp, the strip at quality 88, the plate lossless):
#   ROLL=0 CH=150 python3 -I render.py dial-strip 4 12 240           412x150 css per frame, 12 frames per knurl
#   PLAIN=1 CH=315 ROLL=4 python3 -I render.py plate 3 1 240         the plate behind everything, 412x315 css
# Needs numpy and Pillow; the 12-frame strip takes about five minutes on one core.
import os
import sys
import numpy as np
from PIL import Image, ImageFilter

name, S, FRAMES = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
SS = 3
PLAIN = os.environ.get('PLAIN') == '1'      # plate only: no slot, no dial (the rest of the deck)
CW, CH = 412, int(os.environ.get('CH', '108'))
HCX, HCY = 206, 54                # slot centre, css
R_CSS = float(sys.argv[4]) if len(sys.argv) > 4 else 300.0                     # dial radius in css px
ZP = float(np.sqrt(1 - (180 / R_CSS) ** 2))                         # plate surface: the dial stands 0.2 R proud of it
HH = 33 / R_CSS                   # half height of the dial
GX, GY = 0.010, 0.016             # gap round the dial, in R
HXH = np.sqrt(1 - ZP * ZP) + GX   # slot half width
HYH = HH + GY
RR = 0.03                         # slot corner radius
T = 0.10                          # plate thickness
D = 5.0                           # eye distance
RIDGES, SLOPE, LAND = int(round(2 * np.pi * R_CSS / 21)), 0.75, 0.34
CHAM, ROLL = 2.0 / R_CSS, float(os.environ.get('ROLL', '4.0'))     # chamfer (R), rolled top edge (css)
KEY = np.array([-0.2, 0.85, 1.0]); KEY /= np.linalg.norm(KEY)
FILL = np.array([0.5, 0.2, 1.0]); FILL /= np.linalg.norm(FILL)
W, H = CW * S, CH * S

def norm(v):
    return v / np.linalg.norm(v, axis=-1, keepdims=True)

def slot_sd(x, y):                # signed distance to the slot outline in the plate plane (R units)
    qx, qy = np.abs(x) - (HXH - RR), np.abs(y) - (HYH - RR)
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - RR

def dial_blocks(p, l):            # does the segment from p toward light l pass through the dial body?
    A = l[..., 0] ** 2 + l[..., 2] ** 2
    B = 2 * (p[..., 0] * l[..., 0] + p[..., 2] * l[..., 2])
    C = p[..., 0] ** 2 + p[..., 2] ** 2 - 1
    disc = B * B - 4 * A * C
    sq = np.sqrt(np.clip(disc, 0, None))
    t0 = np.maximum((-B - sq) / (2 * A + 1e-12), 0)
    t1 = (-B + sq) / (2 * A + 1e-12)
    ok = (disc > 0) & (t1 > 0)
    y0, y1 = p[..., 1] + t0 * l[..., 1], p[..., 1] + t1 * l[..., 1]
    return ok & (np.minimum(y0, y1) <= HH) & (np.maximum(y0, y1) >= -HH)

rng0 = np.random.default_rng(11)
SKEY = norm(np.array([-0.2, 0.45, 1.0]))    # shadows from a lower, more frontal key so they stay short
LIGHTS = [norm(SKEY + rng0.normal(0, 0.22, 3)) for _ in range(16)]   # soft key: a small area light
GRAIN = np.array(Image.fromarray(rng0.normal(128, 40, (H * SS, W * SS)).clip(0, 255).astype(np.uint8))
                 .filter(ImageFilter.GaussianBlur(0.5 * SS * S / 4))) / 128.0 - 1

def shade_rows(r0, r1, phase):
    jy = (np.arange(r0, r1) + 0.5) / (S * SS)
    jx = (np.arange(W * SS) + 0.5) / (S * SS)
    CX, CY = np.meshgrid(jx, jy)
    grain = GRAIN[r0:r1]
    px, py = (CX - HCX) / R_CSS, (HCY - CY) / R_CSS
    eye = np.array([0, 0, D])
    d = norm(np.stack([px, py, np.full_like(px, ZP - D)], -1))
    view = -d
    dx, dy, dz = d[..., 0], d[..., 1], d[..., 2]
    # dial
    A = dx * dx + dz * dz; B = 2 * D * dz; C = D * D - 1
    disc = B * B - 4 * A * C
    tc = (-B - np.sqrt(np.clip(disc, 0, None))) / (2 * A)
    yc = tc * dy
    hit_d = (disc > 0) & (np.abs(yc) <= HH) & (not PLAIN)
    # plate front, slot wall, cavity
    tp = (ZP - D) / dz
    xp, yp = tp * dx, tp * dy
    sdp = slot_sd(xp, yp)
    on_plate = (sdp > 0) | PLAIN
    tb = (ZP - T - D) / dz
    on_wall = ~on_plate & (slot_sd(tb * dx, tb * dy) > 0)
    use_d = hit_d & (~on_plate | (tc < tp))
    use_p = ~use_d & on_plate
    # ---------- dial shading
    P = eye + tc[..., None] * d
    phi = np.arctan2(P[..., 0], P[..., 2])
    pitch = 2 * np.pi / RIDGES
    u = phi / pitch + phase
    v = (yc + HH) / pitch
    a, b = (u + v) % 1.0, (u - v) % 1.0
    da, db = np.minimum(a, 1 - a), np.minimum(b, 1 - b)
    hgt = np.minimum(da, db) / 0.5
    sa, sb = np.where(a < 0.5, 1.0, -1.0), np.where(b < 0.5, 1.0, -1.0)
    on_a = da < db
    gu, gv = np.where(on_a, sa, sb), np.where(on_a, sa, -sb)
    land = hgt > (1 - LAND)
    gu, gv = np.where(land, 0, gu), np.where(land, 0, gv)
    rl = (hgt - 0.5) * 0.9
    gu, gv = gu * (1 + rl * 0.6), gv * (1 + rl * 0.6)
    groove = hgt < 0.2
    gu, gv = np.where(groove, gu * 0.2, gu), np.where(groove, gv * 0.2, gv)
    ridge = np.clip(1 - np.abs(da - db) / 0.035, 0, 1) * (~land)
    n0 = np.stack([np.sin(phi), np.zeros_like(phi), np.cos(phi)], -1)
    tu = np.stack([np.cos(phi), np.zeros_like(phi), -np.sin(phi)], -1)
    tv = np.stack([np.zeros_like(phi), np.ones_like(phi), np.zeros_like(phi)], -1)
    n = norm(n0 - SLOPE * (gu[..., None] * tu + gv[..., None] * tv))
    n = norm(n + np.stack([grain, np.roll(grain, 5, 1), np.roll(grain, 9, 0)], -1) * 0.035)
    def ndl(nn, l): return np.clip(np.sum(nn * l, -1), 0, 1)
    def spec(nn, l, p):
        return np.clip(np.sum(nn * norm(l + view), -1), 0, 1) ** p
    # the plate's lip shades the part of the dial that sits below the plate surface
    lit = np.zeros_like(px)
    for L in LIGHTS:
        tt = np.clip((ZP - P[..., 2]) / L[2], 0, None)
        q = P + tt[..., None] * L
        lit += ~((P[..., 2] < ZP) & (slot_sd(q[..., 0], q[..., 1]) > 0))
    lit /= len(LIGHTS)
    depth = np.clip((ZP - P[..., 2]) / 0.12, 0, 1)                 # sinking into the slot
    amb = 1 - 0.75 * depth
    direct = 0.012 * ndl(n, KEY) + 0.12 * spec(n, KEY, 5) + 0.26 * spec(n, KEY, 24) \
        + ridge * 0.10 * ndl(n0, KEY) + land * 0.22 * spec(n, KEY, 8)
    fillc = 0.006 * ndl(n, FILL) + 0.04 * spec(n, FILL, 8)
    kao = np.where(groove, 0.12, 0.45 + 0.55 * np.clip(hgt * 1.8, 0, 1))
    lum_d = (direct * lit + fillc * amb + 0.004 * amb) * kao * amb
    lum_d *= 0.8 + 0.2 * np.clip((yc + HH) / (2 * HH), 0, 1)
    # ---------- plate shading
    sdc = sdp * R_CSS                                              # css px from the slot edge
    cham = on_plate & (sdc < CHAM * R_CSS) & (not PLAIN)
    ex = np.gradient(sdp, axis=1); ey = np.gradient(sdp, axis=0)   # outward in (x, -row) terms
    el = np.hypot(ex, ey) + 1e-12
    ex, ey = ex / el, ey / el
    nx = np.where(cham, -ex, 0.0); ny = np.where(cham, ey, 0.0)   # rows go down, y goes up
    roll = (CY < ROLL) & (ROLL > 0)
    tr = np.clip(1 - CY / max(ROLL, 1e-6), 0, 1)
    ny = np.where(roll, np.sin(tr * np.pi / 2) * 1.6, ny)
    nx = nx + grain * 0.05; ny = ny + np.roll(grain, 7, 1) * 0.05
    npl = norm(np.stack([nx, ny, np.ones_like(nx)], -1))
    Pp = eye + tp[..., None] * d
    sh = np.zeros_like(px)
    for L in ([] if PLAIN else LIGHTS):
        sh += ~dial_blocks(Pp, np.broadcast_to(L, Pp.shape))
    sh = sh / len(LIGHTS) if not PLAIN else np.ones_like(px)
    # contact darkening on the plate right round the slot
    ao_p = 1 - 0.45 * np.exp(-np.clip(sdc, 0, None) / 3.0) * (not PLAIN)
    hvp = KEY + np.array([0, 0, 1.0]); hvp /= np.linalg.norm(hvp)     # flat plate: same look wherever it is on screen
    ndh = np.clip(np.sum(npl * hvp, -1), 0, 1)
    lum_p = (0.0035 + (0.004 * ndl(npl, KEY) + 0.006 * ndh ** 8) * sh
             + (0.30 * ndh ** 40 + 0.05 * ndl(npl, KEY)) * sh * (cham | roll)) * ao_p
    # ---------- gap: slot wall then the dark cavity behind the plate
    lum_w = np.where(on_wall, 0.0022, 0.0008)
    lum = np.where(use_d, lum_d, np.where(use_p, lum_p, lum_w))
    lum *= 1 + 0.04 * grain
    rgb = np.stack([lum * 0.97, lum * 0.985, lum], -1)
    rgb = 1 - np.exp(-rgb * 1.6)
    return np.clip(rgb, 0, 1) ** (1 / 2.2)

def frame(phase):
    rows = []
    step = SS * 24
    for r0 in range(0, H * SS, step):
        rows.append(shade_rows(r0, min(r0 + step, H * SS), phase))
    img = np.concatenate(rows, 0)
    img = img.reshape(H, SS, W, SS, 3).mean(axis=(1, 3))
    return (img * 255 + 0.5).clip(0, 255).astype(np.uint8)

frames = [frame(f / FRAMES) for f in range(1 if PLAIN else FRAMES)]
Image.fromarray(frames[0]).save(f'{name}-frame0.png')
Image.fromarray(np.concatenate(frames, 0)).save(f'{name}-sprite.png', optimize=True)
print(name, W, H, FRAMES)
