"""Book pipeline state, derived from files on disk, and the work it asks the Claude job queue for.

Usage:
  python tools/pipeline.py status                 counts per stage + the next wave
  python tools/pipeline.py next                   slugs of the next wave with their stage (empty = all done)
  python tools/pipeline.py mark-reviewed <slug>…  record "reviewed": <today> in content/books.json
  python tools/pipeline.py feed                   JSON: the jobs the wave needs now (read by the control queue)
  python tools/pipeline.py panel                  JSON: waves and book stages for the control dashboard
  python tools/pipeline.py deploy [--dry-run]     check, build, commit and push every reviewed book of the wave
  python tools/pipeline.py start [<wave>]         open a PIPELINE.md wave now, alongside the current one (default: the first not begun)

Stages: no-source → no-glossary → failing → unreviewed → reviewed → deployed.
A wave is every book already in progress; when none is, the next shelf-months without sources
(`months_per_wave` in pipeline.config.json, default 2). A wave of the PIPELINE.md table can also be opened early
with `start` (recorded under "started" in pipeline.config.json); the dashboard offers it as a button (the panel's
"actions").
The control queue (~/sisyphus/control) runs one job per book and stage — import, glossary, check —
and one deploy job once every book of the wave is reviewed.
"""
import datetime
import hashlib
import json
import re
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_glossary import check  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
BOOKS = CONTENT / "books.json"
LONG = 12000  # words; writers work from tools/candidates.py above this
CONFIG = ROOT / "pipeline.config.json"  # local, git-ignored
DEFAULTS = {
    "months_per_wave": 2,
    # Model per job. Haiku importers were unreliable (2026-09-28), so imports use sonnet.
    "models": {"import": "sonnet", "glossary": "sonnet", "check": "opus"},
}


