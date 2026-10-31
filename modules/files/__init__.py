import io
import json
import time
import stat
import posixpath
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, jsonify, request, send_file
import paramiko
from core.storage import StorageManager

blueprint = Blueprint("files", __name__)

_pool_lock = threading.Lock()
_ssh_pool = {}
_shallow_index_cache = {"ts": 0, "entries": []}  # Cached for 45s to keep CPU usage near zero


def _get_servers_dict():
    return StorageManager.load_settings().get("servers", {})


def _get_ssh_connection(server_id):
    servers = _get_servers_dict()
    sid = str(server_id)
    if sid not in servers:
        raise ValueError(f"Unknown server ID: {sid}")

    srv = servers[sid]
    with _pool_lock:
        entry = _ssh_pool.get(sid)
        if (
            entry
            and entry.get("host") == srv.get("host")
            and entry.get("user") == srv.get("user")
            and entry["ssh"].get_transport()
            and entry["ssh"].get_transport().is_active()
        ):
            return entry["ssh"], entry["os"], srv

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        srv["host"],
        username=srv["user"],
        password=srv.get("password", ""),
        timeout=3.5,
        banner_timeout=3.5,
        auth_timeout=3.5
    )

    _, stdout, _ = ssh.exec_command("uname -s", timeout=2.5)
    uname_out = stdout.read().decode("utf-8", errors="ignore").strip().lower()
    os_type = "linux" if ("linux" in uname_out or "darwin" in uname_out) else "windows"

    with _pool_lock:
        _ssh_pool[sid] = {
            "ssh": ssh,
            "os": os_type,
            "host": srv.get("host"),
            "user": srv.get("user")
        }

    return ssh, os_type, srv


def _exec_cmd(ssh, command, timeout=6):
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return out, err


def os_path_basename(p):
    return posixpath.basename(p.rstrip("/"))


def _normalize_sftp_path(path_str, os_type):
    if not path_str:
        return "/"
    p = path_str.replace("\\", "/")
    if os_type == "windows":
        if len(p) >= 2 and p[1] == ":":
            p = "/" + p
        if len(p) == 3 and p.startswith("/") and p.endswith(":"):
            p = p + "/"
    return p


