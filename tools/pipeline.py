"""Book pipeline state, derived from files on disk.

Usage:
  python tools/pipeline.py status                 counts per stage + the next wave
  python tools/pipeline.py next                   slugs of the next wave with their stage (empty = all done)
  python tools/pipeline.py mark-reviewed <slug>…  record "reviewed": <today> in content/books.json

Stages: no-source → no-glossary → failing → unreviewed → reviewed → deployed.
A wave is every book already in progress; when none is, the next two shelf-months without sources.
"""
import datetime
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_glossary import check  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"
BOOKS = CONTENT / "books.json"
LONG = 12000  # words; writers work from tools/candidates.py above this


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
    # Finish books already in progress before starting new ones.
    started = [(b, s) for b, s in todo if s != "no-source"]
    if started:
        return started
    months = sorted({b["month"] for b, _ in todo})[:2]
    return [(b, s) for b, s in todo if b["month"] in months]


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
    st = states()
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
