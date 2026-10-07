"""Graph library project (docs/graph/PLAN.md): step states from docs/graph/steps.json, and the jobs it asks the
Claude control queue (~/sisyphus/control, project "library-graph") for.

Usage:
  python tools/graph_pipeline.py status              counts per state + open waves
  python tools/graph_pipeline.py next                steps of the open waves with their state
  python tools/graph_pipeline.py feed                JSON: jobs whose prerequisites are all done (read by the control queue)
  python tools/graph_pipeline.py panel               JSON: waves and step states for the control dashboard
  python tools/graph_pipeline.py mark <code>         verify a finished step (LOG.md line, checks) and record it
  python tools/graph_pipeline.py ok <code>           the user accepted a review step (kind "user")
  python tools/graph_pipeline.py start <wave>        open a wave now, without waiting for the waves before it
  python tools/graph_pipeline.py reopen <code>       redo a step (and nothing else); bumps its revision

A step is queued only when every step in its "needs" is done; "needs" names every prerequisite, across waves too.
A wave opens once every wave before it is finished, every step done, the user's review included, or by hand with
`start`. Ready steps of waves not open yet are fed as "later": the control queue runs them only in slots the open
waves leave idle. User steps never become jobs; the dashboard's button runs `ok`.
"""
import datetime
import functools
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "docs" / "graph" / "steps.json"
LOG = ROOT / "docs" / "graph" / "LOG.md"
STAGES = [("done", "완료", "#16a34a"), ("ready", "실행 가능", "#0d9488"), ("user", "사용자 확인", "#ea580c"),
          ("waiting", "선행 대기", "#a1a1aa")]
LABEL = {k: l for k, l, _ in STAGES}
RULES = ("먼저 docs/graph/PLAN.md(개정 4, 이 프로젝트의 플랜)를 읽는다. 데이터 모델과 근거 규칙은 docs/relations-plan.md에 있다. "
         "결정된 사항은 다시 열지 않는다. 선행 단계는 파이프라인이 이미 확인했다. "
         "같은 저장소에서 책 파이프라인(프로젝트 library)이 content/books.json과 content/sources/를 고치고 배포한다: 그 파일들은 건드리지 않는다. "
         "커밋·push는 '커밋·배포' 단계에서만 한다. site/의 파일을 바꾸면 site/sw.js의 파일 목록과 VERSION을 맞춘다. "
         "명령은 모두 포그라운드로 실행하고 끝날 때까지 기다린다(서버가 필요하면 tools/graph_qa.py처럼 한 명령 안에서 띄우고 닫는다). "
         "플랜과 화면이 크게 어긋나거나, 사용자만 정할 수 있는 일이 생기거나, 해결 못 할 오류가 나면 더 바꾸지 말고 멈춘 뒤 무엇이 필요한지 짧게 보고한다.")


def load() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def save(cat: dict) -> None:
    CATALOG.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def find(cat: dict, code: str) -> dict:
    for s in cat["steps"]:
        if s["code"] == code:
            return s
    sys.exit(f"no step {code}")


def is_done(cat: dict, s: dict) -> bool:
    return s["code"] in cat["done"]


def wave_steps(cat: dict, name: str) -> list[dict]:
    return [s for s in cat["steps"] if s["wave"] == name]


def finished(cat: dict, w: dict) -> bool:
    return all(is_done(cat, s) for s in wave_steps(cat, w["name"]))


def open_waves(cat: dict) -> list[str]:
    """Not finished, and started by hand or every wave before it finished. A step of a closed wave done in an idle
    slot ("later") does not open it, so open waves come first."""
    out = []
    for i, w in enumerate(cat["waves"]):
        if finished(cat, w):
            continue
        if w.get("started") or all(finished(cat, v) for v in cat["waves"][:i]):
            out.append(w["name"])
    return out


