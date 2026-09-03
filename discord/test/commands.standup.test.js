import test from "node:test";
import assert from "node:assert/strict";
import { tempStore, fakeCtx } from "./helpers.js";
import { board as fixture } from "./fixtures/board.js";
import standupCmd from "../src/commands/standup.js";
import sprintCmd from "../src/commands/sprint.js";

const api = { async getBoard() { return fixture; }, async getBoards() { return [{ id: "board_1", name: "Questboard" }]; } };

test("/standup replies publicly with the standup text", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const ctx = fakeCtx({ store, api, _opts: {} });
  await standupCmd.execute(ctx);
  assert.equal(ctx.replies[0].ephemeral, false);
  assert.match(ctx.replies[0].p, /\*\*Standup — Questboard\*\*/);
});

test("/sprint replies ephemerally with the active sprint embed", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const ctx = fakeCtx({ store, api, _opts: {} });
  await sprintCmd.execute(ctx);
  assert.equal(ctx.replies[0].ephemeral, true);
  assert.match(JSON.stringify(ctx.replies[0].p.embeds[0]), /Sprint 1/);
});

test("/standup with no board set nudges", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  const ctx = fakeCtx({ store, api, _opts: {} });
  await standupCmd.execute(ctx);
  assert.match(ctx.replies[0].p, /No board set/i);
});
