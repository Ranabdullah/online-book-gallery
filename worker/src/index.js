/**
 * Athenaeum Worker - main router.
 * Replaces the old firebase-functions/index.js. Same endpoints, same
 * behavior, ported to run on Cloudflare's free tier (no card needed) -
 * the reason for the rewrite is documented in chat: Firebase Cloud
 * Functions require the paid Blaze plan for ANY outbound call to a
 * non-Google API (GitHub, VirusTotal), which this whole backend needs.
 */

import { createFirebaseCustomToken, setFirebaseCustomClaims, verifyFirebaseIdToken } from './gcp-auth.js';
import { makeFirestore } from './firestore.js';
import {
  extractPdfText, extractEpubText, callGemini,
  getGithubAssetDownloadUrl, uploadAssetToGithub, deleteAssetFromGithub,
  scanBufferForViruses
} from './integrations.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

function withCors(resp, env) {
  resp.headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  resp.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  resp.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  return resp;
}

async function requireAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '');
  if (!idToken) throw new Error('unauthenticated');
  return verifyFirebaseIdToken(idToken, env.FIREBASE_PROJECT_ID);
}

async function requireAdmin(request, env) {
  const payload = await requireAuth(request, env);
  if (!payload.admin) throw new Error('permission-denied');
  return payload;
}

