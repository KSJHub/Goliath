'use strict';

// Pure, non-executable Discord rebuild blueprint planner.
// No Discord client, file/network I/O or write operations are used in this module.
const ID = /^\d{16,20}$/;
const CHANNEL_TYPES = Object.freeze({ text: 0, voice: 2, forum: 15, announcement: 5, stage: 13 });
const TYPES = new Set(Object.keys(CHANNEL_TYPES));
const MAX_CATEGORIES = 40;
const MAX_CHANNELS = 300;
const MAX_OPERATIONS = 350;

function assertString(value, label, limit) {
  if (typeof value !== 'string' || !value.trim() || value.length > limit ||
      /[\u0000-\u001f\u007f]/.test(value)) throw new Error(label + ' is invalid or too long.');
  return value.trim();
}
function parseBlueprint(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A blueprint object is required.');
  if (!Array.isArray(raw.categories) || raw.categories.length > MAX_CATEGORIES) {
    throw new Error('Blueprint must contain an array of up to 40 categories.');
  }
  if (raw.name !== undefined) assertString(raw.name, 'Blueprint name', 100);
  const ids = new Set();
  let count = 0;
  const categories = raw.categories.map((category, index) => {
    if (!category || typeof category !== 'object' || Array.isArray(category)) throw new Error('Invalid category at position ' + index);
    const name = assertString(category.name, 'Category name', 100);
    const id = category.id === undefined || category.id === null || category.id === ''
      ? null : String(category.id);
    if (id !== null && !ID.test(id)) throw new Error('Invalid category ID.');
    if (id) {
      if (ids.has(id)) throw new Error('Duplicate Discord ID in blueprint.');
      ids.add(id);
    }
    if (!Array.isArray(category.channels)) throw new Error('Every category must include a channels array.');
    if (category.channels.length > 50) throw new Error('A category may contain no more than 50 planned channels.');
    count += category.channels.length;
    if (count > MAX_CHANNELS) throw new Error('Blueprint exceeds 300 channels.');
    const categoryChannelNames = new Set();
    const channels = category.channels.map((channel) => {
      if (!channel || typeof channel !== 'object' || Array.isArray(channel)) throw new Error('Invalid channel.');
      const cname = assertString(channel.name, 'Channel name', 100);
      const type = channel.type || 'text';
      if (!TYPES.has(type)) throw new Error('Unsupported channel type: ' + String(type));
      const compositeName = cname.toLocaleLowerCase('en') + ':' + type;
      if (categoryChannelNames.has(compositeName)) {
        throw new Error('Duplicate channel name and type in category: ' + cname);
      }
      categoryChannelNames.add(compositeName);
      const cid = channel.id === undefined || channel.id === null || channel.id === ''
        ? null : String(channel.id);
      if (cid !== null && !ID.test(cid)) throw new Error('Invalid channel ID.');
      if (cid) {
        if (ids.has(cid)) throw new Error('Duplicate Discord ID in blueprint.');
        ids.add(cid);
      }
      return { id: cid, name: cname, type, discordType: CHANNEL_TYPES[type] };
    });
    return { id, name, channels };
  });
  return { name: raw.name ? raw.name.trim() : 'Untitled Discord rebuild blueprint', categories };
}
function toBlueprint(audit) {
  if (!audit || !Array.isArray(audit.channels)) throw new Error('Audit missing channels.');
  const categories = audit.channels.filter(item => item.type === 4).map(category => ({
    id: category.id, name: category.name, channels: audit.channels
      .filter(item => item.parentId === category.id && Object.values(CHANNEL_TYPES).includes(item.type))
      .map(item => ({
        id: item.id, name: item.name,
        type: Object.keys(CHANNEL_TYPES).find(key => CHANNEL_TYPES[key] === item.type) || 'text'
      }))
  }));
  return { name: audit.guild?.name ? audit.guild.name + ' rebuild' : 'Discord rebuild', categories };
}
function planBlueprint(audit, raw) {
  if (!audit?.guild?.id || !ID.test(String(audit.guild.id)) || !Array.isArray(audit.channels))
    throw new Error('A verified guild audit is required.');
  const blueprint = parseBlueprint(raw);
  const current = audit.channels;
  const byId = new Map(current.map(item => [String(item.id), item]));
  const existingCategories = current.filter(item => item.type === 4);
  const actions = [];
  const warnings = [];
  const plannedNames = new Set();
  const usedIds = new Set();
  const push = (action) => {
    if (actions.length >= MAX_OPERATIONS) throw new Error('Blueprint operations exceed safety limit.');
    actions.push(action);
  };
  for (const category of blueprint.categories) {
    let match = null;
    if (category.id) {
      match = byId.get(category.id);
      if (!match || match.type !== 4) throw new Error('Category ID not found in current guild: ' + category.id);
    } else {
      const same = existingCategories.filter(item => item.name === category.name);
      if (same.length > 1) throw new Error('Ambiguous existing category name: ' + category.name + '. Specify its ID.');
      match = same[0] || null;
    }
    const categoryKey = match ? match.id : 'new-category:' + category.name;
    if (plannedNames.has(categoryKey)) throw new Error('Blueprint selects a category twice: ' + category.name);
    plannedNames.add(categoryKey);
    if (match) {
      usedIds.add(match.id);
      if (match.name !== category.name)
        push({ kind: 'rename_category', risk: 'review', target: { id: match.id, name: match.name },
          before: { name: match.name }, after: { name: category.name }, executable: false });
    } else {
      push({ kind: 'create_category', risk: 'review', target: { name: category.name },
        before: null, after: { name: category.name, type: 4 }, executable: false });
    }
    for (const channel of category.channels) {
      let found = null;
      if (channel.id) {
        found = byId.get(channel.id);
        if (!found || found.type !== channel.discordType) throw new Error('Channel ID is absent or has a different type: ' + channel.id);
        if (usedIds.has(channel.id)) throw new Error('Blueprint references a channel twice.');
      } else if (match) {
        const same = current.filter(item =>
          item.parentId === match.id && item.name === channel.name && item.type === channel.discordType);
        if (same.length > 1) throw new Error('Ambiguous channel name: ' + channel.name + '. Specify its ID.');
        found = same[0] || null;
      } else {
        const matching = current.filter(item =>
          item.name === channel.name && item.type === channel.discordType);
        if (matching.length) warnings.push('A channel named "' + channel.name + '" already exists outside the new category. The preview does not move or delete it.');
      }
      if (found) {
        usedIds.add(found.id);
        const changed = {};
        const before = {};
        if (found.name !== channel.name) {
          before.name = found.name; changed.name = channel.name;
        }
        if (match && found.parentId !== match.id) {
          before.parentId = found.parentId; changed.parentId = match.id;
          warnings.push('Moving "' + found.name + '" may change its effective permissions. Review its overwrites before applying.');
        }
        if (!match && found.parentId) {
          warnings.push('Existing channel "' + found.name + '" is kept in place until its new category has been created and reviewed.');
        }
        if (Object.keys(changed).length) push({ kind: 'edit_channel', risk: 'review',
          target: { id: found.id, name: found.name }, before, after: changed, executable: false });
      } else {
        push({ kind: 'create_channel', risk: 'review',
          target: { name: channel.name }, before: null, after: {
            name: channel.name, type: channel.discordType,
            parentId: match?.id || null, parentName: category.name
          }, executable: false });
      }
    }
  }
  const newChannelCount = actions.filter(action =>
    action.kind === 'create_category' || action.kind === 'create_channel').length;
  if (current.length + newChannelCount > 500) {
    throw new Error('The proposed layout may exceed Discord\'s 500-channel guild limit.');
  }
  const untouched = current.filter(item => !usedIds.has(item.id));
  return {
    readOnly: true, executable: false,
    environment: audit.environment, guild: audit.guild,
    blueprintName: blueprint.name, basedOnAudit: audit.timestamp,
    generatedAt: new Date().toISOString(),
    operations: actions, operationCount: actions.length,
    untouchedCount: untouched.length,
    warnings: [...new Set(warnings)].slice(0, 100),
    notice: 'No Discord changes performed. Existing channels, roles, permissions and messages are preserved. This preview cannot be applied.'
  };
}
module.exports = { parseBlueprint, toBlueprint, planBlueprint };
