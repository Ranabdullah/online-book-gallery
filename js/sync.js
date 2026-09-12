/**
 * Athenaeum - Cross-Device Synchronization & Profile Engine
 * Features:
 * - Cross-device reading progress synchronization (Phone <-> PC)
 * - Device Profiles (Shared Sync vs Independent PC logs)
 * - Automatic background sync after every edit
 * - Direct GitHub API auto-commit (optional PAT)
 * - Local server auto-save bridge
 * - Reading activity history inspector
 */

(function () {
  const SYNC_KEY_STORAGE = 'athenaeum_sync_key';
  const PROFILE_STORAGE = 'athenaeum_active_profile';
  const DEVICE_ID_STORAGE = 'athenaeum_device_id';
  const GH_TOKEN_STORAGE = 'athenaeum_github_token';
  const PROGRESS_STORAGE = 'athenaeum_reading_progress_v2';
  const LOGS_STORAGE = 'athenaeum_reading_logs_v2';

  // Default Sync Room Key (shared across user's devices)
  const DEFAULT_SYNC_KEY = 'ranabdullah_athenaeum_sync';

  // Cloud KV endpoint (Free, fast public sync relay)
  const CLOUD_RELAY_BASE = 'https://kvdb.io/AnCj8Y9wUfQf8X7q8xH7w1/';

  // GitHub Repository details
  const GH_OWNER = 'Ranabdullah';
  const GH_REPO = 'online-book-gallery';

  // 1. Device Identification
  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_ID_STORAGE);
    if (!id) {
      id = 'dev_' + Math.random().toString(36).substring(2, 10) + '_' + Date.now();
      localStorage.setItem(DEVICE_ID_STORAGE, id);
    }
    return id;
  }

  function detectDevice() {
    const ua = navigator.userAgent || '';
    const isMobile = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    const isTablet = /iPad|Android(?!.*Mobile)|Tablet/i.test(ua) || (navigator.maxTouchPoints > 1 && window.innerWidth >= 768 && window.innerWidth <= 1024);

    if (isTablet) {
      return { type: 'tablet', label: '📱 Tablet', isMobile: true };
    } else if (isMobile || window.innerWidth <= 768) {
      return { type: 'phone', label: '📱 Phone', isMobile: true };
    } else {
      const isMac = /Macintosh|Mac OS X/i.test(ua);
      return { type: 'pc', label: isMac ? '💻 Mac' : '🖥️ Windows PC', isMobile: false };
    }
  }

  // 2. Profile Management
  function getSyncKey() {
    return localStorage.getItem(SYNC_KEY_STORAGE) || DEFAULT_SYNC_KEY;
  }

  function setSyncKey(key) {
    const cleaned = (key || '').trim() || DEFAULT_SYNC_KEY;
    localStorage.setItem(SYNC_KEY_STORAGE, cleaned);
    return cleaned;
  }

  function getActiveProfile() {
    const stored = localStorage.getItem(PROFILE_STORAGE);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch (e) {}
    }
    // Default to shared profile that syncs between Phone and PC
    return {
      id: 'shared',
      name: 'Shared (Phone & PC)',
      isShared: true
    };
  }

  function setActiveProfile(profile) {
    localStorage.setItem(PROFILE_STORAGE, JSON.stringify(profile));
    notifySyncListeners('profile_changed', profile);
  }

  function getAvailableProfiles() {
    return [
      { id: 'shared', name: 'Shared Sync (Phone & PC)', isShared: true, desc: 'Progress syncs across all your devices' },
      { id: 'pc_independent', name: 'Independent PC Log', isShared: false, desc: 'Separate reading log for this specific PC' },
      { id: 'personal_study', name: 'Study / Research Log', isShared: false, desc: 'Dedicated log for research & notes' }
    ];
  }

  // 3. Local Progress & Reading Logs Storage
  function getAllLocalProgress() {
    try {
      return JSON.parse(localStorage.getItem(PROGRESS_STORAGE) || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveLocalProgress(bookId, data) {
    const all = getAllLocalProgress();
    all[bookId] = {
      ...data,
      updatedAt: Date.now()
    };
    localStorage.setItem(PROGRESS_STORAGE, JSON.stringify(all));
    appendReadingLog(data);
  }

  function appendReadingLog(entry) {
    try {
      const logs = JSON.parse(localStorage.getItem(LOGS_STORAGE) || '[]');
      const newLog = {
        id: 'log_' + Date.now(),
        ...entry,
        timestamp: Date.now()
      };
      // Keep newest 60 logs
      const updated = [newLog, ...logs.filter(l => l.bookId !== entry.bookId || Math.abs(l.timestamp - newLog.timestamp) > 300000)].slice(0, 60);
      localStorage.setItem(LOGS_STORAGE, JSON.stringify(updated));
      notifySyncListeners('logs_updated', updated);
    } catch (e) {}
  }

  function getReadingLogs() {
    try {
      return JSON.parse(localStorage.getItem(LOGS_STORAGE) || '[]');
    } catch (e) {
      return [];
    }
  }

  // 4. Cloud Relay Synchronization
  async function fetchCloudPayload() {
    const key = getSyncKey();
    try {
      const resp = await fetch(CLOUD_RELAY_BASE + encodeURIComponent(key) + '?_t=' + Date.now());
      if (resp.ok) {
        const text = await resp.text();
        if (text) {
          return JSON.parse(text);
        }
      }
    } catch (err) {
      // Cloud relay unreachable or offline
    }
    return null;
  }

  async function pushCloudPayload(payload) {
    const key = getSyncKey();
    try {
      const resp = await fetch(CLOUD_RELAY_BASE + encodeURIComponent(key), {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(payload)
      });
      return resp.ok;
    } catch (err) {
      return false;
    }
  }

  // 5. Reading Progress API
  async function saveReadingProgress({ bookId, bookTitle, cfi, page, percentage, format }) {
    const device = detectDevice();
    const profile = getActiveProfile();

    const progressEntry = {
      bookId,
      bookTitle: bookTitle || 'Book',
      profileId: profile.id,
      profileName: profile.name,
      deviceId: getDeviceId(),
      deviceType: device.type,
      deviceLabel: device.label,
      cfi: cfi || null,
      page: page || 1,
      percentage: percentage || 0,
      format: format || 'epub',
      updatedAt: Date.now()
    };

    // 1. Save locally
    saveLocalProgress(bookId, progressEntry);

    // 2. If active profile is shared, broadcast to cloud relay
    if (profile.isShared) {
      broadcastProgressToCloud(progressEntry);
    }

    notifySyncListeners('progress_saved', progressEntry);
    return progressEntry;
  }

  let broadcastTimeout = null;
  function broadcastProgressToCloud(entry) {
    clearTimeout(broadcastTimeout);
    broadcastTimeout = setTimeout(async () => {
      try {
        let payload = await fetchCloudPayload() || { progress: {}, overrides: {}, logs: [] };
        if (!payload.progress) payload.progress = {};
        if (!payload.logs) payload.logs = [];

        payload.progress[entry.bookId] = entry;
        payload.logs = [entry, ...(payload.logs || []).filter(l => l.bookId !== entry.bookId || Math.abs(l.updatedAt - entry.updatedAt) > 300000)].slice(0, 60);

        await pushCloudPayload(payload);
        notifySyncListeners('cloud_synced', { status: 'success', time: Date.now() });
      } catch (e) {
        console.warn('Background cloud progress sync note:', e);
      }
    }, 400);
  }

  async function getLatestCrossDeviceProgress(bookId) {
    const profile = getActiveProfile();
    // If user selected an independent local log, don't import cross-device progress
    if (!profile.isShared) {
      const local = getAllLocalProgress();
      return local[bookId] || null;
    }

    try {
      const cloud = await fetchCloudPayload();
      const cloudEntry = cloud && cloud.progress ? cloud.progress[bookId] : null;
      const local = getAllLocalProgress()[bookId];

      if (!cloudEntry && !local) return null;
      if (!cloudEntry) return local;
      if (!local) return cloudEntry;

      // Return cloud entry if it's newer and from another device
      if (cloudEntry.updatedAt > local.updatedAt && cloudEntry.deviceId !== getDeviceId()) {
        return {
          ...cloudEntry,
          isRemoteNewer: true
        };
      }
      return local;
    } catch (e) {
      return getAllLocalProgress()[bookId] || null;
    }
  }

  // 6. Book Metadata & Cover Overrides Auto-Sync
  async function broadcastBookOverride(bookId, overrideData) {
    // 1. Send to local backend server if active
    try {
      const localResp = await fetch('/api/save-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: bookId, ...overrideData })
      });
      if (localResp.ok) {
        console.log('Saved directly to backend disk via server.py');
      }
    } catch (e) {}

    // 2. Broadcast to cloud relay for instant cross-device updates
    try {
      let payload = await fetchCloudPayload() || { progress: {}, overrides: {}, logs: [] };
      if (!payload.overrides) payload.overrides = {};
      payload.overrides[bookId] = {
        id: bookId,
        ...overrideData,
        updatedAt: Date.now()
      };
      await pushCloudPayload(payload);
    } catch (e) {}

    // 3. Direct GitHub API commit if PAT is configured
    const ghToken = getGitHubToken();
    if (ghToken) {
      commitOverrideDirectToGitHub(bookId, overrideData, ghToken).catch(e => {
        console.warn('GitHub API commit warning:', e);
      });
    }

    notifySyncListeners('override_synced', { bookId, overrideData });
  }

  // 7. Direct GitHub API Commit Engine (Zero-Command Cloud Persistence)
  function getGitHubToken() {
    return localStorage.getItem(GH_TOKEN_STORAGE) || '';
  }

  function setGitHubToken(token) {
    const cleaned = (token || '').trim();
    localStorage.setItem(GH_TOKEN_STORAGE, cleaned);
    return cleaned;
  }

  async function commitOverrideDirectToGitHub(bookId, overrideData, token) {
    if (!token) return;

    try {
      // 1. If cover is base64, commit covers/{bookId}.jpg
      if (overrideData.cover && overrideData.cover.startsWith('data:image')) {
        const b64Data = overrideData.cover.replace(/^data:image\/[a-z]+;base64,/, '');
        await pushFileToGitHub(`covers/${bookId}.jpg`, b64Data, `feat: update cover for ${bookId}`, token);
      }

      // 2. Update data/books.json in GitHub repo
      const booksFile = await getFileFromGitHub('data/books.json', token);
      if (booksFile && booksFile.content) {
        const contentStr = decodeURIComponent(escape(atob(booksFile.content)));
        const books = JSON.parse(contentStr);
        let found = false;

        for (const b of books) {
          if (b.id === bookId) {
            if (overrideData.title) b.title = overrideData.title;
            if (overrideData.author) b.author = overrideData.author;
            if (overrideData.category) b.category = overrideData.category;
            if (overrideData.cover) b.cover = `covers/${bookId}.jpg`;
            found = true;
            break;
          }
        }

        if (found) {
          const updatedJson = JSON.stringify(books, null, 2);
          const updatedB64 = btoa(unescape(encodeURIComponent(updatedJson)));
          await pushFileToGitHub('data/books.json', updatedB64, `feat: update metadata for ${bookId}`, token, booksFile.sha);
        }
      }
    } catch (err) {
      console.error('Direct GitHub API sync error:', err);
    }
  }

  async function getFileFromGitHub(path, token) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (resp.ok) return await resp.json();
    return null;
  }

  async function pushFileToGitHub(path, base64Content, message, token, existingSha = null) {
    const url = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${path}`;
    let sha = existingSha;

    if (!sha) {
      const existing = await getFileFromGitHub(path, token);
      if (existing && existing.sha) sha = existing.sha;
    }

    const payload = {
      message,
      content: base64Content,
      branch: 'main'
    };
    if (sha) payload.sha = sha;

    const resp = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    return resp.ok;
  }

  // 8. Event Listener Hub
  const syncListeners = [];
  function addSyncListener(cb) {
    syncListeners.push(cb);
  }

  function notifySyncListeners(event, data) {
    syncListeners.forEach(cb => {
      try { cb(event, data); } catch (e) {}
    });
  }

  // 9. Full Sync Trigger
  async function performFullSync() {
    const device = detectDevice();
    notifySyncListeners('sync_status', { status: 'syncing', text: 'Syncing reading progress & covers...' });

    try {
      // 1. Pull cloud payload
      const cloud = await fetchCloudPayload();
      let importedCount = 0;

      if (cloud) {
        // Sync overrides to local DB
        if (cloud.overrides && window.AthenaeumDB) {
          for (const [id, item] of Object.entries(cloud.overrides)) {
            await window.AthenaeumDB.saveBookOverride(id, item);
            importedCount++;
          }
        }

        // Sync hidden/deleted books
        if (cloud.hidden && Array.isArray(cloud.hidden) && window.AthenaeumDB) {
          cloud.hidden.forEach(id => window.AthenaeumDB.hideBook(id));
        }

        // Merge remote reading logs
        if (cloud.logs && cloud.logs.length > 0) {
          const localLogs = getReadingLogs();
          const merged = [...cloud.logs, ...localLogs];
          const uniqueLogs = [];
          const seen = new Set();
          for (const l of merged) {
            const key = l.bookId + '_' + l.deviceId + '_' + Math.floor(l.updatedAt / 60000);
            if (!seen.has(key)) {
              seen.add(key);
              uniqueLogs.push(l);
            }
          }
          uniqueLogs.sort((a, b) => b.updatedAt - a.updatedAt);
          localStorage.setItem(LOGS_STORAGE, JSON.stringify(uniqueLogs.slice(0, 60)));
        }
      }

      // 2. Push local state to cloud
      const localProgress = getAllLocalProgress();
      const localOverrides = window.AthenaeumDB ? await window.AthenaeumDB.getAllBookOverrides() : {};
      const localHidden = window.AthenaeumDB ? window.AthenaeumDB.getHiddenBooks() : [];
      const localLogs = getReadingLogs();

      await pushCloudPayload({
        progress: localProgress,
        overrides: localOverrides,
        hidden: localHidden,
        logs: localLogs,
        syncedBy: device.label,
        lastSync: Date.now()
      });

      notifySyncListeners('sync_status', { status: 'synced', text: `In sync with ${device.label}` });
      return { success: true, importedCount };
    } catch (err) {
      notifySyncListeners('sync_status', { status: 'error', text: 'Sync offline (local storage active)' });
      return { success: false, error: err.message };
    }
  }

  // Export to window
  window.AthenaeumSync = {
    detectDevice,
    getDeviceId,
    getSyncKey,
    setSyncKey,
    getActiveProfile,
    setActiveProfile,
    getAvailableProfiles,
    saveReadingProgress,
    getLatestCrossDeviceProgress,
    getReadingLogs,
    broadcastBookOverride,
    getGitHubToken,
    setGitHubToken,
    performFullSync,
    addSyncListener
  };

  // Initial silent background sync on load
  setTimeout(() => {
    performFullSync().catch(() => {});
  }, 1500);

})();
