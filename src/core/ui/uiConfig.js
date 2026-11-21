const { EMOJIS: SHARED_EMOJIS } = require('./emojis');

module.exports = {
  COLORS: {
    PRIMARY: '#5865F2',
    SUCCESS: '#57F287',
    ERROR: '#ED4245',
    WARNING: '#FEE75C',

    // optional additions
    INFO: '#5865F2',
    NEUTRAL: '#2B2D31'
  },

  // Backward-compatible moderation UI mapping. Values live in ./emojis.js.
  EMOJIS: Object.freeze({ ...SHARED_EMOJIS, DASHBOARD: SHARED_EMOJIS.MODERATION_DASHBOARD })
};