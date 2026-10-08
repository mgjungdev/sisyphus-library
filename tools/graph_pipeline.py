"""Graph library project (docs/graph/PLAN.md): step states from docs/graph/steps.json, and the jobs it asks the
Claude control queue (~/sisyphus/control, project "library-graph") for.

Usage:
  python tools/graph_pipeline.py status              counts per state + open waves
  python tools/graph_pipeline.py next                steps of the open waves with their state
  python tools/graph_pipeline.py feed                JSON: jobs whose prerequisites are all done (read by the control queue)
  python tools/graph_pipeline.py panel               JSON: waves and step states for the control dashboard
  python tools/graph_pipeline.py begin <code>        a data step's job starts: records what it builds on, prints its stage
  python tools/graph_pipeline.py mark <code>         verify a finished step (LOG.md line, checks) and record it
  python tools/graph_pipeline.py ok <code>           the user accepted a review step (kind "user")
  python tools/graph_pipeline.py start <wave>        open a wave now, without waiting for the waves before it
  python tools/graph_pipeline.py reopen <code>       redo a step (and nothing else); bumps its revision

A step is queued only when every step in its "needs" is done; "needs" names every prerequisite, across waves too.
A wave opens once every wave before it is finished, every step done, the user's review included, or by hand with
`start`. Ready steps of waves not open yet are fed as "later": the control queue runs them only in slots the open
waves leave idle. User steps never become jobs; the dashboard's button runs `ok`.

Data steps ("kind": "data") run in parallel with the result of a serial run in steps.json order (tools/graph_stage.py).
Each writes only its stage folder and works on the graph as the data steps before it left it; `mark` merges the stage.
Its "needs" are the steps whose works it relates to (and the step before it by the same author). A step that started
before an earlier one was merged gets a 보정 job (same code, state "fix") once every earlier data step is done: it
redoes only what depends on the difference. A data step is final when what its work rests on equals what a serial
run would have given it. A user step with "through" waits until every data step up to that one is final.
"""
import datetime
import functools
import json
import os
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import graph_stage as gs  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "docs" / "graph" / "steps.json"
LOG = ROOT / "docs" / "graph" / "LOG.md"
STAGES = [("done", "완료", "#16a34a"), ("fix", "보정", "#7c3aed"), ("ready", "실행 가능", "#0d9488"),
          ("user", "사용자 확인", "#ea580c"), ("waiting", "선행 대기", "#a1a1aa")]
LABEL = {k: l for k, l, _ in STAGES}
RULES = ("먼저 docs/graph/PLAN.md(개정 4, 이 프로젝트의 플랜)를 읽는다. 데이터 모델과 근거 규칙은 docs/relations-plan.md에 있다. "
         "결정된 사항은 다시 열지 않는다. 선행 단계는 파이프라인이 이미 확인했다. "
         "같은 저장소에서 책 파이프라인(프로젝트 library)이 content/books.json과 content/sources/를 고치고 배포한다: 그 파일들은 건드리지 않는다. "
         "커밋·push는 '커밋·배포' 단계에서만 한다. site/의 파일을 바꾸면 site/sw.js의 파일 목록과 VERSION을 맞춘다. "
         "명령은 모두 포그라운드로 실행하고 끝날 때까지 기다린다(서버가 필요하면 tools/graph_qa.py처럼 한 명령 안에서 띄우고 닫는다). "
         "플랜과 화면이 크게 어긋나거나, 사용자만 정할 수 있는 일이 생기거나, 해결 못 할 오류가 나면 더 바꾸지 말고 멈춘 뒤 무엇이 필요한지 짧게 보고한다.")


def stage_rules(code: str) -> str:
    return (f"병렬 실행: 다른 데이터 단계가 같은 폴더에서 동시에 돈다. 결과는 단계들을 steps.json 순서대로 하나씩 돌린 것과 같아야 한다. "
            f"그래서 (1) 맨 처음 `python tools/graph_pipeline.py begin {code}` 를 실행한다: 이 단계의 작업 폴더와, 순서상 이 단계가 보는 그래프의 작품 목록을 알려 준다. "
            f"(2) content/graph/의 본 파일(nodes·edges·readings·glosses·sources.jsonl, authority.json, collate.json, dossiers/)은 직접 고치지 않는다. "
            f"새 줄과 고친 줄은 모두 content/graph/stage/{code}/ 아래 같은 이름의 파일에 쓴다: id가 같은 줄(edge는 type·from·to·role·rel이 같은 줄)은 본 파일의 줄을 대신하고, "
            f"지우려면 {{\"id\": …, \"_delete\": true}}(edge는 그 키 필드 + \"_delete\")를 쓴다. "
            f"(3) catalog.py 명령(check, substitute, authority, collate)에는 모두 `--stage {code}` 를 붙인다. 그게 이 단계가 보는 그래프다: "
            f"본 파일에서 begin 목록에 없는 작품(순서상 뒤 단계의 작품)이 보여도 관계 상대로도, 대체 테스트 대상으로도 쓰지 않고, 그 heading도 쓰지 않는다. "
            f"(4) content/contexts/<작품>.txt와 content/authors/<작가>.md는 직접 써도 된다. "
            f"(5) `python tools/catalog.py build`와 `python tools/build.py`는 돌리지 않는다(병합 때 파이프라인이 만든다). "
            f"(6) LOG 줄은 docs/graph/LOG.md가 아니라 content/graph/stage/{code}/LOG.md에 쓴다. mark가 통과하면 파이프라인이 본 파일과 LOG.md에 합친다.")


