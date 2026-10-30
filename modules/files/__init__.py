import io
import json
import os
import posixpath
import stat
import threading
import time
import paramiko
from flask import Blueprint, jsonify, request, send_file

blueprint = Blueprint("files_module", __name__)

SERVERS = {
    "1": {"name": "Server 1 (Win)", "host": "192.168.2.143", "user": "dylan", "password": "weqr1234"},
    "2": {"name": "Server 2 (Win)", "host": "192.168.2.91", "user": "dylanwardstudios", "password": "weqr1234"},
    "3": {"name": "Server 3 (Pi)", "host": "192.168.2.134", "user": "dylan", "password": "sIjkew-1qixwe-sogcog"}
}

# Persistent SSH/SFTP connection pool so clicking folders is instant
_pool_lock = threading.Lock()
_ssh_pool = {}


def _get_connection(server_id):
    if server_id not in SERVERS:
        raise ValueError("Invalid server_id")

    with _pool_lock:
        entry = _ssh_pool.get(server_id)
        if entry:
            try:
                transport = entry["ssh"].get_transport()
                if transport and transport.is_active():
                    transport.send_ignore()
                    return entry["ssh"], entry["sftp"], entry["os_type"]
            except Exception:
                try:
                    entry["ssh"].close()
                except Exception:
                    pass
                _ssh_pool.pop(server_id, None)

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
        sftp = ssh.open_sftp()

        # Detect OS once per connection
        _, stdout, _ = ssh.exec_command("uname -s", timeout=3)
        uname_out = stdout.read().decode("utf-8", errors="ignore").strip().lower()
        os_type = "linux" if ("linux" in uname_out or "darwin" in uname_out) else "windows"

        _ssh_pool[server_id] = {
            "ssh": ssh,
            "sftp": sftp,
            "os_type": os_type,
            "connected_at": time.time()
        }
        return ssh, sftp, os_type


def _exec_ssh(ssh, cmd, timeout=6):
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return out, err


def _query_server_drives(server_id):
    srv_meta = SERVERS[server_id]
    try:
        ssh, _, os_type = _get_connection(server_id)
        drives = []

        if os_type == "windows":
            ps_cmd = (
                'powershell -NoProfile -Command '
                '"Get-CimInstance Win32_LogicalDisk | '
                'Select-Object DeviceID,VolumeName,Size,FreeSpace | ConvertTo-Json -Compress"'
            )
            out, _ = _exec_ssh(ssh, ps_cmd, timeout=7)
            if out:
                parsed = json.loads(out)
                if isinstance(parsed, dict):
                    parsed = [parsed]
                for d in parsed:
                    dev = (d.get("DeviceID") or "").strip()
                    if not dev:
                        continue
                    total = int(d.get("Size") or 0)
                    free = int(d.get("FreeSpace") or 0)
                    used = max(0, total - free)
                    vol = (d.get("VolumeName") or "").strip()
                    drives.append({
                        "id": f"{server_id}:{dev}",
                        "server_id": server_id,
                        "server_name": srv_meta["name"],
                        "host": srv_meta["host"],
                        "os_type": "windows",
                        "mount": f"{dev}/",
                        "label": f"{dev} ({vol})" if vol else dev,
                        "total_bytes": total,
                        "used_bytes": used,
                        "free_bytes": free,
                        "percent": round((used / total) * 100, 1) if total > 0 else 0
                    })
        else:
            # Linux / Raspberry Pi: list all real mounted filesystems
            df_cmd = "df -B1 -P -x tmpfs -x devtmpfs -x squashfs -x overlay"
            out, _ = _exec_ssh(ssh, df_cmd, timeout=5)
            lines = out.splitlines()
            for line in lines[1:]:
                parts = line.split()
                if len(parts) < 6:
                    continue
                filesystem, total_s, used_s, free_s, _, mount = (
                    parts[0], parts[1], parts[2], parts[3], parts[4], " ".join(parts[5:])
                )
                if mount.startswith("/snap") or mount.startswith("/run"):
                    continue
                total = int(total_s) if total_s.isdigit() else 0
                used = int(used_s) if used_s.isdigit() else 0
                free = int(free_s) if free_s.isdigit() else 0
                drives.append({
                    "id": f"{server_id}:{mount}",
                    "server_id": server_id,
                    "server_name": srv_meta["name"],
                    "host": srv_meta["host"],
                    "os_type": "linux",
                    "mount": mount,
                    "label": f"{mount} ({os.path.basename(filesystem) or filesystem})",
                    "total_bytes": total,
                    "used_bytes": used,
                    "free_bytes": free,
                    "percent": round((used / total) * 100, 1) if total > 0 else 0
                })

        return {"server_id": server_id, "name": srv_meta["name"], "host": srv_meta["host"], "online": True, "drives": drives}
    except Exception as exc:
        return {
            "server_id": server_id,
            "name": srv_meta["name"],
            "host": srv_meta["host"],
            "online": False,
            "error": str(exc),
            "drives": []
        }


