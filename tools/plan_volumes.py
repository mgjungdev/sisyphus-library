"""Plan catalog rows for long works: split each novel into volumes at chapter boundaries.

Usage:
  python tools/plan_volumes.py detect <works.json> [slug…]   guess each work's chapter heading, first line, TOC skip
  python tools/plan_volumes.py plan <works.json> [--write]    split into volumes; --write appends the rows to books.json

works.json: a list of works in shelf order, each
  {"slug", "title", "author", "year", "genre", "level", "tags", "gutenberg",
   "heading": "<regex a chapter heading paragraph fully matches>", "first": "<exact line of the first chapter>",
   "nth": 1, "end": "<exact line after the story (first one after the start), or null>",
   "drop"?: "<regex of paragraphs to leave out>", "motif"?, "color"?, "accent"?, "height"?}

A work of up to MAX_ONE words stays one book. A longer one becomes n = ceil(words / TARGET) volumes
("<slug>-1" …, with "series", "vol", "vols"), cut at the chapter starts nearest to equal parts. Each row gets a
"source" ({"from", "nth", "to", "to_nth", "heading"}) that tools/import_gutenberg.py replays with --keep-start; every cut is
replayed here and must give exactly the planned paragraphs. Shelf months continue after the catalog's last
month: about four spines a month, never splitting a work across months.
"""
import hashlib
import json
import math
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from import_gutenberg import cut, fetch, paragraphs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
BOOKS = ROOT / "content" / "books.json"
TARGET, MAX_ONE, MIN_VOL, MAX_VOL = 40000, 43000, 20000, 42000
PER_MONTH, MAX_MONTH = 4, 6
MOTIF = {"Fairy Tales & Fables": "crown", "Love & Society": "rose", "Adventure": "compass",
         "Mystery & Detective": "key", "Realism & Character": "quill", "Gothic & Horror": "raven",
         "Ghost Stories": "lamp", "Science Fiction & Fantasy": "planet", "Humor & Satire": "mask"}
HEADINGS = [r"(CHAPTER|Chapter) [IVXLC\d]+\b.*", r"(CHAPTER|Chapter) [A-Z][a-z]*(-[A-Za-z]+)?\b.*",
            r"[IVXLC]+\.?( .*)?", r"\d+\.?( .*)?"]


def body(text: str) -> list[str]:
    lines = text.splitlines()
    s = next((i for i, l in enumerate(lines) if l.startswith("*** START OF")), -1)
    e = next((i for i, l in enumerate(lines) if l.startswith("*** END OF")), len(lines))
    return lines[s + 1: e]


def blocks(lines: list[str]) -> list[tuple[int, str]]:
    """(first line index, text) of each paragraph, joined the way import_gutenberg.paragraphs joins it."""
    out, cur, at = [], [], 0
    for i, l in enumerate(lines + [""]):
        if l.strip():
            if not cur:
                at = i
            cur.append(l.strip())
        elif cur:
            out.append((at, re.sub(r"\s{2,}", " ", " ".join(cur)).strip()))
            cur = []
    return out


def detect(w: dict) -> dict:
    lines = body(fetch(w["gutenberg"]))
    heads = [(i, t) for i, t in blocks(lines) if len(t) < 120]
    best = None
    for h in HEADINGS:
        hits = [(i, t) for i, t in heads if re.fullmatch(h, t)]
        if len(hits) >= 3 and (not best or len(hits) > len(best[1])):
            best = (h, hits)
    if not best:
        return {"slug": w["slug"], "error": "no chapter heading pattern"}
    h, hits = best
    first = lines[hits[0][0]].strip()
    # A table of contents lists the headings once before the text: start at the last copy of the first heading.
    nth = sum(lines[i].strip() == first for i, _ in hits)
    return {"slug": w["slug"], "heading": h, "first": first, "nth": nth, "chapters": len(hits) // nth,
            "last": hits[-1][1][:60]}


def chapters(w: dict) -> tuple[list[str], list[tuple[int, str, int]]]:
    """The work's paragraphs and its chapter starts: (paragraph index, exact first source line, nth of that line)."""
    text = fetch(w["gutenberg"])
    lines = body(text)
    paras = paragraphs(cut(text, w["first"], w.get("end"), w.get("nth", 1), True), w["heading"], w.get("drop"))
    start = [i for i, l in enumerate(lines) if l.strip() == w["first"]][w.get("nth", 1) - 1]
    stop = len(lines)
    if w.get("end"):
        stop = next(i for i, l in enumerate(lines) if i > start and l.strip() == w["end"])
    heads = [(i, t) for i, t in blocks(lines) if start <= i < stop and re.fullmatch(w["heading"], t)]
    idx = [i for i, p in enumerate(paras) if p.startswith("## ")]
    if len(idx) != len(heads):
        raise ValueError(f"{len(idx)} heading paragraphs but {len(heads)} heading blocks")
    starts = []
    for pi, (li, _) in zip(idx, heads):
        line = lines[li].strip()
        starts.append((pi, line, sum(1 for l in lines[:li + 1] if l.strip() == line)))
    return paras, starts


def words(paras: list[str]) -> int:
    return sum(len(p.split()) for p in paras if not p.startswith("## "))


