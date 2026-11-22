# Athenaeum — two-member private cloud bookshelf

**Status: implementation staged, NOT deployed.** The connected Cloudflare account returned HTTP 403 for R2 and Workers operations. Do not claim uploads are live until the Worker and bucket are deployed and tested.

## What this feature does
- A dedicated `shared-library.html` page supports two approved members, each with their own passwordless email sign-in.
- Client-side ZIP extraction handles PDF/EPUB only and uploads the individual books in sequential chunks to private Cloudflare R2.
- A server-side two-email allowlist is enforced on **every** upload, list, and download API request. A browser-visible name or URL is not authentication.
- SHA-256 file keys reduce repeated uploads; the cloud book list is shared by both accounts.
- Reading downloads the selected private file to the current device's browser and opens the existing Athenaeum reader. Cloud copies persist in R2.
- Existing books in `books/` on GitHub Pages remain publicly accessible. This feature does not make the current public GitHub repository private.

## Provisioning, once Cloudflare permissions are granted
1. Reconnect the Cloudflare app granting **Workers R2 Storage Write** and **Workers Scripts Write/Edit** access to the account that owns Athenaeum. The current connection is missing these permissions.
2. Create a private R2 bucket named `athenaeum-private-books`. Do not enable the public r2.dev domain or a public custom domain.
3. Use a **dedicated Supabase Auth project** for Athenaeum. In Auth settings, configure email sign-in and the redirect URL `https://ranabdullah.github.io/online-book-gallery/shared-library.html`. Set up the two intended members; consider disabling public sign-ups after invitations.
4. Fill `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `cloudflare/shared-library-wrangler.toml` and the matching safe public values in `js/shared-library-config.js`. Set its `workerUrl` to the deployed Worker URL.
5. From the repo root, deploy using the existing project's Wrangler tooling:
   `npx wrangler deploy --config cloudflare/shared-library-wrangler.toml`
6. Set the **private Worker secret** `MEMBER_EMAILS` using:
   `npx wrangler secret put MEMBER_EMAILS --config cloudflare/shared-library-wrangler.toml`
   Enter exactly two approved addresses, comma separated. Do not store these addresses in the public repository.
7. Test email sign-in for each approved member. Confirm unapproved accounts get 403, then upload one small ZIP and test listing and reading from both accounts. Confirm R2 bucket is private and no unauthenticated read works.
8. After this test, upload larger ZIPs one at a time. Archives of several hundred MB may require substantial browser memory because JSZip extracts them client-side.

## Notes
- Only two email addresses are allowed at a time. Both have upload and read permissions.
- The Worker checks Supabase's authenticated identity via its `/auth/v1/user` endpoint. Never accept an email supplied by the browser as proof of identity.
- The Worker requires `MEMBER_EMAILS`, `BOOKS`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY`; without them, operations fail closed.
- Uploads are chunked at 8 MiB, per-object max 350 MiB. Unsupported MOBI is skipped. A single ZIP over 350 MiB is allowed but may exhaust browser memory.
- The R2 filenames use client-reported SHA-256, and byte size is checked on multipart completion. For a security-sensitive public service, add server-side content-signature and hash verification plus virus scanning before broader membership.
- An existing object with the same hash is skipped. Duplicate titles with different editions are preserved unless file bytes match.
- Publisher/copyright permissions still matter even when sharing with a small private audience.
- For the **whole Athenaeum website** to be truly private, migrate the static gallery and existing book assets to authenticated hosting. GitHub Pages cannot enforce login-based access to its directly served files.
