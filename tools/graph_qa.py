"""Browser QA for the library site (docs/graph/PLAN.md §7). Serves site/ on a free port in a thread, drives
headless Chromium with Playwright, and closes both before exiting.

Usage:
  python tools/graph_qa.py --smoke                          #/, #/graph, #/read/frankenstein-1 open without console/page errors
  python tools/graph_qa.py --shot <hash> [--w 1280 --h 800] [--out name]   screenshot to logs/graph-shots/<name>.png
  python tools/graph_qa.py --eval <hash> <js>               run JS in the page, print the result as JSON
  python tools/graph_qa.py --node <slug> [--w --h]          #/graph: click the book's node with the mouse, check the
                                                            pull-out panel, press Read, expect #/read/<slug>
  python tools/graph_qa.py --author <slug> [--w --h]        #/graph: hover the author's medal (tooltip), click it: the
                                                            camera takes in the author and its books beside the
                                                            author panel (name, books, #/graph/<slug>); a book in the
                                                            panel -> its pull-out -> Read -> #/read/<book>; then the
                                                            search finds the author by name
  python tools/graph_qa.py --authordoc <slug> [--w --h]     author medal -> panel 'About the author' -> #/author/<slug>
                                                            (reader's type and measure, sections, books, sources) ->
                                                            a book -> the reader (title page links back) and 'In the
                                                            graph'; night theme and 390px shots
  python tools/graph_qa.py --link <from> <to> [--w --h]     #/graph: hover and click the middle of the relation line (tip/popover head: "A answers B" + definition)
                                                            (work slugs), check tooltip and popover, follow a passage
  python tools/graph_qa.py --pair <from> <to> [--w --h]     line popover -> 'Read side by side' -> #/pair/<reading>: both books
                                                            (side by side; one above the other under 720px), passages
                                                            marked, pair 1 on the reading line in both, wheel one pane
                                                            -> the other follows to the counterpart (both ways, in
                                                            proportion between pairs), next-pair button; G4-02-pair-*.png
  python tools/graph_qa.py --controls [--w --h]             #/graph/frankenstein-1 focus, search, genre/relation chips,
                                                            year slider; controls must not overlap
  python tools/graph_qa.py --appendix <slug> [--expect <slug>] [--w --h]   #/read/<slug> (a last volume): Contents ->
                                                            Appendix -> the appendix page after "The End"; with
                                                            --expect, click its link to #/read/<expect>
  python tools/graph_qa.py --toggle [--w --h]               top-bar switch: #/ -> #/graph -> #/ by mouse, books fly
                                                            shelf <-> node at >= 55 fps once they set off (the
                                                            switch's own longest frame is printed), all land, reduced motion
                                                            crossfades, top bar items must not overlap
  python tools/graph_qa.py --timeline [--w --h]            Web -> Timeline -> Web by the switch in the corner: books glide
                                                            (no step over a tenth of the way), axis fades in, >= 50 fps,
                                                            relations and years run left to right, back in place; kept
                                                            for the next visit; reduced motion at once; G4-03-*.png
  python tools/graph_qa.py --modes                          the 3D map turns by itself until touched (not under reduced
                                                            motion); the 2D | 3D switch draws the other engine and is
                                                            remembered; without WebGL the map is drawn in 2D
  python tools/graph_qa.py --g2                             G2 items of PLAN.md §7 (margin mark -> jump, appendix link, Show in the graph
                                                            -> focus) at 1280 and 390, then --g1
  python tools/graph_qa.py --g1                             every G1 check of PLAN.md §7: node count (books + authors), console errors,
                                                            frame rate (rAF), node -> Read, line popover -> passage,
                                                            toggle, touch pinch-zoom and pan at 390px; then the
                                                            G1-*.png screenshots (1280 and 390, light and dark; G1-2d-*.png with --view 2d)

<hash> is e.g. "#/graph" or "/graph"; ?drafts=1 is added automatically. The map is drawn in 3D (graph3d.js) unless
--view 2d adds ?view=2d (graph2d.js, the path for browsers without WebGL); every check runs in either. --layout timeline
adds ?layout=timeline: the map opens on the timeline (for this visit; the switch in the corner keeps the choice).
"""
import argparse
import functools
import http.server
import json
import re
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
SHOTS = ROOT / "logs" / "graph-shots"
SMOKE = ["#/", "#/graph", "#/read/frankenstein-1"]
SETTLE_MS = 1500
VIEW = ""  # "&view=2d" with --view 2d
GPU_ARGS = ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu"]


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 128  # the default backlog of 5 refuses connections when the page loads its modules at once


