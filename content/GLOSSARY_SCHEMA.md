# Glossary file format — `content/glossary/<slug>.json`

```json
{
  "slug": "happy-prince",
  "entries": [
    {
      "id": "gild",
      "match": "gilded",
      "para": 1,
      "occurrence": 1,
      "headword": "gild",
      "pos": "verb",
      "ipa": "/ɡɪld/",
      "sense_en": "covered with a thin layer of gold",
      "sense_ko": "금박을 입힌",
      "synonyms": [
        {"word": "gold-plated", "nuance": "Everyday, technical: a thin gold coat over cheaper metal.", "example": "a gold-plated watch"},
        {"word": "gilt", "nuance": "Older adjective form; common for picture frames and book edges.", "example": "gilt-edged pages"}
      ],
      "modern": null,
      "tip_ko": null,
      "all": true
    }
  ]
}
```

| field | required | meaning |
|---|---|---|
| `id` | yes | unique within the file; lowercase, hyphens (`crying-for-the-moon`) |
| `match` | yes | exact text as it appears in the source paragraph (a word or a multi-word phrase). Case-insensitive, curly apostrophes as in the source (`’`) |
| `para` | yes | 1-based paragraph number in `content/sources/<slug>.txt` (paragraphs are separated by blank lines) |
| `occurrence` | no (1) | which occurrence of `match` inside that paragraph |
| `headword` | yes | dictionary form (`gild`, `cry for the moon`) |
| `pos` | yes | noun / verb / adjective / adverb / phrase / idiom / preposition / conjunction |
| `ipa` | yes | American IPA between slashes; for phrases give the key word only or null |
| `sense_en` | yes | the meaning **in this sentence**, simple learner English, ≤ 20 words |
| `sense_ko` | yes | natural Korean for that sense (not a list of dictionary glosses) |
| `synonyms` | yes (2–4) | each: `word`, `nuance` (how it differs from the headword, ≤ 25 words, English), `example` (short, natural phrase or sentence) |
| `modern` | no | for archaic/literary usage: what people say today (`"evermore" → "forever"`) |
| `tip_ko` | no | one short Korean tip when Korean speakers typically confuse or mispronounce it |
| `all` | no (true) | also link the other occurrences of the same `match` in the story |

Selection — entry count scales with length: under 1,500 words 12–30; under 8,000 words 30–60; under 20,000 words 60–100; a novel volume (20,000+ words) 90–140 — always spread across all chapters:
1. hard or rare words a B1–B2 learner would not know,
2. easy-looking words whose synonyms differ in nuance (gaze / stare / glance),
3. archaic, literary or idiomatic expressions (incl. multi-word phrases).
Do not gloss very common words (the top ~2,000) unless used in an unusual sense.
