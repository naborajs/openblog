#!/usr/bin/env python3
"""Create one source-faithful, original editorial cover for each OpenBlog article.

Input is a JSON array returned by the public OpenBlog articles API. The output
images and manifest belong in the ignored ``work/`` directory, never in Git.
The diagrams use only the article title, summary, and its own section headings;
they do not invent statistics or download third-party images.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH, HEIGHT = 1200, 630
PAPER = (255, 255, 255)
INK = (10, 10, 11)
BLUE = (23, 69, 170)
RED = (158, 25, 42)
PALE = (239, 242, 247)
RULE = (207, 211, 220)
MUTED = (78, 82, 91)

FILLER = re.compile(
    r"^(?:comprehensive deep dive|extended guide|deep dive|final thoughts?|"
    r"final resources|conclusion|your (?:next steps|action plan)|quick reference|"
    r"references|frequently asked questions|common mistakes to avoid|"
    r"tools and resources|learning path|measuring progress)\b",
    re.IGNORECASE,
)
STOP_HEADINGS = {"introduction", "overview", "summary", "references", "conclusion"}


def font(size: int, bold: bool = False, serif: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if serif:
        names = ["georgiab.ttf" if bold else "georgia.ttf", "Georgia Bold.ttf" if bold else "Georgia.ttf"]
    else:
        names = ["arialbd.ttf" if bold else "arial.ttf", "segoeuib.ttf" if bold else "segoeui.ttf"]
    roots = [Path("C:/Windows/Fonts"), Path("/usr/share/fonts/truetype/dejavu"), Path("/usr/share/fonts/truetype/liberation2")]
    for root in roots:
        for name in names:
            path = root / name
            if path.exists():
                return ImageFont.truetype(str(path), size)
    for name in names:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def width_of(draw: ImageDraw.ImageDraw, text: str, typeface: ImageFont.ImageFont) -> float:
    return draw.textlength(text, font=typeface)


def wrap_pixels(draw: ImageDraw.ImageDraw, text: str, typeface: ImageFont.ImageFont, max_width: int) -> list[str]:
    words = re.sub(r"\s+", " ", text.strip()).split(" ")
    lines: list[str] = []
    line = ""
    for word in words:
        candidate = word if not line else line + " " + word
        if width_of(draw, candidate, typeface) <= max_width:
            line = candidate
        elif line:
            lines.append(line)
            line = word
        else:
            # Break unusually long identifiers rather than clipping them.
            chunk = ""
            for char in word:
                if width_of(draw, chunk + char, typeface) > max_width and chunk:
                    lines.append(chunk)
                    chunk = char
                else:
                    chunk += char
            line = chunk
    if line:
        lines.append(line)
    return lines


def section_labels(article: dict) -> list[str]:
    body = str(article.get("body") or "")
    labels: list[str] = []
    for raw in re.findall(r"(?m)^#{1,6}\s+(.+?)\s*#*\s*$", body):
        label = re.sub(r"[`*_]", "", raw).strip().rstrip(":?!.")
        if not label or label.casefold() in STOP_HEADINGS or FILLER.search(label):
            continue
        if label.casefold() not in {value.casefold() for value in labels}:
            labels.append(label)
        if len(labels) == 5:
            break
    if len(labels) < 3:
        summary = re.sub(r"\s+", " ", str(article.get("summary") or "")).strip()
        clauses = [part.strip(" .,:;—–-") for part in re.split(r"[,;:—–]", summary)]
        for part in clauses:
            if len(part) >= 4 and part.casefold() not in {value.casefold() for value in labels}:
                labels.append(part[:56])
            if len(labels) == 4:
                break
    return labels[:4]


def code_sample(article: dict) -> list[str]:
    matches = re.findall(r"```[^\n]*\n(.*?)```", str(article.get("body") or ""), flags=re.S)
    if not matches:
        return []
    lines = [re.sub(r"\s+", " ", line).strip() for line in matches[0].splitlines()]
    lines = [line for line in lines if line][:6]
    return [line[:54] for line in lines]


def concepts_from_title(title: str) -> tuple[str, str]:
    match = re.search(r"\b(?:versus|vs\.?|compared with|instead of)\b", title, re.IGNORECASE)
    if match:
        left = title[:match.start()].strip(" :–—")
        right = title[match.end():].strip(" :–—?")
        left = re.sub(r"^(?:why |how |what |my )+", "", left, flags=re.I)
        right = re.sub(r"^(?:my |the |an? )+", "", right, flags=re.I)
        return left[:38] or "Option one", right[:38] or "Option two"
    return "Principle", "Trade-off"


def central_topic(article: dict) -> str:
    """Choose a few article-specific title words for the illustration's hub."""
    title = re.sub(r"\s+", " ", str(article.get("title") or "")).strip()
    title = re.sub(r"^(?:why|how|what|when|where|who)\s+", "", title, flags=re.I)
    title = re.sub(r"^(?:i\s+)?(?:do not|don't|did not|didn't|avoid|use|trust|choose|prefer|build|make|create|set up|install|understand|learn)\s+", "", title, flags=re.I)
    title = re.sub(r"^(?:i|we|my|our|the|a|an)\s+", "", title, flags=re.I)
    words = re.findall(r"[\w.+#-]+", title, flags=re.UNICODE)
    ignored = {
        "a", "about", "an", "and", "are", "as", "at", "because", "by", "can", "for",
        "from", "in", "into", "is", "it", "its", "of", "on", "or", "our", "over", "the",
        "their", "this", "to", "with", "when", "where", "why", "what", "how", "everything",
        "personal", "really", "actually", "guide", "tutorial", "using", "use", "using", "my",
    }
    useful = [word for word in words if word.casefold() not in ignored]
    candidate = " ".join(useful[:3]).strip(" .,:;?!—–-")
    return candidate[:32] or str(article.get("topic") or "Main idea")[:32]


