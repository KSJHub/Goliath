const express = require('express');

const guildManager = require('../../../../core/guild/guildManager');
const { emitGuildUpdate } = require('../../../sockets/socketHub');

const router = express.Router();

function getBody(req) {
  return req.body && typeof req.body === 'object' ? req.body : {};
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeUrl(value) {
  const url = normalizeText(value);

  if (!url) return '';

  if (!/^https?:\/\//i.test(url)) {
    return '';
  }

  return url;
}

function normalizeHexColor(value) {
  const color = normalizeText(value);

  if (!color) return '';

  const withHash = color.startsWith('#') ? color : `#${color}`;

  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) {
    return '';
  }

  return withHash.toUpperCase();
}

function getDefaultEmbedConfig() {
  return {
    defaultTitle: '',
    footerText: '',
    footerIcon: '',
    color: '',
  };
}

function normalizeEmbedConfig(config = {}) {
  const safeConfig =
    config && typeof config === 'object' && !Array.isArray(config)
      ? config
      : {};

  return {
    ...getDefaultEmbedConfig(),
    defaultTitle: normalizeText(safeConfig.defaultTitle),
    footerText: normalizeText(safeConfig.footerText),
    footerIcon: normalizeUrl(safeConfig.footerIcon),
    color: normalizeHexColor(safeConfig.color),
  };
}

router.get('/:guildId', (req, res) => {
  try {
    const { guildId } = req.params;

    if (!guildId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing guild ID.',
      });
    }

    const current = guildManager.getGuildSection(
      guildId,
      'embeds',
      getDefaultEmbedConfig()
    );

    const config = normalizeEmbedConfig(current);

    return res.json({
      ok: true,
      guildId,
      config,
    });
  } catch (error) {
    console.error('Embeds load failed:', error);

    return res.status(500).json({
      ok: false,
      error: 'Failed to load embed config.',
      message: error.message,
    });
  }
});

router.post('/:guildId', (req, res) => {
  try {
    const { guildId } = req.params;
    const body = getBody(req);

    if (!guildId) {
      return res.status(400).json({
        ok: false,
        error: 'Missing guild ID.',
      });
    }

    const current = normalizeEmbedConfig(
      guildManager.getGuildSection(
        guildId,
        'embeds',
        getDefaultEmbedConfig()
      )
    );

    const payload = normalizeEmbedConfig({
      ...current,
      defaultTitle: body.defaultTitle,
      footerText: body.footerText,
      footerIcon: body.footerIcon,
      color: body.color,
    });

    const config = guildManager.saveGuildSection(
      guildId,
      'embeds',
      payload
    );

    emitGuildUpdate(guildId, {
      section: 'embeds',
      data: config,
    });

    return res.json({
      ok: true,
      guildId,
      config,
    });
  } catch (error) {
    console.error('Embeds save failed:', error);

    return res.status(500).json({
      ok: false,
      error: 'Failed to save embed config.',
      message: error.message,
    });
  }
});

module.exports = router;
