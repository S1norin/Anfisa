"""Service tests (t7-2, sub-task s3).

Plain asserts — run:  python3 services/live_processing/tests.py

  AC1 — stage outputs match an offline generator run on the same input
       (scripts/gen_hiw_assets.py is the baseline; identical math).
  AC2 — a glare wash produces NO read + explicit QUALITY:GLARE; a faint
       label produces QUALITY:LOW_CONTRAST; no decode crop, no payload.
  AC3 — preview resolution and update rate are configurable and
       independent of the acquisition (input is 1200px+, bursts allowed).
"""

from __future__ import annotations

import base64
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "..", "scripts"))

import app as svc_app          # noqa: E402
import processor               # noqa: E402
import gen_hiw_assets as gen   # noqa: E402  (offline baseline)

PASS = 0


def check(name, cond, detail=""):
    global PASS
    if not cond:
        raise AssertionError(f"FAIL: {name} {detail}")
    PASS += 1
    print(f"  ok: {name}")


def make_labeled_frame(w=1200, h=800):
    img = np.full((h, w, 3), (168, 150, 132), np.uint8)  # kraft (BGR)
    cv2.rectangle(img, (200, 280), (900, 520), (245, 245, 245), -1)
    x = 260
    widths = [9, 5, 7, 11, 5, 7, 9, 5, 11, 7, 5, 9, 7, 11, 5, 9, 7, 5, 11, 9, 5, 7]
    for i in range(22):
        wd = widths[i % len(widths)]
        cv2.rectangle(img, (x, 320), (x + wd - 1, 480), (15, 15, 15), -1)
        x += wd + (5 if i % 3 else 3)
    return img


def make_glare_frame():
    img = np.full((800, 1200, 3), (168, 150, 132), np.uint8)
    cv2.rectangle(img, (300, 250), (950, 550), (250, 250, 250), -1)
    return img


def make_faint_frame():
    img = np.full((800, 1200, 3), (168, 150, 132), np.uint8)
    cv2.rectangle(img, (300, 250), (900, 550), (195, 195, 195), -1)
    for i in range(12):
        x = 360 + i * 44
        cv2.rectangle(img, (x, 290), (x + 14, 510), (180, 180, 180), -1)
    return img


def test_ac1():
    print("AC1: service stages == offline generator stages (same input)")
    frame = make_labeled_frame()
    q_svc = processor.detect_candidate(frame)
    q_gen = gen.detect_candidate(frame)
    check("candidate detected", q_svc is not None and q_gen is not None)
    check("quads identical", np.array_equal(q_svc, q_gen))
    s_svc = processor.stage_stages(frame, q_svc, None)
    s_gen = gen.stage_stages(frame, q_gen, None)
    check("same stage names", set(s_svc) == set(s_gen))
    for name in s_gen:
        check(f"stage '{name}' within tolerance", np.allclose(s_svc[name], s_gen[name], atol=1))
    out = processor.process_capture(frame, processor.ServiceConfig())
    q = q_svc
    dh = max(60, int(round((q[:, 1].max() - q[:, 1].min()) * processor.DECODE_W / max(q[:, 0].max() - q[:, 0].min(), 1))))
    crop_gen = gen.rectify(frame, q_gen, processor.DECODE_W, dh)
    pad = processor.ServiceConfig().quiet_pad_px
    crop_svc = out["stages"]["decodeCrop"][pad:-pad, pad:-pad]
    check("decode crop within tolerance", np.allclose(crop_svc, crop_gen, atol=1))
    check("decode pending for browser ZXing", out["decode"]["pending"] is True)
    check("no payload fabricated", "decodedPayload" not in out["decode"])
    check("candidate quad in output", out["candidate"] is not None and len(out["candidate"]["quadPx"]) == 4)
    check("candidate source 'pixels'", out["candidate"]["source"] == "pixels")


