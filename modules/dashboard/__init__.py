import time
import uuid
import os
from flask import Blueprint, render_template, jsonify, request, make_response
import config
from core.storage import StorageManager

blueprint = Blueprint("dashboard", __name__)


@blueprint.after_app_request
def add_performance_headers(response):
    # Prevent stale socket hangs while caching static assets cleanly
    if request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@blueprint.route("/")
def index():
    return render_template("index.html", servers=config.SERVERS)


@blueprint.route("/api/ping", methods=["GET"])
def ping():
    # Lightweight endpoint for the live connection speed & latency graph
    burst = request.args.get("burst", "0") == "1"
    payload = "DWS" * (16384 if burst else 32)
    resp = make_response(jsonify({
        "ok": True,
        "ts": time.time(),
        "bytes": len(payload),
        "d": payload
    }))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


@blueprint.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(StorageManager.load_settings())


@blueprint.route("/api/apps", methods=["POST"])
def add_app():
    try:
        settings = StorageManager.load_settings()
        name = request.form.get("name", "").strip()
        url = request.form.get("url", "").strip()
        iframe = request.form.get("iframe", "true").lower() == "true"

        if not name or not url:
            return jsonify({"error": "App name and URL are required."}), 400

        icon_url = request.form.get("icon_url", "").strip()
        if "icon_file" in request.files and request.files["icon_file"].filename:
            icon_url = StorageManager.save_upload(request.files["icon_file"], prefix="icon")

        new_app = {
            "id": uuid.uuid4().hex[:10],
            "name": name,
            "url": url,
            "icon": icon_url or "",
            "iframe": iframe
        }
        settings.setdefault("apps", []).append(new_app)
        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "settings": settings})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@blueprint.route("/api/apps/<app_id>", methods=["DELETE"])
def delete_app(app_id):
    settings = StorageManager.load_settings()
    settings["apps"] = [a for a in settings.get("apps", []) if a.get("id") != app_id]
    StorageManager.save_settings(settings)
    return jsonify({"ok": True, "settings": settings})


@blueprint.route("/api/background", methods=["POST"])
def update_background():
    try:
        settings = StorageManager.load_settings()
        bg_url = request.form.get("bg_url", "").strip()
        reset_default = request.form.get("reset_default", "false") == "true"

        if reset_default:
            settings["background"] = {"url": "", "type": "svg", "parallax_intensity": 28}
        else:
            if "bg_file" in request.files and request.files["bg_file"].filename:
                bg_url = StorageManager.save_upload(request.files["bg_file"], prefix="bg")
            settings["background"] = {
                "url": bg_url,
                "type": "image" if bg_url else "svg",
                "parallax_intensity": 28
            }

        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "background": settings["background"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 400
