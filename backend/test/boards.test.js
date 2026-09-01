import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

let uniqueCounter = 0;
function uniqueEmail(prefix) {
  uniqueCounter += 1;
  return `${prefix}-${uniqueCounter}@x.com`;
}

async function ownedBoard(tag) {
  const { token, user } = await registerUser(app, {
    email: uniqueEmail(`b-${tag}`),
  });
  const board = (
    await request(app)
      .post("/api/boards")
      .set(authHeader(token))
      .send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("GET /api/boards/:boardId 403 for a non-member, 200 for the owner", async () => {
  const { token, board } = await ownedBoard("read");
  const outsider = await registerUser(app, { email: uniqueEmail("out") });

  const denied = await request(app)
    .get(`/api/boards/${board.id}`)
    .set(authHeader(outsider.token));
  assert.equal(denied.status, 403);

  const allowed = await request(app)
    .get(`/api/boards/${board.id}`)
    .set(authHeader(token));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.id, board.id);
});

test("GET /api/boards/:boardId/members 403 for a non-member, 200 for the owner", async () => {
  const { token, board } = await ownedBoard("members");
  const outsider = await registerUser(app, { email: uniqueEmail("out") });

  const denied = await request(app)
    .get(`/api/boards/${board.id}/members`)
    .set(authHeader(outsider.token));
  assert.equal(denied.status, 403);

  const allowed = await request(app)
    .get(`/api/boards/${board.id}/members`)
    .set(authHeader(token));
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.length, 1);
});

test("GET /api/boards only lists boards the caller owns or belongs to", async () => {
  const { board } = await ownedBoard("list");
  const outsider = await registerUser(app, { email: uniqueEmail("out") });

  const list = (
    await request(app).get("/api/boards").set(authHeader(outsider.token))
  ).body;
  assert.equal(list.find((b) => b.id === board.id), undefined);
});