const SCHOLARLY_PERSONA = `You are a subject-matter expert writing at a PhD / academic-press level: precise terminology, engagement with the work's underlying arguments, structure, method, and intellectual context, not just plot or a back-cover pitch. Assume an educated reader who wants substance, not simplification.`;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), env);

    const url = new URL(request.url);
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch {
      return withCors(json({ error: 'Worker misconfigured: GOOGLE_SERVICE_ACCOUNT_JSON secret is missing or invalid.' }, 500), env);
    }
    const db = makeFirestore(serviceAccount);

    try {
      let result;

      if (url.pathname === '/redeemAccessCode') {
        const { code } = await request.json();
        if (!env.ACCESS_CODE) throw new Error('Access code not configured on the server yet.');
        if ((code || '').trim() !== env.ACCESS_CODE) throw new Error('Incorrect access code.');
        const guestUid = 'guest_' + Math.random().toString(36).slice(2, 12);
        const token = await createFirebaseCustomToken(serviceAccount, guestUid, { guest: true });
        result = { token };

      } else if (url.pathname === '/grantAdmin') {
        const payload = await requireAuth(request, env);
        const { setupKey } = await request.json();
        if (!env.ADMIN_SETUP_KEY || setupKey !== env.ADMIN_SETUP_KEY) throw new Error('Wrong setup key.');
        await setFirebaseCustomClaims(serviceAccount, payload.sub, { admin: true });
        result = { ok: true, message: 'Admin claim granted. Sign out and back in for it to take effect.' };

      } else if (url.pathname === '/getBookDownloadUrl') {
        await requireAuth(request, env);
        const { assetName } = await request.json();
        if (!assetName) throw new Error('assetName is required.');
        result = { url: await getGithubAssetDownloadUrl(env, assetName) };

      } else if (url.pathname === '/generateSummary') {
        await requireAuth(request, env);
        const { bookId, length: lengthArg } = await request.json();
        if (!bookId) throw new Error('bookId is required.');
        const length = lengthArg === 'short' ? 'short' : 'long'; // long is the default
        const cacheId = `${bookId}_${length}`;

        const cached = await db.get(`summaries/${cacheId}`);
        if (cached) {
          result = { summary: cached.text, cached: true };
        } else {
          const book = await db.get(`books/${bookId}`);
          if (!book) throw new Error('Book not found.');

          const fileUrl = await getGithubAssetDownloadUrl(env, book.file);
          const buffer = await (await fetch(fileUrl)).arrayBuffer();

          let text;
          if (book.format === 'PDF') text = await extractPdfText(buffer);
          else if (book.format === 'EPUB') text = await extractEpubText(buffer);
          else throw new Error(`Unsupported format for summarization: ${book.format}`);

          const trimmed = text.slice(0, 60000); // Gemini free-tier context ceiling - safe slice

          const prompt = length === 'short'
            ? `${SCHOLARLY_PERSONA}\n\nWrite a dense, scholarly abstract (6-9 sentences, journal-abstract style) of this work: its central thesis or narrative project, its method or structure, and its significance or critical standing, for "${book.title}" by ${book.author}.\n\nText excerpt:\n${trimmed}`
            : `${SCHOLARLY_PERSONA}\n\nWrite a rigorous scholarly analysis (900-1300 words) of "${book.title}" by ${book.author}, structured as:\n1. Thesis / central argument (or, for fiction, core narrative and thematic project)\n2. Structure and method (how the work is organized and argued, or narrated)\n3. Key concepts, themes, or motifs, examined with precision rather than summarized in passing\n4. Intellectual or literary context (what tradition, debate, or genre it engages with, and how)\n5. Critical assessment: strengths, limitations, and open questions the work leaves unresolved\n\nUse discipline-appropriate terminology throughout. Avoid generic praise or reductive plot recap - the reader wants the kind of analysis found in a graduate seminar or academic review.\n\nText excerpt:\n${trimmed}`;

          const summaryText = await callGemini(env.GEMINI_API_KEY, prompt);
          await db.set(`summaries/${cacheId}`, { bookId, length, text: summaryText, generatedAt: new Date() });
          result = { summary: summaryText, cached: false };
        }

      } else if (url.pathname === '/bulkDeleteCategory') {
        await requireAdmin(request, env);
        const { categories } = await request.json();
        if (!Array.isArray(categories) || categories.length === 0) throw new Error('categories must be a non-empty array.');

        let deleted = 0;
        for (const cat of categories) {
          const books = await db.query('books', 'category', 'EQUAL', cat);
          for (const book of books) {
            try {
              if (book.file) await deleteAssetFromGithub(env, book.file);
              if (book.cover) await deleteAssetFromGithub(env, book.cover);
            } catch (e) {
              console.warn('Could not delete GitHub asset for', book.id, e.message);
            }
            await db.delete(`books/${book.id}`);
            deleted++;
          }
        }
        result = { deleted, categories };

      } else if (url.pathname === '/autoCategorize') {
        await requireAdmin(request, env);
        const { title, author, existingCategories } = await request.json();
        const catList = (existingCategories || []).join(', ') || 'Fiction & Modern Novels, Science & Non-Fiction';
        const category = await callGemini(env.GEMINI_API_KEY, `Pick the single best-fitting category for this book from this list (or propose one new short category name if truly none fit): ${catList}.\nBook: "${title}" by ${author}.\nRespond with ONLY the category name, nothing else.`);
        result = { category: category.trim() };

      } else if (url.pathname === '/checkAndFixCover') {
        await requireAdmin(request, env);
        const { bookId, title, author, isbn } = await request.json();
        if (!bookId) throw new Error('bookId is required.');

        let betterCoverUrl = null;
        if (isbn) {
          const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
          const check = await fetch(olUrl, { method: 'HEAD' });
          if (check.ok) betterCoverUrl = olUrl;
        }
        if (!betterCoverUrl && title) {
          const q = encodeURIComponent(`intitle:${title}${author ? ' inauthor:' + author : ''}`);
          const gbJson = await (await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`)).json();
          const thumb = gbJson?.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
          if (thumb) betterCoverUrl = thumb.replace('http://', 'https://').replace('zoom=1', 'zoom=2');
        }

        if (!betterCoverUrl) {
          result = { replaced: false, reason: 'No better cover found.' };
        } else {
          const imgBuffer = await (await fetch(betterCoverUrl)).arrayBuffer();
          const assetName = `covers/${bookId}.jpg`;
          await deleteAssetFromGithub(env, assetName);
          await uploadAssetToGithub(env, imgBuffer, assetName, 'image/jpeg');
          await db.set(`books/${bookId}`, { cover: assetName, coverSource: betterCoverUrl });
          result = { replaced: true, source: betterCoverUrl };
        }

      } else if (url.pathname === '/submitBookForReview') {
        await requireAuth(request, env);
        const { fileBase64, fileName, title, author, category } = await request.json();
        if (!fileBase64 || !fileName) throw new Error('fileBase64 and fileName are required.');

        const binary = atob(fileBase64);
        const buffer = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);

        if (buffer.length > 30 * 1024 * 1024) {
          throw new Error('File too large for this submission path (30MB cap for now) - larger uploads need the staging-upload flow.');
        }

        const scan = await scanBufferForViruses(env.VIRUSTOTAL_API_KEY, buffer, fileName);
        if (!scan.clean) {
          result = { accepted: false, reason: 'Flagged by virus scan.', stats: scan.stats };
        } else {
          const ext = fileName.split('.').pop().toLowerCase();
          const bookId = `book_${Date.now()}`;
          const assetName = `books/${bookId}.${ext}`;
          await uploadAssetToGithub(env, buffer, assetName, 'application/octet-stream');

          let finalCategory = category;
          if (!finalCategory) {
            const existing = (await db.list('categories')).map(c => c.id);
            finalCategory = (await callGemini(env.GEMINI_API_KEY, `Pick the single best-fitting category from this list (or propose one new short one): ${existing.join(', ')}.\nBook: "${title}" by ${author}.\nRespond with ONLY the category name.`)).trim();
          }

          await db.set(`books/${bookId}`, {
            id: bookId, title, author, category: finalCategory,
            format: ext.toUpperCase(), file: assetName, cover: null,
            isHosted: true, submittedByGuest: true
          });
          result = { accepted: true, bookId };
        }

      } else {
        return withCors(json({ error: 'Not found' }, 404), env);
      }

      return withCors(json(result), env);

    } catch (err) {
      const status = err.message === 'unauthenticated' ? 401 : err.message === 'permission-denied' ? 403 : 400;
      return withCors(json({ error: err.message }, status), env);
    }
  }
};
