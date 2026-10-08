"""The relations catalog: content/graph/ checked as tables and built into site/data/graph.json.

  content/graph/vocab.json        enums and labels (note types, roles, evidence axes, limits)
  content/graph/sources.jsonl     sources evidence cites (src:pg-* and src:lcnaf-* are generated, ctx:<id> = content/contexts/<id>.txt)
  content/graph/nodes.jsonl       person, subject heading, work, text (expression), edition (manifestation)
  content/graph/glosses.jsonl     notes on passages; a gloss whose target is a library work yields a `refers` note
  content/graph/edges.jsonl       index (work -> heading), context (paratext work -> work), note (work -> work)
  content/graph/readings.jsonl    interpretations of notes: claim, alignments, question
  content/graph/dossiers/*.json   per-work Norton-style arrangement of contexts and glosses
  content/graph/authority.json    cached LC Name Authority labels (written by `authority`)
  content/graph/collate.json      copy-text verdicts (written by `collate`)
  content/authors/<slug>.md       an essay on each author of ready books -> site/data/authors/<slug>.json (see parse_author)

A locator is {source, exact, prefix?, suffix?}: `exact` is the anchor, the paragraph is found, never stored.
Evidence is {src, for?, quote?, at?, status?}. Its status is computed: a quote found in the source is
"machine"; a stored "human" or "cited-unseen" is kept; anything else is "unverified".

Usage:
    python tools/catalog.py check               load into SQLite, enforce keys and rules (exit 1 on errors)
    python tools/catalog.py build [--drafts]    site/data/graph.json (admitted only), or graph.drafts.json (everything);
                                                every ready book is a work node there, linked to its author node
    python tools/catalog.py authority           fetch LC Name Authority labels for every person
    python tools/catalog.py collate <work>      decide which text (expression) our copy is, from two Gutenberg editions
    python tools/catalog.py substitute <reading> print the substitution-test prompt for one reading
    … --stage <code>                            any command, on the graph as data step <code> sees it in serial order,
                                                with its stage folder content/graph/stage/<code>/ laid over it;
                                                authority and collate then write there (tools/graph_stage.py)
"""
import html
import json
import re
import sqlite3
import sys
import unicodedata
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from text import load_paragraphs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
GRAPH = CONTENT / "graph"
RAW = CONTENT / "raw"
OUT = ROOT / "site" / "data"
UA = "SisyphusLibrary/1.0 (study library)"
OK = ("machine", "human")
STAGE = None  # a data step's code (--stage): load() gives the graph as that step sees it, caches are written to its stage


# ---------------- loading ----------------

def jsonl(name: str) -> list[dict]:
    path = GRAPH / name
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()]


def cache_dir() -> Path:
    if not STAGE:
        return GRAPH
    d = GRAPH / "stage" / STAGE
    d.mkdir(parents=True, exist_ok=True)
    return d


def jfile(name: str, default=None):
    path = GRAPH / name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else default


def load() -> dict:
    g = {
        "vocab": jfile("vocab.json", {}),
        "sources": {s["id"]: s for s in jsonl("sources.jsonl")},
        "nodes": jsonl("nodes.jsonl"),
        "glosses": jsonl("glosses.jsonl"),
        "edges": jsonl("edges.jsonl"),
        "readings": jsonl("readings.jsonl"),
        "dossiers": [json.loads(p.read_text(encoding="utf-8")) for p in sorted((GRAPH / "dossiers").glob("*.json"))],
        "authority": jfile("authority.json", {}),
        "collate": jfile("collate.json", {}),
        "authors": {p.stem: parse_author(p) for p in sorted((CONTENT / "authors").glob("*.md"))},
        "books": json.loads((CONTENT / "books.json").read_text(encoding="utf-8")),
        "hidden": set(),
    }
    if STAGE:
        import graph_stage
        graph_stage.apply_view(g, STAGE)
    # Generated sources: every Gutenberg id in the catalog or in a text's items, every person's LC record.
    pgs = {b["gutenberg"] for b in g["books"] if b.get("gutenberg")}
    pgs |= {it["pg"] for n in g["nodes"] if n.get("kind") == "text" for it in n.get("items", []) if it.get("pg")}
    for gid in sorted(pgs):
        g["sources"].setdefault(f"src:pg-{gid}", {
            "id": f"src:pg-{gid}", "nature": "primary", "access": "transcription",
            "title": f"Project Gutenberg #{gid}", "url": f"https://www.gutenberg.org/ebooks/{gid}", "raw": f"pg{gid}.txt"})
        g["sources"][f"src:pg-{gid}"].setdefault("raw", f"pg{gid}.txt")
    for n in g["nodes"]:
        if n.get("kind") == "person" and n.get("lccn"):
            g["sources"][f"src:lcnaf-{n['lccn']}"] = {
                "id": f"src:lcnaf-{n['lccn']}", "nature": "secondary", "access": "database",
                "title": f"LC Name Authority File {n['lccn']}", "url": f"https://id.loc.gov/authorities/names/{n['lccn']}"}
    for p in sorted((CONTENT / "contexts").glob("*.txt")):
        g["sources"][f"ctx:{p.stem}"] = {"id": f"ctx:{p.stem}", "nature": "primary", "access": "transcription",
                                         "title": p.stem, "local": f"contexts/{p.name}"}
    return g


