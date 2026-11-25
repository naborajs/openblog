#!/usr/bin/env python3
"""Submit a reviewed OpenBlog draft with a locally staged, rights-checked cover."""
import argparse
import hashlib
from html import unescape
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PROFILE = Path(os.environ.get("OPENBLOG_PROFILE", Path.home() / ".hermes/profiles/research"))
STAGING = PROFILE / "blog_images/covers"
CREDITS = PROFILE / "blog_images/credits"
PUBLIC_MEDIA = Path(os.environ.get("OPENBLOG_PUBLIC_MEDIA", "/srv/openblog/covers"))
ORIGIN = os.environ.get("OPENBLOG_ORIGIN", "https://blog.naborajs.me").rstrip("/")
LOCAL_API = os.environ.get("OPENBLOG_LOCAL_API", "http://127.0.0.1:3100").rstrip("/")
COVER_RE = re.compile(r"^[a-z0-9-]{3,112}-cover[.]jpg$")
KEY_RE = re.compile(r"ob_[A-Za-z0-9_-]{43}")
DRAFT_ID_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$", re.I)
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
ALLOWED = {"section","title","topic","summary","body","cover_file","cover_alt","video_url","video_captions","transcript","sources","related_slugs"}
PLACEHOLDERS = re.compile(r"\b(?:lorem ipsum|todo:|citation needed|insert (?:source|citation|example)|to be added)\b", re.I)

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def jpeg_dimensions(data):
    if len(data) < 4 or data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
        raise ValueError("cover is not a complete JPEG")
    sof = {0xC0,0xC1,0xC2,0xC3,0xC5,0xC6,0xC7,0xC9,0xCA,0xCB,0xCD,0xCE,0xCF}
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            pos += 1
            continue
        while pos < len(data) and data[pos] == 0xFF:
            pos += 1
        if pos >= len(data):
            break
        marker = data[pos]
        pos += 1
        if marker in (0xD8,0xD9,0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if marker == 0xDA:
            break
        if pos + 2 > len(data):
            break
        length = int.from_bytes(data[pos:pos+2], "big")
        if length < 2 or pos + length > len(data):
            raise ValueError("invalid JPEG segment")
        if marker in sof:
            if length < 7:
                raise ValueError("invalid JPEG frame")
            height = int.from_bytes(data[pos+3:pos+5], "big")
            width = int.from_bytes(data[pos+5:pos+7], "big")
            return width, height
        pos += length
    raise ValueError("JPEG dimensions could not be read")

def load_cover(filename, alt):
    if not isinstance(filename, str) or not COVER_RE.fullmatch(filename):
        raise ValueError("cover_file must be one staged *-cover.jpg filename")
    if not isinstance(alt, str) or not alt.strip() or len(alt.strip()) > 180:
        raise ValueError("cover_alt must contain 1 to 180 characters")
    staging = STAGING.resolve(strict=True)
    candidate = STAGING / filename
    if STAGING.is_symlink() or not STAGING.is_dir() or candidate.is_symlink() or not candidate.is_file():
        raise ValueError("cover must be a regular file in the private staging folder")
    os.chmod(STAGING, 0o700)
    source = candidate.resolve(strict=True)
    if source.parent != staging:
        raise ValueError("cover resolved outside the staging folder")
    info = source.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_size > 5_000_000:
        raise ValueError("cover must be a regular file no larger than 5 MB")
    data = source.read_bytes()
    if jpeg_dimensions(data) != (1200, 630):
        raise ValueError("cover must be a 1200 by 630 JPEG")
    credit_path = CREDITS / (filename[:-10] + ".json")
    if CREDITS.is_symlink() or not CREDITS.is_dir() or credit_path.is_symlink() or not credit_path.is_file() or credit_path.stat().st_size > 32_000:
        raise ValueError("matching private image-rights record is required")
    os.chmod(CREDITS, 0o700)
    os.chmod(credit_path, 0o600)
    credit = json.loads(credit_path.read_text(encoding="utf-8"))
    source_info = credit.get("image_source")
    if credit.get("rights_verified") is not True or not isinstance(source_info, dict):
        raise ValueError("image-rights record must be verified")
    recorded_file = credit.get("cover_file")
    if not isinstance(recorded_file, str) or recorded_file != filename:
        raise ValueError("rights record must name the matching cover basename")
    try:
        recorded_path = (STAGING / recorded_file).resolve(strict=True)
    except OSError as error:
        raise ValueError("rights record cover file is unavailable") from error
    if recorded_path != source:
        raise ValueError("rights record resolves to a different cover file")
    if not str(source_info.get("creator", "")).strip() or not str(source_info.get("license", "")).strip():
        raise ValueError("rights record needs a creator and license")
    license_name = str(source_info["license"]).strip()
    source_url = str(source_info.get("source_url", "")).strip()
    license_url = str(source_info.get("license_url", "")).strip()
    is_original = "original" in license_name.casefold() and "creation" in source_url.casefold()
    if not source_url or (not is_original and not (urlsplit(source_url).scheme == "https" and urlsplit(source_url).hostname)):
        raise ValueError("rights record needs an HTTPS source URL or an explicit original-creation record")
    if not is_original and not (urlsplit(license_url).scheme == "https" and urlsplit(license_url).hostname):
        raise ValueError("rights record needs an HTTPS license URL")
    credit_alt = credit.get("cover_alt") or credit.get("alt_text")
    if not isinstance(credit_alt, str) or not credit_alt.strip() or credit_alt.strip() != alt.strip():
        raise ValueError("draft alt text must match the rights record")
    required_credit = str(source_info.get("required_credit") or "").strip()
    return data, hashlib.sha256(data).hexdigest(), required_credit

def validate_publication(draft, required_credit):
    body = draft.get("body")
    if not isinstance(body, str) or PLACEHOLDERS.search(body):
        raise ValueError("article body is missing or contains a draft placeholder")
    minimum_words = 250 if draft["section"] == "news" else 650
    if len(body.split()) < minimum_words:
        raise ValueError(f"article needs at least {minimum_words} words before it can publish")
    minimum_headings = 2 if draft["section"] == "news" else 3
    if len(re.findall(r"(?m)^#{2,3}[ \t]+", body)) < minimum_headings:
        raise ValueError(f"article needs at least {minimum_headings} useful section headings")
    sources = draft.get("sources")
    if not isinstance(sources, list) or len(sources) < 3 or len(sources) > 12:
        raise ValueError("article needs three to twelve specific source links")
    hosts = set()
    urls = set()
    for source in sources:
        if not isinstance(source, dict):
            raise ValueError("each source must include a title and HTTPS URL")
        address = source.get("url")
        title = source.get("title")
        parsed = urlsplit(address) if isinstance(address, str) else None
        if not parsed or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("sources must be direct HTTPS links without embedded credentials")
        normalized = address.strip().rstrip("/").casefold()
        if normalized in urls:
            raise ValueError("source URLs must be unique")
        urls.add(normalized)
        hosts.add(parsed.hostname.casefold())
        if not isinstance(title, str) or not title.strip() or len(title.strip()) > 180:
            raise ValueError("every source needs a descriptive title")
    if len(hosts) < 2:
        raise ValueError("sources must come from at least two distinct hosts")
    if required_credit and required_credit.casefold() not in body.casefold():
        raise ValueError("the cover license requires a visible credit in the article body")

def post_api(path, key, payload, idempotency=None):
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if idempotency:
        headers["Idempotency-Key"] = idempotency
    request = Request(LOCAL_API + path, json.dumps(payload, ensure_ascii=False).encode(), headers, method="POST")
    # This credential must never be sent through an ambient HTTP proxy.
    with build_opener(NoRedirect(), ProxyHandler({})).open(request, timeout=20) as response:
        return response.status, json.load(response)

def install_cover(data, digest):
    filename = "hermes-" + digest + "-cover.jpg"
    target = PUBLIC_MEDIA / filename
    if PUBLIC_MEDIA.is_symlink() or not PUBLIC_MEDIA.is_dir():
        raise ValueError("public media directory is unavailable")
    if target.is_symlink():
        raise ValueError("hash-named cover path is unexpectedly a symlink")
    if target.exists():
        if hashlib.sha256(target.read_bytes()).hexdigest() != digest:
            raise ValueError("hash-named cover contains different data")
        return filename
    fd, temporary = tempfile.mkstemp(prefix=".openblog-", suffix=".tmp", dir=PUBLIC_MEDIA)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, target)
        os.chmod(target, 0o644)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return filename

