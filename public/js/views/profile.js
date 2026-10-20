import { api, store } from '../api.js';
import { html, el, $, $$, avatar, hydrateAvatars, fmtCount, toast, modal, copyText, timeAgo } from '../ui.js';
import { icons } from '../icons.js';
import { videoGrid } from '../components/grid.js';
import { toggleFollow } from '../components/player.js';
import { userRow } from './discover.js';
import { refresh, navigate } from '../router.js';
import { openReportDialog } from '../components/report.js';
import { ensureLogin } from '../components/auth.js';

export async function profileView({ params, query }) {
  const data = await api.get(`/api/users/${encodeURIComponent(params.username)}`);
  const { user, viewer } = data;
  let stats = data.stats;
  const tabs = viewer.isMe ? [['videos', 'Videos'], ['favorites', 'Saved'], ['liked', 'Liked']] : [['videos', 'Videos']];
  const tab = tabs.some(([k]) => k === query.tab) ? query.tab : 'videos';

  const root = el(html`<div class="page page-wide profile">
    <header class="p-head">
      <div class="p-avatar">${avatar(user, 116)}</div>
      <div class="p-info">
        <h1>${user.username}${user.verified ? icons.verified : ''}</h1>
        <p class="p-name">${user.displayName}</p>
        <div class="p-actions"></div>
        <div class="p-stats">
          <button class="p-stat" data-list="following"><strong class="s-following">${fmtCount(stats.following)}</strong> Following</button>
          <button class="p-stat" data-list="followers"><strong class="s-followers">${fmtCount(stats.followers)}</strong> Followers</button>
          <span class="p-stat"><strong>${fmtCount(stats.likes)}</strong> Likes</span>
        </div>
        <p class="p-bio">${user.bio || (viewer.isMe ? 'No bio yet.' : '')}</p>
      </div>
    </header>
    <div class="tabs p-tabs" role="tablist">
      ${tabs.map(([k, label]) => html`<a role="tab" aria-selected="${k === tab}" href="/@${user.username}${k === 'videos' ? '' : `?tab=${k}`}">${label}</a>`)}
    </div>
    <div class="p-grid"></div>
  </div>`);
  hydrateAvatars(root);

  const actions = $('.p-actions', root);
  function renderActions() {
    if (viewer.isMe) {
      actions.replaceChildren(el(html`<div class="btn-row"><button class="btn btn-primary p-edit">Edit profile</button><a class="btn" href="/studio">Creator studio</a><button class="btn icon-only p-share" aria-label="Share profile">${icons.link}</button></div>`));
      $('.p-edit', actions).addEventListener('click', () => editProfile(user));
    } else if (viewer.isBlocked) {
      actions.replaceChildren(el(html`<div class="btn-row">
        <button class="btn btn-primary p-unblock">Unblock</button>
        <button class="btn icon-only p-share" aria-label="Share profile">${icons.link}</button></div>`));
      $('.p-unblock', actions).addEventListener('click', async () => {
        try {
          await api.del(`/api/users/${user.username}/block`);
          toast(`@${user.username} unblocked`, 'success');
          refresh();
        } catch (ex) { toast(ex.message, 'error'); }
      });
    } else {
      actions.replaceChildren(el(html`<div class="btn-row">
        <button class="btn ${viewer.isFollowing ? '' : 'btn-primary'} p-follow">${viewer.isFollowing ? 'Following' : viewer.followsYou ? 'Follow back' : 'Follow'}</button>
        <button class="btn icon-only p-share" aria-label="Share profile">${icons.link}</button>
        <button class="btn icon-only p-more" aria-label="More options">${icons.more}</button></div>`));
      $('.p-more', actions).addEventListener('click', () => profileMenu(user));
      $('.p-follow', actions).addEventListener('click', async () => {
        try {
          const res = await toggleFollow(user.username, viewer.isFollowing);
          if (!res) return;
          viewer.isFollowing = res.following;
          stats = { ...stats, followers: res.followers };
          $('.s-followers', root).textContent = fmtCount(res.followers);
          renderActions();
        } catch (ex) { toast(ex.message, 'error'); }
      });
    }
    $('.p-share', actions).addEventListener('click', async () => {
      if (await copyText(`${location.origin}/@${user.username}`)) toast('Profile link copied', 'success');
    });
  }
  renderActions();

  for (const b of $$('[data-list]', root)) {
    b.addEventListener('click', async () => {
      const list = b.dataset.list;
      const { items } = await api.get(`/api/users/${user.username}/${list}`);
      const box = el('<div class="user-list"></div>');
      if (!items.length) box.append(el(html`<p class="empty small">${list === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}</p>`));
      box.append(...items.map((u) => userRow(u)));
      modal(box, { title: list === 'followers' ? 'Followers' : 'Following' });
    });
  }

  const gridBox = $('.p-grid', root);
  if (viewer.isBlocked) {
    gridBox.append(el(html`<div class="empty-state"><h2>You blocked @${user.username}</h2><p class="muted">You won't see their videos or comments, and they can't interact with you. Unblock to see them again.</p></div>`));
    return { el: root };
  }
  try {
    const { items } = await api.get(`/api/users/${user.username}/videos?tab=${tab}`);
    if (!items.length) {
      const msg = { videos: viewer.isMe ? ['Upload your first video', 'Your videos will appear here.'] : ['No videos yet', `@${user.username} hasn't posted anything.`],
        favorites: ['Nothing saved yet', 'Tap the bookmark on any video to save it here.'], liked: ['No liked videos yet', 'Videos you like will appear here.'] }[tab];
      gridBox.append(el(html`<div class="empty-state"><h2>${msg[0]}</h2><p class="muted">${msg[1]}</p>${viewer.isMe && tab === 'videos' ? html`<a class="btn btn-primary" href="/upload">Upload</a>` : ''}</div>`));
    } else {
      gridBox.append(videoGrid(items, { metric: 'views', showAuthor: tab !== 'videos' }));
    }
  } catch (ex) {
    gridBox.append(el(html`<div class="empty-state"><p class="muted">${ex.message}</p></div>`));
  }
  return { el: root };
}

