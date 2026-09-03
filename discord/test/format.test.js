import test from "node:test";
import assert from "node:assert/strict";
import { board } from "./fixtures/board.js";
import { formatTasks, formatStandup, formatSprint } from "../src/format.js";

test("formatTasks unfiltered has one field per status with counts", () => {
  const embed = formatTasks(board, {});
  assert.equal(embed.title, "Questboard");
  const names = embed.fields.map((f) => f.name);
  assert.deepEqual(names, ["Backlog (0)", "To Do (1)", "In Progress (1)", "Done (2)"]);
  assert.match(embed.fields[2].value, /Wire up auth — Max · 5pt · high/);
});

test("formatTasks filtered by status returns a single Matching field", () => {
  const embed = formatTasks(board, { status: "todo" });
  assert.equal(embed.fields.length, 1);
  assert.match(embed.fields[0].name, /Matching/);
  assert.match(embed.fields[0].value, /Ship it — unassigned · 8pt · urgent/);
});

test("formatStandup groups in-progress by assignee and flags blocked + recent done", () => {
  const { content } = formatStandup(board);
  assert.match(content, /\*\*In Progress\*\*/);
  assert.match(content, /Max\b[\s\S]*Wire up auth/);
  assert.match(content, /\*\*Done since yesterday\*\*[\s\S]*Design schema/);
  assert.doesNotMatch(content, /Old done thing/); // 72h ago, excluded
  assert.match(content, /\*\*Blocked\*\*[\s\S]*Ship it/); // depends on k1 (in-progress)
});

test("formatSprint reports the active sprint with point totals", () => {
  const embed = formatSprint(board);
  assert.match(embed.title, /Sprint 1/);
  assert.match(JSON.stringify(embed.fields), /2026-09-01/);
  assert.match(JSON.stringify(embed.fields), /3 \/ 16 done/); // 3 of 16 sprint points done
});
