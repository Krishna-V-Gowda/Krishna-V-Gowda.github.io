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


def resolve_local(page: Path, reference: str) -> Path | None:
    if not reference or reference.startswith(("mailto:", "tel:", "data:", "javascript:")):
        return None
    parts = urlsplit(reference)
    if parts.scheme or parts.netloc:
        return None
    if not parts.path:
        return page
    return (page.parent / parts.path).resolve()


def main() -> int:
    errors: list[str] = []
    pages = sorted(ROOT.rglob("*.html"))
    link_count = 0
    image_count = 0
    id_count = 0

    for page in pages:
        relative = page.relative_to(ROOT)
        parser = PageParser()
        parser.feed(page.read_text(encoding="utf-8"))
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

    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT)
        if any(part in FORBIDDEN_DIRS for part in relative.parts):
            errors.append(f"forbidden generated residue: {relative}")
        if path.is_file() and path.suffix.lower() == ".svg":
            try:
                ET.parse(path)
            except ET.ParseError as exc:
                errors.append(f"{relative}: invalid SVG/XML: {exc}")

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
