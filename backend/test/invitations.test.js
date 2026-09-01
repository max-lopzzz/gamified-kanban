import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

async function ownerBoard(tag) {
  const { token, user } = await registerUser(app, { email: `o-${tag}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("invite -> accept adds the invitee as a board member", async () => {
  const { token, board } = await ownerBoard("1");
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

test("GET invitations lists pending ones without error", async () => {
  const { token, board } = await ownerBoard("2");
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

test("duplicate pending invitation is rejected with 409", async () => {
  const { token, board } = await ownerBoard("3");
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

test("non-owner cannot invite", async () => {
  const { board } = await ownerBoard("4");
  const outsider = await registerUser(app, { email: `out-4@x.com` });
  const res = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(outsider.token))
    .send({ email: "whoever@x.com" });
  assert.equal(res.status, 403);
});

test("accepting with a mismatched email is rejected", async () => {
  const { token, board } = await ownerBoard("5");
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
