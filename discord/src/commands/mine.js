import { SlashCommandBuilder } from "discord.js";
import { formatMine } from "../format.js";
import { NotLinkedError, ForbiddenError, ApiUnreachableError } from "../api.js";

const STATUS_CHOICES = ["backlog", "todo", "in-progress", "done"].map((s) => ({ name: s, value: s }));

export const data = new SlashCommandBuilder()
  .setName("mine")
  .setDescription("Your tasks across the boards you belong to")
  .addStringOption((o) => o.setName("status").setDescription("Filter by column").addChoices(...STATUS_CHOICES))
  .addStringOption((o) => o.setName("board").setDescription("Only this board").setAutocomplete(true));

function isMine(task, appUserId, board) {
  const teamIds = new Set((board.teams || []).filter((t) => (t.member_ids || []).includes(appUserId)).map((t) => t.id));
  return (task.assignees || []).some((a) => (a.type === "user" && a.id === appUserId) || (a.type === "team" && teamIds.has(a.id)));
}

export async function execute(ctx) {
  const link = ctx.link();
  if (!link) return ctx.reply("You're not linked yet — run `/questboard link`.");

  let boards;
  try {
    boards = await ctx.api.getBoards(link.integrationToken);
  } catch (err) {
    if (err instanceof NotLinkedError) { ctx.store.deleteLink(ctx.discordUserId); return ctx.reply("Your link was revoked — run `/questboard link`."); }
    if (err instanceof ApiUnreachableError) return ctx.reply("Questboard isn't responding, try again in a moment.");
    throw err;
  }
  const only = ctx.opt("board");
  if (only) boards = boards.filter((b) => b.id === only || b.name.toLowerCase() === only.toLowerCase());

  const status = ctx.opt("status");
  const pairs = [];
  for (const b of boards) {
    let full;
    try { full = await ctx.api.getBoard(link.integrationToken, b.id); }
    catch (err) { if (err instanceof ForbiddenError) continue; throw err; }
    let tasks = full.tasks.filter((t) => isMine(t, link.appUserId, full));
    tasks = status ? tasks.filter((t) => t.status === status) : tasks.filter((t) => t.status !== "done");
    if (tasks.length) pairs.push({ board: full, tasks });
  }
  return ctx.reply({ embeds: [formatMine(pairs)] });
}

export default { name: "mine", data, execute };
