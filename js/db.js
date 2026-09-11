/**
 * Athenaeum - IndexedDB Storage Engine
 * Manages user-added books (blobs), custom covers, and metadata overrides locally.
 */

const DB_NAME = 'AthenaeumDB';
const DB_VERSION = 1;

let dbInstance = null;

function openDB() {
  if (dbInstance) return Promise.resolve(dbInstance);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // Store user-added books
      if (!db.objectStoreNames.contains('user_books')) {
        db.createObjectStore('user_books', { keyPath: 'id' });
      }
      // Store book metadata / cover overrides
      if (!db.objectStoreNames.contains('book_overrides')) {
        db.createObjectStore('book_overrides', { keyPath: 'id' });
      }
    };

    req.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    req.onerror = (e) => {
      console.error('IndexedDB open error:', e);
      reject(e);
    };
  });
}

// User Added Books
async function saveUserBook(book) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('user_books', 'readwrite');
    const store = tx.objectStore('user_books');
    store.put(book);
    tx.oncomplete = () => resolve(book);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllUserBooks() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('user_books', 'readonly');
    const store = tx.objectStore('user_books');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function getUserBookById(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('user_books', 'readonly');
    const store = tx.objectStore('user_books');
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Book Metadata / Cover Overrides
async function saveBookOverride(id, overrideData) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('book_overrides', 'readwrite');
    const store = tx.objectStore('book_overrides');
    store.put({ id, ...overrideData, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllBookOverrides() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('book_overrides', 'readonly');
    const store = tx.objectStore('book_overrides');
    const req = store.getAll();
    req.onsuccess = () => {
      const map = {};
      (req.result || []).forEach(item => {
        map[item.id] = item;
      });
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

async function deleteBookOverride(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('book_overrides', 'readwrite');
    const store = tx.objectStore('book_overrides');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Export functions to window
window.AthenaeumDB = {
  saveUserBook,
  getAllUserBooks,
  getUserBookById,
  saveBookOverride,
  getAllBookOverrides,
  deleteBookOverride
};
