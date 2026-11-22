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
let currentOrigin = 'all';
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
    const resp = await fetch(`data/books.json?v=3.6.1&t=${Date.now()}`, { cache: 'no-cache' });
    if (resp.ok) {
      baseBooks = await resp.json();
      try {
        const external = await fetch('data/free-books.json?v=1', {cache:'no-store'});
        if(external.ok) {
          const suggestions = await external.json();
          const canonical = text => String(text||'').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g,'');
          const existing = new Set(baseBooks.map(b => canonical(b.title)));
          for(const b of suggestions){
            if(!b.externalUrl || !/^https:\/\/www\.gutenberg\.org\/ebooks\/\d+$/.test(b.externalUrl)) continue;
            if(existing.has(canonical(b.title)))continue;
            b.originMark='N';
            b.isExternal=true;
            baseBooks.push(b);
            existing.add(canonical(b.title));
          }
        }
      } catch(e){ console.warn('Free-source list unavailable',e); }
      // Metadata-only A records; count as catalogued, never as readable files.
      try {
        const response = await fetch('data/abdurrehman-archive.json?v=2', {cache:'no-store'});
        if (response.ok) {
          const inventory = await response.json();
          const titleKey = value => String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
          const titles = new Set(baseBooks.map(b => titleKey(b.title)));
          const prioritize = {EPUB:0,PDF:1,MOBI:2};
          for (const item of [...(inventory.books || [])].sort((a,b) => (prioritize[a.format] ?? 9) - (prioritize[b.format] ?? 9))) {
            const key = titleKey(item.title);
            if (key.length < 3 || titles.has(key)) continue;
            titles.add(key);
            baseBooks.push({
              id:item.id, title:item.displayTitle || item.title, author:item.author || 'Author not confirmed',
              category:item.category, format:item.format, sizeMB:item.sizeMB,
              cover:'', file:'', isHosted:false, needsFix:false,
              isArchiveRecord:true, recordType:item.recordType || 'book-format archive entry', readingAvailable:false,
              originMark:'A', originAttribution:'Abdurrehman (archive supplied)',
              originArchive:item.archive, originArchiveEntry:item.path,
              description:item.description || ('Archive entry in the '+item.category+' collection; source text not yet verified.'),
              summaries:{everyday:null,inDepth:null}, summaryStatus:'awaiting_source_file'
            });
          }
        }
      } catch (err) {console.warn('Archive inventory not loaded:',err);}
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
  const seenBookIds = new Set();
  const combined = [...userBooks, ...baseBooks].filter(b => {
    if (seenBookIds.has(b.id)) return false; // Local restored missing file takes priority over its catalog stub
    seenBookIds.add(b.id);
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

  window.AthenaeumCatalog = allBooks.filter(b => b.isHosted && !b.needsFix);
  window.dispatchEvent(new Event("athenaeum:catalog-ready"));
  initStats();
  renderFeaturedBook();
  renderBooks();
  updateDuplicateBadge();
}

let featuredBookId = null;

function renderFeaturedBook(chooseAnother = false) {
  const panel = document.getElementById('featured-book-section');
  if (!panel) return;
  const eligible = allBooks.filter(b => b.isHosted && !b.needsFix && b.file && b.cover && !b.isExternal);
  if (!eligible.length) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  const selected = !chooseAnother && eligible.find(b => b.id === featuredBookId);
  const pool = chooseAnother && eligible.length > 1 ? eligible.filter(b => b.id !== featuredBookId) : eligible;
  const book = selected || pool[Math.floor(Math.random() * pool.length)];
  featuredBookId = book.id;
  const intel = document.getElementById("top-book-intel");
  if (intel) intel.href = "book-analysis.html?book=" + encodeURIComponent(book.id);
  panel.style.setProperty("--featured-cover", "url(" + JSON.stringify(book.cover) + ")");
  document.getElementById('featured-book-title').textContent = book.title || 'Untitled book';
  document.getElementById('featured-book-author').textContent = book.author ? 'By ' + book.author : 'Author unknown';
  document.getElementById('featured-book-category').textContent = book.category || 'From the library';
  // Prefer a real catalog description. Never invent a plot summary when absent.
  let savedSummary = null;
  try {
    const twoLevels=JSON.parse(localStorage.getItem('athenaeum_summaries_v2_' + book.id) || 'null');
    savedSummary=twoLevels?.everyday?.text || null;
    if (!savedSummary) {
      const legacy=JSON.parse(localStorage.getItem('athenaeum_source_summary_' + book.id) || 'null');
      savedSummary=legacy?.summary || null;
    }
  } catch(e) {}
  document.getElementById('featured-book-description').textContent =
    book.summaries?.everyday || book.description ||
    (savedSummary ? 'Excerpt-based Everyday Summary: ' + savedSummary.slice(0, 360) + (savedSummary.length > 360 ? '…' : '') :
    'A '+(book.format || 'digital')+' edition from the '+(book.category || 'general')+' collection, credited to '+(book.author || 'an unverified author')+'. Read the book or open Book Intelligence to examine its contents and prepare a source-grounded summary.');
  const summaryLink = document.getElementById('featured-book-summary');
  if(summaryLink) summaryLink.href = 'book-analysis.html?book=' + encodeURIComponent(book.id);
  const cover = document.getElementById('featured-book-cover');
  cover.src = book.cover;
  cover.alt = 'Cover of ' + (book.title || 'featured book');
  document.getElementById('featured-book-read').href = 'reader.html?book=' + encodeURIComponent(book.file);
  document.getElementById('featured-book-read').textContent = 'Read book →';
}

document.addEventListener('DOMContentLoaded', () => {
  const next = document.getElementById('featured-book-next');
  if (next) next.addEventListener('click', () => renderFeaturedBook(true));
});

function fallbackBookCover(img) {
  if (!img || img.dataset.fallbackApplied) return;
  img.dataset.fallbackApplied = '1';
  const raw = (img.alt || 'Untitled Book').replace(/^Cover of /, '');
  // Break both ordinary words and old filename fragments without allowing
  // oversized strings to overflow the cover's book-frame.
  const title = raw.length > 78 ? raw.substring(0, 75) + '…' : raw;
  const words = title.split(/\s+/).flatMap(word => {
    const chunks=[];
    for (let i=0;i<word.length;i+=16) chunks.push(word.slice(i,i+16));
    return chunks;
  });
  const lines=[];
  let line='';
  for(const word of words){
    if ((line+' '+word).trim().length > 18 && line) {lines.push(line);line=word;}
    else line=(line+' '+word).trim();
  }
  if(line)lines.push(line);
  const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const seed = [...raw].reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,7);
  const palette = [['#14273c','#4b657c'],['#213b35','#67806a'],['#35293f','#856e9b'],['#503326','#ba7e4a']][seed % 4];
  const spans = lines.slice(0,6).map((l,i)=>'<tspan x="50%" dy="'+(i?30:0)+'">'+esc(l)+'</tspan>').join('');
  const y = 310 - (Math.min(lines.length,6)-1)*15;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="'+palette[0]+'"/><stop offset="1" stop-color="'+palette[1]+'"/></linearGradient></defs><rect width="400" height="600" fill="url(#g)"/><rect x="23" y="22" width="354" height="556" rx="2" fill="none" stroke="#eacda1" stroke-opacity=".65" stroke-width="2"/><path d="M80 120H320M80 490H320" stroke="#eacda1" stroke-opacity=".72" stroke-width="2"/><circle cx="200" cy="172" r="29" fill="none" stroke="#eacda1"/><path d="M180 172h40M200 152v40" stroke="#eacda1"/><text x="50%" y="'+y+'" text-anchor="middle" fill="#fff8e9" font-family="Georgia,serif" font-size="24" font-weight="700">'+spans+'</text><text x="50%" y="530" text-anchor="middle" fill="#eacda1" font-family="Georgia,serif" font-size="15" letter-spacing="3">ATHENAEUM</text></svg>';
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
window.fallbackBookCover = fallbackBookCover;

function initStats() {
  const hosted = allBooks.filter(b => b.isHosted && !b.needsFix && !b.isExternal);
  const available = allBooks.filter(b => b.isHosted && !b.needsFix);
  const catalogued = allBooks.filter(b => !b.needsFix || b.isArchiveRecord);
  const needsFix = allBooks.filter(b => !b.isArchiveRecord && (!b.isHosted || b.needsFix));

  const statBooks = document.getElementById('stat-total-books');
  const statAuthors = document.getElementById('stat-total-authors');
  const statCategories = document.getElementById('stat-total-categories');
  const countAll = document.getElementById('count-all');
  const countNeedsUpload = document.getElementById('count-needs-upload');

  if (statBooks) statBooks.textContent = catalogued.length;
  if (countAll) countAll.textContent = catalogued.length;
  if (countNeedsUpload) countNeedsUpload.textContent = needsFix.length;

  const authorsSet = new Set(catalogued.map(b => (b.author || '').trim()).filter(a => a && a !== 'Author not confirmed' && a !== 'Not verified'));
  if (statAuthors) statAuthors.textContent = authorsSet.size;

  const catSet = new Set(catalogued.map(b => b.category).filter(Boolean));
  if (statCategories) statCategories.textContent = catSet.size;
  const pills = document.getElementById('category-pills');
  if (pills) {
    const present = new Set([...pills.querySelectorAll('button[data-category]')].map(b => b.dataset.category));
    for (const category of [...catSet].sort()) {
      if (!present.has(category)) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'cat-pill';
        pill.dataset.category = category;
        pill.textContent = category;
        pills.appendChild(pill);
        present.add(category);
      }
    }
  }

  const originSummary = document.getElementById('contributor-category-counts');
  if (originSummary) {
    const sources = [['R','Original collection'],['A','Abdurrehman'],['N','Free sources']];
    const htmlEscape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    originSummary.innerHTML = sources.map(([mark,label]) => {
      const items = catalogued.filter(b => (b.originMark || 'R') === mark);
      const counts = new Map();
      for (const b of items) counts.set(b.category || 'Uncategorized',(counts.get(b.category || 'Uncategorized') || 0)+1);
      const chips = [...counts].sort((a,b)=>a[0].localeCompare(b[0])).map(([cat,n]) =>
        '<span style="white-space:nowrap;border:1px solid #ddd1bf;border-radius:16px;padding:3px 9px;font-size:11px;background:white">' + htmlEscape(cat) + ' · <b>' + n + '</b></span>').join('');
      return '<details style="margin:5px 0"><summary style="cursor:pointer;font-weight:600">' + mark + ' · ' + label + ': ' + items.length + ' records</summary><div style="display:flex;gap:5px;flex-wrap:wrap;padding:8px 0">' + chips + '</div></details>';
    }).join('');
  }
  updateFavoritesBadge();
}