def family(article: dict) -> str:
    text = " ".join(str(article.get(key) or "") for key in ("title", "summary", "topic")).casefold()
    if re.search(r"\b(vs\.?|versus|compared with|instead of)\b", text):
        return "comparison"
    code = code_sample(article)
    if code and re.search(r"\b(code|python|haskell|typescript|javascript|cli|programming|script|api)\b", text):
        return "code"
    if re.search(r"\b(cost|economics?|price|budget|free software|trade[- ]?off)\b", text):
        return "tradeoff"
    if re.search(r"\b(network|internet|website|dns|https|ssl|tls|cloudflare|tunnel|vpn|api|agent|mcp|docker|server|database)\b", text):
        return "system"
    if re.search(r"\b(learn|learning|language|workflow|routine|strategy|backup|timeline|step|setup|setting up|install|organize)\b", text):
        return "path"
    return "concept"


def draw_wrapped(draw: ImageDraw.ImageDraw, lines: list[str], xy: tuple[int, int], typeface: ImageFont.ImageFont,
                 fill: tuple[int, int, int], line_gap: int = 5, max_lines: int | None = None) -> int:
    x, y = xy
    if max_lines:
        lines = lines[:max_lines]
    for line in lines:
        draw.text((x, y), line, font=typeface, fill=fill)
        y += typeface.size + line_gap
    return y


def short_lines(draw: ImageDraw.ImageDraw, label: str, typeface: ImageFont.ImageFont, width: int, limit: int = 2) -> list[str]:
    lines = wrap_pixels(draw, label, typeface, width)
    if len(lines) > limit:
        lines = lines[:limit]
        lines[-1] = lines[-1].rstrip(" .,:;") + "…"
    return lines


def draw_brand(draw: ImageDraw.ImageDraw, accent: tuple[int, int, int], section: str, topic: str) -> None:
    # A small globe-and-network signature that uses the site's four-color system.
    cx, cy = 83, 61
    draw.ellipse((cx - 22, cy - 22, cx + 22, cy + 22), outline=INK, width=2)
    draw.ellipse((cx - 9, cy - 22, cx + 9, cy + 22), outline=BLUE, width=2)
    draw.arc((cx - 21, cy - 11, cx + 21, cy + 11), 0, 180, fill=RED, width=2)
    draw.arc((cx - 21, cy - 11, cx + 21, cy + 11), 180, 360, fill=INK, width=2)
    draw.ellipse((cx + 15, cy - 18, cx + 20, cy - 13), fill=accent)
    draw.text((120, 43), "OPENBLOG", font=font(20, bold=True), fill=INK)
    draw.text((120, 70), f"{section.upper()}  /  {topic.upper()[:32]}", font=font(12, bold=True), fill=accent)


