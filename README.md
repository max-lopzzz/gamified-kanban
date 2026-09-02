# Questboard — a gamified Kanban / Scrum tool

A small full-stack app: a Kanban board where completing tasks earns XP, levels
you up, tracks daily streaks, and unlocks achievements. Built as a real, runnable
codebase (not a mockup) so you can extend it into an actual product.

**Live demo:** <https://gamified-kanban.vercel.app>

If this is useful to you: [☕ support the project on Ko-fi](https://ko-fi.com/maximiliano66848).

## Stack

- **Backend:** Node.js + Express + SQLite (`better-sqlite3`, zero setup), JWT auth
- **Frontend:** React + Vite, `react-router-dom`, `@dnd-kit` for drag-and-drop,
  hand-written CSS on a design-token system (no framework)
- **Tests:** `node:test` + `supertest` on the backend

## What it does

The core loop: drag a task to **Done** → earn XP → level up → keep a daily streak
→ unlock achievements.

On top of that:

- **Board invitations** — an owner generates a copy-link invite; the recipient
  opens `/invite/:token`, signs in, and joins the board.
- **Teams** — owner-managed groups (name + description); tasks can be assigned to
  a person, a team, or left "up for grabs".
- **Sprints** — created with a goal and start/end dates. A sprint is **active
  automatically** whenever today falls inside its date window (no "start" button);
  the board's sprint switcher filters by sprint and shows a done / committed
  story-point progress strip.
- **Board settings** — a dedicated two-pane `/board/:id/settings` view (Members /
  Teams / Sprints / Danger zone). Non-owners see it read-only.
- **Light / dark / system theme**, persisted per browser.
- **Task editing** — edit, delete, reassign, re-sprint, set dependencies from the
  card.

### How the gamification works (`backend/gamification.js`)

- **XP per task** = `story_points × 10 × priority_multiplier`
  (urgent 1.5×, high 1.25×, normal 1×, low 0.75×).
- **Who gets the XP:** the assignee if the task is assigned to a specific person;
  otherwise (team or "up for grabs") whoever moved it to Done.
- **Levels** follow `50 × level^1.6` — gentle early, steeper later.
- **Streaks** increment once per calendar day you complete at least one task; a
  missed day resets to 1.
- **Achievements** are checked after every completion (first task, 10 tasks,
  5-day streak, an 8+ point task, level 5). Seed list is in `db.js`.
- **Leaderboard** is scoped to the board you're viewing — its members ranked by
  total XP.

## Project structure

```
backend/
  app.js                 # Express app (routes + middleware), no listener
  server.js              # starts the listener (honors HOST / PORT / DB_PATH)
  db.js                  # SQLite schema, lightweight migrations, seed data
  gamification.js        # XP curve, streaks, achievements
  lib/sprint-status.js   # derives a sprint's active state from the calendar
  routes/                # auth, boards, tasks, teams, sprints, users
  test/                  # node:test + supertest suites
frontend/src/
  main.jsx               # BrowserRouter + theme bootstrap
  App.jsx                # auth gate + <Routes>
  api.js                 # fetch wrapper (VITE_API_URL, 401 handling)
  theme.js               # light / dark / system persistence
  styles.css             # design tokens + all styling
  components/
    AppShell.jsx         # layout route: HUD, board switcher, theme toggle, footer
    Board.jsx / Column.jsx / TaskCard.jsx   # the board
    SprintBar.jsx        # sprint switcher + progress strip
    Hud.jsx / Toasts.jsx / Leaderboard.jsx
    settings/            # Members / Teams / Sprints section components
  pages/
    BoardPage.jsx        # sprint-aware wrapper around <Board>
    BoardSettingsPage.jsx
    InviteAcceptPage.jsx
    NotFound.jsx
```

## Running it locally

**Backend** (port 4000):

```bash
cd backend
npm install
npm run dev        # creates gamified_kanban.sqlite on first run
```

**Frontend** (port 5173):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>, register, create a board, add tasks, drag to
**Done**. For local dev the frontend expects the API at `/api` — set
`VITE_API_URL=http://localhost:4000/api` in `frontend/.env` (or run a proxy).

**Backend tests:**

```bash
cd backend && npm test
```

## Deploying

**Frontend — Vercel.** It's a client-routed SPA, so `frontend/vercel.json`
rewrites unknown paths to `index.html` (without it, deep links like
`/invite/:token` 404). Set `VITE_API_URL` in the project's Environment Variables
to the backend URL **plus `/api`** (e.g. `https://your-api.example.com/api`) and
redeploy. Without it the frontend calls `/api` on its own domain, where nothing
is listening.

**Backend — Render (`render.yaml` blueprint).** Render dashboard → New →
Blueprint → pick this repo. Creates a `web` service from `backend/` with a 1 GB
persistent disk at `/var/data` and `DB_PATH` pointed there so the database
survives redeploys. A disk requires a paid instance type (Starter, ~$7/mo) — the
free tier's filesystem is ephemeral. `JWT_SECRET` is auto-generated and kept
stable; set `CORS_ORIGIN` to your frontend origin once it's live.

**Backend — free, Oracle Cloud "Always Free" VM.** Keeps SQLite unchanged, $0
forever, but you run the box. Full runbook (systemd unit, Caddy auto-TLS,
persistent block volume, nightly backups) in
[`deploy/oracle/SETUP.md`](deploy/oracle/SETUP.md).

## Where to go from here

- **Hosted Postgres** if one SQLite file on one disk stops being enough
  (multiple instances, PITR backups).
- **Team gamification** — XP is per-user today; a team XP pool or a shared
  "raid boss" health bar would set it apart from other gamified to-do apps.
- **Sprint burndown / velocity** history.
- **Frontend test setup** (Vitest + RTL) — only the backend is covered right now.
