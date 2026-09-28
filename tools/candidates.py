"""Candidate sheet for long works: uncommon words with one sentence each, grouped by chapter.

Usage: python tools/candidates.py <slug> [--max N] [--below F]
Glossary writers read this sheet instead of the whole text for works over 12,000 words.
Rarity is Datamuse frequency (per million words); results are cached in content/raw/freq-cache.json.
Each line: lemma  freq  count-in-text  ¶para  sentence with the word in [[ ]].
"""
import json
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_glossary import load_paragraphs  # noqa: E402
from lemma import lemma  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "content" / "raw" / "freq-cache.json"
WORD = re.compile(r"[A-Za-z]+(?:[’'\-][A-Za-z]+)*")


def freq(word: str) -> float:
    url = f"https://api.datamuse.com/words?sp={urllib.parse.quote(word)}&md=f&max=1"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            data = json.load(r)
    except OSError:
        return -1.0
    if not data or data[0]["word"].lower() != word:
        return 0.0
    tag = next((t for t in data[0].get("tags", []) if t.startswith("f:")), "f:0")
    return float(tag[2:])


def sentence(text: str, start: int, end: int) -> str:
    a = max(text.rfind(c, 0, start) for c in ".!?") + 1
    ends = [i for i in (text.find(c, end) for c in ".!?") if i != -1]
    b = min(ends) + 1 if ends else len(text)
    return (text[a:start] + "[[" + text[start:end] + "]]" + text[end:b]).strip()


def main():
    args = sys.argv[1:]
    slug = args[0]
    cap = int(args[args.index("--max") + 1]) if "--max" in args else 300
    below = float(args[args.index("--below") + 1]) if "--below" in args else 12.0
    paras = load_paragraphs(slug)

    first: dict[str, tuple] = {}  # lemma -> (para, start, end, chapter)
    count: dict[str, int] = {}
    names: set[str] = set()
    chapter = ""
    for pi, p in enumerate(paras, 1):
        if p.startswith("## "):
            chapter = p[3:]
            continue
        for m in WORD.finditer(p):
            w = m.group(0)
            lm = lemma(w).lower()
            if w[0].isupper() and p[:m.start()].rstrip()[-1:] not in ("", ".", "!", "?", "“", "\"", "—", ":"):
                names.add(lm)  # capitalised mid-sentence somewhere: a name
                continue
            if len(lm) < 4:
                continue
            count[lm] = count.get(lm, 0) + 1
            first.setdefault(lm, (pi, m.start(), m.end(), chapter))

    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    missing = [w for w in first if w not in cache]
    with ThreadPoolExecutor(8) as ex:
        for w, f in zip(missing, ex.map(freq, missing)):
            if f >= 0:
                cache[w] = f
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")

    # freq 0 = unknown to Datamuse: mostly names and transparent hyphenated compounds.
    rare = sorted((w for w in first if w not in names and 0 < cache.get(w, -1) < below), key=lambda w: cache[w])[:cap]
    rare.sort(key=lambda w: first[w][:2])
    words = sum(len(p.split()) for p in paras)
    print(f"# {slug}: {words} words, {len(paras)} paragraphs, {len(rare)} candidates (freq < {below}/M)")
    chapter = None
    for w in rare:
        pi, s, e, ch = first[w]
        if ch != chapter:
            chapter = ch
            print(f"\n## {ch or '(opening)'}")
        print(f"{w}\t{cache[w]:g}\t×{count[w]}\t¶{pi}\t{sentence(paras[pi - 1], s, e)}")


if __name__ == "__main__":
    main()
