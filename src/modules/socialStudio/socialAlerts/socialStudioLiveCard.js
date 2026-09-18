'use strict';

function clean(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}

function intText(value) {
  return Number.isFinite(Number(value)) ? Number(value).toLocaleString('en-GB') : '';
}

function livePlatformField(account, event, liveStatus) {
  const platform = String(account?.platform || '').toLowerCase();
  const username = clean(event?.kickUsername || account?.username, 100).replace(/^@/, '');
  if (platform === 'tiktok') return { name: '⚫ TikTok', value: username ? `@${username}` : (liveStatus === 'OFFLINE' ? 'TikTok' : 'TikTok LIVE'), inline: true };
  const labels = { twitch: ['🟣', 'Twitch'], youtube: ['🔴', 'YouTube'], kick: ['🟢', 'Kick'], facebook: ['🔵', 'Facebook'], instagram: ['🟠', 'Instagram'], x: ['⚪', 'X'] };
  const meta = labels[platform];
  if (!meta) return null;
  return { name: `${meta[0]} ${meta[1]}`, value: username ? `@${username}` : meta[1], inline: true };
}

function buildLiveFields({ account, event, vars, liveStatus, durationText, started, ended }) {
  const fields = [];
  const offline = liveStatus === 'OFFLINE';
  const platform = String(account?.platform || '').toLowerCase();
  if (platform !== 'tiktok' && (event.category || event.game)) fields.push({ name: '🎮 Game', value: clean(event.category || event.game, 1024), inline: true });
  const platformField = livePlatformField(account, event, liveStatus);
  if (platformField) fields.push(platformField);

  if (offline) {
    const peak = Number(account?.state?.peakViewers || vars.peakViewers || event.viewerCount || 0);
    if (peak > 0) fields.push({ name: '📈 Peak Viewers', value: intText(peak), inline: true });
    if (started) fields.push({ name: '🕐 Started', value: started, inline: true });
    if (durationText) fields.push({ name: '⏱️ Streamed For', value: durationText, inline: true });
    if (ended) fields.push({ name: '⚫ Ended', value: ended, inline: true });
    return fields;
  }

  if (vars.viewers) fields.push({ name: '👥 Viewers', value: vars.viewers, inline: true });
  if (started) fields.push({ name: '🕐 Started', value: started, inline: true });
  if (durationText) fields.push({ name: '⏱️ Live For', value: durationText, inline: true });
  if (event.language) fields.push({ name: '🌐 Language', value: clean(String(event.language).toUpperCase(), 100), inline: true });
  if (event.hasMatureContent === true) fields.push({ name: '🔞 Mature', value: 'Yes', inline: true });
  return fields;
}

module.exports = { buildLiveFields, livePlatformField };
