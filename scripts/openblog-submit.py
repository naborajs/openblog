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
from urllib.parse import unquote, urlencode, urlsplit
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

def safe_https_bytes(url, host, limit, content_types):
    parsed = urlsplit(url) if isinstance(url, str) else None
    hosts = {host} if isinstance(host, str) else set(host)
    if (not parsed or parsed.scheme != "https" or parsed.hostname not in hosts or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.fragment):
        raise ValueError("image source must use an approved HTTPS host")
    request = Request(url, headers={
        "User-Agent": "OpenBlog/1.0 (+https://blog.naborajs.me/policy)",
        "Accept": ", ".join(content_types),
    })
    try:
        with build_opener(NoRedirect(), ProxyHandler({})).open(request, timeout=20) as response:
            if response.status != 200:
                raise ValueError("image source returned an unexpected status")
            content_type = response.headers.get_content_type().casefold()
            if content_type not in content_types:
                raise ValueError("image source returned an unsupported content type")
            declared = response.headers.get("Content-Length")
            if declared and int(declared) > limit:
                raise ValueError("image source exceeds the download limit")
            data = response.read(limit + 1)
    except HTTPError as error:
        raise ValueError("approved image source returned HTTP " + str(error.code)) from error
    if not data or len(data) > limit:
        raise ValueError("image source is empty or exceeds the download limit")
    return data


def plain_metadata(value):
    value = re.sub(r"<[^>]*>", " ", str(value or ""))
    return re.sub(r"\s+", " ", unescape(value)).strip()


