import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { awardTaskCompletion } from "../gamification.js";

const router = Router();

/*
 * Board authorization: the board owner, or anyone with a board_members row.
 *
 * Mirrors the helper in routes/boards.js — a board's owner always counts as a
 * member even if the board_members row is missing.
 */
function isBoardMember(boardId, userId) {
  const board = db
    .prepare("SELECT owner_id FROM boards WHERE id = ?")
    .get(boardId);

  if (!board) {
    return false;
  }

  if (board.owner_id === userId) {
    return true;
  }

  return Boolean(
    db
      .prepare(`
        SELECT 1
        FROM board_members
        WHERE board_id = ? AND user_id = ?
      `)
      .get(boardId, userId)
  );
}

/*
 * Validate every foreign reference in a task write against `boardId`.
 * Returns an error string, or null when everything checks out.
 *
 * `INSERT OR IGNORE` does not suppress FK violations, so an unknown id
 * would otherwise throw mid-write (a bare 500, and for PATCH a half-applied
 * dependency replacement). Validate up front and 400 instead.
 */
function taskRefError({ boardId, dependencyIds, sprintId, teamId, assigneeId }) {
  for (const dependencyId of Array.isArray(dependencyIds) ? dependencyIds : []) {
    const dependency = db
      .prepare("SELECT board_id FROM tasks WHERE id = ?")
      .get(dependencyId);
    if (!dependency || dependency.board_id !== boardId) {
      return "Unknown dependency task for this board";
    }
  }

  if (sprintId) {
    const sprint = db
      .prepare("SELECT board_id FROM sprints WHERE id = ?")
      .get(sprintId);
    if (!sprint || sprint.board_id !== boardId) {
      return "Unknown sprint for this board";
    }
  }

  if (teamId) {
    const team = db
      .prepare("SELECT board_id FROM teams WHERE id = ?")
      .get(teamId);
    if (!team || team.board_id !== boardId) {
      return "Unknown team for this board";
    }
  }

  if (assigneeId && !isBoardMember(boardId, assigneeId)) {
    return "Assignee is not a member of this board";
  }

  return null;
}

/*
 * Create task
 */
