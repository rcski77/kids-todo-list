const CIRC = 2 * Math.PI * 21; // r=21 → circumference ≈ 131.95

const PRESETS = [
  { label: '20 min', sec: 20 * 60 },
  { label: '30 min', sec: 30 * 60 },
  { label: '45 min', sec: 45 * 60 },
  { label: '60 min', sec: 60 * 60 },
];

const POLL_MS = 4000;

let kids = [];
let currentKidId = null;
let lastStateJSON = null;
let currentView = 'tasks';
let pottySummary = null;

// ── Global "get ready" timer (local, not tied to any kid) ──
let gTotal = 0, gLeft = 0, gRunning = false, gInterval = null;

// ── Brush teeth mini-timer ──
// The countdown is authoritative on the server (so the web app and the
// ESP32 display agree on it); these locals just mirror it for a smooth
// per-second UI tick between polls.
const BRUSH_TOTAL_DEFAULT = 120;
let brushTotal = BRUSH_TOTAL_DEFAULT;
let brushLeft = BRUSH_TOTAL_DEFAULT, brushRunning = false, brushInterval = null;
let brushTaskId = null;

async function api(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API error ${res.status} on ${path}`);
  return res.status === 204 ? null : res.json();
}

/* ═══ INIT ═══ */
async function init() {
  initPresets();
  document.getElementById('gGoBtn').onclick = toggleTimer;
  document.getElementById('gRstBtn').onclick = resetTimer;
  document.getElementById('doneResetBtn').onclick = resetKid;
  updateTimerUI();

  document.querySelectorAll('.view-tab').forEach((btn) => {
    btn.onclick = () => switchView(btn.dataset.view);
  });
  renderPottySkeleton();

  kids = await api('/kids');
  if (kids.length === 0) {
    document.getElementById('kidContent').innerHTML =
      `<div class="empty-state">No kids set up yet.<br><a href="admin.html">Add one in the admin page →</a></div>`;
    return;
  }

  const saved = localStorage.getItem('selectedKidId');
  currentKidId = kids.find((k) => String(k.id) === saved) ? Number(saved) : kids[0].id;

  renderKidSelector();
  renderKidSkeleton();
  await refreshState();
  setInterval(refreshState, POLL_MS);
  setInterval(() => {
    if (currentView === 'potty') refreshPotty();
  }, POLL_MS);
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.view-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.getElementById('tasksView').style.display = view === 'tasks' ? '' : 'none';
  document.getElementById('pottyView').style.display = view === 'potty' ? '' : 'none';
  if (view === 'potty') refreshPotty();
}

function renderKidSelector() {
  const el = document.getElementById('kidSelector');
  el.innerHTML = '';
  kids.forEach((k) => {
    const btn = document.createElement('button');
    btn.className = 'kid-tab' + (k.id === currentKidId ? ' active' : '');
    btn.innerHTML = `<span class="kid-emoji">${k.emoji}</span> ${k.name}`;
    btn.onclick = () => selectKid(k.id);
    el.appendChild(btn);
  });
}

async function selectKid(id) {
  if (id === currentKidId) return;
  currentKidId = id;
  localStorage.setItem('selectedKidId', String(id));
  lastStateJSON = null;
  renderKidSelector();
  renderKidSkeleton();
  document.getElementById('doneScreen').classList.remove('visible');
  await refreshState();
  if (currentView === 'potty') await refreshPotty();
}

function renderKidSkeleton() {
  document.getElementById('kidContent').innerHTML = `
    <div class="progress-area">
      <div class="progress-label">⭐ Stars Collected</div>
      <div class="stars-row" id="starsRow"></div>
    </div>

    <div class="hero-area" id="heroArea">
      <div class="hero-badge">👉 Do This Now!</div>
      <div class="hero-top">
        <div class="hero-emoji" id="heroEmoji"></div>
        <div class="hero-info">
          <div class="hero-name" id="heroName"></div>
          <div class="hero-detail" id="heroDetail"></div>
        </div>
      </div>
      <div id="brushTimerBlock" style="display:none">
        <div class="brush-timer">
          <div class="brush-arc-wrap">
            <svg viewBox="0 0 52 52">
              <circle class="brush-arc-bg" cx="26" cy="26" r="21"/>
              <circle class="brush-arc-fill" id="brushArc" cx="26" cy="26" r="21"
                stroke-dasharray="131.95" stroke-dashoffset="0"/>
            </svg>
          </div>
          <div class="brush-time" id="brushTime">2:00</div>
          <div class="brush-label">Brushing timer<span>Start when you begin brushing!</span></div>
          <button class="brush-go" id="brushGoBtn">▶ Start</button>
        </div>
      </div>
      <button class="done-btn" id="doneBtn">✅ Done! Next Task →</button>
    </div>
    <div class="timeline-wrap">
      <div class="timeline" id="timeline"></div>
    </div>
  `;
  document.getElementById('brushGoBtn').onclick = toggleBrushTimer;
  document.getElementById('doneBtn').onclick = completeCurrentTask;
}

/* ═══ STATE POLLING + RENDER ═══ */
async function refreshState() {
  if (!currentKidId) return;
  let state;
  try {
    state = await api(`/kids/${currentKidId}/state`);
  } catch (e) {
    return; // server hiccup — just try again next poll
  }
  const json = JSON.stringify(state);
  if (json === lastStateJSON) return; // nothing changed, skip re-render/animation
  const prevState = lastStateJSON ? JSON.parse(lastStateJSON) : null;
  lastStateJSON = json;
  render(state, prevState);
}

function render(state, prevState) {
  renderStars(state, prevState);
  renderHero(state);
  renderTimeline(state);

  if (state.allDone) {
    showDoneScreen(state);
  } else {
    document.getElementById('doneScreen').classList.remove('visible');
  }
}

function renderStars(state, prevState) {
  const row = document.getElementById('starsRow');
  if (!row) return;
  row.innerHTML = state.tasks
    .map((t) => `<span class="star-item ${t.done ? 'earned' : ''}">⭐</span>`)
    .join('');
  if (prevState && state.starsEarned > prevState.starsEarned) {
    miniConfetti();
  }
}

function renderHero(state) {
  const heroArea = document.getElementById('heroArea');
  const task = state.tasks.find((t) => t.id === state.currentTaskId);
  if (!task) {
    if (heroArea) heroArea.style.display = 'none';
    return;
  }
  if (heroArea) heroArea.style.display = '';
  document.getElementById('heroEmoji').textContent = task.emoji;
  document.getElementById('heroName').textContent = task.name;
  document.getElementById('heroDetail').textContent = task.detail;
  showBrushTimer(task.hasTimer, task.id, task.timerSeconds, state.timer);
}

function renderTimeline(state) {
  const el = document.getElementById('timeline');
  if (!el) return;
  el.innerHTML = '';
  state.tasks.forEach((task, i) => {
    if (task.id === state.currentTaskId) return;
    const card = document.createElement('div');
    card.className = `tl-card ${task.done ? 'done' : 'upcoming'}`;
    card.innerHTML = `
      <div class="tl-emoji">${task.emoji}</div>
      <div class="tl-info">
        <div class="tl-name">${task.name}</div>
        <div class="tl-sub">${task.done ? '✅ Done!' : task.detail}</div>
      </div>
      <div class="tl-check">${task.done ? '✓' : '○'}</div>
    `;
    el.appendChild(card);
    if (i < state.tasks.length - 1) {
      const conn = document.createElement('div');
      conn.className = `tl-connector ${task.done ? 'done' : ''}`;
      el.appendChild(conn);
    }
  });
}

async function completeCurrentTask() {
  const state = JSON.parse(lastStateJSON);
  if (!state.currentTaskId) return;
  const updated = await api(`/kids/${currentKidId}/complete/${state.currentTaskId}`, { method: 'POST' });
  const prevState = state;
  lastStateJSON = JSON.stringify(updated);
  miniConfetti();
  render(updated, prevState);
}

async function resetKid() {
  stopTimer();
  const updated = await api(`/kids/${currentKidId}/reset`, { method: 'POST' });
  lastStateJSON = JSON.stringify(updated);
  document.getElementById('doneScreen').classList.remove('visible');
  render(updated, null);
}

function showDoneScreen(state) {
  const el = document.getElementById('doneScreen');
  if (el.classList.contains('visible')) return;
  el.classList.add('visible');
  document.getElementById('doneStars').innerHTML = state.tasks.map(() => '⭐').join('');
  bigConfetti();
}

/* ═══ POTTY TRACKER ═══ */
// Lets a parent flip which mode a kid's ESP32 is showing (task list vs.
// potty counter), and shows a "high score" style chart of daily counts —
// the counts themselves come from the physical button press on the ESP32
// (or the manual buttons here, e.g. if the ESP32 is offline).
function renderPottySkeleton() {
  document.getElementById('pottyContent').innerHTML = `
    <div class="potty-mode-card">
      <div class="potty-mode-label">📟 ESP32 is showing</div>
      <div class="potty-mode-switch" id="pottyModeSwitch">
        <button class="mode-btn" data-mode="tasks">📋 To-Do List</button>
        <button class="mode-btn" data-mode="potty">🚽 Potty Counter</button>
      </div>
    </div>
    <div class="potty-today-card">
      <div class="potty-today-count" id="pottyTodayCount">0</div>
      <div class="potty-today-sub">🚽 visits today</div>
      <div class="potty-today-btns">
        <button class="potty-add-btn" id="pottyAddBtn">➕ Log a visit</button>
        <button class="potty-undo-btn" id="pottyUndoBtn">↺ Oops, undo</button>
      </div>
    </div>
    <div class="potty-chart-card">
      <div class="potty-chart-title">🏆 Last 7 Days<span id="pottyBest"></span></div>
      <div class="potty-chart" id="pottyChart"></div>
    </div>
  `;
  document.getElementById('pottyAddBtn').onclick = logPotty;
  document.getElementById('pottyUndoBtn').onclick = undoPotty;
  document.querySelectorAll('#pottyModeSwitch .mode-btn').forEach((btn) => {
    btn.onclick = () => setDisplayMode(btn.dataset.mode);
  });
}

async function refreshPotty() {
  if (!currentKidId) return;
  try {
    pottySummary = await api(`/kids/${currentKidId}/potty`);
  } catch (e) {
    return; // server hiccup — just try again next tab visit
  }
  renderPotty();
}

function renderPotty() {
  if (!pottySummary) return;

  document.getElementById('pottyTodayCount').textContent = pottySummary.today;
  document.getElementById('pottyBest').textContent =
    pottySummary.best > 0 ? ` · Best: ${pottySummary.best}` : '';

  const kid = kids.find((k) => k.id === currentKidId);
  const mode = (kid && kid.display_mode) || 'tasks';
  document.querySelectorAll('#pottyModeSwitch .mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  const chart = document.getElementById('pottyChart');
  const max = Math.max(1, ...pottySummary.history.map((h) => h.count));
  chart.innerHTML = pottySummary.history
    .map((h) => {
      const dayLabel = new Date(`${h.day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' })[0];
      const pct = Math.max(4, Math.round((h.count / max) * 100));
      const isBest = h.count > 0 && h.count === pottySummary.best;
      return `
        <div class="potty-bar-col">
          <div class="potty-bar-count">${isBest ? '🏆 ' : ''}${h.count}</div>
          <div class="potty-bar-track"><div class="potty-bar-fill" style="height:${pct}%"></div></div>
          <div class="potty-bar-label">${dayLabel}</div>
        </div>`;
    })
    .join('');
}

