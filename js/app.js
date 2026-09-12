/**
 * Athenaeum - Main Gallery Application
 * Features:
 * - Real-time fuzzy search & Category navigation
 * - Permanent right-sidebar integration
 * - Auto-cataloging for user-added books (IndexedDB)
 * - Editing book titles, authors, categories & covers
 * - Drag-and-drop book import
 * - Reading list / Favorites persistence
 */

let baseBooks = [];
let allBooks = [];
let bookOverrides = {};
let currentCategory = 'all';
let currentFormat = 'all';
let currentSort = 'author-asc';
let searchQuery = '';
let showFavoritesOnly = false;

const STORAGE_KEY_FAVS = 'athenaeum_favorites';

function getFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY_FAVS) || '[]');
  } catch (e) {
    return [];
  }
}

function toggleFavorite(bookId) {
  const favs = getFavorites();
  const index = favs.indexOf(bookId);
  if (index > -1) {
    favs.splice(index, 1);
  } else {
    favs.push(bookId);
  }
  localStorage.setItem(STORAGE_KEY_FAVS, JSON.stringify(favs));
  updateFavoritesBadge();
  renderBooks();
}

function updateFavoritesBadge() {
  const favs = getFavorites();
  const badge = document.getElementById('fav-count');
  if (badge) badge.textContent = favs.length;
}

async function loadCatalog() {
  try {
    const resp = await fetch('data/books.json');
    if (resp.ok) {
      baseBooks = await resp.json();
    }
  } catch (err) {
    console.warn('Could not fetch base books.json:', err);
  }

  await refreshAllBooks();
}

async function refreshAllBooks() {
  // 1. Get overrides
  bookOverrides = await window.AthenaeumDB.getAllBookOverrides();

  // 2. Get user added books
  const userBooks = await window.AthenaeumDB.getAllUserBooks();

  // 3. Combine: user books first, then catalog books, filtering out deleted/hidden books
  const hiddenIds = new Set(window.AthenaeumDB ? window.AthenaeumDB.getHiddenBooks() : []);
  const combined = [...userBooks, ...baseBooks].filter(b => {
    if (hiddenIds.has(b.id)) return false;
    const ov = bookOverrides[b.id];
    if (ov && ov.deleted === true) return false;
    return true;
  });

  // 4. Apply overrides
  allBooks = combined.map(b => {
    const override = bookOverrides[b.id];
    if (override) {
      return {
        ...b,
        title: override.title || b.title,
        author: override.author || b.author,
        category: override.category || b.category,
        cover: override.cover || b.cover,
        hasCustomOverride: true
      };
    }
    return b;
  });

  initStats();
  renderBooks();
  updateDuplicateBadge();
}

function initStats() {
  const hosted = allBooks.filter(b => b.isHosted && !b.needsFix);
  const needsFix = allBooks.filter(b => !b.isHosted || b.needsFix);

  const statBooks = document.getElementById('stat-total-books');
  const statAuthors = document.getElementById('stat-total-authors');
  const statCategories = document.getElementById('stat-total-categories');
  const countAll = document.getElementById('count-all');
  const countNeedsUpload = document.getElementById('count-needs-upload');

  if (statBooks) statBooks.textContent = hosted.length;
  if (countAll) countAll.textContent = hosted.length;
  if (countNeedsUpload) countNeedsUpload.textContent = needsFix.length;

  const authorsSet = new Set(hosted.map(b => (b.author || '').trim()).filter(Boolean));
  if (statAuthors) statAuthors.textContent = authorsSet.size;

  const catSet = new Set(hosted.map(b => b.category).filter(Boolean));
  if (statCategories) statCategories.textContent = catSet.size;

  updateFavoritesBadge();
}

function filterAndSortBooks() {
  const favs = getFavorites();

  return allBooks.filter(b => {
    if (currentCategory === '__needs_upload__') {
      if (b.isHosted && !b.needsFix) return false;
    } else {
      // Normal reading library: hide unhosted books
      if (!b.isHosted || b.needsFix) return false;
      if (currentCategory !== 'all' && b.category !== currentCategory) {
        return false;
      }
    }

    if (currentFormat !== 'all' && b.format !== currentFormat) {
      return false;
    }

    if (showFavoritesOnly && !favs.includes(b.id)) {
      return false;
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchTitle = (b.title || '').toLowerCase().includes(q);
      const matchAuthor = (b.author || '').toLowerCase().includes(q);
      const matchCat = (b.category || '').toLowerCase().includes(q);
      if (!matchTitle && !matchAuthor && !matchCat) {
        return false;
      }
    }

    return true;
  }).sort((a, b) => {
    // User added books always on top when viewing recent
    if (a.isUserAdded && !b.isUserAdded) return -1;
    if (!a.isUserAdded && b.isUserAdded) return 1;

    if (currentSort === 'author-asc') {
      return (a.author || '').localeCompare(b.author || '');
    }
    if (currentSort === 'title-asc') {
      return (a.title || '').localeCompare(b.title || '');
    }
    if (currentSort === 'size-desc') {
      return (b.sizeMB || 0) - (a.sizeMB || 0);
    }
    if (currentSort === 'size-asc') {
      return (a.sizeMB || 0) - (b.sizeMB || 0);
    }
    return 0;
  });
}

