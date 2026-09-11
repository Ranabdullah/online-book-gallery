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
  margin: localStorage.getItem('athenaeum_margin') || '40px'
};

const urlParams = new URLSearchParams(window.location.search);
const bookUrl = urlParams.get('book');
const isLocal = urlParams.get('local');
const blobUrl = urlParams.get('blob');
const bookTitleParam = urlParams.get('title');

document.addEventListener('DOMContentLoaded', async () => {
  applyPaperTheme(readerPrefs.paper);
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
  const isPdf = ext.includes('pdf');

  if (isPdf) {
    currentFormat = 'pdf';
    document.getElementById('pdf-controls').style.display = 'flex';
    document.getElementById('epub-viewer').style.display = 'none';
    document.getElementById('pdf-viewer-container').style.display = 'flex';
    initPdfReaderWithBuffer(buffer);
  } else {
    currentFormat = 'epub';
    document.getElementById('pdf-controls').style.display = 'none';
    document.getElementById('epub-viewer').style.display = 'block';
    document.getElementById('pdf-viewer-container').style.display = 'none';
    initEpubReaderWithBuffer(buffer, identifier);
  }
}

/**
 * EPUB Engine (with Memory Buffer)
 */
function initEpubReaderWithBuffer(buffer, identifier) {
  try {
    currentBook = ePub(buffer);
    const viewer = document.getElementById('epub-viewer');
    viewer.innerHTML = '';

    currentRendition = currentBook.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'auto'
    });

    // Apply paper style to EPUB internal styles
    applyCurrentStylesToRendition();

    // Restore saved reading position
    const savedCfi = localStorage.getItem(`athenaeum_pos_${identifier}`);
    const displayPromise = savedCfi ? currentRendition.display(savedCfi) : currentRendition.display();

    displayPromise.then(() => {
      hideLoader();
      applyCurrentStylesToRendition();
    }).catch((displayErr) => {
      console.warn('Initial display error, falling back to default:', displayErr);
      currentRendition.display().then(hideLoader).catch(e => showError('EPUB render error: ' + e.message));
    });

    // Tracking position & progress
    currentRendition.on('relocated', (location) => {
      hideLoader();
      if (location && location.start) {
        localStorage.setItem(`athenaeum_pos_${identifier}`, location.start.cfi);
        if (location.start.percentage) {
          const pct = Math.round(location.start.percentage * 100);
          document.getElementById('reader-percentage').textContent = `${pct}%`;
          document.getElementById('progress-bar-fill').style.width = `${pct}%`;
        }
        if (location.start.displayed && location.start.displayed.page) {
          document.getElementById('reader-progress-text').textContent = `Page ${location.start.displayed.page}`;
        }
      }
    });

    // TOC
    currentBook.loaded.navigation.then((nav) => {
      const tocList = document.getElementById('toc-list');
      if (nav && nav.toc && nav.toc.length > 0) {
        tocList.innerHTML = nav.toc.map(item => `
          <a class="toc-item" data-href="${item.href}">${escapeHtml(item.label.trim())}</a>
        `).join('');

        tocList.querySelectorAll('.toc-item').forEach(el => {
          el.addEventListener('click', () => {
            triggerPageTurnAnimation('next');
            currentRendition.display(el.dataset.href);
            toggleSidebar(false);
          });
        });
      }
    });

    // Tablet touch swipe
    let touchStartX = 0;
    currentRendition.on('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    });
    currentRendition.on('touchend', (e) => {
      const diff = e.changedTouches[0].screenX - touchStartX;
      if (diff > 50) turnPage('prev');
      if (diff < -50) turnPage('next');
    });

  } catch (err) {
    showError('Error initializing EPUB reader: ' + err.message);
  }
}

/**
 * PDF Engine
 */
async function initPdfReaderWithBuffer(buffer) {
  try {
    const loadingTask = pdfjsLib.getDocument({ data: buffer });
    pdfDoc = await loadingTask.promise;
    hideLoader();

    renderPdfPage(pdfCurrentPage);

    // Outline
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

async function renderPdfPage(num) {
  if (!pdfDoc) return;
  try {
    const page = await pdfDoc.getPage(num);
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');

    const viewport = page.getViewport({ scale: pdfScale });
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: ctx, viewport }).promise;

    document.getElementById('reader-progress-text').textContent = `Page ${num} of ${pdfDoc.numPages}`;
    const pct = Math.round((num / pdfDoc.numPages) * 100);
    document.getElementById('reader-percentage').textContent = `${pct}%`;
    document.getElementById('progress-bar-fill').style.width = `${pct}%`;
  } catch (e) {
    console.error('PDF render error:', e);
  }
}

window.jumpToPdfPage = function(num) {
  if (num >= 1 && num <= pdfDoc.numPages) {
    triggerPageTurnAnimation(num > pdfCurrentPage ? 'next' : 'prev');
    pdfCurrentPage = num;
    renderPdfPage(pdfCurrentPage);
    toggleSidebar(false);
  }
};

/**
 * 3D Page Turn Animation
 */
function triggerPageTurnAnimation(direction) {
  const pageWrapper = document.getElementById('book-page-wrapper');
  if (!pageWrapper) return;

  const animClass = direction === 'next' ? 'page-turning-next' : 'page-turning-prev';
  pageWrapper.classList.remove('page-turning-next', 'page-turning-prev');
  // force reflow
  void pageWrapper.offsetWidth;
  pageWrapper.classList.add(animClass);

  setTimeout(() => {
    pageWrapper.classList.remove(animClass);
  }, 420);
}

function turnPage(direction) {
  triggerPageTurnAnimation(direction);

  if (currentFormat === 'epub' && currentRendition) {
    if (direction === 'next') currentRendition.next();
    else currentRendition.prev();
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

  // Update active button in menu
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

  try {
    currentRendition.themes.default({
      body: {
        background: `${colors.bg} !important`,
        color: `${colors.text} !important`,
        'font-family': `${readerPrefs.fontFamily} !important`,
        padding: `0 ${readerPrefs.margin} !important`,
        'line-height': '1.65 !important'
      },
      p: {
        'font-family': `${readerPrefs.fontFamily} !important`,
        'line-height': '1.65 !important'
      }
    });
    currentRendition.themes.fontSize(`${readerPrefs.fontSize}%`);
  } catch (e) {
    console.warn('Theme apply warning:', e);
  }
}

/**
 * Navigation & Menu Controls Setup
 */
function setupNavControls() {
  const btnPrev = document.getElementById('btn-nav-prev');
  const btnNext = document.getElementById('btn-nav-next');

  btnPrev.addEventListener('click', () => turnPage('prev'));
  btnNext.addEventListener('click', () => turnPage('next'));

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

  btnPaper.addEventListener('click', (e) => {
    e.stopPropagation();
    paperMenu.classList.toggle('active');
  });

  document.addEventListener('click', (e) => {
    if (!paperMenu.contains(e.target) && e.target !== btnPaper) {
      paperMenu.classList.remove('active');
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
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('reader-sidebar');
  if (typeof forceState === 'boolean') {
    sidebar.classList.toggle('open', forceState);
  } else {
    sidebar.classList.toggle('open');
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
    setTimeout(() => { loader.style.display = 'none'; }, 280);
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
