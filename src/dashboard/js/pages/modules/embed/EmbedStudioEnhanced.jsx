import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

function EmojiBankStrip({ theme, emojiBank, onCopied }) {
  const favourites = Array.isArray(emojiBank?.favourites) ? emojiBank.favourites : [];
  const selectedIds = useMemo(() => new Set(favourites.map(String)), [favourites]);
  const selected = useMemo(
    () => (Array.isArray(emojiBank?.bank) ? emojiBank.bank : []).filter((emoji) => selectedIds.has(String(emoji.id))),
    [emojiBank, selectedIds]
  );

  if (!emojiBank?.enabled) return null;

  async function copyEmoji(emoji, target = 'text') {
    const mention = emoji?.mention || `<${emoji?.animated ? 'a' : ''}:${emoji?.name}:${emoji?.id}>`;
    try {
      await navigator.clipboard.writeText(mention);
      onCopied?.(
        target === 'component'
          ? `${emoji.name} copied for a Discord button/select emoji field.`
          : `${emoji.name} copied for message/embed text.`
      );
    } catch {
      onCopied?.(`Use ${mention} ${target === 'component' ? 'in the component emoji field' : 'in message or embed text'}.`);
    }
  }

  return (
    <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 22, padding: 18, boxShadow: theme.shadow, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: '#93c5fd', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Emoji Bank</div>
          <h3 style={{ margin: '5px 0 0' }}>Guild-selected Goliath emojis</h3>
          <p style={{ margin: '7px 0 0', color: theme.mutedText, lineHeight: 1.5 }}>Use <strong>Text</strong> for message/embed content or <strong>Button / Select</strong> for Discord component emoji fields. Both use the Discord application emoji owned by Goliath; no guild emoji slot is consumed.</p>
        </div>
        <div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900 }}>{selected.length} / {emojiBank?.guildCapacity?.max || 100}</div>
      </div>

      {selected.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))', gap: 9 }}>
          {selected.map((emoji) => (
            <div key={emoji.id} style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,0.30)', borderRadius: 14, padding: 10, display: 'grid', gap: 9 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                {emoji.url ? <img src={emoji.url} alt="" width="30" height="30" style={{ objectFit: 'contain' }} /> : null}
                <span style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis' }}>:{emoji.name}:</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
                <button
                  type="button"
                  onClick={() => copyEmoji(emoji, 'text')}
                  style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(37,99,235,0.18)', color: theme.cardText, borderRadius: 10, padding: '8px 9px', cursor: 'pointer', fontWeight: 850 }}
                >
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => copyEmoji(emoji, 'component')}
                  style={{ border: `1px solid ${theme.cardBorder}`, background: 'rgba(168,85,247,0.16)', color: theme.cardText, borderRadius: 10, padding: '8px 9px', cursor: 'pointer', fontWeight: 850 }}
                >
                  Button / Select
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ color: theme.mutedText }}>No Emoji Bank entries are selected for this guild yet.</div>
      )}
    </section>
  );
}

export default function EmbedStudioEnhanced(props) {
  const { selectedGuild, selectedGuildData, theme } = props;
  const guildId = getGuildId(selectedGuild, selectedGuildData);
  const [payload, setPayload] = useState({});
  const [emojiBank, setEmojiBank] = useState(null);
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
      const [result, emojisResult] = await Promise.all([
        api.getEmbedStudio(guildId),
        api.request(`/api/emojis/${guildId}/overview`).catch(() => null),
      ]);
      if (requestVersion === requestVersionRef.current) {
        setPayload(result || {});
        setEmojiBank(emojisResult || null);
      }
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
      <EmojiBankStrip theme={theme} emojiBank={emojiBank} onCopied={setNotice} />
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
