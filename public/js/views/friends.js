import { api, store } from '../api.js';
import { html, el, $, avatar, hydrateAvatars, fmtCount } from '../ui.js';
import { icons } from '../icons.js';
import { videoGrid } from '../components/grid.js';
import { loginRequired } from './upload.js';

/** Friends = accounts you follow that also follow you back. Shows them and their latest videos. */
export async function friendsView() {
  if (!store.me) return loginRequired('Log in to see videos from your friends - people you follow who follow you back.');
  const me = store.me.username;
  const [following, followers] = await Promise.all([
    api.get(`/api/users/${me}/following`),
    api.get(`/api/users/${me}/followers`),
  ]);
  const followerIds = new Set(followers.items.map((u) => u.id));
  const friends = following.items.filter((u) => followerIds.has(u.id));

  const root = el(html`<div class="page page-wide friends-page">
    <h1>Friends</h1>
    <p class="muted">People you follow who follow you back.</p>
    <div class="friend-strip"></div>
    <div class="friend-videos"></div>
  </div>`);
  const strip = $('.friend-strip', root);
  const out = $('.friend-videos', root);

  if (!friends.length) {
    out.append(el(html`<div class="empty-state"><h2>No friends yet</h2>
      <p class="muted">When someone you follow follows you back, you become friends and their videos show up here.</p>
      <a class="btn btn-primary" href="/explore">Find creators</a></div>`));
    return { el: root };
  }

  strip.append(...friends.map((u) => el(html`<a class="friend-chip" href="/@${u.username}">${avatar(u, 56)}
    <span class="fc-name">${u.displayName}${u.verified ? icons.verified : ''}</span></a>`)));
  hydrateAvatars(strip);

  const lists = await Promise.all(friends.map((u) => api.get(`/api/users/${u.username}/videos`).catch(() => ({ items: [] }))));
  const videos = lists.flatMap((l) => l.items).sort((a, b) => b.createdAt - a.createdAt);
  if (videos.length) {
    out.append(el(html`<h2>Latest from friends <span class="muted small">${fmtCount(videos.length)} videos</span></h2>`), videoGrid(videos));
  } else {
    out.append(el('<p class="empty">Your friends haven\'t posted any videos yet.</p>'));
  }
  return { el: root };
}