async function logPotty() {
  pottySummary = await api(`/kids/${currentKidId}/potty`, { method: 'POST' });
  renderPotty();
  miniConfetti();
}

async function undoPotty() {
  pottySummary = await api(`/kids/${currentKidId}/potty/undo`, { method: 'POST' });
  renderPotty();
}

async function setDisplayMode(mode) {
  const kid = await api(`/kids/${currentKidId}`, {
    method: 'PATCH',
    body: JSON.stringify({ displayMode: mode }),
  });
  const idx = kids.findIndex((k) => k.id === kid.id);
  if (idx !== -1) kids[idx] = kid;
  renderPotty();
}

/* ═══ GLOBAL "GET READY" TIMER ═══ */
function initPresets() {
  const el = document.getElementById('gPresets');
  el.innerHTML = '';
  PRESETS.forEach(({ label, sec }) => {
    const btn = document.createElement('button');
    btn.className = 'g-preset' + (gTotal === sec && gLeft === gTotal ? ' active' : '');
    btn.textContent = label;
    btn.onclick = () => setTimer(sec);
    el.appendChild(btn);
  });
}

function setTimer(sec) {
  stopTimer();
  gTotal = sec;
  gLeft = sec;
  updateTimerUI();
  initPresets();
}

function toggleTimer() {
  if (gLeft <= 0 && gTotal <= 0) return;
  gRunning ? stopTimer() : startTimer();
}

