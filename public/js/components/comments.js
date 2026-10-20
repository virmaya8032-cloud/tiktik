import { api, store } from '../api.js';
import { html, el, $, $$, avatar, hydrateAvatars, richText, timeAgo, fmtCount, toast } from '../ui.js';
import { icons } from '../icons.js';
import { ensureLogin } from './auth.js';
import { openReportDialog } from './report.js';

/**
 * Comment thread for one video. Returns an element; calls onCount(n) whenever
 * the total comment count changes so the action rail can stay in sync.
 */
export function commentsPanel(video, { onCount, onClose } = {}) {
  let total = video.stats.comments;
  let replyTo = null;
  const root = el(html`<section class="comments" aria-label="Comments">
    <header class="comments-head">
      <h3>Comments <span class="c-total">${fmtCount(total)}</span></h3>
      ${onClose ? html`<button class="icon-btn c-close" aria-label="Close comments">${icons.close}</button>` : ''}
    </header>
    <div class="c-list" role="list"><div class="spinner" aria-label="Loading"></div></div>
    <form class="c-form" autocomplete="off">
      <div class="c-replying" hidden><span></span><button type="button" class="link-btn c-cancel">Cancel</button></div>
      <div class="c-row">
        <input name="body" maxlength="500" placeholder="Add a comment..." aria-label="Add a comment">
        <button class="btn btn-primary btn-sm" type="submit" disabled>Post</button>
      </div>
    </form>
  </section>`);
  const list = $('.c-list', root);
  const form = $('.c-form', root);
  const input = form.body;
  const postBtn = $('button[type=submit]', form);

  $('.c-close', root)?.addEventListener('click', () => onClose());
  input.addEventListener('input', () => { postBtn.disabled = !input.value.trim(); });
  input.addEventListener('focus', () => { if (!store.me) { input.blur(); ensureLogin(); } });
  $('.c-cancel', root).addEventListener('click', () => setReply(null));

  function setCount(n) {
    total = Math.max(0, n);
    $('.c-total', root).textContent = fmtCount(total);
    onCount?.(total);
  }
  function setReply(c) {
    replyTo = c;
    const box = $('.c-replying', root);
    box.hidden = !c;
    if (c) { $('span', box).textContent = `Replying to @${c.author.username}`; input.focus(); }
  }

  function commentEl(c, isReply = false) {
    const canDelete = c.isMine || video.viewer.isAuthor;
    const node = el(html`<div class="comment ${isReply ? 'reply' : ''}" role="listitem" data-id="${c.id}">
      <a href="/@${c.author.username}" class="c-avatar">${avatar(c.author, isReply ? 28 : 36)}</a>
      <div class="c-main">
        <a href="/@${c.author.username}" class="c-name">${c.author.displayName}${c.author.verified ? icons.verified : ''}
          ${c.author.id === video.author.id ? html`<span class="badge">Creator</span>` : ''}</a>
        <p class="c-body">${richText(c.body)}</p>
        <div class="c-meta">
          <span>${timeAgo(c.createdAt)}</span>
          <button class="link-btn c-reply">Reply</button>
          ${canDelete ? html`<button class="link-btn c-del">Delete</button>` : ''}
          ${c.isMine ? '' : html`<button class="link-btn c-report">Report</button>`}
        </div>
        ${!isReply && c.replyCount ? html`<button class="link-btn c-more">View ${c.replyCount} ${c.replyCount === 1 ? 'reply' : 'replies'}</button>` : ''}
        <div class="c-replies"></div>
      </div>
      <button class="c-like ${c.liked ? 'on' : ''}" aria-pressed="${c.liked}" aria-label="Like comment">${icons.heartLine}<span>${fmtCount(c.likes)}</span></button>
    </div>`);
    hydrateAvatars(node);
    const own = (sel) => $$(sel, node).find((x) => x.closest('.comment') === node);
    own('.c-reply')?.addEventListener('click', async () => { if (await ensureLogin()) setReply(c); });
    own('.c-like').addEventListener('click', async (e) => {
      const btn = e.currentTarget; // currentTarget is null after the first await
      if (!(await ensureLogin())) return;
      try {
        const { comment } = c.liked ? await api.del(`/api/comments/${c.id}/like`) : await api.post(`/api/comments/${c.id}/like`);
        Object.assign(c, { liked: comment.liked, likes: comment.likes });
        btn.classList.toggle('on', c.liked);
        btn.setAttribute('aria-pressed', String(c.liked));
        $('span', btn).textContent = fmtCount(c.likes);
      } catch (ex) { toast(ex.message, 'error'); }
    });
    own('.c-report')?.addEventListener('click', () => openReportDialog({ type: 'comment', id: c.id, label: 'comment' }));
    own('.c-del')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Confirm delete'; return; }
      try {
        await api.del(`/api/comments/${c.id}`);
        node.remove();
        setCount(total - 1 - (isReply ? 0 : c.replyCount));
        toast('Comment deleted');
      } catch (ex) { toast(ex.message, 'error'); }
    });
    own('.c-more')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { items } = await api.get(`/api/videos/${video.id}/comments?parent=${c.id}`);
        const box = own('.c-replies');
        box.replaceChildren(...items.map((r) => commentEl(r, true)));
        btn.remove();
      } catch (ex) { toast(ex.message, 'error'); btn.disabled = false; }
    });
    return node;
  }

  async function load() {
    try {
      const { items, allowComments } = await api.get(`/api/videos/${video.id}/comments`);
      if (!allowComments && !video.viewer.isAuthor) {
        form.hidden = true;
        list.replaceChildren(el('<p class="empty small">Comments are turned off for this video.</p>'));
        return;
      }
      if (!items.length) list.replaceChildren(el('<p class="empty small c-empty">No comments yet. Start the conversation!</p>'));
      else list.replaceChildren(...items.map((c) => commentEl(c)));
    } catch (ex) {
      list.replaceChildren(el(html`<p class="empty small">${ex.message}</p>`));
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body || !(await ensureLogin())) return;
    postBtn.disabled = true;
    try {
      const { comment } = await api.post(`/api/videos/${video.id}/comments`, { body, parentId: replyTo?.id });
      input.value = '';
      $('.c-empty', list)?.remove();
      if (comment.parentId) {
        const parentNode = $$('.comment', list).find((n) => Number(n.dataset.id) === comment.parentId);
        const box = parentNode ? $$('.c-replies', parentNode).find((x) => x.closest('.comment') === parentNode) : null;
        (box || list).append(commentEl(comment, true));
      } else {
        list.prepend(commentEl(comment));
        list.scrollTop = 0;
      }
      setReply(null);
      setCount(total + 1);
    } catch (ex) {
      toast(ex.message, 'error');
      postBtn.disabled = false;
    }
  });

  load();
  return root;
}
