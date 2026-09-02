import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { awardTaskCompletion } from "../gamification.js";

const router = Router();

/*
 * Board authorization: the board owner, or anyone with a board_members row.
 */
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

/* ---- assignees (a task can have several people / teams) ------------------ */

// Convert the legacy single-assignee body fields into the new array shape,
// so old callers keep working.
function normalizeAssignees(body) {
  if (Array.isArray(body.assignees)) {
    return body.assignees
      .filter((a) => a && (a.type === "user" || a.type === "team") && a.id)
      .map((a) => ({ type: a.type, id: a.id }));
  }
  if (body.assigneeType === "user" && body.assigneeId) {
    return [{ type: "user", id: body.assigneeId }];
  }
  if (body.assigneeType === "team" && body.teamId) {
    return [{ type: "team", id: body.teamId }];
  }
  return [];
}

function assigneesError(assignees, boardId) {
  for (const a of assignees) {
    if (a.type === "user" && !isBoardMember(boardId, a.id)) {
      return "An assignee is not a member of this board";
    }
    if (a.type === "team") {
      const team = db
        .prepare("SELECT board_id FROM teams WHERE id = ?")
        .get(a.id);
      if (!team || team.board_id !== boardId) {
        return "An assigned team does not belong to this board";
      }
    }
  }
  return null;
}

function setAssignees(taskId, assignees) {
  db.prepare("DELETE FROM task_assignees WHERE task_id = ?").run(taskId);
  const ins = db.prepare(
    `INSERT OR IGNORE INTO task_assignees (task_id, assignee_type, assignee_id)
     VALUES (?, ?, ?)`
  );
  for (const a of assignees) ins.run(taskId, a.type, a.id);
}

// Every user who should receive XP when the task is completed: each assigned
// person, plus every member of each assigned team.
function xpRecipients(taskId) {
  const users = new Set();
  const rows = db
    .prepare(
      "SELECT assignee_type, assignee_id FROM task_assignees WHERE task_id = ?"
    )
    .all(taskId);
  for (const r of rows) {
    if (r.assignee_type === "user") {
      users.add(r.assignee_id);
    } else if (r.assignee_type === "team") {
      for (const m of db
        .prepare("SELECT user_id FROM team_members WHERE team_id = ?")
        .all(r.assignee_id)) {
        users.add(m.user_id);
      }
    }
  }
  return users;
}

/*
 * Move a task to done: stamp it, then award full XP to every recipient. If the
 * task has no assignees, whoever completed it gets the XP. Returns the mover's
 * own gamification result (for their toast) or null.
 */
function completeTask(task, byUserId, position = 0) {
  db.prepare(
    `UPDATE tasks
     SET status = 'done', position = ?, completed_at = ?, completed_by = ?
     WHERE id = ?`
  ).run(position, new Date().toISOString(), byUserId, task.id);

  const fresh = db.prepare("SELECT * FROM tasks WHERE id = ?").get(task.id);

  const recipients = xpRecipients(task.id);
  if (recipients.size === 0) recipients.add(byUserId);

  let mine = null;
  for (const uid of recipients) {
    const g = awardTaskCompletion(uid, fresh);
    if (uid === byUserId) mine = g;
  }
  return { task: fresh, gamification: mine };
}

/*
 * Validate dependency / sprint references against the board. Returns an error
 * string or null. (Assignees are validated separately.)
 */
