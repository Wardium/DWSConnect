import os
import json
import uuid
import threading
from werkzeug.utils import secure_filename
import config

_lock = threading.Lock()

DEFAULT_SETTINGS = {
    "background": {
        "url": "",  # Empty uses the built-in animated SVG vector background
        "type": "svg",
        "parallax_intensity": 28
    },
    "apps": [
        {
            "id": "default-1",
            "name": "Example Wiki",
            "url": "https://en.wikipedia.org",
            "icon": "",
            "iframe": True
        }
    ]
}

class StorageManager:
    @staticmethod
    def initialize():
        os.makedirs(config.DATA_DIR, exist_ok=True)
        os.makedirs(config.UPLOAD_DIR, exist_ok=True)
        if not os.path.exists(config.SETTINGS_FILE):
            StorageManager.save_settings(DEFAULT_SETTINGS)

    @staticmethod
    def load_settings():
        with _lock:
            try:
                with open(config.SETTINGS_FILE, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return DEFAULT_SETTINGS.copy()

    @staticmethod
    def save_settings(data):
        with _lock:
            with open(config.SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4)

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
