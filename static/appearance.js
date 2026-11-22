const token = localStorage.getItem('scoreboard_token');
const $ = (id) => document.getElementById(id);
const statusBar = $('status-bar');
const SIZE_KEYS = Object.keys(window.FONT_SIZES);
const COLOR_KEYS = Object.keys(window.DEFAULT_THEME).filter(k => k !== 'font' && !SIZE_KEYS.includes(k));

let flashTimer;
function flash(msg, type) {
  statusBar.textContent = msg;
  statusBar.className = 'snackbar show ' + type;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { statusBar.className = 'snackbar'; }, 2000);
}

function toLogin() {
  localStorage.removeItem('scoreboard_token');
  location.href = '/control';
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...(opts.headers || {}), 'Authorization': 'Bearer ' + token },
  });
  if (res.status === 401) { toLogin(); throw new Error('unauthorized'); }
  return res;
}

function postJson(path, body) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function populateFonts(names, selected) {
  const select = $('font-select');
  select.replaceChildren(...names.map(n => {
    const o = document.createElement('option');
    o.value = o.textContent = n;
    return o;
  }));
  select.value = selected;
}

function showSize(key) {
  $(key + '_out').textContent = $(key).value + ' px';
}

function syncInputs(s) {
  $('font-select').value = s.font;
  for (const key of COLOR_KEYS) $(key).value = s[key];
  for (const key of SIZE_KEYS) { $(key).value = s[key]; showSize(key); }
}

async function save(body, message) {
  try {
    const res = await postJson('/api/update', body);
    if (!res.ok) { flash('Error', 'error'); return; }
    syncInputs(await res.json());
    flash(message, 'success');
  } catch (e) {
    if (e.message !== 'unauthorized') flash('Connection error', 'error');
  }
}

async function init() {
  const [stateRes, fontsRes] = await Promise.all([api('/api/state'), api('/api/fonts')]);
  const state = await stateRes.json();
  populateFonts(await fontsRes.json(), state.font);
  syncInputs(state);
}

$('font-upload-btn').addEventListener('click', async () => {
  const file = $('font-file').files[0];
  if (!file) { flash('Choose a font file', 'error'); return; }
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await api('/api/fonts', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      flash(err.detail || 'Upload failed', 'error');
      return;
    }
    const data = await res.json();
    populateFonts(data.fonts, data.name);
    $('font-file').value = '';
    flash('Uploaded ' + data.name, 'success');
  } catch (e) {
    if (e.message !== 'unauthorized') flash('Connection error', 'error');
  }
});

$('save-appearance-btn').addEventListener('click', () => {
  const body = { font: $('font-select').value };
  for (const key of COLOR_KEYS) body[key] = $(key).value;
  for (const key of SIZE_KEYS) body[key] = Number($(key).value);
  save(body, 'Appearance saved');
});

$('reset-appearance-btn').addEventListener('click', () => {
  if (!confirm('Reset font, colors and text sizes to defaults?')) return;
  save(window.DEFAULT_THEME, 'Appearance reset');
});

for (const key of SIZE_KEYS) $(key).addEventListener('input', () => showSize(key));

if (!token) {
  location.href = '/control';
} else {
  init().catch(() => {});
}
