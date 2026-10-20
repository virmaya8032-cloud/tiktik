import { api, store, uploadWithProgress } from '../api.js';
import { html, el, $, $$, toast, fmtCount, fmtTime, timeAgo } from '../ui.js';
import { icons } from '../icons.js';
import { authForm } from '../components/auth.js';
import { navigate, refresh } from '../router.js';
import { categoryLabel } from './discover.js';

const MAX_BYTES = 200 * 1024 * 1024;
const MAX_SECONDS = 600;

export function loginRequired(message) {
  const root = el(html`<div class="page narrow"><div class="empty-state"><h2>Log in to continue</h2><p class="muted">${message}</p></div></div>`);
  $('.empty-state', root).append(authForm({ onDone: () => refresh() }));
  return { el: root };
}

export async function loginView({ query }) {
  const next = query.next && query.next.startsWith('/') && !query.next.startsWith('//') ? query.next : '/';
  if (store.me) { navigate(next, { replace: true }); return { el: el('<div></div>') }; }
  const root = el('<div class="page narrow login-page"></div>');
  root.append(authForm({ mode: query.mode === 'register' ? 'register' : 'login', onDone: () => navigate(next, { replace: true }) }));
  return { el: root };
}

/** Read duration/dimensions from a local file via a detached <video>. */
function probe(url) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      // Some WebM files report Infinity until seeked to the end.
      if (v.duration === Infinity) {
        v.currentTime = 1e9;
        v.ontimeupdate = () => { v.ontimeupdate = null; resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }); };
      } else resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
    };
    v.onerror = () => reject(new Error("This file can't be played in your browser."));
    v.src = url;
  });
}

