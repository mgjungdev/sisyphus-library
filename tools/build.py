"""Build site/data/*.json from content/.

  content/books.json               catalog (month, spine, cover)
  content/sources/<slug>.txt       story text, paragraphs separated by blank lines
  content/graph/, content/contexts/ relations catalog -> site/data/graph.json (see tools/catalog.py)

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


def main():
    catalog = json.loads((CONTENT / "books.json").read_text(encoding="utf-8"))
    (OUT / "books").mkdir(parents=True, exist_ok=True)
    out = []

    def is_ready(meta: dict) -> bool:
        slug = meta["slug"]
        return (CONTENT / "sources" / f"{slug}.txt").exists() and bool(meta.get("reviewed"))

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
        out.append(info)
    genres = list(dict.fromkeys(b["genre"] for b in catalog))
    order = ["Fairy Tales & Fables", "Adventure", "Mystery & Detective", "Gothic & Horror", "Ghost Stories",
             "Science Fiction & Fantasy", "Love & Society", "Humor & Satire", "Realism & Character"]
    genres = [g for g in order if g in genres] + [g for g in genres if g not in order]
    (OUT / "library.json").write_text(json.dumps({"genres": genres, "books": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  library.json: {len(out)} books, {sum(b['status'] == 'ready' for b in out)} ready")

    # The relations catalog (admitted records only). It must never stop the shelves from deploying.
    try:
        import catalog
        catalog.write(catalog.build_contexts(build_book), drafts=False)
    except Exception as e:  # noqa: BLE001
        print(f"  graph.json skipped: {e!r}")


if __name__ == "__main__":
    main()
