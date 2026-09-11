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

const LS_OVERRIDES_KEY = 'athenaeum_overrides_backup_v2';

function getLocalBackupOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LS_OVERRIDES_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveLocalBackupOverride(id, data) {
  try {
    const map = getLocalBackupOverrides();
    map[id] = { id, ...data, updatedAt: Date.now() };
    localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('LocalStorage backup error:', e);
  }
}

function deleteLocalBackupOverride(id) {
  try {
    const map = getLocalBackupOverrides();
    delete map[id];
    localStorage.setItem(LS_OVERRIDES_KEY, JSON.stringify(map));
  } catch (e) {}
}

// Book Metadata / Cover Overrides
async function saveBookOverride(id, overrideData) {
  // 1. Save to LocalStorage immediately
  saveLocalBackupOverride(id, overrideData);

  // 2. Automatically sync to backend server if active
  syncOverrideToBackend(id, overrideData);

  // 3. Save to IndexedDB
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('book_overrides', 'readwrite');
      const store = tx.objectStore('book_overrides');
      store.put({ id, ...overrideData, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve(); // Gracefully fallback to localStorage
    });
  } catch (err) {
    console.warn('IndexedDB write error, saved in LocalStorage fallback:', err);
  }
}

async function getAllBookOverrides() {
  const localMap = getLocalBackupOverrides();

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_overrides', 'readonly');
      const store = tx.objectStore('book_overrides');
      const req = store.getAll();
      req.onsuccess = () => {
        const idbMap = {};
        (req.result || []).forEach(item => {
          idbMap[item.id] = item;
        });
        // Merge with localMap (prefer newer updatedAt)
        const combined = { ...localMap, ...idbMap };
        resolve(combined);
      };
      req.onerror = () => resolve(localMap);
    });
  } catch (err) {
    return localMap;
  }
}

async function deleteBookOverride(id) {
  deleteLocalBackupOverride(id);
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_overrides', 'readwrite');
      const store = tx.objectStore('book_overrides');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (err) {}
}

// Automated Backend Sync Engine
async function syncOverrideToBackend(id, data) {
  try {
    const payload = { id, ...data };
    const resp = await fetch('/api/save-override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (resp.ok) {
      const result = await resp.json();
      console.log('Automated backend sync success:', result);
      return result;
    }
  } catch (e) {
    // If backend server is not running or on static host, ignore silently
  }
}

async function syncAllOverridesToBackend() {
  const overrides = await getAllBookOverrides();
  try {
    const resp = await fetch('/api/sync-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ overrides })
    });
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {
    throw e;
  }
}

// Export functions to window
window.AthenaeumDB = {
  saveUserBook,
  getAllUserBooks,
  getUserBookById,
  saveBookOverride,
  getAllBookOverrides,
  deleteBookOverride,
  syncOverrideToBackend,
  syncAllOverridesToBackend
};

