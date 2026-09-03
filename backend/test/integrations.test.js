import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
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
