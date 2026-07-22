const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'app.db');

require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS kids (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '🧒',
    color TEXT NOT NULL DEFAULT '#FFB800',
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    emoji TEXT NOT NULL DEFAULT '⭐',
    name TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    has_timer INTEGER NOT NULL DEFAULT 0,
    timer_seconds INTEGER NOT NULL DEFAULT 120
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    kid_id INTEGER NOT NULL REFERENCES kids(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    UNIQUE(task_id, day)
  );
`);

const DEFAULT_TASKS = [
  ['⏰', 'Wake Up & Stretch', 'Big stretch — arms up high!', 0, 0],
  ['🚽', 'Potty Time', 'Go to the bathroom', 0, 0],
  ['🍳', 'Eat Breakfast', 'Fuel up for your mission!', 0, 0],
  ['💧', 'Wash Face and Hands', 'Splash splash!', 0, 0],
  ['🪥', 'Brush Teeth', 'Top and bottom — 2 whole minutes!', 1, 120],
  ['👕', 'Get Dressed', 'Clothes are ready for you!', 0, 0],
  ['🎒', 'Pack Your Backpack', 'Lunch, Folder, Water bottle', 0, 0],
  ['👟', 'Shoes and Jacket On', 'Almost time to blast off!', 0, 0],
  ['🚪', 'Out the Door!', 'MISSION COMPLETE!', 0, 0],
];

function seedDefaultTasks(kidId) {
  const insertTask = db.prepare(`
    INSERT INTO tasks (kid_id, sort_order, emoji, name, detail, has_timer, timer_seconds)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  DEFAULT_TASKS.forEach((t, i) => {
    insertTask.run(kidId, i, t[0], t[1], t[2], t[3], t[4]);
  });
}

// Seed a default kid + the original morning routine tasks on first run.
const kidCount = db.prepare('SELECT COUNT(*) AS n FROM kids').get().n;
if (kidCount === 0) {
  const insertKid = db.prepare(
    'INSERT INTO kids (name, emoji, color, sort_order) VALUES (?, ?, ?, ?)'
  );
  const { lastInsertRowid: kidId } = insertKid.run('Buddy', '🚀', '#FFB800', 0);
  seedDefaultTasks(kidId);
}

module.exports = db;
module.exports.seedDefaultTasks = seedDefaultTasks;
