'use strict';

const guildManager = require('../../../core/guild/guildManager');
const birthdays = require('./birthdays');
const management = require('./birthdaysManagement');
const {
  row, button, birthdayListContent,
  adminPayload, celebrationPayload, messagePoolPayload, cardPayload, cardImagePayload, toolsPayload, userPayload, userPrivacyPayload,
  settingsModal, customTimezoneModal, messagesModal, cardTextModal, cardColorModal, cardImageModal, monthlySettingsModal, manageModal, importModal, birthdayModal,
} = require('./birthdaysViews');

async function respond(interaction, payload) {
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  if (interaction.isModalSubmit?.()) return interaction.reply({ ...payload, flags: 64 });
  return interaction.update(payload);
}
function parseDate(raw) {
  const match = String(raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!match) throw new Error('Use DD/MM or DD/MM/YYYY.');
  return { day: Number(match[1]), month: Number(match[2]), year: match[3] ? Number(match[3]) : null };
}
function parsePrivacy(raw) {
  const values = String(raw || '').split('/').map((v) => v.trim().toLowerCase());
  const bool = (v, fallback) => !v ? fallback : ['on', 'true', 'yes', '1'].includes(v);
  return { listPublic: bool(values[0], true), announce: bool(values[1], true), showAge: bool(values[2], false) };
}

