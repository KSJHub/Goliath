'use strict';

const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { updateModuleSection } = require('../../../core/guild/moduleSectionManager');
const { isModuleEnabled, setModuleEnabled } = require('../../../core/guild/guildManager');
const invites = require('./invites');
const panel = require('./invitesPanel');
const { rolePages, mergePageSelection } = require('../../../core/ui/rolePagination');
const tracking = require('./invitesTracking');

const meta = (interaction, action) => ({
  actorId: interaction.user.id,
  action,
});

const updateRaw = (guildId, updater, audit = {}) =>
  updateModuleSection(
    guildId,
    invites.SECTION,
    updater,
    invites.defaults(),
    audit,
  );

const resetLeaderboard = (guildId, audit = {}) =>
  updateRaw(
    guildId,
    (current = {}) => ({
      ...current,
      inviters: {},
      members: {},
    }),
    audit,
  );

const resetMemberScore = (guildId, userId, audit = {}) =>
  updateRaw(
    guildId,
    (current = {}) => {
      const inviters = { ...(current.inviters || {}) };
      delete inviters[userId];

      const members = {};

      for (const [id, record] of Object.entries(current.members || {})) {
        members[id] = record?.inviterId === userId
          ? {
              ...record,
              inviterId: null,
              attribution: 'reset',
            }
          : record;
      }

      return {
        ...current,
        inviters,
        members,
      };
    },
    audit,
  );

const nested = (interaction, key, patch) => {
  const section = invites.getSection(interaction.guildId);

  return invites.updateSettings(
    interaction.guildId,
    {
      [key]: {
        ...section.settings[key],
        ...patch,
      },
    },
    meta(interaction, `invite_${key}_update`),
  );
};

async function update(interaction) {
  const payload = panel.buildInviteStudioPayload(interaction);

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(payload);
  } else {
    await interaction.update(payload);
  }
}

async function resend(interaction, record) {
  const member = await interaction.guild.members
    .fetch(record.inviterId)
    .catch(() => null);

  const live = await interaction.guild.invites
    .fetch(record.code)
    .catch(() => null);

  if (!member?.user || !live) {
    throw new Error('The selected personal link or member is unavailable.');
  }

  await member.user.send(
    panel.personalInvitePayload(
      {
        ...interaction,
        user: member.user,
      },
      {
        invite: live,
        record,
      },
    ),
  );

  return live.url;
}

async function checkPanelDeployment(interaction) {
  const config = invites.getSection(interaction.guildId).settings.publicPanel;
  const state = panel.sessionFor(interaction);
  const result = { channelId: config.channelId, messageId: config.messageId, status: 'missing' };
  if (!config.channelId || !config.messageId) {
    state.panelDeployment = result;
    return result;
  }
  try {
    const channel = await interaction.guild.channels.fetch(config.channelId);
    if (!channel?.messages) {
      result.status = 'unknown';
    } else {
      const message = await channel.messages.fetch(config.messageId);
      result.status = message ? 'deployed' : 'missing';
    }
  } catch (error) {
    result.status = [10003, 10008].includes(Number(error.code)) ? 'missing' : 'unknown';
  }
  state.panelDeployment = result;
  return result;
}

