/**
 * Athenaeum - One-time migration: local books.json + books/ + covers/
 *   ->  private GitHub data repo (as Release assets) + Firestore (metadata)
 *
 * SETUP (one-time):
 *   1. Create a PRIVATE GitHub repo, e.g. "book-library-data" (empty is fine).
 *   2. Create a GitHub Personal Access Token (classic) with "repo" scope:
 *      github.com -> Settings -> Developer settings -> Personal access tokens
 *   3. Firebase Console -> Project settings -> Service accounts ->
 *      Generate new private key -> save as admin-scripts/serviceAccountKey.json
 *   4. cd admin-scripts && npm init -y && npm install firebase-admin node-fetch@2 form-data
 *   5. Set the constants below (or use environment variables) and run:
 *      node migrate_to_github.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { execFileSync } = require('child_process');

// ---------- CONFIG ----------
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'YOUR_GITHUB_PAT';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'your-github-username';
const GITHUB_DATA_REPO = process.env.GITHUB_DATA_REPO || 'book-library-data';
const RELEASE_TAG = 'library-data';

const GH_API = 'https://api.github.com';
const GH_HEADERS = {
  Authorization: `token ${GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

const NATIVE_FORMATS = ['epub', 'pdf', 'txt', 'jpg', 'jpeg', 'png', 'cbz'];
const CONVERTIBLE_FORMATS = ['mobi', 'azw', 'azw3', 'fb2', 'rtf', 'djvu', 'docx', 'cbr'];

function convertToEpub(localFile, bookId) {
  const outPath = path.join(require('os').tmpdir(), `${bookId}_converted.epub`);
  console.log(`  Converting ${path.basename(localFile)} -> EPUB via Calibre...`);
  try {
    execFileSync('ebook-convert', [localFile, outPath], { stdio: 'ignore' });
    return outPath;
  } catch (e) {
    console.warn(`  [conversion failed] ${bookId}: ${e.message}. Is Calibre's ebook-convert on your PATH?`);
    return null;
  }
}

const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const BASE_DIR = path.join(__dirname, '..');
let releaseCache = null;
let assetCache = null; // Map<name, asset>

async function getOrCreateRelease() {
  if (releaseCache) return releaseCache;
  const repo = `${GITHUB_OWNER}/${GITHUB_DATA_REPO}`;
  let res = await fetch(`${GH_API}/repos/${repo}/releases/tags/${RELEASE_TAG}`, { headers: GH_HEADERS });
  if (res.status === 404) {
    res = await fetch(`${GH_API}/repos/${repo}/releases`, {
      method: 'POST',
      headers: GH_HEADERS,
      body: JSON.stringify({ tag_name: RELEASE_TAG, name: 'Library Data', draft: false, prerelease: false })
    });
  }
  releaseCache = await res.json();
  if (!releaseCache.id) throw new Error('Could not create/find release: ' + JSON.stringify(releaseCache));
  return releaseCache;
}

async function loadAssetIndex(release) {
  if (assetCache) return assetCache;
  const repo = `${GITHUB_OWNER}/${GITHUB_DATA_REPO}`;
  assetCache = new Map();
  let page = 1;
  while (true) {
    const res = await fetch(`${GH_API}/repos/${repo}/releases/${release.id}/assets?per_page=100&page=${page}`, { headers: GH_HEADERS });
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    batch.forEach(a => assetCache.set(a.name, a));
    if (batch.length < 100) break;
    page++;
  }
  return assetCache;
}

async function uploadIfMissing(localPath, assetName, contentType = 'application/octet-stream') {
  const release = await getOrCreateRelease();
  const index = await loadAssetIndex(release);
  if (index.has(assetName)) return;

  const repo = `${GITHUB_OWNER}/${GITHUB_DATA_REPO}`;
  const uploadUrl = `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
  const buffer = fs.readFileSync(localPath);
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { ...GH_HEADERS, 'Content-Type': contentType, 'Content-Length': buffer.length },
    body: buffer
  });
  const json = await res.json();
  if (json.id) index.set(assetName, json);
  else console.warn(`  [upload failed] ${assetName}: ${JSON.stringify(json).slice(0, 200)}`);
}

async function migrate() {
  const booksJsonPath = path.join(BASE_DIR, 'data', 'books.json');
  const books = JSON.parse(fs.readFileSync(booksJsonPath, 'utf-8'));
  console.log(`Migrating ${books.length} books to ${GITHUB_OWNER}/${GITHUB_DATA_REPO}...`);
  await getOrCreateRelease();

  let done = 0;
  for (const book of books) {
    const localFile = path.join(BASE_DIR, book.file);
    const localCover = path.join(BASE_DIR, book.cover);
    const ext = (book.file.split('.').pop() || '').toLowerCase();

    let destFile = book.file;
    let destFormat = book.format;

    if (fs.existsSync(localFile)) {
      if (CONVERTIBLE_FORMATS.includes(ext)) {
        const converted = convertToEpub(localFile, book.id);
        if (converted) {
          destFile = `books/${book.id}.epub`;
          destFormat = 'EPUB';
          await uploadIfMissing(converted, destFile);
          await uploadIfMissing(localFile, `books-originals/${book.id}.${ext}`);
        } else {
          console.warn(`  [skip file] ${book.id}: conversion failed, not uploaded`);
        }
      } else if (NATIVE_FORMATS.includes(ext)) {
        await uploadIfMissing(localFile, book.file);
      } else {
        console.warn(`  [skip file] ${book.id}: unsupported format .${ext}`);
      }
    } else {
      console.warn(`  [skip file] ${book.id}: ${localFile} not found`);
    }

    if (fs.existsSync(localCover)) {
      await uploadIfMissing(localCover, book.cover, 'image/jpeg');
    }

    await db.collection('books').doc(book.id).set({
      id: book.id,
      title: book.title,
      author: book.author,
      category: book.category,
      format: destFormat,
      originalFormat: book.format,
      sizeMB: book.sizeMB,
      cover: book.cover,   // GitHub release asset name, e.g. "covers/book_0001.jpg"
      file: destFile,      // GitHub release asset name the reader loads
      isHosted: true
    }, { merge: true });

    done++;
    if (done % 10 === 0) console.log(`  ${done}/${books.length} done`);
  }

  console.log(`Migration complete: ${done} books uploaded to GitHub + Firestore.`);
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
