"""Print a compact review sheet for a glossary: each entry with its sentence.
Flags IPA that differs from Datamuse (after normalising ə/ʌ, stress marks and length marks).

Usage: python tools/review_sheet.py <slug> [<slug> ...]
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_glossary import find_all, load_paragraphs  # noqa: E402
from lookup import ipa_of  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def norm(ipa: str) -> str:
    s = ipa.strip("/")
    for a, b in (("ˈ", ""), ("ˌ", ""), ("ː", ""), (".", ""), (" ", ""), ("ɚ", "ər"), ("ɝ", "ər"), ("ɜ", "ə"), ("ɹ", "r"),
                 ("ɡ", "g"), ("ɫ", "l"), ("ɒ", "ɑ"), ("ʌ", "ə"), ("ɪ", "ə"), ("ntʃ", "nʃ"), ("ŋk", "nk"), ("ɔr", "or"), ("oʊr", "or")):
        s = s.replace(a, b)
    return s


def differs(mine: str, ref: str) -> bool:
    import difflib
    a, b = norm(mine), norm(ref)
    return difflib.SequenceMatcher(None, a, b).ratio() < 0.8


def sentence(text: str, start: int, end: int) -> str:
    a = max(text.rfind(". ", 0, start), text.rfind("? ", 0, start), text.rfind("! ", 0, start))
    b = min([i for i in (text.find(". ", end), text.find("? ", end), text.find("! ", end)) if i != -1] or [len(text)])
    s = text[a + 2 if a != -1 else 0 : b + 1]
    return s[:start - (a + 2 if a != -1 else 0)] + "[[" + text[start:end] + "]]" + s[end - (a + 2 if a != -1 else 0):]


def main():
    for slug in sys.argv[1:]:
        paras = load_paragraphs(slug)
        data = json.loads((ROOT / "content" / "glossary" / f"{slug}.json").read_text(encoding="utf-8"))
        es = data["entries"]
        with ThreadPoolExecutor(8) as ex:
            dm = list(ex.map(lambda e: ipa_of(e["headword"]), es))
        print(f"################ {slug} ({len(es)} entries)")
        for e, d in zip(es, dm):
            p = paras[e["para"] - 1]
            hits = find_all(p, e["match"])
            st = hits[e.get("occurrence", 1) - 1] if hits else 0
            flag = ""
            if e.get("ipa") and d and " " not in e["headword"] and differs(e["ipa"], d):
                flag = f"   <-- IPA differs from Datamuse {d}"
            print(f"\n[{e['id']}] {e['headword']} ({e['pos']}) {e.get('ipa')}{flag}")
            print(f"  « {sentence(p, st, st + len(e['match']))} »")
            print(f"  EN: {e['sense_en']}")
            print(f"  KO: {e['sense_ko']}")
            print("  SYN: " + " | ".join(f"{s['word']}: {s['nuance']}" for s in e["synonyms"]))
            if e.get("modern"):
                print(f"  MODERN: {e['modern']}")
            if e.get("tip_ko"):
                print(f"  TIP: {e['tip_ko']}")


if __name__ == "__main__":
    main()