function renderBooks() {
  const grid = document.getElementById('books-grid');
  const emptyState = document.getElementById('empty-state');
  const visibleCount = document.getElementById('visible-count');
  if (!grid) return;

  const filtered = filterAndSortBooks();
  if (visibleCount) visibleCount.textContent = filtered.length;

  if (filtered.length === 0) {
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';

  const favs = getFavorites();

  grid.innerHTML = filtered.map(b => {
    const isFav = favs.includes(b.id);
    const readUrl = b.isHosted ? `reader.html?book=${encodeURIComponent(b.file)}` : '#';
    const isNeedsUpload = !b.isHosted || b.needsFix;

    return `
      <article class="book-card ${isNeedsUpload ? 'card-needs-upload' : ''}" data-id="${b.id}">
        <div class="cover-wrapper">
          <img class="book-cover" src="${b.cover}" alt="${escapeHtml(b.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22600%22 viewBox=%220 0 400 600%22><rect width=%22400%22 height=%22600%22 fill=%22%23f1f5f9%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-family=%22sans-serif%22 font-size=%2216%22>No Cover</text></svg>'">
          ${isNeedsUpload ? `<span class="format-badge" style="background: #ea580c; left: 8px; right: auto; font-size: 10px; font-weight: 700;">⚠️ NEEDS FILE</span>` : ''}
          ${b.isUserAdded ? `<span class="user-added-badge">NEW</span>` : ''}
          <span class="format-badge ${b.format.toLowerCase()}">${b.format}</span>
          <button class="bookmark-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${b.id}')" title="${isFav ? 'Remove favorite' : 'Add favorite'}">
            ♥
          </button>
          <button class="card-cover-change-btn" onclick="triggerQuickCoverChange('${b.id}', event)" title="Change book cover">
            📷 Cover
          </button>
        </div>

        <div class="card-details">
          <span class="book-category">${escapeHtml(b.category)}</span>
          <h3 class="book-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</h3>
          <div class="book-author" title="${escapeHtml(b.author)}">${escapeHtml(b.author)}</div>

          <div class="card-actions">
            ${!isNeedsUpload ? `
              <a href="${readUrl}" class="btn-read" title="Read online in high-speed reader">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Read</span>
              </a>
            ` : `
              <button class="btn-read" style="background: #ea580c;" onclick="triggerDirectFileUpload('${b.id}')" title="Upload EPUB or PDF from PC to read">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <span>Upload</span>
              </button>
            `}
            <button class="btn-card-edit" onclick="openEditModal('${b.id}')" title="Edit book name, author, category or cover">
              ✏️
            </button>
            <button class="btn-card-edit" onclick="openBookModal('${b.id}')" title="Book details">
              &bull;&bull;&bull;
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  attachCardDragAndDrop();
}

/**
 * Direct File Upload Handler for Needs Upload Tab
 */
window.triggerDirectFileUpload = function(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.epub,.pdf';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast(`Saving "${file.name}"...`);
    try {
      const buffer = await file.arrayBuffer();
      if (book) {
        book.fileData = buffer;
        book.isHosted = true;
        book.needsFix = false;
        book.file = `idb://${bookId}`;
        book.format = file.name.split('.').pop().toUpperCase();
        book.sizeMB = Math.round((file.size / (1024 * 1024)) * 100) / 100;

        if (window.AthenaeumDB) {
          await window.AthenaeumDB.saveUserBook({
            id: bookId,
            title: book.title,
            author: book.author,
            category: book.category,
            format: book.format,
            cover: book.cover,
            fileData: buffer,
            sizeMB: book.sizeMB,
            dateAdded: Date.now()
          });
        }

        showToast(`✅ "${book.title}" is now ready! Opening...`);
        initStats();
        renderBooks();
        setTimeout(() => {
          window.location.href = `reader.html?book=${encodeURIComponent(book.file)}&title=${encodeURIComponent(book.title)}`;
        }, 700);
      }
    } catch (err) {
      alert('Error saving book file: ' + err.message);
    }
  };
  input.click();
};

