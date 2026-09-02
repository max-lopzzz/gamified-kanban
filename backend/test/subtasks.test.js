import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

let n = 0;
async function boardWithTask() {
  n += 1;
  const { token } = await registerUser(app, { email: `sub${n}@x.com` });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "parent", storyPoints: 2 })
  ).body;
  return { token, board, task };
}

test("subtasks: create, list via board fetch, delete", async () => {
  const { token, board, task } = await boardWithTask();

  const a = (
    await request(app)
      .post("/api/subtasks")
      .set(authHeader(token))
      .send({ taskId: task.id, title: "step one" })
  ).body;
  assert.equal(a.title, "step one");
  assert.equal(a.done, 0);

  await request(app)
    .post("/api/subtasks")
    .set(authHeader(token))
    .send({ taskId: task.id, title: "step two" });

  let fetched = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks.find((t) => t.id === task.id);
  assert.equal(fetched.subtasks.length, 2);
  assert.deepEqual(
    fetched.subtasks.map((s) => s.title),
    ["step one", "step two"]
  );

  await request(app)
    .delete(`/api/subtasks/${a.id}`)
    .set(authHeader(token));
  fetched = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks.find((t) => t.id === task.id);
  assert.equal(fetched.subtasks.length, 1);
});

test("checking the last subtask completes the task and awards XP", async () => {
  const { token, board, task } = await boardWithTask();
  const s1 = (
    await request(app)
      .post("/api/subtasks")
      .set(authHeader(token))
      .send({ taskId: task.id, title: "one" })
  ).body;
  const s2 = (
    await request(app)
      .post("/api/subtasks")
      .set(authHeader(token))
      .send({ taskId: task.id, title: "two" })
  ).body;

  const first = await request(app)
    .patch(`/api/subtasks/${s1.id}`)
    .set(authHeader(token))
    .send({ done: true });
  assert.equal(first.body.taskCompleted, false);

  let boardTask = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks.find((t) => t.id === task.id);
  assert.equal(boardTask.status, "backlog");

  const xpBefore = (
    await request(app).get("/api/users/me").set(authHeader(token))
  ).body.xp;

  const last = await request(app)
    .patch(`/api/subtasks/${s2.id}`)
    .set(authHeader(token))
    .send({ done: true });
  assert.equal(last.body.taskCompleted, true);
  assert.ok(last.body.gamification && last.body.gamification.xpGained > 0);

  boardTask = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body.tasks.find((t) => t.id === task.id);
  assert.equal(boardTask.status, "done");

  const xpAfter = (
    await request(app).get("/api/users/me").set(authHeader(token))
  ).body.xp;
  assert.ok(xpAfter > xpBefore);
});

test("subtask routes 403 for a non-member, 404 for an unknown id", async () => {
  const { token, task } = await boardWithTask();
  const sub = (
    await request(app)
      .post("/api/subtasks")
      .set(authHeader(token))
      .send({ taskId: task.id, title: "x" })
  ).body;

  const outsider = await registerUser(app, { email: `sub-out${n}@x.com` });
  const forbidden = await request(app)
    .patch(`/api/subtasks/${sub.id}`)
    .set(authHeader(outsider.token))
    .send({ done: true });
  assert.equal(forbidden.status, 403);

  const missing = await request(app)
    .patch("/api/subtasks/sub_nope")
    .set(authHeader(token))
    .send({ done: true });
  assert.equal(missing.status, 404);
});
