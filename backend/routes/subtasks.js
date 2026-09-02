import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { completeTask, isBoardMember } from "./tasks.js";

const router = Router();

function taskFor(subtaskId) {
  const sub = db
    .prepare("SELECT * FROM subtasks WHERE id = ?")
    .get(subtaskId);
  if (!sub) return { sub: null, task: null };
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(sub.task_id);
  return { sub, task };
}

/*
 * Create a subtask
 */
router.post("/", (req, res) => {
  const { taskId, title } = req.body;
  if (!taskId || !title?.trim()) {
    return res.status(400).json({ error: "taskId and title are required" });
  }

  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });
  if (!isBoardMember(task.board_id, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }

  const id = `sub_${nanoid(10)}`;
  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) AS m FROM subtasks WHERE task_id = ?"
    )
    .get(taskId).m;

  db.prepare(
    `INSERT INTO subtasks (id, task_id, title, position) VALUES (?, ?, ?, ?)`
  ).run(id, taskId, title.trim(), maxPos + 1);

  res.json(db.prepare("SELECT id, task_id, title, done, position FROM subtasks WHERE id = ?").get(id));
});

/*
 * Update a subtask (title and/or done). Checking off the last open subtask
 * moves the parent task to Done and awards XP.
 */
router.patch("/:id", (req, res) => {
  const { sub, task } = taskFor(req.params.id);
  if (!sub) return res.status(404).json({ error: "Subtask not found" });
  if (!isBoardMember(task.board_id, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }

  const updates = [];
  const values = [];
  if (typeof req.body.title === "string" && req.body.title.trim()) {
    updates.push("title = ?");
    values.push(req.body.title.trim());
  }
  if (req.body.done !== undefined) {
    updates.push("done = ?");
    values.push(req.body.done ? 1 : 0);
  }
  if (updates.length === 0) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  values.push(req.params.id);
  db.prepare(`UPDATE subtasks SET ${updates.join(", ")} WHERE id = ?`).run(
    ...values
  );

  let taskCompleted = false;
  let gamification = null;

  if (req.body.done === true && task.status !== "done") {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(done) AS done FROM subtasks WHERE task_id = ?`
      )
      .get(task.id);
    if (counts.total > 0 && counts.done === counts.total) {
      const result = completeTask(task, req.userId);
      taskCompleted = true;
      gamification = result.gamification;
    }
  }

  res.json({
    subtask: db
      .prepare("SELECT id, task_id, title, done, position FROM subtasks WHERE id = ?")
      .get(req.params.id),
    taskCompleted,
    gamification,
  });
});

/*
 * Delete a subtask
 */
router.delete("/:id", (req, res) => {
  const { sub, task } = taskFor(req.params.id);
  if (!sub) return res.status(404).json({ error: "Subtask not found" });
  if (!isBoardMember(task.board_id, req.userId)) {
    return res
      .status(403)
      .json({ error: "You are not a member of this board" });
  }
  db.prepare("DELETE FROM subtasks WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
