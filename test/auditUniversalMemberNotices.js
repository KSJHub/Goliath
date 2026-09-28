'use strict';

const assert = require('node:assert/strict');
const {
  buildScheduleReminderNotice,
  buildVerificationNotice,
  buildPrivateRoomDecisionNotice,
  buildSecurityIncidentNotice,
} = require('../src/core/ui/systemNotices');

function fakeUser(id = '123456789012345678') {
  return {
    id,
    tag: 'Member#0001',
    username: 'Member',
    displayAvatarURL: () => null,
  };
}

function fakeGuild() {
  return {
    id: '111111111111111111',
    name: 'Goliath Test Guild',
    iconURL: () => null,
  };
}

function embedJson(payload) {
  assert(payload && typeof payload === 'object', 'notice payload must be an object');
  assert(Array.isArray(payload.embeds) && payload.embeds.length === 1, 'notice must contain one primary embed');
  const embed = payload.embeds[0];
  return typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
}

function fieldMap(embed) {
  return new Map((embed.fields || []).map((field) => [field.name, field.value]));
}

const guild = fakeGuild();
const user = fakeUser();

{
  const embed = embedJson(buildScheduleReminderNotice({
    guild,
    member: user,
    event: {
      eventId: 'evt_test',
      title: 'Community Night',
      startAt: new Date(Date.now() + 3600000).toISOString(),
      channelId: '222222222222222222',
      voiceChannelId: '333333333333333333',
      hostUserId: '444444444444444444',
      location: 'Gaming Lounge',
    },
    minutes: 60,
  }));
  assert.match(embed.title || '', /EVENT REMINDER/i);
  const fields = fieldMap(embed);
  assert(fields.has('📅 Event'));
  assert(fields.has('🕒 Starts'));
  assert(fields.has('⏰ Reminder'));
}

{
  const pending = embedJson(buildVerificationNotice({ guild, member: user, type: 'pending', roles: [{ id: '555555555555555555' }] }));
  assert.match(pending.title || '', /VERIFICATION REQUIRED/i);
  assert.match(JSON.stringify(pending), /Pending/i);

  const success = embedJson(buildVerificationNotice({ guild, member: user, type: 'success', roles: [{ id: '666666666666666666' }] }));
  assert.match(success.title || '', /VERIFICATION COMPLETE/i);
  assert.match(JSON.stringify(success), /Verified/i);

  const cooldown = embedJson(buildVerificationNotice({ guild, member: user, type: 'cooldown', values: { cooldownSeconds: 30 }, reason: 'Please wait before trying again.' }));
  assert.match(cooldown.title || '', /COOLDOWN/i);
  assert.match(JSON.stringify(cooldown), /30 second/i);
}

{
  const approved = embedJson(buildPrivateRoomDecisionNotice({
    guild,
    member: user,
    approved: true,
    request: { requestId: 'room_req_1', purpose: 'Squad practice', participantIds: ['777777777777777777'] },
    room: { channelId: '888888888888888888' },
  }));
  assert.match(approved.title || '', /PRIVATE ROOM APPROVED/i);
  assert.match(JSON.stringify(approved), /888888888888888888/);

  const denied = embedJson(buildPrivateRoomDecisionNotice({
    guild,
    member: user,
    approved: false,
    request: { requestId: 'room_req_2', purpose: 'Squad practice', reviewReason: 'Capacity unavailable.' },
  }));
  assert.match(denied.title || '', /PRIVATE ROOM DECLINED/i);
  assert.match(JSON.stringify(denied), /Capacity unavailable/i);
}

{
  const embed = embedJson(buildSecurityIncidentNotice({
    guild,
    owner: user,
    incident: {
      id: 'incident_1',
      type: 'mass_channel_delete',
      severity: 'critical',
      actorId: '999999999999999999',
      actorTag: 'BadActor#0001',
      actionTaken: 'lockdown=success; security-isolation=success',
      reason: 'Deletion threshold exceeded.',
    },
  }));
  assert.match(embed.title || '', /SECURITY INCIDENT DETECTED/i);
  assert.match(JSON.stringify(embed), /CRITICAL/i);
  assert.match(JSON.stringify(embed), /lockdown=success/i);
}

console.log('✅ Universal member notice contract audit passed.');
