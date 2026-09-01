import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import request from "supertest";

export async function makeApp() {
  const dbPath = path.join(os.tmpdir(), `qb-test-${randomUUID()}.sqlite`);
  process.env.DB_PATH = dbPath;

  // Cache-bust so each test file gets a fresh module graph bound to this DB_PATH.
  const bust = `?t=${randomUUID()}`;
  const { default: app } = await import(`../app.js${bust}`);
  const { default: db } = await import(`../db.js${bust}`);

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
