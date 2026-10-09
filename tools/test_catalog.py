"""Each deliberate fault in content/graph must be caught by catalog.check; the real data must pass.

Usage: python tools/test_catalog.py
The faults are applied to an in-memory copy; no file is changed.
"""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import catalog as c  # noqa: E402


def node(g, i):
    return next(n for n in g["nodes"] if n["id"] == i)


def backwards(g):
    g["edges"].append({"type": "note", "from": "work:frankenstein", "to": "work:island-of-doctor-moreau", "rel": "answers"})
    g["readings"].append({**copy.deepcopy(g["readings"][0]), "id": "r:x",
                          "note": ["work:frankenstein", "work:island-of-doctor-moreau", "answers"]})


def unsubstituted(g):
    g["readings"][0]["status"] = "admitted"
    g["readings"][0].pop("qc", None)


def essay(g, slug="wells", **over):
    """A well-formed essay on Wells in memory, with some fields replaced."""
    doc = {"slug": slug, "name": "Wells, H. G. (Herbert George)", "display": "H. G. Wells", "born": "1866", "died": "1946",
           "person": "person:wells", "lccn": "n79063613", "intro": ["One. Two."],
           "sections": [{"title": "Life", "paras": ["w " * 500]}, {"title": "Writing", "paras": ["w " * 300]}],
           "books": [{"title": "The Time Machine", "key": "time-machine", "text": "A story."}],
           "sources": ["[LC](https://id.loc.gov/authorities/names/n79063613) — authority record"]}
    g["authors"][slug] = {**doc, **over}


FAULTS = {
    "duplicate note": lambda g: g["edges"].append(dict([e for e in g["edges"] if e["type"] == "note"][-1])),
    "answers without a reading": lambda g: g["edges"].append(
        {"type": "note", "from": "work:island-of-doctor-moreau", "to": "work:birth-mark", "rel": "answers"}),
    "broader cycle": lambda g: node(g, "heading:identity").__setitem__("broader", ["heading:maker-and-made"]),
    "unknown text reference": lambda g: node(g, "edition:frankenstein-1818").__setitem__("text", "text:frankenstein-1823"),
    "time runs backwards": backwards,
    "quote not in the text": lambda g: g["glosses"][0]["loc"].__setitem__("exact", "Paradise Regained"),
    "ambiguous quote": lambda g: g["glosses"][0]["loc"].pop("prefix"),
    "admitted on unverified evidence": lambda g: node(g, "work:scott-blackwoods-1818").__setitem__("status", "admitted"),
    "dossier names an unknown id": lambda g: g["dossiers"][0]["sections"][0]["items"].append("work:no-such-letter"),
    "admitted reading without a substitution test": unsubstituted,
    "dispute across notes": lambda g: g["readings"][2].__setitem__("disputes", "r:moreau-frank-1"),
    "dates differ from LC authority": lambda g: node(g, "person:wells").__setitem__("died", "1945"),
    "author essay dates differ from the person record": lambda g: essay(g, died="1945"),
    "author essay without a source": lambda g: essay(g, sources=["Encyclopaedia Britannica, no address"]),
    "author essay lists another author's book": lambda g: essay(g, books=[{"title": "Frankenstein", "key": "frankenstein", "text": "x"}]),
    "author essay for no author of the library": lambda g: essay(g, slug="no-such-author"),
    "author of ready books without an essay": lambda g: g["authors"].pop("wells"),
    "collection essay with dates": lambda g: essay(g, slug="the-arabian-nights", kind="collection", person="", lccn="",
                                                   name="Arabian nights", display="The Arabian Nights", books=[],
                                                   sections=[{"title": "History", "paras": ["w " * 500]}, {"title": "Tales", "paras": ["w " * 300]}]),
}


def book_nodes(base):
    """Both builds: one work node per ready book (volumes of a series together), each with its book fields."""
    ready = [b for b in base["books"] if c.is_ready(b)]
    count = len({b.get("series") or b["slug"] for b in ready})
    want = {c.book_work_id(b, c.slug_to_work(base)) for b in ready}
    failed = 0
    for drafts in (False, True):
        data = c.build(copy.deepcopy(base), drafts)
        got = [n for n in data["nodes"] if n.get("slugs")]
        bad = [n["id"] for n in got if n.get("kind") != "work" or not all(k in n for k in ("title", "author", "year", "genre", "spine", "degree", "status"))]
        ids = {n["id"] for n in got}
        ok = len(got) == len(ids) == count and ids == want and not bad
        missing = sorted(want - ids)[:3] + sorted(ids - want)[:3] + bad[:3]
        print(f"{'ok  ' if ok else 'FAIL'} {'drafts' if drafts else 'graph'} build: {len(got)} book nodes for {count} ready books by series"
              + ("" if ok else f" (differ: {missing})"))
        failed += not ok
    return failed


def author_nodes(base):
    """Both builds: one author node (kind person) per distinct author of the ready books, every book linked to its one
    author, and each author's works = its books."""
    ready = [b for b in base["books"] if c.is_ready(b)]
    count = len({b["author"] for b in ready})
    failed = 0
    for drafts in (False, True):
        data = c.build(copy.deepcopy(base), drafts)
        authors = {n["id"]: n for n in data["nodes"] if n.get("kind") == "person" and n.get("works")}
        books = {n["id"]: n for n in data["nodes"] if n.get("slugs")}
        to = {}
        for l in data["author_links"]:
            to.setdefault(l["from"], []).append(l["to"])
        bad = [b for b in books if len(to.get(b, [])) != 1 or to[b][0] not in authors
               or authors[to[b][0]]["byline"] != books[b]["byline"] or b not in authors[to[b][0]]["works"]]
        bad += [a for a, n in authors.items() if not all(k in n for k in ("name", "byline", "slug"))
                or sorted(n["works"]) != sorted(b for b, t in to.items() if t == [a])]
        slugs = [n["slug"] for n in authors.values()]
        ok = len(authors) == count and not bad and len(set(slugs)) == len(slugs)
        print(f"{'ok  ' if ok else 'FAIL'} {'drafts' if drafts else 'graph'} build: {len(authors)} author nodes for {count} authors of ready books"
              + ("" if ok else f" (bad: {bad[:3]})"))
        failed += not ok
    return failed


def main():
    if "--stage" in sys.argv:  # the graph as a data step sees it (catalog.py --stage)
        c.STAGE = sys.argv[sys.argv.index("--stage") + 1]
    base = c.load()
    failed = book_nodes(base) + author_nodes(base)
    real = c.check(base)
    print(f"{'ok  ' if not real.errors else 'FAIL'} real data passes ({len(real.errors)} errors)")
    failed += bool(real.errors)
    for name, fault in FAULTS.items():
        g = copy.deepcopy(base)
        fault(g)
        errors = c.check(g).errors
        print(f"{'ok  ' if errors else 'FAIL'} {name}" + (f": {errors[0]}" if errors else " was not caught"))
        failed += not errors
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
