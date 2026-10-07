"""Cut the 1818 text of Frankenstein (Project Gutenberg #41445) into frankenstein-1 and frankenstein-2.

The 1818 edition restarts chapter numbers in each of its three volumes, so headings carry the volume
("## Vol. II, Chapter VI"). Volume title pages and the repeated Paradise Lost epigraph are left out;
the 1818 Preface is not part of the reading text (it is a context: content/contexts/pbs-1818-preface.txt).

The split matches the earlier two-volume split: frankenstein-2 opens at Vol. II, Chapter VI.

Usage: python tools/editions/frankenstein_1818.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from import_gutenberg import SOURCES, cut, fetch, paragraphs  # noqa: E402

HEADING = r"(LETTER|CHAPTER) [IVXL]+\."
ROMAN = ["I", "II", "III"]
NAMES = {"SAVILLE": "Saville", "WALTON": "Walton"}


def smallcaps(p: str) -> str:
    """Lower the small-caps lead-in the importer leaves behind ("My DEAR SISTER," -> "My dear sister,")."""
    for caps, name in NAMES.items():
        p = p.replace(caps, name)
    words = p.split(" ")
    for i, w in enumerate(words[:4]):
        if i and re.fullmatch(r"[A-Z]{2,}[,.;:]?", w):
            words[i] = w.lower()
    return " ".join(words)


def edition() -> list[str]:
    text = fetch(41445)
    paras = paragraphs(cut(text, "LETTER I.", None, 1, True), HEADING)
    out, vol, skipping = [], 0, False
    for p in paras:
        if p in ("Frankenstein;", "Or,", "The MODERN PROMETHEUS.", "The END."):
            continue
        if p.startswith("End OF VOL."):
            skipping = True
            continue
        if skipping:
            skipping = p != "Paradise Lost."
            continue
        m = re.fullmatch(r"## (LETTER|CHAPTER) ([IVXL]+)", p)
        if m and m.group(1) == "CHAPTER":
            if m.group(2) == "I":
                vol += 1
            out.append(f"## Vol. {ROMAN[vol - 1]}, Chapter {m.group(2)}")
            continue
        if m:
            out.append(f"## Letter {m.group(2)}")
            continue
        out.append(smallcaps(p))
    return out


def main():
    paras = edition()
    split = paras.index("## Vol. II, Chapter VI")
    for slug, part in (("frankenstein-1", paras[:split]), ("frankenstein-2", paras[split:])):
        (SOURCES / f"{slug}.txt").write_text("\n\n".join(part) + "\n", encoding="utf-8")
        words = sum(len(p.split()) for p in part if not p.startswith("## "))
        print(f"{slug}: {len(part)} paragraphs, {words} words")


if __name__ == "__main__":
    main()
