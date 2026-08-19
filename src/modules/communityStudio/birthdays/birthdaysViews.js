'use strict';

const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType,
  EmbedBuilder, ModalBuilder, RoleSelectMenuBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const guildManager = require('../../../core/guild/guildManager');
const birthdays = require('./birthdays');

const row = (...items) => new ActionRowBuilder().addComponents(...items.filter(Boolean));
const button = (id, label, style = ButtonStyle.Secondary, disabled = false) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setDisabled(disabled);
const UPCOMING_DAYS = 60;
const TIMEZONES = [
  ['🇬🇧 Europe/London', 'Europe/London'],
  ['🇮🇪 Europe/Dublin', 'Europe/Dublin'],
  ['🇺🇸 America/New_York', 'America/New_York'],
  ['🇺🇸 America/Chicago', 'America/Chicago'],
  ['🇺🇸 America/Denver', 'America/Denver'],
  ['🇺🇸 America/Los_Angeles', 'America/Los_Angeles'],
  ['🇨🇦 America/Toronto', 'America/Toronto'],
  ['🇦🇺 Australia/Sydney', 'Australia/Sydney'],
  ['🇳🇿 Pacific/Auckland', 'Pacific/Auckland'],
  ['🌐 UTC', 'UTC'],
];

function birthdayWindow(guildId) {
  const list = birthdays.listUpcoming(guildId, 100, UPCOMING_DAYS);
  return { today: list.filter((item) => item.daysUntil === 0), upcoming: list.filter((item) => item.daysUntil > 0) };
}
function birthdayLine(item, todayLabel = false) {
  const date = todayLabel ? 'TODAY' : `${String(item.next.day).padStart(2, '0')}/${String(item.next.month).padStart(2, '0')}`;
  return `• <@${item.member.userId}> — **${date}**`;
}
function birthdayListContent(guildId) {
  const { today, upcoming } = birthdayWindow(guildId);
  return `**🎂 Today’s Birthdays (${today.length})**\n${today.length ? today.map((item) => birthdayLine(item, true)).join('\n') : 'No birthdays today.'}\n\n**📅 Upcoming Birthdays — Next 2 Months**\n${upcoming.length ? upcoming.map((item) => birthdayLine(item)).join('\n') : 'No birthdays in the next 2 months.'}`;
}

function adminPayload(interaction) {
  const section = birthdays.getSection(interaction.guildId);
  const enabled = guildManager.isModuleEnabled(interaction.guildId, 'birthdays');
  const { today, upcoming } = birthdayWindow(interaction.guildId);
  const todayLines = today.length ? today.map((item) => birthdayLine(item, true)).join('\n') : 'No birthdays today.';
  const upcomingLines = upcoming.length ? upcoming.slice(0, 5).map((item) => birthdayLine(item)).join('\n') : 'No birthdays in the next 2 months.';
  const desc = [
    `Module: **${enabled ? 'Enabled' : 'Disabled'}**`,
    '', '**🎉 Birthday Day**',
    `Role: ${section.settings.birthdayRoleId ? `<@&${section.settings.birthdayRoleId}>` : '**None**'}`,
    `Today: **${today.length}**`,
    '', '**📣 Public Celebration**',
    `Channel: ${section.settings.announcementChannelId ? `<#${section.settings.announcementChannelId}>` : '**Not set**'}`,
    `Time: **${section.settings.announcementTime} · ${section.settings.timezone}**`,
    `Style: **${section.settings.useBirthdayEmbed ? 'Birthday Card' : 'Plain Message'} · ${section.settings.combineSameDay ? 'Combined' : 'Individual'}**`,
    '', '**📅 Monthly Board**',
    `Channel: ${section.settings.monthlyBoardChannelId ? `<#${section.settings.monthlyBoardChannelId}>` : '**Not set**'}`,
    `Posts: **1st monthly · ${section.settings.monthlyBoardTime}**`,
    '', '**🎂 Today**', todayLines,
    '', '**📆 Upcoming — Next 2 Months**', upcomingLines,
  ].join('\n');
  return {
    embeds: [new EmbedBuilder().setColor(enabled ? 0x5865F2 : 0x747F8D).setTitle('🎂 Birthdays').setDescription(desc).setFooter({ text: 'Goliath Birthdays · /admin' }).setTimestamp()],
    components: [
      row(button('admin:birthdays:celebration', '🎉 Celebration', ButtonStyle.Primary), button('admin:birthdays:management', '🛠️ Management')),
      row(button('admin:studio:communityStudio', '⬅️ Back'), button('admin:birthdays:tools', '⚙️ Settings')),
    ],
  };
}

