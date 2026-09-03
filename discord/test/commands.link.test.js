import test from "node:test";
import assert from "node:assert/strict";
import { tempStore, fakeCtx } from "./helpers.js";
import questboard from "../src/commands/link.js";

function apiStub(over = {}) {
  return {
    async redeemCode({ code }) {
      if (code === "good") return { token: "qbit_x", appUserId: "u1", displayName: "Max" };
      throw new Error("invalid_or_expired_code");
    },
    async getBoards() { return [{ id: "b1", name: "Alpha" }, { id: "b2", name: "Beta" }]; },
    async unlink() {},
    ...over,
  };
}

test("link with a good code stores the link and confirms", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const ctx = fakeCtx({ sub: "link", _opts: { code: "good" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /Linked to Questboard as \*\*Max\*\*/);
  assert.equal(store.getLink("d1").integrationToken, "qbit_x");
});

test("link with a bad code explains how to get a new one", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const ctx = fakeCtx({ sub: "link", _opts: { code: "nope" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /invalid or expired/i);
  assert.equal(store.getLink("d1"), null);
});

test("use sets the channel default when the board name matches", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u1", "qbit_x");
  const ctx = fakeCtx({ sub: "use", _opts: { board: "Beta" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.equal(store.getChannelBoard("c1"), "b2");
  assert.match(ctx.replies[0].p, /defaults to \*\*Beta\*\*/);
});

test("use without a link tells the user to link first", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  const ctx = fakeCtx({ sub: "use", _opts: { board: "Beta" }, store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /link/i);
  assert.equal(store.getChannelBoard("c1"), null);
});

test("whichboard reports the current default", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.upsertLink("d1", "u1", "qbit_x");
  store.setChannelBoard("c1", "b1", "d1");
  const ctx = fakeCtx({ sub: "whichboard", store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /Alpha/);
});

test("whichboard with a board set but no link does not leak the raw id", async () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  store.setChannelBoard("c1", "b1", "d1");
  const ctx = fakeCtx({ sub: "whichboard", store, api: apiStub() });
  await questboard.execute(ctx);
  assert.match(ctx.replies[0].p, /link your account/i);
  assert.ok(!ctx.replies[0].p.includes("b1"));
});
