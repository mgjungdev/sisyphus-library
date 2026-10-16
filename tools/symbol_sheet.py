"""Review sheet for the cover symbols (docs/symbols/PLAN.md): every symbol on its cover cloth at cover size, and as the
map's badge at the sizes it is seen at, on the light and the dark page. The genre motifs it replaces stand beside it.

Usage:
  python tools/symbol_sheet.py <work> [<work> ...] [--name NAME] [--png]
  python tools/symbol_sheet.py --step S2-01 [--png]       the works of a step in docs/symbols/steps.json
  python tools/symbol_sheet.py --all [--png]              every symbol drawn so far

Writes docs/symbols/sheets/<name>.html (and .png with --png, for looking at it without a browser). A work without a
symbol yet shows its genre motif only.
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SYMBOLS = ROOT / "content" / "symbols"
SHEETS = ROOT / "docs" / "symbols" / "sheets"
STEPS = ROOT / "docs" / "symbols" / "steps.json"
SVG = re.compile(r'<svg[^>]*viewBox="([^"]+)"[^>]*>(.*)</svg>', re.S)
NOTE = re.compile(r"<!--(.*?)-->", re.S)
GILT = 'fill="none" stroke="currentColor" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"'


def works() -> dict:
    """work -> its first volume's catalog row (title, author, genre, spine, cover)."""
    cat = json.loads((ROOT / "content" / "books.json").read_text(encoding="utf-8"))
    out = {}
    for b in cat if isinstance(cat, list) else cat["books"]:
        out.setdefault(b.get("series") or b["slug"], b)
    return out


def motifs() -> dict:
    """The genre motifs of site/js/art.js: name -> (viewBox, body)."""
    js = (ROOT / "site" / "js" / "art.js").read_text(encoding="utf-8")
    block = js[js.index("export const MOTIFS"):js.index("};", js.index("export const MOTIFS"))]
    out = {}
    for m in re.finditer(r"(\w+): S\('([^']+)', `<g \$\{G\}>(.*?)</g>`\)", block, re.S):
        body = re.sub(r"\$\{Array\.from.*?\.join\(''\)\}", "", m.group(3), flags=re.S)  # comb's teeth: not worth evaluating
        out[m.group(1)] = (m.group(2), body)
    return out


def symbol(work: str):
    f = SYMBOLS / f"{work}.svg"
    if not f.exists():
        return None
    text = f.read_text(encoding="utf-8")
    m = SVG.search(text)
    note = NOTE.search(text)
    return (m.group(1), m.group(2)) if m else None, (note.group(1).strip() if note else "")


def svg(vb_body, w: float) -> str:
    vb, body = vb_body
    return f'<svg viewBox="{vb}" aria-hidden="true"><g {GILT.format(w=w)}>{body}</g></svg>'


def card(work: str, row: dict, M: dict) -> str:
    got = symbol(work)
    art, note = got if got else (None, "")
    cloth, gilt = row["spine"]["color"], row["cover"].get("accent", "#c9a24a")
    motif = M.get(row["cover"].get("motif"), M.get("leaf"))
    main = art or motif
    badges = "".join(f'<span class="badge" style="--d:{d}px">{svg(main, 4.2)}</span>' for d in (64, 36, 22))
    return f"""<article style="--cloth:{cloth};--gilt:{gilt}">
  <div class="cover">{svg(main, 2.2)}<b>{html.escape(row['title'])}</b><i>{html.escape(row['author'])}</i></div>
  <div class="side">
    <h2>{html.escape(row['title'])}</h2>
    <p class="meta">{html.escape(work)} · {html.escape(row['genre'])}{'' if art else ' · <em>no symbol yet</em>'}</p>
    {f'<p class="note">{html.escape(note)}</p>' if note else ''}
    <div class="row light">{badges}</div>
    <div class="row dark">{badges}</div>
    <div class="was"><span class="badge" style="--d:36px">{svg(motif, 4.2)}</span><span>genre motif ({html.escape(row['cover'].get('motif', ''))})</span></div>
  </div>
</article>"""


