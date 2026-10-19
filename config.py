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
