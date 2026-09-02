import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { withDerivedActive } from "../lib/sprint-status.js";

const router = Router();

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
 * List boards the user owns or belongs to
 */
router.get("/", (req, res) => {
  const boards = db
    .prepare(`
      SELECT b.*
      FROM boards b
      LEFT JOIN board_members m
        ON m.board_id = b.id
      WHERE b.owner_id = ?
         OR m.user_id = ?
      GROUP BY b.id
      ORDER BY b.created_at DESC
    `)
    .all(req.userId, req.userId);

  res.json(boards);
});

/*
 * Create board
 */
router.post("/", (req, res) => {
  const { name } = req.body;

  if (!name?.trim()) {
    return res.status(400).json({
      error: "name is required",
    });
  }

  const id = `board_${nanoid(10)}`;

  db.prepare(`
    INSERT INTO boards (id, name, owner_id)
    VALUES (?, ?, ?)
  `).run(id, name.trim(), req.userId);

  db.prepare(`
    INSERT INTO board_members (board_id, user_id, role)
    VALUES (?, ?, 'owner')
  `).run(id, req.userId);

  res.json(
    db.prepare("SELECT * FROM boards WHERE id = ?").get(id)
  );
});

/*
 * Get board + tasks + members + teams + sprints
 */
router.get("/:boardId", (req, res) => {
  const board = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(req.params.boardId);

  if (!board) {
    return res.status(404).json({
      error: "Board not found",
    });
  }

  if (!isBoardMember(req.params.boardId, req.userId)) {
    return res.status(403).json({
      error: "You are not a member of this board",
    });
  }

  const tasks = db
    .prepare(`
      SELECT *
      FROM tasks
      WHERE board_id = ?
      ORDER BY position ASC
    `)
    .all(req.params.boardId);

  const dependencyRows = db
    .prepare(`
      SELECT
        td.task_id,
        td.depends_on_task_id,
        t.title
      FROM task_dependencies td
      JOIN tasks t ON t.id = td.depends_on_task_id
      WHERE td.task_id IN (
        SELECT id FROM tasks WHERE board_id = ?
      )
    `)
    .all(req.params.boardId);

  const dependenciesByTask = {};
  for (const row of dependencyRows) {
    (dependenciesByTask[row.task_id] ||= []).push({
      id: row.depends_on_task_id,
      title: row.title,
    });
  }

  const tasksWithDeps = tasks.map((task) => ({
    ...task,
    dependencies: dependenciesByTask[task.id] || [],
  }));

  const members = db
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.display_name,
        bm.role
      FROM board_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE bm.board_id = ?
      ORDER BY u.display_name
    `)
    .all(req.params.boardId);

  const teams = db
    .prepare(`
      SELECT *
      FROM teams
      WHERE board_id = ?
      ORDER BY name
    `)
    .all(req.params.boardId);

  const sprints = withDerivedActive(
    db
      .prepare(
        `SELECT * FROM sprints WHERE board_id = ? ORDER BY starts_at ASC`
      )
      .all(req.params.boardId)
  );

  res.json({
    ...board,
    tasks: tasksWithDeps,
    members,
    teams,
    sprints,
  });
});

/*
 * Invite user to board
 *
 * Since we aren't sending email yet, this creates an invitation
 * token that can be copied and shared.
 */
router.post("/:boardId/invitations", (req, res) => {
  const { email } = req.body;

  if (!email?.trim()) {
    return res.status(400).json({
      error: "email is required",
    });
  }

  const board = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(req.params.boardId);

  if (!board) {
    return res.status(404).json({
      error: "Board not found",
    });
  }

  if (board.owner_id !== req.userId) {
    return res.status(403).json({
      error: "Only the board owner can invite people",
    });
  }

  const user = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email.trim().toLowerCase());

  if (user) {
    const existing = db
      .prepare(`
        SELECT 1
        FROM board_members
        WHERE board_id = ? AND user_id = ?
      `)
      .get(req.params.boardId, user.id);

    if (existing) {
      return res.status(400).json({
        error: "That person is already a board member",
      });
    }
  }

  const pending = db
    .prepare(`
      SELECT 1
      FROM board_invitations
      WHERE board_id = ?
        AND lower(email) = lower(?)
        AND status = 'pending'
    `)
    .get(req.params.boardId, email.trim());

  if (pending) {
    return res.status(409).json({
      error: "An invitation for that email is already pending",
    });
  }

  const id = `invite_${nanoid(10)}`;
  const token = nanoid(32);

  db.prepare(`
    INSERT INTO board_invitations
      (id, board_id, email, token, invited_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    id,
    req.params.boardId,
    email.trim().toLowerCase(),
    token,
    req.userId
  );

  res.json({
    id,
    token,
    email: email.trim().toLowerCase(),
  });
});

/*
 * Accept invitation
 */
