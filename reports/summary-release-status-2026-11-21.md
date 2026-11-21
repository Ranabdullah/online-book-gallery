# Athenaeum — Summary levels and missing-book status
Date: November 21, 2026

## Current verified repository inventory
- Catalog records: **790**.
- Hosted EPUB/PDF book files: **542**.
- Catalog entries missing their book file: **248**.
- Hosted books without an existing cover file: **0**.
- Unhosted book entries without an actual cover file: **232**.
- New EPUB/PDF book files successfully uploaded from conversation ZIPs in this release: **0**.

## Changes committed
- Every one of 790 catalog entries now has two explicit summary slots: `summaries.everyday` and `summaries.inDepth`, plus `summaryStatus`.
- The 542 hosted books are eligible for source-based excerpt analysis; 248 missing files cannot be analyzed until their content is available.
- Book Intelligence now offers **Everyday Summary** (plain language) and **In-Depth Analysis** (advanced close reading), each requiring source text from the actual EPUB/PDF.
- Each generated text must acknowledge excerpts and cite supplied chapter/page identifiers where possible; no invented author quotations or scholarly sources.
- Old unsourced general-purpose fake templates were replaced with explicit "Not yet analyzed" states.
- Former Gemini 2.0 Flash API model was shut down June 2026; updated to Gemini 3.8 Flash. Uses the visitor's **own configured Gemini key**, not a shared site secret.
- Source-based generated summaries are **browser-local**, not automatically published to GitHub.
- Added `missing-books.html`: live missing-file inventory with clearly labelled title-based visual placeholders.
- Cloudflare Pages Worker now serves current GitHub main application files instead of a stale GitHub Pages build, while keeping book binaries on the existing origin. The live missing-books page was verified through Cloudflare's browser renderer.

## What is NOT yet done
- **No complete source-grounded everyday or in-depth summaries have been generated and editorially reviewed for the 790 catalog entries.** The new slots are null/pending. The per-user tool generates analyses on request.
- **No ZIP archive content was published or imported** during this release. Archive bytes were not accessible through the working archive processor.
- Missing book file contents and official edition covers remain missing. The visual title covers on the missing-books page are placeholders, not published official artwork.
- The browser rendering service rate-limited the subsequent live Book Intelligence verification, so the entire multi-step reader/AI flow remains unverified end-to-end.
- Some uploaded PDFs/EPUBs may be copyrighted; verify redistribution permissions before publishing a new copy on the openly accessible GitHub repository.

## Tracking
- `reports/book-summaries-and-covers-status-2026-11-21.csv`: statuses for every catalog entry.
- `reports/missing-books-by-author-2026-11-21.csv`: exact names and missing file paths.
- `missing-books.html`: browsable public list of the 248 missing-file entries.

## Editorial standards for future full summaries
1. **Everyday Summary**: 180–250 words, what the text actually discusses, important characters/ideas where verified, clear takeaways and scope limits.
2. **In-Depth Analysis**: 450–650 words, evidence from identifiable chapters/pages, narrative or argument structure, language, style, themes, plausible competing interpretations and limitations. "PhD-level" is a requested depth, not a scholarly qualification or peer review.
3. Never invent quotes, page references, academic citations, ending details or full plot arcs from title-only metadata or insufficient excerpts.
4. Mark research based on partial excerpts as **partial**, and use a full-edition reading plus independently checked academic sources before presenting a complete scholarly dossier.
