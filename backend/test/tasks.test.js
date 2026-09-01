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

test("POST /api/tasks 403 for a non-member of the board", async () => {
  const { token, board } = await boardCtx("authz-post");
  const outsider = await registerUser(app, { email: uniqueEmail("out") });

  const res = await request(app)
    .post("/api/tasks")
    .set(authHeader(outsider.token))
    .send({ boardId: board.id, title: "injected" });

  assert.equal(res.status, 403);

  // nothing was written to the board
  const tasks = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks;
  assert.equal(tasks.find((t) => t.title === "injected"), undefined);

  // a board member can still create
  const ok = await request(app)
    .post("/api/tasks")
    .set(authHeader(token))
    .send({ boardId: board.id, title: "legit" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.title, "legit");
});

test("task write routes 403 for a non-member, 200 for a member", async () => {
  const { token, board } = await boardCtx("authz-rw");
  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "private" })
  ).body;

  const outsider = await registerUser(app, { email: uniqueEmail("out") });

  const patched = await request(app)
    .patch(`/api/tasks/${task.id}`)
    .set(authHeader(outsider.token))
    .send({ title: "pwned" });
  assert.equal(patched.status, 403);

  const moved = await request(app)
    .patch(`/api/tasks/${task.id}/move`)
    .set(authHeader(outsider.token))
    .send({ status: "done", position: 0 });
  assert.equal(moved.status, 403);

  const deleted = await request(app)
    .delete(`/api/tasks/${task.id}`)
    .set(authHeader(outsider.token));
  assert.equal(deleted.status, 403);

  // the task is untouched
  const stillThere = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks.find((t) => t.id === task.id);
  assert.ok(stillThere);
  assert.equal(stillThere.title, "private");
  assert.equal(stillThere.status, "backlog");

  // a real member still succeeds on all three
  const memberPatch = await request(app)
    .patch(`/api/tasks/${task.id}`)
    .set(authHeader(token))
    .send({ title: "renamed" });
  assert.equal(memberPatch.status, 200);
  assert.equal(memberPatch.body.title, "renamed");

  const memberMove = await request(app)
    .patch(`/api/tasks/${task.id}/move`)
    .set(authHeader(token))
    .send({ status: "done", position: 0 });
  assert.equal(memberMove.status, 200);

  const memberDelete = await request(app)
    .delete(`/api/tasks/${task.id}`)
    .set(authHeader(token));
  assert.equal(memberDelete.status, 200);
});

test("POST /api/tasks with a bogus dependencyId is a 400 and creates nothing", async () => {
  const { token, board } = await boardCtx("dep-400");

  const before = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks.length;

  const res = await request(app)
    .post("/api/tasks")
    .set(authHeader(token))
    .send({ boardId: board.id, title: "orphan", dependencyIds: ["task_bogus"] });

  assert.equal(res.status, 400);
  assert.ok(res.body.error);

  const after = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks;
  assert.equal(after.length, before);
  assert.equal(after.find((t) => t.title === "orphan"), undefined);
});

test("POST /api/tasks rejects a dependency that lives on another board", async () => {
  const a = await boardCtx("dep-cross-a");
  const foreignTask = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(a.token))
      .send({ boardId: a.board.id, title: "foreign" })
  ).body;

  const b = await boardCtx("dep-cross-b");
  const res = await request(app)
    .post("/api/tasks")
    .set(authHeader(b.token))
    .send({
      boardId: b.board.id,
      title: "leaky",
      dependencyIds: [foreignTask.id],
    });

  assert.equal(res.status, 400);
});
