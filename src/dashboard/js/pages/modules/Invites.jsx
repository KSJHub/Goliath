import React, { useEffect, useMemo, useState } from 'react';
import EmptyState from '../../shared/EmptyState.jsx';
import { api } from '../../services/apiClient.js';
import { ChannelSelect, RoleSelect } from '../../ui/DiscordResourceSelects.jsx';

const guildIdOf = (selectedGuild, data) => String(data?.guildId || data?.id || selectedGuild || '').split(':').pop().trim();
const list = (payload, key) => Array.isArray(payload?.[key]) ? payload[key] : Array.isArray(payload) ? payload : [];
const emptyReward = { roleId: '', invites: 5 };
const emptyDraft = { channelId: '', roleIds: [], maxAge: 2592000, maxUses: 0, temporary: false };
const expiryOptions = [[1800,'30 minutes'],[3600,'1 hour'],[21600,'6 hours'],[43200,'12 hours'],[86400,'1 day'],[604800,'7 days'],[2592000,'30 days'],[0,'Never']];
const useOptions = [[0,'No limit'],[1,'1 use'],[5,'5 uses'],[10,'10 uses'],[25,'25 uses'],[50,'50 uses'],[100,'100 uses']];
const tabs = [
  ['links', 'Invite Links'],
  ['analytics', 'Analytics'],
  ['rewards', 'Rewards'],
  ['history', 'Join History'],
  ['health', 'Health'],
  ['settings', 'Settings'],
];

