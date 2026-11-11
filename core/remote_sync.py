import json
import re
import threading
import paramiko
import config

_sync_lock = threading.Lock()


def _replace_python_assignment(source_code: str, var_name: str, new_assignment_str: str) -> str:
    """
    Finds `VAR_NAME = [...]` or `VAR_NAME = {...}` (including nested dicts/lists)
    and replaces the entire block with `new_assignment_str`.
    """
    pattern = re.compile(rf"^({re.escape(var_name)}\s*=\s*)([\[\{{])", re.MULTILINE)
    match = pattern.search(source_code)
    if not match:
        raise ValueError(f"Could not find `{var_name} =` block in file.")

    open_char = match.group(2)
    close_char = "]" if open_char == "[" else "}"
    start_idx = match.start()
    scan_start = match.end() - 1

    depth = 0
    in_str = False
    str_char = ""
    escaped = False

    for i in range(scan_start, len(source_code)):
        ch = source_code[i]
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == str_char:
                in_str = False
        else:
            if ch in ("'", '"'):
                in_str = True
                str_char = ch
            elif ch == open_char:
                depth += 1
            elif ch == close_char:
                depth -= 1
                if depth == 0:
                    return source_code[:start_idx] + new_assignment_str + source_code[i + 1:]

    raise ValueError(f"Unbalanced brackets while parsing `{var_name}`.")


def _build_monitored_servers_code(servers_dict: dict) -> str:
    sorted_items = sorted(servers_dict.items(), key=lambda item: str(item[0]))
    hosts = [srv.get("host", "").strip() for _, srv in sorted_items if srv.get("host")]
    return "MONITORED_SERVERS = " + json.dumps(hosts, indent=4)


def _build_app_servers_code(servers_dict: dict) -> str:
    sorted_items = sorted(servers_dict.items(), key=lambda item: str(item[0]))
    lines = ["SERVERS = {"]
    for idx, (sid, srv) in enumerate(sorted_items):
        comma = "," if idx < len(sorted_items) - 1 else ""
        entry = {
            "host": srv.get("host", "").strip(),
            "user": srv.get("user", "").strip(),
            "password": srv.get("password", ""),
        }
        lines.append(f'    {json.dumps(str(sid))}: {json.dumps(entry)}{comma}')
    lines.append("}")
    return "\n".join(lines)


def _build_node_counts_code(servers_dict: dict) -> str:
    counts = {"local": 0}
    for sid in sorted(servers_dict.keys(), key=str):
        counts[str(sid)] = 0
    return f"node_active_counts = {json.dumps(counts)}"


def _atomic_sftp_write(sftp, remote_path: str, content: str):
    tmp_path = f"{remote_path}.dws_sync.tmp"
    with sftp.file(tmp_path, "w") as f:
        f.write(content)
    sftp.posix_rename(tmp_path, remote_path)


def _resolve_ssh_credentials(servers_dict: dict):
    host = getattr(config, "REMOTE_SYNC_HOST", "192.168.2.91")
    user = getattr(config, "REMOTE_SYNC_USER", "dylanwardstudios")
    password = getattr(config, "REMOTE_SYNC_PASS", "weqr1234")

    # If 192.168.2.91 is in the settings dict, prefer its current credentials
    for srv in (servers_dict or {}).values():
        if srv.get("host", "").strip() == host:
            user = srv.get("user") or user
            password = srv.get("password") or password
            break

    return host, user, password


