'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const PAGE_SIZE = 25;
function rolePages(guild, selected = [], page = 0) {
  const roles = [...(guild?.roles?.cache?.values?.() || [])]
    .filter(role => role.id !== guild.id && !role.managed)
    .sort((a, b) => b.position - a.position || a.id.localeCompare(b.id));
  const selectedIds = new Set(selected.map(String));
  const count = Math.max(1, Math.ceil(roles.length / PAGE_SIZE));
  const current = Math.max(0, Math.min(Number.isSafeInteger(page) ? page : 0, count - 1));
  return { roles: roles.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), all: roles,
    selectedIds, page: current, pages: count };
}
function rolePager(prefix, page, pages) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}:prev`).setLabel('◀ Roles').setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`${prefix}:next`).setLabel('Roles ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1),
  );
}
function rolePageSelect(customId, placeholder, info) {
  if (!info.roles.length) return null;
  return new StringSelectMenuBuilder().setCustomId(customId)
    .setPlaceholder(placeholder).setMinValues(0)
    .setMaxValues(Math.min(10, info.roles.length))
    .addOptions(info.roles.map(role => ({
      label: role.name.slice(0, 100), value: role.id,
      description: `Position ${role.position}`, default: info.selectedIds.has(role.id),
    })));
}
function mergePageSelection(previous, visibleRoles, chosen, limit = 10) {
  const visible = new Set(visibleRoles.map(role => role.id));
  const chosenIds = chosen.map(String);
  if (chosenIds.some(id => !visible.has(id))) throw new Error('Role selection is no longer valid for this page. Please refresh the panel.');
  const merged = [...new Set([...previous.map(String).filter(id => !visible.has(id)), ...chosenIds])];
  if (merged.length > limit) throw new Error(`Select no more than ${limit} roles across all pages.`);
  return merged;
}
module.exports = { PAGE_SIZE, rolePages, rolePager, rolePageSelect, mergePageSelection };
