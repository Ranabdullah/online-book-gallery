const functions = require('firebase-functions');
const admin = require('firebase-admin');
const fetch = require('node-fetch');
const pdfParse = require('pdf-parse');

admin.initializeApp();
const db = admin.firestore();

// ---------- CONFIG ----------
// Set these once via the Firebase CLI before deploying:
//   firebase functions:config:set \
//     access.code="YOUR_SECRET_CODE" \
//     admin.setup_key="ANOTHER_SECRET" \
//     gemini.api_key="YOUR_GEMINI_KEY" \
//     github.token="YOUR_GITHUB_PAT" \
//     github.owner="your-github-username" \
//     github.data_repo="book-library-data" \
//     virustotal.api_key="YOUR_VT_KEY"
const ACCESS_CODE = () => functions.config().access?.code;
const ADMIN_SETUP_KEY = () => functions.config().admin?.setup_key;
const GEMINI_API_KEY = () => functions.config().gemini?.api_key;
const GITHUB_TOKEN = () => functions.config().github?.token;
const GITHUB_OWNER = () => functions.config().github?.owner;
const GITHUB_DATA_REPO = () => functions.config().github?.data_repo;
const VIRUSTOTAL_API_KEY = () => functions.config().virustotal?.api_key;

const GH_API = 'https://api.github.com';
const GH_HEADERS = () => ({
  Authorization: `token ${GITHUB_TOKEN()}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
});

// ---------- 1. ACCESS GATE ----------
exports.redeemAccessCode = functions.https.onCall(async (data) => {
  const submitted = (data.code || '').trim();
  const real = ACCESS_CODE();
  if (!real) throw new functions.https.HttpsError('failed-precondition', 'Access code not configured yet.');
  if (submitted !== real) throw new functions.https.HttpsError('permission-denied', 'Incorrect access code.');

  const guestUid = 'guest_' + Math.random().toString(36).slice(2, 12);
  const token = await admin.auth().createCustomToken(guestUid, { guest: true });
  return { token };
});

// ---------- 2. ONE-TIME ADMIN SETUP ----------
exports.grantAdmin = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const setupKey = ADMIN_SETUP_KEY();
  if (!setupKey || data.setupKey !== setupKey) throw new functions.https.HttpsError('permission-denied', 'Wrong setup key.');
  await admin.auth().setCustomUserClaims(context.auth.uid, { admin: true });
  return { ok: true, message: 'Admin claim granted. Sign out and back in to take effect.' };
});

// ---------- 3. GITHUB RELEASE STORAGE ----------
// Every book/cover lives as an asset on one release ("library-data") in the
// private data repo. We never proxy file bytes through this function - we
// fetch a short-lived signed URL from GitHub and hand THAT to the browser,
// so even a 500MB file downloads straight from GitHub's CDN with no
// timeout or memory ceiling on our end.
const RELEASE_TAG = 'library-data';
let releaseCache = null;

async function getOrCreateRelease() {
  if (releaseCache) return releaseCache;
  const repo = `${GITHUB_OWNER()}/${GITHUB_DATA_REPO()}`;
  let res = await fetch(`${GH_API}/repos/${repo}/releases/tags/${RELEASE_TAG}`, { headers: GH_HEADERS() });
  if (res.status === 404) {
    res = await fetch(`${GH_API}/repos/${repo}/releases`, {
      method: 'POST',
      headers: GH_HEADERS(),
      body: JSON.stringify({ tag_name: RELEASE_TAG, name: 'Library Data', draft: false, prerelease: false })
    });
  }
  releaseCache = await res.json();
  return releaseCache;
}

async function findAsset(release, assetName) {
  const repo = `${GITHUB_OWNER()}/${GITHUB_DATA_REPO()}`;
  const res = await fetch(`${GH_API}/repos/${repo}/releases/${release.id}/assets`, { headers: GH_HEADERS() });
  const assets = await res.json();
  return assets.find(a => a.name === assetName);
}

// Resolves a bookId's stored filename to a real, temporary download URL.
async function getGithubAssetDownloadUrl(assetName) {
  const release = await getOrCreateRelease();
  const asset = await findAsset(release, assetName);
  if (!asset) throw new functions.https.HttpsError('not-found', `Asset ${assetName} not found in data repo.`);

  const repo = `${GITHUB_OWNER()}/${GITHUB_DATA_REPO()}`;
  const res = await fetch(`${GH_API}/repos/${repo}/releases/assets/${asset.id}`, {
    headers: { ...GH_HEADERS(), Accept: 'application/octet-stream' },
    redirect: 'manual'
  });
  const location = res.headers.get('location');
  if (!location) throw new functions.https.HttpsError('internal', 'GitHub did not return a signed download URL.');
  return location;
}

async function uploadAssetToGithub(localPath, assetName, contentType) {
  const release = await getOrCreateRelease();
  const existing = await findAsset(release, assetName);
  if (existing) return existing; // already there

  const repo = `${GITHUB_OWNER()}/${GITHUB_DATA_REPO()}`;
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
  const buffer = require('fs').readFileSync(localPath);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...GH_HEADERS(), 'Content-Type': contentType, 'Content-Length': buffer.length },
    body: buffer
  });
  return res.json();
}

async function deleteAssetFromGithub(assetName) {
  const release = await getOrCreateRelease();
  const asset = await findAsset(release, assetName);
  if (!asset) return;
  const repo = `${GITHUB_OWNER()}/${GITHUB_DATA_REPO()}`;
  await fetch(`${GH_API}/repos/${repo}/releases/assets/${asset.id}`, { method: 'DELETE', headers: GH_HEADERS() });
}

// Called by reader.js instead of Firebase Storage's getDownloadURL().
exports.getBookDownloadUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
  const assetName = data.assetName;
  if (!assetName) throw new functions.https.HttpsError('invalid-argument', 'assetName is required.');
  const url = await getGithubAssetDownloadUrl(assetName);
  return { url };
});

// ---------- 4. AI SUMMARIES - PhD-level, Gemini free tier, cached ----------
exports.generateSummary = functions
  .runWith({ timeoutSeconds: 300, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    const bookId = data.bookId;
    const length = data.length === 'short' ? 'short' : 'long'; // long is the default
    if (!bookId) throw new functions.https.HttpsError('invalid-argument', 'bookId is required.');

    const cacheId = `${bookId}_${length}`;
    const cached = await db.collection('summaries').doc(cacheId).get();
    if (cached.exists) return { summary: cached.data().text, cached: true };

    const bookDoc = await db.collection('books').doc(bookId).get();
    if (!bookDoc.exists) throw new functions.https.HttpsError('not-found', 'Book not found.');
    const book = bookDoc.data();

    const text = await extractText(book);
    const trimmed = text.slice(0, 60000); // Gemini free-tier context ceiling - safe slice

    const scholarlyPersona = `You are a subject-matter expert writing at a PhD / academic-press level: precise terminology, engagement with the work's underlying arguments, structure, method, and intellectual context, not just plot or a back-cover pitch. Assume an educated reader who wants substance, not simplification.`;

    const prompt = length === 'short'
      ? `${scholarlyPersona}\n\nWrite a dense, scholarly abstract (6-9 sentences, journal-abstract style) of this work: its central thesis or narrative project, its method or structure, and its significance or critical standing, for "${book.title}" by ${book.author}.\n\nText excerpt:\n${trimmed}`
      : `${scholarlyPersona}\n\nWrite a rigorous scholarly analysis (900-1300 words) of "${book.title}" by ${book.author}, structured as:\n1. Thesis / central argument (or, for fiction, core narrative and thematic project)\n2. Structure and method (how the work is organized and argued, or narrated)\n3. Key concepts, themes, or motifs, examined with precision rather than summarized in passing\n4. Intellectual or literary context (what tradition, debate, or genre it engages with, and how)\n5. Critical assessment: strengths, limitations, and open questions the work leaves unresolved\n\nUse discipline-appropriate terminology throughout. Avoid generic praise or reductive plot recap - the reader wants the kind of analysis found in a graduate seminar or academic review, not a summary aimed at a casual reader.\n\nText excerpt:\n${trimmed}`;

    const summaryText = await callGemini(prompt);

    await db.collection('summaries').doc(cacheId).set({
      bookId, length, text: summaryText,
      generatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { summary: summaryText, cached: false };
  });

async function callGemini(prompt) {
  const key = GEMINI_API_KEY();
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'Gemini API key not configured.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!out) throw new functions.https.HttpsError('internal', 'Gemini returned no summary. ' + JSON.stringify(json).slice(0, 300));
  return out.trim();
}

async function extractText(book) {
  const url = await getGithubAssetDownloadUrl(book.file);
  const tmpPath = `/tmp/${book.id}_src`;
  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  require('fs').writeFileSync(tmpPath, buffer);

  if (book.format === 'PDF') {
    const parsed = await pdfParse(buffer);
    return parsed.text;
  }
  if (book.format === 'EPUB') {
    const { EPub } = require('epub2');
    const epub = await EPub.createAsync(tmpPath);
    let text = '';
    for (const ch of epub.flow.slice(0, 15)) {
      const raw = await epub.getChapterRawAsync(ch.id);
      text += raw.replace(/<[^>]+>/g, ' ') + '\n';
      if (text.length > 80000) break;
    }
    return text;
  }
  throw new functions.https.HttpsError('invalid-argument', `Unsupported format: ${book.format}`);
}

// ---------- 5. BULK DELETE BY CATEGORY ----------
exports.bulkDeleteCategory = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  const categories = data.categories;
  if (!Array.isArray(categories) || categories.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'categories must be a non-empty array.');
  }

  const snap = await db.collection('books').where('category', 'in', categories.slice(0, 10)).get();
  let deleted = 0;
  const batch = db.batch();

  for (const doc of snap.docs) {
    const book = doc.data();
    batch.delete(doc.ref);
    try {
      if (book.file) await deleteAssetFromGithub(book.file);
      if (book.cover) await deleteAssetFromGithub(book.cover);
    } catch (e) {
      console.warn('Could not delete GitHub asset for', book.id, e.message);
    }
    deleted++;
  }
  await batch.commit();
  return { deleted, categories };
});

