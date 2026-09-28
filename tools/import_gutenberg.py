"""Download a Project Gutenberg text and cut one story out of it.

Usage:
    python tools/import_gutenberg.py <slug> <gutenberg_id> "<start heading>" ["<end heading>"]
        [--heading REGEX]   paragraphs fully matching REGEX become chapter headings ("## ...")
        [--raw PATH]        use a local plain-text file instead of downloading (gutenberg_id = 0)
        [--nth N]           use the Nth line equal to the start heading (e.g. 2 to skip a table of contents)

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


def cut(text: str, start: str, end: str | None, nth: int = 1) -> list[str]:
    lines = text.splitlines()
    body_start = next((i for i, l in enumerate(lines) if l.startswith("*** START OF")), -1)
    body_end = next((i for i, l in enumerate(lines) if l.startswith("*** END OF")), len(lines))
    lines = lines[body_start + 1 : body_end]
    s = [i for i, l in enumerate(lines) if l.strip() == start][nth - 1]
    e = len(lines)
    if end:
        e = next(i for i, l in enumerate(lines) if i > s and l.strip() == end)
    return lines[s + 1 : e]


def paragraphs(lines: list[str], heading: str | None = None) -> list[str]:
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
        if heading and re.fullmatch(heading, p.strip()):
            out.append("## " + p.strip().rstrip("."))
            continue
        p = p.replace("_", "")  # Gutenberg italics markers (can span paragraphs)
        p = re.sub(r"\s*--\s*", "—", p)  # plain-text dashes
        # small-caps opening word: "HIGH above" -> "High above"
        p = re.sub(r"^([A-Z])([A-Z]+)\b", lambda m: m.group(1) + m.group(2).lower(), p)
        out.append(p)
    return out


def main():
    args, opts = [], {}
    it = iter(sys.argv[1:])
    for a in it:
        if a in ("--heading", "--raw", "--nth"):
            opts[a] = next(it)
        else:
            args.append(a)
    slug, gid, start = args[0], int(args[1]), args[2]
    end = args[3] if len(args) > 3 else None
    text = Path(opts["--raw"]).read_text(encoding="utf-8-sig") if "--raw" in opts else fetch(gid)
    paras = paragraphs(cut(text, start, end, int(opts.get("--nth", 1))), opts.get("--heading"))
    SOURCES.mkdir(parents=True, exist_ok=True)
    (SOURCES / f"{slug}.txt").write_text("\n\n".join(paras) + "\n", encoding="utf-8")
    words = sum(len(p.split()) for p in paras if not p.startswith("## "))
    heads = [p[3:] for p in paras if p.startswith("## ")]
    print(f"{slug}: {len(paras)} paragraphs, {words} words" + (f", {len(heads)} chapters: {heads}" if heads else ""))


if __name__ == "__main__":
    main()
