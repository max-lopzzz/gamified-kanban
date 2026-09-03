# Discord bot — read-only board queries from Discord

**Date:** 2026-09-03
**Status:** Approved design, pending implementation plan

## Goal

Let a team ask about their Questboard tasks from Discord using structured
slash commands. Each Discord user links their own Questboard account, so
results are scoped to the boards they actually belong to and `/mine`
means their tasks. Read-only for v1.

## Scope

### In scope (v1)

- A standalone Discord bot service in the repo (`discord/`), deployed as
  its own `systemd` unit on the existing Oracle VM.
- Slash commands: `/questboard link|unlink|use|whichboard`, `/tasks`,
  `/mine`, `/standup`, `/sprint`.
- A per-user identity link between a Discord user and a Questboard
  account, established with a short-lived code generated in Questboard
  settings and redeemed in Discord.
- Minimal backend additions: two tables, one authed route file, one
  bot-only redeem endpoint, an `authMiddleware` fallback for opaque
  integration tokens, and a read-only guard for those tokens.
- One frontend settings panel to connect / disconnect Discord.

### Out of scope (v1, noted for later)

- Any write action from Discord (create task, move card, complete task,
  edit). The integration token is read-only by enforcement.
- Natural-language / LLM-backed questions. Commands are structured only.
- Discord OAuth2. Linking is code-based.
- Per-message reading (no Message Content intent).
- Notifications / push from Questboard into Discord (e.g. "task moved to
  done"). This is a plausible v2 but not designed here.

## Approach

**Standalone bot service that talks to the Questboard REST API over
`http://127.0.0.1:4000`**, exactly as the frontend does, authenticating
as the linked user with a per-user opaque integration token.

Rejected alternatives:

- **Bot inside the API process.** Less to build, but couples the bot's
  stability and deploy cadence to the API, shares the event loop, and
  contradicts the token model.
- **Separate process reading the SQLite file directly.** Would force the
  bot to re-implement `taskWithRelations`, derived sprint status, and
  membership checks, which live in route handlers, not shared libs.

## Architecture

### Repo layout

```
discord/
  package.json          # discord.js, better-sqlite3, node:test
  src/
    index.js            # client bootstrap, command router, graceful shutdown
    api.js              # thin wrapper over the Questboard REST API (fetch)
    store.js            # bot-local SQLite: channel_boards, discord_links
    commands/
      link.js           # /questboard link | unlink | use | whichboard
      tasks.js          # /tasks
      mine.js           # /mine
      standup.js        # /standup
      sprint.js         # /sprint
    format.js           # board JSON -> Discord embed objects (pure)
    register.js         # one-shot: push slash-command defs to Discord
  test/
```

`discord/` is a standalone npm package (not a workspace of `backend/` or
`frontend/`). It shares no code with them; the contract is the REST API.

### Component responsibilities

- **`api.js`** — the only file that knows REST shapes. Exposes
  `getBoards(token)`, `getBoard(token, boardId)`, and a `redeemCode({
  code, discordUserId })` that uses the bot secret. Wraps `fetch`, maps
  non-2xx to typed errors (`NotLinkedError`, `ForbiddenError`,
  `ApiUnreachableError`).
- **`store.js`** — bot-local SQLite CRUD. No business logic.
- **`format.js`** — pure functions: `(boardJson, opts) -> embed`. No
  Discord client, no network. Fully unit-testable. Owns all truncation
  to Discord limits.
- **`commands/*.js`** — each exports `{ data, execute, autocomplete? }`.
  Resolve the caller's link, resolve the target board, call `api.js`,
  pass the result to `format.js`, reply.
- **`index.js`** — connects the client, routes interactions to command
  modules, handles graceful shutdown (`SIGTERM` -> destroy client).
- **`register.js`** — run manually (`npm run register`) when command
  definitions change. Guild-scoped in development (instant), global in
  production.

### Bot-local state

File: `/mnt/data/questboard-bot.sqlite` (same volume as the API DB).
Add it to `deploy/oracle/backup-db.sh`.

```sql
CREATE TABLE IF NOT EXISTS channel_boards (
  channel_id        TEXT PRIMARY KEY,
  board_id          TEXT NOT NULL,
  set_by_discord_id TEXT NOT NULL,
  set_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discord_links (
  discord_user_id   TEXT PRIMARY KEY,
  app_user_id       TEXT NOT NULL,
  integration_token TEXT NOT NULL,
  linked_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Nothing beyond IDs and one token per person is stored bot-side.
`channel_boards` is deliberately shared: anyone in a channel can set and
see its default board. Querying still requires the caller to be linked
and a member of that board.

## Backend changes

All additive. The new endpoints are inert until a bot calls them.

### Schema (new tables, created in `backend/db.js`)

```sql
CREATE TABLE IF NOT EXISTS integration_tokens (
  token        TEXT PRIMARY KEY,          -- "qbit_" + nanoid(32)
  user_id      TEXT NOT NULL,
  kind         TEXT NOT NULL,             -- 'discord'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS discord_link_codes (
  code       TEXT PRIMARY KEY,            -- 6 digits, zero-padded
  user_id    TEXT NOT NULL,
  expires_at TEXT NOT NULL,               -- datetime, 10 min TTL
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

Read-only is enforced at the middleware layer, not stored per-token, to
keep v1 simple. `ON DELETE CASCADE` means deleting a user cleans both
tables up.

On each code write, sweep expired rows:
`DELETE FROM discord_link_codes WHERE expires_at < datetime('now')`.

### Route file `backend/routes/integrations.js`

Two routers, mounted at **non-overlapping prefixes** in `backend/app.js`
so there is no Express match-order ambiguity:

```js
import integrationRoutes, { botRouter } from "./routes/integrations.js";
app.use("/api/bot", botRouter);                          // bot-only: X-Bot-Secret
app.use("/api/integrations", authMiddleware, integrationRoutes); // JWT users
```

`botRouter` defines exactly one route, `POST /discord/redeem` (full path
`/api/bot/discord/redeem`). Everything a logged-in user calls lives under
`/api/integrations`. The prefixes do not share a path segment beyond
`/api`, so registration order does not matter.

**Authed endpoints (`integrationRoutes`, behind `authMiddleware`, JWT
only in practice):**

- `POST /discord/link-code`
  -> `{ code: "482913", expiresAt: "<iso>" }`
  Generates a single-use 6-digit code for `req.userId`, TTL 10 min.
  Called by the frontend.

- `GET /discord/status`
  -> `{ linked: boolean }`
  `linked` is true iff the user has at least one `kind='discord'`
  integration token. The API does not store the Discord user id, so v1
  reports connected / not connected only.

- `DELETE /discord/link`
  Deletes all `kind='discord'` integration tokens for `req.userId`.
  Returns `{ ok: true }`. The bot's `discord_links` row goes stale and
  its next command re-prompts the user to link.

**Bot-only endpoint (`botRouter`, no `authMiddleware`, mounted at `/api/bot`):**

- `POST /discord/redeem`
  Header: `X-Bot-Secret: <BOT_REDEEM_SECRET>`. Constant-time compare;
  missing/wrong -> 401.
  Body: `{ code: string, discordUserId: string }`.
  Looks up the code; if missing or expired -> 400
  `{ error: "invalid_or_expired_code" }`. On success: delete the code,
  insert an `integration_tokens` row (`qbit_` + `nanoid(32)`,
  `kind='discord'`), respond
  `{ token, appUserId, displayName }`.
  `discordUserId` is accepted for logging/future use; v1 does not
  persist it server-side.

### `authMiddleware` change (`backend/routes/auth.js`)

After extracting the `Bearer` value:

```js
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
// ...existing jwt.verify path, which sets req.authKind = "user"
```

### Read-only guard

A small middleware inserted before the resource routers in
`backend/app.js`:

```js
function integrationReadOnly(req, res, next) {
  if (req.authKind === "integration" && req.method !== "GET") {
    return res.status(403).json({ error: "This token is read-only" });
  }
  next();
}
app.use("/api/boards", authMiddleware, integrationReadOnly, boardRoutes);
// ...same for tasks, teams, users, sprints, subtasks
```

The v1 bot cannot mutate anything even if a command is miswired.

### Backend tests (`backend/test/integrations.test.js`)

- issue code -> redeem -> `qbit_` token authorizes `GET /api/boards/:id`
- same token -> `POST /api/tasks` returns 403
- expired code -> `POST /api/bot/discord/redeem` returns 400
- `POST /api/bot/discord/redeem` without `X-Bot-Secret` -> 401
- `DELETE /discord/link` -> the previously working token now 401s
- a `qbit_` token for user A -> `GET /api/boards/:id` for a board only
  user B belongs to returns 403/404 (same as a normal user)
- `GET /discord/status` reflects linked / not-linked

## The link flow, end to end

1. **Questboard -> Settings -> "Connect Discord".** Frontend calls
   `POST /api/integrations/discord/link-code`. UI shows the 6-digit code,
   a copy button, a 10-minute countdown, and the literal instruction
   `Run /questboard link 482913 in Discord`.
2. **Discord:** user runs `/questboard link code:482913`. Handler reads
   `interaction.user.id` (always available).
3. **Bot -> API:** `POST /api/bot/discord/redeem` with
   `{ code, discordUserId }` and `X-Bot-Secret`.
4. **API:** validates and deletes the code, mints an
   `integration_tokens` row, responds `{ token, appUserId, displayName }`.
5. **Bot:** upserts `discord_links(discord_user_id, app_user_id,
   integration_token)`. Replies ephemerally: "Linked to Questboard as
   **Max**."
6. **Subsequent commands:** handler looks up `interaction.user.id` in
   `discord_links`. No row -> ephemeral prompt to link. Row -> call the
   API with that user's `qbit_` token.
7. **Unlink:** `/questboard unlink` (bot deletes its row + calls
   `DELETE /api/integrations/discord/link`), or "Disconnect Discord" in
   Settings (API deletes the token; bot row goes stale and re-prompts).

### Failure modes

| Situation | Behavior |
|---|---|
| Bad / expired code | ephemeral: "That code is invalid or expired — generate a new one in Questboard Settings." |
| API unreachable | ephemeral: "Questboard isn't responding, try again in a moment." |
| Token rejected mid-session (revoked from Settings) | bot deletes its stale `discord_links` row, replies: "Your link was revoked — run `/questboard link` to reconnect." |
| Command needs a board, none resolved | ephemeral: "No board set for this channel — run `/questboard use` or pass `board:`." |
| Caller not a member of the target board | ephemeral: "You don't have access to that board." |

## Commands & output

Replies are **ephemeral by default**. `/standup` replies **publicly**
(it is meant to be shared).

Board resolution for board-scoped commands:
explicit `board:` option -> channel default (`channel_boards`) -> error.

### `/questboard` (subcommand group)

- `link code:<string>` — redeem a code.
- `unlink` — drop your link (bot row + `DELETE /api/integrations/discord/link`).
- `use board:<autocomplete>` — set this channel's default board.
  Autocomplete calls `GET /api/boards` with the caller's token, matches
  on name. Reply confirms and notes the channel default is shared.
- `whichboard` — show the channel's current default board.

### `/tasks` — board snapshot

Options (all optional): `status:` (choice: backlog / todo / in-progress
/ done), `assignee:` (autocomplete of the board's members + teams),
`sprint:` (autocomplete; defaults to the active sprint if one exists),
`board:`.

Output: an embed titled with the board name. Unfiltered -> one field per
status column. Filtered -> a single list. Each line:
`• <title> — <assignee> · <points>pt · <priority>`.
Truncated to Discord limits (25 fields, 1024 chars/field, 6000 total)
with a footer: "+N more — narrow with `status:` or `assignee:`".

### `/mine` — your tasks across your boards

Options: `status:` (defaults to "not done"), `board:` (to narrow).
Not limited to the channel's board. Grouped by board, then status.

### `/standup` — public

For the channel's board:
- **In Progress**, grouped by assignee.
- **Done since yesterday** — tasks with `completed_at` within 24h.
- **Blocked** — tasks with at least one dependency not in `done`.
  Computed bot-side by cross-referencing each task's `dependencies[].id`
  against the board's own task list from the same `GET /api/boards/:id`
  response — no API change needed.

### `/sprint` — active sprint status

The board's active sprint: name, date range, task counts by status,
percent done, and a `done / total` story-point line. "Active" is
whatever `GET /api/boards/:id` already reports as active — the API
derives it by calendar date via `backend/lib/sprint-status.js`
(`withDerivedActive`); the bot does not recompute it.

### Autocomplete

Handlers cache results per `(discordUserId, board)` for ~30s to avoid
hammering the API on every keystroke.

## Frontend

One new panel, `frontend/src/components/DiscordIntegration.jsx`
(~120 lines), rendered in the existing settings route. No router change.

- On mount: `GET /api/integrations/discord/status`.
- **Not linked:** "Connect Discord" button -> `POST
  /api/integrations/discord/link-code` -> show the 6-digit code
  (large, monospaced), a copy button, a live countdown, and
  `Run /questboard link 482913 in your Discord server`. Poll `status`
  every 5s while the code is live; on `linked: true`, swap to the linked
  state.
- **Linked:** "Connected to Discord" + "Disconnect" button -> `DELETE
  /api/integrations/discord/link` -> back to the button. (v1 shows
  connected state only — the API does not store the Discord username.)

Reuses existing form-control tokens (`.btn-primary`, card/section
classes). A few new client methods in `frontend/src/api.js`.

Nothing touches the board view, the Kanban components, or frontend auth.

## Deployment

### New files

- `discord/` (the whole package).
- `deploy/oracle/questboard-bot.service` — `User=kanban`,
  `EnvironmentFile=/etc/questboard/bot.env`,
  `WorkingDirectory=/opt/gamified-kanban/discord`,
  `ExecStart=/usr/bin/node src/index.js`, `Restart=on-failure`.
- `deploy/oracle/bot.env.example`.

### Secrets — `/etc/questboard/bot.env` (chmod 600, owned by `kanban`)

```
DISCORD_TOKEN=          # bot token from the Discord Developer Portal
DISCORD_CLIENT_ID=      # application ID
DISCORD_DEV_GUILD_ID=   # optional: server ID for instant command registration in dev
API_BASE=http://127.0.0.1:4000
BOT_DB_PATH=/mnt/data/questboard-bot.sqlite
BOT_REDEEM_SECRET=      # openssl rand -hex 32, MUST match the API's copy
```

Add `BOT_REDEEM_SECRET` to `/etc/questboard/api.env` (and
`deploy/oracle/api.env.example`) with the same value.

### Deploy checklist (updated)

```
sudo -u kanban -H bash -c 'cd /opt/gamified-kanban && git pull \
  && (cd backend && npm ci --omit=dev) \
  && (cd discord && npm ci --omit=dev)'
# only when slash-command definitions changed:
sudo -u kanban -H bash -c 'cd /opt/gamified-kanban/discord && npm run register'
sudo systemctl restart gamified-kanban-api questboard-bot
curl -sS -i https://40-233-18-200.sslip.io/api/health
sudo journalctl -u questboard-bot -n 30 --no-pager
```

## Discord application setup (one-time, done by the operator)

1. **Create the application** — <https://discord.com/developers/applications>
   -> "New Application", name "Questboard". Copy the **Application ID**
   -> `DISCORD_CLIENT_ID`.
2. **Add a bot user** — "Bot" tab -> "Add Bot" -> "Reset Token" -> copy
   -> `DISCORD_TOKEN`. Secret; goes only in `/etc/questboard/bot.env`.
3. **Intents** — none. Leave Message Content, Presence, and Server
   Members intents **off**.
4. **Invite to the server** — "OAuth2 -> URL Generator" -> scopes `bot`
   + `applications.commands` -> bot permissions: Send Messages, Embed
   Links, Use Slash Commands. Open the URL, pick the server, authorize.
5. **Register commands** — after first deploy, on the VM:
   `cd /opt/gamified-kanban/discord && npm run register`. Global
   registration can take up to an hour to propagate; set
   `DISCORD_DEV_GUILD_ID` to register against one server instantly
   during development.
6. **`BOT_REDEEM_SECRET`** — `openssl rand -hex 32`; put the same value
   in `/etc/questboard/bot.env` and `/etc/questboard/api.env`.

## Testing

### Backend

`backend/test/integrations.test.js` — see the list under "Backend
changes". Runs in the existing `node:test` + `supertest` suite.

### Bot (`discord/test/`, `node:test`)

- **`format.js`** — pure. Fixture board JSON -> assert embed structure,
  field grouping, line formatting, and the truncation / "+N more"
  behavior at Discord's limits.
- **`store.js`** — CRUD against a temp SQLite file (`BOT_DB_PATH` pointed
  at a tmp path).
- **command handlers** — `api.js` stubbed. Assert: "not linked" prompt
  when no `discord_links` row; board-resolution precedence (explicit
  `board:` > channel default > error); ephemeral vs public reply choice
  per command; error-mode replies for `ApiUnreachableError` /
  `ForbiddenError`.
- No live Discord gateway connection in tests.

CI runs both the `backend` and `discord` suites.

## Security / threat model

- `DISCORD_TOKEN` and `BOT_REDEEM_SECRET` live only in
  `/etc/questboard/bot.env`, chmod 600, owned by `kanban`. Not in git;
  `.env*` is already gitignored.
- `integration_tokens` are read-only by the middleware guard. A
  compromised bot process can read a linked user's boards but cannot
  mutate anything.
- Link codes: single-use, 10-min TTL, deleted on use, swept when
  expired, and redemption additionally requires `BOT_REDEEM_SECRET`.
  Brute force is not viable.
- A Discord user can only ever act as the one Questboard account they
  linked. Board access uses the API's existing membership checks; no
  new authorization path.
- `channel_boards` is intentionally shared state (anyone in a channel
  can set/see its default board). Querying still requires the caller to
  be linked and a board member.
- `constant-time` compare for `X-Bot-Secret`.

## Rollout

1. Ship backend + frontend. The integration endpoints are dormant
   without a bot.
2. Do the Discord application setup.
3. Deploy the bot; register commands guild-scoped to the operator's
   server.
4. Link the operator's own account; smoke-test every command.
5. Register commands globally.
6. Announce to the team; each member links their own account.

**Observability:** bot logs to stdout -> `journalctl -u questboard-bot`.
Structured lines: command name, discord user id, resolved board, latency,
API status code.

**Rollback:** `systemctl stop questboard-bot` removes the entire feature
with zero effect on the app. Backend additions are additive and dormant
without the bot.

## Open questions / deferred

- `GET /discord/status` reports connected / not-connected only — the API
  does not store the Discord user id or username. If Settings should
  show *which* Discord account is linked, a later change has the bot
  report the mapping back to the API at redeem time.
- v2 candidates: write commands (create/move/complete), Questboard ->
  Discord notifications, natural-language questions via the Claude API.