function startTimer() {
  if (gLeft <= 0) { if (gTotal > 0) gLeft = gTotal; else return; }
  gRunning = true;
  const btn = document.getElementById('gGoBtn');
  btn.textContent = '⏸ Pause';
  btn.classList.add('running');
  gInterval = setInterval(() => {
    gLeft--;
    updateTimerUI();
    if (gLeft <= 0) { stopTimer(); timerDone(); }
  }, 1000);
}

function stopTimer() {
  gRunning = false;
  clearInterval(gInterval); gInterval = null;
  const btn = document.getElementById('gGoBtn');
  btn.textContent = '▶ Start';
  btn.classList.remove('running');
}

function resetTimer() {
  stopTimer();
  gLeft = gTotal;
  updateTimerUI();
}

function updateTimerUI() {
  const timeEl = document.getElementById('gTime');
  const arcEl = document.getElementById('gArcFill');

  if (gTotal === 0) {
    timeEl.textContent = '–:––';
    timeEl.classList.remove('warn');
    arcEl.style.strokeDashoffset = 0;
    arcEl.classList.remove('warn');
    return;
  }

  const m = Math.floor(gLeft / 60);
  const s = gLeft % 60;
  timeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;

  const warn = gLeft <= 60 && gLeft > 0;
  timeEl.classList.toggle('warn', warn);
  arcEl.classList.toggle('warn', warn);

  const frac = gLeft / gTotal;
  arcEl.style.strokeDashoffset = CIRC * (1 - frac);
}