function taskRefError({ boardId, dependencyIds, sprintId }) {
  for (const depId of Array.isArray(dependencyIds) ? dependencyIds : []) {
    const dep = db
      .prepare("SELECT board_id FROM tasks WHERE id = ?")
      .get(depId);
    if (!dep || dep.board_id !== boardId) {
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
    sprintId = null,
    dependencyIds = [],
  } = req.body;

  if (!boardId || !title?.trim()) {
    return res.status(400).json({ error: "boardId and title are required" });
  }

  if (!isBoardMember(boardId, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }

  const dependencyList = Array.isArray(dependencyIds) ? dependencyIds : [];
  const assignees = normalizeAssignees(req.body);

  const refError =
    taskRefError({ boardId, dependencyIds: dependencyList, sprintId }) ||
    assigneesError(assignees, boardId);
  if (refError) return res.status(400).json({ error: refError });

  const id = `task_${nanoid(10)}`;
  const maxPos = db
    .prepare(
      `SELECT COALESCE(MAX(position), -1) AS m FROM tasks
       WHERE board_id = ? AND status = 'backlog'`
    )
    .get(boardId).m;

  const insertTask = db.prepare(`
    INSERT INTO tasks
      (id, board_id, sprint_id, title, description, priority, story_points, position)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertDependency = db.prepare(
    `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
     VALUES (?, ?)`
  );

  db.transaction(() => {
    insertTask.run(
      id,
      boardId,
      sprintId || null,
      title.trim(),
      description,
      priority,
      Number(storyPoints) || 1,
      maxPos + 1
    );
    setAssignees(id, assignees);
    for (const depId of dependencyList) {
      if (depId !== id) insertDependency.run(id, depId);
    }
  })();

  res.json(taskWithRelations(id));
});

/*
 * Move task
 */
router.patch("/:taskId/move", (req, res) => {
  const { status, position = 0 } = req.body;

  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!isBoardMember(task.board_id, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }

  const movingToDone = status === "done" && task.status !== "done";

  if (movingToDone) {
    const { gamification } = completeTask(task, req.userId, position);
    return res.json({ task: taskWithRelations(task.id), gamification });
  }

  db.prepare(
    "UPDATE tasks SET status = ?, position = ? WHERE id = ?"
  ).run(status, position, req.params.taskId);

  res.json({ task: taskWithRelations(req.params.taskId), gamification: null });
});

/*
 * Update task
 */
router.patch("/:taskId", (req, res) => {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!isBoardMember(task.board_id, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }

  const hasDependencyIds = Array.isArray(req.body.dependencyIds);
  const hasAssignees = Array.isArray(req.body.assignees);
  const assignees = hasAssignees ? normalizeAssignees(req.body) : null;

  const refError =
    taskRefError({
      boardId: task.board_id,
      dependencyIds: req.body.dependencyIds,
      sprintId: req.body.sprintId,
    }) || (hasAssignees ? assigneesError(assignees, task.board_id) : null);
  if (refError) return res.status(400).json({ error: refError });

  const allowed = {
    title: "title",
    description: "description",
    priority: "priority",
    storyPoints: "story_points",
    sprintId: "sprint_id",
  };
  const updates = [];
  const values = [];
  for (const [bodyKey, col] of Object.entries(allowed)) {
    if (req.body[bodyKey] !== undefined) {
      updates.push(`${col} = ?`);
      values.push(req.body[bodyKey]);
    }
  }

  if (updates.length === 0 && !hasDependencyIds && !hasAssignees) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  db.transaction(() => {
    if (updates.length > 0) {
      db.prepare(
        `UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`
      ).run(...values, req.params.taskId);
    }
    if (hasAssignees) setAssignees(req.params.taskId, assignees);
    if (hasDependencyIds) {
      db.prepare(
        "DELETE FROM task_dependencies WHERE task_id = ?"
      ).run(req.params.taskId);
      const ins = db.prepare(
        `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
         VALUES (?, ?)`
      );
      for (const depId of req.body.dependencyIds) {
        if (depId !== req.params.taskId) ins.run(req.params.taskId, depId);
      }
    }
  })();

  res.json(taskWithRelations(req.params.taskId));
});

/*
 * Delete task
 */
router.delete("/:taskId", (req, res) => {
  const task = db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!isBoardMember(task.board_id, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.taskId);
  res.json({ ok: true });
});

/*
 * A task row plus its assignees (with names) — the shape the frontend uses.
 */
export function taskWithRelations(taskId) {
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return null;
  task.assignees = db
    .prepare(
      `SELECT ta.assignee_type AS type, ta.assignee_id AS id,
              CASE ta.assignee_type
                WHEN 'user' THEN (SELECT display_name FROM users WHERE id = ta.assignee_id)
                WHEN 'team' THEN (SELECT name FROM teams WHERE id = ta.assignee_id)
              END AS name
       FROM task_assignees ta
       WHERE ta.task_id = ?
       ORDER BY ta.assignee_type, name`
    )
    .all(taskId);
  return task;
}

export { completeTask, isBoardMember };
export default router;
