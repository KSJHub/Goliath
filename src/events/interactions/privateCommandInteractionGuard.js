'use strict';

const { Events, REST, Routes } = require('discord.js');
const { resolveTokenDetails } = require('../../config/tokenResolver');

const FORBIDDEN = new Set(['owner', 'commandcenter', 'Convert Emoji Shortcodes']);

async function cleanGuild(client, guildId) {
  if (!guildId) return;
  const mode = String(process.env.BOT_MODE || 'DEV').trim().toUpperCase();
  const token = String(resolveTokenDetails({ mode })?.token || '').trim();
  const applicationId = String(client.application?.id || client.user?.id || '').trim();
  if (!token || !applicationId) return;

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = await rest.get(Routes.applicationGuildCommands(applicationId, guildId));
  for (const command of commands || []) {
    if (!FORBIDDEN.has(String(command?.name || ''))) continue;
    await rest.delete(Routes.applicationGuildCommand(applicationId, guildId, command.id));
    console.warn(`[CommandGuard] Removed self-registered guild /${command.name} from ${guildId}.`);
  }
}

module.exports = {
  name: Events.InteractionCreate,
  once: false,

  async execute(interaction, client) {
    const customId = String(interaction?.customId || '');
    const commandName = String(interaction?.commandName || '');
    const touchesPrivateOwnerUi = customId.startsWith('owner:commandcenter:')
      || commandName === 'commandcenter';
    if (!touchesPrivateOwnerUi || !interaction?.guildId) return;

    // Audit Intelligence still contains legacy self-registration logic. Run
    // after its interaction has completed so the central command policy wins.
    setTimeout(() => {
      cleanGuild(client, interaction.guildId).catch((error) => {
        console.error('[CommandGuard] Interaction cleanup failed:', error?.message || error);
      });
    }, 1500);
  },
};
