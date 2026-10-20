import { api } from '../api.js';
import { html, el, $, avatar, hydrateAvatars, fmtCount, toast, onVisible } from '../ui.js';
import { icons } from '../icons.js';
import { videoGrid, videoTile } from '../components/grid.js';
import { toggleFollow } from '../components/player.js';
import { navigate } from '../router.js';

const LABELS = { all: 'All', comedy: 'Comedy', music: 'Music', dance: 'Dance', food: 'Food', sports: 'Sports', travel: 'Travel', gaming: 'Gaming', tech: 'Tech', art: 'Art', pets: 'Pets', other: 'Other' };
export const categoryLabel = (c) => LABELS[c] || c;

export async function exploreView({ query }) {
  const { categories } = await api.get('/api/categories');
  const active = categories.includes(query.category) ? query.category : 'all';
  const root = el(html`<div class="page page-wide explore">
    <h1 class="sr-only">Explore</h1>
    <div class="chips" role="tablist" aria-label="Categories">
      ${['all', ...categories].map((c) => html`<a role="tab" class="chip" aria-selected="${c === active}" href="/explore${c === 'all' ? '' : `?category=${c}`}">${categoryLabel(c)}</a>`)}
    </div>
    <div class="grid-wrap"></div>
    <div class="sentinel"></div>
  </div>`);
  const wrap = $('.grid-wrap', root);
  const grid = el('<div class="grid"></div>');
  wrap.append(grid);
  let cursor = 0;
  let more = true;
  let loading = false;
  async function load() {
    if (!more || loading) return;
    loading = true;
    try {
      const data = await api.get(`/api/explore?category=${active}&count=24&cursor=${cursor}`);
      cursor = data.cursor;
      more = data.hasMore;
      grid.append(...data.items.map((v) => videoTile(v)));
      if (!grid.children.length) wrap.replaceChildren(el('<div class="empty-state"><h2>Nothing here yet</h2><p class="muted">No public videos in this category.</p></div>'));
    } catch (ex) { toast(ex.message, 'error'); } finally { loading = false; }
  }
  await load();
  const stop = onVisible($('.sentinel', root), load);
  return { el: root, destroy: stop };
}

function userRow(u) {
  const row = el(html`<div class="user-row">
    <a href="/@${u.username}" class="user-row-main">${avatar(u, 52)}
      <span><strong>${u.displayName}</strong>${u.verified ? icons.verified : ''}
      <small>@${u.username}${u.followers != null ? ` · ${fmtCount(u.followers)} followers` : ''}</small>
      ${u.bio ? html`<small class="bio-line">${u.bio}</small>` : ''}</span></a>
    ${u.isMe ? '' : html`<button class="btn btn-sm ${u.isFollowing ? '' : 'btn-primary'}">${u.isFollowing ? 'Following' : 'Follow'}</button>`}
  </div>`);
  hydrateAvatars(row);
  $('button', row)?.addEventListener('click', async (e) => {
    try {
      const res = await toggleFollow(u.username, u.isFollowing);
      if (!res) return;
      u.isFollowing = res.following;
      e.target.textContent = u.isFollowing ? 'Following' : 'Follow';
      e.target.classList.toggle('btn-primary', !u.isFollowing);
    } catch (ex) { toast(ex.message, 'error'); }
  });
  return row;
}
export { userRow };

export async function searchView({ query }) {
  const q = (query.q || '').trim();
  const type = ['top', 'users', 'videos', 'hashtags'].includes(query.type) ? query.type : 'top';
  const tabs = [['top', 'Top'], ['users', 'Accounts'], ['videos', 'Videos'], ['hashtags', 'Hashtags']];
  const root = el(html`<div class="page page-wide search-page">
    <form class="search-inline" role="search"><input name="q" value="${q}" placeholder="Search accounts, videos, #hashtags" aria-label="Search"><button class="btn btn-primary">Search</button></form>
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label]) => html`<a role="tab" aria-selected="${k === type}" href="/search?q=${encodeURIComponent(q)}&type=${k}">${label}</a>`)}
    </div>
    <div class="results"></div>
  </div>`);
  $('form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const nq = e.target.q.value.trim();
    if (nq) navigate(`/search?q=${encodeURIComponent(nq)}&type=${type}`);
  });
  const out = $('.results', root);
  if (!q) {
    const { items } = await api.get('/api/search/suggest');
    out.append(el(html`<div class="trending"><h2>Trending hashtags</h2><div class="chips">${items.map((s) => html`<a class="chip" href="/tag/${s.text.slice(1)}">${s.text}</a>`)}</div></div>`));
    return { el: root };
  }
  const data = await api.get(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
  const users = data.users || [];
  const videos = data.videos || [];
  const tags = data.hashtags || [];
  if (type === 'top' || type === 'users') {
    if (users.length) {
      const sec = el(html`<section class="result-sec">${type === 'top' ? html`<div class="sec-head"><h2>Accounts</h2><a href="/search?q=${encodeURIComponent(q)}&type=users">See all</a></div>` : ''}<div class="user-list"></div></section>`);
      $('.user-list', sec).append(...users.map(userRow));
      out.append(sec);
    }
  }
  if ((type === 'top' || type === 'hashtags') && tags.length) {
    out.append(el(html`<section class="result-sec">${type === 'top' ? html`<h2>Hashtags</h2>` : ''}
      <div class="tag-list">${tags.map((t) => html`<a class="tag-row" href="/tag/${t.name}"><span class="tag-ic">${icons.hash}</span><span><strong>#${t.name}</strong><small>${fmtCount(t.videos)} videos</small></span></a>`)}</div></section>`));
  }
  if ((type === 'top' || type === 'videos') && videos.length) {
    const sec = el(html`<section class="result-sec">${type === 'top' ? html`<h2>Videos</h2>` : ''}</section>`);
    sec.append(videoGrid(videos));
    out.append(sec);
  }
  if (!out.children.length) {
    out.append(el(html`<div class="empty-state"><h2>No results for "${q}"</h2><p class="muted">Check the spelling or try a different search.</p></div>`));
  }
  return { el: root };
}

export async function hashtagView({ params }) {
  const { hashtag, items } = await api.get(`/api/hashtags/${encodeURIComponent(params.name)}`);
  const root = el(html`<div class="page page-wide">
    <header class="tag-head"><span class="tag-big">${icons.hash}</span><div><h1>#${hashtag.name}</h1>
      <p class="muted">${fmtCount(hashtag.videos)} videos · ${fmtCount(hashtag.views)} views</p></div></header>
  </div>`);
  root.append(videoGrid(items));
  return { el: root };
}

