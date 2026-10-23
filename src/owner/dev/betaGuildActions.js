'use strict';
const { randomBytes } = require('node:crypto');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const security = require('../../core/security/protection/core');
const PREFIX = 'ownerpanel:guildaccess:';
const pending = new Map();

// Matches the enabled DEV role permissions supplied by the owner.
// BigInt preserves every permission bit, including newer Discord flags.
const INVITE_PERMISSION_BITS = {
  CreateInstantInvite: 0,
  KickMembers: 1,
  BanMembers: 2,
  ManageChannels: 4,
  ManageGuild: 5,
  AddReactions: 6,
  ViewAuditLog: 7,
  ViewChannel: 10,
  SendMessages: 11,
  SendTTSMessages: 12,
  ManageMessages: 13,
  EmbedLinks: 14,
  AttachFiles: 15,
  ReadMessageHistory: 16,
  Connect: 20,
  Speak: 21,
  MuteMembers: 22,
  DeafenMembers: 23,
  MoveMembers: 24,
  UseVAD: 25,
  ManageNicknames: 27,
  ManageRoles: 28,
  ManageWebhooks: 29,
  ManageGuildExpressions: 30,
  ManageEvents: 33,
  ManageThreads: 34,
  CreatePublicThreads: 35,
  CreatePrivateThreads: 36,
  SendMessagesInThreads: 38,
  ModerateMembers: 40,
  CreateGuildExpressions: 43,
  CreateEvents: 44,
  SetVoiceChannelStatus: 48,
  SendPolls: 49,
  UseExternalApps: 50,
  PinMessages: 51,
};
const INVITE_PERMISSIONS = Object.values(INVITE_PERMISSION_BITS)
  .reduce((mask, bit) => mask | (1n << BigInt(bit)), 0n)
  .toString();


function restartRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ownerpanel:restart:ask:beta')
      .setLabel('Restart BETA').setStyle(ButtonStyle.Primary)
  );
}

async function handle(interaction, api) {
  const action = String(interaction.customId || '').slice(PREFIX.length);
  if (!['remove', 'invite', 'remove-id', 'invite-id'].includes(action) &&
      !action.startsWith('remove-confirm:') &&
      !action.startsWith('remove-cancel:')) return false;

  if (String(process.env.BOT_MODE || '').trim().toUpperCase() !== 'DEV' ||
      !security.isBotOwner(interaction.user?.id)) {
    await interaction.reply({
      content: '❌ Configured owner on DEV required.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (action === 'remove' || action === 'invite') {
    await interaction.showModal(
      new ModalBuilder().setCustomId(`${PREFIX}${action}-id`)
        .setTitle(action === 'remove' ? 'Remove BETA Guild' : 'Invite BETA Bot')
        .addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('guild_id')
            .setLabel('Discord server ID')
            .setStyle(TextInputStyle.Short).setRequired(true)
            .setMinLength(17).setMaxLength(20)
        ))
    );
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const now = Date.now();
    for (const [nonce, entry] of pending) {
      if (entry.expires <= now) pending.delete(nonce);
    }

    if (action === 'remove-id' || action === 'invite-id') {
      const guildId = interaction.fields.getTextInputValue('guild_id').trim();
      if (!api.validId(guildId)) throw new Error('Enter a valid server ID.');

      if (action === 'invite-id') {
        if (!api.parseIds(api.readEnv('beta').BETA_GUILD_IDS).includes(guildId)) {
          throw new Error('Approve this guild first, then restart BETA before inviting.');
        }
        const url = new URL('https://discord.com/oauth2/authorize');
        url.search = new URLSearchParams({
          client_id: api.botId,
          scope: 'bot applications.commands',
          permissions: INVITE_PERMISSIONS,
          guild_id: guildId,
          disable_guild_select: 'true',
        }).toString();
        await interaction.editReply({
          content: `🔗 Invite BETA to **${guildId}**.\n` +
            'If you just approved it, restart BETA and wait for it to return before opening the invite.\n' +
            'The invite requests the configured DEV permission set (Administrator excluded). After joining, place the bot role above the roles it must manage.',
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setLabel('Invite BETA Bot')
                .setStyle(ButtonStyle.Link).setURL(url.toString())
            ),
            restartRow(),
          ],
          allowedMentions: { parse: [] },
        });
      } else {
        const nonce = randomBytes(12).toString('hex');
        pending.set(nonce, {
          guildId, owner: interaction.user.id, expires: now + 60000,
        });
        await interaction.editReply({
          content: `Remove BETA access for **${guildId}** and make the beta bot leave?\n` +
            'This removes its approval. Rejoining later requires approval and a new invitation.\n' +
            'Confirmation expires in 60 seconds.',
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${PREFIX}remove-confirm:${nonce}`)
              .setLabel('Confirm Removal').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`${PREFIX}remove-cancel:${nonce}`)
              .setLabel('Cancel').setStyle(ButtonStyle.Secondary)
          )],
          allowedMentions: { parse: [] },
        });
      }
      return true;
    }

    const nonce = action.split(':')[1];
    const entry = pending.get(nonce);
    if (!entry || entry.owner !== interaction.user.id || entry.expires <= now) {
      throw new Error('Invalid or expired removal confirmation.');
    }
    pending.delete(nonce);
    if (action.startsWith('remove-cancel:')) {
      await interaction.editReply('Removal cancelled.');
      return true;
    }

    const env = api.readEnv('beta');
    const token = String(env.DISCORD_BOT_TOKEN_BETA || '').trim();
    if (!token) throw new Error('BETA token missing; no changes made.');

    async function request(route, method = 'GET') {
      return fetch(`https://discord.com/api/v10${route}`, {
        method,
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(15000),
      });
    }
    const identity = await request('/users/@me');
    if (!identity.ok) throw new Error(`Identity check HTTP ${identity.status}; no changes made.`);
    const bot = await identity.json();
    if (bot.id !== api.botId) throw new Error('BETA identity mismatch; no changes made.');

    api.removeGuild(entry.guildId);
    console.log(`[Owner Guild Access] owner=${interaction.user.id} removed-beta=${entry.guildId}`);

    let outcome;
    try {
      const response = await request(`/users/@me/guilds/${entry.guildId}`, 'DELETE');
      if (response.status === 204) outcome = '✅ Discord confirmed the beta bot left.';
      else if (response.status === 404) outcome = 'ℹ️ Discord reports the guild was not found for this bot.';
      else outcome = `⚠️ Leave not confirmed: Discord HTTP ${response.status}.`;
    } catch {
      outcome = '⚠️ Leave request could not be confirmed.';
    }

    await interaction.editReply({
      content: `Approval removed for **${entry.guildId}**.\n${outcome}\n` +
        '**Restart BETA now** to apply the saved restriction to its running allowlist.',
      components: [restartRow()],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    await interaction.editReply({
      content: `❌ ${error.message}`,
      allowedMentions: { parse: [] },
    });
  }
  return true;
}
module.exports = { handle };