def _normalize_sftp_path(path, os_type):
    if not path:
        return "/"
    clean = path.replace("\\", "/")
    if os_type == "windows":
        # OpenSSH on Windows accepts '/C:/folder' or 'C:/folder'
        if len(clean) >= 2 and clean[1] == ":":
            clean = "/" + clean
        if len(clean) == 3 and clean.startswith("/") and clean.endswith(":"):
            clean += "/"
    return clean


@blueprint.route("/api/files/drives", methods=["GET"])
def list_all_drives():
    results = {}
    threads = []

    def worker(sid):
        results[sid] = _query_server_drives(sid)

    for sid in SERVERS:
        t = threading.Thread(target=worker, args=(sid,))
        t.start()
        threads.append(t)

    for t in threads:
        t.join(timeout=8)

    ordered_servers = [results[sid] for sid in sorted(results.keys())]
    flat_drives = []
    for srv in ordered_servers:
        flat_drives.extend(srv.get("drives", []))

    return jsonify({"servers": ordered_servers, "drives": flat_drives, "timestamp": time.time()})


@blueprint.route("/api/files/list", methods=["GET"])
def list_directory():
    server_id = request.args.get("server_id", "")
    raw_path = request.args.get("path", "/")
    try:
        _, sftp, os_type = _get_connection(server_id)
        sftp_path = _normalize_sftp_path(raw_path, os_type)

        entries = []
        for attr in sftp.listdir_attr(sftp_path):
            name = attr.filename
            if name in (".", ".."):
                continue
            is_dir = stat.S_ISDIR(attr.st_mode) if attr.st_mode is not None else False
            full_path = posixpath.join(sftp_path.rstrip("/"), name)
            if is_dir and not full_path.endswith("/"):
                full_path += "/"
            entries.append({
                "name": name,
                "path": full_path,
                "is_dir": is_dir,
                "size": 0 if is_dir else (attr.st_size or 0),
                "mtime": attr.st_mtime or 0
            })

        # Sort directories first, then alphabetically
        entries.sort(key=lambda x: (not x["is_dir"], x["name"].lower()))
        return jsonify({
            "server_id": server_id,
            "os_type": os_type,
            "path": sftp_path,
            "entries": entries
        })
    except Exception as exc:
        # Reset pooled connection on SFTP error so next attempt reconnects cleanly
        with _pool_lock:
            _ssh_pool.pop(server_id, None)
        return jsonify({"error": str(exc)}), 500


@blueprint.route("/api/files/download", methods=["GET"])
def download_remote_file():
    server_id = request.args.get("server_id", "")
    raw_path = request.args.get("path", "")
    try:
        _, sftp, os_type = _get_connection(server_id)
        sftp_path = _normalize_sftp_path(raw_path, os_type)
        filename = posixpath.basename(sftp_path.rstrip("/")) or "download.bin"

        buf = io.BytesIO()
        sftp.getfo(sftp_path, buf)
        buf.seek(0)
        return send_file(buf, as_attachment=True, download_name=filename)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@blueprint.route("/api/files/upload", methods=["POST"])
def upload_remote_file():
    server_id = request.form.get("server_id", "")
    target_dir = request.form.get("path", "/")
    files = request.files.getlist("files")
    if not files:
        return jsonify({"error": "No files provided"}), 400

    try:
        _, sftp, os_type = _get_connection(server_id)
        norm_dir = _normalize_sftp_path(target_dir, os_type)
        uploaded =
