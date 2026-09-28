"""Tiny rule-based English lemmatizer (no dependencies).

Good enough to map inflected forms in 19th/early-20th-century fiction to a
dictionary headword for lookups. Curated glossary entries always carry their
own headword, so this only feeds the generic word card.
"""

IRREGULAR = {
    # be / have / do
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be", "been": "be", "being": "be",
    "has": "have", "had": "have", "having": "have",
    "does": "do", "did": "do", "done": "do", "doing": "do",
    # common irregular verbs
    "ate": "eat", "eaten": "eat", "began": "begin", "begun": "begin", "bent": "bend",
    "bit": "bite", "bitten": "bite", "blew": "blow", "blown": "blow", "bore": "bear", "borne": "bear",
    "born": "bear", "bought": "buy", "brought": "bring", "broke": "break", "broken": "break",
    "built": "build", "burnt": "burn", "caught": "catch", "chose": "choose", "chosen": "choose",
    "came": "come", "crept": "creep", "dealt": "deal", "drew": "draw", "drawn": "draw",
    "dreamt": "dream", "drank": "drink", "drunk": "drink", "drove": "drive", "driven": "drive",
    "fell": "fall", "fallen": "fall", "fed": "feed", "felt": "feel", "fought": "fight",
    "found": "find", "fled": "flee", "flew": "fly", "flown": "fly", "forgot": "forget",
    "forgotten": "forget", "froze": "freeze", "frozen": "freeze", "gave": "give", "given": "give",
    "went": "go", "gone": "go", "grew": "grow", "grown": "grow", "hung": "hang", "heard": "hear",
    "hid": "hide", "hidden": "hide", "held": "hold", "kept": "keep", "knelt": "kneel",
    "knew": "know", "known": "know", "laid": "lay", "led": "lead", "leapt": "leap", "left": "leave",
    "lent": "lend", "lay": "lie", "lain": "lie", "lit": "light", "lost": "lose", "made": "make",
    "meant": "mean", "met": "meet", "paid": "pay", "ran": "run", "rang": "ring", "rung": "ring",
    "rose": "rise", "risen": "rise", "rode": "ride", "ridden": "ride", "said": "say", "saw": "see",
    "seen": "see", "sought": "seek", "sold": "sell", "sent": "send", "shook": "shake",
    "shaken": "shake", "shone": "shine", "shot": "shoot", "sang": "sing", "sung": "sing",
    "sank": "sink", "sunk": "sink", "sat": "sit", "slept": "sleep", "slid": "slide", "spoke": "speak",
    "spoken": "speak", "spent": "spend", "spun": "spin", "sprang": "spring", "sprung": "spring",
    "stood": "stand", "stole": "steal", "stolen": "steal", "stuck": "stick", "stung": "sting",
    "struck": "strike", "strode": "stride", "swore": "swear", "sworn": "swear", "swept": "sweep",
    "swam": "swim", "swum": "swim", "swung": "swing", "took": "take", "taken": "take",
    "taught": "teach", "tore": "tear", "torn": "tear", "told": "tell", "thought": "think",
    "threw": "throw", "thrown": "throw", "understood": "understand", "woke": "wake",
    "woken": "wake", "wore": "wear", "worn": "wear", "wept": "weep", "won": "win", "wound": "wind",
    "wrote": "write", "written": "write", "withdrew": "withdraw", "wrung": "wring",
    # nouns
    "children": "child", "men": "man", "women": "woman", "feet": "foot", "teeth": "tooth",
    "mice": "mouse", "geese": "goose", "people": "people", "leaves": "leaf", "lives": "life",
    "wives": "wife", "knives": "knife", "wolves": "wolf", "halves": "half", "selves": "self",
    "shelves": "shelf", "thieves": "thief",
    # adjectives
    "better": "good", "best": "good", "worse": "bad", "worst": "bad",
    # pronouns & function words stay as they are
}

KEEP = {
    "this", "his", "was", "has", "is", "us", "as", "its", "yes", "thus", "news", "always",
    "perhaps", "whereas", "series", "species", "glass", "grass", "moss", "dress", "kiss",
    "princess", "less", "unless", "across", "business", "happiness", "goodness", "sadness",
    "during", "evening", "morning", "nothing", "something", "anything", "everything",
    "king", "ring", "sing", "wing", "thing", "spring", "string", "ceiling", "pudding",
    "red", "bed", "need", "seed", "speed", "feed", "bleed", "hundred", "sacred", "naked", "wicked",
    "sometimes", "towards", "afterwards", "upwards", "downwards", "ceiling", "morning",
    "evening", "wedding", "clothes", "pudding", "being", "herself", "himself", "itself",
}

VOWELS = set("aeiou")
_WORDS = None


def _known(w: str) -> bool:
    global _WORDS
    if _WORDS is None:
        from pathlib import Path
        _WORDS = set((Path(__file__).parent / "wordlist.txt").read_text(encoding="utf-8").split())
    return w in _WORDS


def _candidates(w: str) -> list[str]:
    c = []
    if w.endswith("ies") and len(w) > 4:
        c.append(w[:-3] + "y")
    if w.endswith("ied") and len(w) > 4:
        c.append(w[:-3] + "y")
    if w.endswith("s") and not w.endswith(("ss", "us", "is")):
        c.append(w[:-1])
    if w.endswith("es"):
        c.append(w[:-2])
    for suf in ("ing", "ed"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            stem = w[: -len(suf)]
            c.append(stem + "e")
            if len(stem) > 2 and stem[-1] == stem[-2]:
                c.append(stem[:-1])
            if stem.endswith("i"):
                c.append(stem[:-1] + "y")
            c.append(stem)
    return c


def lemma(word: str) -> str:
    w = word.lower().replace("’", "'")
    if w.endswith("'s"):
        w = w[:-2]
    if w in IRREGULAR:
        return IRREGULAR[w]
    if w in KEEP or len(w) <= 3 or (w.endswith("ly") and len(w) > 4):
        return w
    for c in _candidates(w):
        if _known(c):
            return c
    return w


if __name__ == "__main__":
    import sys
    for a in sys.argv[1:]:
        print(a, "->", lemma(a))
