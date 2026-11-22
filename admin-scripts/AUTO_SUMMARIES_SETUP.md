# Athenaeum — Automatic Everyday & In-Depth Summaries

The repository contains a **daily scheduled automation** to generate both levels of analysis for all **GitHub-hosted PDF and EPUB books** and automatically detect future book entries. It is configured but **cannot generate results until you add a private Gemini API key and run it**.

## Enable once

1. Open [GitHub Actions repository secrets](https://github.com/Ranabdullah/online-book-gallery/settings/secrets/actions).
2. Add a repository secret called `GEMINI_API_KEY`. Use a **new Gemini key**, not any credential previously pasted into chat. A key may have usage limits or paid quota, depending on your Gemini account.
3. Open [Auto-generate Athenaeum Summaries](https://github.com/Ranabdullah/online-book-gallery/actions/workflows/auto-summaries.yml), select **Run workflow**, and use 5–10 books for the initial test.
4. Review the run's `SAVED` lines, error report and published book pages. Later runs can process more books; the daily schedule attempts up to 20 pending books.
5. Check a finished book's **Book Intelligence** page to read its two published excerpt-based levels. Each book is stored as `data/generated-summaries/<bookId>.json` and will not be regenerated once both levels exist.

## What is actually generated

- **Everyday** — accessible overview and evidence-grounded takeaways.
- **In-Depth** — cautious analysis of structure, themes and style, referencing provided page/section markers.
- These are deliberately **excerpt-based**. The runner samples up to about 14 PDF pages or EPUB spine sections and may not reflect the full book.
- An image-only or damaged file, inaccessible file or one larger than 80 MB is reported as unprocessed. Such files are not fabricated from their filenames.
- The report `data/generated-summaries-status.json` lists the most recent batch's successes and failures. `data/generated-summaries-failures.json` backs off unsuccessful sources for seven days before retry.
- API access, quota and pricing may vary, so begin with a small batch and verify usage. The API key stays in GitHub's encrypted Actions Secrets and is never committed to the repository.

## Existing and new books

- Current supported public-hosted catalog: **542 books** (445 EPUB / 97 PDF). Availability of extractable text is not guaranteed.
- New **GitHub-hosted** books added to `data/books.json` or `books/` trigger the automation, and the nightly run also checks for pending books.
- New books uploaded **privately** into Cloudflare R2 require a separate encrypted/private summary storage pathway. For safety, this public GitHub workflow does **not** expose private-book text or analyses.
- Manually imported browser-only books can still be processed through [Bulk Summaries](https://ranabdullah.github.io/online-book-gallery/bulk-summaries.html) with a local key and then exported.

## Safety and verification

Only process and transmit documents to Gemini when you have the necessary rights and authorization. The existing book binaries in GitHub Pages are already public; the automation does not change their visibility. Automatic generated summaries are published to the public repository, so do not use this workflow for confidential materials.

The initial setup and first run must be verified; creating the workflow alone does not mean 542 summaries have already been produced.
