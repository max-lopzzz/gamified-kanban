import { SlashCommandBuilder } from "discord.js";
import { formatTasks } from "../format.js";
import { NotLinkedError, ForbiddenError, ApiUnreachableError } from "../api.js";

const STATUS_CHOICES = ["backlog", "todo", "in-progress", "done"].map((s) => ({ name: s, value: s }));

export const data = new SlashCommandBuilder()
  .setName("tasks")
  .setDescription("Show tasks on a board")
  .addStringOption((o) => o.setName("status").setDescription("Filter by column").addChoices(...STATUS_CHOICES))
  .addStringOption((o) => o.setName("assignee").setDescription("Filter by assignee").setAutocomplete(true))
  .addStringOption((o) => o.setName("sprint").setDescription("Filter by sprint").setAutocomplete(true))
  .addStringOption((o) => o.setName("board").setDescription("Board (defaults to this channel's)").setAutocomplete(true));

function resolveBoardId(ctx) {
  return ctx.opt("board") || ctx.store.getChannelBoard(ctx.channelId);
}

export async function execute(ctx) {
  const link = ctx.link();
  if (!link) return ctx.reply("You're not linked yet — run `/questboard link`.");
  const boardId = resolveBoardId(ctx);
  if (!boardId) return ctx.reply("No board set for this channel — run `/questboard use` or pass `board:`.");

  let board;
  try {
    board = await ctx.api.getBoard(link.integrationToken, boardId);
  } catch (err) {
    if (err instanceof ForbiddenError) return ctx.reply("You don't have access to that board.");
    if (err instanceof NotLinkedError) {
      ctx.store.deleteLink(ctx.discordUserId);
      return ctx.reply("Your link was revoked — run `/questboard link` to reconnect.");
    }
    if (err instanceof ApiUnreachableError) return ctx.reply("Questboard isn't responding, try again in a moment.");
    throw err;
  }

  const embed = formatTasks(board, {
    status: ctx.opt("status") || undefined,
    assignee: ctx.opt("assignee") || undefined,
    sprintId: ctx.opt("sprint") || undefined,
  });
  return ctx.reply({ embeds: [embed] });
}

export async function autocomplete(ctx) {
  const link = ctx.store.getLink(ctx.discordUserId);
  if (!link) return [];
  const focused = ctx._focused || null; // set by index.js: which option is being completed
  try {
    if (focused === "board") {
      const boards = await ctx.api.getBoards(link.integrationToken);
      const q = (ctx.opt("board") || "").toLowerCase();
      return boards.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 25)
        .map((b) => ({ name: b.name, value: b.id }));
    }
    const boardId = resolveBoardId(ctx);
    if (!boardId) return [];
    const board = await ctx.api.getBoard(link.integrationToken, boardId);
    if (focused === "assignee") {
      const q = (ctx.opt("assignee") || "").toLowerCase();
      const names = [
        ...board.members.map((m) => m.display_name),
        ...board.teams.map((t) => t.name),
      ];
      return names.filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 25).map((n) => ({ name: n, value: n }));
    }
    if (focused === "sprint") {
      const q = (ctx.opt("sprint") || "").toLowerCase();
      return board.sprints.filter((s) => !q || s.name.toLowerCase().includes(q)).slice(0, 25)
        .map((s) => ({ name: s.name, value: s.id }));
    }
  } catch { /* fall through */ }
  return [];
}

export default { name: "tasks", data, execute, autocomplete };
