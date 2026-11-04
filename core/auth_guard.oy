import hashlib
import json
import re
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote, urlparse
from flask import jsonify, make_response, redirect, request
from core.storage import StorageManager

_TOKEN_RE = re.compile(r"^[a-zA-Z0-9\-_]{8,128}$")
_cache_lock = threading.Lock()
# Cache structure: { token_sha256: (is_valid_bool, timestamp_float) }
_token_cache = {}

CACHE_TTL_VALID = 5.0    # Re-verify active sessions every 5s so revocations take effect quickly
CACHE_TTL_INVALID = 2.0  # Short cache for invalid tokens to prevent brute-force flooding


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _get_client_ip() -> str:
    forwarded = request.headers.get("X-Original-Remote-Addr") or request.headers.get(
        "X-Forwarded-For", request.remote_addr or ""
    )
    return forwarded.split(",")[0].strip()


def _sanitize_redirect_url(raw_url: str, current_host: str = "") -> str:
    url = (raw_url or "").strip()
    if not url:
        return "https://teamexist.com"
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        parsed = urlparse(url)
        if not parsed.netloc:
            return "https://teamexist.com"
        # Prevent infinite redirect loops if someone sets the redirect URL to this site itself
        if current_host and parsed.netloc.lower() == current_host.lower():
            return "https://teamexist.com"
    except Exception:
        return "https://teamexist.com"

    return url


def verify_dws_token(token: str, verify_url: str, client_ip: str) -> bool:
    if not token or not _TOKEN_RE.match(token):
        return False

    token_key = _hash_token(token)
    now = time.time()

    with _cache_lock:
        cached = _token_cache.get(token_key)
        if cached:
            is_valid, ts = cached
            ttl = CACHE_TTL_VALID if is_valid else CACHE_TTL_INVALID
            if now - ts < ttl:
                return is_valid

    req = urllib.request.Request(
        verify_url,
        data=b"{}",
        headers={
            "Content-Type": "application/json",
            "Cookie": f"dws_auth={token}",
            "X-Forwarded-For": client_ip,
            "User-Agent": "DWSConnect-AuthGuard/1.0",
        },
        method="POST",
    )

    is_authorized = False
    try:
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            if resp.status == 200:
                payload = json.loads(resp.read().decode("utf-8"))
                is_authorized = bool(
                    payload.get("authorized") is True or payload.get("logged_in") is True
                )
    except Exception as exc:
        print(f"[AUTH GUARD] Verification request failed ({verify_url}): {exc}", flush=True)
        # Fail closed on error so auth cannot be bypassed
        is_authorized = False

    with _cache_lock:
        # Prune cache if it grows large
        if len(_token_cache) > 512:
            _token_cache.clear()
        _token_cache[token_key] = (is_authorized, now)

    return is_authorized


def clear_token_cache():
    with _cache_lock:
        _token_cache.clear()


def init_auth_guard(app):
    @app.before_request
    def enforce_gatekeeper_auth():
        settings = StorageManager.load_settings()
        auth_cfg = settings.get("auth", {})

        verify_url = (
            auth_cfg.get("verify_url") or "https://auth.teamexist.com/api/verify"
        ).strip()
        base_redirect = _sanitize_redirect_url(
            auth_cfg.get("redirect_url", "https://teamexist.com"),
            current_host=request.host,
        )
        append_return = bool(auth_cfg.get("append_redirect_param", False))

        token = request.cookies.get("dws_auth", "").strip()
        client_ip = _get_client_ip()

        if verify_dws_token(token, verify_url, client_ip):
            return None  # Authorized -> continue to route

        target_redirect = base_redirect
        if append_return and request.url:
            sep = "&" if "?" in target_redirect else "?"
            target_redirect = f"{target_redirect}{sep}redirect={quote(request.url, safe='')}"

        # If this is a background fetch/API call, return 401 JSON so the frontend can redirect
        if request.path.startswith("/api/"):
            resp = make_response(
                jsonify(
                    {
                        "ok": False,
                        "unauthorized": True,
                        "error": "Unauthorized",
                        "redirect_url": target_redirect,
                    }
                ),
                401,
            )
        else:
            # Browser navigation / asset request -> immediate 302 redirect before loading anything
            resp = make_response(redirect(target_redirect, code=302))

        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        return resp

    @app.after_request
    def apply_security_headers(response):
        # Prevent browser from caching sensitive HTML/API responses after logout/revocation
        if request.path == "/" or request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        return response

    @app.route("/api/auth/config", methods=["GET", "POST"])
    def api_auth_config():
        if request.method == "GET":
            settings = StorageManager.load_settings()
            return jsonify({"ok": True, "auth": settings.get("auth", {})})

        body = request.get_json(silent=True) or {}
        settings = StorageManager.load_settings()
        auth_cfg = settings.get("auth", {})

        raw_redirect = (body.get("redirect_url") or "").strip()
        if not raw_redirect:
            return jsonify({"ok": False, "error": "Redirect URL cannot be empty."}), 400

        clean_redirect = _sanitize_redirect_url(raw_redirect, current_host=request.host)
        raw_verify = (
            body.get("verify_url")
            or auth_cfg.get("verify_url")
            or "https://auth.teamexist.com/api/verify"
        ).strip()

        auth_cfg["redirect_url"] = clean_redirect
        auth_cfg["verify_url"] = raw_verify
        auth_cfg["append_redirect_param"] = bool(body.get("append_redirect_param", False))
        settings["auth"] = auth_cfg

        StorageManager.save_settings(settings)
        clear_token_cache()

        return jsonify(
            {
                "ok": True,
                "auth": auth_cfg,
                "settings": StorageManager.get_public_settings(),
            }
        )
