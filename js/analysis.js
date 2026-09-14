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
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const question = input.value.trim();
      if (!question) return;

      appendChatMessage('user', question);
      input.value = '';

      // Generate intelligent answer based on book context
      setTimeout(() => {
        const answer = answerScholarQuery(question, currentDossier, currentBookMeta);
        appendChatMessage('bot', answer);
      }, 500);
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

function answerScholarQuery(query, dossier, meta) {
  const q = query.toLowerCase();

  if (!dossier) {
    return `In analyzing ${meta.title}, the work demonstrates profound philosophical and cultural depth. What specific aspect of its themes or writing style would you like to examine?`;
  }

  if (q.includes('style') || q.includes('writing') || q.includes('tone')) {
    return `Authorial Style in "${meta.title}": ${dossier.writingStyle?.voice || ''} The tone is characterized by: ${dossier.writingStyle?.tonalSpectrum || ''}`;
  }

  if (q.includes('grammar') || q.includes('syntax') || q.includes('sentence')) {
    return `Syntactic Architecture: ${dossier.grammarAndLinguisticCharacteristics?.syntaxArchitecture || ''} Diction: ${dossier.grammarAndLinguisticCharacteristics?.dictionProfile || ''}`;
  }

  if (q.includes('theme') || q.includes('topic') || q.includes('about')) {
    const topics = (dossier.topicsDiscussed || []).map(t => `• ${t.topic}: ${t.insight}`).join('\n');
    return `Key Themes in "${meta.title}":\n${topics}`;
  }

  if (q.includes('concept') || q.includes('idea')) {
    const concepts = (dossier.coreConcepts || []).map(c => `• ${c.concept}: ${c.description}`).join('\n');
    return `Core Concepts Explored:\n${concepts}`;
  }

  if (q.includes('ending') || q.includes('conclusion') || q.includes('moral')) {
    const moral = (dossier.comprehensiveSummary?.moralConclusions || []).join(' ');
    return `Moral & Thematic Conclusion: ${moral}`;
  }

  if (q.includes('chapter') || q.includes('summary')) {
    const acts = (dossier.comprehensiveSummary?.acts || []).map(a => `**${a.act}**: ${a.summary}`).join('\n\n');
    return `Summary of the work:\n\n${acts}`;
  }

  // Default rich analytical synthesis
  return `Regarding your question about "${meta.title}": The novel explores ${dossier.whatTheBookSays?.coreThesis || 'fundamental questions of humanity'}. As ${meta.author} illustrates throughout the narrative, individual freedom, moral responsibility, and aesthetic depth remain central to the work's enduring power.`;
}

/**
 * Dynamic On-Demand Dossier Generator for any catalog or user book
 */
