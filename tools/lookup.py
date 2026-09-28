"""Batch dictionary lookup for glossary writing (Datamuse).

Usage: python tools/lookup.py word1 word2 ...     (or  -f words.txt)
Prints, per word: American IPA (stress marks placed at syllable onset), part-of-speech
tags, the first definitions, and synonym candidates.
"""
import json
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ONSETS = {"pl", "pr", "bl", "br", "tr", "dr", "kl", "kr", "gl", "gr", "fl", "fr", "θr", "ʃr", "sp", "st", "sk", "sm",
          "sn", "sl", "sw", "tw", "kw", "dw", "spr", "str", "skr", "spl", "skw"}
VOW = set("aeiouæɑɒɔəɛɜɪʊʌɚɝyː")


def fix_stress(ipa: str) -> str:
    out: list[str] = []
    for ch in ipa:
        if ch not in "ˈˌ":
            out.append(ch)
            continue
        j = len(out)
        while j > 0 and out[j - 1] not in VOW and out[j - 1] not in "ˈˌ ":
            j -= 1
        cluster = "".join(out[j:])
        n = 1 if cluster else 0
        for ln in (3, 2):
            if len(cluster) >= ln and (cluster[-ln:] in ONSETS or cluster[-ln:] in ("tʃ", "dʒ")):
                n = ln
                break
        out.insert(len(out) - n, ch)
    return "".join(out)


def get(url):
    with urllib.request.urlopen(url, timeout=20) as r:
        return json.load(r)


def ipa_of(word: str) -> str | None:
    key = word.split()[-1] if " " in word else word
    try:
        res = get("https://api.datamuse.com/words?" + urllib.parse.urlencode({"sp": key, "md": "dpr", "ipa": 1, "max": 1}))
    except Exception:
        return None
    if not res or res[0]["word"].lower() != key.lower():
        return None
    tag = next((t for t in res[0].get("tags", []) if t.startswith("ipa_pron:")), None)
    return "/" + fix_stress(tag[9:]) + "/" if tag else None


def look(word: str) -> str:
    q = urllib.parse.quote(word)
    try:
        meta = get(f"https://api.datamuse.com/words?sp={q}&md=dpr&ipa=1&max=1")
        syn = get(f"https://api.datamuse.com/words?rel_syn={q}&max=12")
        if len(syn) < 4:
            syn += get(f"https://api.datamuse.com/words?ml={q}&max=12")
    except Exception as e:  # noqa: BLE001
        return f"## {word}\n  (lookup failed: {e})"
    lines = [f"## {word}"]
    if meta and meta[0]["word"].lower() == word.lower():
        m = meta[0]
        tags = m.get("tags", [])
        ipa = next((t[9:] for t in tags if t.startswith("ipa_pron:")), None)
        pos = [t for t in tags if t in ("n", "v", "adj", "adv")]
        lines.append(f"  ipa: /{fix_stress(ipa)}/" if ipa else "  ipa: ?")
        lines.append(f"  pos: {', '.join(pos)}")
        for d in m.get("defs", [])[:5]:
            lines.append("  - " + d.replace("\t", ": "))
    else:
        lines.append("  (no Datamuse entry)")
    words = list(dict.fromkeys(s["word"] for s in syn if " " not in s["word"]))[:12]
    lines.append("  syn: " + ", ".join(words))
    return "\n".join(lines)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["-f"]:
        args = [w.strip() for w in open(args[1], encoding="utf-8") if w.strip()]
    with ThreadPoolExecutor(8) as ex:
        for block in ex.map(look, args):
            print(block)
