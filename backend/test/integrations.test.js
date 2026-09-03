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

test("a redeemed token stops working after the user unlinks", async () => {
  const { token: jwt } = await registerUser(app, { email: "revoke@x.com" });
  const jwtAuth = { Authorization: `Bearer ${jwt}` };
  const code = (await request(app).post("/api/integrations/discord/link-code").set(jwtAuth)).body.code;
  const qbit = (await request(app).post("/api/bot/discord/redeem").set(BOT).send({ code, discordUserId: "z" })).body.token;

  const before = await request(app).get("/api/boards").set({ Authorization: `Bearer ${qbit}` });
  assert.equal(before.status, 200);

  await request(app).delete("/api/integrations/discord/link").set(jwtAuth);

  const after = await request(app).get("/api/boards").set({ Authorization: `Bearer ${qbit}` });
  assert.equal(after.status, 401);
});

test("a qbit_ token cannot read a board the user is not a member of", async () => {
  const { token: jwtA } = await registerUser(app, { email: "tenantA@x.com" });
  const { token: jwtB } = await registerUser(app, { email: "tenantB@x.com" });
  const boardB = (await request(app).post("/api/boards").set({ Authorization: `Bearer ${jwtB}` }).send({ name: "B private" })).body;

  const code = (await request(app).post("/api/integrations/discord/link-code").set({ Authorization: `Bearer ${jwtA}` })).body.code;
  const qbitA = (await request(app).post("/api/bot/discord/redeem").set(BOT).send({ code, discordUserId: "a" })).body.token;

  const res = await request(app).get(`/api/boards/${boardB.id}`).set({ Authorization: `Bearer ${qbitA}` });
  assert.ok(res.status === 403 || res.status === 404, `expected 403/404, got ${res.status}`);
});