function timezoneMenu(currentTimezone) {
  const options = TIMEZONES.map(([label, value]) => ({ label, value, default: value === currentTimezone }));
  if (!TIMEZONES.some(([, value]) => value === currentTimezone) && currentTimezone) options.unshift({ label: `Current · ${currentTimezone}`.slice(0, 100), value: currentTimezone, default: true });
  options.push({ label: '✏️ Other / Custom…', value: '__custom__' });
  return new StringSelectMenuBuilder().setCustomId('admin:birthdays:timezone').setPlaceholder('Choose birthday timezone').setMinValues(1).setMaxValues(1).addOptions(...options.slice(0, 25));
}

function celebrationPayload(interaction) {
  const section = birthdays.getSection(interaction.guildId);
  const imageLabel = section.settings.cardImageMode === 'none' ? 'None' : section.settings.cardImageMode === 'custom' ? 'Custom' : 'Goliath Default';
  const desc = [
    '**📣 Public Celebration**',
    `Channel: ${section.settings.announcementChannelId ? `<#${section.settings.announcementChannelId}>` : '**Not set**'}`,
    `Time: **${section.settings.announcementTime} · ${section.settings.timezone}**`,
    `Same-day birthdays: **${section.settings.combineSameDay ? 'Combined' : 'Individual'}**`,
    '', '**💬 Messages**',
    `Individual: **${section.settings.messageTemplates.length} ready**`,
    `Group: **${section.settings.groupMessageTemplates.length} ready**`,
    '', '**🎨 Birthday Card**',
    `Style: **${section.settings.useBirthdayEmbed ? 'Birthday Card' : 'Plain Message'}**`,
    `Image: **${imageLabel}**`,
  ].join('\n');
  return {
    embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎉 Birthday Celebration').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Celebration' }).setTimestamp()],
    components: [
      row(new ChannelSelectMenuBuilder().setCustomId('admin:birthdays:channel').setPlaceholder('Public birthday celebration channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1).setDefaultChannels(section.settings.announcementChannelId ? [section.settings.announcementChannelId] : [])),
      row(timezoneMenu(section.settings.timezone)),
      row(button('admin:birthdays:settings', '🕐 Time', ButtonStyle.Primary), button('admin:birthdays:timezone:custom', '🌍 Timezone'), button('admin:birthdays:combine', section.settings.combineSameDay ? '👥 Combined: On' : '👤 Combined: Off', section.settings.combineSameDay ? ButtonStyle.Success : ButtonStyle.Secondary)),
      row(button('admin:birthdays:messages:individual', '💬 Individual Messages'), button('admin:birthdays:messages:group', '🎉 Group Messages'), button('admin:birthdays:card', '🎨 Birthday Card')),
      row(button('admin:birthdays', '⬅️ Back')),
    ],
  };
}

