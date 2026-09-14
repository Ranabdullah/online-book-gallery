/**
 * Athenaeum - IndexedDB Storage Engine
 * Manages user-added books (blobs), custom covers, and metadata overrides locally.
 */

const DB_NAME = 'AthenaeumDB';
const DB_VERSION = 2;

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
      // Store saved vocabulary words
      if (!db.objectStoreNames.contains('vocabulary')) {
        const vocabStore = db.createObjectStore('vocabulary', { keyPath: 'id' });
        try {
          vocabStore.createIndex('word', 'word', { unique: false });
          vocabStore.createIndex('bookId', 'bookId', { unique: false });
        } catch (idxErr) {}
      }
      // Store reader notes & highlights
      if (!db.objectStoreNames.contains('book_notes')) {
        const notesStore = db.createObjectStore('book_notes', { keyPath: 'id' });
        try {
          notesStore.createIndex('bookId', 'bookId', { unique: false });
        } catch (idxErr) {}
      }
      // Store cached AI book analyses
      if (!db.objectStoreNames.contains('book_analyses')) {
        db.createObjectStore('book_analyses', { keyPath: 'id' });
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

async function deleteUserBook(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('user_books', 'readwrite');
    const store = tx.objectStore('user_books');
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Hidden / Deleted Books Registry
const LS_HIDDEN_BOOKS_KEY = 'athenaeum_hidden_books_v1';

function getHiddenBooks() {
  try {
    const stored = localStorage.getItem(LS_HIDDEN_BOOKS_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (e) {
    return [];
  }
}

function hideBook(id) {
  try {
    const list = getHiddenBooks();
    if (!list.includes(id)) {
      list.push(id);
      localStorage.setItem(LS_HIDDEN_BOOKS_KEY, JSON.stringify(list));
    }
  } catch (e) {}
}

function unhideBook(id) {
  try {
    const list = getHiddenBooks().filter(x => x !== id);
    localStorage.setItem(LS_HIDDEN_BOOKS_KEY, JSON.stringify(list));
  } catch (e) {}
}

function isBookHidden(id) {
  return getHiddenBooks().includes(id);
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

// =======================================================
// 4. Vocabulary Builder & Flashcards Storage
// =======================================================
const LS_VOCAB_KEY = 'athenaeum_vocabulary_v1';

function getLocalVocabBackup() {
  try {
    return JSON.parse(localStorage.getItem(LS_VOCAB_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveLocalVocabBackup(list) {
  try {
    localStorage.setItem(LS_VOCAB_KEY, JSON.stringify(list));
  } catch (e) {}
}

async function saveVocabularyWord(item) {
  if (!item || !item.word) return;
  const wordClean = item.word.trim().toLowerCase();
  const id = item.id || `vocab_${wordClean}`;
  const payload = {
    id,
    word: item.word.trim(),
    phonetics: item.phonetics || '',
    audioUrl: item.audioUrl || '',
    partOfSpeech: item.partOfSpeech || 'word',
    definition: item.definition || '',
    example: item.example || '',
    contextSentence: item.contextSentence || '',
    bookId: item.bookId || 'general',
    bookTitle: item.bookTitle || 'Library',
    mastery: item.mastery || 'learning',
    dateAdded: item.dateAdded || Date.now(),
    updatedAt: Date.now()
  };

  // LocalStorage mirror
  const currentList = getLocalVocabBackup().filter(x => x.id !== id);
  currentList.unshift(payload);
  saveLocalVocabBackup(currentList);

  // IndexedDB
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('vocabulary', 'readwrite');
      const store = tx.objectStore('vocabulary');
      store.put(payload);
      tx.oncomplete = () => resolve(payload);
      tx.onerror = () => resolve(payload);
    });
  } catch (e) {
    return payload;
  }
}

async function getAllVocabulary(filterBookId) {
  const fallbackList = getLocalVocabBackup();
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('vocabulary', 'readonly');
      const store = tx.objectStore('vocabulary');
      const req = store.getAll();
      req.onsuccess = () => {
        let list = req.result || [];
        if (list.length === 0 && fallbackList.length > 0) {
          list = fallbackList;
        }
        if (filterBookId) {
          list = list.filter(item => item.bookId === filterBookId);
        }
        list.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
        resolve(list);
      };
      req.onerror = () => {
        let list = fallbackList;
        if (filterBookId) list = list.filter(item => item.bookId === filterBookId);
        resolve(list);
      };
    });
  } catch (e) {
    let list = fallbackList;
    if (filterBookId) list = list.filter(item => item.bookId === filterBookId);
    return list;
  }
}

async function deleteVocabularyWord(id) {
  const currentList = getLocalVocabBackup().filter(x => x.id !== id);
  saveLocalVocabBackup(currentList);

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('vocabulary', 'readwrite');
      const store = tx.objectStore('vocabulary');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {}
}

async function updateWordMastery(id, mastery) {
  const currentList = getLocalVocabBackup();
  const target = currentList.find(x => x.id === id);
  if (target) {
    target.mastery = mastery;
    saveLocalVocabBackup(currentList);
  }

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('vocabulary', 'readwrite');
      const store = tx.objectStore('vocabulary');
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result) {
          const updated = { ...req.result, mastery, updatedAt: Date.now() };
          store.put(updated);
        }
        resolve();
      };
      req.onerror = () => resolve();
    });
  } catch (e) {}
}