/**
 * Bulletproof Cover Saving & Image Optimization System
 */
async function saveCoverForBook(bookId, source, showNotice = true) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;

  try {
    const optimized = await window.BookManager.optimizeCoverImage(source);
    const existing = bookOverrides[bookId] || {};
    const updatedOverride = {
      ...existing,
      title: existing.title || book.title,
      author: existing.author || book.author,
      category: existing.category || book.category,
      cover: optimized
    };

    // 1. Dual-layer save: IndexedDB + LocalStorage backup
    await window.AthenaeumDB.saveBookOverride(bookId, updatedOverride);
    bookOverrides[bookId] = updatedOverride;

    // Broadcast to backend & cloud sync automatically
    if (window.AthenaeumSync) {
      window.AthenaeumSync.broadcastBookOverride(bookId, updatedOverride);
    }

    // 2. Update memory state
    book.cover = optimized;
    book.hasCustomOverride = true;

    // 3. Update preview in modal if currently open
    const infoCover = document.getElementById('info-cover');
    if (infoCover) infoCover.src = optimized;
    const editPreview = document.getElementById('edit-cover-preview');
    if (editPreview) editPreview.src = optimized;

    // 4. Update gallery cards
    renderBooks();

    if (showNotice) {
      showToast(`Cover saved successfully for "${book.title}"!`);
    }
    return optimized;
  } catch (err) {
    console.error('Failed to save cover:', err);
    showToast('Could not save cover: ' + err.message);
    throw err;
  }
}

function triggerQuickCoverChange(bookId, event) {
  if (event) {
    event.stopPropagation();
    event.preventDefault();
  }

  let quickInput = document.getElementById('quick-cover-input');
  if (!quickInput) {
    quickInput = document.createElement('input');
    quickInput.type = 'file';
    quickInput.id = 'quick-cover-input';
    quickInput.accept = 'image/*';
    quickInput.style.display = 'none';
    document.body.appendChild(quickInput);
  }

  quickInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (file) {
      await saveCoverForBook(bookId, file, true);
    }
    quickInput.value = '';
  };

  quickInput.click();
}

function attachCardDragAndDrop() {
  const cards = document.querySelectorAll('.book-card');
  cards.forEach(card => {
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add('drag-target');
    });

    card.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-target');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('drag-target');

      const bookId = card.dataset.id;
      if (!bookId) return;

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
          await saveCoverForBook(bookId, file, true);
        }
      } else {
        const text = e.dataTransfer.getData('text/plain');
        if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('data:image/'))) {
          await saveCoverForBook(bookId, text, true);
        }
      }
    });
  });
}

/**
 * Edit Book Modal Logic
 */
let currentEditBookId = null;
let currentEditCoverData = null;

function openEditModal(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;

  currentEditBookId = bookId;
  currentEditCoverData = book.cover;

  document.getElementById('edit-book-id').value = bookId;
  document.getElementById('edit-title').value = book.title;
  document.getElementById('edit-author').value = book.author;
  document.getElementById('edit-category').value = book.category;
  document.getElementById('edit-cover-preview').src = book.cover;
  document.getElementById('edit-cover-url').value = '';

  const modal = document.getElementById('edit-modal');
  modal.classList.add('active');
}