router.post("/", (req, res) => {
  const {
    boardId,
    title,
    description = "",
    priority = "normal",
    storyPoints = 1,
    assigneeType = "unassigned",
    assigneeId = null,
    teamId = null,
    sprintId = null,
    dependencyIds = [],
  } = req.body;

  if (!boardId || !title?.trim()) {
    return res.status(400).json({
      error: "boardId and title are required",
    });
  }

  if (!["unassigned", "user", "team"].includes(assigneeType)) {
    return res.status(400).json({
      error: "Invalid assignee type",
    });
  }

  if (!isBoardMember(boardId, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  const dependencyList = Array.isArray(dependencyIds) ? dependencyIds : [];

  const refError = taskRefError({
    boardId,
    dependencyIds: dependencyList,
    sprintId,
    teamId: assigneeType === "team" ? teamId : null,
    assigneeId: assigneeType === "user" ? assigneeId : null,
  });

  if (refError) {
    return res.status(400).json({ error: refError });
  }

  const id = `task_${nanoid(10)}`;

  const maxPos = db
    .prepare(`
      SELECT COALESCE(MAX(position), -1) AS m
      FROM tasks
      WHERE board_id = ? AND status = 'backlog'
    `)
    .get(boardId).m;

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      id,
      board_id,
      sprint_id,
      title,
      description,
      priority,
      story_points,
      assignee_type,
      assignee_id,
      team_id,
      position
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertDependency = db.prepare(`
    INSERT OR IGNORE INTO task_dependencies
      (task_id, depends_on_task_id)
    VALUES (?, ?)
  `);

  const createTask = db.transaction(() => {
    insertTask.run(
      id,
      boardId,
      sprintId || null,
      title.trim(),
      description,
      priority,
      Number(storyPoints) || 1,
      assigneeType,
      assigneeType === "user" ? assigneeId : null,
      assigneeType === "team" ? teamId : null,
      maxPos + 1
    );

    for (const dependencyId of dependencyList) {
      if (dependencyId !== id) {
        insertDependency.run(id, dependencyId);
      }
    }
  });

  createTask();

  res.json(
    db.prepare("SELECT * FROM tasks WHERE id = ?").get(id)
  );
});

/*
 * Move task
 */
router.patch("/:taskId/move", (req, res) => {
  const { status, position = 0 } = req.body;

  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);

  if (!task) {
    return res.status(404).json({
      error: "Task not found",
    });
  }

  if (!isBoardMember(task.board_id, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  const wasAlreadyDone = task.status === "done";

  const completedAt =
    status === "done"
      ? new Date().toISOString()
      : task.completed_at;

  db.prepare(`
    UPDATE tasks
    SET status = ?, position = ?, completed_at = ?
    WHERE id = ?
  `).run(
    status,
    position,
    completedAt,
    req.params.taskId
  );

  const updatedTask = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);

  let gamification = null;

  if (
    status === "done" &&
    !wasAlreadyDone &&
    updatedTask.assignee_type === "user" &&
    updatedTask.assignee_id
  ) {
    gamification = awardTaskCompletion(
      updatedTask.assignee_id,
      updatedTask
    );
  }

  res.json({
    task: updatedTask,
    gamification,
  });
});

/*
 * Update task
 */
router.patch("/:taskId", (req, res) => {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);

  if (!task) {
    return res.status(404).json({
      error: "Task not found",
    });
  }

  if (!isBoardMember(task.board_id, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  const refError = taskRefError({
    boardId: task.board_id,
    dependencyIds: req.body.dependencyIds,
    sprintId: req.body.sprintId,
    teamId: req.body.teamId,
    assigneeId: req.body.assigneeId,
  });

  if (refError) {
    return res.status(400).json({ error: refError });
  }

  const allowed = {
    title: "title",
    description: "description",
    priority: "priority",
    storyPoints: "story_points",
    assigneeType: "assignee_type",
    assigneeId: "assignee_id",
    teamId: "team_id",
    sprintId: "sprint_id",
  };

  const updates = [];
  const values = [];

  for (const [bodyKey, dbColumn] of Object.entries(allowed)) {
    if (req.body[bodyKey] !== undefined) {
      updates.push(`${dbColumn} = ?`);
      values.push(req.body[bodyKey]);
    }
  }

  const hasDependencyIds = Array.isArray(req.body.dependencyIds);

  if (updates.length === 0 && !hasDependencyIds) {
    return res.status(400).json({
      error: "No valid fields to update",
    });
  }

  /*
   * Apply the column update and the dependency replacement atomically, so a
   * failure part-way (e.g. an FK violation) rolls back both rather than
   * leaving the task with its dependencies wiped.
   */
  const applyUpdate = db.transaction(() => {
    if (updates.length > 0) {
      db.prepare(`
        UPDATE tasks
        SET ${updates.join(", ")}
        WHERE id = ?
      `).run(...values, req.params.taskId);
    }

    if (hasDependencyIds) {
      db.prepare(`
        DELETE FROM task_dependencies
        WHERE task_id = ?
      `).run(req.params.taskId);

      const insert = db.prepare(`
        INSERT OR IGNORE INTO task_dependencies
          (task_id, depends_on_task_id)
        VALUES (?, ?)
      `);

      for (const dependencyId of req.body.dependencyIds) {
        if (dependencyId !== req.params.taskId) {
          insert.run(req.params.taskId, dependencyId);
        }
      }
    }
  });

  applyUpdate();

  res.json(
    db.prepare("SELECT * FROM tasks WHERE id = ?")
      .get(req.params.taskId)
  );
});

/*
 * Delete task
 */
router.delete("/:taskId", (req, res) => {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);

  if (!task) {
    return res.status(404).json({
      error: "Task not found",
    });
  }

  if (!isBoardMember(task.board_id, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  db.prepare(`
    DELETE FROM tasks
    WHERE id = ?
  `).run(req.params.taskId);

  res.json({ ok: true });
});

export default router;
