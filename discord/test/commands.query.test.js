import test from "node:test";
import assert from "node:assert/strict";
import { tempStore, fakeCtx } from "./helpers.js";
import { board as fixture } from "./fixtures/board.js";
import tasksCmd from "../src/commands/tasks.js";
import mineCmd from "../src/commands/mine.js";
import { ForbiddenError } from "../src/api.js";

const apiOk = {
  async getBoards() { return [{ id: "board_1", name: "Questboard" }]; },
  async getBoard() { return fixture; },
};

test("/tasks uses the channel default board and renders an embed", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const ctx = fakeCtx({ store, api: apiOk, _opts: {} });
  await tasksCmd.execute(ctx);
  const payload = ctx.replies[0].p;
  assert.ok(payload.embeds[0].fields.some((f) => f.name.startsWith("In Progress")));
});

test("/tasks with no board set nudges the user", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  const ctx = fakeCtx({ store, api: apiOk, _opts: {} });
  await tasksCmd.execute(ctx);
  assert.match(ctx.replies[0].p, /No board set/i);
});

test("/tasks surfaces a Forbidden as a friendly message", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const api = { ...apiOk, async getBoard() { throw new ForbiddenError("403"); } };
  const ctx = fakeCtx({ store, api, _opts: {} });
  await tasksCmd.execute(ctx);
  assert.match(ctx.replies[0].p, /don't have access/i);
});

test("/mine filters to the caller's own tasks across boards", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  const ctx = fakeCtx({ store, api: apiOk, _opts: {} });
  await mineCmd.execute(ctx);
  const embed = ctx.replies[0].p.embeds[0];
  assert.match(JSON.stringify(embed), /Wire up auth/);   // u_max, in-progress
  assert.doesNotMatch(JSON.stringify(embed), /Design schema/); // u_mor's
});
