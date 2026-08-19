'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const store = require('./socialStudioStore');
const { providerInfo } = require('./socialStudioProviders');

const P = 'social:';
const sessions = new Map();
const MONITORING_INTERVALS = new Set(['30000', '60000', '300000', '600000', '900000', '1800000', '3600000']);

function key(interaction) {
  return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`;
}

function setCreator(interaction, creatorId) {
  if (!interaction?.guildId || !interaction?.user?.id) return;
  if (creatorId) sessions.set(key(interaction), String(creatorId));
}

function selectedCreatorId(interaction) {
  return sessions.get(key(interaction)) || null;
}

function who(interaction) {
  return interaction.member?.displayName
    || interaction.user?.displayName
    || interaction.user?.username
    || 'Unknown User';
}

function row(...components) {
  return new ActionRowBuilder().addComponents(...components);
}

function button(id, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
}

function normalizeQuietTime(value) {
  let text = String(value || '').trim().replace(/\s+/g, '').replace('.', ':');
  if (/^\d{3,4}$/.test(text)) text = `${text.slice(0, -2)}:${text.slice(-2)}`;
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || hours < 0 || hours > 23 || !Number.isInteger(minutes) || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function creatorEditModal(creator) {
  return new ModalBuilder()
    .setCustomId(`${P}creator:update:${creator.creatorId}`)
    .setTitle('Edit Creator Profile')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('displayName')
        .setLabel('Creator display name')
        .setPlaceholder('Enter the public creator name here')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(120)
        .setRequired(true)
        .setValue(String(creator.displayName || '').slice(0, 120))),
      row(new TextInputBuilder()
        .setCustomId('group')
        .setLabel('Group or team')
        .setPlaceholder('Add their team, brand or category here')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(120)
        .setRequired(false)
        .setValue(String(creator.group || '').slice(0, 120))),
      row(new TextInputBuilder()
        .setCustomId('tags')
        .setLabel('Tags (comma separated)')
        .setPlaceholder('Example: streamer, ksj, twitch')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(300)
        .setRequired(false)
        .setValue(Array.isArray(creator.tags) ? creator.tags.join(', ').slice(0, 300) : '')),
      row(new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Profile Notes (optional)')
        .setPlaceholder('Add notes about this creator profile.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(false)
        .setValue(String(creator.notes || '').slice(0, 1000))),
      row(new TextInputBuilder()
        .setCustomId('adminNotes')
        .setLabel('Admin Notes (Management Only)')
        .setPlaceholder('Private notes visible only to Social Studio managers.')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(1000)
        .setRequired(false)
        .setValue(String(creator.adminNotes || '').slice(0, 1000))),
    );
}

function quietHoursModal(config) {
  const quiet = config.settings?.quietHours && typeof config.settings.quietHours === 'object'
    ? config.settings.quietHours
    : {};
  return new ModalBuilder()
    .setCustomId(`${P}automation:quiet`)
    .setTitle('Configure Quiet Hours')
    .addComponents(
      row(new TextInputBuilder()
        .setCustomId('enabled')
        .setLabel('Enabled? yes or no')
        .setPlaceholder('yes or no')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(3)
        .setRequired(true)
        .setValue(quiet.enabled === true ? 'yes' : 'no')),
      row(new TextInputBuilder()
        .setCustomId('start')
        .setLabel('Start time, HH:MM')
        .setPlaceholder('Example: 23:00')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(5)
        .setRequired(true)
        .setValue(String(quiet.start || '23:00'))),
      row(new TextInputBuilder()
        .setCustomId('end')
        .setLabel('End time, HH:MM')
        .setPlaceholder('Example: 08:00')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(5)
        .setRequired(true)
        .setValue(String(quiet.end || '08:00'))),
      row(new TextInputBuilder()
        .setCustomId('timezone')
        .setLabel('Timezone')
        .setPlaceholder('Example: Europe/London')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(100)
        .setRequired(true)
        .setValue(String(quiet.timezone || 'Europe/London'))),
    );
}

function profilePayload(interaction, creator) {
  const config = store.getConfig(interaction.guildId);
  const linked = (creator.accountIds || [])
    .map((id) => config.accounts?.[id])
    .filter(Boolean);
  const platforms = [...new Set(linked.map((account) => account.platform).filter(Boolean))];
  const color = platforms.length === 1
    ? {
        twitch: 0x9146FF,
        youtube: 0xFF0000,
        tiktok: 0x2F3136,
        kick: 0x53FC18,
        facebook: 0x1877F2,
        instagram: 0xE1306C,
        x: 0xFFFFFF,
      }[platforms[0]] || 0x5865F2
    : (config.enabled ? 0x5865F2 : 0x747F8D);

  const description = [
    `👤 **${creator.displayName || 'Unnamed creator'}**`,
    '',
    '**Profile**',
    `Status: ${creator.enabled === false ? '⏸️ Paused' : '🟢 Monitoring'}`,
    `Group / Team: ${creator.group || 'Not set'}`,
    `Tags: ${creator.tags?.length ? creator.tags.join(', ') : 'None'}`,
    `Profile Notes: ${creator.notes || 'None'}`,
    `🔒 Admin Notes: ${creator.adminNotes || 'None'}`,
  ].join('\n');

  return {
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setTitle('📝 Manage Profile')
      .setDescription(description)
      .setFooter({ text: `Requested by ${who(interaction)}` })
      .setTimestamp()],
    components: [
      row(
        button(`${P}creator:edit`, '📝 Edit Profile'),
        button(`${P}creator:clear`, '🔄 Clear'),
        button(`${P}creator:profile:toggle`, creator.enabled === false ? '▶️ Resume' : '⏸️ Pause', creator.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary),
        button(`${P}creator:delete`, '🗑️ Delete', ButtonStyle.Danger),
      ),
      row(
        button(`${P}creators`, '⬅️ Back'),
        button(`${P}settings`, '⚙️ Settings'),
      ),
    ],
  };
}

function creatorsPayload(interaction, message) {
  const config = store.getConfig(interaction.guildId);
  const creators = Object.values(config.creators || {});
  return {
    content: message || null,
    embeds: [new EmbedBuilder()
      .setColor(config.enabled ? 0x5865F2 : 0x747F8D)
      .setTitle('👥 Creator Profiles')
      .setDescription(creators.length
        ? `Profile action completed.\n\n**Profiles remaining:** ${creators.length}\n\nSelect a creator again to continue managing profiles.`
        : 'Profile action completed.\n\nThere are no creator profiles remaining.')
      .setFooter({ text: `Requested by ${who(interaction)}` })
      .setTimestamp()],
    components: [row(button(`${P}creators`, '🔄 Refresh Profiles', ButtonStyle.Primary), button(`${P}settings`, '⚙️ Settings'))],
  };
}

function capture(interaction) {
  const id = String(interaction?.customId || '');
  if (id !== `${P}creator:select`) return false;
  const creatorId = interaction.values?.[0];
  if (creatorId) setCreator(interaction, creatorId);
  return false;
}

function monitoringPayload(interaction) {
  const panel = require('./socialStudioPanel');
  return panel.buildSectionPanel(interaction, 'monitoring');
}

function liveMessagesPayload(interaction) {
  const panel = require('./socialStudioPanel');
  return panel.buildSectionPanel(interaction, 'liveMessages');
}

function diagnosticsPayload(interaction) {
  const panel = require('./socialStudioPanel');
  return panel.buildSectionPanel(interaction, 'diagnostics');
}
async function updatePanel(interaction, payload) {
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

async function followUp(interaction, payload) {
  const next = { flags: 64, ...payload };
  if (interaction.deferred || interaction.replied) await interaction.followUp(next);
  else await interaction.reply(next);
  return true;
}

function saveSettings(interaction, config) {
  return store.saveConfig(interaction.guildId, config, {
    actorId: interaction.user?.id || null,
    guild: interaction.guild,
  });
}

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [entryKey, entryValue] of Object.entries(value)) {
    if (/(token|secret|password|authorization|cookie|api.?key|access.?key)/i.test(entryKey)) output[entryKey] = '[REDACTED]';
    else output[entryKey] = redactSecrets(entryValue);
  }
  return output;
}

async function handleMonitoringAction(interaction, id) {
  const config = store.getConfig(interaction.guildId);
  config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};

  if (id === `${P}automation:interval`) {
    const value = String(interaction.values?.[0] || '');
    if (!MONITORING_INTERVALS.has(value)) throw new Error('Choose a valid monitoring interval.');
    config.settings.checkIntervalMs = Number(value);
    saveSettings(interaction, config);
    return updatePanel(interaction, monitoringPayload(interaction));
  }

  if (id === `${P}automation:dupes`) {
    config.settings.suppressDuplicates = String(interaction.values?.[0]) !== 'false';
    saveSettings(interaction, config);
    return updatePanel(interaction, monitoringPayload(interaction));
  }

  if (id === `${P}automation:retry`) {
    config.settings.retryDeliveries = String(interaction.values?.[0]) !== 'false';
    saveSettings(interaction, config);
    return updatePanel(interaction, monitoringPayload(interaction));
  }

  if (id === `${P}toggle`) {
    store.setEnabled(interaction.guildId, config.enabled !== true, {
      actorId: interaction.user?.id || null,
      guild: interaction.guild,
    });
    return updatePanel(interaction, monitoringPayload(interaction));
  }

  if (id === `${P}automation:quiet`) {
    if (interaction.isButton?.()) {
      await interaction.showModal(quietHoursModal(config));
      return true;
    }
    if (interaction.isModalSubmit?.()) {
      const enabledRaw = String(interaction.fields.getTextInputValue('enabled') || '').trim().toLowerCase();
      const start = normalizeQuietTime(interaction.fields.getTextInputValue('start'));
      const end = normalizeQuietTime(interaction.fields.getTextInputValue('end'));
      const timezone = String(interaction.fields.getTextInputValue('timezone') || '').trim();
      if (!['yes', 'no'].includes(enabledRaw)) throw new Error('Quiet Hours enabled must be yes or no.');
      if (!start || !end) {
        throw new Error('Quiet Hours times must be valid 24-hour times, for example 23:00 and 08:00.');
      }
      if (!timezone) throw new Error('Quiet Hours timezone is required.');
      try {
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone }).format(new Date());
      } catch {
        throw new Error('Quiet Hours timezone must be a valid IANA timezone, for example Europe/London.');
      }
      if (start === end) throw new Error('Quiet Hours start and end times must be different.');
      config.settings.quietHours = {
        enabled: enabledRaw === 'yes',
        start,
        end,
        timezone,
      };
      saveSettings(interaction, config);
      if (!interaction.deferred && !interaction.replied) await interaction.deferUpdate();
      return updatePanel(interaction, monitoringPayload(interaction));
    }
  }

  return false;
}

async function handleLiveMessageAction(interaction, id) {
  const config = store.getConfig(interaction.guildId);
  config.settings = config.settings && typeof config.settings === 'object' ? config.settings : {};
  const keyById = {
    [`${P}automation:editlive`]: 'editLiveNotifications',
    [`${P}automation:deleteended`]: 'deleteEndedNotifications',
    [`${P}automation:viewers`]: 'includeViewerCount',
    [`${P}automation:duration`]: 'includeLiveDuration',
  };
  const setting = keyById[id];
  if (!setting) return false;
  config.settings[setting] = config.settings[setting] === false;
  saveSettings(interaction, config);
  return updatePanel(interaction, liveMessagesPayload(interaction));
}

async function handleDiagnosticsAction(interaction, id) {
  const config = store.getConfig(interaction.guildId);
  const accounts = Object.values(config.accounts || {});
  const history = Array.isArray(config.history) ? config.history : [];

  if (id === `${P}data:refresh`) return updatePanel(interaction, diagnosticsPayload(interaction));

  if (id === `${P}testing:last`) {
    const latest = history.at(-1);
    const content = latest
      ? `📄 **Latest Social Studio Response**\n\n\`\`\`json\n${JSON.stringify(latest, null, 2).slice(0, 1700)}\n\`\`\``
      : '📄 **Latest Social Studio Response**\n\nNo provider response or Social Studio history has been recorded yet.';
    return followUp(interaction, { content });
  }

  if (id === `${P}testing:diagnostics`) {
    const platforms = [...new Set(accounts.map((account) => String(account.platform || '').toLowerCase()).filter(Boolean))];
    const lines = platforms.length
      ? platforms.map((platform) => {
        let info = {};
        try { info = providerInfo(platform) || {}; } catch { info = {}; }
        const alerts = Array.isArray(info.supportedAlertTypes) && info.supportedAlertTypes.length
          ? info.supportedAlertTypes.join(', ')
          : 'No alert types reported';
        return `**${platform}** — ${alerts}`;
      })
      : ['No linked accounts are available to inspect.'];
    return followUp(interaction, {
      content: `🩺 **Social Studio Provider Details**\n\n${lines.join('\n').slice(0, 1800)}`,
    });
  }

  if (id === `${P}data:export:config`) {
    const safe = redactSecrets(config);
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(safe, null, 2), 'utf8'), {
      name: `social-studio-config-${interaction.guildId}.json`,
    });
    return followUp(interaction, { content: '📤 Social Studio configuration export.', files: [file] });
  }

  if (id === `${P}data:export`) {
    const file = new AttachmentBuilder(Buffer.from(JSON.stringify(history, null, 2), 'utf8'), {
      name: `social-studio-history-${interaction.guildId}.json`,
    });
    return followUp(interaction, { content: '🗂️ Social Studio history export.', files: [file] });
  }

  if (id === `${P}data:clear`) {
    config.history = [];
    saveSettings(interaction, config);
    await updatePanel(interaction, diagnosticsPayload(interaction));
    await interaction.followUp({ content: '🧹 Social Studio history cleared.', flags: 64 }).catch(() => null);
    return true;
  }

  return false;
}

