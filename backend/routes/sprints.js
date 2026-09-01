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

/*
 * A board has at most one active sprint. Clearing siblings has to happen on
 * both POST and PATCH, so it lives in one place.
 */
function deactivateOtherSprints(boardId, exceptId = null) {
  if (exceptId) {
    db.prepare(
      "UPDATE sprints SET is_active = 0 WHERE board_id = ? AND id != ?"
    ).run(boardId, exceptId);
  } else {
    db.prepare("UPDATE sprints SET is_active = 0 WHERE board_id = ?").run(
      boardId
    );
  }
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
    goal = "",
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
      goal,
      starts_at,
      ends_at,
      is_active
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    boardId,
    name.trim(),
    goal ?? "",
    startsAt,
    endsAt,
    isActive ? 1 : 0
  );

  if (isActive) {
    deactivateOtherSprints(boardId, id);
  }

  res.json(
    db.prepare("SELECT * FROM sprints WHERE id = ?").get(id)
  );
});

const SPRINT_PATCH_COLUMNS = {
  name: "name",
  goal: "goal",
  startsAt: "starts_at",
  endsAt: "ends_at",
};

router.patch("/:id", (req, res) => {
  const sprint = db
    .prepare("SELECT * FROM sprints WHERE id = ?")
    .get(req.params.id);

  if (!sprint) {
    return res.status(404).json({ error: "Sprint not found" });
  }

  if (!isBoardMember(sprint.board_id, req.userId)) {
    return res.status(403).json({ error: "You are not a member of this board" });
  }

  const updates = [];
  const values = [];

  for (const [bodyKey, column] of Object.entries(SPRINT_PATCH_COLUMNS)) {
    if (req.body[bodyKey] !== undefined) {
      updates.push(`${column} = ?`);
      values.push(req.body[bodyKey]);
    }
  }

  if (req.body.isActive !== undefined) {
    if (req.body.isActive) {
      deactivateOtherSprints(sprint.board_id);
    }
    updates.push("is_active = ?");
    values.push(req.body.isActive ? 1 : 0);
  }

  if (updates.length > 0) {
    values.push(req.params.id);
    db.prepare(`UPDATE sprints SET ${updates.join(", ")} WHERE id = ?`).run(
      ...values
    );
  }

  res.json(db.prepare("SELECT * FROM sprints WHERE id = ?").get(req.params.id));
});

router.delete("/:id", (req, res) => {
  const sprint = db
    .prepare("SELECT * FROM sprints WHERE id = ?")
    .get(req.params.id);

  if (!sprint) {
    return res.status(404).json({ error: "Sprint not found" });
  }

  if (!isBoardMember(sprint.board_id, req.userId)) {
    return res.status(403).json({ error: "You are not a member of this board" });
  }

  /*
   * Clean up dependent rows explicitly inside one transaction.
   *
   * We cannot rely on `tasks.sprint_id ON DELETE SET NULL`: that clause
   * only exists on freshly-created tables. A pre-existing
   * gamified_kanban.sqlite has the legacy FK definition without it, and
   * with `foreign_keys = ON` active a bare `DELETE FROM sprints` throws
   * FOREIGN KEY constraint failed whenever the sprint still has tasks.
   */
  const deleteSprint = db.transaction((sprintId) => {
    db.prepare("UPDATE tasks SET sprint_id = NULL WHERE sprint_id = ?").run(
      sprintId
    );
    db.prepare("DELETE FROM sprints WHERE id = ?").run(sprintId);
  });

  deleteSprint(req.params.id);

  res.json({ ok: true });
});

export default router;