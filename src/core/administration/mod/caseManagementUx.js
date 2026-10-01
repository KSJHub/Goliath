'use strict';

const { MessageFlags } = require('discord.js');
const panel = require('./panel');
const caseProceeding = require('./caseProceeding');
const storage = require('./storage');
const { canUseModAction } = require('./permissions');

const PATCH_KEY = Symbol.for('goliath.mod.case-management-ux-v1');
if (globalThis[PATCH_KEY]) module.exports = globalThis[PATCH_KEY];
else {
  const state = { installed: true };
  globalThis[PATCH_KEY] = state;

  function textField(interaction, id) {
    try { return String(interaction.fields?.getTextInputValue?.(id) || '').trim(); }
    catch { return ''; }
  }

  function subjectName(member, fallbackId = '') {
    return String(
      member?.displayName
      || member?.user?.globalName
      || member?.user?.username
      || member?.user?.tag
      || fallbackId
      || 'Unknown Member'
    ).replace(/\s+/g, ' ').trim();
  }

  function buildDisplayTitle(caseId, memberName, shortTitle, userId = '') {
    const identity = [memberName, userId, shortTitle || 'Untitled Case'].filter(Boolean).join(' • ');
    return String(identity).replace(/\s+/g, ' ').trim().slice(0, 180);
  }

  function liveSubjectName(interaction, userId, storedName = null) {
    const cached = interaction?.guild?.members?.cache?.get?.(String(userId));
    const live = subjectName(cached, '');
    if (live && live !== 'Unknown Member') return live;
    const stored = String(storedName || '').trim();
    if (stored && stored !== String(userId) && !/^\d{15,25}$/.test(stored)) return stored;
    return String(userId || 'Unknown Member');
  }

  function caseDisplayTitle(modCase, fallbackMemberName = null) {
    if (!modCase) return null;
    const proceeding = modCase.metadata?.proceeding || {};
    const base = String(proceeding.title || proceeding.allegations || modCase.reason || 'Untitled Case').replace(/\s+/g, ' ').trim();
    const memberName = String(fallbackMemberName || proceeding.subjectName || modCase.userId || 'Unknown Member');
    return buildDisplayTitle(modCase.caseId, memberName, base, modCase.userId);
  }

  function getCase(guildId, caseId) {
    if (!guildId || !caseId) return null;
    try { return storage.getCaseById(guildId, Number(caseId)); }
    catch { return null; }
  }

  function rowJson(row) {
    try { return typeof row?.toJSON === 'function' ? row.toJSON() : row; }
    catch { return row; }
  }

  function componentJson(component) {
    try { return typeof component?.toJSON === 'function' ? component.toJSON() : component; }
    catch { return component; }
  }

  function isUserSelectRow(row) {
    const data = rowJson(row);
    return Array.isArray(data?.components) && data.components.some((component) => Number(componentJson(component)?.type) === 5);
  }

  function payloadTitle(payload) {
    const embed = payload?.embed || payload?.embeds?.[0];
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : embed;
    return String(data?.title || '');
  }

  function applyEmbedTitle(embed, title) {
    if (!embed || !title) return;
    if (typeof embed.setTitle === 'function') embed.setTitle(title.slice(0, 256));
    else if (embed.data && typeof embed.data === 'object') embed.data.title = title.slice(0, 256);
    else embed.title = title.slice(0, 256);
  }

  function decorateEmbed(embed, interaction) {
    const guildId = interaction?.guildId || interaction?.guild?.id;
    if (!embed) return;
    const data = typeof embed?.toJSON === 'function' ? embed.toJSON() : (embed.data || embed);
    const title = String(data?.title || '');
    const caseIdMatch = title.match(/(?:Case\s*#|•\s*#)(\d+)/i);
    if (caseIdMatch) {
      const modCase = getCase(guildId, caseIdMatch[1]);
      const display = caseDisplayTitle(modCase, liveSubjectName(interaction, modCase?.userId, modCase?.metadata?.proceeding?.subjectName));
      if (display && (title.startsWith('📂') || title.includes('Case #'))) {
        const icon = title.startsWith('📂') ? '📂 ' : title.startsWith('⚖️') ? '⚖️ ' : title.startsWith('👁️') ? '👁️ ' : '';
        if (title.startsWith('📂')) applyEmbedTitle(embed, `${icon}${display}`);
      }
    }

    const fields = data?.fields;
    if (Array.isArray(fields)) {
      const recentIndex = fields.findIndex((field) => field?.name === 'Recent Case Files');
      if (recentIndex >= 0) {
        const description = String(data?.description || '');
        const targetId = description.match(/`(\d{15,25})`/)?.[1];
        if (targetId) {
          let cases = [];
          try { cases = (storage.getCasesForUser(guildId, targetId) || []).filter(caseProceeding.caseIsProceeding).slice(0, 5); } catch {}
          if (cases.length) {
            const value = cases.map((entry) => {
              const proceeding = caseProceeding.parseProceeding(entry);
              const display = caseDisplayTitle(entry, liveSubjectName(interaction, targetId, entry?.metadata?.proceeding?.subjectName));
              const stage = proceeding.stage === 'review' ? '⚖️ Awaiting Review' : proceeding.stage === 'published' ? '📜 Published' : proceeding.stage === 'closed' ? '🔒 Closed' : proceeding.stage === 'decided' ? '👨‍⚖️ Decision Recorded' : '🔎 Under Investigation';
              const severity = ['Low', 'Medium', 'High', 'Severe', 'Critical'][Math.max(0, Math.min(4, Number(proceeding.severity || 1) - 1))];
              return `**${display}**\n${stage} • Severity **${severity}**`;
            }).join('\n\n').slice(0, 1024);
            if (typeof embed.spliceFields === 'function') embed.spliceFields(recentIndex, 1, { ...fields[recentIndex], value });
            else if (embed.data?.fields) embed.data.fields[recentIndex] = { ...embed.data.fields[recentIndex], value };
          }
        }
      }
    }
  }

  function proceedingStageText(stage) {
    if (typeof caseProceeding.stageText === 'function') return caseProceeding.stageText(stage);
    return ({
      investigation: '🔎 Under Investigation',
      review: '⚖️ Awaiting Review',
      decided: '👨‍⚖️ Decision Recorded',
      published: '📜 Published',
      closed: '🔒 Closed',
    })[String(stage || 'investigation')] || '🔎 Under Investigation';
  }

  function proceedingSeverityText(value) {
    if (typeof caseProceeding.severityText === 'function') return caseProceeding.severityText(value);
    const index = Math.max(0, Math.min(4, Number(value || 1) - 1));
    return ['Low', 'Medium', 'High', 'Severe', 'Critical'][index];
  }

  function decorateComponents(components, interaction) {
    if (!Array.isArray(components)) return components;
    const guildId = interaction?.guildId || interaction?.guild?.id;
    for (const row of components) {
      const items = row?.components || row?.data?.components;
      if (!Array.isArray(items)) continue;
      for (const component of items) {
        const data = component?.data || component;
        const customId = data?.custom_id || data?.customId;
        if (!String(customId || '').startsWith('mod_proceeding_open:')) continue;
        const targetId = String(customId).split(':')[1] || '';
        const options = component?.options || data?.options;
        if (!Array.isArray(options)) continue;
        for (const option of options) {
          const optionData = option?.data || option;
          const modCase = getCase(guildId, optionData?.value);
          if (!modCase) continue;
          const proceeding = modCase.metadata?.proceeding || {};
          const memberName = liveSubjectName(interaction, targetId || modCase.userId, proceeding.subjectName);
          const caseTitle = String(proceeding.title || proceeding.allegations || modCase.reason || 'Untitled Case').replace(/\s+/g, ' ').trim();
          const label = buildDisplayTitle(modCase.caseId, memberName, caseTitle, targetId || modCase.userId).slice(0, 100);
          const stage = proceedingStageText(proceeding.stage || 'investigation').replace(/^\S+\s/, '');
          const severity = proceedingSeverityText(proceeding.severity || 1);
          const description = `Case #${modCase.caseId} • ${stage} • Severity ${severity}`.slice(0, 100);
          if (option?.data) { option.data.label = label; option.data.description = description; }
          else { option.label = label; option.description = description; }
        }
      }
    }
    return components;
  }

  function decorateCasePayload(payload, interaction, { stripMemberSelector = false } = {}) {
    if (!payload || typeof payload !== 'object') return payload;
    const guildId = interaction?.guildId || interaction?.guild?.id;
    if (payload.embed) decorateEmbed(payload.embed, interaction);
    if (Array.isArray(payload.embeds)) for (const embed of payload.embeds) decorateEmbed(embed, interaction);
    decorateComponents(payload.components, interaction);

    if (stripMemberSelector && payloadTitle(payload).startsWith('📂 Case Management') && Array.isArray(payload.components)) {
      payload.components = payload.components.filter((row) => !isUserSelectRow(row));
    }
    return payload;
  }

  function wrapInteractionOutput(interaction, options = {}) {
    const restores = [];
    const wrapMethod = (owner, key) => {
      if (!owner || typeof owner[key] !== 'function') return;
      const original = owner[key];
      owner[key] = function caseManagementFilteredOutput(payload, ...rest) {
        return original.call(this, decorateCasePayload(payload, interaction, options), ...rest);
      };
      restores.push(() => { owner[key] = original; });
    };
    wrapMethod(interaction, 'update');
    wrapMethod(interaction, 'editReply');
    wrapMethod(interaction, 'reply');
    wrapMethod(interaction?.message, 'edit');
    return () => { while (restores.length) restores.pop()(); };
  }

  function wrapPanelMethod(name) {
    const original = panel[name];
    if (typeof original !== 'function') return;
    panel[name] = async function caseManagementPanelWrapper(interaction, ...args) {
      const restore = wrapInteractionOutput(interaction, { stripMemberSelector: true });
      try { return await original.call(this, interaction, ...args); }
      finally { restore(); }
    };
  }

  for (const method of ['openModPanel', 'renderDashboard', 'refreshDashboard', 'refreshCasesDashboard', 'handleDashboardNavigation', 'handleUserSelectMenu']) {
    wrapPanelMethod(method);
  }

  for (const method of ['buildProceedingDashboard', 'buildCaseFile', 'buildUserPublishedCasesPanel']) {
    const original = caseProceeding[method];
    if (typeof original !== 'function') continue;
    caseProceeding[method] = function caseManagementBuildWrapper(interaction, ...args) {
      return decorateCasePayload(original.call(this, interaction, ...args), interaction);
    };
  }

  const originalProceedingInteraction = caseProceeding.handleProceedingInteraction;
  if (typeof originalProceedingInteraction === 'function') {
    caseProceeding.handleProceedingInteraction = async function caseManagementProceedingInteraction(interaction, ...args) {
      const restore = wrapInteractionOutput(interaction);
      try { return await originalProceedingInteraction.call(this, interaction, ...args); }
      finally { restore(); }
    };
  }

  const originalProceedingModal = caseProceeding.handleProceedingModal;
  caseProceeding.handleProceedingModal = async function caseManagementProceedingModal(interaction, ...args) {
    const id = String(interaction?.customId || '');
    if (id.startsWith('mod_case_new_submit:') && interaction.isModalSubmit?.()) {
      if (!canUseModAction(interaction.member, interaction.guild, 'proceeding_manage', interaction)) {
        await interaction.reply({ content: '❌ Case-management authority is required to open a case.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const targetId = id.split(':')[1];
      const rawSeverity = textField(interaction, 'severity').toLowerCase();
      const severityMap = { '1': 1, low: 1, '2': 2, medium: 2, moderate: 2, '3': 3, high: 3, '4': 4, severe: 4, '5': 5, critical: 5 };
      const severity = severityMap[rawSeverity] || null;
      if (!severity) {
        await interaction.reply({ content: '❌ Severity must be Low, Medium, High, Severe, or Critical.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const shortTitle = textField(interaction, 'caseTitle');
      const allegations = textField(interaction, 'allegations');
      const recommendation = textField(interaction, 'recommendation');
      const target = await interaction.guild.members.fetch(targetId).catch(() => null);
      const memberName = subjectName(target, targetId);
      const createdAt = new Date().toISOString();

      const created = storage.createCase({
        guildId: interaction.guildId,
        userId: targetId,
        moderatorId: interaction.user.id,
        action: caseProceeding.PROCEEDING_ACTION,
        reason: allegations,
        metadata: {
          proceeding: {
            stage: 'investigation',
            severity,
            title: shortTitle,
            displayTitle: null,
            subjectName: memberName,
            allegations,
            leadModeratorId: interaction.user.id,
            reviewingAdminId: null,
            evidence: [],
            notes: [],
            linkedCases: [],
            recommendation: recommendation ? { reason: recommendation, by: interaction.user.id, at: createdAt } : null,
            decision: null,
            publication: null,
          },
        },
        status: 'active',
        actorId: interaction.user.id,
      });

      if (!created) {
        await interaction.reply({ content: '❌ Failed to create the case.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const displayTitle = buildDisplayTitle(created.caseId, memberName, shortTitle, targetId);
      const metadata = {
        ...(created.metadata || {}),
        proceeding: {
          ...(created.metadata?.proceeding || {}),
          title: shortTitle,
          displayTitle,
          subjectName: memberName,
        },
      };
      const updatedAt = new Date().toISOString();
      storage.db.prepare('UPDATE cases SET metadata = ?, updated_at = ? WHERE guild_id = ? AND case_id = ?')
        .run(JSON.stringify(metadata), updatedAt, String(interaction.guildId), Number(created.caseId));
      storage.recordCaseAudit({
        guildId: interaction.guildId,
        caseId: created.caseId,
        actorId: interaction.user.id,
        event: 'case.management.identity_assigned',
        before: created.metadata?.proceeding || null,
        after: metadata.proceeding,
        metadata: { generatedDisplayTitle: true, subjectId: targetId },
      });
      const updated = storage.getCaseById(interaction.guildId, created.caseId) || created;
      storage.emitCaseUpdated(interaction.guildId, updated);

      const payload = decorateCasePayload(caseProceeding.buildCaseFile(interaction, updated), interaction);
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.update(payload);
      return true;
    }

    const restore = wrapInteractionOutput(interaction);
    try { return await originalProceedingModal.call(this, interaction, ...args); }
    finally { restore(); }
  };

  state.decorateCasePayload = decorateCasePayload;
  state.buildDisplayTitle = buildDisplayTitle;
  module.exports = state;
}
