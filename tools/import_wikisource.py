"""Import a proofread Wikisource transcription as a context text.

Usage:
    python tools/import_wikisource.py <context id> "<Wikisource page title>"

Output:
    content/contexts/<id>.txt         one paragraph per line, blank line between (verse lines joined by " / ")
    content/contexts/<id>.pages.json  for each paragraph (1-based), the printed page it starts on
Notes, page numbers, headers and other no-export furniture are left out.
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTEXTS = ROOT / "content" / "contexts"
API = "https://en.wikisource.org/w/api.php"
UA = "SisyphusLibrary/1.0 (study library; contact via GitHub)"
SKIP = re.compile(r"ws-noexport|ws-header|reference|mw-references|cite-bracket|mw-cite-backlink|wst-header")


def fetch(title: str) -> str:
    q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "text",
                                "format": "json", "formatversion": 2})
    req = urllib.request.Request(f"{API}?{q}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["parse"]["text"]


class Blocks(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.paras, self.pages = [], []
        self.buf, self.lines = [], None
        self.skip = 0  # stack depth of the furniture element we are inside (0: none)
        self.stack = []
        self.page = None

    def handle_starttag(self, tag, attrs):
        if tag in ("br", "img", "hr", "meta", "link", "wbr", "input"):
            return
        a = dict(attrs)
        cls = a.get("class", "")
        self.stack.append((tag, cls))
        if self.skip:
            return
        if "ws-pagenum" in cls:
            self.page = a.get("data-page-number") or self.page
        if "ws-pagenum" in cls or SKIP.search(cls) or tag in ("style", "script", "sup"):
            self.skip = len(self.stack)
            return
        if tag == "div" and cls.split()[:1] == ["ws-poem"]:
            self.lines = []
        if tag == "span" and "ws-poem-line" in cls and self.lines is not None:
            self.buf = []

    def handle_endtag(self, tag):
        if tag in ("br", "img", "hr", "meta", "link", "wbr", "input") or not self.stack:
            return
        while self.stack and self.stack[-1][0] != tag and len(self.stack) > 1:
            self.stack.pop()  # tolerate unclosed inline tags
        depth = len(self.stack)
        t, cls = self.stack.pop()
        if self.skip:
            if depth <= self.skip:
                self.skip = 0
            return
        if t == "span" and "ws-poem-line" in cls and self.lines is not None:
            line = " ".join("".join(self.buf).split())
            if line:
                self.lines.append(line)
            self.buf = []
        elif t == "div" and cls.split()[:1] == ["ws-poem"] and self.lines is not None:
            if self.lines:
                self.emit(" / ".join(self.lines))
            self.lines = None
            self.buf = []
        elif t == "p" and self.lines is None:
            self.emit(" ".join("".join(self.buf).split()))
            self.buf = []

    def handle_data(self, data):
        if not self.skip:
            self.buf.append(data)

    def emit(self, text):
        if text:
            self.paras.append(text)
            self.pages.append(self.page)


def main():
    cid, title = sys.argv[1], sys.argv[2]
    p = Blocks()
    p.feed(fetch(title))
    CONTEXTS.mkdir(parents=True, exist_ok=True)
    (CONTEXTS / f"{cid}.txt").write_text("\n\n".join(p.paras) + "\n", encoding="utf-8")
    pages = {str(i + 1): pg for i, pg in enumerate(p.pages)}
    (CONTEXTS / f"{cid}.pages.json").write_text(json.dumps(pages, indent=1) + "\n", encoding="utf-8")
    words = sum(len(x.split()) for x in p.paras)
    print(f"{cid}: {len(p.paras)} paragraphs, {words} words, pages {sorted(set(filter(None, p.pages)))}")


if __name__ == "__main__":
    main()
