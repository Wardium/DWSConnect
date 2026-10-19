import config
from core import create_app
from core.updater import start_updater_daemon

app = create_app()

if __name__ == "__main__":
    if config.GITHUB_WATCH_ENABLED:
        start_updater_daemon(
            remote=config.GITHUB_REMOTE,
            branch=config.GITHUB_BRANCH,
            interval=config.UPDATE_CHECK_INTERVAL
        )
    print(f"[SERVER] Starting modular server on http://{config.HOST}:{config.PORT}")
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG, use_reloader=False)