def _fetch_server_drives(server_id, aliases):
    servers = _get_servers_dict()
    sid = str(server_id)
    srv = servers.get(sid, {})
    drives = []
    t0 = time.time()

    try:
        ssh, os_type, srv = _get_ssh_connection(sid)
        latency_ms = int(round((time.time() - t0) * 1000))

        if os_type == "linux":
            out, _ = _exec_cmd(
                ssh,
                "df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs"
            )
            for line in out.splitlines()[1:]:
                parts = line.split()
                if len(parts) < 6:
                    continue
                device, total_b, used_b, free_b, _, mountpoint = (
                    parts[0], parts[1], parts[2], parts[3], parts[4], " ".join(parts[5:])
                )
                if device.startswith("/dev/loop") or mountpoint.startswith("/snap"):
                    continue
                try:
                    total = int(total_b)
                    used = int(used_b)
                    free = int(free_b)
                except ValueError:
                    continue
                if total <= 0:
                    continue
                base_label = "Root Disk" if mountpoint == "/" else os_path_basename(mountpoint) or device
                default_label = f"{base_label} ({mountpoint})"
                drive_id = f"{sid}:{mountpoint}"
                custom_alias = aliases.get(drive_id, "").strip()

                drives.append({
                    "id": drive_id,
                    "server_id": sid,
                    "server_name": srv.get("name", f"Server {sid}"),
                    "host": srv.get("host", ""),
                    "os": "linux",
                    "mount": mountpoint,
                    "sftp_root": mountpoint,
                    "original_label": default_label,
                    "alias": custom_alias,
                    "label": custom_alias if custom_alias else default_label,
                    "device": device,
                    "total": total,
                    "used": used,
                    "free": free,
                    "percent": round((used / total) * 100, 1)
                })
        else:
            ps_cmd = (
                'powershell -NoProfile -Command '
                '"Get-CimInstance Win32_LogicalDisk | '
                'Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress"'
            )
            out, _ = _exec_cmd(ssh, ps_cmd, timeout=6)
            parsed = []
            if out and (out.startswith("[") or out.startswith("{")):
                try:
                    data = json.loads(out)
                    parsed = data if isinstance(data, list) else [data]
                except Exception:
                    parsed = []

            if not parsed:
                wmic_out, _ = _exec_cmd(
                    ssh,
                    "wmic logicaldisk get Caption,FreeSpace,Size,VolumeName /format:csv",
                    timeout=5
                )
                for line in wmic_out.splitlines():
                    cols = [c.strip() for c in line.strip().split(",")]
                    if len(cols) >= 5 and cols[1].endswith(":"):
                        parsed.append({
                            "DeviceID": cols[1],
                            "FreeSpace": int(cols[2]) if cols[2].isdigit() else 0,
                            "Size": int(cols[3]) if cols[3].isdigit() else 0,
                            "VolumeName": cols[4]
                        })

            for d in parsed:
                dev_id = str(d.get("DeviceID") or "").strip()
                if not dev_id:
                    continue
                total = int(d.get("Size") or 0)
                free = int(d.get("FreeSpace") or 0)
                if total <= 0:
                    continue
                used = max(0, total - free)
                vol_name = (d.get("VolumeName") or "").strip() or "Local Disk"
                default_label = f"{vol_name} ({dev_id})"
                sftp_root = f"/{dev_id}/" if not dev_id.startswith("/") else f"{dev_id}/"
                drive_id = f"{sid}:{dev_id}"
                custom_alias = aliases.get(drive_id, "").strip()

                drives.append({
                    "id": drive_id,
                    "server_id": sid,
                    "server_name": srv.get("name", f"Server {sid}"),
                    "host": srv.get("host", ""),
                    "os": "windows",
                    "mount": dev_id,
                    "sftp_root": sftp_root,
                    "original_label": default_label,
                    "alias": custom_alias,
                    "label": custom_alias if custom_alias else default_label,
                    "device": dev_id,
                    "total": total,
                    "used": used,
                    "free": free,
                    "percent": round((used / total) * 100, 1)
                })

        return {
            "server_id": sid,
            "name": srv.get("name", f"Server {sid}"),
            "host": srv.get("host", ""),
            "shell_url": srv.get("shell_url", f"https://device.teamexist.com/shell/{sid}"),
            "os": os_type,
            "online": True,
            "latency_ms": latency_ms,
            "drive_count": len(drives),
            "drives": drives,
            "error": None
        }
    except Exception as e:
        with _pool_lock:
            _ssh_pool.pop(sid, None)
        return {
            "server_id": sid,
            "name": srv.get("name", f"Server {sid}"),
            "host": srv.get("host", ""),
            "shell_url": srv.get("shell_url", f"https://device.teamexist.com/shell/{sid}"),
            "os": "unknown",
            "online": False,
            "latency_ms": None,
            "drive_count": 0,
            "drives": [],
            "error": str(e)
        }


@blueprint.route("/api/files/drives", methods=["GET"])
def list_all_drives():
    settings = StorageManager.load_settings()
    servers = settings.get("servers", {})
    aliases = settings.get("drive_aliases", {})
    server_ids = list(servers.keys())

    all_drives = []
    server_status = {}

    if server_ids:
        with ThreadPoolExecutor(max_workers=len(server_ids)) as pool:
            results = list(pool.map(lambda s: _fetch_server_drives(s, aliases), server_ids))

        for res in results:
            sid = res["server_id"]
            server_status[sid] = {
                "id": sid,
                "name": res["name"],
                "host": res["host"],
                "shell_url": res["shell_url"],
                "os": res["os"],
                "online": res["online"],
                "latency_ms": res["latency_ms"],
                "drive_count": res["drive_count"],
                "error": res["error"]
            }
            all_drives.extend(res["drives"])

    return jsonify({
        "ok": True,
        "drives": all_drives,
        "servers": server_status
    })


