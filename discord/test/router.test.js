import test from "node:test";
import assert from "node:assert/strict";
import { dispatch } from "../src/router.js";

test("dispatch routes to the named command", async () => {
  let ran = false;
  const byName = new Map([["ping", { name: "ping", execute: async () => { ran = true; } }]]);
  const out = await dispatch({ name: "ping" }, {}, { byName });
  assert.equal(ran, true);
  assert.deepEqual(out, { ok: true });
});

test("dispatch returns ok:false when a command throws", async () => {
  const byName = new Map([["boom", { name: "boom", execute: async () => { throw new Error("x"); } }]]);
  const out = await dispatch({ name: "boom" }, {}, { byName });
  assert.deepEqual(out, { ok: false });
});

test("dispatch is a no-op for an unknown command", async () => {
  const out = await dispatch({ name: "nope" }, {}, { byName: new Map() });
  assert.deepEqual(out, { ok: false });
});
