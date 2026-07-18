'use strict';

const DEFAULT_INVITE_TEMPLATES = Object.freeze({
  publicPanel: Object.freeze({
    title: '🌍 Join Our Community',
    description: 'Use our official server invite below, or create your own personal link to compete on the leaderboard.',
    color: '#5865F2',
    footer: 'Leaderboard refreshes automatically every 2 hours',
    buttonLabel: 'Join Server',
  }),
  memberInviteDM: Object.freeze({
    dmTitle: '🔗 Your personal invite for {server}',
    dmMessage: 'Share this link with friends. Every valid join counts towards your Invite Studio score.\n\n{invite}',
  }),
});

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeInviteTemplates(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    publicPanel: {
      ...clone(DEFAULT_INVITE_TEMPLATES.publicPanel),
      ...(isPlainObject(source.publicPanel) ? clone(source.publicPanel) : {}),
    },
    memberInviteDM: {
      ...clone(DEFAULT_INVITE_TEMPLATES.memberInviteDM),
      ...(isPlainObject(source.memberInviteDM) ? clone(source.memberInviteDM) : {}),
    },
  };
}

function prepareInviteSection(sectionData = {}, meta = {}) {
  const section = isPlainObject(sectionData) ? clone(sectionData) : {};
  const settings = isPlainObject(section.settings) ? section.settings : {};
  const templates = normalizeInviteTemplates(settings.templates);
  const nextSettings = {
    ...settings,
    templates,
  };

  if (meta?.action === 'invite_admin_use_default_panel') {
    nextSettings.publicPanel = {
      ...(isPlainObject(settings.publicPanel) ? settings.publicPanel : {}),
      ...clone(templates.publicPanel),
    };
    nextSettings.memberInviteTemplate = {
      ...(isPlainObject(settings.memberInviteTemplate) ? settings.memberInviteTemplate : {}),
      ...clone(templates.memberInviteDM),
    };
  }

  return {
    ...section,
    settings: nextSettings,
  };
}

module.exports = {
  DEFAULT_INVITE_TEMPLATES,
  normalizeInviteTemplates,
  prepareInviteSection,
};
