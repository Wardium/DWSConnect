import ssl
import json
import time
import uuid
import urllib.request
import urllib.error
from flask import Blueprint, render_template, jsonify, request, make_response, redirect
import config
from core.storage import StorageManager
from core.updater import get_updater_status, check_and_apply_updates

blueprint = Blueprint("dashboard", __name__)
BOOT_VERSION = str(int(time.time()))


@blueprint.after_app_request
def add_performance_headers(response):
    # Never hard-cache JS/CSS so GitHub auto-updates apply immediately on refresh
    if request.path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
    elif request.path.startswith("/static/"):
        response.headers["Cache-Control"] = "public, max-age=3600"
    return response


@blueprint.route("/")
def index():
    pub = StorageManager.get_public_settings()
    upd = get_updater_status()
    asset_v = f"{upd.get('current_commit', 'v1')}_{BOOT_VERSION}"
    return render_template("index.html", servers=pub.get("servers", {}), asset_v=asset_v)


@blueprint.route("/api/updater/status", methods=["GET"])
def api_updater_status():
    return jsonify({"ok": True, "updater": get_updater_status()})


@blueprint.route("/api/updater/check", methods=["POST"])
def api_updater_check_now():
    updated = check_and_apply_updates(config.GITHUB_REMOTE, config.GITHUB_BRANCH)
    return jsonify({
        "ok": True,
        "updated": updated,
        "updater": get_updater_status()
    })


@blueprint.route("/shell/<server_id>")
def shell_redirect(server_id):
    settings = StorageManager.load_settings()
    srv = settings.get("servers", {}).get(str(server_id), {})
    target = srv.get("shell_url") or f"https://device.teamexist.com/shell/{server_id}"
    return redirect(target)


@blueprint.route("/api/ping", methods=["GET"])
def ping():
    burst = request.args.get("burst", "0") == "1"
    payload = "DWS" * (16384 if burst else 32)
    resp = make_response(jsonify({
        "ok": True,
        "ts": time.time(),
        "bytes": len(payload),
        "d": payload
    }))
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    return resp


@blueprint.route("/api/settings", methods=["GET"])
def get_settings():
    pub = StorageManager.get_public_settings()
    pub["updater"] = get_updater_status()
    return jsonify(pub)


@blueprint.route("/api/ui", methods=["POST"])
def update_ui_settings():
    try:
        data = request.get_json(silent=True) or {}
        settings = StorageManager.load_settings()
        ui = settings.setdefault("ui", {})

        for key in ("theme", "accent", "liquid_animations"):
            if key in data:
                ui[key] = data[key]
        for num_key in ("glass_blur", "parallax_intensity"):
            if num_key in data:
                ui[num_key] = int(data[num_key])
        if isinstance(data.get("custom_theme"), dict):
            ui.setdefault("custom_theme", {}).update(data["custom_theme"])
        if isinstance(data.get("saved_themes"), list):
            ui["saved_themes"] = data["saved_themes"]

        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


def _octoprint_get(base_url, api_key, endpoint):
    target_url = f"{base_url.rstrip('/')}{endpoint}"
    req = urllib.request.Request(
        target_url,
        headers={
            "X-Api-Key": api_key,
            "Accept": "application/json",
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
        },
    )
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with urllib.request.urlopen(req, timeout=5.0, context=ctx) as resp:
        return json.loads(resp.read().decode("utf-8", errors="replace"))


