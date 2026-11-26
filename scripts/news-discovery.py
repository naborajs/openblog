#!/usr/bin/env python3
"""Fetch bounded Currents headlines for private news research, never publication."""
import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PROFILE = Path.home() / ".hermes/profiles/research"
DEFAULT_KEY = PROFILE / "secrets/currents_api_key"
ENDPOINT = "https://api.currentsapi.services/v1/latest-news?" + urlencode({"language": "en", "page_size": 20})
USER_AGENT = "OpenBlog/1.0 (+https://blog.naborajs.me/policy)"
KEY_PATTERN = re.compile(r"^[A-Za-z0-9._~-]{16,512}$")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_key():
    path = DEFAULT_KEY
    if path.is_symlink():
        raise ValueError("Currents key file must not be a symbolic link")
    if not path.is_file():
        return None
    if path.stat().st_mode & 0o777 != 0o600:
        raise ValueError("Currents key file must use mode 0600")
    if path.parent.is_symlink() or not path.parent.is_dir() or path.parent.stat().st_mode & 0o077:
        raise ValueError("Currents secret directory must be a private directory")
    key = path.read_text(encoding="utf-8").strip()
    if not KEY_PATTERN.fullmatch(key):
        raise ValueError("Currents key file has an invalid format")
    return key


def safe_text(value, limit):
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def fetch(key):
    parts = urlsplit(ENDPOINT)
    if parts.scheme != "https" or parts.hostname != "api.currentsapi.services" or parts.username or parts.password:
        raise ValueError("Currents endpoint configuration is invalid")
    request = Request(ENDPOINT, headers={
        "Authorization": "Bearer " + key,
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    opener = build_opener(NoRedirect(), ProxyHandler({}))
    with opener.open(request, timeout=12) as response:
        if response.status != 200 or response.headers.get_content_type() != "application/json":
            raise ValueError("Currents returned an unexpected response")
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("Currents response exceeded the size limit")
    result = json.loads(data)
    if not isinstance(result, dict) or result.get("status") != "ok" or not isinstance(result.get("news"), list):
        raise ValueError("Currents returned an unexpected JSON structure")
    articles = []
    seen = set()
    for item in result["news"][:20]:
        if not isinstance(item, dict):
            continue
        raw_url = item.get("url")
        if not isinstance(raw_url, str):
            continue
        address = urlsplit(raw_url)
        if address.scheme != "https" or not address.hostname or address.username or address.password or address.fragment:
            continue
        canonical = address._replace(fragment="").geturl()
        if canonical in seen:
            continue
        seen.add(canonical)
        categories = item.get("category")
        if not isinstance(categories, list):
            categories = []
        articles.append({
            "title": safe_text(item.get("title"), 240),
            "published": safe_text(item.get("published"), 80),
            "source": safe_text(item.get("author"), 120),
            "category": [safe_text(value, 50) for value in categories[:8] if isinstance(value, str)],
            "url": canonical,
            "lead": safe_text(item.get("description"), 300),
        })
    return articles


def main():
    try:
        key = read_key()
        if key is None:
            print(json.dumps({"status": "disabled", "provider": "Currents", "reason": "key_not_configured"}))
            return
        articles = fetch(key)
        print(json.dumps({"status": "ok", "provider": "Currents", "use": "private_discovery_only", "articles": articles}, ensure_ascii=False))
    except HTTPError as error:
        retry = error.headers.get("Retry-After", "")
        result = {"status": "unavailable", "provider": "Currents", "http_status": error.code}
        if retry.isdigit():
            result["retry_after_seconds"] = int(retry)
        print(json.dumps(result))
        sys.exit(2 if error.code in (401, 403) else 0)
    except (OSError, URLError, ValueError, json.JSONDecodeError) as error:
        print(json.dumps({"status": "unavailable", "provider": "Currents", "reason": str(error)[:180]}))
        sys.exit(2)


if __name__ == "__main__":
    main()
