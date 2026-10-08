const crypto = require('node:crypto');
const express = require('express');
const security = require('../../core/security/protection/core');

const router = express.Router();
// Hands an authenticated Appeals login directly back to the validated route
// using a no-cache HTML handoff instead of relying on SPA/hash redirect recovery.
const AUTH_FLOW_REVISION = 'appeals-state';

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
    if (value) return value;
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

function getOAuthReturnCookieOptions() {
  return {
    httpOnly: false,
    secure: isProduction(),
    sameSite: isProduction() ? 'none' : 'lax',
    path: '/',
    maxAge: 15 * 60 * 1000,
  };
}

function buildAvatarUrl(user) {
  if (!user?.id || !user?.avatar) return null;
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
}

function safeRedirectUrl(url) {
  try {
    return new URL(String(url || 'https://goliath.ksjdigital.co.uk')).origin;
  } catch {
    return 'https://goliath.ksjdigital.co.uk';
  }
}

function requestOrigin(req, fallbackUrl) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'https';
  const host = forwardedHost || String(req.get('host') || '').trim();
  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return safeRedirectUrl(fallbackUrl);
  }
}

function safeReturnPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  try {
    const parsed = new URL(raw, 'https://goliath.local');
    if (parsed.origin !== 'https://goliath.local' || parsed.pathname !== '/appeals') return '/';
    const params = new URLSearchParams();
    const guild = String(parsed.searchParams.get('guild') || '').trim();
    const caseId = String(parsed.searchParams.get('case') || '').trim();
    if (/^\d{16,20}$/.test(guild)) params.set('guild', guild);
    if (/^\d{1,12}$/.test(caseId) && Number(caseId) > 0) params.set('case', String(Number(caseId)));
    const query = params.toString();
    return query ? `/appeals?${query}` : '/appeals';
  } catch {
    return '/';
  }
}

function createOAuthState(returnPath, secret) {
  const payload = Buffer.from(JSON.stringify({
    returnPath: safeReturnPath(returnPath),
    issuedAt: Date.now(),
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readOAuthState(value, secret) {
  const raw = String(value || '').trim();
  const [payload, signature, extra] = raw.split('.');
  if (!payload || !signature || extra) return null;

  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const issuedAt = Number(parsed?.issuedAt);
    if (!Number.isFinite(issuedAt) || Math.abs(Date.now() - issuedAt) > 15 * 60 * 1000) return null;
    return safeReturnPath(parsed?.returnPath);
  } catch {
    return null;
  }
}

function buildPostOAuthTarget(origin, returnPath) {
  const safeOrigin = safeRedirectUrl(origin);
  const safePath = safeReturnPath(returnPath);
  return `${safeOrigin}${safePath}`;
}

function renderAppealsHandoff(returnPath) {
  const safePath = safeReturnPath(returnPath);
  const target = safePath.startsWith('/appeals') ? safePath : '/appeals';
  const escapedTarget = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${escapedTarget}">
  <title>Returning to Goliath Appeals</title>
</head>
<body>
  <p>Authentication complete. Returning to Goliath Appeals…</p>
  <p><a href="${escapedTarget}">Continue to Appeals</a></p>
</body>
</html>`;
}

function markAuthFlow(res) {
  res.set('X-Goliath-Auth-Flow', AUTH_FLOW_REVISION);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
}

/* ---------------- LOGIN ROUTE ---------------- */

router.get('/login', (req, res) => {
  markAuthFlow(res);
  const { clientId, clientSecret, redirectUri } = getAuthConfig();

  if (!clientId || !redirectUri) {
    return res.status(500).json({ error: 'Missing DISCORD_CLIENT_ID or DISCORD_REDIRECT_URI' });
  }
  if (!clientSecret) {
    return res.status(500).json({ error: 'Missing DISCORD_CLIENT_SECRET' });
  }

  const returnPath = safeReturnPath(req.query?.next);
  if (req.session) req.session.oauthReturnPath = returnPath;
  if (returnPath.startsWith('/appeals')) {
    res.cookie('goliath_oauth_return', returnPath, getOAuthReturnCookieOptions());
  }

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify guilds',
    state: createOAuthState(returnPath, clientSecret),
  });
  const authUrl = `https://discord.com/oauth2/authorize?${params.toString()}`;

  if (isDebug()) console.log('[AUTH] OAuth URL:', authUrl);
  if (!req.session) return res.redirect(authUrl);

  return req.session.save((saveError) => {
    if (saveError) {
      console.error('❌ OAuth return-path session save failed', saveError);
      return res.status(500).send('Session error.');
    }
    return res.redirect(authUrl);
  });
});

/* ---------------- CHECK AUTH ---------------- */

router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ authenticated: false, user: null });
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
  markAuthFlow(res);
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).send('Missing OAuth code.');

    const { clientId, clientSecret, redirectUri, clientUrl } = getAuthConfig();
    if (!clientId || !clientSecret || !redirectUri) {
      console.error('❌ OAuth config missing', {
        hasClientId: Boolean(clientId),
        hasClientSecret: Boolean(clientSecret),
        hasRedirectUri: Boolean(redirectUri),
      });
      return res.status(500).send('OAuth configuration error.');
    }

    const stateReturnPath = readOAuthState(req.query.state, clientSecret);
    if (!stateReturnPath) {
      console.error('❌ OAuth callback rejected missing, invalid, or expired state.');
      return res.status(400).send('OAuth sign-in state expired or was invalid. Return to the Appeals page and sign in again.');
    }

    const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
      const errorDescription = typeof tokenData?.error_description === 'string' ? tokenData.error_description : '';
      if (errorDescription.toLowerCase().includes('rate limited')) {
        return res.status(429).send('Discord OAuth rate limited. Try again later.');
      }
      return res.status(500).send('OAuth failed.');
    }
    if (!tokenData.access_token) {
      console.error('❌ Discord token response missing access_token', tokenData);
      return res.status(500).send('OAuth failed.');
    }

    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
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
    delete req.session.oauthReturnPath;

    if (isDebug()) console.log('[AUTH] User logged in:', req.session.user.username);

    req.session.save((saveError) => {
      if (saveError) {
        console.error('❌ Session save failed', saveError);
        return res.status(500).send('Session error.');
      }

      if (stateReturnPath.startsWith('/appeals')) {
        res.clearCookie('goliath_oauth_return', { path: '/', sameSite: isProduction() ? 'none' : 'lax', secure: isProduction() });
        return res.status(200).type('html').send(renderAppealsHandoff(stateReturnPath));
      }

      const origin = requestOrigin(req, clientUrl);
      return res.redirect(buildPostOAuthTarget(origin, stateReturnPath));
    });
  } catch (error) {
    console.error('❌ Auth error', error);
    return res.status(500).send('Authentication failed.');
  }
});

module.exports = router;
