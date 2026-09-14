/**
 * Athenaeum AI Book Intelligence & Study Suite Engine
 * Handles literary dossier rendering, dynamic AI analysis, audio pronunciation,
 * vocabulary flashcards, and interactive scholar Q&A.
 */

let currentBookId = null;
let currentBookMeta = null;
let currentDossier = null;
let flashcardList = [];
let currentFlashcardIndex = 0;

document.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  currentBookId = urlParams.get('id') || urlParams.get('book');

  if (!currentBookId) {
    showFatalError('No book specified for intelligence analysis.');
    return;
  }

  // Normalize book ID if full path was provided (e.g. books/book_0152.epub -> book_0152)
  if (currentBookId.includes('/')) {
    const filename = currentBookId.split('/').pop();
    currentBookId = filename.replace(/\.[^/.]+$/, '');
  }

  setupNavTabs();
  setupVocabularyDrawer();
  setupScholarChat();
  setupFlashcards();
  setupRefreshDossierButton();
  updateVocabBadge();

  await loadBookAndDossier(currentBookId);
});

/**
 * Data Loading Engine
 */
async function loadBookAndDossier(bookId) {
  const loader = document.getElementById('analysis-loader');
  const hero = document.getElementById('analysis-hero');
  const nav = document.getElementById('analysis-nav');
  const content = document.getElementById('analysis-content');

  try {
    // 1. Fetch Catalog metadata
    let books = [];
    try {
      const resp = await fetch('data/books.json');
      if (resp.ok) books = await resp.json();
    } catch (e) {}

    currentBookMeta = books.find(b => b.id === bookId || b.file === bookId || b.file === `books/${bookId}.epub`);
    if (!currentBookMeta && window.AthenaeumDB) {
      currentBookMeta = await window.AthenaeumDB.getUserBookById(bookId);
    }

    if (!currentBookMeta) {
      currentBookMeta = {
        id: bookId,
        title: bookId.replace(/_/g, ' '),
        author: 'Classic Author',
        category: 'Literature',
        file: `books/${bookId}.epub`
      };
    }

    // 2. Check for cached or pre-compiled Dossier
    let dossier = null;
    if (window.AthenaeumDB) {
      dossier = await window.AthenaeumDB.getBookAnalysis(bookId);
    }

    if (!dossier) {
      try {
        const resp = await fetch(`data/analyses/${bookId}.json`);
        if (resp.ok) {
          dossier = await resp.json();
        }
      } catch (e) {}
    }

    // If still no dossier, generate dynamic intelligent analysis
    if (!dossier) {
      dossier = generateDynamicDossier(currentBookMeta);
      if (window.AthenaeumDB) {
        window.AthenaeumDB.saveBookAnalysis(bookId, dossier);
      }
    }

    currentDossier = dossier;

    // Render Dossier into DOM
    renderDossier(dossier, currentBookMeta);

    if (loader) loader.style.display = 'none';
    if (hero) hero.style.display = 'flex';
    if (nav) nav.style.display = 'flex';
    if (content) content.style.display = 'block';

  } catch (err) {
    console.error('Failed to load book intelligence:', err);
    showFatalError('Failed to assemble book intelligence dossier: ' + err.message);
  }
}

/**
 * DOM Rendering
 */
