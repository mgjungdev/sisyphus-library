"""Build site/data/*.json from content/.

  content/books.json               catalog (month, spine, cover)
  content/sources/<slug>.txt       story text, paragraphs separated by blank lines
  content/glossary/<slug>.json     curated vocabulary cards

A book is "ready" when it has both a source and a glossary; otherwise it is
shown as a planned (not yet openable) spine on its month's shelf.
Any glossary error stops the build.
"""
import calendar
import json
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
    out_paras = []
    for pi, p in enumerate(paras):
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

    words = sum(len(WORD.findall(p)) for p in paras)
    return {
        "slug": slug, "title": meta["title"], "author": meta["author"], "year": meta["year"],
        "words": words, "minutes": max(1, round(words / WPM)),
        "paragraphs": out_paras, "cards": cards,
        "order": [e["id"] for e in sorted(entries, key=lambda e: (e["para"], e["id"]))],
    }


def main():
    catalog = json.loads((CONTENT / "books.json").read_text(encoding="utf-8"))
    (OUT / "books").mkdir(parents=True, exist_ok=True)
    errors, shelves = [], {}
    for meta in catalog:
        slug = meta["slug"]
        ready = (CONTENT / "sources" / f"{slug}.txt").exists() and (CONTENT / "glossary" / f"{slug}.json").exists()
        info = {k: meta.get(k) for k in ("slug", "title", "author", "year", "spine", "cover")}
        info["status"] = "planned"
        if ready:
            errs = check(slug)
            if errs:
                errors += [f"{slug}: {e}" for e in errs]
                continue
            book = build_book(meta)
            (OUT / "books" / f"{slug}.json").write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            info.update(status="ready", words=book["words"], minutes=book["minutes"], entries=len(book["cards"]))
            print(f"  built {slug}: {book['words']} words, {len(book['cards'])} cards")
        shelves.setdefault(meta["month"], []).append(info)
    if errors:
        print("Build failed:")
        for e in errors:
            print("   ", e)
        sys.exit(1)
    out = []
    for month in sorted(shelves):
        y, m = map(int, month.split("-"))
        out.append({"month": month, "label": f"{calendar.month_name[m]} {y}", "books": shelves[month]})
    (OUT / "library.json").write_text(json.dumps({"shelves": out}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"  library.json: {len(out)} shelves, {sum(len(s['books']) for s in out)} books")


if __name__ == "__main__":
    main()