PAGE = """<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
:root {{ --bg:#f3f1ea; --ink:#1d2321; --ink2:#5b625e; --rule:#d9d5c9; }}
body {{ margin:0; padding:24px 16px 48px; background:var(--bg); color:var(--ink); font:15px/1.45 Georgia, serif; }}
h1 {{ font-weight:400; margin:0 0 20px; }}
main {{ display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%, 460px), 1fr)); gap:18px; }}
article {{ display:flex; gap:16px; padding:14px; border:1px solid var(--rule); border-radius:12px; background:#fbfaf6; }}
.cover {{ flex:none; width:150px; height:220px; border-radius:3px 8px 8px 3px; background:linear-gradient(90deg, rgba(0,0,0,.25), rgba(0,0,0,0) 8%), var(--cloth);
  color:var(--gilt); display:flex; flex-direction:column; align-items:center; padding:18px 12px; box-sizing:border-box; text-align:center; box-shadow:0 2px 8px rgba(0,0,0,.25); }}
.cover svg {{ width:96px; height:84px; margin:auto 0; }}
.cover b {{ order:-1; font-size:13px; font-weight:400; }} .cover i {{ font-size:11px; }}
.side {{ min-width:0; }} .side h2 {{ margin:0; font-size:18px; font-weight:400; font-style:italic; }}
.meta {{ margin:2px 0 6px; font:12px system-ui, sans-serif; color:var(--ink2); }}
.note {{ margin:0 0 8px; font-size:13.5px; }}
.row {{ display:flex; align-items:center; gap:14px; padding:8px 10px; border-radius:8px; }}
.row.light {{ background:#ece9df; }} .row.dark {{ background:#151917; margin-top:6px; }}
.badge {{ width:var(--d); height:var(--d); border-radius:50%; flex:none; display:grid; place-items:center; color:var(--gilt);
  background:radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--cloth), #fff 14%), color-mix(in srgb, var(--cloth), #000 12%));
  box-shadow:inset 0 0 0 calc(var(--d) * .035) var(--gilt), 0 1px 3px rgba(0,0,0,.35); }}
.badge svg {{ width:62%; height:62%; }}
.was {{ display:flex; align-items:center; gap:8px; margin-top:8px; font:12px system-ui, sans-serif; color:var(--ink2); }}
</style>
<h1>{title}</h1>
<main>
{cards}
</main>
</html>
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("works", nargs="*")
    ap.add_argument("--step")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--name")
    ap.add_argument("--png", action="store_true")
    a = ap.parse_args()
    W = works()
    if a.step:
        step = next((s for s in json.loads(STEPS.read_text(encoding="utf-8"))["steps"] if s["code"] == a.step), None)
        if not step:
            sys.exit(f"no step {a.step}")
        names, name = step.get("works", []), a.name or a.step
    elif a.all:
        names, name = sorted(f.stem for f in SYMBOLS.glob("*.svg")), a.name or "all"
    else:
        names, name = a.works, a.name or "sheet"
    missing = [w for w in names if w not in W]
    if missing:
        sys.exit(f"not in content/books.json: {', '.join(missing)}")
    M = motifs()
    SHEETS.mkdir(parents=True, exist_ok=True)
    out = SHEETS / f"{name}.html"
    out.write_text(PAGE.format(title=html.escape(f"Cover symbols · {name}"), cards="\n".join(card(w, W[w], M) for w in names)), encoding="utf-8")
    print(out)
    if a.png:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = p.chromium.launch()
            pg = b.new_page(viewport={"width": 1000, "height": 800}, device_scale_factor=1.5)
            pg.goto(out.resolve().as_uri())
            pg.screenshot(path=str(out.with_suffix(".png")), full_page=True)
            b.close()
        print(out.with_suffix(".png"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
