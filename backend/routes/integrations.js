import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";

const CODE_TTL_MINUTES = 10;

const router = Router(); // mounted behind authMiddleware at /api/integrations

function sweepExpiredCodes() {
  db.prepare("DELETE FROM discord_link_codes WHERE expires_at < datetime('now')").run();
}

function makeCode() {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

router.post("/discord/link-code", (req, res) => {
  sweepExpiredCodes();
  const insert = db.prepare(
    "INSERT INTO discord_link_codes (code, user_id, expires_at) VALUES (?, ?, datetime('now', ?))"
  );
  const ttl = `+${CODE_TTL_MINUTES} minutes`;
  let code;
  for (let attempt = 0; attempt < 5; attempt++) {
    code = makeCode();
    try {
      insert.run(code, req.userId, ttl);
      break;
    } catch (err) {
      if (attempt === 4) throw err; // give up after 5 collisions
    }
  }
  const row = db.prepare("SELECT expires_at FROM discord_link_codes WHERE code = ?").get(code);
  res.json({ code, expiresAt: new Date(row.expires_at + "Z").toISOString() });
});

router.get("/discord/status", (req, res) => {
  const row = db
    .prepare("SELECT 1 FROM integration_tokens WHERE user_id = ? AND kind = 'discord' LIMIT 1")
    .get(req.userId);
  res.json({ linked: Boolean(row) });
});

router.delete("/discord/link", (req, res) => {
  db.prepare("DELETE FROM integration_tokens WHERE user_id = ? AND kind = 'discord'").run(req.userId);
  res.json({ ok: true });
});

export default router;
