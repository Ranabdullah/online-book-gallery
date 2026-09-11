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

  // 3. Combine: user books first, then catalog books
  const combined = [...userBooks, ...baseBooks];

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
}

function initStats() {
  const statBooks = document.getElementById('stat-total-books');
  const statAuthors = document.getElementById('stat-total-authors');
  const statCategories = document.getElementById('stat-total-categories');
  const countAll = document.getElementById('count-all');

  if (statBooks) statBooks.textContent = allBooks.length;
  if (countAll) countAll.textContent = allBooks.length;

  const authorsSet = new Set(allBooks.map(b => b.author.trim()).filter(Boolean));
  if (statAuthors) statAuthors.textContent = authorsSet.size;

  const catSet = new Set(allBooks.map(b => b.category).filter(Boolean));
  if (statCategories) statCategories.textContent = catSet.size;

  updateFavoritesBadge();
}

function filterAndSortBooks() {
  const favs = getFavorites();

  return allBooks.filter(b => {
    if (currentCategory !== 'all' && b.category !== currentCategory) {
      return false;
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

    return `
      <article class="book-card" data-id="${b.id}">
        <div class="cover-wrapper">
          <img class="book-cover" src="${b.cover}" alt="${escapeHtml(b.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22600%22 viewBox=%220 0 400 600%22><rect width=%22400%22 height=%22600%22 fill=%22%23f1f5f9%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-family=%22sans-serif%22 font-size=%2216%22>No Cover</text></svg>'">
          ${b.isUserAdded ? `<span class="user-added-badge">NEW</span>` : ''}
          <span class="format-badge ${b.format.toLowerCase()}">${b.format}</span>
          <button class="bookmark-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${b.id}')" title="${isFav ? 'Remove favorite' : 'Add favorite'}">
            ♥
          </button>
        </div>

        <div class="card-details">
          <span class="book-category">${escapeHtml(b.category)}</span>
          <h3 class="book-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</h3>
          <div class="book-author" title="${escapeHtml(b.author)}">${escapeHtml(b.author)}</div>

          <div class="card-actions">
            ${b.isHosted ? `
              <a href="${readUrl}" class="btn-read" title="Read online in high-speed reader">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Read</span>
              </a>
            ` : `
              <button class="btn-read" style="background: #475569;" onclick="openLocalPrompt('${b.id}')" title="Large file. Click to load from local storage">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <span>Load</span>
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

  // Upload cover image
  if (coverFileBtn && coverFileInput) {
    coverFileBtn.addEventListener('click', () => coverFileInput.click());
    coverFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        currentEditCoverData = evt.target.result;
        coverPreview.src = currentEditCoverData;
      };
      reader.readAsDataURL(file);
    });
  }

  // Cover image URL
  if (coverUrlInput) {
    coverUrlInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url) {
        currentEditCoverData = url;
        coverPreview.src = url;
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

      await window.AthenaeumDB.saveBookOverride(currentEditBookId, {
        title,
        author,
        category,
        cover: currentEditCoverData
      });

      modal.classList.remove('active');
      showToast(`Updated "${title}" successfully!`);
      await refreshAllBooks();
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

  if (book.isHosted) {
    readBtn.href = `reader.html?book=${encodeURIComponent(b.file)}`;
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
