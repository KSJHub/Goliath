'use strict';

const { buildMemberNotice } = require('./memberNotice');
const { EMOJIS } = require('./emojis');

function clean(value, max = 1024) {
  return String(value ?? '').trim().slice(0, max);
}

function discordTime(value, style = 'F') {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'Unknown';
}

function buildScheduleReminderNotice({ guild, member, event, minutes } = {}) {
  const start = discordTime(event?.startAt, 'F');
  const relative = discordTime(event?.startAt, 'R');
  const fields = [
    { name: `${EMOJIS.DATE} Event`, value: clean(event?.title || 'Scheduled event'), inline: false },
    { name: `${EMOJIS.ROLE_CLOCK} Starts`, value: `${start}\n${relative}`, inline: true },
    { name: `${EMOJIS.UTILITY_ALARM} Reminder`, value: `${Number(minutes) || 0} minute${Number(minutes) === 1 ? '' : 's'} before`, inline: true },
  ];
  if (event?.location) fields.push({ name: `${EMOJIS.SOCIAL_CHANNEL_PIN} Location`, value: clean(event.location), inline: false });
  if (event?.channelId) fields.push({ name: `${EMOJIS.MESSAGES} Event Channel`, value: `<#${event.channelId}>`, inline: true });
  if (event?.voiceChannelId) fields.push({ name: `${EMOJIS.VOICE} Voice Channel`, value: `<#${event.voiceChannelId}>`, inline: true });
  if (event?.hostUserId) fields.push({ name: `${EMOJIS.USER} Host`, value: `<@${event.hostUserId}>`, inline: true });

  return buildMemberNotice(guild, {
    moduleName: 'Schedule',
    moduleEmoji: EMOJIS.UTILITY_ALARM,
    title: 'EVENT REMINDER',
    subtitle: 'Personal Schedule Reminder',
    color: Number(event?.color) || 0x5865f2,
    referenceLabel: 'Event',
    referenceValue: clean(event?.eventId || event?.id || event?.title || 'Scheduled Event', 100),
    status: `${EMOJIS.BELL} Upcoming`,
    member: member?.user || member,
    contextFields: fields,
    detailsTitle: `${EMOJIS.SOCIAL} YOUR REMINDER`,
    details: `**${clean(event?.title || 'Scheduled event', 200)}** starts ${relative} (${start}).`,
    meaning: 'You asked Goliath to remind you about this event based on your RSVP reminder settings.',
    nextSteps: 'No action is required. Use the event channel or voice channel above when it is time to join.',
    footerLabel: `Event ${clean(event?.eventId || event?.id || 'Reminder', 80)}`,
  });
}

function buildVerificationNotice({ guild, member, type, roles = [], reason = null, values = {} } = {}) {
  const variants = {
    pending: {
      emoji: EMOJIS.SECURITY, title: 'VERIFICATION REQUIRED', status: `${EMOJIS.ENV_BETA} Pending`, color: 0xfee75c,
      meaning: 'Your server access is currently in the verification stage.',
      next: 'Complete the active verification process in the server to unlock the access configured for verified members.',
    },
    success: {
      emoji: EMOJIS.SUCCESS, title: 'VERIFICATION COMPLETE', status: `${EMOJIS.ACTIVE} Verified`, color: 0x57f287,
      meaning: 'Goliath has completed your verification and confirmed the configured verified access.',
      next: 'You can return to the server and use the channels and features available to verified members.',
    },
    failed: {
      emoji: EMOJIS.ERROR, title: 'VERIFICATION FAILED', status: `${EMOJIS.STATUS_ALERT} Failed`, color: 0xed4245,
      meaning: 'Goliath could not complete this verification attempt.',
      next: 'Review the reason below and try again when the requirement has been resolved.',
    },
    cooldown: {
      emoji: EMOJIS.TIMER, title: 'VERIFICATION COOLDOWN', status: `${EMOJIS.SEVERITY_HIGH} Cooldown`, color: 0xfee75c,
      meaning: 'Another verification attempt cannot be made yet because the configured cooldown is active.',
      next: values.cooldownSeconds ? `Try again in approximately ${Number(values.cooldownSeconds)} seconds.` : 'Wait for the cooldown to expire, then use the active verification panel again.',
    },
    blocked: {
      emoji: EMOJIS.AUTOMOD_SPAM, title: 'VERIFICATION BLOCKED', status: `${EMOJIS.STATUS_ALERT} Blocked`, color: 0xed4245,
      meaning: 'A configured verification requirement is preventing this attempt from completing.',
      next: 'Review the requirement below. If it cannot be resolved, contact the server Management team.',
    },
  };
  const meta = variants[type] || variants.failed;
  const fields = [];
  if (roles.length) fields.push({ name: type === 'success' ? `${EMOJIS.SUCCESS} Verified Roles` : `${EMOJIS.SECURITY} Pending Roles`, value: roles.map((r) => r?.id ? `<@&${r.id}>` : clean(r, 100)).join(', ').slice(0, 1024), inline: false });
  if (values.minimumAccountAgeDays) fields.push({ name: `${EMOJIS.ROLE_CLOCK} Minimum Account Age`, value: `${values.minimumAccountAgeDays} day(s)`, inline: true });
  if (values.minimumMembershipAgeMinutes) fields.push({ name: `${EMOJIS.ROLE_CLOCK} Minimum Membership Age`, value: `${values.minimumMembershipAgeMinutes} minute(s)`, inline: true });
  if (values.cooldownSeconds) fields.push({ name: `${EMOJIS.TIMER} Cooldown Remaining`, value: `${values.cooldownSeconds} second(s)`, inline: true });

  return buildMemberNotice(guild, {
    moduleName: 'Verification',
    moduleEmoji: meta.emoji,
    title: meta.title,
    subtitle: 'Member Verification Notice',
    color: meta.color,
    referenceLabel: 'Member',
    referenceValue: member?.id || 'Unknown',
    status: meta.status,
    member: member?.user || member,
    contextFields: fields,
    detailsTitle: reason ? `${EMOJIS.CLIPBOARD} VERIFICATION DETAILS` : `${EMOJIS.SECURITY} VERIFICATION STATUS`,
    details: clean(reason || (type === 'success' ? 'Verification completed successfully.' : 'Your verification status has been updated.'), 1800),
    meaning: meta.meaning,
    nextSteps: meta.next,
    footerLabel: 'Goliath Verification',
  });
}

