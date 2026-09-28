"""Live dashboard for the book pipeline: http://127.0.0.1:8766

Usage:
  python tools/watch.py            serve the dashboard and open it in the browser
  python tools/watch.py --no-open  serve only

Shows whether a wave is running, what the coordinator and each agent are doing right now
(from the stream-json run log), book stages, and the summary log. Read-only.
"""
import json
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).parent))
import pipeline  # noqa: E402

ROOT = pipeline.ROOT
LOGS = ROOT / "logs"
LOCK = ROOT / ".pipeline.lock"
PAGE = Path(__file__).with_name("watch.html")
PORT = 8766

_books_cache: dict = {"at": 0.0, "data": None}
_books_lock = threading.Lock()


def read_text(p: Path) -> str:
    raw = p.read_bytes()
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return raw.decode("utf-16", errors="replace")
    return raw.decode("utf-8-sig", errors="replace")


def pid_alive(pid: int) -> bool:
    import ctypes
    h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
    ctypes.windll.kernel32.CloseHandle(h)
    return code.value == 259  # STILL_ACTIVE


def running() -> dict:
    if not LOCK.exists():
        return {"running": False}
    try:
        pid = int(LOCK.read_text().strip())
    except ValueError:
        return {"running": False}
    if not pid_alive(pid):
        return {"running": False, "stale_lock": True}
    return {"running": True, "since": time.strftime("%H:%M", time.localtime(LOCK.stat().st_mtime))}


def books() -> dict:
    # Stages need git + glossary checks; recompute at most every 20 s.
    with _books_lock:
        if _books_cache["data"] and time.time() - _books_cache["at"] < 20:
            return _books_cache["data"]
        st = pipeline.states()
        wave = {b["slug"] for b, _ in pipeline.next_wave(st)}
        counts: dict[str, int] = {}
        for _, s in st:
            counts[s] = counts.get(s, 0) + 1
        data = {
            "counts": counts,
            "books": [{"slug": b["slug"], "title": b.get("title", b["slug"]), "month": b["month"],
                       "stage": s, "wave": b["slug"] in wave} for b, s in st],
        }
        _books_cache.update(at=time.time(), data=data)
        return data


def runs() -> list[Path]:
    files = [p for p in LOGS.glob("run-*") if p.suffix in (".log", ".jsonl")]
    return sorted(files, key=lambda p: p.name, reverse=True)


def short(s, n=160) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[: n - 1] + "…"


def tool_summary(name: str, inp: dict) -> str:
    if name == "Bash":
        return inp.get("command", "")
    if name in ("Agent", "Task"):
        return inp.get("description", "") + (f" · {inp['model']}" if inp.get("model") else "")
    for key in ("file_path", "path", "pattern", "url", "query", "skill"):
        if key in inp:
            return str(inp[key])
    return json.dumps(inp, ensure_ascii=False)


def parse_stream(text: str) -> dict:
    events, agents, final, rate = [], {}, None, None
    init = {}
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            if line:
                events.append({"kind": "raw", "text": short(line, 300)})
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = ev.get("_ts", "")
        who = ev.get("parent_tool_use_id")
        label = agents[who]["name"] if who in agents else ("coordinator" if not who else "agent")
        typ = ev.get("type")
        if typ == "system" and ev.get("subtype") == "init":
            init = {"model": ev.get("model"), "session": ev.get("session_id")}
        elif typ == "assistant":
            for c in ev.get("message", {}).get("content", []):
                if c.get("type") == "text" and c.get("text", "").strip():
                    events.append({"ts": ts, "who": label, "kind": "text", "text": short(c["text"], 600)})
                elif c.get("type") == "tool_use":
                    name, inp = c.get("name", ""), c.get("input", {}) or {}
                    if name in ("Agent", "Task"):
                        agents[c["id"]] = {"name": short(inp.get("description", "agent"), 40),
                                           "model": inp.get("model", ""), "start": ts, "done": False}
                    events.append({"ts": ts, "who": label, "kind": "tool", "tool": name,
                                   "text": short(tool_summary(name, inp), 240)})
        elif typ == "user":
            content = ev.get("message", {}).get("content", [])
            for c in content if isinstance(content, list) else []:
                if c.get("type") != "tool_result":
                    continue
                if c.get("tool_use_id") in agents:
                    agents[c["tool_use_id"]].update(done=True, end=ts)
                    events.append({"ts": ts, "who": label, "kind": "agent-done",
                                   "text": agents[c["tool_use_id"]]["name"]})
                elif c.get("is_error"):
                    body = c.get("content")
                    if isinstance(body, list):
                        body = " ".join(x.get("text", "") for x in body if isinstance(x, dict))
                    events.append({"ts": ts, "who": label, "kind": "error", "text": short(body, 300)})
        elif typ == "rate_limit_event":
            rate = ev.get("rate_limit_info")
        elif typ == "result":
            final = {"ok": not ev.get("is_error"), "text": ev.get("result", ""),
                     "cost": ev.get("total_cost_usd"), "minutes": round((ev.get("duration_ms") or 0) / 60000, 1),
                     "turns": ev.get("num_turns")}
    return {"init": init, "events": events[-400:], "agents": list(agents.values()), "final": final,
            "rate": rate}


def run_view(name: str | None) -> dict:
    files = runs()
    names = [p.name for p in files[:30]]
    p = next((f for f in files if f.name == name), files[0] if files else None)
    if not p:
        return {"runs": names, "run": None}
    text = read_text(p)
    view = {"runs": names, "run": p.name, "size": p.stat().st_size,
            "updated": time.strftime("%H:%M:%S", time.localtime(p.stat().st_mtime))}
    if p.suffix == ".jsonl":
        view.update(parse_stream(text))
    else:
        view["plain"] = text[-20000:]
    return view


def state(run: str | None) -> dict:
    summary = LOGS / "pipeline.log"
    lines = read_text(summary).splitlines()[-40:] if summary.exists() else []
    return {"now": time.strftime("%H:%M:%S"), "paused": (ROOT / "PAUSE").exists(), **running(),
            "summary": lines, **books(), **run_view(run)}


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        url = urlparse(self.path)
        if url.path == "/":
            body, ctype = PAGE.read_bytes(), "text/html; charset=utf-8"
        elif url.path == "/api/state":
            run = parse_qs(url.query).get("run", [None])[0]
            body = json.dumps(state(run), ensure_ascii=False).encode("utf-8")
            ctype = "application/json; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"pipeline watch: {url}  (Ctrl+C to stop)")
    if "--no-open" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
