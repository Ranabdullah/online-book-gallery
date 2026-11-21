# Athenaeum library file audit — 2026-11-21

## Authoritative status

- Source: GitHub `main`, `data/books.json`, complete direct listings of `books/` and `covers/`.
- Catalog entries: **790**.
- Actual book files in `books/`: **542**.
- Catalog records whose expected file exists: **542**.
- Catalog records missing their expected file: **248**.
- Unreferenced book files: **0**.
- Hosted records missing an actual cover: **0**.
- Missing-book records missing an actual cover: **232**.
- Missing-book records incorrectly marked hosted: **0**.
- Present-book records incorrectly marked missing: **0**.
- Exact title+author duplicate groups in current catalog: **0**, based on normalized punctuation/whitespace/case.
- All physical book sizes / formats were compared with catalog metadata. This is a **path and metadata audit**, not proof that the inside of each EPUB/PDF opens successfully. File corruption and wrong-content substitutions are not ruled out.
- No actual EPUB/PDF files were deleted as part of this audit.

## Notes

1. The earlier screenshot showed a **647-line historical CSV**, not the current 248-entry report. The report was replaced in the repository; refresh the GitHub file page to see the latest commit.
2. Some `author` cells contain **collection/folder names** (for example, `Archaeology and Anthropology`, `Arts`), not verified writers. Do not use those as authoritative author attributions.
3. The extra 376 catalog rows removed by the previous deduplication were cross-checked against the retained records: they share author, book title (after removal of the redundant author prefix), and format; this does not prove that their underlying missing files would have been the same edition.
4. Four hosted Andrzej Sapkowski titles now use neutral, clearly generic SVG covers, not false claims to an official edition.
5. This inventory says nothing about whether every book is legally shareable. Store private material only where access is properly restricted.

## Report files

- `library-integrity-audit-2026-11-21.csv`: all 790 records, file/cover existence, and status flags.
- `missing-books-by-author-2026-11-21.csv`: 248 records whose expected book path is missing.
- `missing-author-summary-2026-11-21.csv`: grouped by the *author field as currently recorded*, which is not always a person.
- `removed-exact-catalog-duplicates-2026-11-21.csv`: previous removed duplicate rows for restoration review.

**Storage migration status**: This audit does not transfer files to Supabase or R2 and does not create user accounts. Those features remain separate work.
