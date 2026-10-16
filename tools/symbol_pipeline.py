"""Cover symbols project (docs/symbols/PLAN.md): step states from docs/symbols/steps.json, and the jobs it asks the
Claude control queue (~/sisyphus/control, project "library-symbols") for.

Usage:
  python tools/symbol_pipeline.py status              counts per state + open waves
  python tools/symbol_pipeline.py next                steps of the open waves with their state
  python tools/symbol_pipeline.py feed                JSON: jobs whose prerequisites are all done (read by the control queue)
  python tools/symbol_pipeline.py panel               JSON: waves and step states for the control dashboard
  python tools/symbol_pipeline.py check <work> ...    check symbol files against the house style
  python tools/symbol_pipeline.py mark <code>         verify a finished step (its symbols, a LOG.md line) and record it
  python tools/symbol_pipeline.py ok <code>           the user accepted a review step
  python tools/symbol_pipeline.py start <wave>        open a wave now, without waiting for the waves before it
  python tools/symbol_pipeline.py reopen <code>       redo a step; bumps its revision
  python tools/symbol_pipeline.py sync                add steps for works in content/books.json that are in no step yet

A step is queued when every step in its "needs" is done. A wave opens once every wave before it is finished (its review
included), or by hand with `start`. User steps never become jobs; the dashboard's button runs `ok`.
"""
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "docs" / "symbols" / "steps.json"
LOG = ROOT / "docs" / "symbols" / "LOG.md"
SYMBOLS = ROOT / "content" / "symbols"
STAGES = [("done", "완료", "#16a34a"), ("ready", "실행 가능", "#0d9488"), ("user", "사용자 확인", "#ea580c"),
          ("waiting", "선행 대기", "#a1a1aa")]
PER_STEP, PER_WAVE = 8, 3
RULES = ("먼저 docs/symbols/PLAN.md(이 프로젝트의 플랜·화풍 규칙)를 읽고, site/js/art.js의 MOTIFS와 content/symbols/의 기존 심볼을 본다. "
         "결정된 사항은 다시 열지 않는다. 같은 저장소에서 책 파이프라인(library)과 그래프 파이프라인(library-graph)이 돈다: "
         "content/books.json, content/sources/, content/graph/, site/는 건드리지 않는다(커밋 단계 제외). "
         "커밋·push는 '커밋·배포' 단계에서만 한다. 명령은 모두 포그라운드로 실행하고 끝날 때까지 기다린다. "
         "사용자만 정할 수 있는 일이 생기거나 해결 못 할 오류가 나면 더 바꾸지 말고 멈춘 뒤 무엇이 필요한지 짧게 보고한다.")


def load() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def save(cat: dict) -> None:
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def find(cat: dict, code: str) -> dict:
    s = next((s for s in cat["steps"] if s["code"] == code), None)
    if not s:
        sys.exit(f"no step {code}")
    return s


def wave_steps(cat: dict, name: str) -> list:
    return [s for s in cat["steps"] if s["wave"] == name]


def finished(cat: dict, w: dict) -> bool:
    return all(s.get("done") for s in wave_steps(cat, w["name"]))


def open_waves(cat: dict) -> list:
    """Every wave up to the first unfinished one, and any started by hand, that is not finished."""
    out, blocked = [], False
    for w in cat["waves"]:
        if finished(cat, w):
            continue
        if not blocked or w["name"] in cat.get("started", []):
            out.append(w["name"])
        blocked = True
    return out


def state(cat: dict, s: dict) -> str:
    if s.get("done"):
        return "done"
    by = {x["code"]: x for x in cat["steps"]}
    if not all(by[n].get("done") for n in s.get("needs", [])):
        return "waiting"
    return "user" if s["kind"] == "user" else "ready"


def works_rows() -> dict:
    cat = json.loads((ROOT / "content" / "books.json").read_text(encoding="utf-8"))
    out = {}
    for b in cat if isinstance(cat, list) else cat["books"]:
        out.setdefault(b.get("series") or b["slug"], b)
    return out


# ---------- the house style, checked ----------
ALLOWED = {"path", "circle", "ellipse", "line", "polyline", "rect"}


