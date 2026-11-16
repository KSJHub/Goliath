import { DASHBOARD_EMOJIS as E } from '../../shared/PageShell.jsx';
import React, { useEffect, useMemo, useState } from 'react';

import useOwnerGuilds from '../../hooks/useOwnerGuilds.js';
import { api } from '../../services/apiClient.js';

function getGuildId(guild = {}) {
  return guild.guildId || guild.id || '';
}

function getGuildName(guild = {}) {
  return guild.name || guild.guildName || 'Selected Guild';
}

function getStatusLabel(status) {
  if (status === 'healthy') return 'Healthy';
  if (status === 'warning') return 'Warning';
  if (status === 'critical') return 'Critical';
  if (status === 'idle') return 'Not Configured';
  return 'Unknown';
}

function statusColor(status) {
  if (status === 'healthy') return '#22c55e';
  if (status === 'warning') return '#f59e0b';
  if (status === 'critical') return '#ef4444';
  return '#94a3b8';
}

function formatList(items = [], fallback = 'None') {
  if (!Array.isArray(items) || !items.length) return fallback;
  return items.slice(0, 6).join(', ');
}

function plural(value, label) {
  return `${Number(value || 0)} ${label}${Number(value || 0) === 1 ? '' : 's'}`;
}

function defaultOpenState() {
  return {
    categories: false,
    recommendations: false,
    modules: false,
    permissions: false,
    roles: false,
    channels: false,
  };
}

