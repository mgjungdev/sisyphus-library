"""Parallel data steps of the graph project with the result of running them one after another (docs/graph/PLAN.md §8).

A data step ("kind": "data" in docs/graph/steps.json) writes only to content/graph/stage/<code>/: the same file names
as content/graph/ (nodes.jsonl, edges.jsonl, readings.jsonl, glosses.jsonl, sources.jsonl, authority.json,
collate.json, dossiers/*.json) plus LOG.md for its log line. A row with an id (an edge: type, from, to, role, rel) that
the graph already has replaces it there; {"id": …, "_delete": true} (an edge: its key fields + "_delete") removes it.

`graph_pipeline.py mark` merges a stage into content/graph/ under a lock. content/graph/stage/provenance.json keeps,
for every row a stage wrote, the value before any stage ("base") and each step's version in the steps' serial order,
so the graph a step sees can be rebuilt as it would have been had the steps run one after another:

  view(code)         every row as the steps up to and including <code> (serial order) left it
  view_before(code)  the same, without <code>'s own rows: what <code> builds on
  summary(g)         the parts of the graph a data step's work depends on (works, headings, index entries, refers and
                     read notes); a step whose summary at its start differs from the one it would have seen in serial
                     order, once every earlier step is done, is corrected by a 보정 job (graph_pipeline.py)
"""
import hashlib
import json
import os
import shutil
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GRAPH = ROOT / "content" / "graph"
STAGE = GRAPH / "stage"
PROV = STAGE / "provenance.json"
VIEWS = STAGE / "_views"
STEPS = ROOT / "docs" / "graph" / "steps.json"
LOCK = STAGE / ".lock"
ROWS = ["nodes.jsonl", "edges.jsonl", "readings.jsonl", "glosses.jsonl", "sources.jsonl"]
DICTS = ["authority.json", "collate.json"]
EDGE_KEY = ("type", "from", "to", "role", "rel")


def key(name: str, r: dict) -> str:
    if name == "edges.jsonl":
        return json.dumps([r.get(k) for k in EDGE_KEY], ensure_ascii=False)
    return r["id"]


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(l) for l in path.read_text(encoding="utf-8-sig").splitlines() if l.strip()]


def write_json(path: Path, data, indent=1) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=indent) + "\n", encoding="utf-8")
    os.replace(tmp, path)


@contextmanager
def lock(wait: float = 900):
    """One merge (or begin, mark, ok) at a time across the jobs running in this folder."""
    STAGE.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - LOCK.stat().st_mtime > 1800:  # a holder that died
                    LOCK.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.time() - t0 > wait:
                raise SystemExit(f"{LOCK} is held by another job for {wait:.0f}s; try again")
            time.sleep(2)
    try:
        yield
    finally:
        try:
            LOCK.unlink()
        except FileNotFoundError:
            pass


# ---------------- serial order ----------------

def order() -> dict[str, int]:
    """Serial position of every data step: its place in steps.json."""
    steps = json.loads(STEPS.read_text(encoding="utf-8"))["steps"]
    return {s["code"]: i for i, s in enumerate(steps) if s.get("kind") == "data"}


def prov() -> dict:
    return json.loads(PROV.read_text(encoding="utf-8")) if PROV.exists() else {}


def version_at(h: dict, limit: float, pos: dict):
    """(present, row) of one row's history as the steps up to serial position `limit` left it."""
    vs = [v for v in h["v"] if pos.get(v[0], -1) <= limit]
    row = vs[-1][1] if vs else h["base"]
    return row is not None, row


# ---------------- views ----------------