function filterAndSortBooks() {
  const favs = getFavorites();

  return allBooks.filter(b => {
    if (currentOrigin !== 'all' && (['R','A','N'].includes(b.originMark) ? b.originMark : 'R') !== currentOrigin) return false;
    if (currentCategory === '__needs_upload__') {
      if (b.isArchiveRecord || (b.isHosted && !b.needsFix)) return false;
    } else {
      // Normal reading library: hide unhosted books
      if ((!b.isHosted && !b.isArchiveRecord) || b.needsFix) return false;
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
      const matchArchive = b.isArchiveRecord && (b.originArchiveEntry || '').toLowerCase().includes(q);
      if (!matchTitle && !matchAuthor && !matchCat && !matchArchive) {
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

let visibleBookLimit = 72;
let previousFilterSignature = '';
function renderBooks() {
  const grid = document.getElementById('books-grid');
  const emptyState = document.getElementById('empty-state');
  const visibleCount = document.getElementById('visible-count');
  if (!grid) return;

  const filtered = filterAndSortBooks();
  const signature = [currentCategory,currentOrigin,currentFormat,currentSort,searchQuery,showFavoritesOnly].join('|');
  if (signature !== previousFilterSignature) {visibleBookLimit = 72;previousFilterSignature = signature;}
  const loadMore = document.getElementById('btn-load-more-books');
  if (loadMore) {
    loadMore.hidden = filtered.length <= visibleBookLimit;
    loadMore.textContent = 'Show more (' + Math.max(0,filtered.length-visibleBookLimit) + ' remaining)';
  }
  if (visibleCount) visibleCount.textContent = filtered.length;

  if (filtered.length === 0) {
    grid.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  if (emptyState) emptyState.style.display = 'none';

  const favs = getFavorites();

  grid.innerHTML = filtered.slice(0, visibleBookLimit).map(b => {
    const isFav = favs.includes(b.id);
    const external = Boolean(b.isExternal && /^https:\/\/www\.gutenberg\.org\/ebooks\/\d+$/.test(b.externalUrl||''));
    const readUrl = b.isArchiveRecord ? `archive-book.html?id=${encodeURIComponent(b.id)}` : external ? `external-book.html?id=${encodeURIComponent(b.id)}` : (b.isHosted ? `reader.html?book=${encodeURIComponent(b.file)}` : '#');
    const isNeedsUpload = (!b.isHosted && !b.isArchiveRecord) || b.needsFix;
    const originMark=['R','A','N'].includes(b.originMark) ? b.originMark : 'R';
    const originInfo = originMark==='N'?'New free source (externally hosted)':originMark==='A'?'Abdurrehman contribution':'Existing original Athenaeum collection (attribution pending)';
    const contributorLabel = originMark==='A' ? 'Abdurrehman' : originMark==='N' ? 'Project Gutenberg' : 'Original collection · attribution pending';
    const originColor = originMark==='N'?'#155f5e':originMark==='A'?'#704a8f':'#6c4839';

    return `
      <article class="book-card ${isNeedsUpload ? 'card-needs-upload' : ''}" data-id="${b.id}">
        <div class="cover-wrapper">
          <img class="book-cover" src="${b.cover || 'data:,'}" alt="${escapeHtml(b.title)}" loading="lazy" onerror="fallbackBookCover(this)">
          <span class="origin-marker" title="${escapeHtml(originInfo)}" aria-label="Book origin: ${escapeHtml(originInfo)}" style="position:absolute;top:8px;left:8px;z-index:5;background:${originColor};color:#fff;border:2px solid #fff6;border-radius:50%;width:29px;height:29px;display:flex;align-items:center;justify-content:center;font:800 15px system-ui;box-shadow:0 2px 8px #0008;">${originMark}</span>
          ${isNeedsUpload ? `<span class="format-badge" style="background: #ea580c; left: 8px; right: auto; font-size: 10px; font-weight: 700;">⚠️ NEEDS FILE</span>` : ''}
          ${b.isArchiveRecord ? `<span class="format-badge" style="background:#704a8f;right:8px;top:37px" title="File is in Abdurrehman's supplied ZIP. Select the matching EPUB/PDF to read on this device">${b.recordType === 'book-format archive entry' ? 'FILE NEEDED' : 'DOCUMENT'}</span>` : ''}
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
          <div class="book-source" style="font-size:11px;color:#657287;margin:4px 0">
            <span title="${escapeHtml(b.isArchiveRecord ? ('Contributed by Abdurrehman · ' + b.originArchive) : contributorLabel)}" aria-label="Contributor: ${escapeHtml(contributorLabel)}">👤 ${escapeHtml(contributorLabel)}</span>
            ${b.isArchiveRecord ? `<span role="img" tabindex="0" title="${escapeHtml(b.description)}" aria-label="File details: ${escapeHtml(b.description)}" style="cursor:help;padding:3px 7px;border-radius:6px;border:1px solid #d7c8dc;color:#704a8f">ⓘ</span>` : ''}
          </div>

          <div class="card-actions" aria-label="Book actions">
            ${b.isArchiveRecord ? `
              <button type="button" class="btn-read" style="min-width:42px" onclick="openArchiveBook('${b.id}')" title="Open in Athenaeum reader (select matching EPUB or PDF if needed)" aria-label="Read ${escapeHtml(b.title)}">📖</button>
              <a href="archive-book.html?id=${encodeURIComponent(b.id)}" class="btn-card-edit" title="Book details, contributor and original file information" aria-label="View details for ${escapeHtml(b.title)}">ⓘ</a>
            ` : !isNeedsUpload ? `
              <a href="${readUrl}" class="btn-read" title="${external ? 'Open free-book details and reader' : 'Read in Athenaeum'}" aria-label="Read ${escapeHtml(b.title)}">📖</a>
            ` : `
              <button class="btn-read" onclick="triggerDirectFileUpload('${b.id}')" title="Select local EPUB/PDF to read" aria-label="Select file for ${escapeHtml(b.title)}">📂</button>
            `}
            <a href="book-notes.html?book=${encodeURIComponent(b.id)}" class="btn-card-edit" title="Personal notes" aria-label="Notes for ${escapeHtml(b.title)}">📝</a>
            ${external ? `<a href="${b.externalUrl}" target="_blank" rel="noopener noreferrer" class="btn-card-edit" title="Open official Project Gutenberg edition" aria-label="External book source">↗</a>` : !b.isArchiveRecord ? `<a href="book-analysis.html?book=${encodeURIComponent(b.id || b.file)}" class="btn-card-edit" title="Summary and Book Intelligence" aria-label="Book analysis">🧠</a>` : ''}
            <button class="btn-card-edit" onclick="openEditModal('${b.id}')" title="Edit book title, author or cover" aria-label="Edit book">✏️</button>
            <button class="btn-card-edit" onclick="openBookModal('${b.id}')" title="More book information" aria-label="More book information">⋯</button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  attachCardDragAndDrop();
}

/** Local reading of an A inventory title never publishes the source file to GitHub. */
window.openArchiveBook = async function (id) {
  const record = allBooks.find(b => b.id === id);
  if (!record || !record.isArchiveRecord) return;
  try {
    const saved = await window.AthenaeumDB.getUserBookById(id);
    if (saved && saved.fileData) {
      location.href = 'reader.html?book=' + encodeURIComponent('idb://' + id);
      return;
    }
  } catch (err) { console.warn('Local book lookup failed', err); }
  if (record.format === 'MOBI') {
    alert('This edition is MOBI. Convert a copy you are permitted to use to EPUB or PDF before opening it in Athenaeum.');
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.epub,application/pdf,application/epub+zip';
  input.addEventListener('change', async () => {
    const chosen = input.files?.[0];
    if (!chosen) return;
    const expected = (record.originArchiveEntry || '').split('/').pop().toLowerCase();
    const actual = chosen.name.toLowerCase();
    if (actual !== expected) {
      alert('Please select the matching file "' + expected + '" from Abdurrehman’s ZIP. Other files must not be assigned to this record.');
      return;
    }
    try {
      const imported = await window.BookManager.processAndAddBook(chosen);
      await window.AthenaeumDB.saveUserBook({
        ...imported, id:record.id, file:'idb://' + record.id,
        title:record.title, author:record.author, category:record.category,
        originMark:'A', originAttribution:record.originAttribution,
        originArchive:record.originArchive, originArchiveEntry:record.originArchiveEntry,
        isArchiveRecord:false, isHosted:true, needsFix:false,
        isUserAdded:true, summaryStatus:'awaiting_source_analysis'
      });
      await window.AthenaeumDB.deleteUserBook(imported.id);
      location.href = 'reader.html?book=' + encodeURIComponent('idb://' + record.id);
    } catch (err) {
      alert('Unable to save book locally: ' + (err.message || err));
    }
  }, {once:true});
  input.click();
};

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
  document.getElementById('info-cover').src = book.cover || 'data:,';
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

  if (book.isArchiveRecord) {
    readBtn.href = '#';
    readBtn.textContent = '📖 Open in reader';
    readBtn.onclick = event => {event.preventDefault();modal.classList.remove('active');window.openArchiveBook(book.id);};
    readBtn.style.display = 'inline-flex';
  } else if (book.isExternal) {
    readBtn.href = 'external-book.html?id=' + encodeURIComponent(book.id);
    readBtn.textContent = 'Free book details';
    readBtn.onclick = null;
    readBtn.style.display = 'inline-flex';
  } else if (book.isHosted) {
    readBtn.onclick = null;
    readBtn.href = `reader.html?book=${encodeURIComponent(book.file)}`;
    readBtn.style.display = 'inline-flex';
  } else {
    readBtn.href = '#';
    readBtn.onclick = () => {
      modal.classList.remove('active');
      openLocalPrompt(book.id);
    };
  }

  const analysisBtn = document.getElementById('info-analysis-link');
  if (analysisBtn) {
    analysisBtn.href = book.isArchiveRecord ? `archive-book.html?id=${encodeURIComponent(book.id)}` : `book-analysis.html?book=${encodeURIComponent(book.id || book.file)}`;
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

  const moreButton = document.getElementById('btn-load-more-books');
  if (moreButton) moreButton.addEventListener('click', () => {
    visibleBookLimit += 72;
    renderBooks();
  });

  // Missing files is a utility, not a book genre.
  const missingFilesButton = document.getElementById('pill-needs-upload');
  if (missingFilesButton) missingFilesButton.addEventListener('click', () => {
    currentCategory = currentCategory === '__needs_upload__' ? 'all' : '__needs_upload__';
    document.querySelectorAll('#category-pills .cat-pill').forEach(p => p.classList.toggle('active',p.dataset.category === currentCategory));
    missingFilesButton.setAttribute('aria-pressed',String(currentCategory === '__needs_upload__'));
    renderBooks();
  });

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

    // Call backend API to delete from server books.json permanently
    try {
      await fetch('/api/delete-book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookId })
      });
    } catch (apiErr) {
      console.warn('Backend delete notification non-fatal error:', apiErr);
    }

    // Save override with deleted flag and sync
    await window.AthenaeumDB.saveBookOverride(bookId, { deleted: true });

    if (window.AthenaeumSync) {
      window.AthenaeumSync.broadcastBookOverride(bookId, { deleted: true });
      window.AthenaeumSync.performFullSync().catch(() => {});
    }

    // Immediately remove from allBooks array in memory
    allBooks = allBooks.filter(b => b.id !== bookId);

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

function normalizeTitleForDupe(value) {
  // Preserve parentheses and edition/language markers. Never conflate distinct
  // translations or versions just because the generic work title is shared.
  return String(value || '').normalize('NFKD').toLowerCase()
    .replace(/[\u0300-\u036f]/g, '').replace(/\(pdfdrive\)/g, '')
    .replace(/[_]+/g,' ').replace(/[^a-z0-9\s()\-]/g,' ')
    .replace(/\s+/g,' ').trim();
}

function detectLibraryDuplicates() {
  const groups = new Map();
  for (const b of allBooks) {
    // Archive file identity is stronger than filename/title; separate language,
    // format, edition and individual file provenance when available.
    const titleKey = normalizeTitleForDupe(b.title);
    if (!titleKey || titleKey.length < 3) continue;
    const translation = b.originArchiveEntry?.match(/UDHR_Translations\/([^/]+)\.pdf$/i);
    const identity = translation ? 'udhr:' + translation[1].toLowerCase()
      : b.isArchiveRecord && b.originArchiveEntry ? 'archive-title:' + titleKey + ':' + b.format
      : 'book-title:' + titleKey + ':' + (b.author || '').toLowerCase().trim();
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(b);
  }
  return [...groups.entries()].filter(([,items]) => items.length > 1)
    .map(([key,items]) => ({key,title:items[0].title,items}));
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



/** Contributor filters use recorded catalog provenance; absent attribution remains provisional R. */
function initOriginTabs() {
  const nav = document.getElementById('origin-tabs');
  if (!nav) return;
  nav.addEventListener('click', event => {
    const button = event.target.closest('button[data-origin]');
    if (!button || !nav.contains(button)) return;
    currentOrigin = button.dataset.origin;
    nav.querySelectorAll('button[data-origin]').forEach(b => {
      const active = b.dataset.origin === currentOrigin;
      b.setAttribute('aria-pressed', String(active));
      b.style.background = active ? '#1b3048' : '#fff';
      b.style.color = active ? '#fff' : '#1b3048';
    });
    renderBooks();
  });
  nav.querySelector('button[data-origin="all"]')?.click();
}
document.addEventListener('DOMContentLoaded', initOriginTabs);
