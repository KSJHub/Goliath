'use strict';

const express = require('express');
const guildManager = require('../../../../core/guild/guildManager');
const emojiApi = require('../../../../modules/utilityStudio/emojis/emojisApi');
const emojis = require('../../../../modules/utilityStudio/emojis/emojis');
const emojiStore = require('../../../../modules/utilityStudio/emojis/emojisStore');

const router = express.Router();
const ok = (res, payload = {}) => res.json({ success: true, ...payload });
const fail = (res, error, status = 400) => res.status(error?.statusCode || status).json({ success: false, error: error?.message || 'Emoji request failed.' });

function guildId(req) {
  const id = String(req.params.guildId || '').trim();
  if (!/^\d{16,20}$/.test(id)) throw new Error('Invalid guild ID.');
  return id;
}

function actor(req) {
  return String(req.session?.user?.id || req.body?.actorId || '').trim() || null;
}

function client(req) {
  return req.client || req.app?.get?.('goliath.client') || null;
}

async function payload(req, id) {
  return { guildId: id, ...(await emojis.overview(client(req), id)), source: 'Discord application emojis' };
}

router.get('/:guildId/overview', async (req, res) => { try { return ok(res, await payload(req, guildId(req))); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/enabled', async (req, res) => { try { const id = guildId(req); guildManager.setModuleEnabled(id, 'emojis', req.body?.enabled === true, { actorId: actor(req), action: 'emoji_panel_toggle' }); return ok(res, await payload(req, id)); } catch (error) { return fail(res, error); } });
router.get('/:guildId/search', async (req, res) => { try { return ok(res, { results: await emojiApi.search(req.query?.q || '', Number(req.query?.limit) || 25) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/catalog', async (req, res) => { try { const id = guildId(req); return ok(res, { results: await emojis.catalog(client(req), id, req.query?.q || '', { category: req.query?.category, tag: req.query?.tag }) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/picker', async (req, res) => { try { const id = guildId(req); return ok(res, await emojis.picker(client(req), id, req.query?.q || '', req.query?.context || 'dashboard')); } catch (error) { return fail(res, error); } });
router.get('/:guildId/suggest', async (req, res) => { try { const id = guildId(req); return ok(res, { suggestions: await emojis.suggest(client(req), id, req.query?.q || '', req.query?.context || 'dashboard', Number(req.query?.limit) || 25) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/analytics', async (req, res) => { try { return ok(res, { analytics: await emojis.analytics(client(req)) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/health', async (req, res) => { try { const id = guildId(req); return ok(res, { health: await emojis.health(client(req), id) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/cleanup', async (req, res) => { try { const id = guildId(req); return ok(res, { candidates: await emojis.cleanupCandidates(client(req), emojiStore.getSection(id).cleanup.unusedDays) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/duplicates', async (req, res) => { try { return ok(res, { duplicates: await emojis.duplicates(client(req)) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/dependencies/:emojiId', async (req, res) => { try { guildId(req); return ok(res, { dependency: await emojis.dependencies(client(req), req.params.emojiId) }); } catch (error) { return fail(res, error); } });
router.get('/:guildId/export', async (req, res) => { try { const id = guildId(req); return ok(res, { config: emojis.exportGuildConfig(id) }); } catch (error) { return fail(res, error); } });
router.post('/:guildId/import-config', async (req, res) => { try { const id = guildId(req); const section = emojis.importGuildConfig(id, req.body?.config || req.body, { actorId: actor(req), action: 'emoji_config_import' }); return ok(res, { section, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.post('/:guildId/import', async (req, res) => { try { const id = guildId(req); if (!emojiStore.getSection(id).enabled) throw new Error('Emoji Studio is disabled for this server.'); const result = await emojis.importFromEmojiGG(client(req), req.body?.emojiGgId, req.body?.name || null); if (req.body?.selectForGuild !== false) emojiStore.setFavourite(id, result.emoji.id, true, { actorId: actor(req), action: 'emoji_panel_import' }); return ok(res, { result, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.post('/:guildId/import-url', async (req, res) => { try { const id = guildId(req); if (!emojiStore.getSection(id).enabled) throw new Error('Emoji Studio is disabled for this server.'); const result = await emojis.importFromUrl(client(req), req.body?.imageUrl, req.body?.name || null); if (req.body?.selectForGuild !== false) emojiStore.setFavourite(id, result.emoji.id, true, { actorId: actor(req), action: 'emoji_url_import' }); return ok(res, { result, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/favourites/:emojiId', async (req, res) => { try { const id = guildId(req); emojiStore.setFavourite(id, req.params.emojiId, req.body?.selected !== false, { actorId: actor(req), action: 'emoji_favourite' }); return ok(res, await payload(req, id)); } catch (error) { return fail(res, error); } });
router.put('/:guildId/aliases/:alias', async (req, res) => { try { const id = guildId(req); return ok(res, { section: emojiStore.setAlias(id, req.params.alias, req.body?.emojiId, { actorId: actor(req), action: 'emoji_alias_set' }) }); } catch (error) { return fail(res, error); } });
router.delete('/:guildId/aliases/:alias', async (req, res) => { try { const id = guildId(req); return ok(res, { section: emojiStore.removeAlias(id, req.params.alias, { actorId: actor(req), action: 'emoji_alias_remove' }) }); } catch (error) { return fail(res, error); } });
router.put('/:guildId/tags/:emojiId', async (req, res) => { try { const id = guildId(req); return ok(res, { section: emojiStore.setTags(id, req.params.emojiId, req.body?.tags || [], { actorId: actor(req), action: 'emoji_tags_set' }) }); } catch (error) { return fail(res, error); } });
router.put('/:guildId/packs/:packKey', async (req, res) => { try { const id = guildId(req); return ok(res, { section: emojiStore.savePack(id, req.params.packKey, req.body || {}, { actorId: actor(req), action: 'emoji_pack_save' }) }); } catch (error) { return fail(res, error); } });
router.delete('/:guildId/packs/:packKey', async (req, res) => { try { const id = guildId(req); return ok(res, { section: emojiStore.deletePack(id, req.params.packKey, { actorId: actor(req), action: 'emoji_pack_delete' }) }); } catch (error) { return fail(res, error); } });
router.put('/:guildId/temporary/:emojiId', async (req, res) => { try { const id = guildId(req); return ok(res, { section: emojiStore.setTemporary(id, req.params.emojiId, req.body?.expiresAt, req.body?.removeWhenUnused !== false, { actorId: actor(req), action: 'emoji_temporary_set' }) }); } catch (error) { return fail(res, error); } });
router.patch('/:guildId/bank/:emojiId', async (req, res) => { try { const id = guildId(req); const emoji = await emojis.renameInBank(client(req), req.params.emojiId, req.body?.name); return ok(res, { emoji, ...(await payload(req, id)) }); } catch (error) { return fail(res, error); } });
router.delete('/:guildId/bank/:emojiId', async (req, res) => { try { const id = guildId(req); await emojis.removeFromBank(client(req), req.params.emojiId); return ok(res, await payload(req, id)); } catch (error) { return fail(res, error); } });

module.exports = router;
