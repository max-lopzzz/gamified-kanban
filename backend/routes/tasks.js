import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { awardTaskCompletion } from "../gamification.js";

const router = Router();

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

  const id = `task_${nanoid(10)}`;

  const maxPos = db
    .prepare(`
      SELECT COALESCE(MAX(position), -1) AS m
      FROM tasks
      WHERE board_id = ? AND status = 'backlog'
    `)
    .get(boardId).m;

  db.prepare(`
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
  `).run(
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

  const insertDependency = db.prepare(`
    INSERT OR IGNORE INTO task_dependencies
      (task_id, depends_on_task_id)
    VALUES (?, ?)
  `);

  for (const dependencyId of dependencyIds) {
    if (dependencyId !== id) {
      insertDependency.run(id, dependencyId);
    }
  }

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

  if (updates.length > 0) {
    values.push(req.params.taskId);

    db.prepare(`
      UPDATE tasks
      SET ${updates.join(", ")}
      WHERE id = ?
    `).run(...values);
  }

  /*
   * Replace dependencies if they were supplied.
   */
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

  db.prepare(`
    DELETE FROM tasks
    WHERE id = ?
  `).run(req.params.taskId);

  res.json({ ok: true });
});

export default router;
