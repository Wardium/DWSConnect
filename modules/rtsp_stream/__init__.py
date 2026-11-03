import shutil
import subprocess
import time
from urllib.parse import quote
from flask import Blueprint, Response, jsonify, render_template_string, request
from core.storage import StorageManager

blueprint = Blueprint("rtsp_stream", __name__)


@blueprint.route("/api/apps/reorder", methods=["POST"])
def reorder_apps():
    """Persists drag-and-drop app icon order (and optional category changes)."""
    payload = request.get_json(silent=True) or {}
    order_ids = payload.get("order") or []
    updated_subject_map = payload.get("subject_types") or {}

    if not isinstance(order_ids, list):
        return jsonify({"ok": False, "error": "Invalid order list"}), 400

    settings = StorageManager.load_settings()
    apps = settings.get("apps", [])
    app_map = {str(a.get("id")): a for a in apps if a.get("id")}

    new_apps = []
    seen = set()
    for aid in order_ids:
        sid = str(aid)
        if sid in app_map and sid not in seen:
            app_obj = app_map[sid]
            if sid in updated_subject_map and updated_subject_map[sid]:
                app_obj["subject_type"] = str(updated_subject_map[sid]).strip()
            new_apps.append(app_obj)
            seen.add(sid)

    # Keep any remaining apps that weren't in order_ids
    for a in apps:
        sid = str(a.get("id"))
        if sid not in seen:
            new_apps.append(a)

    settings["apps"] = new_apps
    StorageManager.save_settings(settings)
    return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})


def _stream_rtsp_ffmpeg(rtsp_url):
    """Streams RTSP to multipart MJPEG via FFmpeg subprocess over TCP."""
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-loglevel", "error",
        "-rtsp_transport", "tcp",
        "-fflags", "nobuffer",
        "-flags", "low_delay",
        "-i", rtsp_url,
        "-f", "mpjpeg",
        "-q:v", "5",
        "-r", "20",
        "-an",
        "-"
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        bufsize=0
    )
    buffer = bytearray()
    try:
        while True:
            chunk = proc.stdout.read(8192)
            if not chunk:
                break
            buffer.extend(chunk)
            while True:
                soi = buffer.find(b"\xff\xd8")
                if soi == -1:
                    buffer.clear()
                    break
                eoi = buffer.find(b"\xff\xd9", soi + 2)
                if eoi == -1:
                    if soi > 0:
                        del buffer[:soi]
                    break
                frame = bytes(buffer[soi:eoi + 2])
                del buffer[:eoi + 2]
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame)).encode("ascii") + b"\r\n\r\n"
                    + frame + b"\r\n"
                )
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def _stream_rtsp_opencv(rtsp_url):
    """Fallback RTSP-to-MJPEG generator using OpenCV (cv2)."""
    import cv2

    cap = cv2.VideoCapture(rtsp_url)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    try:
        while cap.isOpened():
            ok, frame = cap.read()
            if not ok or frame is None:
                time.sleep(0.1)
                continue
            ret, jpeg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ret:
                continue
            data = jpeg.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(data)).encode("ascii") + b"\r\n\r\n"
                + data + b"\r\n"
            )
    finally:
        cap.release()


@blueprint.route("/api/stream/rtsp")
def api_stream_rtsp():
    """Live MJPEG relay endpoint for RTSP camera streams."""
    rtsp_url = (request.args.get("url") or "").strip()
    if not rtsp_url:
        return jsonify({"ok": False, "error": "Missing RTSP url parameter"}), 400

    if shutil.which("ffmpeg"):
        generator = _stream_rtsp_ffmpeg(rtsp_url)
    else:
        try:
            import cv2  # noqa: F401
            generator = _stream_rtsp_opencv(rtsp_url)
        except ImportError:
            return (
                "Neither ffmpeg nor opencv-python is installed on the server. "
                "Install ffmpeg or run: pip install opencv-python-headless",
                501,
            )

    headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Accel-Buffering": "no",
    }
    return Response(
        generator,
        mimetype="multipart/x-mixed-replace; boundary=frame",
        headers=headers,
    )