def check_symbol(work: str) -> list:
    f = SYMBOLS / f"{work}.svg"
    if not f.exists():
        return [f"{work}: no content/symbols/{work}.svg"]
    t = f.read_text(encoding="utf-8")
    errs = []
    if not re.match(r"\s*<!--\s*[^\n]+:\s*\S[^\n]*-->\s*\n\s*<svg ", t):
        errs.append("first line must be <!-- Title: what it shows -->, then <svg")
    m = re.search(r'<svg viewBox="0 0 120 (90|100|110)">(.*)</svg>', t, re.S)
    if not m:
        return [f"{work}: " + "; ".join(errs + ['<svg viewBox="0 0 120 100|90|110"> ... </svg> expected'])]
    body = m.group(2)
    tags = re.findall(r"<\s*([a-zA-Z]+)", body)
    bad = sorted(set(tags) - ALLOWED)
    if bad:
        errs.append(f"elements not allowed: {', '.join(bad)}")
    if not 3 <= len(tags) <= 12:
        errs.append(f"{len(tags)} elements (3–9, at most 12)")
    for attr in re.findall(r'\b(stroke(?:-[a-z]+)?|fill|style|class|transform|font[a-z-]*)="([^"]*)"', body):
        if attr[0] == "fill" and attr[1] == "currentColor":
            continue
        if attr[0] == "transform" and attr[1].startswith(("rotate", "translate")):
            continue
        errs.append(f'{attr[0]}="{attr[1]}" not allowed (the site sets the line)')
    for r in re.findall(r'<circle[^>]*fill="currentColor"[^>]*>', body):
        rr = re.search(r'\br="([\d.]+)"', r)
        if rr and float(rr.group(1)) > 2.5:
            errs.append(f"a filled dot larger than r 2.5: {r}")
    return [f"{work}: {e}" for e in errs]


# ---------- jobs ----------
def job_for(cat: dict, s: dict) -> dict:
    code, rev = s["code"], s.get("rev", 0)
    base = {"key": f"library-symbols:{code}:r{rev}", "title": f"{code} · {s['title']}", "model": "opus", "perm": "auto", "tags": [code]}
    if s["kind"] == "draw":
        rows = works_rows()
        items = "\n".join(f"- {w}: {rows[w]['title']} ({rows[w]['author']}, {rows[w]['year']}, {rows[w]['genre']})"
                          + ("" if rows[w].get("reviewed") else " [원문 미입고: 원문은 Gutenberg MCP로 확인]") for w in s["works"])
        note = f"\n사용자 메모: {s['note']}" if s.get("note") else ""
        prompt = (f"Sisyphus Library 표지 심볼 프로젝트, 단계 {code}({s['title']}). {RULES}\n\n"
                  f"이번 단계: 아래 작품마다 상징 하나를 그려 content/symbols/<work>.svg로 쓴다(이미 파일이 있으면 그 작품은 고쳐야 할 때만 고친다).\n{items}{note}\n\n"
                  "작품마다: content/sources/<slug>.txt(여러 권이면 <work>-1.txt부터)에서 작품의 중심 테마를 담은 사물·장면을 찾아 고른다. "
                  "이미 있는 다른 작품의 심볼과 겹치지 않게 한다. PLAN.md의 화풍대로 그린다. "
                  f"그다음 `python tools/symbol_pipeline.py check {' '.join(s['works'])}` 와 "
                  f"`python tools/symbol_sheet.py --step {code} --png` 를 돌리고, docs/symbols/sheets/{code}.png를 직접 열어 본다. "
                  "22px 배지에서 알아볼 수 없거나, 다른 물건처럼 보이거나, 무게가 이웃과 크게 다르면 다시 그린다. "
                  f"끝나면 docs/symbols/LOG.md에 '- [x] {code} <날짜> — <작품: 고른 상징 한 구절씩>' 한 줄을 쓰고 "
                  f"`python tools/symbol_pipeline.py mark {code}` 를 실행한다.")
    else:  # commit
        wave = s["wave"]
        prompt = (f"Sisyphus Library 표지 심볼 프로젝트, 단계 {code}({s['title']}). {RULES}\n\n"
                  f"이번 단계: {wave} 웨이브의 결과를 커밋하고 배포한다. "
                  "`python tools/build.py`(library.json에 symbols가 들어가는지), `python tools/symbol_sheet.py --all`, "
                  "`python tools/graph_qa.py --smoke` 를 돌려 통과를 확인한다. "
                  + (s.get("extra", "") + " " if s.get("extra") else "")
                  + "content/symbols/, docs/symbols/와 이 단계에 적힌 파일만 스테이징해서 커밋하고 main에 push한다(다른 프로젝트의 변경은 스테이징하지 않는다). "
                  "GitHub Pages 배포가 끝나면 라이브 사이트에서 #/graph가 열리는지 확인한다. "
                  f"끝나면 docs/symbols/LOG.md에 '- [x] {code} <날짜> — <커밋 해시, 배포 확인>' 한 줄을 쓰고 "
                  f"`python tools/symbol_pipeline.py mark {code}` 를 실행한다.")
    return {**base, "prompt": prompt}


