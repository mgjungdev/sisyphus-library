# Sisyphus Library

Classic public-domain short stories with a tap-to-look-up dictionary.
Static site in `site/` (GitHub Pages), content in `content/`.

## Add a book
1. `python tools/import_gutenberg.py <slug> <gutenberg-id> "<start heading>" ["<next heading>"]` (or the `book-importer` agent)
2. Write `content/glossary/<slug>.json` — format in `content/GLOSSARY_SCHEMA.md` (`glossary-writer`, then `glossary-checker`)
3. Add the book to `content/books.json` (`month: YYYY-MM` puts it on that month's shelf)
4. `python tools/build.py` → push. CI rebuilds and deploys.

## Local preview
`cd site && python -m http.server 8765` → http://127.0.0.1:8765/