def apply_view(g: dict, code: str, before: bool = False, stage: bool = True, pos: dict = None, p: dict = None) -> dict:
    """Rebuild g's rows (loaded from content/graph/) as of `code` in serial order, then lay its stage over them.
    g["hidden"] gets the ids/keys of rows not there yet."""
    pos = pos if pos is not None else order()
    if code not in pos:
        raise SystemExit(f"{code} is not a data step")
    limit = pos[code] - 0.5 if before else pos[code]
    p = p if p is not None else prov()
    hidden = set()
    for name in ROWS + ["dossiers"]:
        field = name.split(".")[0]
        rows = list(g[field].values()) if field == "sources" else g[field]
        out, seen = [], set()
        for r in rows:
            k = r["work"] if name == "dossiers" else key(name, r)
            seen.add(k)
            h = p.get(f"{name}|{k}")
            if h:
                present, r = version_at(h, limit, pos)
                if not present:
                    hidden.add(k)
                    continue
            out.append(r)
        # rows a later step's version removed from the files but present at this point
        for pk, h in p.items():
            n, k = pk.split("|", 1)
            if n == name and k not in seen:
                present, r = version_at(h, limit, pos)
                if present:
                    out.append(r)
        g[field] = {r["id"]: r for r in out} if field == "sources" else out
    # rows of later steps still in their stage folders (not merged yet): also not there at this point
    for d in STAGE.iterdir() if STAGE.exists() else []:
        if d.is_dir() and pos.get(d.name, -1) > limit:
            for name in ROWS:
                hidden.update(key(name, r) for r in read_rows(d / name))
    if stage and not before:
        overlay(g, STAGE / code)
    g["hidden"] = hidden
    return g


