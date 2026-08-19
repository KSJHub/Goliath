const { ActivityType } = require('discord.js');
const { normalizeBotMode } = require('../config/botModes');
const sentinelScheduler = require('../owner/sentinel/schedulerRegistry.js');

const STATUS_INTERVAL_MS = 180_000;
const STATUS_SCHEDULER_ID = 'runtime:status-rotation:global';

const DEV_ACTIVITIES = [
  { name: '🔵 DEV | Building Goliath', type: ActivityType.Watching },
  { name: '🧪 Testing New Modules', type: ActivityType.Playing },
  { name: '🛠️ KSJ Development Server', type: ActivityType.Watching },
  { name: '⚙️ Dashboard Changes', type: ActivityType.Watching },
  { name: '📊 Dashboard Online', type: ActivityType.Watching },
  { name: '🎟️ Ticket System Tests', type: ActivityType.Playing },
  { name: '📋 Forms Engine Tests', type: ActivityType.Watching },
  { name: '🌐 Translation Hub Tests', type: ActivityType.Competing },
  { name: '🔒 Security Center Checks', type: ActivityType.Watching },
  { name: '💾 Backup System Tests', type: ActivityType.Watching },
];

const BETA_ACTIVITIES = [
  { name: '🟡 BETA | Staging Goliath', type: ActivityType.Watching },
  { name: '🚧 Testing Upcoming Features', type: ActivityType.Playing },
  { name: '🔍 Watching Beta Feedback', type: ActivityType.Watching },
  { name: '⚡ Stability Testing', type: ActivityType.Competing },
  { name: '📊 Dashboard Online', type: ActivityType.Watching },
  { name: '🎟️ Validating Ticket Tools', type: ActivityType.Watching },
  { name: '📋 Reviewing Forms Flow', type: ActivityType.Watching },
  { name: '🌐 Testing Translation Hub', type: ActivityType.Competing },
  { name: '🛡️ Security Systems Online', type: ActivityType.Watching },
  { name: '💾 Backup Systems Ready', type: ActivityType.Watching },
];

function buildProductionActivities(client) {
  const guildCount = client.guilds.cache.size;
  const memberCount = client.guilds.cache
    .reduce((total, guild) => total + (guild.memberCount || 0), 0)
    .toLocaleString();

  return [
    { name: '🟢 Goliath | Protecting Servers', type: ActivityType.Watching },
    { name: `🛡️ Protecting ${guildCount} Servers`, type: ActivityType.Watching },
    { name: `👥 Watching ${memberCount} Members`, type: ActivityType.Watching },
    { name: '📊 Dashboard Online', type: ActivityType.Watching },
    { name: '🎟️ Managing Tickets', type: ActivityType.Playing },
    { name: '📋 Processing Forms', type: ActivityType.Watching },
    { name: '🔒 Monitoring Threats', type: ActivityType.Watching },
    { name: '🌐 Translation Hub Ready', type: ActivityType.Competing },
    { name: '🧰 Server Tools Online', type: ActivityType.Watching },
    { name: '💾 Backup Systems Ready', type: ActivityType.Watching },
    { name: '⚡ Powered by KSJ Digital', type: ActivityType.Watching },
    { name: '/help', type: ActivityType.Listening },
  ];
}

function buildActivities(client) {
  const mode = normalizeBotMode(client.botMode || process.env.BOT_MODE);

  if (mode === 'PRODUCTION') {
    return buildProductionActivities(client);
  }

  if (mode === 'BETA') {
    return BETA_ACTIVITIES;
  }

  return DEV_ACTIVITIES;
}

function startStatusRotation(client) {
  if (!client?.user) return;

  if (client.statusRotationInterval) {
    clearInterval(client.statusRotationInterval);
  }

  sentinelScheduler.register({
    id: STATUS_SCHEDULER_ID,
    module: 'runtime',
    component: 'status-rotation',
    intervalMs: STATUS_INTERVAL_MS,
    staleAfterMs: STATUS_INTERVAL_MS * 3,
    details: { mode: normalizeBotMode(client.botMode || process.env.BOT_MODE) },
  });

  const initialActivities = buildActivities(client);
  let index = Math.floor(Math.random() * initialActivities.length);
  let firstRotation = true;

  const rotate = async () => {
    try {
      const activities = firstRotation
        ? initialActivities
        : buildActivities(client);
      firstRotation = false;
      const activity = activities[index % activities.length];

      await client.user.setPresence({
        status: 'online',
        activities: [activity],
      });

      index += 1;
      sentinelScheduler.beat(STATUS_SCHEDULER_ID, {
        activity: activity.name,
        activityIndex: index,
      });
    } catch (error) {
      sentinelScheduler.fail(STATUS_SCHEDULER_ID, error);
      console.error('[STATUS] Failed to update presence:', error);
    }
  };

  rotate();

  client.statusRotationInterval = setInterval(rotate, STATUS_INTERVAL_MS);
  client.statusRotationInterval.unref?.();
}

module.exports = {
  startStatusRotation,
};