def serve():
    handler = functools.partial(Quiet, directory=str(SITE))
    httpd = Server(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def norm(h: str) -> str:
    h = h.lstrip("#")
    return "#" + (h if h.startswith("/") else "/" + h)


def open_page(browser, base, h, w=1280, ht=800, errors=None, **opts):
    ctx = browser.new_context(viewport={"width": w, "height": ht}, service_workers="block", **opts)
    page = ctx.new_page()
    if errors is not None:
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("requestfailed", lambda r: errors.append(f"requestfailed: {r.url} {r.failure}"))
        page.on("response", lambda r: errors.append(f"http {r.status}: {r.url}") if r.status >= 400 else None)
    page.goto(f"{base}/?drafts=1{VIEW}{norm(h)}", wait_until="load")
    page.wait_for_timeout(SETTLE_MS)
    return ctx, page


NODE_POS = """slug => {
  const st = document.querySelector('.graph-stage'), n = st.nodeIds().find(n => n.slug === slug);
  const p = n && st.screenOf(n.id);
  return p ? { id: n.id, x: p.x, y: p.y, mode: st.mode } : null;
}"""


def node_read(browser, base, slug, w, h) -> int:
    """Mouse-click a node, check the pull-out panel, press Read. Returns 0 when it lands on #/read/<slug>."""
    errs = []
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    page.wait_for_timeout(2500)  # let the map settle so the node stays under the pointer
    pos = page.evaluate(NODE_POS, slug)
    if not pos:
        print(f"FAIL no node for {slug}")
        ctx.close()
        return 1
    page.mouse.move(pos["x"], pos["y"])
    page.wait_for_timeout(150)
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_selector("#flight-layer.show-info .flight-info", timeout=5000)
    page.wait_for_timeout(400)
    info = page.evaluate("""() => {
      const L = document.getElementById('flight-layer');
      return { title: L.querySelector('#fi-title')?.textContent, by: L.querySelector('.by')?.textContent,
               cover: !!L.querySelector('.fbook .cover-art'), hash: location.hash,
               links: [...L.querySelectorAll('.fi-links [data-pick]')].map(b => b.dataset.pick) };
    }""")
    print("node ", pos["id"], "clicked at", round(pos["x"]), round(pos["y"]), pos["mode"])
    print("panel", json.dumps(info, ensure_ascii=False))
    SHOTS.mkdir(parents=True, exist_ok=True)
    shot = SHOTS / f"node-{slug}-{w}.png"
    page.screenshot(path=str(shot))
    print("shot ", shot)
    page.click("#flight-layer [data-act=read]")
    page.wait_for_function("() => location.hash.startsWith('#/read/')", timeout=5000)
    page.wait_for_selector(".reader, [data-view=reader]", timeout=5000)
    page.wait_for_timeout(600)
    end = page.evaluate("() => ({ hash: location.hash, view: document.body.dataset.view, layer: document.getElementById('flight-layer').className })")
    print("read ", json.dumps(end))
    ctx.close()
    ok = (info["title"] and info["cover"] and info["hash"] == "#/graph" and end["hash"] == f"#/read/{slug}"
          and end["view"] == "reader" and not errs)
    for e in errs:
        print("   ", e)
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


def author_panel(browser, base, slug, w, h) -> int:
    """Hover and mouse-click an author's medal; check the panel and the framing; open its first book from the panel and
    press Read; then find the author by name in the search. Returns 0 when every step holds."""
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    errs = []
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    page.wait_for_timeout(2500)
    pos = page.evaluate("""slug => {
      const st = document.querySelector('.graph-stage'), n = st.nodeIds().find(n => n.author && n.slug === slug);
      const p = n && st.screenOf(n.id);
      return p ? { id: n.id, x: p.x, y: p.y, mode: st.mode } : null;
    }""", slug)
    if not pos:
        print(f"FAIL no author node for {slug}")
        ctx.close()
        return 1
    page.mouse.move(pos["x"], pos["y"])
    page.wait_for_timeout(350)
    tip = page.evaluate("() => { const t = document.querySelector('.graph-tip'); return t.hidden ? null : t.textContent; }")
    check("hover tooltip", tip and "book" in tip, repr(tip))
    lit = page.evaluate("""id => { const st = document.querySelector('.graph-stage');
      return { lit: st.state().lit.sort(), want: [id, ...st.booksOf(id)].sort() }; }""", pos["id"])
    check("hover lights the author and its books only", lit["lit"] == lit["want"], f"{len(lit['lit'])} lit, {len(lit['want'])} wanted")
    page.mouse.click(pos["x"], pos["y"])
    page.wait_for_selector(".graph-author:not([hidden])", timeout=5000)
    page.wait_for_timeout(1100)  # the camera takes in the author and its books
    info = page.evaluate("""id => {
      const st = document.querySelector('.graph-stage'), el = document.querySelector('.graph-author');
      const r = el.getBoundingClientRect(), sheet = el.classList.contains('is-sheet');
      const books = [...el.querySelectorAll('[data-book]')].map(b => b.dataset.book);
      const at = [id, ...books].map(i => st.screenOf(i)).filter(Boolean);
      // Every shown book and the medal on screen, clear of the panel.
      const clear = at.every(p => p.x >= 0 && p.y >= 56 && p.x <= innerWidth && p.y <= innerHeight
        && (sheet ? p.y < r.top : p.x < r.left));
      return { name: el.querySelector('#ga-name')?.textContent, life: el.querySelector('.ga-life')?.textContent || '',
        books, titles: [...el.querySelectorAll('[data-book] .t')].map(t => t.textContent), about: !!el.querySelector('.ga-about'),
        more: el.querySelector('.ga-more')?.getAttribute('href') || null, hash: location.hash, pin: st.state().pin,
        clear, sheet };
    }""", pos["id"])
    print("author", pos["id"], "clicked at", round(pos["x"]), round(pos["y"]), pos["mode"])
    print("panel ", json.dumps(info, ensure_ascii=False))
    check("panel", info["name"] and info["books"], f"{info['name']} {info['life']}, {len(info['books'])} books")
    check("focus", info["hash"] == f"#/graph/{slug}" and info["pin"] == pos["id"], info["hash"])
    check("framed beside the panel", info["clear"])
    SHOTS.mkdir(parents=True, exist_ok=True)
    shot = SHOTS / f"author-{slug}-{w}.png"
    page.screenshot(path=str(shot))
    print("shot  ", shot)
    first = info["books"][0]
    page.click(f".graph-author [data-book='{first}']")
    page.wait_for_selector("#flight-layer.show-info .flight-info", timeout=6000)
    page.wait_for_timeout(400)
    title = page.evaluate("() => document.querySelector('#flight-layer #fi-title')?.textContent")
    check("book from the panel", title and info["titles"][0].startswith(title), repr(title))  # the shelf may use a shorter title
    want = page.evaluate("id => document.querySelector('.graph-stage').nodeIds().find(n => n.id === id)?.slug", first)
    page.click("#flight-layer [data-act=read]")
    page.wait_for_function("() => location.hash.startsWith('#/read/')", timeout=5000)
    page.wait_for_timeout(500)
    end = page.evaluate("() => location.hash")
    check("Read", end == f"#/read/{want}", end)
    ctx.close()
    # The search finds the author by the last word of its name, first among the hits.
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    word = info["name"].split()[-1]
    page.fill(".gc-search input", word)
    page.wait_for_timeout(1200)
    found = page.evaluate("() => ({ hash: location.hash, first: document.querySelector('.gc-hits li b')?.textContent })")
    check("search", found["hash"] == f"#/graph/{slug}" and found["first"] == info["name"], f"{word!r} -> {json.dumps(found, ensure_ascii=False)}")
    ctx.close()
    for e in errs:
        print("   ", e)
    check("console errors", not errs)
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


TIP = """() => { const t = document.querySelector('.graph-tip'), c = t.querySelector('.tip-claim');
  return { shown: !t.hidden, pair: t.querySelector('.tip-pair')?.textContent, def: t.querySelector('.tip-def')?.textContent,
           claim: c?.textContent, oneLine: c ? c.getClientRects().length === 1 && c.offsetHeight < 30 : false }; }"""


def open_line_pop(page, a, b):
    """Hover the middle of the line a–b (further along it when a book or medal covers the middle), click it and wait
    for the popover. Returns (pos, tip) or None."""
    pos = page.evaluate("([a, b]) => document.querySelector('.graph-stage').linkMid(a, b)", [f"work:{a}", f"work:{b}"])
    if not pos:
        print(f"FAIL no line {a} -> {b}")
        return None
    page.mouse.move(pos["x"], pos["y"])
    page.wait_for_timeout(250)
    # The map may still be drifting: read the middle again and hover there before reading the tooltip.
    pos = page.evaluate("([a, b]) => document.querySelector('.graph-stage').linkMid(a, b)", [f"work:{a}", f"work:{b}"])
    page.mouse.move(pos["x"], pos["y"])
    page.wait_for_timeout(60)
    tip = page.evaluate(TIP)
    if tip["shown"] and not tip["pair"]:  # a medal or book drawn over the line's middle (a crowded overview)
        print("info ", "under the line's middle:", " ".join(page.evaluate("() => document.querySelector('.graph-tip').textContent").split())[:60],
              "- trying further along the line")
        ALONG = """([a, b, end, t]) => { const st = document.querySelector('.graph-stage'), m = st.linkMid(a, b), e = st.screenOf(end === 0 ? a : b);
          return m && e ? { x: m.x + (e.x - m.x) * t, y: m.y + (e.y - m.y) * t } : m; }"""
        for end, t in ((0, 0.4), (1, 0.4), (0, 0.65), (1, 0.65), ("zoom", 0), (0, 0), (0, 0.4), (1, 0.4), (0, 0.65), (1, 0.65)):
            if end == "zoom":  # the whole line is under books and medals: zoom in on it, as a reader would
                print("info ", "zooming in on the line")
                for _ in range(4):
                    page.mouse.wheel(0, -120)
                    page.wait_for_timeout(120)
                page.wait_for_timeout(900)
                continue
            pos = page.evaluate(ALONG, [f"work:{a}", f"work:{b}", end, t])
            page.mouse.move(pos["x"], pos["y"])
            page.wait_for_timeout(250)
            pos = page.evaluate(ALONG, [f"work:{a}", f"work:{b}", end, t])
            page.mouse.move(pos["x"], pos["y"])
            page.wait_for_timeout(60)
            tip = page.evaluate(TIP)
            if tip["pair"]:
                break
    print("tip  ", json.dumps(tip, ensure_ascii=False))
    page.mouse.click(pos["x"], pos["y"])
    try:
        page.wait_for_selector(".graph-pop:not([hidden]) .gp-claim", timeout=5000)
    except Exception:
        got = page.evaluate("() => ({ hash: location.hash, book: !!document.querySelector('#flight-layer.show-info .flight-info'), author: document.querySelector('.graph-author:not([hidden]) h2, .graph-author:not([hidden]) .ga-name')?.textContent })")
        print(f"FAIL the click at {pos['x']:.0f},{pos['y']:.0f} opened no popover:", json.dumps(got, ensure_ascii=False))
        return None
    page.wait_for_timeout(700)  # the camera brings the line up; the popover follows it
    return pos, tip


def link_pop(browser, base, a, b, w, h) -> int:
    """Hover, then mouse-click the middle of the relation line a–b (slugs of the note's from/to works); check the
    tooltip and popover head say who does what to whom ('A answers B', from -> to) with the kind's definition, the
    popover (claim, passage pairs, question, tabs), then follow the first "To this passage" link."""
    errs = []
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    page.wait_for_timeout(2500)
    got = open_line_pop(page, a, b)
    if not got:
        ctx.close()
        return 1
    pos, tip = got
    POP = """() => { const P = document.querySelector('.graph-pop'), r = P.getBoundingClientRect();
      const st = document.querySelector('.graph-stage'), fg = st.graph;
      return { pair: P.querySelector('.gp-pair')?.textContent, def: P.querySelector('.gp-def')?.textContent,
               contact: P.querySelector('.gp-contact')?.textContent, claim: P.querySelector('.gp-claim')?.textContent,
               pairs: P.querySelectorAll('.gp-pairs > li').length, same: P.querySelectorAll('.gp-line').length,
               links: [...P.querySelectorAll('.gp-psg a')].map(a => a.getAttribute('href')),
               question: P.querySelector('.gp-q p')?.textContent,
               tabs: [...P.querySelectorAll('.gp-tabs button')].map(b => b.textContent.trim()),
               sheet: P.classList.contains('is-sheet'), box: [r.left, r.top, r.width, r.height].map(Math.round),
               hash: location.hash }; }"""
    info = page.evaluate(POP)
    # The sentence the head should read (the note's from, the kind's verb, its to) and the kind's definition, from the
    # one place they are written: RELATION_KINDS in site/js/catalog.js.
    want = page.evaluate("""async ([a, b]) => { const C = await import(new URL('js/catalog.js', location.href).href);
      const G = await C.loadGraph(), n = G.notes.find(n => n.from === a && n.to === b);
      if (!n) return null;
      const x = C.relationSentence(G, n);
      return { sentence: `${x.from} ${x.verb} ${x.to}`, name: x.name, def: x.def, mode: x.mode }; }""", [f"work:{a}", f"work:{b}"])
    print("want ", json.dumps(want, ensure_ascii=False))
    sq = lambda t: " ".join((t or "").split())
    said = (want and want["def"] and sq(info["pair"]) == want["sentence"] and sq(tip["pair"]) == want["sentence"]
            and sq(info["def"]).startswith(want["name"]) and want["def"] in sq(info["def"]) and want["def"] in sq(tip["def"])
            and (not want["mode"] or want["mode"].replace("-", " ") in sq(info["def"])) and bool(sq(info["contact"])))
    print("said ", "ok" if said else "FAIL (direction sentence / definition in the tooltip and popover head)")
    mid = page.evaluate("([a, b]) => document.querySelector('.graph-stage').linkMid(a, b)", [f"work:{a}", f"work:{b}"])
    print("pop  ", json.dumps(info, ensure_ascii=False))
    print("mid  ", round(mid["x"]), round(mid["y"]))
    SHOTS.mkdir(parents=True, exist_ok=True)
    shot = SHOTS / f"link-{a}-{b}-{w}.png"
    page.screenshot(path=str(shot))
    print("shot ", shot)
    tab_ok = True
    if len(info["tabs"]) > 1:
        page.click(".gp-tabs button:nth-child(2)")
        page.wait_for_timeout(200)
        other = page.evaluate(POP)
        print("tab2 ", json.dumps({k: other[k] for k in ("claim", "pairs", "question", "tabs")}, ensure_ascii=False))
        page.screenshot(path=str(SHOTS / f"link-{a}-{b}-{w}-tab2.png"))
        tab_ok = other["claim"] != info["claim"]
        page.click(".gp-tabs button:nth-child(1)")
        page.wait_for_timeout(200)
    href = info["links"][0] if info["links"] else None
    if href:
        page.click(".graph-pop .gp-psg a")
        page.wait_for_function("() => location.hash.startsWith('#/read/')", timeout=5000)
        page.wait_for_selector(".reader, [data-view=reader]", timeout=5000)
        page.wait_for_timeout(900)
        para = href.rsplit("/", 1)[-1]
        end = page.evaluate("""p => { const el = document.getElementById('p' + p), r = el?.getBoundingClientRect();
          return { hash: location.hash, view: document.body.dataset.view,
                   visible: !!r && r.bottom > 0 && r.top < innerHeight && r.width > 0 }; }""", para)
        print("read ", json.dumps(end))
    ctx.close()
    ok = (said and tip["shown"] and tip["claim"] and tip["oneLine"] and info["claim"] and info["pairs"] >= 1
          and len(info["links"]) == 2 * info["pairs"] and info["question"] and tab_ok and info["hash"] == "#/graph"
          and href and end["hash"] == href and end["view"] == "reader" and end["visible"] and not errs)
    x, y, pw, ph = info["box"]
    inside = lambda p: x <= p[0] <= x + pw and y <= p[1] <= y + ph
    if not info["sheet"]:  # beside the line, level with its middle, covering neither book nor the middle
        ok = ok and y - 2 <= mid["y"] <= y + ph + 2
    ok = ok and not inside((mid["x"], mid["y"])) and not any(inside(e) for e in mid["ends"])
    for e in errs:
        print("   ", e)
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


PAIR = """() => { const P = document.querySelector('.pair'); if (!P) return null;
  const st = P.pairState(), line = s => { const pane = P.querySelector(`.pv-pane[data-side="${s}"] .pv-scroll`), r = pane.getBoundingClientRect();
    return { top: r.top, left: r.left, h: r.height, w: r.width, at: r.top + r.height * 0.38 }; };
  const markMid = (s, n) => { const m = P.querySelector(`.pv-pane[data-side="${s}"] .pv-mark[data-n="${n}"]`) ||
      [...P.querySelectorAll(`.pv-pane[data-side="${s}"] .pv-al`)].find(p => p.dataset.ns.split(' ').includes(String(n)));
    const r = m?.getBoundingClientRect(); return r ? r.top + r.height / 2 : null; };
  const n = st.cur;
  return { ...st, hash: location.hash, view: document.body.dataset.view, panes: { from: line('from'), to: line('to') },
    marks: P.querySelectorAll('.pv-mark').length, ties: P.querySelectorAll('.pv-ties path').length,
    count: P.querySelector('.pv-count').textContent, lines: P.querySelectorAll('.pv-line').length,
    off: n ? { from: markMid('from', n) - line('from').at, to: markMid('to', n) - line('to').at } : null }; }"""


def pair_view(browser, base, a, b, w, h) -> int:
    """Line popover -> 'Read side by side' -> #/pair/<reading>: both books open (side by side, one above the other
    under 720px), every passage of the reading's alignments marked, the first pair on the reading line in both panes;
    wheel the left (top) pane to the next pair: the other pane follows so the counterpart arrives there too; wheel the
    other pane back: the first follows; the next-pair button moves both; G4-02-pair-*.png shots."""
    fails = []

    def check(name, cond, detail=""):
        print(f"{'ok  ' if cond else 'FAIL'} {name}{(' - ' + detail) if detail else ''}")
        if not cond:
            fails.append(name)

    errs = []
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    page.wait_for_timeout(2500)
    if not open_line_pop(page, a, b):
        ctx.close()
        return 1
    side = page.evaluate("() => document.querySelector('.graph-pop .gp-side')?.getAttribute('href')")
    check("popover has 'Read side by side'", bool(side), str(side))
    if not side:
        ctx.close()
        return 1
    page.click(".graph-pop .gp-side")
    page.wait_for_function("() => document.querySelector('.pair')?.pairState().anchors.length", timeout=8000)
    page.wait_for_timeout(600)
    want = page.evaluate("""async id => { const C = await import(new URL('js/catalog.js', location.href).href);
      const G = await C.loadGraph(), r = [...G.readings.values()].flat().find(r => r.id === 'r:' + id);
      return r ? (r.alignments || []).filter(a => a.from.para && a.to.para).length : null; }""", side.split("/")[2])
    s = page.evaluate(PAIR)
    print("pair ", json.dumps({k: s[k] for k in ("hash", "cur", "marks", "ties", "count", "off", "panes")}, ensure_ascii=False))
    check("hash #/pair/<reading>", s["hash"] == side and s["view"] == "pair", s["hash"])
    check("every pair anchored in both books", want is not None and len(s["anchors"]) == want >= 1, f"{len(s['anchors'])} of {want}")
    check("passages marked", s["marks"] >= (want or 1), f"{s['marks']} marks")
    pf, pt = s["panes"]["from"], s["panes"]["to"]
    if w <= 720:
        check("one above the other", pt["top"] >= pf["top"] + pf["h"] - 2 and abs(pt["left"] - pf["left"]) < 4,
              f"from top {pf['top']:.0f} h {pf['h']:.0f}, to top {pt['top']:.0f}")
    else:
        check("side by side", pt["left"] >= pf["left"] + pf["w"] and abs(pt["top"] - pf["top"]) < 4,
              f"from left {pf['left']:.0f} w {pf['w']:.0f}, to left {pt['left']:.0f}")
        check("ties drawn across the gutter", s["ties"] >= 1, str(s["ties"]))
    check("pair 1 on the reading line in both", s["cur"] == 1 and all(abs(v) < 40 for v in s["off"].values()), json.dumps(s["off"]))
    check("same/differs note", s["lines"] == 2 and s["count"].startswith("1 of"), s["count"])
    SHOTS.mkdir(parents=True, exist_ok=True)
    tag = f"{a}-{b}-{w}"
    page.screenshot(path=str(SHOTS / f"G4-02-pair-{tag}.png"))

    def wheel_to(sd, target):  # wheel the pane with the mouse until its scrollTop reaches target
        js = "s => { const r = document.querySelector(`.pv-pane[data-side=\"${s}\"] .pv-scroll`).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }"
        page.mouse.move(*page.evaluate(js, sd))
        for _ in range(200):
            d = target - page.evaluate(PAIR)["tops"][sd]
            if abs(d) < 3:
                break
            page.mouse.wheel(0, max(-3000, min(3000, d)))
            page.wait_for_timeout(60)
        page.wait_for_timeout(900)  # a long way to the counterpart is eased
        return page.evaluate(PAIR)

    if (want or 0) >= 2:
        page.wait_for_timeout(600)
        s = page.evaluate(PAIR)  # where the pairs are once the text has settled
        a0, a1 = s["anchors"][0], s["anchors"][1]
        t = wheel_to("from", a1["from"])
        print("wheel", json.dumps({k: t[k] for k in ("cur", "lead", "tops", "off")}))
        check("one pane leads, the other follows to pair 2",
              t["lead"] == "from" and t["cur"] == 2 and abs(t["tops"]["to"] - a1["to"]) < 30 and all(abs(v) < 40 for v in t["off"].values()),
              json.dumps(t["off"]))
        page.screenshot(path=str(SHOTS / f"G4-02-pair-{tag}-2.png"))
        t = wheel_to("to", a0["to"])
        print("back ", json.dumps({k: t[k] for k in ("cur", "lead", "tops", "off")}))
        check("the other pane leads back to pair 1", t["lead"] == "to" and t["cur"] == 1 and abs(t["tops"]["from"] - a0["from"]) < 30, json.dumps(t["tops"]))
        # Between two pairs the other book travels from one counterpart to the next, steadily, without overshooting.
        fr = []
        for k in (0.25, 0.5, 0.75):
            t = wheel_to("from", a0["from"] + (a1["from"] - a0["from"]) * k)
            fr.append((t["tops"]["to"] - a0["to"]) / ((a1["to"] - a0["to"]) or 1))
        check("between pairs the follower moves in step", all(-0.02 <= f <= 1.02 for f in fr) and fr == sorted(fr), " ".join(f"{f:.2f}" for f in fr))
        cur0 = t["cur"]
        step, goal = (".pv-next", cur0 + 1) if cur0 < want else (".pv-prev", cur0 - 1)
        page.click(step)
        page.wait_for_timeout(900)
        t = page.evaluate(PAIR)
        check("next/previous-pair buttons move both", t["cur"] == goal and all(abs(v) < 40 for v in t["off"].values()),
              f"{cur0} -> {t['cur']}, off {json.dumps(t['off'])}")
    # 'Open in the reader' opens the book at the current pair's passage.
    href = page.evaluate("""() => { const a = document.querySelector('.pv-pane[data-side="to"] .pv-open');
      a.addEventListener('click', e => e.preventDefault(), { once: true });
      a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return a.getAttribute('href'); }""")
    check("reader link at the passage", bool(re.match(r"#/read/[\w-]+/\d+$", href or "")), str(href))
    page.evaluate("() => { document.documentElement.dataset.theme = 'night'; }")
    page.wait_for_timeout(200)
    page.screenshot(path=str(SHOTS / f"G4-02-pair-{tag}-night.png"))
    ctx.close()
    for e in errs:
        print("   ", e)
    check("no console or page errors", not errs, str(len(errs)))
    print("ok" if not fails else f"FAIL ({', '.join(fails)})")
    return 0 if not fails else 1


STATE = "() => document.querySelector('.graph-stage').state()"
NEAR = """id => { const st = document.querySelector('.graph-stage'), r = st.getBoundingClientRect(), q = st.screenOf(id);
  if (!q) return { x: null, y: null, inside: false };
  const p = { x: q.x - r.left, y: q.y - r.top };
  return { x: Math.round(p.x), y: Math.round(p.y), inside: p.x > 0 && p.x < r.width && p.y > 0 && p.y < r.height }; }"""
BOXES = """() => [...document.querySelectorAll('.graph-head, .gc-search, .gc-toggle, .graph-key')].map(e => {
  const r = e.getBoundingClientRect(); return { el: e.className, l: r.left, t: r.top, r: r.right, b: r.bottom }; })"""


def controls(browser, base, w, h) -> int:
    """#/graph/<slug> focus, title search, genre and relation chips, the year slider; controls must not overlap."""
    errs, ok = [], True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    ctx, page = open_page(browser, base, "#/graph/frankenstein-1", w, h, errors=errs)
    page.wait_for_timeout(2200)
    if not page.evaluate("() => !!document.querySelector('.graph-stage')"):
        print("FAIL no graph:", page.evaluate("() => location.hash + ' ' + document.getElementById('view').textContent.trim().slice(0, 80)"), errs)
        ctx.close()
        return 1
    st = page.evaluate(STATE)
    pos = page.evaluate(NEAR, "work:frankenstein")
    check("focus url", st["pin"] == "work:frankenstein" and pos["inside"], json.dumps({"pin": st["pin"], "zoom": round(st["zoom"], 2), **pos}))
    boxes = page.evaluate(BOXES)
    clash = [(a["el"], b["el"]) for i, a in enumerate(boxes) for b in boxes[i + 1:]
             if a["l"] < b["r"] and b["l"] < a["r"] and a["t"] < b["b"] and b["t"] < a["b"]]
    check("no overlap", not clash and all(b["r"] <= w + 1 and b["l"] >= -1 for b in boxes), json.dumps(clash))
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"controls-focus-{w}.png"))

    # Search: typing moves the camera to the book and puts it in the URL.
    page.fill(".gc-search input", "")
    page.type(".gc-search input", "moreau", delay=40)
    page.wait_for_timeout(1300)
    st = page.evaluate(STATE)
    hits = page.evaluate("() => [...document.querySelectorAll('.gc-hits [data-i] b')].map(b => b.textContent)")
    pos = page.evaluate(NEAR, "work:island-of-doctor-moreau")
    check("search", st["pin"] == "work:island-of-doctor-moreau" and pos["inside"] and st["hash"].startswith("#/graph/island-of-doctor-moreau"),
          json.dumps({"hits": hits[:3], "hash": st["hash"], **pos}))
    page.screenshot(path=str(SHOTS / f"controls-search-{w}.png"))
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)

    # Filters.
    page.click(".gc-toggle")
    page.wait_for_timeout(250)
    genre = "Gothic & Horror"
    page.click(f'.gc-chip[data-group=genre][data-v="{genre}"]')
    page.wait_for_timeout(900)
    st = page.evaluate(STATE)
    check("genre chip", st["genres"] == [genre] and st["visible"] > 0, f"{st['visible']} books, lines {st['lines']}")
    page.screenshot(path=str(SHOTS / f"controls-genre-{w}.png"))
    page.click(".gc-clear")
    rel = page.evaluate("() => document.querySelector('.gc-chip[data-group=rel]')?.dataset.v")
    if rel:
        page.click(f'.gc-chip[data-group=rel][data-v="{rel}"]')
        page.wait_for_timeout(500)
        st = page.evaluate(STATE)
        check("relation chip", 0 < st["lines"] and st["bright"] < st["visible"], f"{rel}: {st['lines']} lines, {st['bright']} bright books")
        page.click(".gc-clear")
    page.evaluate("""() => { const r = document.querySelector('.gc-year input');
      const ys = [...new Set(document.querySelector('.graph-stage').graph.graphData().nodes.map(n => n.year).filter(Boolean))].sort((a, b) => a - b);
      r.value = ys.indexOf(1818); r.dispatchEvent(new Event('input')); r.dispatchEvent(new Event('change')); }""")
    page.wait_for_timeout(900)
    st = page.evaluate(STATE)
    out = page.evaluate("() => document.querySelector('.gc-year output').textContent")
    check("year slider", st["years"] and max(st["years"]) <= 1818 and 1818 in st["years"], f"by {out}: {st['visible']} books")
    page.screenshot(path=str(SHOTS / f"controls-year-{w}.png"))
    page.click(".gc-clear")
    page.wait_for_timeout(200)
    st = page.evaluate(STATE)
    check("clear", st["visible"] == len(st["years"]) and page.evaluate("() => document.querySelector('.gc-badge').hidden"), f"{st['visible']} books")
    ctx.close()
    for e in errs:
        print("   ", e)
    ok = ok and not errs
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