@blueprint.route("/api/octoprint/config", methods=["POST"])
def save_octoprint_config():
    try:
        data = request.get_json(silent=True) or {}
        settings = StorageManager.load_settings()
        octo = settings.setdefault("octoprint", {})

        octo["enabled"] = bool(data.get("enabled", True))
        if "url" in data and data["url"].strip():
            clean_url = data["url"].strip().rstrip("/")
            if not clean_url.startswith(("http://", "https://")):
                clean_url = "https://" + clean_url
            octo["url"] = clean_url
        if "api_key" in data and data["api_key"].strip():
            octo["api_key"] = data["api_key"].strip()

        StorageManager.save_settings(settings)

        if not octo.get("api_key"):
            return jsonify({
                "ok": False,
                "error": "No API Key stored. Paste your OctoPrint API Key and click Save."
            }), 400

        # Immediately test connection & read printer state so the user gets instant feedback
        if octo.get("enabled") and octo.get("url"):
            try:
                job_raw = _octoprint_get(octo["url"], octo["api_key"], "/api/job")
                state_str = str(job_raw.get("state") or "Connected")
                return jsonify({
                    "ok": True,
                    "printer_state": state_str,
                    "settings": StorageManager.get_public_settings()
                })
            except urllib.error.HTTPError as he:
                return jsonify({
                    "ok": False,
                    "error": f"OctoPrint returned HTTP {he.code}. Check your API Key or URL."
                }), 400
            except Exception as conn_err:
                return jsonify({
                    "ok": False,
                    "error": f"Could not reach {octo['url']}: {str(conn_err)}"
                }), 400

        return jsonify({"ok": True, "printer_state": "Disabled", "settings": StorageManager.get_public_settings()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/octoprint/status", methods=["GET"])
def get_octoprint_status():
    settings = StorageManager.load_settings()
    octo = settings.get("octoprint", {})
    if not octo.get("enabled") or not octo.get("url") or not octo.get("api_key"):
        return jsonify({"ok": False, "enabled": False})

    base_url = octo["url"].rstrip("/")
    api_key = octo["api_key"]

    try:
        job_raw = _octoprint_get(base_url, api_key, "/api/job")
        state_str = str(job_raw.get("state") or "Offline")
        prog = job_raw.get("progress") or {}
        job = job_raw.get("job") or {}
        file_info = job.get("file") or {}

        temps = {"nozzle_actual": 0.0, "nozzle_target": 0.0, "bed_actual": 0.0, "bed_target": 0.0}
        flags = {}
        try:
            printer_raw = _octoprint_get(base_url, api_key, "/api/printer")
            t_data = printer_raw.get("temperature") or {}
            tool0 = t_data.get("tool0") or {}
            bed = t_data.get("bed") or {}
            temps = {
                "nozzle_actual": round(float(tool0.get("actual") or 0.0), 1),
                "nozzle_target": round(float(tool0.get("target") or 0.0), 1),
                "bed_actual": round(float(bed.get("actual") or 0.0), 1),
                "bed_target": round(float(bed.get("target") or 0.0), 1),
            }
            flags = (printer_raw.get("state") or {}).get("flags") or {}
        except Exception:
            pass

        nozzle_heating = temps["nozzle_target"] >= 40 and (temps["nozzle_target"] - temps["nozzle_actual"]) > 2.5
        bed_heating = temps["bed_target"] >= 35 and (temps["bed_target"] - temps["bed_actual"]) > 1.5
        is_warming_up = nozzle_heating or bed_heating

        state_lower = state_str.lower()
        is_printing = (
            bool(flags.get("printing"))
            or bool(flags.get("paused"))
            or any(k in state_lower for k in ("printing", "paused", "starting", "preparing", "heating", "resuming"))
        )

        completion = round(float(prog.get("completion") or 0.0), 1)
        print_time_left = prog.get("printTimeLeft")
        if print_time_left is None and job.get("estimatedPrintTime") and prog.get("printTime"):
            est = float(job["estimatedPrintTime"])
            elapsed = float(prog["printTime"])
            if est > elapsed:
                print_time_left = int(est - elapsed)

        return jsonify({
            "ok": True,
            "enabled": True,
            "state": state_str,
            "is_printing": is_printing,
            "is_warming_up": is_warming_up,
            "is_active": is_printing or is_warming_up,
            "file_name": file_info.get("display") or file_info.get("name") or "Preheating / Active Job",
            "completion": completion,
            "print_time": int(prog.get("printTime") or 0),
            "print_time_left": print_time_left,
            "temps": temps
        })
    except urllib.error.HTTPError as he:
        return jsonify({"ok": False, "enabled": True, "error": f"HTTP {he.code} from OctoPrint"})
    except Exception as e:
        return jsonify({"ok": False, "enabled": True, "error": str(e)})


@blueprint.route("/api/apps", methods=["POST"])
def add_app():
    try:
        settings = StorageManager.load_settings()
        name = request.form.get("name", "").strip()
        url = request.form.get("url", "").strip()
        launch_mode = request.form.get("launch_mode", "center").strip()
        subject_type = request.form.get("subject_type", "Web App").strip() or "Web App"

        if not name or not url:
            return jsonify({"error": "App name and URL are required."}), 400

        icon_url = request.form.get("icon_url", "").strip()
        if "icon_file" in request.files and request.files["icon_file"].filename:
            icon_url = StorageManager.save_upload(request.files["icon_file"], prefix="icon")

        new_app = {
            "id": uuid.uuid4().hex[:10],
            "name": name,
            "url": url,
            "icon": icon_url or "",
            "iframe": launch_mode != "tab",
            "launch_mode": launch_mode,
            "subject_type": subject_type
        }
        settings.setdefault("apps", []).append(new_app)
        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@blueprint.route("/api/apps/<app_id>", methods=["PUT"])
def update_app(app_id):
    try:
        data = request.get_json(silent=True) or {}
        settings = StorageManager.load_settings()
        for app in settings.get("apps", []):
            if app.get("id") == app_id:
                if "name" in data and data["name"].strip():
                    app["name"] = data["name"].strip()
                if "url" in data and data["url"].strip():
                    app["url"] = data["url"].strip()
                if "launch_mode" in data:
                    app["launch_mode"] = data["launch_mode"]
                    app["iframe"] = data["launch_mode"] != "tab"
                if "subject_type" in data:
                    app["subject_type"] = data["subject_type"].strip() or "Web App"
                break
        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/apps/<app_id>", methods=["DELETE"])
def delete_app(app_id):
    settings = StorageManager.load_settings()
    settings["apps"] = [a for a in settings.get("apps", []) if a.get("id") != app_id]
    StorageManager.save_settings(settings)
    return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})


