import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { awardTaskCompletion } from "../gamification.js";

const router = Router();

router.post("/", (req, res) => {
  const { boardId, title, description = "", priority = "normal", storyPoints = 1, assigneeId, sprintId } = req.body;
  if (!boardId || !title) return res.status(400).json({ error: "boardId and title are required" });

  const id = `task_${nanoid(10)}`;
  const maxPos = db
    .prepare("SELECT COALESCE(MAX(position), -1) as m FROM tasks WHERE board_id = ? AND status = 'backlog'")
    .get(boardId).m;

  db.prepare(
    `INSERT INTO tasks (id, board_id, sprint_id, title, description, priority, story_points, assignee_id, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, boardId, sprintId || null, title, description, priority, storyPoints, assigneeId || null, maxPos + 1);

  res.json(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
});

// Move a task to a new status/position. If moving to "done", awards XP.
router.patch("/:taskId/move", (req, res) => {
  const { status, position = 0 } = req.body;
  const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.taskId);
  if (!task) return res.status(404).json({ error: "Task not found" });

  const wasAlreadyDone = task.status === "done";
  const completedAt = status === "done" ? new Date().toISOString() : task.completed_at;

  db.prepare("UPDATE tasks SET status = ?, position = ?, completed_at = ? WHERE id = ?").run(
    status,
    position,
    completedAt,
    req.params.taskId
  );

  const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.taskId);

  let gamification = null;
  if (status === "done" && !wasAlreadyDone && updatedTask.assignee_id) {
    gamification = awardTaskCompletion(updatedTask.assignee_id, updatedTask);
  }

  res.json({ task: updatedTask, gamification });
});

router.patch("/:taskId", (req, res) => {
  const fields = ["title", "description", "priority", "story_points", "assignee_id", "sprint_id"];
  const updates = [];
  const values = [];
  for (const f of fields) {
    const bodyKey = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    if (req.body[bodyKey] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(req.body[bodyKey]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: "No valid fields to update" });
  values.push(req.params.taskId);
  db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  res.json(db.prepare("SELECT * FROM tasks WHERE id = ?").get(req.params.taskId));
});

router.delete("/:taskId", (req, res) => {
  db.prepare("DELETE FROM tasks WHERE id = ?").run(req.params.taskId);
  res.json({ ok: true });
});

export default router;
