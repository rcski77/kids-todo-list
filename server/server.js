const path = require('path');
const express = require('express');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function today() {
  // YYYY-MM-DD in the server's local timezone (set TZ env var in docker-compose).
  return new Date().toLocaleDateString('en-CA');
}

function getKidOr404(req, res) {
  const kid = db.prepare('SELECT * FROM kids WHERE id = ?').get(req.params.kidId);
  if (!kid) {
    res.status(404).json({ error: 'kid not found' });
    return null;
  }
  return kid;
}

// Computes a timer row's live remaining time, accounting for time elapsed
// since it was last started (if it's currently running).
function computeTimerRemaining(row) {
  if (!row.running) return row.remaining_seconds;
  const elapsedSec = Math.floor((Date.now() - Date.parse(row.started_at)) / 1000);
  return Math.max(0, row.remaining_seconds - elapsedSec);
}

// Returns the live timer state for a kid, but only if it belongs to the
// task passed in (a stale timer from a since-completed task is ignored).
function getTimerForTask(kidId, taskId) {
  if (!taskId) return null;
  const row = db.prepare('SELECT * FROM timers WHERE kid_id = ?').get(kidId);
  if (!row || row.task_id !== taskId) return null;
  return {
    totalSeconds: row.total_seconds,
    remainingSeconds: computeTimerRemaining(row),
    running: !!row.running,
  };
}

function clearTimer(kidId) {
  db.prepare('DELETE FROM timers WHERE kid_id = ?').run(kidId);
}

// Zero-filled daily potty counts for the last `days` calendar days (oldest first).
function pottyHistory(kidId, days) {
  const rows = db
    .prepare('SELECT day, COUNT(*) AS count FROM potty_events WHERE kid_id = ? GROUP BY day')
    .all(kidId);
  const counts = new Map(rows.map((r) => [r.day, r.count]));
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = d.toLocaleDateString('en-CA');
    result.push({ day, count: counts.get(day) || 0 });
  }
  return result;
}

function buildPottySummary(kidId) {
  const history = pottyHistory(kidId, 7);
  const today = history[history.length - 1].count;
  const bestRow = db
    .prepare(
      'SELECT COALESCE(MAX(c), 0) AS m FROM (SELECT COUNT(*) AS c FROM potty_events WHERE kid_id = ? GROUP BY day)'
    )
    .get(kidId);
  return { today, best: bestRow.m, history };
}

function buildState(kid) {
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE kid_id = ? ORDER BY sort_order ASC, id ASC')
    .all(kid.id);

  const day = today();
  const doneIds = new Set(
    db
      .prepare('SELECT task_id FROM completions WHERE kid_id = ? AND day = ?')
      .all(kid.id, day)
      .map((r) => r.task_id)
  );

  const tasksWithDone = tasks.map((t) => ({
    id: t.id,
    emoji: t.emoji,
    name: t.name,
    detail: t.detail,
    hasTimer: !!t.has_timer,
    timerSeconds: t.timer_seconds,
    done: doneIds.has(t.id),
  }));

  const currentTask = tasksWithDone.find((t) => !t.done) || null;
  const allDone = tasks.length > 0 && !currentTask;

  return {
    kid: { id: kid.id, name: kid.name, emoji: kid.emoji, color: kid.color },
    tasks: tasksWithDone,
    currentTaskId: currentTask ? currentTask.id : null,
    starsEarned: doneIds.size,
    totalTasks: tasks.length,
    allDone,
    timer: currentTask ? getTimerForTask(kid.id, currentTask.id) : null,
  };
}

// ── Kids ──────────────────────────────────────────────
app.get('/api/kids', (req, res) => {
  const kids = db.prepare('SELECT * FROM kids ORDER BY sort_order ASC, id ASC').all();
  res.json(kids);
});

