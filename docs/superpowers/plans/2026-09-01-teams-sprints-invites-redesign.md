# Teams, Sprints, Invites & Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the half-built board-collaboration features (invitations, teams, sprints) into one correct, reachable implementation, then run a full token-driven visual redesign with light/dark themes.

**Architecture:** Three sequential phases on branch `feat/teams-sprints-invites-redesign`. Phase 1 fixes the backend and API layer and deletes the duplicate inline UI, verified by a new `node:test` + `supertest` backend suite. Phase 2 adds `react-router-dom`, a dedicated settings view, and a sprint-aware board. Phase 3 rebuilds `styles.css` as a design-token system and restyles every surface.

**Tech Stack:** Node.js + Express + `better-sqlite3` (backend), React 18 + Vite + `@dnd-kit` (frontend), `react-router-dom` (new), `node:test` + `supertest` (new, backend tests only).

**Spec:** `docs/superpowers/specs/2026-09-01-teams-sprints-invites-redesign-design.md`

## Global Constraints

- Work on branch `feat/teams-sprints-invites-redesign`. The branch already carries the uncommitted WIP — do not discard it; it is the starting point.
- SQLite migrations only via the existing `addColumnIfMissing(table, column, definition)` helper in `backend/db.js`. No `DROP COLUMN`, no destructive migration.
- Dependency write field is `dependencyIds: string[]` everywhere. Dependency read field is `task.dependencies: [{ id, title }]` per task.
- Single active sprint per board: setting a sprint `isActive: true` clears `is_active` on all sibling sprints of that board.
- Team write routes (create, delete, add/remove member) require the requester to be the board **owner** (`boards.owner_id === req.userId`). Team read routes require board membership.
- No new runtime dependency on the frontend beyond `react-router-dom`. No CSS framework — `styles.css` stays a single hand-written file.
- Frontend has no automated test infra; frontend tasks end with an explicit manual verification step. Do not add Vitest/RTL in this plan.
- `frontend/dist/` is a stale committed build artifact — never hand-edit it.
- Every backend task follows TDD: failing test first, then implementation, then commit.

---

## Phase 1 — Reconcile

### File structure (Phase 1)

- Create `backend/app.js` — the Express app (moved out of `server.js`) so tests can import it without opening a listening socket.
- Modify `backend/server.js` — import `app`, call `app.listen` only.
- Modify `backend/db.js` — read `DB_PATH` env var (default `gamified_kanban.sqlite`); add three `addColumnIfMissing` calls.
- Modify `backend/routes/sprints.js` — add `PATCH /:id`, `DELETE /:id`; fix list ordering.
- Modify `backend/routes/teams.js` — add owner-guard helper; guard write routes; accept `description`.
- Modify `backend/routes/boards.js` — drop `expires_at` from invitations query; reject duplicate pending invites; shape per-task `dependencies` in `GET /:boardId`.
- Modify `backend/routes/tasks.js` — read `dependencyIds` in `POST` and `PATCH`.
- Modify `backend/package.json` — add `supertest` devDependency, `"test": "node --test"` script.
- Create `backend/test/helpers.js` — build an app instance against a throwaway temp DB, plus a helper to register a user and return an auth token.
- Create `backend/test/sprints.test.js`, `backend/test/invitations.test.js`, `backend/test/teams.test.js`, `backend/test/tasks.test.js`.
- Modify `frontend/src/api.js` — align method names/signatures.
- Modify `frontend/src/components/Board.jsx` — delete the inline management panel and its state/handlers.

---

### Task 1: Extract the Express app from `server.js`

**Files:**
- Create: `backend/app.js`
- Modify: `backend/server.js`

**Interfaces:**
- Produces: `backend/app.js` default-exports a configured Express `app` (all routes mounted, `express.json()` + `cors()` applied) **without** calling `listen`. `server.js` imports it and listens.

- [ ] **Step 1: Create `backend/app.js`**

```js
import express from "express";
import cors from "cors";

import authRoutes, { authMiddleware } from "./routes/auth.js";
import boardRoutes from "./routes/boards.js";
import taskRoutes from "./routes/tasks.js";
import userRoutes from "./routes/users.js";
import teamRoutes from "./routes/teams.js";
import sprintRoutes from "./routes/sprints.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/boards", authMiddleware, boardRoutes);
app.use("/api/tasks", authMiddleware, taskRoutes);
app.use("/api/teams", authMiddleware, teamRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/sprints", authMiddleware, sprintRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

export default app;
```

- [ ] **Step 2: Replace `backend/server.js` with just the listener**

```js
import app from "./app.js";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`Gamified Kanban API running on http://localhost:${PORT}`);
});
```

- [ ] **Step 3: Verify the server still boots**

Run: `cd backend && node server.js`
Expected: prints `Gamified Kanban API running on http://localhost:4000`, no error. Stop it with Ctrl-C.

- [ ] **Step 4: Commit**

```bash
git add backend/app.js backend/server.js
git commit -m "refactor(backend): split Express app from server listener"
```

---

### Task 2: Make the DB path configurable

**Files:**
- Modify: `backend/db.js:1-4`

**Interfaces:**
- Consumes: nothing.
- Produces: `db.js` opens `process.env.DB_PATH || "gamified_kanban.sqlite"`. Behavior in normal runs is unchanged (default path). Tests set `DB_PATH` before importing `app.js`.

- [ ] **Step 1: Change the Database constructor line**

Replace:

```js
import Database from "better-sqlite3";

const db = new Database("gamified_kanban.sqlite");
```

with:

```js
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || "gamified_kanban.sqlite";
const db = new Database(DB_PATH);
```

- [ ] **Step 2: Verify default run is unaffected**

Run: `cd backend && node -e "import('./db.js').then(() => console.log('db ok'))"`
Expected: prints `db ok`, and `backend/gamified_kanban.sqlite` still exists.

- [ ] **Step 3: Commit**

```bash
git add backend/db.js
git commit -m "feat(backend): honor DB_PATH env var for the SQLite file"
```

---

### Task 3: Add the schema columns the WIP already assumes

**Files:**
- Modify: `backend/db.js` (the block of `addColumnIfMissing(...)` calls, after the `db.exec` schema string)

**Interfaces:**
- Produces: `sprints.created_at` (`TEXT NOT NULL DEFAULT (datetime('now'))`), `sprints.goal` (`TEXT DEFAULT ''`), `teams.description` (`TEXT DEFAULT ''`) all exist after `db.js` is imported.

- [ ] **Step 1: Add three migration calls**

After the existing `addColumnIfMissing("tasks", "team_id", "TEXT");` call, add:

```js
addColumnIfMissing(
  "sprints",
  "created_at",
  "TEXT NOT NULL DEFAULT (datetime('now'))"
);

addColumnIfMissing("sprints", "goal", "TEXT DEFAULT ''");

addColumnIfMissing("teams", "description", "TEXT DEFAULT ''");
```

- [ ] **Step 2: Verify columns exist on a fresh DB**

Run:

```bash
cd backend && DB_PATH=/tmp/qb-migrate-check.sqlite node -e "
import('./db.js').then(async (m) => {
  const db = m.default;
  console.log(db.prepare('PRAGMA table_info(sprints)').all().map(c => c.name));
  console.log(db.prepare('PRAGMA table_info(teams)').all().map(c => c.name));
});
"
rm -f /tmp/qb-migrate-check.sqlite*
```

Expected: `sprints` list includes `created_at` and `goal`; `teams` list includes `description`.

- [ ] **Step 3: Commit**

```bash
git add backend/db.js
git commit -m "feat(backend): add sprints.created_at/goal and teams.description columns"
```

---

### Task 4: Backend test harness

**Files:**
- Modify: `backend/package.json`
- Create: `backend/test/helpers.js`

**Interfaces:**
- Consumes: `backend/app.js` default export.
- Produces:
  - `makeApp()` → `Promise<{ app, db, cleanup }>`. Sets a unique `process.env.DB_PATH` under `os.tmpdir()`, dynamically imports a fresh `app.js` + `db.js` (via a cache-busting query string), returns the app, the db handle, and `cleanup()` which closes the db and unlinks the temp file plus its `-wal`/`-shm` siblings.
  - `registerUser(app, { email, password, displayName })` → `Promise<{ token, user }>` — POSTs `/api/auth/register`, returns parsed body.
  - `authHeader(token)` → `{ Authorization: \`Bearer ${token}\` }`.

- [ ] **Step 1: Add the test script and dependency to `backend/package.json`**

Set `scripts.test` to `"node --test"` and add to a new `devDependencies` block:

```json
"devDependencies": {
  "supertest": "^7.0.0"
}
```

- [ ] **Step 2: Install**

Run: `cd backend && npm install`
Expected: `supertest` appears under `node_modules`, exit 0.

- [ ] **Step 3: Write `backend/test/helpers.js`**

```js
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";

export async function makeApp() {
  const dbPath = path.join(os.tmpdir(), `qb-test-${randomUUID()}.sqlite`);
  process.env.DB_PATH = dbPath;

  // Cache-bust so each test file gets a fresh module graph bound to this DB_PATH.
  const bust = `?t=${randomUUID()}`;
  const { default: app } = await import(`../app.js${bust}`);
  const { default: db } = await import(`../db.js${bust}`);

  function cleanup() {
    try {
      db.close();
    } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  }

  return { app, db, cleanup };
}

export async function registerUser(
  app,
  { email, password = "pw-123456", displayName = email.split("@")[0] }
) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password, displayName });
  if (res.status !== 200) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body; // { token, user }
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
```

> Note: `db.js` runs its schema/seed on import. With the cache-bust query the module re-executes against the just-set `DB_PATH`, giving each test file an isolated database. `better-sqlite3` is CJS-interop but `import()` of it through `db.js` works because `db.js` already uses ESM `import`.

- [ ] **Step 4: Smoke-test the harness**

Create a temporary check and run it:

```bash
cd backend && node --test --test-name-pattern="harness smoke" test/helpers.smoke.test.js
```

with `backend/test/helpers.smoke.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp } from "./helpers.js";

test("harness smoke — health endpoint responds", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const res = await request(app).get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});
```

Expected: 1 pass. Then delete the smoke file:

```bash
rm backend/test/helpers.smoke.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/test/helpers.js
git commit -m "test(backend): add node:test + supertest harness with isolated temp DB"
```

---

### Task 5: Sprint update & delete endpoints

**Files:**
- Modify: `backend/routes/sprints.js`
- Create: `backend/test/sprints.test.js`

**Interfaces:**
- Consumes: `makeApp`, `registerUser`, `authHeader` from `test/helpers.js`; `isBoardMember` already defined in `sprints.js`.
- Produces:
  - `PATCH /api/sprints/:id` — body may contain any of `name`, `goal`, `startsAt`, `endsAt`, `isActive`. Maps to columns `name`, `goal`, `starts_at`, `ends_at`, `is_active` (0/1). When `isActive === true`, first runs `UPDATE sprints SET is_active = 0 WHERE board_id = ?` for the sprint's board. 404 if sprint missing; 403 if requester not a board member. Returns the updated sprint row.
  - `DELETE /api/sprints/:id` — 404 if missing; 403 if not a board member; else deletes and returns `{ ok: true }`. `tasks.sprint_id` clears via the existing `ON DELETE SET NULL` FK.

