'use strict';

const { createHash } = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, EmbedBuilder } = require('discord.js');
const { safeReply, ephemeralError } = require('../../../core/ui/interactionResponse');
const { COLORS, createEmbed } = require('../../../core/ui/embeds');
const { canUseModAction } = require('./permissions');
const {
  db,
  recordCaseAudit,
  emitCaseUpdated,
  searchCases,
  getCaseById,
  getCaseAudit,
  isCaseLocked,
  isCaseMergedSource,
  getMergedIntoId,
  getMergedCaseIds,
  updateCaseReason,
  updateCaseTags,
  updateCaseLock,
  linkCases,
  unlinkCaseRelationship,
  mergeCases,
  splitMergedCase,
  bulkUpdateCases,
} = require('./storage');

const ACTIONS = new Set(['warn', 'timeout', 'kick', 'ban', 'unwarn', 'remove-timeout']);
const STATUSES = new Set(['active', 'reversed', 'expired']);
const SEARCHES = new Map();
const TTL = 30 * 60 * 1000;
const SNOWFLAKE = /^\d{16,20}$/;
const AUDIT_PAGE_SIZE = 5;
const EVIDENCE_PAGE_SIZE = 4;
const MAX_ACTIVE_EVIDENCE = 50;
const MAX_EVIDENCE_HISTORY = 100;

function buildCaseSearchModal() {
  return new ModalBuilder().setCustomId('mod_submit_case_search').setTitle('Search Moderation Cases').addComponents(
    ...[['case_id', 'Case ID', 'Optional — e.g. 123', 12], ['user_id', 'User ID', 'Optional Discord user ID', 30], ['moderator_id', 'Moderator ID', 'Optional Discord moderator ID', 30], ['action', 'Action', 'warn, timeout, kick, ban...', 30], ['status', 'Status', 'active, reversed, expired', 20]].map(([id, label, placeholder, max]) => new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setPlaceholder(placeholder).setRequired(false).setMaxLength(max)))
  );
}

function buildAdvancedCaseSearchModal(token) {
  return new ModalBuilder().setCustomId(`mod_submit_case_search_advanced:${token}`).setTitle('Advanced Case Search').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason_query').setLabel('Reason / Staff Note').setStyle(TextInputStyle.Paragraph).setPlaceholder('Text contained in the reason or staff note').setRequired(false).setMaxLength(500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('created_from').setLabel('Created From').setStyle(TextInputStyle.Short).setPlaceholder('YYYY-MM-DD').setRequired(false).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('created_to').setLabel('Created To').setStyle(TextInputStyle.Short).setPlaceholder('YYYY-MM-DD').setRequired(false).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('updated_from').setLabel('Updated From').setStyle(TextInputStyle.Short).setPlaceholder('YYYY-MM-DD').setRequired(false).setMaxLength(10)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('updated_to').setLabel('Updated To').setStyle(TextInputStyle.Short).setPlaceholder('YYYY-MM-DD').setRequired(false).setMaxLength(10))
  );
}

function buildCaseLinkModal(token, caseId) {
  return new ModalBuilder().setCustomId(`mod_case_link_submit:${token}:${caseId}`).setTitle(`Link Case #${caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('related_case_id').setLabel('Related Case ID').setStyle(TextInputStyle.Short).setPlaceholder('Enter the case ID to link').setRequired(true).setMaxLength(12))
  );
}

function buildCaseReasonModal(token, c) {
  return new ModalBuilder().setCustomId(`mod_case_reason_submit:${token}:${c.caseId}`).setTitle(`Edit Case #${c.caseId} Reason`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('reason').setLabel('Moderation Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Enter the updated moderation reason').setRequired(true).setMaxLength(500).setValue(String(c.reason || '').slice(0, 500)))
  );
}

function buildCaseTagsModal(token, c) {
  const tags = Array.isArray(c.metadata?.tags) ? c.metadata.tags : [];
  return new ModalBuilder().setCustomId(`mod_case_tags_submit:${token}:${c.caseId}`).setTitle(`Edit Case #${c.caseId} Tags`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tags').setLabel('Case Tags').setStyle(TextInputStyle.Paragraph).setPlaceholder('Comma-separated tags, e.g. spam, repeat offender').setRequired(false).setMaxLength(400).setValue(tags.join(', ').slice(0, 400)))
  );
}

function buildCaseMergeModal(token, c) {
  return new ModalBuilder().setCustomId(`mod_case_merge_submit:${token}:${c.caseId}`).setTitle(`Merge Into Case #${c.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('source_case_id').setLabel('Case ID To Merge').setStyle(TextInputStyle.Short).setPlaceholder('Case must belong to the same member').setRequired(true).setMaxLength(12))
  );
}

function buildCaseSplitModal(token, c) {
  const merged = getMergedCaseIds(c);
  return new ModalBuilder().setCustomId(`mod_case_split_submit:${token}:${c.caseId}`).setTitle(`Split From Case #${c.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('source_case_id').setLabel('Merged Case ID To Split').setStyle(TextInputStyle.Short).setPlaceholder(merged.length ? `Merged: ${merged.map((id) => `#${id}`).join(', ')}`.slice(0, 100) : 'Enter merged case ID').setRequired(true).setMaxLength(12))
  );
}

function buildCaseBulkModal(token, c) {
  return new ModalBuilder().setCustomId(`mod_case_bulk_submit:${token}:${c.caseId}`).setTitle('Bulk Case Editing').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('case_ids').setLabel('Case IDs').setStyle(TextInputStyle.Paragraph).setPlaceholder('Comma or space separated, maximum 25 cases').setRequired(true).setMaxLength(300).setValue(String(c.caseId))),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('operation').setLabel('Operation').setStyle(TextInputStyle.Short).setPlaceholder('add-tags, remove-tags, set-tags, lock, unlock, unlink').setRequired(true).setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Tags / Value').setStyle(TextInputStyle.Paragraph).setPlaceholder('Tags for tag operations; leave blank for other operations').setRequired(false).setMaxLength(400))
  );
}

