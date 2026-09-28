"""Run `claude -p` with stream-json output, writing each event to a log as it arrives.

Usage: python tools/stream_run.py <log.jsonl> <prompt> [claude args…]

Each JSON line gets a "_ts" (HH:MM:SS) field so tools/watch.py can show the run live.
Prints the final result text as one JSON string (ASCII-escaped, safe for any console encoding)
and exits with claude's exit code.
"""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

CLAUDE = Path(os.environ["USERPROFILE"]) / ".local" / "bin" / "claude.exe"


def main():
    log, prompt, extra = Path(sys.argv[1]), sys.argv[2], sys.argv[3:]
    cmd = [str(CLAUDE), "-p", prompt, *extra, "--output-format", "stream-json", "--verbose"]
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    result = ""
    tail: list[str] = []
    with log.open("a", encoding="utf-8", newline="\n") as out:
        for raw in proc.stdout:
            line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
            if line.startswith("{"):
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    ev = None
                if isinstance(ev, dict):
                    if ev.get("type") == "result":
                        result = str(ev.get("result", ""))
                    line = json.dumps({"_ts": time.strftime("%H:%M:%S"), **ev}, ensure_ascii=False)
            elif line.strip():
                tail = (tail + [line])[-3:]
            out.write(line + "\n")
            out.flush()
    code = proc.wait()
    print(json.dumps(result or " ".join(tail)))
    sys.exit(code)


if __name__ == "__main__":
    main()
