'use strict';

const TRIGGERS = Object.freeze({
  'form.submitted': {
    key: 'form.submitted',
    label: 'Form Submitted',
    module: 'forms',
    description: 'Runs when a Universal Form receives a submission.',
    variables: ['guildId', 'formId', 'submissionId', 'submitterId', 'status'],
  },
  'ticket.created': {
    key: 'ticket.created',
    label: 'Ticket Created',
    module: 'tickets',
    description: 'Runs when a ticket is created.',
    variables: ['guildId', 'ticketId', 'ticketType', 'creatorId', 'priority'],
  },
  'ticket.closed': {
    key: 'ticket.closed',
    label: 'Ticket Closed',
    module: 'tickets',
    description: 'Runs when a ticket is closed.',
    variables: ['guildId', 'ticketId', 'closedBy', 'reason', 'transcriptId'],
  },
  'member.joined': {
    key: 'member.joined',
    label: 'Member Joined',
    module: 'members',
    description: 'Runs when a member joins a guild.',
    variables: ['guildId', 'userId', 'username', 'memberCount'],
  },
  'member.left': {
    key: 'member.left',
    label: 'Member Left',
    module: 'members',
    description: 'Runs when a member leaves a guild.',
    variables: ['guildId', 'userId', 'username', 'memberCount'],
  },
  'translation.completed': {
    key: 'translation.completed',
    label: 'Translation Completed',
    module: 'translation',
    description: 'Runs when a translation completes.',
    variables: ['guildId', 'sourceLanguage', 'targetLanguage', 'provider', 'messageId'],
  },
  'verification.completed': {
    key: 'verification.completed',
    label: 'Verification Completed',
    module: 'verification',
    description: 'Runs when a user completes verification.',
    variables: ['guildId', 'userId', 'verifiedRoleId'],
  },
});

const ACTIONS = Object.freeze({
  'log.event': {
    key: 'log.event',
    label: 'Log Event',
    module: 'core',
    description: 'Writes an automation execution record only. Safe default action.',
    schema: { message: 'string' },
    safe: true,
  },
  'send.message': {
    key: 'send.message',
    label: 'Send Message',
    module: 'messages',
    description: 'Future action: send a plain message to a channel.',
    schema: { channelId: 'snowflake', message: 'string' },
    safe: false,
    disabled: true,
  },
  'send.embed': {
    key: 'send.embed',
    label: 'Send Embed',
    module: 'embedStudio',
    description: 'Future action: send an Embed Studio template.',
    schema: { channelId: 'snowflake', templateId: 'string' },
    safe: false,
    disabled: true,
  },
  'ticket.create': {
    key: 'ticket.create',
    label: 'Create Ticket',
    module: 'tickets',
    description: 'Future action: create a ticket from automation context.',
    schema: { type: 'string', title: 'string', priority: 'string' },
    safe: false,
    disabled: true,
  },
  'role.add': {
    key: 'role.add',
    label: 'Add Role',
    module: 'roles',
    description: 'Future action: add a role to a member.',
    schema: { userId: 'snowflake', roleId: 'snowflake' },
    safe: false,
    disabled: true,
  },
});

function listTriggers() {
  return Object.values(TRIGGERS);
}

function listActions() {
  return Object.values(ACTIONS);
}

function getTrigger(key) {
  return TRIGGERS[String(key || '').trim()] || null;
}

function getAction(key) {
  return ACTIONS[String(key || '').trim()] || null;
}

module.exports = {
  TRIGGERS,
  ACTIONS,
  listTriggers,
  listActions,
  getTrigger,
  getAction,
};