function buildEvidenceAddModal(token, c) {
  return new ModalBuilder().setCustomId(`mod_case_evidence_add_submit:${token}:${c.caseId}`).setTitle(`Add Evidence • Case #${c.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message_url').setLabel('Discord Message URL').setStyle(TextInputStyle.Short).setPlaceholder('https://discord.com/channels/guild/channel/message').setRequired(false).setMaxLength(300)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('channel_id').setLabel('Channel ID').setStyle(TextInputStyle.Short).setPlaceholder('Optional if message URL is supplied').setRequired(false).setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('message_id').setLabel('Message ID').setStyle(TextInputStyle.Short).setPlaceholder('Optional if message URL is supplied').setRequired(false).setMaxLength(20)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('attachment_url').setLabel('Attachment / Media URL').setStyle(TextInputStyle.Short).setPlaceholder('Optional image, video, file, clip or other URL').setRequired(false).setMaxLength(500)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('evidence_note').setLabel('Evidence Note / Context').setStyle(TextInputStyle.Paragraph).setPlaceholder('What this evidence shows or why it matters').setRequired(false).setMaxLength(1000))
  );
}

function buildEvidenceRemoveModal(token, c) {
  const active = getCaseEvidence(c).filter((entry) => !entry.removedAt);
  return new ModalBuilder().setCustomId(`mod_case_evidence_remove_submit:${token}:${c.caseId}`).setTitle(`Remove Evidence • Case #${c.caseId}`).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('evidence_id').setLabel('Evidence ID').setStyle(TextInputStyle.Short).setPlaceholder(active.length ? active.slice(-5).map((entry) => entry.id).join(', ').slice(0, 100) : 'Enter evidence ID').setRequired(true).setMaxLength(40)),
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('remove_reason').setLabel('Removal Reason').setStyle(TextInputStyle.Paragraph).setPlaceholder('Why this evidence reference is being removed').setRequired(true).setMaxLength(500))
  );
}

function input(i, id) { return String(i.fields.getTextInputValue(id) || '').trim(); }
function isCaseReadOnly(c) { return isCaseLocked(c) || isCaseMergedSource(c); }

function parseDate(value, label, endOfDay = false) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must use YYYY-MM-DD.`);
  const parsed = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} is not a valid date.`);
  return parsed.toISOString();
}

function validateSnowflake(value, label) {
  if (!value) return null;
  if (!SNOWFLAKE.test(value)) return `${label} must be a valid Discord ID.`;
  return null;
}

function filtersFrom(i) {
  const caseId = input(i, 'case_id'), userId = input(i, 'user_id'), moderatorId = input(i, 'moderator_id'), action = input(i, 'action').toLowerCase(), status = input(i, 'status').toLowerCase();
  if (caseId && !/^\d+$/.test(caseId)) return { error: 'Case ID must be a number.' };
  const userError = validateSnowflake(userId, 'User ID');
  if (userError) return { error: userError };
  const moderatorError = validateSnowflake(moderatorId, 'Moderator ID');
  if (moderatorError) return { error: moderatorError };
  if (action && !ACTIONS.has(action)) return { error: `Unknown action. Use: ${[...ACTIONS].join(', ')}.` };
  if (status && !STATUSES.has(status)) return { error: `Unknown status. Use: ${[...STATUSES].join(', ')}.` };
  return { caseId: caseId || undefined, userId: userId || undefined, moderatorId: moderatorId || undefined, action: action || undefined, status: status || undefined, page: 0, pageSize: 10 };
}