def feed() -> list:
    """Ready steps of the open waves only: a wave's symbols wait for the review of the one before (the style is set
    there), unless it is started by hand."""
    cat = load()
    return [job_for(cat, s) for name in open_waves(cat) for s in wave_steps(cat, name) if state(cat, s) == "ready"]


def counts(cat: dict) -> dict:
    opened = open_waves(cat)
    c: dict = {}
    for s in cat["steps"]:
        k = state(cat, s) if s["wave"] in opened or s.get("done") else "waiting"
        c[k] = c.get(k, 0) + 1
    return c


def unassigned(cat: dict) -> list:
    have = {w for s in cat["steps"] for w in s.get("works", [])}
    return [w for w in works_rows() if w not in have]


def panel() -> dict:
    cat = load()
    cur = open_waves(cat)
    waves = [{"name": w["name"], "months": w["label"], "current": w["name"] in cur, "done": finished(cat, w),
              "books": [{"slug": s["code"], "title": f"{s['code']} · {s['title']}", "month": w["label"], "stage": state(cat, s)}
                        for s in wave_steps(cat, w["name"])]} for w in cat["waves"]]
    actions = []
    for name in cur:
        for s in wave_steps(cat, name):
            if state(cat, s) == "user":
                actions.append({"id": f"ok:{s['code']}", "label": f"{s['code']} 확인", "cmd": f"python tools/symbol_pipeline.py ok {s['code']}",
                                "confirm": f"{s['code']} · {s['title']}: 시트를 확인했고 다음 단계로 넘어갈까요? 고칠 점이 있으면 취소하고 세션에서 말해 주세요."})
    for w in cat["waves"]:
        if not finished(cat, w) and w["name"] not in cur:
            actions.append({"id": f"start:{w['name']}", "label": f"{w['name']} 시작", "cmd": f"python tools/symbol_pipeline.py start {w['name']}",
                            "confirm": f"{w['name']} · {w['label']} 웨이브를 지금 열까요?"})
    new = unassigned(cat)
    if new:
        actions.append({"id": "sync", "label": f"새 작품 {len(new)}편 추가", "cmd": "python tools/symbol_pipeline.py sync",
                        "confirm": f"심볼 단계가 없는 작품 {len(new)}편을 새 웨이브로 추가할까요?"})
    return {"title": "Sisyphus Library · 표지 심볼", "counts": counts(cat), "total": len(cat["steps"]), "waves": waves,
            "actions": actions, "stages": [{"key": k, "label": l, "color": c} for k, l, c in STAGES],
            "done": {"stage": "done", "label": "완료"}}


def log_line(text: str) -> None:
    body = LOG.read_text(encoding="utf-8") if LOG.exists() else "# Cover symbols log\n"
    LOG.write_text(body.rstrip("\n") + f"\n- {datetime.date.today().isoformat()} — {text}\n", encoding="utf-8")


def mark(code: str) -> None:
    cat = load()
    s = find(cat, code)
    if s["kind"] == "user":
        sys.exit(f"{code} is a review step: the user accepts it (ok)")
    errs = [e for w in s.get("works", []) for e in check_symbol(w)]
    if errs:
        sys.exit("not done:\n  " + "\n  ".join(errs))
    if f"[x] {code} " not in (LOG.read_text(encoding="utf-8") if LOG.exists() else ""):
        sys.exit(f"write the line '- [x] {code} <date> — …' in docs/symbols/LOG.md first")
    s["done"] = datetime.date.today().isoformat()
    save(cat)
    print(f"{code} done")