/** Draw the frame at time t of a playing <video> into a JPEG blob. */
function captureFrame(video) {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, 720 / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

export async function uploadView() {
  if (!store.me) return loginRequired('Upload videos and share them with the TikTik community.');
  const { categories } = await api.get('/api/categories');
  const root = el(html`<div class="page upload">
    <h1>Upload video</h1>
    <p class="muted">Post a video to your account</p>
    <div class="up-grid">
      <label class="drop" tabindex="0">
        <input type="file" accept="video/mp4,video/webm,video/quicktime" class="sr-only" name="file">
        <span class="drop-ic">${icons.upload}</span>
        <strong>Select video to upload</strong>
        <span class="muted">Or drag and drop a file</span>
        <span class="muted small">MP4, WebM or MOV · up to 10 minutes · max 200 MB</span>
        <span class="btn btn-primary">Select file</span>
      </label>
      <div class="up-preview" hidden>
        <video playsinline muted loop controls></video>
        <div class="cover-pick">
          <span class="field-label">Cover <small class="muted">drag to choose a frame</small></span>
          <input type="range" min="0" max="1000" value="100" aria-label="Cover frame">
          <img alt="Cover preview" class="cover-img">
        </div>
        <button class="link-btn up-change">Change video</button>
      </div>
      <form class="form up-form" novalidate>
        <label class="field"><span>Caption <small class="muted cap-count">0/2200</small></span>
          <textarea name="caption" maxlength="2200" rows="4" placeholder="Describe your video. Add #hashtags and @mention friends."></textarea></label>
        <div class="btn-row"><button type="button" class="btn btn-sm ins" data-ins="#">#&nbsp;Hashtags</button><button type="button" class="btn btn-sm ins" data-ins="@">@&nbsp;Mention</button></div>
        <label class="field"><span>Sound name <small class="muted">optional</small></span><input name="sound" maxlength="100" placeholder="original sound - ${store.me.displayName}"></label>
        <div class="field-row">
          <label class="field"><span>Category</span><select name="category">${categories.map((c) => html`<option value="${c}" ${c === 'other' ? 'selected' : ''}>${categoryLabel(c)}</option>`)}</select></label>
          <label class="field"><span>Who can watch</span><select name="privacy"><option value="public">Everyone</option><option value="followers">Followers</option><option value="private">Only me</option></select></label>
        </div>
        <label class="check"><input type="checkbox" name="allowComments" checked> Allow comments</label>
        <div class="progress" hidden><div class="progress-bar"></div><span class="progress-label">0%</span></div>
        <p class="form-error" role="alert" hidden></p>
        <div class="btn-row end"><button type="button" class="btn up-discard">Discard</button><button class="btn btn-primary up-post" disabled>Post</button></div>
      </form>
    </div>
  </div>`);

  const drop = $('.drop', root);
  const fileInput = $('input[type=file]', root);
  const preview = $('.up-preview', root);
  const pv = $('video', preview);
  const range = $('.cover-pick input', root);
  const coverImg = $('.cover-img', root);
  const form = $('.up-form', root);
  const err = $('.form-error', root);
  const postBtn = $('.up-post', root);
  let file = null;
  let meta = null;
  let coverBlob = null;
  let objectUrl = null;
  let coverUrl = null;

  const showError = (m) => { err.textContent = m; err.hidden = !m; };

  async function choose(f) {
    showError('');
    if (!f) return;
    if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(f.type)) return showError('Please choose an MP4, WebM or MOV video.');
    if (f.size > MAX_BYTES) return showError('That file is larger than 200 MB.');
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(f);
    try {
      meta = await probe(objectUrl);
    } catch (ex) { return showError(ex.message); }
    if (meta.duration > MAX_SECONDS) return showError('Videos can be up to 10 minutes long.');
    file = f;
    pv.src = objectUrl;
    drop.hidden = true;
    preview.hidden = false;
    postBtn.disabled = false;
    if (!form.caption.value) form.caption.value = '';
    pv.addEventListener('loadeddata', () => setCover(0.1), { once: true });
  }

  async function setCover(frac) {
    if (!meta) return;
    pv.pause();
    pv.currentTime = Math.min(meta.duration - 0.05, Math.max(0, meta.duration * frac));
    await new Promise((r) => pv.addEventListener('seeked', r, { once: true }));
    coverBlob = await captureFrame(pv);
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = coverBlob ? URL.createObjectURL(coverBlob) : '';
    coverImg.src = coverUrl;
  }

  fileInput.addEventListener('change', () => choose(fileInput.files[0]));
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => choose(e.dataTransfer.files[0]));
  range.addEventListener('change', () => setCover(range.value / 1000));
  $('.up-change', root).addEventListener('click', () => fileInput.click());

  const capCount = () => { $('.cap-count', root).textContent = `${form.caption.value.length}/2200`; };
  form.caption.addEventListener('input', capCount);
  for (const b of $$('.ins', root)) {
    b.addEventListener('click', () => {
      const ta = form.caption;
      const pos = ta.selectionStart ?? ta.value.length;
      const pre = ta.value.slice(0, pos);
      const ins = (pre && !/\s$/.test(pre) ? ' ' : '') + b.dataset.ins;
      ta.value = pre + ins + ta.value.slice(pos);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = pos + ins.length;
      capCount();
    });
  }

  $('.up-discard', root).addEventListener('click', () => {
    file = null; meta = null; coverBlob = null;
    pv.removeAttribute('src'); pv.load();
    form.reset(); capCount();
    preview.hidden = true; drop.hidden = false; postBtn.disabled = true;
    fileInput.value = '';
    showError('');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file) return showError('Choose a video first.');
    showError('');
    const fd = new FormData();
    fd.append('video', file, file.name);
    if (coverBlob) fd.append('cover', coverBlob, 'cover.jpg');
    fd.append('caption', form.caption.value.trim());
    fd.append('sound', form.sound.value.trim());
    fd.append('category', form.category.value);
    fd.append('privacy', form.privacy.value);
    fd.append('allowComments', String(form.allowComments.checked));
    fd.append('duration', String(meta.duration));
    fd.append('width', String(meta.width));
    fd.append('height', String(meta.height));
    const prog = $('.progress', root);
    const bar = $('.progress-bar', root);
    const label = $('.progress-label', root);
    prog.hidden = false;
    postBtn.disabled = true;
    try {
      const { video } = await uploadWithProgress('/api/videos', fd, (p) => {
        bar.style.width = `${Math.round(p * 100)}%`;
        label.textContent = p < 1 ? `Uploading ${Math.round(p * 100)}%` : 'Processing...';
      });
      toast('Your video is posted!', 'success');
      navigate(`/@${video.author.username}/video/${video.id}`);
    } catch (ex) {
      showError(ex.message);
      postBtn.disabled = false;
      prog.hidden = true;
    }
  });

  return {
    el: root,
    destroy() {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (coverUrl) URL.revokeObjectURL(coverUrl);
    },
  };
}

