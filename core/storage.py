import os
import copy
import json
import uuid
import threading
from werkzeug.utils import secure_filename
import config

_lock = threading.Lock()

DEFAULT_SETTINGS = {
    "ui": {
        "theme": "auto",           # "auto" (OS sync), "dark", or "light"
        "accent": "aurora",        # "aurora", "emerald", "plasma", "crimson", "solar"
        "glass_blur": 24,
        "parallax_intensity": 28,
        "liquid_animations": True
    },
    "background": {
        "url": "",                 # Static custom background URL
        "type": "svg",             # "svg" or "image"
        "parallax_intensity": 28,
        "time_based_enabled": False,
        "time_wallpapers": {
            "morning": "",         # 06:00 - 11:59
            "afternoon": "",       # 12:00 - 16:59
            "evening": "",         # 17:00 - 20:59
            "night": ""            # 21:00 - 05:59
        }
    },
    "apps": [
        {
            "id": "default-1",
            "name": "Example Wiki",
            "url": "https://en.wikipedia.org",
            "icon": "",
            "iframe": True,
            "launch_mode": "center",  # "center", "dropdown", or "tab"
            "subject_type": "Knowledge Base"
        }
    ],
    "servers": copy.deepcopy(config.DEFAULT_SERVERS),
    "drive_aliases": {}  # Maps "<server_id>:<mount>" -> "Custom Server-Wide Drive Name"
}


class StorageManager:
    @staticmethod
    def initialize():
        os.makedirs(config.DATA_DIR, exist_ok=True)
        os.makedirs(config.UPLOAD_DIR, exist_ok=True)
        if not os.path.exists(config.SETTINGS_FILE):
            StorageManager.save_settings(DEFAULT_SETTINGS)
        else:
            # Ensure newly added keys exist in older settings.json files
            current = StorageManager.load_settings()
            StorageManager.save_settings(current)

    @staticmethod
    def _merge_defaults(data):
        merged = copy.deepcopy(DEFAULT_SETTINGS)
        if not isinstance(data, dict):
            return merged

        for key in ("ui", "background", "drive_aliases"):
            if isinstance(data.get(key), dict):
                merged[key].update(data[key])
                if key == "background" and isinstance(data["background"].get("time_wallpapers"), dict):
                    merged["background"]["time_wallpapers"].update(data["background"]["time_wallpapers"])

        if isinstance(data.get("apps"), list):
            merged["apps"] = data["apps"]
            for app in merged["apps"]:
                if "launch_mode" not in app:
                    app["launch_mode"] = "center" if app.get("iframe", True) else "tab"
                if "subject_type" not in app:
                    app["subject_type"] = "Web App"

        if isinstance(data.get("servers"), dict) and data["servers"]:
            merged["servers"] = data["servers"]
            for sid, srv in merged["servers"].items():
                srv["id"] = str(sid)
                if not srv.get("shell_url"):
                    srv["shell_url"] = f"https://device.teamexist.com/shell/{sid}"

        return merged

    @staticmethod
    def load_settings():
        with _lock:
            try:
                with open(config.SETTINGS_FILE, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                return StorageManager._merge_defaults(raw)
            except Exception:
                return copy.deepcopy(DEFAULT_SETTINGS)

    @staticmethod
    def save_settings(data):
        with _lock:
            clean = StorageManager._merge_defaults(data)
            with open(config.SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(clean, f, indent=4)
            return clean

    @staticmethod
    def get_public_settings():
        """Returns settings safe for frontend broadcast (masks raw SSH passwords)."""
        settings = StorageManager.load_settings()
        pub = copy.deepcopy(settings)
        for sid, srv in pub.get("servers", {}).items():
            srv["has_password"] = bool(srv.get("password"))
            srv.pop("password", None)
        return pub

    @staticmethod
    def allowed_file(filename):
        return "." in filename and filename.rsplit(".", 1)[1].lower() in config.ALLOWED_EXTENSIONS

    @staticmethod
    def save_upload(file_storage, prefix="asset"):
        if not file_storage or file_storage.filename == "":
            return None
        if not StorageManager.allowed_file(file_storage.filename):
            raise ValueError("Unsupported file extension.")
        ext = file_storage.filename.rsplit(".", 1)[1].lower()
        safe_name = secure_filename(f"{prefix}_{uuid.uuid4().hex[:10]}.{ext}")
        dest_path = os.path.join(config.UPLOAD_DIR, safe_name)
        file_storage.save(dest_path)
        return f"/static/uploads/{safe_name}"
