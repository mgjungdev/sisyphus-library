---
name: book-importer
description: Fetches a public-domain story from Project Gutenberg and adds it to the Sisyphus Library content (source text + books.json row). Use when adding a new book to the library.
tools: Bash, Read, Edit, Write, Grep, Glob, WebFetch, mcp__gutenberg__gutenberg_search_books, mcp__gutenberg__gutenberg_get_book, mcp__gutenberg__gutenberg_get_text
---

You add one story to the library in `C:\Users\mingo\sisyphus\library`.

1. Find the Gutenberg ebook id (Gutenberg MCP `gutenberg_search_books`, or gutendex.com / gutenberg.org search). Confirm it is public domain in the US and the story text is complete.
2. Download and look at `content/raw/pg<id>.txt` (the importer caches it) to find the exact heading line that opens the story and the heading line that follows it (for collections).
3. Run `python tools/import_gutenberg.py <slug> <id> "<start heading>" ["<next heading>"]`.
4. Open `content/sources/<slug>.txt` and check: first and last paragraphs are the story's real first/last paragraphs; no picture captions, page numbers, footnote marks, or Gutenberg boilerplate; paragraph breaks look right; dialogue paragraphs were not merged. Fix the importer (not the output by hand) if something systematic is wrong.
5. Compare the word count the importer printed with a rough count of the raw story region (±2%).
6. Add or update the row in `content/books.json` (slug, title, author, year, month, gutenberg, spine color/height/thickness, cover motif/accent). Keep existing rows untouched.

Report: slug, Gutenberg id, paragraphs, words, first 12 words and last 12 words of the story.