function setupEditModal() {
  const modal = document.getElementById('edit-modal');
  const closeBtn = document.getElementById('edit-modal-close');
  const form = document.getElementById('edit-book-form');
  const coverFileBtn = document.getElementById('btn-change-cover-file');
  const coverFileInput = document.getElementById('edit-cover-file');
  const coverUrlInput = document.getElementById('edit-cover-url');
  const coverPreview = document.getElementById('edit-cover-preview');
  const resetBtn = document.getElementById('btn-reset-book-override');

  if (closeBtn) closeBtn.addEventListener('click', () => modal.classList.remove('active'));
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  // Upload cover image with instant optimization & preview
  if (coverFileBtn && coverFileInput) {
    coverFileBtn.addEventListener('click', () => coverFileInput.click());
    coverFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        coverPreview.style.opacity = '0.5';
        const optimized = await window.BookManager.optimizeCoverImage(file);
        currentEditCoverData = optimized;
        coverPreview.src = optimized;
        coverPreview.style.opacity = '1';
        // Auto-save immediately to DB/LocalStorage so it is never lost!
        if (currentEditBookId) {
          await saveCoverForBook(currentEditBookId, optimized, false);
          showToast('Cover saved instantly!');
        }
      } catch (err) {
        console.error('Error optimizing cover:', err);
        coverPreview.style.opacity = '1';
      }
    });
  }

  // Cover image URL
  if (coverUrlInput) {
    coverUrlInput.addEventListener('change', async (e) => {
      const url = e.target.value.trim();
      if (url) {
        try {
          const optimized = await window.BookManager.optimizeCoverImage(url);
          currentEditCoverData = optimized;
          coverPreview.src = optimized;
          if (currentEditBookId) {
            await saveCoverForBook(currentEditBookId, optimized, false);
            showToast('Cover saved instantly!');
          }
        } catch (err) {
          currentEditCoverData = url;
          coverPreview.src = url;
        }
      }
    });
  }

  // Save changes
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentEditBookId) return;

      const title = document.getElementById('edit-title').value.trim();
      const author = document.getElementById('edit-author').value.trim();
      const category = document.getElementById('edit-category').value;

      const overrideData = {
        title,
        author,
        category,
        cover: currentEditCoverData
      };

      await window.AthenaeumDB.saveBookOverride(currentEditBookId, overrideData);

      // Auto-broadcast to backend and cross-device sync
      if (window.AthenaeumSync) {
        window.AthenaeumSync.broadcastBookOverride(currentEditBookId, overrideData);
      }

      modal.classList.remove('active');
      showToast(`Updated "${title}" successfully!`);
      await refreshAllBooks();
    });
  }

  // Delete book from library
  const deleteBtn = document.getElementById('btn-delete-book');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', () => {
      if (currentEditBookId) {
        deleteBook(currentEditBookId);
      }
    });
  }

  // Reset to original
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      if (!currentEditBookId) return;
      await window.AthenaeumDB.deleteBookOverride(currentEditBookId);
      modal.classList.remove('active');
      showToast('Restored original book details');
      await refreshAllBooks();
    });
  }
}

/**
 * Add Book Auto-Cataloging Setup
 */
function setupAddBook() {
  const btnAdd = document.getElementById('btn-add-book');
  const input = document.getElementById('add-book-input');
  const overlay = document.getElementById('drag-overlay');

  if (btnAdd && input) {
    btnAdd.addEventListener('click', () => input.click());

    input.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      showToast('Auto-cataloging book and extracting cover...');
      try {
        const book = await window.BookManager.processAndAddBook(file);
        showToast(`✨ Added "${book.title}" to your library!`);
        await refreshAllBooks();
      } catch (err) {
        alert('Failed to catalogue book: ' + err.message);
      }
      input.value = '';
    });
  }

  // Drag and Drop
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (overlay) overlay.classList.add('active');
  });

  if (overlay) {
    overlay.addEventListener('dragleave', (e) => {
      e.preventDefault();
      overlay.classList.remove('active');
    });

    overlay.addEventListener('drop', async (e) => {
      e.preventDefault();
      overlay.classList.remove('active');

      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;

      const file = files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['epub', 'pdf'].includes(ext)) {
        alert('Please drop an .epub or .pdf book file.');
        return;
      }

      showToast('Auto-cataloging book and extracting cover...');
      try {
        const book = await window.BookManager.processAndAddBook(file);
        showToast(`✨ Added "${book.title}" to your library!`);
        await refreshAllBooks();
      } catch (err) {
        alert('Failed to catalogue book: ' + err.message);
      }
    });
  }

  // Listen for custom event
  window.addEventListener('athenaeum:book-added', () => {
    refreshAllBooks();
  });
}

/**
 * Quick View Info Modal
 */
function openBookModal(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  if (!book) return;

  const modal = document.getElementById('info-modal');
  document.getElementById('info-cover').src = book.cover;
  document.getElementById('info-title').textContent = book.title;
  document.getElementById('info-author').textContent = `By ${book.author}`;
  document.getElementById('info-category').textContent = book.category;
  document.getElementById('info-format').textContent = `Format: ${book.format}`;
  document.getElementById('info-size').textContent = `Size: ${book.sizeMB} MB`;

  const readBtn = document.getElementById('info-read-link');
  const editBtn = document.getElementById('info-edit-btn');
  const changeCoverBtn = document.getElementById('btn-info-change-cover');
  const changeCoverInput = document.getElementById('info-cover-file');

  if (changeCoverBtn && changeCoverInput) {
    changeCoverBtn.onclick = () => changeCoverInput.click();
    changeCoverInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (file) {
        await saveCoverForBook(book.id, file, true);
        document.getElementById('info-cover').src = book.cover;
      }
      changeCoverInput.value = '';
    };
  }

  if (book.isHosted) {
    readBtn.href = `reader.html?book=${encodeURIComponent(book.file)}`;
    readBtn.style.display = 'inline-flex';
  } else {
    readBtn.href = '#';
    readBtn.onclick = () => {
      modal.classList.remove('active');
      openLocalPrompt(book.id);
    };
  }

  if (editBtn) {
    editBtn.onclick = () => {
      modal.classList.remove('active');
      openEditModal(book.id);
    };
  }

  const infoDeleteBtn = document.getElementById('info-delete-btn');
  if (infoDeleteBtn) {
    infoDeleteBtn.onclick = () => {
      deleteBook(book.id);
    };
  }

  modal.classList.add('active');
}

