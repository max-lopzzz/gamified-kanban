import { NotLinkedError, ForbiddenError, ApiUnreachableError } from "../api.js";

export async function loadBoard(ctx) {
  const link = ctx.link();
  if (!link) return { error: "You're not linked yet — run `/questboard link`." };
  const boardId = ctx.opt("board") || ctx.store.getChannelBoard(ctx.channelId);
  if (!boardId) return { error: "No board set for this channel — run `/questboard use` or pass `board:`." };
  try {
    const board = await ctx.api.getBoard(link.integrationToken, boardId);
    return { board };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: "You don't have access to that board." };
    if (err instanceof NotLinkedError) {
      ctx.store.deleteLink(ctx.discordUserId);
      return { error: "Your link was revoked — run `/questboard link` to reconnect." };
    }
    if (err instanceof ApiUnreachableError) return { error: "Questboard isn't responding, try again in a moment." };
    throw err;
  }
}

export async function boardAutocomplete(ctx) {
  const link = ctx.store.getLink(ctx.discordUserId);
  if (!link) return [];
  try {
    const q = (ctx.opt("board") || "").toLowerCase();
    const boards = await ctx.api.getBoards(link.integrationToken);
    return boards.filter((b) => !q || b.name.toLowerCase().includes(q)).slice(0, 25)
      .map((b) => ({ name: b.name, value: b.id }));
  } catch { return []; }
}
