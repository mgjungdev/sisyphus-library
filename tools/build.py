"""Build site/data/*.json from content/.

  content/books.json               catalog (month, spine, cover)
  content/sources/<slug>.txt       story text, paragraphs separated by blank lines
  content/graph/, content/contexts/ relations catalog -> site/data/graph.json (see tools/catalog.py)
  content/symbols/<work>.svg       each work's cover symbol (docs/symbols/PLAN.md) -> library.json "symbols"

A book is "ready" when it has a source and a "reviewed" date in books.json (set by
tools/pipeline.py mark-reviewed after the source text is checked); otherwise it is
shown as a planned (not yet openable) spine on its month's shelf.
Every word is emitted as [word, lemma] so the reader can look it up on tap.
"""
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from lemma import lemma  # noqa: E402
from text import load_paragraphs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
OUT = ROOT / "site" / "data"
WORD = re.compile(r"[A-Za-z]+(?:[’'\-][A-Za-z]+)*")
WPM = 180


def tokenize(text: str) -> list:
    out, pos = [], 0
    for m in WORD.finditer(text):
        if m.start() > pos:
            out.append(text[pos : m.start()])
        w = m.group(0)
        out.append([w, lemma(w)])
        pos = m.end()
    if pos < len(text):
        out.append(text[pos:])
    return out


def build_book(meta: dict, nxt: dict | None = None, folder: str = "sources", name: str | None = None) -> dict:
    slug = meta["slug"]
    paras = load_paragraphs(name or slug, folder)
    out_paras, chapters = [], []
    for pi, p in enumerate(paras):
        if p.startswith("## "):
            chapters.append({"title": p[3:].strip(), "para": pi + 1})
            out_paras.append([{"h": p[3:].strip()}])
        else:
            out_paras.append(tokenize(p))

    words = sum(len(WORD.findall(p)) for p in paras if not p.startswith("## "))
    return {
        "slug": slug, "title": meta["title"], "author": meta["author"], "year": meta["year"],
        "genre": meta.get("genre"), "level": meta.get("level"), "tags": meta.get("tags", []),
        **volume(meta), **({"next": nxt} if nxt else {}),
        "words": words, "minutes": max(1, round(words / WPM)),
        "chapters": chapters, "paragraphs": out_paras,
    }


def volume(meta: dict) -> dict:
    """series / vol / vols of one volume of a novel split into several books; {} for a single book."""
    return {k: meta[k] for k in ("series", "vol", "vols")} if meta.get("vol") else {}


def century(year: int) -> dict:
    if year < 500:
        return {"key": "0000", "label": "Antiquity", "sub": "The ancient world"}
    n = (year - 1) // 100 + 1
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    words = {9: "Ninth", 17: "Seventeenth", 18: "Eighteenth", 19: "Nineteenth", 20: "Twentieth"}
    return {"key": f"{(n - 1) * 100:04d}", "label": f"{(n - 1) * 100}s", "sub": f"{words.get(n, f'{n}{suffix}')} century"}


def thickness(words: int | None) -> int:
    return round(18 + 7 * math.log(1 + words / 1500)) if words else 22


SVG = re.compile(r'<svg[^>]*viewBox="([^"]+)"[^>]*>(.*)</svg>', re.S)


def load_symbols() -> dict:
    """content/symbols/<work>.svg -> {work: {"vb": viewBox, "body": inner markup}}; a work is a book's series, or its
    slug when it is one volume. The comment at the top of each file (what the symbol stands for) is outside <svg>."""
    out = {}
    for f in sorted((CONTENT / "symbols").glob("*.svg")):
        m = SVG.search(f.read_text(encoding="utf-8"))
        if not m:
            print(f"  symbol skipped (no <svg viewBox>): {f.name}")
            continue
        out[f.stem] = {"vb": m.group(1), "body": re.sub(r"\s*\n\s*", " ", m.group(2)).strip()}
    return out


ESSENTIAL = 10  # relations on the map that make a work essential reading