function remember(guildId, filters) {
  const token = `${String(guildId)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  SEARCHES.set(token, { guildId: String(guildId), filters: { ...filters }, createdAt: Date.now() });
  for (const [k, v] of SEARCHES) if (Date.now() - v.createdAt > TTL) SEARCHES.delete(k);
  return token;
}

function stateFor(token, guildId) {
  const s = SEARCHES.get(token);
  if (!s || s.guildId !== String(guildId) || Date.now() - s.createdAt > TTL) { SEARCHES.delete(token); return null; }
  return s;
}

function cleanHttpUrl(value, label) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed.toString().slice(0, 500);
  } catch {
    throw new Error(`${label} must be a valid http/https URL.`);
  }
}

function parseDiscordMessageUrl(value) {
  const url = cleanHttpUrl(value, 'Discord message URL');
  if (!url) return null;
  const parsed = new URL(url);
  if (!/(^|\.)discord(?:app)?\.com$/i.test(parsed.hostname)) throw new Error('Discord message URL must point to discord.com or discordapp.com.');
  const match = parsed.pathname.match(/^\/channels\/(\d{16,20})\/(\d{16,20})\/(\d{16,20})\/?$/);
  if (!match) throw new Error('Discord message URL must include guild, channel and message IDs.');
  return { messageUrl: url, guildId: match[1], channelId: match[2], messageId: match[3] };
}

function evidenceCore(entry = {}) {
  return {
    id: entry.id || null,
    type: entry.type || 'note',
    messageUrl: entry.messageUrl || null,
    guildId: entry.guildId || null,
    channelId: entry.channelId || null,
    messageId: entry.messageId || null,
    attachmentUrl: entry.attachmentUrl || null,
    attachmentName: entry.attachmentName || null,
    note: entry.note || null,
    addedBy: entry.addedBy || null,
    addedAt: entry.addedAt || null,
  };
}

function evidenceIntegrity(entry) {
  return createHash('sha256').update(JSON.stringify(evidenceCore(entry))).digest('hex');
}

function getCaseEvidence(c) {
  return Array.isArray(c?.metadata?.evidence) ? c.metadata.evidence.filter((entry) => entry && typeof entry === 'object' && entry.id) : [];
}

function evidenceIsIntact(entry) {
  return Boolean(entry?.integrity) && entry.integrity === evidenceIntegrity(entry);
}

function writeCaseMetadata(guildId, caseId, metadata) {
  const updatedAt = new Date().toISOString();
  const result = db.prepare('UPDATE cases SET metadata = ?, updated_at = ? WHERE guild_id = ? AND case_id = ?').run(JSON.stringify(metadata || {}), updatedAt, String(guildId), Number(caseId));
  if (!result.changes) return null;
  const updated = getCaseById(guildId, caseId);
  if (updated) emitCaseUpdated(guildId, updated);
  return updated;
}

function buildEvidenceEntry(guildId, raw, actorId) {
  const message = raw.messageUrl ? parseDiscordMessageUrl(raw.messageUrl) : null;
  let channelId = String(raw.channelId || '').trim() || message?.channelId || null;
  let messageId = String(raw.messageId || '').trim() || message?.messageId || null;
  if (channelId && !SNOWFLAKE.test(channelId)) throw new Error('Channel ID must be a valid Discord ID.');
  if (messageId && !SNOWFLAKE.test(messageId)) throw new Error('Message ID must be a valid Discord ID.');
  if (message && String(message.guildId) !== String(guildId)) throw new Error('That Discord message URL belongs to a different server.');
  if ((channelId && !messageId) || (!channelId && messageId)) throw new Error('Channel ID and Message ID must be supplied together.');
  const attachmentUrl = cleanHttpUrl(raw.attachmentUrl, 'Attachment / media URL');
  const note = String(raw.note || '').trim().slice(0, 1000) || null;
  if (!message && !attachmentUrl && !note && !(channelId && messageId)) throw new Error('Add a Discord message, media URL, message IDs, or an evidence note.');
  const messageUrl = message?.messageUrl || (channelId && messageId ? `https://discord.com/channels/${guildId}/${channelId}/${messageId}` : null);
  let attachmentName = null;
  if (attachmentUrl) {
    try { attachmentName = decodeURIComponent(new URL(attachmentUrl).pathname.split('/').filter(Boolean).pop() || '').slice(0, 120) || null; } catch { attachmentName = null; }
  }
  const typeParts = [];
  if (messageUrl) typeParts.push('message');
  if (attachmentUrl) typeParts.push('media');
  if (note) typeParts.push('note');
  const entry = {
    id: `ev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type: typeParts.join('+') || 'note',
    messageUrl,
    guildId: message?.guildId || (messageUrl ? String(guildId) : null),
    channelId,
    messageId,
    attachmentUrl,
    attachmentName,
    note,
    addedBy: actorId ? String(actorId) : null,
    addedAt: new Date().toISOString(),
  };
  entry.integrity = evidenceIntegrity(entry);
  return entry;
}

function addCaseEvidence(guildId, caseId, raw, actorId = null) {
  const existing = getCaseById(guildId, caseId);
  if (!existing) return { ok: false, error: 'Case not found.' };
  if (isCaseReadOnly(existing)) return { ok: false, error: 'Locked or merged source cases cannot have evidence changed.' };
  const evidence = getCaseEvidence(existing);
  if (evidence.length >= MAX_EVIDENCE_HISTORY) return { ok: false, error: `Evidence history is limited to ${MAX_EVIDENCE_HISTORY} records per case.` };
  if (evidence.filter((entry) => !entry.removedAt).length >= MAX_ACTIVE_EVIDENCE) return { ok: false, error: `A case can have at most ${MAX_ACTIVE_EVIDENCE} active evidence records.` };
  let entry;
  try { entry = buildEvidenceEntry(guildId, raw, actorId); } catch (error) { return { ok: false, error: error.message }; }
  const duplicate = evidence.find((item) => !item.removedAt && ((entry.messageId && item.messageId === entry.messageId) || (entry.attachmentUrl && item.attachmentUrl === entry.attachmentUrl)));
  if (duplicate) return { ok: false, error: `Matching evidence already exists as ${duplicate.id}.` };
  const metadata = { ...(existing.metadata || {}), evidence: [...evidence, entry] };
  const updated = writeCaseMetadata(guildId, caseId, metadata);
  if (!updated) return { ok: false, error: 'Failed to persist evidence.' };
  recordCaseAudit({ guildId, caseId, actorId, event: 'case.evidence.added', before: null, after: evidenceCore(entry), metadata: { evidenceId: entry.id, type: entry.type, integrity: entry.integrity } });
  return { ok: true, case: updated, evidence: entry };
}

function removeCaseEvidence(guildId, caseId, evidenceId, reason, actorId = null) {
  const existing = getCaseById(guildId, caseId);
  if (!existing) return { ok: false, error: 'Case not found.' };
  if (isCaseReadOnly(existing)) return { ok: false, error: 'Locked or merged source cases cannot have evidence changed.' };
  const evidence = getCaseEvidence(existing);
  const index = evidence.findIndex((entry) => String(entry.id) === String(evidenceId));
  if (index < 0) return { ok: false, error: 'Evidence ID was not found on this case.' };
  if (evidence[index].removedAt) return { ok: false, error: 'That evidence has already been removed.' };
  const removalReason = String(reason || '').trim().slice(0, 500);
  if (!removalReason) return { ok: false, error: 'A removal reason is required.' };
  const before = { ...evidence[index] };
  const next = evidence.map((entry, i) => i === index ? { ...entry, removedAt: new Date().toISOString(), removedBy: actorId ? String(actorId) : null, removalReason } : entry);
  const metadata = { ...(existing.metadata || {}), evidence: next };
  const updated = writeCaseMetadata(guildId, caseId, metadata);
  if (!updated) return { ok: false, error: 'Failed to remove evidence.' };
  recordCaseAudit({ guildId, caseId, actorId, event: 'case.evidence.removed', before: evidenceCore(before), after: { evidenceId: before.id, removed: true, removalReason }, metadata: { evidenceId: before.id, integrity: before.integrity, softDelete: true } });
  return { ok: true, case: updated, evidence: next[index] };
}

function resultEmbed(r) {
  const d = r.results.length ? r.results.map((e) => {
    const state = [e.status || 'active'];
    if (isCaseLocked(e)) state.push('🔒 locked');
    if (getMergedIntoId(e)) state.push(`merged → #${getMergedIntoId(e)}`);
    if (getMergedCaseIds(e).length) state.push(`${getMergedCaseIds(e).length} merged`);
    const evidenceCount = getCaseEvidence(e).filter((entry) => !entry.removedAt).length;
    if (evidenceCount) state.push(`${evidenceCount} evidence`);
    return `**#${e.caseId}** • ${e.action} • ${state.join(' • ')}\nUser: <@${e.userId}> • Moderator: <@${e.moderatorId}>\nReason: ${e.reason || 'No reason provided'}`;
  }).join('\n\n') : 'No moderation cases matched those filters.';
  return createEmbed({ title: 'Moderation Case Search', description: d.slice(0, 3900), color: COLORS.PRIMARY, footer: `Showing ${r.total ? `${r.page * r.pageSize + 1}-${Math.min((r.page + 1) * r.pageSize, r.total)} of ${r.total}` : '0'} result${r.total === 1 ? '' : 's'}` });
}