app.post('/api/kids', (req, res) => {
  const { name, emoji, color } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM kids').get().m;
  const result = db
    .prepare('INSERT INTO kids (name, emoji, color, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, emoji || '🧒', color || '#FFB800', maxOrder + 1);
  db.seedDefaultTasks(result.lastInsertRowid);
  const kid = db.prepare('SELECT * FROM kids WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(kid);
});

app.delete('/api/kids/:kidId', (req, res) => {
  db.prepare('DELETE FROM kids WHERE id = ?').run(req.params.kidId);
  res.status(204).end();
});

// Currently only used to flip which mode a kid's ESP32 is showing
// (the task list vs. the potty counter).
app.patch('/api/kids/:kidId', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const { displayMode } = req.body;
  if (displayMode !== undefined) {
    if (!['tasks', 'potty'].includes(displayMode)) {
      return res.status(400).json({ error: 'displayMode must be "tasks" or "potty"' });
    }
    db.prepare('UPDATE kids SET display_mode = ? WHERE id = ?').run(displayMode, kid.id);
  }
  res.json(db.prepare('SELECT * FROM kids WHERE id = ?').get(kid.id));
});

// ── Tasks (per kid) ──────────────────────────────────
app.get('/api/kids/:kidId/tasks', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const tasks = db
    .prepare('SELECT * FROM tasks WHERE kid_id = ? ORDER BY sort_order ASC, id ASC')
    .all(kid.id);
  res.json(tasks);
});

app.post('/api/kids/:kidId/tasks', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const { emoji, name, detail, hasTimer, timerSeconds } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const maxOrder = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tasks WHERE kid_id = ?')
    .get(kid.id).m;
  const result = db
    .prepare(
      `INSERT INTO tasks (kid_id, sort_order, emoji, name, detail, has_timer, timer_seconds)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(kid.id, maxOrder + 1, emoji || '⭐', name, detail || '', hasTimer ? 1 : 0, timerSeconds || 120);
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(task);
});

app.patch('/api/tasks/:taskId', (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'task not found' });

  const emoji = req.body.emoji !== undefined ? req.body.emoji : task.emoji;
  const name = req.body.name !== undefined ? req.body.name : task.name;
  const detail = req.body.detail !== undefined ? req.body.detail : task.detail;
  const hasTimer = req.body.hasTimer !== undefined ? (req.body.hasTimer ? 1 : 0) : task.has_timer;
  const timerSeconds =
    req.body.timerSeconds !== undefined
      ? Math.max(1, Number(req.body.timerSeconds) || task.timer_seconds)
      : task.timer_seconds;

  if (!name) return res.status(400).json({ error: 'name is required' });

  db.prepare(
    'UPDATE tasks SET emoji = ?, name = ?, detail = ?, has_timer = ?, timer_seconds = ? WHERE id = ?'
  ).run(emoji, name, detail, hasTimer, timerSeconds, task.id);
  // Avoid a stale in-progress timer referencing the old duration.
  clearTimer(task.kid_id);

  res.json(db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id));
});

// Persists a new task order after drag-and-drop reordering in the admin UI.
app.post('/api/kids/:kidId/tasks/reorder', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const { taskIds } = req.body;
  if (!Array.isArray(taskIds)) return res.status(400).json({ error: 'taskIds must be an array' });

  const setOrder = db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ? AND kid_id = ?');
  const applyOrder = db.transaction((ids) => {
    ids.forEach((id, i) => setOrder.run(i, id, kid.id));
  });
  applyOrder(taskIds);

  res.json(
    db.prepare('SELECT * FROM tasks WHERE kid_id = ? ORDER BY sort_order ASC, id ASC').all(kid.id)
  );
});

app.delete('/api/tasks/:taskId', (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.taskId);
  res.status(204).end();
});

// ── State (for the web UI) ──────────────────────────
app.get('/api/kids/:kidId/state', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  res.json(buildState(kid));
});

app.post('/api/kids/:kidId/complete/:taskId', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const day = today();
  db.prepare(
    'INSERT OR IGNORE INTO completions (task_id, kid_id, day, completed_at) VALUES (?, ?, ?, ?)'
  ).run(req.params.taskId, kid.id, day, new Date().toISOString());
  clearTimer(kid.id);
  res.json(buildState(kid));
});

// Completes whichever task is currently active, without the caller needing
// to know its id — used by the ESP32's physical "next task" button.
app.post('/api/kids/:kidId/advance', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const state = buildState(kid);
  if (state.currentTaskId) {
    const day = today();
    db.prepare(
      'INSERT OR IGNORE INTO completions (task_id, kid_id, day, completed_at) VALUES (?, ?, ?, ?)'
    ).run(state.currentTaskId, kid.id, day, new Date().toISOString());
    clearTimer(kid.id);
  }
  res.json(buildState(kid));
});

app.post('/api/kids/:kidId/uncomplete/:taskId', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const day = today();
  db.prepare('DELETE FROM completions WHERE task_id = ? AND kid_id = ? AND day = ?').run(
    req.params.taskId,
    kid.id,
    day
  );
  clearTimer(kid.id);
  res.json(buildState(kid));
});

app.post('/api/kids/:kidId/reset', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const day = today();
  db.prepare('DELETE FROM completions WHERE kid_id = ? AND day = ?').run(kid.id, day);
  clearTimer(kid.id);
  res.json(buildState(kid));
});

// ── Task timer (e.g. the brush-teeth countdown) ─────
// Server-authoritative so the web app and the ESP32 display agree on how
// much time is left, regardless of which one started/paused it.
app.post('/api/kids/:kidId/timer/start', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const { taskId } = req.body;
  const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND kid_id = ?').get(taskId, kid.id);
  if (!task) return res.status(400).json({ error: 'invalid taskId' });

  const existing = db.prepare('SELECT * FROM timers WHERE kid_id = ?').get(kid.id);
  const now = new Date().toISOString();

  if (existing && existing.task_id === Number(taskId) && existing.remaining_seconds > 0) {
    // Resume from wherever it was left (paused or already running).
    db.prepare('UPDATE timers SET running = 1, started_at = ? WHERE kid_id = ?').run(now, kid.id);
  } else {
    db.prepare(
      `INSERT OR REPLACE INTO timers (kid_id, task_id, total_seconds, remaining_seconds, running, started_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    ).run(kid.id, task.id, task.timer_seconds, task.timer_seconds, now);
  }
  res.json(buildState(kid));
});