TOPBAR = """() => ['.wordmark', '.arrange', '.view-switch', '.topbar-actions a[data-nav=settings]'].map(sel => {
  const el = document.querySelector(sel); if (!el || !el.offsetParent) return null;
  const r = el.getBoundingClientRect(); return { el: sel, l: r.left, r: r.right };
}).filter(Boolean)"""
SWITCH = """() => ({ hash: location.hash, view: document.body.dataset.view, on: document.querySelector('.view-switch').dataset.on,
  current: [...document.querySelectorAll('.view-switch [aria-current=page]')].map(a => a.dataset.nav),
  layers: document.querySelectorAll('.view-leave').length, canvas: !!document.querySelector('.graph-stage canvas'),
  books: document.querySelectorAll('#view .book').length, flyers: document.querySelectorAll('.fly').length,
  out: document.querySelectorAll('#view .book.is-out').length,
  away: document.querySelector('#view .graph-stage')?.state?.().away ?? null,
  faded: [...document.querySelectorAll('#view .book')].filter(b => getComputedStyle(b).opacity !== '1').length })"""
# Every frame of a switch, for ms: whether the old view was still fading in its layer, books in the air, nodes hidden
# while their books fly. A fixed moment would be missed when the new view takes the main thread for a while.
MID = """ms => { window.__mid = []; const t0 = performance.now();
  const tick = t => { const st = document.querySelector('#view .graph-stage')?.state?.();
    window.__mid.push({ layers: document.querySelectorAll('.view-leave').length, flyers: document.querySelectorAll('.fly').length,
      away: st ? st.away : null, on: document.querySelector('.view-switch').dataset.on, books: document.querySelectorAll('#view .book').length,
      out: document.querySelectorAll('#view .book.is-out').length });
    if (t - t0 < ms) requestAnimationFrame(tick); };
  requestAnimationFrame(tick); }"""
