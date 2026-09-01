# Teams, Sprints, Invites & Visual Redesign — Design

**Date:** 2026-09-01
**Status:** Approved for planning
**Topic:** Consolidate the half-built board-collaboration features (invitations, teams,
sprints), make them reachable and correct, and run a full visual redesign of the app.

---

## 1. Background

The working tree contains a large body of uncommitted work that adds board
invitations, teams, sprints, task dependencies, and task assignment to a person or
a team. None of it is reachable in the running app, and it exists in **two
overlapping implementations**:

- An inline management panel built directly into `frontend/src/components/Board.jsx`
  (toggled by a `showManagement` state flag).
- A separate tabbed modal, `frontend/src/components/BoardSettings.jsx`, which is
  **imported nowhere** and never renders.

The two disagree on API method names and signatures, the backend is missing
endpoints the UI already calls, and `frontend/src/styles.css` was never touched, so
every new class renders unstyled.

### Known defects in the current WIP

| # | Defect | Effect |
|---|---|---|
| 1 | `Board.jsx` calls `api.inviteToBoard(...)`; `api.js` defines `inviteMember` | Invite from the inline panel throws |
| 2 | `GET /api/boards/:boardId/invitations` selects `expires_at`, which is not a column | Endpoint 500s |
| 3 | `backend/routes/sprints.js` has only `GET` (list) and `POST` (create) | `api.updateSprint` / `api.deleteSprint` → 404; sprint Start/Finish/Delete buttons are dead |
| 4 | `sprints.js` orders by `created_at`, which is not a column on `sprints` | Sprint list query throws |
| 5 | `BoardSettings.jsx` calls `api.createSprint(boardId, name, startsAt, endsAt)` (positional); `api.js` `createSprint` takes one payload object | Sprint create sends `undefined` |
| 6 | `BoardSettings.jsx` calls `api.createTeam(boardId, name, description)`; `api.js` `createTeam` sends only `name` | Team description silently dropped |
| 7 | `BoardSettings.jsx` reads `team.description`; `teams` table has no `description` column | Always empty |
| 8 | `GET /api/boards/:boardId` returns one flat `dependencies` array of `{task_id, depends_on_task_id}`; `TaskCard.jsx` expects `task.dependencies` = `[{id, title}]` per task | Dependencies never render |
| 9 | `PATCH /api/tasks/:taskId` reads `req.body.dependencies`; `TaskCard.jsx` sends `dependencyIds` | Dependency edits are ignored |
| 10 | `teams.js` routes have no ownership checks | Any authenticated user can create/delete teams and edit membership on any board |
| 11 | `frontend/src/styles.css` unchanged | All new UI (`board-management`, `settings-modal`, `team-card`, `sprint-card`, etc.) is unstyled |

---

## 2. Goals

1. **One implementation.** Consolidate onto a single settings surface; delete the
   inline panel in `Board.jsx`.
2. **Correct and reachable.** Fix every defect in §1. Invitations, teams, and
   sprints all function end to end.
3. **Dedicated settings view.** Board settings live at their own route, not a modal.
4. **Sprint-aware board.** A sprint switcher filters the board; a progress strip
   shows committed vs completed points for the selected sprint.
5. **Copy-link invite flow.** Owner generates an invite; the app produces a
   shareable `/invite/:token` URL; the invitee accepts in-app.
6. **Full visual redesign.** Token-driven design system, light + dark palettes with
   a persisted toggle, in an "elevated quest/RPG" visual direction.
7. **Guardrail tests** on the repaired/new backend endpoints.

### Non-goals (flagged for later)

- Team-level XP pools / shared "raid boss" mechanic.
- Sprint burndown chart / velocity history.
- Email-based invitations (SMTP).
- Frontend test infrastructure (Vitest + React Testing Library).
- Per-task comments / activity log.

---

## 3. Approach

Three sequential phases, each independently runnable and reviewable:

1. **Reconcile.** Consolidate to one implementation, fix all §1 defects, add the
   missing backend endpoints, align `api.js` signatures, add backend tests. The
   features work against the *existing* (unstyled) CSS.
2. **Restructure.** Add routing; build the dedicated settings view and the
   sprint-aware board.
3. **Redesign.** Rebuild `styles.css` as a token system with light/dark; restyle
   every surface.

