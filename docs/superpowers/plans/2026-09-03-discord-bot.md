# Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Discord bot that answers structured slash-command questions about a team's Questboard boards, scoped per Discord user to the Questboard account they link.

**Architecture:** A standalone Node service in `discord/` (its own package, its own `systemd` unit, its own SQLite file) talks to the existing Questboard REST API over `http://127.0.0.1:4000`, authenticating as the linked user with a per-user opaque `qbit_` integration token. The backend gains two tables, one authed route file, one bot-only redeem endpoint, an `authMiddleware` branch for opaque tokens, and a read-only guard for them. The frontend gains one account-settings page with a "Connect Discord" panel.

**Tech Stack:** Node ESM, `discord.js` 14 (gateway, non-privileged `Guilds` intent), `better-sqlite3` 11, `express` 4, `node:test` + `supertest`, React 18 + Vite + `react-router-dom` 6.

**Spec:** `docs/superpowers/specs/2026-09-03-discord-bot-design.md`

## Global Constraints

- **No LLM in v1.** Structured slash commands only.
- **Read-only in v1.** Integration tokens are rejected on any non-GET request to the resource routers.
- **ESM everywhere.** All packages use `"type": "module"`; use `import`/`export`, never `require`.
- **Opaque token format:** `qbit_` + `nanoid(32)`.
- **Link code format:** 6 ASCII digits, zero-padded (`String(n).padStart(6, "0")`), single-use, 10-minute TTL.
- **Bot-only endpoint auth:** header `X-Bot-Secret` must equal `process.env.BOT_REDEEM_SECRET`, compared with `crypto.timingSafeEqual`.
- **Server env dir is `/etc/gamified-kanban/`** (matches the existing `api.env`); the bot env file is `/etc/gamified-kanban/bot.env`. (The spec's `/etc/questboard/` is superseded by this to match the deployed convention.)
- **Deployed API base for the bot:** `http://127.0.0.1:4000` (no `/api` suffix; paths in `api.js` include `/api`).
- **No attribution lines** in commit messages.
- **Backend tests:** `cd backend && npm test`. **Bot tests:** `cd discord && npm test`. Both must stay green.
- `makeApp()` in `backend/test/helpers.js` is **once per test process** — call it once at file scope and share `app`.

---

## File Structure

### Backend (modified)

- `backend/db.js` — add two `CREATE TABLE IF NOT EXISTS` blocks (`integration_tokens`, `discord_link_codes`) inside the existing `db.exec(\`...\`)` schema string.
- `backend/routes/auth.js` — `authMiddleware` gains an opaque-token branch; sets `req.authKind`.
- `backend/routes/integrations.js` — **new.** Default export = authed router (`/discord/link-code`, `/discord/status`, `/discord/link`). Named export `botRouter` = unauthenticated router with `POST /discord/redeem`.
- `backend/app.js` — import and mount the two routers; add `integrationReadOnly` middleware to the resource-router mounts.
- `backend/lib/integration-auth.js` — **new.** `verifyBotSecret(req)` helper (timing-safe).
- `backend/test/integrations.test.js` — **new.** Full flow + guard tests.

### Bot (new package `discord/`)

- `discord/package.json` — deps: `discord.js@14.27.0`, `better-sqlite3@^11.3.0`, `nanoid@^5.0.7`. scripts: `test`, `start`, `register`.
- `discord/src/store.js` — bot-local SQLite. `channel_boards`, `discord_links` CRUD. One responsibility: persistence.
- `discord/src/api.js` — REST wrapper. `getBoards`, `getBoard`, `redeemCode`. Typed errors. One responsibility: talking to Questboard.
- `discord/src/format.js` — pure `board JSON -> embed object` functions. One responsibility: presentation.
- `discord/src/commands/link.js` — `/questboard` subcommands (`link`, `unlink`, `use`, `whichboard`).
- `discord/src/commands/tasks.js` — `/tasks`.
- `discord/src/commands/mine.js` — `/mine`.
- `discord/src/commands/standup.js` — `/standup`.
- `discord/src/commands/sprint.js` — `/sprint`.
- `discord/src/commands/index.js` — array of all command modules; `byName` map.
- `discord/src/context.js` — `buildContext(interaction, { store, api })` -> the `ctx` object command modules consume (keeps `discord.js` out of the command/test code).
- `discord/src/index.js` — client bootstrap, `interactionCreate` router, graceful shutdown.
- `discord/src/register.js` — one-shot slash-command registration (guild-scoped if `DISCORD_DEV_GUILD_ID`, else global).
- `discord/test/*.test.js` — one per unit.
- `discord/test/helpers.js` — `tempStore()`, `stubApiServer()`, `fakeCtx()`.

### Frontend (modified)

- `frontend/src/api.js` — add `discordStatus`, `discordLinkCode`, `discordUnlink`.
- `frontend/src/pages/AccountSettingsPage.jsx` — **new.** Wrapper page.
- `frontend/src/components/settings/DiscordIntegration.jsx` — **new.** The panel.
- `frontend/src/App.jsx` — add `<Route path="account/settings" ...>`.
- `frontend/src/components/AppShell.jsx` — add an "Account" link in `board-select-row`.

### Deploy (new / modified)

- `deploy/oracle/questboard-bot.service` — **new.** systemd unit.
- `deploy/oracle/bot.env.example` — **new.**
- `deploy/oracle/api.env.example` — add `BOT_REDEEM_SECRET`.
- `deploy/oracle/backup-db.sh` — also back up the bot DB.
- `deploy/oracle/SETUP.md` — Discord app setup runbook + updated deploy steps.
- `.github/workflows/test.yml` — **new.** Run backend + bot suites on push/PR.

---

## Task 1: Backend schema — integration tables

**Files:**
- Modify: `backend/db.js` (inside the `db.exec(\`CREATE TABLE ...\`)` block near the end of the schema string, after `user_achievements`)
- Test: `backend/test/integrations.test.js` (create)

**Interfaces:**
- Produces: tables `integration_tokens(token PK, user_id, kind, created_at, last_used_at)` and `discord_link_codes(code PK, user_id, expires_at)`. Both cascade-delete with `users`.

- [ ] **Step 1: Write the failing test**

Create `backend/test/integrations.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { makeApp, registerUser } from "./helpers.js";

process.env.BOT_REDEEM_SECRET = "test-bot-secret";
const { app, db, cleanup } = await makeApp();
test.after(cleanup);

test("integration tables exist with the expected columns", () => {
  const tokCols = db.prepare("PRAGMA table_info(integration_tokens)").all().map((c) => c.name);
  assert.deepEqual(tokCols.sort(), ["created_at", "kind", "last_used_at", "token", "user_id"].sort());

  const codeCols = db.prepare("PRAGMA table_info(discord_link_codes)").all().map((c) => c.name);
  assert.deepEqual(codeCols.sort(), ["code", "expires_at", "user_id"].sort());
});

test("integration_tokens cascade-deletes with its user", async () => {
  const { user } = await registerUser(app, { email: "cascade@x.com" });
  db.prepare(
    "INSERT INTO integration_tokens (token, user_id, kind) VALUES (?, ?, 'discord')"
  ).run("qbit_cascadecheck", user.id);
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id);
  const row = db.prepare("SELECT 1 FROM integration_tokens WHERE token = ?").get("qbit_cascadecheck");
  assert.equal(row, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && node --test test/integrations.test.js`
Expected: FAIL — `PRAGMA table_info(integration_tokens)` returns `[]`, so the `deepEqual` fails (and/or the INSERT throws "no such table").

- [ ] **Step 3: Add the tables**

In `backend/db.js`, inside the big `db.exec(\`...\`)` schema string, immediately after the `CREATE TABLE IF NOT EXISTS user_achievements (...)` block and before the closing `` \`); ``:

```sql
CREATE TABLE IF NOT EXISTS integration_tokens (
  token        TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discord_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && node --test test/integrations.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all files pass (no regressions).

- [ ] **Step 6: Commit**

```bash
git add backend/db.js backend/test/integrations.test.js
git commit -m "feat(api): integration_tokens and discord_link_codes tables"
```

---

## Task 2: Backend auth — opaque tokens + read-only guard

**Files:**
- Modify: `backend/routes/auth.js` (`authMiddleware`)
- Create: `backend/lib/integration-auth.js`
- Modify: `backend/app.js` (add `integrationReadOnly`, apply to resource mounts)
- Test: `backend/test/integrations.test.js` (append)

**Interfaces:**
- Consumes: `integration_tokens` table (Task 1).
- Produces:
  - `authMiddleware` now also accepts `Authorization: Bearer qbit_...`; on a hit it sets `req.userId` and `req.authKind = "integration"` and bumps `last_used_at`. JWT path sets `req.authKind = "user"`.
  - `integrationReadOnly(req, res, next)` — 403 `{ error: "This token is read-only" }` when `req.authKind === "integration" && req.method !== "GET"`.
  - `backend/lib/integration-auth.js` exports `verifyBotSecret(req) -> boolean` (timing-safe compare of `req.header("X-Bot-Secret")` against `process.env.BOT_REDEEM_SECRET`; `false` if either is missing).

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/integrations.test.js`:

```js
import request from "supertest";

test("a qbit_ token authorizes GET but not writes", async () => {
  const { token: jwt, user } = await registerUser(app, { email: "optoken@x.com" });
  const board = (
    await request(app).post("/api/boards").set({ Authorization: `Bearer ${jwt}` }).send({ name: "OpTok" })
  ).body;

  const qbit = "qbit_" + "a".repeat(32);
  db.prepare("INSERT INTO integration_tokens (token, user_id, kind) VALUES (?, ?, 'discord')").run(qbit, user.id);
  const authq = { Authorization: `Bearer ${qbit}` };

  const getRes = await request(app).get(`/api/boards/${board.id}`).set(authq);
  assert.equal(getRes.status, 200);
  assert.equal(getRes.body.id, board.id);

  const writeRes = await request(app).post("/api/tasks").set(authq).send({ boardId: board.id, title: "nope" });
  assert.equal(writeRes.status, 403);
  assert.match(writeRes.body.error, /read-only/i);
});

test("an unknown qbit_ token is 401", async () => {
  const res = await request(app)
    .get("/api/boards")
    .set({ Authorization: "Bearer qbit_unknownunknownunknownunknownun" });
  assert.equal(res.status, 401);
});

test("last_used_at is stamped on use", async () => {
  const { user } = await registerUser(app, { email: "lastused@x.com" });
  const qbit = "qbit_" + "b".repeat(32);
  db.prepare("INSERT INTO integration_tokens (token, user_id, kind) VALUES (?, ?, 'discord')").run(qbit, user.id);
  await request(app).get("/api/boards").set({ Authorization: `Bearer ${qbit}` });
  const row = db.prepare("SELECT last_used_at FROM integration_tokens WHERE token = ?").get(qbit);
  assert.ok(row.last_used_at, "last_used_at should be set");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test test/integrations.test.js`
Expected: FAIL — the `qbit_` token currently falls into `jwt.verify` and 401s, so "authorizes GET" fails at `assert.equal(getRes.status, 200)`.

- [ ] **Step 3: Create the bot-secret helper**

Create `backend/lib/integration-auth.js`:

```js
import crypto from "node:crypto";

/**
 * True iff the request carries a valid X-Bot-Secret header matching
 * process.env.BOT_REDEEM_SECRET. Timing-safe; false if either side is absent
 * or lengths differ.
 */
export function verifyBotSecret(req) {
  const provided = req.header("X-Bot-Secret") || "";
  const expected = process.env.BOT_REDEEM_SECRET || "";
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Extend `authMiddleware`**

In `backend/routes/auth.js`, replace the body of `authMiddleware` with:

```js
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  const raw = header.slice(7);

  if (raw.startsWith("qbit_")) {
    const row = db
      .prepare("SELECT user_id FROM integration_tokens WHERE token = ?")
      .get(raw);
    if (!row) return res.status(401).json({ error: "Invalid or expired token" });
    db.prepare("UPDATE integration_tokens SET last_used_at = datetime('now') WHERE token = ?").run(raw);
    req.userId = row.user_id;
    req.authKind = "integration";
    return next();
  }

  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    req.userId = payload.userId;
    req.authKind = "user";
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
```

(`db` is already imported at the top of `auth.js`.)

- [ ] **Step 5: Add and wire the read-only guard**

In `backend/app.js`, after the imports add:

```js
function integrationReadOnly(req, res, next) {
  if (req.authKind === "integration" && req.method !== "GET") {
    return res.status(403).json({ error: "This token is read-only" });
  }
  next();
}
```

Then change each resource mount from `app.use("/api/boards", authMiddleware, boardRoutes);` to include the guard:

```js
app.use("/api/boards", authMiddleware, integrationReadOnly, boardRoutes);
app.use("/api/tasks", authMiddleware, integrationReadOnly, taskRoutes);
app.use("/api/teams", authMiddleware, integrationReadOnly, teamRoutes);
app.use("/api/users", authMiddleware, integrationReadOnly, userRoutes);
app.use("/api/sprints", authMiddleware, integrationReadOnly, sprintRoutes);
app.use("/api/subtasks", authMiddleware, integrationReadOnly, subtaskRoutes);
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd backend && node --test test/integrations.test.js`
Expected: PASS (all tests so far).

- [ ] **Step 7: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all pass — every existing test uses JWTs, which now also set `req.authKind = "user"`; the guard is a no-op for them.

- [ ] **Step 8: Commit**

```bash
git add backend/routes/auth.js backend/lib/integration-auth.js backend/app.js backend/test/integrations.test.js
git commit -m "feat(api): accept read-only qbit_ integration tokens in authMiddleware"
```

---

## Task 3: Backend — authed integration endpoints

**Files:**
- Create: `backend/routes/integrations.js`
- Modify: `backend/app.js` (mount the authed router)
- Test: `backend/test/integrations.test.js` (append)

**Interfaces:**
- Consumes: `discord_link_codes`, `integration_tokens` (Task 1); `authMiddleware` (Task 2).
- Produces (all behind `authMiddleware`, mounted at `/api/integrations`):
  - `POST /discord/link-code` -> `200 { code: "482913", expiresAt: "<ISO 8601>" }`. Creates a single-use code for `req.userId`, TTL 10 min. Sweeps expired rows first. Retries on the astronomically-unlikely PK collision.
  - `GET /discord/status` -> `200 { linked: boolean }` (`linked` = user has >=1 `kind='discord'` token).
  - `DELETE /discord/link` -> `200 { ok: true }`. Deletes all `kind='discord'` tokens for `req.userId`.
- Default export: the authed `Router`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/integrations.test.js`:

```js
test("link-code + status + unlink lifecycle", async () => {
  const { token: jwt, user } = await registerUser(app, { email: "lifecycle@x.com" });
  const auth = { Authorization: `Bearer ${jwt}` };

  let res = await request(app).get("/api/integrations/discord/status").set(auth);
  assert.deepEqual(res.body, { linked: false });

  res = await request(app).post("/api/integrations/discord/link-code").set(auth);
  assert.equal(res.status, 200);
  assert.match(res.body.code, /^\d{6}$/);
  assert.ok(Date.parse(res.body.expiresAt) > Date.now());

  const codeRow = db.prepare("SELECT * FROM discord_link_codes WHERE code = ?").get(res.body.code);
  assert.equal(codeRow.user_id, user.id);

  // simulate a completed redeem
  db.prepare("INSERT INTO integration_tokens (token, user_id, kind) VALUES (?, ?, 'discord')").run("qbit_" + "c".repeat(32), user.id);
  res = await request(app).get("/api/integrations/discord/status").set(auth);
  assert.deepEqual(res.body, { linked: true });

  res = await request(app).delete("/api/integrations/discord/link").set(auth);
  assert.deepEqual(res.body, { ok: true });
  res = await request(app).get("/api/integrations/discord/status").set(auth);
  assert.deepEqual(res.body, { linked: false });
});

test("link-code requires auth", async () => {
  const res = await request(app).post("/api/integrations/discord/link-code");
  assert.equal(res.status, 401);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test test/integrations.test.js`
Expected: FAIL — `404` on `/api/integrations/discord/status` (route not mounted).

- [ ] **Step 3: Create the route file**

Create `backend/routes/integrations.js`:

```js
import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const CODE_TTL_MINUTES = 10;

const router = Router(); // mounted behind authMiddleware at /api/integrations

function sweepExpiredCodes() {
  db.prepare("DELETE FROM discord_link_codes WHERE expires_at < datetime('now')").run();
}

function makeCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

router.post("/discord/link-code", (req, res) => {
  sweepExpiredCodes();
  const insert = db.prepare(
    "INSERT INTO discord_link_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  );
  const ttl = `+${CODE_TTL_MINUTES} minutes`;
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = makeCode();
    try {
      insert.run(code, req.userId, ttl);
      break;
    } catch (err) {
      if (attempt === 4) throw err; // give up after 5 collisions
    }
  }
  const row = db.prepare("SELECT expires_at FROM discord_link_codes WHERE code = ?").get(code);
  res.json({ code, expiresAt: new Date(row.expires_at + "Z").toISOString() });
});

router.get("/discord/status", (req, res) => {
  const row = db
    .prepare("SELECT 1 FROM integration_tokens WHERE user_id = ? AND kind = 'discord' LIMIT 1")
    .get(req.userId);
  res.json({ linked: Boolean(row) });
});

router.delete("/discord/link", (req, res) => {
  db.prepare("DELETE FROM integration_tokens WHERE user_id = ? AND kind = 'discord'").run(req.userId);
  res.json({ ok: true });
});

export default router;
```

Note: SQLite `datetime('now')` returns `"YYYY-MM-DD HH:MM:SS"` in UTC without a zone marker; `new Date(row.expires_at + "Z")` parses it as UTC.

- [ ] **Step 4: Mount it**

In `backend/app.js`:

```js
import integrationRoutes from "./routes/integrations.js";
// ...with the other app.use lines:
app.use("/api/integrations", authMiddleware, integrationReadOnly, integrationRoutes);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && node --test test/integrations.test.js`
Expected: PASS.

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/integrations.js backend/app.js backend/test/integrations.test.js
git commit -m "feat(api): authed Discord link-code / status / unlink endpoints"
```

---

## Task 4: Backend — bot redeem endpoint

**Files:**
- Modify: `backend/routes/integrations.js` (add `botRouter` named export)
- Modify: `backend/app.js` (mount `botRouter` at `/api/bot`)
- Test: `backend/test/integrations.test.js` (append)

**Interfaces:**
- Consumes: `verifyBotSecret` (`backend/lib/integration-auth.js`, Task 2); `discord_link_codes`, `integration_tokens` (Task 1).
- Produces: named export `botRouter` (a `Router`, **no** `authMiddleware`), mounted at `/api/bot`:
  - `POST /discord/redeem`
    - header `X-Bot-Secret` invalid/missing -> `401 { error: "unauthorized" }`
    - body `{ code, discordUserId }`; `code` missing or expired or unknown -> `400 { error: "invalid_or_expired_code" }`
    - success: deletes the code, inserts `integration_tokens` row (`qbit_` + `nanoid(32)`, `kind='discord'`), returns `200 { token, appUserId, displayName }`. `discordUserId` is read for logging only; not persisted.

- [ ] **Step 1: Write the failing tests**

Append to `backend/test/integrations.test.js`:

```js
const BOT = { "X-Bot-Secret": "test-bot-secret" };

test("redeem: happy path issues a working token", async () => {
  const { token: jwt, user } = await registerUser(app, { email: "redeem@x.com" });
  const board = (
    await request(app).post("/api/boards").set({ Authorization: `Bearer ${jwt}` }).send({ name: "RedeemB" })
  ).body;

  const code = (
    await request(app).post("/api/integrations/discord/link-code").set({ Authorization: `Bearer ${jwt}` })
  ).body.code;

  const res = await request(app).post("/api/bot/discord/redeem").set(BOT).send({ code, discordUserId: "123" });
  assert.equal(res.status, 200);
  assert.match(res.body.token, /^qbit_.{32}$/);
  assert.equal(res.body.appUserId, user.id);
  assert.equal(res.body.displayName, "redeem");

  // token works
  const boardRes = await request(app).get(`/api/boards/${board.id}`).set({ Authorization: `Bearer ${res.body.token}` });
  assert.equal(boardRes.status, 200);

  // code is single-use
  const again = await request(app).post("/api/bot/discord/redeem").set(BOT).send({ code, discordUserId: "123" });
  assert.equal(again.status, 400);
});

test("redeem: wrong bot secret is 401", async () => {
  const res = await request(app)
    .post("/api/bot/discord/redeem")
    .set({ "X-Bot-Secret": "nope" })
    .send({ code: "000000", discordUserId: "1" });
  assert.equal(res.status, 401);
});

test("redeem: expired code is 400", async () => {
  const { token: jwt, user } = await registerUser(app, { email: "expired@x.com" });
  await request(app).post("/api/integrations/discord/link-code").set({ Authorization: `Bearer ${jwt}` });
  // force-expire every code for this user
  db.prepare("UPDATE discord_link_codes SET expires_at = datetime('now', '-1 minute') WHERE user_id = ?").run(user.id);
  const stale = db.prepare("SELECT code FROM discord_link_codes WHERE user_id = ?").get(user.id).code;
  const res = await request(app).post("/api/bot/discord/redeem").set(BOT).send({ code: stale, discordUserId: "1" });
  assert.equal(res.status, 400);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && node --test test/integrations.test.js`
Expected: FAIL — `404` on `/api/bot/discord/redeem`.

- [ ] **Step 3: Add `botRouter`**

In `backend/routes/integrations.js`, add near the top:

```js
import { verifyBotSecret } from "../lib/integration-auth.js";
```

and before `export default router;`:

```js
export const botRouter = Router(); // NO authMiddleware — bot-only, mounted at /api/bot

botRouter.post("/discord/redeem", (req, res) => {
  if (!verifyBotSecret(req)) return res.status(401).json({ error: "unauthorized" });

  const { code, discordUserId } = req.body || {};
  if (!code) return res.status(400).json({ error: "invalid_or_expired_code" });

  const row = db
    .prepare("SELECT user_id FROM discord_link_codes WHERE code = ? AND expires_at >= datetime('now')")
    .get(String(code));
  if (!row) return res.status(400).json({ error: "invalid_or_expired_code" });

  const user = db.prepare("SELECT id, display_name FROM users WHERE id = ?").get(row.user_id);
  if (!user) return res.status(400).json({ error: "invalid_or_expired_code" });

  const token = "qbit_" + nanoid(32);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM discord_link_codes WHERE code = ?").run(String(code));
    db.prepare("INSERT INTO integration_tokens (token, user_id, kind) VALUES (?, ?, 'discord')").run(token, user.id);
  });
  tx();

  console.log(`[integrations] discord link: user=${user.id} discordUserId=${discordUserId ?? "?"}`);
  res.json({ token, appUserId: user.id, displayName: user.display_name });
});
```

- [ ] **Step 4: Mount it**

In `backend/app.js`:

```js
import integrationRoutes, { botRouter } from "./routes/integrations.js";
// mount BEFORE or after the others — the /api/bot prefix does not overlap:
app.use("/api/bot", botRouter);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && node --test test/integrations.test.js`
Expected: PASS (all).

- [ ] **Step 6: Run the whole backend suite**

Run: `cd backend && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add backend/routes/integrations.js backend/app.js backend/test/integrations.test.js
git commit -m "feat(api): bot-only POST /api/bot/discord/redeem"
```

---

## Task 5: Bot package init + local store

**Files:**
- Create: `discord/package.json`
- Create: `discord/.gitignore`
- Create: `discord/src/store.js`
- Create: `discord/test/helpers.js`
- Create: `discord/test/store.test.js`

**Interfaces:**
- Produces `discord/src/store.js` default export `createStore(dbPath) -> store` where `store` has:
  - `getChannelBoard(channelId) -> string | null`
  - `setChannelBoard(channelId, boardId, setByDiscordId) -> void`
  - `getLink(discordUserId) -> { discordUserId, appUserId, integrationToken } | null`
  - `upsertLink(discordUserId, appUserId, integrationToken) -> void`
  - `deleteLink(discordUserId) -> void`
  - `close() -> void`
- Produces `discord/test/helpers.js` export `tempStore()` -> `{ store, path, cleanup }`.

- [ ] **Step 1: Create the package**

Create `discord/package.json`:

```json
{
  "name": "questboard-discord-bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node src/index.js",
    "register": "node src/register.js",
    "test": "node --test --test-concurrency=1"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "discord.js": "14.27.0",
    "nanoid": "^5.0.7"
  }
}
```

Create `discord/.gitignore`:

```
node_modules/
*.sqlite
*.sqlite-shm
*.sqlite-wal
.env
.env.*
```

Run: `cd discord && npm install`
Expected: installs cleanly (native `better-sqlite3` build; if it fails, `apt-get install -y build-essential python3` on Linux).

- [ ] **Step 2: Write the failing test**

Create `discord/test/helpers.js`:

```js
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import createStore from "../src/store.js";

export function tempStore() {
  const p = path.join(os.tmpdir(), `qb-bot-test-${randomUUID()}.sqlite`);
  const store = createStore(p);
  return {
    store,
    path: p,
    cleanup() {
      try { store.close(); } catch {}
      for (const s of ["", "-wal", "-shm"]) fs.rmSync(p + s, { force: true });
    },
  };
}
```

Create `discord/test/store.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { tempStore } from "./helpers.js";

test("channel board default: set / get / overwrite", () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  assert.equal(store.getChannelBoard("chan1"), null);
  store.setChannelBoard("chan1", "board_A", "disc_1");
  assert.equal(store.getChannelBoard("chan1"), "board_A");
  store.setChannelBoard("chan1", "board_B", "disc_2");
  assert.equal(store.getChannelBoard("chan1"), "board_B");
});

test("discord link: upsert / get / delete", () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  assert.equal(store.getLink("d1"), null);
  store.upsertLink("d1", "user_1", "qbit_aaa");
  assert.deepEqual(store.getLink("d1"), {
    discordUserId: "d1", appUserId: "user_1", integrationToken: "qbit_aaa",
  });
  store.upsertLink("d1", "user_1", "qbit_bbb"); // token rotated
  assert.equal(store.getLink("d1").integrationToken, "qbit_bbb");
  store.deleteLink("d1");
  assert.equal(store.getLink("d1"), null);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd discord && node --test test/store.test.js`
Expected: FAIL — `Cannot find module '../src/store.js'`.

- [ ] **Step 4: Implement the store**

Create `discord/src/store.js`:

```js
import Database from "better-sqlite3";

export default function createStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_boards (
      channel_id        TEXT PRIMARY KEY,
      board_id          TEXT NOT NULL,
      set_by_discord_id TEXT NOT NULL,
      set_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS discord_links (
      discord_user_id   TEXT PRIMARY KEY,
      app_user_id       TEXT NOT NULL,
      integration_token TEXT NOT NULL,
      linked_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return {
    getChannelBoard(channelId) {
      const row = db.prepare("SELECT board_id FROM channel_boards WHERE channel_id = ?").get(channelId);
      return row ? row.board_id : null;
    },
    setChannelBoard(channelId, boardId, setByDiscordId) {
      db.prepare(`
        INSERT INTO channel_boards (channel_id, board_id, set_by_discord_id, set_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(channel_id) DO UPDATE SET
          board_id = excluded.board_id,
          set_by_discord_id = excluded.set_by_discord_id,
          set_at = excluded.set_at
      `).run(channelId, boardId, setByDiscordId);
    },
    getLink(discordUserId) {
      const row = db.prepare("SELECT * FROM discord_links WHERE discord_user_id = ?").get(discordUserId);
      return row
        ? { discordUserId: row.discord_user_id, appUserId: row.app_user_id, integrationToken: row.integration_token }
        : null;
    },
    upsertLink(discordUserId, appUserId, integrationToken) {
      db.prepare(`
        INSERT INTO discord_links (discord_user_id, app_user_id, integration_token, linked_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(discord_user_id) DO UPDATE SET
          app_user_id = excluded.app_user_id,
          integration_token = excluded.integration_token,
          linked_at = excluded.linked_at
      `).run(discordUserId, appUserId, integrationToken);
    },
    deleteLink(discordUserId) {
      db.prepare("DELETE FROM discord_links WHERE discord_user_id = ?").run(discordUserId);
    },
    close() {
      db.close();
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd discord && node --test test/store.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add discord/package.json discord/package-lock.json discord/.gitignore discord/src/store.js discord/test/helpers.js discord/test/store.test.js
git commit -m "feat(bot): package scaffold + local SQLite store"
```

---

## Task 6: Bot API client

**Files:**
- Create: `discord/src/api.js`
- Modify: `discord/test/helpers.js` (add `stubApiServer`)
- Create: `discord/test/api.test.js`

**Interfaces:**
- Consumes: nothing from earlier bot tasks.
- Produces `discord/src/api.js`:
  - `class NotLinkedError extends Error {}`
  - `class ForbiddenError extends Error {}`
  - `class ApiUnreachableError extends Error {}`
  - `createApi({ baseUrl, botSecret }) -> api` where `api` has:
    - `getBoards(token) -> Promise<Board[]>` (GET `/api/boards`)
    - `getBoard(token, boardId) -> Promise<Board>` (GET `/api/boards/:id`)
    - `redeemCode({ code, discordUserId }) -> Promise<{ token, appUserId, displayName }>` (POST `/api/bot/discord/redeem` with `X-Bot-Secret`)
  - On `401` from a token call -> throw `NotLinkedError`. On `403`/`404` -> `ForbiddenError`. On network failure -> `ApiUnreachableError`. On `400` from redeem -> plain `Error("invalid_or_expired_code")`.
  - `Board` shape (from the API): `{ id, name, tasks: Task[], members: {id, email, display_name, role}[], teams: {id, name, member_ids}[], sprints: {id, name, starts_at, ends_at, is_active}[] }`. `Task`: `{ id, title, status, priority, story_points, completed_at, sprint_id, assignees: {type, id, name}[], dependencies: {id, title}[], subtasks: {id, title, done}[] }`.
- Produces `discord/test/helpers.js` export `stubApiServer(routes) -> { url, close }` — a `node:http` server; `routes` is `{ "GET /api/boards": (req,res,body)=>[...] }`.

- [ ] **Step 1: Add the stub server helper**

Append to `discord/test/helpers.js`:

```js
import http from "node:http";

export function stubApiServer(handlers) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const key = `${req.method} ${req.url.split("?")[0]}`;
      const handler = handlers[key];
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "no stub for " + key }));
      }
      const parsed = body ? JSON.parse(body) : undefined;
      const result = handler(req, parsed);
      const status = result?.__status ?? 200;
      const payload = result?.__status ? result.body : result;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

export const status = (code, body) => ({ __status: code, body });
```

- [ ] **Step 2: Write the failing test**

Create `discord/test/api.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { stubApiServer, status } from "./helpers.js";
import { createApi, NotLinkedError, ForbiddenError, ApiUnreachableError } from "../src/api.js";

test("getBoards passes the bearer token and returns JSON", async () => {
  let seenAuth = null;
  const srv = await stubApiServer({
    "GET /api/boards": (req) => { seenAuth = req.headers.authorization; return [{ id: "b1", name: "B1" }]; },
  });
  test.after(srv.close);
  const api = createApi({ baseUrl: srv.url, botSecret: "s" });
  const boards = await api.getBoards("qbit_tok");
  assert.equal(seenAuth, "Bearer qbit_tok");
  assert.deepEqual(boards, [{ id: "b1", name: "B1" }]);
});

test("401 -> NotLinkedError", async () => {
  const srv = await stubApiServer({ "GET /api/boards": () => status(401, { error: "x" }) });
  test.after(srv.close);
  const api = createApi({ baseUrl: srv.url, botSecret: "s" });
  await assert.rejects(() => api.getBoards("bad"), NotLinkedError);
});

test("403 -> ForbiddenError", async () => {
  const srv = await stubApiServer({ "GET /api/boards/b9": () => status(403, { error: "x" }) });
  test.after(srv.close);
  const api = createApi({ baseUrl: srv.url, botSecret: "s" });
  await assert.rejects(() => api.getBoard("tok", "b9"), ForbiddenError);
});

test("connection refused -> ApiUnreachableError", async () => {
  const api = createApi({ baseUrl: "http://127.0.0.1:1", botSecret: "s" });
  await assert.rejects(() => api.getBoards("tok"), ApiUnreachableError);
});

test("redeemCode sends X-Bot-Secret and returns the token payload", async () => {
  let seenSecret = null;
  const srv = await stubApiServer({
    "POST /api/bot/discord/redeem": (req, body) => {
      seenSecret = req.headers["x-bot-secret"];
      assert.deepEqual(body, { code: "123456", discordUserId: "d1" });
      return { token: "qbit_new", appUserId: "u1", displayName: "Max" };
    },
  });
  test.after(srv.close);
  const api = createApi({ baseUrl: srv.url, botSecret: "topsecret" });
  const out = await api.redeemCode({ code: "123456", discordUserId: "d1" });
  assert.equal(seenSecret, "topsecret");
  assert.equal(out.token, "qbit_new");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd discord && node --test test/api.test.js`
Expected: FAIL — `Cannot find module '../src/api.js'`.

- [ ] **Step 4: Implement the client**

Create `discord/src/api.js`:

```js
export class NotLinkedError extends Error {}
export class ForbiddenError extends Error {}
export class ApiUnreachableError extends Error {}

export function createApi({ baseUrl, botSecret }) {
  async function call(path, { method = "GET", token, headers = {}, body } = {}) {
    let res;
    try {
      res = await fetch(baseUrl + path, {
        method,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new ApiUnreachableError(err.message);
    }
    if (res.status === 401) throw new NotLinkedError("token rejected");
    if (res.status === 403 || res.status === 404) {
      throw new ForbiddenError(`${res.status} on ${path}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
    return data;
  }

  return {
    getBoards: (token) => call("/api/boards", { token }),
    getBoard: (token, boardId) => call(`/api/boards/${boardId}`, { token }),
    redeemCode: ({ code, discordUserId }) =>
      call("/api/bot/discord/redeem", {
        method: "POST",
        headers: { "x-bot-secret": botSecret },
        body: { code, discordUserId },
      }),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd discord && node --test test/api.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add discord/src/api.js discord/test/helpers.js discord/test/api.test.js
git commit -m "feat(bot): REST client for the Questboard API with typed errors"
```

---

## Task 7: Bot formatters

**Files:**
- Create: `discord/src/format.js`
- Create: `discord/test/fixtures/board.js`
- Create: `discord/test/format.test.js`

**Interfaces:**
- Consumes: the `Board`/`Task` shape from Task 6.
- Produces `discord/src/format.js`:
  - `formatTasks(board, { status, assignee, sprintId }) -> embed` — an object `{ title, fields: [{name, value}], footer? }`. Unfiltered: one field per status (`backlog`,`todo`,`in-progress`,`done`). Filtered: a single `Matching` field. Each task line: `• <title> — <assigneeNames or "unassigned"> · <story_points>pt · <priority>`. Truncates each field value to 1024 chars and appends `footer = { text: "+N more — narrow with status: or assignee:" }` when lines were dropped.
  - `formatMine(boards) -> embed` — `boards` is `[{ board, tasks }]`; groups by board then status; only non-done unless caller pre-filters.
  - `formatStandup(board) -> { content }` — plain text (not an embed): `**In Progress**` grouped by assignee, `**Done since yesterday**` (`completed_at` within 24h of `Date.now()`), `**Blocked**` (task has >=1 dependency whose target task on the same board is not `status === "done"`).
  - `formatSprint(board) -> embed` — the sprint with `is_active === 1`; name, `starts_at → ends_at`, counts per status, `done/total` story points, percent done. If none active: `{ title: board.name, fields: [{ name: "Sprint", value: "No active sprint." }] }`.
  - `STATUS_ORDER = ["backlog", "todo", "in-progress", "done"]` and `STATUS_LABEL = { ... }` exported for reuse by commands.
- All functions are pure — no network, no `discord.js`, no `Date` injection needed beyond `Date.now()`.

- [ ] **Step 1: Create the fixture**

Create `discord/test/fixtures/board.js`:

```js
const now = Date.now();
const iso = (msAgo) => new Date(now - msAgo).toISOString();

export const board = {
  id: "board_1",
  name: "Questboard",
  members: [
    { id: "u_max", email: "max@x.com", display_name: "Max", role: "owner" },
    { id: "u_mor", email: "mor@x.com", display_name: "Moralilst", role: "member" },
  ],
  teams: [{ id: "t_core", name: "Core", member_ids: ["u_max", "u_mor"] }],
  sprints: [
    { id: "s_1", name: "Sprint 1", starts_at: "2026-09-01", ends_at: "2026-09-14", is_active: 1 },
  ],
  tasks: [
    { id: "k1", title: "Wire up auth", status: "in-progress", priority: "high", story_points: 5,
      completed_at: null, sprint_id: "s_1", assignees: [{ type: "user", id: "u_max", name: "Max" }],
      dependencies: [], subtasks: [] },
    { id: "k2", title: "Design schema", status: "done", priority: "normal", story_points: 3,
      completed_at: iso(2 * 3600 * 1000), sprint_id: "s_1", assignees: [{ type: "user", id: "u_mor", name: "Moralilst" }],
      dependencies: [], subtasks: [] },
    { id: "k3", title: "Ship it", status: "todo", priority: "urgent", story_points: 8,
      completed_at: null, sprint_id: "s_1", assignees: [],
      dependencies: [{ id: "k1", title: "Wire up auth" }], subtasks: [] },
    { id: "k4", title: "Old done thing", status: "done", priority: "low", story_points: 1,
      completed_at: iso(72 * 3600 * 1000), sprint_id: null, assignees: [], dependencies: [], subtasks: [] },
  ],
};
```

- [ ] **Step 2: Write the failing test**

Create `discord/test/format.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { board } from "./fixtures/board.js";
import { formatTasks, formatStandup, formatSprint } from "../src/format.js";

test("formatTasks unfiltered has one field per status with counts", () => {
  const embed = formatTasks(board, {});
  assert.equal(embed.title, "Questboard");
  const names = embed.fields.map((f) => f.name);
  assert.deepEqual(names, ["Backlog (0)", "To Do (1)", "In Progress (1)", "Done (2)"]);
  assert.match(embed.fields[2].value, /Wire up auth — Max · 5pt · high/);
});

test("formatTasks filtered by status returns a single Matching field", () => {
  const embed = formatTasks(board, { status: "todo" });
  assert.equal(embed.fields.length, 1);
  assert.match(embed.fields[0].name, /Matching/);
  assert.match(embed.fields[0].value, /Ship it — unassigned · 8pt · urgent/);
});

test("formatStandup groups in-progress by assignee and flags blocked + recent done", () => {
  const { content } = formatStandup(board);
  assert.match(content, /\*\*In Progress\*\*/);
  assert.match(content, /Max\b[\s\S]*Wire up auth/);
  assert.match(content, /\*\*Done since yesterday\*\*[\s\S]*Design schema/);
  assert.doesNotMatch(content, /Old done thing/); // 72h ago, excluded
  assert.match(content, /\*\*Blocked\*\*[\s\S]*Ship it/); // depends on k1 (in-progress)
});

test("formatSprint reports the active sprint with point totals", () => {
  const embed = formatSprint(board);
  assert.match(embed.title, /Sprint 1/);
  assert.match(JSON.stringify(embed.fields), /2026-09-01/);
  assert.match(JSON.stringify(embed.fields), /3\s*\/\s*19|19 pts|points/i); // done 3 of 19 total
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd discord && node --test test/format.test.js`
Expected: FAIL — `Cannot find module '../src/format.js'`.

- [ ] **Step 4: Implement the formatters**

Create `discord/src/format.js`:

```js
export const STATUS_ORDER = ["backlog", "todo", "in-progress", "done"];
export const STATUS_LABEL = {
  backlog: "Backlog", todo: "To Do", "in-progress": "In Progress", done: "Done",
};
const FIELD_MAX = 1024;

const assigneeNames = (t) =>
  t.assignees?.length ? t.assignees.map((a) => a.name).join(", ") : "unassigned";
const line = (t) => `• ${t.title} — ${assigneeNames(t)} · ${t.story_points}pt · ${t.priority}`;

function clampLines(lines) {
  const out = [];
  let len = 0, dropped = 0;
  for (const l of lines) {
    if (len + l.length + 1 > FIELD_MAX) { dropped++; continue; }
    out.push(l); len += l.length + 1;
  }
  return { value: out.join("\n") || "—", dropped };
}

export function formatTasks(board, { status, assignee, sprintId } = {}) {
  let tasks = board.tasks;
  if (assignee) tasks = tasks.filter((t) => t.assignees?.some((a) => a.id === assignee || a.name === assignee));
  if (sprintId) tasks = tasks.filter((t) => t.sprint_id === sprintId);

  if (status) {
    const { value, dropped } = clampLines(tasks.filter((t) => t.status === status).map(line));
    return {
      title: board.name,
      fields: [{ name: `Matching “${STATUS_LABEL[status] || status}” (${tasks.filter((t) => t.status === status).length})`, value }],
      ...(dropped ? { footer: { text: `+${dropped} more — narrow with status: or assignee:` } } : {}),
    };
  }

  let totalDropped = 0;
  const fields = STATUS_ORDER.map((s) => {
    const rows = tasks.filter((t) => t.status === s);
    const { value, dropped } = clampLines(rows.map(line));
    totalDropped += dropped;
    return { name: `${STATUS_LABEL[s]} (${rows.length})`, value };
  });
  return {
    title: board.name,
    fields,
    ...(totalDropped ? { footer: { text: `+${totalDropped} more — narrow with status: or assignee:` } } : {}),
  };
}

export function formatMine(boards) {
  const fields = [];
  for (const { board, tasks } of boards) {
    const active = tasks.filter((t) => t.status !== "done");
    if (!active.length) continue;
    const byStatus = STATUS_ORDER.filter((s) => s !== "done")
      .map((s) => {
        const rows = active.filter((t) => t.status === s);
        return rows.length ? `__${STATUS_LABEL[s]}__\n${rows.map(line).join("\n")}` : null;
      })
      .filter(Boolean)
      .join("\n");
    fields.push({ name: board.name, value: clampLines(byStatus.split("\n")).value });
  }
  return { title: "Your tasks", fields: fields.length ? fields : [{ name: "Your tasks", value: "Nothing assigned to you right now." }] };
}

export function formatStandup(board) {
  const doneIds = new Set(board.tasks.filter((t) => t.status === "done").map((t) => t.id));
  const inProg = board.tasks.filter((t) => t.status === "in-progress");
  const byAssignee = {};
  for (const t of inProg) {
    const key = t.assignees?.length ? t.assignees.map((a) => a.name).join(", ") : "Unassigned";
    (byAssignee[key] ||= []).push(t.title);
  }
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  const recentDone = board.tasks.filter(
    (t) => t.status === "done" && t.completed_at && Date.parse(t.completed_at) >= dayAgo
  );
  const blocked = board.tasks.filter(
    (t) => t.status !== "done" && (t.dependencies || []).some((d) => !doneIds.has(d.id))
  );

  const parts = [`**Standup — ${board.name}**`, "", "**In Progress**"];
  const names = Object.keys(byAssignee);
  parts.push(names.length ? names.map((n) => `${n}\n${byAssignee[n].map((x) => `  • ${x}`).join("\n")}`).join("\n") : "_nothing in progress_");
  parts.push("", "**Done since yesterday**");
  parts.push(recentDone.length ? recentDone.map((t) => `  • ${t.title}`).join("\n") : "_nothing_");
  parts.push("", "**Blocked**");
  parts.push(blocked.length ? blocked.map((t) => `  • ${t.title}`).join("\n") : "_nothing_");
  return { content: parts.join("\n").slice(0, 1900) };
}

export function formatSprint(board) {
  const sprint = (board.sprints || []).find((s) => s.is_active === 1 || s.is_active === true);
  if (!sprint) {
    return { title: board.name, fields: [{ name: "Sprint", value: "No active sprint." }] };
  }
  const inSprint = board.tasks.filter((t) => t.sprint_id === sprint.id);
  const totalPts = inSprint.reduce((n, t) => n + (t.story_points || 0), 0);
  const donePts = inSprint.filter((t) => t.status === "done").reduce((n, t) => n + (t.story_points || 0), 0);
  const counts = STATUS_ORDER.map((s) => `${STATUS_LABEL[s]}: ${inSprint.filter((t) => t.status === s).length}`).join(" · ");
  const pct = totalPts ? Math.round((donePts / totalPts) * 100) : 0;
  return {
    title: `${board.name} — ${sprint.name}`,
    fields: [
      { name: "Dates", value: `${sprint.starts_at || "?"} → ${sprint.ends_at || "?"}` },
      { name: "Tasks", value: counts },
      { name: "Points", value: `${donePts} / ${totalPts} done (${pct}%)` },
    ],
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd discord && node --test test/format.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add discord/src/format.js discord/test/fixtures/board.js discord/test/format.test.js
git commit -m "feat(bot): pure formatters for tasks / mine / standup / sprint"
```

---

## Task 8: Bot — /questboard command (link / unlink / use / whichboard)

**Files:**
- Create: `discord/src/context.js`
- Create: `discord/src/commands/link.js`
- Modify: `discord/test/helpers.js` (add `fakeCtx`)
- Create: `discord/test/commands.link.test.js`

**Interfaces:**
- Consumes: `store` (Task 5), `api` (Task 6).
- Produces `discord/src/context.js` export `buildContext(interaction, deps) -> ctx`:
  ```
  ctx = {
    discordUserId: string,
    channelId: string,
    sub: string | null,                       // interaction.options.getSubcommand(false)
    opt(name): string | null,                 // string option getter
    store, api,
    reply(payloadOrString): Promise<void>,    // ephemeral by default
    replyPublic(payloadOrString): Promise<void>,
    link(): { appUserId, integrationToken } | null,   // store.getLink(discordUserId)
  }
  ```
  `reply`/`replyPublic` accept either a string or `{ embeds:[embed] }`; they translate the plain embed objects from `format.js` into `discord.js` embed payloads (an embed is `{ title, fields, footer }` -> `{ embeds: [ { ...same } ] }` — `discord.js` accepts that shape directly in `interaction.reply`).
- Produces `discord/src/commands/link.js` default export `{ name: "questboard", data, execute(ctx), autocomplete(ctx) }`:
  - `data` = a `SlashCommandBuilder` with subcommands `link` (string opt `code`, required), `unlink`, `use` (string opt `board`, required, autocomplete), `whichboard`.
  - `link`: reads `ctx.opt("code")`, calls `ctx.api.redeemCode({ code, discordUserId: ctx.discordUserId })`. On success `ctx.store.upsertLink(...)` and reply `Linked to Questboard as **<displayName>**.` On `Error` reply `That code is invalid or expired — generate a new one in Questboard → Settings.`
  - `unlink`: `ctx.store.deleteLink(...)`, and best-effort `DELETE /api/integrations/discord/link` via a new `api.unlink(token)` (add it to `api.js`). Reply `Unlinked.`
  - `use`: requires a link (`ctx.link()`), calls `ctx.api.getBoards(token)`, matches `ctx.opt("board")` against `board.id` or exact `board.name`; on hit `ctx.store.setChannelBoard(ctx.channelId, board.id, ctx.discordUserId)` reply `This channel now defaults to **<name>**. Anyone here can query it.`; on miss reply `No board of yours matches that.`
  - `whichboard`: `const id = ctx.store.getChannelBoard(ctx.channelId)`; reply the board name (look it up via `getBoards`) or `No board set for this channel yet.`
  - `autocomplete` (for `use`): if linked, `api.getBoards(token)` filtered by the current input substring (case-insensitive), map to `{ name: board.name, value: board.id }`, max 25.
- Produces `discord/test/helpers.js` export `fakeCtx(overrides) -> ctx` with `reply`/`replyPublic` recording into `ctx.replies` (array of the raw arg).

- [ ] **Step 1: Add `api.unlink` to the client**

In `discord/src/api.js`, add to the returned object:

```js
    unlink: (token) => call("/api/integrations/discord/link", { method: "DELETE", token }),
```

- [ ] **Step 2: Add `fakeCtx` helper**

Append to `discord/test/helpers.js`:

```js
export function fakeCtx(overrides = {}) {
  const replies = [];
  const ctx = {
    discordUserId: "d1",
    channelId: "c1",
    sub: null,
    _opts: {},
    opt(name) { return this._opts[name] ?? null; },
    store: null,
    api: null,
    replies,
    async reply(p) { replies.push({ ephemeral: true, p }); },
    async replyPublic(p) { replies.push({ ephemeral: false, p }); },
    link() { return this.store ? this.store.getLink(this.discordUserId) : null; },
    ...overrides,
  };
  if (overrides._opts) ctx._opts = overrides._opts;
  return ctx;
}
```

- [ ] **Step 3: Write the failing test**

Create `discord/test/commands.link.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { tempStore, fakeCtx } from "./helpers.js";
import questboard from "../src/commands/link.js";

function apiStub(over = {}) {
  return {
    async redeemCode({ code }) {
      if (code === "good") return { token: "qbit_x", appUserId: "u1", displayName: "Max" };
      throw new Error("invalid_or_expired_code");
    },
    async getBoards() { return [{ id: "b1", name: "Alpha" }, { id: "b2", name: "Beta" }]; },
    async unlink() {},
    ...over,
  };
}

test("link with a good code stores the link and confirms", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const ctx = fakeCtx({ sub: "link", _opts: { code: "good" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /Linked to Questboard as \*\*Max\*\*/);
  assert.equal(store.getLink("d1").integrationToken, "qbit_x");
});

test("link with a bad code explains how to get a new one", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const ctx = fakeCtx({ sub: "link", _opts: { code: "nope" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /invalid or expired/i);
  assert.equal(store.getLink("d1"), null);
});

test("use sets the channel default when the board name matches", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u1", "qbit_x");
  const ctx = fakeCtx({ sub: "use", _opts: { board: "Beta" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.equal(store.getChannelBoard("c1"), "b2");
  assert.match(ctx.replies[0].p, /defaults to \*\*Beta\*\*/);
});

test("use without a link tells the user to link first", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const ctx = fakeCtx({ sub: "use", _opts: { board: "Beta" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /link/i);
  assert.equal(store.getChannelBoard("c1"), null);
});

test("whichboard reports the current default", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u1", "qbit_x");
  store.setChannelBoard("c1", "b1", "d1");
  const ctx = fakeCtx({ sub: "whichboard", store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /Alpha/);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `cd discord && node --test test/commands.link.test.js`
Expected: FAIL — `Cannot find module '../src/commands/link.js'`.

- [ ] **Step 5: Implement `context.js` and `commands/link.js`**

Create `discord/src/context.js`:

```js
export function buildContext(interaction, { store, api }) {
  const toPayload = (p) => (typeof p === "string" ? { content: p } : { embeds: [p] });
  return {
    discordUserId: interaction.user.id,
    channelId: interaction.channelId,
    sub: interaction.options.getSubcommand(false),
    opt: (name) => interaction.options.getString(name),
    store,
    api,
    reply: (p) => interaction.reply({ ...toPayload(p), ephemeral: true }),
    replyPublic: (p) => interaction.reply(toPayload(p)),
    link() { return store.getLink(interaction.user.id); },
  };
}
```

Create `discord/src/commands/link.js`:

```js
import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("questboard")
  .setDescription("Link your Questboard account and set this channel's board")
  .addSubcommand((s) => s.setName("link").setDescription("Link with a code from Questboard → Settings")
    .addStringOption((o) => o.setName("code").setDescription("6-digit code").setRequired(true)))
  .addSubcommand((s) => s.setName("unlink").setDescription("Disconnect your Questboard account"))
  .addSubcommand((s) => s.setName("use").setDescription("Set this channel's default board")
    .addStringOption((o) => o.setName("board").setDescription("Board name").setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName("whichboard").setDescription("Show this channel's default board"));

async function resolveBoardName(api, token, boardId) {
  try {
    const boards = await api.getBoards(token);
    return boards.find((b) => b.id === boardId)?.name ?? null;
  } catch { return null; }
}

export async function execute(ctx) {
  if (ctx.sub === "link") {
    const code = ctx.opt("code");
    try {
      const { token, appUserId, displayName } = await ctx.api.redeemCode({ code, discordUserId: ctx.discordUserId });
      ctx.store.upsertLink(ctx.discordUserId, appUserId, token);
      return ctx.reply(`Linked to Questboard as **${displayName}**.`);
    } catch {
      return ctx.reply("That code is invalid or expired — generate a new one in Questboard → Settings.");
    }
  }

  if (ctx.sub === "unlink") {
    const link = ctx.link();
    ctx.store.deleteLink(ctx.discordUserId);
    if (link) { try { await ctx.api.unlink(link.integrationToken); } catch {} }
    return ctx.reply("Unlinked.");
  }

  if (ctx.sub === "use") {
    const link = ctx.link();
    if (!link) return ctx.reply("You're not linked yet — run `/questboard link` (get a code from Questboard → Settings).");
    let boards;
    try { boards = await ctx.api.getBoards(link.integrationToken); }
    catch { return ctx.reply("Questboard isn't responding, try again in a moment."); }
    const q = ctx.opt("board");
    const match = boards.find((b) => b.id === q) || boards.find((b) => b.name.toLowerCase() === q.toLowerCase());
    if (!match) return ctx.reply("No board of yours matches that.");
    ctx.store.setChannelBoard(ctx.channelId, match.id, ctx.discordUserId);
    return ctx.reply(`This channel now defaults to **${match.name}**. Anyone here can query it.`);
  }

  if (ctx.sub === "whichboard") {
    const id = ctx.store.getChannelBoard(ctx.channelId);
    if (!id) return ctx.reply("No board set for this channel yet — run `/questboard use`.");
    const link = ctx.link();
    const name = link ? await resolveBoardName(ctx.api, link.integrationToken, id) : null;
    return ctx.reply(`This channel defaults to **${name || id}**.`);
  }

  return ctx.reply("Unknown subcommand.");
}

export async function autocomplete(ctx) {
  const link = ctx.store.getLink(ctx.discordUserId);
  if (!link) return [];
  try {
    const input = (ctx.opt("board") || "").toLowerCase();
    const boards = await ctx.api.getBoards(link.integrationToken);
    return boards
      .filter((b) => !input || b.name.toLowerCase().includes(input))
      .slice(0, 25)
      .map((b) => ({ name: b.name, value: b.id }));
  } catch { return []; }
}

export default { name: "questboard", data, execute, autocomplete };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd discord && node --test test/commands.link.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add discord/src/context.js discord/src/commands/link.js discord/src/api.js discord/test/helpers.js discord/test/commands.link.test.js
git commit -m "feat(bot): /questboard link | unlink | use | whichboard"
```

---

## Task 9: Bot — /tasks and /mine

**Files:**
- Create: `discord/src/commands/tasks.js`
- Create: `discord/src/commands/mine.js`
- Create: `discord/test/commands.query.test.js`

**Interfaces:**
- Consumes: `store`, `api`, `format.js` (`formatTasks`, `formatMine`), `context.js` `ctx`.
- Produces:
  - `discord/src/commands/tasks.js` default export `{ name: "tasks", data, execute, autocomplete }`.
    - `data`: `/tasks` with optional string options `status` (choices: `backlog`/`todo`/`in-progress`/`done`), `assignee` (autocomplete), `sprint` (autocomplete), `board` (autocomplete).
    - `execute`: require link; resolve board = `opt("board")` || `store.getChannelBoard(channelId)`; if none -> ephemeral "No board set for this channel — run `/questboard use` or pass `board:`." Fetch `api.getBoard(token, boardId)`. If `ForbiddenError` -> "You don't have access to that board." If `NotLinkedError` -> delete the stale link, tell them to relink. If `ApiUnreachableError` -> "Questboard isn't responding…". On success `ctx.reply({ embeds:[formatTasks(board, { status, assignee, sprintId })] })`. `sprintId`: if `opt("sprint")` given use it, else if it equals the string `"active"` or is omitted **do not** filter (v1: sprint filter only when explicitly chosen).
    - `autocomplete`: for `assignee` -> board members' `display_name` + teams' `name`; for `sprint` -> sprint names -> `{name, value: sprint.id}`; for `board` -> like Task 8. Needs `api.getBoard`/`getBoards`; wrap in try/catch -> `[]`.
  - `discord/src/commands/mine.js` default export `{ name: "mine", data, execute }`.
    - `data`: `/mine` with optional `status` (same choices) and `board` (autocomplete).
    - `execute`: require link; `api.getBoards(token)`; for each board `api.getBoard(token, b.id)` (sequential; small N); filter each board's tasks to those with an assignee whose `id === appUserId` OR on a team containing `appUserId` (`board.teams[].member_ids`); if `opt("status")` filter further, else drop `done`; `ctx.reply({ embeds:[formatMine(pairs)] })` where `pairs = [{ board, tasks }]` (skip boards with no matches).

- [ ] **Step 1: Write the failing test**

Create `discord/test/commands.query.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { tempStore, fakeCtx } from "./helpers.js";
import { board as fixture } from "./fixtures/board.js";
import tasksCmd from "../src/commands/tasks.js";
import mineCmd from "../src/commands/mine.js";
import { ForbiddenError } from "../src/api.js";

const apiOk = {
  async getBoards() { return [{ id: "board_1", name: "Questboard" }]; },
  async getBoard() { return fixture; },
};

test("/tasks uses the channel default board and renders an embed", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const ctx = fakeCtx({ store, api: apiOk, _opts: {} });
  await tasksCmd.execute(ctx);
  const payload = ctx.replies[0].p;
  assert.ok(payload.embeds[0].fields.some((f) => f.name.startsWith("In Progress")));
});

test("/tasks with no board set nudges the user", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  const ctx = fakeCtx({ store, api: apiOk, _opts: {} });
  await tasksCmd.execute(ctx);
  assert.match(ctx.replies[0].p, /No board set/i);
});

test("/tasks surfaces a Forbidden as a friendly message", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const api = { ...apiOk, async getBoard() { throw new ForbiddenError("403"); } };
  const ctx = fakeCtx({ store, api, _opts: {} });
  await tasksCmd.execute(ctx);
  assert.match(ctx.replies[0].p, /don't have access/i);
});

test("/mine filters to the caller's own tasks across boards", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  const ctx = fakeCtx({ store, api: apiOk, _opts: {} });
  await mineCmd.execute(ctx);
  const embed = ctx.replies[0].p.embeds[0];
  assert.match(JSON.stringify(embed), /Wire up auth/);   // u_max, in-progress
  assert.doesNotMatch(JSON.stringify(embed), /Design schema/); // u_mor's
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd discord && node --test test/commands.query.test.js`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `tasks.js`**

Create `discord/src/commands/tasks.js`:

```js
import { SlashCommandBuilder } from "discord.js";
import { formatTasks } from "../format.js";
import { NotLinkedError, ForbiddenError, ApiUnreachableError } from "../api.js";

const STATUS_CHOICES = ["backlog", "todo", "in-progress", "done"].map((s) => ({ name: s, value: s }));

export const data = new SlashCommandBuilder()
  .setName("tasks")
  .setDescription("Show tasks on a board")
  .addStringOption((o) => o.setName("status").setDescription("Filter by column").addChoices(...STATUS_CHOICES))
  .addStringOption((o) => o.setName("assignee").setDescription("Filter by assignee").setAutocomplete(true))
  .addStringOption((o) => o.setName("sprint").setDescription("Filter by sprint").setAutocomplete(true))
  .addStringOption((o) => o.setName("board").setDescription("Board (defaults to this channel's)").setAutocomplete(true));

function resolveBoardId(ctx) {
  return ctx.opt("board") || ctx.store.getChannelBoard(ctx.channelId);
}

export async function execute(ctx) {
  const link = ctx.link();
  if (!link) return ctx.reply("You're not linked yet — run `/questboard link`.");
  const boardId = resolveBoardId(ctx);
  if (!boardId) return ctx.reply("No board set for this channel — run `/questboard use` or pass `board:`.");

  let board;
  try {
    board = await ctx.api.getBoard(link.integrationToken, boardId);
  } catch (err) {
    if (err instanceof ForbiddenError) return ctx.reply("You don't have access to that board.");
    if (err instanceof NotLinkedError) {
      ctx.store.deleteLink(ctx.discordUserId);
      return ctx.reply("Your link was revoked — run `/questboard link` to reconnect.");
    }
    if (err instanceof ApiUnreachableError) return ctx.reply("Questboard isn't responding, try again in a moment.");
    throw err;
  }

  const embed = formatTasks(board, {
    status: ctx.opt("status") || undefined,
    assignee: ctx.opt("assignee") || undefined,
    sprintId: ctx.opt("sprint") || undefined,
  });
  return ctx.reply({ embeds: [embed] });
}

export async function autocomplete(ctx) {
  const link = ctx.store.getLink(ctx.discordUserId);
  if (!link) return [];
  const focused = ctx._focused || null; // set by index.js: which option is being completed
  try {
    if (focused === "board") {
      const boards = await ctx.api.getBoards(link.integrationToken);
      const q = (ctx.opt("board") || "").toLowerCase();
      return boards.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 25)
        .map((b) => ({ name: b.name, value: b.id }));
    }
    const boardId = resolveBoardId(ctx);
    if (!boardId) return [];
    const board = await ctx.api.getBoard(link.integrationToken, boardId);
    if (focused === "assignee") {
      const q = (ctx.opt("assignee") || "").toLowerCase();
      const names = [
        ...board.members.map((m) => m.display_name),
        ...board.teams.map((t) => t.name),
      ];
      return names.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 25).map((n) => ({ name: n, value: n }));
    }
    if (focused === "sprint") {
      const q = (ctx.opt("sprint") || "").toLowerCase();
      return board.sprints.filter((s) => !q || s.name.toLowerCase().includes(q)).slice(0, 25)
        .map((s) => ({ name: s.name, value: s.id }));
    }
  } catch { /* fall through */ }
  return [];
}

export default { name: "tasks", data, execute, autocomplete };
```

- [ ] **Step 4: Implement `mine.js`**

Create `discord/src/commands/mine.js`:

```js
import { SlashCommandBuilder } from "discord.js";
import { formatMine } from "../format.js";
import { NotLinkedError, ForbiddenError, ApiUnreachableError } from "../api.js";

const STATUS_CHOICES = ["backlog", "todo", "in-progress", "done"].map((s) => ({ name: s, value: s }));

export const data = new SlashCommandBuilder()
  .setName("mine")
  .setDescription("Your tasks across the boards you belong to")
  .addStringOption((o) => o.setName("status").setDescription("Filter by column").addChoices(...STATUS_CHOICES))
  .addStringOption((o) => o.setName("board").setDescription("Only this board").setAutocomplete(true));

function isMine(task, appUserId, board) {
  const teamIds = new Set((board.teams || []).filter((t) => (t.member_ids || []).includes(appUserId)).map((t) => t.id));
  return (task.assignees || []).some((a) => (a.type === "user" && a.id === appUserId) || (a.type === "team" && teamIds.has(a.id)));
}

export async function execute(ctx) {
  const link = ctx.link();
  if (!link) return ctx.reply("You're not linked yet — run `/questboard link`.");

  let boards;
  try {
    boards = await ctx.api.getBoards(link.integrationToken);
  } catch (err) {
    if (err instanceof NotLinkedError) { ctx.store.deleteLink(ctx.discordUserId); return ctx.reply("Your link was revoked — run `/questboard link`."); }
    if (err instanceof ApiUnreachableError) return ctx.reply("Questboard isn't responding, try again in a moment.");
    throw err;
  }
  const only = ctx.opt("board");
  if (only) boards = boards.filter((b) => b.id === only || b.name.toLowerCase() === only.toLowerCase());

  const status = ctx.opt("status");
  const pairs = [];
  for (const b of boards) {
    let full;
    try { full = await ctx.api.getBoard(link.integrationToken, b.id); }
    catch (err) { if (err instanceof ForbiddenError) continue; throw err; }
    let tasks = full.tasks.filter((t) => isMine(t, link.appUserId, full));
    tasks = status ? tasks.filter((t) => t.status === status) : tasks.filter((t) => t.status !== "done");
    if (tasks.length) pairs.push({ board: full, tasks });
  }
  return ctx.reply({ embeds: [formatMine(pairs)] });
}

export default { name: "mine", data, execute };
```

Note: `formatMine` expects `{ board, tasks }` and re-filters `status !== "done"` internally; passing already-filtered `tasks` is fine because the internal filter is idempotent, but when `status` is given (e.g. `done`) `formatMine`'s internal `active` filter would drop them. **Fix:** change `formatMine` to not re-filter — it should render exactly the `tasks` handed to it. Update `discord/src/format.js` `formatMine` to:

```js
export function formatMine(boards) {
  const fields = [];
  for (const { board, tasks } of boards) {
    if (!tasks.length) continue;
    const groups = ["backlog", "todo", "in-progress", "done"]
      .map((s) => {
        const rows = tasks.filter((t) => t.status === s);
        return rows.length ? `__${STATUS_LABEL[s]}__\n${rows.map((t) => `• ${t.title} — ${t.assignees?.map((a) => a.name).join(", ") || "unassigned"} · ${t.story_points}pt · ${t.priority}`).join("\n")}` : null;
      })
      .filter(Boolean)
      .join("\n");
    fields.push({ name: board.name, value: groups.slice(0, 1024) });
  }
  return { title: "Your tasks", fields: fields.length ? fields : [{ name: "Your tasks", value: "Nothing assigned to you right now." }] };
}
```

Re-run `cd discord && node --test test/format.test.js` to confirm still green (the earlier `formatMine` had no direct test; this is safe).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd discord && node --test test/commands.query.test.js test/format.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add discord/src/commands/tasks.js discord/src/commands/mine.js discord/src/format.js discord/test/commands.query.test.js
git commit -m "feat(bot): /tasks and /mine"
```

---

## Task 10: Bot — /standup and /sprint

**Files:**
- Create: `discord/src/commands/standup.js`
- Create: `discord/src/commands/sprint.js`
- Create: `discord/test/commands.standup.test.js`

**Interfaces:**
- Consumes: `store`, `api`, `format.js` (`formatStandup`, `formatSprint`), `ctx`.
- Produces:
  - `discord/src/commands/standup.js` default export `{ name: "standup", data, execute }`. `data`: `/standup` with optional `board` (autocomplete). `execute`: require link; resolve board = `opt("board")` || channel default; none -> ephemeral nudge. Fetch board (same error handling as `/tasks`). On success `ctx.replyPublic(formatStandup(board).content)` — **public**, not ephemeral.
  - `discord/src/commands/sprint.js` default export `{ name: "sprint", data, execute }`. `data`: `/sprint` with optional `board` (autocomplete). `execute`: like `/standup` but `ctx.reply({ embeds:[formatSprint(board)] })` (ephemeral).
- Both reuse a shared `resolveBoardOrReply(ctx)` helper — put it in `discord/src/commands/_shared.js` (create) exporting `async function loadBoard(ctx) -> { board } | { error: string }` that does link check + board resolution + fetch + typed-error translation, returning `{ error }` for the caller to `ctx.reply`.

- [ ] **Step 1: Write the failing test**

Create `discord/test/commands.standup.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { tempStore, fakeCtx } from "./helpers.js";
import { board as fixture } from "./fixtures/board.js";
import standupCmd from "../src/commands/standup.js";
import sprintCmd from "../src/commands/sprint.js";

const api = { async getBoard() { return fixture; }, async getBoards() { return [{ id: "board_1", name: "Questboard" }]; } };

test("/standup replies publicly with the standup text", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const ctx = fakeCtx({ store, api, _opts: {} });
  await standupCmd.execute(ctx);
  assert.equal(ctx.replies[0].ephemeral, false);
  assert.match(ctx.replies[0].p, /\*\*Standup — Questboard\*\*/);
});

test("/sprint replies ephemerally with the active sprint embed", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const ctx = fakeCtx({ store, api, _opts: {} });
  await sprintCmd.execute(ctx);
  assert.equal(ctx.replies[0].ephemeral, true);
  assert.match(JSON.stringify(ctx.replies[0].p.embeds[0]), /Sprint 1/);
});

test("/standup with no board set nudges", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  const ctx = fakeCtx({ store, api, _opts: {} });
  await standupCmd.execute(ctx);
  assert.match(ctx.replies[0].p, /No board set/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd discord && node --test test/commands.standup.test.js`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement `_shared.js`**

Create `discord/src/commands/_shared.js`:

```js
import { NotLinkedError, ForbiddenError, ApiUnreachableError } from "../api.js";

export async function loadBoard(ctx) {
  const link = ctx.link();
  if (!link) return { error: "You're not linked yet — run `/questboard link`." };
  const boardId = ctx.opt("board") || ctx.store.getChannelBoard(ctx.channelId);
  if (!boardId) return { error: "No board set for this channel — run `/questboard use` or pass `board:`." };
  try {
    const board = await ctx.api.getBoard(link.integrationToken, boardId);
    return { board };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have access to that board." };
    if (err instanceof NotLinkedError) {
      ctx.store.deleteLink(ctx.discordUserId);
      return { error: "Your link was revoked — run `/questboard link` to reconnect." };
    }
    if (err instanceof ApiUnreachableError) return { error: "Questboard isn't responding, try again in a moment." };
    throw err;
  }
}

export async function boardAutocomplete(ctx) {
  const link = ctx.store.getLink(ctx.discordUserId);
  if (!link) return [];
  try {
    const q = (ctx.opt("board") || "").toLowerCase();
    const boards = await ctx.api.getBoards(link.integrationToken);
    return boards.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 25)
      .map((b) => ({ name: b.name, value: b.id }));
  } catch { return []; }
}
```

- [ ] **Step 4: Implement `standup.js` and `sprint.js`**

Create `discord/src/commands/standup.js`:

```js
import { SlashCommandBuilder } from "discord.js";
import { formatStandup } from "../format.js";
import { loadBoard, boardAutocomplete } from "./_shared.js";

export const data = new SlashCommandBuilder()
  .setName("standup")
  .setDescription("Post an In Progress / Done / Blocked summary for the channel's board")
  .addStringOption((o) => o.setName("board").setDescription("Board (defaults to this channel's)").setAutocomplete(true));

export async function execute(ctx) {
  const { board, error } = await loadBoard(ctx);
  if (error) return ctx.reply(error);
  return ctx.replyPublic(formatStandup(board).content);
}

export async function autocomplete(ctx) { return boardAutocomplete(ctx); }

export default { name: "standup", data, execute, autocomplete };
```

Create `discord/src/commands/sprint.js`:

```js
import { SlashCommandBuilder } from "discord.js";
import { formatSprint } from "../format.js";
import { loadBoard, boardAutocomplete } from "./_shared.js";

export const data = new SlashCommandBuilder()
  .setName("sprint")
  .setDescription("Show the active sprint for the channel's board")
  .addStringOption((o) => o.setName("board").setDescription("Board (defaults to this channel's)").setAutocomplete(true));

export async function execute(ctx) {
  const { board, error } = await loadBoard(ctx);
  if (error) return ctx.reply(error);
  return ctx.reply({ embeds: [formatSprint(board)] });
}

export async function autocomplete(ctx) { return boardAutocomplete(ctx); }

export default { name: "sprint", data, execute, autocomplete };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd discord && node --test test/commands.standup.test.js`
Expected: PASS.

- [ ] **Step 6: Run the full bot suite**

Run: `cd discord && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add discord/src/commands/standup.js discord/src/commands/sprint.js discord/src/commands/_shared.js discord/test/commands.standup.test.js
git commit -m "feat(bot): /standup (public) and /sprint"
```

---

## Task 11: Bot — client bootstrap + command registration

**Files:**
- Create: `discord/src/commands/index.js`
- Create: `discord/src/index.js`
- Create: `discord/src/register.js`
- Create: `discord/test/router.test.js`

**Interfaces:**
- Consumes: every `commands/*.js` default export; `buildContext` (Task 8); `createStore` (Task 5); `createApi` (Task 6).
- Produces:
  - `discord/src/commands/index.js` — `export const commands = [questboard, tasks, mine, standup, sprint];` and `export const byName = new Map(commands.map((c) => [c.name, c]));`
  - `discord/src/index.js` — reads env (`DISCORD_TOKEN`, `API_BASE`, `BOT_DB_PATH`, `BOT_REDEEM_SECRET`), builds `store` + `api`, creates a `Client({ intents: [GatewayIntentBits.Guilds] })`, on `interactionCreate`:
    - `isChatInputCommand()` -> `cmd = byName.get(interaction.commandName)`; `ctx = buildContext(interaction, { store, api })`; `await cmd.execute(ctx)`; on throw, log and (if not yet replied) `interaction.reply({ content: "Something went wrong.", ephemeral: true })`.
    - `isAutocomplete()` -> `cmd.autocomplete?.(autocompleteCtx)` then `interaction.respond(choices.slice(0, 25))`. The autocomplete ctx adds `_focused: interaction.options.getFocused(true).name` and `opt(name)` backed by `interaction.options.getString(name, false)`.
    - `client.login(process.env.DISCORD_TOKEN)`. `process.on("SIGTERM"|"SIGINT", () => { client.destroy(); store.close(); process.exit(0); })`.
  - `discord/src/register.js` — builds `commands.map((c) => c.data.toJSON())`, uses `REST` + `Routes`; if `process.env.DISCORD_DEV_GUILD_ID` -> `Routes.applicationGuildCommands(clientId, guildId)` else `Routes.applicationCommands(clientId)`. Logs the count. `clientId` from `process.env.DISCORD_CLIENT_ID`.
- **Testable slice:** `discord/src/router.js` — extract the dispatch logic so it can be tested without `discord.js`. `export async function dispatch(cmdInput, ctx, { byName })` where `cmdInput = { name }`: looks up the command, calls `execute`, catches + returns `{ ok: false }` on throw. `index.js` calls `dispatch`.

- [ ] **Step 1: Write the failing test**

Create `discord/test/router.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/router.js";

test("dispatch routes to the named command", async () => {
  let ran = false;
  const byName = new Map([["ping", { name: "ping", execute: async () => { ran = true; } }]]);
  const out = await dispatch({ name: "ping" }, {}, { byName });
  assert.equal(ran, true);
  assert.deepEqual(out, { ok: true });
});

test("dispatch returns ok:false when a command throws", async () => {
  const byName = new Map([["boom", { name: "boom", execute: async () => { throw new Error("x"); } }]]);
  const out = await dispatch({ name: "boom" }, {}, { byName });
  assert.deepEqual(out, { ok: false });
});

test("dispatch is a no-op for an unknown command", async () => {
  const out = await dispatch({ name: "nope" }, {}, { byName: new Map() });
  assert.deepEqual(out, { ok: false });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd discord && node --test test/router.test.js`
Expected: FAIL — `Cannot find module '../src/router.js'`.

- [ ] **Step 3: Implement `router.js`, `commands/index.js`**

Create `discord/src/router.js`:

```js
export async function dispatch(cmdInput, ctx, { byName }) {
  const cmd = byName.get(cmdInput.name);
  if (!cmd) return { ok: false };
  try {
    await cmd.execute(ctx);
    return { ok: true };
  } catch (err) {
    console.error(`[bot] command ${cmdInput.name} failed:`, err);
    return { ok: false };
  }
}
```

Create `discord/src/commands/index.js`:

```js
import questboard from "./link.js";
import tasks from "./tasks.js";
import mine from "./mine.js";
import standup from "./standup.js";
import sprint from "./sprint.js";

export const commands = [questboard, tasks, mine, standup, sprint];
export const byName = new Map(commands.map((c) => [c.name, c]));
```

- [ ] **Step 4: Implement `index.js` and `register.js`**

Create `discord/src/index.js`:

```js
import { Client, GatewayIntentBits } from "discord.js";
import createStore from "./store.js";
import { createApi } from "./api.js";
import { buildContext } from "./context.js";
import { byName } from "./commands/index.js";
import { dispatch } from "./router.js";

const {
  DISCORD_TOKEN,
  API_BASE = "http://127.0.0.1:4000",
  BOT_DB_PATH = "./questboard-bot.sqlite",
  BOT_REDEEM_SECRET,
} = process.env;

if (!DISCORD_TOKEN) { console.error("DISCORD_TOKEN is required"); process.exit(1); }

const store = createStore(BOT_DB_PATH);
const api = createApi({ baseUrl: API_BASE, botSecret: BOT_REDEEM_SECRET });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", (c) => console.log(`[bot] logged in as ${c.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const ctx = buildContext(interaction, { store, api });
      const { ok } = await dispatch({ name: interaction.commandName }, ctx, { byName });
      if (!ok && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong.", ephemeral: true });
      }
    } else if (interaction.isAutocomplete()) {
      const cmd = byName.get(interaction.commandName);
      if (!cmd?.autocomplete) return interaction.respond([]);
      const focused = interaction.options.getFocused(true);
      const ctx = {
        discordUserId: interaction.user.id,
        channelId: interaction.channelId,
        _focused: focused.name,
        opt: (name) => interaction.options.getString(name, false),
        store, api,
        link: () => store.getLink(interaction.user.id),
      };
      const choices = (await cmd.autocomplete(ctx)) || [];
      await interaction.respond(choices.slice(0, 25));
    }
  } catch (err) {
    console.error("[bot] interaction handler error:", err);
  }
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { client.destroy(); store.close(); process.exit(0); });
}

client.login(DISCORD_TOKEN);
```

Create `discord/src/register.js`:

```js
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
  process.exit(1);
}

const body = commands.map((c) => c.data.toJSON());
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
const route = DISCORD_DEV_GUILD_ID
  ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID)
  : Routes.applicationCommands(DISCORD_CLIENT_ID);

const out = await rest.put(route, { body });
console.log(`Registered ${out.length} commands ${DISCORD_DEV_GUILD_ID ? "to guild " + DISCORD_DEV_GUILD_ID : "globally"}.`);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd discord && node --test test/router.test.js`
Expected: PASS.

- [ ] **Step 6: Smoke-check the module graph loads**

Run: `cd discord && node -e "import('./src/commands/index.js').then(m => console.log(m.commands.map(c => c.name).join(',')))"`
Expected: prints `questboard,tasks,mine,standup,sprint` with no import error (verifies every command's `SlashCommandBuilder` definition is valid).

- [ ] **Step 7: Run the full bot suite**

Run: `cd discord && npm test`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add discord/src/router.js discord/src/commands/index.js discord/src/index.js discord/src/register.js discord/test/router.test.js
git commit -m "feat(bot): gateway client, interaction router, slash-command registration"
```

---

## Task 12: Frontend — Connect Discord in account settings

**Files:**
- Modify: `frontend/src/api.js`
- Create: `frontend/src/pages/AccountSettingsPage.jsx`
- Create: `frontend/src/components/settings/DiscordIntegration.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/AppShell.jsx`

**Interfaces:**
- Consumes: backend endpoints from Tasks 3 (`/api/integrations/discord/{link-code,status,link}`).
- Produces `frontend/src/api.js` additions on the `api` object:
  - `discordStatus: () => request("/integrations/discord/status")`
  - `discordLinkCode: () => request("/integrations/discord/link-code", { method: "POST" })`
  - `discordUnlink: () => request("/integrations/discord/link", { method: "DELETE" })`
- Produces route `account/settings` -> `<AccountSettingsPage />` (inside the `AppShell` `<Route element=...>` group, alongside `board/:boardId/settings`).
- Produces an "Account" `<Link to="/account/settings">` in `AppShell`'s `board-select-row`, after the "Board settings" link.

- [ ] **Step 1: Add the API client methods**

In `frontend/src/api.js`, inside the `export const api = { ... }` object (e.g. after `me:`), add:

```js
  discordStatus: () => request("/integrations/discord/status"),
  discordLinkCode: () => request("/integrations/discord/link-code", { method: "POST" }),
  discordUnlink: () => request("/integrations/discord/link", { method: "DELETE" }),
```

- [ ] **Step 2: Create the panel component**

Create `frontend/src/components/settings/DiscordIntegration.jsx`:

```jsx
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";

export default function DiscordIntegration() {
  const [linked, setLinked] = useState(null); // null = loading
  const [code, setCode] = useState(null);
  const [expiresAt, setExpiresAt] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  async function refresh() {
    try {
      const { linked } = await api.discordStatus();
      setLinked(linked);
      if (linked) { setCode(null); setExpiresAt(null); }
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => { refresh(); }, []);

  // countdown ticker
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  // poll status while a code is live
  useEffect(() => {
    if (!code) return;
    pollRef.current = setInterval(refresh, 5000);
    return () => clearInterval(pollRef.current);
  }, [code]);

  // expire the code locally
  useEffect(() => {
    if (expiresAt && now >= Date.parse(expiresAt)) { setCode(null); setExpiresAt(null); }
  }, [now, expiresAt]);

  async function connect() {
    setError("");
    try {
      const res = await api.discordLinkCode();
      setCode(res.code);
      setExpiresAt(res.expiresAt);
    } catch (e) { setError(e.message); }
  }

  async function disconnect() {
    setError("");
    try { await api.discordUnlink(); await refresh(); }
    catch (e) { setError(e.message); }
  }

  if (linked === null) return <p>Loading…</p>;

  if (linked) {
    return (
      <div className="discord-integration">
        <p>Connected to Discord.</p>
        <button className="btn-danger" type="button" onClick={disconnect}>Disconnect</button>
        {error && <p className="settings-error">{error}</p>}
      </div>
    );
  }

  const secondsLeft = expiresAt ? Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000)) : 0;
  const mmss = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return (
    <div className="discord-integration">
      {!code ? (
        <>
          <p>Link your Discord account so the Questboard bot can answer for you.</p>
          <button className="btn-primary" type="button" onClick={connect}>Connect Discord</button>
        </>
      ) : (
        <>
          <p>In your Discord server, run:</p>
          <p><code className="discord-link-cmd">/questboard link {code}</code></p>
          <p className="settings-note">Expires in {mmss}. Waiting for you to run it…</p>
        </>
      )}
      {error && <p className="settings-error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Create the page**

Create `frontend/src/pages/AccountSettingsPage.jsx`:

```jsx
import { Link } from "react-router-dom";
import SettingsSection from "../components/settings/SettingsSection.jsx";
import DiscordIntegration from "../components/settings/DiscordIntegration.jsx";

export default function AccountSettingsPage() {
  return (
    <div className="board-page settings-page">
      <div className="settings-topbar">
        <Link className="btn-ghost" to="/">← Back</Link>
        <h2>Account settings</h2>
      </div>
      <div className="settings-content">
        <SettingsSection title="Discord">
          <DiscordIntegration />
        </SettingsSection>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire the route and nav link**

In `frontend/src/App.jsx`, add the import and the route inside the `AppShell` element group:

```jsx
import AccountSettingsPage from "./pages/AccountSettingsPage.jsx";
// ...
        <Route path="account/settings" element={<AccountSettingsPage />} />
```

In `frontend/src/components/AppShell.jsx`, right after the existing `{boardId && (<Link ... to={`/board/${boardId}/settings`}>Board settings</Link>)}` block, add:

```jsx
          <Link className="btn-ghost" to="/account/settings">
            Account
          </Link>
```

- [ ] **Step 5: Build the frontend**

Run: `cd frontend && npm run build`
Expected: `built in ...` with no errors, module count increases by ~3.

- [ ] **Step 6: Manual smoke test against a local backend**

Run backend: `cd backend && BOT_REDEEM_SECRET=dev npm run dev`
Run frontend: `cd frontend && npm run dev` (ensure `frontend/.env.local` has `VITE_API_URL=http://localhost:4000/api`)
In the browser: sign in, click **Account** in the top row, click **Connect Discord** → a 6-digit code with a ticking countdown appears. In a separate terminal, redeem it as the bot would:

```bash
curl -sS -X POST http://localhost:4000/api/bot/discord/redeem \
  -H 'content-type: application/json' -H 'X-Bot-Secret: dev' \
  -d '{"code":"<the code>","discordUserId":"manual-test"}'
```

Expected: JSON `{ token: "qbit_...", appUserId, displayName }`, and within 5s the settings panel flips to "Connected to Discord." Click **Disconnect** → back to the button.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api.js frontend/src/pages/AccountSettingsPage.jsx frontend/src/components/settings/DiscordIntegration.jsx frontend/src/App.jsx frontend/src/components/AppShell.jsx
git commit -m "feat(web): Connect Discord panel in account settings"
```

---

## Task 13: Deploy assets + CI

**Files:**
- Create: `deploy/oracle/questboard-bot.service`
- Create: `deploy/oracle/bot.env.example`
- Modify: `deploy/oracle/api.env.example`
- Modify: `deploy/oracle/backup-db.sh`
- Modify: `deploy/oracle/SETUP.md`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Consumes: everything above.
- Produces: a runnable systemd unit, an env template, CI that runs `backend` + `discord` suites.

- [ ] **Step 1: Create the systemd unit**

Create `deploy/oracle/questboard-bot.service`:

```ini
# systemd unit for the Discord bot.
# Install: sudo cp deploy/oracle/questboard-bot.service /etc/systemd/system/
#          sudo systemctl daemon-reload && sudo systemctl enable --now questboard-bot
#
# Assumes:
#   - repo cloned at /opt/gamified-kanban  (bot at /opt/gamified-kanban/discord)
#   - Node installed system-wide at /usr/bin/node
#   - the `kanban` user
#   - env file at /etc/gamified-kanban/bot.env
#   - the API reachable at http://127.0.0.1:4000
#   - bot state DB on the persistent volume at /mnt/data

[Unit]
Description=Questboard Discord Bot
After=network-online.target gamified-kanban-api.service
Wants=network-online.target
RequiresMountsFor=/mnt/data

[Service]
Type=simple
User=kanban
Group=kanban
WorkingDirectory=/opt/gamified-kanban/discord
EnvironmentFile=/etc/gamified-kanban/bot.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=5

# --- hardening ---
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true
ReadWritePaths=/mnt/data

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Create the bot env template**

Create `deploy/oracle/bot.env.example`:

```bash
# Copy to /etc/gamified-kanban/bot.env and fill in real values.
#   sudo cp deploy/oracle/bot.env.example /etc/gamified-kanban/bot.env
#   sudo chown root:kanban /etc/gamified-kanban/bot.env && sudo chmod 640 /etc/gamified-kanban/bot.env

# From the Discord Developer Portal (see SETUP.md "Discord bot").
DISCORD_TOKEN=replace-with-bot-token
DISCORD_CLIENT_ID=replace-with-application-id
# Optional: set to your server's ID for instant slash-command updates while iterating.
DISCORD_DEV_GUILD_ID=

# The API on the same host (loopback). No /api suffix here.
API_BASE=http://127.0.0.1:4000

# Bot state (channel->board defaults, discord->account links). On the persistent volume.
BOT_DB_PATH=/mnt/data/questboard-bot.sqlite

# MUST match the value in /etc/gamified-kanban/api.env  (openssl rand -hex 32)
BOT_REDEEM_SECRET=replace-with-openssl-rand-hex-32
```

- [ ] **Step 3: Add `BOT_REDEEM_SECRET` to the API env template**

In `deploy/oracle/api.env.example`, append:

```bash

# Shared secret the Discord bot uses to call POST /api/bot/discord/redeem.
# MUST match /etc/gamified-kanban/bot.env. Generate once:  openssl rand -hex 32
BOT_REDEEM_SECRET=replace-with-openssl-rand-hex-32
```

- [ ] **Step 4: Back up the bot DB too**

In `deploy/oracle/backup-db.sh`, after the existing `sqlite3 "$DB" ".backup ..."` + `gzip` lines for the main DB, add:

```bash
# Bot state DB (best-effort — absent until the bot is deployed).
BOT_DB="${BOT_DB_PATH:-/mnt/data/questboard-bot.sqlite}"
if [ -f "$BOT_DB" ]; then
  sqlite3 "$BOT_DB" ".backup '$DEST/questboard-bot-$stamp.sqlite'"
  gzip -f "$DEST/questboard-bot-$stamp.sqlite"
fi
```

And extend the prune line to also prune the bot backups:

```bash
ls -1t "$DEST"/questboard-bot-*.sqlite.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --
```

- [ ] **Step 5: Document the Discord app setup + deploy steps**

In `deploy/oracle/SETUP.md`, add a new section (before the troubleshooting table):

```markdown
## Discord bot (optional)

### One-time: create the Discord application

1. <https://discord.com/developers/applications> → **New Application**, name it "Questboard".
   Copy the **Application ID** → `DISCORD_CLIENT_ID`.
2. **Bot** tab → **Add Bot** → **Reset Token** → copy → `DISCORD_TOKEN`.
   This is a secret: it goes only in `/etc/gamified-kanban/bot.env`.
3. Leave **all** Privileged Gateway Intents **off** (Message Content, Presence, Server Members).
4. **OAuth2 → URL Generator** → scopes `bot` + `applications.commands` →
   bot permissions: **Send Messages**, **Embed Links**, **Use Slash Commands**.
   Open the generated URL, pick your server, authorize.
5. Generate the shared redeem secret and put the SAME value in both env files:
   `openssl rand -hex 32` → `BOT_REDEEM_SECRET` in `/etc/gamified-kanban/api.env`
   and `/etc/gamified-kanban/bot.env`. Restart the API after editing its env file.

### Install and run the bot

```bash
sudo cp /opt/gamified-kanban/deploy/oracle/bot.env.example /etc/gamified-kanban/bot.env
sudo nano /etc/gamified-kanban/bot.env      # fill in the values above
sudo chown root:kanban /etc/gamified-kanban/bot.env && sudo chmod 640 /etc/gamified-kanban/bot.env

cd /opt/gamified-kanban/discord && sudo -u kanban npm ci
# register slash commands (guild-scoped first for instant availability):
sudo -u kanban env $(grep -v '^#' /etc/gamified-kanban/bot.env | xargs) npm run register

sudo cp /opt/gamified-kanban/deploy/oracle/questboard-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now questboard-bot
journalctl -u questboard-bot -n 30 --no-pager
```

Once verified, drop `DISCORD_DEV_GUILD_ID` from the env file and re-run
`npm run register` to publish the commands globally.
```

Also update the existing "Updating a deployment" block to:

```bash
cd /opt/gamified-kanban && sudo -u kanban git pull
cd backend && sudo -u kanban npm ci
cd ../discord && sudo -u kanban npm ci        # if the bot is installed
sudo systemctl restart gamified-kanban-api questboard-bot
# only if slash-command definitions changed:
cd /opt/gamified-kanban/discord && sudo -u kanban env $(grep -v '^#' /etc/gamified-kanban/bot.env | xargs) npm run register
```

- [ ] **Step 6: Add CI**

Create `.github/workflows/test.yml`:

```yaml
name: test
on:
  push:
  pull_request:

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
        working-directory: backend
      - run: npm test
        working-directory: backend

  discord-bot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - run: npm ci
        working-directory: discord
      - run: npm test
        working-directory: discord
```

- [ ] **Step 7: Verify both suites pass locally one more time**

Run: `cd backend && npm test && cd ../discord && npm test`
Expected: both green.

- [ ] **Step 8: Commit**

```bash
git add deploy/oracle/questboard-bot.service deploy/oracle/bot.env.example deploy/oracle/api.env.example deploy/oracle/backup-db.sh deploy/oracle/SETUP.md .github/workflows/test.yml
git commit -m "chore(deploy): systemd unit, env templates, backups, and CI for the Discord bot"
```

---

## Self-Review

**1. Spec coverage**

| Spec section | Task(s) |
|---|---|
| `integration_tokens`, `discord_link_codes` tables | 1 |
| `authMiddleware` opaque-token branch + `req.authKind` | 2 |
| read-only guard on resource routers | 2 |
| `verifyBotSecret` timing-safe helper | 2 |
| `POST /api/integrations/discord/link-code` | 3 |
| `GET /api/integrations/discord/status` (connected/not only) | 3 |
| `DELETE /api/integrations/discord/link` | 3 |
| `POST /api/bot/discord/redeem` (non-overlapping prefix) | 4 |
| bot repo layout, `store.js` (`channel_boards`, `discord_links`) | 5 |
| `api.js` thin REST wrapper + typed errors | 6 |
| `format.js` pure formatters + truncation | 7 |
| `/questboard link\|unlink\|use\|whichboard` | 8 |
| `/tasks` (status/assignee/sprint/board, autocomplete, truncation footer) | 7 + 9 |
| `/mine` across the user's boards, team membership | 9 |
| `/standup` public, In Progress / Done-24h / Blocked | 10 |
| `/sprint` active sprint via API-derived `is_active` | 10 |
| autocomplete cache ~30s | **Deferred** — see note below |
| gateway client, non-privileged `Guilds` intent, graceful shutdown | 11 |
| `register.js` guild vs global | 11 |
| frontend "Connect Discord" panel, poll every 5s, countdown | 12 |
| new `account/settings` route + nav link (spec said "no router change"; corrected — no user-level settings route existed) | 12 |
| `questboard-bot.service`, `bot.env`, `/etc/gamified-kanban/` path | 13 |
| `BOT_REDEEM_SECRET` in both env files | 13 |
| backup script covers bot DB | 13 |
| SETUP.md Discord app runbook + deploy steps | 13 |
| CI runs both suites (repo had none) | 13 |
| link flow end-to-end | 3 + 4 + 8 (+ 12 Step 6 manual) |
| failure-mode messages (bad code, API down, revoked mid-session, no board, no access) | 8, 9, 10 (`_shared.loadBoard`) |
| threat model (secret handling, read-only enforcement, single-use codes) | 2, 4, 13 |

**Deferred with reason:** the spec's "autocomplete results cached per `(discordUserId, board)` for ~30s". Left out of v1 tasks to keep the command modules simple and their tests hermetic; boards are small and Discord already debounces autocomplete keystrokes server-side. If it proves chatty in practice, add a tiny TTL `Map` cache inside `_shared.js`/`tasks.js` — no interface change. Noted here so it is a conscious cut, not a gap.

**2. Placeholder scan:** No `TBD`/`TODO`/"handle edge cases"/"similar to Task N". Every code and test step has literal content. The `_shared.js` helper is fully written in Task 10 and only referenced (not re-pasted) in later tasks' prose, but its interface block names every export and signature.

**3. Type consistency:**
- `ctx` shape: defined in Task 8 (`context.js`), consumed identically in Tasks 9–11. `ctx.opt(name)`, `ctx.link()`, `ctx.reply`, `ctx.replyPublic`, `ctx.store`, `ctx.api`, `ctx.channelId`, `ctx.discordUserId`, `ctx.sub` — consistent throughout.
- Command module default export shape `{ name, data, execute, autocomplete? }` — consistent Tasks 8–11; `commands/index.js` (Task 11) maps over `.name`.
- `api` methods: `getBoards(token)`, `getBoard(token, id)`, `redeemCode({code, discordUserId})`, `unlink(token)` — defined Task 6 (+ `unlink` added Task 8 Step 1), used with those exact signatures in Tasks 8–10.
- Error classes `NotLinkedError` / `ForbiddenError` / `ApiUnreachableError` — defined Task 6, imported by name in Tasks 9 and 10.
- `store` methods — defined Task 5, used verbatim in Tasks 8–11.
- `formatMine` — Task 7 defines it, Task 9 Step 4 **revises** it (drop the internal `done` re-filter) and says to re-run the Task 7 test; the revised version is fully pasted. Consistent after Task 9.
- Backend: `req.authKind` values `"user"` / `"integration"` — set in Task 2 (`auth.js`), read in Task 2 (`integrationReadOnly`). `integration_tokens` columns match between Task 1 schema, Task 2 middleware, Task 3 status query, Task 4 insert.
- `expiresAt` is an ISO string in the API response (Task 3) and parsed with `Date.parse` in the frontend (Task 12) — consistent.

No inconsistencies found.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-09-03-discord-bot.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