MID_SEEN = """want => { const w = window.__mid || [], hit = w.find(s => Object.entries(want).every(([k, v]) => v === '+' ? s[k] > 0 : s[k] === v));
  return { frames: w.length, hit: hit || null }; }"""


def mid_seen(page, want):
    """The first recorded frame of the switch that matches want, waiting for it to be recorded."""
    try:
        page.wait_for_function(f"want => ({MID_SEEN})(want).hit", arg=want, timeout=2500)
    except Exception:
        pass
    return page.evaluate(MID_SEEN, want)


# Frame rate while the books are in the air (from the frame they set off, .fly-layer[data-go], for ms): frames counted
# and the longest gap between two; and, apart, the longest frame of the switch before that (the new view being built).
FLIGHT_FPS = """ms => { window.__fly = new Promise(done => { let n = 0, gap = 0, stall = 0, t0 = 0, last = performance.now();
  const begun = last;
  const tick = t => {
    if (!t0) {
      stall = Math.max(stall, t - last); last = t;
      if (document.querySelector('.fly-layer[data-go]')) t0 = t;
      else if (t - begun > 4000) return done({ fps: 0, gap: 0, stall: Math.round(stall) }); // never set off
      return requestAnimationFrame(tick);
    }
    n++; gap = Math.max(gap, t - last); last = t;
    if (t - t0 < ms) requestAnimationFrame(tick);
    else done({ fps: Math.round(n * 1000 / (t - t0) * 10) / 10, gap: Math.round(gap), stall: Math.round(stall) }); };
  requestAnimationFrame(tick); }); }"""


def toggle(browser, base, w, h) -> int:
    """Shelves -> graph -> shelves with the top-bar switch. The books on screen fly between their shelf places and
    their nodes (transit.js) at about 60 fps while the old view fades in a layer; under reduced motion a crossfade."""
    errs, ok = [], True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    ctx, page = open_page(browser, base, "#/", w, h, errors=errs)
    SHOTS.mkdir(parents=True, exist_ok=True)
    bar = page.evaluate(TOPBAR)
    clash = [(a["el"], b["el"]) for i, a in enumerate(bar) for b in bar[i + 1:] if a["l"] < b["r"] and b["l"] < a["r"]]
    check("top bar fits", not clash and all(b["r"] <= w + 1 for b in bar), json.dumps([(b["el"], round(b["l"]), round(b["r"])) for b in bar]))
    st = page.evaluate(SWITCH)
    check("shelves on", st["on"] == "library" and st["current"] == ["library"] and st["books"] > 0, json.dumps(st))
    page.screenshot(path=str(SHOTS / f"toggle-shelves-{w}.png"))

    page.evaluate(FLIGHT_FPS, 900)
    page.evaluate(MID, 2000)
    page.click(".view-switch a[data-nav=graph]")
    page.wait_for_timeout(420)
    mid = mid_seen(page, {"layers": 1, "on": "graph", "flyers": "+", "away": "+"})
    check("to graph: books in the air", mid["hit"], json.dumps(mid))
    page.screenshot(path=str(SHOTS / f"toggle-mid-graph-{w}.png"))
    fly = page.evaluate("() => window.__fly")
    check("to graph: frame rate in the air", fly["fps"] >= FPS_MIN, f"{fly['fps']} fps, longest frame {fly['gap']} ms (target {FPS_MIN}); switch before take-off: longest frame {fly['stall']} ms")
    page.wait_for_timeout(1400)
    st = page.evaluate(SWITCH)
    check("graph on: all landed", st["hash"] == "#/graph" and st["view"] == "graph" and st["current"] == ["graph"] and st["canvas"]
          and not st["layers"] and not st["flyers"] and st["away"] == 0, json.dumps(st))
    page.screenshot(path=str(SHOTS / f"toggle-graph-{w}.png"))

    page.evaluate(FLIGHT_FPS, 900)
    page.evaluate(MID, 2000)
    page.click(".view-switch a[data-nav=library]")
    page.wait_for_timeout(380)
    mid = mid_seen(page, {"layers": 1, "on": "library", "books": "+", "flyers": "+"})
    check("to shelves: books in the air", mid["hit"] and mid["hit"]["out"] == mid["hit"]["flyers"], json.dumps(mid))
    page.screenshot(path=str(SHOTS / f"toggle-mid-shelves-{w}.png"))
    fly = page.evaluate("() => window.__fly")
    check("to shelves: frame rate in the air", fly["fps"] >= FPS_MIN, f"{fly['fps']} fps, longest frame {fly['gap']} ms (target {FPS_MIN}); switch before take-off: longest frame {fly['stall']} ms")
    page.wait_for_timeout(1300)
    st = page.evaluate(SWITCH)
    check("shelves back: all landed", st["hash"] in ("#/", "") and st["view"] == "library" and st["current"] == ["library"]
          and not st["layers"] and not st["flyers"] and not st["out"] and st["books"] > 0 and not st["faded"], json.dumps(st))

    page.goto(f"{base}/?drafts=1#/settings")
    page.wait_for_timeout(500)
    st = page.evaluate(SWITCH)
    check("settings: no thumb", st["on"] == "" and st["current"] == [], json.dumps(st))
    ctx.close()

    # Reduced motion: no books in the air, the views crossfade.
    ctx, page = open_page(browser, base, "#/", w, h, errors=errs, reduced_motion="reduce")
    page.evaluate(MID, 1200)
    page.click(".view-switch a[data-nav=graph]")
    page.wait_for_timeout(120)
    mid = mid_seen(page, {"layers": 1, "on": "graph"})
    flew = page.evaluate("() => window.__mid.some(s => s.flyers)")
    check("reduced motion, to graph: crossfade", mid["hit"] and not flew, json.dumps(mid))
    page.wait_for_timeout(900)
    st = page.evaluate(SWITCH)
    check("reduced motion: graph on", st["view"] == "graph" and st["canvas"] and not st["layers"] and st["away"] == 0, json.dumps(st))
    page.evaluate(MID, 1200)
    page.click(".view-switch a[data-nav=library]")
    page.wait_for_timeout(120)
    mid = mid_seen(page, {"layers": 1, "on": "library"})
    flew = page.evaluate("() => window.__mid.some(s => s.flyers)")
    check("reduced motion, to shelves: crossfade", mid["hit"] and not flew, json.dumps(mid))
    page.wait_for_timeout(900)
    st = page.evaluate(SWITCH)
    check("reduced motion: shelves back", st["view"] == "library" and not st["layers"] and not st["out"] and st["books"] > 0
          and not st["faded"], json.dumps(st))
    ctx.close()
    for e in errs:
        print("   ", e)
    ok = ok and not errs
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


