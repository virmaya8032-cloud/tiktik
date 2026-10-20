import { api, store } from './api.js';
import { html, el, $, $$, avatar, hydrateAvatars, debounce, toast, modal } from './ui.js';
import { icons } from './icons.js';
import { route, startRouter, navigate, refresh, authChanged } from './router.js';
import { openAuthModal } from './components/auth.js';
import { feedView } from './views/feed.js';
import { exploreView, searchView, hashtagView } from './views/discover.js';
import { videoView } from './views/video.js';
import { profileView, inboxView } from './views/profile.js';
import { uploadView, studioView, loginView } from './views/upload.js';
import { friendsView } from './views/friends.js';
import { infoView, TERMS_LINKS } from './views/info.js';
import { adminView } from './views/admin.js';
import { resetView } from './views/reset.js';

route('/', (ctx) => feedView({ ...ctx, kind: 'foryou' }));
route('/following', (ctx) => feedView({ ...ctx, kind: 'following' }));
route('/friends', friendsView);
route('/info/:slug', infoView);
route('/explore', exploreView);
route('/search', searchView);
route('/tag/:name', hashtagView);
route('/upload', uploadView);
route('/studio', studioView);
route('/inbox', inboxView);
route('/login', loginView);
route('/admin', adminView);
route('/reset-password', resetView);
route('/@:username', profileView);
route('/@:username/video/:id', videoView);

