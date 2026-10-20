import os
import sys
import time
import threading
import subprocess
import config

_shutdown_callback = None

def _run_cmd(cmd):
    return subprocess.run(
        cmd,
        cwd=config.BASE_DIR,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        close_fds=True
    )

def check_and_apply_updates(remote="origin", branch="main"):
    if not os.path.exists(os.path.join(config.BASE_DIR, ".git")):
        return False

    fetch_res = _run_cmd(["git", "fetch", remote, branch])
    if fetch_res.returncode != 0:
        return False

    local_hash = _run_cmd(["git", "rev-parse", "HEAD"]).stdout.strip()
    remote_hash = _run_cmd(["git", "rev-parse", f"{remote}/{branch}"]).stdout.strip()

    if local_hash and remote_hash and local_hash != remote_hash:
        print(f"[UPDATER] Update detected ({local_hash[:7]} -> {remote_hash[:7]}). Upgrading...")

        pull_res = _run_cmd(["git", "pull", "--ff-only", remote, branch])
        if pull_res.returncode != 0:
            print(f"[UPDATER] Git pull failed: {pull_res.stderr}")
            return False

        req_file = os.path.join(config.BASE_DIR, "requirements.txt")
        if os.path.exists(req_file):
            _run_cmd([sys.executable, "-m", "pip", "install", "-r", req_file, "--quiet"])

        print("[UPDATER] Upgrade complete. Closing port 5050 for restart...")
        if _shutdown_callback:
            _shutdown_callback()
        return True

    return False

def start_updater_daemon(remote="origin", branch="main", interval=30, on_update=None):
    global _shutdown_callback
    _shutdown_callback = on_update

    def _watch_loop():
        print(f"[UPDATER] Watching GitHub ({remote}/{branch}) every {interval}s...")
        while True:
            try:
                if check_and_apply_updates(remote, branch):
                    break  # Exit watcher loop while main thread restarts
            except Exception as exc:
                print(f"[UPDATER] Error checking repo: {exc}")
            time.sleep(interval)

    thread = threading.Thread(target=_watch_loop, daemon=True)
    thread.start()