function messagePoolPayload(interaction, type) {
  const section = birthdays.getSection(interaction.guildId);
  const group = type === 'group';
  const templates = group ? section.settings.groupMessageTemplates : section.settings.messageTemplates;
  const variables = group ? '`{mentions}` · `{count}` · `{server}`' : '`{mention}` · `{user}` · `{server}` · `{age}`';
  const preview = templates.slice(0, 5).map((message, index) => `**${index + 1}.** ${message}`).join('\n\n');
  return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle(group ? '🎉 Group Birthday Messages' : '💬 Individual Birthday Messages').setDescription(`Active messages: **${templates.length}**\nVariables: ${variables}\n\n${preview || 'No messages configured.'}\n\nGoliath rotates through this pool automatically.`).setFooter({ text: 'Goliath Birthdays · Celebration Messages' }).setTimestamp()], components: [row(button(`admin:birthdays:messages:${type}:edit`, '✏️ Edit Messages', ButtonStyle.Primary), button(`admin:birthdays:messages:${type}:defaults`, '♻️ Restore Defaults')), row(button('admin:birthdays:celebration', '⬅️ Back'))] };
}
function cardImageLabel(section) { if (section.settings.cardImageMode === 'none') return 'None'; if (section.settings.cardImageMode === 'custom') return section.settings.cardImageUrl ? 'Custom Image/GIF' : 'Custom — URL missing'; return 'Goliath Default GIF'; }
function cardPayload(interaction) { const section = birthdays.getSection(interaction.guildId); const desc = [`Status: **${section.settings.useBirthdayEmbed ? 'Enabled' : 'Disabled'}**`, `Title: **${section.settings.cardTitle}**`, `Colour: **${section.settings.cardColor}**`, `Image: **${cardImageLabel(section)}**`].join('\n'); return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🎨 Birthday Card').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Birthday Card' }).setTimestamp()], components: [row(button('admin:birthdays:card:toggle', section.settings.useBirthdayEmbed ? '🟢 Card: On' : '⚪ Card: Off', section.settings.useBirthdayEmbed ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:birthdays:card:text', '✏️ Card Title', ButtonStyle.Primary), button('admin:birthdays:card:color', '🎨 Colour'), button('admin:birthdays:card:image', '🖼️ Image / GIF')), row(button('admin:birthdays:card:preview', '👁️ Preview'), button('admin:birthdays:card:defaults', '♻️ Restore Defaults')), row(button('admin:birthdays:celebration', '⬅️ Back'))] }; }
function cardImagePayload(interaction) { const section = birthdays.getSection(interaction.guildId); const desc = [`Current image: **${cardImageLabel(section)}**`, '', 'Choose the built-in birthday GIF, use your own image/GIF URL, or disable the large card image.', section.settings.cardImageMode === 'custom' && section.settings.cardImageUrl ? `\nCustom URL: ${section.settings.cardImageUrl}` : ''].join('\n'); return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🖼️ Birthday Card Image / GIF').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Birthday Card' }).setTimestamp()], components: [row(button('admin:birthdays:card:image:default', '🎉 Goliath Default', section.settings.cardImageMode === 'default' ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:birthdays:card:image:custom', '🔗 Custom URL', section.settings.cardImageMode === 'custom' ? ButtonStyle.Success : ButtonStyle.Secondary), button('admin:birthdays:card:image:none', '🚫 No Image', section.settings.cardImageMode === 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)), row(button('admin:birthdays:card', '⬅️ Back'))] }; }
function managementPayload(interaction) { const section = birthdays.getSection(interaction.guildId); const desc = ['**🎭 Birthday Role**', `Role: ${section.settings.birthdayRoleId ? `<@&${section.settings.birthdayRoleId}>` : '**Not set**'}`, 'Automatically applied for the member’s birthday day.', '', '**📅 Monthly Board**', `Channel: ${section.settings.monthlyBoardChannelId ? `<#${section.settings.monthlyBoardChannelId}>` : '**Not set**'}`, `Schedule: **1st monthly · ${section.settings.monthlyBoardTime} · ${section.settings.timezone}**`, `Leap day: **${section.settings.leapDayMode === 'mar1' ? '1 March' : '28 February'} in non-leap years**`, '', '**👥 Member Birthdays**', 'Manage members’ stored birthday records.'].join('\n'); return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🛠️ Management').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Management' }).setTimestamp()], components: [row(new RoleSelectMenuBuilder().setCustomId('admin:birthdays:role').setPlaceholder('Birthday Role').setMinValues(0).setMaxValues(1).setDefaultRoles(section.settings.birthdayRoleId ? [section.settings.birthdayRoleId] : [])), row(new ChannelSelectMenuBuilder().setCustomId('admin:birthdays:monthly:channel').setPlaceholder('Monthly Board Channel').setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(0).setMaxValues(1).setDefaultChannels(section.settings.monthlyBoardChannelId ? [section.settings.monthlyBoardChannelId] : [])), row(button('admin:birthdays:manage', '👥 Manage Birthdays'), button('admin:birthdays:monthly:settings', '📅 Board Settings')), row(button('admin:birthdays', '⬅️ Back'))] }; }
function toolsPayload() { return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('⚙️ Birthday Settings').setDescription('Birthday diagnostics, testing and data tools.').setFooter({ text: 'Goliath Birthdays · Settings' }).setTimestamp()], components: [row(button('admin:birthdays:testmenu', '🧪 Test Centre'), button('admin:birthdays:health', '🩺 Health'), button('admin:birthdays:import', '📥 Import'), button('admin:birthdays:export', '📤 Export')), row(button('admin:birthdays', '⬅️ Back'))] }; }
function settingsModal(section) { return new ModalBuilder().setCustomId('admin:birthdays:settings:submit').setTitle('Birthday Celebration Time').addComponents(row(new TextInputBuilder().setCustomId('time').setLabel('Celebration time (HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(section.settings.announcementTime).setPlaceholder('09:00'))); }
function customTimezoneModal(section) { return new ModalBuilder().setCustomId('admin:birthdays:timezone:custom:submit').setTitle('Custom Birthday Timezone').addComponents(row(new TextInputBuilder().setCustomId('timezone').setLabel('IANA timezone').setStyle(TextInputStyle.Short).setRequired(true).setValue(section.settings.timezone).setPlaceholder('Europe/London'))); }
function messagesModal(section, type) { const group = type === 'group'; const values = group ? section.settings.groupMessageTemplates : section.settings.messageTemplates; return new ModalBuilder().setCustomId(`admin:birthdays:messages:${type}:submit`).setTitle(group ? 'Group Birthday Messages' : 'Individual Birthday Messages').addComponents(row(new TextInputBuilder().setCustomId('messages').setLabel('One rotating message per line').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(values.join('\n')))); }
function cardTextModal(section) { return new ModalBuilder().setCustomId('admin:birthdays:card:text:submit').setTitle('Birthday Card Title').addComponents(row(new TextInputBuilder().setCustomId('title').setLabel('Card title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(section.settings.cardTitle))); }
function cardColorModal(section) { return new ModalBuilder().setCustomId('admin:birthdays:card:color:submit').setTitle('Birthday Card Colour').addComponents(row(new TextInputBuilder().setCustomId('color').setLabel('Embed colour hex').setStyle(TextInputStyle.Short).setRequired(true).setValue(section.settings.cardColor).setPlaceholder('#5865F2'))); }
function cardImageModal(section) { return new ModalBuilder().setCustomId('admin:birthdays:card:image:custom:submit').setTitle('Custom Birthday Card Image').addComponents(row(new TextInputBuilder().setCustomId('image').setLabel('Image / GIF URL').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2000).setValue(section.settings.cardImageUrl || '').setPlaceholder('https://...'))); }
function monthlySettingsModal(section) { return new ModalBuilder().setCustomId('admin:birthdays:monthly:settings:submit').setTitle('Monthly Board & Leap Day').addComponents(row(new TextInputBuilder().setCustomId('time').setLabel('Monthly board time (HH:MM)').setStyle(TextInputStyle.Short).setRequired(true).setValue(section.settings.monthlyBoardTime)), row(new TextInputBuilder().setCustomId('leap').setLabel('Feb 29 in non-leap years').setStyle(TextInputStyle.Short).setRequired(true).setValue(section.settings.leapDayMode === 'mar1' ? 'mar1' : 'feb28').setPlaceholder('feb28 or mar1'))); }
function manageModal() { return new ModalBuilder().setCustomId('admin:birthdays:manage:submit').setTitle('Manage Member Birthday').addComponents(row(new TextInputBuilder().setCustomId('user').setLabel('Discord user ID').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('123456789012345678')), row(new TextInputBuilder().setCustomId('date').setLabel('Birthday (DD/MM or DD/MM/YYYY)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('18/08/1990 · blank = remove')), row(new TextInputBuilder().setCustomId('privacy').setLabel('List / Announce / Age (on/off)').setStyle(TextInputStyle.Short).setRequired(false).setPlaceholder('on / on / off'))); }
function importModal() { return new ModalBuilder().setCustomId('admin:birthdays:import:submit').setTitle('Import Birthdays JSON').addComponents(row(new TextInputBuilder().setCustomId('json').setLabel('Paste Goliath birthday JSON').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000))); }
function birthdayModal(record) { const value = record ? `${String(record.day).padStart(2, '0')}/${String(record.month).padStart(2, '0')}${record.year ? `/${record.year}` : ''}` : ''; return new ModalBuilder().setCustomId('birthdays:user:set:submit').setTitle('My Birthday').addComponents(row(new TextInputBuilder().setCustomId('date').setLabel('Birthday (DD/MM or DD/MM/YYYY)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('16/08 or 16/08/1990').setValue(value))); }
function userPayload(interaction) {
  const record = birthdays.getBirthday(interaction.guildId, interaction.user.id);
  const isToday = birthdayWindow(interaction.guildId).today.some((item) => item.member.userId === interaction.user.id);
  const desc = record ? [
    '**🎂 Your Birthday**',
    `Date: **${String(record.day).padStart(2, '0')}/${String(record.month).padStart(2, '0')}${record.year ? `/${record.year}` : ''}**${isToday ? ' — **TODAY**' : ''}`,
    '',
    'Use the buttons below to update your birthday or choose how it appears in server birthday features.',
  ].join('\n') : [
    '**🎂 Add Your Birthday**',
    'You have not added a birthday yet.',
    'Your birth year is optional. Privacy settings become available after saving your birthday.',
  ].join('\n');
  return { embeds: [new EmbedBuilder().setColor(isToday ? 0xF1C40F : 0x5865F2).setTitle(isToday ? '🎉 Happy Birthday!' : '🎂 My Birthday').setDescription(desc).setFooter({ text: 'Goliath Birthdays · /user' }).setTimestamp()], components: record ? [row(button('birthdays:user:set', '✏️ Edit Birthday', ButtonStyle.Primary), button('birthdays:user:upcoming', '📅 Today & Upcoming')), row(button('birthdays:user:privacy', '🔐 Privacy Settings'), button('birthdays:user:remove', '🗑️ Remove Birthday', ButtonStyle.Danger)), row(button('user:category:community', '⬅️ Back'))] : [row(button('birthdays:user:set', '➕ Add Birthday', ButtonStyle.Primary), button('birthdays:user:upcoming', '📅 Today & Upcoming')), row(button('user:category:community', '⬅️ Back'))] };
}
function userPrivacyPayload(interaction) { const record = birthdays.getBirthday(interaction.guildId, interaction.user.id); if (!record) return userPayload(interaction); const ageAvailable = Boolean(record.year); const desc = ['**📅 Listed in Birthday Lists**', 'Controls whether your birthday appears in Goliath birthday lists, including **Today & Upcoming** and the server **Monthly Birthday Board**.', `Status: **${record.listPublic ? 'On' : 'Off'}**`, '', '**📣 Birthday Announcement**', 'Controls whether Goliath publicly celebrates your birthday in the server configured birthday channel.', `Status: **${record.announce ? 'On' : 'Off'}**`, '', '**🎈 Show My Age**', ageAvailable ? 'Controls whether your age is shown publicly when your birth year has been provided.' : 'Age cannot be displayed because no birth year is stored.', `Status: **${ageAvailable ? (record.showAge ? 'On' : 'Off') : 'Unavailable'}**`].join('\n'); return { embeds: [new EmbedBuilder().setColor(0x5865F2).setTitle('🔐 Birthday Privacy').setDescription(desc).setFooter({ text: 'Goliath Birthdays · Privacy Settings' }).setTimestamp()], components: [row(button('birthdays:user:list', record.listPublic ? '📅 Listed: On' : '📅 Listed: Off', record.listPublic ? ButtonStyle.Success : ButtonStyle.Secondary), button('birthdays:user:announce', record.announce ? '📣 Announce: On' : '📣 Announce: Off', record.announce ? ButtonStyle.Success : ButtonStyle.Secondary), button('birthdays:user:age', ageAvailable ? (record.showAge ? '🎈 Age: On' : '🎈 Age: Off') : '🎈 Age: Unavailable', ageAvailable && record.showAge ? ButtonStyle.Success : ButtonStyle.Secondary, !ageAvailable)), row(button('birthdays:user:open', '⬅️ Back'))] }; }

module.exports = { row, button, birthdayListContent, adminPayload, celebrationPayload, messagePoolPayload, cardPayload, cardImagePayload, managementPayload, toolsPayload, userPayload, userPrivacyPayload, settingsModal, customTimezoneModal, messagesModal, cardTextModal, cardColorModal, cardImageModal, monthlySettingsModal, manageModal, importModal, birthdayModal };