@functools.lru_cache(maxsize=1)
def shelved() -> frozenset[str]:
    """Slugs and series of the books readable on the site; a series counts once all its volumes are."""
    books = json.loads((ROOT / "content" / "books.json").read_text(encoding="utf-8"))
    ready = {b["slug"]: (ROOT / "content" / "sources" / f"{b['slug']}.txt").exists() and bool(b.get("reviewed"))
             for b in books}
    series: dict[str, bool] = {}
    for b in books:
        if b.get("series"):
            series[b["series"]] = series.get(b["series"], True) and ready[b["slug"]]
    return frozenset(k for k, v in {**ready, **series}.items() if v)


def state(cat: dict, s: dict) -> str:
    if is_done(cat, s):
        return "done"
    if not all(is_done(cat, find(cat, c)) for c in s["needs"]):
        return "waiting"
    # "books": slugs (or series) the step reads that the book pipeline has not shelved yet (docs/graph/imports.json).
    if s.get("books") and not set(s["books"]) <= shelved():
        return "waiting"
    return "user" if s.get("kind") == "user" else "ready"


def verify(s: dict) -> list[str]:
    code = s["code"]
    errs = []
    log = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
    if not re.search(rf"^- \[x\] {re.escape(code)}\b", log, re.M):
        errs.append(f"docs/graph/LOG.md에 '- [x] {code} …' 줄이 없다")
    errs += [f"{f} 파일이 없다" for f in s.get("files", []) if not (ROOT / f).exists()]
    for cmd in s.get("checks", []):
        r = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, encoding="utf-8", errors="replace",
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        if r.returncode:
            errs.append(f"`{cmd}` 실패:\n{(r.stdout + r.stderr).strip()[-1500:]}")
    return errs


def job_for(cat: dict, s: dict) -> dict:
    code = s["code"]
    return {"key": f"library-graph:{code}:r{s.get('rev', 0)}", "title": f"{code} · {s['title']}",
            "model": s.get("model", "opus"), "perm": "auto", "tags": [code],
            "prompt": f"Sisyphus Library 그래프 프로젝트, 단계 {code}({s['title']}). {RULES}\n\n이번 단계: {s['task']}\n\n"
                      f"끝나면 docs/graph/LOG.md에 '- [x] {code} <날짜> — <확인 결과>' 한 줄을 추가하고 "
                      f"`python tools/graph_pipeline.py mark {code}` 를 통과할 때까지 실행한다(실패 메시지는 고친 뒤 다시)."}


def feed() -> list[dict]:
    """Ready steps of the open waves, then those of the waves not open yet, marked "later": the control queue runs
    them only in slots the open waves leave idle, so independent work never waits for an earlier wave."""
    cat = load()
    opened = open_waves(cat)
    closed = [w["name"] for w in cat["waves"] if w["name"] not in opened and not finished(cat, w)]
    jobs = [job_for(cat, s) for name in opened for s in wave_steps(cat, name) if state(cat, s) == "ready"]
    return jobs + [{**job_for(cat, s), "later": True}
                   for name in closed for s in wave_steps(cat, name) if state(cat, s) == "ready"]


def actions(cat: dict) -> list[dict]:
    """Buttons for the dashboard: {"id", "label", "confirm", "cmd"}; it runs cmd here when one is pressed."""
    out = []
    opened = open_waves(cat)
    for name in opened:
        for s in wave_steps(cat, name):
            if state(cat, s) == "user":
                out.append({"id": f"ok:{s['code']}", "label": f"{s['code']} 확인", "cmd": f"python tools/graph_pipeline.py ok {s['code']}",
                            "confirm": f"{s['code']} · {s['title']}: 결과를 확인했고 다음 단계로 넘어갈까요? 고칠 점이 있으면 취소하고 세션에서 말해 주세요."})
    for w in cat["waves"]:
        if not finished(cat, w) and w["name"] not in opened:
            out.append({"id": f"start:{w['name']}", "label": f"{w['name']} 시작",
                        "cmd": f"python tools/graph_pipeline.py start {w['name']}",
                        "confirm": f"{w['name']} · {w['label']} 웨이브를 지금 열까요? 선행 단계가 끝난 단계만 대기열에 들어갑니다."})
    return out