function resultComponents(r, token) {
  const rows = [];
  if (r.results.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`mod_case_search_select:${token}`).setPlaceholder('Select a case to open Case Detail').addOptions(r.results.map((e) => ({ label: `Case #${e.caseId} • ${e.action}`.slice(0, 100), description: `${e.status || 'active'}${isCaseLocked(e) ? ' • locked' : ''}${getMergedIntoId(e) ? ` • merged into #${getMergedIntoId(e)}` : ''} • User ${e.userId}`.slice(0, 100), value: String(e.caseId) })))));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_search_page:${token}:${Math.max(0, r.page - 1)}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(r.page <= 0),
    new ButtonBuilder().setCustomId(`mod_case_search_page:${token}:${r.page + 1}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(r.page >= r.totalPages - 1 || r.totalPages === 0),
    new ButtonBuilder().setCustomId(`mod_case_search_advanced:${token}`).setLabel('Advanced Filters').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mod_case_search').setLabel('New Search').setStyle(ButtonStyle.Primary)
  ));
  return rows;
}

function payload(r, token) { return { embeds: [resultEmbed(r)], components: resultComponents(r, token) }; }

function formatAuditValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function formatAuditEntry(entry) {
  const actor = entry.actorId ? `<@${entry.actorId}>` : 'System';
  const timestamp = new Date(entry.createdAt).getTime();
  const time = Number.isFinite(timestamp) ? `<t:${Math.floor(timestamp / 1000)}:R>` : 'Unknown time';
  const event = String(entry.event || 'case.updated').replace(/^case\./, '').replace(/\./g, ' ');
  const before = formatAuditValue(entry.before).replace(/\s+/g, ' ').slice(0, 180);
  const after = formatAuditValue(entry.after).replace(/\s+/g, ' ').slice(0, 180);
  return `• **${event}** by ${actor} • ${time}\n  Before: ${before}\n  After: ${after}`;
}

function caseDetailEmbed(c, audit) {
  const ts = (v) => { const n = new Date(v).getTime(); return Number.isFinite(n) ? Math.floor(n / 1000) : Math.floor(Date.now() / 1000); };
  const e = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(`🧾 Case #${c.caseId}`).addFields(
    { name: 'Action', value: String(c.action || 'unknown'), inline: true }, { name: 'Status', value: String(c.status || 'active'), inline: true },
    { name: 'User ID', value: String(c.userId), inline: true }, { name: 'Moderator ID', value: String(c.moderatorId), inline: true },
    { name: 'Reason', value: String(c.reason || 'No reason provided').slice(0, 1024), inline: false },
    { name: 'Created', value: `<t:${ts(c.createdAt)}:F>`, inline: true }, { name: 'Updated', value: c.updatedAt ? `<t:${ts(c.updatedAt)}:F>` : 'Never', inline: true }
  );
  if (c.relatedCaseId) e.addFields({ name: 'Related Case', value: `#${c.relatedCaseId}`, inline: true });
  const mergedInto = getMergedIntoId(c);
  const mergedCases = getMergedCaseIds(c);
  if (mergedInto) e.addFields({ name: '↪️ Merged Into', value: `Case #${mergedInto} • this source case is read-only until split`, inline: false });
  if (mergedCases.length) e.addFields({ name: '🧩 Merged Cases', value: mergedCases.map((id) => `#${id}`).join(', ').slice(0, 1024), inline: false });
  if (isCaseLocked(c)) {
    const lockedBy = c.metadata?.lockedBy ? `<@${c.metadata.lockedBy}>` : 'Unknown';
    const lockedAt = c.metadata?.lockedAt ? `<t:${ts(c.metadata.lockedAt)}:R>` : 'Unknown time';
    e.addFields({ name: '🔒 Case Lock', value: `Locked by ${lockedBy} • ${lockedAt}`, inline: false });
  }
  const tags = Array.isArray(c.metadata?.tags) ? c.metadata.tags : [];
  if (tags.length) e.addFields({ name: 'Tags', value: tags.map((tag) => `\`${String(tag).slice(0, 32)}\``).join(' ').slice(0, 1024), inline: false });
  const evidence = getCaseEvidence(c);
  const activeEvidence = evidence.filter((entry) => !entry.removedAt);
  const removedEvidence = evidence.length - activeEvidence.length;
  if (evidence.length) {
    const last = [...evidence].sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))[0];
    const intact = activeEvidence.filter(evidenceIsIntact).length;
    e.addFields({ name: '📎 Evidence', value: `Active: **${activeEvidence.length}** • Removed: **${removedEvidence}** • Integrity: **${intact}/${activeEvidence.length}**${last?.addedAt ? ` • Latest <t:${ts(last.addedAt)}:R>` : ''}`, inline: false });
  }
  if (c.note) e.addFields({ name: 'Staff Note', value: String(c.note).slice(0, 1024), inline: false });
  if (audit?.results?.length) e.addFields({ name: `Audit Timeline • Page ${audit.page + 1}/${audit.totalPages}`, value: audit.results.map(formatAuditEntry).join('\n').slice(0, 1024), inline: false });
  return e;
}

function caseDetailButtons(c, token, audit) {
  const closed = c.status === 'reversed' || c.status === 'expired';
  const locked = isCaseLocked(c);
  const mergedSource = isCaseMergedSource(c);
  const readOnly = locked || mergedSource;
  const mergedCases = getMergedCaseIds(c);
  const evidence = getCaseEvidence(c);
  const activeEvidence = evidence.filter((entry) => !entry.removedAt);
  const rows = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_search_back:${token}`).setLabel('← Back to Search').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`mod_case_reverse_warning:${c.caseId}`).setLabel('↩️ Reverse Warning').setStyle(ButtonStyle.Secondary).setDisabled(c.action !== 'warn' || closed),
    new ButtonBuilder().setCustomId(`mod_case_reverse_timeout:${c.caseId}`).setLabel('⏪ Reverse Timeout').setStyle(ButtonStyle.Secondary).setDisabled(c.action !== 'timeout' || closed),
    new ButtonBuilder().setCustomId(`mod_case_note:${c.caseId}`).setLabel('📝 Add/Edit Note').setStyle(ButtonStyle.Primary).setDisabled(readOnly),
    new ButtonBuilder().setCustomId(`mod_case_lock:${token}:${c.caseId}`).setLabel(locked ? '🔓 Unlock Case' : '🔒 Lock Case').setStyle(locked ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(mergedSource)
  )];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_reason:${token}:${c.caseId}`).setLabel('✏️ Edit Reason').setStyle(ButtonStyle.Primary).setDisabled(readOnly),
    new ButtonBuilder().setCustomId(`mod_case_tags:${token}:${c.caseId}`).setLabel('🏷️ Edit Tags').setStyle(ButtonStyle.Primary).setDisabled(readOnly),
    new ButtonBuilder().setCustomId(`mod_case_link:${token}:${c.caseId}`).setLabel('🔗 Link Case').setStyle(ButtonStyle.Secondary).setDisabled(readOnly || Boolean(c.relatedCaseId)),
    new ButtonBuilder().setCustomId(`mod_case_unlink:${token}:${c.caseId}`).setLabel('Unlink Case').setStyle(ButtonStyle.Secondary).setDisabled(readOnly || !c.relatedCaseId),
    new ButtonBuilder().setCustomId(`mod_case_related_open:${token}:${c.caseId}`).setLabel('Open Related').setStyle(ButtonStyle.Secondary).setDisabled(!c.relatedCaseId)
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_merge:${token}:${c.caseId}`).setLabel('🧩 Merge Case').setStyle(ButtonStyle.Secondary).setDisabled(readOnly),
    new ButtonBuilder().setCustomId(`mod_case_split:${token}:${c.caseId}`).setLabel('↔️ Split Case').setStyle(ButtonStyle.Secondary).setDisabled(locked || (!mergedSource && !mergedCases.length)),
    new ButtonBuilder().setCustomId(`mod_case_bulk:${token}:${c.caseId}`).setLabel('📚 Bulk Edit').setStyle(ButtonStyle.Primary)
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_evidence_add:${token}:${c.caseId}`).setLabel('➕ Add Evidence').setStyle(ButtonStyle.Primary).setDisabled(readOnly || activeEvidence.length >= MAX_ACTIVE_EVIDENCE),
    new ButtonBuilder().setCustomId(`mod_case_evidence_view:${token}:${c.caseId}:0`).setLabel(`📎 View Evidence (${activeEvidence.length})`).setStyle(ButtonStyle.Secondary).setDisabled(!evidence.length),
    new ButtonBuilder().setCustomId(`mod_case_evidence_remove:${token}:${c.caseId}`).setLabel('🗑️ Remove Evidence').setStyle(ButtonStyle.Danger).setDisabled(readOnly || !activeEvidence.length)
  ));
  if (audit?.totalPages > 1) rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_audit_page:${token}:${c.caseId}:${Math.max(0, audit.page - 1)}`).setLabel('◀ Audit').setStyle(ButtonStyle.Secondary).setDisabled(audit.page <= 0),
    new ButtonBuilder().setCustomId(`mod_case_audit_page:${token}:${c.caseId}:${Math.min(audit.totalPages - 1, audit.page + 1)}`).setLabel('Audit ▶').setStyle(ButtonStyle.Secondary).setDisabled(audit.page >= audit.totalPages - 1)
  ));
  return rows.slice(0, 5);
}

function formatEvidence(entry) {
  const flags = [entry.removedAt ? '🗑️ REMOVED' : '✅ ACTIVE', evidenceIsIntact(entry) ? '🔐 intact' : '⚠️ integrity mismatch'];
  const lines = [`**${entry.id}** • ${entry.type || 'evidence'} • ${flags.join(' • ')}`];
  if (entry.messageUrl) lines.push(`[Discord message](${entry.messageUrl})`);
  if (entry.channelId || entry.messageId) lines.push(`Channel: \`${entry.channelId || '—'}\` • Message: \`${entry.messageId || '—'}\``);
  if (entry.attachmentUrl) lines.push(`[${entry.attachmentName || 'Attachment / media'}](${entry.attachmentUrl})`);
  if (entry.note) lines.push(`Context: ${String(entry.note).replace(/\s+/g, ' ').slice(0, 260)}`);
  if (entry.addedBy) lines.push(`Added by <@${entry.addedBy}>${entry.addedAt ? ` • <t:${Math.floor(new Date(entry.addedAt).getTime() / 1000)}:R>` : ''}`);
  if (entry.removedAt) lines.push(`Removed${entry.removedBy ? ` by <@${entry.removedBy}>` : ''} • ${entry.removalReason || 'No reason recorded'}`);
  return lines.join('\n').slice(0, 900);
}

