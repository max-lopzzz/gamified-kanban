import { Router } from "express";
import { nanoid } from "nanoid";

import db from "../db.js";

const router = Router();

function isBoardMember(boardId, userId) {
  return !!db
    .prepare(`
      SELECT 1
      FROM board_members
      WHERE board_id = ? AND user_id = ?
    `)
    .get(boardId, userId);
}

router.get("/board/:boardId", (req, res) => {
  if (!isBoardMember(req.params.boardId, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  const sprints = db
    .prepare(`
      SELECT *
      FROM sprints
      WHERE board_id = ?
      ORDER BY starts_at ASC, created_at ASC
    `)
    .all(req.params.boardId);

  res.json(sprints);
});

router.post("/", (req, res) => {
  const {
    boardId,
    name,
    startsAt = null,
    endsAt = null,
    isActive = false,
  } = req.body;

  if (!boardId || !name?.trim()) {
    return res.status(400).json({
      error: "boardId and name are required",
    });
  }

  if (!isBoardMember(boardId, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  const id = `sprint_${nanoid(10)}`;

  db.prepare(`
    INSERT INTO sprints (
      id,
      board_id,
      name,
      starts_at,
      ends_at,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    boardId,
    name.trim(),
    startsAt,
    endsAt,
    isActive ? 1 : 0
  );

  res.json(
    db.prepare("SELECT * FROM sprints WHERE id = ?").get(id)
  );
});

export default router;