export default function PermissionHealth({ theme }) {
  const { guilds, selectedGuild, loading: guildsLoading } = useOwnerGuilds();
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(defaultOpenState);

  const activeGuild = useMemo(
    () => guilds.find((guild) => String(getGuildId(guild)) === String(selectedGuild)) || null,
    [guilds, selectedGuild],
  );

  async function loadHealth() {
    if (!selectedGuild) return;
    try {
      setLoading(true);
      setError('');
      setOpen(defaultOpenState());
      const response = await api.getPermissionHealth(selectedGuild);
      setHealth(response);
    } catch (loadError) {
      console.error(loadError);
      setError(loadError.message || 'Failed to load permission health.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHealth();
  }, [selectedGuild]);

  const card = {
    border: '1px solid ' + theme.cardBorder,
    background: theme.cardBg,
    color: theme.cardText,
    borderRadius: 20,
    padding: 18,
    boxShadow: theme.shadow,
    minWidth: 0,
    overflow: 'hidden',
  };

  const score = Number(health?.healthScore ?? 0);
  const status = health?.status || 'idle';
  const categories = health?.categories || [];
  const recommendations = health?.recommendations || [];
  const channelIssues = health?.channels?.issues || [];
  const roleIssues = health?.roles?.issues || [];
  const dangerousRoles = health?.roles?.dangerousRoles || [];
  const moduleSections = health?.modules?.sections || [];
  const summary = health?.summary || {};
  const allHealthy = Boolean(health && !loading && !error && Number(summary.issueCount || 0) === 0 && status === 'healthy');

  return (
    <div style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <section style={{ ...card, background: 'linear-gradient(135deg, rgba(34,197,94,0.16), rgba(15,23,42,0.08) 48%, rgba(59,130,246,0.10))' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 420px' }}>
            <p style={{ margin: 0, color: '#22c55e', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Server Diagnostics</p>
            <h1 style={{ margin: '8px 0 0', fontSize: 'clamp(28px, 4vw, 42px)', letterSpacing: '-0.04em', lineHeight: 1 }}>Permission Health</h1>
            <p style={{ marginTop: 8, color: theme.mutedText, lineHeight: 1.55, maxWidth: 860 }}>
              Diagnose bot permissions, channel access, role hierarchy, security risks and module readiness from one owner control centre.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={() => setOpen({ categories: true, recommendations: true, modules: true, permissions: true, roles: true, channels: true })} style={buttonStyle(theme)}>Expand All</button>
            <button type="button" onClick={() => setOpen(defaultOpenState())} style={buttonStyle(theme)}>Collapse All</button>
            <button type="button" onClick={loadHealth} disabled={loading || !selectedGuild} style={{ ...buttonStyle(theme), background: 'rgba(34,197,94,0.16)' }}>{loading ? 'Scanning...' : 'Refresh Scan'}</button>
          </div>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'minmax(min(100%, 320px), 420px) 1fr', gap: 14 }}>
        <div style={{ ...card, display: 'grid', gap: 14, alignContent: 'center', background: `linear-gradient(145deg, ${statusColor(status)}22, rgba(15,23,42,0.18))` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: theme.mutedText, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: 12 }}>Health Score</div>
              <div style={{ marginTop: 6, fontSize: 'clamp(52px, 8vw, 86px)', lineHeight: 0.95, fontWeight: 950, color: statusColor(status) }}>{score || 0}%</div>
            </div>
            <StatusPill status={status} />
          </div>
          <div style={{ height: 14, borderRadius: 999, background: 'rgba(148,163,184,0.18)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.max(0, Math.min(score || 0, 100))}%`, height: '100%', background: statusColor(status), borderRadius: 999 }} />
          </div>
          <div style={{ color: theme.mutedText, lineHeight: 1.5 }}>
            {health?.checkedAt ? `Last checked ${new Date(health.checkedAt).toLocaleString()}` : 'Run a scan to calculate health.'}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,180px),1fr))', gap: 12 }}>
          <HealthCard title="Selected Guild" value={guildsLoading ? 'Loading' : getGuildName(activeGuild)} detail={selectedGuild || 'No guild selected'} theme={theme} />
          <HealthCard title="Total Issues" value={summary.issueCount || 0} detail={`${summary.warningCount || 0} warnings`} theme={theme} />
          <HealthCard title="Channels" value={summary.channelIssueCount || 0} detail={`${health?.channels?.checked || 0} checked`} theme={theme} />
          <HealthCard title="Roles" value={summary.roleIssueCount || 0} detail={`${health?.roles?.checked || 0} checked`} theme={theme} />
          <HealthCard title="Security Risks" value={summary.dangerousRoleCount || 0} detail="Administrator roles" theme={theme} />
          <HealthCard title="Modules" value={summary.moduleIssueCount || 0} detail={`${summary.moduleConfiguredCount || 0} targets`} theme={theme} />
        </div>
      </section>

      {error ? <section style={{ ...card, color: '#fca5a5' }}>{error}</section> : null}
      {!selectedGuild ? <HealthyPanel theme={theme} title="Select a guild to scan" text="Choose a server from Owner View to inspect permissions, roles and module readiness." /> : null}
      {allHealthy ? <HealthyPanel theme={theme} title="Everything looks healthy" text="All permission, role hierarchy, channel access and module readiness checks passed for this server." /> : null}

      <CollapsibleCard id="categories" title="Diagnostic Categories" subtitle="High-level health groups from the backend scan." open={open.categories} setOpen={setOpen} theme={theme}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,240px),1fr))', gap: 12 }}>
          {categories.length ? categories.map((category) => <CategoryCard key={category.key} category={category} theme={theme} />) : <Muted theme={theme}>No categories returned yet. Run or refresh the scan to populate diagnostics.</Muted>}
        </div>
      </CollapsibleCard>

      <CollapsibleCard id="recommendations" title="Recommendations" subtitle="Priority fixes generated from the scan." open={open.recommendations} setOpen={setOpen} theme={theme}>
        <div style={{ display: 'grid', gap: 10 }}>
          {recommendations.length ? recommendations.map((item, index) => <IssueRow key={`${item}-${index}`} title={`Recommendation ${index + 1}`} detail={item} meta="Review this item in Discord, then refresh the scan." theme={theme} />) : <HealthyPanel theme={theme} title="No recommendations" text="Server health looks clean. Priority fixes will appear here if future scans find issues." compact />}
        </div>
      </CollapsibleCard>

      <CollapsibleCard id="modules" title="Module Readiness" subtitle="Mapped module configuration against channel and role scans." open={open.modules} setOpen={setOpen} theme={theme}>
        {loading ? <Muted theme={theme}>Scanning module diagnostics...</Muted> : moduleSections.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 12 }}>
            {moduleSections.map((section) => <ModuleCard key={section.key} section={section} theme={theme} />)}
          </div>
        ) : <HealthyPanel theme={theme} title="No module issues returned" text="Module readiness checks will appear here when configured targets are scanned." compact />}
      </CollapsibleCard>

      <CollapsibleCard id="permissions" title="Bot Permissions" subtitle="Required and recommended Goliath server permissions." open={open.permissions} setOpen={setOpen} theme={theme}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,260px),1fr))', gap: 12 }}>
          <DetailCard theme={theme} label="Result" value={health?.basePermissions?.message || 'Run a scan to check permissions.'} />
          <DetailCard theme={theme} label="Missing Required" value={formatList(health?.basePermissions?.missingPermissions)} danger={health?.basePermissions?.missingPermissions?.length > 0} hint={health?.basePermissions?.missingPermissions?.length ? 'Fix these first. Required permissions can break core modules.' : 'All required permissions look good.'} />
          <DetailCard theme={theme} label="Missing Recommended" value={formatList(health?.basePermissions?.missingRecommendedPermissions)} danger={health?.basePermissions?.missingRecommendedPermissions?.length > 0} hint={health?.basePermissions?.missingRecommendedPermissions?.length ? 'Recommended permissions improve module coverage.' : 'No recommended permission gaps found.'} />
          <DetailCard theme={theme} label="Goliath Highest Role" value={health?.basePermissions?.botRoleName || 'Unknown'} hint={health?.basePermissions?.botRoleId || ''} />
        </div>
      </CollapsibleCard>

      <CollapsibleCard id="roles" title="Role Hierarchy & Security Risks" subtitle="Roles Goliath cannot manage plus Administrator role warnings." open={open.roles} setOpen={setOpen} theme={theme}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: 12 }}>
          <section style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Hierarchy Issues</h3>
            {loading ? <Muted theme={theme}>Scanning roles...</Muted> : roleIssues.length ? roleIssues.slice(0, 12).map((issue) => <IssueRow key={issue.roleId} title={`@${issue.roleName || issue.roleId}`} detail={issue.message} meta={issue.fix || issue.reason} theme={theme} />) : <HealthyPanel theme={theme} title="No role hierarchy issues" text="Goliath can manage the roles returned by the scan." compact />}
          </section>
          <section style={{ display: 'grid', gap: 10 }}>
            <h3 style={{ margin: 0 }}>Administrator Roles</h3>
            {dangerousRoles.length ? dangerousRoles.slice(0, 12).map((role) => <IssueRow key={role.roleId} title={`@${role.roleName || role.roleId}`} detail={role.message} meta="Review whether this role really needs Administrator." theme={theme} />) : <HealthyPanel theme={theme} title="No administrator role warnings" text="No risky administrator-role warnings were returned by the scan." compact />}
          </section>
        </div>
      </CollapsibleCard>

      <CollapsibleCard id="channels" title="Channel Access Issues" subtitle="Channels/categories where Goliath is missing required access." open={open.channels} setOpen={setOpen} theme={theme}>
        {loading ? <Muted theme={theme}>Scanning channels...</Muted> : channelIssues.length ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,280px),1fr))', gap: 10 }}>
            {channelIssues.slice(0, 24).map((issue) => <IssueRow key={issue.channelId} title={`#${issue.channelName || issue.channelId}`} detail={issue.result?.message} meta={formatList(issue.result?.missingPermissions)} theme={theme} />)}
          </div>
        ) : <HealthyPanel theme={theme} title="No channel access issues" text="Goliath can access the channels returned by the scan." compact />}
      </CollapsibleCard>
    </div>
  );
}

