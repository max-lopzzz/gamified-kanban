import { MessageFlags } from "discord.js";

export function buildContext(interaction, { store, api }) {
  const toPayload = (p) => (typeof p === "string" ? { content: p } : p);
  return {
    discordUserId: interaction.user.id,
    channelId: interaction.channelId,
    sub: interaction.options.getSubcommand(false),
    opt: (name) => interaction.options.getString(name),
    store,
    api,
    reply: (p) => interaction.reply({ ...toPayload(p), flags: MessageFlags.Ephemeral }),
    replyPublic: (p) => interaction.reply(toPayload(p)),
    link() { return store.getLink(interaction.user.id); },
  };
}
