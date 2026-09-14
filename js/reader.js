/**
 * Athenaeum - Enhanced Unified Reader Engine
 * - Robust ArrayBuffer preloading & error diagnostics
 * - Realistic 3D page-turning animation
 * - 6 Authentic Paper finishes (Crisp White, Cream Novel, Sepia, Parchment, Newsprint, Charcoal)
 * - Custom typography & margin controls
 * - IndexedDB book loader for user-added books
 */

if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
}

let currentBook = null;
let currentRendition = null;
let currentFormat = null;
let pdfDoc = null;
let pdfCurrentPage = 1;
let pdfScale = 1.25;

// User Preferences
let readerPrefs = {
  paper: localStorage.getItem('athenaeum_paper') || 'cream',
  fontFamily: localStorage.getItem('athenaeum_font') || 'Merriweather, Georgia, serif',
  fontSize: parseInt(localStorage.getItem('athenaeum_font_size') || '100', 10),
  margin: localStorage.getItem('athenaeum_margin') || '40px',
  mode: localStorage.getItem('athenaeum_reading_mode') || 'scroll', // Default to Vertical Scroll Down
  textAlign: localStorage.getItem('athenaeum_text_align') || 'left' // Natural spacing, prevents awkward word gaps
};

const urlParams = new URLSearchParams(window.location.search);
const bookUrl = urlParams.get('book');
const isLocal = urlParams.get('local');
const blobUrl = urlParams.get('blob');
const bookTitleParam = urlParams.get('title');
let currentBookIdentifier = bookUrl || blobUrl || bookTitleParam || 'book_default';

document.addEventListener('DOMContentLoaded', async () => {
  applyPaperTheme(readerPrefs.paper);
  applyReadingMode(readerPrefs.mode);
  setupMenuControls();
  setupNavControls();

  if (isLocal) {
    loadLocalSessionBook();
  } else if (blobUrl) {
    await loadBufferAndInit(blobUrl, bookTitleParam || 'Local Book');
  } else if (bookUrl) {
    await loadFromCatalogOrDB(bookUrl);
  } else {
    showError('No book specified to open. Return to library to choose a book.');
  }
});

async function loadFromCatalogOrDB(url) {
  // Check if it is an IndexedDB user book
  if (url.startsWith('idb://')) {
    const bookId = url.replace('idb://', '');
    try {
      updateLoaderStatus('Loading book from local storage...');
      const userBook = await window.AthenaeumDB.getUserBookById(bookId);
      if (userBook && userBook.fileData) {
        document.getElementById('reader-book-title').textContent = userBook.title;
        document.getElementById('reader-book-author').textContent = `by ${userBook.author}`;
        document.title = `${userBook.title} - Athenaeum Reader`;
        initReaderWithBuffer(userBook.fileData, userBook.format.toLowerCase(), userBook.title);
        return;
      }
    } catch (e) {
      console.warn('Error loading from IndexedDB:', e);
    }
  }

  // Load catalog metadata for title display
  try {
    const resp = await fetch('data/books.json');
    if (resp.ok) {
      const books = await resp.json();
      const match = books.find(b => b.file === url);
      if (match) {
        currentBookIdentifier = match.id || match.file;
        document.getElementById('reader-book-title').textContent = match.title;
        document.getElementById('reader-book-author').textContent = match.author ? `by ${match.author}` : '';
        document.title = `${match.title} - Athenaeum Reader`;
      }
    }
  } catch (e) {}

  const ext = url.split('.').pop().toLowerCase();
  await loadBufferAndInit(url, ext);
}

function loadLocalSessionBook() {
  const fileName = sessionStorage.getItem('athenaeum_local_file_name') || 'Local Book';
  const fileData = sessionStorage.getItem('athenaeum_local_file_data');

  if (!fileData) {
    showError('Could not load local file data. Please select the file again from library.');
    return;
  }

  document.getElementById('reader-book-title').textContent = fileName;
  document.title = `${fileName} - Athenaeum Reader`;

  const ext = fileName.split('.').pop().toLowerCase();
  // Base64 to ArrayBuffer
  try {
    const base64 = fileData.split(',')[1] || fileData;
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    initReaderWithBuffer(bytes.buffer, ext, fileName);
  } catch (err) {
    showError('Failed to parse local book data: ' + err.message);
  }
}

