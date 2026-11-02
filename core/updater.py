import os
import sys
import time
import json
import datetime
import threading
import subprocess
import config

_shutdown_callback = None
UPDATER_STATUS_FILE = os.path.join(config.DATA_DIR, "updater_status.json")
_status_lock = threading.Lock()


def _now_str():
    return datetime.datetime.now().strftime("%Y-%m-%d %I:%M:%S %p")


def _run_cmd(cmd):
    return subprocess.run(
        cmd,
        cwd=config.BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        close_fds=True
    )


def _read_git_metadata():
    if not os.path.exists(os.path.join(config.BASE_DIR, ".git")):
        return {"commit": "no-git", "message": "Not a git repository", "commit_date": "Unknown"}
    commit = _run_cmd(["git", "rev-parse", "--short", "HEAD"]).stdout.strip() or "unknown"
    msg = _run_cmd(["git", "log", "-1", "--format=%s"]).stdout.strip() or ""
    cdate = _run_cmd(["git", "log", "-1", "--format=%cr (%cd)", "--date=short"]).stdout.strip() or ""
    return {"commit": commit, "message": msg, "commit_date": cdate}


def _save_updater_state(updates_dict):
    os.makedirs(config.DATA_DIR, exist_ok=True)
    with _status_lock:
        current = {}
        if os.path.exists(UPDATER_STATUS_FILE):
            try:
                with open(UPDATER_STATUS_FILE, "r", encoding="utf-8") as f:
                    current = json.load(f)
            except Exception:
                current = {}
        current.update(updates_dict)
        with open(UPDATER_STATUS_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=4)


def get_updater_status():
    git_meta = _read_git_metadata()
    state = {
        "last_checked": "Never",
        "last_updated": "Server initial boot",
        "last_update_commit": git_meta["commit"],
        "status": "Watching GitHub" if config.GITHUB_WATCH_ENABLED else "Disabled"
    }
    if os.path.exists(UPDATER_STATUS_FILE):
        try:
            with open(UPDATER_STATUS_FILE, "r", encoding="utf-8") as f:
                state.update(json.load(f))
        except Exception:
            pass
    state["current_commit"] = git_meta["commit"]
    state["commit_message"] = git_meta["message"]
    state["commit_date"] = git_meta["commit_date"]
    return state


def check_and_apply_updates(remote="origin", branch="main"):
    if not os.path.exists(os.path.join(config.BASE_DIR, ".git")):
        _save_updater_state({"last_checked": _now_str(), "status": "No .git folder found"})
        return False

    fetch_res = _run_cmd(["git", "fetch", remote, branch])
    if fetch_res.returncode != 0:
        _save_updater_state({"last_checked": _now_str(), "status": "Git fetch failed"})
        return False

    local_hash = _run_cmd(["git", "rev-parse", "HEAD"]).stdout.strip()
    remote_hash = _run_cmd(["git", "rev-parse", f"{remote}/{branch}"]).stdout.strip()

    _save_updater_state({
        "last_checked": _now_str(),
        "status": "Up to date"
    })

    if local_hash and remote_hash and local_hash != remote_hash:
        print(f"[UPDATER] Update detected ({local_hash[:7]} -> {remote_hash[:7]}). Upgrading...")
        pull_res = _run_cmd(["git", "pull", "--ff-only", remote, branch])
        if pull_res.returncode != 0:
            print(f"[UPDATER] Git pull failed: {pull_res.stderr}")
            _save_updater_state({
                "last_checked": _now_str(),
                "status": f"Git pull failed: {pull_res.stderr.strip()[:80]}"
            })
            return False

        req_file = os.path.join(config.BASE_DIR, "requirements.txt")
        if os.path.exists(req_file):
            _run_cmd([sys.executable, "-m", "pip", "install", "-r", req_file, "--quiet"])

        new_meta = _read_git_metadata()
        _save_updater_state({
            "last_checked": _now_str(),
            "last_updated": _now_str(),
            "last_update_commit": f"{local_hash[:7]} → {remote_hash[:7]}",
            "commit_message": new_meta["message"],
            "status": "Updated & Restarted"
        })

        print("[UPDATER] Upgrade complete. Closing port 5050 for restart...")
        if _shutdown_callback:
            _shutdown_callback()
        return True

    return False


def start_updater_daemon(remote="origin", branch="main", interval=30, on_update=None):
    global _shutdown_callback
    _shutdown_callback = on_update

    # Record initial boot state if file doesn't exist yet
    if not os.path.exists(UPDATER_STATUS_FILE):
        meta = _read_git_metadata()
        _save_updater_state({
            "last_checked": _now_str(),
            "last_updated": f"Booted on {meta['commit']} ({meta['commit_date']})",
            "last_update_commit": meta["commit"],
            "status": "Watching GitHub"
        })

    def _watch_loop():
        print(f"[UPDATER] Watching GitHub ({remote}/{branch}) every {interval}s...")
        while True:
            try:
                if check_and_apply_updates(remote, branch):
                    break
            except Exception as exc:
                print(f"[UPDATER] Error checking repo: {exc}")
            time.sleep(interval)

    thread = threading.Thread(target=_watch_loop, daemon=True)
    thread.start()