function renderDossier(dossier, meta) {
  // Topbar
  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.textContent = `${meta.title} - AI Intelligence`;
  document.title = `${meta.title} - AI Book Intelligence | Athenaeum`;

  const readUrl = meta.file ? `reader.html?book=${encodeURIComponent(meta.file)}&title=${encodeURIComponent(meta.title)}` : '#';
  const readBtnTop = document.getElementById('btn-read-now-top');
  const readBtnHero = document.getElementById('btn-read-hero');
  if (readBtnTop) readBtnTop.href = readUrl;
  if (readBtnHero) readBtnHero.href = readUrl;

  // Hero Section
  const coverImg = document.getElementById('hero-cover');
  if (coverImg) {
    coverImg.src = meta.cover || 'covers/default.jpg';
    coverImg.alt = meta.title;
  }

  const heroTitle = document.getElementById('hero-title');
  if (heroTitle) heroTitle.textContent = meta.title;

  const heroAuthor = document.getElementById('hero-author');
  if (heroAuthor) heroAuthor.textContent = meta.author ? `by ${meta.author}` : '';

  const badgeGenre = document.getElementById('badge-genre');
  if (badgeGenre) badgeGenre.textContent = dossier.genre || meta.category || 'Literature';

  const badgeDiff = document.getElementById('badge-difficulty');
  if (badgeDiff) badgeDiff.textContent = dossier.difficultyLevel || 'Elevated Reading';

  const badgeTime = document.getElementById('badge-time');
  if (badgeTime) {
    const mins = dossier.readingTimeMinutes || 300;
    const hrs = Math.round(mins / 60);
    badgeTime.textContent = `~${hrs} hrs read`;
  }

  const heroThesis = document.getElementById('hero-thesis');
  if (heroThesis) {
    heroThesis.textContent = dossier.whatTheBookSays ? dossier.whatTheBookSays.coreThesis : (dossier.summary || 'A profound exploration of human existence.');
  }

  // Tab 1: Summary
  const summaryElevator = document.getElementById('summary-elevator');
  if (summaryElevator) {
    summaryElevator.textContent = (dossier.comprehensiveSummary && dossier.comprehensiveSummary.elevatorPitch) ? dossier.comprehensiveSummary.elevatorPitch : (dossier.whatTheBookSays?.premise || '');
  }

  const actsContainer = document.getElementById('summary-acts-container');
  if (actsContainer && dossier.comprehensiveSummary && dossier.comprehensiveSummary.acts) {
    actsContainer.innerHTML = dossier.comprehensiveSummary.acts.map(act => `
      <div class="act-card">
        <h4 class="act-title">${escapeHtml(act.act)}</h4>
        <div class="act-chapters">${escapeHtml(act.chapters || '')}</div>
        <p class="act-summary">${escapeHtml(act.summary)}</p>
        <div class="act-tags">
          ${(act.keyThemes || []).map(t => `<span class="act-tag">${escapeHtml(t)}</span>`).join('')}
        </div>
      </div>
    `).join('');
  }

  const conclusionsList = document.getElementById('summary-conclusions');
  if (conclusionsList && dossier.comprehensiveSummary && dossier.comprehensiveSummary.moralConclusions) {
    conclusionsList.innerHTML = dossier.comprehensiveSummary.moralConclusions.map(c => `
      <li>${escapeHtml(c)}</li>
    `).join('');
  }

  // Tab 2: Writing Style
  if (dossier.writingStyle) {
    const styleVoice = document.getElementById('style-voice');
    if (styleVoice) styleVoice.textContent = dossier.writingStyle.voice || '';

    const styleTone = document.getElementById('style-tone');
    if (styleTone) styleTone.textContent = dossier.writingStyle.tonalSpectrum || '';

    const styleMontage = document.getElementById('style-montage');
    if (styleMontage && dossier.writingStyle.cinematicMontage) {
      styleMontage.innerHTML = `<strong>Narrative Technique:</strong> ${escapeHtml(dossier.writingStyle.cinematicMontage)}`;
    }

    const symbolismGrid = document.getElementById('style-symbolism');
    if (symbolismGrid && dossier.writingStyle.symbolism) {
      symbolismGrid.innerHTML = Object.entries(dossier.writingStyle.symbolism).map(([k, v]) => `
        <div class="symbol-card">
          <div class="symbol-name">${escapeHtml(k)}</div>
          <div class="symbol-desc">${escapeHtml(v)}</div>
        </div>
      `).join('');
    }
  }

  // Tab 3: Grammar & Syntax
  if (dossier.grammarAndLinguisticCharacteristics) {
    const g = dossier.grammarAndLinguisticCharacteristics;
    const gScore = document.getElementById('grammar-score');
    if (gScore) gScore.textContent = `Complexity: ${g.grammaticalComplexityScore || '8.5 / 10'}`;

    const gSyntax = document.getElementById('grammar-syntax');
    if (gSyntax) gSyntax.textContent = g.syntaxArchitecture || 'Balanced periodic syntax with complex subordination.';

    const gDiction = document.getElementById('grammar-diction');
    if (gDiction) gDiction.textContent = g.dictionProfile || 'Rich literary register with specialized vocabulary.';

    const gNeo = document.getElementById('grammar-neologisms');
    if (gNeo) gNeo.textContent = g.neologismsAndPortmanteaus || 'Stylized idiomatic expressions reflecting the cultural atmosphere.';
  }

  // Tab 4: Topics
  const topicsContainer = document.getElementById('topics-container');
  if (topicsContainer && dossier.topicsDiscussed) {
    topicsContainer.innerHTML = dossier.topicsDiscussed.map(item => `
      <div class="topic-item">
        <div class="topic-title">${escapeHtml(item.topic)}</div>
        <div class="topic-insight">${escapeHtml(item.insight)}</div>
      </div>
    `).join('');
  }

  // Tab 5: Concepts
  const conceptsContainer = document.getElementById('concepts-container');
  if (conceptsContainer && dossier.coreConcepts) {
    conceptsContainer.innerHTML = dossier.coreConcepts.map(c => `
      <div class="concept-card">
        <div class="concept-name">${escapeHtml(c.concept)}</div>
        <div class="concept-desc">${escapeHtml(c.description)}</div>
      </div>
    `).join('');
  }

  // Tab 6: Vocabulary
  renderVocabularyTab(dossier.difficultWordsGlossary || []);

  // Tab 7: Scholar Q&A Prompts
  renderScholarPrompts(dossier.discussionQuestions || []);
}

/**
 * Vocabulary Tab Rendering
 */