- [ ] **Step 1: Write the failing tests — `backend/test/sprints.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

async function setupBoardWithSprint(app) {
  const { token } = await registerUser(app, { email: `u${Date.now()}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  const s1 = (
    await request(app)
      .post("/api/sprints")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "S1" })
  ).body;
  return { token, board, s1 };
}

test("PATCH /api/sprints/:id updates fields", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, s1 } = await setupBoardWithSprint(app);

  const res = await request(app)
    .patch(`/api/sprints/${s1.id}`)
    .set(authHeader(token))
    .send({ name: "S1 renamed", goal: "ship it" });

  assert.equal(res.status, 200);
  assert.equal(res.body.name, "S1 renamed");
  assert.equal(res.body.goal, "ship it");
});

test("PATCH isActive:true deactivates sibling sprints", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board, s1 } = await setupBoardWithSprint(app);
  const s2 = (
    await request(app)
      .post("/api/sprints")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "S2" })
  ).body;

  await request(app)
    .patch(`/api/sprints/${s1.id}`)
    .set(authHeader(token))
    .send({ isActive: true });
  await request(app)
    .patch(`/api/sprints/${s2.id}`)
    .set(authHeader(token))
    .send({ isActive: true });

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  const active = list.filter((s) => s.is_active);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, s2.id);
});

test("PATCH /api/sprints/:id 404 for unknown sprint", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token } = await setupBoardWithSprint(app);
  const res = await request(app)
    .patch("/api/sprints/sprint_nope")
    .set(authHeader(token))
    .send({ name: "x" });
  assert.equal(res.status, 404);
});

test("DELETE /api/sprints/:id removes it and nulls task.sprint_id", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board, s1 } = await setupBoardWithSprint(app);
  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "T", sprintId: s1.id })
  ).body;

  const del = await request(app)
    .delete(`/api/sprints/${s1.id}`)
    .set(authHeader(token));
  assert.equal(del.status, 200);

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(list.length, 0);

  const board2 = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  const t2 = board2.tasks.find((x) => x.id === task.id);
  assert.equal(t2.sprint_id, null);
});

test("DELETE /api/sprints/:id 403 for a non-member", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { s1 } = await setupBoardWithSprint(app);
  const outsider = await registerUser(app, { email: `out${Date.now()}@x.com` });
  const res = await request(app)
    .delete(`/api/sprints/${s1.id}`)
    .set(authHeader(outsider.token));
  assert.equal(res.status, 403);
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `cd backend && node --test test/sprints.test.js`
Expected: FAIL — `PATCH`/`DELETE` return 404 (no route), sibling-deactivation and null-on-delete assertions fail.

- [ ] **Step 3: Implement the endpoints in `backend/routes/sprints.js`**

Add before `export default router;`:

```js
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
      db.prepare(
        "UPDATE sprints SET is_active = 0 WHERE board_id = ?"
      ).run(sprint.board_id);
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

  db.prepare("DELETE FROM sprints WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});
```

- [ ] **Step 4: Ensure `ON DELETE SET NULL` actually fires — enable FK enforcement**

`better-sqlite3` does not enable foreign keys by default. In `backend/db.js`, immediately after `db.pragma("journal_mode = WAL");` add:

```js
db.pragma("foreign_keys = ON");
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `cd backend && node --test test/sprints.test.js`
Expected: all sprint tests PASS.

- [ ] **Step 6: Run the full backend suite (nothing else regressed)**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/sprints.js backend/db.js backend/test/sprints.test.js
git commit -m "feat(backend): sprint PATCH/DELETE endpoints + single-active invariant"
```

---

### Task 6: Fix the sprint list ordering

**Files:**
- Modify: `backend/routes/sprints.js` (the `GET /board/:boardId` query)

**Interfaces:**
- Produces: `GET /api/sprints/board/:boardId` orders by `starts_at ASC, created_at ASC` and no longer throws (the `created_at` column now exists from Task 3).

- [ ] **Step 1: Add a failing test to `backend/test/sprints.test.js`**

```js
test("GET /api/sprints/board/:boardId returns sprints without error", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await setupBoardWithSprint(app);
  await request(app)
    .post("/api/sprints")
    .set(authHeader(token))
    .send({ boardId: board.id, name: "S2", startsAt: "2026-01-01" });

  const res = await request(app)
    .get(`/api/sprints/board/${board.id}`)
    .set(authHeader(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
});
```

- [ ] **Step 2: Run it**

Run: `cd backend && node --test test/sprints.test.js`
Expected: with Task 3 applied this likely already PASSES. If the query still references a missing column it FAILS with a SQLite error — proceed to Step 3.

- [ ] **Step 3: Confirm the query text**

Ensure the `GET /board/:boardId` handler's SQL reads exactly:

```sql
SELECT *
FROM sprints
WHERE board_id = ?
ORDER BY starts_at ASC, created_at ASC
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/sprints.js backend/test/sprints.test.js
git commit -m "fix(backend): sprint list ordering references existing created_at column"
```

---

### Task 7: Team ownership guards + description

**Files:**
- Modify: `backend/routes/teams.js`
- Create: `backend/test/teams.test.js`

**Interfaces:**
- Consumes: helpers.
- Produces:
  - `requireBoardOwner(boardId, userId)` internal helper → boolean.
  - `POST /api/teams` accepts `{ boardId, name, description? }`; 403 unless requester owns the board.
  - `DELETE /api/teams/:teamId`, `POST /api/teams/:teamId/members`, `DELETE /api/teams/:teamId/members/:userId` → 403 unless requester owns the team's board; 404 if team missing.
  - `GET /api/teams/board/:boardId` and `GET /api/teams/:teamId/members` require board membership (403 otherwise).

- [ ] **Step 1: Write failing tests — `backend/test/teams.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

async function ownerWithBoard(app, tag) {
  const { token, user } = await registerUser(app, { email: `own${tag}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("POST /api/teams creates a team with description for the owner", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await ownerWithBoard(app, "a");

  const res = await request(app)
    .post("/api/teams")
    .set(authHeader(token))
    .send({ boardId: board.id, name: "Frontend", description: "UI crew" });

  assert.equal(res.status, 200);
  assert.equal(res.body.name, "Frontend");
  assert.equal(res.body.description, "UI crew");
});

test("POST /api/teams 403 for a non-owner", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { board } = await ownerWithBoard(app, "b");
  const outsider = await registerUser(app, { email: `nope-b@x.com` });

  const res = await request(app)
    .post("/api/teams")
    .set(authHeader(outsider.token))
    .send({ boardId: board.id, name: "X" });

  assert.equal(res.status, 403);
});

