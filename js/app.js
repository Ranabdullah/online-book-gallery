/**
 * Athenaeum - Main Gallery Application
 * Features:
 * - Real-time fuzzy search
 * - Category navigation & badge filtering
 * - Format selection (EPUB / PDF)
 * - Sorting by Author, Title, File size
 * - Personal Reading List / Favorites persistence
 * - Local file opener for instant tablet reading
 */

let allBooks = [];
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
    if (!resp.ok) throw new Error('Could not load books catalog');
    allBooks = await resp.json();
    initStats();
    renderBooks();
  } catch (err) {
    console.error('Error loading books:', err);
    document.getElementById('books-grid').innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
        <p style="font-size: 16px;">Building books catalog or loading files...</p>
        <p style="font-size: 13px; margin-top: 8px;">Please refresh in a moment.</p>
      </div>
    `;
  }
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
    // Category filter
    if (currentCategory !== 'all' && b.category !== currentCategory) {
      return false;
    }

    // Format filter
    if (currentFormat !== 'all' && b.format !== currentFormat) {
      return false;
    }

    // Favorites only
    if (showFavoritesOnly && !favs.includes(b.id)) {
      return false;
    }

    // Search query
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
    const hasHosted = b.isHosted;

    return `
      <article class="book-card" data-id="${b.id}">
        <div class="cover-wrapper">
          <img class="book-cover" src="${b.cover}" alt="${escapeHtml(b.title)}" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22400%22 height=%22600%22 viewBox=%220 0 400 600%22><rect width=%22400%22 height=%22600%22 fill=%22%23f1f5f9%22/><text x=%2250%25%22 y=%2250%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 fill=%22%2394a3b8%22 font-family=%22sans-serif%22 font-size=%2218%22>No Cover</text></svg>'">
          <span class="format-badge ${b.format.toLowerCase()}">${b.format}</span>
          <button class="bookmark-btn ${isFav ? 'active' : ''}" onclick="toggleFavorite('${b.id}')" title="${isFav ? 'Remove from favorites' : 'Add to favorites'}">
            ♥
          </button>
        </div>

        <div class="card-details">
          <span class="book-category">${escapeHtml(b.category)}</span>
          <h3 class="book-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</h3>
          <div class="book-author" title="${escapeHtml(b.author)}">${escapeHtml(b.author)}</div>

          <div class="card-actions">
            ${hasHosted ? `
              <a href="${readUrl}" class="btn-read" title="Read online in high-speed reader">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Read</span>
              </a>
            ` : `
              <button class="btn-read" style="background: #475569;" onclick="openLocalPrompt('${b.id}')" title="Large file. Click to load from local storage or tablet">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                <span>Load</span>
              </button>
            `}
            <button class="btn-info" onclick="openBookModal('${b.id}')" title="Details & Options">
              &bull;&bull;&bull;
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');
}

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
  const downloadBtn = document.getElementById('info-download-link');

  if (book.isHosted) {
    readBtn.href = `reader.html?book=${encodeURIComponent(book.file)}`;
    readBtn.style.display = 'inline-flex';
    downloadBtn.href = book.file;
    downloadBtn.style.display = 'inline-flex';
  } else {
    readBtn.href = '#';
    readBtn.onclick = () => {
      modal.classList.remove('active');
      openLocalPrompt(book.id);
    };
    downloadBtn.style.display = 'none';
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

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();

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

  // Reset filters button
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

  // Open local file button for tablet
  const btnOpenFile = document.getElementById('btn-open-file');
  const fileInput = document.getElementById('local-file-input');

  if (btnOpenFile && fileInput) {
    btnOpenFile.addEventListener('click', () => {
      fileInput.click();
    });

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
          // If file is too large for sessionStorage, use URL.createObjectURL or prompt
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
