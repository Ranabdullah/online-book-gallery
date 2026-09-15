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
  initIntelligenceAndDrawers();

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
        updateIntelligenceLink();
        refreshDrawerBadges();
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

  // epub.js MUST get pixel height for paginated mode — '100%' resolves to 0 in some flex layouts
  const stageEl = document.getElementById('book-stage') || document.querySelector('.book-page-wrapper');
  const pixelH = stageEl ? stageEl.clientHeight : window.innerHeight - 100;
  const renderHeight = isScroll ? '100%' : Math.max(400, pixelH);

  currentRendition = currentBook.renderTo('epub-viewer', {
    width: '100%',
    height: renderHeight,
    flow: isScroll ? 'scrolled-doc' : 'paginated',
    manager: isScroll ? 'continuous' : 'default',
    spread: 'none'   // always single column — avoids blank double-page spread
  });

  // Word lookup inside iframe
  currentRendition.hooks.content.register((contents) => {
    try {
      if (contents && contents.document) {
        if (contents.document.body) {
          cleanRenderedOcrArtifacts(contents.document.body);
        }
        attachTouchAndTapNavigation(contents.document);
        attachEpubWordLookupListeners(contents);
      }
    } catch (hookErr) {
      console.warn('Content hook non-fatal error:', hookErr);
    }
  });

  // Native EPUB text selection hook
  currentRendition.on('selected', (cfiRange, contents) => {
    handleEpubSelection(cfiRange, contents);
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

      // Always update percentage (even 0% is valid — removing falsy guard)
      const pct = location.start.percentage != null ? Math.round(location.start.percentage * 100) : 0;
      const pctEl = document.getElementById('reader-percentage');
      const barEl = document.getElementById('progress-bar-fill');
      if (pctEl) pctEl.textContent = `${pct}%`;
      if (barEl) barEl.style.width = `${pct}%`;

      // Page label: use displayed page per chapter, or chapter index
      const pageNum = (location.start.displayed && location.start.displayed.page) ? location.start.displayed.page : null;
      const totalPages = (location.start.displayed && location.start.displayed.total) ? location.start.displayed.total : null;
      const progressEl = document.getElementById('reader-progress-text');
      if (progressEl) {
        if (pageNum && totalPages && totalPages > 1) {
          progressEl.textContent = `Page ${pageNum} of ${totalPages}`;
        } else if (pageNum) {
          progressEl.textContent = `Page ${pageNum}`;
        } else {
          progressEl.textContent = `${pct}%`;
        }
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

    // Render PDF Text Layer for selection and dictionary lookup
    try {
      const slot = document.getElementById(`pdf-page-slot-${num}`);
      if (slot) {
        let textLayerDiv = slot.querySelector('.pdf-text-layer');
        if (!textLayerDiv) {
          textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'pdf-text-layer textLayer';
          slot.appendChild(textLayerDiv);
        }
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        const textContent = await page.getTextContent();
        if (pdfjsLib.renderTextLayer) {
          await pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport
          }).promise;
        }
      }
    } catch (textErr) {
      console.warn(`PDF slot ${num} text layer error:`, textErr);
    }
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

  container.innerHTML = `
    <div class="pdf-page-slot" id="pdf-paginated-slot" style="position: relative; display: flex; justify-content: center; width: 100%;">
      <canvas id="pdf-canvas" class="pdf-page-canvas"></canvas>
    </div>
  `;
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

    // Render PDF Text Layer for selection and dictionary lookup in paginated mode
    try {
      const slot = document.getElementById('pdf-paginated-slot') || container;
      let textLayerDiv = slot.querySelector('.pdf-text-layer');
      if (!textLayerDiv) {
        textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'pdf-text-layer textLayer';
        slot.appendChild(textLayerDiv);
      }
      textLayerDiv.innerHTML = '';
      textLayerDiv.style.width = `${viewport.width}px`;
      textLayerDiv.style.height = `${viewport.height}px`;
      const textContent = await page.getTextContent();
      if (pdfjsLib.renderTextLayer) {
        await pdfjsLib.renderTextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport: viewport
        }).promise;
      }
    } catch (textErr) {
      console.warn('Paginated PDF text layer error:', textErr);
    }

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
    const scrollAmount = window.innerHeight * 0.78;
    if (currentFormat === 'epub') {
      const scrollEl = document.querySelector('.epub-container') || document.getElementById('epub-viewer');
      if (scrollEl) {
        scrollEl.scrollBy({ top: direction === 'next' ? scrollAmount : -scrollAmount, behavior: 'auto' });
      }
    } else if (currentFormat === 'pdf') {
      const container = document.getElementById('pdf-viewer-container');
      if (container) {
        container.scrollBy({ top: direction === 'next' ? scrollAmount : -scrollAmount, behavior: 'auto' });
      }
    }
    return;
  }

  // Paginated mode
  playPageTurnFeedback(direction);
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

