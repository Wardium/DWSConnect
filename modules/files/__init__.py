import io
import os
import stat
import time
import json
import posixpath
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from flask import Blueprint, jsonify, request, send_file
import paramiko

blueprint = Blueprint("files", __name__)

# Your 3 servers from the SSH module
SERVERS = {
    "1": {"name": "Server 1", "host": "192.168.2.143", "user": "dylan", "password": "weqr1234"},
    "2": {"name": "Server 2", "host": "192.168.2.91", "user": "dylanwardstudios", "password": "weqr1234"},
    "3": {"name": "Server 3", "host": "192.168.2.134", "user": "dylan", "password": "sIjkew-1qixwe-sogcog"}
}

_pool_lock = threading.Lock()
_ssh_pool = {}  # server_id -> {"ssh": SSHClient, "os": "windows"|"linux", "last_used": float}


def _get_ssh_connection(server_id):
    """Returns a cached, live Paramiko SSHClient and detected OS type for a server."""
    if server_id not in SERVERS:
        raise ValueError(f"Unknown server ID: {server_id}")

    with _pool_lock:
        entry = _ssh_pool.get(server_id)
        if entry and entry["ssh"].get_transport() and entry["ssh"].get_transport().is_active():
            entry["last_used"] = time.time()
            return entry["ssh"], entry["os"]

    srv = SERVERS[server_id]
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
        _ssh_pool[server_id] = {
            "ssh": ssh,
            "os": os_type,
            "last_used": time.time()
        }
    return ssh, os_type


