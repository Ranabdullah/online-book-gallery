# Athenaeum — finish the private shared library

The website, ZIP importer, encrypted remembered session and Cloudflare R2 Worker are committed to GitHub. **The cloud backend is not active until the deployment workflow succeeds.**

## One-time setup (no terminal required)

1. Open [Athenaeum GitHub repository settings](https://github.com/Ranabdullah/online-book-gallery/settings/secrets/actions).
2. Add three **repository secrets** (Settings → Secrets and variables → Actions → New repository secret):
   - `CLOUDFLARE_API_TOKEN` — a **new** Cloudflare API token with `Workers Scripts Write` and `Workers R2 Storage Write` permissions for Athenaeum's Cloudflare account. Generate this in Cloudflare → My Profile → API Tokens. Do not share it in chat.
   - `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account identifier displayed in the Cloudflare dashboard.
   - `ATHENAEUM_LIBRARY_CODE` — a **new random code of at least 24 characters**, generated using Athenaeum's "Generate secure code" control. **Don't reuse the one previously pasted in chat.** Share this replacement only with your friend, privately.
3. Go to [Deploy Athenaeum Private Library](https://github.com/Ranabdullah/online-book-gallery/actions/workflows/deploy-private-library.yml) and choose **Run workflow** on `main`.
4. After the workflow succeeds, open the deployment's run summary. It displays the **public Worker endpoint** (not a secret), such as `https://athenaeum-private-library.YOUR-SUBDOMAIN.workers.dev`. If the summary cannot determine it, find the endpoint in Cloudflare → Workers & Pages → `athenaeum-private-library`.
5. Open [Athenaeum Shared Library](https://ranabdullah.github.io/online-book-gallery/shared-library.html). Paste the **Worker URL** into "Private library API URL" and select **Connect server**. Enter your new private code and select **Unlock**. "Remember this device" will preserve access on trusted browsers.
6. Upload one **small ZIP containing an EPUB or PDF**, then verify its status in the upload receipt and the **cloud books count**. Give your friend the website URL, the Worker URL and the new code privately, and confirm they can read that same file.
7. If this works, upload the remaining ZIPs individually. The ZIP is unpacked in the browser and supported files are uploaded to private R2. Very large ZIPs can exceed browser memory. Files over 350 MB each and MOBI are not supported without conversion.

## Clear separation of storage

- `zip-import.html`: **local only** (files live in browser IndexedDB). It cannot transfer books to another device.
- `shared-library.html`: **shared R2 cloud** (files live on the server, readable by holders of the code). It provides verified upload receipts and cloud counts.
- `index.html`: existing GitHub Pages catalog. **Existing GitHub-hosted book files are public**, even if only you and your friend use the link. For a fully private library, their files must be moved to private storage and existing public copies deleted after rights review.

## Security

The code is never committed or put into the Worker URL. The deployment workflow reads it from GitHub Actions Secrets and saves it as a Cloudflare Worker secret. The Worker checks the code on every upload, listing and download request. Anyone with the code has the same privileges; rotating the code revokes all existing users. "Remember this device" should only be enabled on your own browser profile.

The GitHub Actions workflow and R2 setup may incur costs if you exceed free usage allowances. Copyright restrictions can apply even when sharing between two people.

## Troubleshooting

- **Workflow says missing secret**: check the spelling of all three GitHub repository secrets.
- **403 during R2 bucket or Worker creation**: regenerate the Cloudflare API token with both write permissions for the correct Cloudflare account. Connecting ChatGPT alone will not update a token stored as a GitHub secret.
- **Cloud setup required**: Worker URL was not entered on that device, or the backend was not deployed.
- **Unlock returns 403**: check that you entered the same private code stored as `ATHENAEUM_LIBRARY_CODE`. The Worker is updated each time the deployment workflow runs.
- **Books in ZIP Import but zero Shared Library books**: the imports were local only. Upload that ZIP from the Shared Library page after unlocking.
- **Cloud upload failed**: inspect the per-book upload receipt and Worker logs; no file is labelled confirmed until the R2 object is verified.
- **Blank or slow reader**: try a small book first; the reader downloads the private book to the current browser, and large PDF/EPUB files may take longer.

## Internal structure

- `cloudflare/private-library-worker.js`: authenticated R2 listing and chunked uploads/downloads
- `cloudflare/shared-library-wrangler.toml`: Worker deployment configuration and private R2 binding
- `.github/workflows/deploy-private-library.yml`: deploy Worker/bucket using repository secrets
- `js/shared-library-config.js`: optional nonsecret worker URL (blank by default)
- `shared-library.html`: private cloud library, upload receipts, source counts, browser session support