def draw_title(draw: ImageDraw.ImageDraw, article: dict) -> None:
    title = re.sub(r"\s+", " ", str(article.get("title") or "OpenBlog article")).strip()
    chosen = None
    for size in (49, 46, 43, 40, 37, 34):
        candidate = font(size, bold=True, serif=(size >= 43))
        lines = wrap_pixels(draw, title, candidate, 584)
        if len(lines) <= 5:
            chosen = (candidate, lines)
            break
    if not chosen:
        chosen = (font(34, bold=True), wrap_pixels(draw, title, font(34, bold=True), 584)[:6])
    typeface, lines = chosen
    draw_wrapped(draw, lines, (66, 137), typeface, INK, line_gap=4, max_lines=6)
    summary = re.sub(r"\s+", " ", str(article.get("summary") or "")).strip()
    summary_font = font(17)
    summary_lines = wrap_pixels(draw, summary, summary_font, 570)
    draw_wrapped(draw, summary_lines[:2], (68, 443), summary_font, MUTED, line_gap=5)


def draw_node(draw: ImageDraw.ImageDraw, rect: tuple[int, int, int, int], label: str, number: int | None,
              accent: tuple[int, int, int], *, fill=PAPER, border=RULE, label_size=16) -> None:
    x1, y1, x2, y2 = rect
    draw.rounded_rectangle(rect, radius=7, fill=fill, outline=border, width=2)
    if number is not None:
        cx, cy = x1 + 23, (y1 + y2) // 2
        draw.ellipse((cx - 14, cy - 14, cx + 14, cy + 14), fill=accent)
        number_font = font(14, bold=True)
        label_number = str(number)
        box = draw.textbbox((0, 0), label_number, font=number_font)
        draw.text((cx - (box[2] - box[0]) / 2, cy - (box[3] - box[1]) / 2 - box[1]), label_number,
                  font=number_font, fill=PAPER)
        text_x = x1 + 47
    else:
        text_x = x1 + 12
    lines = short_lines(draw, label, font(label_size, bold=True), x2 - text_x - 10, 2)
    line_h = label_size + 4
    first_y = (y1 + y2 - len(lines) * line_h) / 2
    draw_wrapped(draw, lines, (int(text_x), int(first_y)), font(label_size, bold=True), INK, line_gap=4)


def draw_path(draw: ImageDraw.ImageDraw, labels: list[str], accent: tuple[int, int, int]) -> None:
    chosen = labels[:4] or ["Question", "Evidence", "Explanation"]
    center_x = 950
    ys = [171 + i * 98 for i in range(len(chosen))]
    draw.line((center_x, ys[0] + 29, center_x, ys[-1] + 29), fill=accent, width=3)
    for i, (label, y) in enumerate(zip(chosen, ys, strict=True), start=1):
        draw_node(draw, (750, y, 1145, y + 60), label, i, accent, label_size=15)


def draw_comparison(draw: ImageDraw.ImageDraw, labels: list[str], article: dict, accent: tuple[int, int, int]) -> None:
    left, right = concepts_from_title(str(article.get("title") or ""))
    draw.text((752, 139), "A SIDE-BY-SIDE VIEW", font=font(12, bold=True), fill=accent)
    for col, term, color in ((0, left, BLUE), (1, right, RED)):
        x = 748 + col * 208
        draw.rounded_rectangle((x, 174, x + 193, 499), radius=8, outline=color, width=2, fill=PAPER)
        draw.line((x + 12, 224, x + 181, 224), fill=color, width=3)
        title_lines = short_lines(draw, term, font(16, bold=True), 162, 2)
        draw_wrapped(draw, title_lines, (x + 14, 188), font(16, bold=True), INK, line_gap=3)
        column_labels = labels[col::2][:3] if labels else ["Context", "Benefits", "Limitations"]
        for row, label in enumerate(column_labels):
            y = 253 + row * 75
            draw.ellipse((x + 15, y + 7, x + 26, y + 18), fill=color)
            draw_wrapped(draw, short_lines(draw, label, font(13), 142, 2), (x + 37, y), font(13), INK, line_gap=3)
    draw.line((951, 244, 951, 499), fill=RULE, width=1)


