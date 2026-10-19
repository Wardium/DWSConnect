import os
import importlib
from flask import Flask
import config
from core.storage import StorageManager

def create_app():
    app = Flask(
        __name__,
        template_folder=os.path.join(config.BASE_DIR, "templates"),
        static_folder=os.path.join(config.BASE_DIR, "static")
    )

    # Ensure server-side storage directories exist
    StorageManager.initialize()

    # Auto-discover and register all modules inside /modules
    modules_dir = os.path.join(config.BASE_DIR, "modules")
    if os.path.exists(modules_dir):
        for folder in sorted(os.listdir(modules_dir)):
            mod_path = os.path.join(modules_dir, folder)
            if os.path.isdir(mod_path) and os.path.exists(os.path.join(mod_path, "__init__.py")):
                module = importlib.import_module(f"modules.{folder}")
                if hasattr(module, "blueprint"):
                    app.register_blueprint(module.blueprint)
                    print(f"[MODULE LOADER] Registered module: {folder}")

    return app
