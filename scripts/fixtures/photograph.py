"""Photographs the flat synthetic tickets: puts each paper ticket on a surface and
degrades it the way a phone camera would, recording where its corners land.

  .venv/bin/python scripts/fixtures/photograph.py

Writes fixtures/synthetic/photos/<ticket>__<variant>.jpg and photos.json with, per
photo, the four corners (TL, TR, BR, BL in the ticket's own orientation) and the
conditions applied. Deterministic: every random draw comes from a seed derived
from the photo's name.
"""
import json
import zlib
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
FLAT = ROOT / "fixtures/synthetic/flat"
OUT = ROOT / "fixtures/synthetic/photos"
OUT.mkdir(parents=True, exist_ok=True)
truth = json.loads((ROOT / "fixtures/synthetic/truth.json").read_text())

PAPER = [k for k, v in truth.items() if v["kind"] == "paper"]

# Variant plan: each ticket is shot six ways. The white desk is the hard case for
# edge detection (white paper on a white surface); low light is the hard case for
# OCR; crease and curl break the "four straight edges" assumption.
VARIANTS = [
    dict(name="wood-clean", bg="wood"),
    dict(name="linen-crease", bg="linen", crease=2),
    dict(name="marble-curl", bg="marble", curl=0.06),
    dict(name="slate-lowlight", bg="slate", crease=1, low=True),
    dict(name="whitedesk", bg="white", curl=0.03),
    dict(name="wood-tilt-glare", bg="wood2", tilt=0.14, glare=True, crease=1),
]


def rng_for(name):
    return np.random.default_rng(zlib.crc32(name.encode()))


