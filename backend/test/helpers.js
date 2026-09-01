import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";

let appMade = false;

/**
 * Build a fresh Express app bound to an isolated temp SQLite database.
 *
 * `node --test` runs each test FILE in its own child process, so per-file
 * module caches already isolate databases between files.
 *
 * `makeApp()` sets a unique `process.env.DB_PATH` and imports `app.js` fresh
 * (cache-busting query string). It is safe to call **once per process only**:
 * the route modules' unqueried `./db.js` import is cache-shared across
 * `app.js` re-executions, so a second call would leave `app` bound to the
 * first temp DB while the returned `db` handle points at a new empty one.
 * That desync is a silent trap, so a second call throws.
 *
 * Usage: call `makeApp()` once per test file — at module scope with
 * top-level `await`, or in a `before()` hook — and share the returned `app`
 * across every `test()` in the file. Isolate individual tests by having each
 * create its own board and asserting only on board-scoped data.
 *
 * A single file-scope `cleanup()` call (or an `after()` hook) is enough to
 * tear the temp database down.
 */
export async function makeApp() {
  if (appMade) {
    throw new Error(
      "makeApp() must be called at most once per test process — node --test isolates per file; call it once at file scope or in a before() hook and share the returned app across tests."
    );
  }

  const dbPath = path.join(os.tmpdir(), `qb-test-${randomUUID()}.sqlite`);
  process.env.DB_PATH = dbPath;

  const bust = `?t=${randomUUID()}`;
  const { default: app } = await import(`../app.js${bust}`);
  const { default: db } = await import(`../db.js${bust}`);
  appMade = true;

  function cleanup() {
    try {
      db.close();
    } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(dbPath + suffix, { force: true });
    }
  }

  return { app, db, cleanup };
}

export async function registerUser(
  app,
  { email, password = "pw-123456", displayName = email.split("@")[0] }
) {
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password, displayName });
  if (res.status !== 200) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body; // { token, user }
}

export function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}
