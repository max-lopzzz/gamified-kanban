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

export default app;