def commons_cover(filename, alt, slug, title):
    if not isinstance(filename, str) or not COVER_RE.fullmatch(filename):
        raise ValueError("cover_file must be one *-cover.jpg rights-record filename")
    if not isinstance(alt, str) or not alt.strip() or len(alt.strip()) > 180:
        raise ValueError("cover_alt must contain 1 to 180 characters")
    if STAGING.is_symlink() or not STAGING.is_dir():
        raise ValueError("private image-rights directory is unavailable")
    os.chmod(STAGING, 0o700)
    credit_path = CREDITS / (filename[:-10] + ".json")
    if CREDITS.is_symlink() or not CREDITS.is_dir() or credit_path.is_symlink() or not credit_path.is_file() or credit_path.stat().st_size > 32_000:
        raise ValueError("matching private image-rights record is required")
    os.chmod(CREDITS, 0o700)
    os.chmod(credit_path, 0o600)
    credit = json.loads(credit_path.read_text(encoding="utf-8"))
    source_info = credit.get("image_source")
    if credit.get("rights_verified") is not True or not isinstance(source_info, dict):
        raise ValueError("image-rights record must be verified")
    if credit.get("slug") != slug or credit.get("title") != title or credit.get("cover_file") != filename:
        raise ValueError("rights record must match the article and cover filename")
    if str(credit.get("cover_alt", "")).strip() != alt.strip():
        raise ValueError("draft alt text must match the rights record")
    if source_info.get("provider") != "Wikimedia Commons":
        raise ValueError("only verified Wikimedia Commons photo sources are enabled")
    source_url = str(source_info.get("source_url", "")).strip()
    license_url = str(source_info.get("license_url", "")).strip()
    creator = plain_metadata(source_info.get("creator"))
    license_name = plain_metadata(source_info.get("license"))
    download_url = str(source_info.get("download_url", "")).strip()
    source_digest = str(source_info.get("source_sha256", "")).strip().lower()
    parsed_source = urlsplit(source_url)
    if (parsed_source.scheme != "https" or parsed_source.hostname != "commons.wikimedia.org"
            or parsed_source.username or parsed_source.password or parsed_source.query or parsed_source.fragment
            or not unquote(parsed_source.path).startswith("/wiki/File:") or not creator or len(creator) > 240
            or not license_name or len(license_name) > 120):
        raise ValueError("rights record needs a Wikimedia file page, named creator, and license")
    if not re.fullmatch(r"[0-9a-f]{64}", source_digest):
        raise ValueError("rights record needs the SHA-256 of the selected Commons image")

    file_title = unquote(parsed_source.path).removeprefix("/wiki/")
    query = urlencode({
        "action": "query", "titles": file_title, "prop": "imageinfo",
        "iiprop": "url|extmetadata", "iiurlwidth": "1800", "format": "json", "formatversion": "2",
    })
    api_data = safe_https_bytes(
        "https://commons.wikimedia.org/w/api.php?" + query,
        "commons.wikimedia.org", 1_000_000, ["application/json"],
    )
    try:
        api_result = json.loads(api_data)
        page = api_result["query"]["pages"][0]
        image_info = page["imageinfo"][0]
        metadata = image_info["extmetadata"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Commons did not return usable file and license metadata") from error
    if page.get("missing") is not None:
        raise ValueError("Commons file page does not exist")
    canonical_page = urlsplit(str(image_info.get("descriptionurl", "")))
    if canonical_page.hostname != "commons.wikimedia.org" or unquote(canonical_page.path).casefold() != unquote(parsed_source.path).casefold():
        raise ValueError("rights record does not point to the canonical Commons file page")

    commons_license = plain_metadata(metadata.get("LicenseShortName", {}).get("value"))
    commons_license_url = str(metadata.get("LicenseUrl", {}).get("value") or "").strip()
    if commons_license.casefold() != license_name.casefold():
        raise ValueError("recorded license does not match the Commons file page")
    normalized_license = commons_license.casefold().replace("-", " ")
    if not (normalized_license in {"cc0", "public domain"}
            or (normalized_license.startswith("cc by ") and not any(term in normalized_license for term in ("sa", "nc", "nd")))):
        raise ValueError("only CC0, public-domain, or attribution-only CC BY cover photos are enabled")
    if commons_license_url.startswith("http://"):
        commons_license_url = "https://" + commons_license_url[len("http://"):]
    provided_license = urlsplit(license_url)
    canonical_license = urlsplit(commons_license_url)
    if (provided_license.scheme != "https" or provided_license.hostname != canonical_license.hostname
            or provided_license.path.rstrip("/").casefold() != canonical_license.path.rstrip("/").casefold()):
        raise ValueError("recorded license URL does not match the Commons file page")
    artist = plain_metadata(metadata.get("Artist", {}).get("value"))
    if not artist or creator.casefold() not in artist.casefold():
        raise ValueError("recorded creator does not match the Commons file page")

    canonical_asset = str(image_info.get("thumburl") or image_info.get("url") or "")
    provided_asset = urlsplit(download_url)
    expected_asset = urlsplit(canonical_asset)
    if (not canonical_asset or expected_asset.scheme != "https" or expected_asset.hostname not in {"upload.wikimedia.org", "thumb.wikimedia.org"}
            or provided_asset.scheme != "https" or provided_asset.hostname != expected_asset.hostname
            or provided_asset.username or provided_asset.password or unquote(provided_asset.path) != unquote(expected_asset.path)):
        raise ValueError("download URL does not match the Commons image asset")

    data = safe_https_bytes(canonical_asset, {"upload.wikimedia.org", "thumb.wikimedia.org"}, 5_000_000, ["image/jpeg"])
    if hashlib.sha256(data).hexdigest() != source_digest:
        raise ValueError("downloaded Commons image does not match the recorded SHA-256")
    width, height = jpeg_dimensions(data)
    if width < 1200 or height < 630 or not 1.3 <= width / height <= 2.4:
        raise ValueError("Commons image must be a landscape JPEG of at least 1200 by 630")
    credit_line = f"Image credit: [{creator}]({source_url}); [{license_name}]({license_url})."
    return data, hashlib.sha256(data).hexdigest(), credit_line

def validate_publication(draft, credit_line):
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
    if credit_line.casefold() not in body.casefold():
        raise ValueError("the verified cover credit must be visible in the article body")

def post_api(path, key, payload, idempotency=None):
    headers = {"Authorization": "Bearer " + key, "Content-Type": "application/json"}
    if idempotency:
        headers["Idempotency-Key"] = idempotency
    request = Request(LOCAL_API + path, json.dumps(payload, ensure_ascii=False).encode(), headers, method="POST")
    # This credential must never be sent through an ambient HTTP proxy.
    with build_opener(NoRedirect(), ProxyHandler({})).open(request, timeout=20) as response:
        return response.status, json.load(response)

def install_cover(data, digest):
    filename = "commons-" + digest + "-cover.jpg"
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
        cover_name = draft.get("cover_file")
        if not isinstance(cover_name, str) or not COVER_RE.fullmatch(cover_name):
            raise ValueError("cover_file must be one *-cover.jpg rights-record filename")
        image_slug = cover_name[:-10]
        data, digest, credit_line = commons_cover(cover_name, draft.get("cover_alt"), image_slug, draft.get("title"))
        if not isinstance(draft.get("body"), str):
            raise ValueError("article body is required before publication")
        if credit_line.casefold() not in draft["body"].casefold():
            draft["body"] = draft["body"].rstrip() + "\n\n" + credit_line
        validate_publication(draft, credit_line)
        filename = "commons-" + digest + "-cover.jpg"
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
