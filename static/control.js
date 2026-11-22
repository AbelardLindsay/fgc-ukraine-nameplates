let token = localStorage.getItem('scoreboard_token');
let current = {};

const $ = (id) => document.getElementById(id);

const loginScreen  = $('login-screen');
const controlPanel = $('control-panel');
const statusBar    = $('status-bar');

// ── Init ────────────────────────────────────

async function init() {
  if (token) {
    const ok = await fetchState();
    if (ok) { initBulkInputs(); fetchCaches(); showControl(); return; }
  }
  showLogin();
}

function showLogin() {
  loginScreen.classList.remove('hidden');
  controlPanel.classList.add('hidden');
  $('password-input').focus();
}

function showControl() {
  loginScreen.classList.add('hidden');
  controlPanel.classList.remove('hidden');
}

// ── Auth ─────────────────────────────────────

async function login() {
  const password = $('password-input').value;
  $('login-error').textContent = '';

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });

    if (res.ok) {
      const data = await res.json();
      token = data.token;
      localStorage.setItem('scoreboard_token', token);
      await fetchState();
      fetchCaches();
      showControl();
    } else {
      $('login-error').textContent = 'Invalid password.';
      $('password-input').value = '';
      $('password-input').focus();
    }
  } catch {
    $('login-error').textContent = 'Connection error.';
  }
}

function logout() {
  token = null;
  localStorage.removeItem('scoreboard_token');
  showLogin();
}

// ── Cache ─────────────────────────────────────

async function fetchCaches() {
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const [players, events] = await Promise.all([
      fetch('/api/players', { headers }).then(r => r.json()),
      fetch('/api/events',  { headers }).then(r => r.json()),
    ]);
    populateDatalist('players-datalist', players);
    populateDatalist('events-datalist',  events);
  } catch { /* non-critical */ }
}

function populateDatalist(id, items) {
  const dl = document.getElementById(id);
  dl.replaceChildren(...items.map(name => {
    const opt = document.createElement('option');
    opt.value = name;
    return opt;
  }));
}

// ── State ─────────────────────────────────────

async function fetchState() {
  try {
    const res = await fetch('/api/state', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) { handleExpired(); return false; }
    current = await res.json();
    syncUI();
    return true;
  } catch {
    return false;
  }
}

async function sendUpdate(updates) {
  try {
    const res = await fetch('/api/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });

    if (res.status === 401) { handleExpired(); return; }

    if (res.ok) {
      current = await res.json();
      syncUI();
      flash('Updated', 'success');
    } else {
      flash('Error', 'error');
    }
  } catch {
    flash('Connection error', 'error');
  }
}

function handleExpired() {
  token = null;
  localStorage.removeItem('scoreboard_token');
  showLogin();
}

// ── UI Sync ───────────────────────────────────

function setIfUnfocused(id, value) {
  const el = $(id);
  if (el && document.activeElement !== el) el.value = value ?? '';
}

function syncUI() {
  setIfUnfocused('p1-name-input',    current.player1_name);
  setIfUnfocused('p2-name-input',    current.player2_name);
  setIfUnfocused('event-name-input', current.event_name);
  setIfUnfocused('round-select',     current.round);
  $('p1-score-display').textContent = current.player1_score ?? 0;
  $('p2-score-display').textContent = current.player2_score ?? 0;
}

function initBulkInputs() {
  $('bulk-p1-input').value = current.player1_name ?? '';
  $('bulk-p2-input').value = current.player2_name ?? '';
  const bsel = $('bulk-round-select');
  if (bsel) bsel.value = current.round ?? '';
}

let flashTimer;
function flash(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = 'snackbar show ' + type;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { statusBar.className = 'snackbar'; }, 2000);
}

// ── Change password ───────────────────────────

const passwordDialog = $('password-dialog');

async function changePassword() {
  const errorEl = $('password-error');
  const next = $('new-password-input').value;
  errorEl.textContent = '';

  if (next !== $('confirm-password-input').value) {
    errorEl.textContent = 'Passwords do not match';
    return;
  }

  try {
    const res = await fetch('/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        current_password: $('current-password-input').value,
        new_password: next,
      }),
    });

    if (res.status === 401) { passwordDialog.close(); handleExpired(); return; }

    if (res.ok) {
      token = (await res.json()).token;
      localStorage.setItem('scoreboard_token', token);
      passwordDialog.close();
      flash('Password changed', 'success');
    } else {
      errorEl.textContent = (await res.json()).detail || 'Error';
    }
  } catch {
    errorEl.textContent = 'Connection error';
  }
}

// ── Actions ───────────────────────────────────

function setName(player) {
  const val = $(`p${player}-name-input`).value.trim();
  sendUpdate({ [`player${player}_name`]: val || `PLAYER ${player}` }).then(fetchCaches);
}

function adjustScore(player, delta) {
  const key = `player${player}_score`;
  sendUpdate({ [key]: Math.max(0, (current[key] ?? 0) + delta) });
}

function resetScore(player) {
  sendUpdate({ [`player${player}_score`]: 0 });
}

function setRound() {
  sendUpdate({ round: $('round-select').value });
}

function setEventName() {
  const val = $('event-name-input').value.trim();
  if (val) sendUpdate({ event_name: val }).then(fetchCaches);
}

function saveBulk() {
  const p1 = $('bulk-p1-input').value.trim();
  const p2 = $('bulk-p2-input').value.trim();
  const round = $('bulk-round-select').value;
  sendUpdate({
    player1_name:  p1 || 'PLAYER 1',
    player2_name:  p2 || 'PLAYER 2',
    player1_score: 0,
    player2_score: 0,
    round,
  }).then(() => { initBulkInputs(); fetchCaches(); });
}

function swapPlayers() {
  sendUpdate({
    player1_name:  current.player2_name,
    player2_name:  current.player1_name,
    player1_score: current.player2_score,
    player2_score: current.player1_score,
  });
}

function resetAllScores() {
  if (confirm('Reset both scores to 0?')) {
    sendUpdate({ player1_score: 0, player2_score: 0 });
  }
}

// ── Event Listeners ───────────────────────────

$('login-form').addEventListener('submit', (e) => { e.preventDefault(); login(); });
$('logout-btn').addEventListener('click', logout);

$('change-password-btn').addEventListener('click', () => {
  $('password-form').reset();
  $('password-error').textContent = '';
  passwordDialog.showModal();
});
$('password-cancel-btn').addEventListener('click', () => passwordDialog.close());
$('password-form').addEventListener('submit', async (e) => { e.preventDefault(); await changePassword(); });

$('p1-name-btn').addEventListener('click', () => setName(1));
$('p2-name-btn').addEventListener('click', () => setName(2));
$('p1-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') setName(1); });
$('p2-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') setName(2); });

$('p1-plus').addEventListener('click',  () => adjustScore(1,  1));
$('p1-minus').addEventListener('click', () => adjustScore(1, -1));
$('p2-plus').addEventListener('click',  () => adjustScore(2,  1));
$('p2-minus').addEventListener('click', () => adjustScore(2, -1));

$('p1-reset').addEventListener('click', () => resetScore(1));
$('p2-reset').addEventListener('click', () => resetScore(2));

$('round-btn').addEventListener('click', setRound);
$('event-btn').addEventListener('click', setEventName);
$('event-name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') setEventName(); });

$('save-match-btn').addEventListener('click', saveBulk);
$('bulk-p1-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBulk(); });
$('bulk-p2-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBulk(); });

$('swap-btn').addEventListener('click', swapPlayers);
$('reset-all-btn').addEventListener('click', resetAllScores);

init();
