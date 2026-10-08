'use strict';

const {
  clean,
  handle,
  request,
  unavailable,
  result,
} = require('./shared');

function validPublishedAt(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) && ms <= Date.now() + 5 * 60 * 1000 ? new Date(ms).toISOString() : null;
}

async function checkX(account) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return unavailable('x', 'Set X_BEARER_TOKEN.', 'configuration_required');
  const username = handle(account).replace(/^@+/, '').trim();
  if (!username || !/^[a-z0-9_]{1,15}$/i.test(username)) return unavailable('x', 'X username is missing or invalid.', 'configuration_required');
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const { json: userJson } = await request(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=name,username,profile_image_url`, { headers });
    const user = userJson?.data;
    if (!user?.id) return unavailable('x', 'X account could not be resolved.');
    const resolvedUsername = clean(user.username || username, 100).replace(/^@+/, '');
    const { json: postsJson } = await request(`https://api.x.com/2/users/${encodeURIComponent(user.id)}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at,attachments,text`, { headers });
    const post = postsJson?.data?.[0];
    const postId = clean(post?.id, 100);
    const publishedAt = validPublishedAt(post?.created_at);
    const profileUrl = `https://x.com/${encodeURIComponent(resolvedUsername)}`;
    const latestContent = postId && publishedAt ? {
      type: 'post',
      id: postId,
      title: clean(post.text || 'New post on X').slice(0, 180),
      url: `${profileUrl}/status/${encodeURIComponent(postId)}`,
      publishedAt,
    } : null;
    return result('x', { isLive: false, status: 'ok', externalId: String(user.id), resolvedUsername, latestContent, contentItems: latestContent ? [latestContent] : [], url: profileUrl, avatar: user.profile_image_url || null });
  } catch (error) { return unavailable('x', `X API unavailable: ${error.message}`); }
}

function isConfigured() {
  return Boolean(process.env.X_BEARER_TOKEN);
}

module.exports = {
  id: 'x',
  label: 'X',
  alertTypes: ['post'],
  isConfigured,
  check: checkX,
};
