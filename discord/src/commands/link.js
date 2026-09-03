import { SlashCommandBuilder } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("questboard")
  .setDescription("Link your Questboard account and set this channel's board")
  .addSubcommand((s) => s.setName("link").setDescription("Link with a code from Questboard → Settings")
    .addStringOption((o) => o.setName("code").setDescription("6-digit code").setRequired(true)))
  .addSubcommand((s) => s.setName("unlink").setDescription("Disconnect your Questboard account"))
  .addSubcommand((s) => s.setName("use").setDescription("Set this channel's default board")
    .addStringOption((o) => o.setName("board").setDescription("Board name").setRequired(true).setAutocomplete(true)))
  .addSubcommand((s) => s.setName("whichboard").setDescription("Show this channel's default board"));

async function resolveBoardName(api, token, boardId) {
  try {
    const boards = await api.getBoards(token);
    return boards.find((b) => b.id === boardId)?.name ?? null;
  } catch { return null; }
}

export async function execute(ctx) {
  if (ctx.sub === "link") {
    const code = ctx.opt("code");
    try {
      const { token, appUserId, displayName } = await ctx.api.redeemCode({ code, discordUserId: ctx.discordUserId });
      ctx.store.upsertLink(ctx.discordUserId, appUserId, token);
      return ctx.reply(`Linked to Questboard as **${displayName}**.`);
    } catch {
      return ctx.reply("That code is invalid or expired — generate a new one in Questboard → Settings.");
    }
  }

  if (ctx.sub === "unlink") {
    const link = ctx.link();
    ctx.store.deleteLink(ctx.discordUserId);
    if (link) { try { await ctx.api.unlink(link.integrationToken); } catch {} }
    return ctx.reply("Unlinked.");
  }

  if (ctx.sub === "use") {
    const link = ctx.link();
    if (!link) return ctx.reply("You're not linked yet — run `/questboard link` (get a code from Questboard → Settings).");
    let boards;
    try { boards = await ctx.api.getBoards(link.integrationToken); }
    catch { return ctx.reply("Questboard isn't responding, try again in a moment."); }
    const q = ctx.opt("board");
    const match = boards.find((b) => b.id === q) || boards.find((b) => b.name.toLowerCase() === q.toLowerCase());
    if (!match) return ctx.reply("No board of yours matches that.");
    ctx.store.setChannelBoard(ctx.channelId, match.id, ctx.discordUserId);
    return ctx.reply(`This channel now defaults to **${match.name}**. Anyone here can query it.`);
  }

  if (ctx.sub === "whichboard") {
    const id = ctx.store.getChannelBoard(ctx.channelId);
    if (!id) return ctx.reply("No board set for this channel yet — run `/questboard use`.");
    const link = ctx.link();
    const name = link ? await resolveBoardName(ctx.api, link.integrationToken, id) : null;
    if (!name) return ctx.reply("This channel has a board set. Link your account with `/questboard link` to see its name.");
    return ctx.reply(`This channel defaults to **${name}**.`);
  }

  return ctx.reply("Unknown subcommand.");
}

export async function autocomplete(ctx) {
  const link = ctx.store.getLink(ctx.discordUserId);
  if (!link) return [];
  try {
    const input = (ctx.opt("board") || "").toLowerCase();
    const boards = await ctx.api.getBoards(link.integrationToken);
    return boards
      .filter((b) => !input || b.name.toLowerCase().includes(input))
      .slice(0, 25)
      .map((b) => ({ name: b.name, value: b.id }));
  } catch { return []; }
}

export default { name: "questboard", data, execute, autocomplete };