// ---------- theme ----------
const THEME_KEY = 'cw-theme';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage unavailable */ }
}
let savedTheme = null;
try { savedTheme = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
applyTheme(savedTheme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

// ---------- shell ----------
const shell = el(html`<div class="shell">
  <aside class="sidebar" aria-label="Main navigation">
    <div class="side-top">
      <a href="/" class="brand" aria-label="TikTik home">${icons.logo}${icons.wordmark}</a>
      <button type="button" class="icon-btn side-collapse" aria-label="Collapse sidebar" aria-pressed="false" title="Collapse sidebar">${icons.sidebar}</button>
    </div>
    <form class="search" role="search" autocomplete="off">
      <span class="search-ic">${icons.search}</span>
      <input name="q" type="search" placeholder="Search" aria-label="Search" aria-autocomplete="list" aria-controls="suggest">
      <ul id="suggest" class="suggest" role="listbox" hidden></ul>
    </form>
    <nav class="side-nav">
      <a href="/" data-nav="/" class="nav-home"><i class="ic-off">${icons.home}</i><i class="ic-on">${icons.homeFill}</i><span>For You</span></a>
      <a href="/explore" data-nav="/explore">${icons.compass}<span>Explore</span></a>
      <a href="/following" data-nav="/following">${icons.users}<span>Following</span></a>
      <a href="/friends" data-nav="/friends" class="auth-only">${icons.friends}<span>Friends</span></a>
      <a href="/upload" data-nav="/upload">${icons.plus}<span>Upload</span></a>
      <a href="/inbox" data-nav="/inbox" class="nav-inbox auth-only">${icons.inbox}<span>Activity</span><b class="dot" hidden></b></a>
      <a href="/studio" data-nav="/studio" class="auth-only">${icons.chart}<span>Studio</span></a>
      <a href="/admin" data-nav="/admin" class="admin-only" hidden>${icons.flag}<span>Moderation</span></a>
      <a href="/login" data-nav="/@me" class="nav-profile">${icons.user}<span>Profile</span></a>
      <div class="more-wrap">
        <button type="button" class="nav-more" aria-haspopup="menu" aria-expanded="false">${icons.menu}<span>More</span></button>
        <div class="more-menu" role="menu" hidden></div>
      </div>
    </nav>
    <div class="side-account"></div>
    <section class="side-people" aria-labelledby="side-people-h" hidden>
      <h2 id="side-people-h"></h2>
      <div class="side-people-list"></div>
    </section>
    <footer class="side-foot">
      <a href="/info/company" class="foot-head">Company</a>
      <a href="/info/program" class="foot-head">Program</a>
      <button type="button" class="foot-head foot-toggle" aria-expanded="false" aria-controls="foot-terms">Terms &amp; Policies</button>
      <div id="foot-terms" class="foot-sub" hidden>${TERMS_LINKS.map(([slug, label]) => html`<a href="/info/${slug}">${label}</a>`)}</div>
      <button class="link-btn theme-toggle"></button>
      <p>© 2026 TikTik</p>
    </footer>
  </aside>
  <main id="app" class="main" tabindex="-1"></main>
  <div class="top-actions" hidden><button type="button" class="btn btn-primary top-login">Log in</button></div>
  <nav class="tabbar" aria-label="Mobile navigation">
    <a href="/" data-nav="/">${icons.home}<span>Home</span></a>
    <a href="/explore" data-nav="/explore">${icons.compass}<span>Explore</span></a>
    <a href="/upload" data-nav="/upload" class="tab-upload" aria-label="Create">${icons.plusSmall}</a>
    <a href="/inbox" data-nav="/inbox" class="nav-inbox">${icons.inbox}<span>Inbox</span><b class="dot" hidden></b></a>
    <a href="/login" data-nav="/@me" class="nav-profile">${icons.user}<span>Profile</span></a>
  </nav>
</div>`);
document.body.replaceChildren(shell);

function renderAccount() {
  const box = $('.side-account', shell);
  const me = store.me;
  for (const a of $$('.nav-profile', shell)) a.setAttribute('href', me ? `/@${me.username}` : '/login');
  for (const a of $$('.auth-only', shell)) a.hidden = !me;
  for (const a of $$('.admin-only', shell)) a.hidden = !me?.isAdmin;
  for (const d of $$('.nav-inbox .dot', shell)) d.hidden = !store.unread;
  $('.top-actions', shell).hidden = !!me;
  if (me) {
    box.replaceChildren(el(html`<div class="me-card">
      <a href="/@${me.username}" class="me-link">${avatar(me, 36)}<span><strong>${me.displayName}</strong><small>@${me.username}</small></span></a>
      <button class="icon-btn logout" aria-label="Log out" title="Log out">${icons.logout}</button></div>`));
    hydrateAvatars(box);
    $('.logout', box).addEventListener('click', async () => {
      await api.post('/api/auth/logout');
      await store.refresh();
      toast('Logged out');
      navigate('/');
    });
  } else {
    box.replaceChildren(el('<button class="btn btn-primary btn-block login-btn">Log in</button>'));
    $('.login-btn', box).addEventListener('click', async () => { if (await openAuthModal()) refresh(); });
  }
  const t = document.documentElement.dataset.theme;
  $('.theme-toggle', shell).replaceChildren(el(t === 'dark' ? icons.sun : icons.moon), document.createTextNode(t === 'dark' ? ' Light mode' : ' Dark mode'));
}
$('.theme-toggle', shell).addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  renderAccount();
});

$('.top-login', shell).addEventListener('click', async () => { if (await openAuthModal()) refresh(); });

$('.foot-toggle', shell).addEventListener('click', (e) => {
  const open = e.currentTarget.getAttribute('aria-expanded') !== 'true';
  e.currentTarget.setAttribute('aria-expanded', String(open));
  $('#foot-terms', shell).hidden = !open;
});

