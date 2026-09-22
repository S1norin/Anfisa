"""Live-preview HTTP service (t7-2, sub-task s2).

Stdlib-only (requirements-hiw.txt stays numpy + opencv — no framework):

    python3 services/live_processing/app.py --port 8790

POST /process
  request JSON:
    { captureId, cameraId, sourceType: 'AREA_FRAME'|'LINE_STRIP',
      simTimeMs, encoderSpanMm: [a, b], seq,
      imageB64, imageMime: 'image/png'|'image/jpeg' }
  response JSON — the LiveProcessingResult contract
  (src/live-processing/contracts.ts), stages base64-encoded:
    200 { captureId, seq, cameraId, sourceType, simTimeMs, encoderSpanMm,
          stages: [{name, dataB64, mime, width, height}],
          candidate: {quadPx, source} | null,
          decode: {decoded, pending?, decodedPayload?, reasons, confidence},
          processingMs }
  400 bad request / undecodable image
  429 throttled (update-rate limit, per camera)

GET /health -> {"ok": true}
"""

from __future__ import annotations

import argparse
import base64
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

from processor import ServiceConfig, downscale, process_capture


class RateLimiter:
    """Per-camera minimum update interval — independent of acquisition."""

    def __init__(self, min_interval_ms: int) -> None:
        self._min_s = min_interval_ms / 1000.0
        self._last: dict[str, float] = {}
        self._lock = threading.Lock()

    def allow(self, camera_id: str) -> bool:
        now = time.monotonic()
        with self._lock:
            last = self._last.get(camera_id)
            if last is not None and now - last < self._min_s:
                return False
            self._last[camera_id] = now
            return True


def _encode_png(img: np.ndarray) -> tuple[bytes, int, int]:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("PNG encode failed")
    h, w = img.shape[:2]
    return buf.tobytes(), w, h


class Handler(BaseHTTPRequestHandler):
    server_version = "AnfisaLiveProc/1"
    config: ServiceConfig = ServiceConfig()
    limiter: RateLimiter = RateLimiter(250)

    def log_message(self, *a: object) -> None:  # quiet
        pass

    def _cors(self) -> None:
        # Browser UI (localhost:5173) talks cross-origin to 127.0.0.1:8790.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/process":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length))
            img_b64 = req["imageB64"]
            frame = cv2.imdecode(
                np.frombuffer(base64.b64decode(img_b64), np.uint8),
                cv2.IMREAD_COLOR,
            )
            if frame is None:
                raise ValueError("undecodable image")
        except Exception as e:  # noqa: BLE001
            self._send(400, {"error": f"bad request: {e}"})
            return

        camera_id = str(req.get("cameraId", ""))
        if not self.limiter.allow(camera_id):
            self._send(429, {"reason": "THROTTLED"})
            return

        frame = downscale(frame, self.config.preview_max_edge)
        started = time.monotonic()
        out = process_capture(frame, self.config)
        stages_json = []
        for name, img in out["stages"].items():
            data, w, h = _encode_png(img)
            stages_json.append(
                {
                    "name": name,
                    "dataB64": base64.b64encode(data).decode(),
                    "mime": "image/png",
                    "width": w,
                    "height": h,
                }
            )
        self._send(
            200,
            {
                "captureId": req.get("captureId"),
                "seq": req.get("seq", 0),
                "cameraId": camera_id,
                "sourceType": req.get("sourceType", "AREA_FRAME"),
                "simTimeMs": req.get("simTimeMs", 0),
                "encoderSpanMm": req.get("encoderSpanMm", [0, 0]),
                "stages": stages_json,
                "candidate": out["candidate"],
                "decode": out["decode"],
                "processingMs": out["processingMs"],
            },
        )


def make_server(host: str, port: int, config: ServiceConfig):
    handler = type(
        "BoundHandler",
        (Handler,),
        {"config": config, "limiter": RateLimiter(config.min_update_interval_ms)},
    )
    return ThreadingHTTPServer((host, port), handler)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8790)
    ap.add_argument("--preview-max-edge", type=int, default=1440)
    ap.add_argument("--min-update-interval-ms", type=int, default=250)
    a = ap.parse_args()
    cfg = ServiceConfig(
        preview_max_edge=a.preview_max_edge,
        min_update_interval_ms=a.min_update_interval_ms,
    )
    server = make_server(a.host, a.port, cfg)
    print(f"live-processing service on http://{a.host}:{a.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