@blueprint.route("/api/background", methods=["POST"])
def update_background():
    try:
        settings = StorageManager.load_settings()
        bg = settings.setdefault("background", {})
        reset_default = request.form.get("reset_default", "false") == "true"

        if reset_default:
            bg["url"] = ""
            bg["type"] = "svg"
            bg["time_based_enabled"] = False
        else:
            bg_url = request.form.get("bg_url", "").strip()
            if "bg_file" in request.files and request.files["bg_file"].filename:
                bg_url = StorageManager.save_upload(request.files["bg_file"], prefix="bg")
            if bg_url:
                bg["url"] = bg_url
                bg["type"] = "image"

            if "time_based_enabled" in request.form:
                bg["time_based_enabled"] = request.form.get("time_based_enabled") == "true"

            tw = bg.setdefault("time_wallpapers", {"morning": "", "afternoon": "", "evening": "", "night": ""})
            for slot in ("morning", "afternoon", "evening", "night"):
                url_val = request.form.get(f"tw_{slot}_url")
                if url_val is not None:
                    tw[slot] = url_val.strip()
                file_key = f"tw_{slot}_file"
                if file_key in request.files and request.files[file_key].filename:
                    tw[slot] = StorageManager.save_upload(request.files[file_key], prefix=f"bg_{slot}")

        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "background": settings["background"]})
    except Exception as e:
        return jsonify({"error": str(e)}), 400


@blueprint.route("/api/servers", methods=["POST"])
def save_or_add_server():
    try:
        data = request.get_json(silent=True) or {}
        settings = StorageManager.load_settings()
        servers = settings.setdefault("servers", {})

        sid = str(data.get("id") or "").strip()
        if not sid:
            numeric_ids = [int(k) for k in servers.keys() if str(k).isdigit()]
            sid = str(max(numeric_ids, default=3) + 1)

        existing = servers.get(sid, {})
        name = (data.get("name") or existing.get("name") or f"Server {sid}").strip()
        host = (data.get("host") or existing.get("host") or "").strip()
        user = (data.get("user") or existing.get("user") or "dylan").strip()
        password = data.get("password")
        if password is None or password == "":
            password = existing.get("password", "")
        shell_url = (data.get("shell_url") or existing.get("shell_url") or f"https://device.teamexist.com/shell/{sid}").strip()

        if not host:
            return jsonify({"ok": False, "error": "Server host IP/domain is required."}), 400

        servers[sid] = {
            "id": sid,
            "name": name,
            "host": host,
            "user": user,
            "password": password,
            "shell_url": shell_url
        }
        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/servers/<server_id>", methods=["DELETE"])
def delete_server(server_id):
    settings = StorageManager.load_settings()
    servers = settings.get("servers", {})
    servers.pop(str(server_id), None)
    StorageManager.save_settings(settings)
    return jsonify({"ok": True, "settings": StorageManager.get_public_settings()})


@blueprint.route("/api/drives/alias", methods=["POST"])
def set_drive_alias():
    try:
        data = request.get_json(silent=True) or {}
        drive_id = (data.get("drive_id") or "").strip()
        alias = (data.get("alias") or "").strip()
        if not drive_id:
            return jsonify({"ok": False, "error": "drive_id is required."}), 400

        settings = StorageManager.load_settings()
        aliases = settings.setdefault("drive_aliases", {})
        if alias:
            aliases[drive_id] = alias
        else:
            aliases.pop(drive_id, None)

        StorageManager.save_settings(settings)
        return jsonify({"ok": True, "drive_aliases": aliases})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