def counts(cat: dict) -> dict:
    """A step of a wave not open yet counts as waiting, whatever its own prerequisites say."""
    opened = open_waves(cat)
    c: dict[str, int] = {}
    for s in cat["steps"]:
        k = state(cat, s) if s["wave"] in opened or is_done(cat, s) else "waiting"
        c[k] = c.get(k, 0) + 1
    return c


def panel() -> dict:
    cat = load()
    cur = open_waves(cat)
    waves = []
    for w in cat["waves"]:
        items = [{"slug": s["code"], "title": f"{s['code']} · {s['title']}", "month": w["label"], "stage": state(cat, s)}
                 for s in wave_steps(cat, w["name"])]
        waves.append({"name": w["name"], "months": w["label"], "books": items, "current": w["name"] in cur,
                      "done": finished(cat, w)})
    return {"title": "Sisyphus Library · 그래프", "counts": counts(cat), "total": len(cat["steps"]), "waves": waves,
            "actions": actions(cat), "stages": [{"key": k, "label": l, "color": c} for k, l, c in STAGES],
            "done": {"stage": "done", "label": "완료"}}


def log_line(text: str) -> None:
    body = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
    LOG.write_text(body.rstrip("\n") + f"\n- {datetime.date.today().isoformat()} — {text}\n", encoding="utf-8")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.chdir(ROOT)
    args = sys.argv[1:] or ["status"]
    cmd = args[0]
    if cmd in ("feed", "panel"):
        print(json.dumps(feed() if cmd == "feed" else panel(), ensure_ascii=False))
        return
    cat = load()
    today = datetime.date.today().isoformat()
    if cmd in ("mark", "ok"):
        s = find(cat, args[1])
        if (s.get("kind") == "user") != (cmd == "ok"):
            sys.exit(f"{s['code']}: use `{'ok' if s.get('kind') == 'user' else 'mark'}`")
        if missing := [c for c in s["needs"] if not is_done(cat, find(cat, c))]:
            sys.exit(f"{s['code']}: prerequisites not done: {missing}")
        if cmd == "mark" and (errs := verify(s)):
            sys.exit(f"{s['code']}: not marked\n" + "\n".join(f"  - {e}" for e in errs))
        cat["done"][s["code"]] = today
        save(cat)
        if cmd == "ok":
            log_line(f"{s['code']} 사용자 확인")
        print(f"{s['code']}: done")
        return
    if cmd == "start":
        w = next((w for w in cat["waves"] if w["name"] == args[1]), None) or sys.exit(f"no wave {args[1]}")
        if w["name"] in open_waves(cat):
            sys.exit(f"{w['name']} is already open")
        w["started"] = today
        save(cat)
        log_line(f"{w['name']} 수동 시작: {w['label']}")
        print(f"{w['name']} started; open: {', '.join(open_waves(cat))}")
        return
    if cmd == "reopen":
        s = find(cat, args[1])
        cat["done"].pop(s["code"], None)
        s["rev"] = s.get("rev", 0) + 1
        save(cat)
        log_line(f"{s['code']} 다시 (r{s['rev']})")
        print(f"{s['code']}: reopened (r{s['rev']})")
        return
    if cmd == "next":
        for name in open_waves(cat):
            for s in wave_steps(cat, name):
                print(f"{name}\t{s['code']}\t{LABEL[state(cat, s)]}\t{s['title']}")
        return
    c = counts(cat)
    print("  ".join(f"{LABEL[k]}: {c.get(k, 0)}" for k, _, _ in STAGES))
    print("open waves:", ", ".join(open_waves(cat)) or "(none)")


if __name__ == "__main__":
    main()