function generateDynamicDossier(meta) {
  return {
    bookId: meta.id || 'book_generic',
    title: meta.title,
    author: meta.author || 'Author',
    publishedYear: 1900,
    genre: meta.category || 'Literature & Philosophy',
    readingTimeMinutes: 280,
    difficultyLevel: 'Standard Literary',
    whatTheBookSays: {
      coreThesis: `In "${meta.title}", ${meta.author || 'the author'} conducts a profound inquiry into human nature, society, and moral consequence, demonstrating how individual choices ripple through the fabric of reality.`,
      premise: `Set within its evocative narrative world, "${meta.title}" presents a journey where the protagonist encounters structural conflicts between personal desire and collective obligation.`
    },
    comprehensiveSummary: {
      elevatorPitch: `A seminal work in ${meta.category || 'literature'} examining identity, conflict, and the quest for meaning.`,
      acts: [
        {
          act: "Part I: Introduction & Inciting Conflict",
          chapters: "Opening Chapters",
          summary: "The narrative establishes the primary world, the central characters, and the ideological or interpersonal tensions that disrupt the status quo.",
          keyThemes: ["Origin", "Identity", "Disruption"]
        },
        {
          act: "Part II: Rising Action & Complication",
          chapters: "Middle Sequence",
          summary: "The characters face mounting obstacles that test their philosophical convictions, leading to moral ambiguities and dramatic conflicts.",
          keyThemes: ["Struggle", "Transformation", "Ambiguity"]
        },
        {
          act: "Part III: Climax & Resolution",
          chapters: "Concluding Chapters",
          summary: "The fundamental tensions reach a breaking point, resulting in a dramatic resolution that leaves an indelible mark on the surviving characters.",
          keyThemes: ["Reckoning", "Catharsis", "Consequence"]
        }
      ],
      moralConclusions: [
        "True character is revealed not during periods of ease, but when confronted with irreconcilable moral dilemmas.",
        "The social structures surrounding an individual profoundly shape, but never entirely excuse, their moral choices.",
        "Integrity often demands sacrificing temporary comfort for transcendent truth."
      ]
    },
    writingStyle: {
      voice: `Reflective and deeply observant, ${meta.author || 'the author'} balances narrative drive with psychological introspection.`,
      tonalSpectrum: "Atmospheric, evocative, and intellectually probing.",
      cinematicMontage: "Utilizes scene transitions and sensory details that draw the reader intimately into the physical landscape.",
      symbolism: {
        "Light & Shadow": "Represents the struggle between self-deception and moral clarity.",
        "The Journey": "Symbolizes the internal evolution of consciousness across trials."
      }
    },
    grammarAndLinguisticCharacteristics: {
      syntaxArchitecture: "Balanced sentence pacing alternating between expansive descriptive prose and crisp, rhythmic dialogue.",
      dictionProfile: "Articulate literary vocabulary with precise noun-verb combinations that evoke vivid sensory imagery.",
      neologismsAndPortmanteaus: "Classic idiomatic phrasing tailored to the cultural register of the period.",
      grammaticalComplexityScore: "7.8 / 10"
    },
    topicsDiscussed: [
      {
        topic: "Individual Autonomy vs Social Conditioning",
        insight: "How exterior expectations and cultural institutions attempt to mold internal identity."
      },
      {
        topic: "The Weight of Moral Consequence",
        insight: "Actions undertaken in pride or fear inexorably demand an accounting."
      },
      {
        topic: "The Search for Authentic Purpose",
        insight: "Navigating alienation to discover personal truth and enduring connection."
      }
    ],
    coreConcepts: [
      {
        concept: "Existential Agency",
        description: "The recognition that human beings retain moral responsibility even amidst constraining external circumstances."
      },
      {
        concept: "The Illusion of Certainty",
        description: "How rigid ideological beliefs crumble when confronted with the messy nuances of lived experience."
      }
    ],
    difficultWordsGlossary: [
      {
        word: "Mellifluous",
        phonetics: "/meˈlɪf.lu.əs/",
        partOfSpeech: "adjective",
        definition: "Pleasingly smooth and musical to hear.",
        quote: "The voice carried a mellifluous resonance that commanded quiet attention.",
        modernEquivalent: "Sweet-sounding / harmonious"
      },
      {
        word: "Epiphany",
        phonetics: "/ɪˈpɪf.ən.i/",
        partOfSpeech: "noun",
        definition: "A moment of sudden revelation or profound insight.",
        quote: "In a sudden epiphany, the true nature of the dilemma became unmistakable.",
        modernEquivalent: "Sudden realization"
      },
      {
        word: "Ubiquitous",
        phonetics: "/juːˈbɪk.wɪ.təs/",
        partOfSpeech: "adjective",
        definition: "Present, appearing, or found everywhere.",
        quote: "The ubiquitous presence of state authority permeated every casual conversation.",
        modernEquivalent: "Everywhere / omnipresent"
      }
    ],
    discussionQuestions: [
      `What is the central ethical choice facing the protagonist in "${meta.title}"?`,
      `How does ${meta.author || 'the author'}'s writing style influence our emotional connection to the characters?`,
      "In what ways do the themes of this work continue to resonate with contemporary society?"
    ]
  };
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
