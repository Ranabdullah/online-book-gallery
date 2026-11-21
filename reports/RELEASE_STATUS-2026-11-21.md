# Athenaeum — Import queue and release status
Date: 2026-11-21

## Uploaded ZIPs in the conversation
These archives have been attached in ChatGPT but **are not hosted by Athenaeum**. Filenames and sizes below are attachment metadata; the ZIP members were not accessible to the archive-processing runtime during this update. Do not treat these as verified book contents.

| Archive | Size (MiB) | Status |
|---|---:|---|
| Companion Encyclopedia of Anthropology.zip | 453.4 | Awaiting content extraction and private upload |
| Encyclopedia of Anthropology Vol 1 - 5 - Sage Publications.zip | 395.6 | Awaiting content extraction and private upload |
| Forensic Anthropology.zip | 390.6 | Awaiting content extraction and private upload |
| Philosophy of Anthropology and Sociology.zip | 469.4 | Awaiting content extraction and private upload |
| The Human Animal A Personal View of the Human Species.zip | 444.4 | Awaiting content extraction and private upload |
| What Is Anthropology.zip | 343.9 | Awaiting content extraction and private upload |
| Smart Math-20261121T202252Z-1-001.zip | 0 | Awaiting content extraction and private upload |
| Science-20261121T201307Z-1-001.zip | 329.9 | Awaiting content extraction and private upload |
| Religion-20261121T201305Z-1-001.zip | 253.1 | Awaiting content extraction and private upload |
| Psychology-20261121T201304Z-1-001.zip | 237.4 | Awaiting content extraction and private upload |
| Physics-20261121T201303Z-1-001.zip | 142.8 | Awaiting content extraction and private upload |
| Philosophy-20261121T201301Z-1-001.zip | 132.4 | Awaiting content extraction and private upload |
| Mathematics-20261121T201257Z-1-001.zip | 101.8 | Awaiting content extraction and private upload |
| Why !-20261121T201313Z-1-001.zip | 46.9 | Awaiting content extraction and private upload |
| Music-20261121T201259Z-1-001.zip | 19.5 | Awaiting content extraction and private upload |
| Management-20261121T201255Z-1-001.zip | 68.2 | Awaiting content extraction and private upload |
| Mechanical Engineering-20261121T201258Z-1-001.zip | 28.5 | Awaiting content extraction and private upload |
| SOP's-20261121T201311Z-1-001.zip | 0.1 | Awaiting content extraction and private upload |
| World-20261121T201314Z-1-001.zip | 0 | Awaiting content extraction and private upload |
| SAT-20261121T201306Z-1-001.zip | 1 | Awaiting content extraction and private upload |
| Music-20261121T202233Z-1-001.zip | 19.5 | Awaiting content extraction and private upload |
| Online-Book-Gallery-Local-Reader-1.0.1.zip | 4 | Awaiting content extraction and private upload |

## This release contains
- `my-hub.html`: local shelf, reading history, notes entry points, recommendations and backup export.
- `zip-import.html`: client-side ZIP inspection, duplicate matching and local EPUB/PDF import (NOT cloud upload).
- `js/source-summary.js`: source-based extractive previews and optional opt-in Gemini excerpt summaries (NOT all-book full summaries).
- The historical **unauthenticated** public progress-sync relay was disabled to prevent cross-user data exposure; local reading progress remains on device.
- Existing reader and gallery remain intact; missing catalog file references remain flagged.
- Covers are available for the 542 hosted titles; remaining 232 missing-cover entries have missing book files.

## Not complete / blocked
1. **No ZIP bytes were sent to R2, GitHub or Supabase.** The archive processing runtime cannot open the conversation attachments here.
2. **Cloudflare R2 is not enabled** in the Sara Jane account (API responds 403: enable R2 through dashboard). Do not publish copyrighted or personal book archives through public GitHub.
3. **A dedicated Athenaeum Supabase project is not created.** Provider quoted **0 per month**, but the connector requires a cost-confirmation ID; the user must approve any confirmation step before project creation. Existing unrelated Supabase projects are untouched.
4. **Phone SMS login is not active** until Supabase project and SMS provider are configured. A display name alone is not proof of identity.
5. **Cross-device private account sync, shared notes, and shared recommendations are not active**; browser-local data is not an account.
6. **Source summaries are generated on demand** and are clearly marked as partial excerpts; comprehensive summaries were not generated for every book.
7. The website pages and new local ZIP importer have not yet been browser end-to-end tested in this runtime.

## Safe continuation
Enable R2, approve the new isolated Supabase project, configure SMS or use a supported passwordless alternative, then implement authenticated uploads and per-user RLS. After that, import archive ZIPs (or upload them from user's PC) into **private** storage and run a title/content/edition deduplication report before making any permitted books available to other members. Never overwrite existing book files without verified content identity.

## Audit report
See `reports/library-integrity-audit-2026-11-21.csv`, `reports/missing-books-by-author-2026-11-21.csv`, and `reports/removed-exact-catalog-duplicates-2026-11-21.csv`.
