import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

/*
 * Get all teams for a board
 */
router.get("/board/:boardId", (req, res) => {
  const teams = db
    .prepare(`
      SELECT
        t.*,
        COUNT(tm.user_id) AS member_count
      FROM teams t
      LEFT JOIN team_members tm ON tm.team_id = t.id
      WHERE t.board_id = ?
      GROUP BY t.id
      ORDER BY t.name
    `)
    .all(req.params.boardId);

  res.json(teams);
});

/*
 * Create a team
 */
router.post("/", (req, res) => {
  const { boardId, name } = req.body;

  if (!boardId || !name?.trim()) {
    return res.status(400).json({
      error: "boardId and name are required",
    });
  }

  const id = `team_${nanoid(10)}`;

  db.prepare(`
    INSERT INTO teams (id, board_id, name)
    VALUES (?, ?, ?)
  `).run(id, boardId, name.trim());

  res.json(
    db.prepare("SELECT * FROM teams WHERE id = ?").get(id)
  );
});

/*
 * Get team members
 */
router.get("/:teamId/members", (req, res) => {
  const members = db
    .prepare(`
      SELECT u.id, u.email, u.display_name
      FROM users u
      JOIN team_members tm ON tm.user_id = u.id
      WHERE tm.team_id = ?
      ORDER BY u.display_name
    `)
    .all(req.params.teamId);

  res.json(members);
});

/*
 * Add a member to a team
 */
router.post("/:teamId/members", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({
      error: "userId is required",
    });
  }

  try {
    db.prepare(`
      INSERT OR IGNORE INTO team_members (team_id, user_id)
      VALUES (?, ?)
    `).run(req.params.teamId, userId);

    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
});

/*
 * Remove a member from a team
 */
router.delete("/:teamId/members/:userId", (req, res) => {
  db.prepare(`
    DELETE FROM team_members
    WHERE team_id = ? AND user_id = ?
  `).run(req.params.teamId, req.params.userId);

  res.json({ ok: true });
});

/*
 * Delete team
 */
router.delete("/:teamId", (req, res) => {
  db.prepare(`
    DELETE FROM teams
    WHERE id = ?
  `).run(req.params.teamId);

  res.json({ ok: true });
});

export default router;
