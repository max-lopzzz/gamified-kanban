import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

function getBoard(boardId) {
  return db.prepare("SELECT * FROM boards WHERE id = ?").get(boardId);
}

function isBoardMember(boardId, userId) {
  const board = getBoard(boardId);
  if (!board) return false;
  if (board.owner_id === userId) return true;
  return !!db
    .prepare("SELECT 1 FROM board_members WHERE board_id = ? AND user_id = ?")
    .get(boardId, userId);
}

function isBoardOwner(boardId, userId) {
  const board = getBoard(boardId);
  return !!board && board.owner_id === userId;
}

function teamBoardId(teamId) {
  const team = db.prepare("SELECT board_id FROM teams WHERE id = ?").get(teamId);
  return team ? team.board_id : null;
}

router.get("/board/:boardId", (req, res) => {
  if (!isBoardMember(req.params.boardId, req.userId)) {
    return res.status(403).json({ error: "You are not a member of this board" });
  }
  const teams = db
    .prepare(
      `SELECT t.*, COUNT(tm.user_id) AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       WHERE t.board_id = ?
       GROUP BY t.id
       ORDER BY t.name`
    )
    .all(req.params.boardId);
  res.json(teams);
});

router.post("/", (req, res) => {
  const { boardId, name, description = "" } = req.body;
  if (!boardId || !name?.trim()) {
    return res.status(400).json({ error: "boardId and name are required" });
  }
  if (!isBoardOwner(boardId, req.userId)) {
    return res.status(403).json({ error: "Only the board owner can create teams" });
  }
  const id = `team_${nanoid(10)}`;
  db.prepare(
    "INSERT INTO teams (id, board_id, name, description) VALUES (?, ?, ?, ?)"
  ).run(id, boardId, name.trim(), description.trim());
  res.json(db.prepare("SELECT * FROM teams WHERE id = ?").get(id));
});

router.get("/:teamId/members", (req, res) => {
  const boardId = teamBoardId(req.params.teamId);
  if (!boardId) return res.status(404).json({ error: "Team not found" });
  if (!isBoardMember(boardId, req.userId)) {
    return res.status(403).json({ error: "You are not a member of this board" });
  }
  const members = db
    .prepare(
      `SELECT u.id, u.email, u.display_name
       FROM users u
       JOIN team_members tm ON tm.user_id = u.id
       WHERE tm.team_id = ?
       ORDER BY u.display_name`
    )
    .all(req.params.teamId);
  res.json(members);
});

router.post("/:teamId/members", (req, res) => {
  const boardId = teamBoardId(req.params.teamId);
  if (!boardId) return res.status(404).json({ error: "Team not found" });
  if (!isBoardOwner(boardId, req.userId)) {
    return res.status(403).json({ error: "Only the board owner can change team membership" });
  }
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: "userId is required" });
  db.prepare(
    "INSERT OR IGNORE INTO team_members (team_id, user_id) VALUES (?, ?)"
  ).run(req.params.teamId, userId);
  res.json({ ok: true });
});

router.delete("/:teamId/members/:userId", (req, res) => {
  const boardId = teamBoardId(req.params.teamId);
  if (!boardId) return res.status(404).json({ error: "Team not found" });
  if (!isBoardOwner(boardId, req.userId)) {
    return res.status(403).json({ error: "Only the board owner can change team membership" });
  }
  db.prepare(
    "DELETE FROM team_members WHERE team_id = ? AND user_id = ?"
  ).run(req.params.teamId, req.params.userId);
  res.json({ ok: true });
});

router.delete("/:teamId", (req, res) => {
  const boardId = teamBoardId(req.params.teamId);
  if (!boardId) return res.status(404).json({ error: "Team not found" });
  if (!isBoardOwner(boardId, req.userId)) {
    return res.status(403).json({ error: "Only the board owner can delete teams" });
  }
  db.prepare("DELETE FROM teams WHERE id = ?").run(req.params.teamId);
  res.json({ ok: true });
});

export default router;
