import io
import json
import stat
import posixpath
import threading
from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, jsonify, request, send_file
import paramiko
import config

blueprint = Blueprint("files", __name__)

# Connection pool to avoid slow SSH handshakes on every click
_pool_lock = threading.Lock()
_ssh_pool = {}  # server_id -> {"ssh": SSHClient, "os": "windows"|"linux"}


def _get_ssh_connection(server_id):
    if server_id not in config.SERVERS:
        raise ValueError(f"Unknown server ID: {server_id}")

    srv = config.SERVERS[server_id]
    with _pool_lock:
        entry = _ssh_pool.get(server_id)
        if entry and entry["ssh"].get_transport() and entry["ssh"].get_transport().is_active():
            return entry["ssh"], entry["os"]

    # Establish new connection outside the global lock so slow hosts don't block others
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(
        srv["host"],
        username=srv["user"],
        password=srv["password"],
        timeout=4,
        banner_timeout=4,
        auth_timeout=4
    )

    # Detect OS once per connection
    _, stdout, _ = ssh.exec_command("uname -s", timeout=3)
    uname_out = stdout.read().decode("utf-8", errors="ignore").strip().lower()
    os_type = "linux" if ("linux" in uname_out or "darwin" in uname_out) else "windows"

    with _pool_lock:
        _ssh_pool[server_id] = {"ssh": ssh, "os": os_type}

    return ssh, os_type


def _exec_cmd(ssh, command, timeout=6):
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return out, err


def _fetch_server_drives(server_id):
    srv = config.SERVERS[server_id]
    drives = []
    try:
        ssh, os_type = _get_ssh_connection(server_id)
        if os_type == "linux":
            out, _ = _exec_cmd(
                ssh,
                "df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs"
            )
            lines = out.splitlines()
            for line in lines[1:]:
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
                label = "Root Disk" if mountpoint == "/" else os_path_basename(mountpoint) or device
                drives.append({
                    "id": f"{server_id}:{mountpoint}",
                    "server_id": server_id,
                    "server_name": srv.get("name", f"Server {server_id}"),
                    "host": srv["host"],
                    "os": "linux",
                    "mount": mountpoint,
                    "sftp_root": mountpoint,
                    "label": f"{label} ({mountpoint})",
                    "device": device,
                    "total": total,
                    "used": used,
                    "free": free,
                    "percent": round((used / total) * 100, 1)
                })
        else:
            # Windows: Try PowerShell CIM first, fallback to wmic
            ps_cmd = (
                'powershell -NoProfile -Command '
                '"Get-CimInstance Win32_LogicalDisk | '
                'Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress"'
            )
            out, _ = _exec_cmd(ssh, ps_cmd, timeout=7)
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
                    timeout=6
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
                # OpenSSH SFTP on Windows accepts /C:/ or C:/
                sftp_root = f"/{dev_id}/" if not dev_id.startswith("/") else f"{dev_id}/"
                drives.append({
                    "id": f"{server_id}:{dev_id}",
                    "server_id": server_id,
                    "server_name": srv.get("name", f"Server {server_id}"),
                    "host": srv["host"],
                    "os": "windows",
                    "mount": dev_id,
                    "sftp_root": sftp_root,
                    "label": f"{vol_name} ({dev_id})",
                    "device": dev_id,
                    "total": total,
                    "used": used,
                    "free": free,
                    "percent": round((used / total) * 100, 1)
                })

        return {"server_id": server_id, "online": True, "drives": drives, "error": None}
    except Exception as e:
        with _pool_lock:
            _ssh_pool.pop(server_id, None)
        return {
            "server_id": server_id,
            "server_name": srv.get("name", f"Server {server_id}"),
            "host": srv["host"],
            "online": False,
            "drives": [],
            "error": str(e)
        }


def os_path_basename(p):
    return posixpath.basename(p.rstrip("/"))


def _normalize_sftp_path(path_str, os_type):
    if not path_str:
        return "/"
    p = path_str.replace("\\", "/")
    if os_type == "windows":
        # OpenSSH SFTP on Windows works with /C:/folder or C:/folder
        if len(p) >= 2 and p[1] == ":":
            p = "/" + p
        if len(p) == 3 and p.startswith("/") and p.endswith(":"):
            p = p + "/"
    return p


@blueprint.route("/api/files/drives", methods=["GET"])
def list_all_drives():
    server_ids = list(config.SERVERS.keys())
    all_drives = []
    server_status = {}

    with ThreadPoolExecutor(max_workers=len(server_ids) or 1) as pool:
        results = list(pool.map(_fetch_server_drives, server_ids))

    for res in results:
        sid = res["server_id"]
        server_status[sid] = {
            "online": res["online"],
            "error": res["error"],
            "host": config.SERVERS[sid]["host"],
            "name": config.SERVERS[sid].get("name", f"Server {sid}")
        }
        all_drives.extend(res["drives"])

    return jsonify({
        "ok": True,
        "drives": all_drives,
        "servers": server_status
    })


@blueprint.route("/api/files/list", methods=["GET"])
def list_directory():
    server_id = request.args.get("server_id", "")
    raw_path = request.args.get("path", "/")

    try:
        ssh, os_type = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        target_path = _normalize_sftp_path(raw_path, os_type)

        try:
            attrs = sftp.listdir_attr(target_path)
        except IOError:
            # Fallback if Windows SFTP prefers C:/ without leading slash
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
        # Sort folders first, then alphabetically
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
        ssh, os_type = _get_ssh_connection(server_id)
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
        ssh, os_type = _get_ssh_connection(server_id)
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
        ssh, os_type = _get_ssh_connection(server_id)
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
        ssh, os_type = _get_ssh_connection(server_id)
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
