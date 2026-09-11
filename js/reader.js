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
  soundEnabled: localStorage.getItem('athenaeum_sound') !== 'false'
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
  setupCornerCurlGesture();

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
  const stage = document.getElementById('book-stage');
  if (stage) {
    attachTouchAndTapNavigation(stage);
  }

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

    const isMobile = window.innerWidth <= 768;
    currentRendition = currentBook.renderTo('epub-viewer', {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: isMobile ? 'none' : 'auto'
    });

    // Dynamic OCR clean-up filter & responsive mobile touch navigation inside iframe
    currentRendition.hooks.content.register((contents) => {
      cleanRenderedOcrArtifacts(contents.document.body);
      attachTouchAndTapNavigation(contents.document);
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

    const container = document.getElementById('pdf-viewer-container');
    const availWidth = (container ? container.clientWidth : window.innerWidth) - 24;
    const baseViewport = page.getViewport({ scale: 1.0 });
    let effectiveScale = pdfScale;
    if (window.innerWidth <= 768 && baseViewport.width > availWidth && availWidth > 200) {
      effectiveScale = (availWidth / baseViewport.width) * pdfScale;
    }

    const viewport = page.getViewport({ scale: effectiveScale });
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
 * Synthesized Organic Paper Turn Whisper (Web Audio API)
 */
function playPaperTurnSound() {
  if (!readerPrefs.soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!window._athenaeumAudioCtx) {
      window._athenaeumAudioCtx = new AudioContext();
    }
    const ctx = window._athenaeumAudioCtx;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    // Synthesize 180ms organic bandpassed noise for crisp paper glide
    const duration = 0.18;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Filtered noise with slight texture variations
    let lastOut = 0.0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut * 0.4) + (white * 0.6);
      data[i] = lastOut;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = buffer;

    // Bandpass filter to match tactile book paper frequency (800Hz - 2400Hz sweep)
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(1400, ctx.currentTime);
    bandpass.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + duration);
    bandpass.Q.setValueAtTime(1.8, ctx.currentTime);

    // Natural attack & decay envelope
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.09, ctx.currentTime + 0.025);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    noiseSource.connect(bandpass);
    bandpass.connect(gainNode);
    gainNode.connect(ctx.destination);

    noiseSource.start();
  } catch (err) {
    // Audio contexts may require initial user gesture
  }
}

/**
 * Authentic 3D Page Curl & Turning Engine
 */
let isPageTurnActive = false;

function executeRealisticPageCurl(direction) {
  if (isPageTurnActive) return;
  isPageTurnActive = true;

  const overlay = document.getElementById('page-curl-overlay');
  const curlClass = direction === 'next' ? 'curling-forward' : 'curling-backward';

  // Play realistic paper rustle sound
  playPaperTurnSound();

  if (overlay) {
    overlay.classList.remove('curling-forward', 'curling-backward', 'active');
    void overlay.offsetWidth; // Trigger reflow
    overlay.classList.add('active', curlClass);

    // Advance underlying content at midpoint of curl fold
    setTimeout(() => {
      advanceReaderPage(direction);
    }, 190);

    // Reset overlay after 3D curl clears
    setTimeout(() => {
      overlay.classList.remove('active', curlClass);
      isPageTurnActive = false;
    }, 540);
  } else {
    advanceReaderPage(direction);
    isPageTurnActive = false;
  }
}