def test_ac2():
    print("AC2: no-read inputs -> explicit reasons, no crop")
    cfg = processor.ServiceConfig()
    glare = processor.process_capture(make_glare_frame(), cfg)
    check("glare: no candidate", glare["candidate"] is None)
    check("glare: explicit reason", glare["decode"]["reasons"] == ["QUALITY:GLARE"], str(glare["decode"]["reasons"]))
    check("glare: not pending", glare["decode"]["pending"] is False)
    check("glare: no decode crop", "decodeCrop" not in glare["stages"])

    faint = processor.process_capture(make_faint_frame(), cfg)
    check("faint: no candidate", faint["candidate"] is None)
    check("faint: explicit reason", faint["decode"]["reasons"] == ["QUALITY:LOW_CONTRAST"], str(faint["decode"]["reasons"]))
    check("faint: no decode crop", "decodeCrop" not in faint["stages"])


def test_ac3_config():
    print("AC3: resolution + update rate configurable, independent of input")
    frame = make_labeled_frame(1280, 900)  # 1280px acquisition
    small = processor.ServiceConfig(preview_max_edge=400)
    out = processor.process_capture(processor.downscale(frame, small.preview_max_edge), small)
    w = max(out["stages"]["maskedCrop"].shape[:2])
    check("preview limited by config", w == 400, f"edge={w}")
    check("acquisition size untouched", frame.shape[1] == 1280)

    rl = svc_app.RateLimiter(min_interval_ms=100)
    check("first update allowed", rl.allow("cam-a") is True)
    check("burst within interval dropped", rl.allow("cam-a") is False)
    check("other camera independent", rl.allow("cam-b") is True)
    time.sleep(0.11)
    check("after interval allowed", rl.allow("cam-a") is True)


def _post(port, payload):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/process",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test_app_http():
    print("app: HTTP request/response + throttling")
    cfg = processor.ServiceConfig(preview_max_edge=640, min_update_interval_ms=120)
    server = svc_app.make_server("127.0.0.1", 0, cfg)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    try:
        ok, health = _get(port, "/health")
        check("health", ok == 200 and health == {"ok": True})

        _, img = cv2.imencode(".png", make_labeled_frame(1280, 900))
        cap = {
            "captureId": "live-cap-1", "cameraId": "cam-x",
            "sourceType": "AREA_FRAME", "simTimeMs": 1000,
            "encoderSpanMm": [10, 1010], "seq": 1,
            "imageB64": base64.b64encode(img.tobytes()).decode(),
        }
        code, body = _post(port, cap)
        check("200 on valid capture", code == 200, str(body)[:200])
        for f in ("captureId", "seq", "cameraId", "sourceType", "simTimeMs",
                  "encoderSpanMm", "stages", "candidate", "decode", "processingMs"):
            check(f"contract field '{f}'", f in body)
        names = {s["name"] for s in body["stages"]}
        check("named stages present", {"maskedCrop", "grayscaleContrast", "edgeMap", "candidateOverlay", "decodeCrop"} <= names, str(names))
        for s in body["stages"]:
            check(f"stage '{s['name']}' decodes", cv2.imdecode(np.frombuffer(base64.b64decode(s["dataB64"]), np.uint8), cv2.IMREAD_COLOR) is not None)
        # Preview stages are resolution-capped by config; decodeCrop is a
        # fixed ZXing-scale rectification (config.decode_w), not a preview.
        previews = [s for s in body["stages"] if s["name"] != "decodeCrop"]
        check("previews downscaled by config", all(max(s["width"], s["height"]) <= 640 for s in previews))
        dc = next(s for s in body["stages"] if s["name"] == "decodeCrop")
        check("decode crop at fixed ZXing width", dc["width"] == 1300 + 2 * processor.ServiceConfig().quiet_pad_px, str(dc["width"]))
        check("pending decode for browser", body["decode"]["pending"] is True)
        check("processing duration > 0", body["processingMs"] > 0)

        code2, body2 = _post(port, cap)  # immediate burst
        check("429 on burst (update-rate limit)", code2 == 429 and body2.get("reason") == "THROTTLED", str(body2))
        time.sleep(0.14)
        code3, _ = _post(port, cap)
        check("200 after interval", code3 == 200)

        code4, _ = _post(port, {**cap, "imageB64": base64.b64encode(b"not an image").decode()})
        check("400 on undecodable image", code4 == 400)
    finally:
        server.server_close()


def _get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return r.status, json.loads(r.read())


def main():
    t0 = time.time()
    test_ac1()
    test_ac2()
    test_ac3_config()
    test_app_http()
    print(f"\n{PASS} checks passed in {time.time() - t0:.1f}s — ALL OK")


if __name__ == "__main__":
    main()