PLAYER_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{ title }}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #050811; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
  }
  .player-stage {
    position: relative; width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: radial-gradient(circle at center, #0c1428 0%, #050811 100%);
  }
  #cam-stream {
    width: 100%; height: 100%;
    object-fit: contain;
    display: block;
    transition: object-fit 0.2s ease;
  }
  #cam-stream.fill-mode { object-fit: cover; }
  .cam-hud {
    position: absolute; top: 10px; left: 10px; right: 10px;
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 7px 12px; border-radius: 999px;
    background: rgba(5, 8, 17, 0.68);
    backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    opacity: 0; transform: translateY(-4px);
    transition: opacity 0.25s ease, transform 0.25s ease;
    pointer-events: none;
    z-index: 10;
  }
  .player-stage:hover .cam-hud, .player-stage.hud-pinned .cam-hud {
    opacity: 1; transform: translateY(0); pointer-events: auto;
  }
  .hud-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .live-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #34d399; box-shadow: 0 0 10px #34d399;
    flex-shrink: 0;
  }
  .live-dot.err { background: #f87171; box-shadow: 0 0 10px #f87171; }
  .cam-name {
    font-size: 12px; font-weight: 700;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .hud-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .hud-btn {
    padding: 4px 10px; border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.22);
    background: rgba(255, 255, 255, 0.1);
    color: #fff; font-size: 11px; font-weight: 600; cursor: pointer;
    transition: background 0.2s ease, transform 0.2s ease;
  }
  .hud-btn:hover { background: rgba(56, 189, 248, 0.45); transform: scale(1.05); }
  .cam-status-overlay {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 10px; background: rgba(5, 8, 17, 0.78);
    font-size: 13px; color: rgba(255, 255, 255, 0.78);
    z-index: 5;
  }
  .cam-status-overlay.hidden { display: none; }
</style>
</head>
<body>
  <div class="player-stage" id="stage">
    <div class="cam-hud">
      <div class="hud-left">
        <span class="live-dot" id="live-dot"></span>
        <span class="cam-name">{{ title }}</span>
      </div>
      <div class="hud-actions">
        <button class="hud-btn" id="btn-aspect" title="Toggle Fit / Fill">Fit</button>
        <button class="hud-btn" id="btn-snap" title="Save Snapshot">📷 Snap</button>
        <button class="hud-btn" id="btn-reconnect" title="Reconnect Stream">↻</button>
        <button class="hud-btn" id="btn-fs" title="Fullscreen">⛶</button>
      </div>
    </div>
    <div class="cam-status-overlay" id="status-overlay">
      <span id="status-msg">Connecting to RTSP camera...</span>
      <button class="hud-btn" id="btn-retry-center">Retry Stream</button>
    </div>
    <img id="cam-stream" src="{{ stream_src }}" alt="{{ title }}" crossorigin="anonymous" />
  </div>
<script>
  const img = document.getElementById("cam-stream");
  const dot = document.getElementById("live-dot");
  const overlay = document.getElementById("status-overlay");
  const statusMsg = document.getElementById("status-msg");
  const baseSrc = {{ stream_src | tojson }};

  function reconnect() {
    overlay.classList.remove("hidden");
    statusMsg.textContent = "Reconnecting to RTSP feed...";
    dot.classList.remove("err");
    img.src = baseSrc + "&_t=" + Date.now();
  }

  img.addEventListener("load", () => {
    overlay.classList.add("hidden");
    dot.classList.remove("err");
  });

  img.addEventListener("error", () => {
    dot.classList.add("err");
    overlay.classList.remove("hidden");
    statusMsg.textContent = "Stream disconnected or unreachable.";
  });

  document.getElementById("btn-reconnect").addEventListener("click", reconnect);
  document.getElementById("btn-retry-center").addEventListener("click", reconnect);

  document.getElementById("btn-aspect").addEventListener("click", (e) => {
    img.classList.toggle("fill-mode");
    e.target.textContent = img.classList.contains("fill-mode") ? "Fill" : "Fit";
  });

  document.getElementById("btn-snap").addEventListener("click", () => {
    try {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth || 1280;
      c.height = img.naturalHeight || 720;
      c.getContext("2d").drawImage(img, 0, 0);
      const a = document.createElement("a");
      a.download = "rtsp_snapshot_" + Date.now() + ".jpg";
      a.href = c.toDataURL("image/jpeg", 0.92);
      a.click();
    } catch (err) {}
  });

  document.getElementById("btn-fs").addEventListener("click", () => {
    const st = document.getElementById("stage");
    if (!document.fullscreenElement) st.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  });
</script>
</body>
</html>
"""


@blueprint.route("/stream/player")
def stream_player():
    """Renders an embeddable RTSP player for Center Stage, Dropdown Widget, or New Tab."""
    rtsp_url = (request.args.get("url") or "").strip()
    title = (request.args.get("title") or "RTSP Camera").strip()
    if rtsp_url.lower().startswith(("rtsp://", "rtsps://")):
        stream_src = f"/api/stream/rtsp?url={quote(rtsp_url, safe='')}"
    else:
        stream_src = rtsp_url
    return render_template_string(PLAYER_HTML, title=title, stream_src=stream_src)
