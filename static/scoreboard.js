const state = JSON.parse(document.getElementById('initial-state').textContent);
const WS_URL = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/ws';

const THEME_VARS = {
  p1_color_start: '--p1-color-start', p1_color_end: '--p1-color-end',
  p2_color_start: '--p2-color-start', p2_color_end: '--p2-color-end',
  round_bg_color: '--round-bg', round_text_color: '--round-text',
  player_text_color: '--player-text', event_text_color: '--event-text',
};
const SIZE_VARS = {
  name_size: '--name-size', score_size: '--score-size',
  round_size: '--round-size', event_size: '--event-size',
};
let appliedFont = null;

function applyTheme(s) {
  for (const [key, cssVar] of Object.entries(THEME_VARS)) {
    if (s[key]) document.documentElement.style.setProperty(cssVar, s[key]);
  }
  for (const [key, cssVar] of Object.entries(SIZE_VARS)) {
    if (Number.isFinite(s[key])) document.documentElement.style.setProperty(cssVar, s[key] + 'px');
  }
  if (s.font && s.font !== appliedFont) {
    appliedFont = s.font;
    document.getElementById('font-face').textContent =
      `@font-face { font-family: 'Scoreboard Font'; src: url("/fonts/${encodeURIComponent(s.font)}"); }`;
  }
}

const busy = {};
let ws, reconnectTimer;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (e) => {
    applyUpdate(JSON.parse(e.data));
  };

  ws.onclose = () => {
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = () => ws.close();
}

function applyUpdate(next) {
  applyTheme(next);
  if (next.player1_name  !== state.player1_name)  animateName('p1-name', next.player1_name);
  if (next.player2_name  !== state.player2_name)  animateName('p2-name', next.player2_name);
  if (next.player1_score !== state.player1_score) animateScore('p1-score', next.player1_score);
  if (next.player2_score !== state.player2_score) animateScore('p2-score', next.player2_score);
  if (next.round         !== state.round)         animateRound(next.round);
  if (next.event_name    !== state.event_name)    animateBottomBar(next.event_name);
  Object.assign(state, next);
}

function animateScore(id, newValue) {
  if (busy[id]) return;
  busy[id] = true;
  const el = document.getElementById(id);
  el.classList.add('flip-out');
  setTimeout(() => {
    el.textContent = newValue;
    el.classList.remove('flip-out');
    el.classList.add('flip-in');
    setTimeout(() => { el.classList.remove('flip-in'); busy[id] = false; }, 250);
  }, 180);
}

function animateName(id, newValue) {
  if (busy[id]) return;
  busy[id] = true;
  const el = document.getElementById(id);
  el.classList.add('text-out');
  setTimeout(() => {
    el.textContent = newValue;
    el.classList.remove('text-out');
    el.classList.add('text-in');
    setTimeout(() => { el.classList.remove('text-in'); busy[id] = false; }, 300);
  }, 220);
}

function animateRound(newValue) {
  if (busy['round-text']) return;
  busy['round-text'] = true;
  const el = document.getElementById('round-text');
  el.classList.add('text-out');
  setTimeout(() => {
    el.textContent = newValue;
    el.classList.remove('text-out');
    el.classList.add('text-in', 'round-pulse');
    setTimeout(() => {
      el.classList.remove('text-in', 'round-pulse');
      busy['round-text'] = false;
    }, 600);
  }, 220);
}

function animateBottomBar(newValue) {
  if (busy['bottom-bar']) return;
  busy['bottom-bar'] = true;
  const bar = document.querySelector('.bottom-bar');
  bar.style.transition = 'transform .3s ease-in';
  bar.style.transform = 'translateX(-50%) translateY(150%)';
  setTimeout(() => {
    document.getElementById('event-name').textContent = newValue;
    bar.style.transition = 'transform .55s cubic-bezier(.16,1,.3,1)';
    bar.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      bar.style.transition = '';
      bar.style.transform = '';
      busy['bottom-bar'] = false;
    }, 600);
  }, 320);
}

applyTheme(state);
connect();