def draw_system(draw: ImageDraw.ImageDraw, labels: list[str], article: dict, accent: tuple[int, int, int]) -> None:
    center = (950, 336)
    for i, (x, y) in enumerate(((785, 218), (1096, 218), (785, 450), (1096, 450))):
        draw.line((center[0], center[1], x, y), fill=RULE, width=2)
        label = labels[i] if i < len(labels) else central_topic(article)
        draw_node(draw, (x - 76, y - 33, x + 76, y + 33), label, None,
                  RED if i % 2 else BLUE, fill=PAPER, border=RED if i % 2 else BLUE, label_size=12)
    core = central_topic(article)
    draw.ellipse((center[0] - 84, center[1] - 55, center[0] + 84, center[1] + 55), fill=INK)
    draw_wrapped(draw, short_lines(draw, core, font(15, bold=True), 142, 2), (center[0] - 66, center[1] - 16),
                 font(15, bold=True), PAPER, line_gap=3)


def draw_code(draw: ImageDraw.ImageDraw, article: dict, labels: list[str], accent: tuple[int, int, int]) -> None:
    x1, y1, x2, y2 = 744, 165, 1150, 507
    draw.rounded_rectangle((x1, y1, x2, y2), radius=9, fill=PAPER, outline=INK, width=2)
    draw.rounded_rectangle((x1 + 1, y1 + 1, x2 - 1, y1 + 46), radius=8, fill=INK)
    for i, color in enumerate((RED, PAPER, BLUE)):
        cx = x1 + 20 + i * 18
        draw.ellipse((cx - 4, y1 + 17, cx + 4, y1 + 25), fill=color)
    draw.text((x1 + 90, y1 + 12), central_topic(article).upper()[:27], font=font(13, bold=True), fill=PAPER)
    sample = code_sample(article) or labels[:4]
    if not sample:
        sample = ["request → response", "check the contract", "handle the result"]
    code_font = font(15)
    for index, line in enumerate(sample[:6]):
        y = y1 + 70 + index * 37
        draw.text((x1 + 20, y), f"{index + 1:02}", font=font(12), fill=MUTED)
        trimmed = line[:39]
        color = BLUE if re.search(r"\b(?:import|def|class|const|function|return)\b", trimmed) else INK
        draw.text((x1 + 64, y), trimmed, font=code_font, fill=color)
    draw.line((x1 + 20, y2 - 47, x2 - 20, y2 - 47), fill=RULE, width=1)
    draw.text((x1 + 20, y2 - 34), "EXAMPLE FROM THE ARTICLE", font=font(11, bold=True), fill=accent)


def draw_tradeoff(draw: ImageDraw.ImageDraw, labels: list[str], article: dict, accent: tuple[int, int, int]) -> None:
    draw.text((751, 139), "COST AREAS DISCUSSED", font=font(12, bold=True), fill=accent)
    areas = labels[:4] or [central_topic(article), "Time and effort", "Hosting", "Support and upkeep"]
    for idx, label in enumerate(areas):
        col, row = idx % 2, idx // 2
        x, y = 750 + col * 205, 184 + row * 145
        color = BLUE if idx % 2 == 0 else RED
        draw.rounded_rectangle((x, y, x + 188, y + 118), radius=8, fill=PAPER, outline=color, width=2)
        draw.ellipse((x + 15, y + 15, x + 43, y + 43), fill=color)
        draw.text((x + 21, y + 19), str(idx + 1), font=font(13, bold=True), fill=PAPER)
        draw_wrapped(draw, short_lines(draw, label, font(14, bold=True), 151, 3),
                     (x + 15, y + 55), font(14, bold=True), INK, line_gap=3)


def draw_concept(draw: ImageDraw.ImageDraw, labels: list[str], article: dict, accent: tuple[int, int, int]) -> None:
    draw.text((751, 139), "IDEAS IN THIS ARTICLE", font=font(12, bold=True), fill=accent)
    center_x, center_y = 950, 334
    positions = ((951, 196), (1113, 290), (1050, 452), (843, 452), (784, 290))
    core = central_topic(article)
    draw.ellipse((center_x - 74, center_y - 45, center_x + 74, center_y + 45), fill=INK)
    draw_wrapped(draw, short_lines(draw, core, font(13, bold=True), 124, 2), (center_x - 60, center_y - 13),
                 font(13, bold=True), PAPER, line_gap=3)
    points = labels[:5] or ["Question", "Context", "Evidence"]
    for i, (x, y) in enumerate(positions[:len(points)]):
        draw.line((center_x, center_y, x, y), fill=RULE, width=2)
        color = BLUE if i % 2 == 0 else RED
        draw_node(draw, (x - 70, y - 30, x + 70, y + 30), points[i], None, color,
                  fill=PAPER, border=color, label_size=12)