router.post("/invitations/:token/accept", (req, res) => {
  const invitation = db
    .prepare(`
      SELECT *
      FROM board_invitations
      WHERE token = ? AND status = 'pending'
    `)
    .get(req.params.token);

  if (!invitation) {
    return res.status(404).json({
      error: "Invitation not found or already used",
    });
  }

  const user = db
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(req.userId);

  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return res.status(403).json({
      error: "This invitation was sent to a different email address",
    });
  }

  db.prepare(`
    INSERT OR IGNORE INTO board_members
      (board_id, user_id, role)
    VALUES (?, ?, 'member')
  `).run(invitation.board_id, req.userId);

  db.prepare(`
    UPDATE board_invitations
    SET status = 'accepted'
    WHERE id = ?
  `).run(invitation.id);

  res.json({
    ok: true,
    boardId: invitation.board_id,
  });
});

/*
 * Get board members
 */
router.get("/:boardId/members", (req, res) => {
  const board = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(req.params.boardId);

  if (!board) {
    return res.status(404).json({
      error: "Board not found",
    });
  }

    if (!isBoardMember(req.params.boardId, req.userId)) {
      return res.status(403).json({
        error: "You are not a member of this board",
      });
    }

  const members = db
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.display_name,
        bm.role
      FROM board_members bm
      JOIN users u ON u.id = bm.user_id
      WHERE bm.board_id = ?
      ORDER BY u.display_name
    `)
    .all(req.params.boardId);

  res.json(members);
});

/*
 * Remove board member
 */
router.delete("/:boardId/members/:userId", (req, res) => {
  const board = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(req.params.boardId);

  if (!board) {
    return res.status(404).json({
      error: "Board not found",
    });
  }

  if (board.owner_id !== req.userId) {
    return res.status(403).json({
      error: "Only the board owner can remove members",
    });
  }

  if (board.owner_id === req.params.userId) {
    return res.status(400).json({
      error: "The board owner cannot be removed",
    });
  }

    db.prepare(`
      DELETE FROM board_members
      WHERE board_id = ? AND user_id = ?
    `).run(req.params.boardId, req.params.userId);

  res.json({ ok: true });
});

/*
 * Get pending invitations
 */
router.get("/:boardId/invitations", (req, res) => {
  const board = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(req.params.boardId);

  if (!board) {
    return res.status(404).json({
      error: "Board not found",
    });
  }

  if (board.owner_id !== req.userId) {
    return res.status(403).json({
      error: "Only the board owner can view invitations",
    });
  }

  const invitations = db
    .prepare(`
      SELECT
        id,
        board_id,
        email,
        status,
        created_at
      FROM board_invitations
      WHERE board_id = ?
        AND status = 'pending'
      ORDER BY created_at DESC
    `)
    .all(req.params.boardId);

  res.json(invitations);
});

/*
 * Cancel invitation
 */
router.delete(
  "/:boardId/invitations/:invitationId",
  (req, res) => {
    const board = db
      .prepare("SELECT * FROM boards WHERE id = ?")
      .get(req.params.boardId);

    if (!board) {
      return res.status(404).json({
        error: "Board not found",
      });
    }

    if (board.owner_id !== req.userId) {
      return res.status(403).json({
        error: "Only the board owner can cancel invitations",
      });
    }

    db.prepare(`
      DELETE FROM board_invitations
      WHERE id = ? AND board_id = ?
    `).run(
      req.params.invitationId,
      req.params.boardId
    );

    res.json({ ok: true });
  }
);

/*
 * Delete board
 */
router.delete("/:boardId", (req, res) => {
  const board = db
    .prepare("SELECT * FROM boards WHERE id = ?")
    .get(req.params.boardId);

  if (!board) {
    return res.status(404).json({
      error: "Board not found",
    });
  }

  if (board.owner_id !== req.userId) {
    return res.status(403).json({
      error: "Only the board owner can delete this board",
    });
  }

  /*
   * Delete every dependent row explicitly inside one transaction.
   *
   * We cannot rely on ON DELETE CASCADE: those clauses only exist on
   * freshly-created tables. A pre-existing gamified_kanban.sqlite has the
   * old FK definitions without cascade, and with `foreign_keys = ON`
   * active a bare `DELETE FROM boards` would throw FOREIGN KEY constraint
   * failed whenever the board still has tasks/teams/sprints/invitations.
   */
  const deleteBoard = db.transaction((boardId) => {
    db.prepare(`
      DELETE FROM task_dependencies
      WHERE task_id IN (SELECT id FROM tasks WHERE board_id = ?)
        OR depends_on_task_id IN (SELECT id FROM tasks WHERE board_id = ?)
    `).run(boardId, boardId);
    db.prepare("DELETE FROM tasks WHERE board_id = ?").run(boardId);
    db.prepare(`
      DELETE FROM team_members
      WHERE team_id IN (SELECT id FROM teams WHERE board_id = ?)
    `).run(boardId);
    db.prepare("DELETE FROM teams WHERE board_id = ?").run(boardId);
    db.prepare("DELETE FROM sprints WHERE board_id = ?").run(boardId);
    db.prepare("DELETE FROM board_invitations WHERE board_id = ?").run(boardId);
    db.prepare("DELETE FROM board_members WHERE board_id = ?").run(boardId);
    db.prepare("DELETE FROM boards WHERE id = ?").run(boardId);
  });

  deleteBoard(req.params.boardId);

  res.json({ ok: true });
});

export default router;
