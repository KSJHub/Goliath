'use strict';

const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const social = require('./social');

const sessions = new Map();
const TYPES = ['live', 'upload', 'short', 'post'];

function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(id, label, style = ButtonStyle.Secondary, disabled = false) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled); }
function clean(value, max = 1000) { return String(value || '').trim().slice(0, max); }
function key(interaction) { return `${interaction.guildId}:${interaction.user.id}`; }
function session(interaction) {
  const profiles = social.creators.list(interaction.guildId);
  const accounts = social.getConfig(interaction.guildId).accounts || [];
  const current = sessions.get(key(interaction)) || { creatorId: profiles[0]?.creatorId || null, accountId: accounts[0]?.accountId || null, alertType: 'live' };
  if (current.creatorId && !profiles.some((item) => item.creatorId === current.creatorId)) current.creatorId = profiles[0]?.creatorId || null;
  if (current.accountId && !accounts.some((item) => item.accountId === current.accountId)) current.accountId = accounts[0]?.accountId || null;
  sessions.set(key(interaction), current);
  return current;
}
function selectedProfile(guildId, state) { return social.creators.get(guildId, state.creatorId); }
function selectedAccount(guildId, state) { return social.getConfig(guildId).accounts.find((item) => item.accountId === state.accountId) || null; }