function evidenceViewer(c, token, requestedPage = 0) {
  const evidence = [...getCaseEvidence(c)].sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')));
  const totalPages = Math.max(1, Math.ceil(evidence.length / EVIDENCE_PAGE_SIZE));
  const page = Math.max(0, Math.min(Math.trunc(Number(requestedPage) || 0), totalPages - 1));
  const pageEntries = evidence.slice(page * EVIDENCE_PAGE_SIZE, (page + 1) * EVIDENCE_PAGE_SIZE);
  const active = evidence.filter((entry) => !entry.removedAt).length;
  const intact = evidence.filter(evidenceIsIntact).length;
  const embed = new EmbedBuilder().setColor(COLORS.PRIMARY).setTitle(`📎 Case #${c.caseId} Evidence`).setDescription(`Active **${active}** • History **${evidence.length}** • Integrity **${intact}/${evidence.length}**`).setFooter({ text: `Evidence page ${page + 1}/${totalPages}` });
  if (pageEntries.length) pageEntries.forEach((entry) => embed.addFields({ name: entry.id, value: formatEvidence(entry), inline: false }));
  else embed.addFields({ name: 'No evidence', value: 'No evidence has been recorded for this case.', inline: false });
  const readOnly = isCaseReadOnly(c);
  const activeEntries = evidence.filter((entry) => !entry.removedAt);
  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_case_evidence_view:${token}:${c.caseId}:${Math.max(0, page - 1)}`).setLabel('◀ Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
    new ButtonBuilder().setCustomId(`mod_case_evidence_view:${token}:${c.caseId}:${Math.min(totalPages - 1, page + 1)}`).setLabel('Next ▶').setStyle(ButtonStyle.Secondary).setDisabled(page >= totalPages - 1),
    new ButtonBuilder().setCustomId(`mod_case_evidence_add:${token}:${c.caseId}`).setLabel('➕ Add').setStyle(ButtonStyle.Primary).setDisabled(readOnly || activeEntries.length >= MAX_ACTIVE_EVIDENCE),
    new ButtonBuilder().setCustomId(`mod_case_evidence_remove:${token}:${c.caseId}`).setLabel('🗑️ Remove').setStyle(ButtonStyle.Danger).setDisabled(readOnly || !activeEntries.length),
    new ButtonBuilder().setCustomId(`mod_case_evidence_back:${token}:${c.caseId}`).setLabel('← Case Detail').setStyle(ButtonStyle.Secondary)
  )];
  return { embeds: [embed], components };
}

function bulkSummaryEmbed(result) {
  const lines = result.results.map((entry) => `${entry.ok ? (entry.changed ? '✅' : '➖') : '❌'} **#${entry.caseId}**${entry.error ? ` — ${entry.error}` : entry.changed ? ' — changed' : ' — no change'}`);
  return createEmbed({ title: `Bulk Case Update • ${result.operation}`, description: [`Requested: **${result.requested}** • Succeeded: **${result.succeeded}** • Failed: **${result.failed}** • Changed: **${result.changed}**`, '', ...lines].join('\n').slice(0, 3900), color: result.failed ? COLORS.WARNING || COLORS.PRIMARY : COLORS.SUCCESS || COLORS.PRIMARY });
}