// A brief, restrained blur/slide makes a page change obvious without slowing reading.
function playPageTurnFeedback(direction) {
  const page = document.getElementById('book-page-wrapper');
  if (!page) return;
  page.classList.remove('page-turn-next', 'page-turn-prev');
  // Force a new animation when the reader turns pages quickly.
  void page.offsetWidth;
  page.classList.add(direction === 'prev' ? 'page-turn-prev' : 'page-turn-next');
  window.setTimeout(() => page.classList.remove('page-turn-next', 'page-turn-prev'), 360);
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

  // Paragraph stitching removed — setting display:inline on <p> breaks epub.js scroll
  // and causes the scroll-push-down bug. Text-node OCR word-gap regex above handles word gaps.
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

        // In Paginated (Page Turn) mode: handle page turn swipes and tap zones
        if (readerPrefs.mode === 'paginated') {
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

            // Left 22% -> Prev page
            if (tapX < width * 0.22) {
              turnPage('prev');
            }
            // Right 22% -> Next page
            else if (tapX > width * 0.78) {
              turnPage('next');
            }
            // Center -> Toggle Immersive Fullscreen Mode on mobile
            else if (window.innerWidth <= 768) {
              toggleImmersiveMode();
            }
          }
        } else {
          // In Scroll mode: NEVER automatically jump down on tap or swipe!
          // Only center tap toggles immersive UI toolbar
          if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && dt < 350) {
            const width = target.clientWidth || window.innerWidth;
            const tapX = touchEndX;
            if (tapX >= width * 0.25 && tapX <= width * 0.75 && window.innerWidth <= 768) {
              toggleImmersiveMode();
            }
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
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
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

  // Chapters drawer
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

  const wordSearchForm = document.getElementById('word-search-form');
  const wordSearchInput = document.getElementById('word-search-input');
  if (wordSearchForm && wordSearchInput) {
    wordSearchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const word = wordSearchInput.value.trim();
      if (!word) {
        wordSearchInput.focus();
        return;
      }
      const rect = wordSearchInput.getBoundingClientRect();
      showWordPopover(word, rect.left + rect.width / 2, rect.bottom + 8, {
        format: 'search',
        surroundingContext: word
      });
      wordSearchInput.select();
    });
  }

  const menu = document.getElementById('reader-menu-drawer');
  const menuButton = document.getElementById('btn-reader-menu');
  const menuClose = document.getElementById('btn-reader-menu-close');
  if (menuButton && menu) {
    menuButton.addEventListener('click', () => toggleReaderMenu());
  }
  if (menuClose) menuClose.addEventListener('click', () => toggleReaderMenu(false));
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
      toggleReaderMenu(false);
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
  toggleReaderMenu(false);
  if (paperMenu) paperMenu.classList.remove('active');
  const isOpen = typeof forceState === 'boolean' ? forceState : !sidebar.classList.contains('open');
  sidebar.classList.toggle('open', isOpen);
  if (backdrop) {
    backdrop.classList.toggle('active', isOpen);
  }
}

function toggleReaderMenu(forceState) {
  const menu = document.getElementById('reader-menu-drawer');
  const trigger = document.getElementById('btn-reader-menu');
  const backdrop = document.getElementById('reader-backdrop');
  if (!menu) return;
  const isOpen = typeof forceState === 'boolean' ? forceState : !menu.classList.contains('open');
  menu.classList.toggle('open', isOpen);
  if (trigger) trigger.setAttribute('aria-expanded', String(isOpen));
  if (backdrop) backdrop.classList.toggle('active', isOpen);
}

