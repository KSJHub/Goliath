'use strict';

const {
  ActionRowBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GuildChannel,
  GuildChannelManager,
  PermissionFlagsBits,
  PermissionOverwriteManager,
  PermissionsBitField,
  Role,
} = require('discord.js');
const { navigationButton } = require('../../../core/guild/goliathNavigation');
const core = require('./core');
const selective = require('./selective');
const history = require('./history');

const BOOTSTRAP_KEY = Symbol.for('goliath.duplicator.bridge-bootstrap');
const OVERWRITE_PATCH_KEY = Symbol.for('goliath.duplicator.permission-overwrite-per-target');
const CHANNEL_CREATE_PATCH_KEY = Symbol.for('goliath.duplicator.channel-create-compat');
const CHANNEL_DELETE_PATCH_KEY = Symbol.for('goliath.duplicator.channel-delete-recovery');
const ROLE_ORDER_PATCH_KEY = Symbol.for('goliath.duplicator.role-order');
const SNAPSHOT_PATCH_KEY = Symbol.for('goliath.duplicator.snapshot-bot-role-remap');
const roleOrderState = new WeakMap();

function duplicatorReason(value) {
  return String(value || '').startsWith('Goliath duplicator:');
}

function temporaryBotOverwrite(guild) {
  const botId = guild?.client?.user?.id;
  const me = guild?.members?.me;
  if (!botId || !me) return null;
  let allow = 0n;
  for (const bit of [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]) {
    if (me.permissions?.has(bit)) allow |= bit;
  }
  return allow ? { id: botId, type: 1, allow, deny: 0n } : null;
}

function overwriteOptions(item) {
  const options = {};
  let allowNames = [];
  let denyNames = [];
  try { allowNames = new PermissionsBitField(BigInt(item.allow || 0)).toArray(); } catch {}
  try { denyNames = new PermissionsBitField(BigInt(item.deny || 0)).toArray(); } catch {}
  for (const name of allowNames) options[name] = true;
  for (const name of denyNames) options[name] = false;
  return options;
}

function isSourceControlPlaneRole(role, botRoleIds) {
  if (!role || !botRoleIds?.has?.(role.id)) return false;
  return /(^|\W)(?:goliath|operations)($|\W)/i.test(String(role.name || ''));
}

// Snapshot correction for local-source copies. Bot/operator ACLs are runtime control-plane
// permissions, not portable server content. Carrying them to another environment can deny
// the destination Goliath its own ManageChannels/ManageRoles access and strand copied
// channels. Goliath/Operations roles assigned to the source bot are control-plane roles:
// never copy their base permissions and never carry their channel overwrites.
if (!core[SNAPSHOT_PATCH_KEY]) {
  const originalSnapshot = core.snapshot.bind(core);
  Object.defineProperty(core, SNAPSHOT_PATCH_KEY, { value: true });
  core.snapshot = function goliathDuplicatorSnapshot(guild, selectedOptions) {
    const snap = originalSnapshot(guild, selectedOptions);
    const sourceBot = guild.members.me;
    const sourceBotId = guild.client.user?.id || null;
    const botRoleIds = new Set(sourceBot?.roles?.cache?.keys?.() || []);
    const pseudoManaged = [];

    snap.roles = (snap.roles || []).filter((role) => {
      if (!isSourceControlPlaneRole(role, botRoleIds)) return true;
      pseudoManaged.push({
        ...role,
        managed: true,
        tags: { botId: sourceBotId, integrationId: null, subscriptionListingId: null },
        remapOnly: true,
        controlPlane: true,
      });
      return false;
    });

    const managedById = new Map((snap.managedRoles || []).map((role) => [role.id, role]));
    for (const role of pseudoManaged) managedById.set(role.id, role);
    snap.managedRoles = [...managedById.values()];

    const operatorRoleIds = new Set(pseudoManaged.map((role) => String(role.id)));
    if (operatorRoleIds.size || sourceBotId) {
      snap.channels = (snap.channels || []).map((channel) => ({
        ...channel,
        permissionOverwrites: (channel.permissionOverwrites || []).filter((overwrite) => {
          const type = Number(overwrite.type);
          const id = String(overwrite.id);
          if (type === 0 && operatorRoleIds.has(id)) return false;
          if (type === 1 && sourceBotId && id === String(sourceBotId)) return false;
          return true;
        }),
      }));
    }

    if (snap.stats) {
      snap.stats.roles = snap.roles.length;
      snap.stats.managedRoles = snap.managedRoles.length;
      snap.stats.permissionOverwrites = (snap.channels || []).reduce((sum, channel) => sum + (channel.permissionOverwrites || []).length, 0);
    }
    return snap;
  };
}

