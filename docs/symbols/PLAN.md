# Cover symbols

Every work in the library gets one symbol of its own. The symbol is drawn on its cover (shelf and pull-out) and is its node on the relations map (a round badge in its cloth colour, the symbol in gilt). Until a work has one, it keeps the motif of its genre (`site/js/art.js` MOTIFS).

Project `library-symbols` in the control queue: `python tools/symbol_pipeline.py status | next | feed | panel | mark <code> | ok <code> | start <wave> | reopen <code> | sync`.

## What a symbol shows

- **One thing from the work that stands for it**: an object, a creature or a small scene element that is in the text and carries its central theme. Examples: the blasted oak in *Frankenstein*, the footprint in *Robinson Crusoe*, Darcy's letter in *Pride and Prejudice*. A reader of the book should see why. A reader who has not read it should find the thing when they do.
- Choose from the text, not from film or later fame (no bolts in the neck for the creature). For a work whose text is in `content/sources/`, look at the passages where the thing appears, and name the scene in the file's note.
- **No two works share a symbol.** Look at what `content/symbols/` already holds. When two works share a famous object, pick the one that is particular to this book.
- No letters, words, numerals or faces drawn in detail. A figure may be a silhouette of a few strokes at most. An object reads better than a person.

## How it is drawn (the house style: the genre motifs in `site/js/art.js`)

- `content/symbols/<work>.svg`, where `<work>` is the book's `series` in `content/books.json` (a single-volume book uses its `slug`). The file holds one comment line before `<svg>`, `<!-- <Title>: <what the symbol is and the scene it comes from, one sentence> -->`, then `<svg viewBox="0 0 120 100">` (or `0 0 120 110` / `0 0 120 90`) with only `path`, `circle`, `ellipse`, `line`, `polyline` and `rect`, and no `<g>` (the site wraps the body in one).
- A single gilt line. The site sets `fill="none" stroke="currentColor" stroke-width="2.2"` with round caps and joins. Do not set stroke, stroke-width or colours yourself. The only extras allowed are `fill="currentColor"` on small dots (r ≤ 2.5) and `opacity=".5"`–`".7"` on secondary strokes.
- 3 to 9 elements. Keep a margin of about 6 units inside the viewBox. Keep the main shape between about 60 and 100 units wide, so that symbols sit at the same visual weight as the motifs.
- It must read at **22 px** as a badge. One clear silhouette carries it; details only support it. Check with `python tools/symbol_sheet.py --step <code> --png` and look at the PNG: the cover, the 64/36/22 px badges on light and dark, and the genre motif it replaces. Redraw anything that blurs into a blob, looks like a different thing (a crutch that reads as a glass) or is much heavier or lighter than its neighbours.

## Steps

- Waves of 3 drawing steps, 8 works each, most related works first (the map shows them most). The user reviews the wave's sheet (`*-OK`), then a commit step builds, checks and deploys.
- S1 is the pilot: 8 works drawn by hand. Its review also covers the map change, where nodes became symbol badges and a click opens a cascade.
- Works shelved later: `sync` adds steps for works in `content/books.json` that are in no step yet.
