'use strict';

const { Events } = require('discord.js');
const sentinel = require('../../owner/sentinel/eventPipeline');

function userState(user) {
  return user ? { id: user.id, username: user.username || null, globalName: user.globalName || null, bot: Boolean(user.bot), avatar: user.avatar || null } : null;
}
function stageState(stage) {
  return stage ? { id: stage.id, guildId: stage.guildId, channelId: stage.channelId, topic: stage.topic || null, privacyLevel: stage.privacyLevel, discoverableDisabled: stage.discoverableDisabled } : null;
}
function safe(client, input) {
  return sentinel.captureEvent(client, input).catch((error) => console.warn('[Sentinel] supplemental event capture failed:', error?.message || error));
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    // Events already comprehensively collected by Audit Intelligence are not
    // repeated here. This listener fills gateway gaps; the installed Sentinel
    // boundary stamps/routs the existing collector as well.
    client.on(Events.MessageCreate, (message) => {
      if (!message?.guild || message.author?.bot) return;
      safe(client, {
        type: 'message.create', category: 'messages', action: 'create', title: 'Message Created', icon: '💬',
        guild: message.guild, channel: message.channel, user: message.author,
        target: { id: message.id, label: `Message ${message.id}` },
        after: { id: message.id, content: message.content || null, authorId: message.author.id, channelId: message.channelId, attachments: message.attachments?.size || 0 },
      });
    });

    client.on(Events.MessageReactionRemoveAll, (message, reactions) => {
      if (!message?.guild) return;
      safe(client, {
        type: 'reaction.clear', category: 'messages', action: 'delete', title: 'Message Reactions Cleared', icon: '🧹',
        guild: message.guild, channel: message.channel, target: { id: message.id, label: `Message ${message.id}` },
        metadata: { reactionCount: reactions?.size || 0 },
      });
    });

    client.on(Events.MessageReactionRemoveEmoji, (reaction) => {
      const message = reaction?.message;
      if (!message?.guild) return;
      safe(client, {
        type: 'reaction.emojiClear', category: 'messages', action: 'delete', title: 'Emoji Reactions Cleared', icon: '🧹',
        guild: message.guild, channel: message.channel, target: { id: message.id, label: `Message ${message.id}` },
        metadata: { emoji: reaction.emoji?.name || null, emojiId: reaction.emoji?.id || null, count: reaction.count || 0 },
      });
    });

    client.on(Events.GuildIntegrationsUpdate, (guild) => safe(client, {
      type: 'guild.integrationsUpdate', category: 'guild', action: 'update', title: 'Guild Integrations Updated', icon: '🔌', guild,
      target: { id: guild.id, label: guild.name },
    }));

    client.on(Events.StageInstanceCreate, (stage) => safe(client, {
      type: 'stage.create', category: 'voice', action: 'create', title: 'Stage Created', icon: '🎙️', guild: stage.guild,
      channel: stage.channel || null, target: { id: stage.id, label: stage.topic || 'Stage' }, after: stageState(stage),
    }));
    client.on(Events.StageInstanceUpdate, (before, after) => safe(client, {
      type: 'stage.update', category: 'voice', action: 'update', title: 'Stage Updated', icon: '🎙️', guild: after.guild,
      channel: after.channel || null, target: { id: after.id, label: after.topic || 'Stage' }, before: stageState(before), after: stageState(after),
    }));
    client.on(Events.StageInstanceDelete, (stage) => safe(client, {
      type: 'stage.delete', category: 'voice', action: 'delete', title: 'Stage Deleted', icon: '🎙️', guild: stage.guild,
      channel: stage.channel || null, target: { id: stage.id, label: stage.topic || 'Stage' }, before: stageState(stage),
    }));

    client.on(Events.ThreadMembersUpdate, (added, removed, thread) => {
      if (!thread?.guild) return;
      safe(client, {
        type: 'thread.members', category: 'guild', action: 'update', title: 'Thread Membership Updated', icon: '🧵',
        guild: thread.guild, channel: thread,
        target: { id: thread.id, label: thread.name },
        metadata: { added: [...(added?.keys?.() || [])], removed: [...(removed?.keys?.() || [])] },
      });
    });

    client.on(Events.UserUpdate, (before, after) => {
      for (const guild of client.guilds.cache.values()) {
        if (!guild.members.cache.has(after.id)) continue;
        safe(client, {
          type: 'user.update', category: 'members', action: 'update', title: 'User Profile Updated', icon: '👤', guild,
          user: after, target: { id: after.id, label: after.tag || after.username }, before: userState(before), after: userState(after),
        });
      }
    });
  },
};
