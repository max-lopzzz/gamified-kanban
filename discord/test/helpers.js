import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";
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

export function stubApiServer(handlers) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const key = `${req.method} ${req.url.split("?")[0]}`;
      const handler = handlers[key];
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        return res.end(JSON.stringify({ error: "no stub for " + key }));
      }
      const parsed = body ? JSON.parse(body) : undefined;
      const result = handler(req, parsed);
      const status = result?.__status ?? 200;
      const payload = result?.__status ? result.body : result;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

export const status = (code, body) => ({ __status: code, body });

export function fakeCtx(overrides = {}) {
  const replies = [];
  const ctx = {
    discordUserId: "d1",
    channelId: "c1",
    sub: null,
    _opts: {},
    opt(name) { return this._opts[name] ?? null; },
    store: null,
    api: null,
    replies,
    async reply(p) { replies.push({ ephemeral: true, p }); },
    async replyPublic(p) { replies.push({ ephemeral: false, p }); },
    link() { return this.store ? this.store.getLink(this.discordUserId) : null; },
    ...overrides,
  };
  if (overrides._opts) ctx._opts = overrides._opts;
  return ctx;
}
