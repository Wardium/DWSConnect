import os
import sys
import time
import threading
import subprocess
import config

def _run_cmd(cmd):
    return subprocess.run(
        cmd, cwd=config.BASE_DIR, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )

def check_and_apply_updates(remote="origin", branch="main"):
    # Ensure current directory is a git repo
    if not os.path.exists(os.path.join(config.BASE_DIR, ".git")):
        return False

    # Fetch latest metadata from GitHub
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

        # Sync dependencies if requirements.txt changed
        req_file = os.path.join(config.BASE_DIR, "requirements.txt")
        if os.path.exists(req_file):
            _run_cmd([sys.executable, "-m", "pip", "install", "-r", req_file, "--quiet"])

        print("[UPDATER] Upgrade complete. Restarting webserver process...")
        os.execv(sys.executable, [sys.executable] + sys.argv)
        return True

    return False

def start_updater_daemon(remote="origin", branch="main", interval=30):
    def _watch_loop():
        print(f"[UPDATER] Watching GitHub ({remote}/{branch}) every {interval}s...")
        while True:
            try:
                check_and_apply_updates(remote, branch)
            except Exception as exc:
                print(f"[UPDATER] Error checking repo: {exc}")
            time.sleep(interval)

    thread = threading.Thread(target=_watch_loop, daemon=True)
    thread.start()
