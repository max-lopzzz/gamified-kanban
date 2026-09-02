import { Router } from "express";
import db from "../db.js";
import { xpForLevel } from "../gamification.js";

const router = Router();

function isBoardMember(boardId, userId) {
  const board = db
    .prepare("SELECT owner_id FROM boards WHERE id = ?")
    .get(boardId);
  if (!board) return false;
  if (board.owner_id === userId) return true;
  return Boolean(
    db
      .prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?")
      .get(boardId, userId)
  );
}

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
  const { boardId } = req.query;

  if (boardId) {
    if (!isBoardMember(boardId, req.userId)) {
      return res
        .status(403)
        .json({ error: "You are not a member of this board" });
    }
    const rows = db
      .prepare(
        `SELECT u.id, u.display_name, u.xp, u.level, u.current_streak
         FROM users u
         JOIN board_members bm ON bm.user_id = u.id
         WHERE bm.board_id = ?
         ORDER BY u.xp DESC
         LIMIT 20`
      )
      .all(boardId);
    return res.json(rows);
  }

  const rows = db
    .prepare(
      "SELECT id, display_name, xp, level, current_streak FROM users ORDER BY xp DESC LIMIT 20"
    )
    .all();
  res.json(rows);
});

export default router;
