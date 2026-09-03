import test from "node:test";
import assert from "node:assert/strict";
import { buildContext } from "../src/context.js";
import tasksCmd from "../src/commands/tasks.js";
import { tempStore } from "./helpers.js";
import { board as fixture } from "./fixtures/board.js";

function fakeInteraction(overrides = {}) {
  const calls = [];
  return {
    calls,
    user: { id: "d1" },
    channelId: "c1",
    options: {
      getSubcommand: () => null,
      getString: (name) => overrides.opts?.[name] ?? null,
    },
    reply: async (payload) => { calls.push(payload); },
    ...overrides,
  };
}

test("buildContext sends a flat embed payload (no double-wrap) for /tasks", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u_max", "qbit_x");
  store.setChannelBoard("c1", "board_1", "d1");
  const api = { async getBoard() { return fixture; }, async getBoards() { return [{ id: "board_1", name: "Questboard" }]; } };
  const interaction = fakeInteraction();
  const ctx = buildContext(interaction, { store, api });
  await tasksCmd.execute(ctx);
  const payload = interaction.calls[0];
  assert.ok(Array.isArray(payload.embeds), "payload.embeds is an array");
  assert.ok(payload.embeds[0].title, "embeds[0] has a title (not a nested {embeds:[...]})");
  assert.ok(!payload.embeds[0].embeds, "embeds[0] is not itself a wrapper");
});

test("buildContext wraps a plain string as { content } for a link reply", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const api = { async redeemCode() { throw new Error("bad"); } };
  const interaction = fakeInteraction({ opts: { code: "nope" } });
  interaction.options.getSubcommand = () => "link";
  const ctx = buildContext(interaction, { store, api });
  const questboard = (await import("../src/commands/link.js")).default;
  await questboard.execute(ctx);
  const payload = interaction.calls[0];
  assert.equal(typeof payload.content, "string");
  assert.ok(!payload.embeds);
});
