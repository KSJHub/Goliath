'use strict';

const Module = require('module');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const invites = require('./invites');
const baseAdminPanel = require('./invitesAdminPanel');

const SETTINGS_KEY = 'personalInviteMigrations';
const ADMIN_BUTTON_ID = 'invites:migrate-personal';
const adminPanelPath = require.resolve('./invitesAdminPanel');

function migrationMap(guildId) {
  const value = invites.getSection(guildId).settings[SETTINGS_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function saveMigrationMap(guildId, map, meta = {}) {
  return invites.updateSettings(guildId, { [SETTINGS_KEY]: map }, meta);
}

function memberInviteOwners(guildId) {
  const owners = new Map();
  for (const link of invites.listInviteLinks(guildId)) {
    if (!link.personal || !link.enabled || !link.inviterId) continue;
    if (!owners.has(link.inviterId)) owners.set(link.inviterId, []);
    owners.get(link.inviterId).push(link);
  }
  return owners;
}

async function migratePersonalInvites(guild, meta = {}) {
  const section = invites.getSection(guild.id);
  const template = section.settings.memberInviteTemplate;
  if (!template.enabled) throw new Error('Member invite creation is disabled by management.');
  if (!template.channelId) throw new Error('Configure the current member invite channel before starting migration.');

  const owners = memberInviteOwners(guild.id);
  const migrations = { ...migrationMap(guild.id) };
  const result = {
    owners: owners.size,
    migrated: 0,
    alreadyCurrent: 0,
    skipped: 0,
    dmSent: 0,
    dmFailed: 0,
    failures: [],
  };

  for (const [inviterId, links] of owners.entries()) {
    const current = links.find((link) => link.channelId === template.channelId && !migrations[link.code]);
    if (current) {
      result.alreadyCurrent += 1;
      continue;
    }

    const pending = Object.entries(migrations).find(([, migration]) => migration?.inviterId === inviterId);
    if (pending) {
      const live = await guild.invites.fetch(pending[0]).catch(() => null);
      if (live) {
        result.skipped += 1;
        continue;
      }
      delete migrations[pending[0]];
    }

    const legacyCodes = [...new Set(links.map((link) => link.code).filter(Boolean))];
    if (!legacyCodes.length) {
      result.skipped += 1;
      continue;
    }

    try {
      const created = await invites.createInviteLink(guild, {
        channelId: template.channelId,
        maxAge: template.maxAge,
        maxUses: template.maxUses,
        temporary: template.temporary,
        roleIds: template.roleIds,
        inviterId,
        personal: true,
      }, { ...meta, action: 'invite_personal_migration_create' });

      const newCode = created.invite.code;
      migrations[newCode] = {
        inviterId,
        replacementCode: newCode,
        legacyCodes: legacyCodes.filter((code) => code !== newCode),
        createdAt: new Date().toISOString(),
      };
      saveMigrationMap(guild.id, migrations, meta);
      invites.addHistory(guild.id, {
        type: 'personal_links_migrated',
        inviterId,
        inviteCode: newCode,
        legacyInviteCodes: migrations[newCode].legacyCodes,
      }, meta);

      result.migrated += 1;
      const member = await guild.members.fetch(inviterId).catch(() => null);
      if (!member) {
        result.dmFailed += 1;
        continue;
      }

      const sent = await member.send([
        `🔗 Your personal invite for **${guild.name}** has been updated.`,
        '',
        created.invite.url,
        '',
        'Your previous link will continue working until somebody successfully joins through this new link.',
        'After the new link is used, Goliath will automatically retire your previous link.',
        '**Your existing Invite Studio leaderboard score has been preserved.**',
      ].join('\n')).then(() => true).catch(() => false);

      if (sent) result.dmSent += 1;
      else result.dmFailed += 1;
    } catch (error) {
      result.failures.push({ inviterId, error: String(error?.message || error) });
    }
  }

  saveMigrationMap(guild.id, migrations, meta);
  await invites.syncGuild(guild, { ...meta, action: 'invite_personal_migration_sync' }).catch(() => null);
  return result;
}

async function retireLegacyIfReplacementUsed(guild, inviteCode, meta = {}) {
  const code = String(inviteCode || '').trim();
  if (!code) return [];
  const migrations = { ...migrationMap(guild.id) };
  const migration = migrations[code];
  if (!migration) return [];

  const retired = [];
  for (const legacyCode of [...new Set(migration.legacyCodes || [])]) {
    await invites.deleteInviteLink(guild, legacyCode, {
      ...meta,
      action: 'invite_migration_retire_legacy',
    }).catch(() => null);
    retired.push(legacyCode);
  }

  delete migrations[code];
  saveMigrationMap(guild.id, migrations, meta);
  invites.addHistory(guild.id, {
    type: 'personal_legacy_links_retired',
    inviterId: migration.inviterId,
    inviteCode: code,
    legacyInviteCodes: retired,
  }, meta);
  await invites.syncGuild(guild, meta).catch(() => null);
  return retired;
}

function isInviteAdminPayload(payload) {
  const embed = Array.isArray(payload?.embeds) ? payload.embeds[0] : null;
  const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed?.data || embed;
  return data?.title === '🛠️ Invite Studio Admin';
}

function addMigrationButton(payload, interaction) {
  if (!isInviteAdminPayload(payload)) return payload;
  const configured = Boolean(invites.getSection(interaction.guildId).settings.memberInviteTemplate.channelId);
  const components = Array.isArray(payload.components) ? [...payload.components] : [];
  const alreadyPresent = components.some((actionRow) => {
    const data = typeof actionRow?.toJSON === 'function' ? actionRow.toJSON() : actionRow;
    return data?.components?.some((component) => (component.custom_id || component.customId) === ADMIN_BUTTON_ID);
  });
  if (alreadyPresent) return payload;

  components.splice(Math.max(0, components.length - 1), 0,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(ADMIN_BUTTON_ID)
        .setLabel('Migrate Personal Links')
        .setStyle(ButtonStyle.Success)
        .setDisabled(!configured),
    ));
  return { ...payload, components };
}

async function callBaseWithAugmentedResponses(interaction) {
  const originalUpdate = typeof interaction.update === 'function' ? interaction.update.bind(interaction) : null;
  const originalEditReply = typeof interaction.editReply === 'function' ? interaction.editReply.bind(interaction) : null;
  if (originalUpdate) interaction.update = (payload, ...args) => originalUpdate(addMigrationButton(payload, interaction), ...args);
  if (originalEditReply) interaction.editReply = (payload, ...args) => originalEditReply(addMigrationButton(payload, interaction), ...args);
  try {
    return await baseAdminPanel.handleInviteStudioInteraction(interaction);
  } finally {
    if (originalUpdate) interaction.update = originalUpdate;
    if (originalEditReply) interaction.editReply = originalEditReply;
  }
}

const extendedAdminPanel = {
  ...baseAdminPanel,
  buildInviteStudioPayload(interaction, forcedPage = null) {
    return addMigrationButton(baseAdminPanel.buildInviteStudioPayload(interaction, forcedPage), interaction);
  },
  async handleInviteStudioInteraction(interaction) {
    if (interaction.customId !== ADMIN_BUTTON_ID) {
      return callBaseWithAugmentedResponses(interaction);
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      throw new Error('Manage Server permission is required.');
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await migratePersonalInvites(interaction.guild, {
      actorId: interaction.user.id,
      action: 'invite_admin_migrate_personal_links',
    });
    const failurePreview = result.failures.slice(0, 5)
      .map((failure) => `<@${failure.inviterId}>: ${failure.error}`)
      .join('\n');

    await interaction.editReply([
      '✅ **Personal invite migration finished.**',
      `Owners checked: **${result.owners}**`,
      `New links created: **${result.migrated}**`,
      `Already using the current channel: **${result.alreadyCurrent}**`,
      `Skipped: **${result.skipped}**`,
      `DMs sent: **${result.dmSent}**`,
      `DMs failed: **${result.dmFailed}**`,
      `Migration failures: **${result.failures.length}**`,
      '',
      'Old links remain active and continue counting. An old link is automatically deleted after its replacement records its first successful join.',
      failurePreview ? `\n**First failures**\n${failurePreview}` : '',
    ].filter(Boolean).join('\n'));
    return true;
  },
};

function installAdminPanelExtension() {
  if (global.__goliathInviteMigrationAdminExtensionInstalled) return;
  global.__goliathInviteMigrationAdminExtensionInstalled = true;
  const originalLoad = Module._load;
  Module._load = function patchedInviteAdminLoad(request, parent, isMain) {
    let resolved = null;
    try { resolved = Module._resolveFilename(request, parent, isMain); } catch { }
    if (resolved === adminPanelPath) return extendedAdminPanel;
    return originalLoad.call(this, request, parent, isMain);
  };
}

installAdminPanelExtension();

module.exports = {
  migratePersonalInvites,
  retireLegacyIfReplacementUsed,
  installAdminPanelExtension,
};
