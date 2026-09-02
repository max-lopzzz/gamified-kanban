import test from "node:test";
import assert from "node:assert/strict";
import { xpForLevel, levelFromXp } from "../lib/leveling.js";

test("level 1 starts at 0 XP and the curve is strictly increasing", () => {
  assert.equal(xpForLevel(1), 0);
  for (let l = 1; l < 40; l++) {
    assert.ok(xpForLevel(l + 1) > xpForLevel(l), `L${l + 1} > L${l}`);
  }
});

test("levelFromXp agrees with xpForLevel at the boundaries", () => {
  for (let l = 1; l <= 25; l++) {
    assert.equal(levelFromXp(xpForLevel(l)), l);
    assert.equal(levelFromXp(xpForLevel(l + 1) - 1), l);
  }
});

test("a single very large task cannot vault past the low levels", () => {
  // 2855 XP used to reach level 12; the steeper curve keeps it in single digits.
  assert.ok(levelFromXp(2855) <= 5);
});
