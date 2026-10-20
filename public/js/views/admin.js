import { api, store } from '../api.js';
import { html, el, $, $$, fmtCount, timeAgo, toast, modal } from '../ui.js';
import { refresh } from '../router.js';
import { loginRequired } from './upload.js';

const REASON_LABELS = {
  spam: 'Spam or scam', harassment: 'Harassment', hate: 'Hate speech', violence: 'Violence', sexual: 'Sexual content',
  minor_safety: 'Child safety', self_harm: 'Self-harm', misinformation: 'False information', intellectual_property: 'Intellectual property', other: 'Other',
};
const ACTION_LABELS = {
  hide_video: 'Hid video', unhide_video: 'Restored video', delete_video: 'Deleted video',
  hide_comment: 'Hid comment', unhide_comment: 'Restored comment', delete_comment: 'Deleted comment',
  suspend_user: 'Suspended account', unsuspend_user: 'Lifted suspension', dismiss_reports: 'Dismissed reports',
};
const TABS = [['open', 'Open reports'], ['actioned', 'Actioned'], ['dismissed', 'Dismissed'], ['suspended', 'Suspended accounts'], ['log', 'Activity log']];

/** Moderation panel for admins: report queue, content actions, suspensions and the audit log. */
export async function adminView({ query }) {
  if (!store.me) return loginRequired('Log in with a moderator account to open the moderation panel.');
  if (!store.me.isAdmin) {
    return { el: el('<div class="page"><div class="empty-state"><h2>Moderators only</h2><p class="muted">Your account does not have access to this page.</p></div></div>') };
  }
  const tab = TABS.some(([k]) => k === query.tab) ? query.tab : 'open';
  const summary = await api.get('/api/admin/summary');
  const root = el(html`<div class="page page-wide admin">
    <h1>Moderation</h1>
    <div class="kpis">
      ${[['Open reports', summary.openReports], ['Suspended accounts', summary.suspendedUsers], ['Hidden videos', summary.hiddenVideos], ['Hidden comments', summary.hiddenComments]]
    .map(([k, n]) => html`<div class="kpi"><span>${k}</span><strong>${fmtCount(n)}</strong></div>`)}
    </div>
    <div class="tabs" role="tablist">
      ${TABS.map(([k, label]) => html`<a role="tab" aria-selected="${k === tab}" href="/admin${k === 'open' ? '' : `?tab=${k}`}">${label}</a>`)}
    </div>
    <div class="admin-body"><div class="spinner" aria-label="Loading"></div></div>
  </div>`);
  const body = $('.admin-body', root);
  try {
    if (tab === 'suspended') await renderSuspended(body);
    else if (tab === 'log') await renderLog(body);
    else await renderReports(body, tab);
  } catch (ex) {
    body.replaceChildren(el(html`<div class="empty-state"><p class="muted">${ex.message}</p></div>`));
  }
  return { el: root };
}

/** Run an admin call, then re-render the page so counts and lists stay accurate. */
async function run(fn, done) {
  try {
    await fn();
    toast(done, 'success');
    refresh();
  } catch (ex) { toast(ex.message, 'error'); }
}

function askReason(title, label, cb) {
  const form = el(html`<form class="form">
    <label class="field"><span>${label}</span><textarea name="reason" maxlength="300" rows="3" required></textarea></label>
    <div class="btn-row end"><button type="button" class="btn a-cancel">Cancel</button><button class="btn btn-primary">Confirm</button></div>
  </form>`);
  const m = modal(form, { title });
  $('.a-cancel', form).addEventListener('click', () => m.close());
  form.addEventListener('submit', (e) => { e.preventDefault(); m.close(); cb(form.reason.value.trim()); });
}

async function renderReports(body, status) {
  const { items } = await api.get(`/api/admin/reports?status=${status}`);
  if (!items.length) {
    body.replaceChildren(el(html`<div class="empty-state"><h2>${status === 'open' ? 'Queue is clear' : 'Nothing here yet'}</h2><p class="muted">${status === 'open' ? 'New reports from people will appear here.' : 'Resolved reports will appear here.'}</p></div>`));
    return;
  }
  // One card per target: the queue lists the most-reported targets first.
  const seen = new Set();
  const cards = [];
  for (const r of items) {
    const key = `${r.targetType}:${r.targetId}`;
    if (status === 'open' && seen.has(key)) continue;
    seen.add(key);
    cards.push(reportCard(r, status, items.filter((x) => `${x.targetType}:${x.targetId}` === key)));
  }
  body.replaceChildren(el('<div class="report-list"></div>'));
  $('.report-list', body).append(...cards);
}