Rejected alternatives: redesign-first (styling functionally broken components,
nothing verifiable until the end); vertical feature slices (shared primitives and
the light/dark token set get built piecemeal and churned).

---

## 4. Data model (`backend/db.js`)

All additions use the existing `addColumnIfMissing(table, column, definition)`
helper so an existing `gamified_kanban.sqlite` migrates on boot. No columns are
dropped; no destructive migration.

### 4.1 Column additions

| Table | Column | Definition | Reason |
|---|---|---|---|
| `sprints` | `created_at` | `TEXT NOT NULL DEFAULT (datetime('now'))` | `sprints.js` already orders by it (defect 4) |
| `sprints` | `goal` | `TEXT DEFAULT ''` | Sprint goal line on the sprint-aware board |
| `teams` | `description` | `TEXT DEFAULT ''` | UI already reads/writes it (defects 6, 7) |

> Note on `addColumnIfMissing` + `NOT NULL DEFAULT`: SQLite permits
> `ADD COLUMN ... NOT NULL DEFAULT <const>` on a populated table, so `created_at`
> backfills to `datetime('now')` at migration time for existing rows. Acceptable —
> existing sprints get an approximate creation time.

### 4.2 Tables kept from the WIP as-is

`board_invitations`, `teams`, `team_members`, `task_dependencies`, and the
`tasks.assignee_type` / `tasks.team_id` columns. All coherent. `board_invitations`
has **no** `expires_at` — the fix for defect 2 is to remove that column from the
query, not to add the column.

### 4.3 Dependency data shape — single convention

| Direction | Field | Shape |
|---|---|---|
| Write (`POST` / `PATCH /api/tasks`) | `dependencyIds` | `string[]` of task IDs |
| Read (`GET /api/boards/:id`) | `task.dependencies` | `[{ id, title }]`, attached to each task object |

Changes required:
- `tasks.js` `POST` and `PATCH`: read `req.body.dependencyIds` (currently `PATCH`
  reads `dependencies`). Replace-on-write semantics: if `dependencyIds` is an array,
  delete existing rows for the task and re-insert. Ignore self-references.
- `boards.js` `GET /:boardId`: after loading tasks, load
  `task_dependencies` joined to `tasks` for titles, group by `task_id`, and attach
  `dependencies: [{id, title}]` to each task. Remove the top-level flat
  `dependencies` array from the response.
- `TaskCard.jsx` already sends `dependencyIds` — no change to the send; it reads
  `task.dependencies` for display — works once the shape above lands.

---

## 5. Backend API (`backend/routes/`)

### 5.1 `sprints.js`

Keep the `isBoardMember(boardId, userId)` guard on every route.

| Method + path | Behavior |
|---|---|
| `GET /api/sprints/board/:boardId` | Existing. Order `by starts_at ASC, created_at ASC` (valid once column added). |
| `POST /api/sprints` | Existing. Body: `{ boardId, name, goal?, startsAt?, endsAt?, isActive? }`. |
| `PATCH /api/sprints/:id` — **new** | Body may include `name`, `goal`, `startsAt`, `endsAt`, `isActive`. Whitelisted columns only. If `isActive: true`, first `UPDATE sprints SET is_active = 0 WHERE board_id = ?` for that sprint's board, then set this one active — **single active sprint per board** invariant. Returns the updated row. |
| `DELETE /api/sprints/:id` — **new** | Deletes the sprint. `tasks.sprint_id` clears via existing `ON DELETE SET NULL` FK. Returns `{ ok: true }`. |

`PATCH` / `DELETE` resolve the sprint first to find its `board_id`, then apply the
`isBoardMember` guard; 404 if the sprint does not exist.

### 5.2 `teams.js`

Add an ownership guard helper (board `owner_id === req.userId`).

| Method + path | Guard |
|---|---|
| `GET /api/teams/board/:boardId` | board member |
| `GET /api/teams/:teamId/members` | board member |
| `POST /api/teams` | board **owner**; accept `{ boardId, name, description? }` |
| `DELETE /api/teams/:teamId` | board **owner** |
| `POST /api/teams/:teamId/members` | board **owner** |
| `DELETE /api/teams/:teamId/members/:userId` | board **owner** |

