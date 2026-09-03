import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error("DISCORD_TOKEN and DISCORD_CLIENT_ID are required");
  process.exit(1);
}

const body = commands.map((c) => c.data.toJSON());
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
const route = DISCORD_DEV_GUILD_ID
  ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_DEV_GUILD_ID)
  : Routes.applicationCommands(DISCORD_CLIENT_ID);

const out = await rest.put(route, { body });
console.log(`Registered ${out.length} commands ${DISCORD_DEV_GUILD_ID ? "to guild " + DISCORD_DEV_GUILD_ID : "globally"}.`);