def split(w: dict) -> list[dict]:
    """Volumes of one work: [{"from", "nth", "to", "paras"}], replay-checked."""
    paras, starts = chapters(w)
    total = words(paras)
    n = 1 if total <= MAX_ONE else math.ceil(total / TARGET)
    cum, acc = [], 0
    for k, (pi, _, _) in enumerate(starts):
        cum.append(acc)
        nxt = starts[k + 1][0] if k + 1 < len(starts) else len(paras)
        acc += words(paras[pi:nxt])
    while True:
        cuts = [0]
        for k in range(1, n):
            target = total * k / n
            cuts.append(min(range(cuts[-1] + 1, len(starts)), key=lambda c: abs(cum[c] - target)))
        sizes = [(cum[cuts[k + 1]] if k + 1 < len(cuts) else total) - cum[c] for k, c in enumerate(cuts)]
        # Chapters are coarse: when a volume overshoots, one more volume usually fits them all.
        if n == 1 or max(sizes) <= MAX_VOL or total / (n + 1) < MIN_VOL or n + 1 > len(starts):
            break
        n += 1
    vols = []
    for k, c in enumerate(cuts):
        pi, line, nth = starts[c]
        end_pi = starts[cuts[k + 1]][0] if k + 1 < len(cuts) else len(paras)
        to, to_nth = (starts[cuts[k + 1]][1], starts[cuts[k + 1]][2]) if k + 1 < len(cuts) else (w.get("end"), None)
        if k == 0:
            line, nth, pi = w["first"], w.get("nth", 1), 0
        want = paras[pi:end_pi]
        got = paragraphs(cut(fetch(w["gutenberg"]), line, to, nth, True, to_nth), w["heading"], w.get("drop"))
        vols.append({"from": line, "nth": nth, "to": to, "to_nth": to_nth, "words": words(want), "ok": got == want,
                     "first": want[0][:50], "last": want[-1][:50]})
    return vols


def palette() -> dict[str, list[tuple[str, str]]]:
    by: dict[str, list[tuple[str, str]]] = {}
    for b in json.loads(BOOKS.read_text(encoding="utf-8")):
        pair = (b["spine"]["color"], b["cover"]["accent"])
        if pair not in by.setdefault(b["genre"], []):
            by[b["genre"]].append(pair)
    return by


def rows(works: list[dict], plans: dict[str, list[dict]]) -> list[dict]:
    catalog = json.loads(BOOKS.read_text(encoding="utf-8"))
    y, m = map(int, max(b["month"] for b in catalog).split("-"))
    plan = max(b["plan"] for b in catalog)
    pal, used = palette(), {}
    out, in_month = [], PER_MONTH
    for w in works:
        vols = plans[w["slug"]]
        if in_month >= PER_MONTH or in_month + len(vols) > MAX_MONTH:
            m += 1
            y, m = (y + 1, 1) if m > 12 else (y, m)
            in_month = 0
        in_month += len(vols)
        h = int(hashlib.md5(w["slug"].encode()).hexdigest(), 16)
        choices = pal.get(w["genre"]) or [("#4a3d31", "#d8c08a")]
        k = used.get(w["genre"], h % len(choices))
        used[w["genre"]] = k + 1
        color, accent = choices[k % len(choices)]
        base = {"title": w["title"], "author": w["author"], "year": w["year"], "genre": w["genre"],
                "level": w["level"], "tags": w["tags"],
                "spine": {"color": w.get("color", color), "height": w.get("height", round(0.84 + (h % 13) / 100, 2))},
                "cover": {"motif": w.get("motif", MOTIF.get(w["genre"], "leaf")), "accent": w.get("accent", accent)},
                "month": f"{y:04d}-{m:02d}", "gutenberg": w["gutenberg"]}
        for n, v in enumerate(vols, 1):
            plan += 1
            src = {"from": v["from"], "nth": v["nth"], "to": v["to"], "heading": w["heading"]}
            if v["to_nth"]:
                src["to_nth"] = v["to_nth"]
            if w.get("drop"):
                src["drop"] = w["drop"]
            if len(vols) == 1:
                out.append({"slug": w["slug"], **base, "plan": plan, "source": src})
            else:
                out.append({"slug": f"{w['slug']}-{n}", **base, "plan": plan,
                            "series": w["slug"], "vol": n, "vols": len(vols), "source": src})
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cmd, path, rest = sys.argv[1], Path(sys.argv[2]), sys.argv[3:]
    works = json.loads(path.read_text(encoding="utf-8"))
    # Per-work settings (heading, first, nth, end) found by hand live in cfg-*.json next to the list.
    cfg = {}
    for f in sorted(path.parent.glob("cfg-*.json")):
        cfg.update(json.loads(f.read_text(encoding="utf-8")))
    works = [{**w, **cfg.get(w["slug"], {})} for w in works]
    only = [a for a in rest if not a.startswith("--")]
    if cmd == "detect":
        for w in works:
            if not only or w["slug"] in only:
                print(json.dumps(detect(w), ensure_ascii=False))
        return
    plans, bad = {}, 0
    for w in works:
        if only and w["slug"] not in only:
            continue
        try:
            plans[w["slug"]] = vols = split(w)
        except Exception as e:  # noqa: BLE001 — report every work, fix the list, run again
            print(f"{w['slug']}: ERROR {e}")
            bad += 1
            continue
        flag = lambda v: "" if v["ok"] and (len(vols) == 1 or MIN_VOL <= v["words"] <= MAX_VOL) else "  <-- CHECK"
        print(f"{w['slug']}: {sum(v['words'] for v in vols)} words, {len(vols)} vol")
        for v in vols:
            print(f"   {v['words']:>6}  from {v['from']!r} (#{v['nth']}) to {v['to']!r}{flag(v)}")
            print(f"           first: {v['first']!r}  last: {v['last']!r}")
        bad += any(flag(v) for v in vols)
    if "--write" in rest:
        if bad or only:
            sys.exit(f"not written: {bad} works need a look" if bad else "not written: run --write on the whole list")
        catalog = json.loads(BOOKS.read_text(encoding="utf-8"))
        new = rows(works, plans)
        BOOKS.write_text(json.dumps(catalog + new, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"added {len(new)} books ({len(works)} works), shelves {new[0]['month']} – {new[-1]['month']}")


if __name__ == "__main__":
    main()