Team routes that take a `:teamId` resolve the team → its `board_id` → the board,
then check. 404 for a missing team, 403 for a non-owner.

### 5.3 `boards.js`

- Remove `expires_at` from the invitations `SELECT` (defect 2).
- `POST /api/boards/:boardId/invitations`: keep the owner-only check; additionally
  reject when a `pending` invitation already exists for the same lowercased email on
  that board (`409` with a clear message).
- `GET /api/boards/:boardId`: response stays `{ ...board, tasks, members, teams,
  sprints }`; each task gains `dependencies: [{id, title}]` per §4.3. Keep the
  existing `members` / `teams` / `sprints` sub-queries.
- Invitation `accept` route unchanged in behavior (email must match the logged-in
  user's email; inserts `board_members` row; marks invitation `accepted`).

### 5.4 `frontend/src/api.js`

Align to the names/signatures `BoardSettings.jsx` and the new views use:

| Method | Signature | Notes |
|---|---|---|
| `inviteMember(boardId, email)` | POST `/boards/:id/invitations` | Delete `inviteToBoard`; update `Board.jsx` callers (those callers are being deleted anyway). |
| `boardInvitations(boardId)` | GET | unchanged |
| `cancelInvitation(boardId, invitationId)` | DELETE | unchanged |
| `acceptInvitation(token)` | POST `/boards/invitations/:token/accept` | unchanged |
| `createTeam(boardId, name, description)` | POST `/teams`, body `{ boardId, name, description }` | send all three |
| `updateTeam` | — | not needed this pass |
| `createSprint(boardId, name, startsAt, endsAt, goal)` | POST `/sprints`, body `{ boardId, name, startsAt, endsAt, goal, isActive: false }` | positional args → body object |
| `updateSprint(id, patch)` | PATCH `/sprints/:id` | now backed by a real endpoint |
| `deleteSprint(id)` | DELETE `/sprints/:id` | now backed by a real endpoint |
| task create/update | body uses `dependencyIds` | consistent with §4.3 |

---

## 6. Routing & component structure (frontend)

### 6.1 Add `react-router-dom`

New dependency in `frontend/package.json`. Rationale: a dedicated settings view and
a copy-link invite flow both need real URLs; `App.jsx`'s manual view-state does not
extend to `/invite/:token` cleanly.

| Route | Element | Notes |
|---|---|---|
| `/` | redirect | to `/board/:lastBoardId` (from `localStorage`) or the board picker if none |
| `/board/:boardId` | `<BoardPage>` | the sprint-aware Kanban board |
| `/board/:boardId/settings` | `<BoardSettingsPage>` | Members / Teams / Sprints sections with a left sub-nav |
| `/invite/:token` | `<InviteAcceptPage>` | shows board name + "Accept invitation"; on success redirects to `/board/:boardId` |
| `*` | `<NotFound>` | minimal |

Auth gate wraps the router: unauthenticated → `<Login>` (existing component,
unchanged behavior). An unauthenticated hit on `/invite/:token` routes to login and
returns to the invite URL afterward.

### 6.2 Component changes

**Delete:**
- The entire inline management block in `Board.jsx`: `showManagement` and all
  invite / team / sprint state, the handlers (`handleInvite`, `handleCreateTeam`,
  `loadTeamMembers`, `handleAddTeamMember`, `handleRemoveTeamMember`,
  `handleDeleteTeam`, `handleCreateSprint`), and the `board-management` JSX
  (~400 lines). `Board.jsx` returns to rendering only the board.
- `api.inviteToBoard`.

**Keep & refactor:**
- `BoardSettings.jsx` → `pages/BoardSettingsPage.jsx`, converted from a modal
  (`settings-overlay` / `settings-modal`) to a routed two-pane view. Its three
  inner components move to their own files:
  - `components/settings/MembersSection.jsx` (invite form + member list + pending
    invitations + cancel).
  - `components/settings/TeamsSection.jsx` (create team, list, add/remove members,
    delete).
  - `components/settings/SprintsSection.jsx` (create sprint, list, start/finish
    via `updateSprint`, delete).
- Shared: `components/settings/SettingsSection.jsx` (section shell — heading +
  body), and a small `FormRow` primitive used across sections and the task form.

**New:**
- `components/AppShell.jsx` — HUD + board switcher + theme toggle + link to
  settings; wraps routed content. The board-list / active-board / create-board
  logic currently in `App.jsx` moves here.
- `pages/BoardPage.jsx` — reads `:boardId`; owns the selected-sprint state and
  renders the sprint switcher + progress strip (§7) above `<Board>`, passing the
  selected sprint id down as a `sprintFilter` prop. `Board.jsx` applies the filter
  when partitioning tasks into columns.
- `pages/InviteAcceptPage.jsx`.
- `pages/NotFound.jsx`.

**`App.jsx`** — reduces to: auth state, the `<BrowserRouter>`, the auth gate, and
the toast queue host (`LevelUpToast` / `AchievementToast` stay app-level).

### 6.3 Gamification event wiring

`handleGamificationEvent` (level-up + achievement toasts, user reload, leaderboard
refresh) moves from `App.jsx` into `AppShell` and is passed down to `Board`
unchanged. No change to when events fire (still on task → Done).

---

## 7. Sprint-aware board

### 7.1 Sprint switcher

In the board header: a segmented control / select —
`Backlog · <each sprint, active one marked> · All tasks`.

- Default selection: the active sprint if one exists, else **All tasks**.
- `All tasks` → no filter (current behavior).
- `Backlog` → `task.sprint_id == null`.
- A specific sprint → `task.sprint_id === sprintId`.
- Filter applies to all four columns; the drag-and-drop and gamification paths are
  unchanged.

### 7.2 Sprint progress strip

Shown only when a specific sprint is selected:

- **Committed points** — sum of `story_points` over tasks in the sprint.
- **Completed points** — sum over sprint tasks with `status === 'done'`.
- A progress bar (completed / committed).
- **Days remaining** — from `ends_at` to now (or "ended" / "no end date").
- The sprint **goal** text, if set.

All derived client-side from the already-loaded board payload — no new endpoint.

### 7.3 Task form

`Column.jsx`'s new-task form already has a sprint `<select>`. Keep it; default the
value to the currently-viewed sprint (or none when viewing Backlog / All tasks).
Task edit (`TaskCard.jsx`) gains the same sprint select.

---

## 8. Design-token system & visual redesign

### 8.1 Tokens (`frontend/src/styles.css`)

Expand `:root` from ~11 vars to a full scale:

- **Surfaces:** `--bg`, `--surface`, `--surface-raised`, `--surface-overlay`,
  `--border`, `--border-strong`.
- **Text:** `--text`, `--text-muted`, `--text-faint`.
- **Brand / accent:** `--gold` (primary actions, XP), `--teal` (secondary accent),
  `--danger`.
- **Priority:** `--priority-low`, `--priority-normal`, `--priority-high`,
  `--priority-urgent` (replacing today's `--urgent` / `--high` pair).
- **Scale:** `--radius-sm/md/lg`, `--shadow-sm/md/lg`, `--space-1..8`.
- **Semantic game tokens:** `--xp-fill`, `--xp-track`, `--streak-flame`,
  `--level-ring`.

### 8.2 Light / dark

- Bare `:root` defines the **light** palette (warm "parchment/ink" quest theme:
  off-white surfaces, deep ink text, same gold/teal accents).
- `@media (prefers-color-scheme: dark)`, guarded as
  `:root:not([data-theme="light"])`, redefines the tokens to the **dark** palette
  (today's colors, refined).
- `:root[data-theme="dark"]` and `:root[data-theme="light"]` redefine the tokens
  again so an explicit toggle wins in both directions.
- Every color is defined on bare `:root` first; media / attribute blocks only
  *override*.
- `body` keeps an explicit `background: var(--bg)`.

### 8.3 Theme toggle

- A control in `AppShell` (sun/moon).
- Writes `data-theme` on `document.documentElement`; persists to
  `localStorage["questboard-theme"]`.
- Read on load inside `try/catch`; absent / unreadable → leave unset (system
  decides).

### 8.4 Visual direction — "elevated quest/RPG"

| Surface | Treatment |
|---|---|
| Typography | Keep Sora (display) / Inter (body). Tighten the scale, increase size contrast, heavier display weights for headings. |
| HUD | XP as a segmented bar with a level ring; streak as a flame token + count; level-up / achievement toasts get a soft glow + slide-in, gated by `prefers-reduced-motion`. |
| Task card | Layered surface + `--shadow-sm`; priority as a colored **left rail** (not a pill); XP shown as a small "reward" chip; description clamped to 2 lines; edit/delete actions revealed on hover/focus. |
| Column | Stronger header, count badge, refined `drag-over` state using `--level-ring`. |
| Settings view | Two-pane: sub-nav left, content right. Member / team / sprint lists as table-like rows. Consistent `FormRow`. |
| Buttons | `primary` (gold — commit actions), `ghost` (outline), `danger` (muted red, always behind a confirm). Uniform padding / height. |
| Sprint strip | Progress bar reuses `--xp-fill`; active-sprint marker uses `--teal`. |

`styles.css` is reorganized into commented sections (`/* ---------- HUD ---------- */`
etc.), one block per component. Expected size ~700–900 lines. Single file, no CSS
framework — matches the current project convention.

### 8.5 Coverage

Every class introduced by the WIP and by this design gets styling. A pass over the
rendered app in both themes confirms no unstyled surfaces remain.

---

## 9. Testing

### 9.1 Backend (added this pass)

- Dev dependencies: `node:test` (built-in runner) + `supertest`. Add
  `"test": "node --test"` to `backend/package.json`.
- `db.js` is refactored to read a `DB_PATH` env var, defaulting to
  `gamified_kanban.sqlite` (no behavior change in normal runs). Each test file sets
  `DB_PATH` to a unique temp path under `os.tmpdir()` before importing the app, and
  deletes it on teardown.
- Coverage:
  - **sprints:** create; update fields; `isActive: true` deactivates siblings
    (single-active invariant); delete nulls `tasks.sprint_id`; non-member → 403;
    missing sprint → 404.
  - **invitations:** create → accept → member appears; non-owner create → 403;
    accept with a mismatched email → 403; duplicate pending → 409; cancel removes it.
  - **teams:** create (owner) / create (non-owner → 403); add/remove member;
    delete cascades `team_members`.
  - **tasks:** create and update round-trip `dependencyIds` and `assignee_type` /
    `team_id`; `GET /boards/:id` returns `task.dependencies` as `[{id,title}]`.

### 9.2 Frontend

No test infra this pass. Instead, a manual verification checklist in the
implementation plan, per surface: invite create + accept flow, team CRUD, sprint
CRUD + start/finish, sprint switcher + progress math, theme toggle persistence,
both palettes with no unstyled elements, drag-and-drop + gamification still fire.

---

## 10. Rollout

- Branch `feat/teams-sprints-invites-redesign` off `main`, **carrying** the current
  uncommitted WIP (do not discard it — it is the starting point).
- Three commits matching the phases in §3, each left in a runnable state:
  1. Reconcile: defects fixed, endpoints added, `api.js` aligned, backend tests
     green.
  2. Restructure: `react-router-dom`, settings view, sprint-aware board.
  3. Redesign: token system, light/dark, full restyle.
- Update `README.md` "Where to go from here" to describe what now exists.
- `frontend/dist/` is a stale committed build artifact — **out of scope**; do not
  hand-edit it. Note in the plan that it should be `.gitignore`d and removed from
  tracking in a separate change.

---

## 11. Open risks

| Risk | Mitigation |
|---|---|
| `addColumnIfMissing` with `NOT NULL DEFAULT (datetime('now'))` on `sprints.created_at` — behavior on an already-populated table | Verified acceptable in SQLite; existing rows backfill to migration time. If a tester's DB errors, fall back to `TEXT` (nullable) + `ORDER BY starts_at ASC, id ASC`. |
| Deleting ~400 lines from `Board.jsx` while it also has live drag-and-drop code | Phase 1 keeps `Board.jsx` behavior identical except for removing the management panel; drag-and-drop untouched. Covered by the manual checklist. |
| `styles.css` full rewrite regressing existing screens (auth, HUD, leaderboard) | Redesign is its own phase/commit; every existing screen is on the verification checklist in both themes. |
| Single-file `styles.css` at ~900 lines | Accepted — matches project convention; organized with section comments. A CSS-module split is a separate future call. |
