from pathlib import Path
p=Path('src/modules/socialStudio/socialAlerts/socialStudioMonitorCore.js')
s=p.read_text()
anchor='function eventCandidates(account, previous, checked) {'
helper="""const DELIVERED_CONTENT_LEDGER_LIMIT = 500;
const CONTENT_ALERT_TYPES = new Set(['vod', 'clip', 'upload', 'short', 'post', 'reel']);

function deliveredContentLedger(previous, config, accountId) {
  const keys = [];
  const add = (key) => {
    const value = clean(key, 500);
    if (!value || keys.includes(value)) return;
    keys.push(value);
  };
  for (const key of Array.isArray(previous?.deliveredContentKeys) ? previous.deliveredContentKeys : []) add(key);
  if (previous?.lastAlertKey && !String(previous.lastAlertKey).startsWith('live:') && !String(previous.lastAlertKey).startsWith('ended:')) add(previous.lastAlertKey);
  for (const item of Array.isArray(config?.history) ? config.history : []) {
    if (String(item?.accountId || '') !== String(accountId || '')) continue;
    if (!CONTENT_ALERT_TYPES.has(String(item?.alertType || '').toLowerCase())) continue;
    if (!item?.eventId) continue;
    add(`${String(item.alertType).toLowerCase()}:${String(item.eventId)}`);
  }
  return keys.slice(-DELIVERED_CONTENT_LEDGER_LIMIT);
}

function rememberDeliveredContent(state, key) {
  const keys = Array.isArray(state.deliveredContentKeys) ? state.deliveredContentKeys.filter(Boolean) : [];
  const value = clean(key, 500);
  if (!value) return;
  state.deliveredContentKeys = [...keys.filter((item) => item !== value), value].slice(-DELIVERED_CONTENT_LEDGER_LIMIT);
}

"""
if 'function deliveredContentLedger(' not in s:
    assert anchor in s
    s=s.replace(anchor,helper+anchor,1)
old="""      const events = eventCandidates(account, previous, checked);
      for (const event of events) {
        const key = eventKey(event);
        if (config.settings.suppressDuplicates !== false && previous.lastAlertKey === key && event.type !== 'ended') continue;"""
new="""      const events = eventCandidates(account, previous, checked);
      state.deliveredContentKeys = deliveredContentLedger(previous, config, accountId);
      for (const event of events) {
        const key = eventKey(event);
        const contentEvent = CONTENT_ALERT_TYPES.has(String(event.type || '').toLowerCase());
        if (config.settings.suppressDuplicates !== false && event.type !== 'ended' && (previous.lastAlertKey === key || (contentEvent && state.deliveredContentKeys.includes(key)))) continue;"""
assert old in s
s=s.replace(old,new,1)
old2="""        state.lastAlertKey = key;
        state.lastAlertAt = now();
        state.lastAlertMessageId = delivery.messageId;"""
new2="""        state.lastAlertKey = key;
        state.lastAlertAt = now();
        if (CONTENT_ALERT_TYPES.has(String(event.type || '').toLowerCase())) rememberDeliveredContent(state, key);
        state.lastAlertMessageId = delivery.messageId;"""
assert old2 in s
p.write_text(s.replace(old2,new2,1))

t=Path('src/modules/socialStudio/socialAlerts/providers/twitch.js')
x=t.read_text()
x=x.replace('  const contentItems = candidates.slice(0, 1);','  const contentItems = candidates;')
t.write_text(x)