function openLocalPrompt(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  const name = book ? book.title : 'this book';
  const fileInput = document.getElementById('local-file-input');
  alert(`"${name}" is cataloged in your library! Select the file from your tablet or device storage to open it instantly in the reader.`);
  if (fileInput) fileInput.click();
}

function showToast(msg) {
  const toast = document.getElementById('toast-notice');
  const toastMsg = document.getElementById('toast-msg');
  if (toast && toastMsg) {
    toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3500);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();
  setupAddBook();
  setupEditModal();
  setupSyncModal();
  setupDuplicateManager();

  // Search input with debounce
  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  let searchTimeout;

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const val = e.target.value.trim();
      searchTimeout = setTimeout(() => {
        searchQuery = val;
        if (searchClear) searchClear.classList.toggle('active', val.length > 0);
        renderBooks();
      }, 150);
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.classList.remove('active');
      renderBooks();
    });
  }

  // Category pills
  const pillsContainer = document.getElementById('category-pills');
  if (pillsContainer) {
    pillsContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.cat-pill');
      if (!pill) return;
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentCategory = pill.dataset.category;
      renderBooks();
    });
  }

  // Format filter
  const formatSelect = document.getElementById('format-filter');
  if (formatSelect) {
    formatSelect.addEventListener('change', (e) => {
      currentFormat = e.target.value;
      renderBooks();
    });
  }

  // Sort filter
  const sortSelect = document.getElementById('sort-filter');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderBooks();
    });
  }

  // Favorites filter toggle
  const favBtn = document.getElementById('btn-favorites');
  if (favBtn) {
    favBtn.addEventListener('click', () => {
      showFavoritesOnly = !showFavoritesOnly;
      favBtn.classList.toggle('btn-primary', showFavoritesOnly);
      favBtn.classList.toggle('btn-outline', !showFavoritesOnly);
      renderBooks();
    });
  }

  // Reset filters
  const resetBtn = document.getElementById('btn-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      currentCategory = 'all';
      currentFormat = 'all';
      searchQuery = '';
      showFavoritesOnly = false;
      if (searchInput) searchInput.value = '';
      if (formatSelect) formatSelect.value = 'all';
      if (favBtn) {
        favBtn.classList.remove('btn-primary');
        favBtn.classList.add('btn-outline');
      }
      document.querySelectorAll('.cat-pill').forEach(p => p.classList.toggle('active', p.dataset.category === 'all'));
      renderBooks();
    });
  }

  // Open local file direct
  const btnOpenFile = document.getElementById('btn-open-file');
  const fileInput = document.getElementById('local-file-input');

  if (btnOpenFile && fileInput) {
    btnOpenFile.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          sessionStorage.setItem('athenaeum_local_file_name', file.name);
          sessionStorage.setItem('athenaeum_local_file_data', evt.target.result);
          window.location.href = 'reader.html?local=1';
        } catch (storageErr) {
          const blobUrl = URL.createObjectURL(file);
          window.location.href = `reader.html?blob=${encodeURIComponent(blobUrl)}&title=${encodeURIComponent(file.name)}`;
        }
      };
      reader.readAsDataURL(file);
    });
  }

  // Info modal close
  const infoModal = document.getElementById('info-modal');
  const infoClose = document.getElementById('info-modal-close');
  if (infoClose && infoModal) {
    infoClose.addEventListener('click', () => infoModal.classList.remove('active'));
    infoModal.addEventListener('click', (e) => {
      if (e.target === infoModal) infoModal.classList.remove('active');
    });
  }
});

// Export key functions globally for inline HTML event handlers
window.openBookModal = openBookModal;
window.openEditModal = openEditModal;
window.toggleFavorite = toggleFavorite;
window.openLocalPrompt = openLocalPrompt;
window.saveCoverForBook = saveCoverForBook;
window.triggerQuickCoverChange = triggerQuickCoverChange;

