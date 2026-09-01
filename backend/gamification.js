import db from "./db.js";

// --- XP curve -------------------------------------------------------------
// XP required to reach level N (from level 1). Gentle early, steeper later.
export function xpForLevel(level) {
  return Math.round(50 * Math.pow(level, 1.6));
}

export function levelFromXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

// --- XP reward for completing a task --------------------------------------
const PRIORITY_MULTIPLIER = { low: 0.75, normal: 1, high: 1.25, urgent: 1.5 };

export function xpForTask(task) {
  const base = task.story_points * 10;
  const mult = PRIORITY_MULTIPLIER[task.priority] ?? 1;
  return Math.round(base * mult);
}

// --- Streak logic -----------------------------------------------------------
function daysBetween(a, b) {
  const d1 = new Date(a + "T00:00:00Z");
  const d2 = new Date(b + "T00:00:00Z");
  return Math.round((d2 - d1) / 86400000);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function updateStreak(user) {
  const today = todayStr();
  if (!user.last_completed_date) {
    return { current_streak: 1, longest_streak: Math.max(1, user.longest_streak) };
  }
  const gap = daysBetween(user.last_completed_date, today);
  if (gap === 0) {
    // already completed something today, streak unchanged
    return { current_streak: user.current_streak, longest_streak: user.longest_streak };
  }
  if (gap === 1) {
    const next = user.current_streak + 1;
    return { current_streak: next, longest_streak: Math.max(next, user.longest_streak) };
  }
  // streak broken
  return { current_streak: 1, longest_streak: user.longest_streak };
}

// --- Achievement checks -----------------------------------------------------
function grantAchievement(userId, code) {
  const ach = db.prepare("SELECT id FROM achievements WHERE code = ?").get(code);
  if (!ach) return null;
  const already = db
    .prepare("SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?")
    .get(userId, ach.id);
  if (already) return null;
  db.prepare(
    "INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)"
  ).run(userId, ach.id);
  return db.prepare("SELECT * FROM achievements WHERE id = ?").get(ach.id);
}

function checkAchievements(user, task, totalCompleted) {
  const unlocked = [];
  if (totalCompleted === 1) {
    const a = grantAchievement(user.id, "first_blood");
    if (a) unlocked.push(a);
  }
  if (totalCompleted === 10) {
    const a = grantAchievement(user.id, "ten_tasks");
    if (a) unlocked.push(a);
  }
  if (user.current_streak >= 5) {
    const a = grantAchievement(user.id, "five_streak");
    if (a) unlocked.push(a);
  }
  if (task.story_points >= 8) {
    const a = grantAchievement(user.id, "big_one");
    if (a) unlocked.push(a);
  }
  if (user.level >= 5) {
    const a = grantAchievement(user.id, "level_5");
    if (a) unlocked.push(a);
  }
  return unlocked;
}

// --- Main entry point: call this when a task moves to "done" ---------------
export function awardTaskCompletion(userId, task) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) throw new Error("User not found");

  const xpGained = xpForTask(task);
  const newXp = user.xp + xpGained;
  const oldLevel = user.level;
  const newLevel = levelFromXp(newXp);
  const { current_streak, longest_streak } = updateStreak(user);

  db.prepare(
    `UPDATE users SET xp = ?, level = ?, current_streak = ?, longest_streak = ?, last_completed_date = ?
     WHERE id = ?`
  ).run(newXp, newLevel, current_streak, longest_streak, todayStr(), userId);

  const updatedUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);

  const totalCompleted = db
    .prepare("SELECT COUNT(*) as c FROM tasks WHERE assignee_id = ? AND status = 'done'")
    .get(userId).c;

  const unlockedAchievements = checkAchievements(updatedUser, task, totalCompleted);

  return {
    xpGained,
    totalXp: newXp,
    leveledUp: newLevel > oldLevel,
    oldLevel,
    newLevel,
    currentStreak: current_streak,
    longestStreak: longest_streak,
    unlockedAchievements,
    xpToNextLevel: xpForLevel(newLevel + 1),
    xpForCurrentLevel: xpForLevel(newLevel),
  };
}