def sync_remote_dws_shell(servers_dict: dict) -> dict:
    """
    SSH/SFTPs into 192.168.2.91, updates gatekeeper.py and app.py inside
    /home/dylanwardstudios/DWSSecureShell, and restarts the Docker container.
    """
    if not getattr(config, "REMOTE_SYNC_ENABLED", True):
        return {"ok": False, "skipped": True, "reason": "REMOTE_SYNC_ENABLED is False"}

    remote_dir = getattr(config, "REMOTE_SYNC_DIR", "/home/dylanwardstudios/DWSSecureShell").rstrip("/")
    # Ensure leading slash on Linux path
    if not remote_dir.startswith("/"):
        remote_dir = "/" + remote_dir

    gatekeeper_path = f"{remote_dir}/gatekeeper.py"
    app_path = f"{remote_dir}/app.py"
    container_override = getattr(config, "REMOTE_DOCKER_CONTAINER", "").strip()

    host, user, password = _resolve_ssh_credentials(servers_dict)

    with _sync_lock:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            print(f"[REMOTE SYNC] Connecting to {user}@{host} ({remote_dir})...", flush=True)
            ssh.connect(host, username=user, password=password, timeout=8)
            sftp = ssh.open_sftp()

            # 1. Update gatekeeper.py (MONITORED_SERVERS)
            with sftp.file(gatekeeper_path, "r") as f:
                gk_code = f.read().decode("utf-8")

            new_monitored_code = _build_monitored_servers_code(servers_dict)
            updated_gk_code = _replace_python_assignment(gk_code, "MONITORED_SERVERS", new_monitored_code)
            _atomic_sftp_write(sftp, gatekeeper_path, updated_gk_code)
            print(f"[REMOTE SYNC] Updated {gatekeeper_path}", flush=True)

            # 2. Update app.py (SERVERS and node_active_counts)
            with sftp.file(app_path, "r") as f:
                app_code = f.read().decode("utf-8")

            new_servers_code = _build_app_servers_code(servers_dict)
            updated_app_code = _replace_python_assignment(app_code, "SERVERS", new_servers_code)

            try:
                new_counts_code = _build_node_counts_code(servers_dict)
                updated_app_code = _replace_python_assignment(updated_app_code, "node_active_counts", new_counts_code)
            except ValueError:
                pass  # Dynamic node_active_counts already in use

            _atomic_sftp_write(sftp, app_path, updated_app_code)
            print(f"[REMOTE SYNC] Updated {app_path}", flush=True)

            sftp.close()

            # 3. Copy updated files into the container (if not bind-mounted) & restart Docker container
            if container_override:
                restart_script = f"""
                CID="{container_override}"
                docker cp "{gatekeeper_path}" "$CID:/app/gatekeeper.py" 2>/dev/null || true
                docker cp "{app_path}" "$CID:/app/app.py" 2>/dev/null || true
                docker restart "$CID" || echo "{password}" | sudo -S docker restart "$CID"
                """
            else:
                restart_script = f"""
                cd "{remote_dir}" || exit 1
                # Find container by port 5000, port 5050, or name matching dws/shell
                CID=$(docker ps --filter "publish=5000" -q | head -n 1)
                if [ -z "$CID" ]; then
                    CID=$(docker ps --format '{{{{.ID}}}} {{{{.Names}}}}' | grep -iE 'dws|shell' | awk '{{print $1}}' | head -n 1)
                fi
                if [ -n "$CID" ]; then
                    docker cp "{gatekeeper_path}" "$CID:/app/gatekeeper.py" 2>/dev/null || true
                    docker cp "{app_path}" "$CID:/app/app.py" 2>/dev/null || true
                    docker restart "$CID" || echo "{password}" | sudo -S docker restart "$CID"
                elif [ -f "docker-compose.yml" ] || [ -f "compose.yml" ]; then
                    docker compose restart || docker-compose restart || echo "{password}" | sudo -S docker compose restart
                fi
                """

            _, stdout, stderr = ssh.exec_command(restart_script, timeout=25)
            exit_status = stdout.channel.recv_exit_status()
            out_msg = stdout.read().decode("utf-8", errors="replace").strip()
            err_msg = stderr.read().decode("utf-8", errors="replace").strip()

            print(f"[REMOTE SYNC] Docker restart finished (exit={exit_status}): {out_msg or err_msg}", flush=True)
            return {"ok": exit_status == 0, "stdout": out_msg, "stderr": err_msg}

        except Exception as exc:
            print(f"[REMOTE SYNC] ERROR syncing to {host}: {exc}", flush=True)
            return {"ok": False, "error": str(exc)}
        finally:
            try:
                ssh.close()
            except Exception:
                pass


def trigger_remote_sync_async(servers_dict: dict):
    """Spawns a background thread so saving settings in the UI returns immediately."""
    servers_copy = copy.deepcopy(servers_dict) if hasattr(json, "dumps") else dict(servers_dict)
    t = threading.Thread(target=sync_remote_dws_shell, args=(servers_copy,), daemon=True)
    t.start()