// ---------- collapsible sidebar ----------
const SIDE_KEY = 'cw-side';
function setCollapsed(on) {
  shell.classList.toggle('side-collapsed', on);
  const btn = $('.side-collapse', shell);
  btn.setAttribute('aria-pressed', String(on));
  btn.setAttribute('aria-label', on ? 'Expand sidebar' : 'Collapse sidebar');
  btn.title = on ? 'Expand sidebar' : 'Collapse sidebar';
  try { localStorage.setItem(SIDE_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ }
}
let savedSide = null;
try { savedSide = localStorage.getItem(SIDE_KEY); } catch { /* ignore */ }
setCollapsed(savedSide === '1');
$('.side-collapse', shell).addEventListener('click', () => setCollapsed(!shell.classList.contains('side-collapsed')));

// ---------- "More" menu ----------
const moreBtn = $('.nav-more', shell);
const moreMenu = $('.more-menu', shell);
function closeMore() { moreMenu.hidden = true; moreBtn.setAttribute('aria-expanded', 'false'); }
function openMore() {
  const dark = document.documentElement.dataset.theme === 'dark';
  moreMenu.replaceChildren(el(html`<div>
    <button role="menuitem" data-act="theme">${dark ? icons.sun : icons.moon}<span>${dark ? 'Light mode' : 'Dark mode'}</span></button>
    <button role="menuitem" data-act="keys">${icons.keyboard}<span>Keyboard shortcuts</span></button>
    ${store.me ? html`<a role="menuitem" href="/studio">${icons.chart}<span>Creator Studio</span></a>
    ${store.me.isAdmin ? html`<a role="menuitem" href="/admin">${icons.flag}<span>Moderation</span></a>` : ''}
    <button role="menuitem" data-act="logout">${icons.logout}<span>Log out</span></button>` : ''}
  </div>`));
  moreMenu.hidden = false;
  moreBtn.setAttribute('aria-expanded', 'true');
  $('[role=menuitem]', moreMenu)?.focus();
}
moreBtn.addEventListener('click', () => (moreMenu.hidden ? openMore() : closeMore()));
moreMenu.addEventListener('click', async (e) => {
  const item = e.target.closest('[role=menuitem]');
  if (!item) return;
  closeMore();
  const act = item.dataset.act;
  if (act === 'theme') { applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); renderAccount(); }
  if (act === 'keys') {
    modal(el(html`<dl class="keys">
      <dt>↑ / K</dt><dd>Previous video</dd><dt>↓ / J</dt><dd>Next video</dd><dt>Space</dt><dd>Play / pause</dd>
      <dt>L</dt><dd>Like</dd><dt>M</dt><dd>Mute / unmute</dd><dt>C</dt><dd>Open comments</dd><dt>Esc</dt><dd>Close comments</dd></dl>`), { title: 'Keyboard shortcuts' });
  }
  if (act === 'logout') {
    await api.post('/api/auth/logout');
    await store.refresh();
    toast('Logged out');
    navigate('/');
  }
});
document.addEventListener('mousedown', (e) => { if (!moreMenu.hidden && !e.target.closest('.more-wrap')) closeMore(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !moreMenu.hidden) { closeMore(); moreBtn.focus(); } });

// ---------- Following accounts (logged in) / Suggested accounts (logged out) ----------
let peopleToken = 0;
async function renderPeople() {
  const token = ++peopleToken;
  const me = store.me;
  const section = $('.side-people', shell);
  try {
    if (!me) { section.hidden = true; return; }
    const { items } = await api.get(`/api/users/${me.username}/following`);
    if (token !== peopleToken) return;
    $('h2', section).textContent = me ? 'Following accounts' : 'Suggested accounts';
    const list = $('.side-people-list', section);
    list.replaceChildren(...items.slice(0, 8).map((u) => el(html`<a class="person" href="/@${u.username}">${avatar(u, 32)}
      <span><strong>${u.username}${u.verified ? icons.verified : ''}</strong><small>${u.displayName}</small></span></a>`)));
    if (!items.length) list.append(el(html`<p class="muted small">${me ? 'Accounts you follow will appear here.' : 'No suggestions right now.'}</p>`));
    hydrateAvatars(list);
    section.hidden = false;
  } catch { section.hidden = true; }
}

