import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

// Emails are stored and compared case-insensitively. Normalize on every
// write and lookup so "Foo@X.com" and "foo@x.com" can never become two
// accounts (and so the invitation email check is sound).
function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

router.post("/register", (req, res) => {
  const { password, displayName } = req.body;
  const email = normalizeEmail(req.body.email);
  if (!email || !password || !displayName) {
    return res.status(400).json({ error: "email, password, and displayName are required" });
  }
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) return res.status(409).json({ error: "Email already registered" });

  const id = `user_${nanoid(10)}`;
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare(
    "INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)"
  ).run(id, email, passwordHash, displayName);

  const token = jwt.sign({ userId: id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({ token, user: { id, email, displayName, xp: 0, level: 1 } });
});

router.post("/login", (req, res) => {
  const { password } = req.body;
  const email = normalizeEmail(req.body.email);
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: "30d" });
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      xp: user.xp,
      level: user.level,
      currentStreak: user.current_streak,
      longestStreak: user.longest_streak,
    },
  });
});

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Missing token" });
  const raw = header.slice(7);

  if (raw.startsWith("qbit_")) {
    const row = db
      .prepare("SELECT user_id FROM integration_tokens WHERE token = ?")
      .get(raw);
    if (!row) return res.status(401).json({ error: "Invalid or expired token" });
    db.prepare("UPDATE integration_tokens SET last_used_at = datetime('now') WHERE token = ?").run(raw);
    req.userId = row.user_id;
    req.authKind = "integration";
    return next();
  }

  try {
    const payload = jwt.verify(raw, JWT_SECRET);
    req.userId = payload.userId;
    req.authKind = "user";
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export default router;
