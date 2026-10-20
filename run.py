import os
import sys
import time
import socket
from werkzeug.serving import make_server
import config
from core import create_app
from core.updater import start_updater_daemon

app = create_app()
server = None
restart_requested = False

def trigger_restart():
    global restart_requested
    restart_requested = True
    if server:
        server.shutdown()

if __name__ == "__main__":
    server = make_server(config.HOST, config.PORT, app, threaded=True)
    server.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)

    if config.GITHUB_WATCH_ENABLED:
        start_updater_daemon(
            remote=config.GITHUB_REMOTE,
            branch=config.GITHUB_BRANCH,
            interval=config.UPDATE_CHECK_INTERVAL,
            on_update=trigger_restart
        )

    print(f"[SERVER] Starting modular server on http://{config.HOST}:{config.PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SERVER] Stopping server...")
    finally:
        server.server_close()

    if restart_requested:
        time.sleep(0.5)
        print("[SERVER] Port released. Restarting webserver process...")
        os.execv(sys.executable, [sys.executable] + sys.argv)