def _exec_ssh(ssh, command, timeout=5):
    _, stdout, stderr = ssh.exec_command(command, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return out, err


def _fetch_server_drives(server_id):
    """Queries all connected disks and capacities on a single Windows or Linux server."""
    srv = SERVERS[server_id]
    try:
        ssh, os_type = _get_ssh_connection(server_id)
        drives = []

        if os_type == "windows":
            ps_cmd = (
                'powershell -NoProfile -Command "'
                'Get-PSDrive -PSProvider FileSystem | '
                'Where-Object { $_.Used -ne$null -or $_.Free -ne$null } | '
                'Select-Object Name,Root,Used,Free,Description | ConvertTo-Json -Compress"'
            )
            out, _ = _exec_ssh(ssh, ps_cmd, timeout=6)
            if out:
                parsed = json.loads(out)
                if isinstance(parsed, dict):
                    parsed = [parsed]
                for d in parsed:
                    used = int(d.get("Used") or 0)
                    free = int(d.get("Free") or 0)
                    total = used + free
                    if total <= 0:
                        continue
                    name = d.get("Name", "C")
                    drives.append({
                        "server_id": server_id,
                        "server_name": srv["name"],
                        "host": srv["host"],
                        "os": "windows",
                        "drive_id": f"{name}:",
                        "label": d.get("Description") or f"Local Disk ({name}:)",
                        "mount": f"{name}:/",
                        "used": used,
                        "free": free,
                        "total": total,
                        "percent": round((used / total) * 100, 1)
                    })
        else:
            # Linux / Raspberry Pi drive detection (includes root and any hot-plugged USB/SATA mounts)
            df_cmd = "df -B1 --output=source,target,size,used,avail -x tmpfs -x devtmpfs -x squashfs -x overlay"
            out, _ = _exec_ssh(ssh, df_cmd, timeout=5)
            lines = out.splitlines()
            for line in lines[1:]:
                parts = line.split()
                if len(parts) < 5:
                    continue
                source, target, size_s, used_s, avail_s = parts[0], parts[1], parts[2], parts[3], parts[4]
                if target.startswith("/boot/firmware") or target.startswith("/run") or target.startswith("/sys"):
                    continue
                total = int(size_s)
                used = int(used_s)
                free = int(avail_s)
                if total <= 0:
                    continue
                drives.append({
                    "server_id": server_id,
                    "server_name": srv["name"],
                    "host": srv["host"],
                    "os": "linux",
                    "drive_id": target,
                    "label": f"{os.path.basename(source) or source} ({target})",
                    "mount": target,
                    "used": used,
                    "free": free,
                    "total": total,
                    "percent": round((used / total) * 100, 1)
                })

        return {
            "server_id": server_id,
            "server_name": srv["name"],
            "host": srv["host"],
            "os": os_type,
            "online": True,
            "drives": drives
        }
    except Exception as exc:
        with _pool_lock:
            _ssh_pool.pop(server_id, None)
        return {
            "server_id": server_id,
            "server_name": srv["name"],
            "host": srv["host"],
            "os": "unknown",
            "online": False,
            "error": str(exc),
            "drives": []
        }


def _resolve_sftp_path(sftp, os_type, raw_path):
    """Normalizes paths across Windows OpenSSH SFTP (C:/ vs /C:/) and Linux."""
    clean = (raw_path or "/").replace("\\", "/")
    if os_type == "windows":
        # Ensure drive root has trailing slash: "C:" -> "C:/"
        if len(clean) == 2 and clean[1] == ":":
            clean += "/"
        candidates = [clean]
        if not clean.startswith("/"):
            candidates.append("/" + clean)
        else:
            candidates.append(clean.lstrip("/"))
        for candidate in candidates:
            try:
                sftp.stat(candidate)
                return candidate
            except Exception:
                continue
        return candidates[0]
    return clean if clean.startswith("/") else "/" + clean


@blueprint.route("/api/ping", methods=["GET"])
def api_ping():
    """Fast endpoint for the live connection speed & latency graph."""
    payload = "dws_speed_probe_" * 256  # ~4KB probe payload
    return jsonify({"ok": True, "ts": time.time(), "probe": payload})


@blueprint.route("/api/files/drives", methods=["GET"])
def api_get_all_drives():
    """Fetches all drives from all 3 servers concurrently."""
    results = []
    all_drives = []
    with ThreadPoolExecutor(max_workers=len(SERVERS)) as pool:
        futures = {pool.submit(_fetch_server_drives, sid): sid for sid in SERVERS}
        for future in as_completed(futures):
            res = future.result()
            results.append(res)
            all_drives.extend(res.get("drives", []))

    results.sort(key=lambda x: x["server_id"])
    all_drives.sort(key=lambda d: (d["server_id"], d["drive_id"]))
    return jsonify({
        "servers": results,
        "drives": all_drives,
        "total_drives": len(all_drives),
        "timestamp": time.time()
    })


@blueprint.route("/api/files/list", methods=["GET"])
def api_list_directory():
    server_id = request.args.get("server_id", "1")
    req_path = request.args.get("path", "/")
    try:
        ssh, os_type = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        try:
            target_path = _resolve_sftp_path(sftp, os_type, req_path)
            entries = sftp.listdir_attr(target_path)
            items = []
            for attr in entries:
                name = attr.filename
                if name in (".", ".."):
                    continue
                is_dir = stat.S_ISDIR(attr.st_mode) if attr.st_mode is not None else False
                base = target_path.rstrip("/")
                full_path = f"{base}/{name}" if base else f"/{name}"
                items.append({
                    "name": name,
                    "path": full_path,
                    "is_dir": is_dir,
                    "size": 0 if is_dir else int(attr.st_size or 0),
                    "mtime": int(attr.st_mtime or 0)
                })
            # Sort folders first, then alphabetically
            items.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
            return jsonify({
                "ok": True,
                "server_id": server_id,
                "os": os_type,
                "path": target_path,
                "items": items
            })
        finally:
            sftp.close()
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@blueprint.route("/api/files/download", methods=["GET"])
def api_download_file():
    server_id = request.args.get("server_id", "1")
    req_path = request.args.get("path", "")
    if not req_path:
        return jsonify({"ok": False, "error": "Missing file path"}), 400
    try:
        ssh, os_type = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        target_path = _resolve_sftp_path(sftp, os_type, req_path)
        file_obj = io.BytesIO()
        sftp.getfo(target_path, file_obj)
        sftp.close()
        file_obj.seek(0)
        filename = posixpath.basename(target_path.rstrip("/")) or "download.bin"
        return send_file(file_obj, as_attachment=True, download_name=filename)
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@blueprint.route("/api/files/upload", methods=["POST"])
def api_upload_file():
    server_id = request.form.get("server_id", "1")
    dest_dir = request.form.get("path", "/")
    uploaded_files = request.files.getlist("files")
    if not uploaded_files:
        return jsonify({"ok": False, "error": "No files provided"}), 400

    try:
        ssh, os_type = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        try:
            target_dir = _resolve_sftp_path(sftp, os_type, dest_dir).rstrip("/")
            saved = []
            for f in uploaded_files:
                if not f.filename:
                    continue
                safe_name = os.path.basename(f.filename)
                remote_path = f"{target_dir}/{safe_name}" if target_dir else f"/{safe_name}"
                sftp.putfo(f.stream, remote_path)
                saved.append(safe_name)
            return jsonify({"ok": True, "uploaded": saved, "count": len(saved)})
        finally:
            sftp.close()
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@blueprint.route("/api/files/mkdir", methods=["POST"])
def api_mkdir():
    data = request.get_json(silent=True) or {}
    server_id = data.get("server_id", "1")
    parent_path = data.get("path", "/")
    folder_name = os.path.basename((data.get("name") or "").strip())
    if not folder_name:
        return jsonify({"ok": False, "error": "Folder name required"}), 400
    try:
        ssh, os_type = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        try:
            base = _resolve_sftp_path(sftp, os_type, parent_path).rstrip("/")
            new_dir = f"{base}/{folder_name}" if base else f"/{folder_name}"
            sftp.mkdir(new_dir)
            return jsonify({"ok": True, "path": new_dir})
        finally:
            sftp.close()
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@blueprint.route("/api/files/delete", methods=["DELETE"])
def api_delete_item():
    data = request.get_json(silent=True) or {}
    server_id = data.get("server_id", "1")
    req_path = data.get("path", "")
    is_dir = bool(data.get("is_dir", False))
    if not req_path:
        return jsonify({"ok": False, "error": "Path required"}), 400
    try:
        ssh, os_type = _get_ssh_connection(server_id)
        sftp = ssh.open_sftp()
        try:
            target = _resolve_sftp_path(sftp, os_type, req_path)
            if is_dir:
                sftp.rmdir(target)
            else:
                sftp.remove(target)
            return jsonify({"ok": True})
        finally:
            sftp.close()
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
