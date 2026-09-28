"""Download a Project Gutenberg text and cut one story out of it.

Usage:
    python tools/import_gutenberg.py <slug> <gutenberg_id> "<start heading>" ["<end heading>"]

The start heading is the exact line that opens the story (e.g. "The Happy Prince.").
The story runs until the end heading, or until the Gutenberg END marker.
Output: content/sources/<slug>.txt — one paragraph per line, blank line between.
"""
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "content" / "raw"
SOURCES = ROOT / "content" / "sources"


def fetch(gid: int) -> str:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"pg{gid}.txt"
    if not path.exists():
        url = f"https://www.gutenberg.org/cache/epub/{gid}/pg{gid}.txt"
        with urllib.request.urlopen(url, timeout=60) as r:
            path.write_bytes(r.read())
    return path.read_text(encoding="utf-8-sig")


def cut(text: str, start: str, end: str | None) -> list[str]:
    lines = text.splitlines()
    body_start = next(i for i, l in enumerate(lines) if l.startswith("*** START OF"))
    body_end = next(i for i, l in enumerate(lines) if l.startswith("*** END OF"))
    lines = lines[body_start + 1 : body_end]
    s = next(i for i, l in enumerate(lines) if l.strip() == start)
    e = len(lines)
    if end:
        e = next(i for i, l in enumerate(lines) if i > s and l.strip() == end)
    return lines[s + 1 : e]


def paragraphs(lines: list[str]) -> list[str]:
    paras, cur = [], []
    for l in lines:
        if not l.strip():
            if cur:
                paras.append(" ".join(cur))
                cur = []
            continue
        cur.append(l.strip())
    if cur:
        paras.append(" ".join(cur))
    out = []
    for p in paras:
        if re.fullmatch(r"\[Picture:[^\]]*\]", p) or re.fullmatch(r"[* ]+", p):
            continue
        if re.fullmatch(r"by [A-Z][\w. ]+", p):  # byline
            continue
        p = re.sub(r"\s{2,}", " ", p)
        p = re.sub(r"_([^_]+)_", r"\1", p)  # Gutenberg italics markers
        # small-caps opening word: "HIGH above" -> "High above"
        p = re.sub(r"^([A-Z])([A-Z]+)\b", lambda m: m.group(1) + m.group(2).lower(), p)
        out.append(p)
    return out


def main():
    slug, gid, start = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    end = sys.argv[4] if len(sys.argv) > 4 else None
    paras = paragraphs(cut(fetch(gid), start, end))
    SOURCES.mkdir(parents=True, exist_ok=True)
    (SOURCES / f"{slug}.txt").write_text("\n\n".join(paras) + "\n", encoding="utf-8")
    words = sum(len(p.split()) for p in paras)
    print(f"{slug}: {len(paras)} paragraphs, {words} words")


if __name__ == "__main__":
    main()
