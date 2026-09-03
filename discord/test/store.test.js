import test from "node:test";
import assert from "node:assert/strict";
import { tempStore } from "./helpers.js";

test("channel board default: set / get / overwrite", () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  assert.equal(store.getChannelBoard("chan1"), null);
  store.setChannelBoard("chan1", "board_A", "disc_1");
  assert.equal(store.getChannelBoard("chan1"), "board_A");
  store.setChannelBoard("chan1", "board_B", "disc_2");
  assert.equal(store.getChannelBoard("chan1"), "board_B");
});

test("discord link: upsert / get / delete", () => {
  const { store, cleanup } = tempStore();
  test.after(cleanup);
  assert.equal(store.getLink("d1"), null);
  store.upsertLink("d1", "user_1", "qbit_aaa");
  assert.deepEqual(store.getLink("d1"), {
    discordUserId: "d1", appUserId: "user_1", integrationToken: "qbit_aaa",
  });
  store.upsertLink("d1", "user_1", "qbit_bbb"); // token rotated
  assert.equal(store.getLink("d1").integrationToken, "qbit_bbb");
  store.deleteLink("d1");
  assert.equal(store.getLink("d1"), null);
});
