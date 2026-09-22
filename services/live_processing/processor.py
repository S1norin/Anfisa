"""OpenCV processing core for the live-preview service (t7-2).

Computes stage previews + candidate metadata from the EXACT input frame /
completed strip it received. The stage math mirrors
scripts/gen_hiw_assets.py (the offline asset generator) so live previews
are comparable with the guided-replay assets — the service NEVER reads or
serves the precomputed replay assets.

Decode: the service does NOT decode barcodes (the browser decodes the
returned crop through the existing ZXing path). It reports
  - quality failures as explicit no-read reasons (QUALITY:GLARE,
    QUALITY:LOW_CONTRAST), and
  - ``pending: true`` when a candidate was found and the rectified crop
    is returned for browser-side decoding.
It never fabricates a payload.
"""

from __future__ import annotations

import time

import cv2
import numpy as np

# --- detector constants: mirror scripts/gen_hiw_assets.py (baseline) ----
DETECT_THRESHOLD = 200
DETECT_CLOSE_KERNEL = 15
DETECT_MIN_AREA = 60 * 25
DETECT_MIN_COL_STD = 12.0

# Decode-crop geometry: aspect-preserving rectify to a fixed width (bars
# land at a ZXing-friendly scale), then a white ISO 15417 quiet zone.
DECODE_W = 1300
QUIET_PAD_PX = 48


class ServiceConfig:
    """Preview limits — independent of the acquisition resolution/rate."""

    def __init__(
        self,
        preview_max_edge: int = 1440,
        decode_w: int = DECODE_W,
        quiet_pad_px: int = QUIET_PAD_PX,
        min_update_interval_ms: int = 250,
    ) -> None:
        self.preview_max_edge = preview_max_edge
        self.decode_w = decode_w
        self.quiet_pad_px = quiet_pad_px
        self.min_update_interval_ms = min_update_interval_ms


def detect_candidate(raw: np.ndarray) -> np.ndarray | None:
    """Bright wide region -> 4-point quad (TL,TR,BR,BL), else None.

    Identical to the offline generator's detector (gen_hiw_assets.py).
    """
    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, DETECT_THRESHOLD, 255, cv2.THRESH_BINARY)
    k = cv2.getStructuringElement(
        cv2.MORPH_RECT, (DETECT_CLOSE_KERNEL, DETECT_CLOSE_KERNEL)
    )
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
            continue  # uniform bright wash (glare) — no candidate
        if w * h > best_area:
            best_area = float(w * h)
            best = np.array(
                [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], dtype=np.float32
            )
    return best


def stage_stages(
    raw: np.ndarray, quad: np.ndarray, poly: np.ndarray | None
) -> dict[str, np.ndarray]:
    """Named stage images — identical to the offline generator's set."""
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
    return {
        "maskedCrop": masked,
        "grayscaleContrast": contrast,
        "edgeMap": edges,
        "candidateOverlay": overlay,
    }


def rectify(raw: np.ndarray, quad: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    m = cv2.getPerspectiveTransform(
        quad,
        np.array(
            [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
            dtype=np.float32,
        ),
    )
    return cv2.warpPerspective(raw, m, (out_w, out_h), flags=cv2.INTER_CUBIC)


def quality_reasons(raw: np.ndarray) -> list[str]:
    """Explicit no-read reasons for a frame with NO candidate.

    - QUALITY:GLARE — a bright wash that passes the size tests but has no
      bar structure (uniform column profile);
    - QUALITY:LOW_CONTRAST — nothing above threshold (faint / wrapped
      label, no bright region).
    """
    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)
    _, th = cv2.threshold(gray, DETECT_THRESHOLD, 255, cv2.THRESH_BINARY)
    k = cv2.getStructuringElement(
        cv2.MORPH_RECT, (DETECT_CLOSE_KERNEL, DETECT_CLOSE_KERNEL)
    )
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, k)
    contours, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        x, y, w, h = cv2.boundingRect(c)
        if w < 60 or h < 25 or w * h < DETECT_MIN_AREA:
            continue
        col = cv2.GaussianBlur(gray[y : y + h, x : x + w], (5, 5), 0).mean(axis=0)
        if float(col.std()) < DETECT_MIN_COL_STD:
            return ["QUALITY:GLARE"]
    return ["QUALITY:LOW_CONTRAST"]


def process_capture(
    frame_bgr: np.ndarray, config: ServiceConfig
) -> dict:
    """Process the EXACT input frame: stages + candidate + decode info.

    Returns a plain dict (JSON-friendly after base64-encoding stages):
      stages: {name: image} — includes 'decodeCrop' only when a candidate
              was found (rectified + white quiet zone, ZXing-ready);
      candidate: {'quadPx': [[x, y] x 4]} or None;
      decode: {'decoded': False, 'pending': bool, 'reasons': [...],
               'confidence': 0.0}
    """
    started = time.monotonic()
    quad = detect_candidate(frame_bgr)
    if quad is not None:
        stages = stage_stages(frame_bgr, quad, None)
        x0, x1 = float(quad[:, 0].min()), float(quad[:, 0].max())
        y0, y1 = float(quad[:, 1].min()), float(quad[:, 1].max())
        decode_h = max(60, int(round((y1 - y0) * config.decode_w / max(x1 - x0, 1))))
        crop = rectify(frame_bgr, quad, config.decode_w, decode_h)
        crop = cv2.copyMakeBorder(
            crop,
            config.quiet_pad_px,
            config.quiet_pad_px,
            config.quiet_pad_px,
            config.quiet_pad_px,
            cv2.BORDER_CONSTANT,
            value=(255, 255, 255),
        )
        stages["decodeCrop"] = crop
        candidate = {"quadPx": quad.astype(int).tolist(), "source": "pixels"}
        decode = {
            "decoded": False,
            "pending": True,  # browser decodes decodeCrop via the ZXing path
            "reasons": [],
            "confidence": 0.0,
        }
    else:
        # Honest no-candidate chain: bare-frame overlay, no decode crop.
        stages = stage_stages(
            frame_bgr,
            np.array([[40, 40], [40, 40], [40, 40], [40, 40]], dtype=np.float32),
            None,
        )
        stages["candidateOverlay"] = frame_bgr.copy()
        candidate = None
        decode = {
            "decoded": False,
            "pending": False,
            "reasons": quality_reasons(frame_bgr),
            "confidence": 0.0,
        }
    return {
        "stages": stages,
        "candidate": candidate,
        "decode": decode,
        "processingMs": (time.monotonic() - started) * 1000.0,
    }


def downscale(frame_bgr: np.ndarray, max_edge: int) -> np.ndarray:
    """Limit preview resolution, independently of the acquisition size."""
    h, w = frame_bgr.shape[:2]
    m = max(h, w)
    if m <= max_edge:
        return frame_bgr
    s = max_edge / m
    return cv2.resize(frame_bgr, (max(1, int(w * s)), max(1, int(h * s))))