async function renderVocabularyTab(words) {
  const container = document.getElementById('vocab-cards-container');
  const tabPill = document.getElementById('vocab-tab-count');
  if (tabPill) tabPill.textContent = words.length;

  if (!container) return;

  // Check which words are already saved in user's vocabulary
  let savedWords = [];
  if (window.AthenaeumDB) {
    savedWords = await window.AthenaeumDB.getAllVocabulary();
  }
  const savedSet = new Set(savedWords.map(w => w.word.toLowerCase()));

  container.innerHTML = words.map(item => {
    const isSaved = savedSet.has(item.word.toLowerCase());
    return `
      <div class="vocab-card" data-word="${escapeHtml(item.word)}">
        <div>
          <div class="vocab-card-header">
            <div>
              <span class="vocab-word">${escapeHtml(item.word)}</span>
              <div class="vocab-phonetics">${escapeHtml(item.phonetics || '')}</div>
            </div>
            <span class="vocab-part">${escapeHtml(item.partOfSpeech || 'noun')}</span>
          </div>
          <p class="vocab-def">${escapeHtml(item.definition)}</p>
          ${item.quote ? `<div class="vocab-quote">“${escapeHtml(item.quote)}”</div>` : ''}
        </div>
        <div class="vocab-footer">
          <button class="btn-pronounce" title="Listen Pronunciation" onclick="pronounceWord('${escapeHtml(item.word)}')">🔊</button>
          <button class="btn-save-vocab ${isSaved ? 'saved' : ''}" onclick="toggleSaveWord(this, ${escapeAttr(JSON.stringify(item))})">
            ${isSaved ? '⭐ In Vocabulary' : '+ Save to Vocab'}
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Vocabulary search filter
  const searchInput = document.getElementById('vocab-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      container.querySelectorAll('.vocab-card').forEach(card => {
        const word = card.dataset.word.toLowerCase();
        card.style.display = word.includes(q) ? 'flex' : 'none';
      });
    });
  }
}

/**
 * Pronounce Word (Text-to-Speech)
 */
window.pronounceWord = function(word) {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.88;
    window.speechSynthesis.speak(utterance);
  }
};

/**
 * Save / Remove Word from Vocabulary Bank
 */
window.toggleSaveWord = async function(btn, item) {
  if (!window.AthenaeumDB) return;

  const isAlreadySaved = btn.classList.contains('saved');
  const wordClean = item.word.trim().toLowerCase();
  const vocabId = `vocab_${wordClean}`;

  if (isAlreadySaved) {
    await window.AthenaeumDB.deleteVocabularyWord(vocabId);
    btn.classList.remove('saved');
    btn.textContent = '+ Save to Vocab';
  } else {
    await window.AthenaeumDB.saveVocabularyWord({
      id: vocabId,
      word: item.word,
      phonetics: item.phonetics,
      partOfSpeech: item.partOfSpeech,
      definition: item.definition,
      example: item.modernEquivalent || item.quote,
      contextSentence: item.quote,
      bookId: currentBookId,
      bookTitle: currentBookMeta ? currentBookMeta.title : 'Book',
      mastery: 'learning'
    });
    btn.classList.add('saved');
    btn.textContent = '⭐ In Vocabulary';
  }

  updateVocabBadge();
};

/**
 * Update Vocabulary Badge Counter
 */
async function updateVocabBadge() {
  if (!window.AthenaeumDB) return;
  const list = await window.AthenaeumDB.getAllVocabulary();
  const badge = document.getElementById('vocab-count-badge');
  const drawerTotal = document.getElementById('drawer-vocab-total');
  if (badge) badge.textContent = list.length;
  if (drawerTotal) drawerTotal.textContent = list.length;
}

/**
 * Vocabulary Drawer
 */
function setupVocabularyDrawer() {
  const btnToggle = document.getElementById('btn-toggle-vocab');
  const btnClose = document.getElementById('btn-close-vocab-drawer');
  const drawer = document.getElementById('vocab-drawer');
  const backdrop = document.getElementById('vocab-drawer-backdrop');

  const toggle = async (open) => {
    const isOpen = typeof open === 'boolean' ? open : !drawer.classList.contains('open');
    drawer.classList.toggle('open', isOpen);
    backdrop.classList.toggle('open', isOpen);
    if (isOpen) {
      await renderVocabularyDrawerList();
    }
  };

  if (btnToggle) btnToggle.addEventListener('click', () => toggle(true));
  if (btnClose) btnClose.addEventListener('click', () => toggle(false));
  if (backdrop) backdrop.addEventListener('click', () => toggle(false));
}

async function renderVocabularyDrawerList() {
  if (!window.AthenaeumDB) return;
  const list = await window.AthenaeumDB.getAllVocabulary();
  const container = document.getElementById('drawer-vocab-list');
  if (!container) return;

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 16px; color: var(--text-muted); font-size: 13px;">
        <div style="font-size: 36px; margin-bottom: 8px;">📖</div>
        <p>No saved vocabulary words yet.</p>
        <p style="font-size: 11.5px; margin-top: 4px;">Click "+ Save to Vocab" on any word card to build your personalized glossary!</p>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(item => `
    <div class="drawer-vocab-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <strong style="font-family: var(--font-serif); font-size: 15px;">${escapeHtml(item.word)}</strong>
          <span style="font-size: 11px; color: var(--text-muted); margin-left: 6px;">${escapeHtml(item.phonetics || '')}</span>
        </div>
        <button onclick="deleteVocabFromDrawer('${escapeHtml(item.id)}')" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 14px;">&times;</button>
      </div>
      <div style="font-size: 11px; color: var(--accent-gold); font-weight: 700; text-transform: uppercase; margin: 2px 0;">${escapeHtml(item.partOfSpeech || '')}</div>
      <p style="font-size: 13px; line-height: 1.45; margin: 4px 0;">${escapeHtml(item.definition)}</p>
      <div style="font-size: 11px; color: var(--text-muted); display: flex; justify-content: space-between; margin-top: 6px;">
        <span>From: <em>${escapeHtml(item.bookTitle || 'Library')}</em></span>
        <button onclick="pronounceWord('${escapeHtml(item.word)}')" style="background: none; border: none; cursor: pointer;">🔊</button>
      </div>
    </div>
  `).join('');
}

window.deleteVocabFromDrawer = async function(id) {
  if (window.AthenaeumDB) {
    await window.AthenaeumDB.deleteVocabularyWord(id);
    await renderVocabularyDrawerList();
    updateVocabBadge();
    // Refresh glossaries
    if (currentDossier) {
      renderVocabularyTab(currentDossier.difficultWordsGlossary || []);
    }
  }
};

/**
 * Flashcard Practice System
 */
function setupFlashcards() {
  const btnStart = document.getElementById('btn-start-flashcards');
  const modalBackdrop = document.getElementById('flashcard-modal-backdrop');
  const btnClose = document.getElementById('btn-close-flashcards');
  const card = document.getElementById('flashcard-card');
  const btnPrev = document.getElementById('fc-btn-prev');
  const btnNext = document.getElementById('fc-btn-next');
  const btnMastered = document.getElementById('fc-btn-mastered');

  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      if (!window.AthenaeumDB) return;
      flashcardList = await window.AthenaeumDB.getAllVocabulary();
      if (flashcardList.length === 0 && currentDossier && currentDossier.difficultWordsGlossary) {
        flashcardList = currentDossier.difficultWordsGlossary;
      }
      if (flashcardList.length === 0) {
        alert('Save some words to your vocabulary first to practice flashcards!');
        return;
      }
      currentFlashcardIndex = 0;
      modalBackdrop.style.display = 'flex';
      renderCurrentFlashcard();
    });
  }

  if (btnClose) btnClose.addEventListener('click', () => modalBackdrop.style.display = 'none');
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) modalBackdrop.style.display = 'none';
    });
  }

  if (card) {
    card.addEventListener('click', () => {
      card.classList.toggle('flipped');
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (flashcardList.length === 0) return;
      currentFlashcardIndex = (currentFlashcardIndex + 1) % flashcardList.length;
      card.classList.remove('flipped');
      renderCurrentFlashcard();
    });
  }

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (flashcardList.length === 0) return;
      currentFlashcardIndex = (currentFlashcardIndex - 1 + flashcardList.length) % flashcardList.length;
      card.classList.remove('flipped');
      renderCurrentFlashcard();
    });
  }

  if (btnMastered) {
    btnMastered.addEventListener('click', async () => {
      const item = flashcardList[currentFlashcardIndex];
      if (item && window.AthenaeumDB) {
        await window.AthenaeumDB.updateWordMastery(item.id, 'mastered');
      }
      if (btnNext) btnNext.click();
    });
  }
}

function renderCurrentFlashcard() {
  if (flashcardList.length === 0) return;
  const item = flashcardList[currentFlashcardIndex];
  const progress = document.getElementById('flashcard-progress');
  const wordEl = document.getElementById('fc-word');
  const phoneticsEl = document.getElementById('fc-phonetics');
  const partEl = document.getElementById('fc-part');
  const defEl = document.getElementById('fc-def');
  const quoteEl = document.getElementById('fc-quote');

  if (progress) progress.textContent = `Word ${currentFlashcardIndex + 1} of ${flashcardList.length}`;
  if (wordEl) wordEl.textContent = item.word;
  if (phoneticsEl) phoneticsEl.textContent = item.phonetics || '';
  if (partEl) partEl.textContent = item.partOfSpeech || 'word';
  if (defEl) defEl.textContent = item.definition || '';
  if (quoteEl) quoteEl.textContent = item.quote ? `“${item.quote}”` : (item.example || '');
}

/**
 * Tab Navigation
 */
function setupNavTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));

      tab.classList.add('active');
      const targetId = `pane-${tab.dataset.tab}`;
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });
}

/**
 * Scholar Q&A Interactive Chat Engine
 */
function setupScholarChat() {
  const form = document.getElementById('scholar-form');
  const input = document.getElementById('scholar-input');
  const chatBox = document.getElementById('scholar-chat-box');

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;

      appendChatMessage('user', question);
      input.value = '';

      // Show typing indicator
      const typingId = 'typing-' + Date.now();
      const typingDiv = document.createElement('div');
      typingDiv.className = 'scholar-message bot';
      typingDiv.id = typingId;
      typingDiv.innerHTML = '<p style="color: #94a3b8; font-style: italic;">✍️ Composing scholarly analysis...</p>';
      if (chatBox) { chatBox.appendChild(typingDiv); chatBox.scrollTop = chatBox.scrollHeight; }

      try {
        // Try Gemini AI first
        const answer = await answerScholarQueryWithAI(question, currentDossier, currentBookMeta);
        document.getElementById(typingId)?.remove();
        appendChatMessage('bot', answer);
      } catch (err) {
        document.getElementById(typingId)?.remove();
        if (err.message === 'NO_KEY') {
          // Prompt for key and retry
          promptForApiKey(async () => {
            const typingDiv2 = document.createElement('div');
            typingDiv2.className = 'scholar-message bot';
            typingDiv2.id = typingId + '2';
            typingDiv2.innerHTML = '<p style="color: #94a3b8; font-style: italic;">✍️ Composing scholarly analysis...</p>';
            if (chatBox) { chatBox.appendChild(typingDiv2); chatBox.scrollTop = chatBox.scrollHeight; }
            try {
              const answer = await answerScholarQueryWithAI(question, currentDossier, currentBookMeta);
              document.getElementById(typingId + '2')?.remove();
              appendChatMessage('bot', answer);
            } catch (e2) {
              document.getElementById(typingId + '2')?.remove();
              appendChatMessage('bot', `Analysis error: ${e2.message}. Please check your API key.`);
            }
          });
        } else {
          appendChatMessage('bot', `I encountered an error: ${err.message}. Please try again.`);
        }
      }
    });
  }
}


function renderScholarPrompts(prompts) {
  const container = document.getElementById('scholar-suggestions');
  if (!container) return;

  container.innerHTML = prompts.slice(0, 3).map(p => `
    <button class="suggestion-btn" onclick="askScholarPrompt(${escapeAttr(JSON.stringify(p))})">${escapeHtml(p)}</button>
  `).join('');
}

window.askScholarPrompt = function(promptText) {
  const input = document.getElementById('scholar-input');
  if (input) {
    input.value = promptText;
    const form = document.getElementById('scholar-form');
    if (form) form.dispatchEvent(new Event('submit'));
  }
};

function appendChatMessage(role, text) {
  const chatBox = document.getElementById('scholar-chat-box');
  if (!chatBox) return;

  const msg = document.createElement('div');
  msg.className = `scholar-message ${role}`;
  msg.innerHTML = `<p>${escapeHtml(text)}</p>`;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}

/**
 * ============================================================
 * GEMINI AI ENGINE — PhD-Level Literary Analysis
 * ============================================================
 */

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

function getGeminiApiKey() {
  return localStorage.getItem('athenaeum_gemini_key') || '';
}

function setGeminiApiKey(key) {
  localStorage.setItem('athenaeum_gemini_key', key.trim());
}

async function callGemini(prompt, systemInstruction) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json'
    }
  };

  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
  }

  const data = await resp.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  try {
    return JSON.parse(text);
  } catch (e) {
    // Try to extract JSON from markdown code blocks
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) return JSON.parse(match[1]);
    throw new Error('Invalid JSON from Gemini: ' + text.slice(0, 200));
  }
}

async function callGeminiText(prompt, systemInstruction) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error('NO_KEY');

  const body = {
    system_instruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.75, maxOutputTokens: 1024 }
  };

  const resp = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Gemini API error ${resp.status}`);
  }

  const data = await resp.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Prompt API Key from the user and save it
 */
function promptForApiKey(onSuccess) {
  let modal = document.getElementById('api-key-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'api-key-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex;
      align-items: center; justify-content: center; z-index: 9999;
    `;
    modal.innerHTML = `
      <div style="background: #fff; border-radius: 14px; padding: 32px 28px; max-width: 440px; width: 90%; box-shadow: 0 24px 60px rgba(0,0,0,0.25); font-family: sans-serif;">
        <div style="font-size: 32px; margin-bottom: 12px;">🔑</div>
        <h2 style="font-size: 18px; font-weight: 700; margin: 0 0 8px;">Gemini API Key Required</h2>
        <p style="font-size: 13px; color: #64748b; line-height: 1.55; margin: 0 0 16px;">
          To generate PhD-level literary analysis, enter your free Gemini API key.<br>
          Get one free at <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:#4f46e5;">aistudio.google.com</a>
        </p>
        <input id="api-key-input" type="password" placeholder="Paste your Gemini API key here..."
          style="width: 100%; box-sizing: border-box; border: 1.5px solid #e2e8f0; border-radius: 8px;
                 padding: 10px 12px; font-size: 13px; margin-bottom: 14px; outline: none;"/>
        <div style="display: flex; gap: 10px;">
          <button id="api-key-save" style="flex: 1; background: #4f46e5; color: white; border: none; border-radius: 8px;
            padding: 10px; font-size: 13px; font-weight: 600; cursor: pointer;">Save & Analyse</button>
          <button id="api-key-cancel" style="background: #f1f5f9; border: none; border-radius: 8px;
            padding: 10px 16px; font-size: 13px; cursor: pointer;">Cancel</button>
        </div>
        <p id="api-key-error" style="color: #ef4444; font-size: 12px; margin: 8px 0 0; display: none;"></p>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('api-key-save').addEventListener('click', () => {
      const key = document.getElementById('api-key-input').value.trim();
      if (!key || key.length < 20) {
        document.getElementById('api-key-error').style.display = 'block';
        document.getElementById('api-key-error').textContent = 'Please enter a valid API key.';
        return;
      }
      setGeminiApiKey(key);
      modal.remove();
      if (onSuccess) onSuccess();
    });

    document.getElementById('api-key-cancel').addEventListener('click', () => modal.remove());

    const existing = getGeminiApiKey();
    if (existing) document.getElementById('api-key-input').value = existing;
  }
}

/**
 * Generate full PhD-level dossier using Gemini AI
 */
async function generateAIDossier(meta) {
  const title = meta.title || 'Unknown Title';
  const author = meta.author || 'Unknown Author';
  const category = meta.category || 'Literature';

  const systemPrompt = `You are a world-class literary scholar with expertise equivalent to a PhD in Comparative Literature and Literary Criticism. You write with the analytical depth of a peer-reviewed academic journal, while remaining engaging and clear. Your analyses are SPECIFIC to the exact book being analyzed — never generic. Always name specific characters, chapters, scenes, motifs, and textual evidence from the actual work.`;

  const prompt = `Produce a comprehensive scholarly literary dossier for the book titled "${title}" by ${author} (genre: ${category}).

Return ONLY a valid JSON object with this exact structure (no markdown, no extra text):

{
  "genre": "Precise literary genre classification",
  "difficultyLevel": "e.g. Scholarly / Advanced Literary / Accessible / Graduate-Level",
  "readingTimeMinutes": 300,
  "whatTheBookSays": {
    "coreThesis": "A 3-4 sentence PhD-level articulation of the book's central philosophical or thematic argument. Name the actual protagonist, central conflict, and what the book ultimately argues or demonstrates about the human condition. Be specific to THIS book.",
    "premise": "2-3 sentences describing the specific narrative world, the protagonist's situation at the outset, and the inciting tension that drives the narrative forward."
  },
  "comprehensiveSummary": {
    "elevatorPitch": "One powerful, specific paragraph (6-8 sentences) that captures the book's essence, key characters, major arc, and lasting significance. This must be specific to '${title}', not generic.",
    "acts": [
      {
        "act": "Part I: [Specific Act Name reflecting actual book content]",
        "chapters": "Chapters/Sections covered",
        "summary": "3-4 detailed sentences covering specific events, character developments, and thematic movements in this section of '${title}'.",
        "keyThemes": ["Specific theme from book", "Another specific theme", "Third theme"]
      },
      {
        "act": "Part II: [Specific Act Name]",
        "chapters": "Chapters/Sections covered",
        "summary": "3-4 detailed sentences covering this section.",
        "keyThemes": ["Theme 1", "Theme 2", "Theme 3"]
      },
      {
        "act": "Part III: [Specific Act Name]",
        "chapters": "Chapters/Sections covered",
        "summary": "3-4 detailed sentences covering the climax and resolution.",
        "keyThemes": ["Theme 1", "Theme 2", "Theme 3"]
      }
    ],
    "moralConclusions": [
      "First specific moral/philosophical takeaway from '${title}' — cite a specific moment or character arc",
      "Second specific insight drawn from the text",
      "Third insight about what the author is ultimately arguing"
    ]
  },
  "writingStyle": {
    "voice": "Precise description of ${author}'s narrative voice in '${title}': person, distance, reliability, register. 3-4 sentences with specific examples from the text.",
    "tonalSpectrum": "The specific emotional and intellectual tonal range ${author} employs — from the opening to the close of '${title}'. Be specific about mood shifts.",
    "cinematicMontage": "Describe ${author}'s specific narrative techniques in '${title}': scene construction, pacing, use of time (flashback/flash-forward), montage, white space, or stream of consciousness. 3-4 sentences.",
    "symbolism": {
      "[Specific Symbol from the actual book]": "What this symbol represents in '${title}' and where it appears",
      "[Second Specific Symbol]": "Its symbolic weight and textual instances",
      "[Third Symbol or Motif]": "Its thematic function in the narrative",
      "[Fourth Symbol]": "How it develops across the work"
    }
  },
  "grammarAndLinguisticCharacteristics": {
    "syntaxArchitecture": "Detailed analysis of ${author}'s sentence structure in '${title}': clause complexity, periodic vs cumulative sentences, syntactic parallelism, rhythm. 3-4 sentences with specific observations.",
    "dictionProfile": "Precise description of ${author}'s word choice in '${title}': register (formal/colloquial), Latinate vs. Anglo-Saxon vocabulary, precision vs. ambiguity, period-specific diction. 3-4 sentences.",
    "neologismsAndPortmanteaus": "Any invented words, specialized coinages, idiomatic innovations, or linguistic idiosyncrasies distinctive to '${title}' and ${author}'s style. If none, describe the most distinctive phrasing patterns.",
    "grammaticalComplexityScore": "X.X / 10"
  },
  "topicsDiscussed": [
    {
      "topic": "Specific major theme or topic from '${title}'",
      "insight": "3-4 sentences of scholarly analysis: how this theme is developed, what specific scenes or characters embody it, and what ${author} is arguing about it."
    },
    {
      "topic": "Second major topic specific to '${title}'",
      "insight": "3-4 sentences of specific textual analysis."
    },
    {
      "topic": "Third major topic",
      "insight": "3-4 sentences of analysis with textual grounding."
    },
    {
      "topic": "Fourth major topic",
      "insight": "3-4 sentences of analysis."
    },
    {
      "topic": "Fifth major topic",
      "insight": "3-4 sentences."
    }
  ],
  "coreConcepts": [
    {
      "concept": "Specific philosophical or intellectual concept central to '${title}'",
      "description": "3-4 sentences: define the concept academically, explain how '${title}' engages with it, which scholars or traditions it relates to, and how ${author} uses it."
    },
    {
      "concept": "Second core concept",
      "description": "3-4 sentences of scholarly analysis."
    },
    {
      "concept": "Third core concept",
      "description": "3-4 sentences."
    },
    {
      "concept": "Fourth core concept",
      "description": "3-4 sentences."
    }
  ],
  "difficultWordsGlossary": [
    {
      "word": "Advanced or unusual word actually used in '${title}'",
      "phonetics": "/IPA pronunciation/",
      "partOfSpeech": "noun/verb/adjective/adverb",
      "definition": "Precise scholarly definition",
      "quote": "A plausible sentence using this word in the style of '${title}'",
      "modernEquivalent": "Simpler modern equivalent"
    }
  ],
  "discussionQuestions": [
    "Specific, deep analytical question about '${title}' suitable for a graduate seminar",
    "Second scholarly discussion question probing character or theme",
    "Third question examining ${author}'s technique or argument",
    "Fourth question connecting '${title}' to broader literary or philosophical context",
    "Fifth question asking the reader to evaluate or critique the work"
  ]
}

The difficultWordsGlossary must contain exactly 12 words — words that are genuinely elevated, archaic, technical, or unusual. Each must be real, correctly defined words.
Every field must be specific to "${title}" by ${author}. Do NOT produce generic content.`;

  return await callGemini(prompt, systemPrompt);
}

/**
 * Scholar Q&A — powered by Gemini with full book context
 */
async function answerScholarQueryWithAI(question, dossier, meta) {
  const title = meta?.title || 'this book';
  const author = meta?.author || 'the author';

  const systemPrompt = `You are an expert literary scholar specializing in "${title}" by ${author}. You answer questions with PhD-level analytical depth, citing specific textual evidence, naming characters and scenes, referencing critical traditions, and drawing connections to broader literary and philosophical contexts. Your answers are 3-6 paragraphs long, substantive, and never generic.`;

  const context = dossier ? `
BOOK DOSSIER CONTEXT:
- Core thesis: ${dossier.whatTheBookSays?.coreThesis || ''}
- Writing style: ${dossier.writingStyle?.voice || ''}
- Key topics: ${(dossier.topicsDiscussed || []).map(t => t.topic + ': ' + t.insight).join(' | ')}
- Core concepts: ${(dossier.coreConcepts || []).map(c => c.concept + ': ' + c.description).join(' | ')}
- Summary: ${dossier.comprehensiveSummary?.elevatorPitch || ''}
` : '';

  const prompt = `${context}

STUDENT QUESTION: ${question}

Provide a thorough, PhD-level scholarly response to this question about "${title}" by ${author}. Be specific, cite characters and scenes, and demonstrate deep expertise.`;

  return await callGeminiText(prompt, systemPrompt);
}

/**
 * Setup Refresh AI Dossier button
 */
function setupRefreshDossierButton() {
  const btn = document.getElementById('btn-regenerate-ai');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!currentBookMeta) return;

    const triggerGeneration = async () => {
      btn.disabled = true;
      btn.innerHTML = '<span class="loader-dot">✨</span> Analysing with AI...';

      try {
        const dossier = await generateAIDossier(currentBookMeta);
        dossier.bookId = currentBookId;
        currentDossier = dossier;

        if (window.AthenaeumDB) {
          await window.AthenaeumDB.saveBookAnalysis(currentBookId, dossier);
        }

        renderDossier(dossier, currentBookMeta);
        btn.innerHTML = '<span>✅</span> Dossier Updated!';
        setTimeout(() => {
          btn.innerHTML = '<span>✨</span> Refresh AI Dossier';
          btn.disabled = false;
        }, 2500);

      } catch (err) {
        btn.disabled = false;
        btn.innerHTML = '<span>✨</span> Refresh AI Dossier';
        if (err.message === 'NO_KEY') {
          promptForApiKey(triggerGeneration);
        } else {
          showToast('AI Analysis failed: ' + err.message);
        }
      }
    };

    if (!getGeminiApiKey()) {
      promptForApiKey(triggerGeneration);
    } else {
      await triggerGeneration();
    }
  });
}