function reportCard(r, status, group) {
  const t = r.target;
  const kind = { video: 'Video', comment: 'Comment', user: 'Account' }[r.targetType];
  const reasons = [...new Set(group.map((x) => REASON_LABELS[x.reason] || x.reason))];
  const card = el(html`<article class="report-card">
    <header class="rc-head">
      <span class="chip rc-kind">${kind}</span>
      <strong>${reasons.join(', ')}</strong>
      ${status === 'open' && r.openOnTarget > 1 ? html`<span class="badge">${r.openOnTarget} reports</span>` : ''}
      <small class="muted">${timeAgo(status === 'open' ? r.createdAt : r.resolvedAt)}</small>
    </header>
    <div class="rc-main">
      ${t.exists && t.videoUrl ? html`<video class="rc-video" src="${t.videoUrl}" ${t.coverUrl ? html`poster="${t.coverUrl}"` : ''} controls muted playsinline preload="metadata"></video>` : ''}
      <div class="rc-text">
        <p class="rc-snapshot">${r.snapshot || '(no text)'}</p>
        <p class="small muted">
          ${r.owner ? html`Owner <a href="/@${r.owner.username}">@${r.owner.username}</a>${r.owner.suspended ? ' (suspended)' : ''} · ` : ''}
          Reported by ${group.map((x) => (x.reporter ? `@${x.reporter.username}` : 'a deleted account')).join(', ')}
        </p>
        ${group.filter((x) => x.details).map((x) => html`<p class="rc-details small">"${x.details}"</p>`)}
        <p class="small rc-state">${!t.exists ? 'Content already removed.' : t.hidden ? 'Hidden by a moderator.' : t.suspended ? 'Account suspended.' : ''}
          ${t.exists && t.url ? html`<a href="${t.url}">Open</a>` : ''}</p>
      </div>
    </div>
    <footer class="btn-row rc-actions"></footer>
  </article>`);
  const actions = $('.rc-actions', card);
  const btn = (label, cls, onClick) => {
    const b = el(html`<button class="btn btn-sm ${cls}">${label}</button>`);
    b.addEventListener('click', onClick);
    actions.append(b);
    return b;
  };
  const confirmTwice = (label, cls, onConfirm) => btn(label, cls, (e) => {
    const b = e.currentTarget;
    if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = `Confirm ${label.toLowerCase()}`; return; }
    onConfirm();
  });
  const path = r.targetType === 'video' ? 'videos' : 'comments';
  if (t.exists && r.targetType !== 'user') {
    if (t.hidden) btn('Restore', '', () => run(() => api.post(`/api/admin/${path}/${r.targetId}/unhide`), `${kind} restored`));
    else btn('Hide', 'btn-primary', () => run(() => api.post(`/api/admin/${path}/${r.targetId}/hide`), `${kind} hidden`));
    confirmTwice('Delete', 'btn-danger', () => run(() => api.del(`/api/admin/${path}/${r.targetId}`), `${kind} deleted`));
  }
  const suspendId = r.targetType === 'user' ? r.targetId : r.owner?.id;
  const suspended = r.targetType === 'user' ? t.suspended : r.owner?.suspended;
  if (suspendId && (r.targetType === 'user' ? t.exists : true) && !r.owner?.isAdmin) {
    if (suspended) btn('Lift suspension', '', () => run(() => api.post(`/api/admin/users/${suspendId}/unsuspend`), 'Suspension lifted'));
    else {
      btn(r.targetType === 'user' ? 'Suspend account' : 'Suspend owner', 'btn-danger', () => askReason('Suspend account', 'Reason (shown in the audit log)', (reason) => {
        run(() => api.post(`/api/admin/users/${suspendId}/suspend`, { reason }), 'Account suspended');
      }));
    }
  }
  if (status === 'open') btn('Dismiss', '', () => run(() => api.post(`/api/admin/reports/${r.id}/dismiss`), 'Reports dismissed'));
  return card;
}

async function renderSuspended(body) {
  const { items } = await api.get('/api/admin/users');
  if (!items.length) { body.replaceChildren(el('<div class="empty-state"><h2>No suspended accounts</h2></div>')); return; }
  const list = el('<div class="user-list"></div>');
  for (const u of items) {
    const row = el(html`<div class="user-row">
      <a href="/@${u.username}" class="user-row-main"><span><strong>@${u.username}</strong>
        <small>${u.suspendedReason} · ${timeAgo(u.suspendedAt)}</small></span></a>
      <button class="btn btn-sm">Lift suspension</button>
    </div>`);
    $('button', row).addEventListener('click', () => run(() => api.post(`/api/admin/users/${u.id}/unsuspend`), 'Suspension lifted'));
    list.append(row);
  }
  body.replaceChildren(list);
}

async function renderLog(body) {
  const { items } = await api.get('/api/admin/log');
  if (!items.length) { body.replaceChildren(el('<div class="empty-state"><h2>No moderator actions yet</h2></div>')); return; }
  body.replaceChildren(el(html`<div class="table-wrap"><table class="posts admin-log">
    <thead><tr><th>When</th><th>Moderator</th><th>Action</th><th>Target</th><th>Note</th></tr></thead>
    <tbody>${items.map((l) => html`<tr><td>${timeAgo(l.createdAt)}</td><td>${l.admin ? `@${l.admin}` : '-'}</td>
      <td>${ACTION_LABELS[l.action] || l.action}</td><td>${l.targetType} #${l.targetId}</td><td>${l.note}</td></tr>`)}</tbody>
  </table></div>`));
  for (const td of $$('td', body)) td.classList.add('small');
}
