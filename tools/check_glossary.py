"""Validate content/glossary/<slug>.json against content/sources/<slug>.txt.

Usage: python tools/check_glossary.py <slug> [<slug> ...]
Exit code 1 if any error.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
POS = {"noun", "verb", "adjective", "adverb", "phrase", "idiom", "preposition", "conjunction", "phrasal verb", "interjection", "pronoun"}
REQUIRED = ["id", "match", "para", "headword", "pos", "sense_en", "sense_ko", "synonyms"]


def load_paragraphs(slug: str) -> list[str]:
    text = (ROOT / "content" / "sources" / f"{slug}.txt").read_text(encoding="utf-8")
    return [p.strip() for p in text.split("\n\n") if p.strip()]


def find_all(para: str, match: str) -> list[int]:
    pat = re.compile(r"(?<![\w’'])" + re.escape(match) + r"(?![\w’'])", re.IGNORECASE)
    return [m.start() for m in pat.finditer(para)]


def check(slug: str) -> list[str]:
    errors = []
    paras = load_paragraphs(slug)
    path = ROOT / "content" / "glossary" / f"{slug}.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        return [f"{path.name}: cannot parse JSON: {e}"]
    if data.get("slug") != slug:
        errors.append(f"slug field is {data.get('slug')!r}, expected {slug!r}")
    seen = set()
    spans = {}
    for i, e in enumerate(data.get("entries", [])):
        tag = f"entry #{i + 1} ({e.get('id', '?')})"
        for k in REQUIRED:
            if e.get(k) in (None, "", []):
                errors.append(f"{tag}: missing {k}")
        eid = e.get("id", "")
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", eid or ""):
            errors.append(f"{tag}: id must be lowercase-hyphenated")
        if eid in seen:
            errors.append(f"{tag}: duplicate id")
        seen.add(eid)
        if e.get("pos") and e["pos"] not in POS:
            errors.append(f"{tag}: pos {e['pos']!r} not in {sorted(POS)}")
        ipa = e.get("ipa")
        if ipa and not (ipa.startswith("/") and ipa.endswith("/")):
            errors.append(f"{tag}: ipa must be between slashes")
        syn = e.get("synonyms") or []
        if not 2 <= len(syn) <= 4:
            errors.append(f"{tag}: needs 2-4 synonyms (has {len(syn)})")
        for s in syn:
            if not all(s.get(k) for k in ("word", "nuance", "example")):
                errors.append(f"{tag}: synonym {s.get('word')!r} needs word, nuance, example")
        p = e.get("para")
        if not isinstance(p, int) or not 1 <= p <= len(paras):
            errors.append(f"{tag}: para {p} out of range 1..{len(paras)}")
            continue
        if paras[p - 1].startswith("## "):
            errors.append(f"{tag}: para {p} is a chapter heading")
            continue
        hits = find_all(paras[p - 1], e.get("match", ""))
        occ = e.get("occurrence", 1)
        if len(hits) < occ:
            errors.append(f"{tag}: match {e.get('match')!r} occurrence {occ} not found in paragraph {p} (found {len(hits)})")
            continue
        start = hits[occ - 1]
        key = (p, start)
        if key in spans:
            errors.append(f"{tag}: same text position as {spans[key]}")
        spans[key] = eid
    n = len(data.get("entries", []))
    words = sum(len(p.split()) for p in paras if not p.startswith("## "))
    lo, hi = (25, 70) if words < 8000 else (40, 110)
    if words < 1500:
        lo = 12
    if not lo <= n <= hi:
        errors.append(f"{n} entries (expected {lo}-{hi} for {words} words)")
    return errors


def main():
    bad = False
    for slug in sys.argv[1:]:
        errs = check(slug)
        if errs:
            bad = True
            print(f"✗ {slug}: {len(errs)} error(s)")
            for e in errs:
                print("   ", e)
        else:
            print(f"✓ {slug}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
