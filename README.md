# Sisyphus Library

**Live site: https://mgjungdev.github.io/sisyphus-library/**

Classic public-domain fiction, from short stories to novels, with a tap-to-look-up dictionary.
Static site in `site/` (GitHub Pages), content in `content/`.

## Add a book
1. `python tools/import_gutenberg.py <slug> <gutenberg-id> "<start heading>" ["<next heading>"]` (or the `book-importer` agent)
2. Add the book to `content/books.json` (`month: YYYY-MM` puts it on that month's shelf)
3. Check the imported text (clean start and end, no Gutenberg boilerplate, `## ` chapter headings), then `python tools/pipeline.py mark-reviewed <slug>`
4. `python tools/build.py` → push. CI rebuilds and deploys.

## Local preview
`cd site && python -m http.server 8765` → `http://127.0.0.1:8765/` (local only)
