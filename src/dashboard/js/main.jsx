import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import Appeals from './pages/moderation/Appeals';

window.__GOLIATH_APPEALS_ENTRY__ = 'GOLIATH_APPEALS_ENTRY';

const root = ReactDOM.createRoot(document.getElementById('root'));

function parseAppealReference(value) {
  const raw = String(value || '').replace(/^[#?]/, '');
  if (!raw) return null;
  const params = new URLSearchParams(raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw);
  const guild = String(params.get('guild') || '').trim();
  const caseId = String(params.get('case') || '').trim();
  if (/^\d{16,20}$/.test(guild) && /^\d{1,12}$/.test(caseId) && Number(caseId) > 0) {
    return { guild, caseId: String(Number(caseId)) };
  }
  return null;
}

function getAppealReference() {
  for (const candidate of [window.location.search, window.location.hash]) {
    const reference = parseAppealReference(candidate);
    if (reference) return reference;
  }
  return null;
}

function getOAuthAppealReturn() {
  const match = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('goliath_oauth_return='));
  if (!match) return null;
  try {
    const value = decodeURIComponent(match.slice('goliath_oauth_return='.length));
    if (value !== '/appeals' && !value.startsWith('/appeals?')) return null;
    return { path: '/appeals', reference: parseAppealReference(value) };
  } catch {
    return null;
  }
}

let pathname = window.location.pathname.replace(/\/+$/, '') || '/';
let appealReference = getAppealReference();
let oauthAppealReturn = null;

if (pathname === '/overview' || pathname === '/') {
  oauthAppealReturn = getOAuthAppealReturn();
  if (!appealReference && oauthAppealReturn?.reference) appealReference = oauthAppealReturn.reference;
}

const isAppealsPath = pathname === '/appeals' || pathname.endsWith('/appeals');
const isRecoveredAppealPath = Boolean(oauthAppealReturn) && (pathname === '/overview' || pathname === '/');

if ((isAppealsPath || isRecoveredAppealPath) && pathname !== '/appeals') {
  const params = new URLSearchParams();
  if (appealReference) {
    params.set('guild', appealReference.guild);
    params.set('case', appealReference.caseId);
  }
  const query = params.toString();
  window.history.replaceState({}, '', query ? `/appeals?${query}` : '/appeals');
  document.cookie = 'goliath_oauth_return=; Max-Age=0; Path=/; SameSite=Lax';
  pathname = '/appeals';
}

const RootComponent = pathname === '/appeals' ? Appeals : App;

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <RootComponent />
    </BrowserRouter>
  </React.StrictMode>
);
