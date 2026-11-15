'use strict';
// Pure advisory check; no Discord API calls, no permission grants, no restore operations.
const MANAGE_CHANNELS = 1n << 4n;
const ADMINISTRATOR = 1n << 3n;
const SNOWFLAKE = /^\d{16,20}$/;
function flag(raw, bit) {
  try { const bits = BigInt(raw); return (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & bit) === bit; }
  catch { return false; }
}
function buildCapabilityPreflight({ audit, operations, capability }) {
  if (!audit?.guild?.id || !SNOWFLAKE.test(String(audit.guild.id)) ||
      !Array.isArray(operations) || operations.length > 350) throw new Error('Valid target audit and bounded operations required.');
  const guildMatch = !!capability && capability.guildId === audit.guild.id &&
    capability.environment === audit.environment && capability.readOnly === true;
  const ready = guildMatch && capability.botPresent === true &&
    typeof capability.guildPermissions === 'string' && /^\d+$/.test(capability.guildPermissions);
  const manageGuildChannels = ready && flag(capability.guildPermissions, MANAGE_CHANNELS);
  const channelPermissions = new Map((ready && Array.isArray(capability.channelPermissions) ? capability.channelPermissions : [])
    .filter(c => SNOWFLAKE.test(String(c.id || '')) && /^\d+$/.test(String(c.permissions || '')))
    .map(c => [c.id, c.permissions]));
  if (!Array.isArray(audit.channels) || audit.channels.length > 500 ||
      audit.channels.some(c => !SNOWFLAKE.test(String(c?.id || ''))))
    throw new Error('A bounded, valid channel inventory is required.');
  const channelMap = new Map(audit.channels.map(c => [c.id, c]));
  if (channelMap.size !== audit.channels.length) throw new Error('Duplicate channel IDs in audit.');
  const knownKinds = new Set(['create_category', 'create_channel', 'rename_category', 'edit_channel']);
  const items = operations.map((operation, index) => {
    const targetId = operation.target?.id || null;
    const current = targetId ? channelMap.get(targetId) : null;
    const type = operation.kind;
    const warnings = [];
    let permission = 'unknown';
    if (!knownKinds.has(type)) {
      permission = 'blocked';
      warnings.push('Unsupported operation type; no execution path permitted.');
    } else if (!ready) {
      warnings.push('Could not verify the bot member and permissions in the selected environment.');
    } else if (!manageGuildChannels) {
      permission = 'blocked';
      warnings.push('Goliath lacks Manage Channels at guild scope; further channel-specific checks may still be required.');
    } else if (targetId && !current) {
      permission = 'blocked';
      warnings.push('Operation target no longer exists in the guild audit.');
    } else if ((type === 'rename_category' && (!current || current.type !== 4)) ||
               (type === 'edit_channel' && (!current || current.type === 4)) ||
               ((type === 'create_category' || type === 'create_channel') && targetId)) {
      permission = 'blocked';
      warnings.push('Operation target is missing, has the wrong Discord type, or a create operation supplies an existing target.');
    } else {
      permission = 'permitted-in-principle';
      if (targetId) {
        const raw = channelPermissions.get(targetId);
        if (raw === undefined) {
          permission = 'unknown';
          warnings.push('Effective channel permissions are not available; must refresh before any write.');
        } else if (!flag(raw, MANAGE_CHANNELS)) {
          permission = 'blocked';
          warnings.push('Goliath lacks effective Manage Channels on this channel.');
        }
      }
      if (type === 'create_category' && operation.after?.type !== 4) {
        permission = 'blocked';
        warnings.push('A new category must use Discord category type 4.');
      }
      if (type === 'create_channel' && ![0, 2, 5, 13, 15, 16].includes(operation.after?.type)) {
        permission = 'blocked';
        warnings.push('Unsupported Discord channel type for a new channel.');
      }
      if (type === 'create_channel') {
        const parentId = operation.after?.parentId;
        if (parentId && (!channelMap.has(parentId) || channelMap.get(parentId).type !== 4)) {
          permission = 'blocked';
          warnings.push('Channel parent must be an existing category.');
        } else if (parentId && !channelPermissions.has(parentId)) {
          if (permission !== 'blocked') permission = 'unknown';
          warnings.push('Bot permissions for the destination category must be checked.');
        } else if (parentId && !flag(channelPermissions.get(parentId), MANAGE_CHANNELS)) {
          permission = 'blocked';
          warnings.push('Bot lacks Manage Channels on the destination category.');
        } else if (!parentId && operation.after?.parentName) {
          if (permission !== 'blocked') permission = 'unknown';
          warnings.push('Proposed new category is not created yet. Parent linkage requires runtime verification.');
        }
      }
      if (type === 'edit_channel' && operation.after?.parentId) {
        const parent = channelMap.get(operation.after.parentId);
        if (!parent || parent.type !== 4) {
          permission = 'blocked';
          warnings.push('Proposed destination must be an existing category.');
        } else if (!channelPermissions.has(parent.id)) {
          if (permission !== 'blocked') permission = 'unknown';
          warnings.push('Effective permissions on the destination category must be refreshed.');
        } else if (!flag(channelPermissions.get(parent.id), MANAGE_CHANNELS)) {
          permission = 'blocked';
          warnings.push('Goliath lacks Manage Channels on the destination category.');
        }
      }
    }
    if (type === 'edit_channel' && operation.after?.parentId !== undefined)
      warnings.push('Moving a channel can change effective visibility and staff access.');
    let recovery = 'Manual reconstruction required; no verified rollback procedure attached.';
    if (type === 'rename_category' || type === 'edit_channel')
      recovery = 'Record original fields, then re-check state before a compensating edit; not yet implemented.';
    if (type === 'create_category' || type === 'create_channel')
      recovery = 'A compensating delete would be destructive if messages or configuration were added; not yet implemented.';
    return {
      sequence: index + 1, kind: type, target: operation.target || null,
      permission, warnings, recovery,
      risk: operation.risk || 'review', executable: false
    };
  });
  return {
    readOnly: true, executable: false, environment: audit.environment, guildId: audit.guild.id,
    botIdentity: ready ? capability.botId : null,
    permissionsVerified: ready,
    guildManageChannels: manageGuildChannels,
    operations: items,
    counts: {
      permittedInPrinciple: items.filter(i => i.permission === 'permitted-in-principle').length,
      blocked: items.filter(i => i.permission === 'blocked').length,
      unknown: items.filter(i => i.permission === 'unknown').length
    },
    rollbackVerified: false, canExecute: false,
    notice: 'Read-only permission estimation, not a guarantee of Discord API success. Rollback is not implemented.'
  };
}
module.exports = { buildCapabilityPreflight };