function advanceReaderPage(direction) {
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

function turnPage(direction) {
  executeRealisticPageCurl(direction);
}

/**
 * Interactive Corner Peel & Tactile Drag Gesture
 */
function setupCornerCurlGesture() {
  const hint = document.getElementById('corner-curl-hint');
  if (!hint) return;

  let isDragging = false;
  let startX = 0, startY = 0;
  let totalDragDist = 0;

  const handleStart = (clientX, clientY) => {
    isDragging = true;
    startX = clientX;
    startY = clientY;
    totalDragDist = 0;
  };

  const handleMove = (clientX, clientY) => {
    if (!isDragging) return;
    const dx = startX - clientX;
    const dy = startY - clientY;
    const pull = Math.max(0, (dx + dy) / 2);
    totalDragDist = pull;

    const overlay = document.getElementById('page-curl-overlay');
    const leaf = document.getElementById('curl-leaf');
    const shadow = document.getElementById('curl-cast-shadow');

    if (overlay && leaf && pull > 12) {
      overlay.classList.add('active');
      const progress = Math.min(pull / 260, 0.42);
      const rotY = progress * 70;
      const transX = progress * 30;
      const transY = progress * 18;
      leaf.style.transform = `rotate3d(-0.85, 1, 0.15, ${rotY}deg) translate3d(-${transX}%, -${transY}%, 38px)`;
      if (shadow) {
        shadow.style.opacity = `${progress * 2.2}`;
        shadow.style.background = `radial-gradient(ellipse at 80% 82%, rgba(0, 0, 0, 0.32) 0%, rgba(0, 0, 0, 0.1) 45%, transparent 70%)`;
      }
    }
  };

  const handleEnd = () => {
    if (!isDragging) return;
    isDragging = false;

    const overlay = document.getElementById('page-curl-overlay');
    const leaf = document.getElementById('curl-leaf');
    const shadow = document.getElementById('curl-cast-shadow');

    if (leaf) leaf.style.transform = '';
    if (shadow) {
      shadow.style.opacity = '';
      shadow.style.background = '';
    }

    if (totalDragDist > 65) {
      if (overlay) overlay.classList.remove('active');
      turnPage('next');
    } else {
      if (overlay) overlay.classList.remove('active');
    }
    totalDragDist = 0;
  };

  hint.addEventListener('pointerdown', (e) => {
    handleStart(e.clientX, e.clientY);
  });

  document.addEventListener('pointermove', (e) => {
    if (isDragging) handleMove(e.clientX, e.clientY);
  });

  document.addEventListener('pointerup', handleEnd);
  document.addEventListener('pointercancel', handleEnd);

  hint.addEventListener('click', (e) => {
    if (totalDragDist < 10) turnPage('next');
  });
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

  try {
    currentRendition.themes.default({
      body: {
        background: `${colors.bg} !important`,
        color: `${colors.text} !important`,
        'font-family': `${readerPrefs.fontFamily} !important`,
        padding: `0 ${effectiveMargin} !important`,
        'line-height': effectiveLineHeight
      },
      p: {
        'font-family': `${readerPrefs.fontFamily} !important`,
        'line-height': effectiveLineHeight
      }
    });
    currentRendition.themes.fontSize(`${readerPrefs.fontSize}%`);
  } catch (e) {
    console.warn('Theme apply warning:', e);
  }
}

/**
 * Dynamic OCR Text Cleanup Filter (Runtime Layer)
 */
function cleanRenderedOcrArtifacts(rootNode) {
  if (!rootNode) return;
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
  let node;
  const replacements = [
    [/\bBrave\s+Ne\s*w\s+World\b/g, 'Brave New World'],
    [/\bNe\s+w\b/g, 'New'],
    [/\bne\s+w\b/g, 'new'],
    [/\bChapte\s+r\b/g, 'Chapter'],
    [/\bchapte\s+r\b/g, 'chapter'],
    [/\bgre\s+y\b/g, 'grey'],
    [/\bOve\s+r\b/g, 'Over'],
    [/\bove\s+r\b/g, 'over'],
    [/\bm\s+a\s+in\b/g, 'main'],
    [/\be\s+ntra\s+nce\b/g, 'entrance'],
    [/\be\s+nte\s+re\s+d\b/g, 'entered'],
    [/\be\s+norm\s+ous\b/g, 'enormous'],
    [/\ba\s+nd\b/g, 'and'],
    [/\ba\s+ll\b/g, 'all'],
    [/\ba\s+t\b/g, 'at'],
    [/\ba\s+s\b/g, 'as'],
    [/\ba\s+n\b/g, 'an'],
    [/\bm\s+otto\b/g, 'motto'],
    [/\bSta\s+te\b/g, 'State'],
    [/\bsta\s+te\b/g, 'state'],
    [/\bbe\s+yond\b/g, 'beyond'],
    [/\bsa\s+id\b/g, 'said'],
    [/\bgre\s*a\s*t\s+m\s*a\s*n\b/g, 'great man'],
    [/\bgre\s*a\s*t\b/g, 'great'],
    [/\bGre\s*a\s*t\b/g, 'Great'],
    [/\bstude\s*nts\b/g, 'students'],
    [/\bde\s*pa\s*rtm\s*e\s*nts\b/g, 'departments'],
    [/\bm\s+out\s*h\b/g, 'mouth'],
    [/\bhe\s+a\s+t\b/g, 'heat'],
    [/\bhe\s+at\b/g, 'heat'],
    [/\bitse\s+lf\b/g, 'itself'],
    [/\b([A-Za-z]+)\s+'([stdm]|ll|re|ve)\b/g, "$1'$2"],
    [/\b([A-Za-z]+'s)([A-Za-z]+)\b/g, '$1 $2'],
    [/\s+([,.:;?!])/g, '$1'],
    [/[ \t]{2,}/g, ' ']
  ];

  while ((node = walker.nextNode())) {
    let val = node.nodeValue;
    if (!val || val.trim().length === 0) continue;
    let changed = false;
    for (const [pat, rep] of replacements) {
      if (pat.test(val)) {
        val = val.replace(pat, rep);
        changed = true;
      }
    }
    if (changed) {
      node.nodeValue = val;
    }
  }
}

/**
 * Responsive Touch Swipe & Edge Tap Navigation
 */
function attachTouchAndTapNavigation(target) {
  if (!target || target._hasTouchNav) return;
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

  // Page Turn Sound Toggle
  const soundToggle = document.getElementById('sound-toggle');
  if (soundToggle) {
    soundToggle.checked = readerPrefs.soundEnabled;
    soundToggle.addEventListener('change', (e) => {
      readerPrefs.soundEnabled = e.target.checked;
      localStorage.setItem('athenaeum_sound', readerPrefs.soundEnabled ? 'true' : 'false');
      if (readerPrefs.soundEnabled) playPaperTurnSound();
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
