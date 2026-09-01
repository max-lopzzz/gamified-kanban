import Database from "better-sqlite3";

const db = new Database("gamified_kanban.sqlite");
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_completed_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS board_members (
  board_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  PRIMARY KEY (board_id, user_id)
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  sprint_id TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'backlog', -- backlog | todo | in_progress | done
  priority TEXT NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  story_points INTEGER NOT NULL DEFAULT 1,
  assignee_id TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (board_id) REFERENCES boards(id),
  FOREIGN KEY (sprint_id) REFERENCES sprints(id),
  FOREIGN KEY (assignee_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'star'
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL,
  achievement_id TEXT NOT NULL,
  unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, achievement_id)
);
`);

// Seed default achievements if empty
const count = db.prepare("SELECT COUNT(*) as c FROM achievements").get().c;
if (count === 0) {
  const insert = db.prepare(
    "INSERT INTO achievements (id, code, name, description, icon) VALUES (?, ?, ?, ?, ?)"
  );
  const seed = [
    ["first_blood", "First Blood", "Complete your first task", "sword"],
    ["five_streak", "On a Roll", "Reach a 5-day completion streak", "flame"],
    ["ten_tasks", "Grinder", "Complete 10 tasks total", "hammer"],
    ["big_one", "Boss Fight", "Complete a task worth 8+ story points", "shield"],
    ["level_5", "Veteran", "Reach level 5", "trophy"],
  ];
  for (const [code, name, description, icon] of seed) {
    insert.run(`ach_${code}`, code, name, description, icon);
  }
}

export default db;