async function handleInviteStudioInteraction(interaction) {
  const id = String(interaction.customId || '');

  console.log('[Invite Studio DEBUG]', interaction.type, id);

  if (id !== 'invites' && id !== 'admin:invites' && !id.startsWith('invites:')) return false;

  const publicActions = new Set(['invites:member-profile', 'invites:member-refresh', 'invites:member-personal']);
  if (!publicActions.has(id) && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'Manage Server permission is required.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const state = panel.sessionFor(interaction);

  if (id === 'invites' || id === 'admin:invites') {
    state.page = 'overview';
    await update(interaction);
    return true;
  }

  const pages = {
    'invites:home': 'overview',
    'invites:official-settings': 'official-settings',
    'invites:public-config': 'public-config',
    'invites:member-settings': 'official',
    'invites:admin-config': 'admin-config',
    'invites:invite-manager': 'invite-manager',
  };

  const settingsPages = {
    'invites:settings-home': 'home',
    'invites:settings-health': 'health',
    'invites:settings-members': 'members',
    'invites:settings-official': 'official',
    'invites:settings-panel': 'panel',
  };
  if (settingsPages[id]) {
    state.page = 'admin-config';
    state.settingsPage = settingsPages[id];
    if (state.settingsPage === 'panel') await checkPanelDeployment(interaction);
    await update(interaction);
    return true;
  }
  if (id === 'invites:settings-manage-links' || id === 'invites:settings-official-manage' || id === 'invites:settings-panel-manage') {
    state.page = id === 'invites:settings-manage-links' ? 'invite-manager' :
      id === 'invites:settings-official-manage' ? 'official-settings' : 'public-config';
    if (state.page === 'official-settings') state.vanityStatus = await invites.syncVanityStatus(interaction.guild);
    if (state.page === 'public-config') await checkPanelDeployment(interaction);
    await update(interaction);
    return true;
  }

  if (pages[id]) {
    state.page = pages[id];
    if (state.page === 'admin-config') state.settingsPage = 'home';
    if (state.page === 'official-settings' || state.page === 'public-config') {
      state.vanityStatus = await invites.syncVanityStatus(interaction.guild);
    }
    if (state.page === 'public-config') await checkPanelDeployment(interaction);
    await update(interaction);
    return true;
  }

  if (
    id === 'invites:member-profile' ||
    id === 'invites:member-configure' ||
    id === 'invites:member-refresh' ||
    id === 'invites:member-personal'
  ) {
    return handleMemberInteraction(interaction);
  }


  if (id === 'invites:official-link-type' && interaction.isStringSelectMenu()) {
    const linkType = interaction.values[0] === 'vanity' ? 'vanity' : 'standard';
    const vanity = await invites.syncVanityStatus(interaction.guild);
    state.vanityStatus = vanity;
    nested(interaction, 'officialInvite', { linkType });
    await update(interaction);
    return true;
  }

  if (id === 'invites:official-channel' && interaction.isChannelSelectMenu()) {
    nested(interaction, 'officialInvite', { channelId: interaction.values[0] });
    await update(interaction);
    return true;
  }

  if (id === 'invites:official-role-prev' || id === 'invites:official-role-next') {
    const state = panel.sessionFor(interaction);
    const config = invites.getSection(interaction.guildId).settings.officialInvite;
    const info = rolePages(interaction.guild, config.roleIds || [], state.officialRolePage || 0);
    state.officialRolePage = Math.max(0, Math.min(info.pages - 1, info.page + (id.endsWith('next') ? 1 : -1)));
    await update(interaction);
    return true;
  }
  if (id.startsWith('invites:official-roles:') && interaction.isStringSelectMenu?.()) {
    const page = Number(id.slice('invites:official-roles:'.length));
    if (!Number.isSafeInteger(page) || page < 0) throw new Error('Invalid role page.');
    const config = invites.getSection(interaction.guildId).settings.officialInvite;
    const info = rolePages(interaction.guild, config.roleIds || [], page);
    if (info.page !== page) throw new Error('Role page expired. Reopen Invites.');
    const chosen = mergePageSelection(config.roleIds || [], info.roles, interaction.values || []);
    nested(interaction, 'officialInvite', { roleIds: chosen });
    panel.sessionFor(interaction).officialRolePage = page;
    await update(interaction);
    return true;
  }

  if (id === 'invites:panel-channel' && interaction.isChannelSelectMenu()) {
    nested(interaction, 'publicPanel', {
      channelId: interaction.values[0],
    });
    await checkPanelDeployment(interaction);
    await update(interaction);
    return true;
  }

  if (id === 'invites:panel-limit' && interaction.isStringSelectMenu()) {
    nested(interaction, 'publicPanel', {
      leaderboardLimit: Number(interaction.values[0]),
    });
    await update(interaction);
    return true;
  }

  if (id === 'invites:panel-preview') {
    try {
      state.vanityStatus = await invites.syncVanityStatus(interaction.guild);
      const payload = panel.buildPublicPayload(interaction.guildId);
      // Production preview: use the approved gold directly and expose the outgoing
      // colour in the response so the live Discord payload can be verified.
      payload.embeds[0].setColor(0xD4AF37);
      const outgoingColor = payload.embeds[0].toJSON().color;
      console.info('[Invite Studio Preview]', interaction.guildId, 'embed colour:', outgoingColor.toString(16).padStart(6, '0'));
      await interaction.reply({
        ...payload,
        content: 'Preview embed colour: #' + outgoingColor.toString(16).padStart(6, '0').toUpperCase(),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await interaction.reply({ content: `❌ Preview unavailable: ${String(error.message || error).slice(0, 1700)}`, flags: MessageFlags.Ephemeral });
    }
    return true;
  }

  if (id === 'invites:panel-embed-modal') {
    await interaction.showModal(panel.embedModal(interaction));
    return true;
  }

  if (id === 'invites:panel-embed-submit' || id === 'invites:panel-embed-submit-v2') {
    const fieldId = (name) => id === 'invites:panel-embed-submit-v2' ? `panel-v2-${name}` : name;
    const title = interaction.fields.getTextInputValue(fieldId('title')).trim();
    const description = interaction.fields.getTextInputValue(fieldId('description')).trim();
    const footer = interaction.fields.getTextInputValue(fieldId('footer')).trim();
    const color = interaction.fields.getTextInputValue(fieldId('color')).trim();
    if (!title || !description || !footer || title.length > 256 || description.length > 1800 || footer.length > 2048 || !/^#[0-9a-fA-F]{6}$/.test(color)) {
      await interaction.reply({
        content: '❌ Check your panel fields. Title, welcome message and footer cannot be empty; embed colour must be a 6-digit hex such as #5865F2.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }
    nested(interaction, 'publicPanel', { title, description, footer, color: color.toUpperCase() });
    await interaction.reply({
      content: '✅ Invite panel design saved. Use **👁️ Preview Panel** to review it, then **Publish/Update Panel** to apply it publicly.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (id === 'invites:member-enabled') {
    const config = invites.getSection(interaction.guildId)
      .settings.memberInviteTemplate;

    nested(interaction, 'memberInviteTemplate', {
      enabled: !config.enabled,
    });

    await update(interaction);
    return true;
  }

  if (id === 'invites:member-dm-modal') {
    await interaction.showModal(panel.dmModal(interaction));
    return true;
  }

  if (id === 'invites:member-dm-submit') {
    const dmTitle = interaction.fields.getTextInputValue('title').trim();
    const dmMessage = interaction.fields.getTextInputValue('message').trim();
    if (!dmTitle || !dmMessage || dmTitle.length > 256 || dmMessage.length > 3000) {
      await interaction.reply({ content: '❌ Provide a DM title (up to 256 characters) and a welcome message (up to 3000 characters).', flags: MessageFlags.Ephemeral });
      return true;
    }
    nested(interaction, 'memberInviteTemplate', { dmTitle, dmMessage });
    await interaction.reply({
      content: '✅ Personal invite DM saved. Goliath automatically adds the referral link, scoring explanation and My Stats guidance. Available placeholders: `{user}`, `{server}`, `{invite}`.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (
    !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
  ) {
    await interaction.reply({
      content: '❌ Manage Server permission is required.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (id === 'invites:official-verify') {
    await interaction.deferUpdate();
    const config = invites.getSection(interaction.guildId).settings.officialInvite;
    state.vanityStatus = await invites.syncVanityStatus(interaction.guild);
    if (!config.code) {
      state.officialLive = null;
    } else {
      try {
        const live = await interaction.guild.invites.fetch(config.code);
        state.officialLive = { code: config.code, exists: Boolean(live), uses: Number(live?.uses || 0) };
      } catch (error) {
        state.officialLive = { code: config.code, exists: [10006, 10008].includes(Number(error?.code)) ? false : null, uses: 0 };
      }
    }
    await interaction.editReply(panel.buildInviteStudioPayload(interaction));
    return true;
  }

  if (id === 'invites:official-regenerate') {
    const armed = state.officialConfirm?.action === 'regenerate' && state.officialConfirm.until > Date.now();
    if (!armed) { state.officialConfirm = { action: 'regenerate', until: Date.now() + 30000 }; await update(interaction); return true; }
    state.officialConfirm = null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const result = await invites.ensureOfficialInvite(interaction.guild, meta(interaction, 'invite_official_regenerate'), true);
      state.officialLive = { code: result.invite.code, exists: true, uses: Number(result.invite.uses || 0) };
      await interaction.editReply('Official invite regenerated: ' + result.invite.url);
    } catch (error) {
      await interaction.editReply('Regeneration failed: ' + String(error.message || error).slice(0, 1700));
    }
    return true;
  }

  if (id === 'invites:official-create') {
    const config = invites.getSection(interaction.guildId).settings.officialInvite;
    const record = config.code ? invites.getSection(interaction.guildId).inviteLinks[config.code] : null;
    const changed = Boolean(config.code && record && (
      record.channelId !== config.channelId ||
      Number(record.maxAge || 0) !== 0 ||
      Number(record.maxUses || 0) !== 0 ||
      JSON.stringify([...(record.roleIds || [])].sort()) !== JSON.stringify([...(config.roleIds || [])].sort())
    ));
    const confirmed = state.officialConfirm?.action === 'update' && state.officialConfirm.until > Date.now();
    if (changed && !confirmed) {
      state.officialConfirm = { action: 'update', until: Date.now() + 30000 };
      await update(interaction);
      return true;
    }
    state.officialConfirm = null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      // A vanity preference never replaces the saved standard invite.
      state.vanityStatus = await invites.syncVanityStatus(interaction.guild);
      const result = await invites.ensureOfficialInvite(interaction.guild, meta(interaction, 'invite_official_create'));
      state.officialLive = { code: result.invite.code, exists: true, uses: Number(result.invite.uses || 0) };
      await interaction.editReply(result.created
        ? '✅ Official standard invite created/updated: ' + result.invite.url + '. Your vanity preference is saved separately.'
        : '✅ Invite settings saved. Your existing standard invite is unchanged. ' +
          (config.linkType === 'vanity' ? 'The vanity URL will be used when Discord confirms one is available.' : 'Standard invite mode is selected.'));
    } catch (error) {
      await interaction.editReply('❌ Invite update failed: ' + String(error.message || error).slice(0, 1700));
    }
    return true;
  }

  if (id === 'invites:official-delete') {
    const armed = state.officialConfirm?.action === 'delete' && state.officialConfirm.until > Date.now();
    if (!armed) { state.officialConfirm = { action: 'delete', until: Date.now() + 30000 }; await update(interaction); return true; }
    state.officialConfirm = null;
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    const config = invites.getSection(interaction.guildId)
      .settings.officialInvite;

    await invites.deleteInviteLink(
      interaction.guild,
      config.code,
      meta(interaction, 'invite_official_delete'),
    );

    nested(interaction, 'officialInvite', {
      code: null,
    });

    await interaction.editReply('✅ Official invite deleted.');

    return true;
  }

  if (id === 'invites:panel-deploy') {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      state.vanityStatus = await invites.syncVanityStatus(interaction.guild);
      const message = await tracking.deployPublicPanel(
        interaction.guild,
        meta(interaction, 'invite_panel_deploy'),
      );

      await checkPanelDeployment(interaction);
      await interaction.editReply(
        `✅ Public invite panel sent / updated in <#${message.channelId}>.`,
      );
    } catch (error) {
      await interaction.editReply(
        `❌ ${String(error.message || error).slice(0, 1800)}`,
      );
    }

    return true;
  }

  if (id === 'invites:toggle') {
    const enabling = !isModuleEnabled(
      interaction.guildId,
      'invites',
    );

    setModuleEnabled(
      interaction.guildId,
      'invites',
      enabling,
      interaction.guild,
    );

    if (enabling) {
      await invites.syncGuild(
        interaction.guild,
        meta(interaction, 'invite_enable_sync'),
      ).catch((error) => {
        console.warn(
          `[Invites] Enable sync failed: ${error.message || error}`,
        );
      });
    }

    await update(interaction);
    return true;
  }

  if (id === 'invites:health' || id === 'invites:repair') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const health = id === 'invites:repair'
        ? await invites.repair(interaction.guild, meta(interaction, 'invite_repair'))
        : await invites.buildHealth(interaction.guild);
      const status = (value) => value === 'healthy' ? '🟢' : value === 'issue' ? '🔴' : '🟡';
      const report = new EmbedBuilder()
        .setColor(health.issues.length ? 0xED4245 : health.warnings.length ? 0xFEE75C : 0x57F287)
        .setTitle(id === 'invites:repair' ? '🔧 Invite Repair Report' : '🩺 Invite Studio Health')
        .setDescription(`${health.enabled ? '🟢 Module enabled' : '🔴 Module disabled'} · ${health.issues.length} issues · ${health.warnings.length} warnings\nChecks report the current state without deleting existing invite links.`)
        .addFields(health.checks.map((check) => ({
          name: `${status(check.status)} ${check.name}`,
          value: check.detail,
          inline: false,
        })))
        .setFooter({ text: 'Goliath Invites · Diagnostics' })
        .setTimestamp(new Date(health.checkedAt));
      await interaction.editReply({ embeds: [report] });
    } catch (error) {
      await interaction.editReply({ content: `❌ Diagnostics failed: ${String(error.message || error).slice(0, 1700)}` });
    }
    return true;
  }

  if (id === 'invites:settings-panel-delete') {
    const config = invites.getSection(interaction.guildId).settings.publicPanel;
    if (!config.channelId || !config.messageId) {
      state.panelDeleteConfirmUntil = 0;
      await interaction.reply({ content: 'ℹ️ No deployed public panel is recorded for this guild.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!(state.panelDeleteConfirmUntil > Date.now())) {
      state.panelDeleteConfirmUntil = Date.now() + 30000;
      await update(interaction);
      return true;
    }
    state.panelDeleteConfirmUntil = 0;
    await interaction.deferUpdate();
    try {
      const channel = await interaction.guild.channels.fetch(config.channelId);
      if (!channel?.messages) throw new Error('Saved panel channel is inaccessible. The deployment record was not cleared.');
      const message = await channel.messages.fetch(config.messageId).catch((error) => {
        if (Number(error?.code) === 10008) return null;
        throw error;
      });
      if (message) await message.delete();
      invites.updateSettings(interaction.guildId, {
        publicPanel: { ...config, channelId: config.channelId, messageId: null, lastRefreshedAt: null },
      }, meta(interaction, 'invite_public_panel_delete'));
      await checkPanelDeployment(interaction);
      await interaction.editReply(panel.buildInviteStudioPayload(interaction));
    } catch (error) {
      await interaction.editReply(panel.buildInviteStudioPayload(interaction));
      await interaction.followUp({ content: '❌ Panel deletion failed: ' + String(error.message || error).slice(0, 1400), flags: MessageFlags.Ephemeral });
    }
    return true;
  }

  if (id === 'invites:default-panel') {
    if (!(state.panelResetConfirmUntil > Date.now())) {
      state.panelResetConfirmUntil = Date.now() + 30000;
      await update(interaction);
      return true;
    }
    state.panelResetConfirmUntil = 0;
    const defaults = invites.defaults().settings.publicPanel;
    const current = invites.getSection(interaction.guildId).settings.publicPanel;
    invites.updateSettings(
      interaction.guildId,
      { publicPanel: { ...current, title: defaults.title, description: defaults.description, footer: defaults.footer, color: defaults.color } },
      meta(interaction, 'invite_panel_defaults'),
    );
    await interaction.reply({ content: '✅ Public panel text defaults restored. Channel, deployed message and referral DM were preserved.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (id === 'invites:leaderboard-reset-arm') {
    state.resetConfirmUntil = Date.now() + 30000;
    await update(interaction);
    return true;
  }

  if (id === 'invites:leaderboard-reset-confirm') {
    if (state.resetConfirmUntil < Date.now()) {
      await interaction.reply({
        content: '❌ Reset confirmation expired.',
        flags: MessageFlags.Ephemeral,
      });

      return true;
    }

    resetLeaderboard(
      interaction.guildId,
      meta(interaction, 'invite_leaderboard_reset'),
    );

    state.resetConfirmUntil = 0;

    await interaction.reply({
      content: '✅ Leaderboard reset. Personal links were kept.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (id === 'invites:manager-display' && interaction.isStringSelectMenu()) {
    state.displayLimit = Number(interaction.values[0]);
    await update(interaction);
    return true;
  }

  if (
    id === 'invites:manager-select-member' &&
    interaction.isUserSelectMenu()
  ) {
    state.selectedUserId = interaction.values[0];
    state.memberConfirm = null;
    await update(interaction);
    return true;
  }

  const selected = invites.findPersonalInvite(
    interaction.guildId,
    state.selectedUserId,
  );

  if (id.startsWith('invites:manager-') && !selected) {
    await interaction.reply({
      content: '❌ Select a member with a personal invite first.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (id === 'invites:manager-verify') {
    const live = await interaction.guild.invites
      .fetch(selected.code)
      .catch(() => null);

    await interaction.reply({
      content: live
        ? `✅ Verified: ${live.url}`
        : '❌ Link is missing.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (id === 'invites:manager-resend') {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    await interaction.editReply(
      `✅ Resent: ${await resend(interaction, selected)}`,
    );

    return true;
  }

  if (id === 'invites:manager-delete' || id === 'invites:manager-reset-member') {
    const action = id === 'invites:manager-delete' ? 'delete' : 'reset';
    const armed = state.memberConfirm?.action === action &&
      state.memberConfirm?.userId === selected.inviterId &&
      state.memberConfirm.until > Date.now();
    if (!armed) {
      state.memberConfirm = { action, userId: selected.inviterId, until: Date.now() + 30000 };
      await update(interaction);
      return true;
    }
    state.memberConfirm = null;
    if (action === 'delete') {
      await invites.deletePersonalInvite(
        interaction.guild,
        selected.inviterId,
        meta(interaction, 'invite_manager_delete'),
      );
      state.selectedUserId = null;
      await interaction.reply({
        content: '✅ Personal link removed. Referral history was not reset.',
        flags: MessageFlags.Ephemeral,
      });
    } else {
      resetMemberScore(
        interaction.guildId,
        selected.inviterId,
        meta(interaction, 'invite_member_reset'),
      );
      await interaction.reply({
        content: '✅ Member score reset. Their personal link was kept.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return true;
  }

  return false;
}

async function handleMemberInteraction(interaction) {
  const id = String(interaction.customId || '');

  console.log('[Invite Studio DEBUG]', interaction.type, id);

  if (!id.startsWith('invites:member-')) return false;

  if (!isModuleEnabled(interaction.guildId, 'invites')) {
    await interaction.reply({
      content: '❌ Invite Studio is disabled.',
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (id === 'invites:member-profile') {
    await interaction.reply(
      panel.profilePayload(
        interaction.guild,
        interaction.user,
      ),
    );

    return true;
  }

  if (id === 'invites:member-configure') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({
        content: '❌ Manage Server permission is required.',
        flags: MessageFlags.Ephemeral,
      });

      return true;
    }

    await interaction.reply({
      ...panel.buildInviteStudioPayload(
        interaction,
        'configure',
      ),
      flags: MessageFlags.Ephemeral,
    });

    return true;
  }

  if (id === 'invites:member-refresh') {
    await interaction.reply({
      content: '🔄 Updating leaderboard…',
      flags: MessageFlags.Ephemeral,
    });

    const ok = await tracking.refreshPublicPanel(
      interaction.guild,
      {
        action: 'member_refresh',
      },
    );

    await interaction.editReply(
      ok
        ? '✅ Leaderboard updated.'
        : '❌ Panel not found.',
    );

    return true;
  }

  if (id === 'invites:member-personal') {
    await interaction.deferReply({
      flags: MessageFlags.Ephemeral,
    });

    try {
      const result = await invites.createPersonalInvite(
        interaction.guild,
        interaction.user.id,
        null,
        meta(interaction, 'member_personal_invite'),
      );

      let sent = true;

      try {
        await interaction.user.send(
          panel.personalInvitePayload(
            interaction,
            result,
          ),
        );
      } catch {
        sent = false;
      }

      await interaction.editReply({
        ...panel.personalInvitePayload(
          interaction,
          result,
        ),
        content: sent
          ? '✅ Your personal link was sent to your DMs.'
          : '⚠️ I could not DM you; your private link is shown below.',
      });
    } catch (error) {
      await interaction.editReply(
        `❌ ${String(error.message || error).slice(0, 1800)}`,
      );
    }

    return true;
  }

  return false;
}

module.exports = {
  buildInviteStudioPayload: panel.buildInviteStudioPayload,
  handleInviteStudioInteraction,
  handleMemberInteraction,
};