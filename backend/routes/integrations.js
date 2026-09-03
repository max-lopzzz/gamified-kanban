import { Router } from "express";
import { nanoid } from "nanoid";
import db from "../db.js";
import { verifyBotSecret } from "../lib/integration-auth.js";

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

export const botRouter = Router(); // NO authMiddleware — bot-only, mounted at /api/bot

botRouter.post("/discord/redeem", (req, res) => {
  if (!verifyBotSecret(req)) return res.status(401).json({ error: "unauthorized" });

  const { code, discordUserId } = req.body || {};
  if (!code) return res.status(400).json({ error: "invalid_or_expired_code" });

  const row = db
    .prepare("SELECT user_id FROM discord_link_codes WHERE code = ? AND expires_at >= datetime('now')")
    .get(String(code));
  if (!row) return res.status(400).json({ error: "invalid_or_expired_code" });

  const user = db.prepare("SELECT id, display_name FROM users WHERE id = ?").get(row.user_id);
  if (!user) return res.status(400).json({ error: "invalid_or_expired_code" });

  const token = "qbit_" + nanoid(32);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM discord_link_codes WHERE code = ?").run(String(code));
    db.prepare("INSERT INTO integration_tokens (token, user_id, kind) VALUES (?, ?, 'discord')").run(token, user.id);
  });
  tx();

  console.log(`[integrations] discord link: user=${user.id} discordUserId=${discordUserId ?? "?"}`);
  res.json({ token, appUserId: user.id, displayName: user.display_name });
});

export default router;