function togglePaperMenu(forceState) {
  const paperMenu = document.getElementById('paper-menu');
  const backdrop = document.getElementById('reader-backdrop');
  const sidebar = document.getElementById('reader-sidebar');
  toggleReaderMenu(false);
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

// ==========================================================================
// Athenaeum AI Book Intelligence, Vocabulary Bank & Margin Notes Engine
// ==========================================================================

let currentWordPopoverData = null;
let wordLookupRequest = 0;
let activeNoteColor = '#fef08a';

function initIntelligenceAndDrawers() {
  updateIntelligenceLink();
  setupDrawerEventListeners();
  setupPdfWordLookupListeners();
  refreshDrawerBadges();
}

function updateIntelligenceLink() {
  const analysisBtn = document.getElementById('btn-reader-analysis');
  if (analysisBtn) {
    analysisBtn.href = `book-analysis.html?book=${encodeURIComponent(currentBookIdentifier)}`;
  }
  const flashcardLink = document.getElementById('btn-vocab-to-flashcards');
  if (flashcardLink) {
    flashcardLink.href = `book-analysis.html?book=${encodeURIComponent(currentBookIdentifier)}#glossary`;
  }
}

function setupDrawerEventListeners() {
  const btnVocab = document.getElementById('btn-vocab-toggle');
  const btnNotes = document.getElementById('btn-notes-toggle');
  const backdrop = document.getElementById('reader-backdrop');

  const vocabDrawer = document.getElementById('reader-vocab-drawer');
  const notesDrawer = document.getElementById('reader-notes-drawer');
  const tocSidebar = document.getElementById('reader-sidebar');

  if (btnVocab && vocabDrawer) {
    btnVocab.addEventListener('click', () => {
      const isOpen = vocabDrawer.classList.contains('open');
      closeAllDrawers();
      if (!isOpen) {
        vocabDrawer.classList.add('open');
        if (backdrop) backdrop.classList.add('active');
        loadAndRenderVocabDrawer();
      }
    });
  }

  if (btnNotes && notesDrawer) {
    btnNotes.addEventListener('click', () => {
      const isOpen = notesDrawer.classList.contains('open');
      closeAllDrawers();
      if (!isOpen) {
        notesDrawer.classList.add('open');
        if (backdrop) backdrop.classList.add('active');
        loadAndRenderNotesDrawer();
      }
    });
  }

  const btnVocabClose = document.getElementById('btn-vocab-drawer-close');
  if (btnVocabClose) {
    btnVocabClose.addEventListener('click', closeAllDrawers);
  }

  const btnNotesClose = document.getElementById('btn-notes-drawer-close');
  if (btnNotesClose) {
    btnNotesClose.addEventListener('click', closeAllDrawers);
  }

  if (backdrop) {
    backdrop.addEventListener('click', () => {
      closeAllDrawers();
      hideWordPopover();
    });
  }

  // Search filter inputs
  const vocabSearch = document.getElementById('vocab-search-input');
  if (vocabSearch) {
    vocabSearch.addEventListener('input', (e) => {
      loadAndRenderVocabDrawer(e.target.value.trim().toLowerCase());
    });
  }

  const notesSearch = document.getElementById('notes-search-input');
  if (notesSearch) {
    notesSearch.addEventListener('input', (e) => {
      loadAndRenderNotesDrawer(e.target.value.trim().toLowerCase());
    });
  }

  // Popover close button
  const popoverClose = document.getElementById('popover-btn-close');
  if (popoverClose) {
    popoverClose.addEventListener('click', hideWordPopover);
  }

  // Dismiss popover on Escape or click outside
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllDrawers();
      hideWordPopover();
    }
  });

  document.addEventListener('mousedown', (e) => {
    // Guard: if popover was just shown from the iframe, skip this dismiss cycle
    if (window._popoverJustShown) return;
    const popover = document.getElementById('reader-word-popover');
    if (popover && popover.style.display !== 'none') {
      if (!popover.contains(e.target)) {
        hideWordPopover();
      }
    }
  });

  // Color chips for notes
  document.querySelectorAll('#note-color-chips .color-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#note-color-chips .color-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeNoteColor = chip.dataset.color || '#fef08a';
    });
  });

  // Toggle Note Form in popover
  const toggleNoteBtn = document.getElementById('popover-btn-toggle-note');
  const noteForm = document.getElementById('popover-note-form');
  if (toggleNoteBtn && noteForm) {
    toggleNoteBtn.addEventListener('click', () => {
      const isVisible = noteForm.style.display === 'block';
      noteForm.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        document.getElementById('popover-note-input')?.focus();
      }
    });
  }

  // Save Word to Vocabulary button
  const saveVocabBtn = document.getElementById('popover-btn-save-vocab');
  if (saveVocabBtn) {
    saveVocabBtn.addEventListener('click', async () => {
      if (!currentWordPopoverData || !window.AthenaeumDB) return;
      saveVocabBtn.textContent = 'Saving...';
      try {
        await window.AthenaeumDB.saveVocabularyWord({
          word: currentWordPopoverData.word,
          phonetic: currentWordPopoverData.phonetic || '',
          partOfSpeech: currentWordPopoverData.partOfSpeech || '',
          definition: currentWordPopoverData.definition || 'Saved vocabulary entry',
          example: currentWordPopoverData.example || '',
          contextSentence: currentWordPopoverData.contextSentence || '',
          bookId: currentBookIdentifier,
          bookTitle: document.getElementById('reader-book-title')?.textContent || 'Current Book'
        });
        saveVocabBtn.textContent = '✓ Saved to Vocab!';
        saveVocabBtn.disabled = true;
        refreshDrawerBadges();
      } catch (err) {
        console.warn('Error saving vocabulary:', err);
        saveVocabBtn.textContent = '⭐ Save to Vocab';
      }
    });
  }

  // Submit Note Button
  const submitNoteBtn = document.getElementById('popover-btn-submit-note');
  if (submitNoteBtn) {
    submitNoteBtn.addEventListener('click', async () => {
      if (!currentWordPopoverData || !window.AthenaeumDB) return;
      const noteInput = document.getElementById('popover-note-input');
      const noteContent = noteInput ? noteInput.value.trim() : '';
      if (!noteContent) {
        if (noteInput) noteInput.focus();
        return;
      }

      submitNoteBtn.textContent = 'Saving...';
      const loc = currentWordPopoverData.locator || {};
      let cfiOrPage = '';
      if (loc.format === 'epub' && loc.cfiRange) {
        cfiOrPage = loc.cfiRange;
        try {
          if (currentRendition && currentRendition.annotations) {
            currentRendition.annotations.highlight(loc.cfiRange, {}, () => {}, 'custom-hl', {
              fill: activeNoteColor,
              'fill-opacity': '0.35'
            });
          }
        } catch (hlErr) {}
      } else if (loc.format === 'pdf') {
        cfiOrPage = `Page ${loc.page || pdfCurrentPage}`;
      }

      try {
        await window.AthenaeumDB.saveBookNote({
          bookId: currentBookIdentifier,
          bookTitle: document.getElementById('reader-book-title')?.textContent || 'Current Book',
          format: loc.format || currentFormat || 'epub',
          cfiOrPage: cfiOrPage,
          selectedText: currentWordPopoverData.contextSentence || currentWordPopoverData.word,
          noteText: noteContent,
          color: activeNoteColor
        });

        submitNoteBtn.textContent = '✓ Saved!';
        if (noteInput) noteInput.value = '';
        setTimeout(() => {
          if (noteForm) noteForm.style.display = 'none';
          hideWordPopover();
        }, 700);
        refreshDrawerBadges();
      } catch (noteErr) {
        console.warn('Error saving book note:', noteErr);
        submitNoteBtn.textContent = 'Save Note';
      }
    });
  }
}

