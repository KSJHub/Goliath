'use strict';
const express = require('express');
const birthdays = require('../../modules/communityStudio/birthdays/birthdays');
const selectors = require('../../modules/roleStudio/roleSelector/roleSelectorService');
const guildManager = require('../../core/guild/guildManager');
const social = require('../../modules/socialStudio/socialAlerts/socialStudioStore');
const router = express.Router();
router.use((req, res, next) => {
  if (!/^\d{16,20}$/.test(String(req.session?.user?.id || ''))) return res.status(401).json({ error: 'Sign in required.' });
  res.set('Cache-Control', 'no-store');
  if (!['GET', 'HEAD'].includes(req.method)) {
    try {
      const origin = new URL(req.get('origin'));
      const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
      if (origin.host.toLowerCase() !== host.toLowerCase()) throw new Error('Origin mismatch');
    } catch { return res.status(403).json({ error: 'Invalid request origin.' }); }
  }
  next();
});
async function memberFor(req, id) {
  const guild = req.client?.guilds?.cache?.get(String(id));
  if (!guild) return null;
  const member = await guild.members.fetch({ user: req.session.user.id, force: true }).catch(() => null);
  return member ? { guild, member } : null;
}
router.get('/communities', async (req, res) => {
  try {
    const result = [];
    for (const guild of req.client?.guilds?.cache?.values?.() || []) {
      const member = await guild.members.fetch({ user: req.session.user.id, force: true }).catch(() => null);
      if (member) result.push({ id: guild.id, name: guild.name, iconUrl: guild.iconURL?.({ size: 128 }) || null });
    }
    return res.json({ communities: result });
  } catch { return res.status(503).json({ error: 'Unable to load communities.' }); }
});
router.get('/communities/:guildId', async (req, res) => {
  try {
    const context = await memberFor(req, req.params.guildId);
    if (!context) return res.status(403).json({ error: 'Community membership required.' });
    const { guild, member } = context;
    const birthdayEnabled = guildManager.isModuleEnabled(guild.id, 'birthdays');
    const rolesEnabled = guildManager.isModuleEnabled(guild.id, selectors.MODULE);
    const birthday = birthdayEnabled ? birthdays.getBirthday(guild.id, member.id) : null;
    const groups = rolesEnabled ? selectors.listGroups(guild.id).filter(g => g.type === 'standard' && selectors.isGroupMemberUsable(g)).map(g => ({
      id: g.id, name: g.name, description: g.description, selectionMode: g.selectionMode, allowRemove: g.allowRemove,
      options: g.options.filter(o => o.enabled).map(o => ({ id: o.id, label: o.label, emoji: o.emoji, selected: Boolean(o.roleId && member.roles.cache.has(o.roleId)) }))
    })) : [];
    const creator = social.findCreatorByOwner(guild.id, member.id);
    const accounts = creator ? social.getCreatorAccounts(guild.id, creator).map(a => ({ platform: a.platform || a.provider, username: a.username || a.externalId || '', enabled: a.enabled !== false })) : [];
    res.json({ community: { id: guild.id, name: guild.name, nickname: member.nickname || null, joinedAt: member.joinedAt?.toISOString?.() || null,
      roles: [...member.roles.cache.values()].filter(r => r.id !== guild.id).sort((a,b) => b.position-a.position).map(r => ({ id:r.id, name:r.name, color:r.hexColor })) },
      birthday: birthday ? { day:birthday.day, month:birthday.month, year:birthday.year, listPublic:birthday.listPublic, announce:birthday.announce, showAge:birthday.showAge } : null,
      birthdayEnabled, groups, accounts });
  } catch { res.status(503).json({ error: 'Unable to load your community profile.' }); }
});
router.put('/communities/:guildId/birthday', async (req, res) => {
  const context = await memberFor(req, req.params.guildId);
  if (!context) return res.status(403).json({ error: 'Community membership required.' });
  if (!guildManager.isModuleEnabled(context.guild.id, 'birthdays')) return res.status(403).json({ error: 'Birthdays are unavailable in this community.' });
  const b = req.body || {};
  if (![b.listPublic,b.announce,b.showAge].every(v => typeof v === 'boolean')) return res.status(400).json({ error: 'Choose your birthday privacy settings.' });
  try { birthdays.setBirthday(context.guild.id, context.member.id, { day:b.day, month:b.month, year:b.year || null, listPublic:b.listPublic, announce:b.announce, showAge:b.showAge }, { actorId:context.member.id, action:'member_portal_birthday' }); return res.json({ ok:true }); }
  catch (e) { return res.status(400).json({ error:e.message }); }
});
router.delete('/communities/:guildId/birthday', async (req, res) => {
  const context = await memberFor(req, req.params.guildId);
  if (!context) return res.status(403).json({ error: 'Community membership required.' });
  if (!guildManager.isModuleEnabled(context.guild.id, 'birthdays')) return res.status(403).json({ error: 'Birthdays are unavailable in this community.' });
  try { birthdays.removeBirthday(context.guild.id, context.member.id, { actorId:context.member.id, action:'member_portal_birthday_remove' }); return res.json({ ok:true }); }
  catch { return res.status(500).json({ error:'Unable to remove birthday.' }); }
});
router.put('/communities/:guildId/roles/:groupId', async (req, res) => {
  const context = await memberFor(req, req.params.guildId);
  if (!context) return res.status(403).json({ error:'Community membership required.' });
  if (!Array.isArray(req.body?.options) || req.body.options.some(v => typeof v !== 'string')) return res.status(400).json({ error:'Invalid selection.' });
  try { await selectors.applyStandardSelection(context.guild, context.member, req.params.groupId, req.body.options); return res.json({ ok:true }); }
  catch (e) { return res.status(400).json({ error:e.message }); }
});
module.exports = router;