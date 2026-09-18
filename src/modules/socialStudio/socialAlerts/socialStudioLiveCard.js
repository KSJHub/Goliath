'use strict';

const PLATFORM_FIELDS = Object.freeze({
  twitch: ['🟣', 'Twitch'],
  youtube: ['🔴', 'YouTube'],
  tiktok: ['⚫', 'TikTok'],
  kick: ['🟢', 'Kick'],
  facebook: ['🔵', 'Facebook'],
  instagram: ['🟠', 'Instagram'],
  x: ['⚪', 'X'],
});

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function intText(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : '';
}

function livePlatformField(account, event, liveStatus) {
  const platform = String(account?.platform || '').toLowerCase();
  const meta = PLATFORM_FIELDS[platform];
  if (!meta) return null;

  const username = clean(
    event?.kickUsername || event?.username || account?.username,
    100,
  ).replace(/^@/, '');

  let value = username ? `@${username}` : meta[1];
  if (platform === 'tiktok' && !username && liveStatus !== 'OFFLINE') value = 'TikTok LIVE';

  return {
    name: `${meta[0]} ${meta[1]}`,
    value,
    inline: true,
  };
}

function buildLiveFields({ account, event, vars = {}, liveStatus, durationText, started, ended }) {
  const fields = [];
  const offline = liveStatus === 'OFFLINE';
  const platform = String(account?.platform || '').toLowerCase();

  // Locked LIVE-card row 1: Game | Platform | Viewers/Peak Viewers.
  if (platform !== 'tiktok' && (event?.category || event?.game)) {
    fields.push({
      name: '🎮 Game',
      value: clean(event.category || event.game, 1024),
      inline: true,
    });
  }

  const platformField = livePlatformField(account, event, liveStatus);
  if (platformField) fields.push(platformField);

  if (offline) {
    const peak = Number(
      account?.state?.peakViewers ||
      vars.peakViewers ||
      event?.viewerCount ||
      0,
    );
    if (peak > 0) fields.push({ name: '📈 Peak Viewers', value: intText(peak), inline: true });
  } else if (vars.viewers) {
    fields.push({ name: '👥 Viewers', value: clean(vars.viewers, 1024), inline: true });
  }

  // Locked LIVE-card row 2: Started | Live For/Streamed For | Language/Ended.
  if (started) fields.push({ name: '🕐 Started', value: started, inline: true });

  if (durationText) {
    fields.push({
      name: offline ? '⏱️ Streamed For' : '⏱️ Live For',
      value: durationText,
      inline: true,
    });
  }

  if (offline) {
    if (ended) fields.push({ name: '⚫ Ended', value: ended, inline: true });
  } else if (event?.language) {
    fields.push({
      name: '🌐 Language',
      value: clean(String(event.language).toUpperCase(), 100),
      inline: true,
    });
  }

  // Provider metadata that does not belong in the locked 3x2 core grid follows it.
  if (!offline && event?.hasMatureContent === true) {
    fields.push({ name: '🔞 Mature', value: 'Yes', inline: true });
  }

  return fields;
}

module.exports = {
  PLATFORM_FIELDS,
  buildLiveFields,
  livePlatformField,
};
