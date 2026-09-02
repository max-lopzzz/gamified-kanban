import app from "./app.js";

const PORT = process.env.PORT || 4000;
// Behind a reverse proxy (e.g. Caddy on the same host), set HOST=127.0.0.1
// so the API is never reachable directly on the public interface.
const HOST = process.env.HOST || undefined;

app.listen(PORT, HOST, () => {
  console.log(
    `Gamified Kanban API running on http://${HOST || "localhost"}:${PORT}`
  );
});