def overlay(g: dict, d: Path) -> None:
    """Lay one stage folder's rows over g (the step's own unmerged work)."""
    if not d.exists():
        return
    for name in ROWS:
        field = name.split(".")[0]
        if field == "sources":
            for r in read_rows(d / name):
                if r.get("_delete"):
                    g["sources"].pop(r["id"], None)
                else:
                    g["sources"][r["id"]] = r
            continue
        idx = {key(name, r): i for i, r in enumerate(g[field])}
        for r in read_rows(d / name):
            k = key(name, r)
            if r.get("_delete"):
                if k in idx:
                    g[field][idx[k]] = None
                continue
            if k in idx and g[field][idx[k]] is not None:
                g[field][idx[k]] = r
            else:
                idx[k] = len(g[field])
                g[field].append(r)
        g[field] = [r for r in g[field] if r is not None]
    for name in DICTS:
        f = d / name
        if f.exists():
            g[name.split(".")[0]].update(json.loads(f.read_text(encoding="utf-8")))
    for f in sorted((d / "dossiers").glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        g["dossiers"] = [x for x in g["dossiers"] if x["work"] != doc["work"]] + ([] if doc.get("_delete") else [doc])


def summary(g: dict) -> dict:
    """What a data step's own work reads of the other steps' work: the works it may relate to and test claims against,
    the subject headings it may index under, the index entries (substitution peers), and refers/read notes (contact)."""
    import catalog
    notes = [e for e in g["edges"] if e.get("type") == "note" and e.get("rel") in ("refers", "read")]
    notes += catalog.computed_notes(g)
    return {"works": sorted(n["id"] for n in g["nodes"] if n.get("kind") == "work"),
            "headings": sorted(n["id"] for n in g["nodes"] if n.get("kind") == "subject"),
            "index": sorted(f"{e['from']} > {e['to']}" for e in g["edges"] if e.get("type") == "index"),
            "contact": sorted({f"{n['from']} {n['rel']} {n['to']}" for n in notes})}


def summary_before(code: str, base: dict = None, pos: dict = None, p: dict = None) -> dict:
    """base: catalog.load() of content/graph/, reused across calls (it is not changed)."""
    import catalog
    g = dict(base or catalog.load())
    return summary(apply_view(g, code, before=True, pos=pos, p=p))


def digest(s: dict) -> str:
    return hashlib.sha1(json.dumps(s, sort_keys=True).encode()).hexdigest()[:10]


def diff(old: dict, new: dict) -> dict:
    return {k: {"added": sorted(set(new[k]) - set(old.get(k, []))), "removed": sorted(set(old.get(k, [])) - set(new[k]))}
            for k in new if set(new[k]) != set(old.get(k, []))}


def seen(code: str) -> dict | None:
    f = VIEWS / f"{code}.json"
    return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None


def record(code: str, kind: str, s: dict) -> None:
    """kind "begun": the summary a job started from; "seen": the one its merged work rests on."""
    f = VIEWS / f"{code}.json"
    d = seen(code) or {}
    d[kind] = s
    write_json(f, d, indent=None)


# ---------------- merge ----------------

def newline(path: Path) -> str:
    return "\r\n" if path.exists() and b"\r\n" in path.read_bytes()[:4096] else "\n"


def main_digest() -> str:
    h = hashlib.sha1()
    for name in ROWS + DICTS:
        f = GRAPH / name
        h.update(f.read_bytes() if f.exists() else b"")
    for f in sorted((GRAPH / "dossiers").glob("*.json")):
        h.update(f.name.encode() + f.read_bytes())
    return h.hexdigest()[:12]


def merge(code: str) -> list[str]:
    """Fold content/graph/stage/<code>/ into content/graph/ in serial order; returns what changed. Caller holds lock()."""
    pos = order()
    me = pos[code]
    d = STAGE / code
    p = prov()
    changed = []

    def put(name: str, k: str, cur, new):
        """Record this step's version of one row; returns the row the files should now hold (None: absent)."""
        h = p.setdefault(f"{name}|{k}", {"base": cur, "v": []})
        h["v"] = sorted([v for v in h["v"] if v[0] != code] + [[code, new]], key=lambda v: pos.get(v[0], -1))
        return h["v"][-1][1]

    def intro(name: str, r: dict) -> float:
        """Serial position of the step that first wrote this row (-1: there before any stage)."""
        h = p.get(f"{name}|{key(name, r)}")
        if not h or h["base"] is not None:
            return -1
        return min((pos.get(v[0], -1) for v in h["v"] if v[1] is not None), default=-1)

    for name in ROWS:
        f = d / name
        if not f.exists():
            continue
        main = GRAPH / name
        nl = newline(main)
        rows = read_rows(main)
        idx = {key(name, r): i for i, r in enumerate(rows)}
        for r in read_rows(f):
            k = key(name, r)
            new = None if r.get("_delete") else r
            cur = rows[idx[k]] if k in idx else None
            final = put(name, k, cur, new)
            if k in idx:
                rows[idx[k]] = final
            elif final is not None:
                # a new row goes after the rows of the steps up to it in serial order, where a serial run puts it
                at = 0
                for i, x in enumerate(rows):
                    if x is not None and intro(name, x) <= me:
                        at = i + 1
                rows.insert(at, final)
                idx = {key(name, x): i for i, x in enumerate(rows) if x is not None}
            changed.append(f"{name} {k}")
        body = nl.join(json.dumps(r, ensure_ascii=False) for r in rows if r is not None)
        main.write_bytes((body + nl).encode("utf-8"))
    for name in DICTS:
        f = d / name
        if f.exists():
            main = GRAPH / name
            cache = json.loads(main.read_text(encoding="utf-8")) if main.exists() else {}
            cache.update(json.loads(f.read_text(encoding="utf-8")))
            write_json(main, cache)
            changed.append(name)
    for f in sorted((d / "dossiers").glob("*.json")):
        main = GRAPH / "dossiers" / f.name
        cur = json.loads(main.read_text(encoding="utf-8")) if main.exists() else None
        doc = json.loads(f.read_text(encoding="utf-8"))
        final = put("dossiers", doc["work"], cur, None if doc.get("_delete") else doc)
        if final is None:
            main.unlink(missing_ok=True)
        else:
            main.parent.mkdir(exist_ok=True)
            write_json(main, final)
        changed.append(f"dossiers/{f.name}")
    write_json(PROV, p, indent=None)
    return changed


def stage_log(code: str) -> str:
    f = STAGE / code / "LOG.md"
    return f.read_text(encoding="utf-8").strip() if f.exists() else ""


def clear(code: str) -> None:
    d = STAGE / code
    if d.exists():
        dest = STAGE / "_merged" / f"{code}-{time.strftime('%Y%m%d-%H%M%S')}"
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(d), str(dest))