# ---------------- author essays ----------------
# content/authors/<slug>.md: front matter (name = LC heading, display, born, died, person, lccn), a first paragraph
# (who the author is; the author panel shows it), then '## Life', '## Writing', '## In this library' (one item per
# book: `- [Title](work key or book slug) — a sentence or two`) and '## Sources' (`- [Title](url) — what it is`).
# Prose may hold *italics* and [text](https://…) links.
AUTHOR_SECTIONS = {"life": (400, 700), "writing": (200, 400)}
# An anonymous collection credited as its own author (kind: collection) has no dates and no Life.
COLLECTION_SECTIONS = {"history": (400, 700), "tales": (200, 400)}
# A sentence ends at . ! ? (and a closing quote) before a capital or the end, not after an initial (H. G.) or Mr/Dr/St.
SENTENCE_END = re.compile(r"(?<!\b[A-Z])(?<!\bMr)(?<!\bDr)(?<!\bSt)[.!?][\"')”]?(?=\s+[\"'“]?[A-Z]|\s*\Z)")
_BOOK_ITEM = re.compile(r"\A\[(.+?)\]\(([^)\s]+)\)\s*(?:[—–:-]+\s*)?(.*)\Z", re.S)


def parse_author(path: Path) -> dict:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    m = re.match(r"\A---\n(.*?)\n---\n", text, re.S)
    doc = {"slug": path.stem}
    for line in (m.group(1).splitlines() if m else []):
        k, _, v = line.partition(":")
        if k.strip():
            doc[k.strip()] = v.strip().strip('"')
    body = text[m.end():] if m else text
    chunks = re.split(r"^## +(.+?)[ \t]*$", body, flags=re.M)
    paras = lambda s: [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", s) if p.strip()]
    items = lambda s: [re.sub(r"\s+", " ", x).strip() for x in re.split(r"^[ \t]*[-*][ \t]+", s, flags=re.M)[1:] if x.strip()]
    doc.update(intro=paras(chunks[0]), sections=[], books=None, sources=None)
    for title, s in zip(chunks[1::2], chunks[2::2]):
        key = title.strip().lower()
        if key == "in this library":
            doc["books"] = []
            for it in items(s):
                b = _BOOK_ITEM.match(it)
                doc["books"].append({"title": b.group(1), "key": b.group(2), "text": b.group(3)} if b else {"bad": it})
        elif key == "sources":
            doc["sources"] = items(s)
        else:
            doc["sections"].append({"title": title.strip(), "paras": paras(s)})
    return doc


def inline_html(s: str) -> str:
    """Escaped text with *italics*, [text](https://…) and <https://…> as HTML; straight quotes made curly."""
    s = curly(s)
    s = html.escape(s, quote=False)
    s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", lambda m: f'<a href="{m.group(2)}" rel="noopener">{m.group(1)}</a>', s)
    s = re.sub(r"&lt;(https?://[^\s&]+)&gt;", r'<a href="\1" rel="noopener">\1</a>', s)
    return re.sub(r"(?<![\w*])\*([^*\n]+?)\*(?![\w*])", r"<i>\1</i>", s)


def curly(s: str) -> str:
    """Typewriter quotes to printer's quotes, outside link targets: an opening one after a space, dash or bracket."""
    parts = re.split(r"(\]\([^)\s]+\)|<https?://[^>\s]+>)", s)
    for i in range(0, len(parts), 2):
        t = re.sub(r'(^|[\s(\[—–*])"', "\\1\u201c", parts[i])
        t = re.sub(r"(^|[\s(\[—–*])'", "\\1\u2018", t.replace('"', "\u201d"))
        parts[i] = t.replace("'", "\u2019")
    return "".join(parts)


def inline_text(s: str) -> str:
    s = curly(s)
    s = re.sub(r"\[([^\]]+)\]\([^)\s]+\)", r"\1", s)
    return re.sub(r"(?<![\w*])\*([^*\n]+?)\*(?![\w*])", r"\1", s)


def library_authors(g: dict) -> dict:
    """slug -> {byline, person, works} for every author of ready books, as the build names them."""
    registered = slug_to_work(g)
    by_line = defaultdict(list)
    for b in g["books"]:
        if is_ready(b):
            by_line[b["author"]].append(b)
    out = {}
    for byline, bs in by_line.items():
        pid, slug = author_ref(g, byline, [b["slug"] for b in bs])
        out[slug] = {"byline": byline, "person": pid, "works": {book_work_id(b, registered) for b in bs},
                     "slugs": [b["slug"] for b in bs]}
    return out


def doc_work(key: str, works: set, slugs_of: dict) -> str | None:
    """The work an 'In this library' item names: a work key (work:<key>) or one of its books' slugs."""
    if f"work:{key}" in works:
        return f"work:{key}"
    return slugs_of.get(key)


def check_authors(g: dict, r: "Report", nodes: dict):
    authors = library_authors(g)
    registered = slug_to_work(g)
    slugs_of = {b["slug"]: book_work_id(b, registered) for b in g["books"] if is_ready(b)}
    for slug, a in sorted(authors.items()):
        if slug not in g["authors"]:
            r.err(f"author {slug}", f"no essay content/authors/{slug}.md ({a['byline']})")
    for slug, d in g["authors"].items():
        where = f"content/authors/{slug}.md"
        a = authors.get(slug)
        if not a:
            r.err(where, "no ready book by this author (the file name must be the author's slug)")
            continue
        collection = d.get("kind") == "collection"
        for f in ("name", "display") if collection else ("name", "display", "born", "died"):
            if not d.get(f):
                r.err(where, f"front matter has no {f}")
        if collection and (d.get("born") or d.get("died")):
            r.err(where, "a collection has no born/died")
        p = nodes.get(a["person"]) if a["person"] else None
        if d.get("person") in g["hidden"]:
            continue  # its record comes from a step after this one in serial order
        if p:
            if d.get("person") != p["id"]:
                r.err(where, f"person {d.get('person')!r} is not the author's record {p['id']}")
            for f in ("name", "born", "died", "lccn"):
                if str(d.get(f, "")) != str(p.get(f, "")):
                    r.err(where, f"{f} {d.get(f)!r} differs from {p['id']} {p.get(f)!r}")
        else:
            if d.get("person"):
                r.err(where, f"person {d['person']} is not this author's record")
            label = g["authority"].get(d.get("lccn", ""))
            if not d.get("lccn"):
                r.warn(where, "no person record and no lccn: dates not checked against an authority")
            elif not label:
                r.warn(where, "no LC authority label cached (run: python tools/catalog.py authority)")
            # LC marks an uncertain year with "?" (Defoe, Daniel, 1661?-1731)
            elif not collection and not re.search(rf"\b{re.escape(str(d.get('born')))}\??-{re.escape(str(d.get('died')))}\b", label):
                r.err(where, f"dates {d.get('born')}-{d.get('died')} do not match LC authority {label!r}")
        if any(re.search(r"[\x00-\x08\x0b-\x1f]", str(v)) for v in d.values()):
            r.err(where, "control character in the text")
        if not d["intro"]:
            r.err(where, "no first paragraph")
        else:
            n = len(SENTENCE_END.findall(inline_text(d["intro"][0])))
            if not 2 <= n <= 3:
                r.warn(where, f"first paragraph has {n} sentences (2-3)")
        have = {s["title"].lower(): s for s in d["sections"]}
        for name, (lo, hi) in (COLLECTION_SECTIONS if collection else AUTHOR_SECTIONS).items():
            s = have.get(name)
            if not s:
                r.err(where, f"no '## {name.title()}' section")
                continue
            words = sum(len(inline_text(p).split()) for p in s["paras"])
            if not lo <= words <= hi:
                r.warn(where, f"{name.title()} has {words} words ({lo}-{hi})")
        if not any(re.search(r"https?://", s) for s in d["sources"] or []):
            r.err(where, "Sources lists no source with a URL")
        if d["books"] is None:
            r.err(where, "no '## In this library' section")
            continue
        listed = set()
        for b in d["books"]:
            if "bad" in b:
                r.err(where, f"In this library: item is not '[Title](key) — text': {b['bad'][:50]!r}")
                continue
            wid = doc_work(b["key"], a["works"], slugs_of)
            if not wid or wid not in a["works"]:
                r.err(where, f"In this library: {b['key']!r} is not a ready book by {a['byline']}")
            elif wid in listed:
                r.err(where, f"In this library: {b['key']!r} listed twice")
            else:
                listed.add(wid)
        for wid in sorted(a["works"] - listed):
            r.warn(where, f"In this library: ready book {wid} is not listed")


def write_authors(g: dict, data: dict):
    """site/data/authors/<slug>.json for each essay whose author is in the graph."""
    out = OUT / "authors"
    out.mkdir(parents=True, exist_ok=True)
    nodes = {n["id"]: n for n in data["nodes"]}
    people = {n["slug"]: n for n in data["nodes"] if n.get("kind") == "person" and n.get("works")}
    registered = slug_to_work(g)
    slugs_of = {b["slug"]: book_work_id(b, registered) for b in g["books"] if is_ready(b)}
    for p in out.glob("*.json"):
        if p.stem not in g["authors"]:
            p.unlink()
    for slug, d in g["authors"].items():
        a = people.get(slug)
        if not a:
            continue
        books = []
        for b in d["books"] or []:
            w = nodes.get(doc_work(b.get("key", ""), set(a["works"]), slugs_of) or "")
            if not w or "bad" in b:
                continue
            books.append({"title": curly(b["title"]), "year": w.get("year"), "html": inline_html(b["text"]),
                          "read": f"#/read/{w['slugs'][0]}", "graph": f"#/graph/{w['slugs'][0]}"})
        doc = {
            "slug": slug, "name": d.get("display") or a.get("byline"), "heading": d.get("name"),
            "born": d.get("born"), "died": d.get("died"), "lccn": d.get("lccn"),
            "graph": f"#/graph/{slug}",
            "intro": [inline_html(x) for x in d["intro"]],
            "sections": [{"title": s["title"], "paras": [inline_html(x) for x in s["paras"]]} for s in d["sections"]],
            "books": books, "sources": [inline_html(x) for x in d["sources"] or []],
        }
        (out / f"{slug}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  authors: {sum(s in people for s in g['authors'])} essays")


# ---------------- text anchoring ----------------

def norm(s: str, strip: bool = True) -> str:
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = re.sub(r"\s+", " ", s)
    return s.strip() if strip else s


_paras: dict[str, list[str]] = {}


def paras_of(source: str) -> list[str] | None:
    """Paragraphs of a library slug or of ctx:<id>; None when the file does not exist."""
    if source not in _paras:
        folder, name = ("contexts", source[4:]) if source.startswith("ctx:") else ("sources", source)
        try:
            _paras[source] = [norm(p) for p in load_paragraphs(name, folder)]
        except FileNotFoundError:
            _paras[source] = None
    return _paras[source]


def anchor(loc: dict) -> list[int]:
    """1-based paragraph numbers where the locator's exact text (with its prefix/suffix) occurs."""
    paras = paras_of(loc["source"])
    if paras is None:
        return []
    exact, pre, suf = norm(loc["exact"]), norm(loc.get("prefix", ""), False), norm(loc.get("suffix", ""), False)
    hits = []
    for i, p in enumerate(paras):
        start = p.find(exact)
        while start != -1:
            if p[:start].endswith(pre) and p[start + len(exact):].startswith(suf):
                hits.append(i + 1)
            start = p.find(exact, start + 1)
    return hits


_texts: dict[str, str | None] = {}


def source_text(src: dict) -> str | None:
    key = src["id"]
    if key not in _texts:
        path = RAW / src["raw"] if src.get("raw") else CONTENT / src["local"] if src.get("local") else None
        _texts[key] = norm(path.read_text(encoding="utf-8-sig")) if path and path.exists() else None
    return _texts[key]


def ev_status(ev: dict, g: dict) -> str:
    if ev.get("status") in ("human", "cited-unseen"):
        return ev["status"]
    src = g["sources"].get(ev["src"])
    if src and ev.get("quote"):
        text = source_text(src)
        if text is not None and norm(ev["quote"]) in text:
            return "machine"
    return "unverified"


# ---------------- checking ----------------

class Report:
    def __init__(self):
        self.errors, self.warnings = [], []

    def err(self, where, msg):
        self.errors.append(f"{where}: {msg}")

    def warn(self, where, msg):
        self.warnings.append(f"{where}: {msg}")


def year_of(work: dict) -> int | None:
    w = work.get("written")
    if w:
        return int(str(w)[:4])
    return (work.get("first_pub") or {}).get("year")


def computed_notes(g: dict) -> list[dict]:
    """refers notes, one per (work, target), from glosses on that work's texts."""
    slug_work = slug_to_work(g)
    out = {}
    for gl in g["glosses"]:
        tgt = gl.get("target")
        frm = slug_work.get(gl["loc"]["source"])
        if not tgt or not frm or tgt == frm:
            continue
        key = (frm, tgt)
        n = out.setdefault(key, {"type": "note", "from": frm, "to": tgt, "rel": "refers", "modes": [], "glosses": [],
                                 "status": "admitted", "computed": True})
        n["glosses"].append(gl["id"])
        if gl.get("mode") and gl["mode"] not in n["modes"]:
            n["modes"].append(gl["mode"])
        if gl.get("status") != "admitted":
            n["status"] = "proposed"
    return list(out.values())


def slug_to_work(g: dict) -> dict:
    m = {}
    for n in g["nodes"]:
        if n.get("kind") == "text":
            for it in n.get("items", []):
                for s in it.get("slugs", []):
                    m[s] = n["work"]
    return m


def contact(note: dict, notes: list[dict]) -> str:
    pair = (note["from"], note["to"])
    if any(n["rel"] == "refers" and (n["from"], n["to"]) == pair for n in notes):
        return "documented"
    if any(n["rel"] == "read" and (n["from"], n["to"]) == pair for n in notes):
        return "probable"
    return "none"


REQUIRED = {"work": ["title", "author", "first_pub"], "person": ["name", "born", "died"],
            "text": ["label"], "edition": ["year"]}


def check(g: dict) -> Report:
    r = Report()
    v = g["vocab"]
    db = sqlite3.connect(":memory:")
    db.executescript("""
      PRAGMA foreign_keys = ON;
      CREATE TABLE nodes (id TEXT PRIMARY KEY, kind TEXT NOT NULL);
      CREATE TABLE sources (id TEXT PRIMARY KEY);
      CREATE TABLE notes (src TEXT NOT NULL REFERENCES nodes(id), dst TEXT NOT NULL REFERENCES nodes(id),
                          rel TEXT NOT NULL, PRIMARY KEY (src, dst, rel));
      CREATE TABLE readings (id TEXT PRIMARY KEY, src TEXT, dst TEXT, rel TEXT,
                             FOREIGN KEY (src, dst, rel) REFERENCES notes(src, dst, rel));
      CREATE TABLE alignments (reading TEXT REFERENCES readings(id), seq INTEGER, PRIMARY KEY (reading, seq));
      CREATE TABLE broader (child TEXT REFERENCES nodes(id), parent TEXT REFERENCES nodes(id), PRIMARY KEY (child, parent));
    """)

    def insert(sql, args, where):
        try:
            db.execute(sql, args)
        except sqlite3.IntegrityError as e:
            r.err(where, str(e).replace("UNIQUE constraint failed", "duplicate").replace("FOREIGN KEY constraint failed", "unknown reference"))

    nodes = {}
    for n in g["nodes"]:
        insert("INSERT INTO nodes VALUES (?, ?)", (n["id"], n.get("kind")), n["id"])
        nodes[n["id"]] = n
    for gl in g["glosses"]:
        insert("INSERT INTO nodes VALUES (?, 'gloss')", (gl["id"],), gl["id"])
    for s in g["sources"]:
        insert("INSERT INTO sources VALUES (?)", (s,), s)

    def ref(where, id_, kinds=None):
        n = nodes.get(id_)
        if id_ not in nodes and not any(gl["id"] == id_ for gl in g["glosses"]):
            r.err(where, f"unknown reference {id_}")
        elif kinds and n and n.get("kind") not in kinds:
            r.err(where, f"{id_} is a {n.get('kind')}, expected {'/'.join(kinds)}")

    def evidence(where, evs, fields=None, need=False):
        covered = set()
        for ev in evs or []:
            if ev["src"] not in g["sources"]:
                r.err(where, f"unknown source {ev['src']}")
                continue
            st = ev_status(ev, g)
            if ev.get("quote") and st == "unverified" and source_text(g["sources"][ev["src"]]) is not None:
                r.err(where, f"evidence quote not found in {ev['src']}: {ev['quote'][:50]!r}")
            if st in OK:
                covered |= set(ev.get("for", ["*"]))
        if need:
            missing = [f for f in (fields or ["*"]) if f not in covered and not (f == "*" and covered)]
            if missing:
                r.err(where, f"admitted without machine/human evidence for: {', '.join(missing)}")
        return covered

    def locator(where, loc):
        if paras_of(loc["source"]) is None:
            r.err(where, f"no text for {loc['source']}")
            return None
        hits = anchor(loc)
        if not hits:
            r.err(where, f"text not found in {loc['source']}: {loc['exact'][:50]!r}")
        elif len(hits) > 1:
            r.err(where, f"ambiguous in {loc['source']} (paragraphs {hits}): {loc['exact'][:50]!r}; add prefix/suffix")
        return hits[0] if len(hits) == 1 else None

    # Nodes
    for n in g["nodes"]:
        k, where = n.get("kind"), n["id"]
        admitted = n.get("status", "admitted") == "admitted" if k == "work" else True
        if k == "person":
            label = g["authority"].get(n.get("lccn", ""))
            if not label:
                r.warn(where, "no LC authority label cached (run: python tools/catalog.py authority)")
            else:
                want = f"{n['name']}, {n['born']}-{n['died']}"
                if label != want:
                    r.err(where, f"name/dates {want!r} do not match LC authority {label!r}")
        elif k == "work":
            ref(where, n.get("author"), ["person"])
            if n.get("form") not in v.get("work_forms", []):
                r.err(where, f"form {n.get('form')!r} not in vocab")
            evidence(where, n.get("ev"), REQUIRED["work"], need=admitted)
        elif k == "text":
            ref(where, n.get("work"), ["work"])
            evidence(where, n.get("ev"), REQUIRED["text"], need=False)
        elif k == "edition":
            ref(where, n.get("text"), ["text"])
            evidence(where, n.get("ev"), REQUIRED["edition"], need=False)
        elif k == "subject":
            for b in n.get("broader", []):
                insert("INSERT INTO broader VALUES (?, ?)", (n["id"], b), where)
    cyc = db.execute("""
      WITH RECURSIVE up(start, node) AS (SELECT child, parent FROM broader
        UNION SELECT up.start, b.parent FROM up JOIN broader b ON b.child = up.node)
      SELECT DISTINCT start FROM up WHERE start = node""").fetchall()
    for (c,) in cyc:
        r.err(c, "broader headings form a cycle")

    # Glosses
    for gl in g["glosses"]:
        locator(gl["id"], gl["loc"])
        if gl.get("kind") not in v.get("gloss_kinds", []):
            r.err(gl["id"], f"kind {gl.get('kind')!r} not in vocab")
        if gl.get("target"):
            ref(gl["id"], gl["target"], ["work"])
        if gl.get("see"):
            locator(gl["id"] + " (see)", gl["see"])
        evidence(gl["id"], gl.get("ev"))

    # Edges
    notes = computed_notes(g)
    for e in g["edges"]:
        where = f"{e['type']} {e['from']} -> {e['to']}"
        if e["type"] == "index":
            ref(where, e["from"], ["work"])
            ref(where, e["to"], ["subject", "person"])
            for loc in e.get("loci", []):
                locator(where, loc)
        elif e["type"] == "context":
            ref(where, e["from"], ["work"])
            ref(where, e["to"], ["work"])
            if e.get("role") not in v.get("context_roles", []):
                r.err(where, f"role {e.get('role')!r} not in vocab")
            for loc in e.get("loci", []):
                locator(where, loc)
            if nodes.get(e["from"], {}).get("status", "admitted") == "admitted":
                evidence(where, e.get("ev"), need=True)
        elif e["type"] == "note":
            if e["rel"] not in v.get("note_types", {}) or v["note_types"][e["rel"]].get("computed"):
                r.err(where, f"note type {e['rel']!r} is unknown or computed (write a gloss or encounter instead)")
            notes.append(e)
        else:
            r.err(where, f"unknown edge type {e['type']!r}")
    for n in notes:
        where = f"note {n['from']} -[{n['rel']}]-> {n['to']}"
        insert("INSERT INTO notes VALUES (?, ?, ?)", (n["from"], n["to"], n["rel"]), where)
        a, b = nodes.get(n["from"]), nodes.get(n["to"])
        if a and b and year_of(a) and year_of(b) and year_of(a) < year_of(b):
            r.err(where, f"time runs backwards ({year_of(a)} before {year_of(b)})")

    # Readings
    by_note = defaultdict(list)
    lim = v.get("limits", {})
    rids = {rd["id"] for rd in g["readings"]}
    for rd in g["readings"]:
        frm, to, rel = rd["note"]
        insert("INSERT INTO readings VALUES (?, ?, ?, ?)", (rd["id"], frm, to, rel), rd["id"])
        by_note[(frm, to, rel)].append(rd)
        al = rd.get("alignments", [])
        lo, hi = lim.get("alignments", [1, 3])
        if not lo <= len(al) <= hi:
            r.err(rd["id"], f"{len(al)} alignments (need {lo}-{hi})")
        for i, a in enumerate(al, 1):
            insert("INSERT INTO alignments VALUES (?, ?)", (rd["id"], i), rd["id"])
            locator(f"{rd['id']} alignment {i} from", a["from"])
            locator(f"{rd['id']} alignment {i} to", a["to"])
            for f in ("same", "differs"):
                if not a.get(f):
                    r.err(rd["id"], f"alignment {i} has no {f!r}")
                elif len(a[f].split()) > lim.get(f"{f}_words", 99):
                    r.err(rd["id"], f"alignment {i} {f!r} longer than {lim[f + '_words']} words")
        if len(rd.get("claim", "").split()) > lim.get("claim_words", 99):
            r.err(rd["id"], f"claim longer than {lim['claim_words']} words")
        if rd.get("case") not in v.get("case", []):
            r.err(rd["id"], f"case {rd.get('case')!r} not in vocab")
        if rd.get("disputes"):
            other = next((x for x in g["readings"] if x["id"] == rd["disputes"]), None)
            if rd["disputes"] not in rids:
                r.err(rd["id"], f"disputes unknown reading {rd['disputes']}")
            elif rd["disputes"] == rd["id"] or other["note"] != rd["note"]:
                r.err(rd["id"], "disputes must name another reading of the same note")
        if rd.get("status") == "admitted" and not (rd.get("qc", {}).get("substitution") or {}).get("passed"):
            r.err(rd["id"], "admitted without a passed substitution test")
    for n in notes:
        if n["rel"] in v.get("interpretive", []):
            rs = by_note.get((n["from"], n["to"], n["rel"]), [])
            where = f"note {n['from']} -[{n['rel']}]-> {n['to']}"
            if not rs:
                r.err(where, "interpretive note without a reading")
            elif n.get("status") == "admitted" and not any(x.get("status") == "admitted" for x in rs):
                r.err(where, "admitted without an admitted reading")

    # Dossiers
    for d in g["dossiers"]:
        where = f"dossier {d['work']}"
        ref(where, d["work"], ["work"])
        ref(where, d.get("text"), ["text"])
        for s in d.get("sections", []):
            for it in s["items"]:
                ref(f"{where} / {s['title']}", it)
        for s in d.get("bibliography", []):
            if s not in g["sources"]:
                r.err(where, f"bibliography: unknown source {s}")

    # Warnings: catalog year vs first publication, copy-text not decided
    work_of = slug_to_work(g)
    for b in g["books"]:
        w = nodes.get(work_of.get(b["slug"], ""))
        fp = (w or {}).get("first_pub", {}).get("year")
        if fp and b.get("year") != fp:
            r.warn(b["slug"], f"books.json year {b.get('year')} differs from first publication {fp}")
    for n in g["nodes"]:
        if n.get("kind") == "work" and len([t for t in g["nodes"] if t.get("work") == n["id"] and t.get("kind") == "text"
                                            and any(it.get("pg") for it in t.get("items", []))]) > 1:
            if n["id"] not in g["collate"]:
                r.warn(n["id"], "copy-text not decided (run: python tools/catalog.py collate <work>)")
    check_authors(g, r, nodes)
    return r


# ---------------- building ----------------

def build(g: dict, drafts: bool = False) -> dict:
    keep = (lambda x: True) if drafts else (lambda x: x.get("status", "admitted") == "admitted")
    nodes = {n["id"]: n for n in g["nodes"]}
    works = {k: n for k, n in nodes.items() if n.get("kind") == "work" and keep(n)}

    def loc(l):
        hits = anchor(l)
        return {**l, "para": hits[0] if len(hits) == 1 else None}

    def ev(evs):
        return [{**e, "status": ev_status(e, g)} for e in evs or []]

    notes = computed_notes(g) + [e for e in g["edges"] if e["type"] == "note"]
    notes = [n for n in notes if keep(n) and n["from"] in works and n["to"] in works]
    for n in notes:
        n["contact"] = contact(n, notes)
    readings = [{**rd, "alignments": [{**a, "from": loc(a["from"]), "to": loc(a["to"])} for a in rd["alignments"]]}
                for rd in g["readings"] if keep(rd)]
    used_src = set()
    out_nodes = []
    for n in g["nodes"]:
        if n.get("kind") == "work" and n["id"] not in works:
            continue
        m = {**n, "ev": ev(n.get("ev"))}
        if n.get("kind") == "person":
            m["authority"] = g["authority"].get(n.get("lccn", ""))
            m["ev"] = [{"src": f"src:lcnaf-{n['lccn']}", "for": ["name", "born", "died"],
                        "status": "machine" if m["authority"] == f"{n['name']}, {n['born']}-{n['died']}" else "unverified"}]
        used_src |= {e["src"] for e in m["ev"]}
        out_nodes.append(m)
    books, author_links = library_works(g, works, notes, out_nodes)
    glosses = [{**gl, "loc": loc(gl["loc"]), **({"see": loc(gl["see"])} if gl.get("see") else {}), "ev": ev(gl.get("ev"))}
               for gl in g["glosses"] if keep(gl)]
    for gl in glosses:
        used_src |= {e["src"] for e in gl["ev"]}
    edges = []
    for e in g["edges"]:
        if e["type"] == "note":
            continue
        if e["from"] not in works or (e["type"] == "context" and e["to"] not in works):
            continue
        e = {**e, "loci": [loc(l) for l in e.get("loci", [])], "ev": ev(e.get("ev"))}
        used_src |= {x["src"] for x in e["ev"]}
        edges.append(e)
    for d in g["dossiers"]:
        used_src |= set(d.get("bibliography", []))
    # Context works open in the reader as ctx-<id> books.
    contexts = {}
    for e in edges:
        if e["type"] == "context":
            cid = e["from"].split(":", 1)[1]
            if (CONTENT / "contexts" / f"{cid}.txt").exists():
                contexts[e["from"]] = f"ctx-{cid}"
    return {
        "vocab": {k: g["vocab"][k] for k in ("note_types", "context_roles", "contact", "case") if k in g["vocab"]},
        "nodes": out_nodes, "glosses": glosses, "edges": edges, "notes": notes, "readings": readings,
        "author_links": author_links,
        "dossiers": [d for d in g["dossiers"] if d["work"] in works], "contexts": contexts,
        "collate": g["collate"], "sources": [g["sources"][s] for s in sorted(used_src) if s in g["sources"]],
        "slugs": {s: wid for wid, b in books.items() for s in b["slugs"]},
    }


def is_ready(b: dict) -> bool:
    """Readable on the site (tools/build.py): a source text and a review date."""
    return (CONTENT / "sources" / f"{b['slug']}.txt").exists() and bool(b.get("reviewed"))


def book_work_id(b: dict, registered: dict) -> str:
    return registered.get(b["slug"]) or f"work:{b.get('series') or b['slug']}"


def library_works(g: dict, works: dict, notes: list[dict], out_nodes: list[dict]) -> tuple[dict, list[dict]]:
    """Every readable book becomes a work node in out_nodes (a novel's volumes are one node), linked to its author.

    A book whose work is in nodes.jsonl (and kept by this build) gets that node, with the book fields added;
    any other book gets a light node work:<series or slug> from books.json, status "auto".
    """
    registered = slug_to_work(g)
    degree = defaultdict(int)
    for n in notes:
        degree[n["from"]] += 1
        degree[n["to"]] += 1
    by_id = {n["id"]: n for n in out_nodes}
    books: dict[str, dict] = {}
    for b in g["books"]:
        if not is_ready(b):
            continue
        wid = book_work_id(b, registered)
        if wid not in books:
            node = by_id.get(wid) if wid in works else None
            if node is None:
                node = {"id": wid, "kind": "work", "title": b["title"], "author": b["author"], "year": b["year"],
                        "status": "auto"}
                out_nodes.append(node)
                by_id[wid] = node
            else:
                node["year"] = (node.get("first_pub") or {}).get("year") or year_of(node) or b["year"]
            node.update({"byline": b["author"], "genre": b.get("genre"), "spine": b["spine"],
                         "accent": (b.get("cover") or {}).get("accent"), "slugs": [], "degree": degree.get(wid, 0)})
            books[wid] = node
        books[wid]["slugs"].append(b["slug"])
    by_author = defaultdict(list)
    for bk in books.values():
        by_author[bk["byline"]].append(bk)
    links = []
    for name, bks in by_author.items():
        bks.sort(key=lambda x: (x["year"], x["title"]))
        node = author_node(g, name, bks, by_id)
        if node["id"] not in by_id:
            out_nodes.append(node)
            by_id[node["id"]] = node
        links += [{"from": bk["id"], "to": node["id"]} for bk in bks]
    return books, links


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def author_node(g: dict, byline: str, bks: list[dict], by_id: dict) -> dict:
    """The author of some ready books (one byline in books.json): the registered person when one of the books is a
    registered work by a person or the person's name reads as the byline, else a light node author:<slug>.
    It carries the byline, the works in this library (oldest first) and, when content/authors/<slug>.md exists, its
    first paragraph (about) for the author panel."""
    pid, slug = author_ref(g, byline, [s for bk in bks for s in bk["slugs"]])
    if pid:
        node = by_id.get(pid) or {k: v for k, v in next(n for n in g["nodes"] if n["id"] == pid).items()}
    else:
        node = {"id": f"author:{slug}", "kind": "person", "name": byline, "status": "auto"}
    node.update({"byline": byline, "slug": slug, "works": [bk["id"] for bk in bks]})
    doc = g.get("authors", {}).get(slug)
    if doc and doc["intro"]:
        node.update({"about": inline_text(doc["intro"][0]), "doc": True})
    return node


def author_ref(g: dict, byline: str, slugs: list[str]) -> tuple[str | None, str]:
    """(registered person id or None, author slug) for a byline and its books' slugs."""
    nodes = {n["id"]: n for n in g["nodes"]}
    registered = slug_to_work(g)
    pid = next((nodes[registered[s]].get("author") for s in slugs
                if s in registered and str(nodes[registered[s]].get("author", "")).startswith("person:")), None)
    pid = pid or next((n["id"] for n in g["nodes"] if n.get("kind") == "person" and display_name(n["name"]) == byline), None)
    return (pid, pid.split(":", 1)[1]) if pid else (None, slugify(byline))


def build_contexts(build_book, drafts: bool = False):
    """Reader pages for context texts: site/data/books/ctx-<id>.json."""
    g = load()
    data = build(g, drafts)
    nodes = {n["id"]: n for n in data["nodes"]}
    for wid, slug in data["contexts"].items():
        w = nodes[wid]
        author = next((n for n in data["nodes"] if n["id"] == w.get("author")), {})
        meta = {"slug": slug, "title": w["title"], "author": display_name(author.get("name", "")),
                "year": (w.get("first_pub") or {}).get("year"), "genre": "Context", "tags": []}
        book = build_book(meta, folder="contexts", name=slug[4:])
        (OUT / "books" / f"{slug}.json").write_text(json.dumps(book, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    if not drafts:
        write_authors(g, data)
    return data


def display_name(name: str) -> str:
    """'Shelley, Mary Wollstonecraft' -> 'Mary Wollstonecraft Shelley'; parenthesised fuller forms dropped."""
    name = re.sub(r"\s*\(.*?\)", "", name)
    if ", " in name:
        last, first = name.split(", ", 1)
        return f"{first} {last}"
    return name


def write(data: dict, drafts: bool):
    OUT.mkdir(parents=True, exist_ok=True)
    name = "graph.drafts.json" if drafts else "graph.json"
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"  {name}: {sum(bool(n.get('slugs')) for n in data['nodes'])} books, "
          f"{sum(n.get('kind') == 'work' for n in data['nodes'])} works, {len(data['notes'])} notes, "
          f"{len(data['readings'])} readings, {len(data['glosses'])} glosses")


# ---------------- commands ----------------

def cmd_authority():
    g = load()
    cache = g["authority"]
    people = [n for n in g["nodes"] if n.get("kind") == "person" and n.get("lccn")]
    people += [{"id": f"content/authors/{d['slug']}.md", "lccn": d["lccn"]} for d in g["authors"].values() if d.get("lccn")]
    for n in people:
        if n["id"].startswith("content/") and n["lccn"] in cache:
            continue
        url = f"https://id.loc.gov/authorities/names/{n['lccn']}.json"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as resp:
            doc = json.load(resp)
        # the record itself, not a blank node whose id merely ends with the lccn (Collins: "_:b179…n79061084" = "Jollins, Mr.")
        me = next(x for x in doc if x.get("@id", "").split("://", 1)[-1] == f"id.loc.gov/authorities/names/{n['lccn']}"
                  and "http://www.loc.gov/mads/rdf/v1#authoritativeLabel" in x)
        label = me["http://www.loc.gov/mads/rdf/v1#authoritativeLabel"][0]["@value"]
        cache[n["lccn"]] = label
        print(f"  {n['id']}: {label}")
    (cache_dir() / "authority.json").write_text(json.dumps(cache, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


SENT = re.compile(r"(?<=[.!?])\s+")


def sentences(text: str) -> set[str]:
    out = set()
    for s in SENT.split(norm(text).lower()):
        s = re.sub(r"[^a-z ]+", "", s)
        s = re.sub(r" +", " ", s).strip()
        if len(s.split()) >= 12:
            out.add(s)
    return out


def body(gid: int) -> str:
    t = (RAW / f"pg{gid}.txt").read_text(encoding="utf-8-sig")
    t = t.split("*** START OF", 1)[-1].split("*** END OF", 1)[0]
    return re.sub(r"_", "", t)


def cmd_collate(work: str):
    """Probes are sentences that occur in one Gutenberg edition and not the other; our copy is the text whose probes it contains."""
    g = load()
    wid = work if work.startswith("work:") else f"work:{work}"
    texts = [n for n in g["nodes"] if n.get("kind") == "text" and n.get("work") == wid and any(it.get("pg") for it in n.get("items", []))]
    if len(texts) < 2:
        sys.exit(f"{wid}: need two texts with Gutenberg items")
    sets = {t["id"]: sentences(body(next(it["pg"] for it in t["items"] if it.get("pg")))) for t in texts}
    slugs = [s for t in texts for it in t["items"] for s in it.get("slugs", [])]
    ours = set()
    for s in slugs:
        ours |= sentences("\n\n".join(load_paragraphs(s)))
    result = {"slugs": slugs, "texts": {}}
    for tid, ss in sets.items():
        probes = ss - set().union(*(o for k, o in sets.items() if k != tid))
        hit = len(probes & ours)
        result["texts"][tid] = {"probes": len(probes), "found": hit, "ratio": round(hit / len(probes), 3) if probes else None,
                                "examples": sorted(probes & ours, key=len)[:3] if hit else sorted(probes, key=len)[:3]}
    best = max(result["texts"], key=lambda k: result["texts"][k]["ratio"] or 0)
    others = [v["ratio"] or 0 for k, v in result["texts"].items() if k != best]
    ok = (result["texts"][best]["ratio"] or 0) >= 0.8 and all(o <= 0.2 for o in others)
    result["copytext"] = best if ok else "unknown"
    cache = g["collate"]
    cache[wid] = result
    (cache_dir() / "collate.json").write_text(json.dumps(cache, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    for tid, v in result["texts"].items():
        print(f"  {tid}: {v['found']}/{v['probes']} probes in our copy")
    print(f"  copytext: {result['copytext']}")


def cmd_substitute(rid: str):
    g = load()
    rd = next(x for x in g["readings"] if x["id"] == rid)
    frm, to, rel = rd["note"]
    heads = {e["to"] for e in g["edges"] if e["type"] == "index" and e["from"] in (frm, to)}
    peers = sorted({e["from"] for e in g["edges"] if e["type"] == "index" and e["to"] in heads} - {frm, to})
    print(f"Substitution test for {rid} ({frm} {rel} {to}).\n")
    print(f"Claim: {rd['claim']}\n")
    for i, a in enumerate(rd["alignments"], 1):
        print(f"{i}. same: {a['same']}\n   differs: {a['differs']}")
    print(f"\nFor each work below, replace {to} (or {frm}) with it. If the claim stays true, the claim is too general.")
    for p in peers:
        print(f"  - {p}")
    print("\nRecord the result in the reading as qc.substitution = {passed, tried, by, note}.")


def main():
    global STAGE
    args = sys.argv[1:]
    if "--stage" in args:
        i = args.index("--stage")
        STAGE = args[i + 1]
        del args[i:i + 2]
    cmd = args[0] if args else "check"
    if cmd == "check":
        g = load()
        r = check(g)
        for w in r.warnings:
            print(f"  warning  {w}")
        for e in r.errors:
            print(f"  ERROR    {e}")
        print(f"  {len(r.errors)} errors, {len(r.warnings)} warnings")
        sys.exit(1 if r.errors else 0)
    elif cmd == "build":
        from build import build_book
        drafts = "--drafts" in args
        write(build_contexts(build_book, drafts), drafts)
    elif cmd == "authority":
        cmd_authority()
    elif cmd == "collate":
        cmd_collate(args[1])
    elif cmd == "substitute":
        cmd_substitute(args[1])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