# Every frame of a Web <-> Timeline switch, until the axis has gone all the way to mix (and ms more): rAF gaps, and
# each shown book's map position (graph units, so the camera's own move does not count), to see that every book glides
# and none jumps.
TL_TRACE = """([mix, ms]) => { window.__tl = new Promise(done => {
  const st = document.querySelector('.graph-stage'), frames = [], t0 = performance.now();
  let end = 0;
  const tick = t => {
    const r = st.timelineReport(), m = st.state().mix;
    frames.push({ t, at0: st.state().tweenAt, mix: m, at: Object.fromEntries(r.books.map(b => [b.id, [b.gx, b.gy, b.gz]])) });
    if (!end && m === mix && frames.length > 2) end = t + ms;
    if ((!end || t < end) && t - t0 < 6000) requestAnimationFrame(tick); else done(frames);
  };
  requestAnimationFrame(tick); }); }"""
TL_SUMMARY = """async () => {
  const fs = await window.__tl, ids = Object.keys(fs[0].at);
  let gap = 0; for (let i = 1; i < fs.length; i++) gap = Math.max(gap, fs[i].t - fs[i - 1].t);
  const fps = (fs.length - 1) * 1000 / (fs[fs.length - 1].t - fs[0].t);
  // For each book that moves far: its largest step per 60th of a second of the switch's own clock, as a share of the
  // whole way (a dropped frame is counted by the frame rate, not as a jump).
  let worst = 0, who = null, moved = 0;
  ids.forEach(id => {
    const a = fs[0].at[id], b = fs[fs.length - 1].at[id];
    const way = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (way < 60) return;
    moved++;
    for (let i = 1; i < fs.length; i++) {
      const p = fs[i - 1].at[id], q = fs[i].at[id];
      if (!p || !q) continue;
      const s = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) / way / Math.max(1, (fs[i].at0 - fs[i - 1].at0) / 16.7);
      if (s > worst) { worst = s; who = id; }
    }
  });
  const mixes = fs.map(f => f.mix);
  let smooth = true;
  for (let i = 1; i < mixes.length; i++) if (Math.abs(mixes[i] - mixes[i - 1]) / Math.max(1, (fs[i].at0 - fs[i - 1].at0) / 16.7) > 0.05) smooth = false;
  return { frames: fs.length, fps: Math.round(fps * 10) / 10, gap: Math.round(gap), moved, worst: Math.round(worst * 1000) / 1000, who, mix: [mixes[0], mixes[mixes.length - 1]], smoothMix: smooth };
}"""
TL_CHECK = """() => {
  const st = document.querySelector('.graph-stage'), r = st.timelineReport(), s = st.state();
  const back = r.lines.filter(l => l.tx < l.fx - 1).map(l => `${l.from}->${l.to}`);
  const older = r.lines.filter(l => l.fy && l.ty && l.fy > l.ty).map(l => `${l.from}->${l.to}`);
  // Books in year order lie left to right on screen (more than five years apart: within that they make room).
  const yb = r.books.filter(b => b.year >= 1700).sort((a, b) => a.year - b.year);
  const inv = [];
  for (let i = 0; i < yb.length; i++) for (let j = i + 1; j < yb.length; j++)
    if (yb[j].year > yb[i].year + 5 && yb[j].x < yb[i].x - 2) inv.push(`${yb[i].id}(${yb[i].year}) / ${yb[j].id}(${yb[j].year})`);
  const pressed = document.querySelector('.graph-layout [aria-pressed=true]')?.dataset.layout;
  return { layout: s.layout, mix: s.mix, pressed, kept: localStorage.getItem('sl.graph.layout'), books: r.books.length, lines: r.lines.length,
    held: r.books.filter(b => b.held).length, back, older, inv: inv.slice(0, 5), invN: inv.length, spin: s.mode === '3d' ? st.cam().az : null };
}"""
TL_BOXES = """() => ['.graph-layout', '.graph-key', '.gc-search', '.gc-toggle', '.gc-mode', '.graph-head'].map(sel => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { el: sel, l: r.left, r: r.right, t: r.top, b: r.bottom };
})"""
TL_AT = "() => Object.fromEntries(document.querySelector('.graph-stage').timelineReport().books.map(b => [b.id, [b.gx, b.gy, b.gz]]))"


def timeline_view(browser, base, w, h) -> int:
    """Web -> Timeline -> Web by the switch in the corner: the books glide to their years (graph units, every frame:
    no step over a tenth of the way), the axis fades in, every relation line runs left to right (older book left),
    books in year order left to right; back to the web every book returns to where it was; the choice is kept, and
    a map opened on the timeline grows its web from there; reduced motion switches at once. G4-03-*.png."""
    errs, ok = [], True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    def pick(st, *ks):
        return json.dumps({k: st[k] for k in ks})

    tag = f"{'2d' if '2d' in VIEW else '3d'}-{w}"
    SHOTS.mkdir(parents=True, exist_ok=True)
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    page.wait_for_timeout(2500)
    bx = page.evaluate(TL_BOXES)
    clash = [(a["el"], b["el"]) for i, a in enumerate(bx) for b in bx[i + 1:]
             if a["l"] < b["r"] - 1 and b["l"] < a["r"] - 1 and a["t"] < b["b"] - 1 and b["t"] < a["b"] - 1]
    check("switch clear of the other controls", not clash and bx[0]["r"] <= w and bx[0]["b"] <= h, json.dumps(clash or bx[0]))
    web = page.evaluate(TL_AT)
    st = page.evaluate(TL_CHECK)
    check("opens on the web", st["layout"] == "web" and st["mix"] == 0 and st["pressed"] == "web" and st["held"] == 0, pick(st, "layout", "mix", "pressed", "held"))

    page.evaluate(TL_TRACE, [1, 100])
    page.click(".graph-layout [data-layout=timeline]")
    page.wait_for_timeout(500)
    page.screenshot(path=str(SHOTS / f"G4-03-mid-{tag}.png"))
    tr = page.evaluate(TL_SUMMARY)
    check("to timeline: every book glides", tr["moved"] > 100 and tr["worst"] <= 0.1, f"{tr['moved']} books moved, largest step {tr['worst']:.1%} of the way per frame ({tr['who']})")
    check("to timeline: axis fades in", tr["smoothMix"] and tr["mix"][1] == 1, json.dumps(tr["mix"]))
    check("to timeline: frame rate", tr["fps"] >= 50, f"{tr['fps']} fps, longest frame {tr['gap']} ms")
    page.wait_for_timeout(600)
    st = page.evaluate(TL_CHECK)
    check("timeline on", st["layout"] == "timeline" and st["mix"] == 1 and st["pressed"] == "timeline" and st["kept"] == "timeline"
          and st["held"] == st["books"], pick(st, "layout", "mix", "pressed", "kept", "held", "books"))
    check("relations run left to right", st["lines"] > 0 and not st["back"] and not st["older"], f"{st['lines']} lines; backwards {st['back']}; newer before older {st['older']}")
    check("books in year order left to right", not st["invN"], f"{st['invN']} {st['inv']}")
    if st["spin"] is not None:
        a = st["spin"]
        page.wait_for_timeout(1500)
        b = page.evaluate("() => document.querySelector('.graph-stage').cam().az")
        check("3D: the timeline faces the reader and does not turn", abs(b - a) < 0.3 and abs(b) < 1, f"az {a:.2f} -> {b:.2f}")
    page.screenshot(path=str(SHOTS / f"G4-03-timeline-{tag}.png"))

    page.evaluate(TL_TRACE, [0, 100])
    page.click(".graph-layout [data-layout=web]")
    tr = page.evaluate(TL_SUMMARY)
    check("to web: every book glides", tr["moved"] > 100 and tr["worst"] <= 0.1, f"{tr['moved']} books moved, largest step {tr['worst']:.1%} of the way per frame ({tr['who']})")
    check("to web: axis fades out", tr["smoothMix"] and tr["mix"][1] == 0, json.dumps(tr["mix"]))
    check("to web: frame rate", tr["fps"] >= 50, f"{tr['fps']} fps, longest frame {tr['gap']} ms")
    page.wait_for_timeout(300)
    now = page.evaluate(TL_AT)
    off = max(max(abs(now[k][i] - web[k][i]) for i in range(3)) for k in web)
    st = page.evaluate(TL_CHECK)
    check("web again: every book back in its place", off < 8 and st["held"] == 0 and st["layout"] == "web" and st["kept"] == "web", f"furthest {off:.1f} units; held {st['held']}")
    page.screenshot(path=str(SHOTS / f"G4-03-web-{tag}.png"))

    # Kept: the next visit opens on the timeline; from there the forces grow the web.
    page.evaluate("() => localStorage.setItem('sl.graph.layout', 'timeline')")
    page.reload(wait_until="load")
    page.wait_for_timeout(1800)
    st = page.evaluate(TL_CHECK)
    check("kept: opens on the timeline", st["layout"] == "timeline" and st["mix"] == 1 and st["held"] == st["books"] and not st["back"] and not st["invN"],
          pick(st, "layout", "mix", "held", "books", "invN"))
    page.evaluate(TL_TRACE, [0, 100])
    page.click(".graph-layout [data-layout=web]")
    tr = page.evaluate(TL_SUMMARY)
    page.wait_for_timeout(300)
    st = page.evaluate(TL_CHECK)
    check("from a timeline visit: to the web the engine worked out", st["layout"] == "web" and st["mix"] == 0 and st["held"] == 0 and tr["moved"] > 100
          and tr["worst"] <= 0.1, f"{tr['moved']} books moved, largest step {tr['worst']:.1%} of the way per frame, {tr['fps']} fps, longest frame {tr['gap']} ms")
    page.screenshot(path=str(SHOTS / f"G4-03-grown-{tag}.png"))
    ctx.close()

    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs, reduced_motion="reduce")
    page.click(".graph-layout [data-layout=timeline]")
    page.wait_for_timeout(60)
    st = page.evaluate(TL_CHECK)
    check("reduced motion: at once", st["layout"] == "timeline" and st["mix"] == 1 and st["held"] == st["books"] and not st["back"], pick(st, "layout", "mix", "held"))
    ctx.close()
    for e in errs:
        print("   ", e)
    ok = ok and not errs
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


