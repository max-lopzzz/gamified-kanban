import { Router } from "express";
import db from "../db.js";
import { xpForLevel } from "../gamification.js";

const router = Router();

router.get("/me", (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const achievements = db
    .prepare(
      `SELECT a.* , ua.unlocked_at FROM achievements a
       JOIN user_achievements ua ON ua.achievement_id = a.id
       WHERE ua.user_id = ? ORDER BY ua.unlocked_at DESC`
    )
    .all(req.userId);
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    xp: user.xp,
    level: user.level,
    currentStreak: user.current_streak,
    longestStreak: user.longest_streak,
    xpForCurrentLevel: xpForLevel(user.level),
    xpForNextLevel: xpForLevel(user.level + 1),
    achievements,
  });
});

router.get("/leaderboard", (req, res) => {
  const users = db
    .prepare(
      "SELECT id, display_name, xp, level, current_streak FROM users ORDER BY xp DESC LIMIT 20"
    )
    .all();
  res.json(users);
});

export default router;