test("team member add/remove works for the owner and cascades on delete", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await ownerWithBoard(app, "c");
  const team = (
    await request(app)
      .post("/api/teams")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "T" })
  ).body;
  const member = await registerUser(app, { email: `m-c@x.com` });

  // add the new user to the board first via an accepted invitation
  const invite = (
    await request(app)
      .post(`/api/boards/${board.id}/invitations`)
      .set(authHeader(token))
      .send({ email: "m-c@x.com" })
  ).body;
  await request(app)
    .post(`/api/boards/invitations/${invite.token}/accept`)
    .set(authHeader(member.token));

  const add = await request(app)
    .post(`/api/teams/${team.id}/members`)
    .set(authHeader(token))
    .send({ userId: member.user.id });
  assert.equal(add.status, 200);

  let members = (
    await request(app).get(`/api/teams/${team.id}/members`).set(authHeader(token))
  ).body;
  assert.equal(members.length, 1);

  await request(app).delete(`/api/teams/${team.id}`).set(authHeader(token));
  const list = (
    await request(app).get(`/api/teams/board/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(list.length, 0);
});

test("GET /api/teams/board/:boardId 403 for a non-member", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { board } = await ownerWithBoard(app, "d");
  const outsider = await registerUser(app, { email: `nope-d@x.com` });
  const res = await request(app)
    .get(`/api/teams/board/${board.id}`)
    .set(authHeader(outsider.token));
  assert.equal(res.status, 403);
});
```

- [ ] **Step 2: Run, verify failures**

Run: `cd backend && node --test test/teams.test.js`
Expected: FAIL — non-owner create returns 200, description is missing, non-member GET returns 200.

- [ ] **Step 3: Rewrite `backend/routes/teams.js`**

```js
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
```

- [ ] **Step 4: Run tests**

Run: `cd backend && node --test test/teams.test.js`
Expected: all PASS.

- [ ] **Step 5: Full suite**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/teams.js backend/test/teams.test.js
git commit -m "feat(backend): board-owner guards on team writes + team description"
```

---

### Task 8: Fix board invitations query + duplicate guard

**Files:**
- Modify: `backend/routes/boards.js` (the `GET /:boardId/invitations` query; the `POST /:boardId/invitations` handler)
- Create: `backend/test/invitations.test.js`

**Interfaces:**
- Produces:
  - `GET /api/boards/:boardId/invitations` returns rows with `id, board_id, email, status, created_at` (no `expires_at`), owner-only.
  - `POST /api/boards/:boardId/invitations` → `409 { error: "An invitation for that email is already pending" }` when a pending invite for the same lowercased email exists on the board.
  - Accept flow unchanged: `POST /api/boards/invitations/:token/accept` requires the logged-in user's email to equal the invitation email; inserts the `board_members` row; marks the invitation `accepted`; returns `{ ok: true, boardId }`.

- [ ] **Step 1: Write failing tests — `backend/test/invitations.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

async function ownerBoard(app, tag) {
  const { token, user } = await registerUser(app, { email: `o-${tag}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("invite -> accept adds the invitee as a board member", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await ownerBoard(app, "1");
  const invitee = await registerUser(app, { email: `friend-1@x.com` });

  const invite = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(token))
    .send({ email: "friend-1@x.com" });
  assert.equal(invite.status, 200);
  assert.ok(invite.body.token);

  const accept = await request(app)
    .post(`/api/boards/invitations/${invite.body.token}/accept`)
    .set(authHeader(invitee.token));
  assert.equal(accept.status, 200);
  assert.equal(accept.body.boardId, board.id);

  const members = (
    await request(app).get(`/api/boards/${board.id}/members`).set(authHeader(token))
  ).body;
  assert.ok(members.some((m) => m.email === "friend-1@x.com"));
});

test("GET invitations lists pending ones without error", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await ownerBoard(app, "2");
  await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(token))
    .send({ email: "pending-2@x.com" });

  const res = await request(app)
    .get(`/api/boards/${board.id}/invitations`)
    .set(authHeader(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].email, "pending-2@x.com");
});

test("duplicate pending invitation is rejected with 409", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await ownerBoard(app, "3");
  await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(token))
    .send({ email: "dup-3@x.com" });

  const second = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(token))
    .send({ email: "DUP-3@x.com" });
  assert.equal(second.status, 409);
});

test("non-owner cannot invite", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { board } = await ownerBoard(app, "4");
  const outsider = await registerUser(app, { email: `out-4@x.com` });
  const res = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(outsider.token))
    .send({ email: "whoever@x.com" });
  assert.equal(res.status, 403);
});

test("accepting with a mismatched email is rejected", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await ownerBoard(app, "5");
  const invite = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(token))
    .send({ email: "intended-5@x.com" });
  const wrongUser = await registerUser(app, { email: `wrong-5@x.com` });

  const res = await request(app)
    .post(`/api/boards/invitations/${invite.body.token}/accept`)
    .set(authHeader(wrongUser.token));
  assert.equal(res.status, 403);
});
```

- [ ] **Step 2: Run, verify failures**

Run: `cd backend && node --test test/invitations.test.js`
Expected: FAIL — `GET invitations` 500s on `expires_at`; duplicate returns 200 instead of 409.

- [ ] **Step 3: Fix the `GET /:boardId/invitations` query**

Change its `SELECT` list to:

```sql
SELECT id, board_id, email, status, created_at
FROM board_invitations
WHERE board_id = ? AND status = 'pending'
ORDER BY created_at DESC
```

- [ ] **Step 4: Add the duplicate guard in `POST /:boardId/invitations`**

After the existing "already a board member" check and before generating the token, add:

```js
const pending = db
  .prepare(
    `SELECT 1 FROM board_invitations
     WHERE board_id = ? AND lower(email) = lower(?) AND status = 'pending'`
  )
  .get(req.params.boardId, email.trim());

if (pending) {
  return res
    .status(409)
    .json({ error: "An invitation for that email is already pending" });
}
```

- [ ] **Step 5: Run tests**

Run: `cd backend && node --test test/invitations.test.js`
Expected: all PASS.

- [ ] **Step 6: Full suite**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/boards.js backend/test/invitations.test.js
git commit -m "fix(backend): invitations query column + duplicate-pending 409 guard"
```

---

### Task 9: Per-task dependency shape

**Files:**
- Modify: `backend/routes/boards.js` (`GET /:boardId`), `backend/routes/tasks.js` (`POST /`, `PATCH /:taskId`)
- Create: `backend/test/tasks.test.js`

**Interfaces:**
- Produces:
  - `POST /api/tasks` and `PATCH /api/tasks/:taskId` read `req.body.dependencyIds` (array of task IDs). On `POST`, insert rows for each. On `PATCH`, if `dependencyIds` is an array, delete existing rows for the task then re-insert. Self-references skipped.
  - `GET /api/boards/:boardId` — each task object carries `dependencies: [{ id, title }]`. No top-level flat `dependencies` array on the response.

- [ ] **Step 1: Write failing tests — `backend/test/tasks.test.js`**

```js
import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

async function boardCtx(app, tag) {
  const { token, user } = await registerUser(app, { email: `t-${tag}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("task create stores dependencyIds and board fetch returns shaped dependencies", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await boardCtx(app, "1");

  const a = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "A" })
  ).body;
  const b = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "B", dependencyIds: [a.id] })
  ).body;

  const fetched = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(fetched.dependencies, undefined);
  const bt = fetched.tasks.find((x) => x.id === b.id);
  assert.deepEqual(bt.dependencies, [{ id: a.id, title: "A" }]);
  const at = fetched.tasks.find((x) => x.id === a.id);
  assert.deepEqual(at.dependencies, []);
});

test("task PATCH replaces dependencyIds", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await boardCtx(app, "2");
  const a = (await request(app).post("/api/tasks").set(authHeader(token)).send({ boardId: board.id, title: "A" })).body;
  const b = (await request(app).post("/api/tasks").set(authHeader(token)).send({ boardId: board.id, title: "B" })).body;
  const c = (await request(app).post("/api/tasks").set(authHeader(token)).send({ boardId: board.id, title: "C", dependencyIds: [a.id] })).body;

  await request(app)
    .patch(`/api/tasks/${c.id}`)
    .set(authHeader(token))
    .send({ dependencyIds: [b.id] });

  const fetched = (await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))).body;
  const ct = fetched.tasks.find((x) => x.id === c.id);
  assert.deepEqual(ct.dependencies.map((d) => d.id), [b.id]);
});

test("task create round-trips assignee_type and team_id", async (t) => {
  const { app, cleanup } = await makeApp();
  t.after(cleanup);
  const { token, board } = await boardCtx(app, "3");
  const team = (
    await request(app)
      .post("/api/teams")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "T" })
  ).body;

  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "X", assigneeType: "team", teamId: team.id })
  ).body;

  assert.equal(task.assignee_type, "team");
  assert.equal(task.team_id, team.id);
});
```

- [ ] **Step 2: Run, verify failures**

Run: `cd backend && node --test test/tasks.test.js`
Expected: FAIL — board fetch has a top-level `dependencies` array and tasks lack a per-task `dependencies`; `PATCH` with `dependencyIds` is ignored.

- [ ] **Step 3: Update `backend/routes/tasks.js`**

In `POST /`, the destructure currently reads `dependencies = []`. Rename to `dependencyIds = []` and use it in the insert loop:

```js
for (const dependencyId of dependencyIds) {
  if (dependencyId !== id) {
    insertDependency.run(id, dependencyId);
  }
}
```

In `PATCH /:taskId`, replace the `if (Array.isArray(req.body.dependencies))` block with:

```js
if (Array.isArray(req.body.dependencyIds)) {
  db.prepare("DELETE FROM task_dependencies WHERE task_id = ?").run(
    req.params.taskId
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
     VALUES (?, ?)`
  );
  for (const dependencyId of req.body.dependencyIds) {
    if (dependencyId !== req.params.taskId) {
      insert.run(req.params.taskId, dependencyId);
    }
  }
}
```

- [ ] **Step 4: Update `GET /:boardId` in `backend/routes/boards.js`**

Replace the flat `dependencies` query + its place in the response with a per-task attach:

```js
const dependencyRows = db
  .prepare(
    `SELECT d.task_id, d.depends_on_task_id, t.title
     FROM task_dependencies d
     JOIN tasks t ON t.id = d.depends_on_task_id
     WHERE d.task_id IN (SELECT id FROM tasks WHERE board_id = ?)`
  )
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
```

and in the `res.json({ ... })` call use `tasks: tasksWithDeps` and remove the `dependencies` key entirely.

- [ ] **Step 5: Run tests**

Run: `cd backend && node --test test/tasks.test.js`
Expected: all PASS.

- [ ] **Step 6: Full suite**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/tasks.js backend/routes/boards.js backend/test/tasks.test.js
git commit -m "fix(backend): unify dependency shape (dependencyIds write, per-task read)"
```

---

### Task 10: Align `frontend/src/api.js` signatures

**Files:**
- Modify: `frontend/src/api.js`

**Interfaces:**
- Produces (final shapes the Phase 2 UI depends on):
  - `inviteMember(boardId, email)` → POST `/boards/:boardId/invitations` body `{ email }`.
  - `boardInvitations(boardId)`, `cancelInvitation(boardId, invitationId)`, `acceptInvitation(token)` — unchanged paths.
  - `boardMembers(boardId)`, `removeBoardMember(boardId, userId)` — unchanged.
  - `teams(boardId)` → GET `/teams/board/:boardId`.
  - `createTeam(boardId, name, description)` → POST `/teams` body `{ boardId, name, description }`.
  - `teamMembers(teamId)`, `addTeamMember(teamId, userId)`, `removeTeamMember(teamId, userId)`, `deleteTeam(teamId)` — unchanged.
  - `sprints(boardId)` → GET `/sprints/board/:boardId`.
  - `createSprint(boardId, name, startsAt, endsAt, goal)` → POST `/sprints` body `{ boardId, name, startsAt, endsAt, goal, isActive: false }`.
  - `updateSprint(sprintId, patch)` → PATCH `/sprints/:sprintId` body `patch`.
  - `deleteSprint(sprintId)` → DELETE `/sprints/:sprintId`.
  - `createTask(payload)` / `updateTask(id, payload)` — payloads use `dependencyIds`.
  - `deleteBoard(id)` — unchanged.
  - **Removed:** `inviteToBoard`.

- [ ] **Step 1: Edit the invitations + teams + sprints sections of `api.js`**

Replace the `inviteToBoard`/`inviteMember` entry with a single:

```js
  inviteMember: (boardId, email) =>
    request(`/boards/${boardId}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
```

Set `createTeam`:

```js
  createTeam: (boardId, name, description = "") =>
    request("/teams", {
      method: "POST",
      body: JSON.stringify({ boardId, name, description }),
    }),
```

Set `createSprint`:

```js
  createSprint: (boardId, name, startsAt, endsAt, goal = "") =>
    request("/sprints", {
      method: "POST",
      body: JSON.stringify({
        boardId,
        name,
        startsAt: startsAt || null,
        endsAt: endsAt || null,
        goal,
        isActive: false,
      }),
    }),
```

Confirm `updateSprint(sprintId, payload)` and `deleteSprint(sprintId)` already point at `/sprints/${sprintId}` with `PATCH`/`DELETE` — keep as-is.

- [ ] **Step 2: Grep for the removed name**

Run: `cd frontend && grep -rn "inviteToBoard" src/`
Expected: no matches (the only caller was in `Board.jsx`, removed in Task 11). If a match remains, it is fixed in Task 11.

- [ ] **Step 3: Build check**

Run: `cd frontend && npm run build`
Expected: build succeeds (no syntax errors). Warnings about unused code are acceptable at this step.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js
git commit -m "refactor(frontend): align api.js signatures with settings UI + dependencyIds"
```

---

### Task 11: Delete the inline management panel from `Board.jsx`

**Files:**
- Modify: `frontend/src/components/Board.jsx`

**Interfaces:**
- Produces: `Board.jsx` renders only the board (header with title + task columns + `DndContext`). It keeps props `{ boardId, currentUserId, onGamificationEvent, onBoardDeleted }` for now (Phase 2 changes the prop set). All invite/team/sprint state, handlers, and the `board-management` JSX are gone. `handleCreateTask`, `handleUpdateTask`, `handleDeleteTask`, `handleDeleteBoard`, `handleDragEnd`, `refresh` stay.

- [ ] **Step 1: Remove state**

Delete these `useState` lines: `showManagement`, `inviteEmail`, `inviteResult`, `teamName`, `expandedTeam`, `teamMemberId`, `teamMembers`, `sprintName`, `sprintStart`, `sprintEnd`, `sprintActive`. Keep `board`, `loading`, `error`.

- [ ] **Step 2: Remove handlers**

Delete `handleInvite`, `handleCreateTeam`, `loadTeamMembers`, `handleAddTeamMember`, `handleRemoveTeamMember`, `handleDeleteTeam`, `handleCreateSprint`.

- [ ] **Step 3: Remove JSX**

Delete the `board-header-actions` buttons block (the "Board settings" toggle and the "Delete board" button) **except** keep a single "Delete board" button when `isOwner` (still calls `handleDeleteBoard`). Delete the entire `{showManagement && ( ... )}` block (the `board-management` div with all four `<section>`s).

- [ ] **Step 4: Keep the board subtitle counts**

The `board-subtitle` line references `board.members`/`board.teams`/`board.sprints`, which `GET /:boardId` still returns — leave it.

- [ ] **Step 5: Verify build + manual smoke**

Run: `cd frontend && npm run build`
Expected: succeeds.

Then run both servers (`cd backend && npm run dev`, `cd frontend && npm run dev`), log in, open a board. Verify: board loads, columns render, add-task works, drag to Done fires the XP toast, "Delete board" still prompts. There is no settings UI right now — that is expected; Phase 2 adds it.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Board.jsx
git commit -m "refactor(frontend): remove duplicate inline management panel from Board"
```

---

### Task 12: Phase 1 checkpoint

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all tests PASS (sprints, invitations, teams, tasks).

- [ ] **Step 2: Frontend build**

Run: `cd frontend && npm run build`
Expected: succeeds.

- [ ] **Step 3: Tag the phase**

```bash
git tag phase-1-reconcile
```

---

## Phase 2 — Restructure

### File structure (Phase 2)

- Modify `frontend/package.json` — add `react-router-dom`.
- Modify `frontend/src/main.jsx` — wrap `<App/>` in `<BrowserRouter>`.
- Modify `frontend/src/App.jsx` — auth gate + `<Routes>` + toast host only.
- Create `frontend/src/components/AppShell.jsx` — HUD, board switcher, theme toggle (theme toggle wired in Phase 3), settings link, `<Outlet/>`; owns board list + active board + gamification event handling.
- Create `frontend/src/pages/BoardPage.jsx` — reads `:boardId`; owns selected-sprint state; renders `<SprintBar/>` + `<Board/>`.
- Create `frontend/src/components/SprintBar.jsx` — sprint switcher + progress strip.
- Create `frontend/src/pages/BoardSettingsPage.jsx` — two-pane settings; sub-nav + section.
- Create `frontend/src/components/settings/SettingsSection.jsx` — section shell.
- Create `frontend/src/components/settings/MembersSection.jsx`, `TeamsSection.jsx`, `SprintsSection.jsx` — extracted from `BoardSettings.jsx`.
- Create `frontend/src/pages/InviteAcceptPage.jsx`.
- Create `frontend/src/pages/NotFound.jsx`.
- Modify `frontend/src/components/Board.jsx` — accept `sprintFilter` prop; drop `onBoardDeleted` (moves to `BoardSettingsPage`'s "Danger zone").
- Modify `frontend/src/components/Column.jsx` — default the new-task sprint select to the viewed sprint.
- Modify `frontend/src/components/TaskCard.jsx` — add a sprint select to the edit form; send `dependencyIds`.
- Delete `frontend/src/components/BoardSettings.jsx`.

---

### Task 13: Add `react-router-dom` and the router skeleton

**Files:**
- Modify: `frontend/package.json`, `frontend/src/main.jsx`, `frontend/src/App.jsx`
- Create: `frontend/src/pages/NotFound.jsx`

**Interfaces:**
- Consumes: existing `hasToken`, `clearToken`, `api` from `api.js`; `Login` component.
- Produces:
  - `main.jsx` renders `<BrowserRouter><App/></BrowserRouter>`.
  - `App.jsx` exports the auth gate: unauthenticated → `<Login onAuthed={...}/>`; authenticated → `<Routes>` with `<AppShell/>` as the layout route wrapping `index` (board picker redirect), `board/:boardId`, `board/:boardId/settings`, and `invite/:token` outside the shell, plus `*` → `<NotFound/>`. `AppShell` is added in Task 14 — until then, stub the element as `<AppShell/>` import will fail, so implement Task 14 immediately after and only build/verify at the end of Task 14.

- [ ] **Step 1: Install the dep**

Run: `cd frontend && npm install react-router-dom@^6.26.0`
Expected: added to `dependencies`, exit 0.

- [ ] **Step 2: Update `main.jsx`**

```jsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 3: Create `frontend/src/pages/NotFound.jsx`**

```jsx
import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="board-page">
      <h2>Not found</h2>
      <p>
        That page doesn’t exist. <Link to="/">Back to your boards</Link>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `frontend/src/App.jsx`**

```jsx
import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { hasToken } from "./api";
import Login from "./components/Login.jsx";
import AppShell from "./components/AppShell.jsx";
import BoardPage from "./pages/BoardPage.jsx";
import BoardSettingsPage from "./pages/BoardSettingsPage.jsx";
import InviteAcceptPage from "./pages/InviteAcceptPage.jsx";
import NotFound from "./pages/NotFound.jsx";

export default function App() {
  const [authed, setAuthed] = useState(hasToken());

  if (!authed) {
    return <Login onAuthed={() => setAuthed(true)} />;
  }

  return (
    <Routes>
      <Route element={<AppShell onSignOut={() => setAuthed(false)} />}>
        <Route index element={<BoardPage />} />
        <Route path="board/:boardId" element={<BoardPage />} />
        <Route path="board/:boardId/settings" element={<BoardSettingsPage />} />
      </Route>
      <Route path="invite/:token" element={<InviteAcceptPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
```

- [ ] **Step 5: Defer build check to Task 14**

`AppShell`, `BoardPage`, `BoardSettingsPage`, `InviteAcceptPage` do not exist yet. Do not build here.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/main.jsx frontend/src/App.jsx frontend/src/pages/NotFound.jsx
git commit -m "feat(frontend): add react-router-dom and route skeleton"
```

---

### Task 14: `AppShell` — layout, board switcher, gamification host

**Files:**
- Create: `frontend/src/components/AppShell.jsx`

**Interfaces:**
- Consumes: `api` (`boards`, `createBoard`, `me`, `leaderboard`), `clearToken`; `Hud`, `Leaderboard`, `LevelUpToast`, `AchievementToast` components; `useNavigate`, `useParams`, `Outlet`, `Link` from router.
- Produces:
  - Props: `{ onSignOut }`.
  - Renders `Hud`, a board `<select>` + "new board" form, a link to `board/:activeBoardId/settings`, a theme-toggle button (id `theme-toggle`, no-op until Phase 3 Task 22), then `<Outlet context={{ user, boards, activeBoardId, reloadBoards, onGamificationEvent }}/>`, then `Leaderboard`.
  - `onGamificationEvent(g)` — same behavior as the old `App.jsx`: `loadUser()`, bump leaderboard key, level-up toast for 2200ms, achievement toasts for 4000ms each.
  - Child routes read context with `useOutletContext()`.
  - On mount: `loadUser()` + `loadBoards()`. Selecting a board `navigate(\`/board/${id}\`)`. Creating a board navigates to it.
  - `activeBoardId` comes from `useParams().boardId`; when absent (the `index` route) and boards exist, `navigate` to the first board.

- [ ] **Step 1: Create `frontend/src/components/AppShell.jsx`**

```jsx
import { useCallback, useEffect, useState } from "react";
import { Outlet, useNavigate, useParams, Link } from "react-router-dom";
import { api, clearToken } from "../api";
import Hud from "./Hud.jsx";
import Leaderboard from "./Leaderboard.jsx";
import { LevelUpToast, AchievementToast } from "./Toasts.jsx";

export default function AppShell({ onSignOut }) {
  const navigate = useNavigate();
  const { boardId } = useParams();

  const [user, setUser] = useState(null);
  const [boards, setBoards] = useState([]);
  const [newBoardName, setNewBoardName] = useState("");
  const [showLevelUp, setShowLevelUp] = useState(false);
  const [achievementQueue, setAchievementQueue] = useState([]);
  const [leaderboardKey, setLeaderboardKey] = useState(0);

  const loadUser = useCallback(async () => {
    setUser(await api.me());
  }, []);

  const loadBoards = useCallback(async () => {
    const list = await api.boards();
    setBoards(list);
    return list;
  }, []);

  useEffect(() => {
    loadUser();
    loadBoards();
  }, [loadUser, loadBoards]);

  useEffect(() => {
    if (!boardId && boards.length > 0) {
      navigate(`/board/${boards[0].id}`, { replace: true });
    }
  }, [boardId, boards, navigate]);

  function handleSignOut() {
    clearToken();
    onSignOut();
    navigate("/");
  }

  async function handleCreateBoard(e) {
    e.preventDefault();
    if (!newBoardName.trim()) return;
    const board = await api.createBoard(newBoardName.trim());
    setNewBoardName("");
    await loadBoards();
    navigate(`/board/${board.id}`);
  }

  function onGamificationEvent(g) {
    loadUser();
    setLeaderboardKey((k) => k + 1);
    if (g.leveledUp) {
      setShowLevelUp(true);
      setTimeout(() => setShowLevelUp(false), 2200);
    }
    if (g.unlockedAchievements?.length) {
      setAchievementQueue((q) => [...q, ...g.unlockedAchievements]);
      g.unlockedAchievements.forEach((ach) => {
        setTimeout(() => {
          setAchievementQueue((q) => q.filter((a) => a.id !== ach.id));
        }, 4000);
      });
    }
  }

  return (
    <>
      <Hud user={user} justLeveledUp={showLevelUp} onSignOut={handleSignOut} />
      {showLevelUp && user && <LevelUpToast level={user.level} />}
      {achievementQueue.map((ach) => (
        <AchievementToast key={ach.id} achievement={ach} />
      ))}

      <div className="board-page" style={{ paddingBottom: 0 }}>
        <div className="board-select-row">
          <select
            value={boardId || ""}
            onChange={(e) => navigate(`/board/${e.target.value}`)}
          >
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>

          <form onSubmit={handleCreateBoard} style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              placeholder="New board name"
              value={newBoardName}
              onChange={(e) => setNewBoardName(e.target.value)}
            />
            <button className="btn-ghost" type="submit">
              + New board
            </button>
          </form>

          {boardId && (
            <Link className="btn-ghost" to={`/board/${boardId}/settings`}>
              Board settings
            </Link>
          )}

          <button
            id="theme-toggle"
            className="btn-ghost"
            type="button"
            onClick={() => {}}
            title="Toggle theme"
          >
            Theme
          </button>
        </div>
      </div>

      <Outlet
        context={{
          user,
          boards,
          activeBoardId: boardId,
          reloadBoards: loadBoards,
          onGamificationEvent,
        }}
      />

      <div className="board-page" style={{ paddingTop: 0 }}>
        <Leaderboard refreshKey={leaderboardKey} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Do not build yet** — `BoardPage` / `BoardSettingsPage` / `InviteAcceptPage` still missing. Proceed to Task 15.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AppShell.jsx
git commit -m "feat(frontend): AppShell layout route with board switcher + gamification host"
```

---

### Task 15: `SprintBar` — switcher + progress strip

**Files:**
- Create: `frontend/src/components/SprintBar.jsx`

**Interfaces:**
- Consumes: `board` object (has `sprints`, `tasks` with `story_points`/`status`/`sprint_id`).
- Produces:
  - Props: `{ board, value, onChange }` where `value` is `"all"` | `"backlog"` | a sprint id, `onChange(next)` sets it.
  - Renders a row of buttons: `All tasks`, `Backlog`, then one per sprint (name; the active one gets an `is-active` marker).
  - When `value` is a real sprint id, renders the progress strip: committed points (sum `story_points` where `sprint_id === value`), completed points (same but `status === "done"`), a `<progress>`/bar, days-remaining from that sprint's `ends_at`, and the sprint `goal` if set.
  - Pure/derived — no fetching.

- [ ] **Step 1: Create `frontend/src/components/SprintBar.jsx`**

```jsx
function daysRemaining(endsAt) {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;
  const ms = end.getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

export default function SprintBar({ board, value, onChange }) {
  const sprints = board.sprints || [];
  const selected =
    value !== "all" && value !== "backlog"
      ? sprints.find((s) => s.id === value)
      : null;

  const sprintTasks = selected
    ? (board.tasks || []).filter((t) => t.sprint_id === selected.id)
    : [];
  const committed = sprintTasks.reduce((n, t) => n + (t.story_points || 0), 0);
  const completed = sprintTasks
    .filter((t) => t.status === "done")
    .reduce((n, t) => n + (t.story_points || 0), 0);
  const pct = committed > 0 ? Math.round((completed / committed) * 100) : 0;
  const left = selected ? daysRemaining(selected.ends_at) : null;

  return (
    <div className="sprint-bar">
      <div className="sprint-switcher">
        <button
          type="button"
          className={"sprint-chip" + (value === "all" ? " selected" : "")}
          onClick={() => onChange("all")}
        >
          All tasks
        </button>
        <button
          type="button"
          className={"sprint-chip" + (value === "backlog" ? " selected" : "")}
          onClick={() => onChange("backlog")}
        >
          Backlog
        </button>
        {sprints.map((s) => (
          <button
            key={s.id}
            type="button"
            className={
              "sprint-chip" +
              (value === s.id ? " selected" : "") +
              (s.is_active ? " is-active" : "")
            }
            onClick={() => onChange(s.id)}
          >
            {s.name}
            {s.is_active ? " ·  active" : ""}
          </button>
        ))}
      </div>

      {selected && (
        <div className="sprint-progress">
          <div className="sprint-progress-meta">
            <span>
              {completed} / {committed} pts
            </span>
            {left !== null && (
              <span>
                {left > 0 ? `${left} day${left === 1 ? "" : "s"} left` : "ended"}
              </span>
            )}
            {selected.goal && <span className="sprint-goal">{selected.goal}</span>}
          </div>
          <div className="sprint-progress-track">
            <div
              className="sprint-progress-fill"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/SprintBar.jsx
git commit -m "feat(frontend): SprintBar switcher + derived sprint progress strip"
```

---

### Task 16: `BoardPage` — sprint-aware wrapper

**Files:**
- Create: `frontend/src/pages/BoardPage.jsx`
- Modify: `frontend/src/components/Board.jsx`

**Interfaces:**
- Consumes: `useParams().boardId`, `useOutletContext()` → `{ onGamificationEvent, user }`; `SprintBar`; `Board`.
- Produces:
  - `BoardPage` owns `sprintFilter` state (default `"all"`), fetches nothing itself — it passes `boardId`, `sprintFilter`, `onGamificationEvent`, `currentUserId` to `<Board>` and renders `<SprintBar board={board} .../>` above it. To give `SprintBar` the board data, `Board` calls a new `onBoardLoaded(board)` callback prop with its fetched board; `BoardPage` holds that in state.
  - `Board` new/changed props: `{ boardId, currentUserId, onGamificationEvent, sprintFilter, onBoardLoaded }`. Removed: `onBoardDeleted`. `Board` filters `board.tasks` by `sprintFilter` before splitting into columns: `"all"` → no filter; `"backlog"` → `sprint_id == null`; otherwise `sprint_id === sprintFilter`.
  - When `sprintFilter` changes, no refetch — filtering is client-side.
  - Default the active sprint: after `onBoardLoaded`, if `sprintFilter === "all"` and the board has an active sprint, `BoardPage` sets `sprintFilter` to that sprint's id once (guard with a ref so the user can switch back to "all").

- [ ] **Step 1: Create `frontend/src/pages/BoardPage.jsx`**

```jsx
import { useEffect, useRef, useState } from "react";
import { useParams, useOutletContext } from "react-router-dom";
import Board from "../components/Board.jsx";
import SprintBar from "../components/SprintBar.jsx";

export default function BoardPage() {
  const { boardId } = useParams();
  const { onGamificationEvent, user } = useOutletContext();

  const [board, setBoard] = useState(null);
  const [sprintFilter, setSprintFilter] = useState("all");
  const autoSelected = useRef(false);

  useEffect(() => {
    setBoard(null);
    setSprintFilter("all");
    autoSelected.current = false;
  }, [boardId]);

  function handleBoardLoaded(loaded) {
    setBoard(loaded);
    if (!autoSelected.current) {
      autoSelected.current = true;
      const active = (loaded.sprints || []).find((s) => s.is_active);
      if (active) setSprintFilter(active.id);
    }
  }

  if (!boardId) return null;

  return (
    <>
      {board && (
        <div className="board-page" style={{ paddingTop: 0, paddingBottom: 0 }}>
          <SprintBar
            board={board}
            value={sprintFilter}
            onChange={setSprintFilter}
          />
        </div>
      )}
      <Board
        key={boardId}
        boardId={boardId}
        currentUserId={user?.id}
        onGamificationEvent={onGamificationEvent}
        sprintFilter={sprintFilter}
        onBoardLoaded={handleBoardLoaded}
      />
    </>
  );
}
```

- [ ] **Step 2: Update `Board.jsx` props + filtering**

- Change the signature to `{ boardId, currentUserId, onGamificationEvent, sprintFilter = "all", onBoardLoaded }`.
- In `refresh()`, after `setBoard(data)`, call `onBoardLoaded?.(data)`.
- Remove `handleDeleteBoard` and the "Delete board" button and the `isOwner` const if now unused (board deletion moves to settings — Task 19).
- Before rendering columns, compute:

```js
const visibleTasks = (board.tasks || []).filter((t) => {
  if (sprintFilter === "all") return true;
  if (sprintFilter === "backlog") return t.sprint_id == null;
  return t.sprint_id === sprintFilter;
});
```

and pass `visibleTasks.filter((t) => t.status === col.status)` to each `Column`, and `allTasks={visibleTasks}`.

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: succeeds now that `AppShell`/`BoardPage`/`NotFound` exist. `BoardSettingsPage` + `InviteAcceptPage` still missing → build fails on those imports. If so, add temporary one-line stub components exporting `return null;` and note they are completed in Tasks 17–19. Remove stubs as those tasks land.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BoardPage.jsx frontend/src/components/Board.jsx
git commit -m "feat(frontend): sprint-aware BoardPage wrapper + client-side task filter"
```

---

### Task 17: Extract settings sections from `BoardSettings.jsx`

**Files:**
- Create: `frontend/src/components/settings/SettingsSection.jsx`, `MembersSection.jsx`, `TeamsSection.jsx`, `SprintsSection.jsx`

**Interfaces:**
- Consumes: `api` methods from Task 10.
- Produces:
  - `SettingsSection({ title, children })` → `<section className="settings-section"><h3>{title}</h3>{children}</section>`.
  - `MembersSection({ boardId })` — self-contained: loads members (`api.boardMembers`) + pending invites (`api.boardInvitations`); invite form (`api.inviteMember`) shows the returned token as a copyable `/invite/:token` URL; remove member (`api.removeBoardMember`); cancel invite (`api.cancelInvitation`).
  - `TeamsSection({ boardId })` — loads `api.teams` + per-team `api.teamMembers`; create (`api.createTeam(boardId, name, description)`); add/remove member; delete team.
  - `SprintsSection({ boardId })` — loads `api.sprints`; create (`api.createSprint(boardId, name, startsAt, endsAt, goal)`); start/finish via `api.updateSprint(id, { isActive })`; delete via `api.deleteSprint`.
  - Each section manages its own loading/error state and refetches after mutations.

- [ ] **Step 1: Create `SettingsSection.jsx`**

```jsx
export default function SettingsSection({ title, children }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
```

- [ ] **Step 2: Create `MembersSection.jsx`** — port `MembersTab` from `BoardSettings.jsx`, with these changes: take `boardId` (not `members`/`onRefresh`) and load members itself; after `api.inviteMember` returns `{ token, email }`, set `inviteResult` to `` `${window.location.origin}/invite/${token}` `` and render it in a read-only `<input>` with a "Copy" button (`navigator.clipboard.writeText`).

```jsx
import { useEffect, useState } from "react";
import { api } from "../../api";

export default function MembersSection({ boardId }) {
  const [members, setMembers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [email, setEmail] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setError("");
      setMembers(await api.boardMembers(boardId));
      setInvitations(await api.boardInvitations(boardId));
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, [boardId]);

  async function invite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    try {
      setError("");
      const res = await api.inviteMember(boardId, email.trim());
      setInviteUrl(`${window.location.origin}/invite/${res.token}`);
      setEmail("");
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeMember(userId) {
    if (!window.confirm("Remove this person from the board?")) return;
    try {
      await api.removeBoardMember(boardId, userId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function cancelInvitation(id) {
    try {
      await api.cancelInvitation(boardId, id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      {error && <div className="error-message">{error}</div>}

      <div className="settings-list">
        {members.map((m) => (
          <div key={m.id} className="settings-list-item">
            <div>
              <strong>{m.display_name}</strong>
              <small>{m.email}</small>
            </div>
            <span className="member-role">{m.role}</span>
            {m.role !== "owner" && (
              <button
                className="btn-danger"
                type="button"
                onClick={() => removeMember(m.id)}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      <form onSubmit={invite} className="settings-form">
        <input
          type="email"
          placeholder="person@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button className="btn-primary" type="submit">
          Create invitation
        </button>
      </form>

      {inviteUrl && (
        <div className="invite-url-row">
          <input type="text" readOnly value={inviteUrl} />
          <button
            className="btn-ghost"
            type="button"
            onClick={() => navigator.clipboard?.writeText(inviteUrl)}
          >
            Copy link
          </button>
        </div>
      )}

      {invitations.length > 0 && (
        <>
          <h4>Pending invitations</h4>
          <div className="settings-list">
            {invitations.map((inv) => (
              <div key={inv.id} className="settings-list-item">
                <span>{inv.email}</span>
                <span>pending</span>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => cancelInvitation(inv.id)}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `TeamsSection.jsx`** — port `TeamsTab` from `BoardSettings.jsx` (it already calls the right `api` methods). Take `boardId` only; load its own `members` via `api.boardMembers(boardId)` for the "add member" dropdown. Keep the `description` textarea. Replace the outer `<div className="settings-section">` + `<h3>` with a bare `<div>` (the page wraps it in `SettingsSection`).

- [ ] **Step 4: Create `SprintsSection.jsx`** — port `SprintsTab` from `BoardSettings.jsx`. It already calls `api.createSprint(boardId, name, startsAt, endsAt)` (Task 10 made that signature real) — add an optional `goal` text input and pass it as the 5th arg. Keep start/finish/delete. Replace the outer section wrapper with a bare `<div>`.

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: succeeds (sections not yet imported anywhere, but must compile). Fix any JSX errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/settings/
git commit -m "feat(frontend): extract Members/Teams/Sprints settings sections"
```

---

### Task 18: `BoardSettingsPage` — two-pane routed view

**Files:**
- Create: `frontend/src/pages/BoardSettingsPage.jsx`
- Delete: `frontend/src/components/BoardSettings.jsx`

**Interfaces:**
- Consumes: `useParams().boardId`, `Link`/`useNavigate`; `SettingsSection` + the three sections; `api.board` (for the board name + owner check) — or `useOutletContext().boards` to find the name.
- Produces:
  - Route element for `board/:boardId/settings`.
  - Left sub-nav: `Members`, `Teams`, `Sprints`, `Danger zone`. Right pane renders the selected section inside `<SettingsSection>`.
  - A "Back to board" `Link` to `/board/:boardId`.
  - `Danger zone` → "Delete board" button (`api.deleteBoard`), behind a type-the-name `window.prompt`, then `reloadBoards()` from outlet context and `navigate("/")`.
  - Section state kept in the URL hash or local state; local `useState("members")` is fine.

- [ ] **Step 1: Create `frontend/src/pages/BoardSettingsPage.jsx`**

```jsx
import { useState } from "react";
import {
  useParams,
  useNavigate,
  useOutletContext,
  Link,
} from "react-router-dom";
import { api } from "../api";
import SettingsSection from "../components/settings/SettingsSection.jsx";
import MembersSection from "../components/settings/MembersSection.jsx";
import TeamsSection from "../components/settings/TeamsSection.jsx";
import SprintsSection from "../components/settings/SprintsSection.jsx";

const TABS = [
  { id: "members", label: "Members" },
  { id: "teams", label: "Teams" },
  { id: "sprints", label: "Sprints" },
  { id: "danger", label: "Danger zone" },
];

export default function BoardSettingsPage() {
  const { boardId } = useParams();
  const navigate = useNavigate();
  const { boards, reloadBoards } = useOutletContext();
  const [tab, setTab] = useState("members");

  const board = (boards || []).find((b) => b.id === boardId);

  async function deleteBoard() {
    const typed = window.prompt(
      `Type the board name to permanently delete it${
        board ? ` ("${board.name}")` : ""
      }:`
    );
    if (!board || typed !== board.name) return;
    await api.deleteBoard(boardId);
    await reloadBoards();
    navigate("/");
  }

  return (
    <div className="board-page settings-page">
      <div className="settings-topbar">
        <Link className="btn-ghost" to={`/board/${boardId}`}>
          ← Back to board
        </Link>
        <h2>{board ? board.name : "Board"} · settings</h2>
      </div>

      <div className="settings-layout">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"settings-nav-item" + (tab === t.id ? " active" : "")}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === "members" && (
            <SettingsSection title="Members & invitations">
              <MembersSection boardId={boardId} />
            </SettingsSection>
          )}
          {tab === "teams" && (
            <SettingsSection title="Teams">
              <TeamsSection boardId={boardId} />
            </SettingsSection>
          )}
          {tab === "sprints" && (
            <SettingsSection title="Sprints">
              <SprintsSection boardId={boardId} />
            </SettingsSection>
          )}
          {tab === "danger" && (
            <SettingsSection title="Danger zone">
              <p>Deleting a board removes all of its tasks, teams, and sprints.</p>
              <button className="btn-danger" type="button" onClick={deleteBoard}>
                Delete this board
              </button>
            </SettingsSection>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old file**

Run: `git rm frontend/src/components/BoardSettings.jsx`

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: succeeds once `InviteAcceptPage` exists (Task 19). If building now, keep the Task 16 stub for `InviteAcceptPage`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/BoardSettingsPage.jsx frontend/src/components/BoardSettings.jsx
git commit -m "feat(frontend): dedicated two-pane board settings route"
```

---

### Task 19: `InviteAcceptPage`

**Files:**
- Create: `frontend/src/pages/InviteAcceptPage.jsx`

**Interfaces:**
- Consumes: `useParams().token`, `useNavigate`; `api.acceptInvitation(token)`, `hasToken` from `api.js`; `Login`.
- Produces:
  - Route element for `/invite/:token` (outside `AppShell`).
  - If `!hasToken()` → render `<Login onAuthed={...}/>` with a message "Log in or register to accept this invitation", staying on the URL; after auth, proceed.
  - Otherwise: a "You've been invited to a board" card with an "Accept invitation" button → `api.acceptInvitation(token)` → on success `navigate(\`/board/${res.boardId}\`)`; on error show the message (e.g. wrong email, already used).

- [ ] **Step 1: Create `frontend/src/pages/InviteAcceptPage.jsx`**

```jsx
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api, hasToken } from "../api";
import Login from "../components/Login.jsx";

export default function InviteAcceptPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [authed, setAuthed] = useState(hasToken());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!authed) {
    return (
      <div className="board-page">
        <p>Log in or register to accept this invitation.</p>
        <Login onAuthed={() => setAuthed(true)} />
      </div>
    );
  }

  async function accept() {
    setBusy(true);
    setError("");
    try {
      const res = await api.acceptInvitation(token);
      navigate(`/board/${res.boardId}`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="board-page invite-accept">
      <h2>You’ve been invited to a board</h2>
      {error && <div className="error-message">{error}</div>}
      <button
        className="btn-primary"
        type="button"
        onClick={accept}
        disabled={busy}
      >
        {busy ? "Accepting…" : "Accept invitation"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Remove any temporary stubs** created in Tasks 16/18 for this file.

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: succeeds with no missing-import errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/InviteAcceptPage.jsx
git commit -m "feat(frontend): invite-accept landing page"
```

---

### Task 20: Task form — sprint select default

**Files:**
- Modify: `frontend/src/components/Column.jsx`, `frontend/src/components/TaskCard.jsx`

**Interfaces:**
- Consumes: `board` (with `sprints`), `sprintFilter` (thread from `BoardPage` → `Board` → `Column`).
- Produces:
  - `Board` passes `sprintFilter` down to each `Column`.
  - `Column`'s new-task form: the sprint `<select>` initial value = `sprintFilter` when it is a real sprint id, else `""`.
  - `TaskCard` edit form gains a sprint `<select>` (options from `board.sprints`), submitting `sprintId` in the `onUpdate` payload; it already sends `dependencyIds`.

- [ ] **Step 1: Thread `sprintFilter` through `Board.jsx` → `Column`**

In `Board.jsx`, add `sprintFilter={sprintFilter}` to each `<Column>`. In `Column.jsx` signature add `sprintFilter`. Initialize sprint state:

```js
const [sprintId, setSprintId] = useState(
  sprintFilter && sprintFilter !== "all" && sprintFilter !== "backlog"
    ? sprintFilter
    : ""
);
```

- [ ] **Step 2: Add the sprint select to `TaskCard.jsx` edit form**

`TaskCard` needs `board` (already passed by `Column`). Add state `const [sprintId, setSprintId] = useState(task.sprint_id || "");` and, in the editing `<form>`, a `<select>` bound to it with options `["No sprint", ...board.sprints]`. Include `sprintId: sprintId || null` in the `onUpdate(task.id, { ... })` payload. Confirm the payload key for dependencies is `dependencyIds` (rename the existing `dependencyIds` variable use if it still says `dependencies`).

- [ ] **Step 3: Build + manual check**

Run: `cd frontend && npm run build` then run both dev servers.
Verify: with a sprint selected in `SprintBar`, opening "+ Add task" pre-selects that sprint; a created task appears under that sprint filter and disappears when you switch to another sprint. Editing a task lets you change its sprint.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Column.jsx frontend/src/components/TaskCard.jsx frontend/src/components/Board.jsx
git commit -m "feat(frontend): default new-task sprint to the viewed sprint; sprint edit on cards"
```

---

### Task 21: Phase 2 checkpoint (manual verification)

- [ ] **Step 1: Build**

Run: `cd frontend && npm run build` — succeeds. `cd backend && npm test` — all pass.

- [ ] **Step 2: End-to-end manual pass** (two dev servers running)

Verify each:
- `/` redirects to the first board; the board switcher navigates between boards and updates the URL.
- `Board settings` link opens `/board/:id/settings`; sub-nav switches Members / Teams / Sprints / Danger zone; "Back to board" returns.
- Members: create an invitation → a `/invite/<token>` URL appears and copies. Open it in a second browser profile (or after signing out), register/log in as the invited email, click Accept → lands on the board; the new member shows in Members.
- Teams: create a team (with description), add/remove a board member, delete the team. Non-owner (the invited user) does not see destructive controls succeed (server 403 surfaces as an error message).
- Sprints: create a sprint with goal + dates; Start it (SprintBar shows it active); the board auto-selects the active sprint on load; progress strip math matches (`done pts / total pts`); Finish and Delete work.
- Danger zone: delete a throwaway board → redirects to `/`.
- Drag a task to Done → XP toast still fires; leaderboard refreshes.

- [ ] **Step 3: Tag**

```bash
git tag phase-2-restructure
```

---

## Phase 3 — Redesign

### File structure (Phase 3)

- Create `frontend/src/theme.js` — `getStoredTheme()`, `applyTheme(mode)`, `nextTheme(current)`.
- Modify `frontend/src/main.jsx` — apply the stored theme before render.
- Modify `frontend/src/components/AppShell.jsx` — wire the `#theme-toggle` button to `theme.js`.
- Rewrite `frontend/src/styles.css` — token system (`:root` light, dark overrides, `[data-theme]` overrides), then section-by-section component styling covering every class used by the app (existing + new: `sprint-bar`, `sprint-chip`, `sprint-progress*`, `settings-page`, `settings-layout`, `settings-nav`, `settings-content`, `settings-section`, `settings-list`, `settings-form`, `invite-url-row`, `team-card`, `sprint-card`, `member-role`, `task-card-drag-area`, `task-card-actions`, `task-card-description`, `task-dependencies`, `dependency-*`, `error-message`, `board-subtitle`, `invite-accept`).
- Modify `README.md` — update "Where to go from here".

---

### Task 22: Theme module + toggle

**Files:**
- Create: `frontend/src/theme.js`
- Modify: `frontend/src/main.jsx`, `frontend/src/components/AppShell.jsx`

**Interfaces:**
- Produces:
  - `theme.js`:
    - `STORAGE_KEY = "questboard-theme"`.
    - `getStoredTheme()` → `"light" | "dark" | null` (try/catch around `localStorage`, returns `null` on any failure or absence).
    - `applyTheme(mode)` — if `mode` is `"light"`/`"dark"` sets `document.documentElement.dataset.theme` and stores it; if `null`/`"system"` removes the attribute and the stored key.
    - `resolveInitial()` → the stored theme, else `null` (system).
    - `nextTheme(current)` — cycles `null → "light" → "dark" → null`.
  - `main.jsx` calls `applyTheme(resolveInitial())` before `createRoot`.
  - `AppShell` tracks `themeMode` state (init `resolveInitial()`), the `#theme-toggle` button calls `setThemeMode(nextTheme(themeMode))` + `applyTheme(...)`, label shows `System` / `Light` / `Dark`.

- [ ] **Step 1: Create `frontend/src/theme.js`**

```js
const STORAGE_KEY = "questboard-theme";

export function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(mode) {
  const root = document.documentElement;
  if (mode === "light" || mode === "dark") {
    root.dataset.theme = mode;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {}
  } else {
    delete root.dataset.theme;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }
}

export function resolveInitial() {
  return getStoredTheme();
}

export function nextTheme(current) {
  if (current === null || current === undefined) return "light";
  if (current === "light") return "dark";
  return null;
}

export function themeLabel(mode) {
  if (mode === "light") return "Light";
  if (mode === "dark") return "Dark";
  return "System";
}
```

- [ ] **Step 2: Apply before render in `main.jsx`**

```jsx
import { applyTheme, resolveInitial } from "./theme.js";
applyTheme(resolveInitial());
```

(above `ReactDOM.createRoot`).

- [ ] **Step 3: Wire the toggle in `AppShell.jsx`**

```jsx
import { applyTheme, resolveInitial, nextTheme, themeLabel } from "../theme.js";
// ...
const [themeMode, setThemeMode] = useState(resolveInitial());
// button:
<button
  id="theme-toggle"
  className="btn-ghost"
  type="button"
  onClick={() => {
    const next = nextTheme(themeMode);
    setThemeMode(next);
    applyTheme(next);
  }}
  title="Toggle light / dark / system"
>
  {themeLabel(themeMode)}
</button>
```

- [ ] **Step 4: Manual check**

Run dev servers. Click the theme button through System → Light → Dark → System. Reload — the chosen mode persists (System shows no `data-theme` attribute; check with devtools on `<html>`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/theme.js frontend/src/main.jsx frontend/src/components/AppShell.jsx
git commit -m "feat(frontend): light/dark/system theme toggle with persistence"
```

---

### Task 23: Token system in `styles.css`

**Files:**
- Modify: `frontend/src/styles.css` (the `:root` block and add theme blocks; do not restyle components yet)

**Interfaces:**
- Produces: a complete token set defined on bare `:root` (light palette), overridden under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, and under `:root[data-theme="dark"]` / `:root[data-theme="light"]`. Tokens: `--bg`, `--surface`, `--surface-raised`, `--surface-overlay`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--text-faint`, `--gold`, `--gold-ink` (text on gold), `--teal`, `--danger`, `--danger-ink`, `--priority-low|normal|high|urgent`, `--radius-sm|md|lg`, `--shadow-sm|md|lg`, `--space-1..8`, `--xp-track`, `--xp-fill`, `--streak-flame`, `--level-ring`, `--font-display`, `--font-body`.

- [ ] **Step 1: Replace the `:root` block**

```css
:root {
  /* light — "parchment & ink" quest theme */
  --bg: #f4efe4;
  --surface: #fbf7ee;
  --surface-raised: #ffffff;
  --surface-overlay: #ffffff;
  --border: #e0d6c2;
  --border-strong: #cabfa4;
  --text: #2a2620;
  --text-muted: #6b6455;
  --text-faint: #9a9283;

  --gold: #c8912f;
  --gold-ink: #1c1710;
  --teal: #2c8c86;
  --danger: #b23b3b;
  --danger-ink: #ffffff;

  --priority-low: #7c9aa6;
  --priority-normal: #5b8def;
  --priority-high: #d98a3d;
  --priority-urgent: #d1524f;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 16px;

  --shadow-sm: 0 1px 2px rgba(30, 24, 14, 0.08);
  --shadow-md: 0 6px 18px rgba(30, 24, 14, 0.12);
  --shadow-lg: 0 18px 48px rgba(30, 24, 14, 0.18);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --space-7: 48px;
  --space-8: 64px;

  --xp-track: #e6dcc6;
  --xp-fill: linear-gradient(90deg, #c8912f, #e6b453);
  --streak-flame: #d97528;
  --level-ring: #2c8c86;

  --font-display: "Sora", sans-serif;
  --font-body: "Inter", sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #14151f;
    --surface: #1e2030;
    --surface-raised: #262940;
    --surface-overlay: #2b2e46;
    --border: #2c2f45;
    --border-strong: #3b3f5c;
    --text: #ededf4;
    --text-muted: #9095ad;
    --text-faint: #6b7090;

    --gold: #e8b94a;
    --gold-ink: #14151f;
    --teal: #4ecdc4;
    --danger: #e85d5d;
    --danger-ink: #14151f;

    --priority-low: #6b8f9c;
    --priority-normal: #5b8def;
    --priority-high: #e89a4a;
    --priority-urgent: #e85d5d;

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 20px 56px rgba(0, 0, 0, 0.55);

    --xp-track: #2c2f45;
    --xp-fill: linear-gradient(90deg, #e8b94a, #f2d488);
    --streak-flame: #f0894a;
    --level-ring: #4ecdc4;
  }
}

:root[data-theme="dark"] {
  --bg: #14151f;
  --surface: #1e2030;
  --surface-raised: #262940;
  --surface-overlay: #2b2e46;
  --border: #2c2f45;
  --border-strong: #3b3f5c;
  --text: #ededf4;
  --text-muted: #9095ad;
  --text-faint: #6b7090;
  --gold: #e8b94a;
  --gold-ink: #14151f;
  --teal: #4ecdc4;
  --danger: #e85d5d;
  --danger-ink: #14151f;
  --priority-low: #6b8f9c;
  --priority-normal: #5b8def;
  --priority-high: #e89a4a;
  --priority-urgent: #e85d5d;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 8px 24px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 20px 56px rgba(0, 0, 0, 0.55);
  --xp-track: #2c2f45;
  --xp-fill: linear-gradient(90deg, #e8b94a, #f2d488);
  --streak-flame: #f0894a;
  --level-ring: #4ecdc4;
}

:root[data-theme="light"] {
  /* bare :root is already light; this block exists so an explicit
     light choice wins over a dark OS preference — repeat the values */
  --bg: #f4efe4;
  --surface: #fbf7ee;
  --surface-raised: #ffffff;
  --surface-overlay: #ffffff;
  --border: #e0d6c2;
  --border-strong: #cabfa4;
  --text: #2a2620;
  --text-muted: #6b6455;
  --text-faint: #9a9283;
  --gold: #c8912f;
  --gold-ink: #1c1710;
  --teal: #2c8c86;
  --danger: #b23b3b;
  --danger-ink: #ffffff;
  --priority-low: #7c9aa6;
  --priority-normal: #5b8def;
  --priority-high: #d98a3d;
  --priority-urgent: #d1524f;
  --shadow-sm: 0 1px 2px rgba(30, 24, 14, 0.08);
  --shadow-md: 0 6px 18px rgba(30, 24, 14, 0.12);
  --shadow-lg: 0 18px 48px rgba(30, 24, 14, 0.18);
  --xp-track: #e6dcc6;
  --xp-fill: linear-gradient(90deg, #c8912f, #e6b453);
  --streak-flame: #d97528;
  --level-ring: #2c8c86;
}
```

- [ ] **Step 2: Keep `body` explicitly painted**

Ensure the existing `body { background: var(--bg); color: var(--text); }` rule stays.

- [ ] **Step 3: Build + eyeball**

Run: `cd frontend && npm run build`, then dev. The app will look rough (components not restyled yet) but must not be unreadable — text on background must have contrast in all three theme states.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(frontend): full design-token set with light/dark/explicit theme blocks"
```

---

### Task 24: Restyle core surfaces (HUD, board, columns, cards)

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Produces: restyled `.hud*`, `.board-page`, `.board-select-row`, `.board-header`, `.board-title`, `.board-subtitle`, `.columns`, `.column*`, `.task-card*` (including `.task-card-drag-area`, `.task-card-actions`, `.task-card-description`, `.task-dependencies`), `.task-priority.*` (as a left rail), `.task-xp`, `.new-task-form`, `.dependency-*`, `.btn-primary|ghost|danger`, `.error-message` — all using tokens. No JSX changes.

- [ ] **Step 1: Rework the button rules**

```css
.btn-primary {
  background: var(--gold);
  color: var(--gold-ink);
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-4);
  font-weight: 600;
  font-size: 14px;
  box-shadow: var(--shadow-sm);
}
.btn-primary:disabled { opacity: 0.5; }

.btn-ghost {
  background: transparent;
  border: 1px solid var(--border-strong);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-4);
  font-size: 14px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
}
.btn-ghost:hover { background: var(--surface-raised); }

.btn-danger {
  background: transparent;
  border: 1px solid var(--danger);
  color: var(--danger);
  border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-4);
  font-size: 14px;
}
.btn-danger:hover { background: var(--danger); color: var(--danger-ink); }
```

- [ ] **Step 2: Task card as layered surface + priority rail**

```css
.task-card {
  position: relative;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-4);
  margin-bottom: var(--space-2);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
.task-card::before {
  content: "";
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 4px;
  background: var(--priority-normal);
}
.task-card .task-priority.low { color: var(--priority-low); }
.task-card .task-priority.normal { color: var(--priority-normal); }
.task-card .task-priority.high { color: var(--priority-high); }
.task-card .task-priority.urgent { color: var(--priority-urgent); }
.task-card.dragging { box-shadow: var(--shadow-lg); opacity: 0.9; }

.task-card-drag-area { cursor: grab; }
.task-card-description {
  color: var(--text-muted);
  font-size: 13px;
  margin-top: var(--space-1);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.task-card-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--space-2);
  font-size: 12px;
}
.task-xp {
  background: var(--xp-track);
  color: var(--text);
  border-radius: 999px;
  padding: 2px var(--space-2);
  font-weight: 600;
}
.task-dependencies { font-size: 11px; color: var(--text-faint); margin-top: var(--space-1); }
.task-card-actions { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
```

Map priority-rail color per card: add rules `.task-card:has(.task-priority.urgent)::before { background: var(--priority-urgent); }` and the same for `high` / `low` (and `normal` covered by the default).

- [ ] **Step 3: HUD, columns, board chrome**

Restyle `.hud` (sticky top bar, `--surface`, bottom border, `--shadow-sm`), the XP bar (`.hud` progress element → `--xp-track` / `--xp-fill`), `.column` (`--surface`, `--radius-lg`, header weight up, `.column-count` as a pill), `.column-body.drag-over` (outline `2px solid var(--level-ring)`), `.board-select-row` (wrap, `gap: var(--space-3)`, align items center), `.board-subtitle` (`--text-faint`, 13px), `.error-message` (`--danger` text, tinted background, `--radius-sm`, padding). Keep the existing font-family and focus-outline rules.

- [ ] **Step 4: Manual check — both themes**

Run dev. Toggle System/Light/Dark. Verify HUD, board, columns, cards, add-task form, and drag all look intentional and readable in every mode; priority rail color matches the label; XP pill legible.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(frontend): restyle HUD, board, columns, and task cards on the token system"
```

---

### Task 25: Style the new surfaces (SprintBar, settings, invite)

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Produces: styles for every class introduced in Phases 1–2 with no prior rule: `.sprint-bar`, `.sprint-switcher`, `.sprint-chip` (+ `.selected`, `.is-active`), `.sprint-progress`, `.sprint-progress-meta`, `.sprint-goal`, `.sprint-progress-track`, `.sprint-progress-fill`, `.settings-page`, `.settings-topbar`, `.settings-layout`, `.settings-nav`, `.settings-nav-item` (+ `.active`), `.settings-content`, `.settings-section`, `.settings-list`, `.settings-list-item`, `.settings-form`, `.invite-url-row`, `.member-role`, `.team-card`, `.team-card-header`, `.team-member`, `.sprint-card`, `.sprint-actions`, `.invite-accept`, `.dependency-list`, `.dependency-option`.

- [ ] **Step 1: SprintBar**

```css
.sprint-bar { margin: var(--space-3) 0; }
.sprint-switcher { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.sprint-chip {
  background: var(--surface);
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 999px;
  padding: var(--space-1) var(--space-3);
  font-size: 13px;
}
.sprint-chip.selected {
  background: var(--surface-raised);
  color: var(--text);
  border-color: var(--border-strong);
  font-weight: 600;
}
.sprint-chip.is-active { border-color: var(--teal); color: var(--teal); }
.sprint-progress { margin-top: var(--space-3); }
.sprint-progress-meta {
  display: flex; gap: var(--space-4); font-size: 12px;
  color: var(--text-muted); margin-bottom: var(--space-2);
}
.sprint-goal { color: var(--text); font-style: italic; }
.sprint-progress-track {
  height: 8px; background: var(--xp-track);
  border-radius: 999px; overflow: hidden;
}
.sprint-progress-fill { height: 100%; background: var(--xp-fill); }
```

- [ ] **Step 2: Settings two-pane**

```css
.settings-page { max-width: 960px; }
.settings-topbar { display: flex; align-items: center; gap: var(--space-4); margin-bottom: var(--space-5); }
.settings-layout { display: grid; grid-template-columns: 180px 1fr; gap: var(--space-6); }
.settings-nav { display: flex; flex-direction: column; gap: var(--space-1); }
.settings-nav-item {
  text-align: left; background: transparent; border: none;
  color: var(--text-muted); padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm); font-size: 14px;
}
.settings-nav-item.active { background: var(--surface-raised); color: var(--text); font-weight: 600; }
.settings-content { min-width: 0; }
.settings-section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-5); }
.settings-section h3 { font-family: var(--font-display); margin-top: 0; }
.settings-list { display: flex; flex-direction: column; gap: var(--space-2); margin: var(--space-4) 0; }
.settings-list-item {
  display: flex; align-items: center; gap: var(--space-3);
  background: var(--surface-raised); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: var(--space-3);
}
.settings-list-item small { color: var(--text-faint); display: block; }
.settings-list-item strong { display: block; }
.settings-form { display: flex; flex-wrap: wrap; gap: var(--space-2); align-items: center; margin-top: var(--space-3); }
.member-role { margin-left: auto; color: var(--text-faint); font-size: 12px; text-transform: uppercase; }
.invite-url-row { display: flex; gap: var(--space-2); margin-top: var(--space-3); }
.invite-url-row input { flex: 1; }
```

- [ ] **Step 3: Team & sprint cards, invite-accept, dependency pickers**

```css
.team-card, .sprint-card {
  background: var(--surface-raised); border: 1px solid var(--border);
  border-radius: var(--radius-md); padding: var(--space-4); margin-bottom: var(--space-3);
}
.team-card-header { display: flex; justify-content: space-between; align-items: flex-start; }
.team-member { display: flex; justify-content: space-between; align-items: center; padding: var(--space-1) 0; }
.sprint-card { display: flex; justify-content: space-between; align-items: flex-start; }
.sprint-actions { display: flex; gap: var(--space-2); }
.invite-accept { max-width: 480px; }
.dependency-list, .dependency-options { display: flex; flex-direction: column; gap: var(--space-1); margin: var(--space-2) 0; }
.dependency-option { display: flex; align-items: center; gap: var(--space-2); font-size: 13px; color: var(--text-muted); }
```

- [ ] **Step 4: Responsive fallback for the settings grid**

```css
@media (max-width: 720px) {
  .settings-layout { grid-template-columns: 1fr; }
  .settings-nav { flex-direction: row; flex-wrap: wrap; }
}
```

- [ ] **Step 5: Full manual sweep**

Run dev. Walk every screen (board, sprint switcher with a selected sprint, settings → all four tabs, invite-accept page) in System / Light / Dark. Confirm: no unstyled white-on-white or black-on-black, no element without padding/border where the others have it, horizontal scroll never appears on the page body.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(frontend): style SprintBar, settings two-pane, invite page, dependency pickers"
```

---

### Task 26: Motion polish + reduced-motion

**Files:**
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Produces: subtle transitions on `.task-card` (`box-shadow`, `transform` on hover), `.sprint-progress-fill` (`width` transition), toast entrance for `.toast`/`LevelUpToast`/`AchievementToast` classes (check `Toasts.jsx` for the exact class names and target those), all wrapped so a `@media (prefers-reduced-motion: reduce)` block disables them.

- [ ] **Step 1: Read the toast class names**

Run: `cd frontend && grep -n "className" src/components/Toasts.jsx`
Use whatever classes it renders (e.g. `.level-up-toast`, `.achievement-toast`) as the animation targets below.

- [ ] **Step 2: Add transitions + keyframes**

```css
.task-card { transition: box-shadow 120ms ease, transform 120ms ease; }
.task-card:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }
.sprint-progress-fill { transition: width 240ms ease; }

@keyframes toast-in {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* replace .level-up-toast / .achievement-toast with the real classes from Step 1 */
.level-up-toast, .achievement-toast { animation: toast-in 200ms ease both; }

@media (prefers-reduced-motion: reduce) {
  .task-card, .task-card:hover { transition: none; transform: none; }
  .sprint-progress-fill { transition: none; }
  .level-up-toast, .achievement-toast { animation: none; }
}
```

- [ ] **Step 3: Manual check**

Run dev. Hover cards (subtle lift), watch the sprint bar animate when a task moves to Done, trigger a level-up. Then enable "Reduce motion" in OS settings and confirm the animations stop.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(frontend): motion polish gated by prefers-reduced-motion"
```

---

### Task 27: Update the README + final checkpoint

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite the "Where to go from here" section**

Replace the multi-user boards / sprints bullets with a short "Features" description: board invitations via copy-link, teams, sprint-aware board with progress, light/dark themes. Keep the "Real hosting" and "Team gamification" bullets as remaining ideas. Add a one-line "Run the backend tests: `cd backend && npm test`".

- [ ] **Step 2: Full regression pass**

- `cd backend && npm test` → all PASS.
- `cd frontend && npm run build` → succeeds.
- Manual: repeat the Phase 2 Task 21 end-to-end pass, now in all three theme modes.

- [ ] **Step 3: Commit + tag**

```bash
git add README.md
git commit -m "docs: update README for teams/sprints/invites + theming"
git tag phase-3-redesign
```

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/teams-sprints-invites-redesign
gh pr create --title "Teams, sprints, invitations + visual redesign" --body "Implements docs/superpowers/specs/2026-09-01-teams-sprints-invites-redesign-design.md. Three phases: reconcile (backend fixes + tests), restructure (routing, settings view, sprint-aware board), redesign (token system + light/dark)."
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| §1 defect 1 (`inviteToBoard`) | 10, 11 |
| §1 defect 2 (`expires_at`) | 8 |
| §1 defect 3 (sprint PATCH/DELETE missing) | 5 |
| §1 defect 4 (sprint `created_at` ordering) | 3, 6 |
| §1 defect 5 (`createSprint` signature) | 10, 17 |
| §1 defect 6/7 (team description) | 3, 7, 10, 17 |
| §1 defect 8/9 (dependency shape) | 9, 20 |
| §1 defect 10 (team guards) | 7 |
| §1 defect 11 (unstyled) | 23, 24, 25 |
| §4.1 columns | 3 |
| §4.3 dependency convention | 9 |
| §5.1 sprint endpoints + single-active | 5 |
| §5.2 team guards | 7 |
| §5.3 boards fixes | 8, 9 |
| §5.4 api.js | 10 |
| §6.1 routing | 13 |
| §6.2 component moves (delete inline panel, keep/refactor BoardSettings, new AppShell/BoardPage/InviteAccept/NotFound) | 11, 13, 14, 16, 17, 18, 19 |
| §6.3 gamification wiring moves to AppShell | 14 |
| §7 sprint-aware board (switcher, progress strip, task-form default) | 15, 16, 20 |
| §8.1 token scale | 23 |
| §8.2 light/dark blocks | 23 |
| §8.3 persisted toggle | 22 |
| §8.4 visual direction (cards, HUD, columns, settings, buttons) | 24, 25, 26 |
| §8.5 coverage sweep | 25 (Step 5), 27 (Step 2) |
| §9.1 backend tests (sprints/invites/teams/tasks) | 4, 5, 7, 8, 9 |
| §9.2 manual checklist | 21, 27 |
| §10 branch, 3 commits/phase, README, dist out of scope | phase tags in 12/21/27; 27; constraint noted |
| §11 risks (FK enforcement for SET NULL) | 5 (Step 4) |

No uncovered spec requirements.

**2. Placeholder scan** — no "TBD"/"handle edge cases"/"similar to Task N". Temporary stubs in Tasks 16/18/19 are explicitly created and explicitly removed within the same phase, with the reason stated.

**3. Type consistency**

- `dependencyIds` (write) / `task.dependencies: [{id,title}]` (read) — consistent across Tasks 9, 10, 20 and the constraints block.
- `api.createSprint(boardId, name, startsAt, endsAt, goal)` — defined in Task 10, called that way in Task 17 Step 4.
- `api.createTeam(boardId, name, description)` — Task 10 + Task 17 Step 3.
- `api.updateSprint(id, patch)` / `api.deleteSprint(id)` — Task 10; consumed in Task 17 Step 4.
- `onBoardLoaded(board)` prop — introduced Task 16, called in `Board.refresh()`, consumed by `BoardPage`.
- `sprintFilter` values `"all" | "backlog" | <sprintId>` — consistent in Tasks 15, 16, 20.
- Outlet context keys `{ user, boards, activeBoardId, reloadBoards, onGamificationEvent }` — produced in Task 14, consumed in Tasks 16 (`onGamificationEvent`, `user`), 18 (`boards`, `reloadBoards`).
- `theme.js` exports `getStoredTheme`, `applyTheme`, `resolveInitial`, `nextTheme`, `themeLabel` — defined Task 22, used in `main.jsx` + `AppShell`.
- Backend test helper exports `makeApp`, `registerUser`, `authHeader` — defined Task 4, used in Tasks 5, 7, 8, 9.

No mismatches found.
