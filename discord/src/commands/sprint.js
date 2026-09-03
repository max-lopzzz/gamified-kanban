import { SlashCommandBuilder } from "discord.js";
import { formatSprint } from "../format.js";
import { loadBoard, boardAutocomplete } from "./_shared.js";

export const data = new SlashCommandBuilder()
  .setName("sprint")
  .setDescription("Show the active sprint for the channel's board")
  .addStringOption((o) => o.setName("board").setDescription("Board (defaults to this channel's)").setAutocomplete(true));

export async function execute(ctx) {
  const { board, error } = await loadBoard(ctx);
  if (error) return ctx.reply(error);
  return ctx.reply({ embeds: [formatSprint(board)] });
}

export async function autocomplete(ctx) { return boardAutocomplete(ctx); }

export default { name: "sprint", data, execute, autocomplete };