function timerDone() {
  if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
  const gt = document.querySelector('.global-timer');
  gt.style.transition = 'background 0.15s';
  gt.style.background = '#FFD0D0';
  setTimeout(() => { gt.style.background = 'rgba(255,255,255,0.88)'; }, 600);
  bigConfetti();
}

/* ═══ BRUSH TIMER ═══ */
// The countdown itself is authoritative on the server (see /timer/start and
// /timer/pause); these functions just mirror that into a smooth local
// per-second tick and reconcile with the server on every poll.
function showBrushTimer(show, taskId, timerSeconds, timerInfo) {
  const block = document.getElementById('brushTimerBlock');
  if (!block) return;
  block.style.display = show ? 'block' : 'none';
  if (!show) {
    stopBrushInterval();
    return;
  }
  if (taskId !== brushTaskId) {
    brushTaskId = taskId;
    brushTotal = timerSeconds || BRUSH_TOTAL_DEFAULT;
  }
  syncBrushFromServer(timerInfo);
}

// Applies the server's view of the timer (or "not started" if null) and
// starts/stops the local 1-second tick to match.
function syncBrushFromServer(timerInfo) {
  if (timerInfo) {
    brushLeft = timerInfo.remainingSeconds;
    brushRunning = timerInfo.running;
  } else {
    brushLeft = brushTotal;
    brushRunning = false;
  }
  updateBrushButton();
  updateBrushUI();

  const finished = brushLeft <= 0;
  if (brushRunning && !finished && !brushInterval) {
    brushInterval = setInterval(() => {
      brushLeft = Math.max(0, brushLeft - 1);
      updateBrushUI();
      if (brushLeft <= 0) {
        stopBrushInterval();
        brushRunning = false;
        updateBrushButton();
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        miniConfetti();
      }
    }, 1000);
  } else if ((!brushRunning || finished) && brushInterval) {
    stopBrushInterval();
  }
}