IN_VIEW = """sel => {
  const c = document.querySelector('.clip').getBoundingClientRect(), el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getClientRects()[0] || el.getBoundingClientRect();
  return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1;
}"""


def appendix(browser, base, slug, expect, w, h) -> int:
    """The back matter of a last volume: listed in Contents, set after "The End", its context links open the reader."""
    errs, ok = [], True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    ctx, page = open_page(browser, base, f"#/read/{slug}", w, h, errors=errs)
    page.click(".r-actions [data-panel=toc]")
    toc = page.evaluate("""() => [...document.querySelectorAll('.panel-toc [data-app]')].map(b => [b.dataset.app, b.textContent.trim()])""")
    check("contents: Appendix entry", toc and toc[0] == ["appendix", "Appendix"], json.dumps(toc))
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"appendix-toc-{slug}-{w}.png"))
    page.click(".panel-toc [data-app=appendix]")
    page.wait_for_timeout(600)
    st = page.evaluate("""() => {
      const A = document.querySelector('.flow .appendix');
      const end = document.querySelector('.flow .the-end');
      return { parts: [...(A?.querySelectorAll('.app-part > h3') || [])].map(x => x.textContent),
               afterEnd: !!(end && A && (end.compareDocumentPosition(A) & Node.DOCUMENT_POSITION_FOLLOWING)),
               links: [...(A?.querySelectorAll('a[href^="#/read/"]') || [])].map(a => [a.getAttribute('href'), a.textContent.trim()]),
               ext: A?.querySelectorAll('a[target=_blank]').length || 0, left: document.querySelector('.r-pos .left').textContent };
    }""")
    check("appendix after The End", st["afterEnd"] and st["parts"], json.dumps(st["parts"]))
    check("appendix on screen", page.evaluate(IN_VIEW, "#appendix h2"))
    check("story counted done", st["left"] == "End of story", st["left"])
    print("     links", json.dumps(st["links"], ensure_ascii=False), "external", st["ext"])
    page.screenshot(path=str(SHOTS / f"appendix-{slug}-{w}.png"))
    if expect:
        href = f"#/read/{expect}"
        hit = [l for l in st["links"] if l[0] == href]
        check(f"link to {expect}", hit, json.dumps(hit, ensure_ascii=False))
        if hit:
            sel = f'.flow .appendix a[href="{href}"]'
            if not page.evaluate(IN_VIEW, sel):  # on a later page of the appendix: turn to it
                for _ in range(20):
                    page.click(".foot-turn.next")
                    page.wait_for_timeout(450)
                    if page.evaluate(IN_VIEW, sel):
                        break
            page.click(sel)
            page.wait_for_function(f"() => location.hash === '{href}'", timeout=5000)
            page.wait_for_timeout(900)
            got = page.evaluate("() => ({ view: document.body.dataset.view, title: document.querySelector('.r-title b')?.textContent, paras: document.querySelectorAll('.flow [data-p]').length })")
            check(f"opens {expect} in the reader", got["view"] == "reader" and got["paras"] > 0, json.dumps(got, ensure_ascii=False))
            page.screenshot(path=str(SHOTS / f"appendix-{expect}-{w}.png"))
    ctx.close()
    for e in errs:
        print("   ", e)
    ok = ok and not errs
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


FPS = """ms => new Promise(done => { let n = 0; const t0 = performance.now();
  const tick = t => { n++; if (t - t0 < ms) requestAnimationFrame(tick); else done(Math.round(n * 1000 / (t - t0) * 10) / 10); };
  requestAnimationFrame(tick); })"""
CAM = "() => ({ ...document.querySelector('.graph-stage').cam(), mode: document.querySelector('.graph-stage').mode })"
FPS_MIN = 55
ON_SCREEN = """() => { const st = document.querySelector('.graph-stage'), r = st.getBoundingClientRect();
  const on = st.nodeIds().filter(n => !n.author).map(n => ({ id: n.id, q: st.screenOf(n.id) })).filter(o => o.q).map(o => ({ id: o.id, p: { x: o.q.x - r.left, y: o.q.y - r.top } }))
    .filter(o => o.p.x > 40 && o.p.x < r.width - 40 && o.p.y > 80 && o.p.y < r.height - 80)
    .sort((a, b) => Math.hypot(a.p.x - r.width / 2, a.p.y - r.height / 2) - Math.hypot(b.p.x - r.width / 2, b.p.y - r.height / 2));
  return on[0] ? { id: on[0].id, x: r.left + on[0].p.x, y: r.top + on[0].p.y } : null; }"""


def ready_nodes() -> tuple[int, int]:
    """Ready books of the built site (site/data/library.json), volumes of a series counted once, and their distinct
    authors (one author node each). The book pipeline may have added books to content/books.json since the last build;
    tools/test_catalog.py checks that build."""
    books = [b for b in json.loads((SITE / "data" / "library.json").read_text(encoding="utf-8"))["books"] if b.get("status") == "ready"]
    return len({b.get("series") or b["slug"] for b in books}), len({b["author"] for b in books})


def touch(cdp, kind, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def g1(browser, base) -> int:
    """PLAN.md §7, the G1 items one after another; then the screenshots for the user's review."""
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    # Node count and console errors in both builds; the frame rate at rest, under a panning hand and a wheel zoom.
    nb, na = ready_nodes()
    want = nb + na
    for drafts in (False, True):
        errs = []
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, service_workers="block")
        page = ctx.new_page()
        page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        page.goto(f"{base}/?{'drafts=1' if drafts else ''}{VIEW}#/graph", wait_until="load")
        page.wait_for_timeout(SETTLE_MS)
        n = page.evaluate("() => document.querySelector('.graph-stage').graph.graphData().nodes.length")
        check(f"node count{' (drafts)' if drafts else ''}", n == want, f"{n} nodes, {nb} ready books by series + {na} authors in site/data")
        if not drafts:
            idle = page.evaluate(FPS, 3000)
            page.evaluate(f"() => {{ window.__fps = ({FPS})(2000); }}")
            page.mouse.move(640, 420)
            page.mouse.down()
            for i in range(40):
                page.mouse.move(640 - i * 6, 420 - i * 3)
                page.wait_for_timeout(40)
            page.mouse.up()
            panning = page.evaluate("() => window.__fps")
            page.mouse.move(400, 300)
            page.evaluate(f"() => {{ window.__fps = ({FPS})(1500); }}")
            for _ in range(6):
                page.mouse.wheel(0, -120)
                page.wait_for_timeout(120)
            zooming = page.evaluate("() => window.__fps")
            check("frame rate", min(idle, panning, zooming) >= FPS_MIN,
                  f"rest {idle} fps, panning {panning} fps, zooming {zooming} fps (target {FPS_MIN})")
        check(f"console errors{' (drafts)' if drafts else ''}", not errs, "; ".join(errs))
        ctx.close()

    print("-- node -> Read")
    for w, h in ((1280, 800), (390, 844)):
        ok = not node_read(browser, base, "frankenstein-1", w, h) and ok
    print("-- line popover -> passage")
    for w, h in ((1280, 800), (390, 844)):
        ok = not link_pop(browser, base, "island-of-doctor-moreau", "frankenstein", w, h) and ok
    print("-- toggle")
    for w, h in ((1280, 800), (390, 844)):
        ok = not toggle(browser, base, w, h) and ok

    print("-- touch at 390px")
    errs = []
    ctx, page = open_page(browser, base, "#/graph", 390, 844, errors=errs, has_touch=True, is_mobile=True, device_scale_factor=3)
    page.wait_for_timeout(2500)
    cdp = ctx.new_cdp_session(page)
    box = page.evaluate("() => { const r = document.querySelector('.graph-stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }")
    cx, cy = box[0] + box[2] / 2, box[1] + box[3] / 2
    rest390 = page.evaluate(FPS, 3000)  # recorded, not gated: the phone-width frame rate at rest and under a finger
    page.evaluate(f"() => {{ window.__fps = ({FPS})(1500); }}")
    touch(cdp, "touchStart", [(cx, cy + 60)])
    for i in range(1, 40):
        touch(cdp, "touchMove", [(cx - i * 3, cy + 60 - i * 2)])
        page.wait_for_timeout(33)
    touch(cdp, "touchEnd", [])
    drag390 = page.evaluate("() => window.__fps")
    print(f"info frame rate at 390px: rest {rest390} fps, one-finger drag {drag390} fps")
    page.wait_for_timeout(600)
    a = page.evaluate(CAM)
    touch(cdp, "touchStart", [(cx - 30, cy), (cx + 30, cy)])
    for i in range(1, 13):
        touch(cdp, "touchMove", [(cx - 30 - i * 8, cy), (cx + 30 + i * 8, cy)])
        page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(300)
    b = page.evaluate(CAM)
    check("pinch zoom", b["k"] > a["k"] * 1.8, f"zoom {a['k']:.2f} -> {b['k']:.2f} (fingers 60 -> 252 px apart)")
    touch(cdp, "touchStart", [(cx, cy)])
    for i in range(1, 13):
        touch(cdp, "touchMove", [(cx + i * 10, cy + i * 6)])
        page.wait_for_timeout(16)
    touch(cdp, "touchEnd", [])
    page.wait_for_timeout(300)
    c = page.evaluate(CAM)
    if c["mode"] == "3d":  # one finger turns the map about its middle
        turn = (c["az"] - b["az"] + 540) % 360 - 180
        check("one-finger rotate", abs(turn) > 10 and abs(c["k"] - b["k"]) < 0.02 * b["k"],
              f"turned {turn:.0f} deg (tilt {b['el']:.0f} -> {c['el']:.0f}) under a 120,72 px drag, zoom {b['k']:.2f} -> {c['k']:.2f}")
    else:
        moved = ((b["x"] - c["x"]) * c["k"], (b["y"] - c["y"]) * c["k"])  # screen px the map followed the finger
        check("one-finger pan", moved[0] > 90 and moved[1] > 50 and abs(c["k"] - b["k"]) < 0.01,
              f"map moved {moved[0]:.0f},{moved[1]:.0f} px under a 120,72 px drag, zoom {c['k']:.2f}")
    tapped = page.evaluate(ON_SCREEN)  # the book nearest the middle of the zoomed map
    tap_in = bool(tapped)
    if tap_in:
        page.touchscreen.tap(tapped["x"], tapped["y"])
        try:
            page.wait_for_selector("#flight-layer.show-info .flight-info", timeout=5000)
        except Exception:
            pass
    panel = page.evaluate("() => !!document.querySelector('#flight-layer.show-info .flight-info')")
    check("tap a book", tap_in and panel, f"{tapped['id']}: panel open" if panel else json.dumps(tapped))
    ctx.close()
    check("touch: console errors", not errs, "; ".join(errs))

    print("-- screenshots")
    SHOTS.mkdir(parents=True, exist_ok=True)
    tag = "-2d" if VIEW else ""
    for name, w, h, scheme in ((f"G1{tag}-1280-light", 1280, 800, "light"), (f"G1{tag}-1280-dark", 1280, 800, "dark"),
                               (f"G1{tag}-390-light", 390, 844, "light"), (f"G1{tag}-390-dark", 390, 844, "dark")):
        ctx, page = open_page(browser, base, "#/graph", w, h, color_scheme=scheme, device_scale_factor=2 if w < 600 else 1)
        page.wait_for_timeout(4000)
        page.screenshot(path=str(SHOTS / f"{name}.png"))
        ctx.close()
        print("shot ", SHOTS / f"{name}.png")
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


