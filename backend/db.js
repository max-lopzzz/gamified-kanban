import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "gamified_kanban.sqlite";
const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL COLLATE NOCASE,
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
  PRIMARY KEY (board_id, user_id),
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS board_invitations (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sprints (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  name TEXT NOT NULL,
  starts_at TEXT,
  ends_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  sprint_id TEXT,

  title TEXT NOT NULL,
  description TEXT DEFAULT '',

  status TEXT NOT NULL DEFAULT 'backlog',
  priority TEXT NOT NULL DEFAULT 'normal',

  story_points INTEGER NOT NULL DEFAULT 1,

  assignee_type TEXT NOT NULL DEFAULT 'unassigned',
  assignee_id TEXT,
  team_id TEXT,

  position INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
  FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE SET NULL,
  FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id TEXT NOT NULL,
  depends_on_task_id TEXT NOT NULL,

  PRIMARY KEY (task_id, depends_on_task_id),

  FOREIGN KEY (task_id)
    REFERENCES tasks(id)
    ON DELETE CASCADE,

  FOREIGN KEY (depends_on_task_id)
    REFERENCES tasks(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS task_assignees (
  task_id TEXT NOT NULL,
  assignee_type TEXT NOT NULL,        -- 'user' | 'team'
  assignee_id TEXT NOT NULL,          -- user id or team id

  PRIMARY KEY (task_id, assignee_type, assignee_id),

  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
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

/*
 * Existing databases need the new task columns.
 * SQLite will throw if the column already exists, so we
 * conditionally add them.
 */

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();

  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing(
  "tasks",
  "assignee_type",
  "TEXT NOT NULL DEFAULT 'unassigned'"
);

addColumnIfMissing(
  "tasks",
  "team_id",
  "TEXT"
);

addColumnIfMissing(
  "sprints",
  "created_at",
  "TEXT NOT NULL DEFAULT (datetime('now'))"
);

addColumnIfMissing("sprints", "goal", "TEXT DEFAULT ''");

addColumnIfMissing("teams", "description", "TEXT DEFAULT ''");

// Who moved the task to "done" (may differ from assignee_id for team /
// unassigned tasks) — used to credit XP and count completions.
addColumnIfMissing("tasks", "completed_by", "TEXT");

/*
 * Backfill task_assignees from the old single-assignee columns, once.
 * (Tasks can now have several people / teams assigned.)
 */
if (db.prepare("SELECT COUNT(*) AS c FROM task_assignees").get().c === 0) {
  const legacy = db
    .prepare(
      `SELECT id, assignee_type, assignee_id, team_id FROM tasks
       WHERE assignee_type IN ('user', 'team')`
    )
    .all();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO task_assignees (task_id, assignee_type, assignee_id)
     VALUES (?, ?, ?)`
  );
  for (const t of legacy) {
    if (t.assignee_type === "user" && t.assignee_id) {
      insert.run(t.id, "user", t.assignee_id);
    } else if (t.assignee_type === "team" && t.team_id) {
      insert.run(t.id, "team", t.team_id);
    }
  }
}

/*
 * One-time normalization: older rows may have mixed-case emails from before
 * emails were lowercased on write. Lowercase each, skipping any that would
 * collide with an existing lowercase row (left as-is for manual cleanup).
 */
const mixedCaseUsers = db
  .prepare("SELECT id, email FROM users WHERE email <> lower(email)")
  .all();

if (mixedCaseUsers.length > 0) {
  const collides = db.prepare(
    "SELECT 1 FROM users WHERE email = lower(?) AND id <> ?"
  );
  const lowercaseEmail = db.prepare(
    "UPDATE users SET email = lower(email) WHERE id = ?"
  );

  for (const user of mixedCaseUsers) {
    if (collides.get(user.email, user.id)) {
      console.warn(
        `[db] skipping email normalization for user ${user.id}: ` +
          `lower(${user.email}) already exists`
      );
      continue;
    }
    lowercaseEmail.run(user.id);
  }
}

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