function markNav(path) {
  const me = store.me ? `/@${store.me.username}` : null;
  for (const a of $$('[data-nav]', shell)) {
    const target = a.dataset.nav === '/@me' ? me : a.dataset.nav;
    const on = target && (target === '/' ? path === '/' : path === target || path.startsWith(`${target}/`));
    a.classList.toggle('on', !!on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  shell.classList.toggle('is-feed', path === '/' || path === '/following');
  const q = new URLSearchParams(location.search).get('q');
  const input = $('.search input', shell);
  if (path === '/search' && q) input.value = q;
}

// ---------- search with suggestions ----------
const searchForm = $('.search', shell);
const searchInput = searchForm.q;
const suggest = $('#suggest', shell);
let suggestIdx = -1;
const hideSuggest = () => { suggest.hidden = true; suggestIdx = -1; searchInput.removeAttribute('aria-activedescendant'); };
const loadSuggest = debounce(async () => {
  const q = searchInput.value.trim();
  try {
    const { items } = await api.get(`/api/search/suggest?q=${encodeURIComponent(q)}`);
    if (document.activeElement !== searchInput) return;
    suggest.replaceChildren(...(q ? [] : [el('<li class="suggest-head">Trending</li>')]), ...items.map((s, i) => {
      const li = el(html`<li role="option" id="sg-${i}" data-href="${s.kind === 'user' ? `/@${s.text}` : `/tag/${s.text.slice(1)}`}">
        ${s.kind === 'user' ? avatar(s, 24) : html`<span class="sg-ic">${icons.hash}</span>`}<span>${s.kind === 'user' ? `${s.displayName} · @${s.text}` : s.text}</span></li>`);
      hydrateAvatars(li);
      return li;
    }));
    suggest.hidden = !items.length;
  } catch { hideSuggest(); }
}, 150);
searchInput.addEventListener('input', loadSuggest);
searchInput.addEventListener('focus', loadSuggest);
searchInput.addEventListener('blur', () => setTimeout(hideSuggest, 150));
searchInput.addEventListener('keydown', (e) => {
  const opts = $$('[role=option]', suggest);
  if (!opts.length || suggest.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    suggestIdx = (suggestIdx + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.setAttribute('aria-selected', String(i === suggestIdx)));
    searchInput.setAttribute('aria-activedescendant', opts[suggestIdx].id);
  } else if (e.key === 'Enter' && suggestIdx >= 0) {
    e.preventDefault();
    navigate(opts[suggestIdx].dataset.href);
    hideSuggest();
    searchInput.blur();
  } else if (e.key === 'Escape') hideSuggest();
});
suggest.addEventListener('mousedown', (e) => {
  const li = e.target.closest('[data-href]');
  if (!li) return;
  e.preventDefault();
  navigate(li.dataset.href);
  hideSuggest();
  searchInput.blur();
});
searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  hideSuggest();
  searchInput.blur();
  navigate(`/search?q=${encodeURIComponent(q)}`);
});

// Prompt for login whenever the API says a session is required.
// (The session-change subscriber below updates the view after login.)
store.requireLogin = () => { openAuthModal(); };

let lastMe = undefined;
store.subscribe(() => {
  renderAccount();
  const id = store.me?.id ?? null;
  if (lastMe !== undefined && id !== lastMe) authChanged(); // logging in/out
  if (id !== lastMe) renderPeople();
  lastMe = id;
  markNav(decodeURIComponent(location.pathname));
});

// Poll unread notifications lightly while the tab is visible.
setInterval(async () => {
  if (!store.me || document.hidden) return;
  const data = await api.get('/api/auth/me').catch(() => null);
  if (data && data.unreadNotifications !== store.unread) store.set({ unread: data.unreadNotifications });
}, 30_000);

// Installable app (PWA). Service workers only run on https or localhost.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

await store.refresh();
startRouter($('#app', shell), (path) => { markNav(path); closeMore(); if (store.me) renderPeople(); });
