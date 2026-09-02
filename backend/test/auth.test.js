import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

test("email is case-insensitive for registration uniqueness", async () => {
  const first = await request(app).post("/api/auth/register").send({
    email: "Case.Test@Example.com",
    password: "pw-123456",
    displayName: "Case Test",
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.user.email, "case.test@example.com");

  const dup = await request(app).post("/api/auth/register").send({
    email: "case.test@example.com",
    password: "pw-123456",
    displayName: "Dupe",
  });
  assert.equal(dup.status, 409);

  const dupUpper = await request(app).post("/api/auth/register").send({
    email: "CASE.TEST@EXAMPLE.COM",
    password: "pw-123456",
    displayName: "Dupe Upper",
  });
  assert.equal(dupUpper.status, 409);
});

test("login accepts any casing of the registered email", async () => {
  await registerUser(app, { email: "login.case@example.com", password: "pw-123456" });

  const res = await request(app).post("/api/auth/login").send({
    email: "  Login.Case@EXAMPLE.com  ",
    password: "pw-123456",
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, "login.case@example.com");
  assert.ok(res.body.token);
});

test("an invitation is accepted by the same address in a different casing", async () => {
  const owner = await registerUser(app, { email: "owner.inv@example.com" });
  const board = (
    await request(app).post("/api/boards").set(authHeader(owner.token)).send({ name: "B" })
  ).body;

  const invite = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(owner.token))
    .send({ email: "Friend.Inv@Example.com" });
  assert.equal(invite.status, 200);

  // Account registers with yet another casing of the same address.
  const friend = await registerUser(app, { email: "FRIEND.INV@example.com" });

  const accept = await request(app)
    .post(`/api/boards/invitations/${invite.body.token}/accept`)
    .set(authHeader(friend.token));
  assert.equal(accept.status, 200);
  assert.equal(accept.body.boardId, board.id);

  const members = (
    await request(app).get(`/api/boards/${board.id}/members`).set(authHeader(owner.token))
  ).body;
  assert.ok(members.some((m) => m.email === "friend.inv@example.com"));
});
