const express = require('express');
const security = require('../../core/security/protection/core');

const router = express.Router();

/* ---------------- HELPERS ---------------- */

function isProduction() {
return process.env.NODE_ENV === 'production';
}

function isDebug() {
return String(process.env.DEBUG || '').toLowerCase() === 'true';
}

function env(name) {
return String(process.env[name] || '').trim();
}

function firstEnv(names, fallback = '') {
for (const name of names) {
const value = env(name);

if (value) {
  return value;
}

}

return fallback;
}

function getAuthConfig() {
return {
clientId: firstEnv(['DISCORD_CLIENT_ID', 'CLIENT_ID']),
clientSecret: firstEnv(['DISCORD_CLIENT_SECRET', 'CLIENT_SECRET']),
redirectUri: firstEnv(['DISCORD_REDIRECT_URI']),
clientUrl: firstEnv(
['CLIENT_URL', 'DASHBOARD_CLIENT_URL', 'VITE_CLIENT_URL'],
'https://goliath.ksjdigital.co.uk'
),
};
}

function getCookieOptions() {
return {
httpOnly: true,
secure: isProduction(),
sameSite: isProduction() ? 'none' : 'lax',
path: '/',
};
}

function buildAvatarUrl(user) {
if (!user?.id || !user?.avatar) return null;

const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';

return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
}

function safeRedirectUrl(url) {
return String(url || 'https://goliath.ksjdigital.co.uk').replace(/\/+$/, '');
}

/* ---------------- LOGIN ROUTE ---------------- */

router.get('/login', (req, res) => {
const { clientId, clientSecret, redirectUri } = getAuthConfig();

if (!clientId || !redirectUri) {
return res.status(500).json({
error: 'Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI',
});
}

if (!clientSecret) {
return res.status(500).json({
error: 'Missing DISCORD_CLIENT_SECRET',
});
}

const params = new URLSearchParams({
client_id: clientId,
response_type: 'code',
redirect_uri: redirectUri,
scope: 'identify guilds',
});

const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

if (isDebug()) {
console.log('[AUTH] OAuth URL:', authUrl);
}

return res.redirect(authUrl);
});

/* ---------------- CHECK AUTH ---------------- */

router.get('/me', (req, res) => {
if (!req.session?.user) {
return res.status(401).json({
authenticated: false,
user: null,
});
}

return res.json({
authenticated: true,
user: {
...req.session.user,
isOwner: security.isBotOwner(req.session.user.id),
},
});
});

/* ---------------- LOGOUT ---------------- */

router.post('/logout', (req, res) => {
if (!req.session) {
res.clearCookie('goliath_dashboard_session', getCookieOptions());
return res.json({ success: true });
}

req.session.destroy((error) => {
if (error) {
console.error('❌ Logout session destroy failed', error);
return res.status(500).json({ error: 'Logout failed' });
}

res.clearCookie('goliath_dashboard_session', getCookieOptions());

return res.json({ success: true });

});
});

/* ---------------- CALLBACK ---------------- */

router.get('/callback', async (req, res) => {
try {
const code = String(req.query.code || '').trim();

if (!code) {
  return res.status(400).send('Missing OAuth code.');
}

const {
  clientId,
  clientSecret,
  redirectUri,
  clientUrl,
} = getAuthConfig();

if (!clientId || !clientSecret || !redirectUri) {
  console.error('❌ OAuth config missing', {
    hasClientId: Boolean(clientId),
    hasClientSecret: Boolean(clientSecret),
    hasRedirectUri: Boolean(redirectUri),
  });

  return res.status(500).send('OAuth configuration error.');
}

const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }),
});

const tokenData = await tokenResponse.json().catch(() => ({}));

if (!tokenResponse.ok) {
  console.error('❌ Discord token error', tokenData);

  const errorDescription =
    typeof tokenData?.error_description === 'string'
      ? tokenData.error_description
      : '';

  if (errorDescription.toLowerCase().includes('rate limited')) {
    return res
      .status(429)
      .send('Discord OAuth rate limited. Try again later.');
  }

  return res.status(500).send('OAuth failed.');
}

if (!tokenData.access_token) {
  console.error('❌ Discord token response missing access_token', tokenData);
  return res.status(500).send('OAuth failed.');
}

const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
  headers: {
    Authorization: `Bearer ${tokenData.access_token}`,
  },
});

const userData = await userResponse.json().catch(() => ({}));

if (!userResponse.ok) {
  console.error('❌ Discord user fetch failed', userData);
  return res.status(500).send('Failed to fetch user.');
}

req.session.user = {
  id: userData.id,
  username: userData.username,
  global_name: userData.global_name || null,
  globalName: userData.global_name || null,
  displayName: userData.global_name || userData.username || 'User',
  avatar: userData.avatar || null,
  avatarUrl: buildAvatarUrl(userData),
  isOwner: security.isBotOwner(userData.id),
};

req.session.accessToken = tokenData.access_token;
req.session.refreshToken = tokenData.refresh_token || null;
req.session.tokenType = tokenData.token_type || 'Bearer';

if (isDebug()) {
  console.log('[AUTH] User logged in:', req.session.user.username);
}

req.session.save((saveError) => {
  if (saveError) {
    console.error('❌ Session save failed', saveError);
    return res.status(500).send('Session error.');
  }

  return res.redirect(`${safeRedirectUrl(clientUrl)}/`);
});

} catch (error) {
console.error('❌ Auth error', error);
return res.status(500).send('Authentication failed.');
}
});

module.exports = router;
