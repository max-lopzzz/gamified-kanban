import { Client, GatewayIntentBits, MessageFlags } from "discord.js";
import createStore from "./store.js";
import { createApi } from "./api.js";
import { buildContext } from "./context.js";
import { byName } from "./commands/index.js";
import { dispatch } from "./router.js";

const {
  DISCORD_TOKEN,
  API_BASE = "http://127.0.0.1:4000",
  BOT_DB_PATH = "./questboard-bot.sqlite",
  BOT_REDEEM_SECRET,
} = process.env;

if (!DISCORD_TOKEN) { console.error("DISCORD_TOKEN is required"); process.exit(1); }

const store = createStore(BOT_DB_PATH);
const api = createApi({ baseUrl: API_BASE, botSecret: BOT_REDEEM_SECRET });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", (c) => console.log(`[bot] logged in as ${c.user.tag}`));

client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const ctx = buildContext(interaction, { store, api });
      const { ok } = await dispatch({ name: interaction.commandName }, ctx, { byName });
      if (!ok && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: "Something went wrong.", flags: MessageFlags.Ephemeral });
      }
    } else if (interaction.isAutocomplete()) {
      const cmd = byName.get(interaction.commandName);
      if (!cmd?.autocomplete) return interaction.respond([]);
      const focused = interaction.options.getFocused(true);
      const ctx = {
        discordUserId: interaction.user.id,
        channelId: interaction.channelId,
        _focused: focused.name,
        opt: (name) => interaction.options.getString(name, false),
        store, api,
        link: () => store.getLink(interaction.user.id),
      };
      const choices = (await cmd.autocomplete(ctx)) || [];
      await interaction.respond(choices.slice(0, 25));
    }
  } catch (err) {
    console.error("[bot] interaction handler error:", err);
  }
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { client.destroy(); store.close(); process.exit(0); });
}

client.login(DISCORD_TOKEN);