export async function studioView() {
  if (!store.me) return loginRequired('Creator studio shows how your videos are performing.');
  const { items, totals } = await api.get('/api/studio');
  const root = el(html`<div class="page page-wide studio">
    <div class="sec-head"><h1>Creator studio</h1><a class="btn btn-primary" href="/upload">Upload</a></div>
    <div class="kpis">
      ${[['Views', totals.views], ['Likes', totals.likes], ['Comments', totals.comments], ['Shares', totals.shares], ['Followers', totals.followers], ['Videos', totals.videos]]
    .map(([k, n]) => html`<div class="kpi"><span>${k}</span><strong>${fmtCount(n)}</strong></div>`)}
    </div>
    <h2>Posts</h2>
    <div class="table-wrap"><table class="posts">
      <thead><tr><th>Video</th><th>Posted</th><th>Privacy</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th><th>Avg. watch</th><th>Completion</th><th></th></tr></thead>
      <tbody></tbody>
    </table></div>
  </div>`);
  const body = $('tbody', root);
  if (!items.length) body.append(el('<tr><td colspan="10" class="empty">No posts yet - upload your first video.</td></tr>'));
  for (const v of items) {
    const tr = el(html`<tr>
      <td><a class="post-cell" href="/@${v.author.username}/video/${v.id}">${v.coverUrl ? html`<img src="${v.coverUrl}" alt="">` : html`<span class="ph"></span>`}<span>${v.caption || '(no caption)'}${v.viewer.hiddenByModerator ? html`<span class="badge" title="Only you can see this video. It was hidden for breaking the community guidelines.">Hidden by moderator</span>` : ''}</span></a></td>
      <td>${timeAgo(v.createdAt)}</td>
      <td><select aria-label="Privacy" class="priv">
        <option value="public" ${v.privacy === 'public' ? 'selected' : ''}>Everyone</option>
        <option value="followers" ${v.privacy === 'followers' ? 'selected' : ''}>Followers</option>
        <option value="private" ${v.privacy === 'private' ? 'selected' : ''}>Only me</option></select></td>
      <td>${fmtCount(v.stats.views)}</td><td>${fmtCount(v.stats.likes)}</td><td>${fmtCount(v.stats.comments)}</td><td>${fmtCount(v.stats.shares)}</td>
      <td>${fmtTime(v.analytics.avgWatchMs / 1000)}</td><td>${Math.round(v.analytics.completionRate * 100)}%</td>
      <td><button class="btn btn-sm btn-danger del" aria-label="Delete video">${icons.trash}</button></td>
    </tr>`);
    $('.priv', tr).addEventListener('change', async (e) => {
      try { await api.patch(`/api/videos/${v.id}`, { privacy: e.target.value }); toast('Privacy updated', 'success'); } catch (ex) { toast(ex.message, 'error'); }
    });
    $('.del', tr).addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.armed !== '1') { btn.dataset.armed = '1'; btn.textContent = 'Confirm'; setTimeout(() => { btn.dataset.armed = ''; btn.replaceChildren(el(icons.trash)); }, 4000); return; }
      try { await api.del(`/api/videos/${v.id}`); tr.remove(); toast('Video deleted'); } catch (ex) { toast(ex.message, 'error'); }
    });
    body.append(tr);
  }
  return { el: root };
}
