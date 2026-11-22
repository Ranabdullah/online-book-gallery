# Athenaeum private shared library — code-only setup

**Status: code staged in GitHub; cloud backend not deployed.** The connected Cloudflare account currently returns HTTP 403 for Workers and R2. Reconnect the correct Cloudflare account with **Workers R2 Storage Write** and **Workers Scripts Write/Edit** permissions to finish deployment.

This feature provides private **book API and R2 files** protected by one shared code. Anyone possessing the code can read and upload. Do not publish the code or commit it to GitHub. Sharing the code with only one trusted friend is a practical convenience, but individual accounts, auditing, and revocation per person are not available.

## Minimal setup

1. Reconnect Cloudflare with Workers and R2 write permissions.
2. Create **private** R2 bucket `athenaeum-private-books`; leave the public r2.dev and public custom-domain access disabled.
3. Run `npx wrangler deploy --config cloudflare/shared-library-wrangler.toml`.
4. Open the website's `shared-library.html` page and click **Generate secure code**. Keep the code private. In Cloudflare, configure the **SHARED_ACCESS_CODE** Worker secret with that exact generated code. CLI: `npx wrangler secret put SHARED_ACCESS_CODE --config cloudflare/shared-library-wrangler.toml`. Do NOT put the code in chat, GitHub, a URL, or a plain config file.
5. Set `workerUrl` in `js/shared-library-config.js` to the deployed Worker URL. This is a public URL, not a secret.
6. Test with one small ZIP: unlock with the code, upload, then open the file from a second device using that code. Test wrong/no codes return HTTP 403.
7. Upload the other ZIPs from each member's device through the website. Uploads run client-side; PDF and EPUB only. Long archives can exhaust browser memory. Retain original ZIPs for backup.

## Security and scope

- The access code is masked in the form and held in page memory, not in localStorage or the URL. The Worker validates it on every file operation.
- The static GitHub Pages website and the historical `books/` files remain publicly accessible. Protecting *the entire gallery* requires moving all those files to authenticated hosting; this feature only protects newly uploaded shared-library books.
- A shared code grants identical permission to anyone who has it. To revoke access, rotate the secret and send the replacement to your friend.
- Uploads use SHA-256 keys and multipart storage; same-file duplicates are skipped.
- The cloud backend is not activated until Cloudflare is configured. The website will show a clear setup notice, not a false upload success.
- Copyright and other distribution rights may still apply to sharing book files even in a two-person collection.