function closeAllDrawers() {
  const vocabDrawer = document.getElementById('reader-vocab-drawer');
  const notesDrawer = document.getElementById('reader-notes-drawer');
  const tocSidebar = document.getElementById('reader-sidebar');
  const backdrop = document.getElementById('reader-backdrop');

  if (vocabDrawer) vocabDrawer.classList.remove('open');
  if (notesDrawer) notesDrawer.classList.remove('open');
  if (tocSidebar) tocSidebar.classList.remove('open');
  toggleReaderMenu(false);
  if (backdrop) backdrop.classList.remove('active');
}

function hideWordPopover() {
  const popover = document.getElementById('reader-word-popover');
  if (popover) {
    popover.style.display = 'none';
  }
  const noteForm = document.getElementById('popover-note-form');
  if (noteForm) noteForm.style.display = 'none';
  currentWordPopoverData = null;
}

async function refreshDrawerBadges() {
  if (!window.AthenaeumDB) return;
  try {
    const vocabList = await window.AthenaeumDB.getAllVocabulary();
    const notesList = await window.AthenaeumDB.getBookNotes(currentBookIdentifier);

    const vocabCount = vocabList ? vocabList.length : 0;
    const notesCount = notesList ? notesList.length : 0;

    const vBadge = document.getElementById('vocab-badge-count');
    const dVBadge = document.getElementById('drawer-vocab-count');
    if (vBadge) vBadge.textContent = vocabCount;
    if (dVBadge) dVBadge.textContent = vocabCount;

    const nBadge = document.getElementById('notes-badge-count');
    const dNBadge = document.getElementById('drawer-notes-count');
    if (nBadge) nBadge.textContent = notesCount;
    if (dNBadge) dNBadge.textContent = notesCount;
  } catch (e) {
    console.warn('Badge refresh warning:', e);
  }
}

