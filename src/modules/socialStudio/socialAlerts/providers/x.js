'use strict';

const {
  clean,
  handle,
  request,
  unavailable,
  result,
} = require('./shared');

async function checkX(account) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return unavailable('x', 'Set X_BEARER_TOKEN.', 'configuration_required');
  const username = handle(account);
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const { json: userJson } = await request(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=name,profile_image_url`, { headers });
    const user = userJson?.data;
    if (!user?.id) return unavailable('x', 'X account could not be resolved.');
    const { json: postsJson } = await request(`https://api.x.com/2/users/${encodeURIComponent(user.id)}/tweets?max_results=5&exclude=retweets,replies&tweet.fields=created_at,attachments,text`, { headers });
    const post = postsJson?.data?.[0];
    const latestContent = post ? { type: 'post', id: post.id, title: clean(post.text || 'New post on X').slice(0, 180), url: `https://x.com/${encodeURIComponent(username)}/status/${post.id}`, publishedAt: post.created_at } : null;
    return result('x', { isLive: false, status: 'ok', externalId: user.id, latestContent, contentItems: latestContent ? [latestContent] : [], url: `https://x.com/${encodeURIComponent(username)}`, avatar: user.profile_image_url });
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
