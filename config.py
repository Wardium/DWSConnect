import os

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
UPLOAD_DIR = os.path.join(BASE_DIR, "static", "uploads")
SETTINGS_FILE = os.path.join(DATA_DIR, "settings.json")

# Server Network Config
HOST = "0.0.0.0"
PORT = 5050
DEBUG = False  # Keep False when using the GitHub auto-updater daemon

# GitHub Auto-Updater Config
GITHUB_WATCH_ENABLED = True
GITHUB_REMOTE = "origin"
GITHUB_BRANCH = "main"
UPDATE_CHECK_INTERVAL = 30  # Seconds between remote hash checks

ALLOWED_EXTENSIONS = {"png", "svg", "jpg", "jpeg", "webp", "gif"}

# Multi-Server SSH / SFTP Configuration
SERVERS = {
    "1": {
        "name": "Server 1 (Win)",
        "host": "192.168.2.143",
        "user": "dylan",
        "password": os.environ.get("DWS_SRV1_PASS", "weqr1234"),
    },
    "2": {
        "name": "Server 2 (Win)",
        "host": "192.168.2.91",
        "user": "dylanwardstudios",
        "password": os.environ.get("DWS_SRV2_PASS", "weqr1234"),
    },
    "3": {
        "name": "Server 3 (Pi)",
        "host": "192.168.2.134",
        "user": "dylan",
        "password": os.environ.get("DWS_SRV3_PASS", "sIjkew-1qixwe-sogcog"),
    },
}
