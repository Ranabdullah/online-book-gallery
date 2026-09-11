/**
 * Athenaeum - High-Speed EPUB & PDF Unified Reader Engine
 * Supports:
 * - Ultra-fast EPUB rendering with ePub.js
 * - Fast PDF rendering with PDF.js
 * - Reading position persistence (localStorage)
 * - White / Sepia / Dark themes
 * - Font scaling & typography adjustments
 * - Touch swipe gestures for tablets
 * - Fullscreen reading mode
 */

// Initialize PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'js/vendor/pdf.worker.min.js';
}

let currentBook = null;
let currentRendition = null;
let currentFormat = null;
let pdfDoc = null;
let pdfCurrentPage = 1;
let pdfScale = 1.2;
let fontSizePercent = 100;
let currentTheme = 'white';

// Parse query params
const urlParams = new URLSearchParams(window.location.search);
const bookUrl = urlParams.get('book');
const isLocal = urlParams.get('local');
const blobUrl = urlParams.get('blob');
const bookTitleParam = urlParams.get('title');

document.addEventListener('DOMContentLoaded', async () => {
  setupThemes();
  setupControls();

  if (isLocal) {
    loadLocalFile();
  } else if (blobUrl) {
    initReader(blobUrl, bookTitleParam || 'Local Book');
  } else if (bookUrl) {
    await initFromCatalog(bookUrl);
  } else {
    showError('No book specified to read. Return to the library to choose a book.');
  }
});

async function initFromCatalog(url) {
  try {
    // Try to get metadata from books.json
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
  } catch (e) {
    console.warn('Could not fetch book metadata:', e);
  }

  initReader(url, url.split('/').pop());
}

function loadLocalFile() {
  const fileName = sessionStorage.getItem('athenaeum_local_file_name') || 'Local Book';
  const fileData = sessionStorage.getItem('athenaeum_local_file_data');

  if (!fileData) {
    showError('Could not load local file data. Please try selecting it again from the library.');
    return;
  }

  document.getElementById('reader-book-title').textContent = fileName;
  document.title = `${fileName} - Athenaeum Reader`;

  initReader(fileData, fileName);
}

function initReader(src, name) {
  const isPdf = name.toLowerCase().endsWith('.pdf') || (typeof src === 'string' && src.toLowerCase().includes('.pdf'));

  if (isPdf) {
    currentFormat = 'pdf';
    document.getElementById('epub-controls').style.display = 'none';
    document.getElementById('pdf-controls').style.display = 'flex';
    document.getElementById('epub-viewer').style.display = 'none';
    document.getElementById('pdf-viewer-container').style.display = 'flex';
    initPdfReader(src);
  } else {
    currentFormat = 'epub';
    document.getElementById('epub-controls').style.display = 'flex';
    document.getElementById('pdf-controls').style.display = 'none';
    document.getElementById('epub-viewer').style.display = 'block';
    document.getElementById('pdf-viewer-container').style.display = 'none';
    initEpubReader(src);
  }
}

/**
 * EPUB Reader Engine (ePub.js)
 */