def _scan_drive_shallow(drive):
    """Scans depth 1 and 2 of a drive via SFTP (capped to keep CPU/IO light)."""
    found = []
    sid = drive["server_id"]
    try:
        ssh, os_type, _ = _get_ssh_connection(sid)
        sftp = ssh.open_sftp()
        root_path = _normalize_sftp_path(drive["sftp_root"], os_type)

        try:
            lvl1 = sftp.listdir_attr(root_path)
        except IOError:
            if root_path.startswith("/") and len(root_path) >= 3 and root_path[2] == ":":
                root_path = root_path[1:]
                lvl1 = sftp.listdir_attr(root_path)
            else:
                sftp.close()
                return found

        subdirs = []
        for attr in lvl1[:45]:
            name = attr.filename
            if name in (".", "..") or name.startswith("$"):
                continue
            is_dir = stat.S_ISDIR(attr.st_mode) if attr.st_mode is not None else False
            full_path = posixpath.join(root_path.rstrip("/"), name)
            if root_path == "/":
                full_path = "/" + name
            found.append({
                "name": name,
                "path": full_path,
                "parent_path": root_path,
                "is_dir": is_dir,
                "size": 0 if is_dir else int(attr.st_size or 0),
                "server_id": sid,
                "server_name": drive["server_name"],
                "drive_id": drive["id"],
                "drive_label": drive["label"]
            })
            if is_dir and len(subdirs) < 12:
                subdirs.append(full_path)

        for sub in subdirs:
            try:
                lvl2 = sftp.listdir_attr(sub)
                for attr in lvl2[:25]:
                    name = attr.filename
                    if name in (".", ".."):
                        continue
                    is_dir = stat.S_ISDIR(attr.st_mode) if attr.st_mode is not None else False
                    full_path = posixpath.join(sub.rstrip("/"), name)
                    found.append({
                        "name": name,
                        "path": full_path,
                        "parent_path": sub,
                        "is_dir": is_dir,
                        "size": 0 if is_dir else int(attr.st_size or 0),
                        "server_id": sid,
                        "server_name": drive["server_name"],
                        "drive_id": drive["id"],
                        "drive_label": drive["label"]
                    })
            except Exception:
                continue

        sftp.close()
    except Exception:
        pass
    return found


@blueprint.route("/api/files/search", methods=["GET"])
def quick_search_files():
    query = (request.args.get("q") or "").strip().lower()
    if len(query) < 2:
        return jsonify({"ok": True, "results": []})

    now = time.time()
    if now - _shallow_index_cache["ts"] > 45 or not _shallow_index_cache["entries"]:
        settings = StorageManager.load_settings()
        servers = settings.get("servers", {})
        aliases = settings.get("drive_aliases", {})
        sids = list(servers.keys())
        drives = []
        if sids:
            with ThreadPoolExecutor(max_workers=len(sids)) as pool:
                res_list = list(pool.map(lambda s: _fetch_server_drives(s, aliases), sids))
            for r in res_list:
                drives.extend(r["drives"])

        entries = []
        if drives:
            with ThreadPoolExecutor(max_workers=min(6, len(drives))) as pool:
                for chunk in pool.map(_scan_drive_shallow, drives):
                    entries.extend(chunk)
        _shallow_index_cache["ts"] = now
        _shallow_index_cache["entries"] = entries

    matches = [
        item for item in _shallow_index_cache["entries"]
        if query in item["name"].lower()
    ][:18]

    return jsonify({"ok": True, "results": matches})


