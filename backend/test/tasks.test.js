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

async function boardCtx(tag) {
  const { token, user } = await registerUser(app, {
    email: uniqueEmail(`t-${tag}`),
  });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  return { token, user, board };
}

test("task create stores dependencyIds and board fetch returns shaped dependencies", async () => {
  const { token, board } = await boardCtx("1");

  const a = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "A" })
  ).body;
  const b = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "B", dependencyIds: [a.id] })
  ).body;

  const fetched = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(fetched.dependencies, undefined);
  const bt = fetched.tasks.find((x) => x.id === b.id);
  assert.deepEqual(bt.dependencies, [{ id: a.id, title: "A" }]);
  const at = fetched.tasks.find((x) => x.id === a.id);
  assert.deepEqual(at.dependencies, []);
});

test("task PATCH replaces dependencyIds", async () => {
  const { token, board } = await boardCtx("2");
  const a = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "A" })
  ).body;
  const b = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "B" })
  ).body;
  const c = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "C", dependencyIds: [a.id] })
  ).body;

  await request(app)
    .patch(`/api/tasks/${c.id}`)
    .set(authHeader(token))
    .send({ dependencyIds: [b.id] });

  const fetched = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  const ct = fetched.tasks.find((x) => x.id === c.id);
  assert.deepEqual(ct.dependencies.map((d) => d.id), [b.id]);
});

test("task create round-trips assignee_type and team_id", async () => {
  const { token, board } = await boardCtx("3");
  const team = (
    await request(app)
      .post("/api/teams")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "T" })
  ).body;

  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "X", assigneeType: "team", teamId: team.id })
  ).body;

  assert.equal(task.assignee_type, "team");
  assert.equal(task.team_id, team.id);
});