def modes(browser, base) -> int:
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    errs = []
    cam = "() => document.querySelector('.graph-stage').cam()"
    ctx, page = open_page(browser, base, "#/graph", errors=errs)
    page.wait_for_timeout(1500)
    a = page.evaluate(cam)
    page.wait_for_timeout(2000)
    b = page.evaluate(cam)
    turn = (b["az"] - a["az"] + 540) % 360 - 180
    check("3D turns by itself", page.evaluate("() => document.querySelector('.graph-stage').mode") == "3d" and abs(turn) > 1.5, f"{turn:.1f} deg in 2 s")
    page.mouse.move(1180, 690)  # empty stage, clear of the key, the controls and the Web | Timeline switch
    page.mouse.down(); page.mouse.up()
    page.wait_for_timeout(300)
    a = page.evaluate(cam)
    page.wait_for_timeout(1500)
    b = page.evaluate(cam)
    check("stops once touched", abs((b["az"] - a["az"] + 540) % 360 - 180) < 0.3, f"{b['az'] - a['az']:.2f} deg in 1.5 s")
    page.click(".gc-mode [data-mode='2d']")
    page.wait_for_timeout(1200)
    st = page.evaluate("() => ({ mode: document.querySelector('.graph-stage').mode, pressed: document.querySelector(\".gc-mode [aria-pressed='true']\").dataset.mode, kept: localStorage.getItem('sl.graph.view') })")
    check("switch to 2D", st == {"mode": "2d", "pressed": "2d", "kept": "2d"}, json.dumps(st))
    page.reload(wait_until="load")
    page.wait_for_timeout(1500)
    check("2D remembered", page.evaluate("() => document.querySelector('.graph-stage').mode") == "2d")
    page.click(".gc-mode [data-mode='3d']")
    page.wait_for_timeout(1500)
    st = page.evaluate("() => ({ mode: document.querySelector('.graph-stage').mode, kept: localStorage.getItem('sl.graph.view'), nodes: document.querySelector('.graph-stage').nodeIds().length })")
    check("switch back to 3D", st["mode"] == "3d" and st["kept"] == "3d" and st["nodes"] > 0, json.dumps(st))
    ctx.close()

    ctx, page = open_page(browser, base, "#/graph", errors=errs, reduced_motion="reduce")
    page.wait_for_timeout(1500)
    a = page.evaluate(cam)
    page.wait_for_timeout(1500)
    b = page.evaluate(cam)
    check("reduced motion: no turning", abs((b["az"] - a["az"] + 540) % 360 - 180) < 0.3, f"{b['az'] - a['az']:.2f} deg in 1.5 s")
    ctx.close()
    for e in errs:
        print("   ", e)
    ok = ok and not errs

    nogl = browser.browser_type.launch(headless=True, args=["--disable-webgl", "--disable-webgl2"])
    try:
        errs = []
        ctx, page = open_page(nogl, base, "#/graph", errors=errs)
        page.wait_for_timeout(800)
        st = page.evaluate("() => ({ mode: document.querySelector('.graph-stage')?.mode, off: document.querySelector(\".gc-mode [data-mode='3d']\").disabled, nodes: document.querySelector('.graph-stage').nodeIds().length })")
        check("no WebGL: drawn in 2D", st["mode"] == "2d" and st["off"] and st["nodes"] > 0, json.dumps(st))
        errs = [e for e in errs if "WebGL" not in e]  # the engine's own note that it fell back
        check("no WebGL: console errors", not errs, "; ".join(errs))
        ctx.close()
    finally:
        nogl.close()
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


def g2(browser, base) -> int:
    """PLAN.md §7, the G2 items: margin mark -> the other book's paragraph, appendix link, "Show in the graph" -> focus.
    Run at 1280 and 390; screenshots logs/graph-shots/G2-<name>-<w>.png."""
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    SHOTS.mkdir(parents=True, exist_ok=True)
    for w, h in ((1280, 800), (390, 844)):
        print(f"-- {w}px")
        errs = []
        ctx, page = open_page(browser, base, "#/read/frankenstein-1/142", w, h, errors=errs)
        marks = page.evaluate("() => [...document.querySelectorAll('.rel-mark')].map(b => b.textContent.trim())")
        check("margin marks on the page", any("Moreau" in m for m in marks), json.dumps(marks, ensure_ascii=False))
        sel = ".rel-mark:has-text('Moreau')"
        page.click(sel)
        page.wait_for_selector(".card .rel-item", timeout=5000)
        page.wait_for_timeout(300)
        card = page.evaluate("""() => ({ same: !!document.querySelector('.card .rel-line b'), n: document.querySelectorAll('.card .rel-item').length,
          href: document.querySelector('.card .rel-psg a')?.getAttribute('href') })""")
        check("card: Same/Differs and passage link", card["same"] and card["href"] and card["href"].startswith("#/read/island-of-doctor-moreau"), json.dumps(card))
        page.screenshot(path=str(SHOTS / f"G2-mark-card-{w}.png"))
        page.click(".card .rel-psg a")
        page.wait_for_function("() => location.hash.startsWith('#/read/island-of-doctor-moreau')", timeout=5000)
        page.wait_for_timeout(1000)
        para = card["href"].rsplit("/", 1)[-1]
        vis = page.evaluate("""p => { const c = document.querySelector('.clip').getBoundingClientRect(), e = document.querySelector(`.flow [data-p="${p}"]`);
          if (!e) return null; const r = e.getClientRects()[0] || e.getBoundingClientRect(); return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right; }""", para)
        check(f"jump lands on Moreau ¶{para}", vis, card["href"])
        page.screenshot(path=str(SHOTS / f"G2-mark-jump-{w}.png"))
        check("reader: console errors", not errs, "; ".join(errs))
        ctx.close()
    for w, h in ((1280, 800), (390, 844)):
        print(f"-- appendix {w}px")
        ok = not appendix(browser, base, "frankenstein-2", "ctx-shelley-1831-intro", w, h) and ok
        errs = []
        ctx, page = open_page(browser, base, "#/read/frankenstein-2", w, h, errors=errs)
        page.click(".r-actions a[aria-label='Show in the graph']")
        page.wait_for_function("() => location.hash.startsWith('#/graph/')", timeout=5000)
        page.wait_for_timeout(2500)
        foc = page.evaluate("""() => { const st = document.querySelector('.graph-stage'); if (!st?.graph) return null;
          const r = st.getBoundingClientRect(), q = st.screenOf('work:frankenstein');
          return { hash: location.hash, on: !!q && q.x > r.left && q.x < r.right && q.y > r.top && q.y < r.bottom, zoom: st.cam().k }; }""")
        check("Show in the graph -> focus on Frankenstein", foc and foc["hash"].startswith("#/graph/frankenstein-") and foc["on"], json.dumps(foc))
        page.screenshot(path=str(SHOTS / f"G2-graph-focus-{w}.png"))
        check("graph: console errors", not errs, "; ".join(errs))
        ctx.close()
    print("-- G1 regression")
    ok = not g1(browser, base) and ok
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


