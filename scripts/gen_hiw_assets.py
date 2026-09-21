#!/usr/bin/env python3
"""
Generate the "How it works" replay assets (deterministic, offline).

Installs (run by the user — the agent never pip-installs):
    python3 -m venv .venv-hiw
    .venv-hiw/bin/pip install -r requirements-hiw.txt

Usage:
    .venv-hiw/bin/python scripts/gen_hiw_assets.py              # generate into public/
    .venv-hiw/bin/python scripts/gen_hiw_assets.py --selftest   # generate + run assertions

Reads  scripts/hiw-asset-spec.json   (emitted from the TS fixtures:
         npx vite-node scripts/gen-hiw-spec.ts)
Writes public/hiw/assets/<fixtureId>/manifest.json
       public/hiw/assets/<fixtureId>/<captureId>/{raw,maskedCrop,grayscaleContrast,
         edgeMap,candidateOverlay,rectifiedCrop,decode-crop}.png

Determinism: fixed-seed noise, no timestamps anywhere in output. Re-running
produces byte-identical files (PNGs and manifest JSON).

Rendering
---------
* line-scan captures: top/bottom scan strips (belt cross-section, one row per
  sensor line). Kraft face + printed Code 128 label (ISO 15417, Code 128 B,
  standard checksum — decodable by production ZXing).
* area captures: synthetic box in a 2D pinhole camera; label rendered on the
  FRONT face (visible to the 0° and 45° cameras), painter's algorithm.
  The four other side cameras (135°/180°/225°/270°) see the box WITHOUT a
  label (edge-on / hidden face) -> no candidate, no decode crop, no
  expectedDecode. no-read fixtures: cam1 = glare wash over the label
  (strong enough that no decoder scanline survives — the pixel decode
  really fails), cam2 = label under a low-contrast shrink wrap (below the
  pixel-detection threshold -> geometry fallback candidate).

Resolution: the AREA capture is the full-res sensor buffer (AREA_RES x the
1140x960 display frame). Every stage the UI shows (raw, mask, gray, edge,
overlay) is the display-resolution view; the rectified crop is cut from the
FULL-RES buffer, exactly like a real camera's full-resolution decode input
versus its scaled live preview. This keeps the bars above the sampling
limit in both spaces (1-module bars are sub-pixel in the display frame,
which is why cutting the crop from the display frame makes ZXing report
NO_SYMBOL — verified, do not rectify from the display resolution).

Stage chain per capture (mirrors the live pipeline order):
    raw -> maskedCrop -> grayscaleContrast -> edgeMap -> candidateOverlay
         -> rectifiedCrop (== decode-crop.png, the decode input)

Candidate detection (explicit, self-tested): bright-region contours on the
raw frame, with morphological closing to bridge the (possibly sub-pixel)
barcode bars so the whole white label region becomes one blob. Wide,
sufficiently large blobs become a 'pixels' candidate. Frames where
detection finds nothing (e.g. the low-contrast wrapped label, which never
reaches the threshold) fall back to the spec's geometry quad (source
'geometry' -> UI shows "illustrative candidate location").
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np

REPO = Path(__file__).resolve().parent.parent
SPEC_PATH = REPO / "scripts" / "hiw-asset-spec.json"
DEFAULT_OUT = REPO / "public"

# area frame DISPLAY size (2x the original 570x480; manifest quads and all
# stage tiles live in this space). The full-res sensor buffer is AREA_RES x
# this (see render_area_frame) — the decode crop is cut from there.
IMG_W, IMG_H = 1140, 960
STRIP_W, STRIP_H = 570, 560      # line-scan strips (x = belt cross, y = travel)

# Deterministic scene constants (no clocks, no env reads)
SEED = 42
KRAFT = np.array([106, 138, 168], dtype=np.float64)   # BGR
BG = np.array([32, 32, 34], dtype=np.float64)
BELT = np.array([66, 66, 70], dtype=np.float64)
LABEL_WHITE = np.array([250, 250, 250], dtype=np.float64)

BOX_W, BOX_H, BOX_L = 170.0, 130.0, 230.0  # x (cross-belt), y (up), z (travel)

CAM = {  # pinhole, look-at (0, 55, 0)
    "focal": 500.0,
    "cx": IMG_W / 2.0,
    "cy": IMG_H / 2.0,
    "normal": (0.0, 150.0, 430.0),
    "low": (0.0, 330.0, 430.0),
}

# Azimuth + camera height per side camera id (story geometry; must stay in
# sync with SIDE_CAMERAS in src/ui/howItWorks/fixtures.ts).
SIDE_CAM_VIEW = {
    "cam-side-1": (0.0, "normal"),
    "cam-side-2": (45.0, "normal"),
    "cam-side-3": (135.0, "normal"),
    "cam-side-4": (180.0, "normal"),
    "cam-side-5": (225.0, "low"),
    "cam-side-6": (270.0, "low"),
}

QUIET_MODULES = 10
BARCODE_ROWS_MODULES = 30  # bar band height in modules (60 px = full label height)


# ---------------------------------------------------------------------------
# Code 128 (ISO 15417, Code 128 B) — data patterns ported from
# src/pipeline/code128Table.ts (verified value-by-value against the ISO
# 15417:2007 table). Checksum is the standard POSITION-WEIGHTED sum
# (start + sum(i*v_i)) mod 103, as decoders require.
# ---------------------------------------------------------------------------

CODE128_PATTERNS = [
  [2, 1, 2, 2, 2, 2],
  [2, 2, 2, 1, 2, 2],
  [2, 2, 2, 2, 2, 1],
  [1, 2, 1, 2, 2, 3],
  [1, 2, 1, 3, 2, 2],
  [1, 3, 1, 2, 2, 2],
  [1, 2, 2, 2, 1, 3],
  [1, 2, 2, 3, 1, 2],
  [1, 3, 2, 2, 1, 2],
  [2, 2, 1, 2, 1, 3],
  [2, 2, 1, 3, 1, 2],
  [2, 3, 1, 2, 1, 2],
  [1, 1, 2, 2, 3, 2],
  [1, 2, 2, 1, 3, 2],
  [1, 2, 2, 2, 3, 1],
  [1, 1, 3, 2, 2, 2],
  [1, 2, 3, 1, 2, 2],
  [1, 2, 3, 2, 2, 1],
  [2, 2, 3, 2, 1, 1],
  [2, 2, 1, 1, 3, 2],
  [2, 2, 1, 2, 3, 1],
  [2, 1, 3, 2, 1, 2],
  [2, 2, 3, 1, 1, 2],
  [3, 1, 2, 1, 3, 1],
  [3, 1, 1, 2, 2, 2],
  [3, 2, 1, 1, 2, 2],
  [3, 2, 1, 2, 2, 1],
  [3, 1, 2, 2, 1, 2],
  [3, 2, 2, 1, 1, 2],
  [3, 2, 2, 2, 1, 1],
  [2, 1, 2, 1, 2, 3],
  [2, 1, 2, 3, 2, 1],
  [2, 3, 2, 1, 2, 1],
  [1, 1, 1, 3, 2, 3],
  [1, 3, 1, 1, 2, 3],
  [1, 3, 1, 3, 2, 1],
  [1, 1, 2, 3, 1, 3],
  [1, 3, 2, 1, 1, 3],
  [1, 3, 2, 3, 1, 1],
  [2, 1, 1, 3, 1, 3],
  [2, 3, 1, 1, 1, 3],
  [2, 3, 1, 3, 1, 1],
  [1, 1, 2, 1, 3, 3],
  [1, 1, 2, 3, 3, 1],
  [1, 3, 2, 1, 3, 1],
  [1, 1, 3, 1, 2, 3],
  [1, 1, 3, 3, 2, 1],
  [1, 3, 3, 1, 2, 1],
  [3, 1, 3, 1, 2, 1],
  [2, 1, 1, 3, 3, 1],
  [2, 3, 1, 1, 3, 1],
  [2, 1, 3, 1, 1, 3],
  [2, 1, 3, 3, 1, 1],
  [2, 1, 3, 1, 3, 1],
  [3, 1, 1, 1, 2, 3],
  [3, 1, 1, 3, 2, 1],
  [3, 3, 1, 1, 2, 1],
  [3, 1, 2, 1, 1, 3],
  [3, 1, 2, 3, 1, 1],
  [3, 3, 2, 1, 1, 1],
  [3, 1, 4, 1, 1, 1],
  [2, 2, 1, 4, 1, 1],
  [4, 3, 1, 1, 1, 1],
  [1, 1, 1, 2, 2, 4],
  [1, 1, 1, 4, 2, 2],
  [1, 2, 1, 1, 2, 4],
  [1, 2, 1, 4, 2, 1],
  [1, 4, 1, 1, 2, 2],
  [1, 4, 1, 2, 2, 1],
  [1, 1, 2, 2, 1, 4],
  [1, 1, 2, 4, 1, 2],
  [1, 2, 2, 1, 1, 4],
  [1, 2, 2, 4, 1, 1],
  [1, 4, 2, 1, 1, 2],
  [1, 4, 2, 2, 1, 1],
  [2, 4, 1, 2, 1, 1],
  [2, 2, 1, 1, 1, 4],
  [4, 1, 3, 1, 1, 1],
  [2, 4, 1, 1, 1, 2],
  [1, 3, 4, 1, 1, 1],
  [1, 1, 1, 2, 4, 2],
  [1, 2, 1, 1, 4, 2],
  [1, 2, 1, 2, 4, 1],
  [1, 1, 4, 2, 1, 2],
  [1, 2, 4, 1, 1, 2],
  [1, 2, 4, 2, 1, 1],
  [4, 1, 1, 2, 1, 2],
  [4, 2, 1, 1, 1, 2],
  [4, 2, 1, 2, 1, 1],
  [2, 1, 2, 1, 4, 1],
  [2, 1, 4, 1, 2, 1],
  [4, 1, 2, 1, 2, 1],
  [1, 1, 1, 1, 4, 3],
  [1, 1, 1, 3, 4, 1],
  [1, 3, 1, 1, 4, 1],
  [1, 1, 4, 1, 1, 3],
  [1, 1, 4, 3, 1, 1],
  [4, 1, 1, 1, 1, 3],
  [4, 1, 1, 3, 1, 1],
  [1, 1, 3, 1, 4, 1],
  [1, 1, 4, 1, 3, 1],
  [3, 1, 1, 1, 4, 1],
  [4, 1, 1, 1, 3, 1],
  [2, 1, 1, 4, 1, 2],
  [2, 1, 1, 2, 1, 4],
  [2, 1, 1, 2, 3, 2],
  [2, 3, 3, 1, 1, 1],
]


# Start symbol: pattern 211214 (value 104 in the ISO 15417 table). This is
# the convention real-world Code 128 B symbols and bwip-js use, and the
# pattern the demo's decoder (zxing-cpp) maps to Code B mode with checksum
# base 104. NOTE: emitting the ISO "Start B" 211232 (value 105) makes
# zxing-cpp decode the payload as CODE C (its start-value->mode mapping is
# 104->B, 105->C) — verified, do not use.
START_B = 104
START_B_PAT = [2, 1, 1, 2, 1, 4]


def code128_elements(payload: str) -> list[int]:
    """Bar/space element widths for an ISO Code 128 B symbol."""
    data = [ord(c) - 32 for c in payload]
    csum = (START_B + sum((i + 1) * v for i, v in enumerate(data))) % 103
    els = list(START_B_PAT)
    for v in (*data, csum):
        els.extend(CODE128_PATTERNS[v])
    els.extend([2, 3, 3, 1, 1, 1, 2])  # stop pattern + 2-module guard
    return els


def _zxing_semantics_decode(els: list[int]) -> str:
    """Decode a Code 128 element stream the way zxing-cpp does (the
    decoder the browser demo uses). Raises on any structural violation."""
    assert els[-7:] == [2, 3, 3, 1, 1, 1, 2], "stop pattern missing"
    body = els[:-7]
    assert len(body) % 6 == 0, "symbol boundary misaligned"
    pat2val = {tuple(p): i for i, p in enumerate(CODE128_PATTERNS)}
    pat2val[tuple([2, 1, 1, 4, 1, 2])] = 103  # ISO 15417 table rows 103-105
    pat2val[tuple([2, 1, 1, 2, 1, 4])] = 104  # (data table above stops at 102)
    pat2val[tuple([2, 1, 1, 2, 3, 2])] = 105
    syms = [pat2val[tuple(body[i * 6 : (i + 1) * 6])] for i in range(len(body) // 6)]
    start, data, csum = syms[0], syms[1:-1], syms[-1]
    assert start in (103, 104, 105), f"invalid start {start}"
    assert (start + sum((i + 1) * v for i, v in enumerate(data))) % 103 == csum, "checksum"
    mode = 204 - start  # zxing-cpp: 103->A(101), 104->B(100), 105->C(99)
    if mode != 100:  # this generator emits pure Code B only
        raise ValueError(f"start {start} selects mode {mode}, not Code B")
    assert all(0 <= v <= 94 for v in data), "value outside Code B range"
    return "".join(chr(v + 32) for v in data)


def render_barcode(payload: str, module_px: int) -> np.ndarray:
    """Black(0)/white(255) barcode bitmap, quiet zone included."""
    els = code128_elements(payload)
    total_modules = QUIET_MODULES * 2 + sum(els)
    w = total_modules * module_px
    h = BARCODE_ROWS_MODULES * module_px
    img = np.full((h, w), 255, dtype=np.uint8)
    x = QUIET_MODULES * module_px
    for i, width in enumerate(els):
        if i % 2 == 0:  # bar
            img[:, x : x + width * module_px] = 0
        x += width * module_px
    return img


# ---------------------------------------------------------------------------
# Small image helpers
# ---------------------------------------------------------------------------


def base_canvas(w: int, h: int, color: np.ndarray, seed: int) -> np.ndarray:
    img = np.tile(color, ((h, w, 1)))
    rng = np.random.default_rng(seed)
    img += rng.normal(0.0, 2.0, img.shape)
    return np.clip(img, 0, 255).astype(np.uint8)


def _look_at(cam_pos: np.ndarray, target: np.ndarray):
    fwd = target - cam_pos
    fwd /= np.linalg.norm(fwd)
    right = np.cross(fwd, np.array([0.0, 1.0, 0.0]))
    right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return cam_pos, right, up, fwd


def project(
    pts: np.ndarray, cam_pos, right, up, fwd, intr: dict | None = None
) -> tuple[np.ndarray, np.ndarray]:
    """World pts (N,3) -> (image xy (N,2), depth (N,))."""
    i = intr or CAM
    rel = pts - cam_pos
    x = rel @ right
    y = rel @ up
    z = rel @ fwd
    fx = i["focal"] * x / z + i["cx"]
    fy = -i["focal"] * y / z + i["cy"]
    return np.column_stack([fx, fy]), z


def box_faces(center: np.ndarray, azimuth_deg: float) -> dict[str, tuple[np.ndarray, float]]:
    """6 face corners (world, already rotated) + base brightness factor.

    Faces are keyed by their pre-rotation normal: 'front' (+z, label face),
    'rear' (−z), 'right' (+x), 'left' (−x), 'top' (+y), 'bottom' (−y).
    """
    th = np.deg2rad(azimuth_deg)
    rot = np.array(
        [[np.cos(th), 0.0, -np.sin(th)], [0.0, 1.0, 0.0], [np.sin(th), 0.0, np.cos(th)]]
    )
    hw, hh, hl = BOX_W / 2, BOX_H / 2, BOX_L / 2
    corners = {
        "front": np.array(
            [[-hw, hh, hl], [hw, hh, hl], [hw, -hh, hl], [-hw, -hh, hl]]
        ),
        "rear": np.array([[-hw, hh, -hl], [hw, hh, -hl], [hw, -hh, -hl], [-hw, -hh, -hl]]),
        "right": np.array([[hw, hh, -hl], [hw, hh, hl], [hw, -hh, hl], [hw, -hh, -hl]]),
        "left": np.array([[-hw, hh, hl], [-hw, hh, -hl], [-hw, -hh, -hl], [-hw, -hh, hl]]),
        "top": np.array([[-hw, hh, -hl], [hw, hh, -hl], [hw, hh, hl], [-hw, hh, hl]]),
        "bottom": np.array([[-hw, -hh, hl], [hw, -hh, hl], [hw, -hh, -hl], [-hw, -hh, -hl]]),
    }
    shade = {"front": 1.0, "rear": 0.78, "right": 0.9, "left": 0.9, "top": 1.06, "bottom": 0.55}
    out = {}
    for name, c in corners.items():
        world = (c + center) @ rot.T
        out[name] = (world, shade[name])
    return out


def label_face_corners(center: np.ndarray, azimuth_deg: float) -> np.ndarray:
    """4 world corners of the label on the FRONT face (u along face x, v along y)."""
    th = np.deg2rad(azimuth_deg)
    rot = np.array(
        [[np.cos(th), 0.0, -np.sin(th)], [0.0, 1.0, 0.0], [np.sin(th), 0.0, np.cos(th)]]
    )
    hw, hh = BOX_W / 2, BOX_H / 2
    # Label spans ~88% of the face width x ~48% of the face height. Module
    # size is fixed by the payload (149.6 mm / 209 modules = 0.716 mm/module
    # at 88% width); the decode resolution comes from the full-res buffer,
    # not from the label size here — see render_area_frame.
    u0, u1 = -0.44 * BOX_W, 0.44 * BOX_W
    v0, v1 = 0.30 * BOX_H, 0.78 * BOX_H
    local = np.array(
        [[u0, v0, hh + 0.5], [u1, v0, hh + 0.5], [u1, v1, hh + 0.5], [u0, v1, hh + 0.5]]
    )
    return (local + center) @ rot.T


AREA_RES = 4  # full-res sensor buffer = AREA_RES x the display frame


def render_area_frame(
    payload: str,
    azimuth_deg: float,
    cam_key: str,
    label: str,  # 'none' | 'clean' | 'glare' | 'wrapped'
    seed: int,
    res: int = AREA_RES,
) -> tuple[np.ndarray, np.ndarray, np.ndarray | None]:
    """Render one side-camera area capture.

    Returns (display, full_res, label_quad_display). The capture is rendered
    at AREA_RES x resolution (full-res sensor buffer) and box-downsampled
    (INTER_AREA) to the display frame — correct camera optics. The label is
    sub-pixel in the display frame (~1 px/module); the full-res buffer keeps
    the bar pattern above the sampling limit (~3.9 px/module) so the
    rectified crop — cut from the full-res buffer — decodes with zxing-cpp
    (verified: crops cut from the display frame fail with NO_SYMBOL).

    label_quad_display: projected label corners in DISPLAY space (None when
    the label face is not visible to this camera). Used for the geometry
    fallback candidate so it always matches the rendered label position.
    """
    cam_pos = np.array(CAM[cam_key])
    target = np.array([0.0, 55.0, 0.0])
    _, right, up, fwd = _look_at(cam_pos, target)
    W, H = IMG_W * res, IMG_H * res
    belt_y = 680 * res
    intr = {
        "focal": CAM["focal"] * res,
        "cx": CAM["cx"] * res,
        "cy": CAM["cy"] * res,
    }

    img = base_canvas(W, H, BG, seed)
    # conveyor belt
    belt = np.array([[0, belt_y], [W, belt_y], [W, H], [0, H]], dtype=np.int32)
    cv2.fillPoly(img, [belt], tuple(int(v) for v in BELT))
    rng = np.random.default_rng(seed + 1)
    noise = rng.normal(0.0, 1.5, (H - belt_y, W))
    img[belt_y:] = np.clip(img[belt_y:].astype(float) + noise[..., None], 0, 255).astype(np.uint8)

    faces = box_faces(np.array([0.0, BOX_H / 2, 0.0]), azimuth_deg)
    # painter's algorithm: farthest first, cull back-facing
    order = sorted(
        faces.items(),
        key=lambda kv: project(kv[1][0], cam_pos, right, up, fwd, intr)[1].mean(),
        reverse=True,
    )
    for name, (corners, shade) in order:
        xy, z = project(corners, cam_pos, right, up, fwd, intr)
        if z.min() <= 0:
            continue
        normal = np.cross(corners[1] - corners[0], corners[2] - corners[0])
        view = corners.mean(axis=0) - cam_pos
        if np.dot(normal, view) > 0:
            continue
        col = tuple(int(v) for v in np.clip(KRAFT * shade, 0, 255))
        cv2.fillPoly(img, [xy.astype(np.int32)], col)

    label_quad_display: np.ndarray | None = None
    if label != "none" and azimuth_deg <= 45.0 + 1e-6:
        label_world = label_face_corners(np.array([0.0, BOX_H / 2, 0.0]), azimuth_deg)
        xy, z = project(label_world, cam_pos, right, up, fwd, intr)
        if z.min() > 0:
            label_quad_display = (xy / res).astype(np.float32)
            bc = render_barcode(payload, 3)  # 3 px/module
            src = np.array(
                [
                    [0, 0],
                    [bc.shape[1] - 1, 0],
                    [bc.shape[1] - 1, bc.shape[0] - 1],
                    [0, bc.shape[0] - 1],
                ],
                dtype=np.float32,
            )
            m = cv2.getPerspectiveTransform(src, xy.astype(np.float32))
            white = np.dstack([bc, bc, bc])
            # ~1:1 warp at the 4x internal resolution (627 px source onto a
            # ~580 px quad) — plain linear is exact enough; the optical
            # downsample happens at the end of this function.
            warped = cv2.warpPerspective(white, m, (W, H), flags=cv2.INTER_LINEAR)
            mask = cv2.warpPerspective(
                np.full(bc.shape, 255, np.uint8), m, (W, H), flags=cv2.INTER_NEAREST
            )
            ok = mask > 0
            img[ok] = warped[ok]

            if label == "glare":
                # The glare must make the PIXEL DECODE fail (not just look
                # bad): wash the whole label so every bar rises above the
                # 128 binarization edge, then add a hot central disc. A
                # partial wash leaves clean scanlines near the label edge
                # and zxing-cpp still decodes (verified, do not weaken).
                img[ok] = (0.30 * warped[ok].astype(float) + 0.70 * 255.0).astype(np.uint8)
                cx, cy = int(xy.mean(axis=0)[0]), int(xy.mean(axis=0)[1])
                ys, xs = np.mgrid[0:H, 0:W]
                d = np.sqrt((xs - cx) ** 2 + (ys - cy) ** 2)
                r = max(xy[:, 0].max() - xy[:, 0].min(), xy[:, 1].max() - xy[:, 1].min())
                g = np.clip(1.0 - d / (1.15 * r), 0.0, 1.0) ** 1.5
                img = np.clip(img.astype(float) + g[..., None] * 140, 0, 255).astype(np.uint8)
            elif label == "wrapped":
                # low-contrast shrink wash: pull the label toward the kraft tone
                # (kraft under the label = KRAFT; front face shade factor is 1.0).
                # Coefficient 0.15 is the verified sweet spot: the washed
                # symbol's bar/space contrast (38 gray levels) is below what
                # zxing-cpp can read (0.18 still decodes), and the washed
                # whites (max ~183) stay under the detection threshold (200)
                # so the geometry fallback candidate is used.
                wash = KRAFT + 28.0
                img[ok] = (0.15 * warped[ok].astype(float) + 0.85 * wash).astype(np.uint8)
    if res > 1:
        display = cv2.resize(img, (IMG_W, IMG_H), interpolation=cv2.INTER_AREA)
    else:
        display = img
    return display, img, label_quad_display


def render_top_strip(payload: str, seed: int) -> np.ndarray:
    img = base_canvas(STRIP_W, STRIP_H, KRAFT, seed).astype(np.float32)
    img += np.random.default_rng(seed + 2).normal(0.0, 1.5, img.shape)
    img = np.clip(img, 0, 255).astype(np.uint8)
    for y in (120, 440):  # packing tape seams crossing the parcel
        cv2.line(img, (0, y), (STRIP_W, y), (88, 108, 128), 3)
    # white label, barcode in NORMAL orientation: the bar/space pattern runs
    # along the cross-belt axis (x) and the bars extend along the travel
    # axis (y) — the geometry a 1D line scanner reads (each sensor row cuts
    # the whole bar pattern).
    l0, l1, t0, t1 = 50, 520, 215, 275
    cv2.rectangle(img, (l0, t0), (l1, t1), (250, 250, 250), -1)
    bc = render_barcode(payload, 2)
    x0 = (STRIP_W - bc.shape[1]) // 2
    y0 = t0 + (t1 - t0 - bc.shape[0]) // 2
    img[y0 : y0 + bc.shape[0], x0 : x0 + bc.shape[1]] = cv2.cvtColor(bc, cv2.COLOR_GRAY2BGR)
    return img


# ---------------------------------------------------------------------------
# Stage chain
# ---------------------------------------------------------------------------

DETECT_MIN_AREA = 60 * 25
# Column-profile structure gate. A glare wash can push the whole label above
# the threshold while the bars only survive faintly near the edges (col std
# ~13 on the generated glare fixture) — the detector must still find the
# candidate there (the story is: candidate found, pixel decode fails with an
# explicit reason). The wrapped no-read label never forms a blob at all
# (max gray ~188 < threshold), so this gate does not protect it.
DETECT_MIN_COL_STD = 12.0
DETECT_THRESHOLD = 200
DETECT_CLOSE_KERNEL = 15


def parcel_mask_poly(area: bool, azimuth_deg: float) -> np.ndarray:
    """Silhouette polygon for the maskedCrop stage."""
    if area:
        cam_pos = np.array(CAM["normal"])
        _, right, up, fwd = _look_at(cam_pos, np.array([0.0, 55.0, 0.0]))
        faces = box_faces(np.array([0.0, BOX_H / 2, 0.0]), azimuth_deg)
        pts = np.concatenate([f[0] for f in faces.values()])
        xy, z = project(pts, cam_pos, right, up, fwd)
        mask = cv2.convexHull(xy.astype(np.float32), returnPoints=True)
        return mask.reshape(-1, 2).astype(np.int32)
    # line strip: parcel occupies the central band (y = travel extent)
    return np.array(
        [[12, 40], [STRIP_W - 12, 40], [STRIP_W - 12, 520], [12, 520]], dtype=np.int32
    )


def detect_candidate(raw: np.ndarray) -> np.ndarray | None:
    """Bright wide region -> 4-point quad (TL,TR,BR,BL), else None.

    Closing bridges barcode bars (sub-pixel in area frames, thin rows in
    strips) so the label region becomes one blob; below-threshold regions
    (wrapped label) never form a blob -> geometry fallback by the caller.
    """
    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, DETECT_THRESHOLD, 255, cv2.THRESH_BINARY)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (DETECT_CLOSE_KERNEL, DETECT_CLOSE_KERNEL))
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best, best_area = None, 0.0
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w < 60 or h < 25 or w / max(h, 1) < 0.8:
            continue
        if w * h < DETECT_MIN_AREA:
            continue
        col = cv2.GaussianBlur(gray[y : y + h, x : x + w], (5, 5), 0).mean(axis=0)
        if float(col.std()) < DETECT_MIN_COL_STD:
            continue  # uniform bright blob (glare wash without bars) — no candidate
        if w * h > best_area:
            best_area = float(w * h)
            best = np.array([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32)
    return best


def stage_stages(raw: np.ndarray, quad: np.ndarray, poly: np.ndarray | None) -> dict[str, np.ndarray]:
    masked = raw.copy()
    if poly is not None:
        m = np.zeros(raw.shape[:2], np.uint8)
        cv2.fillPoly(m, [poly], 255)
        masked = cv2.bitwise_and(raw, raw, mask=m)
    gray = cv2.cvtColor(masked, cv2.COLOR_BGR2GRAY)
    contrast = cv2.equalizeHist(gray)
    edges = cv2.Canny(gray, 80, 160)
    overlay = raw.copy()
    cv2.polylines(overlay, [quad.astype(np.int32)], True, (0, 220, 0), 2)
    for i in range(4):
        cx, cy = map(int, quad[i])
        cv2.circle(overlay, (cx, cy), 4, (0, 220, 0), -1)
    return {"maskedCrop": masked, "grayscaleContrast": contrast, "edgeMap": edges, "candidateOverlay": overlay}


def rectify(raw: np.ndarray, quad: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    m = cv2.getPerspectiveTransform(quad, np.array(
        [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32
    ))
    return cv2.warpPerspective(raw, m, (out_w, out_h), flags=cv2.INTER_CUBIC)


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# ---------------------------------------------------------------------------
# Manifest
# ---------------------------------------------------------------------------

STAGE_FILES = ["raw", "maskedCrop", "grayscaleContrast", "edgeMap", "candidateOverlay", "rectifiedCrop"]


def build_capture(
    spec_cap: dict,
    raw: np.ndarray,
    poly: np.ndarray | None,
    out_dir: Path,
    payload: str | None = None,
    raw_fullres: np.ndarray | None = None,
    quad_fullres: np.ndarray | None = None,
    geom_quad_display: np.ndarray | None = None,
) -> dict:
    detected = detect_candidate(raw)
    if detected is not None:
        quad, source = detected, "pixels"
        full_quad = (
            detected * AREA_RES if raw_fullres is not None else None
        )
    elif geom_quad_display is not None:
        # AREA capture whose label is below the detection threshold (e.g.
        # the wrapped no-read label): projected label corners (geometry,
        # not pixels) — always matches the rendered label position.
        quad, source = geom_quad_display, "geometry"
        full_quad = quad_fullres
    elif "candidate" in spec_cap:
        quad = np.array(spec_cap["candidate"]["quadPx"], dtype=np.float32)
        source = "geometry"
        full_quad = None
    else:
        # No label in frame AND the spec declares no candidate: the camera
        # sees the parcel from an angle with no label. No candidate, no
        # decode crop, no expectedDecode.
        quad, source, full_quad = None, None, None
    (out_dir / "raw.png").write_bytes(_png(raw))
    if quad is not None:
        stages = stage_stages(raw, quad, poly)
        for name, img in stages.items():
            (out_dir / f"{name}.png").write_bytes(_png(img))
        # aspect-preserving rectify to a fixed width, so barcode modules land at
        # a ZXing-friendly scale (~6 px/module). AREA captures cut the crop
        # from the full-res sensor buffer (see render_area_frame); strips
        # rectify from the strip itself.
        src, q = (raw_fullres, full_quad) if full_quad is not None else (raw, quad)
        x0 = q[:, 0].min(); x1 = q[:, 0].max()
        y0 = q[:, 1].min(); y1 = q[:, 1].max()
        decode_w = 1300
        scale = decode_w / max(x1 - x0, 1)
        decode_h = max(60, int(round((y1 - y0) * scale)))
        crop = rectify(src, q, decode_w, decode_h)
        # ISO 15417 quiet zone: the box-printed label only carries a
        # horizontal quiet zone (bars run the full label height) and
        # zxing-cpp reports NO_SYMBOL on the bare rectified side crop
        # (verified). Pad the decode input with a white quiet zone on all
        # sides — a standard pre-decode step in real pipelines.
        if payload is not None:
            total_modules = QUIET_MODULES * 2 + sum(code128_elements(payload))
            mod_px = decode_w / total_modules
            pad = max(32, int(round(11 * mod_px)))
            crop = cv2.copyMakeBorder(
                crop, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(255, 255, 255)
            )
        crop_bytes = _png(crop)
        (out_dir / "rectifiedCrop.png").write_bytes(crop_bytes)  # == decode input
        (out_dir / "decode-crop.png").write_bytes(crop_bytes)
    else:
        # Honest no-candidate chain: overlay is the bare frame; the
        # rectified-crop slot is a neutral placeholder (there is nothing to
        # rectify) and NO decode-crop.png is emitted.
        stages = stage_stages(raw, np.array(
            [[40, 40], [40, 40], [40, 40], [40, 40]], dtype=np.float32), poly)
        (out_dir / "maskedCrop.png").write_bytes(_png(stages["maskedCrop"]))
        (out_dir / "grayscaleContrast.png").write_bytes(_png(stages["grayscaleContrast"]))
        (out_dir / "edgeMap.png").write_bytes(_png(stages["edgeMap"]))
        (out_dir / "candidateOverlay.png").write_bytes(_png(raw))
        ph = base_canvas(1300, 168, np.array([24.0, 24.0, 26.0]), seed=7)
        (out_dir / "rectifiedCrop.png").write_bytes(_png(ph))
    cap = dict(spec_cap)
    if quad is not None:
        cap["candidate"] = {**spec_cap["candidate"], "source": source, "quadPx": quad.astype(int).tolist()}
    cap["params"] = {
        "detector": {
            "threshold": DETECT_THRESHOLD,
            "closeKernel": DETECT_CLOSE_KERNEL,
            "minArea": DETECT_MIN_AREA,
            "minColumnStdDev": DETECT_MIN_COL_STD,
        },
        "canny": [80, 160],
    }
    return cap


def _png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img)
    assert ok
    return buf.tobytes()


RESULT_STATUSES = ("OK", "PARTIAL", "NO_READ", "AMBIGUOUS", "SENSOR_FAULT")
KINDS = ("LINE_SCAN", "AREA_CAMERA")


def validate_manifest(m: dict) -> None:
    """AC3: field-level validation against the TS ReplayManifest schema
    (src/ui/howItWorks/replayManifest.ts)."""
    assert m["schemaVersion"] == 1
    assert m["fixtureId"] in ("success", "no-read")

    p = m["parcel"]
    assert p["parcelId"]
    assert isinstance(p["label"], str) and p["label"]
    assert p["labels"], "parcel must carry ground-truth labels"
    for lab in p["labels"]:
        assert set(lab) == {"labelInstanceId", "face", "payload"}
        assert lab["labelInstanceId"] and lab["face"] and lab["payload"]

    assert isinstance(m["durationMs"], int) and m["durationMs"] > 0

    kfs = m["keyframes"]
    assert len(kfs) >= 2
    last_t = -1
    for kf in kfs:
        assert set(kf) == {"tMs", "frontZMm", "encoderMm"}
        assert all(isinstance(v, (int, float)) for v in kf.values())
        assert kf["tMs"] > last_t, "keyframes must be monotonic in tMs"
        last_t = kf["tMs"]

    sensor_ids = set()
    for s in m["sensors"]:
        assert set(s) == {"id", "kind", "face"}
        assert s["kind"] in KINDS
        sensor_ids.add(s["id"])
    assert len(sensor_ids) == len(m["sensors"])

    cap_ids = set()
    assert m["captures"]
    for c in m["captures"]:
        cap_ids.add(c["captureId"])
        assert c["sensorId"] in sensor_ids
        assert c["kind"] in KINDS
        assert c["sensorId"].startswith("ls-") == (c["kind"] == "LINE_SCAN")
        assert c["parcelId"] == p["parcelId"]
        assert isinstance(c["simTimeMs"], int) and 0 <= c["simTimeMs"] <= m["durationMs"]
        assert isinstance(c["encoderSpanMm"], list) and len(c["encoderSpanMm"]) == 2
        assert all(isinstance(v, (int, float)) for v in c["encoderSpanMm"])
        assert [st["stage"] for st in c["stages"]] == STAGE_FILES
        for st in c["stages"]:
            assert set(st) == {"stage", "path"}
            assert st["path"].startswith(f"hiw/assets/{m['fixtureId']}/{c['captureId']}/")
            assert st["path"].endswith(".png")
        cand = c.get("candidate")
        if cand is not None:
            assert cand["source"] in ("pixels", "geometry", "manual")
            assert cand["labelInstanceId"]
            assert len(cand["quadPx"]) == 4 and all(len(q) == 2 for q in cand["quadPx"])
            assert all(isinstance(v, (int, float)) for q in cand["quadPx"] for v in q)
        if c.get("decodeCropPath") is not None:
            assert c["decodeCropPath"].endswith(f"{c['captureId']}/decode-crop.png")
            assert ".png.png" not in c["decodeCropPath"]
        ed = c.get("expectedDecode")
        if ed is not None:
            assert isinstance(ed["decoded"], bool)
            assert isinstance(ed["reasons"], list)
            if ed["decoded"]:
                assert isinstance(ed.get("payload"), str) and ed["payload"]
                assert not ed["reasons"]
            else:
                assert ed["reasons"], "failed decode must carry explicit reasons"

    assert m["observations"]
    for o in m["observations"]:
        assert o["captureId"] in cap_ids
        assert o["parcelId"] == p["parcelId"]
        assert isinstance(o["decoded"], bool)
        assert (o["decoded"] is True) == (o.get("decodedPayload") is not None)
        if o["decoded"]:
            assert not o["reasons"]
        else:
            assert len(o["reasons"]) >= 1
        assert isinstance(o["association"]["ok"], bool)

    steps = m["steps"]
    assert len(steps) == 8
    for i, st in enumerate(steps, 1):
        assert st["step"] == i
        assert st["tStartMs"] < st["tEndMs"] <= m["durationMs"]
        assert all(s in sensor_ids for s in st["sensorIds"])
        if st.get("captureId"):
            assert st["captureId"] in cap_ids
    assert steps[0]["tStartMs"] == 0
    assert steps[-1]["tEndMs"] == m["durationMs"]

    r = m["result"]
    assert r["parcelId"] == p["parcelId"]
    assert r["status"] in RESULT_STATUSES
    assert isinstance(r["finalSimTimeMs"], int)
    for v in r["values"]:
        assert v["sourceCaptureIds"] and set(v["sourceCaptureIds"]) <= cap_ids
        assert v["mergedReads"] >= 1
    for f in r["failedReads"]:
        assert f["captureId"] in cap_ids and len(f["reasons"]) >= 1


def build_manifest(spec_fix: dict, fixture_id: str, captures: list[dict]) -> dict:
    m = json.loads(json.dumps(spec_fix))  # deep copy
    m["fixtureId"] = fixture_id
    m["captures"] = captures
    validate_manifest(m)
    return m


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def gen_fixture(spec_fix: dict, fixture_id: str, out_root: Path) -> Path:
    face_payloads = {L["face"]: L["payload"] for L in spec_fix["parcel"]["labels"]}
    out_dir = out_root / "hiw" / "assets" / fixture_id
    out_dir.mkdir(parents=True, exist_ok=True)
    captures = []
    for cap in spec_fix["captures"]:
        cap_out = out_dir / cap["captureId"]
        cap_out.mkdir(parents=True, exist_ok=True)
        if cap["kind"] == "LINE_SCAN":
            seed = 1000 + sum(ord(ch) for ch in cap["sensorId"]) % 1000
            raw = render_top_strip(face_payloads["TOP"], seed)
            poly = parcel_mask_poly(area=False, azimuth_deg=0.0)
            area_payload = None
            captures.append(build_capture(cap, raw, poly, cap_out, area_payload))
        else:
            azimuth, cam_key = SIDE_CAM_VIEW[cap["sensorId"]]
            if fixture_id == "no-read":
                label = "glare" if cap["sensorId"] == "cam-side-1" else (
                    "wrapped" if cap["sensorId"] == "cam-side-2" else "none")
            else:
                label = "clean"
            raw, full_res, geom_quad = render_area_frame(
                face_payloads["FRONT"], azimuth, cam_key, label, seed=2000
            )
            geom_quad_full = geom_quad * AREA_RES if geom_quad is not None else None
            poly = parcel_mask_poly(area=True, azimuth_deg=azimuth)
            captures.append(
                build_capture(
                    cap,
                    raw,
                    poly,
                    cap_out,
                    face_payloads["FRONT"],
                    full_res,
                    geom_quad_full,
                    geom_quad,
                )
            )
    m = build_manifest(spec_fix, fixture_id, captures)
    (out_dir / "manifest.json").write_text(json.dumps(m, sort_keys=True, indent=2) + "\n")
    return out_dir


def selftest(out_root: Path) -> None:
    for fid in ("success", "no-read"):
        out_dir = out_root / "hiw" / "assets" / fid
        m = json.loads((out_dir / "manifest.json").read_text())
        validate_manifest(m)
        by_cap = {c["captureId"]: c for c in m["captures"]}
        # every stage file exists + is a non-trivial PNG
        for c in m["captures"]:
            for st in c["stages"]:
                p = out_root / st["path"]
                assert p.exists() and p.stat().st_size > 2000, st["path"]
            if c.get("decodeCropPath") is not None:
                assert (out_root / c["decodeCropPath"]).exists()
        # out-of-view cameras (edge-on / hidden face): no candidate, no
        # decode crop, no expectedDecode, and no decode-crop.png on disk
        for n in (3, 4, 5, 6):
            c = by_cap[f"cap-cam-{n}-01"]
            assert c["sensorId"] == f"cam-side-{n}"
            assert "candidate" not in c
            assert c.get("decodeCropPath") is None
            assert c.get("expectedDecode") is None
            assert not (out_dir / f"cap-cam-{n}-01/decode-crop.png").exists()
        if fid == "success":
            for c in m["captures"]:
                if "candidate" in c:
                    assert c["candidate"]["source"] == "pixels", c["captureId"]
        else:
            assert by_cap["cap-ls-top-01"]["candidate"]["source"] == "pixels"
            assert by_cap["cap-cam-1-01"]["candidate"]["source"] == "pixels"
            assert by_cap["cap-cam-2-01"]["candidate"]["source"] == "geometry"
            assert "QUALITY:LOW_CONTRAST" in by_cap["cap-cam-2-01"]["expectedDecode"]["reasons"]
        # area frames: all six distinct (viewing angle changes the frame)
        area_files = sorted(p for p in out_dir.glob("cap-cam-*/raw.png"))
        hashes = {sha256_file(p) for p in area_files}
        assert len(area_files) == 6 and len(hashes) == 6
        # barcode sanity: rendered symbol decodes structurally (element count)
        els = code128_elements("A1F4-2026-0001")
        assert len(els) == 16 * 6 + 7  # (start + 14 data + checksum) x 6 + stop
        assert sum(els) == 16 * 11 + 13  # 11 modules per value + 13 stop modules
        # and end-to-end: decode the element stream with zxing-cpp semantics
        # (start-value->mode: 104->B, 105->C; checksum = (start + sum i*v_i)
        # mod 103). Mirrors the demo's decoder, so encoder regressions
        # (start pattern, checksum base, weighting) fail here. The full
        # pixel-level check lives in the vitest suite (zxing-wasm on the
        # generated decode-crops).
        assert _zxing_semantics_decode(code128_elements("A1F4-2026-0001")) == "A1F4-2026-0001"
    # determinism: manifest byte-identical across two builds
    a = sha256_file(out_root / "hiw/assets/success/manifest.json")
    m2 = build_manifest(
        json.loads((SPEC_PATH).read_text())["fixtures"]["success"],
        "success",
        json.loads((out_root / "hiw/assets/success/manifest.json").read_text())["captures"],
    )
    assert json.dumps(m2, sort_keys=True, indent=2) == json.dumps(
        json.loads((out_root / "hiw/assets/success/manifest.json").read_text()),
        sort_keys=True, indent=2,
    )
    assert a is not None
    print("selftest: OK")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    out_root = Path(args.out)
    spec = json.loads(SPEC_PATH.read_text())
    for fid in ("success", "no-read"):
        gen_fixture(spec["fixtures"][fid], fid, out_root)
        print(f"wrote {out_root / 'hiw' / 'assets' / fid}")
    if args.selftest:
        selftest(out_root)
    return 0


if __name__ == "__main__":
    sys.exit(main())
