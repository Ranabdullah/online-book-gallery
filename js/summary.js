/**
 * Athenaeum - AI Book Summary panel (reader.html only)
 *
 * Adds a floating "Summary" button. Calls the generateSummary Cloud
 * Function (Gemini under the hood, cached in Firestore after the first
 * generation). Defaults to the LONG summary; short/long toggle included.
 */

(function () {
  function getBookId() {
    // reader.js exposes bookUrl / currentBookIdentifier as globals, e.g.
    // "books/book_0001.pdf" -> "book_0001"
    const src = (typeof bookUrl !== 'undefined' && bookUrl) ||
                (typeof currentBookIdentifier !== 'undefined' && currentBookIdentifier) || '';
    const match = src.match(/book_\d+/);
    return match ? match[0] : null;
  }

  function buildUI() {
    const btn = document.createElement('button');
    btn.id = 'summary-fab';
    btn.textContent = '📝 Summary';
    btn.style.cssText = `
      position: fixed; bottom: 20px; left: 20px; z-index: 9000;
      background: #2563eb; color: #fff; border: none; border-radius: 999px;
      padding: 10px 16px; font-size: 13px; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.3);
    `;

    const panel = document.createElement('div');
    panel.id = 'summary-panel';
    panel.style.cssText = `
      position: fixed; inset: 0; z-index: 9001; display: none;
      background: rgba(0,0,0,.6); align-items: center; justify-content: center;
    `;
    panel.innerHTML = `
      <div style="background:#161b22;color:#eee;max-width:560px;width:90%;max-height:80vh;
                  overflow:auto;border-radius:12px;padding:20px;font-family:Inter,system-ui,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <h3 style="margin:0;font-size:16px;">Book Summary</h3>
          <button id="summary-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;">✕</button>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px;">
          <button class="summary-len-btn" data-len="long" style="flex:1;padding:6px;border-radius:6px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;font-size:12.5px;">Long (default)</button>
          <button class="summary-len-btn" data-len="short" style="flex:1;padding:6px;border-radius:6px;border:1px solid #333;background:transparent;color:#ccc;cursor:pointer;font-size:12.5px;">Short</button>
        </div>
        <div id="summary-body" style="font-size:14px;line-height:1.6;white-space:pre-wrap;">Loading...</div>
      </div>
    `;

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    let currentLength = 'long';

    async function loadSummary(length) {
      currentLength = length;
      panel.querySelectorAll('.summary-len-btn').forEach(b => {
        const active = b.dataset.len === length;
        b.style.background = active ? '#2563eb' : 'transparent';
        b.style.color = active ? '#fff' : '#ccc';
      });
      const body = panel.querySelector('#summary-body');
      body.textContent = 'Generating summary... this can take a bit for longer books.';

      const bookId = getBookId();
      if (!bookId) {
        body.textContent = 'Could not determine which book this is.';
        return;
      }
      try {
        const res = await window.AthenaeumFirebase.workerCall('/generateSummary', { bookId, length });
        body.textContent = res.summary;
      } catch (e) {
        body.textContent = 'Could not generate summary: ' + (e.message || e);
      }
    }

    btn.addEventListener('click', () => {
      panel.style.display = 'flex';
      loadSummary(currentLength);
    });
    panel.querySelector('#summary-close').addEventListener('click', () => {
      panel.style.display = 'none';
    });
    panel.querySelectorAll('.summary-len-btn').forEach(b => {
      b.addEventListener('click', () => loadSummary(b.dataset.len));
    });
  }

  document.addEventListener('DOMContentLoaded', buildUI);
})();