function button(theme, tone = 'default', active = false) {
  const bg = { primary: 'rgba(37,99,235,.24)', success: 'rgba(22,163,74,.24)', danger: 'rgba(220,38,38,.24)', default: 'rgba(15,23,42,.45)' };
  return { border: `1px solid ${active ? theme.accent || '#5865f2' : theme.cardBorder}`, background: active ? 'rgba(88,101,242,.3)' : bg[tone], color: theme.cardText, borderRadius: 12, padding: '10px 14px', fontWeight: 900, cursor: 'pointer' };
}
function field(theme) { return { width: '100%', border: `1px solid ${theme.cardBorder}`, background: 'rgba(15,23,42,.45)', color: theme.cardText, borderRadius: 12, padding: '10px 12px' }; }
function Card({ theme, children }) { return <section style={{ border: `1px solid ${theme.cardBorder}`, background: theme.cardBg, color: theme.cardText, borderRadius: 20, boxShadow: theme.shadow, padding: 20 }}>{children}</section>; }
function Stat({ theme, label, value, detail }) { return <Card theme={theme}><div style={{ color: theme.mutedText, fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>{label}</div><div style={{ fontSize: 28, fontWeight: 950, marginTop: 7 }}>{value}</div>{detail && <div style={{ color: theme.mutedText, marginTop: 5, fontSize: 12 }}>{detail}</div>}</Card>; }
function roleName(roles, roleId) { return roles.find((role) => String(role.id) === String(roleId))?.name || roleId; }
function channelName(channels, channelId) { return channels.find((channel) => String(channel.id) === String(channelId))?.name || channelId || 'Unknown'; }

export default function Invites({ theme, selectedGuild, selectedGuildData }) {
  const guildId = guildIdOf(selectedGuild, selectedGuildData);
  const [activeTab, setActiveTab] = useState('links');
  const [config, setConfig] = useState(null);
  const [inviteLinks, setInviteLinks] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [history, setHistory] = useState([]);
  const [health, setHealth] = useState(null);
  const [channels, setChannels] = useState([]);
  const [roles, setRoles] = useState([]);
  const [reward, setReward] = useState(emptyReward);
  const [draft, setDraft] = useState(emptyDraft);
  const [bonus, setBonus] = useState({ userId: '', value: 0 });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const settings = config?.settings || {};
  const analytics = config?.analytics || {};
  const cardGrid = useMemo(() => ({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }), []);

  async function load() {
    if (!guildId) return;
    setError('');
    try {
      const [main, hist, healthData, channelData, roleData] = await Promise.all([
        api.request(`/api/invites/${guildId}`),
        api.request(`/api/invites/${guildId}/history?limit=250`),
        api.request(`/api/invites/${guildId}/health`),
        api.getGuildChannels(guildId),
        api.getGuildRoles(guildId),
      ]);
      setConfig(main.config || {});
      setInviteLinks(main.inviteLinks || []);
      setLeaderboard(main.leaderboard || []);
      setHistory(hist.history || []);
      setHealth(healthData.health || null);
      setChannels(list(channelData, 'channels'));
      setRoles(list(roleData, 'roles'));
    } catch (e) { setError(e.message || 'Failed to load Invite Studio.'); }
  }

  useEffect(() => { load(); }, [guildId]);

  async function action(name, fn, success) {
    setBusy(name); setError(''); setNotice('');
    try { const result = await fn(); setNotice(success || 'Action completed.'); await load(); return result; }
    catch (e) { setError(e.message || 'Invite Studio action failed.'); return null; }
    finally { setBusy(''); }
  }

  function saveSettings(patch) {
    return action('settings', () => api.request(`/api/invites/${guildId}/settings`, { method: 'PATCH', body: JSON.stringify({ settings: { ...settings, ...patch } }) }), 'Settings saved.');
  }
  function addReward() {
    if (!reward.roleId) return;
    const rewards = [...(settings.rewardRoles || []).filter((item) => item.roleId !== reward.roleId), { roleId: reward.roleId, invites: Number(reward.invites || 1) }].sort((a, b) => a.invites - b.invites);
    saveSettings({ rewardRoles: rewards });
    setReward(emptyReward);
  }
  function removeReward(roleId) { saveSettings({ rewardRoles: (settings.rewardRoles || []).filter((item) => item.roleId !== roleId) }); }
  function toggleRole(roleId) { setDraft((current) => ({ ...current, roleIds: current.roleIds.includes(roleId) ? current.roleIds.filter((id) => id !== roleId) : [...current.roleIds, roleId].slice(0, 25) })); }
  async function createLink() {
    if (!draft.channelId) { setError('Choose an invite channel.'); return; }
    const result = await action('create-link', () => api.request(`/api/invites/${guildId}/links`, { method: 'POST', body: JSON.stringify(draft) }), 'Invite link generated.');
    if (result?.invite?.url) setNotice(`Invite created: ${result.invite.url}`);
    if (result) setDraft(emptyDraft);
  }
  async function copyLink(code) {
    const url = `https://discord.gg/${code}`;
    try { await navigator.clipboard.writeText(url); setNotice(`Copied ${url}`); }
    catch { setError('Could not copy the invite link.'); }
  }

  if (!guildId) return <EmptyState theme={theme} icon="✉️" title="Select a server" description="Select a server to manage Invite Studio." />;

  const activeReferrals = leaderboard.reduce((total, item) => total + Number(item.active || 0), 0);
  const departedReferrals = leaderboard.reduce((total, item) => total + Number(item.left || 0), 0);
  const totalUses = inviteLinks.reduce((total, link) => total + Number(link.uses || 0), 0);

  return <div style={{ display: 'grid', gap: 16 }}>
    <Card theme={theme}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:16, flexWrap:'wrap' }}>
        <div><h1 style={{ margin: 0 }}>Invite Studio</h1><p style={{ color: theme.mutedText, marginBottom: 0 }}>Create role-aware Discord invites, track referrals, inspect join history and manage rewards from one module.</p></div>
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          <button style={button(theme, config?.enabled ? 'danger' : 'success')} disabled={busy} onClick={() => action('enabled', () => api.request(`/api/invites/${guildId}/enabled`, { method: 'PATCH', body: JSON.stringify({ enabled: !config?.enabled }) }), 'Module status updated.')}>{config?.enabled ? 'Disable Module' : 'Enable Module'}</button>
          <button style={button(theme,'success')} disabled={busy} onClick={() => action('sync', () => api.request(`/api/invites/${guildId}/sync`, { method: 'POST' }), 'Invite cache synchronized.')}>Sync Invites</button>
        </div>
      </div>
    </Card>

    <div style={cardGrid}>
      <Stat theme={theme} label="Status" value={config?.enabled ? 'Enabled' : 'Disabled'} />
      <Stat theme={theme} label="Invite Links" value={inviteLinks.length} detail={`${totalUses} recorded uses`} />
      <Stat theme={theme} label="Tracked Joins" value={analytics.tracked || 0} detail={`${analytics.unknown || 0} unknown`} />
      <Stat theme={theme} label="Active Referrals" value={activeReferrals} detail={`${departedReferrals} departed`} />
      <Stat theme={theme} label="Roles Granted" value={analytics.inviteRolesGranted || 0} />
      <Stat theme={theme} label="Health" value={health?.healthy ? 'Healthy' : 'Attention'} detail={health ? `${health.issues?.length || 0} issues` : 'Not checked'} />
    </div>

    {(error || notice) && <Card theme={theme}><strong style={{ color: error ? '#fca5a5' : '#86efac' }}>{error || notice}</strong></Card>}

    <Card theme={theme}><div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>{tabs.map(([key,label]) => <button key={key} style={button(theme, 'default', activeTab === key)} onClick={() => setActiveTab(key)}>{label}</button>)}</div></Card>

    {activeTab === 'links' && <>
      <Card theme={theme}><h2 style={{ marginTop: 0 }}>Create invite link</h2><p style={{ color: theme.mutedText }}>Choose the same core settings Discord provides. Members joining through this link receive the selected roles automatically.</p>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12 }}>
          <ChannelSelect theme={theme} resources={channels} value={draft.channelId} onChange={(channelId)=>setDraft((current)=>({...current,channelId}))} label="Invite channel" />
          <label style={{ display:'grid',gap:8 }}><span style={{ color:theme.mutedText,fontSize:12,fontWeight:900,textTransform:'uppercase' }}>Expire after</span><select style={field(theme)} value={draft.maxAge} onChange={(event)=>setDraft((current)=>({...current,maxAge:Number(event.target.value)}))}>{expiryOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <label style={{ display:'grid',gap:8 }}><span style={{ color:theme.mutedText,fontSize:12,fontWeight:900,textTransform:'uppercase' }}>Max number of uses</span><select style={field(theme)} value={draft.maxUses} onChange={(event)=>setDraft((current)=>({...current,maxUses:Number(event.target.value)}))}>{useOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div style={{ marginTop:14 }}><div style={{ color:theme.mutedText,fontSize:12,fontWeight:900,textTransform:'uppercase',marginBottom:8 }}>Roles (optional)</div><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:8,maxHeight:220,overflowY:'auto',border:`1px solid ${theme.cardBorder}`,borderRadius:14,padding:12 }}>{roles.filter((role)=>role.name !== '@everyone' && !role.managed).map((role)=><label key={role.id} style={{ display:'flex',gap:8,alignItems:'center' }}><input type="checkbox" checked={draft.roleIds.includes(String(role.id))} onChange={()=>toggleRole(String(role.id))}/><span>{role.name}</span></label>)}</div></div>
        <label style={{ display:'flex',gap:10,alignItems:'center',marginTop:14 }}><input type="checkbox" checked={draft.temporary} onChange={(event)=>setDraft((current)=>({...current,temporary:event.target.checked}))}/><span><strong>Grant temporary membership</strong><br/><small style={{ color:theme.mutedText }}>Discord removes temporary members when they disconnect unless a role has been assigned.</small></span></label>
        <div style={{ display:'flex',justifyContent:'flex-end',gap:10,marginTop:16 }}><button style={button(theme)} onClick={()=>setDraft(emptyDraft)}>Clear</button><button style={button(theme,'primary')} disabled={busy || !draft.channelId} onClick={createLink}>Generate Invite</button></div>
      </Card>

      <Card theme={theme}><h2 style={{ marginTop:0 }}>Active invite links</h2><div style={{ overflowX:'auto' }}><table style={{ width:'100%',borderCollapse:'collapse' }}><thead><tr><th align="left">Invite</th><th align="left">Channel</th><th>Uses</th><th>Expires</th><th align="left">Roles</th><th>Temporary</th><th></th></tr></thead><tbody>{inviteLinks.map((link)=><tr key={link.code}><td><code>{link.code}</code></td><td>{channelName(channels, link.channelId)}</td><td align="center">{link.uses}{link.maxUses ? `/${link.maxUses}` : ''}</td><td align="center">{link.expiresAt ? new Date(link.expiresAt).toLocaleString() : 'Never'}</td><td>{link.roleIds?.length ? link.roleIds.map((id)=>roleName(roles,id)).join(', ') : 'None'}</td><td align="center">{link.temporary ? 'Yes' : 'No'}</td><td align="right"><div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}><button style={button(theme)} onClick={()=>copyLink(link.code)}>Copy</button><button style={button(theme,'danger')} disabled={busy} onClick={()=>window.confirm(`Delete invite ${link.code}?`) && action('delete-link',()=>api.request(`/api/invites/${guildId}/links/${link.code}`,{method:'DELETE'}),'Invite deleted.')}>Delete</button></div></td></tr>)}</tbody></table>{!inviteLinks.length && <p style={{ color:theme.mutedText }}>No Invite Studio links have been created.</p>}</div></Card>
    </>}

    {activeTab === 'analytics' && <>
      <div style={cardGrid}><Stat theme={theme} label="Joins" value={analytics.joins || 0} /><Stat theme={theme} label="Tracked" value={analytics.tracked || 0} /><Stat theme={theme} label="Unknown" value={analytics.unknown || 0} /><Stat theme={theme} label="Leaves" value={analytics.leaves || 0} /><Stat theme={theme} label="Fake Flags" value={analytics.fake || 0} /><Stat theme={theme} label="Failures" value={analytics.failures || 0} /></div>
      <Card theme={theme}><h2 style={{ marginTop:0 }}>Leaderboard</h2><div style={{ overflowX:'auto' }}><table style={{ width:'100%',borderCollapse:'collapse' }}><thead><tr><th align="left">Inviter</th><th>Active</th><th>Total</th><th>Left</th><th>Fake</th><th>Bonus</th><th>Score</th></tr></thead><tbody>{leaderboard.map((item)=><tr key={item.inviterId}><td><code>{item.inviterId}</code></td><td align="center">{item.active}</td><td align="center">{item.total}</td><td align="center">{item.left}</td><td align="center">{item.fake}</td><td align="center">{item.bonus}</td><td align="center"><strong>{item.score}</strong></td></tr>)}</tbody></table>{!leaderboard.length && <p style={{ color:theme.mutedText }}>No invite activity has been attributed yet.</p>}</div></Card>
    </>}

    {activeTab === 'rewards' && <>
      <Card theme={theme}><h2 style={{ marginTop:0 }}>Reward roles</h2><p style={{ color:theme.mutedText }}>Reward roles go to inviters when they reach an active-referral milestone.</p><div style={{ display:'grid',gridTemplateColumns:'2fr 1fr auto',gap:10,alignItems:'end' }}><RoleSelect theme={theme} resources={roles} value={reward.roleId} onChange={(roleId)=>setReward((current)=>({...current,roleId}))} label="Reward role"/><label>Invites<input style={field(theme)} type="number" min="1" value={reward.invites} onChange={(event)=>setReward((current)=>({...current,invites:Number(event.target.value)}))}/></label><button style={button(theme,'success')} onClick={addReward}>Add</button></div><div style={{ display:'grid',gap:8,marginTop:12 }}>{(settings.rewardRoles || []).map((item)=><div key={item.roleId} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',gap:10 }}><span><strong>{item.invites}</strong> invites → {roleName(roles,item.roleId)}</span><button style={button(theme,'danger')} onClick={()=>removeReward(item.roleId)}>Remove</button></div>)}{!(settings.rewardRoles || []).length && <p style={{ color:theme.mutedText }}>No reward milestones configured.</p>}</div></Card>
      <Card theme={theme}><h2 style={{ marginTop:0 }}>Bonus adjustment</h2><div style={{ display:'grid',gridTemplateColumns:'2fr 1fr auto',gap:10 }}><input style={field(theme)} placeholder="Discord user ID" value={bonus.userId} onChange={(event)=>setBonus({...bonus,userId:event.target.value})}/><input style={field(theme)} type="number" value={bonus.value} onChange={(event)=>setBonus({...bonus,value:Number(event.target.value)})}/><button style={button(theme,'primary')} disabled={!bonus.userId} onClick={()=>action('bonus',()=>api.request(`/api/invites/${guildId}/inviters/${bonus.userId}/bonus`,{method:'PATCH',body:JSON.stringify({bonus:bonus.value})}),'Bonus updated.')}>Apply</button></div></Card>
    </>}

    {activeTab === 'history' && <Card theme={theme}><h2 style={{ marginTop:0 }}>Join history</h2><div style={{ display:'grid',gap:10 }}>{history.slice(0,250).map((entry)=><div key={entry.id} style={{ borderBottom:`1px solid ${theme.cardBorder}`,paddingBottom:10 }}><div style={{ display:'flex',justifyContent:'space-between',gap:10,flexWrap:'wrap' }}><strong>{entry.type}</strong><span style={{ color:theme.mutedText }}>{new Date(entry.at).toLocaleString()}</span></div><div style={{ color:theme.mutedText,marginTop:4 }}>{entry.memberId ? `Member: ${entry.memberId}` : ''}{entry.inviteCode ? ` · Invite: ${entry.inviteCode}` : ''}{entry.inviterId ? ` · Inviter: ${entry.inviterId}` : ''}{entry.roleIds?.length ? ` · Roles: ${entry.roleIds.map((id)=>roleName(roles,id)).join(', ')}` : ''}</div></div>)}{!history.length && <p style={{ color:theme.mutedText }}>No Invite Studio history yet.</p>}</div></Card>}

    {activeTab === 'health' && <>
      <Card theme={theme}><h2 style={{ marginTop:0 }}>Module health</h2><p style={{ color:theme.mutedText }}>Checks permissions, invite access, role hierarchy, configured channels and runtime synchronization.</p><div style={{ display:'flex',gap:10,flexWrap:'wrap' }}><button style={button(theme,'primary')} disabled={busy} onClick={()=>action('repair',()=>api.request(`/api/invites/${guildId}/repair`,{method:'POST'}),'Repair completed.')}>Run Repair</button><button style={button(theme)} disabled={busy} onClick={load}>Refresh Health</button><a style={{ ...button(theme),textDecoration:'none' }} href={`/api/invites/${guildId}/export`}>Export Data</a></div></Card>
      <Card theme={theme}><h3 style={{ marginTop:0 }}>{health?.healthy ? '✅ Healthy' : '⚠️ Attention required'}</h3><div style={{ display:'grid',gap:8 }}>{(health?.issues || []).map((issue,index)=><div key={`issue-${index}`}>❌ {issue.code || issue.reason || JSON.stringify(issue)}</div>)}{(health?.warnings || []).map((warning,index)=><div key={`warning-${index}`}>⚠️ {warning.code || warning.reason || JSON.stringify(warning)}</div>)}{health?.healthy && <div>No issues detected.</div>}</div></Card>
    </>}

    {activeTab === 'settings' && <>
      <Card theme={theme}><h2 style={{ marginTop:0 }}>Tracking and managed invite</h2><div style={{ display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(230px,1fr))',gap:12 }}><ChannelSelect theme={theme} resources={channels} value={settings.managedInviteChannelId || ''} onChange={(value)=>saveSettings({managedInviteChannelId:value})} label="Managed invite channel"/><ChannelSelect theme={theme} resources={channels} value={settings.logChannelId || ''} onChange={(value)=>saveSettings({logChannelId:value})} label="Invite log channel"/><label><input type="checkbox" checked={settings.trackingEnabled !== false} onChange={(event)=>saveSettings({trackingEnabled:event.target.checked})}/> Track joins</label><label><input type="checkbox" checked={settings.removeOnLeave !== false} onChange={(event)=>saveSettings({removeOnLeave:event.target.checked})}/> Remove active credit on leave</label><label><input type="checkbox" checked={settings.ignoreBots !== false} onChange={(event)=>saveSettings({ignoreBots:event.target.checked})}/> Ignore bots</label><label><input type="checkbox" checked={settings.autoRepair !== false} onChange={(event)=>saveSettings({autoRepair:event.target.checked})}/> Auto-repair managed invite</label></div><div style={{ display:'flex',gap:10,flexWrap:'wrap',marginTop:14 }}><button style={button(theme,'success')} disabled={busy || !settings.managedInviteChannelId} onClick={()=>action('managed',()=>api.request(`/api/invites/${guildId}/managed-invite`,{method:'POST',body:JSON.stringify({channelId:settings.managedInviteChannelId})}),'Managed invite created.')}>Create / Regenerate Managed Invite</button><button style={button(theme)} disabled={busy} onClick={()=>action('validate',()=>api.request(`/api/invites/${guildId}/managed-invite/validate`,{method:'POST'}),'Managed invite validated.')}>Validate</button>{settings.managedInviteCode && <code>discord.gg/{settings.managedInviteCode}</code>}</div></Card>
      <Card theme={theme}><h2 style={{ marginTop:0 }}>Danger zone</h2><p style={{ color:theme.mutedText }}>Reset removes Invite Studio configuration, tracking history and analytics for this server.</p><button style={button(theme,'danger')} disabled={busy} onClick={()=>window.confirm('Reset all Invite Studio data?') && action('reset',()=>api.request(`/api/invites/${guildId}/reset`,{method:'POST'}),'Invite Studio reset.')}>Reset Invite Studio</button></Card>
    </>}
  </div>;
}