def main():
    catalog = json.loads((CONTENT / "books.json").read_text(encoding="utf-8"))
    (OUT / "books").mkdir(parents=True, exist_ok=True)
    out = []

    def is_ready(meta: dict) -> bool:
        slug = meta["slug"]
        return (CONTENT / "sources" / f"{slug}.txt").exists() and bool(meta.get("reviewed"))

    # Essential reading, bound in black on the shelves: the works most tied to others on the relations map (proposed
    # records counted). It must never stop the shelves from building.
    essential = set()
    try:
        import catalog as relations
        for n in relations.build(relations.load(), drafts=True)["nodes"]:
            if (n.get("degree") or 0) >= ESSENTIAL:
                essential.update(n.get("slugs") or [])
    except Exception as e:  # noqa: BLE001
        print(f"  essential skipped: {e!r}")

    # The volume that follows each volume, when it is ready: the reader links to it on the last page.
    vols = {(m["series"], m["vol"]): m for m in catalog if m.get("vol")}
    for meta in catalog:
        slug = meta["slug"]
        ready = is_ready(meta)
        info = {k: meta.get(k) for k in ("slug", "title", "author", "year", "genre", "tags", "level", "month", "plan", "cover")}
        info.update(volume(meta))
        info["century"] = century(meta["year"])
        info["status"] = "planned"
        words = None
        if ready:
            after = vols.get((meta.get("series"), (meta.get("vol") or 0) + 1))
            book = build_book(meta, {"slug": after["slug"], "vol": after["vol"]} if after and is_ready(after) else None)
            (OUT / "books" / f"{slug}.json").write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            words = book["words"]
            info.update(status="ready", words=words, minutes=book["minutes"], chapters=len(book["chapters"]))
            print(f"  built {slug}: {words} words")
        info["spine"] = {**meta["spine"], "thickness": thickness(words)}
        if slug in essential:
            info["essential"] = True
        out.append(info)
    genres = list(dict.fromkeys(b["genre"] for b in catalog))
    order = ["Fairy Tales & Fables", "Adventure", "Mystery & Detective", "Gothic & Horror", "Ghost Stories",
             "Science Fiction & Fantasy", "Love & Society", "Humor & Satire", "Realism & Character"]
    genres = [g for g in order if g in genres] + [g for g in genres if g not in order]
    symbols = load_symbols()
    (OUT / "library.json").write_text(json.dumps({"genres": genres, "books": out, "symbols": symbols}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  library.json: {len(out)} books, {sum(b['status'] == 'ready' for b in out)} ready")

    # The relations catalog: graph.json (admitted records only) for everyone, and graph.drafts.json
    # (proposed records too) for ?drafts=1. It must never stop the shelves from deploying.
    try:
        import catalog
        catalog.write(catalog.build_contexts(build_book), drafts=False)
        catalog.write(catalog.build_contexts(build_book, drafts=True), drafts=True)
    except Exception as e:  # noqa: BLE001
        print(f"  graph.json skipped: {e!r}")
    write_author_index(out)


def lede(intro: list) -> str:
    """The first sentence of an essay's opening, without its name and dates: 'English novelist, travel writer…'."""
    text = re.sub(r"<[^>]+>", "", intro[0] if intro else "")
    first = re.split(r"(?<=[.!?])\s+(?=[A-Z])", text.strip(), maxsplit=1)[0]
    m = re.match(r".*?\)(?:,[^.]*?)?\s+(?:was|is)\s+(?:an?\s+|the\s+)?(.*)", first)
    s = (m.group(1) if m else first).rstrip(".")
    return s[:1].upper() + s[1:]


def write_author_index(books: list):
    """site/data/authors.json: every author with an essay (site/data/authors/), for the authors page: the name, the
    dates, a line about them, and the slugs of their books on the shelves."""
    folder = OUT / "authors"
    if not folder.exists():
        return
    ready = [b for b in books if b["status"] == "ready"]
    out = []
    for p in sorted(folder.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        named = {re.sub(r"^#/read/", "", b["read"]) for b in d.get("books", [])}
        series = {b.get("series") for b in ready if b["slug"] in named} - {None}
        slugs = [b["slug"] for b in ready if b["slug"] in named or b.get("series") in series or b["author"] == d["name"]]
        out.append({"slug": d["slug"], "name": d["name"], "heading": d.get("heading"), "born": d.get("born"), "died": d.get("died"),
                    "lede": lede(d.get("intro") or []), "books": slugs})
    (OUT / "authors.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  authors.json: {len(out)} authors, {sum(bool(a['books']) for a in out)} with books on the shelves")


if __name__ == "__main__":
    main()
