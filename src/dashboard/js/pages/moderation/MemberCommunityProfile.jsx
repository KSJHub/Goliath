import React, { useEffect, useState } from 'react';
import { api } from '../../services/apiClient';

export default function MemberCommunityProfile() {
  const [communities, setCommunities] = useState([]);
  const [guildId, setGuildId] = useState('');
  const [profile, setProfile] = useState(null);
  const [birthday, setBirthday] = useState({day:'',month:'',year:'',listPublic:false,announce:false,showAge:false});
  const [choices, setChoices] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const card = { background:'rgba(2,6,23,.35)', border:'1px solid rgba(148,163,184,.16)', borderRadius:16, padding:20 };
  const field = { background:'#08111f', color:'#f8fafc', border:'1px solid rgba(148,163,184,.28)', borderRadius:10, padding:'10px 12px', font:'inherit', maxWidth:'100%' };
  const button = { background:'#2563eb', color:'#fff', border:0, borderRadius:10, padding:'10px 14px', fontWeight:800, cursor:'pointer' };
  useEffect(() => {
    let active = true;
    api.request('/api/member-profile/communities').then(data => { if (!active) return; setCommunities(data.communities || []); setGuildId(data.communities?.[0]?.id || ''); }).catch(e => { if (active) setMessage(e.message || 'Could not load communities.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function loadProfile(id) {
    const data = await api.request('/api/member-profile/communities/' + encodeURIComponent(id));
    setProfile(data);
    setBirthday(data.birthday || {day:'',month:'',year:'',listPublic:false,announce:false,showAge:false});
    setChoices(Object.fromEntries((data.groups || []).map(g => [g.id, g.options.filter(o => o.selected).map(o => o.id)])));
  }
  useEffect(() => {
    let active = true;
    setProfile(null); setMessage('');
    if (!guildId) return undefined;
    api.request('/api/member-profile/communities/' + encodeURIComponent(guildId)).then(data => {
      if (!active) return;
      setProfile(data); setBirthday(data.birthday || {day:'',month:'',year:'',listPublic:false,announce:false,showAge:false});
      setChoices(Object.fromEntries((data.groups || []).map(g => [g.id, g.options.filter(o => o.selected).map(o => o.id)])));
    }).catch(e => { if (active) setMessage(e.message || 'Could not load this community.'); });
    return () => { active = false; };
  }, [guildId]);
  async function save(path, method, body, success) {
    setBusy(true); setMessage('');
    try {
      await api.request('/api/member-profile/communities/' + encodeURIComponent(guildId) + path, { method, ...(body ? { body:JSON.stringify(body) } : {}) });
      await loadProfile(guildId); setMessage(success);
    } catch (e) { setMessage(e.message || 'Could not save your changes.'); }
    finally { setBusy(false); }
  }
  return <div style={{display:'grid',gap:14,marginTop:18}}>
    <section style={card}>
      <h3 style={{margin:'0 0 8px'}}>🏘️ Your communities</h3>
      <p style={{color:'#a7b4c8',lineHeight:1.5}}>Choose a community to see your details and preferences.</p>
      {loading ? <p>Loading communities…</p> : communities.length ? <label>Community <select style={{...field,marginLeft:10}} value={guildId} onChange={e => setGuildId(e.target.value)}>{communities.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label> : <p>No shared communities found.</p>}
    </section>
    {message ? <div role="status" style={{...card,color:'#bfdbfe'}}>{message}</div> : null}
    {profile ? <>
      <section style={card}><h3 style={{marginTop:0}}>👤 Your community profile</h3>
        <p>Community: <strong>{profile.community.name}</strong></p>
        <p>Nickname: <strong>{profile.community.nickname || 'No server nickname'}</strong></p>
        <p>Joined: <strong>{profile.community.joinedAt ? new Date(profile.community.joinedAt).toLocaleDateString() : 'Unavailable'}</strong></p>
        <p>Your roles: {profile.community.roles.length ? profile.community.roles.map(r => r.name).join(', ') : 'No roles assigned'}</p>
      </section>
      <section style={card}><h3 style={{marginTop:0}}>🎂 Birthday & privacy</h3>
        {!profile.birthdayEnabled ? <p>Birthdays are not enabled in this community.</p> : <form onSubmit={e => {e.preventDefault(); save('/birthday','PUT',birthday,'Birthday settings saved.');}} style={{display:'grid',gap:12}}>
          <p style={{color:'#a7b4c8',margin:0}}>Choose whether your birthday appears on the public birthday list, is announced, or includes your age.</p>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <label>Day <input required type="number" min="1" max="31" style={{...field,width:70}} value={birthday.day} onChange={e => setBirthday({...birthday,day:e.target.value})} /></label>
            <label>Month <input required type="number" min="1" max="12" style={{...field,width:70}} value={birthday.month} onChange={e => setBirthday({...birthday,month:e.target.value})} /></label>
            <label>Year (optional) <input type="number" min="1900" style={{...field,width:95}} value={birthday.year || ''} onChange={e => setBirthday({...birthday,year:e.target.value})} /></label>
          </div>
          {[['listPublic','Show on the birthday list'],['announce','Allow birthday announcements'],['showAge','Show my age when a year is provided']].map(([key,label]) => <label key={key}><input type="checkbox" checked={!!birthday[key]} onChange={e => setBirthday({...birthday,[key]:e.target.checked})} /> {label}</label>)}
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}><button disabled={busy} style={button}>Save birthday</button>{profile.birthday ? <button disabled={busy} type="button" style={{...button,background:'#334155'}} onClick={() => {if (window.confirm('Remove your birthday from this community?')) save('/birthday','DELETE',null,'Birthday removed.');}}>Remove birthday</button> : null}</div>
        </form>}
      </section>
      <section style={card}><h3 style={{marginTop:0}}>🎭 Choose your roles</h3>
        {!profile.groups.length ? <p>No standard self-selectable roles are currently available here.</p> : profile.groups.map(g => <div key={g.id} style={{borderTop:'1px solid #334155',padding:'14px 0'}}>
          <strong>{g.name}</strong>{g.description ? <p style={{color:'#a7b4c8'}}>{g.description}</p> : null}
          <div style={{display:'grid',gap:8,margin:'10px 0'}}>{g.options.map(o => <label key={o.id}><input type={g.selectionMode === 'single' ? 'radio' : 'checkbox'} name={'role-'+g.id} checked={(choices[g.id] || []).includes(o.id)} onChange={e => setChoices({...choices,[g.id]:g.selectionMode === 'single' ? [o.id] : e.target.checked ? [...(choices[g.id] || []),o.id] : (choices[g.id] || []).filter(x => x !== o.id)})} /> {o.emoji} {o.label}</label>)}</div>
          <button disabled={busy} style={button} onClick={() => save('/roles/'+encodeURIComponent(g.id),'PUT',{options:choices[g.id] || []},'Roles updated.')}>Save roles</button>
          {g.allowRemove && (choices[g.id] || []).length ? <button disabled={busy} style={{...button,background:'#334155',marginLeft:8}} onClick={() => setChoices({...choices,[g.id]:[]})}>Clear selection</button> : null}
        </div>)}
      </section>
      <section style={card}><h3 style={{marginTop:0}}>📺 Creator accounts</h3>
        {profile.accounts.length ? profile.accounts.map((a,i) => <p key={i}><strong>{a.platform || 'Account'}</strong> · {a.username || 'Username unavailable'}{a.enabled ? '' : ' · Paused'}</p>) : <p>No creator accounts are connected in this community.</p>}
        <p style={{color:'#a7b4c8',fontSize:14}}>Manage creator accounts through Goliath’s /user Social Studio. A listed account is not necessarily verified.</p>
      </section>
    </> : null}
  </div>;
}
