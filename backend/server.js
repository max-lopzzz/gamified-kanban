import express from "express";
import cors from "cors";
import authRoutes, { authMiddleware } from "./routes/auth.js";
import boardRoutes from "./routes/boards.js";
import taskRoutes from "./routes/tasks.js";
import userRoutes from "./routes/users.js";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/boards", authMiddleware, boardRoutes);
app.use("/api/tasks", authMiddleware, taskRoutes);
app.use("/api/users", authMiddleware, userRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Gamified Kanban API running on http://localhost:${PORT}`));
