# Questboard — a gamified Kanban/Scrum tool

A small full-stack app: a Kanban board where completing tasks earns XP, levels
you up, tracks daily streaks, and unlocks achievements. Built as a real,
runnable codebase (not a mockup) so you can extend it into an actual product.

## Stack
- **Backend:** Node.js + Express + SQLite (via `better-sqlite3`, zero setup — no external DB to install), JWT auth
- **Frontend:** React (Vite), `@dnd-kit` for drag-and-drop, plain CSS (no framework) using a small design-token system

## Project structure
```
gamified-kanban/
  backend/
    server.js          # Express app entry point
    db.js               # SQLite schema + seed data
    gamification.js     # XP curve, streaks, achievement logic (the core mechanic)
    routes/
      auth.js            # register/login, JWT middleware
      boards.js           # create/list/fetch boards
      tasks.js             # create/move/update tasks — moving to "done" triggers gamification
      users.js               # profile + leaderboard
  frontend/
    src/
      api.js              # fetch wrapper
      App.jsx              # app shell: auth gate, board picker, toasts
      styles.css            # design tokens + all styling
      components/
        Login.jsx            # register/login form
        Hud.jsx                # XP bar / level / streak header
        Board.jsx                # drag-and-drop board, wires gamification events
        Column.jsx                 # single kanban column + "add task" form
        TaskCard.jsx                 # draggable task card
        Toasts.jsx                     # level-up + achievement toast components
        Leaderboard.jsx                 # XP leaderboard panel
```

## Running it locally

**Backend** (runs on port 4000):
```bash
cd backend
npm install
npm run dev
```
This creates `gamified_kanban.sqlite` automatically on first run — no database setup needed.

**Frontend** (runs on port 5173, proxies `/api` to the backend):
```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`, register an account, create a board, add tasks,
and drag them to **Done** to see XP, levels, streaks, and achievements fire.

**Backend tests:**
```bash
cd backend && npm test
```

## How the gamification works (`backend/gamification.js`)
- **XP per task** = `story_points × 10 × priority_multiplier` (urgent = 1.5x, high = 1.25x, normal = 1x, low = 0.75x)
- **Levels** follow a curve (`50 × level^1.6`) — gentle early on, steeper later, so leveling doesn't trivialize as you progress
- **Streaks** increment once per calendar day you complete at least one task; a missed day resets the streak to 1
- **Achievements** are checked after every completion (first task, 10 tasks, 5-day streak, an 8+ point task, reaching level 5) — the seed list lives in `db.js` and is easy to extend

## Features
Beyond the core XP/level/streak loop, the app now includes:
- **Board invitations**: board owners generate a copy-link invite; the recipient opens `/invite/:token`, registers or logs in, and lands on the board as a member
- **Teams**: board-owner-managed teams (name + description) with add/remove members and delete
- **Sprint-aware board**: create sprints with a goal and start/end dates, start one to make it active, and the board auto-selects the active sprint on load; a sprint switcher filters the board and a progress strip shows done / committed story points
- **Board settings view**: a dedicated two-pane `/board/:id/settings` screen with Members / Teams / Sprints / Danger zone sections (delete-board with name confirmation)
- **Theme toggle**: light / dark / system theme with the choice persisted across reloads
- **Full task editing**: edit and delete tasks from the board, including sprint reassignment

## Deploying

**Backend — Render (`render.yaml` blueprint):** Render dashboard → New → Blueprint → pick this repo. It creates a `web` service from `backend/` with a 1 GB persistent disk mounted at `/var/data`, and `DB_PATH` pointed at `/var/data/gamified_kanban.sqlite` so the database survives redeploys. A disk needs a paid instance type (Starter, ~$7/mo) — the free tier's filesystem is ephemeral, which is why accounts kept disappearing. `JWT_SECRET` is auto-generated and kept stable. Once it's live, set `CORS_ORIGIN` in the Render dashboard to your frontend origin.

**Backend — free alternative (Oracle Cloud Always Free VM):** keeps SQLite unchanged, $0 permanently, but you run the box yourself. Full runbook in [`deploy/oracle/SETUP.md`](deploy/oracle/SETUP.md) (systemd unit, Caddy auto-TLS, persistent block volume, backups).

**Frontend — Vercel:** it's a client-routed SPA, so `frontend/vercel.json` rewrites unknown paths to `index.html` (without it, deep links like `/invite/:token` 404). Set `VITE_API_URL` in the Vercel project's Environment Variables to the backend URL **plus `/api`** — e.g. `https://gamified-kanban-api.onrender.com/api` — then redeploy. Without it the frontend calls `/api` on its own domain, where nothing is listening.

## Where to go from here
This is a working MVP, not a finished product. Remaining ideas:
- **Hosted Postgres**: swap SQLite for a managed Postgres if a single file on one disk stops being enough (multiple backend instances, backups, point-in-time recovery).
- **Team gamification**: right now XP is per-user; a team/board-level XP pool or "raid boss" mechanic (a shared health bar the whole team chips away at) could be a good differentiator if you want this to feel distinct from Habitica/other gamified to-do apps already on the market
