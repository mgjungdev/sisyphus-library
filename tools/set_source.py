"""Record source ids in content/books.json: python tools/set_source.py slug=id [slug=id ...]"""
import json
import sys
from pathlib import Path

path = Path(__file__).resolve().parent.parent / "content" / "books.json"
books = json.loads(path.read_text(encoding="utf-8"))
by = {b["slug"]: b for b in books}
for arg in sys.argv[1:]:
    slug, gid = arg.split("=")
    by[slug]["gutenberg"] = int(gid)
path.write_text(json.dumps(books, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print("updated", len(sys.argv) - 1)
