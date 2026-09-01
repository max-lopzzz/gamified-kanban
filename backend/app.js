import express from "express";
import cors from "cors";

import authRoutes, { authMiddleware } from "./routes/auth.js";
import boardRoutes from "./routes/boards.js";
import taskRoutes from "./routes/tasks.js";
import userRoutes from "./routes/users.js";
import teamRoutes from "./routes/teams.js";
import sprintRoutes from "./routes/sprints.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/boards", authMiddleware, boardRoutes);
app.use("/api/tasks", authMiddleware, taskRoutes);
app.use("/api/teams", authMiddleware, teamRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api/sprints", authMiddleware, sprintRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

/*
 * JSON error handler. Without this Express falls back to its HTML error page,
 * which the frontend's `res.json()` then chokes on, masking the real failure.
 * Must stay the LAST app.use(...).
 */
app.use((err, req, res, _next) => {
  res.status(err.status || 500).json({
    error: err.message || "Internal server error",
  });
});

export default app;
