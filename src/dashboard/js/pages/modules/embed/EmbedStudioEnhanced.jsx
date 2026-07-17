import React, { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../../../services/apiClient.js';
import SharedEmbedTemplatesPanel from './SharedEmbedTemplatesPanel.jsx';

function getGuildId(selectedGuild, selectedGuildData) {
  const id = selectedGuildData?.guildId || selectedGuildData?.id || selectedGuild || '';
  return String(id).split(':').pop().trim();
}

function cleanKey(value, label) {
  const key = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{2,80}$/.test(key)) {
    throw new Error(`${label} is invalid.`);
  }
  return key;
}

function normalizeTemplateInput(template = {}) {
  const input = template && typeof template === 'object' && !Array.isArray(template) ? template : {};
  const templateId = cleanKey(input.templateId || input.id || input.name, 'Template ID');
  const moduleKey = cleanKey(input.module || input.templateType || 'global', 'Module key');
  const templateType = cleanKey(input.templateType || input.module || 'global', 'Template type');
  const content = String(input.content || '').slice(0, 2000);
  const embed = input.embed && typeof input.embed === 'object' && !Array.isArray(input.embed) ? input.embed : {};

  if (!content.trim() && !String(embed.title || '').trim() && !String(embed.description || '').trim()) {
    throw new Error('Template content, title or description is required.');
  }

  return {
    ...input,
    templateId,
    module: moduleKey,
    templateType,
    name: String(input.name || templateId).trim().slice(0, 100),
    content,
    embed,
  };
}

function noticeStyle(theme, tone = 'success') {
  return {
    border: `1px solid ${tone === 'danger' ? 'rgba(252,165,165,0.35)' : 'rgba(134,239,172,0.35)'}`,
    background: tone === 'danger' ? 'rgba(239,68,68,0.12)' : 'rgba(34,197,94,0.12)',
    color: tone === 'danger' ? '#fca5a5' : '#86efac',
    borderRadius: 16,
    padding: 14,
    fontWeight: 850,
  };
}

export default function EmbedStudioEnhanced(props) {
  const { selectedGuild, selectedGuildData, theme } = props;
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [payload, setPayload] = useState({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const requestVersionRef = useRef(0);
  const activeActionRef = useRef(null);

  const load = useCallback(async () => {
    if (!guildId) return null;

    const requestVersion = ++requestVersionRef.current;
    setBusy(true);
    setError('');

    try {
      const result = await api.getEmbedStudio(guildId);
      if (requestVersion === requestVersionRef.current) setPayload(result || {});
      return result;
    } catch (loadError) {
      if (requestVersion === requestVersionRef.current) {
        setError(loadError.message || 'Failed to load shared embed templates.');
      }
      return null;
    } finally {
      if (requestVersion === requestVersionRef.current) setBusy(false);
    }
  }, [guildId]);

  useEffect(() => {
    activeActionRef.current = null;
    load();
    return () => {
      requestVersionRef.current += 1;
      activeActionRef.current = null;
    };
  }, [load]);

  async function run(actionKey, action, successMessage) {
    if (!guildId) {
      setError('Choose a server first.');
      return null;
    }

    if (activeActionRef.current) return null;

    const requestVersion = ++requestVersionRef.current;
    activeActionRef.current = actionKey;
    setBusy(true);
    setError('');
    setNotice('');

    try {
      const result = await action();
      if (requestVersion === requestVersionRef.current) {
        setPayload(result || {});
        setNotice(successMessage);
      }
      return result;
    } catch (actionError) {
      if (requestVersion === requestVersionRef.current) {
        setError(actionError.message || 'Embed template action failed.');
      }
      return null;
    } finally {
      if (activeActionRef.current === actionKey) activeActionRef.current = null;
      if (requestVersion === requestVersionRef.current) setBusy(false);
    }
  }

  async function saveTemplate(template) {
    try {
      const normalized = normalizeTemplateInput(template);
      return run(
        `save:${normalized.templateId}`,
        () => api.saveEmbedTemplate(guildId, normalized),
        'Shared embed template saved.'
      );
    } catch (validationError) {
      setNotice('');
      setError(validationError.message || 'Template validation failed.');
      return null;
    }
  }

  async function bindTemplate(moduleKey, slot, templateId) {
    try {
      const cleanModule = cleanKey(moduleKey, 'Module key');
      const cleanSlot = cleanKey(slot, 'Template slot');
      const cleanTemplateId = cleanKey(templateId, 'Template ID');

      return run(
        `bind:${cleanModule}:${cleanSlot}`,
        () => api.bindEmbedTemplate(guildId, cleanModule, cleanSlot, cleanTemplateId),
        'Template binding saved.'
      );
    } catch (validationError) {
      setNotice('');
      setError(validationError.message || 'Template binding validation failed.');
      return null;
    }
  }

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {error ? <section style={noticeStyle(theme, 'danger')}>{error}</section> : null}
      {notice ? <section style={noticeStyle(theme, 'success')}>{notice}</section> : null}
      <SharedEmbedTemplatesPanel
        theme={theme}
        payload={payload}
        busy={busy}
        onReload={load}
        onSaveTemplate={saveTemplate}
        onBindTemplate={bindTemplate}
      />
    </div>
  );
}