def config() -> dict:
    try:
        return {**DEFAULTS, **json.loads(CONFIG.read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save_started(started: dict) -> None:
    """Record the waves opened with `start` in pipeline.config.json, keeping its other keys."""
    try:
        raw = json.loads(CONFIG.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    raw["started"] = started
    CONFIG.write_text(json.dumps(raw, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def catalog() -> list[dict]:
    return json.loads(BOOKS.read_text(encoding="utf-8"))


def deployed_slugs() -> set[str]:
    try:
        out = subprocess.run(["git", "ls-tree", "--name-only", "origin/main", "content/glossary/"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
    except (OSError, subprocess.CalledProcessError):
        return set()
    return {Path(p).stem for p in out.split()}


def words(slug: str) -> int:
    p = CONTENT / "sources" / f"{slug}.txt"
    return len(p.read_text(encoding="utf-8").split()) if p.exists() else 0


def stage(book: dict, deployed: set[str]) -> str:
    slug = book["slug"]
    if not (CONTENT / "sources" / f"{slug}.txt").exists():
        return "no-source"
    if not (CONTENT / "glossary" / f"{slug}.json").exists():
        return "no-glossary"
    if check(slug):
        return "failing"
    if not book.get("reviewed"):
        return "unreviewed"
    return "deployed" if slug in deployed else "reviewed"


def states() -> list[tuple[dict, str]]:
    dep = deployed_slugs()
    return [(b, stage(b, dep)) for b in catalog()]


def next_wave(st: list[tuple[dict, str]]) -> list[tuple[dict, str]]:
    todo = [(b, s) for b, s in st if s != "deployed"]
    if not todo:
        return []
    # Finish books already in progress before starting new ones; waves opened with `start` count as in progress.
    early = {s for w in wave_table() if w["name"] in (config().get("started") or {}) for s in w["slugs"]}
    started = [(b, s) for b, s in todo if s != "no-source" or b["slug"] in early]
    if started:
        return started
    months = sorted({b["month"] for b, _ in todo})[: max(1, int(config()["months_per_wave"]))]
    return [(b, s) for b, s in todo if b["month"] in months]


# ---- control queue ---------------------------------------------------------------------

def vol_label(b: dict) -> str:
    return f" {b['vol']}권" if b.get("vol") else ""


def job_for(b: dict, s: str, models: dict) -> dict | None:
    slug, title = b["slug"], b.get("title", b["slug"])
    who = f"{slug} (\"{title}\"{' by ' + b['author'] if b.get('author') else ''})"
    if b.get("vol"):
        who += f", volume {b['vol']} of {b['vols']} (the other volumes are separate books)"
    src = b.get("source")
    if s == "no-source" and src and b.get("gutenberg"):
        # The volume split was planned from the downloaded text (tools/plan_volumes.py): cut it as planned.
        argv = ["python", "tools/import_gutenberg.py", slug, str(b["gutenberg"]), src["from"]]
        argv += [src["to"]] if src.get("to") else []
        argv += ["--nth", str(src.get("nth", 1)), "--keep-start"]
        argv += ["--end-nth", str(src["to_nth"])] if src.get("to_nth") else []
        argv += ["--heading", src["heading"]] if src.get("heading") else []
        argv += ["--drop", src["drop"]] if src.get("drop") else []
        return {"key": f"import:{slug}", "title": f"{title}{vol_label(b)} · 원문", "tags": [slug], "argv": argv}
    if s == "no-source":
        return {"key": f"import:{slug}", "title": f"{title}{vol_label(b)} · 원문", "model": models["import"], "tags": [slug],
                "prompt": f"Import the source text of the Sisyphus Library book {who}. Follow "
                          f"`.claude/agents/book-importer.md` exactly for this one slug, then record the id with "
                          f"`python tools/set_source.py {slug}=<gutenberg id>`. If the Gutenberg MCP catalog is down, "
                          f"find the id on gutendex.com and use `tools/import_gutenberg.py` directly. If the story "
                          f"cannot be imported, say why in one paragraph and stop."}
    if s in ("no-glossary", "failing"):
        w = words(slug)
        fix = (" The glossary already exists but fails `python tools/check_glossary.py`; fix the existing file "
               "instead of rewriting it." if s == "failing" else "")
        long = f" The story has {w} words, so work from `python tools/candidates.py {slug}`." if w > LONG else ""
        return {"key": f"glossary:{slug}", "title": f"{title}{vol_label(b)} · 어휘집", "model": models["glossary"], "tags": [slug],
                "prompt": f"Write the glossary for the Sisyphus Library book {who}. Follow "
                          f"`.claude/agents/glossary-writer.md` exactly.{long}{fix} "
                          f"`python tools/check_glossary.py {slug}` must pass before you finish."}
    if s == "unreviewed":
        return {"key": f"check:{slug}", "title": f"{title}{vol_label(b)} · 검토", "model": models["check"], "tags": [slug],
                "prompt": f"Review the glossary of the Sisyphus Library book {who}, which you did not write. Follow "
                          f"`.claude/agents/glossary-checker.md` exactly for this slug. When "
                          f"`python tools/check_glossary.py {slug}` passes after your fixes, run "
                          f"`python tools/pipeline.py mark-reviewed {slug}`."}
    return None


def feed() -> list[dict]:
    models = {**DEFAULTS["models"], **(config().get("models") or {})}
    wave = next_wave(states())
    jobs = [j for b, s in wave if (j := job_for(b, s, models))]
    if wave and not jobs:  # every book of the wave is reviewed (or deployed): ship it
        slugs = sorted(b["slug"] for b, s in wave if s == "reviewed")
        if slugs:
            key = hashlib.md5(",".join(slugs).encode()).hexdigest()[:8]
            jobs.append({"key": f"deploy:{key}", "title": f"배포 · {len(slugs)}권", "tags": slugs,
                         "argv": ["python", "tools/pipeline.py", "deploy"]})
    return jobs


def wave_table() -> list[dict]:
    """Waves as PIPELINE.md lists them: | W1 | 2027-02 – 03 | slug, slug … |"""
    try:
        text = (ROOT / "PIPELINE.md").read_text(encoding="utf-8")
    except OSError:
        return []
    return [{"name": m.group(1), "months": m.group(2).strip(),
             "slugs": re.findall(r"[a-z0-9]+(?:-[a-z0-9]+)*", m.group(3))}
            for m in re.finditer(r"^\|\s*(W\d+)\s*\|([^|]*)\|([^|]*)\|", text, re.M)]


def closed(st: list[tuple[dict, str]]) -> dict[str, list[str]]:
    """PIPELINE.md waves with books not yet begun, and those books: what `start` can open."""
    nxt = {b["slug"] for b, _ in next_wave(st)}
    fresh = {b["slug"] for b, s in st if s == "no-source"} - nxt
    return {w["name"]: todo for w in wave_table() if (todo := [s for s in w["slugs"] if s in fresh])}


def actions(st: list[tuple[dict, str]]) -> list[dict]:
    """Buttons for the dashboard: {"id", "label", "confirm", "cmd"}; it runs cmd here when one is pressed.

    Every wave not begun yet can be started by hand (the dashboard puts these on the wave strip)."""
    return [{"id": f"start:{name}", "label": f"{name} 시작", "cmd": f"python tools/pipeline.py start {name}",
             "confirm": f"{name} {len(todo)}권 제작을 지금 시작할까요? 지금 웨이브가 끝나기를 기다리지 않습니다."}
            for name, todo in closed(st).items()]


def panel() -> dict:
    st = states()
    nxt = {b["slug"] for b, _ in next_wave(st)}
    by = {b["slug"]: {"slug": b["slug"], "title": b.get("title", b["slug"]) + vol_label(b), "month": b["month"], "stage": s}
          for b, s in st}
    counts: dict[str, int] = {}
    for _, s in st:
        counts[s] = counts.get(s, 0) + 1
    waves = []
    for w in wave_table():
        items = [by[s] for s in w["slugs"] if s in by]
        if items:
            waves.append({"name": w["name"], "months": w["months"], "books": items,
                          "current": any(b["slug"] in nxt for b in items),
                          "done": all(b["stage"] == "deployed" for b in items)})
    # When the catalog has moved on from the PIPELINE.md table, show the wave pipeline.py actually runs.
    # Waves opened with `start` keep their own place in the strip.
    early = set(config().get("started") or {})
    rest = nxt - {b["slug"] for w in waves if w["name"] in early for b in w["books"]}
    listed = {b["slug"] for w in waves if w["current"] and w["name"] not in early for b in w["books"]}
    if rest and rest != listed:
        months = sorted({by[s]["month"] for s in rest})
        merged = lambda w: w["current"] and w["name"] not in early  # noqa: E731
        at = next((i for i, w in enumerate(waves) if merged(w)), len(waves))
        waves = [w for w in waves if not merged(w)]
        waves.insert(at, {"name": "현재", "months": f"{months[0]} – {months[-1]}",
                          "books": [by[s] for s in by if s in rest], "current": True, "done": False})
    return {"title": "Sisyphus Library", "counts": counts, "total": len(st), "waves": waves, "actions": actions(st)}


def run(*cmd: str) -> None:
    print("$", " ".join(cmd), flush=True)
    if subprocess.run(cmd, cwd=ROOT).returncode:
        sys.exit(f"failed: {' '.join(cmd)}")


def push(tries: int = 4, wait: int = 30) -> None:
    """git push origin main, retried a few times: a brief network outage should not strand the wave."""
    for n in range(1, tries + 1):
        print("$ git push origin main", flush=True)
        if not subprocess.run(["git", "push", "origin", "main"], cwd=ROOT).returncode:
            return
        if n < tries:
            print(f"push failed; retrying in {wait * n}s", flush=True)
            time.sleep(wait * n)
    sys.exit("failed: git push origin main")


def deploy(dry: bool) -> None:
    wave = next_wave(states())
    books = [b for b, s in wave if s == "reviewed"]
    if not books:
        sys.exit("no reviewed books in the wave")
    slugs = [b["slug"] for b in books]
    for slug in slugs:
        if errs := check(slug):
            sys.exit(f"{slug}: check_glossary fails: {errs[0]}")
    run(sys.executable, "tools/build.py")
    paths = ["content/books.json"] + [f"content/{d}/{s}.{e}" for s in slugs
                                      for d, e in (("sources", "txt"), ("glossary", "json"))]
    titles = ", ".join(b.get("title", b["slug"]) for b in books)
    msg = f"Add {len(books)} books: {titles}\n\nCo-Authored-By: Claude <noreply@anthropic.com>"
    if dry:
        print("dry run; would commit", paths, "\n" + msg)
        return
    run("git", "add", "--", *paths)
    # A deploy whose push failed left its commit behind; on the retry there is nothing new to commit.
    if subprocess.run(["git", "diff", "--cached", "--quiet", "--", *paths], cwd=ROOT).returncode:
        run("git", "commit", "-m", msg)
    else:
        print("nothing new to commit; pushing the existing commit", flush=True)
    push()
    # PIPELINE.md is local (git-ignored): record the deploy and the new status.
    p = ROOT / "PIPELINE.md"
    try:
        text = p.read_text(encoding="utf-8")
        today = datetime.date.today().isoformat()
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True,
                             text=True).stdout.strip()
        text = text.rstrip("\n") + f"\n- {today} — {', '.join(slugs)} (commit {sha}).\n"
        counts: dict[str, int] = {}
        for _, s in states():
            counts[s] = counts.get(s, 0) + 1
        status = " · ".join(f"{k}: {counts.get(k, 0)}" for k in
                            ["deployed", "reviewed", "unreviewed", "failing", "no-glossary", "no-source"])
        text = re.sub(r"(## Status\n)[^\n]*", lambda m: m.group(1) + f"{status} ({today}).", text, count=1)
        p.write_text(text, encoding="utf-8")
    except OSError:
        pass
    print("deployed", len(slugs))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "mark-reviewed":
        books = catalog()
        today = datetime.date.today().isoformat()
        by = {b["slug"]: b for b in books}
        for slug in sys.argv[2:]:
            if check(slug):
                sys.exit(f"{slug}: check_glossary fails; not marked")
            by[slug]["reviewed"] = today
        BOOKS.write_text(json.dumps(books, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("reviewed", len(sys.argv) - 2)
        return
    if cmd in ("feed", "panel"):
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(feed() if cmd == "feed" else panel(), ensure_ascii=False))
        return
    if cmd == "deploy":
        deploy("--dry-run" in sys.argv)
        return
    st = states()
    if cmd == "start":
        can = closed(st)
        name = sys.argv[2] if len(sys.argv) > 2 else next(iter(can), None)
        if not name:
            sys.exit("no wave left to start")
        if name not in {w["name"] for w in wave_table()}:
            sys.exit(f"unknown wave {name}")
        if name not in can:
            sys.exit(f"{name} is already open or finished")
        save_started({**(config().get("started") or {}), name: datetime.date.today().isoformat()})
        print(f"{name} 시작 · {len(can[name])}권")
        return
    wave = next_wave(st)
    if cmd == "next":
        for b, s in wave:
            w = words(b["slug"])
            print(f"{b['slug']}\t{s}\t{b['month']}\t{w or '-'} words{'\tLONG' if w > LONG else ''}")
        return
    counts: dict[str, int] = {}
    for _, s in st:
        counts[s] = counts.get(s, 0) + 1
    order = ["deployed", "reviewed", "unreviewed", "failing", "no-glossary", "no-source"]
    print("  ".join(f"{k}: {counts.get(k, 0)}" for k in order))
    print("next wave:", ", ".join(b["slug"] for b, _ in wave) or "(none — all deployed)")


if __name__ == "__main__":
    main()
