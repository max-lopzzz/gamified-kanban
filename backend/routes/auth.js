import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import db from "../db.js";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

router.post("/register", (req, res) => {
  const { email, password, displayName } = req.body;
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
  const { email, password } = req.body;
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
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export default router;
