'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const store = require('../../modules/socialStudio/socialAlerts/socialStudioStore');
const core = require('./socialStudioCreatorRoutingCompatCore');

const P = 'social:';
const PAGE_SIZE = 25;
const MAX_SELECTED_ROLES = 10;
const roleSessions = new Map();

function sessionKey(interaction) { return `${interaction.guildId}:${interaction.user?.id || 'unknown'}`; }
function getRoleSession(interaction) { return roleSessions.get(sessionKey(interaction)) || { rolePage: 0 }; }
function setRoleSession(interaction, patch) { const next = { ...getRoleSession(interaction), ...patch }; roleSessions.set(sessionKey(interaction), next); return next; }
function row(...components) { return new ActionRowBuilder().addComponents(...components); }
function button(id, label, disabled = false) { return new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(ButtonStyle.Secondary).setDisabled(disabled); }
function who(interaction) { return interaction.member?.displayName || interaction.user?.displayName || interaction.user?.username || 'Unknown User'; }
function sortedRoles(interaction) {
  return [...(interaction.guild?.roles?.cache?.values?.() || [])]
    .filter((role) => role && role.id !== interaction.guildId && !role.managed)
    .sort((a, b) => Number(b.position || 0) - Number(a.position || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'en-GB', { sensitivity: 'base' }));
}
function clampPage(page, pageCount) { return Math.max(0, Math.min(Number(page) || 0, Math.max(0, pageCount - 1))); }
function rolePageCount(interaction) { return Math.max(1, Math.ceil(sortedRoles(interaction).length / PAGE_SIZE)); }
function roleSelect(interaction, customId, placeholder, selectedIds, page) {
  const roles = sortedRoles(interaction);
  const pageCount = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const safePage = clampPage(page, pageCount);
  const pageRoles = roles.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const selected = new Set(Array.isArray(selectedIds) ? selectedIds : []);
  const menu = new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(`${placeholder} • page ${safePage + 1}/${pageCount}`).setMinValues(0).setMaxValues(Math.max(1, Math.min(MAX_SELECTED_ROLES, pageRoles.length || 1)));
  if (pageRoles.length) menu.addOptions(pageRoles.map((role) => ({ label: String(role.name || 'Unnamed role').slice(0, 100), value: role.id, description: `Hierarchy position ${role.position}`.slice(0, 100), default: selected.has(role.id) })));
  else menu.addOptions({ label: 'No selectable roles', value: '__none__', description: 'No non-managed server roles are available.', default: false }).setMinValues(1).setMaxValues(1).setDisabled(true);
  return { row: row(menu), page: safePage };
}
function notificationSelect(interaction, config) {
  const selected = config.notificationMentionMode === 'role' && config.notificationRoleId ? `role:${config.notificationRoleId}` : (config.notificationMentionMode || 'none');
  const roles = sortedRoles(interaction).slice(0, 22);
  return row(new StringSelectMenuBuilder().setCustomId(`${P}notification:mode`).setPlaceholder('Select LIVE notification target').setMinValues(1).setMaxValues(1).addOptions([
    ...roles.map((role) => ({ label: String(role.name || 'Unnamed role').slice(0, 100), value: `role:${role.id}`, description: `Hierarchy position ${role.position}`.slice(0, 100), default: selected === `role:${role.id}` })),
    { label: '@here', value: 'here', description: 'Ping currently online members.', default: selected === 'here' },
    { label: '@everyone', value: 'everyone', description: 'Ping everyone when a creator goes LIVE.', default: selected === 'everyone' },
    { label: 'No notification ping', value: 'none', description: 'Post alerts without pinging members.', default: selected === 'none' },
  ]));
}
function currentRoleNames(interaction, ids = []) {
  const cache = interaction.guild?.roles?.cache;
  const roles = ids.map((id) => cache?.get?.(id)).filter(Boolean).sort((a, b) => b.position - a.position);
  return roles.length ? roles.map((role) => `<@&${role.id}>`).join(', ') : 'None';
}
function rolePayload(interaction) {
  const config = store.getConfig(interaction.guildId);
  const state = getRoleSession(interaction);
  const pageCount = rolePageCount(interaction);
  const safePage = clampPage(state.rolePage, pageCount);
  const manager = roleSelect(interaction, `${P}roles:select`, 'Select Social Studio manager roles', config.managerRoleIds || [], safePage);
  const user = roleSelect(interaction, `${P}userroles:select`, 'Select Social Studio user access roles', config.userRoleIds || [], safePage);
  setRoleSession(interaction, { rolePage: safePage });
  const description = [
    '👥 **Manager roles**', `Current: ${currentRoleNames(interaction, config.managerRoleIds || [])}`, '',
    '👤 **User access roles**', `Current: ${(config.userRoleIds || []).length ? currentRoleNames(interaction, config.userRoleIds) : 'Everyone'}`, '',
    '📢 **LIVE Notification Target**', `Current: ${config.notificationMentionMode === 'role' && config.notificationRoleId ? `<@&${config.notificationRoleId}>` : config.notificationMentionMode === 'here' ? '@here' : config.notificationMentionMode === 'everyone' ? '@everyone' : 'No ping'}`, '',
    'Role menus are ordered by Discord hierarchy, highest role first.',
  ].join('\n');
  const navigation = [button(`${P}settings`, '⬅️ Back'), button(`${P}main`, '🏠 Social Studio')];
  if (pageCount > 1) navigation.push(button(`${P}roles:page:prev`, '⬅️ Previous', safePage <= 0), button(`${P}roles:page:next`, 'Next ➡️', safePage >= pageCount - 1));
  return { embeds: [new EmbedBuilder().setColor(config.enabled ? 0x5865F2 : 0x747F8D).setTitle('🔐 Permissions').setDescription(description).setFooter({ text: `Requested by ${who(interaction)}` }).setTimestamp()], components: [manager.row, user.row, notificationSelect(interaction, config), row(...navigation)] };
}
function save(interaction, config) { return store.saveConfig(interaction.guildId, config, { actorId: interaction.user?.id || null, guild: interaction.guild }); }
async function updateRoles(interaction) { const next = rolePayload(interaction); if (interaction.deferred || interaction.replied) await interaction.editReply(next); else await interaction.update(next); return true; }
function mergePageSelection(interaction, existingIds, selectedIds, page) {
  const roles = sortedRoles(interaction);
  const pageIds = new Set(roles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((role) => role.id));
  const next = new Set((existingIds || []).filter((id) => !pageIds.has(id)));
  for (const id of selectedIds || []) if (id !== '__none__') next.add(id);
  if (next.size > MAX_SELECTED_ROLES) throw new Error(`You can select up to ${MAX_SELECTED_ROLES} roles.`);
  return [...next];
}
async function handleRoleHierarchy(interaction) {
  const id = String(interaction?.customId || '');
  if (!interaction.guildId) return false;
  if (id === `${P}permissions`) { setRoleSession(interaction, { rolePage: 0 }); return updateRoles(interaction); }
  const state = getRoleSession(interaction);
  if (id === `${P}roles:page:prev` || id === `${P}roles:page:next`) {
    const delta = id.endsWith(':next') ? 1 : -1;
    setRoleSession(interaction, { rolePage: clampPage(state.rolePage + delta, rolePageCount(interaction)) });
    return updateRoles(interaction);
  }
  if (id === `${P}roles:select`) { const config = store.getConfig(interaction.guildId); config.managerRoleIds = mergePageSelection(interaction, config.managerRoleIds || [], interaction.values || [], state.rolePage); save(interaction, config); return updateRoles(interaction); }
  if (id === `${P}userroles:select`) { const config = store.getConfig(interaction.guildId); config.userRoleIds = mergePageSelection(interaction, config.userRoleIds || [], interaction.values || [], state.rolePage); save(interaction, config); return updateRoles(interaction); }
  if (id === `${P}notification:mode`) { const config = store.getConfig(interaction.guildId); const value = String(interaction.values?.[0] || 'none'); const roleId = value.startsWith('role:') ? value.slice(5) : null; config.notificationMentionMode = roleId ? 'role' : ['none', 'everyone', 'here'].includes(value) ? value : 'none'; config.notificationRoleId = roleId || null; save(interaction, config); return updateRoles(interaction); }
  if (id === `${P}notification:role`) { const config = store.getConfig(interaction.guildId); config.notificationRoleId = interaction.values?.[0] || null; config.notificationMentionMode = config.notificationRoleId ? 'role' : 'none'; save(interaction, config); return updateRoles(interaction); }
  return false;
}

async function handle(interaction) {
  if (!interaction) return false;
  if (await handleRoleHierarchy(interaction)) return true;
  if (await core.handle(interaction)) return true;
  return false;
}

module.exports = { handle };
