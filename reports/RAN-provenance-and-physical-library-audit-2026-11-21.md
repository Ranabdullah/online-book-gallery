# Athenaeum — R/A/N provenance and cover integrity
Updated November 21, 2026

## Source markers
- **R** = the original 542 hosted book records; attribution to the owner is provisional pending a per-item contribution inventory.
- **A** = books added from Abdurrehman's contributed ZIP archives. The ZIP importer defaults to A, stores the exact ZIP filename and member path, and preserves the source marker on local imports.
- **N** = newly discovered Project Gutenberg books linked externally; these are not locally uploaded EPUB files.

No record from Abdurrehman's ZIPs has yet been published into the hosted 542-file catalog, so **A = 0 currently hosted**. Do not relabel an original book A based on title alone. Existing books that are duplicates of archive members must retain their original attribution unless actual provenance can be established.

## Inventory
- Hosted original files **542**: 445 EPUB, 97 PDF.
- New free-source links **12**, all with N markers and separate neutral designed covers. They do not count as physical hosted files.
- A ZIP books imported on this deployment: **0**; ZIP importer stores books locally in a visitor's browser pending proper authorized publication.
- Cover paths present for all 542 original records. Six identical-cover SHA groups (16 book records) were replaced with individual, clearly labelled neutral SVG covers. Original cover SHA/path mapping backed up in `reports/cover-attribution-before-neutral-replacements-2026-11-21.json`.
- Files and covers confirmed by GitHub tree presence, sizes and formats; sampled 3 EPUB ZIP structures, 1 PDF signature and 2 JPEG signatures. This is not an end-to-end decoding/readability or title-content match audit for all 542 files. Sample `book_0556.epub` has an Apple-specific `META-INF/sinf.xml`, which merits compatibility testing; it does not alone prove DRM or corruption.

## Changes
- Book cards display a circle source mark R, A or N. Footer legend explains attribution and caveats.
- New Gutenberg books are linked by their source URL. The books are **not** copied to the public GitHub repository.
- The ZIP importer asks contributor attribution, defaulting to Abdurrehman, and stores provenance in IndexedDB for added records. Already hosted matches are skipped and retain existing origin.
- Repeated uploaded cover images were replaced with explicit neutral title covers; no user-supplied artwork deleted.

## Pending
- Import ZIPs and match **actual content** against the hosted collection.
- Distinguish Abdurrehman contributions from already existing hosted copies by file hash and edition metadata, not just title strings.
- Full-read test of all 542 EPUB/PDF files, including internal PDF page extraction and EPUB spine/chapter validation.
- Public publishing of book files only when distribution permissions are established.

## Free source rights
Project Gutenberg explicitly marks its eBooks public domain **in the USA**, which does not establish identical rights in all jurisdictions. The external N links preserve the original source attribution and avoid independently republishing copyrighted editions.