/**
 * Dynamic On-Demand Dossier Generator — rich fallback if no API key
 */
function generateDynamicDossier(meta) {
  const title = meta.title || 'This Book';
  const author = meta.author || 'the Author';
  const category = meta.category || 'Literature';

  return {
    bookId: meta.id || 'book_generic',
    title,
    author,
    publishedYear: null,
    genre: category,
    readingTimeMinutes: 300,
    difficultyLevel: 'Literary',
    whatTheBookSays: {
      coreThesis: `"${title}" by ${author} is a work that demands close scholarly engagement. Click "✨ Refresh AI Dossier" above (free Gemini API key required) to generate a complete PhD-level literary analysis — covering the book's central thesis, narrative architecture, symbolic vocabulary, and intellectual argument specific to this text.`,
      premise: `${author}'s "${title}" belongs to the ${category} tradition. To unlock a fully tailored dossier with character analysis, thematic dissection, writing style breakdown, and a custom vocabulary glossary, use the Refresh AI Dossier feature.`
    },
    comprehensiveSummary: {
      elevatorPitch: `This is a placeholder analysis for "${title}". For a rigorous, book-specific literary dossier — complete with a structured narrative arc, moral conclusions, and scholarly thematic insights — tap "✨ Refresh AI Dossier". The AI will generate analysis specifically calibrated to ${author}'s actual text, not generic templates.`,
      acts: [
        {
          act: 'Act I: Establishment',
          chapters: 'Opening section',
          summary: `In the opening movement of "${title}", ${author} establishes the world, introduces the central consciousness, and plants the seeds of the conflicts that will define the work.`,
          keyThemes: ['Introduction', 'World-Building', 'Initial Conflict']
        },
        {
          act: 'Act II: Development & Crisis',
          chapters: 'Middle section',
          summary: `The narrative deepens as ${author} develops the central tensions, tests the characters' convictions, and moves toward an inevitable confrontation with the work's core questions.`,
          keyThemes: ['Conflict', 'Character Development', 'Thematic Pressure']
        },
        {
          act: 'Act III: Resolution & Aftermath',
          chapters: 'Concluding section',
          summary: `${author} brings the central conflicts to their reckoning, with consequences that illuminate the thematic argument the work has been building toward throughout its entirety.`,
          keyThemes: ['Resolution', 'Consequence', 'Meaning']
        }
      ],
      moralConclusions: [
        `The moral architecture of "${title}" rewards patient, close reading — its conclusions emerge from the texture of the prose rather than explicit statement.`,
        `${author} consistently resists easy resolution, leaving the reader to construct meaning from the work's carefully arranged ambiguities.`,
        `Use the AI Dossier feature for specific, textually grounded moral and philosophical conclusions drawn from "${title}".`
      ]
    },
    writingStyle: {
      voice: `${author}'s voice in "${title}" is distinctive and carefully calibrated to the work's thematic demands. For a precise stylistic breakdown — including narrative distance, tonal register, and rhetorical strategies specific to this text — generate the full AI Dossier.`,
      tonalSpectrum: `The tonal range of "${title}" spans multiple registers across its narrative arc. Refresh the AI Dossier for a detailed scholarly analysis of ${author}'s tonal architecture.`,
      cinematicMontage: `${author}'s compositional and structural techniques in "${title}" merit detailed scholarly attention. The AI Dossier will analyze scene construction, pacing, temporal manipulation, and formal experimentation specific to this work.`,
      symbolism: {
        'Symbolic Register': `"${title}" operates through a rich system of symbols and motifs. Generate the AI Dossier to see a detailed breakdown of the specific symbols ${author} deploys and their thematic functions.`,
        'Recurring Imagery': `${author}'s imagery patterns in "${title}" are worth careful examination. The full AI analysis will map these patterns across the text.`
      }
    },
    grammarAndLinguisticCharacteristics: {
      syntaxArchitecture: `${author}'s sentence-level craft in "${title}" is a subject worthy of close stylistic analysis. For a detailed account of syntax, clause structures, rhythmic patterns, and grammatical idiosyncrasies specific to this work, generate the full AI Dossier.`,
      dictionProfile: `The lexical register of "${title}" reflects ${author}'s careful calibration of word choice. The AI analysis will characterize the diction profile precisely, identifying register shifts, specialized vocabulary, and period-specific language.`,
      neologismsAndPortmanteaus: `Any linguistic innovations or distinctive idiomatic patterns in "${title}" will be identified and analyzed in the full AI-generated dossier.`,
      grammaticalComplexityScore: '— / 10 (Awaiting AI Analysis)'
    },
    topicsDiscussed: [
      { topic: 'Core Thematic Territory', insight: `"${title}" engages with themes that define its literary category. Click "✨ Refresh AI Dossier" to see five specific, deeply analyzed topics with textual evidence from ${author}'s actual text.` },
      { topic: 'Human Psychology & Motivation', insight: `${author} constructs a rich psychological landscape in "${title}". The full dossier will analyze specific characters' interior lives and what they reveal about human nature.` },
      { topic: 'Social & Historical Context', insight: `"${title}" is embedded in a specific historical and cultural context that shapes its meaning. The AI analysis will locate the work within its broader intellectual tradition.` }
    ],
    coreConcepts: [
      { concept: 'Intellectual Architecture', description: `"${title}" operates through a set of specific philosophical and conceptual commitments. Generate the AI Dossier to see four deeply analyzed core concepts — each defined academically and traced through the specific text of ${author}'s work.` },
      { concept: 'Critical Reception & Tradition', description: `Understanding where "${title}" sits within its critical tradition enriches the reading experience. The full AI analysis will position the work within relevant scholarly conversations.` }
    ],
    difficultWordsGlossary: [
      { word: 'Mellifluous', phonetics: '/meˈlɪf.lu.əs/', partOfSpeech: 'adjective', definition: 'Pleasingly smooth and musical to hear; having a sweet or musical pleasant sound.', quote: `The prose of "${title}" carries a mellifluous quality that belies its thematic severity.`, modernEquivalent: 'Sweetly musical / harmonious' },
      { word: 'Perspicacious', phonetics: '/ˌpɜː.spɪˈkeɪ.ʃəs/', partOfSpeech: 'adjective', definition: 'Having a ready insight into and understanding of things; showing a clever, accurate, and deep understanding.', quote: 'A perspicacious reader will detect the irony embedded in every apparent declaration of certainty.', modernEquivalent: 'Perceptive / insightful' },
      { word: 'Solipsism', phonetics: '/ˈsɒl.ɪp.sɪ.z(ə)m/', partOfSpeech: 'noun', definition: 'The view or theory that the self is all that can be known to exist; self-absorption to the exclusion of the external world.', quote: 'The narrator\'s solipsism gradually becomes the novel\'s most devastating structural device.', modernEquivalent: 'Self-absorbed worldview' },
      { word: 'Laconic', phonetics: '/ləˈkɒn.ɪk/', partOfSpeech: 'adjective', definition: 'Using very few words; brief and concise in speech or expression; terse.', quote: 'His laconic responses conveyed more existential weight than paragraphs of explanation could achieve.', modernEquivalent: 'Brief / terse' },
      { word: 'Verisimilitude', phonetics: '/ˌver.ɪ.sɪˈmɪl.ɪ.tjuːd/', partOfSpeech: 'noun', definition: 'The appearance of being true or real; the quality of seeming probable or lifelike.', quote: 'The author achieves verisimilitude not through documentary detail but through emotional precision.', modernEquivalent: 'Lifelikeness / realism' }
    ],
    discussionQuestions: [
      `What is the central ethical dilemma at the heart of "${title}", and how does ${author} position the reader in relation to it?`,
      `Analyze the narrative voice in "${title}". How does the choice of perspective shape our understanding of the events described?`,
      `How does "${title}" engage with its historical and cultural moment, and what does it reveal about the period in which it was written?`,
      `Trace the development of the work's central symbol or motif from opening to close. What does this arc suggest about ${author}'s thematic argument?`,
      `Where do you locate "${title}" in the tradition of ${category}? What does it affirm, challenge, or transform in that tradition?`
    ]
  };
}

function showToast(message) {
  let toast = document.getElementById('analysis-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'analysis-toast';
    toast.style.cssText = `position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #1e293b; color: white; padding: 10px 20px; border-radius: 24px;
      font-size: 13px; z-index: 9998; box-shadow: 0 8px 24px rgba(0,0,0,0.3);
      max-width: 380px; text-align: center;`;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => { if (toast) toast.style.display = 'none'; }, 4000);
}

function showFatalError(msg) {
  const container = document.querySelector('.analysis-container');
  if (container) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px;">
        <div style="font-size: 40px; margin-bottom: 16px;">⚠️</div>
        <h2 style="font-family: var(--font-serif); margin-bottom: 8px;">Analysis Unavailable</h2>
        <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 24px;">${escapeHtml(msg)}</p>
        <a href="index.html" class="action-btn action-primary">Return to Library</a>
      </div>
    `;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

