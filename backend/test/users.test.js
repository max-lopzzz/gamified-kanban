import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

async function boardWithMember(tag) {
  const owner = await registerUser(app, { email: `lb-owner-${tag}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(owner.token)).send({ name: "B" })
  ).body;

  const member = await registerUser(app, { email: `lb-member-${tag}@x.com` });
  const invite = (
    await request(app)
      .post(`/api/boards/${board.id}/invitations`)
      .set(authHeader(owner.token))
      .send({ email: `lb-member-${tag}@x.com` })
  ).body;
  await request(app)
    .post(`/api/boards/invitations/${invite.token}/accept`)
    .set(authHeader(member.token));

  return { owner, board, member };
}

test("leaderboard?boardId only lists that board's members", async () => {
  const { owner, board } = await boardWithMember("1");
  const outsider = await registerUser(app, { email: "lb-outsider-1@x.com" });

  const res = await request(app)
    .get(`/api/users/leaderboard?boardId=${board.id}`)
    .set(authHeader(owner.token));

  assert.equal(res.status, 200);
  const emails = res.body.map((r) => r.display_name);
  assert.equal(res.body.length, 2); // owner + accepted member
  assert.ok(!emails.includes(outsider.user.displayName));
});

test("removing a board member drops them from that board's leaderboard", async () => {
  const { owner, board, member } = await boardWithMember("2");

  let res = await request(app)
    .get(`/api/users/leaderboard?boardId=${board.id}`)
    .set(authHeader(owner.token));
  assert.equal(res.body.length, 2);

  await request(app)
    .delete(`/api/boards/${board.id}/members/${member.user.id}`)
    .set(authHeader(owner.token));

  res = await request(app)
    .get(`/api/users/leaderboard?boardId=${board.id}`)
    .set(authHeader(owner.token));
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, owner.user.id);
});

test("a non-member cannot read a board's leaderboard", async () => {
  const { board } = await boardWithMember("3");
  const outsider = await registerUser(app, { email: "lb-outsider-3@x.com" });

  const res = await request(app)
    .get(`/api/users/leaderboard?boardId=${board.id}`)
    .set(authHeader(outsider.token));
  assert.equal(res.status, 403);
});

test("leaderboard without boardId is global", async () => {
  const { owner } = await boardWithMember("4");
  const res = await request(app)
    .get("/api/users/leaderboard")
    .set(authHeader(owner.token));
  assert.equal(res.status, 200);
  // every user registered across this file, not just one board
  assert.ok(res.body.length >= 4);
});