async function loadAndRenderVocabDrawer(filterQuery = '') {
  const listEl = document.getElementById('vocab-drawer-list');
  if (!listEl || !window.AthenaeumDB) return;

  try {
    let items = await window.AthenaeumDB.getAllVocabulary();
    if (filterQuery) {
      items = items.filter(w => 
        w.word.toLowerCase().includes(filterQuery) || 
        (w.definition && w.definition.toLowerCase().includes(filterQuery))
      );
    }

    if (!items || items.length === 0) {
      listEl.innerHTML = `
        <div class="drawer-empty-state">
          <p>${filterQuery ? 'No matching words' : 'No saved vocabulary words yet'}</p>
          <span class="drawer-empty-hint">Click or highlight any word in the book to look up its definition and save it!</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = items.map(item => `
      <div class="drawer-vocab-card" data-id="${escapeHtml(item.id)}">
        <div class="drawer-vocab-top">
          <div>
            <span class="drawer-vocab-word">${escapeHtml(item.word)}</span>
            ${item.phonetic ? `<span class="drawer-vocab-phonetic">${escapeHtml(item.phonetic)}</span>` : ''}
          </div>
          <button type="button" class="drawer-btn-icon" onclick="pronounceWord('${escapeHtml(item.word)}')" title="Listen">
            🔊
          </button>
        </div>
        ${item.partOfSpeech ? `<span class="drawer-vocab-pos">${escapeHtml(item.partOfSpeech)}</span>` : ''}
        <div class="drawer-vocab-def">${escapeHtml(item.definition || '')}</div>
        ${item.contextSentence ? `<div class="drawer-vocab-context">"${escapeHtml(item.contextSentence)}"</div>` : ''}
        <div class="drawer-vocab-actions">
          <span style="font-size: 10.5px; color: var(--text-muted);">${escapeHtml(item.bookTitle || '')}</span>
          <button type="button" class="drawer-btn-icon drawer-btn-delete" onclick="deleteSavedVocabWord('${escapeHtml(item.id)}')" title="Delete from vocabulary">
            🗑️ Remove
          </button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.warn('Error loading vocab drawer:', err);
  }
}

async function loadAndRenderNotesDrawer(filterQuery = '') {
  const listEl = document.getElementById('notes-drawer-list');
  if (!listEl || !window.AthenaeumDB) return;

  try {
    let notes = await window.AthenaeumDB.getBookNotes(currentBookIdentifier);
    if (filterQuery) {
      notes = notes.filter(n => 
        (n.noteText && n.noteText.toLowerCase().includes(filterQuery)) ||
        (n.selectedText && n.selectedText.toLowerCase().includes(filterQuery))
      );
    }

    if (!notes || notes.length === 0) {
      listEl.innerHTML = `
        <div class="drawer-empty-state">
          <p>${filterQuery ? 'No matching notes' : 'No highlights or margin notes yet'}</p>
          <span class="drawer-empty-hint">Highlight any passage in the reader and click "Add Note" to write annotations!</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = notes.map(note => {
      const dateStr = note.createdAt ? new Date(note.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      return `
        <div class="drawer-note-card" style="border-left-color: ${note.color || '#fef08a'};" data-id="${escapeHtml(note.id)}">
          ${note.selectedText ? `<div class="drawer-note-quote">"${escapeHtml(note.selectedText)}"</div>` : ''}
          <div class="drawer-note-body">${escapeHtml(note.noteText)}</div>
          <div class="drawer-note-meta">
            <span>${escapeHtml(dateStr)} ${note.cfiOrPage ? `&bull; ${escapeHtml(note.cfiOrPage)}` : ''}</span>
            <div style="display: flex; gap: 4px; align-items: center;">
              ${note.cfiOrPage ? `<button type="button" class="drawer-btn-jump" onclick="jumpToNoteLocation('${escapeHtml(note.id)}')">Jump</button>` : ''}
              <button type="button" class="drawer-btn-icon drawer-btn-delete" onclick="deleteSavedBookNote('${escapeHtml(note.id)}')" title="Delete note">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error loading notes drawer:', err);
  }
}

window.pronounceWord = function(word) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.rate = 0.9;
    utter.lang = 'en-US';
    window.speechSynthesis.speak(utter);
  }
};