function stopBrushInterval() {
  clearInterval(brushInterval);
  brushInterval = null;
}

function updateBrushButton() {
  const btn = document.getElementById('brushGoBtn');
  if (!btn) return;
  const finished = brushLeft <= 0;
  btn.classList.toggle('running', brushRunning && !finished);
  btn.classList.toggle('finished', finished);
  btn.textContent = finished ? '✓ Done!' : brushRunning ? '⏸ Pause' : '▶ Start';
}

async function toggleBrushTimer() {
  const prevState = JSON.parse(lastStateJSON);
  const updated = brushRunning
    ? await api(`/kids/${currentKidId}/timer/pause`, { method: 'POST' })
    : await api(`/kids/${currentKidId}/timer/start`, {
        method: 'POST',
        body: JSON.stringify({ taskId: brushTaskId }),
      });
  lastStateJSON = JSON.stringify(updated);
  render(updated, prevState);
}

function updateBrushUI() {
  const m = Math.floor(brushLeft / 60);
  const s = brushLeft % 60;
  const timeEl = document.getElementById('brushTime');
  const arcEl = document.getElementById('brushArc');
  if (!timeEl || !arcEl) return;
  timeEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  const finished = brushLeft <= 0;
  timeEl.classList.toggle('done-time', finished);
  arcEl.classList.toggle('done-arc', finished);
  const frac = brushLeft / brushTotal;
  arcEl.style.strokeDashoffset = CIRC * (1 - frac);
}

/* ═══ CONFETTI ═══ */
function miniConfetti() {
  const wrap = document.getElementById('confettiWrap');
  const colors = ['#FFD700', '#FF6B6B', '#6BCB77', '#4D96FF', '#FFB347', '#C77DFF'];
  for (let i = 0; i < 22; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.cssText = `left:${20 + Math.random() * 60}vw;top:${5 + Math.random() * 40}vh;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      animation-delay:${Math.random() * 0.3}s;animation-duration:${0.9 + Math.random() * 0.5}s;
      border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`;
    wrap.appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
}

function bigConfetti() {
  const wrap = document.getElementById('confettiWrap');
  const colors = ['#FFD700', '#FF6B6B', '#6BCB77', '#4D96FF', '#FFB347', '#C77DFF', '#fff'];
  for (let i = 0; i < 90; i++) {
    setTimeout(() => {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      const sz = 8 + Math.random() * 10;
      p.style.cssText = `left:${Math.random() * 100}vw;top:0;
        background:${colors[Math.floor(Math.random() * colors.length)]};
        animation-duration:${1 + Math.random() * 0.9}s;
        width:${sz}px;height:${sz}px;
        border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`;
      wrap.appendChild(p);
      setTimeout(() => p.remove(), 2200);
    }, i * 16);
  }
}

init();