// =======================================================
// 5. Reader Notes & Highlights Storage
// =======================================================
const LS_NOTES_KEY = 'athenaeum_notes_v1';

function getLocalNotesBackup() {
  try {
    return JSON.parse(localStorage.getItem(LS_NOTES_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

function saveLocalNotesBackup(list) {
  try {
    localStorage.setItem(LS_NOTES_KEY, JSON.stringify(list));
  } catch (e) {}
}

async function saveBookNote(note) {
  if (!note || !note.bookId) return;
  const id = note.id || `note_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const payload = {
    id,
    bookId: note.bookId,
    format: note.format || 'epub',
    cfiOrPage: note.cfiOrPage || '',
    selectedText: note.selectedText || '',
    noteText: note.noteText || '',
    color: note.color || 'yellow', // yellow, green, blue, pink
    createdAt: note.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  const list = getLocalNotesBackup().filter(x => x.id !== id);
  list.unshift(payload);
  saveLocalNotesBackup(list);

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_notes', 'readwrite');
      const store = tx.objectStore('book_notes');
      store.put(payload);
      tx.oncomplete = () => resolve(payload);
      tx.onerror = () => resolve(payload);
    });
  } catch (e) {
    return payload;
  }
}

async function getBookNotes(bookId) {
  const fallbackList = getLocalNotesBackup().filter(x => x.bookId === bookId);
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_notes', 'readonly');
      const store = tx.objectStore('book_notes');
      const req = store.getAll();
      req.onsuccess = () => {
        let list = (req.result || []).filter(x => x.bookId === bookId);
        if (list.length === 0 && fallbackList.length > 0) list = fallbackList;
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        resolve(list);
      };
      req.onerror = () => resolve(fallbackList);
    });
  } catch (e) {
    return fallbackList;
  }
}

async function deleteBookNote(id) {
  const list = getLocalNotesBackup().filter(x => x.id !== id);
  saveLocalNotesBackup(list);

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_notes', 'readwrite');
      const store = tx.objectStore('book_notes');
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {}
}

// =======================================================
// 6. AI Book Intelligence Dossier Caching
// =======================================================
async function saveBookAnalysis(bookId, dossier) {
  if (!bookId || !dossier) return;
  const payload = {
    id: bookId,
    dossier,
    savedAt: Date.now()
  };

  try {
    localStorage.setItem(`athenaeum_analysis_${bookId}`, JSON.stringify(payload));
  } catch (e) {}

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_analyses', 'readwrite');
      const store = tx.objectStore('book_analyses');
      store.put(payload);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch (e) {}
}

async function getBookAnalysis(bookId) {
  try {
    const stored = localStorage.getItem(`athenaeum_analysis_${bookId}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && parsed.dossier) return parsed.dossier;
    }
  } catch (e) {}

  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('book_analyses', 'readonly');
      const store = tx.objectStore('book_analyses');
      const req = store.get(bookId);
      req.onsuccess = () => {
        resolve(req.result ? req.result.dossier : null);
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

// Export functions to window
window.AthenaeumDB = {
  saveUserBook,
  getAllUserBooks,
  getUserBookById,
  deleteUserBook,
  hideBook,
  unhideBook,
  getHiddenBooks,
  isBookHidden,
  saveBookOverride,
  getAllBookOverrides,
  deleteBookOverride,
  syncOverrideToBackend,
  syncAllOverridesToBackend,
  // Vocabulary
  saveVocabularyWord,
  getAllVocabulary,
  deleteVocabularyWord,
  updateWordMastery,
  // Notes & Highlights
  saveBookNote,
  getBookNotes,
  deleteBookNote,
  // AI Book Intelligence
  saveBookAnalysis,
  getBookAnalysis
};