window.deleteSavedVocabWord = async function(id) {
  if (!confirm('Remove this word from your vocabulary bank?')) return;
  if (window.AthenaeumDB) {
    await window.AthenaeumDB.deleteVocabularyWord(id);
    await refreshDrawerBadges();
    await loadAndRenderVocabDrawer();
  }
};

window.deleteSavedBookNote = async function(id) {
  if (!confirm('Delete this reading note?')) return;
  if (window.AthenaeumDB) {
    await window.AthenaeumDB.deleteBookNote(id);
    await refreshDrawerBadges();
    await loadAndRenderNotesDrawer();
  }
};

window.jumpToNoteLocation = async function(id) {
  if (!window.AthenaeumDB) return;
  const notes = await window.AthenaeumDB.getBookNotes(currentBookIdentifier);
  const note = notes.find(n => n.id === id);
  if (!note || !note.cfiOrPage) return;

  closeAllDrawers();

  if (note.format === 'epub' && currentRendition) {
    currentRendition.display(note.cfiOrPage);
  } else if (note.format === 'pdf') {
    const pageMatch = note.cfiOrPage.match(/\d+/);
    if (pageMatch && window.jumpToPdfPage) {
      window.jumpToPdfPage(parseInt(pageMatch[0], 10));
    }
  }
};

