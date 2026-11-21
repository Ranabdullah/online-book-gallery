# Athenaeum intake batch — 21 November 2026

This is an intake manifest, **not** evidence that user-uploaded binaries were published.
Keep original uploaded archives private pending permissions and verification.

## Eight EPUB titles already represented by hosted files

| Uploaded work | Canonical catalog ID | Original duplicate removed | Status |
| --- | --- | --- | --- |
| Arthur Conan Doyle — The Lost World | book_0168 | book_0765 | Existing hosted edition retained; edition not compared |
| Arthur Conan Doyle — The Memoirs of Sherlock Holmes | book_0169 | book_0766 | Existing hosted edition retained |
| Arthur Conan Doyle — The Return of Sherlock Holmes | book_0170 | book_0767 | Existing hosted edition retained |
| Arthur Conan Doyle — Tales of Terror and Mystery | book_0171 | book_0768 | Existing hosted edition retained |
| Arthur Golden — Memoirs of a Geisha | book_0172 | book_0769 | Existing hosted edition retained |
| Arthur Schopenhauer — Counsels and Maxims | book_0173 | book_0770 | Existing hosted edition retained |
| Arthur Schopenhauer — Essays of Schopenhauer | book_0174 | book_0771 | Existing hosted edition retained |
| Arthur Schopenhauer — The Art of Controversy | book_0176 | book_0773 | Existing hosted edition retained |

Existing catalogue covers are preserved. Uploaded JPGs were not substituted without verifying editions and permissions.

## Six anthropology archives received

| Archive | Potential catalog record | Status |
| --- | --- | --- |
| Companion Encyclopedia of Anthropology.zip | book_0679 | Missing file; ZIP contents not validated |
| Encyclopedia of Anthropology Vol 1 - 5 - Sage Publications.zip | book_0691 | Missing file; ZIP contents not validated |
| Forensic Anthropology.zip | book_0705 / book_0706 / book_0757 (verify title/edition) | Missing files; ZIP contents not validated |
| Philosophy of Anthropology and Sociology.zip | book_0733 | Missing file; ZIP contents not validated |
| The Human Animal A Personal View of the Human Species.zip | book_0749 | Missing file; ZIP contents not validated |
| What Is Anthropology.zip | book_0760 | Missing file; ZIP contents not validated |

## Import requirements

1. Inspect ZIP member names and contents; check book format and corruption.
2. Compute SHA-256 checksums and compare titles/ISBNs/author/edition.
3. Extract covers only when there is permission to use them.
4. Upload approved materials to authenticated private storage, not a public Git repository by default.
5. Update `data/books.json` or Supabase only after verifying the storage path is real.
6. Generate text-grounded summaries after successfully reading source content.
7. Never treat a received chat attachment as persistent Athenaeum storage.

## Account and summary blockers

- `account.html` is a prepared UI, **not functioning authentication** until `js/athenaeum-auth-config.js` is configured for a dedicated Supabase project and SMS provider.
- `data/analyses/` currently contains only `book_0152.json`; the rest have placeholder study dossiers.
- Reading progress, recommendations and shared notes remain browser-local until database, auth, and RLS are connected.