function buttonStyle(theme) {
  return { border: '1px solid ' + theme.cardBorder, background: theme.softBg || 'rgba(15,23,42,0.72)', color: theme.cardText, borderRadius: 12, padding: '10px 14px', cursor: 'pointer', fontWeight: 900 };
}

function StatusPill({ status }) {
  return <span style={{ border: `1px solid ${statusColor(status)}`, color: statusColor(status), background: `${statusColor(status)}18`, borderRadius: 999, padding: '8px 12px', fontSize: 12, fontWeight: 950, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{getStatusLabel(status)}</span>;
}

function HealthCard({ title, value, detail, theme }) {
  return <div style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, borderRadius: 18, padding: 16, boxShadow: theme.shadow, minHeight: 112, display: 'grid', alignContent: 'space-between', gap: 10, minWidth: 0, overflow: 'hidden' }}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div><div style={{ fontSize: 24, fontWeight: 950, wordBreak: 'break-word' }}>{value}</div><div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{detail}</div></div>;
}

function CollapsibleCard({ id, title, subtitle, open, setOpen, theme, children }) {
  return <section style={{ border: '1px solid ' + theme.cardBorder, background: theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, overflow: 'hidden' }}><button type="button" onClick={() => setOpen((current) => ({ ...current, [id]: !current[id] }))} title={open ? 'Click to collapse' : 'Click to expand'} style={{ width: '100%', border: 0, background: 'transparent', color: theme.cardText, padding: 18, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', cursor: 'pointer', textAlign: 'left' }}><span style={{ display: 'grid', gap: 5 }}><strong style={{ fontSize: 19 }}>{title}</strong><span style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.45 }}>{subtitle}</span></span><span style={{ color: theme.mutedText, fontWeight: 950 }}>{open ? 'Collapse' : 'Expand'}</span></button>{open ? <div style={{ padding: '0 18px 18px' }}>{children}</div> : null}</section>;
}

function CategoryCard({ category, theme }) {
  const color = statusColor(category.status);
  return <div style={{ border: `1px solid ${color}55`, background: `${color}12`, borderRadius: 16, padding: 14, display: 'grid', gap: 8 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><strong>{category.label}</strong><StatusPill status={category.status} /></div><div style={{ color: theme.mutedText, fontSize: 13, lineHeight: 1.5 }}>{category.description}</div><div style={{ color: theme.cardText, fontWeight: 900 }}>{plural(category.issueCount, 'issue')} · {plural(category.checkedCount, 'checked')}</div></div>;
}

function DetailCard({ theme, label, value, hint, danger }) {
  return <div style={{ border: '1px solid ' + theme.cardBorder, background: danger ? 'rgba(239,68,68,0.10)' : 'rgba(15,23,42,0.18)', borderRadius: 14, padding: 13, minWidth: 0 }}><div style={{ color: theme.mutedText, fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div><div style={{ marginTop: 7, color: danger ? '#fca5a5' : theme.cardText, fontWeight: 950, overflowWrap: 'anywhere' }}>{value}</div>{hint ? <div style={{ color: theme.mutedText, marginTop: 5, fontSize: 12, overflowWrap: 'anywhere' }}>{hint}</div> : null}</div>;
}

function ModuleCard({ section, theme }) {
  const hasIssues = Number(section.issueCount || 0) > 0;
  return <div style={{ border: '1px solid ' + (hasIssues ? 'rgba(239,68,68,0.35)' : theme.cardBorder), borderRadius: 16, padding: 14, background: hasIssues ? 'rgba(239,68,68,0.10)' : 'rgba(15,23,42,0.18)', minWidth: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}><div style={{ minWidth: 0 }}><strong>{section.label}</strong><div style={{ color: statusColor(section.status), marginTop: 5, fontWeight: 900 }}>{getStatusLabel(section.status)}</div></div><span style={{ color: hasIssues ? '#fca5a5' : '#86efac', fontWeight: 900 }}>{plural(section.issueCount, 'issue')}</span></div><div style={{ color: theme.mutedText, marginTop: 10, fontSize: 13, lineHeight: 1.45 }}>{plural(section.configuredCount, 'configured target')} · {plural(section.channelIssueCount, 'channel issue')} · {plural(section.roleIssueCount, 'role issue')}</div>{section.notes?.length ? <div style={{ color: theme.mutedText, marginTop: 8, fontSize: 13, lineHeight: 1.45 }}>{section.notes.slice(0, 2).join(' ')}</div> : null}{hasIssues ? <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>{(section.channelIssues || []).slice(0, 2).map((issue) => <IssueRow key={`channel-${issue.channelId}`} title={`#${issue.channelName || issue.channelId}`} detail={issue.result?.message} meta={formatList(issue.result?.missingPermissions)} theme={theme} />)}{(section.roleIssues || []).slice(0, 2).map((issue) => <IssueRow key={`role-${issue.roleId}`} title={`@${issue.roleName || issue.roleId}`} detail={issue.message} meta={issue.fix || issue.reason} theme={theme} />)}</div> : <div style={{ color: theme.mutedText, marginTop: 10, fontSize: 13 }}>{section.recommendation}</div>}</div>;
}

function IssueRow({ title, detail, meta, theme }) {
  return <div style={{ border: '1px solid ' + theme.cardBorder, borderRadius: 14, padding: 12, background: 'rgba(15,23,42,0.18)', minWidth: 0 }}><strong style={{ wordBreak: 'break-word' }}>{title}</strong><div style={{ color: theme.mutedText, marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>{detail}</div>{meta ? <div style={{ color: '#fbbf24', marginTop: 6, fontSize: 13, lineHeight: 1.45, wordBreak: 'break-word' }}>Fix: {meta}</div> : null}</div>;
}

function HealthyPanel({ theme, title, text, compact = false }) {
  return <div style={{ border: `1px dashed ${theme.cardBorder}`, background: 'rgba(15,23,42,0.20)', borderRadius: 16, padding: compact ? 14 : 18, display: 'grid', gap: 6, textAlign: 'center', color: theme.mutedText }}><strong style={{ color: theme.cardText }}>{E.SUCCESS} {title}</strong><span style={{ lineHeight: 1.5 }}>{text}</span></div>;
}

function Muted({ theme, children }) {
  return <div style={{ color: theme.mutedText, lineHeight: 1.5 }}>{children}</div>;
}