async function openCaseSearch(i) {
  if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to search moderation cases.'));
  await i.showModal(buildCaseSearchModal());
  return true;
}

async function submitCaseSearch(i) {
  if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to search moderation cases.'));
  const f = filtersFrom(i);
  if (f.error) return safeReply(i, ephemeralError(f.error));
  const token = remember(i.guild.id, f), r = searchCases(i.guild.id, f);
  return safeReply(i, { ...payload(r, token), flags: 64 });
}

async function refreshCaseDetail(i, token, caseId) {
  const c = getCaseById(i.guild.id, caseId);
  if (!c) return safeReply(i, ephemeralError('Case not found.'));
  const audit = getCaseAudit(i.guild.id, caseId, { page: 0, pageSize: AUDIT_PAGE_SIZE });
  return i.update({ embeds: [caseDetailEmbed(c, audit)], components: caseDetailButtons(c, token, audit) });
}

async function handleCaseSearchAction(i) {
  const id = String(i.customId || '');
  if (id === 'mod_case_search') return openCaseSearch(i);
  if (id.startsWith('mod_case_evidence_add:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to add case evidence.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('Unlock or split this case before changing evidence.'));
    await i.showModal(buildEvidenceAddModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_evidence_remove:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to remove case evidence.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('Unlock or split this case before changing evidence.'));
    if (!getCaseEvidence(c).some((entry) => !entry.removedAt)) return safeReply(i, ephemeralError('This case has no active evidence to remove.'));
    await i.showModal(buildEvidenceRemoveModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_evidence_view:')) {
    if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to view case evidence.'));
    const [, token, caseIdRaw, pageRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    return i.update(evidenceViewer(c, token, pageRaw));
  }
  if (id.startsWith('mod_case_evidence_back:')) {
    if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to view case details.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    return refreshCaseDetail(i, token, Number(caseIdRaw));
  }
  if (id.startsWith('mod_case_lock:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to lock or unlock cases.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!Number.isInteger(caseId) || !c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseMergedSource(c)) return safeReply(i, ephemeralError('Split this merged source case before changing its lock.'));
    const updated = updateCaseLock(i.guild.id, caseId, !isCaseLocked(c), i.user?.id || null);
    if (!updated) return safeReply(i, ephemeralError('Failed to update case lock.'));
    return refreshCaseDetail(i, token, caseId);
  }
  if (id.startsWith('mod_case_merge:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to merge cases.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('Locked or already-merged source cases cannot be used as a merge target.'));
    await i.showModal(buildCaseMergeModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_split:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to split merged cases.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseLocked(c)) return safeReply(i, ephemeralError('Unlock this case before splitting merged cases.'));
    const mergedInto = getMergedIntoId(c);
    if (mergedInto) {
      const result = splitMergedCase(i.guild.id, mergedInto, caseId, i.user?.id || null);
      if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to split case.'));
      return refreshCaseDetail(i, token, caseId);
    }
    if (!getMergedCaseIds(c).length) return safeReply(i, ephemeralError('This case has no merged cases to split.'));
    await i.showModal(buildCaseSplitModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_bulk:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to bulk edit cases.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    await i.showModal(buildCaseBulkModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_reason:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit cases.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('This case is locked or merged. Split/unlock it before editing the reason.'));
    await i.showModal(buildCaseReasonModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_tags:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit cases.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('This case is locked or merged. Split/unlock it before editing tags.'));
    await i.showModal(buildCaseTagsModal(token, c));
    return true;
  }
  if (id.startsWith('mod_case_related_open:')) {
    if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to view case details.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const c = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    const relatedCaseId = Number(c.relatedCaseId);
    if (!Number.isInteger(relatedCaseId) || relatedCaseId <= 0) return safeReply(i, ephemeralError('This case does not have a related case.'));
    const related = getCaseById(i.guild.id, relatedCaseId);
    if (!related) return safeReply(i, ephemeralError(`Related Case #${relatedCaseId} could not be found.`));
    const audit = getCaseAudit(i.guild.id, relatedCaseId, { page: 0, pageSize: AUDIT_PAGE_SIZE });
    return i.update({ embeds: [caseDetailEmbed(related, audit)], components: caseDetailButtons(related, token, audit) });
  }
  if (id.startsWith('mod_case_link:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit case relationships.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('This case is locked or merged. Split/unlock it before changing relationships.'));
    if (c.relatedCaseId) return safeReply(i, ephemeralError(`Case #${caseId} is already linked to Case #${c.relatedCaseId}.`));
    await i.showModal(buildCaseLinkModal(token, caseId));
    return true;
  }
  if (id.startsWith('mod_case_unlink:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit case relationships.'));
    const [, token, caseIdRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('This case is locked or merged. Split/unlock it before changing relationships.'));
    const result = unlinkCaseRelationship(i.guild.id, caseId, i.user?.id || null);
    if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to unlink cases.'));
    return refreshCaseDetail(i, token, caseId);
  }
  if (id.startsWith('mod_case_audit_page:')) {
    if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to view case details.'));
    const [, token, caseIdRaw, pageRaw] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    const audit = getCaseAudit(i.guild.id, caseId, { page: Math.max(0, Math.trunc(Number(pageRaw) || 0)), pageSize: AUDIT_PAGE_SIZE });
    return i.update({ embeds: [caseDetailEmbed(c, audit)], components: caseDetailButtons(c, token, audit) });
  }
  if (id.startsWith('mod_case_search_advanced:')) {
    if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to search moderation cases.'));
    const [, token] = id.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    await i.showModal(buildAdvancedCaseSearchModal(token));
    return true;
  }
  if (id.startsWith('mod_case_search_back:')) {
    if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to search moderation cases.'));
    const [, token] = id.split(':');
    const state = stateFor(token, i.guild.id);
    if (!state) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const r = searchCases(i.guild.id, state.filters);
    return i.update(payload(r, token));
  }
  if (!id.startsWith('mod_case_search_page:')) return false;
  if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to search moderation cases.'));
  const [, token, pageRaw] = id.split(':');
  const s = stateFor(token, i.guild.id);
  if (!s) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
  const r = searchCases(i.guild.id, { ...s.filters, page: Math.max(0, Math.trunc(Number(pageRaw) || 0)) });
  return i.update(payload(r, token));
}

async function handleCaseSearchSelect(i) {
  const id = String(i.customId || '');
  if (!id.startsWith('mod_case_search_select:')) return false;
  if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to view case details.'));
  const [, token] = id.split(':');
  if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
  const caseId = Number(i.values?.[0]), c = getCaseById(i.guild.id, caseId);
  if (!Number.isInteger(caseId) || !c) return safeReply(i, ephemeralError('Case not found.'));
  const audit = getCaseAudit(i.guild.id, caseId, { page: 0, pageSize: AUDIT_PAGE_SIZE });
  return i.update({ embeds: [caseDetailEmbed(c, audit)], components: caseDetailButtons(c, token, audit) });
}

async function handleCaseSearchModal(i) {
  if (i.customId === 'mod_submit_case_search') return submitCaseSearch(i);
  if (i.customId.startsWith('mod_case_evidence_add_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to add case evidence.'));
    const [, token, caseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('This case became locked or merged before evidence was submitted.'));
    const result = addCaseEvidence(i.guild.id, caseId, { messageUrl: input(i, 'message_url'), channelId: input(i, 'channel_id'), messageId: input(i, 'message_id'), attachmentUrl: input(i, 'attachment_url'), note: input(i, 'evidence_note') }, i.user?.id || null);
    if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to add evidence.'));
    return i.update(evidenceViewer(result.case, token, 0));
  }
  if (i.customId.startsWith('mod_case_evidence_remove_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to remove case evidence.'));
    const [, token, caseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), c = getCaseById(i.guild.id, caseId);
    if (!c) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(c)) return safeReply(i, ephemeralError('This case became locked or merged before evidence removal was submitted.'));
    const result = removeCaseEvidence(i.guild.id, caseId, input(i, 'evidence_id'), input(i, 'remove_reason'), i.user?.id || null);
    if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to remove evidence.'));
    return i.update(evidenceViewer(result.case, token, 0));
  }
  if (i.customId.startsWith('mod_case_merge_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to merge cases.'));
    const [, token, targetCaseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const targetCaseId = Number(targetCaseIdRaw), sourceRaw = input(i, 'source_case_id');
    if (!Number.isInteger(targetCaseId) || targetCaseId <= 0 || !/^\d+$/.test(sourceRaw)) return safeReply(i, ephemeralError('Case IDs must be positive integers.'));
    const target = getCaseById(i.guild.id, targetCaseId);
    if (!target) return safeReply(i, ephemeralError('Merge target case not found.'));
    if (isCaseReadOnly(target)) return safeReply(i, ephemeralError('The merge target was locked or merged before submission.'));
    const result = mergeCases(i.guild.id, targetCaseId, Number(sourceRaw), i.user?.id || null);
    if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to merge cases.'));
    return refreshCaseDetail(i, token, targetCaseId);
  }
  if (i.customId.startsWith('mod_case_split_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to split merged cases.'));
    const [, token, targetCaseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const targetCaseId = Number(targetCaseIdRaw), sourceRaw = input(i, 'source_case_id');
    if (!Number.isInteger(targetCaseId) || targetCaseId <= 0 || !/^\d+$/.test(sourceRaw)) return safeReply(i, ephemeralError('Case IDs must be positive integers.'));
    const result = splitMergedCase(i.guild.id, targetCaseId, Number(sourceRaw), i.user?.id || null);
    if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to split case.'));
    return refreshCaseDetail(i, token, targetCaseId);
  }
  if (i.customId.startsWith('mod_case_bulk_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to bulk edit cases.'));
    const [, token, contextCaseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const contextCaseId = Number(contextCaseIdRaw);
    if (!Number.isInteger(contextCaseId) || contextCaseId <= 0) return safeReply(i, ephemeralError('Context case ID is invalid.'));
    const result = bulkUpdateCases(i.guild.id, input(i, 'case_ids'), input(i, 'operation'), input(i, 'value'), i.user?.id || null);
    if (result.error) return safeReply(i, ephemeralError(result.error));
    const context = getCaseById(i.guild.id, contextCaseId);
    if (!context) return safeReply(i, ephemeralError('The case you opened bulk editing from could not be found.'));
    const audit = getCaseAudit(i.guild.id, contextCaseId, { page: 0, pageSize: AUDIT_PAGE_SIZE });
    return i.update({ embeds: [bulkSummaryEmbed(result), caseDetailEmbed(context, audit)], components: caseDetailButtons(context, token, audit) });
  }
  if (i.customId.startsWith('mod_case_reason_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit cases.'));
    const [, token, caseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), reason = input(i, 'reason');
    if (!Number.isInteger(caseId) || caseId <= 0) return safeReply(i, ephemeralError('Case ID must be a positive integer.'));
    if (!reason) return safeReply(i, ephemeralError('Case reason cannot be empty.'));
    const existing = getCaseById(i.guild.id, caseId);
    if (!existing) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(existing)) return safeReply(i, ephemeralError('This case became locked or merged before the edit was submitted.'));
    const updated = updateCaseReason(i.guild.id, caseId, reason, i.user?.id || null);
    if (!updated) return safeReply(i, ephemeralError('Failed to update case reason.'));
    return refreshCaseDetail(i, token, caseId);
  }
  if (i.customId.startsWith('mod_case_tags_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit cases.'));
    const [, token, caseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), existing = getCaseById(i.guild.id, Number(caseIdRaw));
    if (!existing) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(existing)) return safeReply(i, ephemeralError('This case became locked or merged before the edit was submitted.'));
    const updated = updateCaseTags(i.guild.id, caseId, input(i, 'tags'), i.user?.id || null);
    if (!updated) return safeReply(i, ephemeralError('Failed to update case tags.'));
    return refreshCaseDetail(i, token, caseId);
  }
  if (i.customId.startsWith('mod_case_link_submit:')) {
    if (!canUseModAction(i.member, i.guild, 'edit_case')) return safeReply(i, ephemeralError('No permission to edit case relationships.'));
    const [, token, caseIdRaw] = i.customId.split(':');
    if (!stateFor(token, i.guild.id)) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
    const caseId = Number(caseIdRaw), relatedRaw = input(i, 'related_case_id');
    if (!Number.isInteger(caseId) || !/^\d+$/.test(relatedRaw)) return safeReply(i, ephemeralError('Case IDs must be positive integers.'));
    const existing = getCaseById(i.guild.id, caseId);
    if (!existing) return safeReply(i, ephemeralError('Case not found.'));
    if (isCaseReadOnly(existing)) return safeReply(i, ephemeralError('This case became locked or merged before the relationship was submitted.'));
    const result = linkCases(i.guild.id, caseId, Number(relatedRaw), i.user?.id || null);
    if (!result.ok) return safeReply(i, ephemeralError(result.error || 'Failed to link cases.'));
    return refreshCaseDetail(i, token, caseId);
  }
  if (!i.customId.startsWith('mod_submit_case_search_advanced:')) return false;
  if (!canUseModAction(i.member, i.guild, 'view_case_detail')) return safeReply(i, ephemeralError('No permission to search moderation cases.'));
  const [, token] = i.customId.split(':');
  const state = stateFor(token, i.guild.id);
  if (!state) return safeReply(i, ephemeralError('This search has expired. Please start a new search.'));
  const reasonQuery = input(i, 'reason_query');
  let dates;
  try {
    const createdFrom = parseDate(input(i, 'created_from'), 'Created From');
    const createdTo = parseDate(input(i, 'created_to'), 'Created To', true);
    const updatedFrom = parseDate(input(i, 'updated_from'), 'Updated From');
    const updatedTo = parseDate(input(i, 'updated_to'), 'Updated To', true);
    if (createdFrom && createdTo && new Date(createdFrom) > new Date(createdTo)) throw new Error('Created From cannot be after Created To.');
    if (updatedFrom && updatedTo && new Date(updatedFrom) > new Date(updatedTo)) throw new Error('Updated From cannot be after Updated To.');
    dates = { createdFrom, createdTo, updatedFrom, updatedTo };
  } catch (error) {
    return safeReply(i, ephemeralError(error.message));
  }
  state.filters = { ...state.filters, text: reasonQuery || undefined, ...dates, page: 0 };
  state.createdAt = Date.now();
  const r = searchCases(i.guild.id, state.filters);
  return safeReply(i, { ...payload(r, token), flags: 64 });
}

module.exports = { openCaseSearch, submitCaseSearch, handleCaseSearchAction, handleCaseSearchSelect, handleCaseSearchModal };
