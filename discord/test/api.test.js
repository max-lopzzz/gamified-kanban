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
