/**
 * Athenaeum - Access code gate
 *
 * Shows a simple "enter access code" screen over the whole app until the
 * visitor is signed in. The actual code check happens server-side in the
 * redeemAccessCode Cloud Function - this file just collects input and
 * displays the gate/loading states.
 *
 * Once verified once, Firebase keeps the session in the browser, so people
 * you've shared the code with won't see this screen again on that device.
 */

(function () {
  const { auth } = window.AthenaeumFirebase;

  function buildGateEl() {
    const el = document.createElement('div');
    el.id = 'athenaeum-access-gate';
    el.innerHTML = `
      <style>
        #athenaeum-access-gate {
          position: fixed; inset: 0; z-index: 99999;
          background: #0d1117; color: #f0f0f0;
          display: flex; align-items: center; justify-content: center;
          font-family: Inter, system-ui, sans-serif;
        }
        #athenaeum-access-gate .box { text-align: center; max-width: 320px; padding: 24px; }
        #athenaeum-access-gate h2 { font-size: 20px; margin-bottom: 6px; }
        #athenaeum-access-gate p { font-size: 13px; color: #9aa0a6; margin-bottom: 18px; }
        #athenaeum-access-gate input {
          width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #333;
          background: #161b22; color: #fff; font-size: 15px; margin-bottom: 10px; text-align: center;
          letter-spacing: 2px;
        }
        #athenaeum-access-gate button {
          width: 100%; padding: 10px 12px; border-radius: 8px; border: none;
          background: #2563eb; color: #fff; font-size: 14px; cursor: pointer;
        }
        #athenaeum-access-gate button:disabled { opacity: 0.6; cursor: default; }
        #athenaeum-access-gate .err { color: #f87171; font-size: 12.5px; margin-top: 10px; min-height: 16px; }
      </style>
      <div class="box">
        <div style="font-size:36px;margin-bottom:8px;">📖</div>
        <h2>Athenaeum</h2>
        <p>This library is private. Enter your access code to continue.</p>
        <input id="ag-code" type="password" placeholder="Access code" autocomplete="off" />
        <button id="ag-submit">Unlock</button>
        <div class="err" id="ag-err"></div>
      </div>
    `;
    return el;
  }

  async function submitCode(gateEl) {
    const input = gateEl.querySelector('#ag-code');
    const btn = gateEl.querySelector('#ag-submit');
    const err = gateEl.querySelector('#ag-err');
    const code = input.value.trim();
    if (!code) return;

    btn.disabled = true;
    btn.textContent = 'Checking...';
    err.textContent = '';

    try {
      const res = await window.AthenaeumFirebase.workerCall('/redeemAccessCode', { code });
      await auth.signInWithCustomToken(res.token);
      gateEl.remove();
    } catch (e) {
      err.textContent = e.message || 'Something went wrong.';
      btn.disabled = false;
      btn.textContent = 'Unlock';
    }
  }

  function showGate() {
    if (document.getElementById('athenaeum-access-gate')) return;
    const gateEl = buildGateEl();
    document.body.appendChild(gateEl);
    gateEl.querySelector('#ag-submit').addEventListener('click', () => submitCode(gateEl));
    gateEl.querySelector('#ag-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submitCode(gateEl);
    });
    gateEl.querySelector('#ag-code').focus();
  }

  auth.onAuthStateChanged((user) => {
    if (!user) {
      showGate();
    } else {
      const existing = document.getElementById('athenaeum-access-gate');
      if (existing) existing.remove();
    }
  });
})();
