"""Build site/data/*.json from content/.

  content/books.json               catalog (month, spine, cover)
  content/sources/<slug>.txt       story text, paragraphs separated by blank lines
  content/glossary/<slug>.json     curated vocabulary cards

A book is "ready" when it has both a source and a glossary; otherwise it is
shown as a planned (not yet openable) spine on its month's shelf.
Any glossary error stops the build.
"""
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_glossary import check, find_all, load_paragraphs  # noqa: E402
from lemma import lemma  # noqa: E402

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


def build_book(meta: dict) -> dict:
    slug = meta["slug"]
    paras = load_paragraphs(slug)
    gloss = json.loads((CONTENT / "glossary" / f"{slug}.json").read_text(encoding="utf-8"))
    entries = gloss["entries"]
    by_head = {e["headword"].lower(): e["id"] for e in entries}

    # spans[(para_index)] = list of (start, end, entry_id)
    spans: dict[int, list] = {i: [] for i in range(len(paras))}

    def free(pi, s, e):
        return all(e <= a or s >= b for a, b, _ in spans[pi])

    for e in entries:  # primary positions first
        pi = e["para"] - 1
        start = find_all(paras[pi], e["match"])[e.get("occurrence", 1) - 1]
        spans[pi].append((start, start + len(e["match"]), e["id"]))
    for e in entries:  # other occurrences
        if not e.get("all", True):
            continue
        for pi, p in enumerate(paras):
            for s in find_all(p, e["match"]):
                if free(pi, s, s + len(e["match"])):
                    spans[pi].append((s, s + len(e["match"]), e["id"]))

    heads = {e["id"]: e["headword"] for e in entries}
    out_paras, chapters = [], []
    for pi, p in enumerate(paras):
        if p.startswith("## "):
            chapters.append({"title": p[3:].strip(), "para": pi + 1})
            out_paras.append([{"h": p[3:].strip()}])
            continue
        items, pos = [], 0
        for s, t, eid in sorted(spans[pi]):
            items += tokenize(p[pos:s])
            items.append([p[s:t], heads[eid], eid])
            pos = t
        items += tokenize(p[pos:])
        out_paras.append(items)

    cards = {}
    for e in entries:
        card = {k: e.get(k) for k in ("headword", "pos", "ipa", "sense_en", "sense_ko", "modern", "tip_ko")}
        card["para"] = e["para"]
        card["synonyms"] = []
        for s in e["synonyms"]:
            s = dict(s)
            ref = by_head.get(s["word"].lower())
            if ref and ref != e["id"]:
                s["ref"] = ref
            card["synonyms"].append(s)
        cards[e["id"]] = {k: v for k, v in card.items() if v not in (None, "")}

    words = sum(len(WORD.findall(p)) for p in paras if not p.startswith("## "))
    return {
        "slug": slug, "title": meta["title"], "author": meta["author"], "year": meta["year"],
        "genre": meta.get("genre"), "level": meta.get("level"), "tags": meta.get("tags", []),
        "words": words, "minutes": max(1, round(words / WPM)),
        "chapters": chapters, "paragraphs": out_paras, "cards": cards,
        "order": [e["id"] for e in sorted(entries, key=lambda e: (e["para"], e["id"]))],
    }


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
    errors, out = [], []
    for meta in catalog:
        slug = meta["slug"]
        ready = (CONTENT / "sources" / f"{slug}.txt").exists() and (CONTENT / "glossary" / f"{slug}.json").exists()
        info = {k: meta.get(k) for k in ("slug", "title", "author", "year", "genre", "tags", "level", "month", "plan", "cover")}
        info["century"] = century(meta["year"])
        info["status"] = "planned"
        words = None
        if ready:
            errs = check(slug)
            if errs:
                errors += [f"{slug}: {e}" for e in errs]
                continue
            book = build_book(meta)
            (OUT / "books" / f"{slug}.json").write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            words = book["words"]
            info.update(status="ready", words=words, minutes=book["minutes"], entries=len(book["cards"]), chapters=len(book["chapters"]))
            print(f"  built {slug}: {words} words, {len(book['cards'])} cards")
        info["spine"] = {**meta["spine"], "thickness": thickness(words)}
        out.append(info)
    if errors:
        print("Build failed:")
        for e in errors:
            print("   ", e)
        sys.exit(1)
    genres = list(dict.fromkeys(b["genre"] for b in catalog))
    order = ["Fairy Tales & Fables", "Adventure", "Mystery & Detective", "Gothic & Horror", "Ghost Stories",
             "Science Fiction & Fantasy", "Love & Society", "Humor & Satire", "Realism & Character"]
    genres = [g for g in order if g in genres] + [g for g in genres if g not in order]
    (OUT / "library.json").write_text(json.dumps({"genres": genres, "books": out}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  library.json: {len(out)} books, {sum(b['status'] == 'ready' for b in out)} ready")


if __name__ == "__main__":
    main()
