'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, ModalBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle, UserSelectMenuBuilder,
} = require('discord.js');
const birthdays = require('./birthdays');

const PAGE_SIZE = 25;
const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const clampPage = (page, total) => Math.max(0, Math.min(Math.max(0, Math.ceil(total / PAGE_SIZE) - 1), Number(page) || 0));
const dateLabel = (record) => `${String(record.day).padStart(2, '0')}/${String(record.month).padStart(2, '0')}${record.year ? `/${record.year}` : ''}`;

function managementPayload(interaction) {
  const section = birthdays.getSection(interaction.guildId);
  const records = Object.values(section.members || {});
  const active = records.filter((record) => !record.leftAt).length;
  const awaitingCleanup = records.length - active;
  const desc = [
    '**🎭 Birthday Role**',
    `Role: ${section.settings.birthdayRoleId ? `<@&${section.settings.birthdayRoleId}>` : '**Not set**'}`,
    'Automatically applied for the member’s birthday day.',
    '', '**👥 Member Birthdays**',
    `Registered: **${records.length}**${awaitingCleanup ? ` · Awaiting cleanup: **${awaitingCleanup}**` : ''}`,
    'Manage registered birthdays, privacy and celebration preferences.',
    '', '**📅 Monthly Board**',
    `Channel: ${section.settings.monthlyBoardChannelId ? `<#${section.settings.monthlyBoardChannelId}>` : '**Not set**'}`,
    `Schedule: **Day ${section.settings.monthlyBoardDay || 1} · ${section.settings.monthlyBoardTime} · ${section.settings.timezone}**`,
  ].join('\n');
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🛠️ Management').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Management' }).setTimestamp()],
    components: [
      row(
        button('admin:birthdays:role:open', '🎭 Birthday Role'),
        button('admin:birthdays:members', '👥 Member Birthdays', ButtonStyle.Primary),
        button('admin:birthdays:board', '📅 Board Settings'),
      ),
      row(button('admin:birthdays', '⬅️ Back')),
    ],
  };
}