app.post('/api/kids/:kidId/timer/pause', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const row = db.prepare('SELECT * FROM timers WHERE kid_id = ?').get(kid.id);
  if (row && row.running) {
    const remaining = computeTimerRemaining(row);
    db.prepare('UPDATE timers SET running = 0, remaining_seconds = ?, started_at = NULL WHERE kid_id = ?').run(
      remaining,
      kid.id
    );
  }
  res.json(buildState(kid));
});

// ── Potty tracker ────────────────────────────────────
app.get('/api/kids/:kidId/potty', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  res.json(buildPottySummary(kid.id));
});

app.post('/api/kids/:kidId/potty', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  db.prepare('INSERT INTO potty_events (kid_id, day, logged_at) VALUES (?, ?, ?)').run(
    kid.id,
    today(),
    new Date().toISOString()
  );
  res.json(buildPottySummary(kid.id));
});

// Removes the most recent log for today, for correcting an accidental press.
app.post('/api/kids/:kidId/potty/undo', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const last = db
    .prepare('SELECT id FROM potty_events WHERE kid_id = ? AND day = ? ORDER BY id DESC LIMIT 1')
    .get(kid.id, today());
  if (last) db.prepare('DELETE FROM potty_events WHERE id = ?').run(last.id);
  res.json(buildPottySummary(kid.id));
});

// ── Lightweight display feed for the ESP32 ──────────
app.get('/api/kids/:kidId/display', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const state = buildState(kid);
  const index = state.tasks.findIndex((t) => t.id === state.currentTaskId);
  const potty = buildPottySummary(kid.id);
  res.json({
    kidName: state.kid.name,
    kidEmoji: state.kid.emoji,
    index: index === -1 ? state.totalTasks : index + 1, // 1-based; totalTasks when all done
    total: state.totalTasks,
    current: state.currentTaskId
      ? state.tasks.find((t) => t.id === state.currentTaskId)
      : null,
    allDone: state.allDone,
    starsEarned: state.starsEarned,
    timer: state.timer,
    displayMode: kid.display_mode,
    potty: { today: potty.today, best: potty.best },
  });
});

app.listen(PORT, () => {
  console.log(`Morning Mission server listening on port ${PORT}`);
});
