"""Shared helpers for reading content/sources/<slug>.txt."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_paragraphs(slug: str) -> list[str]:
    text = (ROOT / "content" / "sources" / f"{slug}.txt").read_text(encoding="utf-8")
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def find_all(para: str, match: str) -> list[int]:
    pat = re.compile(r"(?<![\w’'])" + re.escape(match) + r"(?![\w’'])", re.IGNORECASE)
    return [m.start() for m in pat.finditer(para)]


def source_problems(slug: str) -> list[str]:
    """What is plainly wrong with an imported source: missing, empty, or carrying Gutenberg boilerplate."""
    path = ROOT / "content" / "sources" / f"{slug}.txt"
    if not path.exists():
        return ["no source text"]
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return ["source text is empty"]
    if re.search(r"project gutenberg|\*\*\*\s*(start|end) of", text, re.IGNORECASE):
        return ["source text still carries Project Gutenberg boilerplate"]
    return []
