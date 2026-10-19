import uuid
from flask import Blueprint, render_template, request, jsonify
from core.storage import StorageManager

blueprint = Blueprint("dashboard", __name__)

@blueprint.route("/")
def index():
    return render_template("index.html")

@blueprint.route("/api/settings", methods=["GET"])
def get_settings():
    return jsonify(StorageManager.load_settings())

@blueprint.route("/api/apps", methods=["POST"])
def add_app():
    settings = StorageManager.load_settings()

    name = request.form.get("name", "Untitled App").strip()
    url = request.form.get("url", "#").strip()
    iframe = request.form.get("iframe", "false").lower() == "true"
    icon_url = request.form.get("icon_url", "").strip()

    # Handle uploaded transparent PNG/SVG icon
    if "icon_file" in request.files and request.files["icon_file"].filename != "":
        try:
            icon_url = StorageManager.save_upload(request.files["icon_file"], prefix="icon")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    new_app = {
        "id": uuid.uuid4().hex[:10],
        "name": name,
        "url": url,
        "icon": icon_url,
        "iframe": iframe
    }

    settings["apps"].append(new_app)
    StorageManager.save_settings(settings)
    return jsonify({"status": "ok", "app": new_app, "settings": settings})

@blueprint.route("/api/apps/<app_id>", methods=["DELETE"])
def delete_app(app_id):
    settings = StorageManager.load_settings()
    settings["apps"] = [a for a in settings["apps"] if a["id"] != app_id]
    StorageManager.save_settings(settings)
    return jsonify({"status": "ok", "settings": settings})

@blueprint.route("/api/background", methods=["POST"])
def update_background():
    settings = StorageManager.load_settings()
    bg_url = request.form.get("bg_url", "").strip()

    if "bg_file" in request.files and request.files["bg_file"].filename != "":
        try:
            bg_url = StorageManager.save_upload(request.files["bg_file"], prefix="bg")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    ext = bg_url.rsplit(".", 1)[-1].lower() if "." in bg_url else "svg"
    settings["background"]["url"] = bg_url
    settings["background"]["type"] = ext
    StorageManager.save_settings(settings)
    return jsonify({"status": "ok", "background": settings["background"]})