function creatorSelect(guildId, state) {
  const profiles = social.creators.list(guildId);
  const menu = new StringSelectMenuBuilder().setCustomId('admin:socialhub:creator').setPlaceholder(profiles.length ? 'Select creator profile' : 'No creator profiles').setMinValues(1).setMaxValues(1).setDisabled(!profiles.length);
  if (profiles.length) menu.addOptions(profiles.slice(0, 25).map((profile) => ({ label: clean(profile.displayName, 100), description: clean(`${profile.group || 'Ungrouped'} · ${profile.accountIds.length} linked platform(s)`, 100), value: profile.creatorId, default: profile.creatorId === state.creatorId })));
  return row(menu);
}
function accountSelect(guildId, state) {
  const accounts = social.getConfig(guildId).accounts || [];
  const menu = new StringSelectMenuBuilder().setCustomId('admin:socialhub:account').setPlaceholder(accounts.length ? 'Select platform account' : 'No platform accounts').setMinValues(1).setMaxValues(1).setDisabled(!accounts.length);
  if (accounts.length) menu.addOptions(accounts.slice(0, 25).map((account) => ({ label: clean(account.displayName || account.username || account.platform, 100), description: clean(`${account.platform} · ${account.username || account.externalId || 'unresolved'}`, 100), value: account.accountId, default: account.accountId === state.accountId })));
  return row(menu);
}
function typeSelect(state) {
  return row(new StringSelectMenuBuilder().setCustomId('admin:socialhub:type').setPlaceholder('Simulation alert type').setMinValues(1).setMaxValues(1).addOptions(TYPES.map((type) => ({ label: type[0].toUpperCase() + type.slice(1), value: type, default: type === state.alertType }))));
}
function profileModal(profile = null) {
  return new ModalBuilder().setCustomId(profile ? 'admin:socialhub:profileEditSubmit' : 'admin:socialhub:profileCreateSubmit').setTitle(profile ? 'Edit Creator Profile' : 'Create Creator Profile').addComponents(
    row(new TextInputBuilder().setCustomId('name').setLabel('Creator display name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120).setValue(profile?.displayName || '')),
    row(new TextInputBuilder().setCustomId('group').setLabel('Group').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(80).setValue(profile?.group || '')),
    row(new TextInputBuilder().setCustomId('tags').setLabel('Tags (comma separated)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500).setValue((profile?.tags || []).join(', '))),
    row(new TextInputBuilder().setCustomId('notes').setLabel('Notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(2000).setValue(profile?.notes || '')),
  );
}
function payload(interaction) {
  const state = session(interaction);
  const profile = selectedProfile(interaction.guildId, state);
  const account = selectedAccount(interaction.guildId, state);
  const linked = profile?.accountIds || [];
  const preview = account ? social.simulator.build(interaction.guildId, account, state.alertType) : null;
  const description = profile ? [
    `**Creator:** ${profile.displayName}`,
    `**Group:** ${profile.group || 'None'}`,
    `**Tags:** ${profile.tags.length ? profile.tags.join(', ') : 'None'}`,
    `**Status:** ${profile.enabled !== false ? 'Enabled ✅' : 'Disabled ⏸️'}`,
    `**Linked Platforms:** ${linked.length}`,
    `**Notes:** ${profile.notes || 'None'}`,
    '',
    account ? `**Selected Account:** ${account.platform} · ${account.username || account.externalId || 'unresolved'}\n**Linked:** ${linked.includes(account.accountId) ? 'Yes ✅' : 'No'}\n**Simulation Route:** ${preview?.channelId ? `<#${preview.channelId}>` : 'Not configured'}\n**Quiet Hours:** ${preview?.quietHours ? 'Active 🌙' : 'Inactive'}` : '**Selected Account:** None',
  ].join('\n') : 'Create a unified creator profile, then link one or more existing platform accounts. No API keys or private creator access are required.';
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('👤 Social Studio · Creator Hub').setDescription(description).setFooter({ text: 'Creator profiles unify platforms, notes, tags, defaults and simulation.' }).setTimestamp();
  return {
    embeds: [embed],
    components: [
      creatorSelect(interaction.guildId, state),
      accountSelect(interaction.guildId, state),
      typeSelect(state),
      row(
        button('admin:socialhub:create', '➕ New Profile', ButtonStyle.Success),
        button('admin:socialhub:edit', '✏️ Edit', ButtonStyle.Primary, !profile),
        button('admin:socialhub:link', linked.includes(account?.accountId) ? '🔗 Unlink Account' : '🔗 Link Account', ButtonStyle.Secondary, !profile || !account),
        button('admin:socialhub:simulatePreview', '🧪 Preview', ButtonStyle.Secondary, !account),
        button('admin:socialhub:simulateSend', '📨 Send Simulation', ButtonStyle.Primary, !account),
      ),
      row(
        button('admin:socialhub:toggle', profile?.enabled === false ? '▶️ Enable Profile' : '⏸️ Disable Profile', ButtonStyle.Secondary, !profile),
        button('admin:socialhub:rebuild', '♻️ Rebuild Profiles'),
        button('admin:socialhub:delete', '🗑️ Delete Profile', ButtonStyle.Danger, !profile),
        button('admin:social', '⬅️ Social Studio'),
      ),
    ],
  };
}
async function respond(interaction, data) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(data);
  else await interaction.update(data);
  return true;
}

async function handleSocialCreatorInteraction(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('admin:socialhub')) return false;
  const state = session(interaction);
  const actorId = interaction.user?.id || null;
  try {
    if (id === 'admin:socialhub') return respond(interaction, payload(interaction));
    if (interaction.isStringSelectMenu?.() && id === 'admin:socialhub:creator') { state.creatorId = interaction.values[0]; return respond(interaction, payload(interaction)); }
    if (interaction.isStringSelectMenu?.() && id === 'admin:socialhub:account') { state.accountId = interaction.values[0]; return respond(interaction, payload(interaction)); }
    if (interaction.isStringSelectMenu?.() && id === 'admin:socialhub:type') { state.alertType = interaction.values[0]; return respond(interaction, payload(interaction)); }
    if (id === 'admin:socialhub:create') { await interaction.showModal(profileModal()); return true; }
    if (id === 'admin:socialhub:edit') { const profile = selectedProfile(interaction.guildId, state); if (!profile) throw new Error('Select a creator profile first.'); await interaction.showModal(profileModal(profile)); return true; }
    if ((id === 'admin:socialhub:profileCreateSubmit' || id === 'admin:socialhub:profileEditSubmit') && interaction.isModalSubmit?.()) {
      const existing = selectedProfile(interaction.guildId, state);
      const saved = social.creators.save(interaction.guildId, {
        ...(id.endsWith('EditSubmit') && existing ? existing : {}),
        displayName: clean(interaction.fields.getTextInputValue('name'), 120),
        group: clean(interaction.fields.getTextInputValue('group'), 80),
        tags: clean(interaction.fields.getTextInputValue('tags'), 500).split(',').map((item) => item.trim()).filter(Boolean),
        notes: clean(interaction.fields.getTextInputValue('notes'), 2000),
      }, { actorId });
      state.creatorId = saved.creatorId;
      await interaction.reply({ content: '✅ Creator profile saved.', flags: 64 });
      return true;
    }
    const profile = selectedProfile(interaction.guildId, state);
    const account = selectedAccount(interaction.guildId, state);
    if (id === 'admin:socialhub:link') {
      if (!profile || !account) throw new Error('Select both a creator profile and platform account.');
      if (profile.accountIds.includes(account.accountId)) social.creators.unlinkAccount(interaction.guildId, profile.creatorId, account.accountId, { actorId });
      else social.creators.linkAccount(interaction.guildId, profile.creatorId, account.accountId, { actorId });
      return respond(interaction, payload(interaction));
    }
    if (id === 'admin:socialhub:toggle') { if (!profile) throw new Error('Select a creator profile first.'); social.creators.save(interaction.guildId, { ...profile, enabled: profile.enabled === false }, { actorId }); return respond(interaction, payload(interaction)); }
    if (id === 'admin:socialhub:rebuild') { social.creators.rebuild(interaction.guildId, { actorId }); return respond(interaction, payload(interaction)); }
    if (id === 'admin:socialhub:delete') {
      if (!profile) throw new Error('Select a creator profile first.');
      return respond(interaction, { content: `Delete creator profile **${profile.displayName}**? Platform accounts will remain configured.`, embeds: [], components: [row(button('admin:socialhub:deleteConfirm', 'Confirm Delete', ButtonStyle.Danger), button('admin:socialhub', 'Cancel'))] });
    }
    if (id === 'admin:socialhub:deleteConfirm') { if (!profile) throw new Error('Creator profile no longer exists.'); social.creators.remove(interaction.guildId, profile.creatorId, { actorId }); state.creatorId = null; return respond(interaction, payload(interaction)); }
    if (id === 'admin:socialhub:simulatePreview' || id === 'admin:socialhub:simulateSend') {
      if (!account) throw new Error('Select a platform account first.');
      await interaction.deferReply({ flags: 64 });
      const result = await social.simulator.simulate(interaction.guildId, account.accountId, state.alertType, interaction.client, { send: id.endsWith('Send') }, { actorId, action: 'social_discord_simulation' });
      if (!result.success && !result.preview) throw new Error(result.error || 'Simulation failed.');
      if (result.sent) await interaction.editReply(`✅ ${state.alertType} simulation sent to <#${result.channelId}>.`);
      else await interaction.editReply({ content: `**Simulation preview**\nType: **${result.preview.alertType}**\nRoute: ${result.preview.channelId ? `<#${result.preview.channelId}>` : 'Not configured'}\nQuiet hours: **${result.preview.quietHours ? 'Active' : 'Inactive'}**`, embeds: [social.simulator.build(interaction.guildId, account, state.alertType).embed] });
      return true;
    }
    return respond(interaction, payload(interaction));
  } catch (error) {
    const errorPayload = { content: `❌ Creator Hub failed: ${error.message}`, flags: 64 };
    if (interaction.deferred || interaction.replied) await interaction.followUp(errorPayload).catch(() => null);
    else await interaction.reply(errorPayload).catch(() => null);
    return true;
  }
}

module.exports = { handleSocialCreatorInteraction, buildCreatorHubPanel: payload };