function buildPrivateRoomDecisionNotice({ guild, member, request, room, approved, reviewer } = {}) {
  const fields = [
    { name: `${EMOJIS.RISK} Purpose`, value: clean(request?.purpose || 'Private room request'), inline: false },
  ];
  if (request?.duration) fields.push({ name: `${EMOJIS.TIMER} Duration`, value: clean(request.duration), inline: true });
  const participants = Array.isArray(request?.participantIds) ? request.participantIds : Array.isArray(request?.participants) ? request.participants : [];
  if (participants.length) fields.push({ name: `${EMOJIS.MEMBERS} Participants`, value: participants.map((id) => `<@${id?.id || id}>`).join(', ').slice(0, 1024), inline: false });
  if (approved && room?.channelId) fields.push({ name: `${EMOJIS.HOME} Private Room`, value: `<#${room.channelId}>`, inline: true });

  return buildMemberNotice(guild, {
    moduleName: 'Private Rooms',
    moduleEmoji: approved ? EMOJIS.LOCK : EMOJIS.ERROR,
    title: approved ? 'PRIVATE ROOM APPROVED' : 'PRIVATE ROOM DECLINED',
    subtitle: 'Private Room Request Decision',
    color: approved ? 0x57f287 : 0xed4245,
    referenceLabel: 'Request',
    referenceValue: clean(request?.requestId || request?.id || 'Private Room', 100),
    status: approved ? `${EMOJIS.ACTIVE} Approved` : `${EMOJIS.STATUS_ALERT} Declined`,
    member: member?.user || member,
    contextFields: fields,
    reason: clean(request?.reviewReason || request?.reason || '', 1800) || undefined,
    reasonTitle: approved ? `${EMOJIS.NOTE} REQUEST CONTEXT` : `${EMOJIS.SECURITY} MANAGEMENT DECISION`,
    authority: reviewer || request?.reviewedBy || null,
    meaning: approved ? 'Management approved your Private Room request and Goliath has prepared the approved room.' : 'Management reviewed your Private Room request and decided not to approve it.',
    nextSteps: approved && room?.channelId ? `Your room is available at <#${room.channelId}>. Follow the server rules and any limits attached to the request.` : 'Review the decision reason above. If circumstances change, use the normal Private Rooms process for any future request.',
    footerLabel: `Private Room ${clean(request?.requestId || request?.id || 'Request', 80)}`,
  });
}

function buildSecurityIncidentNotice({ guild, owner, incident } = {}) {
  const severity = clean(incident?.severity || 'unknown', 40).toUpperCase();
  const fields = [
    { name: `${EMOJIS.ISOLATION} Incident`, value: `\`${clean(incident?.type || 'unknown', 100)}\``, inline: true },
    { name: `${EMOJIS.WARNING} Severity`, value: `\`${severity}\``, inline: true },
    { name: `${EMOJIS.USER} Actor`, value: `${clean(incident?.actorTag || 'Unknown', 100)}${incident?.actorId ? ` (<@${incident.actorId}>)` : ''}`, inline: false },
    { name: `${EMOJIS.SECURITY} Automatic Response`, value: clean(incident?.actionTaken || 'Logged only', 1024), inline: false },
  ];
  if (incident?.targetName || incident?.targetId) fields.push({ name: `${EMOJIS.RISK} Target`, value: clean(incident.targetName || incident.targetId, 1024), inline: false });

  return buildMemberNotice(guild, {
    moduleName: 'Security',
    moduleEmoji: EMOJIS.ISOLATION,
    title: 'SECURITY INCIDENT DETECTED',
    subtitle: 'Goliath Anti-Nuke Owner Alert',
    color: String(incident?.severity).toLowerCase() === 'critical' ? 0xed4245 : 0xfee75c,
    referenceLabel: 'Incident',
    referenceValue: clean(incident?.id || incident?.type || 'Security Incident', 100),
    status: `${EMOJIS.ISOLATION} ${severity}`,
    member: owner?.user || owner,
    contextFields: fields,
    detailsTitle: `${EMOJIS.PERMISSIONS} INCIDENT DETAILS`,
    details: clean(incident?.reason || 'Goliath detected activity that met the Anti-Nuke incident threshold.', 1800),
    meaning: 'Goliath detected and recorded a server security incident. The automatic response shown above reflects the protections that were attempted or applied.',
    nextSteps: 'Review the server security logs and affected resources. Confirm the server is stable before reversing any automatic protection.',
    footerLabel: 'Goliath Anti-Nuke',
  });
}

