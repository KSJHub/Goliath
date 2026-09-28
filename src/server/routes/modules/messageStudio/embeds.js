'use strict';

const express = require('express');

const router = express.Router();

// Legacy endpoint retained temporarily so the existing server mount remains safe.
// Embed Studio configuration is owned by the authenticated /api/modules/:guildId/embed-studio API.
// Repository-wide reference searches found no live consumer of /api/config/embeds.
router.use((req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Legacy embed configuration API has been retired.',
    code: 'EMBED_CONFIG_API_RETIRED',
  });
});

module.exports = router;
