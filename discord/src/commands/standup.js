import { SlashCommandBuilder } from "discord.js";
import { formatStandup } from "../format.js";
import { loadBoard, boardAutocomplete } from "./_shared.js";

export const data = new SlashCommandBuilder()
  .setName("standup")
  .setDescription("Post an In Progress / Done / Blocked summary for the channel's board")
  .addStringOption((o) => o.setName("board").setDescription("Board (defaults to this channel's)").setAutocomplete(true));

export async function execute(ctx) {
  const { board, error } = await loadBoard(ctx);
  if (error) return ctx.reply(error);
  return ctx.replyPublic(formatStandup(board).content);
}

export async function autocomplete(ctx) { return boardAutocomplete(ctx); }

export default { name: "standup", data, execute, autocomplete };
