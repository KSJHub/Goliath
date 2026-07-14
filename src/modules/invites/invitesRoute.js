const express = require('express');
const store = require('./invitesStore');
const manager = require('./invitesManager');
const panel = require('./invitesPanel');

function createInvitesRouter(client) {
  const router = express.Router({ mergeParams: true });

  router.get('/', (req, res) => res.json(panel.getPanel(req.params.guildId)));

  router.put('/', (req, res) => {
    const allowed = ['enabled', 'channelId', 'autoRepair', 'trackingEnabled'];
    const patch = Object.fromEntries(allowed.filter(key => key in req.body).map(key => [key, req.body[key]]));
    res.json(store.set(req.params.guildId, patch));
  });

  router.post('/create', async (req, res, next) => {
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      const invite = await manager.create(guild, req.body.channelId);
      res.json({ code: invite.code, url: invite.url });
    } catch (error) { next(error); }
  });

  router.post('/regenerate', async (req, res, next) => {
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      const invite = await manager.regenerate(guild);
      res.json({ code: invite.code, url: invite.url });
    } catch (error) { next(error); }
  });

  router.post('/validate', async (req, res, next) => {
    try {
      const guild = await client.guilds.fetch(req.params.guildId);
      const result = await manager.validate(guild);
      res.json({ ...result, invite: result.invite ? { code: result.invite.code, url: result.invite.url } : null });
    } catch (error) { next(error); }
  });

  router.delete('/', (req, res) => {
    store.remove(req.params.guildId);
    res.status(204).end();
  });

  return router;
}

module.exports = createInvitesRouter;