function rolePayload(interaction, requestedPage = 0) {
  const section = birthdays.getSection(interaction.guildId);
  const roles = [...interaction.guild.roles.cache.values()]
    .filter((role) => role.id !== interaction.guild.id && !role.managed)
    .sort((a, b) => b.position - a.position || a.name.localeCompare(b.name));
  const page = clampPage(requestedPage, roles.length);
  const pages = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const options = roles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((role) => ({
    label: role.name.slice(0, 100),
    value: role.id,
    description: role.editable ? 'Assignable by Goliath' : 'Above Goliath / not assignable',
    default: role.id === section.settings.birthdayRoleId,
  }));
  const components = [];
  if (options.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:birthdays:role:select:${page}`).setPlaceholder('Birthday Role').setMinValues(1).setMaxValues(1).addOptions(...options)));
  if (pages > 1) {
    components.push(row(
      button(`admin:birthdays:role:page:${page - 1}`, '◀️ Previous', ButtonStyle.Secondary, page <= 0),
      button(`admin:birthdays:role:page:${page + 1}`, 'Next ▶️', ButtonStyle.Secondary, page >= pages - 1),
    ));
  }
  components.push(row(
    button('admin:birthdays:management', '⬅️ Back'),
    button('admin:birthdays:role:clear', '🧹 Clear Role', ButtonStyle.Secondary, !section.settings.birthdayRoleId),
  ));
  const desc = pages > 1 ? `Page **${page + 1}/${pages}**` : `Current role: ${section.settings.birthdayRoleId ? `<@&${section.settings.birthdayRoleId}>` : '**Not set**'}`;
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎭 Birthday Role').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Management' }).setTimestamp()],
    components,
  };
}

function memberList(interaction) {
  const section = birthdays.getSection(interaction.guildId);
  return Object.values(section.members || {}).sort((a, b) => a.month - b.month || a.day - b.day || a.userId.localeCompare(b.userId));
}

function memberListPayload(interaction, requestedPage = 0) {
  const records = memberList(interaction);
  const page = clampPage(requestedPage, records.length);
  const pages = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const options = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((record) => {
    const member = interaction.guild.members.cache.get(record.userId);
    const name = member?.displayName || member?.user?.username || record.userId;
    return {
      label: `${name} — ${String(record.day).padStart(2, '0')}/${String(record.month).padStart(2, '0')}`.slice(0, 100),
      value: record.userId,
      description: record.leftAt ? 'Left server · pending automatic cleanup' : `Listed ${record.listPublic ? 'On' : 'Off'} · Announce ${record.announce ? 'On' : 'Off'}`,
    };
  });
  const components = [];
  if (options.length) components.push(row(new StringSelectMenuBuilder().setCustomId(`admin:birthdays:members:select:${page}`).setPlaceholder('Select registered member').setMinValues(1).setMaxValues(1).addOptions(...options)));
  components.push(row(button('admin:birthdays:members:add', '➕ Add Birthday', ButtonStyle.Primary)));
  if (pages > 1) {
    components.push(row(
      button(`admin:birthdays:members:page:${page - 1}`, '◀️ Previous', ButtonStyle.Secondary, page <= 0),
      button(`admin:birthdays:members:page:${page + 1}`, 'Next ▶️', ButtonStyle.Secondary, page >= pages - 1),
    ));
  }
  components.push(row(button('admin:birthdays:management', '⬅️ Back')));
  const pageLine = pages > 1 ? `\n\nPage **${page + 1}/${pages}**` : '';
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('👥 Member Birthdays').setDescription(`Registered birthdays: **${records.length}**${pageLine}`).setFooter({ text: 'Goliath Birthdays · Member Management' }).setTimestamp()],
    components,
  };
}

function memberPayload(interaction, userId) {
  const record = birthdays.getBirthday(interaction.guildId, userId);
  if (!record) return memberListPayload(interaction, 0);
  const member = interaction.guild.members.cache.get(userId);
  const name = member?.displayName || member?.user?.username || userId;
  const ageStatus = record.year ? (record.showAge ? 'On' : 'Off') : 'Unavailable';
  const desc = [
    `Member: <@${userId}>`,
    '', '**🎂 Birthday**',
    `Date: **${dateLabel(record)}**`,
    record.leftAt ? `Status: **Left server · cleanup after 7 days**` : 'Status: **In server**',
    '', '**🔐 Privacy & Celebration**',
    `Listed in birthday lists: **${record.listPublic ? 'On' : 'Off'}**`,
    `Public birthday announcement: **${record.announce ? 'On' : 'Off'}**`,
    `Show age publicly: **${ageStatus}**`,
  ].join('\n');
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(`👤 Birthday — ${name}`.slice(0, 256)).setDescription(desc).setFooter({ text: 'Goliath Birthdays · Member Management' }).setTimestamp()],
    components: [
      row(
        button(`admin:birthdays:member:edit:${userId}`, '✏️ Edit Birthday', ButtonStyle.Primary),
        button(`admin:birthdays:member:list:${userId}`, record.listPublic ? '📅 Listed: On' : '📅 Listed: Off', record.listPublic ? ButtonStyle.Success : ButtonStyle.Secondary),
        button(`admin:birthdays:member:announce:${userId}`, record.announce ? '📣 Announce: On' : '📣 Announce: Off', record.announce ? ButtonStyle.Success : ButtonStyle.Secondary),
      ),
      row(
        button(`admin:birthdays:member:age:${userId}`, record.year ? (record.showAge ? '🎈 Age: On' : '🎈 Age: Off') : '🎈 Age: Unavailable', record.year && record.showAge ? ButtonStyle.Success : ButtonStyle.Secondary, !record.year),
        button(`admin:birthdays:member:remove:${userId}`, '🗑️ Remove Birthday', ButtonStyle.Danger),
      ),
      row(button('admin:birthdays:members', '⬅️ Back')),
    ],
  };
}

function addMemberPayload() {
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('➕ Add Birthday').setDescription('Select member').setFooter({ text: 'Goliath Birthdays · Member Management' }).setTimestamp()],
    components: [
      row(new UserSelectMenuBuilder().setCustomId('admin:birthdays:members:add:select').setPlaceholder('Select member').setMinValues(1).setMaxValues(1)),
      row(button('admin:birthdays:members', '⬅️ Back')),
    ],
  };
}

function birthdayEditModal(userId, record = null, mode = 'edit') {
  return new ModalBuilder().setCustomId(`admin:birthdays:member:${mode}:submit:${userId}`).setTitle(mode === 'add' ? 'Add Member Birthday' : 'Edit Member Birthday').addComponents(
    row(new TextInputBuilder().setCustomId('date').setLabel('Birthday (DD/MM or DD/MM/YYYY)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('18/08 or 18/08/1990').setValue(record ? dateLabel(record) : '')),
  );
}

function boardPayload(interaction) {
  const section = birthdays.getSection(interaction.guildId);
  const desc = [
    '**📅 Monthly Birthday Board**',
    `Channel: ${section.settings.monthlyBoardChannelId ? `<#${section.settings.monthlyBoardChannelId}>` : '**Not set**'}`,
    `Post day: **${section.settings.monthlyBoardDay || 1}**`,
    `Time: **${section.settings.monthlyBoardTime}**`,
    `Timezone: **${section.settings.timezone}**`,
    '', 'Goliath automatically handles 29 February birthdays. In non-leap years they are celebrated on 28 February.',
  ].join('\n');
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('📅 Board Settings').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Monthly Board' }).setTimestamp()],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:birthdays:monthly:channel').setPlaceholder('Monthly Board Channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1).setDefaultChannels(section.settings.monthlyBoardChannelId ? [section.settings.monthlyBoardChannelId] : [])),
      row(button('admin:birthdays:board:edit', '🗓️ Date & Time', ButtonStyle.Primary), button('admin:birthdays:board:preview', '👁️ Preview Board')),
      row(button('admin:birthdays:management', '⬅️ Back')),
    ],
  };
}

function boardSettingsModal(section) {
  return new ModalBuilder().setCustomId('admin:birthdays:board:edit:submit').setTitle('Monthly Board Schedule').addComponents(
    row(new TextInputBuilder().setCustomId('day').setLabel('Day of month (1-28)').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(section.settings.monthlyBoardDay || 1)).setPlaceholder('1')),
    row(new TextInputBuilder().setCustomId('time').setLabel('Post time (HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(section.settings.monthlyBoardTime).setPlaceholder('09:00')),
  );
}

module.exports = {
  managementPayload, rolePayload, memberListPayload, memberPayload, addMemberPayload, birthdayEditModal, boardPayload, boardSettingsModal,
};
