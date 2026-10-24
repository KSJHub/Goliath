'use strict';
const express = require('express');
const { PermissionFlagsBits } = require('discord.js');
const security = require('../../../../core/security/protection/core');
const freeGames = require('../../../../modules/utilityStudio/freeGames/freeGames');
const monitor = require('../../../../modules/utilityStudio/freeGames/freeGamesMonitor');
const { STORES, TYPES, CURRENCIES, getOffers, getPricing } = require('../../../../modules/utilityStudio/freeGames/freeGamesProviders');
const router = express.Router();
router.use('/:guildId', async (req, res, next) => {
  try {
    const userId = String(req.session?.user?.id || '');
    if (!/^\d{16,20}$/.test(userId)) return res.status(401).json({ success: false, error: 'Authentication required.' });
    if (!/^\d{16,20}$/.test(req.params.guildId)) throw new Error('Invalid guild ID.');
    const client = req.client || req.app?.locals?.client;
    const guild = client?.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(403).json({ success: false, error: 'Server unavailable in this environment.' });
    if (!security.isBotOwner(userId)) {
      const member = await guild.members.fetch(userId);
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) return res.status(403).json({ success: false, error: 'Manage Server permission is required.' });
    }
    req.freeGamesGuild = guild;
    next();
  } catch { res.status(403).json({ success: false, error: 'Unable to verify server access.' }); }
});
router.get('/:guildId', async (req, res) => {
  try {
    const guild = req.freeGamesGuild;
    await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
    return res.json({ success: true, config: freeGames.getConfig(guild.id), stores: STORES, types: TYPES, currencies: CURRENCIES, timeZones: Intl.supportedValuesOf('timeZone'), channels: [...guild.channels.cache.values()].filter((channel) => [0, 5].includes(channel.type)).map(({ id, name, type }) => ({ id, name, type })), roles: [...guild.roles.cache.values()].filter((role) => role.id !== guild.id && !role.managed).map(({ id, name }) => ({ id, name })) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
router.post('/:guildId/preview', async (req, res) => {
  try {
    const previous = freeGames.getConfig(req.freeGamesGuild.id);
    const config = { ...previous, ...freeGames.validateSettings(req.body || {}, previous) };
    const feed = await getOffers();
    const pricing = await getPricing(config);
    const offers = freeGames.filterOffers(feed.offers, config);
    const { buildListing, SECTIONS, shortTitle, price } = require('../../../../modules/utilityStudio/freeGames/freeGamesEmbeds');
    return res.json({ success: true, offers: offers.map((offer) => ({ ...offer, displayTitle: shortTitle(offer.title), priceText: price(offer, { ...config, pricing }).replace(/[~\\]/g, '').trim() })), sections: SECTIONS.map(({ title, types }) => ({ title, types })), pricing, fetchedAt: feed.fetchedAt, pages: buildListing(offers, { ...config, pricing }) });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
router.patch('/:guildId', async (req, res) => {
  try {
    const guild = req.freeGamesGuild;
    const config = await monitor.withGuildLock(guild.id, async () => {
      const previous = freeGames.getConfig(guild.id);
      const patch = freeGames.validateSettings(req.body || {}, previous);
      const proposed = { ...previous, ...patch };
      if (proposed.enabled) await monitor.validateDestination(guild, proposed);
      return freeGames.saveSettings(guild.id, patch);
    });
    return res.json({ success: true, config });
  } catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
router.post('/:guildId/refresh', async (req, res) => {
  try { return res.json({ success: true, result: await monitor.processGuild(req.freeGamesGuild), config: freeGames.getConfig(req.freeGamesGuild.id) }); }
  catch (error) { res.status(400).json({ success: false, error: error.message }); }
});
module.exports = router;