function initEpubReader(src) {
  try {
    currentBook = ePub(src);
    const viewer = document.getElementById('epub-viewer');
    viewer.innerHTML = '';

    currentRendition = currentBook.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'auto'
    });

    // Register themes
    currentRendition.themes.register('white', {
      body: { background: '#ffffff', color: '#1a1a1a', 'font-family': 'Inter, sans-serif', padding: '0 20px' }
    });
    currentRendition.themes.register('sepia', {
      body: { background: '#fbf0d9', color: '#5f4b32', 'font-family': 'Merriweather, serif', padding: '0 20px' }
    });
    currentRendition.themes.register('dark', {
      body: { background: '#121212', color: '#e2e8f0', 'font-family': 'Inter, sans-serif', padding: '0 20px' }
    });
    currentRendition.themes.select(currentTheme);

    // Restore saved position
    const savedCfi = localStorage.getItem(`athenaeum_pos_${src}`);
    if (savedCfi) {
      currentRendition.display(savedCfi);
    } else {
      currentRendition.display();
    }

    // On location change
    currentRendition.on('relocated', (location) => {
      hideLoader();
      if (location && location.start) {
        localStorage.setItem(`athenaeum_pos_${src}`, location.start.cfi);
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

    // Populate TOC
    currentBook.loaded.navigation.then((nav) => {
      const tocList = document.getElementById('toc-list');
      if (nav && nav.toc && nav.toc.length > 0) {
        tocList.innerHTML = nav.toc.map(item => `
          <a class="toc-item" data-href="${item.href}">${escapeHtml(item.label.trim())}</a>
        `).join('');

        tocList.querySelectorAll('.toc-item').forEach(el => {
          el.addEventListener('click', () => {
            currentRendition.display(el.dataset.href);
            toggleSidebar(false);
          });
        });
      }
    });

    // Touch swipe for tablet reading
    let touchStartX = 0;
    currentRendition.on('touchstart', (e) => {
      touchStartX = e.changedTouches[0].screenX;
    });
    currentRendition.on('touchend', (e) => {
      const touchEndX = e.changedTouches[0].screenX;
      const diff = touchEndX - touchStartX;
      if (diff > 50) currentRendition.prev();
      if (diff < -50) currentRendition.next();
    });

  } catch (err) {
    showError('Error initializing EPUB reader: ' + err.message);
  }
}

/**
 * PDF Reader Engine (PDF.js)
 */
async function initPdfReader(src) {
  try {
    const loadingTask = pdfjsLib.getDocument(src);
    pdfDoc = await loadingTask.promise;
    hideLoader();

    // Render first page
    renderPdfPage(pdfCurrentPage);

    // Update footer
    document.getElementById('reader-progress-text').textContent = `Page 1 of ${pdfDoc.numPages}`;
    document.getElementById('reader-percentage').textContent = `${Math.round((1 / pdfDoc.numPages) * 100)}%`;
    document.getElementById('progress-bar-fill').style.width = `${(1 / pdfDoc.numPages) * 100}%`;

    // Outline / TOC
    try {
      const outline = await pdfDoc.getOutline();
      const tocList = document.getElementById('toc-list');
      if (outline && outline.length > 0) {
        tocList.innerHTML = outline.map(item => `
          <a class="toc-item" data-dest="${escapeHtml(JSON.stringify(item.dest))}">${escapeHtml(item.title)}</a>
        `).join('');
      } else {
        // Generate simple page list
        let pagesHtml = '';
        for (let i = 1; i <= Math.min(pdfDoc.numPages, 100); i++) {
          pagesHtml += `<a class="toc-item" onclick="jumpToPdfPage(${i})">Page ${i}</a>`;
        }
        tocList.innerHTML = pagesHtml;
      }
    } catch (tocErr) {}

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

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    await page.render(renderContext).promise;

    // Update progress
    document.getElementById('reader-progress-text').textContent = `Page ${num} of ${pdfDoc.numPages}`;
    const pct = Math.round((num / pdfDoc.numPages) * 100);
    document.getElementById('reader-percentage').textContent = `${pct}%`;
    document.getElementById('progress-bar-fill').style.width = `${pct}%`;
  } catch (e) {
    console.error('PDF Page render error:', e);
  }
}

window.jumpToPdfPage = function(num) {
  if (num >= 1 && num <= pdfDoc.numPages) {
    pdfCurrentPage = num;
    renderPdfPage(pdfCurrentPage);
    toggleSidebar(false);
  }
};

/**
 * Controls & Navigation
 */
function setupControls() {
  const btnPrev = document.getElementById('btn-nav-prev');
  const btnNext = document.getElementById('btn-nav-next');

  btnPrev.addEventListener('click', () => {
    if (currentFormat === 'epub' && currentRendition) {
      currentRendition.prev();
    } else if (currentFormat === 'pdf' && pdfDoc && pdfCurrentPage > 1) {
      pdfCurrentPage--;
      renderPdfPage(pdfCurrentPage);
    }
  });

  btnNext.addEventListener('click', () => {
    if (currentFormat === 'epub' && currentRendition) {
      currentRendition.next();
    } else if (currentFormat === 'pdf' && pdfDoc && pdfCurrentPage < pdfDoc.numPages) {
      pdfCurrentPage++;
      renderPdfPage(pdfCurrentPage);
    }
  });

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') btnPrev.click();
    if (e.key === 'ArrowRight') btnNext.click();
  });

  // Font resize (EPUB)
  document.getElementById('btn-font-smaller').addEventListener('click', () => {
    fontSizePercent = Math.max(70, fontSizePercent - 10);
    if (currentRendition) currentRendition.themes.fontSize(`${fontSizePercent}%`);
  });

  document.getElementById('btn-font-larger').addEventListener('click', () => {
    fontSizePercent = Math.min(200, fontSizePercent + 10);
    if (currentRendition) currentRendition.themes.fontSize(`${fontSizePercent}%`);
  });

  // PDF Zoom
  document.getElementById('btn-pdf-zoom-out').addEventListener('click', () => {
    pdfScale = Math.max(0.6, pdfScale - 0.2);
    renderPdfPage(pdfCurrentPage);
  });

  document.getElementById('btn-pdf-zoom-in').addEventListener('click', () => {
    pdfScale = Math.min(3.0, pdfScale + 0.2);
    renderPdfPage(pdfCurrentPage);
  });

  // Sidebar toggle
  document.getElementById('btn-toc-toggle').addEventListener('click', () => {
    toggleSidebar();
  });
  document.getElementById('btn-sidebar-close').addEventListener('click', () => {
    toggleSidebar(false);
  });

  // Fullscreen
  document.getElementById('btn-fullscreen').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}

function toggleSidebar(forceState) {
  const sidebar = document.getElementById('reader-sidebar');
  if (typeof forceState === 'boolean') {
    sidebar.classList.toggle('open', forceState);
  } else {
    sidebar.classList.toggle('open');
  }
}

/**
 * Themes
 */
function setupThemes() {
  const btnTheme = document.getElementById('btn-theme-toggle');
  const themes = ['white', 'sepia', 'dark'];

  btnTheme.addEventListener('click', () => {
    const nextIdx = (themes.indexOf(currentTheme) + 1) % themes.length;
    currentTheme = themes[nextIdx];
    document.body.setAttribute('data-theme', currentTheme);

    if (currentRendition) {
      currentRendition.themes.select(currentTheme);
    }
  });
}

function hideLoader() {
  const loader = document.getElementById('reader-loader');
  if (loader) {
    loader.style.opacity = '0';
    setTimeout(() => { loader.style.display = 'none'; }, 300);
  }
}

function showError(msg) {
  const loader = document.getElementById('reader-loader');
  if (loader) {
    loader.innerHTML = `
      <div style="text-align: center; padding: 20px; max-width: 400px;">
        <div style="font-size: 32px; margin-bottom: 12px;">⚠️</div>
        <p style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Reader Notice</p>
        <p style="font-size: 13px; color: var(--text-muted); line-height: 1.4; margin-bottom: 16px;">${escapeHtml(msg)}</p>
        <a href="index.html" class="btn btn-primary" style="display: inline-block;">Back to Library</a>
      </div>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