function buildScheduleWaitlistPromotionNotice({ guild, member, event } = {}) {
  const start = discordTime(event?.startAt, 'F');
  const relative = discordTime(event?.startAt, 'R');
  const fields = [
    { name: `${EMOJIS.DATE} Event`, value: clean(event?.title || 'Scheduled event'), inline: false },
    { name: `${EMOJIS.ROLE_CLOCK} Starts`, value: `${start}\n${relative}`, inline: true },
  ];

  if (event?.location) {
    fields.push({
      name: `${EMOJIS.SOCIAL_CHANNEL_PIN} Location`,
      value: clean(event.location),
      inline: false,
    });
  }

  if (event?.channelId) {
    fields.push({
      name: `${EMOJIS.MESSAGES} Event Channel`,
      value: `<#${event.channelId}>`,
      inline: true,
    });
  }

  if (event?.voiceChannelId) {
    fields.push({
      name: `${EMOJIS.VOICE} Voice Channel`,
      value: `<#${event.voiceChannelId}>`,
      inline: true,
    });
  }

  return buildMemberNotice(guild, {
    moduleName: 'Schedule',
    moduleEmoji: EMOJIS.SUCCESS,
    title: 'WAITLIST PROMOTION',
    subtitle: 'Schedule RSVP Update',
    color: Number(event?.color) || 0x57f287,
    referenceLabel: 'Event',
    referenceValue: clean(
      event?.eventId || event?.id || event?.title || 'Scheduled Event',
      100,
    ),
    status: `${EMOJIS.ACTIVE} Place Confirmed`,
    member: member?.user || member,
    contextFields: fields,
    detailsTitle: `${EMOJIS.PREMIUM_TICKET} YOUR PLACE IS AVAILABLE`,
    details: `A place opened up for **${clean(event?.title || 'this event', 200)}** and you have been promoted from the waitlist.`,
    meaning: 'Your RSVP has automatically moved from the waitlist into an attending position because a place became available.',
    nextSteps: 'No action is required unless your plans have changed. Review the event details above and update your RSVP if you can no longer attend.',
    footerLabel: `Event ${clean(event?.eventId || event?.id || 'Waitlist', 80)}`,
  });
}

function buildInviteUsedNotice({ guild, inviter, member, score = 0 } = {}) {
  const joinedMember = member?.user || member;

  return buildMemberNotice(guild, {
    moduleName: 'Invites',
    moduleEmoji: EMOJIS.USER_GIVEAWAYS,
    title: 'YOUR INVITE WAS USED',
    subtitle: 'Invite Studio Notification',
    color: 0x57f287,
    referenceLabel: 'Member',
    referenceValue: joinedMember?.id || member?.id || 'Unknown',
    status: `${EMOJIS.ACTIVE} Joined`,
    member: inviter?.user || inviter,
    contextFields: [
      {
        name: `${EMOJIS.USER} New Member`,
        value: joinedMember?.id
          ? `<@${joinedMember.id}>`
          : clean(joinedMember?.tag || 'Unknown member', 100),
        inline: true,
      },
      {
        name: `${EMOJIS.USER_LEVELING} Current Score`,
        value: String(Number(score) || 0),
        inline: true,
      },
    ],
    detailsTitle: `${EMOJIS.USER_GIVEAWAYS} INVITE ACTIVITY`,
    details: `**${clean(joinedMember?.tag || joinedMember?.username || joinedMember?.id || 'A member', 200)}** joined **${clean(guild?.name || 'the server', 200)}** using your invite.`,
    meaning: 'Goliath detected a successful join attributed to one of your tracked invites.',
    nextSteps: 'No action is required. Your Invite Studio statistics have been updated automatically.',
    footerLabel: 'Goliath Invite Studio',
  });
}
module.exports = {
  buildScheduleReminderNotice,
  buildVerificationNotice,
  buildPrivateRoomDecisionNotice,
  buildSecurityIncidentNotice,
  buildScheduleWaitlistPromotionNotice,
  buildInviteUsedNotice
};