def author_doc(browser, base, slug, w, h) -> int:
    """Author medal -> panel ('About the author →') -> #/author/<slug> (the essay in the reader's type and measure,
    every section, its books) -> a book's link -> the reader, whose title page links back to the essay; the essay
    also in the night theme and at 390px. Returns 0 when every step holds."""
    ok = True

    def check(name, cond, detail=""):
        nonlocal ok
        ok = ok and bool(cond)
        print(f"{'ok  ' if cond else 'FAIL'} {name} {detail}")

    doc = json.loads((SITE / "data" / "authors" / f"{slug}.json").read_text(encoding="utf-8"))
    errs = []
    ctx, page = open_page(browser, base, "#/graph", w, h, errors=errs)
    page.wait_for_timeout(2500)
    pos = page.evaluate("""slug => {
      const st = document.querySelector('.graph-stage'), n = st.nodeIds().find(n => n.author && n.slug === slug);
      const p = n && st.screenOf(n.id);
      return p ? { id: n.id, x: p.x, y: p.y, mode: st.mode, books: st.booksOf(n.id).length } : null;
    }""", slug)
    if not pos:
        print(f"FAIL no author node for {slug}")
        ctx.close()
        return 1
    where = """id => { const p = document.querySelector('.graph-stage').screenOf(id); return p && { x: p.x, y: p.y }; }"""
    read_panel = """() => { const el = document.querySelector('.graph-author');
      return { about: el?.querySelector('.ga-about')?.textContent || '', more: el?.querySelector('.ga-more')?.getAttribute('href') }; }"""
    # The graph turns slowly and medals can overlap: hover (which pauses the turn), measure again, click; if another
    # medal lies on top (George Eliot over Ford Madox Ford in the opening view), focus the author (#/graph/<slug>,
    # as the search does) so the camera brings it forward, and click again.
    for attempt in range(3):
        if attempt:
            page.keyboard.press("Escape")
            page.wait_for_timeout(600)
            page.evaluate("s => { location.hash = '#/graph/' + s; }", slug)
            page.wait_for_timeout(2500)
            pos = {**pos, **(page.evaluate(where, pos["id"]) or {})}
        page.mouse.move(pos["x"], pos["y"])
        page.wait_for_timeout(400)
        p = page.evaluate(where, pos["id"]) or pos
        page.mouse.move(p["x"], p["y"])
        page.wait_for_timeout(200)
        page.mouse.click(p["x"], p["y"])
        try:
            page.wait_for_selector(".graph-author:not([hidden])", timeout=3000)
        except Exception:
            pass
        page.wait_for_timeout(900)
        panel = page.evaluate(read_panel)
        if panel["more"] == f"#/author/{slug}":
            if attempt:
                print(f"info medal covered in the opening view; clicked after focus (try {attempt + 1})")
            break
    intro = re.sub(r"<[^>]+>", "", doc["intro"][0]).replace("&amp;", "&")
    check("panel about = the essay's first paragraph", panel["about"] == intro, repr(panel["about"][:60]))
    check("panel 'About the author'", panel["more"] == f"#/author/{slug}", repr(panel["more"]))
    page.click(".graph-author .ga-more")
    page.wait_for_selector(".adoc h1", timeout=5000)
    page.wait_for_timeout(400)
    info = page.evaluate("""() => {
      const a = document.querySelector('.adoc'), cs = getComputedStyle(a), p = a.querySelector('section p');
      const probe = document.createElement('div'); probe.style.fontFamily = 'var(--font-read)'; document.body.append(probe);
      const read = getComputedStyle(probe).fontFamily; probe.remove();
      const fs = parseFloat(cs.fontSize), text = a.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { hash: location.hash, view: document.body.dataset.view, name: a.querySelector('h1').textContent,
        dates: a.querySelector('.adoc-dates')?.textContent, h2: [...a.querySelectorAll('h2')].map(x => x.textContent),
        books: [...a.querySelectorAll('.adoc-books > li')].map(li => ({ read: li.querySelector('.adoc-book a').getAttribute('href'),
          graph: li.querySelector('.adoc-go a:last-child').getAttribute('href') })),
        sources: a.querySelectorAll('.adoc-sources li a[href^="http"]').length,
        font: cs.fontFamily, read, fs, measure: text / fs, overflow: document.documentElement.scrollWidth > innerWidth,
        title: document.title };
    }""")
    print("doc  ", json.dumps({k: v for k, v in info.items() if k != "books"}, ensure_ascii=False))
    check("route", info["hash"] == f"#/author/{slug}" and info["view"] == "author", info["hash"])
    # An anonymous collection (no dates) has History and Tales where an author has Life and Writing.
    dates, heads = (f"{doc['born']}–{doc['died']}", ["Life", "Writing"]) if doc.get("born") else (None, ["History", "Tales"])
    check("name and dates", info["name"] == doc["name"] and info["dates"] == dates, f"{info['name']} {info['dates']}")
    check("sections", info["h2"][:2] == heads and info["h2"][-2:] == ["In this library", "Sources"], info["h2"])
    check("books = the author's books in the graph", len(info["books"]) == pos["books"], f"{len(info['books'])} / {pos['books']}")
    check("sources with links", info["sources"] >= 1, info["sources"])
    check("reader's type", info["font"] == info["read"], info["font"])
    check("reader's measure (about 30 ems)", 25 <= info["measure"] <= 31 if w >= 700 else info["measure"] <= 31, round(info["measure"], 1))
    check("no sideways scroll", not info["overflow"])
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"authordoc-{slug}-{w}.png"))
    page.evaluate("() => document.querySelector('.adoc-books').scrollIntoView()")
    page.wait_for_timeout(300)
    page.screenshot(path=str(SHOTS / f"authordoc-{slug}-{w}-books.png"))
    first = info["books"][0]
    page.click(".adoc-books > li:first-child .adoc-book a")
    page.wait_for_function("() => location.hash.startsWith('#/read/')", timeout=5000)
    page.wait_for_selector(".ereader .tp", timeout=8000)
    page.wait_for_timeout(500)
    rd = page.evaluate("() => ({ hash: location.hash, tp: document.querySelector('.tp-author a')?.getAttribute('href'), top: document.querySelector('.r-author')?.getAttribute('href') })")
    check("book link -> reader", rd["hash"] == first["read"], rd["hash"])
    check("reader links back to the essay", rd["tp"] == f"#/author/{slug}", json.dumps(rd))
    page.go_back()
    page.wait_for_selector(".adoc h1", timeout=5000)
    page.click(".adoc-books > li:first-child .adoc-go a:last-child")
    page.wait_for_function("() => location.hash.startsWith('#/graph/')", timeout=5000)
    page.wait_for_timeout(1500)
    pin = page.evaluate("() => ({ hash: location.hash, pin: document.querySelector('.graph-stage')?.state().pin })")
    check("'In the graph' -> focus", pin["hash"] == first["graph"] and pin["pin"], json.dumps(pin))
    ctx.close()
    # Night theme, and a phone.
    for tw, th, theme in ((w, h, "night"), (390, 844, None), (390, 844, "night")):
        ctx = browser.new_context(viewport={"width": tw, "height": th}, service_workers="block")
        if theme:
            ctx.add_init_script(f"localStorage.setItem('sl.theme', '{theme}')")
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
        pg.goto(f"{base}/?drafts=1{VIEW}#/author/{slug}", wait_until="load")
        pg.wait_for_selector(".adoc h1", timeout=5000)
        pg.wait_for_timeout(500)
        v = pg.evaluate("""() => { const a = document.querySelector('.adoc'), cs = getComputedStyle(a);
          return { bg: cs.backgroundColor, ink: cs.color, theme: document.documentElement.dataset.theme || 'auto',
                   overflow: document.documentElement.scrollWidth > innerWidth, w: a.getBoundingClientRect().width }; }""")
        name = f"authordoc-{slug}-{tw}{'-' + theme if theme else ''}.png"
        pg.screenshot(path=str(SHOTS / name))
        check(f"{tw}px {theme or 'light'}", not v["overflow"] and v["w"] <= tw and v["bg"] != v["ink"], json.dumps(v))
        ctx.close()
    print("shots", SHOTS / f"authordoc-{slug}-*.png")
    for e in errs:
        print("   ", e)
    check("console errors", not errs)
    print("ok" if ok else "FAIL")
    return 0 if ok else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--smoke", action="store_true")
    g.add_argument("--shot", metavar="HASH")
    g.add_argument("--eval", nargs=2, metavar=("HASH", "JS"))
    g.add_argument("--node", metavar="SLUG")
    g.add_argument("--link", nargs=2, metavar=("FROM", "TO"))
    g.add_argument("--pair", nargs=2, metavar=("FROM", "TO"))
    g.add_argument("--author", metavar="SLUG")
    g.add_argument("--authordoc", metavar="SLUG")
    g.add_argument("--controls", action="store_true")
    g.add_argument("--toggle", action="store_true")
    g.add_argument("--appendix", metavar="SLUG")
    g.add_argument("--g1", action="store_true")
    g.add_argument("--g2", action="store_true")
    g.add_argument("--modes", action="store_true")
    g.add_argument("--timeline", action="store_true")
    ap.add_argument("--expect")
    ap.add_argument("--w", type=int, default=1280)
    ap.add_argument("--h", type=int, default=800)
    ap.add_argument("--out")
    ap.add_argument("--view", choices=["2d", "3d"], default="3d")
    ap.add_argument("--layout", choices=["web", "timeline"], default="web")
    a = ap.parse_args()
    global VIEW
    VIEW = ("&view=2d" if a.view == "2d" else "") + ("&layout=timeline" if a.layout == "timeline" else "")

    from playwright.sync_api import sync_playwright

    httpd, base = serve()
    rc = 0
    try:
        with sync_playwright() as p:
            # The machine's GPU, as a reader's browser would use it: headless Chromium otherwise draws WebGL in software
            # (SwiftShader), several times slower than any real device.
            try:
                browser = p.chromium.launch(headless=True, args=GPU_ARGS)
            except Exception:
                browser = p.chromium.launch(headless=True)
            try:
                if a.smoke:
                    for h in SMOKE:
                        errs = []
                        ctx, _ = open_page(browser, base, h, errors=errs)
                        ctx.close()
                        print(f"{'FAIL' if errs else 'ok  '} {h}")
                        for e in errs:
                            print("   ", e)
                        rc |= bool(errs)
                elif a.shot:
                    ctx, page = open_page(browser, base, a.shot, a.w, a.h)
                    name = a.out or (a.shot.strip("#/").replace("/", "-") or "home")
                    SHOTS.mkdir(parents=True, exist_ok=True)
                    path = SHOTS / (name if name.endswith(".png") else name + ".png")
                    page.screenshot(path=str(path))
                    ctx.close()
                    print(path)
                elif a.timeline:
                    rc = timeline_view(browser, base, a.w, a.h)
                elif a.modes:
                    rc = modes(browser, base)
                elif a.g2:
                    rc = g2(browser, base)
                elif a.g1:
                    rc = g1(browser, base)
                elif a.node:
                    rc = node_read(browser, base, a.node, a.w, a.h)
                elif a.author:
                    rc = author_panel(browser, base, a.author, a.w, a.h)
                elif a.authordoc:
                    rc = author_doc(browser, base, a.authordoc, a.w, a.h)
                elif a.appendix:
                    rc = appendix(browser, base, a.appendix, a.expect, a.w, a.h)
                elif a.toggle:
                    rc = toggle(browser, base, a.w, a.h)
                elif a.controls:
                    rc = controls(browser, base, a.w, a.h)
                elif a.pair:
                    rc = pair_view(browser, base, a.pair[0], a.pair[1], a.w, a.h)
                elif a.link:
                    rc = link_pop(browser, base, a.link[0], a.link[1], a.w, a.h)
                else:
                    errs = []
                    ctx, page = open_page(browser, base, a.eval[0], a.w, a.h, errors=errs)
                    res = page.evaluate(a.eval[1])
                    ctx.close()
                    print(json.dumps(res, ensure_ascii=False, indent=2) if not isinstance(res, str) else res)
                    for e in errs:
                        print("!", e, file=sys.stderr)
            finally:
                browser.close()
    finally:
        httpd.shutdown()
        httpd.server_close()
    return rc


if __name__ == "__main__":
    sys.exit(main())