/** Report or block another account. */
function profileMenu(user) {
  const box = el(html`<div class="menu-list">
    <button class="menu-item pm-report">${icons.flag} Report account</button>
    <button class="menu-item btn-danger pm-block">${icons.block} Block @${user.username}</button>
  </div>`);
  const m = modal(box, { title: `@${user.username}` });
  $('.pm-report', box).addEventListener('click', () => { m.close(); openReportDialog({ type: 'user', id: user.id, label: 'account' }); });
  $('.pm-block', box).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (!(await ensureLogin())) return;
    if (btn.dataset.armed !== '1') {
      btn.dataset.armed = '1';
      btn.textContent = `Confirm: block @${user.username}? They won't be told.`;
      return;
    }
    try {
      await api.post(`/api/users/${user.username}/block`);
      m.close();
      toast(`@${user.username} blocked`, 'success');
      refresh();
    } catch (ex) { toast(ex.message, 'error'); }
  });
}

async function blockedAccounts() {
  const box = el('<div class="user-list"><div class="spinner" aria-label="Loading"></div></div>');
  modal(box, { title: 'Blocked accounts' });
  try {
    const { items } = await api.get('/api/me/blocks');
    if (!items.length) { box.replaceChildren(el('<p class="empty small">You haven\'t blocked anyone.</p>')); return; }
    box.replaceChildren(...items.map((u) => {
      const row = el(html`<div class="user-row">
        <a href="/@${u.username}" class="user-row-main">${avatar(u, 52)}
          <span><strong>${u.displayName}</strong><small>@${u.username}</small></span></a>
        <button class="btn btn-sm b-unblock">Unblock</button>
      </div>`);
      hydrateAvatars(row);
      $('.b-unblock', row).addEventListener('click', async () => {
        try {
          await api.del(`/api/users/${u.username}/block`);
          row.remove();
          toast(`@${u.username} unblocked`, 'success');
        } catch (ex) { toast(ex.message, 'error'); }
      });
      return row;
    }));
  } catch (ex) { box.replaceChildren(el(html`<p class="empty small">${ex.message}</p>`)); }
}

function deleteAccount(user) {
  const form = el(html`<form class="form delete-account">
    <p>This permanently deletes <strong>@${user.username}</strong> and cannot be undone:</p>
    <ul class="small">
      <li>your videos, profile photo and their files</li>
      <li>your comments (and the replies under them), likes, saved videos and follows</li>
      <li>your notifications, blocks and login sessions</li>
    </ul>
    <label class="field"><span>Password</span><input name="password" type="password" required autocomplete="current-password"></label>
    <label class="check-row"><input type="checkbox" name="sure" required> I understand this can't be undone</label>
    <p class="form-error" role="alert" hidden></p>
    <div class="btn-row end"><button type="button" class="btn d-cancel">Cancel</button><button class="btn btn-primary">Delete my account</button></div>
  </form>`);
  const m = modal(form, { title: 'Delete account' });
  $('.d-cancel', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = $('.btn-primary', form);
    submit.disabled = true;
    try {
      await api('DELETE', '/api/me', { password: form.password.value });
      m.close();
      // Forget the account locally before leaving, so nothing re-requests the deleted profile.
      store.me = null;
      await navigate('/');
      await store.refresh();
      toast('Your account was deleted', 'success');
    } catch (ex) {
      const err = $('.form-error', form);
      err.textContent = ex.message; err.hidden = false;
      submit.disabled = false;
    }
  });
}

