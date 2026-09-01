import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

async function makeBoard(token, name = "B") {
  const res = await request(app)
    .post("/api/boards")
    .set(authHeader(token))
    .send({ name });
  assert.equal(res.status, 200);
  return res.body;
}

test("owner deletes a board with tasks, deps, team, member, sprint, invitation; siblings untouched", async () => {
  const { token: ownerToken } = await registerUser(app, {
    email: "bd-owner@x.com",
  });

  // ---- board to be deleted, fully populated ----
  const board = await makeBoard(ownerToken, "Doomed");

  const taskA = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(ownerToken))
      .send({ boardId: board.id, title: "A" })
  ).body;

  const taskB = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(ownerToken))
      .send({ boardId: board.id, title: "B" })
  ).body;

  // taskA depends on taskB -> task_dependencies row
  const depRes = await request(app)
    .patch(`/api/tasks/${taskA.id}`)
    .set(authHeader(ownerToken))
    .send({ dependencyIds: [taskB.id] });
  assert.equal(depRes.status, 200);

  // team + member -> teams + team_members rows
  const team = (
    await request(app)
      .post("/api/teams")
      .set(authHeader(ownerToken))
      .send({ boardId: board.id, name: "Crew" })
  ).body;

  const member = await registerUser(app, { email: "bd-member@x.com" });
  const invite = (
    await request(app)
      .post(`/api/boards/${board.id}/invitations`)
      .set(authHeader(ownerToken))
      .send({ email: "bd-member@x.com" })
  ).body;
  const acceptRes = await request(app)
    .post(`/api/boards/invitations/${invite.token}/accept`)
    .set(authHeader(member.token));
  assert.equal(acceptRes.status, 200); // -> board_members row for the invitee

  const addRes = await request(app)
    .post(`/api/teams/${team.id}/members`)
    .set(authHeader(ownerToken))
    .send({ userId: member.user.id });
  assert.equal(addRes.status, 200);

  // sprint -> sprints row
  const sprintRes = await request(app)
    .post("/api/sprints")
    .set(authHeader(ownerToken))
    .send({ boardId: board.id, name: "S1" });
  assert.equal(sprintRes.status, 200);

  // a second, still-pending invitation -> board_invitations row
  const pendingInvite = await request(app)
    .post(`/api/boards/${board.id}/invitations`)
    .set(authHeader(ownerToken))
    .send({ email: "bd-pending@x.com" });
  assert.equal(pendingInvite.status, 200);

  // ---- sibling board owned by the same owner, must survive ----
  const sibling = await makeBoard(ownerToken, "Survivor");
  const siblingTask = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(ownerToken))
      .send({ boardId: sibling.id, title: "keep me" })
  ).body;

  // ---- delete ----
  const del = await request(app)
    .delete(`/api/boards/${board.id}`)
    .set(authHeader(ownerToken));
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { ok: true });

  // board no longer listed / fetchable
  const list = (
    await request(app).get("/api/boards").set(authHeader(ownerToken))
  ).body;
  assert.ok(!list.some((b) => b.id === board.id), "deleted board still listed");
  assert.ok(
    list.some((b) => b.id === sibling.id),
    "sibling board missing from list"
  );

  const getDeleted = await request(app)
    .get(`/api/boards/${board.id}`)
    .set(authHeader(ownerToken));
  assert.equal(getDeleted.status, 404);

  // sibling board + its task untouched
  const getSibling = await request(app)
    .get(`/api/boards/${sibling.id}`)
    .set(authHeader(ownerToken));
  assert.equal(getSibling.status, 200);
  assert.ok(
    getSibling.body.tasks.some((t) => t.id === siblingTask.id),
    "sibling task was deleted"
  );
});

test("non-owner cannot delete the board (403, board survives)", async () => {
  const { token: ownerToken } = await registerUser(app, {
    email: "bd-owner2@x.com",
  });
  const board = await makeBoard(ownerToken, "Guarded");

  const outsider = await registerUser(app, { email: "bd-outsider@x.com" });
  const del = await request(app)
    .delete(`/api/boards/${board.id}`)
    .set(authHeader(outsider.token));
  assert.equal(del.status, 403);

  const stillThere = await request(app)
    .get(`/api/boards/${board.id}`)
    .set(authHeader(ownerToken));
  assert.equal(stillThere.status, 200);
});

test("deleting a missing board returns 404", async () => {
  const { token } = await registerUser(app, { email: "bd-owner3@x.com" });
  const del = await request(app)
    .delete("/api/boards/board_does_not_exist")
    .set(authHeader(token));
  assert.equal(del.status, 404);
});
