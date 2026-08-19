'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');

const { normalizeBotMode } = require('../../config/botModes');
const testDevOverride = require('../../owner/dev/DevOverrideManager');
const security = require('../../core/security/securityCore');

function modeLabel() {
  return normalizeBotMode(process.env.BOT_MODE);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('testdev')
    .setDescription('Owner-only DEV toggle for Goliath test override mode.'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!interaction.guild) {
      return interaction.editReply({ content: '❌ This command can only be used inside a server.' });
    }

    if (!testDevOverride.isDevMode()) {
      return interaction.editReply({
        content: [
          '❌ **Test Dev Override is disabled.**',
          '',
          `Current mode: \`${modeLabel()}\``,
          'This command only works in `DEV` and cannot enable anything in BETA or PRODUCTION.',
        ].join('\n'),
      });
    }

    if (!security.isBotOwner(interaction.user.id)) {
      return interaction.editReply({
        content: [
          '❌ Owner only. You cannot toggle DEV test override mode.',
          '',
          `Your ID: \`${interaction.user.id}\``,
          `OWNER_IDS loaded: \`${security.getBotOwnerIds().join(', ') || 'none'}\``,
        ].join('\n'),
      });
    }

    const state = testDevOverride.toggle(interaction.user.id);
    const billing = testDevOverride.getPaywallBypassState();

    if (state.blocked) {
      return interaction.editReply({ content: `❌ ${state.reason || 'Toggle blocked.'}` });
    }

    return interaction.editReply({
      content: [
        state.enabled ? '🟢 **Development Test Mode: ENABLED**' : '🔴 **Development Test Mode: DISABLED**',
        '',
        `Mode: \`${modeLabel()}\``,
        `Updated by: \`${interaction.user.id}\``,
        `Billing test unlock: \`${billing.active ? 'ON' : 'OFF'}\``,
        `Billing test plan: \`${billing.plan || 'none'}\``,
        '',
        state.enabled
          ? 'Goliath guard checks can now be skipped for DEV owner testing.'
          : 'Goliath guard checks are now operating normally.',
        '',
        billing.active
          ? 'All billing-gated modules and limits are open in DEV. Edit the DEV test JSON and set the billing unlock to false when testing vouchers or plan locks.'
          : 'Billing, vouchers, plan locks and limits are being tested normally.',
        '',
        'Discord API permissions are still enforced by Discord.',
      ].join('\n'),
    });
  },
};