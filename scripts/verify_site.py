from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".html", ".css", ".md", ".xml", ".txt", ".json", ".svg"}
FORBIDDEN_DIRS = {"node_modules", ".next", "build", "dist", "__pycache__"}
FORBIDDEN_PATTERNS = {
    "local-user-path": re.compile("/" + "Users" + "/"),
    "container-path": re.compile("/" + "mnt" + "/" + "data" + "/"),
    "unresolved-placeholder": re.compile(r"(?:TODO_REPLACE|PLACEHOLDER)"),
    "private-form-material": re.compile(r"FORM_ANSWERS|\benrolment\b|\bUEN\b", re.I),
}


class PageParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []
        self.images: list[tuple[str, str]] = []
        self.ids: set[str] = set()
        self.h1_count = 0
        self.title_count = 0
        self.lang: str | None = None
        self.head_links: list[tuple[str, str]] = []
        self.meta: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag == "html":
            self.lang = values.get("lang")
        if tag == "title":
            self.title_count += 1
        if tag == "h1":
            self.h1_count += 1
        if identifier := values.get("id"):
            self.ids.add(identifier)
        if tag == "a" and values.get("href"):
            self.links.append(values["href"] or "")
        if tag == "img":
            self.images.append((values.get("src") or "", values.get("alt") or ""))
        if tag == "link" and values.get("href"):
            self.head_links.append(((values.get("rel") or "").lower(), values["href"] or ""))
        if tag == "meta":
            key = values.get("property") or values.get("name")
            if key and values.get("content") is not None:
                self.meta[key] = values["content"] or ""


def resolve_local(page: Path, reference: str) -> Path | None:
    if not reference or reference.startswith(("mailto:", "tel:", "data:", "javascript:")):
        return None
    parts = urlsplit(reference)
    if parts.scheme or parts.netloc:
        return None
    if not parts.path:
        return page
    return (page.parent / parts.path).resolve()


SITE_ORIGIN = "https://krishna-v-gowda.github.io"


def site_path(url: str) -> Path | None:
    """Map an absolute URL on this site, or a root-relative path, to a file in the payload."""
    parts = urlsplit(url)
    if parts.netloc and f"{parts.scheme}://{parts.netloc}" != SITE_ORIGIN:
        return None
    path = parts.path or "/"
    if path.endswith("/"):
        path += "index.html"
    return ROOT / path.lstrip("/")


def main() -> int:
    errors: list[str] = []
    pages = sorted(ROOT.rglob("*.html"))
    link_count = 0
    image_count = 0
    id_count = 0

    parsed: dict[Path, PageParser] = {}
    for page in pages:
        parser = PageParser()
        parser.feed(page.read_text(encoding="utf-8"))
        parsed[page.resolve()] = parser

    for page in pages:
        relative = page.relative_to(ROOT)
        parser = parsed[page.resolve()]
        if parser.lang != "en":
            errors.append(f"{relative}: html lang must be 'en'")
        if parser.title_count != 1:
            errors.append(f"{relative}: expected one title, found {parser.title_count}")
        if parser.h1_count != 1:
            errors.append(f"{relative}: expected one h1, found {parser.h1_count}")
        id_count += len(parser.ids)
        for src, alt in parser.images:
            image_count += 1
            if not alt.strip():
                errors.append(f"{relative}: image without alt text")
            target = resolve_local(page, src)
            if target is not None and not target.exists():
                errors.append(f"{relative}: missing image {src}")
        for href in parser.links:
            link_count += 1
            if href.startswith("#"):
                if href[1:] not in parser.ids:
                    errors.append(f"{relative}: missing local anchor {href}")
                continue
            target = resolve_local(page, href)
            if target is not None and not target.exists():
                errors.append(f"{relative}: broken local link {href}")
                continue
            fragment = urlsplit(href).fragment
            if target is not None and fragment and target.suffix == ".html":
                other = parsed.get(target.resolve())
                if other is not None and fragment not in other.ids:
                    errors.append(f"{relative}: link {href} points to a missing section")
        for rel, href in parser.head_links:
            link_count += 1
            target = site_path(href) if href.startswith(("/", "http")) else resolve_local(page, href)
            if target is not None and not target.exists():
                errors.append(f"{relative}: <link rel={rel}> target missing: {href}")
        if relative.name != "404.html":
            for key in ("description", "og:title", "og:description", "og:url", "og:image", "twitter:card"):
                if not parser.meta.get(key):
                    errors.append(f"{relative}: missing <meta> {key}")
            image = parser.meta.get("og:image", "")
            if image:
                if not image.lower().endswith((".png", ".jpg", ".jpeg")):
                    errors.append(f"{relative}: og:image must be PNG or JPEG for social platforms: {image}")
                target = site_path(image)
                if target is not None and not target.exists():
                    errors.append(f"{relative}: og:image file missing: {image}")

    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if any(part in FORBIDDEN_DIRS for part in relative.parts):
            errors.append(f"forbidden generated residue: {relative}")
        if path.is_file() and path.suffix.lower() == ".svg":
            try:
                ET.parse(path)
            except ET.ParseError as exc:
                errors.append(f"{relative}: invalid SVG/XML: {exc}")

    sitemap = ROOT / "sitemap.xml"
    if sitemap.exists():
        namespace = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
        listed = {site_path(node.text or "").resolve() for node in ET.parse(sitemap).findall("s:url/s:loc", namespace)}
        expected = {page.resolve() for page in pages if page.name != "404.html"}
        for page in sorted(expected - listed):
            errors.append(f"sitemap.xml: page not listed: {page.relative_to(ROOT)}")
        for page in sorted(listed - expected):
            errors.append(f"sitemap.xml: lists a missing page: {page}")

    public_text_parts: list[str] = []
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            try:
                public_text_parts.append(path.read_text(encoding="utf-8"))
            except UnicodeDecodeError:
                continue
    public_text = "\n".join(public_text_parts)
    for name, pattern in FORBIDDEN_PATTERNS.items():
        if pattern.search(public_text):
            errors.append(f"public residue matched {name}")

    result = {
        "status": "pass" if not errors else "fail",
        "pages": len(pages),
        "links": link_count,
        "images": image_count,
        "ids": id_count,
        "errors": errors,
    }
    print(json.dumps(result, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
