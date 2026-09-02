import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

let uniqueCounter = 0;
function uniqueEmail(prefix) {
  uniqueCounter += 1;
  return `${prefix}${uniqueCounter}@x.com`;
}

async function ownerWithBoard(tag) {
  const { token, user } = await registerUser(app, { email: `own${tag}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("POST /api/teams creates a team with description for the owner", async () => {
  const { token, board } = await ownerWithBoard("a");

  const res = await request(app)
    .post("/api/teams")
    .set(authHeader(token))
    .send({ boardId: board.id, name: "Frontend", description: "UI crew" });

  assert.equal(res.status, 200);
  assert.equal(res.body.name, "Frontend");
  assert.equal(res.body.description, "UI crew");
});

test("POST /api/teams 403 for a non-owner", async () => {
  const { board } = await ownerWithBoard("b");
  const outsider = await registerUser(app, { email: uniqueEmail("nope-b") });

  const res = await request(app)
    .post("/api/teams")
    .set(authHeader(outsider.token))
    .send({ boardId: board.id, name: "X" });

  assert.equal(res.status, 403);
});

test("team member add/remove works for the owner and cascades on delete", async () => {
  const { token, board } = await ownerWithBoard("c");
  const team = (
    await request(app)
      .post("/api/teams")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "T" })
  ).body;
  const member = await registerUser(app, { email: "m-c@x.com" });

  // add the new user to the board first via an accepted invitation
  const invite = (
    await request(app)
      .post(`/api/boards/${board.id}/invitations`)
      .set(authHeader(token))
      .send({ email: "m-c@x.com" })
  ).body;
  await request(app)
    .post(`/api/boards/invitations/${invite.token}/accept`)
    .set(authHeader(member.token));

  const add = await request(app)
    .post(`/api/teams/${team.id}/members`)
    .set(authHeader(token))
    .send({ userId: member.user.id });
  assert.equal(add.status, 200);

  let members = (
    await request(app).get(`/api/teams/${team.id}/members`).set(authHeader(token))
  ).body;
  assert.equal(members.length, 1);

  // the board payload exposes each team's member ids (used by board filters)
  const boardTeams = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.teams;
  const t = boardTeams.find((x) => x.id === team.id);
  assert.deepEqual(t.member_ids, [member.user.id]);

  await request(app).delete(`/api/teams/${team.id}`).set(authHeader(token));
  const list = (
    await request(app).get(`/api/teams/board/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(list.length, 0);
});

test("DELETE /api/teams/:teamId clears members and unassigns its tasks (explicit cleanup)", async () => {
  const { token, user, board } = await ownerWithBoard("e");
  const team = (
    await request(app)
      .post("/api/teams")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "Platform" })
  ).body;

  const add = await request(app)
    .post(`/api/teams/${team.id}/members`)
    .set(authHeader(token))
    .send({ userId: user.id });
  assert.equal(add.status, 200);

  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({
        boardId: board.id,
        title: "team task",
        assigneeType: "team",
        teamId: team.id,
      })
  ).body;

  const del = await request(app)
    .delete(`/api/teams/${team.id}`)
    .set(authHeader(token));
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { ok: true });

  const teams = (
    await request(app).get(`/api/teams/board/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(teams.find((t) => t.id === team.id), undefined);

  const members = await request(app)
    .get(`/api/teams/${team.id}/members`)
    .set(authHeader(token));
  assert.equal(members.status, 404); // team is gone

  const board2 = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  const t2 = board2.tasks.find((x) => x.id === task.id);
  assert.ok(t2, "task should still exist after its team is deleted");
  assert.equal(t2.team_id, null);
  assert.equal(t2.assignee_type, "unassigned");
});

test("GET /api/teams/board/:boardId 403 for a non-member", async () => {
  const { board } = await ownerWithBoard("d");
  const outsider = await registerUser(app, { email: uniqueEmail("nope-d") });
  const res = await request(app)
    .get(`/api/teams/board/${board.id}`)
    .set(authHeader(outsider.token));
  assert.equal(res.status, 403);
});
