import { api, store } from '../api.js';
import { html, el, $, avatar, hydrateAvatars, fmtCount, toast } from '../ui.js';
import { icons } from '../icons.js';
import { createVideoCard, toggleFollow, emitVideoUpdate } from '../components/player.js';
import { commentsPanel } from '../components/comments.js';
import { authForm } from '../components/auth.js';
import { refresh } from '../router.js';

/** Vertical snap-scroll feed. kind: 'foryou' | 'following'. */
export async function feedView({ kind, query }) {
  const root = el(html`<div class="feed-page">
    <div class="feed-tabs" role="tablist" aria-label="Feeds">
      <a href="/following" role="tab" aria-selected="${kind === 'following'}">Following</a>
      <a href="/" role="tab" aria-selected="${kind === 'foryou'}">For You</a>
    </div>
    <a href="/search" class="feed-search icon-btn" aria-label="Search">${icons.search}</a>
    <div class="feed" tabindex="-1"></div>
    <div class="feed-nav">
      <button class="round-btn f-prev" aria-label="Previous video">${icons.up}</button>
      <button class="round-btn f-next" aria-label="Next video">${icons.down}</button>
    </div>
    <aside class="drawer" hidden></aside>
  </div>`);
  const feed = $('.feed', root);
  const drawer = $('.drawer', root);
  const cards = [];
  let loading = false;
  let hasMore = true;
  let cursor = 0;
  let activeIdx = -1;

  if (kind === 'following' && !store.me) {
    feed.replaceChildren(el(html`<div class="empty-state feed-empty"><h2>See videos from creators you follow</h2>
      <p class="muted">Log in to build your Following feed.</p></div>`));
    feed.firstElementChild.append(authForm({ onDone: () => refresh() }));
    $('.feed-nav', root).hidden = true;
    return { el: root };
  }

  async function loadMore() {
    if (loading || !hasMore) return;
    loading = true;
    try {
      let data;
      if (kind === 'foryou') {
        const exclude = cards.map((c) => c.video.id).join(',');
        data = await api.get(`/api/feed/foryou?count=5${exclude ? `&exclude=${exclude}` : ''}`);
      } else {
        data = await api.get(`/api/feed/following?count=5&cursor=${cursor}`);
        cursor = data.cursor;
      }
      hasMore = data.hasMore;
      for (const v of data.items) addCard(v);
      if (!cards.length) showEmpty();
      else if (!hasMore && !$('.feed-end', feed)) feed.append(el('<div class="feed-end"><p>You\'re all caught up</p><a class="btn" href="/explore">Explore more</a></div>'));
    } catch (ex) {
      toast(ex.message, 'error');
    } finally {
      loading = false;
    }
  }

  async function showEmpty() {
    const box = el(html`<div class="empty-state feed-empty">
      <h2>${kind === 'following' ? 'No videos from people you follow yet' : 'No videos yet'}</h2>
      <p class="muted">${kind === 'following' ? 'Follow some creators to fill this feed.' : 'Be the first to upload something!'}</p>
      <div class="suggest-list"></div>
      <a class="btn btn-primary" href="${kind === 'following' ? '/explore' : '/upload'}">${kind === 'following' ? 'Explore creators' : 'Upload a video'}</a>
    </div>`);
    feed.replaceChildren(box);
    $('.feed-nav', root).hidden = true;
    if (kind !== 'following') return;
    const { items } = await api.get('/api/users').catch(() => ({ items: [] }));
    $('.suggest-list', box).append(...items.map((u) => {
      const row = el(html`<div class="user-row"><a href="/@${u.username}" class="user-row-main">${avatar(u, 44)}
        <span><strong>${u.displayName}</strong>${u.verified ? icons.verified : ''}<small>@${u.username} · ${fmtCount(u.followers)} followers</small></span></a>
        <button class="btn btn-primary btn-sm">Follow</button></div>`);
      hydrateAvatars(row);
      $('button', row).addEventListener('click', async (e) => {
        const res = await toggleFollow(u.username, false).catch((ex) => toast(ex.message, 'error'));
        if (res?.following) { e.target.textContent = 'Following'; e.target.disabled = true; }
      });
      return row;
    }));
    box.append(el('<button class="btn refresh-follow">Refresh feed</button>'));
    $('.refresh-follow', box).addEventListener('click', () => refresh());
  }

  function addCard(v) {
    const card = createVideoCard(v, { mode: 'feed', onComments: openComments });
    cards.push(card);
    $('.feed-end', feed)?.remove();
    feed.append(card.el);
    io.observe(card.el);
  }

  // The card that is >= 60% visible is the active (playing) one.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.6) {
        const idx = cards.findIndex((c) => c.el === e.target);
        if (idx >= 0) activate(idx);
      }
    }
  }, { root: feed, threshold: [0.6] });

  function activate(idx) {
    if (idx === activeIdx) return;
    cards[activeIdx]?.setActive(false);
    activeIdx = idx;
    const card = cards[idx];
    card.setActive(true);
    // Keep the URL shareable: ?v=<id> reopens the feed at this video.
    if (kind === 'foryou') history.replaceState(history.state, '', `/?v=${card.video.id}`);
    if (!drawer.hidden) openComments(card.video, null, true);
    if (cards.length - idx <= 3) loadMore();
  }

  function scrollToIdx(idx) {
    const target = cards[Math.max(0, Math.min(cards.length - 1, idx))];
    target?.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }
  $('.f-prev', root).addEventListener('click', () => scrollToIdx(activeIdx - 1));
  $('.f-next', root).addEventListener('click', () => scrollToIdx(activeIdx + 1));

  function closeDrawer() {
    drawer.hidden = true;
    drawer.replaceChildren();
    root.classList.remove('with-drawer');
  }
  function openComments(video, _onCount, follow = false) {
    if (follow && drawer.hidden) return;
    const card = cards.find((c) => c.video.id === video.id);
    drawer.replaceChildren(commentsPanel(card?.video || video, {
      onCount: (n) => card?.setCommentCount(n),
      onClose: closeDrawer,
    }));
    drawer.hidden = false;
    root.classList.add('with-drawer');
  }

  // Keyboard: arrows/J/K move, space toggles play, L likes, M mutes, C comments.
  const onKey = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable], .modal') || e.metaKey || e.ctrlKey || e.altKey) return;
    const card = cards[activeIdx];
    switch (e.key) {
      case 'ArrowDown': case 'j': e.preventDefault(); scrollToIdx(activeIdx + 1); break;
      case 'ArrowUp': case 'k': e.preventDefault(); scrollToIdx(activeIdx - 1); break;
      case ' ': e.preventDefault(); card?.togglePlay(); break;
      case 'l': card?.toggleLike(); break;
      case 'm': store.set({ muted: !store.muted }); break;
      case 'c': if (card) $('.r-comment', card.el).click(); break;
      case 'Escape': if (!drawer.hidden) closeDrawer(); break;
      default:
    }
  };
  document.addEventListener('keydown', onKey);

  // Deep link: /?v=123 starts the feed with that video.
  if (kind === 'foryou' && query.v) {
    try {
      const { video } = await api.get(`/api/videos/${encodeURIComponent(query.v)}`);
      addCard(video);
    } catch { /* fall back to normal feed */ }
  }
  await loadMore();

  return {
    el: root,
    mounted() { feed.focus({ preventScroll: true }); },
    // Logging in/out keeps the feed position; just refresh per-viewer flags.
    onAuthChange() {
      if (kind === 'following') return false;
      const at = Date.now();
      for (const c of cards) {
        api.get(`/api/videos/${c.video.id}`).then(({ video }) => emitVideoUpdate(video, at)).catch(() => {});
      }
      return true;
    },
    destroy() {
      document.removeEventListener('keydown', onKey);
      io.disconnect();
      for (const c of cards) c.destroy();
    },
  };
}