def main():
    cli = argparse.ArgumentParser()
    cli.add_argument("draft", type=Path)
    cli.add_argument("--dedupe", required=True)
    cli.add_argument("--dry-run", action="store_true", help="Validate only; do not upload or call the API.")
    args = cli.parse_args()
    try:
        public_origin = urlsplit(ORIGIN)
        local_api = urlsplit(LOCAL_API)
        if public_origin.scheme != "https" or public_origin.hostname != "blog.naborajs.me" or public_origin.username or public_origin.password or public_origin.path:
            raise ValueError("OPENBLOG_ORIGIN must match the configured OpenBlog HTTPS site")
        if local_api.scheme != "http" or local_api.hostname not in ("127.0.0.1", "localhost", "::1") or local_api.username or local_api.password:
            raise ValueError("OPENBLOG_LOCAL_API must point to the local OpenBlog HTTP listener")
        profile = PROFILE.resolve(strict=True)
        draft_path = args.draft.resolve(strict=True)
        if not draft_path.is_relative_to(profile) or draft_path.stat().st_size > 256_000:
            raise ValueError("draft must be under the research profile and at most 256 KB")
        identity = args.dedupe.strip().casefold()
        if not identity or len(identity) > 250:
            raise ValueError("dedupe identity must contain 1 to 250 characters")
        draft = json.loads(draft_path.read_text(encoding="utf-8"))
        if not isinstance(draft, dict) or draft.get("section") not in ("news","teaching","find-out"):
            raise ValueError("draft must be an OpenBlog article with a valid section")
        unknown = set(draft) - ALLOWED
        if unknown:
            raise ValueError("unsupported draft fields: " + ", ".join(sorted(unknown)))
        if "cover_url" in draft:
            raise ValueError("direct cover URLs are not accepted; provide cover_file")
        data, digest, required_credit = load_cover(draft.get("cover_file"), draft.get("cover_alt"))
        validate_publication(draft, required_credit)
        filename = "hermes-" + digest + "-cover.jpg"
        payload = dict(draft)
        payload.pop("cover_file")
        payload["cover_alt"] = payload["cover_alt"].strip()
        payload["cover_url"] = ORIGIN + "/media/covers/" + filename
        if args.dry_run:
            print(json.dumps({"status":"validated","cover_file":filename,"cover_url":payload["cover_url"],"section":payload["section"]}))
            return
        key_path = Path(os.environ.get("OPENBLOG_KEY_FILE", PROFILE / "secrets/openblog_draft_key"))
        if key_path.is_symlink() or not key_path.is_file() or key_path.stat().st_mode & 0o077:
            raise ValueError("draft-key file is missing or has unsafe permissions")
        key = key_path.read_text(encoding="utf-8").strip()
        if not KEY_RE.fullmatch(key):
            raise ValueError("draft-key file format is invalid")
        fingerprint = hashlib.sha256((payload["section"] + ":" + identity).encode()).hexdigest()
        install_cover(data, digest)
        status, response = post_api("/api/v1/drafts", key, payload, "hermes-" + fingerprint)
        result = response.get("draft")
        if status not in (200, 201) or not isinstance(result, dict) or not isinstance(result.get("id"), str) or not DRAFT_ID_RE.fullmatch(result["id"]):
            raise ValueError("draft API response was incomplete")
        if not isinstance(result.get("slug"), str) or not SLUG_RE.fullmatch(result["slug"]):
            raise ValueError("draft API returned an invalid article slug")
        published_status, published = post_api("/api/v1/drafts/" + result["id"] + "/publish", key, {})
        if (published_status != 200 or not isinstance(published, dict) or published.get("status") != "published"
                or published.get("slug") != result["slug"] or not isinstance(published.get("url"), str)
                or not published["url"].startswith(ORIGIN + "/articles/")):
            raise ValueError("draft was saved but the publication gate did not approve it")
        print(json.dumps({"status":"published","draft_id":result["id"],"slug":published["slug"],"url":published["url"],"cover_file":filename}))
    except HTTPError as error:
        retry = error.headers.get("Retry-After")
        message = "OpenBlog rejected the draft with HTTP " + str(error.code)
        if retry and retry.isdigit():
            message += " (retry after " + retry + " seconds)"
        raise SystemExit(message)
    except (URLError, OSError, ValueError, json.JSONDecodeError) as error:
        raise SystemExit("OpenBlog draft submission failed: " + str(error))

if __name__ == "__main__":
    main()
