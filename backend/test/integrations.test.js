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
