import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();

router.get("/", (req, res) => {
  const boards = db
    .prepare(
      `SELECT b.* FROM boards b
       LEFT JOIN board_members m ON m.board_id = b.id
       WHERE b.owner_id = ? OR m.user_id = ?
       GROUP BY b.id`
    )
    .all(req.userId, req.userId);
  res.json(boards);
});

router.post("/", (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "name is required" });
  const id = `board_${nanoid(10)}`;
  db.prepare("INSERT INTO boards (id, name, owner_id) VALUES (?, ?, ?)").run(
    id,
    name,
    req.userId
  );
  db.prepare(
    "INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, 'owner')"
  ).run(id, req.userId);
  res.json(db.prepare("SELECT * FROM boards WHERE id = ?").get(id));
});

router.get("/:boardId", (req, res) => {
  const board = db.prepare("SELECT * FROM boards WHERE id = ?").get(req.params.boardId);
  if (!board) return res.status(404).json({ error: "Board not found" });
  const tasks = db
    .prepare("SELECT * FROM tasks WHERE board_id = ? ORDER BY position ASC")
    .all(req.params.boardId);
  res.json({ ...board, tasks });
});

export default router;