selective.configure(core);

if (!Client.prototype[BOOTSTRAP_KEY]) {
  const originalLogin = Client.prototype.login;
  Object.defineProperty(Client.prototype, BOOTSTRAP_KEY, { value: true });
  Client.prototype.login = function goliathDuplicatorLogin(...args) {
    core.initializeBridge(this);
    return originalLogin.apply(this, args);
  };
}

// Structure creation stays permission-neutral. Exact permission reconstruction happens
// only after roles/categories/channels exist and source IDs can be mapped safely.
if (GuildChannelManager?.prototype?.create && !GuildChannelManager.prototype[CHANNEL_CREATE_PATCH_KEY]) {
  const originalCreate = GuildChannelManager.prototype.create;
  Object.defineProperty(GuildChannelManager.prototype, CHANNEL_CREATE_PATCH_KEY, { value: true });
  GuildChannelManager.prototype.create = async function goliathDuplicatorChannelCreate(options = {}) {
    if (!duplicatorReason(options.reason)) return originalCreate.call(this, options);

    const guild = this.guild;
    const payload = { ...options };
    const hasCommunity = new Set(guild?.features || []).has('COMMUNITY');

    if (!hasCommunity) {
      if (payload.type === ChannelType.GuildStageVoice) payload.type = ChannelType.GuildVoice;
      else if ([ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(payload.type)) payload.type = ChannelType.GuildText;
    }

    if (payload.type === ChannelType.GuildStageVoice) delete payload.userLimit;
    delete payload.permissionOverwrites;

    try {
      return await originalCreate.call(this, payload);
    } catch (error) {
      if (![50024, 50035].includes(Number(error?.code))) throw error;

      let fallbackType = payload.type;
      if (fallbackType === ChannelType.GuildStageVoice) fallbackType = ChannelType.GuildVoice;
      else if ([ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(fallbackType)) fallbackType = ChannelType.GuildText;

      const minimal = { name: payload.name, type: fallbackType, reason: payload.reason };
      if (payload.parent) minimal.parent = payload.parent;
      if (fallbackType === ChannelType.GuildVoice) {
        if (payload.bitrate) minimal.bitrate = payload.bitrate;
        if (payload.rtcRegion) minimal.rtcRegion = payload.rtcRegion;
      }
      return originalCreate.call(this, minimal);
    }
  };
}

// Bulk Delete recovery. A delete is treated as safe only when Goliath can both see the
// target and manage channels there. If those effective permissions are missing, try to
// repair Goliath's own member overwrite using existing Manage Roles access. Administrator
// is never requested or enabled by this path.
if (GuildChannel?.prototype?.delete && !GuildChannel.prototype[CHANNEL_DELETE_PATCH_KEY]) {
  const originalDelete = GuildChannel.prototype.delete;
  Object.defineProperty(GuildChannel.prototype, CHANNEL_DELETE_PATCH_KEY, { value: true });
  GuildChannel.prototype.delete = async function goliathDuplicatorBulkDelete(reason) {
    const reasonText = String(reason || '');
    if (!reasonText.startsWith('Goliath Duplicator bulk delete by')) {
      return originalDelete.call(this, reason);
    }

    const guild = this.guild;
    const me = guild?.members?.me;
    if (!guild || !me) return originalDelete.call(this, reason);

    const administrator = Boolean(me.permissions?.has(PermissionFlagsBits.Administrator));
    let effective = this.permissionsFor?.(me) || me.permissions;
    let canView = administrator || Boolean(effective?.has(PermissionFlagsBits.ViewChannel));
    let canManage = administrator || Boolean(effective?.has(PermissionFlagsBits.ManageChannels));
    let canDelete = canView && canManage;

    if (!canDelete) {
      const canRepair = Boolean(effective?.has(PermissionFlagsBits.ManageRoles))
        || Boolean(me.permissions?.has(PermissionFlagsBits.ManageRoles));
      if (canRepair && this.permissionOverwrites?.edit) {
        try {
          await this.permissionOverwrites.edit(me, {
            ViewChannel: true,
            ManageChannels: true,
            ManageRoles: true,
          }, `Goliath Duplicator bulk delete access repair by ${me.id}`);
        } catch (error) {
          const wrapped = new Error(
            `Missing Access on ${this.name}. Goliath could not repair its own channel overwrite. ` +
            'Allow View Channel + Manage Channels for Goliath (or its bot-only Operations role) on this channel/category, then retry. Administrator is not required.',
          );
          wrapped.code = Number(error?.code) || 50001;
          throw wrapped;
        }

        const refreshed = await guild.channels.fetch(this.id).catch(() => null);
        effective = refreshed?.permissionsFor?.(me) || this.permissionsFor?.(me) || me.permissions;
        canView = administrator || Boolean(effective?.has(PermissionFlagsBits.ViewChannel));
        canManage = administrator || Boolean(effective?.has(PermissionFlagsBits.ManageChannels));
        canDelete = canView && canManage;
      }
    }

    if (!canDelete) {
      const missing = [
        !canView ? 'View Channel' : null,
        !canManage ? 'Manage Channels' : null,
      ].filter(Boolean).join(' + ');
      const error = new Error(
        `Cannot delete ${this.name}: Goliath is missing ${missing || 'required channel access'}. ` +
        'Allow View Channel + Manage Channels for Goliath (or its bot-only Operations role) on the target/category, then retry. Administrator is not required.',
      );
      error.code = 50013;
      throw error;
    }

    return originalDelete.call(this, reason);
  };
}

// Preserve copied roles as a contiguous source-ordered block below Goliath's highest
// manageable role instead of reusing meaningless absolute positions from another guild.
if (Role?.prototype?.setPosition && !Role.prototype[ROLE_ORDER_PATCH_KEY]) {
  const originalSetPosition = Role.prototype.setPosition;
  Object.defineProperty(Role.prototype, ROLE_ORDER_PATCH_KEY, { value: true });
  Role.prototype.setPosition = async function goliathDuplicatorRoleOrder(position, reason) {
    if (String(reason || '') !== 'Goliath duplicator: role order') {
      return originalSetPosition.call(this, position, reason);
    }

    const guild = this.guild;
    const now = Date.now();
    let state = roleOrderState.get(guild);
    if (!state || now - state.lastTouch > 2500) state = { entries: new Map(), lastTouch: now };
    state.lastTouch = now;
    state.entries.set(this.id, { role: this, sourcePosition: Number(position || 0) });
    roleOrderState.set(guild, state);

    const ordered = [...state.entries.values()]
      .filter((entry) => guild.roles.cache.has(entry.role.id))
      .sort((a, b) => a.sourcePosition - b.sourcePosition);
    const botHighest = Number(guild.members.me?.roles?.highest?.position || 1);
    const top = Math.max(1, botHighest - 1);
    const start = Math.max(1, top - ordered.length + 1);

    for (let index = 0; index < ordered.length; index += 1) {
      const target = Math.min(top, start + index);
      await originalSetPosition.call(ordered[index].role, target, 'Goliath duplicator: relative role order');
    }
    return this;
  };
}

// Rebuild source overwrites without replacing a child channel's inherited category
// permissions with the temporary bot member. The destination bot member is always treated
// as protected control-plane state: source snapshots may never replace/deny that member,
// including snapshots received through another Goliath environment's bridge.
if (PermissionOverwriteManager?.prototype?.set && !PermissionOverwriteManager.prototype[OVERWRITE_PATCH_KEY]) {
  const originalSet = PermissionOverwriteManager.prototype.set;
  Object.defineProperty(PermissionOverwriteManager.prototype, OVERWRITE_PATCH_KEY, { value: true });
  PermissionOverwriteManager.prototype.set = async function goliathDuplicatorPermissionSet(overwrites, reason) {
    const reasonText = String(reason || '');
    const channel = this.channel;
    const isDuplicatorTransfer = reasonText.startsWith('Goliath duplicator: least-privilege channel/category permissions') || reasonText.startsWith('Goliath duplicator: exact channel/category permissions');
    if (!isDuplicatorTransfer || !channel?.guild) return originalSet.call(this, overwrites, reason);

    const guild = channel.guild;
    const botOverwrite = temporaryBotOverwrite(guild);
    const botId = guild.client.user?.id;
    if (!botId || !botOverwrite) {
      const error = new Error(`Destination control-plane protection unavailable on ${channel.name}: Goliath lacks the base permissions needed to retain channel access.`);
      error.code = 'DUPLICATOR_CONTROL_PLANE_UNAVAILABLE';
      throw error;
    }

    // Never trust a portable snapshot to define the destination bot member's ACL. This is
    // deliberately enforced here as well as at snapshot time because remote bridge snapshots
    // are produced inside another process/environment.
    const expected = (Array.isArray(overwrites) ? [...overwrites] : [...(overwrites || [])])
      .filter((item) => !(Number(item.type) === 1 && String(item.id) === String(botId)));
    const expectedIds = new Set(expected.map((item) => String(item.id)));
    const failures = [];

    const upsertExplicit = async (item, targetReason) => {
      const options = overwriteOptions(item);
      if (typeof this.upsert === 'function') {
        return this.upsert(item.id, options, { type: Number(item.type), reason: targetReason });
      }
      return this.edit(item.id, options, targetReason);
    };

    // Establish destination control access before any restrictive source overwrite is applied.
    await upsertExplicit(botOverwrite, 'Goliath duplicator: establish destination control-plane access');

    const ordered = [...expected].sort((a, b) => {
      const aEveryone = String(a.id) === String(guild.id);
      const bEveryone = String(b.id) === String(guild.id);
      if (aEveryone !== bEveryone) return aEveryone ? 1 : -1;
      return Number(a.type) - Number(b.type);
    });

    for (const item of ordered) {
      try {
        await upsertExplicit(item, `Goliath duplicator: mapped overwrite ${item.id}`);
      } catch (error) {
        failures.push({ id: String(item.id), code: Number(error?.code) || null, message: error?.message || String(error) });
      }
    }

    const refreshed = await guild.channels.fetch(channel.id).catch(() => null);
    const cache = refreshed?.permissionOverwrites?.cache || channel.permissionOverwrites?.cache;
    if (cache) {
      for (const overwrite of cache.values()) {
        const id = String(overwrite.id);
        if (expectedIds.has(id) || id === String(botId)) continue;
        try {
          await channel.permissionOverwrites.delete(id, 'Goliath duplicator: remove non-source overwrite');
        } catch (error) {
          failures.push({ id, code: Number(error?.code) || null, message: `Cleanup failed: ${error?.message || String(error)}` });
        }
      }
    }

    // Re-assert the control-plane overwrite after all source ACLs, then verify effective
    // permissions. A copy is not allowed to report permission success while Goliath is locked out.
    try {
      await upsertExplicit(botOverwrite, 'Goliath duplicator: retain destination control-plane access');
      const verified = await guild.channels.fetch(channel.id).catch(() => null);
      const me = guild.members.me;
      const effective = verified?.permissionsFor?.(me);
      const canView = Boolean(effective?.has(PermissionFlagsBits.ViewChannel));
      const canManage = Boolean(effective?.has(PermissionFlagsBits.ManageChannels));
      if (!verified || !canView || !canManage) {
        throw new Error(`effective access verification failed (ViewChannel=${canView}, ManageChannels=${canManage})`);
      }
    } catch (error) {
      failures.push({ id: String(botId), code: Number(error?.code) || null, message: `Destination control-plane verification failed: ${error?.message || String(error)}` });
    }

    if (failures.length) {
      const details = failures.slice(0, 8).map((item) => `${item.id}${item.code ? ` [${item.code}]` : ''}: ${item.message}`).join('; ');
      const error = new Error(`Permission targets failed on ${channel.name}: ${details}`);
      error.code = failures.find((item) => item.code)?.code || 'DUPLICATOR_PERMISSION_TARGETS';
      throw error;
    }

    return channel.permissionOverwrites;
  };
}

function installRunningState(interaction) {
  const customId = String(interaction?.customId || '');
  if (!customId.startsWith('dupselect:')) return;
  const isCopy = customId.endsWith(':copy-now');
  const isDelete = customId.endsWith(':delete-now') || customId.includes(':delete-manifest-now:');
  if (!isCopy && !isDelete) return;
  if (typeof interaction.deferUpdate !== 'function' || typeof interaction.update !== 'function') return;

  const originalDeferUpdate = interaction.deferUpdate.bind(interaction);
  interaction.deferUpdate = async function goliathDuplicatorRunningUpdate() {
    try {
      if (isDelete) {
        return await interaction.update({
          embeds: [new EmbedBuilder()
            .setColor(0xf59e0b)
            .setTitle('⏳ Bulk Delete Running')
            .setDescription([
              'Goliath accepted the confirmation and is checking access before deleting the selected channels/categories.',
              '',
              '**Stages:** Resolve targets → Permission preflight/repair → Delete channels → Delete categories → Verify → Save history',
              '',
              'The confirmation controls have been removed so the delete cannot be started twice. The final result will replace this message.',
            ].join('\n'))
            .setTimestamp()],
          components: [],
        });
      }

      return await interaction.update({
        embeds: [new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('🔄 Selective Copy Running')
          .setDescription([
            'Goliath is applying this transfer now.',
            '',
            '**Stages:** Roles → Role Order → Categories → Channels → Exact Per-Target Category/Channel Permissions → Verification → Transfer Manifest',
            '',
            'The confirmation controls have been removed so this transfer cannot be started twice. The result will replace this message when the copy finishes.',
          ].join('\n'))
          .setTimestamp()],
        components: [],
      });
    } catch {
      return originalDeferUpdate();
    }
  };
}

function bulkDeleteFailureDetails(interaction) {
  const entries = history.list(interaction.guild?.id, 5);
  const latest = entries.find((item) => item.type === 'bulk-delete');
  if (!latest || !(latest.failed || []).length) return null;
  const failures = latest.failed || [];
  const permissionFailures = failures.filter((item) => /permission|ManageChannels|View Channel|Missing Access|50001|50013/i.test(String(item.error || ''))).length;
  const lines = failures.slice(0, 6).map((item) => `• **${item.name || item.id}** — ${item.error || 'Delete failed'}`);
  const sessionId = String(interaction.customId || '').split(':')[1] || '';
  return {
    embeds: [new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('❌ Bulk Delete Failed')
      .setDescription([
        `Deleted **${latest.deletedCount || 0}/${latest.requestedCount || 0}** requested objects.`,
        `Already missing: **${latest.missing?.length || 0}**`,
        `Failed: **${failures.length}**`,
        permissionFailures ? `Permission-blocked: **${permissionFailures}**` : null,
        '',
        '**Why:**',
        ...lines,
        failures.length > 6 ? `…and ${failures.length - 6} more.` : null,
        '',
        permissionFailures ? '**Fix:** Allow **View Channel + Manage Channels** for Goliath (or its bot-only Operations role) on the blocked category/channel, then retry. **Administrator is not required and Bulk Delete will not request it.**' : null,
        `History record: \`${latest.id}\``,
      ].filter(Boolean).join('\n'))
      .setTimestamp()],
    components: sessionId ? [new ActionRowBuilder().addComponents(
      navigationButton(`dupselect:${sessionId}:home`, 'Back to Duplicator', ButtonStyle.Secondary),
    )] : [],
  };
}

async function run(interaction) {
  const action = interaction?.options?.getString?.('action', true);
  if (action === 'copy') return selective.startCopy(interaction);
  return core.run(interaction);
}

async function handleInteraction(interaction) {
  installRunningState(interaction);
  const isBulkDeleteNow = Boolean(interaction?.customId?.startsWith('dupselect:') && interaction.customId.endsWith(':delete-now'));
  if (await selective.handleInteraction(interaction)) {
    if (isBulkDeleteNow) {
      const details = bulkDeleteFailureDetails(interaction);
      if (details && (interaction.deferred || interaction.replied)) await interaction.editReply(details).catch(() => null);
    }
    return true;
  }
  return core.handleInteraction(interaction);
}

module.exports = { ...core, run, handleInteraction, selective };
