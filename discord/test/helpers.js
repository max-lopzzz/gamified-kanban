import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import createStore from "../src/store.js";

export function tempStore() {
  const p = path.join(os.tmpdir(), `qb-bot-test-${randomUUID()}.sqlite`);
  const store = createStore(p);
  return {
    store,
    path: p,
    cleanup() {
      try { store.close(); } catch {}
      for (const s of ["", "-wal", "-shm"]) fs.rmSync(p + s, { force: true });
    },
  };
}