function editProfile(user) {
  const form = el(html`<form class="form edit-profile">
    <div class="ep-avatar">
      <span class="ep-preview">${avatar({ ...user }, 96)}</span>
      <label class="btn btn-sm">Change photo<input type="file" name="avatar" accept="image/png,image/jpeg,image/webp" class="sr-only"></label>
    </div>
    <label class="field"><span>Name</span><input name="displayName" maxlength="40" required value="${user.displayName}"></label>
    <label class="field"><span>Bio <small class="muted bio-count"></small></span><textarea name="bio" maxlength="160" rows="3">${user.bio}</textarea></label>
    <label class="field"><span>Email <small class="muted">optional, private - only used to reset your password</small></span>
      <input name="email" type="email" maxlength="254" autocomplete="email" value="${store.me?.email || ''}"></label>
    <p class="form-error" role="alert" hidden></p>
    <div class="btn-row end"><button type="button" class="btn ep-cancel">Cancel</button><button class="btn btn-primary">Save</button></div>
    <div class="ep-account">
      <h3>Privacy and safety</h3>
      <button type="button" class="link-btn ep-blocks">Blocked accounts</button>
      <button type="button" class="link-btn btn-danger ep-delete">Delete account</button>
    </div>
  </form>`);
  hydrateAvatars(form);
  const m = modal(form, { title: 'Edit profile' });
  const count = () => { $('.bio-count', form).textContent = `${form.bio.value.length}/160`; };
  form.bio.addEventListener('input', count);
  count();
  form.avatar.addEventListener('change', () => {
    const f = form.avatar.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Choose an image under 5 MB', 'error'); form.avatar.value = ''; return; }
    const img = el('<img class="avatar" alt="New avatar">');
    img.src = URL.createObjectURL(f);
    img.style.width = '96px'; img.style.height = '96px';
    $('.ep-preview', form).replaceChildren(img);
  });
  $('.ep-cancel', form).addEventListener('click', () => m.close());
  $('.ep-blocks', form).addEventListener('click', () => { m.close(); blockedAccounts(); });
  $('.ep-delete', form).addEventListener('click', () => { m.close(); deleteAccount(user); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    if (!form.avatar.files[0]) fd.delete('avatar');
    try {
      await api.patch('/api/me', fd);
      await store.refresh();
      m.close();
      toast('Profile updated', 'success');
      refresh();
    } catch (ex) {
      const err = $('.form-error', form);
      err.textContent = ex.message; err.hidden = false;
    }
  });
}

export async function inboxView({ query }) {
  if (!store.me) {
    const { loginRequired } = await import('./upload.js');
    return loginRequired('Log in to see likes, comments, mentions and new followers.');
  }
  const filters = [['all', 'All activity'], ['like', 'Likes'], ['comment', 'Comments'], ['mention', 'Mentions'], ['follow', 'Followers']];
  const active = filters.some(([k]) => k === query.type) ? query.type : 'all';
  const { items } = await api.get('/api/notifications');
  const shown = items.filter((n) => active === 'all' || n.type === active || (active === 'comment' && n.type === 'reply'));
  const root = el(html`<div class="page inbox">
    <h1>Inbox</h1>
    <div class="chips">${filters.map(([k, label]) => html`<a class="chip" aria-selected="${k === active}" href="/inbox${k === 'all' ? '' : `?type=${k}`}">${label}</a>`)}</div>
    <ul class="notif-list"></ul>
  </div>`);
  const list = $('.notif-list', root);
  const verb = { like: 'liked your video.', comment: 'commented:', reply: 'replied to your comment:', mention: 'mentioned you:', follow: 'started following you.' };
  if (!shown.length) list.append(el('<li class="empty-state"><h2>No activity yet</h2><p class="muted">When people interact with you, you\'ll see it here.</p></li>'));
  for (const n of shown) {
    const href = n.videoId ? `/@${store.me.username}/video/${n.videoId}` : `/@${n.actor.username}`;
    const li = el(html`<li class="notif ${n.read ? '' : 'unread'}">
      <a href="/@${n.actor.username}" class="n-avatar">${avatar(n.actor, 44)}</a>
      <a class="n-main" href="${href}"><strong>${n.actor.displayName}</strong> ${verb[n.type]}
        ${n.commentBody ? html`<span class="n-quote">${n.commentBody}</span>` : ''}<small>${timeAgo(n.createdAt)}</small></a>
      ${n.coverUrl ? html`<a href="${href}" class="n-thumb"><img src="${n.coverUrl}" alt=""></a>` : ''}
    </li>`);
    hydrateAvatars(li);
    list.append(li);
  }
  if (items.some((n) => !n.read)) {
    api.post('/api/notifications/read').then(() => store.set({ unread: 0 })).catch(() => {});
  }
  return { el: root };
}