// EPUB & PDF Word Popover Display Logic
async function showWordPopover(rawText, clientX, clientY, locator) {
  const popover = document.getElementById('reader-word-popover');
  if (!popover) return;

  const trimmed = rawText.trim();
  const isMultipleWords = trimmed.split(/\s+/).length > 2;
  const cleanWord = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, '');

  if (!cleanWord && !isMultipleWords) return;
  const requestId = ++wordLookupRequest;

  currentWordPopoverData = {
    word: cleanWord || trimmed,
    phonetic: '',
    partOfSpeech: '',
    definition: '',
    example: '',
    contextSentence: locator && locator.surroundingContext ? locator.surroundingContext.trim().substring(0, 180) : trimmed,
    locator: locator
  };

  // Position popover
  popover.style.display = 'block';
  const popWidth = Math.min(320, window.innerWidth - 24);
  let popLeft = clientX - popWidth / 2;
  popLeft = Math.max(12, Math.min(window.innerWidth - popWidth - 12, popLeft));

  let popTop = clientY + 12;
  if (popTop + 240 > window.innerHeight) {
    popTop = Math.max(50, clientY - 250);
  }

  popover.style.left = `${popLeft}px`;
  popover.style.top = `${popTop}px`;

  // Populate basic header
  const wordEl = document.getElementById('popover-word');
  const phoneticEl = document.getElementById('popover-phonetic');
  const audioBtn = document.getElementById('popover-btn-audio');
  const bodyEl = document.getElementById('popover-body');
  const saveVocabBtn = document.getElementById('popover-btn-save-vocab');
  const noteForm = document.getElementById('popover-note-form');

  if (noteForm) noteForm.style.display = 'none';
  if (saveVocabBtn) {
    saveVocabBtn.textContent = '⭐ Save to Vocab';
    saveVocabBtn.disabled = false;
  }

  wordEl.textContent = cleanWord || trimmed;
  phoneticEl.textContent = '';

  if (audioBtn) {
    audioBtn.style.display = isMultipleWords ? 'none' : 'inline-flex';
    audioBtn.onclick = () => pronounceWord(cleanWord);
  }

  if (isMultipleWords) {
    bodyEl.innerHTML = `
      <div style="font-size: 12.5px; color: var(--reader-text); line-height: 1.45;">
        <p style="font-style: italic; margin-bottom: 6px;">"${escapeHtml(trimmed.substring(0, 120))}${trimmed.length > 120 ? '...' : ''}"</p>
        <span style="color: var(--text-muted); font-size: 11.5px;">Click "Add Note" to write margin notes or highlight this passage!</span>
      </div>
    `;
    return;
  }

  // Fetch an online definition. A timeout and fallback prevent the lookup from
  // appearing to hang when either free dictionary service is unavailable.
  bodyEl.innerHTML = `
    <div class="popover-loading">
      <span class="popover-spinner"></span>
      <span>Looking up "${escapeHtml(cleanWord)}"...</span>
    </div>
  `;

  try {
    const fetchDefinition = async (url) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7000);
      try {
        return await fetch(url, { signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
    };
    let resp = await fetchDefinition(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord.toLowerCase())}`);
    if (!resp.ok) {
      resp = await fetchDefinition(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(cleanWord.toLowerCase())}`);
      if (!resp.ok) throw new Error('Word not found');
      const wikiData = await resp.json();
      if (requestId !== wordLookupRequest) return;
      const english = wikiData.en || [];
      const first = english.find(item => item.definitions && item.definitions.length);
      if (!first) throw new Error('No English definition found');
      const definition = (first.definitions[0].definition || '').replace(/<[^>]+>/g, '');
      currentWordPopoverData.partOfSpeech = first.partOfSpeech || '';
      currentWordPopoverData.definition = definition;
      bodyEl.innerHTML = `<div class="popover-def-item"><span class="popover-pos-badge">${escapeHtml(first.partOfSpeech || 'definition')}</span><span>${escapeHtml(definition)}</span></div>`;
      return;
    }
    if (resp.ok) {
      const data = await resp.json();
      if (requestId !== wordLookupRequest) return;
      if (data && data.length > 0) {
        const entry = data[0];
        const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || '';
        phoneticEl.textContent = phonetic;
        currentWordPopoverData.phonetic = phonetic;

        let defsHtml = '';
        if (entry.meanings && entry.meanings.length > 0) {
          const primaryMeaning = entry.meanings[0];
          currentWordPopoverData.partOfSpeech = primaryMeaning.partOfSpeech || '';

          entry.meanings.slice(0, 2).forEach(m => {
            const pos = m.partOfSpeech ? `<span class="popover-pos-badge">${escapeHtml(m.partOfSpeech)}</span>` : '';
            const defObj = m.definitions && m.definitions[0];
            if (defObj) {
              if (!currentWordPopoverData.definition) {
                currentWordPopoverData.definition = defObj.definition;
                currentWordPopoverData.example = defObj.example || '';
              }
              defsHtml += `
                <div class="popover-def-item">
                  ${pos}<span>${escapeHtml(defObj.definition)}</span>
                  ${defObj.example ? `<span class="popover-example">"${escapeHtml(defObj.example)}"</span>` : ''}
                </div>
              `;
            }
          });
        }
        bodyEl.innerHTML = defsHtml || '<div>Definition retrieved.</div>';
      } else {
        throw new Error('No definition found');
      }
    } else {
      throw new Error('Word not in online dictionary');
    }
  } catch (err) {
    if (requestId !== wordLookupRequest) return;
    bodyEl.innerHTML = `
      <div style="font-size: 12px; color: var(--text-muted); line-height: 1.4;">
        <p style="font-weight: 600; color: var(--reader-text); margin-bottom: 4px;">Word Lookup Offline / Term Not Found</p>
        <span>You can still save "${escapeHtml(cleanWord)}" to your personal vocabulary bank or write a reading note below!</span>
      </div>
    `;
  }
}