def load() -> dict:
    return json.loads(CATALOG.read_text(encoding="utf-8"))


def save(cat: dict) -> None:
    tmp = CATALOG.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cat, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    os.replace(tmp, CATALOG)


def find(cat: dict, code: str) -> dict:
    for s in cat["steps"]:
        if s["code"] == code:
            return s
    sys.exit(f"no step {code}")


def is_done(cat: dict, s: dict) -> bool:
    return s["code"] in cat["done"]


def is_data(s: dict) -> bool:
    return s.get("kind") == "data"


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


class Fixes:
    """Which done data steps rest on something other than what a serial run would have given them."""

    def __init__(self, cat: dict):
        self.cat = cat
        self.data = [s for s in cat["steps"] if is_data(s)]
        self._now: dict = {}
        self._base = None
        # Data steps whose every earlier data step is done: only for them is the serial graph known.
        self.settled = set()
        for s in self.data:
            if not is_done(cat, s):
                break
            self.settled.add(s["code"])

    def now(self, code: str) -> dict:
        """What a serial run gives this step to build on, from the merged work of the steps before it."""
        if code not in self._now:
            if self._base is None:
                import catalog
                self._base, self._pos, self._prov = catalog.load(), gs.order(), gs.prov()
            self._now[code] = gs.summary_before(code, self._base, self._pos, self._prov)
        return self._now[code]

    def diff(self, code: str) -> dict:
        v = gs.seen(code)
        if not v or "seen" not in v:  # done before data steps ran in parallel, so in serial order
            return {}
        return gs.diff(v["seen"], self.now(code))

    def needs_fix(self, code: str) -> bool:
        return code in self.cat["done"] and code in self.settled and bool(self.diff(code))

    def final(self, code: str) -> bool:
        if code not in self.cat["done"]:
            return False
        if code not in self.settled:
            v = gs.seen(code)
            return not (v and "seen" in v)
        return not self.diff(code)

    def final_through(self, code: str) -> bool:
        for s in self.data:
            if not self.final(s["code"]):
                return False
            if s["code"] == code:
                return True
        return True


def state(cat: dict, s: dict, fx: Fixes = None) -> str:
    fx = fx or Fixes(cat)
    if is_done(cat, s):
        return "fix" if is_data(s) and fx.needs_fix(s["code"]) else "done"
    if not all(is_done(cat, find(cat, c)) for c in s["needs"]):
        return "waiting"
    # "books": slugs (or series) the step reads that the book pipeline has not shelved yet (docs/graph/imports.json).
    if s.get("books") and not set(s["books"]) <= shelved():
        return "waiting"
    if s.get("kind") == "user":
        return "user" if not s.get("through") or fx.final_through(s["through"]) else "waiting"
    return "ready"


