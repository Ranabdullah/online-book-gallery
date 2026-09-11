/**
 * Athenaeum - Book Auto-Cataloging & Management Engine
 * - Parses EPUB & PDF metadata directly in the browser
 * - Extracts covers or generates high-res canvas covers
 * - Manages book additions and metadata/cover edits
 */

async function processAndAddBook(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const bookId = 'user_book_' + Date.now();
  const arrayBuffer = await file.arrayBuffer();

  let title = cleanFileName(file.name);
  let author = 'Unknown Author';
  let category = 'Classics & Literature';
  let coverDataUrl = null;

  if (ext === 'epub') {
    try {
      const zip = await JSZip.loadAsync(arrayBuffer);
      // Read container.xml
      const containerFile = zip.file('META-INF/container.xml');
      let opfPath = '';
      if (containerFile) {
        const containerXml = await containerFile.async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(containerXml, 'text/xml');
        const rootfile = doc.querySelector('rootfile');
        if (rootfile) opfPath = rootfile.getAttribute('full-path');
      }

      if (!opfPath) {
        // Find any .opf file
        const opfFiles = Object.keys(zip.files).filter(f => f.endsWith('.opf'));
        if (opfFiles.length > 0) opfPath = opfFiles[0];
      }

      if (opfPath && zip.file(opfPath)) {
        const opfXml = await zip.file(opfPath).async('text');
        const parser = new DOMParser();
        const doc = parser.parseFromString(opfXml, 'text/xml');

        // Extract title & author
        const dcTitle = doc.querySelector('title');
        const dcCreator = doc.querySelector('creator');
        const dcSubject = doc.querySelector('subject');

        if (dcTitle && dcTitle.textContent.trim()) title = dcTitle.textContent.trim();
        if (dcCreator && dcCreator.textContent.trim()) author = dcCreator.textContent.trim();
        if (dcSubject && dcSubject.textContent.trim()) category = matchCategory(dcSubject.textContent.trim());

        // Extract cover
        // 1. Check meta cover
        let coverHref = '';
        const metaCover = doc.querySelector('meta[name="cover"]');
        if (metaCover) {
          const coverId = metaCover.getAttribute('content');
          const item = doc.getElementById(coverId) || doc.querySelector(`item[id="${coverId}"]`);
          if (item) coverHref = item.getAttribute('href');
        }

        // 2. Check item with properties="cover-image"
        if (!coverHref) {
          const propItem = doc.querySelector('item[properties="cover-image"]');
          if (propItem) coverHref = propItem.getAttribute('href');
        }

        // Resolve relative path
        if (coverHref) {
          const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
          const fullCoverPath = basePath + coverHref;
          const coverFile = zip.file(fullCoverPath) || zip.file(coverHref);
          if (coverFile) {
            const base64 = await coverFile.async('base64');
            const mime = coverHref.endsWith('.png') ? 'image/png' : 'image/jpeg';
            coverDataUrl = `data:${mime};base64,${base64}`;
          }
        }

        // 3. Fallback: find any image in zip named cover
        if (!coverDataUrl) {
          const imgFiles = Object.keys(zip.files).filter(name => {
            const l = name.toLowerCase();
            return (l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png')) && l.includes('cover');
          });
          if (imgFiles.length > 0) {
            const base64 = await zip.file(imgFiles[0]).async('base64');
            const mime = imgFiles[0].endsWith('.png') ? 'image/png' : 'image/jpeg';
            coverDataUrl = `data:${mime};base64,${base64}`;
          }
        }
      }
    } catch (e) {
      console.warn('Error extracting EPUB metadata:', e);
    }
  } else if (ext === 'pdf') {
    try {
      if (typeof pdfjsLib !== 'undefined') {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdfDoc = await loadingTask.promise;
        
        // Render 1st page to canvas for cover
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        coverDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // Extract metadata
        const meta = await pdfDoc.getMetadata();
        if (meta && meta.info) {
          if (meta.info.Title && meta.info.Title.trim()) title = meta.info.Title.trim();
          if (meta.info.Author && meta.info.Author.trim()) author = meta.info.Author.trim();
        }
      }
    } catch (e) {
      console.warn('Error extracting PDF metadata:', e);
    }
  }

  // If still no cover, generate clean typography cover
  if (!coverDataUrl) {
    category = determineCategoryByName(title, author);
    coverDataUrl = generateCanvasCover(title, author, category);
  } else {
    category = determineCategoryByName(title, author);
  }

  const sizeMB = parseFloat((file.size / (1024 * 1024)).toFixed(2));

  const newBook = {
    id: bookId,
    title,
    author,
    category,
    format: ext.toUpperCase(),
    sizeMB,
    cover: coverDataUrl,
    isHosted: true,
    file: `idb://${bookId}`,
    originalName: file.name,
    isUserAdded: true,
    fileData: arrayBuffer,
    addedAt: Date.now()
  };

  await window.AthenaeumDB.saveUserBook(newBook);
  window.dispatchEvent(new CustomEvent('athenaeum:book-added', { detail: newBook }));
  return newBook;
}

function cleanFileName(filename) {
  return filename
    .replace(/\.(epub|pdf|mobi)$/i, '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/[_\-]+/g, ' ')
    .trim();
}

function determineCategoryByName(title, author) {
  const text = `${title} ${author}`.toLowerCase();
  if (text.includes('freud') || text.includes('nietzsche') || text.includes('plato') || text.includes('philosophy') || text.includes('psychology')) return 'Philosophy & Psychology';
  if (text.includes('potter') || text.includes('witcher') || text.includes('tolkien') || text.includes('fantasy') || text.includes('dragon')) return 'Fantasy & Adventure';
  if (text.includes('orwell') || text.includes('sci-fi') || text.includes('robot') || text.includes('galaxy') || text.includes('space')) return 'Sci-Fi & Dystopian';
  if (text.includes('art') || text.includes('drawing') || text.includes('paint') || text.includes('blender') || text.includes('animation') || text.includes('sketch')) return 'Art, Drawing & Animation';
  if (text.includes('photo') || text.includes('camera') || text.includes('design')) return 'Photography & Design';
  if (text.includes('science') || text.includes('physics') || text.includes('biology') || text.includes('evolution') || text.includes('eyewitness')) return 'Science & Non-Fiction';
  if (text.includes('myth') || text.includes('norse') || text.includes('god') || text.includes('greek')) return 'Mythology & Folklore';
  if (text.includes('habit') || text.includes('money') || text.includes('rich') || text.includes('wealth') || text.includes('secret')) return 'Personal Growth & Finance';
  if (text.includes('writing') || text.includes('essay') || text.includes('grammar') || text.includes('english')) return 'Writing, Language & Reference';
  return 'Fiction & Modern Novels';
}

function matchCategory(subject) {
  const s = subject.toLowerCase();
  if (s.includes('fiction')) return 'Fiction & Modern Novels';
  if (s.includes('fantasy')) return 'Fantasy & Adventure';
  if (s.includes('philosophy') || s.includes('psychology')) return 'Philosophy & Psychology';
  if (s.includes('science')) return 'Science & Non-Fiction';
  if (s.includes('art')) return 'Art, Drawing & Animation';
  return 'Classics & Literature';
}

function generateCanvasCover(title, author, category) {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');

  // Colors
  const palettes = {
    'Philosophy & Psychology': { bg: '#F5F3EF', text: '#334155', accent: '#64748B' },
    'Fantasy & Adventure': { bg: '#EFF6FF', text: '#1E3A8A', accent: '#3B82F6' },
    'Classics & Literature': { bg: '#F8F7F4', text: '#312E81', accent: '#6366F1' },
    'Sci-Fi & Dystopian': { bg: '#F3F4F6', text: '#111827', accent: '#4B5563' },
    'Fiction & Modern Novels': { bg: '#FFF1F2', text: '#881337', accent: '#F43F5E' },
    'Art, Drawing & Animation': { bg: '#ECFDF5', text: '#064E3B', accent: '#10B981' },
    'Photography & Design': { bg: '#F8FAFC', text: '#0F172A', accent: '#64748B' },
    'Science & Non-Fiction': { bg: '#F0F9FF', text: '#0C4A6E', accent: '#0EA5E9' },
    'Mythology & Folklore': { bg: '#FEF3C7', text: '#78350F', accent: '#D97706' },
    'Personal Growth & Finance': { bg: '#F0FDF4', text: '#14532D', accent: '#22C55E' },
    'Writing, Language & Reference': { bg: '#F8FAFC', text: '#1E293B', accent: '#64748B' }
  };

  const p = palettes[category] || { bg: '#F8F7F4', text: '#0F172A', accent: '#64748B' };

  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, 400, 600);

  // Borders
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.strokeRect(20, 20, 360, 560);
  ctx.strokeStyle = '#F1F5F9';
  ctx.lineWidth = 1;
  ctx.strokeRect(26, 26, 348, 548);

  // Category Tag
  ctx.fillStyle = p.accent;
  ctx.font = '600 11px sans-serif';
  ctx.letterSpacing = '1px';
  ctx.fillText(category.toUpperCase().slice(0, 32), 44, 60);

  // Title
  ctx.fillStyle = p.text;
  ctx.font = 'bold 22px Georgia, serif';
  const words = title.split(' ');
  let line = '';
  let y = 170;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    if (metrics.width > 310 && n > 0) {
      ctx.fillText(line.trim(), 44, y);
      line = words[n] + ' ';
      y += 32;
      if (y > 320) break;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line.trim(), 44, y);

  // Divider
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(44, y + 24);
  ctx.lineTo(104, y + 24);
  ctx.stroke();

  // Author
  ctx.fillStyle = p.accent;
  ctx.font = '600 11px sans-serif';
  ctx.fillText('AUTHOR', 44, 500);

  ctx.fillStyle = p.text;
  ctx.font = 'bold 16px Georgia, serif';
  ctx.fillText(author.slice(0, 32), 44, 525);

  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Auto-optimizes any uploaded cover image to standard dimensions (400x600)
 * and exports as lightweight, crisp JPEG (~60 KB) to ensure instant saving.
 */
async function optimizeCoverImage(source, maxWidth = 400, maxHeight = 600) {
  return new Promise((resolve, reject) => {
    let src = '';
    let isObjectUrl = false;
    if (typeof source === 'string') {
      src = source;
    } else if (source instanceof File || source instanceof Blob) {
      src = URL.createObjectURL(source);
      isObjectUrl = true;
    } else {
      return reject(new Error('Invalid image source'));
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = maxWidth;
        canvas.height = maxHeight;
        const ctx = canvas.getContext('2d');

        const imgAspect = img.width / img.height;
        const targetAspect = maxWidth / maxHeight;
        let renderWidth, renderHeight, offsetX, offsetY;

        if (imgAspect > targetAspect) {
          renderHeight = maxHeight;
          renderWidth = maxHeight * imgAspect;
          offsetX = -(renderWidth - maxWidth) / 2;
          offsetY = 0;
        } else {
          renderWidth = maxWidth;
          renderHeight = maxWidth / imgAspect;
          offsetX = 0;
          offsetY = -(renderHeight - maxHeight) / 2;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, maxWidth, maxHeight);
        ctx.drawImage(img, offsetX, offsetY, renderWidth, renderHeight);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
        if (isObjectUrl) URL.revokeObjectURL(src);
        resolve(dataUrl);
      } catch (err) {
        if (isObjectUrl) URL.revokeObjectURL(src);
        resolve(typeof source === 'string' ? source : null);
      }
    };

    img.onerror = () => {
      if (isObjectUrl) URL.revokeObjectURL(src);
      if (typeof source === 'string') resolve(source);
      else reject(new Error('Failed to load image'));
    };

    img.src = src;
  });
}

window.BookManager = {
  processAndAddBook,
  generateCanvasCover,
  optimizeCoverImage
};