/**
 * Book Deletion & Duplicate Management System
 */
async function deleteBook(bookId) {
  const book = allBooks.find(b => b.id === bookId);
  const title = book ? book.title : 'this book';

  const confirmed = confirm(`Are you sure you want to delete "${title}" from your library?`);
  if (!confirmed) return;

  try {
    if (book && book.isUserBook) {
      await window.AthenaeumDB.deleteUserBook(bookId);
    } else {
      window.AthenaeumDB.hideBook(bookId);
    }

    // Save override with deleted flag and sync
    await window.AthenaeumDB.saveBookOverride(bookId, { deleted: true });

    if (window.AthenaeumSync) {
      window.AthenaeumSync.broadcastBookOverride(bookId, { deleted: true });
      window.AthenaeumSync.performFullSync().catch(() => {});
    }

    // Close any open modals
    const editModal = document.getElementById('edit-modal');
    if (editModal) editModal.classList.remove('active');
    const infoModal = document.getElementById('info-modal');
    if (infoModal) infoModal.classList.remove('active');

    showToast(`Removed "${title}" from library`);
    await refreshAllBooks();
    updateDuplicateBadge();
  } catch (err) {
    alert('Error deleting book: ' + err.message);
  }
}

function normalizeTitleForDupe(t) {
  if (!t) return '';
  let clean = t.toLowerCase();
  clean = clean.replace(/\(pdfdrive\)/g, '');
  clean = clean.replace(/\(.*?\)/g, '');
  clean = clean.replace(/\[.*?\]/g, '');
  clean = clean.replace(/[_]/g, ' ');
  clean = clean.replace(/[-]/g, ' ');
  clean = clean.replace(/[^a-z0-9\s]/g, '');
  return clean.trim().replace(/\s+/g, ' ');
}

function detectLibraryDuplicates() {
  const groups = {};
  for (const b of allBooks) {
    const key = normalizeTitleForDupe(b.title);
    if (!key || key.length < 3) continue;
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  }

  const duplicateGroups = [];
  for (const [key, items] of Object.entries(groups)) {
    if (items.length > 1) {
      duplicateGroups.push({
        key,
        title: items[0].title,
        items
      });
    }
  }
  return duplicateGroups;
}