def illustration(article: dict, labels: list[str]) -> tuple[Image.Image, str]:
    image = Image.new("RGB", (WIDTH, HEIGHT), PAPER)
    draw = ImageDraw.Draw(image)
    digest = hashlib.sha256(str(article.get("slug", "article")).encode()).digest()
    accent = BLUE if digest[0] % 2 == 0 else RED
    kind = family(article)

    # A fine rule and spacious editorial frame, rather than a generic colored tile.
    draw.rectangle((24, 24, WIDTH - 25, HEIGHT - 25), outline=RULE, width=1)
    draw.line((66, 101, WIDTH - 66, 101), fill=INK, width=1)
    draw_brand(draw, accent, str(article.get("section") or "article"), str(article.get("topic") or "Open knowledge"))
    draw_title(draw, article)
    draw.line((66, 548, WIDTH - 66, 548), fill=RULE, width=1)
    draw.text((68, 565), "OPEN KNOWLEDGE  ·  ARTICLE VISUAL", font=font(11, bold=True), fill=MUTED)
    draw.text((WIDTH - 218, 565), str(article.get("slug") or "openblog")[:22].upper(), font=font(10, bold=True), fill=INK)

    if kind == "comparison":
        draw_comparison(draw, labels, article, accent)
        alt_kind = "comparison diagram"
    elif kind == "code":
        draw_code(draw, article, labels, accent)
        alt_kind = "code example and reading map"
    elif kind == "tradeoff":
        draw_tradeoff(draw, labels, article, accent)
        alt_kind = "trade-off diagram"
    elif kind == "system":
        draw_system(draw, labels, article, accent)
        alt_kind = "connected systems diagram"
    elif kind == "path":
        draw_path(draw, labels, accent)
        alt_kind = "step-by-step article map"
    else:
        draw_concept(draw, labels, article, accent)
        alt_kind = "concept map"
    return image, alt_kind


def alt_text(article: dict, labels: list[str], kind: str) -> str:
    title = re.sub(r"\s+", " ", str(article.get("title") or "OpenBlog article")).strip()
    details = ", ".join(labels[:2])
    text = f"Original {kind} for {title}"
    if details:
        text += f", showing {details}"
    if len(text) > 178:
        text = text[:175].rsplit(" ", 1)[0] + "…"
    return text.rstrip(" .") + "."


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="JSON array exported from the public articles API")
    parser.add_argument("output", type=Path, help="Private, ignored output directory such as work/openblog-covers")
    parser.add_argument("--base-url", default="https://blog.naborajs.me/media/covers/", help="Public Caddy cover prefix")
    args = parser.parse_args()
    articles = json.loads(args.input.read_text(encoding="utf-8-sig"))
    if not isinstance(articles, list):
        parser.error("The input file must contain an array of articles.")
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = []
    for article in articles:
        slug = str(article.get("slug") or "")
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise ValueError(f"Invalid article slug: {slug!r}")
        labels = section_labels(article)
        image, kind = illustration(article, labels)
        filename = f"{slug}-cover.jpg"
        path = args.output / filename
        image.save(path, format="JPEG", quality=91, optimize=True, progressive=True, exif=b"")
        alt = alt_text(article, labels, kind)
        manifest.append({
            "slug": slug,
            "title": article.get("title", ""),
            "filename": filename,
            "cover_url": args.base_url.rstrip("/") + "/" + filename,
            "cover_alt": alt,
            "kind": kind,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "bytes": path.stat().st_size,
            "labels": labels,
        })
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    distinct = len({entry["sha256"] for entry in manifest})
    if distinct != len(manifest):
        raise RuntimeError(f"Only {distinct} distinct images were made for {len(manifest)} articles.")
    if any(len(entry["cover_alt"]) > 180 for entry in manifest):
        raise RuntimeError("An alt description exceeds OpenBlog's 180 character limit.")
    print(f"Generated {len(manifest)} unique 1200x630 covers ({distinct} distinct) in {args.output}")
    print("By style: " + json.dumps({kind: sum(entry["kind"] == kind for entry in manifest) for kind in sorted({e["kind"] for e in manifest})}))


if __name__ == "__main__":
    main()