@blueprint.route("/api/files/list", methods=["GET"])
def list_directory():
    server_id = request.args.get("server_id", "")
    raw_path = request.args.get("path", "/")

    try:
        ssh, os_type, _ = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        target_path = _normalize_sftp_path(raw_path, os_type)

        try:
            attrs = sftp.listdir_attr(target_path)
        except IOError:
            if target_path.startswith("/") and len(target_path) >= 3 and target_path[2] == ":":
                target_path = target_path[1:]
                attrs = sftp.listdir_attr(target_path)
            else:
                raise

        items = []
        for attr in attrs:
            name = attr.filename
            if name in (".", ".."):
                continue
            is_dir = stat.S_ISDIR(attr.st_mode) if attr.st_mode is not None else False
            full_path = posixpath.join(target_path.rstrip("/"), name)
            if target_path == "/":
                full_path = "/" + name

            items.append({
                "name": name,
                "path": full_path,
                "is_dir": is_dir,
                "size": 0 if is_dir else int(attr.st_size or 0),
                "mtime": int(attr.st_mtime or 0)
            })

        sftp.close()
        items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))

        return jsonify({
            "ok": True,
            "server_id": server_id,
            "os": os_type,
            "path": target_path,
            "items": items
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/files/download", methods=["GET"])
def download_file():
    server_id = request.args.get("server_id", "")
    raw_path = request.args.get("path", "")

    try:
        ssh, os_type, _ = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        target_path = _normalize_sftp_path(raw_path, os_type)

        file_obj = io.BytesIO()
        try:
            sftp.getfo(target_path, file_obj)
        except IOError:
            if target_path.startswith("/") and len(target_path) >= 3 and target_path[2] == ":":
                target_path = target_path[1:]
                sftp.getfo(target_path, file_obj)
            else:
                raise
        sftp.close()
        file_obj.seek(0)

        filename = posixpath.basename(target_path.rstrip("/")) or "download.bin"
        return send_file(file_obj, as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/files/upload", methods=["POST"])
def upload_file():
    server_id = request.form.get("server_id", "")
    raw_dir = request.form.get("path", "/")

    if "file" not in request.files:
        return jsonify({"ok": False, "error": "No file payload found."}), 400

    files = request.files.getlist("file")
    if not files:
        return jsonify({"ok": False, "error": "Empty file list."}), 400

    try:
        ssh, os_type, _ = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        target_dir = _normalize_sftp_path(raw_dir, os_type)

        uploaded = []
        for f in files:
            if not f.filename:
                continue
            dest = posixpath.join(target_dir.rstrip("/"), os_path_basename(f.filename))
            if target_dir == "/":
                dest = "/" + os_path_basename(f.filename)
            try:
                sftp.putfo(f.stream, dest)
            except IOError:
                if dest.startswith("/") and len(dest) >= 3 and dest[2] == ":":
                    dest = dest[1:]
                    f.stream.seek(0)
                    sftp.putfo(f.stream, dest)
                else:
                    raise
            uploaded.append(f.filename)

        sftp.close()
        return jsonify({"ok": True, "uploaded": uploaded})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/files/mkdir", methods=["POST"])
def create_directory():
    data = request.get_json(silent=True) or {}
    server_id = data.get("server_id", "")
    parent_path = data.get("path", "/")
    folder_name = (data.get("name") or "").strip().replace("/", "").replace("\\", "")

    if not folder_name:
        return jsonify({"ok": False, "error": "Folder name required."}), 400

    try:
        ssh, os_type, _ = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        norm_parent = _normalize_sftp_path(parent_path, os_type)
        new_dir = posixpath.join(norm_parent.rstrip("/"), folder_name)
        if norm_parent == "/":
            new_dir = "/" + folder_name

        try:
            sftp.mkdir(new_dir)
        except IOError:
            if new_dir.startswith("/") and len(new_dir) >= 3 and new_dir[2] == ":":
                sftp.mkdir(new_dir[1:])
            else:
                raise
        sftp.close()
        return jsonify({"ok": True, "path": new_dir})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@blueprint.route("/api/files/delete", methods=["POST"])
def delete_item():
    data = request.get_json(silent=True) or {}
    server_id = data.get("server_id", "")
    raw_path = data.get("path", "")
    is_dir = bool(data.get("is_dir", False))

    try:
        ssh, os_type, _ = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        target_path = _normalize_sftp_path(raw_path, os_type)

        try:
            if is_dir:
                sftp.rmdir(target_path)
            else:
                sftp.remove(target_path)
        except IOError:
            if target_path.startswith("/") and len(target_path) >= 3 and target_path[2] == ":":
                alt = target_path[1:]
                if is_dir:
                    sftp.rmdir(alt)
                else:
                    sftp.remove(alt)
            else:
                raise
        sftp.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