def noise(r, h, w, scale):
    small = r.random((max(2, h // scale), max(2, w // scale))).astype(np.float32)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)


def background(kind, h, w, r):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    if kind in ("wood", "wood2"):
        warp = noise(r, h, w, 180) * 60 + noise(r, h, w, 40) * 8
        grain = np.sin((yy + warp) / (9 if kind == "wood" else 6)) * 0.5 + 0.5
        fine = noise(r, h, w, 3) * 0.25
        t = (0.65 + 0.25 * grain + fine)[..., None]
        base = np.array([62, 104, 150] if kind == "wood" else [40, 72, 112], np.float32)  # BGR
        return np.clip(base * t * 1.25, 0, 255)
    if kind == "linen":
        weave = (np.sin(xx * 1.9) * np.sin(yy * 1.7)) * 6
        n = noise(r, h, w, 2) * 18 + noise(r, h, w, 60) * 14
        return np.clip(np.array([196, 205, 212], np.float32) + (weave + n - 16)[..., None], 0, 255)
    if kind == "marble":
        turb = noise(r, h, w, 220) * 4 + noise(r, h, w, 70) * 2 + noise(r, h, w, 20) * 0.6
        vein = np.abs(np.sin((xx * 0.004 + yy * 0.006 + turb) * 6))
        v = (1 - np.power(vein, 0.15)) * 70
        return np.clip(np.array([228, 230, 232], np.float32) - v[..., None] - noise(r, h, w, 3)[..., None] * 8, 0, 255)
    if kind == "slate":
        return np.clip(np.array([46, 44, 42], np.float32) + (noise(r, h, w, 4) * 22 + noise(r, h, w, 90) * 18 - 20)[..., None], 0, 255)
    if kind == "white":
        return np.clip(np.array([236, 238, 240], np.float32) + (noise(r, h, w, 3) * 6 + noise(r, h, w, 150) * 10 - 8)[..., None], 0, 255)
    raise ValueError(kind)


def paper_effects(rgba, v, r):
    """Crease and curl in the ticket's own frame. Returns the image and a displacement
    map so the corners can be followed through the bend."""
    h, w = rgba.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.zeros((h, w), np.float32)
    dy = np.zeros((h, w), np.float32)
    shade = np.ones((h, w), np.float32)
    for _ in range(v.get("crease", 0)):
        # A fold line crossing the ticket at a random angle: one flank darker,
        # a thin highlight on the ridge, and a slight kink in the paper.
        ang = r.uniform(-0.5, 0.5) + (np.pi / 2 if r.random() < 0.6 else 0)
        cx, cy = r.uniform(0.3, 0.7) * w, r.uniform(0.3, 0.7) * h
        nx, ny = np.cos(ang), np.sin(ang)
        d = (xx - cx) * nx + (yy - cy) * ny
        shade *= 1 - 0.16 * np.exp(-np.maximum(d, 0) / (0.12 * max(w, h))) * (d > 0)
        shade *= 1 + 0.22 * np.exp(-(d / 3.0) ** 2)
        shade *= 1 - 0.18 * np.exp(-((d + 5) / 4.0) ** 2)
        kink = np.tanh(d / 30.0) * 4
        dx += kink * nx
        dy += kink * ny
    if v.get("curl"):
        # Cylindrical curl along the long side: edges lift, so the outline bows.
        k = v["curl"]
        u = (xx / w - 0.5) * 2
        dy += -(u ** 2) * k * h * 0.9
        shade *= 1 - 0.18 * np.abs(u) ** 3
    # Paper tooth: faint low-frequency mottling.
    shade *= 1 + (noise(r, h, w, 6) - 0.5) * 0.05
    out = rgba.astype(np.float32).copy()
    out[..., :3] *= shade[..., None]
    pad = int(0.08 * max(w, h))
    out = cv2.copyMakeBorder(np.clip(out, 0, 255).astype(np.uint8), pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0, 0))
    H, W = out.shape[:2]
    # Inverse map for remap: destination pixel samples source at (x - dx, y - dy).
    DX = cv2.copyMakeBorder(dx, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    DY = cv2.copyMakeBorder(dy, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    gy, gx = np.mgrid[0:H, 0:W].astype(np.float32)
    bent = cv2.remap(out, gx - DX, gy - DY, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
    corners = np.array([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], np.float32)
    moved = np.array([[x + pad + dx[int(y), int(x)], y + pad + dy[int(y), int(x)]] for x, y in corners], np.float32)
    return bent, moved


def photograph(tid, v):
    name = f"{tid}__{v['name']}"
    r = rng_for(name)
    rgba = cv2.imread(str(FLAT / f"{tid}.png"), cv2.IMREAD_UNCHANGED)
    th, tw = rgba.shape[:2]
    portrait = th > tw
    H, W = (1920, 1440) if portrait else (1440, 1920)
    bg = background(v["bg"], H, W, r)

    bent, corners = paper_effects(rgba, v, r)
    src_w, src_h = tw, th
    # Where the ticket lands: long side 50-72% of the frame, rotated, with keystone.
    long_frac = r.uniform(0.5, 0.72)
    scale = long_frac * max(W, H) / max(src_w, src_h)
    if max(src_w, src_h) * scale > 0.9 * (H if portrait else W):
        scale = 0.9 * (H if portrait else W) / max(src_w, src_h)
    ang = np.deg2rad(r.uniform(-22, 22))
    cx, cy = W / 2 + r.uniform(-0.08, 0.08) * W, H / 2 + r.uniform(-0.08, 0.08) * H
    hw, hh = src_w * scale / 2, src_h * scale / 2
    rect = np.array([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], np.float32)
    rot = np.array([[np.cos(ang), -np.sin(ang)], [np.sin(ang), np.cos(ang)]], np.float32)
    dst = rect @ rot.T + [cx, cy]
    tilt = v.get("tilt", 0.06)
    # Keystone: the edge farther from the camera shrinks toward its midpoint.
    far = 0 if r.random() < 0.5 else 2
    shrink = r.uniform(0.5, 1.0) * tilt
    a, b = far, (far + 1) % 4
    mid = (dst[a] + dst[b]) / 2
    dst[a] += (mid - dst[a]) * shrink
    dst[b] += (mid - dst[b]) * shrink
    dst += r.uniform(-1, 1, dst.shape).astype(np.float32) * 0.01 * max(W, H)
    # Fit the plain rectangle's corners (in padded ticket space) to dst.
    pad = (bent.shape[1] - tw) / 2
    src_rect = np.array([[pad, pad], [pad + tw - 1, pad], [pad + tw - 1, pad + th - 1], [pad, pad + th - 1]], np.float32)
    M = cv2.getPerspectiveTransform(src_rect, dst.astype(np.float32))
    warped = cv2.warpPerspective(bent, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
    true_corners = cv2.perspectiveTransform(corners[None], M)[0]

    alpha = warped[..., 3:4].astype(np.float32) / 255
    # Contact shadow: the alpha, blurred and offset away from the light.
    sh = cv2.GaussianBlur(warped[..., 3].astype(np.float32) / 255, (0, 0), 9 + 6 * r.random())
    sh = np.roll(sh, (int(r.uniform(4, 14)), int(r.uniform(4, 14))), (0, 1))
    img = bg * (1 - 0.45 * sh[..., None])
    img = img * (1 - alpha) + warped[..., :3].astype(np.float32) * alpha

    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lx, ly = r.uniform(-1, 1), r.uniform(-1, 1)
    grad = 1 + 0.16 * ((xx / W - 0.5) * lx + (yy / H - 0.5) * ly)
    vign = 1 - 0.28 * (((xx / W - 0.5) ** 2 + (yy / H - 0.5) ** 2) * 2)
    img *= (grad * vign)[..., None]
    img *= np.array([1.0, 1.0, 1.0 + r.uniform(-0.04, 0.06)], np.float32)  # warm/cool cast (BGR)
    if v.get("glare"):
        gx, gy = r.uniform(0.3, 0.7) * W, r.uniform(0.3, 0.7) * H
        g = np.exp(-(((xx - gx) / (0.12 * W)) ** 2 + ((yy - gy) / (0.07 * H)) ** 2))
        img += (g * 120)[..., None]
    if v.get("low"):
        img = img * 0.32
        img += r.normal(0, 7, img.shape)
        img = cv2.GaussianBlur(img, (0, 0), 1.1)
    else:
        img += r.normal(0, 2.5, img.shape)
        img = cv2.GaussianBlur(img, (0, 0), 0.6)
    img = np.clip(img, 0, 255).astype(np.uint8)
    q = 72 if v.get("low") else 88
    cv2.imwrite(str(OUT / f"{name}.jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, q])
    return name, {"ticket": tid, "variant": v["name"], "width": W, "height": H, "corners": true_corners.round(1).tolist(), "conditions": {k: v[k] for k in v if k != "name"}}


photos = {}
for tid in PAPER:
    for v in VARIANTS:
        name, meta = photograph(tid, v)
        photos[name] = meta
        print(name)
(ROOT / "fixtures/synthetic/photos.json").write_text(json.dumps(photos, indent=1))
print(len(photos), "photos")