async function handle(interaction) {
  const compatibility = require('../../../events/client/socialStudioCreatorRoutingCompat');
  if (await compatibility.handle(interaction)) return true;

  const id = String(interaction?.customId || '');
  capture(interaction);

  // Manual provider checks are owned by src/events/client/socialStudioMonitor.js.
  // Returning handled here prevents the generic Social Studio panel router from
  // also processing the same interaction and emitting a false Unknown interaction.
  if (
    id === `${P}account:check`
    || id.startsWith(`${P}account:check:`)
    || id.startsWith(`${P}creator:check:`)
  ) return true;

  if ([
    `${P}testing:last`,
    `${P}testing:diagnostics`,
    `${P}data:refresh`,
    `${P}data:export`,
    `${P}data:export:config`,
    `${P}data:clear`,
  ].includes(id)) {
    return handleDiagnosticsAction(interaction, id);
  }

  if ([
    `${P}automation:interval`,
    `${P}automation:dupes`,
    `${P}automation:retry`,
    `${P}automation:quiet`,
    `${P}toggle`,
  ].includes(id)) {
    return handleMonitoringAction(interaction, id);
  }

  if ([
    `${P}automation:editlive`,
    `${P}automation:deleteended`,
    `${P}automation:viewers`,
    `${P}automation:duration`,
  ].includes(id)) {
    return handleLiveMessageAction(interaction, id);
  }

  if (![`${P}creator:edit`, `${P}creator:clear`, `${P}creator:delete`].includes(id)) return false;

  const creatorId = selectedCreatorId(interaction);
  if (!creatorId) throw new Error('Select a creator profile first.');
  const creator = store.getCreator(interaction.guildId, creatorId);
  if (!creator) {
    sessions.delete(key(interaction));
    throw new Error('The selected creator profile no longer exists.');
  }

  if (id === `${P}creator:edit`) {
    await interaction.showModal(creatorEditModal(creator));
    return true;
  }

  if (id === `${P}creator:clear`) {
    const updated = store.updateCreator(interaction.guildId, creatorId, (current) => ({
      ...current,
      group: '',
      tags: [],
      notes: '',
      adminNotes: '',
    }), { actorId: interaction.user?.id || null, guild: interaction.guild });
    if (interaction.deferred || interaction.replied) await interaction.editReply(profilePayload(interaction, updated));
    else await interaction.update(profilePayload(interaction, updated));
    return true;
  }

  const deleted = store.deleteCreator(interaction.guildId, creatorId, {
    actorId: interaction.user?.id || null,
    guild: interaction.guild,
  });
  sessions.delete(key(interaction));
  if (!deleted) throw new Error('The selected creator profile no longer exists.');
  const payload = creatorsPayload(interaction, `✅ Deleted **${creator.displayName || creatorId}** and its linked Social Studio accounts.`);
  if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
  else await interaction.update(payload);
  return true;
}

module.exports = {
  capture,
  handle,
};