def run_checks(s: dict) -> list[str]:
    errs = []
    for cmd in s.get("checks", []):
        if is_data(s) and ("tools/catalog.py" in cmd or "tools/test_catalog.py" in cmd) and "--stage" not in cmd:
            cmd += f" --stage {s['code']}"
        r = subprocess.run(cmd, cwd=ROOT, shell=True, capture_output=True, encoding="utf-8", errors="replace",
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        if r.returncode:
            errs.append(f"`{cmd}` 실패:\n{(r.stdout + r.stderr).strip()[-1500:]}")
    return errs


def verify(s: dict) -> list[str]:
    code = s["code"]
    errs = []
    if is_data(s):
        log, where = gs.stage_log(code), f"content/graph/stage/{code}/LOG.md"
    else:
        log, where = (LOG.read_text(encoding="utf-8") if LOG.exists() else ""), "docs/graph/LOG.md"
    if not re.search(rf"^- \[x\] {re.escape(code)}\b", log, re.M):
        errs.append(f"{where}에 '- [x] {code} …' 줄이 없다")
    errs += [f"{f} 파일이 없다" for f in s.get("files", []) if not (ROOT / f).exists()]
    return errs + run_checks(s)


def mark_prompt(code: str) -> str:
    return f"`python tools/graph_pipeline.py mark {code}` 를 통과할 때까지 실행한다(실패 메시지는 고친 뒤 다시)."


def job_for(cat: dict, s: dict) -> dict:
    code = s["code"]
    if is_data(s):
        end = (f"{stage_rules(code)}\n\n끝나면 content/graph/stage/{code}/LOG.md에 '- [x] {code} <날짜> — <확인 결과>' 한 줄을 쓰고 "
               + mark_prompt(code))
    else:
        end = f"끝나면 docs/graph/LOG.md에 '- [x] {code} <날짜> — <확인 결과>' 한 줄을 추가하고 " + mark_prompt(code)
    return {"key": f"library-graph:{code}:r{s.get('rev', 0)}", "title": f"{code} · {s['title']}",
            "model": s.get("model", "opus"), "perm": "auto", "tags": [code],
            "prompt": f"Sisyphus Library 그래프 프로젝트, 단계 {code}({s['title']}). {RULES}\n\n이번 단계: {s['task']}\n\n{end}"}


def describe(d: dict) -> str:
    names = {"works": "작품", "headings": "subject heading", "index": "index(작품 > heading)", "contact": "refers/read note"}
    out = []
    for k, v in d.items():
        for verb, items in (("생김", v["added"]), ("없어짐", v["removed"])):
            if items:
                out.append(f"- {names.get(k, k)} {verb}: " + "; ".join(items))
    return "\n".join(out)


def fix_job(cat: dict, s: dict, fx: Fixes) -> dict:
    code = s["code"]
    now = fx.now(code)
    return {"key": f"library-graph:{code}:fix-{gs.digest(now)}", "title": f"{code} 보정 · {s['title']}",
            "model": s.get("model", "opus"), "perm": "auto", "tags": [code, "보정"],
            "prompt": f"Sisyphus Library 그래프 프로젝트, 단계 {code}({s['title']})의 보정. {RULES}\n\n"
                      f"이 단계는 다른 데이터 단계와 병렬로 이미 끝났다(docs/graph/LOG.md의 '- [x] {code}' 줄과 본 파일에 결과가 있다). "
                      f"그런데 시작할 때는 순서상 앞 단계 몇 개가 아직 병합되지 않아서, 단계들을 순서대로 하나씩 돌렸다면 이 단계가 보았을 그래프와 이렇게 달랐다:\n"
                      f"{describe(fx.diff(code))}\n\n"
                      f"할 일: 결과가 순서대로 돌린 것과 같아지도록, 위 차이에 기대는 판단만 원래 단계의 규칙 그대로 다시 한다. 다른 것은 다시 열지 않는다. "
                      f"(a) 생긴 작품: 이 단계의 모든 reading에 대해 그 작품들로도 대체 테스트를 하고(`python tools/catalog.py substitute <reading> --stage {code}`), "
                      f"qc.substitution의 tried에 더한다. 통과 못 하면 원래 규칙대로 그 reading(과 note)을 내리고 이유를 적는다. "
                      f"이 단계의 leads 중 상대가 생긴 작품인 후보, '그래프에 없음'으로 떨어뜨렸던 후보는 원래 규칙대로 다시 판단한다. "
                      f"(b) 생긴 heading: 이 단계가 새로 만든 heading과 같은 개념이면 앞 단계의 heading을 쓰고 자기 것은 지운다; 이 단계 작품이 그 heading을 enacts하는지 원래 기준대로 본다. "
                      f"(c) index·note 변화: 대체 테스트 대상(peers)이나 contact 판단이 달라지면 고친다. 없어진 항목을 이 단계가 썼다면 고친다. "
                      f"바꿀 것이 없으면 아무것도 바꾸지 않는다.\n\n원래 단계의 지시: {s['task']}\n\n{stage_rules(code)}\n\n"
                      f"끝나면 content/graph/stage/{code}/LOG.md에 '- [x] {code} <날짜> 보정 — <바꾼 것, 또는 바꿀 것 없음과 그 이유>' 한 줄을 쓰고 "
                      + mark_prompt(code)}


def feed() -> list[dict]:
    """보정 jobs first (a review waits on them), then ready steps of the open waves, then those of the waves not open
    yet, marked "later": the control queue runs them only in slots the open waves leave idle."""
    cat = load()
    fx = Fixes(cat)
    opened = open_waves(cat)
    closed = [w["name"] for w in cat["waves"] if w["name"] not in opened and not finished(cat, w)]
    fixes = [fix_job(cat, s, fx) for s in fx.data if fx.needs_fix(s["code"])]
    jobs = [job_for(cat, s) for name in opened for s in wave_steps(cat, name) if state(cat, s, fx) == "ready"]
    return fixes + jobs + [{**job_for(cat, s), "later": True}
                           for name in closed for s in wave_steps(cat, name) if state(cat, s, fx) == "ready"]


def actions(cat: dict, fx: Fixes) -> list[dict]:
    """Buttons for the dashboard: {"id", "label", "confirm", "cmd"}; it runs cmd here when one is pressed."""
    out = []
    opened = open_waves(cat)
    for name in opened:
        for s in wave_steps(cat, name):
            if state(cat, s, fx) == "user":
                out.append({"id": f"ok:{s['code']}", "label": f"{s['code']} 확인", "cmd": f"python tools/graph_pipeline.py ok {s['code']}",
                            "confirm": f"{s['code']} · {s['title']}: 결과를 확인했고 다음 단계로 넘어갈까요? 고칠 점이 있으면 취소하고 세션에서 말해 주세요."})
    for w in cat["waves"]:
        if not finished(cat, w) and w["name"] not in opened:
            out.append({"id": f"start:{w['name']}", "label": f"{w['name']} 시작",
                        "cmd": f"python tools/graph_pipeline.py start {w['name']}",
                        "confirm": f"{w['name']} · {w['label']} 웨이브를 지금 열까요? 선행 단계가 끝난 단계만 대기열에 들어갑니다."})
    return out


def counts(cat: dict, fx: Fixes) -> dict:
    """A step of a wave not open yet counts as waiting, whatever its own prerequisites say."""
    opened = open_waves(cat)
    c: dict[str, int] = {}
    for s in cat["steps"]:
        k = state(cat, s, fx) if s["wave"] in opened or is_done(cat, s) else "waiting"
        c[k] = c.get(k, 0) + 1
    return c


def panel() -> dict:
    cat = load()
    fx = Fixes(cat)
    cur = open_waves(cat)
    waves = []
    for w in cat["waves"]:
        items = [{"slug": s["code"], "title": f"{s['code']} · {s['title']}", "month": w["label"], "stage": state(cat, s, fx)}
                 for s in wave_steps(cat, w["name"])]
        waves.append({"name": w["name"], "months": w["label"], "books": items, "current": w["name"] in cur,
                      "done": finished(cat, w)})
    return {"title": "Sisyphus Library · 그래프", "counts": counts(cat, fx), "total": len(cat["steps"]), "waves": waves,
            "actions": actions(cat, fx), "stages": [{"key": k, "label": l, "color": c} for k, l, c in STAGES],
            "done": {"stage": "done", "label": "완료"}}


def log_line(text: str) -> None:
    body = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
    LOG.write_text(body.rstrip("\n") + f"\n- {datetime.date.today().isoformat()} — {text}\n", encoding="utf-8")


def log_append(lines: str) -> None:
    body = LOG.read_text(encoding="utf-8") if LOG.exists() else ""
    LOG.write_text(body.rstrip("\n") + "\n" + lines.strip("\n") + "\n", encoding="utf-8")


def begin(code: str) -> None:
    with gs.lock():
        cat = load()
        s = find(cat, code)
        if not is_data(s):
            sys.exit(f"{code} is not a data step (only data steps use begin)")
        now = gs.summary_before(code)
        gs.record(code, "begun", now)
        d = gs.STAGE / code
        left = d.exists() and any(d.iterdir())
        d.mkdir(parents=True, exist_ok=True)
    fixing = is_done(cat, s)
    print(f"{code}{' 보정' if fixing else ''}: 작업 폴더 content/graph/stage/{code}/"
          + (" (앞 시도가 남긴 파일이 있다: 이어서 쓰거나 지우고 다시 쓴다)" if left else ""))
    print(f"순서상 이 단계가 보는 그래프(이 단계 자신의 것 빼고): 작품 {len(now['works'])}, heading {len(now['headings'])}, "
          f"index {len(now['index'])}. 관계 상대와 대체 테스트 대상은 이 작품들뿐이다:")
    for w in now["works"]:
        print(f"  {w}")
    print("heading: " + ", ".join(now["headings"]))
    print(f"검사는 `python tools/catalog.py check --stage {code}`. 끝나면 stage의 LOG.md에 줄을 쓰고 "
          f"`python tools/graph_pipeline.py mark {code}`.")


def mark_data(cat: dict, s: dict, today: str) -> None:
    """Under the lock: verify the stage on the step's serial view, merge it, record what it rested on."""
    code = s["code"]
    v = gs.seen(code) or {}
    if "begun" not in v:
        sys.exit(f"{code}: `python tools/graph_pipeline.py begin {code}` 가 기록되지 않았다. begin을 실행하고, "
                 f"그 목록에 없는 작품을 쓰지 않았는지 확인한 뒤 다시 mark한다.")
    fixing = is_done(cat, s)
    errs = verify(s)
    if not fixing:
        nodes = gs.read_rows(gs.STAGE / code / "nodes.jsonl")
        if not any(n.get("kind") == "work" for n in nodes):
            errs.append(f"content/graph/stage/{code}/nodes.jsonl에 work 노드가 없다. 본 파일에 직접 썼다면 그 줄을 stage로 옮기고 본 파일에서 지운다")
    if errs:
        sys.exit(f"{code}: not marked\n" + "\n".join(f"  - {e}" for e in errs))
    changed = gs.merge(code)
    log_append(gs.stage_log(code))
    gs.record(code, "seen", v["begun"])
    gs.clear(code)
    if not fixing:
        cat["done"][code] = today
        save(cat)
    for drafts in ([], ["--drafts"]):
        r = subprocess.run([sys.executable, "tools/catalog.py", "build", *drafts], cwd=ROOT, capture_output=True,
                           encoding="utf-8", errors="replace", env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        if r.returncode:
            print(f"warning: catalog.py build {' '.join(drafts)} failed:\n{(r.stdout + r.stderr).strip()[-800:]}")
    print(f"{code}{' 보정' if fixing else ''}: merged {len(changed)} rows, done")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    os.chdir(ROOT)
    args = sys.argv[1:] or ["status"]
    cmd = args[0]
    if cmd in ("feed", "panel"):
        print(json.dumps(feed() if cmd == "feed" else panel(), ensure_ascii=False))
        return
    if cmd == "begin":
        begin(args[1])
        return
    today = datetime.date.today().isoformat()
    if cmd in ("mark", "ok"):
        with gs.lock():
            cat = load()
            s = find(cat, args[1])
            if (s.get("kind") == "user") != (cmd == "ok"):
                sys.exit(f"{s['code']}: use `{'ok' if s.get('kind') == 'user' else 'mark'}`")
            if missing := [c for c in s["needs"] if not is_done(cat, find(cat, c))]:
                sys.exit(f"{s['code']}: prerequisites not done: {missing}")
            if cmd == "mark" and is_data(s):
                mark_data(cat, s, today)
                return
            if cmd == "ok" and s.get("through") and not Fixes(cat).final_through(s["through"]):
                sys.exit(f"{s['code']}: data steps up to {s['through']} are not all final (보정 pending)")
            if cmd == "mark" and (errs := verify(s)):
                sys.exit(f"{s['code']}: not marked\n" + "\n".join(f"  - {e}" for e in errs))
            cat["done"][s["code"]] = today
            save(cat)
            if cmd == "ok":
                log_line(f"{s['code']} 사용자 확인")
        print(f"{s['code']}: done")
        return
    cat = load()
    if cmd == "start":
        w = next((w for w in cat["waves"] if w["name"] == args[1]), None) or sys.exit(f"no wave {args[1]}")
        if w["name"] in open_waves(cat):
            sys.exit(f"{w['name']} is already open")
        with gs.lock():
            cat = load()
            w = next(w for w in cat["waves"] if w["name"] == args[1])
            w["started"] = today
            save(cat)
        log_line(f"{w['name']} 수동 시작: {w['label']}")
        print(f"{w['name']} started; open: {', '.join(open_waves(cat))}")
        return
    if cmd == "reopen":
        with gs.lock():
            cat = load()
            s = find(cat, args[1])
            cat["done"].pop(s["code"], None)
            s["rev"] = s.get("rev", 0) + 1
            save(cat)
        log_line(f"{s['code']} 다시 (r{s['rev']})")
        print(f"{s['code']}: reopened (r{s['rev']})")
        return
    fx = Fixes(cat)
    if cmd == "next":
        for name in open_waves(cat):
            for s in wave_steps(cat, name):
                print(f"{name}\t{s['code']}\t{LABEL[state(cat, s, fx)]}\t{s['title']}")
        return
    c = counts(cat, fx)
    print("  ".join(f"{LABEL[k]}: {c.get(k, 0)}" for k, _, _ in STAGES))
    print("open waves:", ", ".join(open_waves(cat)) or "(none)")


if __name__ == "__main__":
    main()
