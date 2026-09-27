/**
 * Athenaeum - One-time migration: local books.json + books/ + covers/  ->  Firebase
 *
 * Uploads every book file & cover to Firebase Storage, then writes matching
 * metadata docs into the Firestore "books" collection. Run this ONCE after
 * Firebase is set up. Safe to re-run later (it overwrites/skips existing
 * files by id) if you add more books locally before switching fully over
 * to the admin panel.
 *
 * SETUP (one-time):
 *   1. Firebase Console -> Project settings -> Service accounts ->
 *      "Generate new private key" -> save the JSON as:
 *        admin-scripts/serviceAccountKey.json
 *      (already gitignored - never commit this file)
 *   2. cd admin-scripts && npm init -y && npm install firebase-admin
 *   3. node migrate_to_firebase.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// Formats that read natively in the browser reader - uploaded as-is.
const NATIVE_FORMATS = ['epub', 'pdf', 'txt', 'jpg', 'jpeg', 'png', 'cbz'];
// Formats converted to EPUB via Calibre's ebook-convert CLI before upload.
// Requires Calibre installed locally: https://calibre-ebook.com/download
// (the 'ebook-convert' command must be on your PATH)
const CONVERTIBLE_FORMATS = ['mobi', 'azw', 'azw3', 'fb2', 'rtf', 'djvu', 'docx', 'cbr'];

function convertToEpub(localFile, bookId) {
  const outPath = path.join(require('os').tmpdir(), `${bookId}_converted.epub`);
  console.log(`  Converting ${path.basename(localFile)} -> EPUB via Calibre...`);
  try {
    execFileSync('ebook-convert', [localFile, outPath], { stdio: 'ignore' });
    return outPath;
  } catch (e) {
    console.warn(`  [conversion failed] ${bookId}: ${e.message}. Is Calibre's ebook-convert installed and on your PATH?`);
    return null;
  }
}

const serviceAccount = require('./serviceAccountKey.json');
const BASE_DIR = path.join(__dirname, '..');
const BUCKET_NAME = `${serviceAccount.project_id}.appspot.com`;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: BUCKET_NAME
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function uploadIfMissing(localPath, destPath) {
  const [exists] = await bucket.file(destPath).exists();
  if (exists) return;
  await bucket.upload(localPath, { destination: destPath });
}

async function migrate() {
  const booksJsonPath = path.join(BASE_DIR, 'data', 'books.json');
  const books = JSON.parse(fs.readFileSync(booksJsonPath, 'utf-8'));
  console.log(`Migrating ${books.length} books...`);

  let done = 0;
  for (const book of books) {
    const localFile = path.join(BASE_DIR, book.file);   // e.g. books/book_0001.pdf
    const localCover = path.join(BASE_DIR, book.cover);  // e.g. covers/book_0001.jpg
    const ext = (book.file.split('.').pop() || '').toLowerCase();

    let destFile = book.file;   // Storage path the reader will actually load
    let destFormat = book.format;

    if (fs.existsSync(localFile)) {
      if (CONVERTIBLE_FORMATS.includes(ext)) {
        const converted = convertToEpub(localFile, book.id);
        if (converted) {
          destFile = `books/${book.id}.epub`;
          destFormat = 'EPUB';
          await uploadIfMissing(converted, destFile);
          // Keep the original too, under a clearly separate path, so it's still
          // downloadable even though the app reads the converted EPUB.
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
      await uploadIfMissing(localCover, book.cover);
    }

    await db.collection('books').doc(book.id).set({
      id: book.id,
      title: book.title,
      author: book.author,
      category: book.category,
      format: destFormat,
      originalFormat: book.format,
      sizeMB: book.sizeMB,
      cover: book.cover,   // Storage path, e.g. "covers/book_0001.jpg"
      file: destFile,      // Storage path the reader loads, e.g. "books/book_0001.epub"
      isHosted: true
    }, { merge: true });

    done++;
    if (done % 25 === 0) console.log(`  ${done}/${books.length} done`);
  }

  console.log(`Migration complete: ${done} books uploaded to Storage + Firestore.`);
}

migrate().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
