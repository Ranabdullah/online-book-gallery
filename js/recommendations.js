/**
 * Athenaeum - Recommendations Engine
 * Allows anyone to submit book and author recommendations for future reading.
 * Persists locally in localStorage with export / copy capabilities.
 */

const STORAGE_KEY_RECS = 'athenaeum_recommendations';

// Default curated initial recommendations
const INITIAL_RECOMMENDATIONS = [
  {
    id: 'rec_01',
    title: 'Kafka on the Shore',
    author: 'Haruki Murakami',
    category: 'Fiction',
    notes: 'A masterwork of magical realism, memory, and interconnected souls.',
    recommender: 'Curator',
    date: '2026-09-10'
  },
  {
    id: 'rec_02',
    title: 'Atomic Habits',
    author: 'James Clear',
    category: 'Personal Growth',
    notes: 'Incredible framework for small continuous 1% improvements.',
    recommender: 'Reader',
    date: '2026-09-08'
  },
  {
    id: 'rec_03',
    title: 'Meditations',
    author: 'Marcus Aurelius',
    category: 'Philosophy',
    notes: 'Timeless stoic reflection on duty, resilience, and tranquility.',
    recommender: 'Curator',
    date: '2026-09-05'
  }
];

function getRecommendations() {
  const stored = localStorage.getItem(STORAGE_KEY_RECS);
  if (!stored) {
    localStorage.setItem(STORAGE_KEY_RECS, JSON.stringify(INITIAL_RECOMMENDATIONS));
    return INITIAL_RECOMMENDATIONS;
  }
  try {
    return JSON.parse(stored);
  } catch (e) {
    return INITIAL_RECOMMENDATIONS;
  }
}

function saveRecommendation(rec) {
  const recs = getRecommendations();
  recs.unshift(rec);
  localStorage.setItem(STORAGE_KEY_RECS, JSON.stringify(recs));
  renderRecommendations();
}

function renderRecommendations() {
  const container = document.getElementById('rec-items-container');
  const countSpan = document.getElementById('rec-count');
  if (!container) return;

  const recs = getRecommendations();
  if (countSpan) countSpan.textContent = recs.length;

  if (recs.length === 0) {
    container.innerHTML = '<p style="font-size: 13px; color: var(--text-muted); text-align: center; padding: 16px;">No recommendations yet. Be the first to suggest one!</p>';
    return;
  }

  container.innerHTML = recs.map(r => `
    <div class="rec-item">
      <div class="rec-header">
        <span class="rec-book-title">${escapeHtml(r.title)}</span>
        <span class="cat-pill" style="font-size: 10px; padding: 2px 8px;">${escapeHtml(r.category || 'General')}</span>
      </div>
      <div class="rec-author">by <strong>${escapeHtml(r.author)}</strong></div>
      ${r.notes ? `<p style="font-size: 12.5px; margin-top: 6px; color: #334155;">"${escapeHtml(r.notes)}"</p>` : ''}
      <div class="rec-meta">Suggested by ${escapeHtml(r.recommender || 'Anonymous')} &bull; ${r.date || 'Recent'}</div>
    </div>
  `).join('');
}

function copyRecommendations() {
  const recs = getRecommendations();
  if (recs.length === 0) {
    alert('No recommendations to copy.');
    return;
  }
  const text = recs.map((r, i) => `${i + 1}. "${r.title}" by ${r.author} (${r.category || 'General'})${r.notes ? ` - ${r.notes}` : ''}`).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    alert('Recommendations copied to clipboard!');
  }).catch(() => {
    alert('Failed to copy to clipboard.');
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', () => {
  const recModal = document.getElementById('rec-modal');
  const btnOpen = document.getElementById('btn-recommend-modal');
  const btnClose = document.getElementById('rec-modal-close');
  const recForm = document.getElementById('rec-form');
  const btnCopy = document.getElementById('btn-copy-recs');

  if (btnOpen && recModal) {
    btnOpen.addEventListener('click', () => {
      recModal.classList.add('active');
      renderRecommendations();
    });
  }

  if (btnClose && recModal) {
    btnClose.addEventListener('click', () => {
      recModal.classList.remove('active');
    });
  }

  if (recModal) {
    recModal.addEventListener('click', (e) => {
      if (e.target === recModal) {
        recModal.classList.remove('active');
      }
    });
  }

  if (recForm) {
    recForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const title = document.getElementById('rec-title').value.trim();
      const author = document.getElementById('rec-author').value.trim();
      const category = document.getElementById('rec-category').value;
      const notes = document.getElementById('rec-notes').value.trim();
      const name = document.getElementById('rec-name').value.trim() || 'Book Enthusiast';

      if (!title || !author) {
        alert('Please provide both book title and author.');
        return;
      }

      const newRec = {
        id: 'rec_' + Date.now(),
        title,
        author,
        category,
        notes,
        recommender: name,
        date: new Date().toISOString().split('T')[0]
      };

      saveRecommendation(newRec);
      recForm.reset();
      alert(`Thank you! "${title}" has been added to the recommendations wishlist.`);
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener('click', copyRecommendations);
  }
});