// ---------- 6. AUTO-CATEGORIZE ----------
exports.autoCategorize = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  const { title, author, existingCategories } = data;
  const catList = (existingCategories || []).join(', ') || 'Fiction & Modern Novels, Science & Non-Fiction';
  const prompt = `Pick the single best-fitting category for this book from this list (or propose one new short category name if truly none fit): ${catList}.\nBook: "${title}" by ${author}.\nRespond with ONLY the category name, nothing else.`;
  const category = await callGemini(prompt);
  return { category: category.trim() };
});

// ---------- 7. COVER QUALITY CHECK + REPLACEMENT ----------
// Free, no-key APIs: Open Library Covers (by ISBN) and Google Books (by
// title/author search). If the current cover is missing or clearly a
// placeholder/too small, fetch a real one and swap it in.
exports.checkAndFixCover = functions.https.onCall(async (data, context) => {
  if (!context.auth?.token?.admin) throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  const { bookId, title, author, isbn } = data;
  if (!bookId) throw new functions.https.HttpsError('invalid-argument', 'bookId is required.');

  let betterCoverUrl = null;

  if (isbn) {
    const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
    const check = await fetch(olUrl, { method: 'HEAD' });
    if (check.ok) betterCoverUrl = olUrl;
  }

  if (!betterCoverUrl && title) {
    const q = encodeURIComponent(`intitle:${title}${author ? ' inauthor:' + author : ''}`);
    const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1`);
    const gbJson = await gbRes.json();
    const thumb = gbJson?.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    if (thumb) betterCoverUrl = thumb.replace('http://', 'https://').replace('zoom=1', 'zoom=2');
  }

  if (!betterCoverUrl) return { replaced: false, reason: 'No better cover found.' };

  const imgRes = await fetch(betterCoverUrl);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const tmpPath = `/tmp/${bookId}_cover.jpg`;
  require('fs').writeFileSync(tmpPath, buffer);

  const assetName = `covers/${bookId}.jpg`;
  await deleteAssetFromGithub(assetName); // replace, don't duplicate
  await uploadAssetToGithub(tmpPath, assetName, 'image/jpeg');
  await db.collection('books').doc(bookId).update({ cover: assetName, coverSource: betterCoverUrl });

  return { replaced: true, source: betterCoverUrl };
});

// ---------- 8. VIRUS SCAN (VirusTotal free tier, no card) ----------
// Used before any user-submitted book gets published to the library.
async function scanBufferForViruses(buffer, fileName) {
  const key = VIRUSTOTAL_API_KEY();
  if (!key) throw new functions.https.HttpsError('failed-precondition', 'VirusTotal API key not configured.');

  const FormData = require('form-data');
  const form = new FormData();
  form.append('file', buffer, fileName);

  const uploadRes = await fetch('https://www.virustotal.com/api/v3/files', {
    method: 'POST',
    headers: { 'x-apikey': key },
    body: form
  });
  const uploadJson = await uploadRes.json();
  const analysisId = uploadJson?.data?.id;
  if (!analysisId) throw new functions.https.HttpsError('internal', 'VirusTotal upload failed.');

  // Poll briefly - free tier analysis isn't instant.
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const check = await fetch(`https://www.virustotal.com/api/v3/analyses/${analysisId}`, { headers: { 'x-apikey': key } });
    const checkJson = await check.json();
    const status = checkJson?.data?.attributes?.status;
    if (status === 'completed') {
      const stats = checkJson.data.attributes.stats;
      return { clean: stats.malicious === 0 && stats.suspicious === 0, stats };
    }
  }
  throw new functions.https.HttpsError('deadline-exceeded', 'Virus scan took too long - try again shortly.');
}

// NOTE ON GUEST SUBMISSIONS: books can be well over VirusTotal's 32MB
// direct-upload limit and Cloud Functions' practical request-size ceiling
// on the free plan, so routing large files through a callable function
// like this one doesn't scale to your bigger files. This function works
// for smaller submissions; the bigger-file flow (client uploads to a
// staging area first, function scans + publishes after) is a follow-up -
// flagged rather than half-built.
exports.submitBookForReview = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in first.');
    const { fileBase64, fileName, title, author, category } = data;
    if (!fileBase64 || !fileName) throw new functions.https.HttpsError('invalid-argument', 'fileBase64 and fileName are required.');

    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length > 30 * 1024 * 1024) {
      throw new functions.https.HttpsError('invalid-argument', 'File too large for this submission path (30MB cap for now) - larger uploads need the staging-upload flow.');
    }

    const scan = await scanBufferForViruses(buffer, fileName);
    if (!scan.clean) {
      return { accepted: false, reason: 'Flagged by virus scan.', stats: scan.stats };
    }

    const tmpPath = `/tmp/submit_${Date.now()}_${fileName}`;
    require('fs').writeFileSync(tmpPath, buffer);
    const ext = fileName.split('.').pop().toLowerCase();
    const bookId = `book_${Date.now()}`;
    const assetName = `books/${bookId}.${ext}`;
    await uploadAssetToGithub(tmpPath, assetName, 'application/octet-stream');

    let finalCategory = category;
    if (!finalCategory) {
      const catSnap = await db.collection('categories').get();
      const existing = catSnap.docs.map(d => d.id);
      const catResult = await callGemini(`Pick the single best-fitting category from this list (or propose one new short one): ${existing.join(', ')}.\nBook: "${title}" by ${author}.\nRespond with ONLY the category name.`);
      finalCategory = catResult.trim();
    }

    await db.collection('books').doc(bookId).set({
      id: bookId, title, author, category: finalCategory,
      format: ext.toUpperCase(), file: assetName, cover: null,
      isHosted: true, submittedByGuest: true,
      submittedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return { accepted: true, bookId };
  });