function handleEpubSelection(cfiRange, contents) {
  try {
    const win = (contents && contents.window) ? contents.window : window;
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text || text.length === 0 || text.length > 400) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const iframe = document.querySelector('#epub-viewer iframe');
    const iframeRect = iframe ? iframe.getBoundingClientRect() : { top: 0, left: 0 };

    const clientX = iframeRect.left + rect.left + rect.width / 2;
    const clientY = iframeRect.top + rect.bottom;

    showWordPopover(text, clientX, clientY, {
      format: 'epub',
      cfiRange: cfiRange,
      contents: contents,
      surroundingContext: range.commonAncestorContainer ? range.commonAncestorContainer.textContent : ''
    });
  } catch (e) {
    console.warn('EPUB selection warning:', e);
  }
}

function attachEpubWordLookupListeners(contents) {
  try {
    const doc = contents.document;
    if (!doc || doc._hasWordLookup) return;
    doc._hasWordLookup = true;

    doc.addEventListener('dblclick', (e) => {
      setTimeout(() => {
        const sel = contents.window ? contents.window.getSelection() : doc.getSelection();
        if (sel && sel.toString().trim()) {
          handleEpubSelection(null, contents);
        }
      }, 30);
    });

    doc.addEventListener('mouseup', (e) => {
      setTimeout(() => {
        const sel = contents.window ? contents.window.getSelection() : doc.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) {
          // Flag so document mousedown handler does not immediately dismiss the popover
          window._popoverJustShown = true;
          setTimeout(() => { window._popoverJustShown = false; }, 200);
          handleEpubSelection(null, contents);
        }
      }, 60);
    });

    // Long-press selection on phones does not emit mouseup. Read the native
    // selection after touchend so it works the same way as desktop selection.
    doc.addEventListener('touchend', () => {
      setTimeout(() => {
        const sel = contents.window ? contents.window.getSelection() : doc.getSelection();
        if (sel && !sel.isCollapsed && sel.toString().trim()) {
          handleEpubSelection(null, contents);
        }
      }, 80);
    }, { passive: true });
  } catch (err) {
    console.warn('attachEpubWordLookupListeners error:', err);
  }
}

function setupPdfWordLookupListeners() {
  const container = document.getElementById('pdf-viewer-container');
  if (!container || container._hasWordLookup) return;
  container._hasWordLookup = true;

  container.addEventListener('mouseup', (e) => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const text = sel.toString().trim();
      if (!text || text.length === 0 || text.length > 400) return;

      if (!container.contains(sel.anchorNode)) return;

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.bottom;

      showWordPopover(text, clientX, clientY, {
        format: 'pdf',
        page: pdfCurrentPage,
        surroundingContext: range.commonAncestorContainer ? range.commonAncestorContainer.textContent : ''
      });
    }, 60);
  });

  container.addEventListener('touchend', () => {
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim() || !container.contains(sel.anchorNode)) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      showWordPopover(sel.toString().trim(), rect.left + rect.width / 2, rect.bottom, {
        format: 'pdf', page: pdfCurrentPage,
        surroundingContext: sel.getRangeAt(0).commonAncestorContainer?.textContent || ''
      });
    }, 80);
  }, { passive: true });
}

