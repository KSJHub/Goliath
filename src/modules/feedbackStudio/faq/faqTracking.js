'use strict';

const faq = require('./faq');
const panel = require('./faqPanel');
const { isModuleEnabled } = require('../../../core/guild/guildManager');
const { DEFAULT_BOT_CHANNEL_PERMISSIONS, guardChannelAccess } = require('../../../core/security/protection/permissions');

async function deploy(guild, actorId = null) {
  if (!guild?.id) throw new Error('Guild is required.');
  if (!isModuleEnabled(guild.id, 'faq')) throw new Error('FAQ module is disabled.');
  const section = faq.getSection(guild.id);
  const channelId = section.settings.channelId;
  if (!channelId) throw new Error('Select an FAQ channel first.');
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.send) throw new Error('FAQ channel is unavailable or not sendable.');
  await guardChannelAccess(guild, channel.id, DEFAULT_BOT_CHANNEL_PERMISSIONS, { scope:'faq.panel_deployment', autoFix:true, throwOnFail:true, reason:'Goliath FAQ panel deployment validation' });

  let message = section.panel.messageId ? await channel.messages.fetch(section.panel.messageId).catch(() => null) : null;
  const payload = panel.buildHomePanel(guild.id);
  if (message) await message.edit(payload);
  else message = await channel.send(payload);

  faq.updateSection(guild.id, s => ({ ...s, panel:{ channelId:channel.id, messageId:message.id, deployedAt:new Date().toISOString(), deployedBy:actorId }, updatedAt:new Date().toISOString() }), guild);
  return message;
}

function increment(guildId, key, guild) {
  faq.updateSection(guildId, s => ({ ...s, analytics:{ ...s.analytics, [key]:Math.max(0,Number(s.analytics?.[key]||0))+1 }, updatedAt:new Date().toISOString() }), guild);
}

module.exports = { deploy, increment };