async function handleAdmin(interaction) {
  const id = String(interaction.customId || ''); if (!id.startsWith('admin:birthdays')) return false;
  const actor = { actorId: interaction.user.id };

  if (id === 'admin:birthdays') { await respond(interaction, adminPayload(interaction)); return true; }
  if (id === 'admin:birthdays:celebration') { await respond(interaction, celebrationPayload(interaction)); return true; }
  if (id === 'admin:birthdays:management') { await respond(interaction, management.managementPayload(interaction)); return true; }
  if (id === 'admin:birthdays:tools') { await respond(interaction, toolsPayload(interaction)); return true; }
  if (id === 'admin:birthdays:enable' || id === 'admin:birthdays:disable') {
    const enabled = id.endsWith(':enable');
    guildManager.setModuleEnabled(interaction.guild.id, 'birthdays', enabled, { ...actor, action: enabled ? 'birthdays_admin_enable' : 'birthdays_admin_disable' });
    await respond(interaction, toolsPayload(interaction)); return true;
  }
  if (id === 'admin:birthdays:messages:individual') { await respond(interaction, messagePoolPayload(interaction, 'individual')); return true; }
  if (id === 'admin:birthdays:messages:group') { await respond(interaction, messagePoolPayload(interaction, 'group')); return true; }
  if (id === 'admin:birthdays:card') { await respond(interaction, cardPayload(interaction)); return true; }
  if (id === 'admin:birthdays:card:image') { await respond(interaction, cardImagePayload(interaction)); return true; }

  if (id === 'admin:birthdays:role:open') { await respond(interaction, management.rolePayload(interaction, 0)); return true; }
  if (id.startsWith('admin:birthdays:role:page:')) { const page = Number(id.split(':').pop()) || 0; await respond(interaction, management.rolePayload(interaction, page)); return true; }
  if (id.startsWith('admin:birthdays:role:select:') && interaction.isStringSelectMenu?.()) {
    const page = Number(id.split(':').pop()) || 0; const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId) || await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role || role.id === interaction.guild.id || role.managed) throw new Error('That role cannot be used as the Birthday Role.');
    if (!role.editable) throw new Error('Goliath cannot assign that role. Move Goliath above it in the role hierarchy and try again.');
    birthdays.updateSettings(interaction.guildId, { birthdayRoleId: roleId }, { ...actor, action: 'birthdays_role_update' });
    await respond(interaction, management.rolePayload(interaction, page)); return true;
  }
  if (id === 'admin:birthdays:role:clear') { birthdays.updateSettings(interaction.guildId, { birthdayRoleId: null }, { ...actor, action: 'birthdays_role_clear' }); await respond(interaction, management.rolePayload(interaction, 0)); return true; }

  if (id === 'admin:birthdays:members') { await respond(interaction, management.memberListPayload(interaction, 0)); return true; }
  if (id.startsWith('admin:birthdays:members:page:')) { const page = Number(id.split(':').pop()) || 0; await respond(interaction, management.memberListPayload(interaction, page)); return true; }
  if (id.startsWith('admin:birthdays:members:select:') && interaction.isStringSelectMenu?.()) { await respond(interaction, management.memberPayload(interaction, interaction.values[0])); return true; }
  if (id === 'admin:birthdays:members:add') { await respond(interaction, management.addMemberPayload()); return true; }
  if (id === 'admin:birthdays:members:add:select' && interaction.isUserSelectMenu?.()) {
    const userId = interaction.values[0]; const existing = birthdays.getBirthday(interaction.guildId, userId);
    await interaction.showModal(management.birthdayEditModal(userId, existing, existing ? 'edit' : 'add')); return true;
  }
  if (id.startsWith('admin:birthdays:member:add:submit:')) { const userId = id.split(':').pop(); birthdays.setBirthday(interaction.guildId, userId, { ...parseDate(interaction.fields.getTextInputValue('date')), listPublic: true, announce: true, showAge: false }, { ...actor, action: 'birthday_admin_add' }); await interaction.reply({ content: `✅ Birthday added for <@${userId}>.`, flags: 64 }); return true; }
  if (id.startsWith('admin:birthdays:member:edit:submit:')) { const userId = id.split(':').pop(); birthdays.setBirthday(interaction.guildId, userId, parseDate(interaction.fields.getTextInputValue('date')), { ...actor, action: 'birthday_admin_edit' }); await interaction.reply({ content: `✅ Birthday updated for <@${userId}>.`, flags: 64 }); return true; }
  if (id.startsWith('admin:birthdays:member:edit:')) { const userId = id.split(':').pop(); const record = birthdays.getBirthday(interaction.guildId, userId); if (!record) throw new Error('That birthday record no longer exists.'); await interaction.showModal(management.birthdayEditModal(userId, record, 'edit')); return true; }
  if (id.startsWith('admin:birthdays:member:list:')) { const userId = id.split(':').pop(); const record = birthdays.getBirthday(interaction.guildId, userId); if (!record) throw new Error('That birthday record no longer exists.'); birthdays.setBirthday(interaction.guildId, userId, { listPublic: !record.listPublic }, { ...actor, action: 'birthday_admin_list_toggle' }); await respond(interaction, management.memberPayload(interaction, userId)); return true; }
  if (id.startsWith('admin:birthdays:member:announce:')) { const userId = id.split(':').pop(); const record = birthdays.getBirthday(interaction.guildId, userId); if (!record) throw new Error('That birthday record no longer exists.'); birthdays.setBirthday(interaction.guildId, userId, { announce: !record.announce }, { ...actor, action: 'birthday_admin_announce_toggle' }); await respond(interaction, management.memberPayload(interaction, userId)); return true; }
  if (id.startsWith('admin:birthdays:member:age:')) { const userId = id.split(':').pop(); const record = birthdays.getBirthday(interaction.guildId, userId); if (!record) throw new Error('That birthday record no longer exists.'); if (!record.year) throw new Error('This member did not register a birth year, so age cannot be shown.'); birthdays.setBirthday(interaction.guildId, userId, { showAge: !record.showAge }, { ...actor, action: 'birthday_admin_age_toggle' }); await respond(interaction, management.memberPayload(interaction, userId)); return true; }
  if (id.startsWith('admin:birthdays:member:remove:')) { const userId = id.split(':').pop(); birthdays.removeBirthday(interaction.guildId, userId, { ...actor, action: 'birthday_admin_remove' }); await respond(interaction, management.memberListPayload(interaction, 0)); return true; }

  if (id === 'admin:birthdays:board') { await respond(interaction, management.boardPayload(interaction)); return true; }
  if (id === 'admin:birthdays:board:edit') { await interaction.showModal(management.boardSettingsModal(birthdays.getSection(interaction.guildId))); return true; }
  if (id === 'admin:birthdays:board:edit:submit') {
    const day = Number(interaction.fields.getTextInputValue('day').trim()); const time = interaction.fields.getTextInputValue('time').trim();
    if (!Number.isInteger(day) || day < 1 || day > 28) throw new Error('Monthly board day must be between 1 and 28.');
    if (!birthdays.validTime(time)) throw new Error('Monthly board time must use HH:MM.');
    birthdays.updateSettings(interaction.guildId, { monthlyBoardDay: day, monthlyBoardTime: time, leapDayMode: 'feb28' }, { ...actor, action: 'birthdays_monthly_settings_update' });
    await interaction.reply({ content: `✅ Monthly board schedule updated to day **${day}** at **${time}**.`, flags: 64 }); return true;
  }
  if (id === 'admin:birthdays:board:preview') { const section = birthdays.getSection(interaction.guildId); await interaction.reply({ content: '👁️ Monthly Birthday Board preview', embeds: [birthdays.monthlyBoardEmbed(interaction.guild, section)], flags: 64, allowedMentions: { parse: [] } }); return true; }

  if (id === 'admin:birthdays:channel' && interaction.isChannelSelectMenu?.()) birthdays.updateSettings(interaction.guildId, { announcementChannelId: interaction.values[0] || null }, { ...actor, action: 'birthdays_channel_update' });
  else if (id === 'admin:birthdays:timezone' && interaction.isStringSelectMenu?.()) { const timezone = interaction.values[0]; if (timezone === '__custom__') { await interaction.showModal(customTimezoneModal(birthdays.getSection(interaction.guildId))); return true; } if (!birthdays.validTimezone(timezone)) throw new Error('That timezone is not valid.'); birthdays.updateSettings(interaction.guildId, { timezone }, { ...actor, action: 'birthdays_timezone_update' }); }
  else if (id === 'admin:birthdays:timezone:custom') { await interaction.showModal(customTimezoneModal(birthdays.getSection(interaction.guildId))); return true; }
  else if (id === 'admin:birthdays:role' && interaction.isRoleSelectMenu?.()) birthdays.updateSettings(interaction.guildId, { birthdayRoleId: interaction.values[0] || null }, { ...actor, action: 'birthdays_role_update' });
  else if (id === 'admin:birthdays:monthly:channel' && interaction.isChannelSelectMenu?.()) birthdays.updateSettings(interaction.guildId, { monthlyBoardChannelId: interaction.values[0] || null }, { ...actor, action: 'birthdays_monthly_channel_update' });
  else if (id === 'admin:birthdays:settings') { await interaction.showModal(settingsModal(birthdays.getSection(interaction.guildId))); return true; }
  else if (id === 'admin:birthdays:monthly:settings') { await interaction.showModal(monthlySettingsModal(birthdays.getSection(interaction.guildId))); return true; }
  else if (id === 'admin:birthdays:manage') { await interaction.showModal(manageModal()); return true; }
  else if (id === 'admin:birthdays:import') { await interaction.showModal(importModal()); return true; }
  else if (id === 'admin:birthdays:combine') birthdays.updateSettings(interaction.guildId, { combineSameDay: !birthdays.getSection(interaction.guildId).settings.combineSameDay }, { ...actor, action: 'birthdays_combine_toggle' });
  else if (id === 'admin:birthdays:messages:individual:edit') { await interaction.showModal(messagesModal(birthdays.getSection(interaction.guildId), 'individual')); return true; }
  else if (id === 'admin:birthdays:messages:group:edit') { await interaction.showModal(messagesModal(birthdays.getSection(interaction.guildId), 'group')); return true; }
  else if (id === 'admin:birthdays:messages:individual:defaults') { birthdays.updateSettings(interaction.guildId, { messageTemplates: birthdays.DEFAULT_INDIVIDUAL_TEMPLATES }, { ...actor, action: 'birthdays_individual_messages_defaults' }); await respond(interaction, messagePoolPayload(interaction, 'individual')); return true; }
  else if (id === 'admin:birthdays:messages:group:defaults') { birthdays.updateSettings(interaction.guildId, { groupMessageTemplates: birthdays.DEFAULT_GROUP_TEMPLATES }, { ...actor, action: 'birthdays_group_messages_defaults' }); await respond(interaction, messagePoolPayload(interaction, 'group')); return true; }
  else if (id === 'admin:birthdays:card:toggle') { const section = birthdays.getSection(interaction.guildId); birthdays.updateSettings(interaction.guildId, { useBirthdayEmbed: !section.settings.useBirthdayEmbed }, { ...actor, action: 'birthdays_card_toggle' }); await respond(interaction, cardPayload(interaction)); return true; }
  else if (id === 'admin:birthdays:card:text') { await interaction.showModal(cardTextModal(birthdays.getSection(interaction.guildId))); return true; }
  else if (id === 'admin:birthdays:card:color') { await interaction.showModal(cardColorModal(birthdays.getSection(interaction.guildId))); return true; }
  else if (id === 'admin:birthdays:card:image:custom') { await interaction.showModal(cardImageModal(birthdays.getSection(interaction.guildId))); return true; }
  else if (id === 'admin:birthdays:card:image:default') { birthdays.updateSettings(interaction.guildId, { cardImageMode: 'default', cardImageUrl: null }, { ...actor, action: 'birthdays_card_image_default' }); await respond(interaction, cardImagePayload(interaction)); return true; }
  else if (id === 'admin:birthdays:card:image:none') { birthdays.updateSettings(interaction.guildId, { cardImageMode: 'none' }, { ...actor, action: 'birthdays_card_image_none' }); await respond(interaction, cardImagePayload(interaction)); return true; }
  else if (id === 'admin:birthdays:card:defaults') { birthdays.updateSettings(interaction.guildId, { useBirthdayEmbed: true, cardTitle: '🎂 Happy Birthday!', cardColor: '#5865F2', cardImageMode: 'default', cardImageUrl: null }, { ...actor, action: 'birthdays_card_defaults' }); await respond(interaction, cardPayload(interaction)); return true; }
  else if (id === 'admin:birthdays:card:preview') { const section = birthdays.getSection(interaction.guildId); const member = birthdays.getBirthday(interaction.guildId, interaction.user.id) || birthdays.normalizeMember({ userId: interaction.user.id, month: 1, day: 1 }, interaction.user.id, section.settings); const today = new Date().toISOString().slice(0, 10); const preview = birthdays.birthdayEmbed(interaction.guild, section, [member], new Date().getUTCFullYear(), today, true); await interaction.reply({ content: '👁️ Birthday Card preview', embeds: [preview], flags: 64, allowedMentions: { parse: [] } }); return true; }
  else if (id === 'admin:birthdays:testmenu') { await interaction.reply({ content: '**🧪 Birthday Test Centre**\nThese tests do not mark live birthdays as announced or change scheduler state.', flags: 64, components: [row(button('admin:birthdays:test:role', '🎭 Test Role'), button('admin:birthdays:test:announcement', '📣 Test Celebration'), button('admin:birthdays:test:monthly', '🗓️ Test Monthly Board'))] }); return true; }
  else if (id === 'admin:birthdays:test:role') { const result = await birthdays.testRoleAssignment(interaction.guild, interaction.user.id); await interaction.reply({ content: `✅ Birthday role test passed for <@&${result.roleId}>.${result.alreadyHadRole ? ' You already had the role, so it was not removed.' : ' The role was added and removed successfully.'}`, flags: 64 }); return true; }
  else if (id === 'admin:birthdays:test:announcement') { await birthdays.testPublicAnnouncement(interaction.guild, interaction.user.id); await interaction.reply({ content: '✅ Test birthday celebration posted. Live announcement state was not changed.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:test:monthly') { await birthdays.testMonthlyBoard(interaction.guild); await interaction.reply({ content: '✅ Test monthly birthday board posted. The real monthly schedule was not marked as sent.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:export') { const data = Buffer.from(JSON.stringify(birthdays.exportData(interaction.guildId), null, 2), 'utf8'); await interaction.reply({ content: '📤 Birthday export ready.', flags: 64, files: [{ attachment: data, name: `goliath-birthdays-${interaction.guildId}.json` }] }); return true; }
  else if (id === 'admin:birthdays:health') { const health = await birthdays.buildHealth(interaction.guild); const a = health.audit; await interaction.reply({ content: `**🩺 Birthday Health — ${health.healthy ? 'Healthy' : 'Needs attention'}**\nIssues: **${health.issues.length}** · Warnings: **${health.warnings.length}**\nLast processed: **${a.lastProcessed || 'Never'}**\nLast announcement: **${a.lastAnnouncement || 'Never'}**\nLast monthly board: **${a.lastMonthlyBoard || 'Never'}**\nNext scheduled announcement: **${a.nextAnnouncement}**\nFailures: **${a.failures}**${a.lastFailure ? ` · Last: ${a.lastFailure}` : ''}`, flags: 64 }); return true; }
  else if (id === 'admin:birthdays:settings:submit') { const time = interaction.fields.getTextInputValue('time').trim(); if (!birthdays.validTime(time)) throw new Error('Celebration time must use HH:MM.'); birthdays.updateSettings(interaction.guildId, { announcementTime: time }, { ...actor, action: 'birthdays_time_update' }); await interaction.reply({ content: '✅ Birthday celebration time updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:timezone:custom:submit') { const timezone = interaction.fields.getTextInputValue('timezone').trim(); if (!birthdays.validTimezone(timezone)) throw new Error('Enter a valid IANA timezone such as Europe/London.'); birthdays.updateSettings(interaction.guildId, { timezone }, { ...actor, action: 'birthdays_timezone_update' }); await interaction.reply({ content: `✅ Birthday timezone updated to **${timezone}**.`, flags: 64 }); return true; }
  else if (id === 'admin:birthdays:messages:individual:submit') { birthdays.updateSettings(interaction.guildId, { messageTemplates: interaction.fields.getTextInputValue('messages') }, { ...actor, action: 'birthdays_individual_messages_update' }); await interaction.reply({ content: '✅ Individual birthday message pool updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:messages:group:submit') { birthdays.updateSettings(interaction.guildId, { groupMessageTemplates: interaction.fields.getTextInputValue('messages') }, { ...actor, action: 'birthdays_group_messages_update' }); await interaction.reply({ content: '✅ Group birthday message pool updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:card:text:submit') { birthdays.updateSettings(interaction.guildId, { cardTitle: interaction.fields.getTextInputValue('title') }, { ...actor, action: 'birthdays_card_text_update' }); await interaction.reply({ content: '✅ Birthday Card title updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:card:color:submit') { const color = interaction.fields.getTextInputValue('color').trim(); if (!/^#?[0-9a-f]{6}$/i.test(color)) throw new Error('Card colour must be a 6-digit hex colour such as #5865F2.'); birthdays.updateSettings(interaction.guildId, { cardColor: color }, { ...actor, action: 'birthdays_card_color_update' }); await interaction.reply({ content: '✅ Birthday Card colour updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:card:image:custom:submit') { const image = interaction.fields.getTextInputValue('image').trim(); if (!/^https?:\/\//i.test(image)) throw new Error('Card image must be an http/https URL.'); birthdays.updateSettings(interaction.guildId, { cardImageMode: 'custom', cardImageUrl: image }, { ...actor, action: 'birthdays_card_image_custom' }); await interaction.reply({ content: '✅ Custom Birthday Card image/GIF updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:monthly:settings:submit') { const time = interaction.fields.getTextInputValue('time').trim(); if (!birthdays.validTime(time)) throw new Error('Monthly board time must use HH:MM.'); birthdays.updateSettings(interaction.guildId, { monthlyBoardTime: time, leapDayMode: 'feb28' }, { ...actor, action: 'birthdays_monthly_settings_update' }); await interaction.reply({ content: '✅ Monthly board time updated.', flags: 64 }); return true; }
  else if (id === 'admin:birthdays:manage:submit') { const userId = interaction.fields.getTextInputValue('user').trim(); if (!/^\d{15,25}$/.test(userId)) throw new Error('Enter a valid Discord user ID.'); const rawDate = interaction.fields.getTextInputValue('date').trim(); if (!rawDate) { const removed = birthdays.removeBirthday(interaction.guildId, userId, { ...actor, action: 'birthday_admin_remove' }); await interaction.reply({ content: removed ? `✅ Removed birthday for <@${userId}>.` : 'No birthday record was found for that member.', flags: 64 }); return true; } birthdays.setBirthday(interaction.guildId, userId, { ...parseDate(rawDate), ...parsePrivacy(interaction.fields.getTextInputValue('privacy')) }, { ...actor, action: 'birthday_admin_set' }); await interaction.reply({ content: `✅ Birthday updated for <@${userId}>.`, flags: 64 }); return true; }
  else if (id === 'admin:birthdays:import:submit') { let parsed; try { parsed = JSON.parse(interaction.fields.getTextInputValue('json')); } catch { throw new Error('Import data is not valid JSON.'); } const result = birthdays.importData(interaction.guildId, parsed, { ...actor, action: 'birthday_admin_import' }); await interaction.reply({ content: `✅ Imported **${result.imported}** birthday record(s). Total stored: **${result.total}**.`, flags: 64 }); return true; }

  if (id === 'admin:birthdays:channel' || id === 'admin:birthdays:timezone' || id === 'admin:birthdays:combine') { await respond(interaction, celebrationPayload(interaction)); return true; }
  if (id === 'admin:birthdays:monthly:channel') { await respond(interaction, management.managementPayload(interaction)); return true; }
  if (id === 'admin:birthdays:role') { await respond(interaction, management.managementPayload(interaction)); return true; }
  await respond(interaction, adminPayload(interaction)); return true;
}

async function handleUser(interaction) {
  const id = String(interaction.customId || ''); if (!id.startsWith('birthdays:user:')) return false;
  if (!guildManager.isModuleEnabled(interaction.guildId, 'birthdays')) { await interaction.reply({ content: '❌ Birthdays is currently disabled for this server.', flags: 64 }); return true; }
  const record = birthdays.getBirthday(interaction.guildId, interaction.user.id);
  if (id === 'birthdays:user:open') { await respond(interaction, userPayload(interaction)); return true; }
  if (id === 'birthdays:user:privacy') { await respond(interaction, userPrivacyPayload(interaction)); return true; }
  if (id === 'birthdays:user:set') { await interaction.showModal(birthdayModal(record)); return true; }
  if (id === 'birthdays:user:set:submit') { birthdays.setBirthday(interaction.guildId, interaction.user.id, parseDate(interaction.fields.getTextInputValue('date')), { actorId: interaction.user.id, action: 'birthday_user_set' }); await interaction.reply({ content: '✅ Your birthday has been saved.', flags: 64 }); return true; }
  if (!record) { await interaction.reply({ content: 'Add your birthday first.', flags: 64 }); return true; }
  if (id === 'birthdays:user:list') { birthdays.setBirthday(interaction.guildId, interaction.user.id, { listPublic: !record.listPublic }, { actorId: interaction.user.id, action: 'birthday_user_list' }); await respond(interaction, userPrivacyPayload(interaction)); return true; }
  if (id === 'birthdays:user:announce') { birthdays.setBirthday(interaction.guildId, interaction.user.id, { announce: !record.announce }, { actorId: interaction.user.id, action: 'birthday_user_announce' }); await respond(interaction, userPrivacyPayload(interaction)); return true; }
  if (id === 'birthdays:user:age') {
    if (!record.year) { await respond(interaction, userPrivacyPayload(interaction)); return true; }
    birthdays.setBirthday(interaction.guildId, interaction.user.id, { showAge: !record.showAge }, { actorId: interaction.user.id, action: 'birthday_user_age' }); await respond(interaction, userPrivacyPayload(interaction)); return true;
  }
  if (id === 'birthdays:user:remove') { birthdays.removeBirthday(interaction.guildId, interaction.user.id, { actorId: interaction.user.id, action: 'birthday_user_remove' }); await respond(interaction, userPayload(interaction)); return true; }
  if (id === 'birthdays:user:upcoming') { await interaction.reply({ content: birthdayListContent(interaction.guildId), flags: 64, allowedMentions: { parse: [] } }); return true; }
  await respond(interaction, userPayload(interaction)); return true;
}

module.exports = { adminPayload, userPayload, handleAdmin, handleUser };