function updateDuplicateBadge() {
  const dupes = detectLibraryDuplicates();
  const badge = document.getElementById('dupe-count-badge');
  if (badge) {
    if (dupes.length > 0) {
      badge.textContent = dupes.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }
}

function setupDuplicateManager() {
  const btnManage = document.getElementById('btn-manage-dupes');
  const modal = document.getElementById('duplicates-modal');
  const closeBtn = document.getElementById('duplicates-modal-close');
  const rescanBtn = document.getElementById('btn-rescan-dupes');
  const container = document.getElementById('duplicates-list-container');
  const statusSummary = document.getElementById('dupe-status-summary');
  const statusDetail = document.getElementById('dupe-status-detail');

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  function renderDuplicates() {
    const dupes = detectLibraryDuplicates();
    if (dupes.length === 0) {
      if (statusSummary) statusSummary.textContent = '✨ Library is 100% Clean';
      if (statusDetail) statusDetail.textContent = 'No duplicate titles or conflicting files detected.';
      if (container) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
            <div style="font-size: 40px; margin-bottom: 8px;">🎉</div>
            <h4 style="font-family: var(--font-serif); font-size: 16px; margin-bottom: 4px; color: var(--text-main);">No Duplicates Found</h4>
            <p style="font-size: 13px;">Every book in your library is unique. When duplicates appear from imports or syncs, you can manage them here.</p>
          </div>
        `;
      }
      return;
    }

    let totalCopies = 0;
    dupes.forEach(g => totalCopies += g.items.length);
    if (statusSummary) statusSummary.textContent = `Found ${dupes.length} Duplicate Group${dupes.length > 1 ? 's' : ''} (${totalCopies} total books)`;
    if (statusDetail) statusDetail.textContent = 'Review and delete redundant copies below.';

    if (container) {
      container.innerHTML = dupes.map((group, gIdx) => `
        <div class="dupe-group-card" id="dupe-group-${gIdx}">
          <div class="dupe-group-title">
            <span>📚</span>
            <span>Matched: <em>"${escapeHtml(group.title)}"</em></span>
            <span class="cat-pill" style="font-size: 10px; margin-left: auto;">${group.items.length} copies</span>
          </div>
          <div class="dupe-items-grid">
            ${group.items.map(item => `
              <div class="dupe-item-row" id="dupe-row-${item.id}">
                <img src="${item.cover}" alt="Cover" class="dupe-item-thumb">
                <div class="dupe-item-details">
                  <div class="dupe-item-title">${escapeHtml(item.title)}</div>
                  <div class="dupe-item-meta">
                    <span>👤 ${escapeHtml(item.author || 'Unknown')}</span>
                    <span>📁 ${item.format} (${item.sizeMB} MB)</span>
                    <span>🏷️ ${escapeHtml(item.category)}</span>
                    ${item.isHosted ? '<span style="color: #059669; font-weight: 600;">● Online Reader Ready</span>' : '<span style="color: #64748b;">○ Local Catalog</span>'}
                  </div>
                </div>
                <button type="button" class="btn btn-outline dupe-action-del" onclick="deleteDuplicateItem('${item.id}', this)">
                  🗑️ Delete Copy
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('');
    }
  }

  if (btnManage) {
    btnManage.addEventListener('click', () => {
      renderDuplicates();
      if (modal) modal.classList.add('active');
    });
  }

  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      renderDuplicates();
      showToast('Duplicate scan completed');
    });
  }
}

async function deleteDuplicateItem(bookId, btn) {
  const row = btn ? btn.closest('.dupe-item-row') : document.getElementById(`dupe-row-${bookId}`);
  const group = row ? row.closest('.dupe-group-card') : null;

  await deleteBook(bookId);

  if (row) row.remove();
  if (group) {
    const remainingRows = group.querySelectorAll('.dupe-item-row');
    if (remainingRows.length <= 1) {
      group.remove();
    }
  }
  updateDuplicateBadge();
}

/**
 * Cross-Device Synchronization & Profile Manager Setup
 */
function setupSyncModal() {
  const btnToggle = document.getElementById('btn-sync-toggle');
  const modal = document.getElementById('sync-modal');
  const closeBtn = document.getElementById('sync-modal-close');
  const btnSyncNow = document.getElementById('btn-sync-now');
  const deviceNameEl = document.getElementById('sync-device-name');
  const roomKeyInput = document.getElementById('sync-room-key');
  const btnSaveKey = document.getElementById('btn-save-sync-key');
  const btnCopyKey = document.getElementById('btn-copy-sync-key');
  const ghTokenInput = document.getElementById('gh-pat-token');
  const btnSaveGh = document.getElementById('btn-save-gh-token');
  const profileRadios = document.querySelectorAll('input[name="profile_choice"]');

  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  function updateSyncUI() {
    if (!window.AthenaeumSync) return;
    const device = window.AthenaeumSync.detectDevice();
    if (deviceNameEl) {
      deviceNameEl.textContent = `${device.label}`;
    }

    const currentProfile = window.AthenaeumSync.getActiveProfile();
    profileRadios.forEach(radio => {
      radio.checked = (radio.value === currentProfile.id);
      const card = radio.closest('.profile-card');
      if (card) card.classList.toggle('active', radio.checked);
    });

    if (roomKeyInput) {
      roomKeyInput.value = window.AthenaeumSync.getSyncKey();
    }

    if (ghTokenInput) {
      ghTokenInput.value = window.AthenaeumSync.getGitHubToken();
    }

    renderReadingLogsList();
  }

  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      updateSyncUI();
      if (modal) modal.classList.add('active');
    });
  }

  // Profile radio changes
  profileRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (!window.AthenaeumSync) return;
      const isShared = (e.target.value === 'shared');
      const profile = {
        id: e.target.value,
        name: isShared ? 'Shared (Phone & PC)' : 'Independent PC Log',
        isShared
      };
      window.AthenaeumSync.setActiveProfile(profile);
      profileRadios.forEach(r => {
        const c = r.closest('.profile-card');
        if (c) c.classList.toggle('active', r.checked);
      });
      showToast(`Switched profile: ${profile.name}`);
      if (isShared) {
        window.AthenaeumSync.performFullSync().catch(() => {});
      }
    });
  });

  // Save sync key
  if (btnSaveKey && roomKeyInput) {
    btnSaveKey.addEventListener('click', () => {
      if (!window.AthenaeumSync) return;
      const key = window.AthenaeumSync.setSyncKey(roomKeyInput.value);
      showToast(`Pairing key updated: ${key}`);
      window.AthenaeumSync.performFullSync().then(() => {
        renderReadingLogsList();
      });
    });
  }

  // Copy sync key
  if (btnCopyKey && roomKeyInput) {
    btnCopyKey.addEventListener('click', () => {
      const val = roomKeyInput.value || (window.AthenaeumSync ? window.AthenaeumSync.getSyncKey() : '');
      navigator.clipboard.writeText(val).then(() => {
        showToast('Copied pairing key to clipboard!');
      }).catch(() => {
        roomKeyInput.select();
        document.execCommand('copy');
        showToast('Copied pairing key!');
      });
    });
  }

  // Save GitHub token
  if (btnSaveGh && ghTokenInput) {
    btnSaveGh.addEventListener('click', () => {
      if (!window.AthenaeumSync) return;
      const val = window.AthenaeumSync.setGitHubToken(ghTokenInput.value);
      showToast(val ? 'GitHub PAT saved! Auto-commit active.' : 'GitHub PAT cleared.');
    });
  }

  // Manual Sync Now button
  if (btnSyncNow) {
    btnSyncNow.addEventListener('click', async () => {
      if (!window.AthenaeumSync) return;
      btnSyncNow.disabled = true;
      btnSyncNow.innerHTML = '<span>⏳ Syncing...</span>';
      const res = await window.AthenaeumSync.performFullSync();
      btnSyncNow.disabled = false;
      btnSyncNow.innerHTML = '<span>⚡ Sync Now</span>';
      if (res.success) {
        showToast('Library & Reading Progress Synced!');
        await refreshAllBooks();
        renderReadingLogsList();
      } else {
        showToast('Sync completed (local active)');
      }
    });
  }

  // Sync listener for header dot & live updates
  if (window.AthenaeumSync) {
    window.AthenaeumSync.addSyncListener((event, data) => {
      const dot = document.getElementById('sync-dot');
      const badge = document.getElementById('sync-status-badge');
      const lastMsg = document.getElementById('sync-last-msg');

      if (event === 'sync_status') {
        if (dot) {
          dot.className = 'sync-dot ' + (data.status === 'syncing' ? 'syncing' : (data.status === 'synced' ? '' : 'offline'));
        }
        if (badge) {
          badge.className = 'status-pill ' + (data.status === 'syncing' ? 'status-syncing' : 'status-synced');
          badge.textContent = data.status === 'syncing' ? '● Syncing...' : '● Synced';
        }
        if (lastMsg && data.text) {
          lastMsg.textContent = data.text;
        }
      } else if (event === 'logs_updated' || event === 'progress_saved') {
        renderReadingLogsList();
      }
    });
  }
}

function renderReadingLogsList() {
  const container = document.getElementById('reading-logs-list');
  const countText = document.getElementById('logs-count-text');
  if (!container || !window.AthenaeumSync) return;

  const logs = window.AthenaeumSync.getReadingLogs();
  if (countText) countText.textContent = `${logs.length} logged session${logs.length !== 1 ? 's' : ''}`;

  if (logs.length === 0) {
    container.innerHTML = `<div style="padding: 18px; text-align: center; color: var(--text-muted); font-size: 12.5px;">No reading activity recorded yet. Open any book to track progress across devices!</div>`;
    return;
  }

  container.innerHTML = logs.map(log => {
    const book = allBooks.find(b => b.id === log.bookId || b.file === log.bookId);
    const readUrl = log.bookId && log.bookId.includes('/') ? `reader.html?book=${encodeURIComponent(log.bookId)}` : (book && book.file ? `reader.html?book=${encodeURIComponent(book.file)}` : '#');
    const title = log.bookTitle || (book ? book.title : 'Book');
    const pos = log.page ? `Page ${log.page}` : `${log.percentage || 0}%`;

    return `
      <div class="reading-log-item">
        <div style="flex: 1; min-width: 0; padding-right: 10px;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            <span class="log-device-badge">${escapeHtml(log.deviceLabel || 'Device')}</span>
            <strong style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px;">${escapeHtml(title)}</strong>
          </div>
          <div style="font-size: 11.5px; color: var(--text-muted);">
            Progress: <strong>${pos}</strong> (${log.percentage || 0}%) • ${formatTimeAgo(log.updatedAt || log.timestamp)}
          </div>
        </div>
        ${readUrl !== '#' ? `
          <a href="${readUrl}" class="btn btn-outline" style="font-size: 11.5px; padding: 4px 10px; white-space: nowrap;">
            Resume
          </a>
        ` : ''}
      </div>
    `;
  }).join('');
}

function formatTimeAgo(ts) {
  if (!ts) return 'Just now';
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Export functions to window
window.deleteBook = deleteBook;
window.deleteDuplicateItem = deleteDuplicateItem;
window.setupDuplicateManager = setupDuplicateManager;
window.detectLibraryDuplicates = detectLibraryDuplicates;