async function loadBufferAndInit(url, ext) {
  try {
    updateLoaderStatus('Preloading book into memory...');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: Failed to download book file`);

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

    let buffer;
    if (response.body && totalBytes > 0) {
      const reader = response.body.getReader();
      let receivedBytes = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedBytes += value.length;
        const pct = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
        const mb = (receivedBytes / (1024 * 1024)).toFixed(1);
        const totalMb = (totalBytes / (1024 * 1024)).toFixed(1);
        updateLoaderStatus(`Downloading ${pct}% (${mb} MB / ${totalMb} MB)...`);
      }

      const allChunks = new Uint8Array(receivedBytes);
      let position = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
      }
      buffer = allChunks.buffer;
    } else {
      buffer = await response.arrayBuffer();
    }

    updateLoaderStatus('Rendering pages...');
    initReaderWithBuffer(buffer, ext, url);

  } catch (err) {
    showError(`Error loading book: ${err.message}. Please check your connection.`);
  }
}

function initReaderWithBuffer(buffer, ext, identifier) {
  currentBookIdentifier = identifier || currentBookIdentifier;
  const isPdf = ext.includes('pdf');
  const stage = document.getElementById('book-stage');
  if (stage) {
    attachTouchAndTapNavigation(stage);
  }

  if (isPdf) {
    currentFormat = 'pdf';
    document.getElementById('pdf-controls').style.display = 'flex';
    document.getElementById('epub-viewer').style.display = 'none';
    document.getElementById('pdf-viewer-container').style.display = 'flex';
    initPdfReaderWithBuffer(buffer, currentBookIdentifier);
  } else {
    currentFormat = 'epub';
    document.getElementById('pdf-controls').style.display = 'none';
    document.getElementById('epub-viewer').style.display = 'block';
    document.getElementById('pdf-viewer-container').style.display = 'none';
    initEpubReaderWithBuffer(buffer, currentBookIdentifier);
  }
}

/**
 * Reading Mode Engine: Vertical Continuous Scroll vs Paginated Turn
 */
function applyReadingMode(mode) {
  readerPrefs.mode = mode;
  localStorage.setItem('athenaeum_reading_mode', mode);

  document.body.classList.toggle('mode-scroll', mode === 'scroll');
  document.body.classList.toggle('mode-paginated', mode === 'paginated');

  const modeIcon = document.getElementById('mode-icon');
  const modeText = document.getElementById('mode-text');
  const modeSelect = document.getElementById('reading-mode-select');

  if (mode === 'scroll') {
    if (modeIcon) modeIcon.textContent = '📜';
    if (modeText) modeText.textContent = 'Scroll Down';
    if (modeSelect) modeSelect.value = 'scroll';
  } else {
    if (modeIcon) modeIcon.textContent = '📖';
    if (modeText) modeText.textContent = 'Page Turn';
    if (modeSelect) modeSelect.value = 'paginated';
  }
}

function toggleReadingMode(forcedMode) {
  const targetMode = forcedMode || (readerPrefs.mode === 'scroll' ? 'paginated' : 'scroll');
  applyReadingMode(targetMode);

  if (currentFormat === 'epub' && currentBook) {
    setupEpubRendition();
  } else if (currentFormat === 'pdf' && pdfDoc) {
    if (targetMode === 'scroll') {
      renderPdfScrollMode();
    } else {
      renderPdfPaginatedMode(pdfCurrentPage);
    }
  }
}

/**
 * EPUB Engine (with Memory Buffer)
 */
function initEpubReaderWithBuffer(buffer, identifier) {
  try {
    currentBook = ePub(buffer);
    setupEpubRendition();

    // TOC Navigation
    currentBook.loaded.navigation.then((nav) => {
      const tocList = document.getElementById('toc-list');
      if (nav && nav.toc && nav.toc.length > 0) {
        tocList.innerHTML = nav.toc.map(item => `
          <a class="toc-item" data-href="${item.href}">${escapeHtml(item.label.trim())}</a>
        `).join('');

        tocList.querySelectorAll('.toc-item').forEach(el => {
          el.addEventListener('click', () => {
            if (currentRendition) {
              currentRendition.display(el.dataset.href);
            }
            toggleSidebar(false);
          });
        });
      }
    });
  } catch (err) {
    showError('Error initializing EPUB reader: ' + err.message);
  }
}

function setupEpubRendition() {
  if (!currentBook) return;
  const viewer = document.getElementById('epub-viewer');
  if (!viewer) return;

  if (currentRendition) {
    try { currentRendition.destroy(); } catch (e) {}
  }
  viewer.innerHTML = '';

  const isMobile = window.innerWidth <= 768;
  const isScroll = readerPrefs.mode === 'scroll';

  currentRendition = currentBook.renderTo('epub-viewer', {
    width: '100%',
    height: '100%',
    flow: isScroll ? 'scrolled-doc' : 'paginated',
    manager: isScroll ? 'continuous' : 'default',
    spread: (isMobile || isScroll) ? 'none' : 'auto'
  });

  // Dynamic OCR clean-up filter & touch swipe inside iframe
  currentRendition.hooks.content.register((contents) => {
    try {
      if (contents && contents.document) {
        if (contents.document.body) {
          cleanRenderedOcrArtifacts(contents.document.body);
        }
        attachTouchAndTapNavigation(contents.document);
      }
    } catch (hookErr) {
      console.warn('Content hook non-fatal error:', hookErr);
    }
  });

  // Apply paper theme styles
  applyCurrentStylesToRendition();

  // Safety timer: under NO circumstances should the reader stay locked on "Opening Book..."
  const loaderSafetyTimer = setTimeout(() => {
    hideLoader();
  }, 3500);

  const onDisplaySuccess = () => {
    clearTimeout(loaderSafetyTimer);
    hideLoader();
    applyCurrentStylesToRendition();
    try {
      checkAndPromptCrossDeviceResume(currentBookIdentifier, 'epub');
    } catch (e) {
      console.warn('Cross device resume check warning:', e);
    }
  };

  // Restore saved reading position
  const savedCfi = localStorage.getItem(`athenaeum_pos_${currentBookIdentifier}`);
  const displayPromise = savedCfi ? currentRendition.display(savedCfi) : currentRendition.display();

  displayPromise.then(onDisplaySuccess).catch((displayErr) => {
    console.warn('Initial display error, resetting position and falling back to default:', displayErr);
    // In case the saved CFI was from an older version of the book file
    localStorage.removeItem(`athenaeum_pos_${currentBookIdentifier}`);
    currentRendition.display().then(onDisplaySuccess).catch(e => {
      clearTimeout(loaderSafetyTimer);
      hideLoader();
      showError('EPUB render error: ' + e.message);
    });
  });

  // Tracking position & progress
  currentRendition.on('rendered', () => {
    clearTimeout(loaderSafetyTimer);
    hideLoader();
  });

  currentRendition.on('relocated', (location) => {
    clearTimeout(loaderSafetyTimer);
    hideLoader();
    if (location && location.start) {
      localStorage.setItem(`athenaeum_pos_${currentBookIdentifier}`, location.start.cfi);
      const pct = location.start.percentage ? Math.round(location.start.percentage * 100) : 0;
      if (location.start.percentage) {
        document.getElementById('reader-percentage').textContent = `${pct}%`;
        document.getElementById('progress-bar-fill').style.width = `${pct}%`;
      }
      const pageNum = (location.start.displayed && location.start.displayed.page) ? location.start.displayed.page : null;
      if (pageNum) {
        document.getElementById('reader-progress-text').textContent = `Page ${pageNum}`;
      }
      // Save to Cross-Device Sync Engine
      if (window.AthenaeumSync) {
        const titleEl = document.getElementById('reader-book-title');
        window.AthenaeumSync.saveReadingProgress({
          bookId: currentBookIdentifier,
          bookTitle: titleEl ? titleEl.textContent : 'Book',
          cfi: location.start.cfi,
          page: pageNum || 1,
          percentage: pct,
          format: 'epub'
        });
      }
    }
  });
}

/**
 * Cross-Device Reading Position Sync Prompt
 */
async function checkAndPromptCrossDeviceResume(bookId, format) {
  if (!window.AthenaeumSync) return;
  try {
    const remote = await window.AthenaeumSync.getLatestCrossDeviceProgress(bookId);
    if (!remote || !remote.percentage) return;

    const localPct = parseInt(localStorage.getItem(`athenaeum_pct_${bookId}`) || '0', 10);
    if (remote.percentage > localPct && remote.percentage > 1) {
      if (document.getElementById('sync-resume-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'sync-resume-banner';
      banner.style.cssText = 'position: fixed; top: 68px; left: 50%; transform: translateX(-50%); z-index: 100; background: #0f172a; color: white; padding: 10px 18px; border-radius: 30px; display: flex; align-items: center; gap: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); font-family: sans-serif; font-size: 13px;';
      banner.innerHTML = `
        <span>📱 Resume reading from another device: <strong>${remote.percentage}%</strong></span>
        <button id="btn-sync-jump" style="background: #3b82f6; color: white; border: none; padding: 4px 12px; border-radius: 16px; cursor: pointer; font-size: 12px; font-weight: 600;">Jump</button>
        <button id="btn-sync-dismiss" style="background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 16px; line-height: 1;">&times;</button>
      `;
      document.body.appendChild(banner);

      document.getElementById('btn-sync-jump')?.addEventListener('click', () => {
        if (format === 'epub' && currentRendition && remote.cfi) {
          currentRendition.display(remote.cfi);
        } else if (format === 'pdf' && remote.page) {
          jumpToPdfPage(remote.page);
        }
        banner.remove();
      });
      document.getElementById('btn-sync-dismiss')?.addEventListener('click', () => banner.remove());
      setTimeout(() => banner.remove(), 12000);
    }
  } catch (e) {
    console.warn('Sync resume prompt check error:', e);
  }
}

/**
 * PDF Engine (Supports Continuous Vertical Scroll and Paginated Modes)
 */
let pdfObserver = null;

async function initPdfReaderWithBuffer(buffer, identifier) {
  try {
    currentBookIdentifier = identifier || currentBookIdentifier;
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    pdfDoc = await loadingTask.promise;
    hideLoader();

    // Restore saved page
    const savedPage = parseInt(localStorage.getItem(`athenaeum_pos_${currentBookIdentifier}`) || '1', 10);
    if (savedPage && savedPage >= 1 && savedPage <= pdfDoc.numPages) {
      pdfCurrentPage = savedPage;
    }

    if (readerPrefs.mode === 'scroll') {
      renderPdfScrollMode();
    } else {
      renderPdfPaginatedMode(pdfCurrentPage);
    }

    checkAndPromptCrossDeviceResume(currentBookIdentifier, 'pdf');

    // Outline / TOC
    try {
      const outline = await pdfDoc.getOutline();
      const tocList = document.getElementById('toc-list');
      if (outline && outline.length > 0) {
        tocList.innerHTML = outline.map(item => `
          <a class="toc-item" data-dest="${escapeHtml(JSON.stringify(item.dest))}">${escapeHtml(item.title)}</a>
        `).join('');
      } else {
        let pagesHtml = '';
        for (let i = 1; i <= Math.min(pdfDoc.numPages, 100); i++) {
          pagesHtml += `<a class="toc-item" onclick="jumpToPdfPage(${i})">Page ${i}</a>`;
        }
        tocList.innerHTML = pagesHtml;
      }
    } catch (e) {}

  } catch (err) {
    showError('Error initializing PDF reader: ' + err.message);
  }
}

/**
 * Continuous Vertical Scroll Mode for PDF
 */
function renderPdfScrollMode() {
  const container = document.getElementById('pdf-viewer-container');
  if (!container || !pdfDoc) return;
  if (pdfObserver) {
    pdfObserver.disconnect();
  }

  container.innerHTML = '';
  container.style.display = 'flex';

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const slot = document.createElement('div');
    slot.className = 'pdf-page-slot';
    slot.id = `pdf-page-slot-${i}`;
    slot.dataset.page = i;
    slot.style.minHeight = '500px';

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.id = `pdf-canvas-${i}`;
    slot.appendChild(canvas);
    container.appendChild(slot);
  }

  pdfObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        renderPdfPageInSlot(pageNum);
        updatePdfProgress(pageNum);
      }
    });
  }, {
    root: container,
    rootMargin: '600px 0px 600px 0px'
  });

  document.querySelectorAll('.pdf-page-slot').forEach(slot => {
    pdfObserver.observe(slot);
  });

  // Jump to saved page
  if (pdfCurrentPage > 1) {
    setTimeout(() => {
      const targetSlot = document.getElementById(`pdf-page-slot-${pdfCurrentPage}`);
      if (targetSlot) {
        targetSlot.scrollIntoView({ behavior: 'auto', block: 'start' });
      }
      renderPdfPageInSlot(pdfCurrentPage);
    }, 100);
  } else {
    renderPdfPageInSlot(1);
    updatePdfProgress(1);
  }
}

async function renderPdfPageInSlot(num) {
  if (!pdfDoc || num < 1 || num > pdfDoc.numPages) return;
  const canvas = document.getElementById(`pdf-canvas-${num}`);
  if (!canvas || canvas.dataset.rendered === 'true') return;
  canvas.dataset.rendered = 'true';

  try {
    const page = await pdfDoc.getPage(num);
    const ctx = canvas.getContext('2d');
    const container = document.getElementById('pdf-viewer-container');
    const availWidth = (container ? container.clientWidth : window.innerWidth) - 32;
    const baseViewport = page.getViewport({ scale: 1.0 });
    let effectiveScale = pdfScale;
    if (baseViewport.width > availWidth && availWidth > 200) {
      effectiveScale = (availWidth / baseViewport.width) * pdfScale;
    }

    const viewport = page.getViewport({ scale: effectiveScale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const slot = document.getElementById(`pdf-page-slot-${num}`);
    if (slot) slot.style.minHeight = `${viewport.height}px`;

    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (e) {
    console.error(`PDF slot render error on page ${num}:`, e);
  }
}

function updatePdfProgress(num) {
  pdfCurrentPage = num;
  document.getElementById('reader-progress-text').textContent = `Page ${num} of ${pdfDoc.numPages}`;
  const pct = Math.round((num / pdfDoc.numPages) * 100);
  document.getElementById('reader-percentage').textContent = `${pct}%`;
  document.getElementById('progress-bar-fill').style.width = `${pct}%`;

  localStorage.setItem(`athenaeum_pos_${currentBookIdentifier}`, num);

  if (window.AthenaeumSync && currentBookIdentifier) {
    const titleEl = document.getElementById('reader-book-title');
    window.AthenaeumSync.saveReadingProgress({
      bookId: currentBookIdentifier,
      bookTitle: titleEl ? titleEl.textContent : 'Book',
      page: num,
      percentage: pct,
      format: 'pdf'
    });
  }
}

/**
 * Paginated Mode for PDF
 */
function renderPdfPaginatedMode(num) {
  const container = document.getElementById('pdf-viewer-container');
  if (!container || !pdfDoc) return;
  if (pdfObserver) {
    pdfObserver.disconnect();
  }

  container.innerHTML = '<canvas id="pdf-canvas" class="pdf-page-canvas"></canvas>';
  renderPdfPage(num);
}

async function renderPdfPage(num) {
  if (!pdfDoc) return;
  try {
    const page = await pdfDoc.getPage(num);
    const canvas = document.getElementById('pdf-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const container = document.getElementById('pdf-viewer-container');
    const availWidth = (container ? container.clientWidth : window.innerWidth) - 32;
    const baseViewport = page.getViewport({ scale: 1.0 });
    let effectiveScale = pdfScale;
    if (baseViewport.width > availWidth && availWidth > 200) {
      effectiveScale = (availWidth / baseViewport.width) * pdfScale;
    }

    const viewport = page.getViewport({ scale: effectiveScale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport }).promise;
    updatePdfProgress(num);
  } catch (e) {
    console.error('PDF render error:', e);
  }
}

window.jumpToPdfPage = function(num) {
  if (num >= 1 && num <= pdfDoc.numPages) {
    pdfCurrentPage = num;
    if (readerPrefs.mode === 'scroll') {
      const slot = document.getElementById(`pdf-page-slot-${num}`);
      if (slot) {
        slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
        renderPdfPageInSlot(num);
      }
    } else {
      renderPdfPage(num);
    }
    toggleSidebar(false);
  }
};

/**
 * Clean & Fast Reading Flow: Vertical Scroll Down or Simple Page Turn
 */
function turnPage(direction) {
  advanceReaderPage(direction);
}

function advanceReaderPage(direction) {
  if (readerPrefs.mode === 'scroll') {
    // Scroll down or up smoothly by 80% of window height
    const scrollAmount = window.innerHeight * 0.82;
    if (currentFormat === 'epub') {
      const viewer = document.getElementById('epub-viewer');
      if (viewer) {
        viewer.scrollBy({ top: direction === 'next' ? scrollAmount : -scrollAmount, behavior: 'smooth' });
      }
    } else if (currentFormat === 'pdf') {
      const container = document.getElementById('pdf-viewer-container');
      if (container) {
        container.scrollBy({ top: direction === 'next' ? scrollAmount : -scrollAmount, behavior: 'smooth' });
      }
    }
    return;
  }

  // Paginated mode
  if (currentFormat === 'epub' && currentRendition) {
    if (direction === 'next') {
      currentRendition.next();
    } else {
      currentRendition.prev();
    }
  } else if (currentFormat === 'pdf' && pdfDoc) {
    if (direction === 'next' && pdfCurrentPage < pdfDoc.numPages) {
      pdfCurrentPage++;
      renderPdfPage(pdfCurrentPage);
    } else if (direction === 'prev' && pdfCurrentPage > 1) {
      pdfCurrentPage--;
      renderPdfPage(pdfCurrentPage);
    }
  }
}

/**
 * Paper Types & Typography Customization
 */
function applyPaperTheme(paperType) {
  readerPrefs.paper = paperType;
  localStorage.setItem('athenaeum_paper', paperType);
  document.body.setAttribute('data-paper', paperType);

  document.querySelectorAll('.paper-option-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.paper === paperType);
  });

  applyCurrentStylesToRendition();
}

function applyCurrentStylesToRendition() {
  if (!currentRendition) return;

  const paperColors = {
    white: { bg: '#ffffff', text: '#111827' },
    cream: { bg: '#faf6ee', text: '#2c2523' },
    sepia: { bg: '#fbf0d9', text: '#5f4b32' },
    parchment: { bg: '#f5efe6', text: '#3d352e' },
    newsprint: { bg: '#ebe6dd', text: '#262626' },
    charcoal: { bg: '#18181b', text: '#e2e8f0' }
  };

  const colors = paperColors[readerPrefs.paper] || paperColors.cream;
  const isMobile = window.innerWidth <= 768;
  const effectiveMargin = isMobile ? (readerPrefs.margin === '60px' ? '20px' : '10px') : readerPrefs.margin;
  const effectiveLineHeight = isMobile ? '1.55 !important' : '1.65 !important';
  const textAlign = readerPrefs.textAlign === 'justify' ? 'justify' : 'left';

  try {
    currentRendition.themes.default({
      body: {
        background: `${colors.bg} !important`,
        color: `${colors.text} !important`,
        'font-family': `${readerPrefs.fontFamily} !important`,
        padding: `0 ${effectiveMargin} !important`,
        'line-height': effectiveLineHeight,
        'text-align': `${textAlign} !important`,
        'text-align-last': 'left !important',
        'text-justify': 'inter-word !important',
        'word-spacing': 'normal !important',
        'letter-spacing': 'normal !important',
        'word-break': 'normal !important',
        'overflow-wrap': 'break-word !important',
        'word-wrap': 'break-word !important',
        '-webkit-hyphens': 'auto !important',
        'hyphens': 'auto !important'
      },
      p: {
        'font-family': `${readerPrefs.fontFamily} !important`,
        'line-height': effectiveLineHeight,
        'text-align': `${textAlign} !important`,
        'text-align-last': 'left !important',
        'word-spacing': 'normal !important',
        'letter-spacing': 'normal !important',
        'word-break': 'normal !important',
        'overflow-wrap': 'break-word !important',
        'word-wrap': 'break-word !important'
      },
      'span, a, em, strong, i, b, font': {
        'letter-spacing': 'normal !important',
        'word-break': 'normal !important',
        'overflow-wrap': 'break-word !important'
      }
    });
    currentRendition.themes.fontSize(`${readerPrefs.fontSize}%`);
  } catch (e) {
    console.warn('Theme apply warning:', e);
  }
}

/**
 * Dynamic OCR & Layout Artifacts Cleanup Filter (Runtime Layer)
 * Repairs split words, internal gaps, soft-hyphens, spaced punctuation, and line-chopped text
 */
function cleanRenderedOcrArtifacts(rootNode) {
  if (!rootNode) return;
  try {
    const doc = rootNode.ownerDocument || (rootNode.getRootNode && rootNode.getRootNode()) || document;
    if (!doc || typeof doc.createTreeWalker !== 'function') return;

    // 1. Walk and clean text nodes
    const walker = doc.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const textNodes = [];
  while ((node = walker.nextNode())) {
    textNodes.push(node);
  }

  for (const textNode of textNodes) {
    let val = textNode.nodeValue;
    if (!val || val.trim().length === 0) continue;

    const original = val;

    // A. Strip soft hyphens, zero-width spaces, and control characters that cause artificial gaps
    val = val.replace(/[\u00AD\u200B\u200C\u200D\uFEFF]/g, '');

    // B. Normalize non-breaking spaces and collapse duplicate spaces / tabs
    val = val.replace(/\u00A0/g, ' ');
    val = val.replace(/[ \t]{2,}/g, ' ');

    // C. Fix punctuation separated by whitespace (e.g. "are you ?" -> "are you?", "hello , how" -> "hello, how")
    // This prevents punctuation like '?' wrapping onto its own line alone!
    val = val.replace(/\s+([,.:;?!'’"”\)\]\}])/g, '$1');

    // D. Fix space after opening quotes or brackets (e.g. "( hello" -> "(hello")
    val = val.replace(/([‘“\(\[\{])\s+/g, '$1');

    // E. Fix split contractions: e.g. "don 't" -> "don't", "I 'm" -> "I'm", "they 'll" -> "they'll"
    val = val.replace(/\b([A-Za-z]+)\s+(['’][stdm]|['’]ll|['’]re|['’]ve)\b/g, '$1$2');

    // F. Fix split possessives: e.g. "world 's" -> "world's"
    val = val.replace(/\b([A-Za-z]+)\s+['’]s\b/g, "$1's");

    // G. Suffix stitching: when OCR splits word and suffix (e.g. "read ing" -> "reading", "popula tion" -> "population")
    val = val.replace(/\b([a-zA-Z]{3,})\s+(ing|tion|tions|ment|ments|ly|able|ness|ful|fully|less|lessly)\b/g, '$1$2');

    // H. High-frequency OCR split words dictionary
    val = val.replace(/\bthe\s+se\b/gi, (m) => m[0] === 'T' ? 'These' : 'these');
    val = val.replace(/\bba\s+ck\b/gi, (m) => m[0] === 'B' ? 'Back' : 'back');
    val = val.replace(/\bsha\s+ll\b/gi, (m) => m[0] === 'S' ? 'Shall' : 'shall');
    val = val.replace(/\bbe\s+ing\b/gi, (m) => m[0] === 'B' ? 'Being' : 'being');
    val = val.replace(/\bwe\s+ll\b/gi, (m) => m[0] === 'W' ? 'Well' : 'well');
    val = val.replace(/\bwe\s+nt\b/gi, (m) => m[0] === 'W' ? 'Went' : 'went');
    val = val.replace(/\bta\s+ll\b/gi, (m) => m[0] === 'T' ? 'Tall' : 'tall');
    val = val.replace(/\bthe\s+re\b/gi, (m) => m[0] === 'T' ? 'There' : 'there');
    val = val.replace(/\bwi\s+th\b/gi, (m) => m[0] === 'W' ? 'With' : 'with');
    val = val.replace(/\bwhi\s+ch\b/gi, (m) => m[0] === 'W' ? 'Which' : 'which');
    val = val.replace(/\bwha\s+t\b/gi, (m) => m[0] === 'W' ? 'What' : 'what');
    val = val.replace(/\bwhe\s+re\b/gi, (m) => m[0] === 'W' ? 'Where' : 'where');
    val = val.replace(/\bwhe\s+n\b/gi, (m) => m[0] === 'W' ? 'When' : 'when');
    val = val.replace(/\bha\s+ve\b/gi, (m) => m[0] === 'H' ? 'Have' : 'have');
    val = val.replace(/\bha\s+d\b/gi, (m) => m[0] === 'H' ? 'Had' : 'had');
    val = val.replace(/\bha\s+s\b/gi, (m) => m[0] === 'H' ? 'Has' : 'has');
    val = val.replace(/\bcou\s+ld\b/gi, (m) => m[0] === 'C' ? 'Could' : 'could');
    val = val.replace(/\bwou\s+ld\b/gi, (m) => m[0] === 'W' ? 'Would' : 'would');
    val = val.replace(/\bshou\s+ld\b/gi, (m) => m[0] === 'S' ? 'Should' : 'should');
    val = val.replace(/\babo\s+ut\b/gi, (m) => m[0] === 'A' ? 'About' : 'about');
    val = val.replace(/\bbe\s+fore\b/gi, (m) => m[0] === 'B' ? 'Before' : 'before');
    val = val.replace(/\baft\s+er\b/gi, (m) => m[0] === 'A' ? 'After' : 'after');
    val = val.replace(/\bag\s+ain\b/gi, (m) => m[0] === 'A' ? 'Again' : 'again');
    val = val.replace(/\bne\s+ver\b/gi, (m) => m[0] === 'N' ? 'Never' : 'never');
    val = val.replace(/\bal\s+ways\b/gi, (m) => m[0] === 'A' ? 'Always' : 'always');
    val = val.replace(/\bpe\s+ople\b/gi, (m) => m[0] === 'P' ? 'People' : 'people');
    val = val.replace(/\bthi\s+ng\b/gi, (m) => m[0] === 'T' ? 'Thing' : 'thing');
    val = val.replace(/\bthi\s+ngs\b/gi, (m) => m[0] === 'T' ? 'Things' : 'things');
    val = val.replace(/\blitt\s+le\b/gi, (m) => m[0] === 'L' ? 'Little' : 'little');
    val = val.replace(/\bne\s+w\b/gi, (m) => m[0] === 'N' ? 'New' : 'new');
    val = val.replace(/\bove\s+r\b/gi, (m) => m[0] === 'O' ? 'Over' : 'over');
    val = val.replace(/\bsta\s+te\b/gi, (m) => m[0] === 'S' ? 'State' : 'state');
    val = val.replace(/\bbe\s+yond\b/gi, (m) => m[0] === 'B' ? 'Beyond' : 'beyond');
    val = val.replace(/\bitse\s+lf\b/gi, (m) => m[0] === 'I' ? 'Itself' : 'itself');
    val = val.replace(/\bhe\s+at\b/gi, (m) => m[0] === 'H' ? 'Heat' : 'heat');
    val = val.replace(/\bhe\s+a\s+t\b/gi, (m) => m[0] === 'H' ? 'Heat' : 'heat');
    val = val.replace(/\bha\s+bit\b/gi, (m) => m[0] === 'H' ? 'Habit' : 'habit');
    val = val.replace(/\bscie\s+ntific\b/gi, (m) => m[0] === 'S' ? 'Scientific' : 'scientific');
    val = val.replace(/\bscie\s+nce\b/gi, (m) => m[0] === 'S' ? 'Science' : 'science');
    val = val.replace(/\bindividua\s+ls\b/gi, (m) => m[0] === 'I' ? 'Individuals' : 'individuals');
    val = val.replace(/\bindividua\s+l\b/gi, (m) => m[0] === 'I' ? 'Individual' : 'individual');
    val = val.replace(/\bde\s+fe\s+ct\b/gi, (m) => m[0] === 'D' ? 'Defect' : 'defect');
    val = val.replace(/\bde\s+fe\s+re\s+ntia\s+l\b/gi, (m) => m[0] === 'D' ? 'Deferential' : 'deferential');
    val = val.replace(/\binte\s+rrupt\b/gi, (m) => m[0] === 'I' ? 'Interrupt' : 'interrupt');
    val = val.replace(/\binte\s+rrupting\b/gi, (m) => m[0] === 'I' ? 'Interrupting' : 'interrupting');
    val = val.replace(/\bm\s+otto\b/gi, (m) => m[0] === 'M' ? 'Motto' : 'motto');
    val = val.replace(/\bstude\s+nts\b/gi, (m) => m[0] === 'S' ? 'Students' : 'students');
    val = val.replace(/\bstude\s+nt\b/gi, (m) => m[0] === 'S' ? 'Student' : 'student');
    val = val.replace(/\bde\s+pa\s+rtm\s+e\s+nts\b/gi, (m) => m[0] === 'D' ? 'Departments' : 'departments');
    val = val.replace(/\be\s+norm\s+ous\b/gi, (m) => m[0] === 'E' ? 'Enormous' : 'enormous');
    val = val.replace(/\be\s+ntra\s+nce\b/gi, (m) => m[0] === 'E' ? 'Entrance' : 'entrance');
    val = val.replace(/\be\s+nte\s+re\s+d\b/gi, (m) => m[0] === 'E' ? 'Entered' : 'entered');

    if (val !== original) {
      textNode.nodeValue = val;
    }
  }

  // 2. Fix Abbyy / OCR single-line chopped paragraphs:
  // If an EPUB has consecutive <p> tags where the first <p> ends without punctuation (. ! ? " ” : ;)
  // and the next <p> starts with a lowercase letter, stitch or style them so they don't break lines unnaturally!
  const paragraphs = rootNode.querySelectorAll('p');
  for (let i = 0; i < paragraphs.length - 1; i++) {
    const p1 = paragraphs[i];
    const p2 = paragraphs[i + 1];
    const t1 = p1.textContent.trim();
    const t2 = p2.textContent.trim();
    if (t1.length > 0 && t2.length > 0) {
      const lastChar = t1[t1.length - 1];
      const firstChar = t2[0];
      if (!/[.!?:"”;\-—]/.test(lastChar) && /^[a-z]/.test(firstChar)) {
        p1.style.marginBottom = '0px';
        p1.style.display = 'inline';
        p2.style.textIndent = '0px';
        p2.style.display = 'inline';
      }
    }
  }
  } catch (err) {
    console.warn('cleanRenderedOcrArtifacts warning:', err);
  }
}

/**
 * Responsive Touch Swipe & Edge Tap Navigation
 */
function attachTouchAndTapNavigation(target) {
  if (!target || target._hasTouchNav) return;
  try {
    target._hasTouchNav = true;

    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    target.addEventListener('touchstart', (e) => {
      if (e.touches && e.touches.length === 1) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    }, { passive: true });

    target.addEventListener('touchend', (e) => {
      if (e.changedTouches && e.changedTouches.length === 1) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const dx = touchEndX - touchStartX;
        const dy = touchEndY - touchStartY;
        const dt = Date.now() - touchStartTime;

        // 1. Horizontal Swipe (turn pages)
        if (Math.abs(dx) > 40 && Math.abs(dy) < 80 && dt < 600) {
          if (dx < -40) turnPage('next');
          else if (dx > 40) turnPage('prev');
          return;
        }

        // 2. Mobile screen tap zones
        if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && dt < 350) {
          const width = target.clientWidth || window.innerWidth;
          const tapX = touchEndX;

          // Left 22% -> Prev
          if (tapX < width * 0.22) {
            turnPage('prev');
          }
          // Right 22% -> Next
          else if (tapX > width * 0.78) {
            turnPage('next');
          }
          // Center -> Toggle Immersive Fullscreen Mode on mobile
          else if (window.innerWidth <= 768) {
            toggleImmersiveMode();
          }
        }
      }
    }, { passive: true });
  } catch (err) {
    console.warn('attachTouchAndTapNavigation warning:', err);
  }
}

function toggleImmersiveMode() {
  document.body.classList.toggle('immersive-mode');
}

/**
 * Navigation & Menu Controls Setup
 */
function setupNavControls() {
  const btnPrev = document.getElementById('btn-nav-prev');
  const btnNext = document.getElementById('btn-nav-next');

  if (btnPrev) btnPrev.addEventListener('click', () => turnPage('prev'));
  if (btnNext) btnNext.addEventListener('click', () => turnPage('next'));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') turnPage('prev');
    if (e.key === 'ArrowRight') turnPage('next');
  });

  // Zoom
  document.getElementById('btn-pdf-zoom-out').addEventListener('click', () => {
    pdfScale = Math.max(0.6, pdfScale - 0.2);
    renderPdfPage(pdfCurrentPage);
  });
  document.getElementById('btn-pdf-zoom-in').addEventListener('click', () => {
    pdfScale = Math.min(3.0, pdfScale + 0.2);
    renderPdfPage(pdfCurrentPage);
  });

  // Sidebar
  document.getElementById('btn-toc-toggle').addEventListener('click', () => toggleSidebar());
  document.getElementById('btn-sidebar-close').addEventListener('click', () => toggleSidebar(false));

  // Mode Toggle (Scroll Down vs Paginated)
  const btnMode = document.getElementById('btn-mode-toggle');
  if (btnMode) {
    btnMode.addEventListener('click', () => toggleReadingMode());
  }

  // Fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

function setupMenuControls() {
  const btnPaper = document.getElementById('btn-paper-toggle');
  const paperMenu = document.getElementById('paper-menu');
  const btnPaperClose = document.getElementById('btn-paper-close');
  const backdrop = document.getElementById('reader-backdrop');

  if (btnPaper) {
    btnPaper.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePaperMenu();
    });
  }

  if (btnPaperClose) {
    btnPaperClose.addEventListener('click', () => togglePaperMenu(false));
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      toggleSidebar(false);
      togglePaperMenu(false);
    });
  }

  document.addEventListener('click', (e) => {
    if (paperMenu && !paperMenu.contains(e.target) && e.target !== btnPaper) {
      if (window.innerWidth > 768) {
        paperMenu.classList.remove('active');
      }
    }
  });

  // Paper options
  document.querySelectorAll('.paper-option-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyPaperTheme(btn.dataset.paper);
    });
  });

  // Font family
  const fontSelect = document.getElementById('font-family-select');
  if (fontSelect) {
    fontSelect.value = readerPrefs.fontFamily;
    fontSelect.addEventListener('change', (e) => {
      readerPrefs.fontFamily = e.target.value;
      localStorage.setItem('athenaeum_font', readerPrefs.fontFamily);
      applyCurrentStylesToRendition();
    });
  }

  // Font size
  const fontLabel = document.getElementById('font-size-label');
  const btnFontDec = document.getElementById('btn-font-dec');
  const btnFontInc = document.getElementById('btn-font-inc');

  if (fontLabel) fontLabel.textContent = `${readerPrefs.fontSize}%`;

  btnFontDec.addEventListener('click', () => {
    readerPrefs.fontSize = Math.max(70, readerPrefs.fontSize - 10);
    localStorage.setItem('athenaeum_font_size', readerPrefs.fontSize);
    if (fontLabel) fontLabel.textContent = `${readerPrefs.fontSize}%`;
    applyCurrentStylesToRendition();
  });

  btnFontInc.addEventListener('click', () => {
    readerPrefs.fontSize = Math.min(220, readerPrefs.fontSize + 10);
    localStorage.setItem('athenaeum_font_size', readerPrefs.fontSize);
    if (fontLabel) fontLabel.textContent = `${readerPrefs.fontSize}%`;
    applyCurrentStylesToRendition();
  });

  // Margins
  const marginSelect = document.getElementById('margin-select');
  if (marginSelect) {
    marginSelect.value = readerPrefs.margin;
    marginSelect.addEventListener('change', (e) => {
      readerPrefs.margin = e.target.value;
      localStorage.setItem('athenaeum_margin', readerPrefs.margin);
      applyCurrentStylesToRendition();
    });
  }

  // Reading Mode Select (Scroll Down vs Paginated)
  const modeSelect = document.getElementById('reading-mode-select');
  if (modeSelect) {
    modeSelect.value = readerPrefs.mode;
    modeSelect.addEventListener('change', (e) => {
      toggleReadingMode(e.target.value);
    });
  }

  // Text Alignment Select
  const alignSelect = document.getElementById('text-align-select');
  if (alignSelect) {
    alignSelect.value = readerPrefs.textAlign;
    alignSelect.addEventListener('change', (e) => {
      readerPrefs.textAlign = e.target.value;
      localStorage.setItem('athenaeum_text_align', readerPrefs.textAlign);
      applyCurrentStylesToRendition();
    });
  }
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('reader-sidebar');
  const backdrop = document.getElementById('reader-backdrop');
  const paperMenu = document.getElementById('paper-menu');
  if (paperMenu) paperMenu.classList.remove('active');
  const isOpen = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  if (backdrop) {
    backdrop.classList.toggle('active', isOpen);
  }
}

function togglePaperMenu(forceState) {
  const paperMenu = document.getElementById('paper-menu');
  const backdrop = document.getElementById('reader-backdrop');
  const sidebar = document.getElementById('reader-sidebar');
  if (sidebar) sidebar.classList.remove('open');
  const isActive = typeof forceState === 'boolean' ? forceState : !paperMenu.classList.contains('active');
  paperMenu.classList.toggle('active', isActive);
  if (backdrop) {
    backdrop.classList.toggle('active', isActive);
  }
}

function updateLoaderStatus(msg) {
  const el = document.getElementById('loader-status');
  if (el) el.textContent = msg;
}

function hideLoader() {
  const loader = document.getElementById('reader-loader');
  if (loader) {
    loader.style.opacity = '0';
    loader.style.pointerEvents = 'none';
    setTimeout(() => { 
      loader.style.display = 'none'; 
    }, 280);
  }
}

function showError(msg) {
  const loader = document.getElementById('reader-loader');
  if (loader) {
    loader.style.opacity = '1';
    loader.style.display = 'flex';
    loader.innerHTML = `
      <div style="text-align: center; padding: 24px; max-width: 440px; background: white; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); border: 1px solid #e2e8f0;">
        <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
        <p style="font-size: 15px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">Reading Notice</p>
        <p style="font-size: 13px; color: #64748b; line-height: 1.5; margin-bottom: 18px;">${escapeHtml(msg)}</p>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <button onclick="window.location.reload()" class="tool-btn" style="background: #0f172a; color: white; padding: 0 16px;">Retry</button>
          <a href="index.html" class="tool-btn" style="border: 1px solid #cbd5e1; padding: 0 16px;">Back to Library</a>
        </div>
      </div>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
