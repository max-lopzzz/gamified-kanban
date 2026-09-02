import test, { after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { makeApp, registerUser, authHeader } from "./helpers.js";

const { app, cleanup } = await makeApp();
after(cleanup);

let uniqueCounter = 0;
function uniqueEmail(prefix) {
  uniqueCounter += 1;
  return `${prefix}${Date.now()}_${uniqueCounter}@x.com`;
}

async function setupBoardWithSprint(app) {
  const { token } = await registerUser(app, { email: uniqueEmail("u") });
  const board = (
    await request(app).post("/api/boards").set(authHeader(token)).send({ name: "B" })
  ).body;
  const s1 = (
    await request(app)
      .post("/api/sprints")
      .set(authHeader(token))
      .send({ boardId: board.id, name: "S1" })
  ).body;
  return { token, board, s1 };
}

test("PATCH /api/sprints/:id updates fields", async () => {
  const { token, s1 } = await setupBoardWithSprint(app);

  const res = await request(app)
    .patch(`/api/sprints/${s1.id}`)
    .set(authHeader(token))
    .send({ name: "S1 renamed", goal: "ship it" });

  assert.equal(res.status, 200);
  assert.equal(res.body.name, "S1 renamed");
  assert.equal(res.body.goal, "ship it");
});

function isoDaysFromNow(n) {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

test("a sprint whose date window contains today is active; others are not", async () => {
  const { token, board } = await setupBoardWithSprint(app); // s1 has no dates

  const current = (
    await request(app)
      .post("/api/sprints")
      .set(authHeader(token))
      .send({
        boardId: board.id,
        name: "current",
        startsAt: isoDaysFromNow(-2),
        endsAt: isoDaysFromNow(5),
      })
  ).body;

  await request(app)
    .post("/api/sprints")
    .set(authHeader(token))
    .send({
      boardId: board.id,
      name: "past",
      startsAt: isoDaysFromNow(-30),
      endsAt: isoDaysFromNow(-20),
    });

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  const active = list.filter((s) => s.is_active);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, current.id);
});

test("when two windows overlap today, the later-starting sprint wins", async () => {
  const { token, board } = await setupBoardWithSprint(app);

  await request(app)
    .post("/api/sprints")
    .set(authHeader(token))
    .send({
      boardId: board.id,
      name: "wide",
      startsAt: isoDaysFromNow(-10),
      endsAt: isoDaysFromNow(10),
    });
  const newer = (
    await request(app)
      .post("/api/sprints")
      .set(authHeader(token))
      .send({
        boardId: board.id,
        name: "newer",
        startsAt: isoDaysFromNow(-1),
        endsAt: isoDaysFromNow(3),
      })
  ).body;

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  const active = list.filter((s) => s.is_active);
  assert.equal(active.length, 1);
  assert.equal(active[0].id, newer.id);
});

test("PATCH /api/sprints/:id 404 for unknown sprint", async () => {
  const { token } = await setupBoardWithSprint(app);
  const res = await request(app)
    .patch("/api/sprints/sprint_nope")
    .set(authHeader(token))
    .send({ name: "x" });
  assert.equal(res.status, 404);
});

test("DELETE /api/sprints/:id removes it and nulls task.sprint_id", async () => {
  const { token, board, s1 } = await setupBoardWithSprint(app);
  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "T", sprintId: s1.id })
  ).body;

  const del = await request(app)
    .delete(`/api/sprints/${s1.id}`)
    .set(authHeader(token));
  assert.equal(del.status, 200);

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(list.length, 0);

  const board2 = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  const t2 = board2.tasks.find((x) => x.id === task.id);
  assert.equal(t2.sprint_id, null);
});

test("DELETE /api/sprints/:id keeps its tasks with sprint_id nulled (explicit cleanup)", async () => {
  const { token, board, s1 } = await setupBoardWithSprint(app);
  const task = (
    await request(app)
      .post("/api/tasks")
      .set(authHeader(token))
      .send({ boardId: board.id, title: "carry-over", sprintId: s1.id })
  ).body;

  const del = await request(app)
    .delete(`/api/sprints/${s1.id}`)
    .set(authHeader(token));
  assert.equal(del.status, 200);
  assert.deepEqual(del.body, { ok: true });

  const sprints = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  assert.equal(sprints.find((s) => s.id === s1.id), undefined);

  const board2 = (
    await request(app).get(`/api/boards/${board.id}`).set(authHeader(token))
  ).body;
  const t2 = board2.tasks.find((x) => x.id === task.id);
  assert.ok(t2, "task should still exist after its sprint is deleted");
  assert.equal(t2.sprint_id, null);
});

test("DELETE /api/sprints/:id 403 for a non-member", async () => {
  const { s1 } = await setupBoardWithSprint(app);
  const outsider = await registerUser(app, { email: uniqueEmail("out") });
  const res = await request(app)
    .delete(`/api/sprints/${s1.id}`)
    .set(authHeader(outsider.token));
  assert.equal(res.status, 403);
});

test("POST /api/sprints persists goal", async () => {
  const { token, board } = await setupBoardWithSprint(app);

  const res = await request(app)
    .post("/api/sprints")
    .set(authHeader(token))
    .send({ boardId: board.id, name: "S-goal", goal: "ship it" });

  assert.equal(res.status, 200);
  assert.equal(res.body.goal, "ship it");

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  const fetched = list.find((s) => s.id === res.body.id);
  assert.equal(fetched.goal, "ship it");
});

test("a dateless sprint is never auto-active", async () => {
  const { token, board, s1 } = await setupBoardWithSprint(app);

  const list = (
    await request(app).get(`/api/sprints/board/${board.id}`).set(authHeader(token))
  ).body;
  const s = list.find((x) => x.id === s1.id);
  assert.equal(s.is_active, 0);
});

test("GET /api/sprints/board/:boardId returns sprints without error", async () => {
  const { token, board } = await setupBoardWithSprint(app);
  await request(app)
    .post("/api/sprints")
    .set(authHeader(token))
    .send({ boardId: board.id, name: "S2", startsAt: "2026-01-01" });

  const res = await request(app)
    .get(`/api/sprints/board/${board.id}`)
    .set(authHeader(token));
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
});
