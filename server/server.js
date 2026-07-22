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
  const kid = db.prepare('SELECT * FROM kids WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(kid);
});

app.delete('/api/kids/:kidId', (req, res) => {
  db.prepare('DELETE FROM kids WHERE id = ?').run(req.params.kidId);
  res.status(204).end();
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
  res.json(buildState(kid));
});

app.post('/api/kids/:kidId/reset', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const day = today();
  db.prepare('DELETE FROM completions WHERE kid_id = ? AND day = ?').run(kid.id, day);
  res.json(buildState(kid));
});

// ── Lightweight display feed for the ESP32 ──────────
app.get('/api/kids/:kidId/display', (req, res) => {
  const kid = getKidOr404(req, res);
  if (!kid) return;
  const state = buildState(kid);
  const index = state.tasks.findIndex((t) => t.id === state.currentTaskId);
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
  });
});

app.listen(PORT, () => {
  console.log(`Morning Mission server listening on port ${PORT}`);
});
