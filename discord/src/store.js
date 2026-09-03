import Database from "better-sqlite3";

export default function createStore(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
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
  `);

  return {
    getChannelBoard(channelId) {
      const row = db.prepare("SELECT board_id FROM channel_boards WHERE channel_id = ?").get(channelId);
      return row ? row.board_id : null;
    },
    setChannelBoard(channelId, boardId, setByDiscordId) {
      db.prepare(`
        INSERT INTO channel_boards (channel_id, board_id, set_by_discord_id, set_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(channel_id) DO UPDATE SET
          board_id = excluded.board_id,
          set_by_discord_id = excluded.set_by_discord_id,
          set_at = excluded.set_at
      `).run(channelId, boardId, setByDiscordId);
    },
    getLink(discordUserId) {
      const row = db.prepare("SELECT * FROM discord_links WHERE discord_user_id = ?").get(discordUserId);
      return row
        ? { discordUserId: row.discord_user_id, appUserId: row.app_user_id, integrationToken: row.integration_token }
        : null;
    },
    upsertLink(discordUserId, appUserId, integrationToken) {
      db.prepare(`
        INSERT INTO discord_links (discord_user_id, app_user_id, integration_token, linked_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(discord_user_id) DO UPDATE SET
          app_user_id = excluded.app_user_id,
          integration_token = excluded.integration_token,
          linked_at = excluded.linked_at
      `).run(discordUserId, appUserId, integrationToken);
    },
    deleteLink(discordUserId) {
      db.prepare("DELETE FROM discord_links WHERE discord_user_id = ?").run(discordUserId);
    },
    close() {
      db.close();
    },
  };
}