def ok(code: str) -> None:
    cat = load()
    s = find(cat, code)
    if s["kind"] != "user":
        sys.exit(f"{code} is not a review step")
    if state(cat, s) != "user":
        sys.exit(f"{code} is not ready for review ({state(cat, s)})")
    s["done"] = datetime.date.today().isoformat()
    save(cat)
    log_line(f"{code} 사용자 확인")
    print(f"{code} accepted")


def build_waves(cat: dict, works: list, first: int) -> None:
    """Waves of PER_WAVE drawing steps of PER_STEP works, then the review and the commit, appended to the catalog."""
    rows = works_rows()
    n = first
    for i in range(0, len(works), PER_STEP * PER_WAVE):
        chunk = works[i:i + PER_STEP * PER_WAVE]
        name = f"S{n}"
        genres = sorted({rows[w]["genre"] for w in chunk})
        cat["waves"].append({"name": name, "label": f"{len(chunk)}편 · " + ", ".join(g.split(" & ")[0] for g in genres[:3]) + ("…" if len(genres) > 3 else "")})
        draws = []
        for j in range(0, len(chunk), PER_STEP):
            part = chunk[j:j + PER_STEP]
            code = f"{name}-{j // PER_STEP + 1:02d}"
            cat["steps"].append({"code": code, "wave": name, "kind": "draw", "title": "심볼 · " + ", ".join(rows[w]["title"] for w in part[:2]) + (f" 외 {len(part) - 2}편" if len(part) > 2 else ""),
                                 "works": part, "needs": []})
            draws.append(code)
        cat["steps"].append({"code": f"{name}-OK", "wave": name, "kind": "user", "title": f"사용자 확인 ({name} 시트)", "needs": draws})
        cat["steps"].append({"code": f"{name}-08", "wave": name, "kind": "commit", "title": "커밋·배포", "needs": [f"{name}-OK"]})
        n += 1


def sync() -> None:
    cat = load()
    new = unassigned(cat)
    if not new:
        print("every work has a step")
        return
    first = max(int(w["name"][1:]) for w in cat["waves"]) + 1
    build_waves(cat, new, first)
    save(cat)
    log_line(f"sync: 새 작품 {len(new)}편 단계 추가")
    print(f"{len(new)} works added from S{first}")


def main() -> None:
    a = sys.argv[1:]
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "feed":
        print(json.dumps(feed(), ensure_ascii=False))
    elif cmd == "panel":
        print(json.dumps(panel(), ensure_ascii=False))
    elif cmd in ("status", "next"):
        cat = load()
        print("  ".join(f"{l}: {counts(cat).get(k, 0)}" for k, l, _ in STAGES))
        print("open waves:", ", ".join(open_waves(cat)) or "-")
        if cmd == "next":
            for name in open_waves(cat):
                for s in wave_steps(cat, name):
                    print(f"{name}\t{s['code']}\t{dict((k, l) for k, l, _ in STAGES)[state(cat, s)]}\t{s['title']}")
        new = unassigned(cat)
        if new:
            print(f"works in no step yet: {len(new)} (sync)")
    elif cmd == "check":
        errs = [e for w in a[1:] for e in check_symbol(w)]
        print("\n".join(errs) or "ok")
        sys.exit(1 if errs else 0)
    elif cmd == "mark":
        mark(a[1])
    elif cmd == "ok":
        ok(a[1])
    elif cmd == "start":
        cat = load()
        if a[1] not in [w["name"] for w in cat["waves"]]:
            sys.exit(f"no wave {a[1]}")
        cat.setdefault("started", []).append(a[1])
        save(cat)
        log_line(f"{a[1]} 수동 시작")
    elif cmd == "reopen":
        cat = load()
        s = find(cat, a[1])
        s.pop("done", None)
        s["rev"] = s.get("rev", 0) + 1
        if len(a) > 2:
            s["note"] = " ".join(a[2:])
        save(cat)
        log_line(f"{a[1]} 다시 열기 (r{s['rev']})")
    elif cmd == "sync":
        sync()
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
