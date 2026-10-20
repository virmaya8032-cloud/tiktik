import { api, store } from '../api.js';
import { html, el, $, avatar, hydrateAvatars, richText, fmtCount, fmtTime, timeAgo, toast } from '../ui.js';
import { icons } from '../icons.js';
import { ensureLogin } from './auth.js';
import { openShareSheet } from './share.js';

// Cross-card sync: following a creator or muting applies to every mounted card.
const bus = new EventTarget();
// `at` = when the request that produced this state started; cards drop stale updates.
export const emitVideoUpdate = (video, at = Date.now()) => bus.dispatchEvent(new CustomEvent('video', { detail: { video, at } }));
export const emitFollow = (username, following) => bus.dispatchEvent(new CustomEvent('follow', { detail: { username, following } }));

export async function toggleFollow(username, following) {
  if (!(await ensureLogin())) return null;
  const res = following ? await api.del(`/api/users/${username}/follow`) : await api.post(`/api/users/${username}/follow`);
  emitFollow(username, res.following);
  toast(res.following ? `Following @${username}` : `Unfollowed @${username}`);
  return res;
}

/**
 * One vertical video with overlay info, progress/seek, and the action rail.
 * mode: 'feed' (snap feed card) | 'detail' (video page).
 */
export function createVideoCard(initial, { mode = 'feed', onComments } = {}) {
  let v = initial;
  const node = el(html`<article class="vcard vcard-${mode}" data-id="${v.id}">
    <div class="vstage">
      <video class="vmedia" playsinline loop preload="${mode === 'detail' ? 'auto' : 'metadata'}" ${v.coverUrl ? html`poster="${v.coverUrl}"` : ''} muted></video>
      <div class="v-tap" aria-hidden="true"></div>
      <div class="v-bigplay" hidden>${icons.bigPlay}</div>
      <div class="v-hearts" aria-hidden="true"></div>
      <div class="v-controls">
        <button class="icon-btn v-play" aria-label="Pause">${icons.pause}</button>
        <button class="icon-btn v-mute" aria-label="Unmute" aria-pressed="true">${icons.mute}</button>
      </div>
      <div class="v-info">
        <a class="v-author" href="/@${v.author.username}">@${v.author.username}${v.author.verified ? icons.verified : ''}
          <span class="v-date"> · ${v.author.displayName} · ${timeAgo(v.createdAt)}</span></a>
        <p class="v-caption">${richText(v.caption)}</p>
        <a class="v-sound" href="/search?q=${encodeURIComponent(v.sound)}&type=videos">${icons.music}<span class="marquee"><span>${v.sound}</span></span></a>
      </div>
      <div class="v-progress">
        <span class="v-time">00:00 / ${fmtTime(v.duration)}</span>
        <div class="v-bar" role="slider" tabindex="0" aria-label="Video progress" aria-valuemin="0" aria-valuemax="${Math.round(v.duration)}" aria-valuenow="0">
          <div class="v-fill"></div><div class="v-knob"></div>
        </div>
      </div>
    </div>
    <div class="vrail">
      <div class="rail-author">
        <a href="/@${v.author.username}" aria-label="${v.author.username} profile">${avatar(v.author, 48)}</a>
        <button class="rail-follow" aria-label="Follow ${v.author.username}">${icons.plusSmall}</button>
      </div>
      <button class="rail-btn r-like" aria-pressed="false"><span class="rail-ic">${icons.heart}</span><strong></strong></button>
      <button class="rail-btn r-comment"><span class="rail-ic">${icons.comment}</span><strong></strong></button>
      <button class="rail-btn r-fav" aria-pressed="false"><span class="rail-ic">${icons.bookmark}</span><strong></strong></button>
      <button class="rail-btn r-share"><span class="rail-ic">${icons.share}</span><strong></strong></button>
      <a class="rail-disc" href="/search?q=${encodeURIComponent(v.sound)}&type=videos" aria-label="Sound: ${v.sound}">${avatar(v.author, 28)}</a>
    </div>
  </article>`);
  hydrateAvatars(node);

  const video = $('video', node);
  video.src = v.videoUrl;
  video.muted = store.muted;
  const bar = $('.v-bar', node);
  const fill = $('.v-fill', node);
  const knob = $('.v-knob', node);
  const time = $('.v-time', node);
  const bigPlay = $('.v-bigplay', node);
  const playBtn = $('.v-play', node);
  const muteBtn = $('.v-mute', node);

  // ---- state rendering ----
  function render() {
    const like = $('.r-like', node);
    like.classList.toggle('on', v.viewer.liked);
    like.setAttribute('aria-pressed', String(v.viewer.liked));
    like.setAttribute('aria-label', `${v.viewer.liked ? 'Unlike' : 'Like'} video, ${v.stats.likes} likes`);
    $('strong', like).textContent = fmtCount(v.stats.likes);
    const fav = $('.r-fav', node);
    fav.classList.toggle('on', v.viewer.favorited);
    fav.setAttribute('aria-pressed', String(v.viewer.favorited));
    fav.setAttribute('aria-label', `${v.viewer.favorited ? 'Unsave' : 'Save'} video, ${v.stats.favorites} saves`);
    $('strong', fav).textContent = fmtCount(v.stats.favorites);
    const com = $('.r-comment', node);
    com.setAttribute('aria-label', `Comments, ${v.stats.comments}`);
    $('strong', com).textContent = fmtCount(v.stats.comments);
    const sh = $('.r-share', node);
    sh.setAttribute('aria-label', `Share video, ${v.stats.shares} shares`);
    $('strong', sh).textContent = fmtCount(v.stats.shares);
    $('.rail-follow', node).hidden = v.viewer.isAuthor || v.viewer.followingAuthor;
  }
  function applyUpdate(next) {
    if (next.id !== v.id) return;
    v = { ...v, ...next, viewer: { ...v.viewer, ...next.viewer } };
    render();
  }
  render();

  let mutatedAt = 0;
  const onBusVideo = (e) => { if (e.detail.at >= mutatedAt) applyUpdate(e.detail.video); };
  const onBusFollow = (e) => {
    if (e.detail.username !== v.author.username) return;
    v.viewer.followingAuthor = e.detail.following;
    render();
  };
  bus.addEventListener('video', onBusVideo);
  bus.addEventListener('follow', onBusFollow);
  const unsubStore = store.subscribe((s) => {
    video.muted = s.muted;
    muteBtn.replaceChildren(el(s.muted ? icons.mute : icons.volume));
    muteBtn.setAttribute('aria-label', s.muted ? 'Unmute' : 'Mute');
    muteBtn.setAttribute('aria-pressed', String(s.muted));
  });

  // ---- playback ----
  let active = false;
  let watchedMs = 0;
  let completed = false;
  let lastT = 0;

  function setPlayIcon() {
    const paused = video.paused;
    playBtn.replaceChildren(el(paused ? icons.play : icons.pause));
    playBtn.setAttribute('aria-label', paused ? 'Play' : 'Pause');
    bigPlay.hidden = !paused || !active;
  }
  async function play() {
    try {
      await video.play();
    } catch {
      // Autoplay with sound blocked: retry muted, otherwise show the play button.
      if (!video.muted) { store.set({ muted: true }); try { await video.play(); } catch { /* fallthrough */ } }
    }
    setPlayIcon();
  }
  function pause() { video.pause(); setPlayIcon(); }
  function togglePlay() { if (video.paused) play(); else pause(); }

  function flushView() {
    if (watchedMs >= 1000 || completed) {
      api.post(`/api/videos/${v.id}/view`, { watchedMs: Math.round(watchedMs), completed }).catch(() => {});
      v.stats.views += 1;
    }
    watchedMs = 0;
    completed = false;
  }

  function setActive(on) {
    if (on === active) return;
    active = on;
    node.classList.toggle('active', on);
    if (on) {
      lastT = video.currentTime;
      video.preload = 'auto';
      play();
    } else {
      pause();
      flushView();
      bigPlay.hidden = true;
    }
  }

  video.addEventListener('timeupdate', () => {
    const t = video.currentTime;
    const d = video.duration || v.duration || 0;
    const delta = t - lastT;
    if (delta > 0 && delta < 1.5) watchedMs += delta * 1000;
    if (delta < -1 && d && lastT > d * 0.8) completed = true; // looped back to start
    lastT = t;
    if (d) {
      const pct = Math.min(100, (t / d) * 100);
      fill.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;
      bar.setAttribute('aria-valuenow', String(Math.round(t)));
      time.textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
    }
  });
  video.addEventListener('seeked', () => { lastT = video.currentTime; });
  video.addEventListener('play', setPlayIcon);
  video.addEventListener('pause', setPlayIcon);
  video.addEventListener('error', () => {
    bigPlay.hidden = true;
    $('.vstage', node).classList.add('v-error');
  });

  // Seek by dragging/clicking the progress bar or with arrow keys.
  const seekTo = (clientX) => {
    const r = bar.getBoundingClientRect();
    const d = video.duration || v.duration;
    if (!d) return;
    video.currentTime = Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * d;
  };
  bar.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    bar.setPointerCapture(e.pointerId);
    node.classList.add('seeking');
    seekTo(e.clientX);
    const move = (ev) => seekTo(ev.clientX);
    const up = () => { node.classList.remove('seeking'); bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      video.currentTime = Math.max(0, video.currentTime + (e.key === 'ArrowRight' ? 2 : -2));
    }
  });

  // Single tap toggles playback; double tap likes with a heart burst.
  let tapTimer = null;
  $('.v-tap', node).addEventListener('click', (e) => {
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = null;
      heartBurst(e);
      if (!v.viewer.liked) toggleLike();
      return;
    }
    tapTimer = setTimeout(() => { tapTimer = null; togglePlay(); }, 260);
  });
  bigPlay.addEventListener('click', () => play());
  playBtn.addEventListener('click', togglePlay);
  muteBtn.addEventListener('click', () => store.set({ muted: !store.muted }));

  function heartBurst(e) {
    const layer = $('.v-hearts', node);
    const r = layer.getBoundingClientRect();
    const h = el(html`<span class="heart-pop">${icons.heart}</span>`);
    h.style.left = `${e.clientX - r.left}px`;
    h.style.top = `${e.clientY - r.top}px`;
    h.style.setProperty('--tilt', `${Math.round(Math.random() * 40 - 20)}deg`);
    layer.append(h);
    setTimeout(() => h.remove(), 900);
  }

  // ---- actions ----
  let busy = false;
  async function guarded(fn) {
    if (busy) return;
    if (!(await ensureLogin())) return;
    busy = true;
    mutatedAt = Date.now();
    try { await fn(); } catch (ex) { toast(ex.message, 'error'); } finally { busy = false; }
  }
  function toggleLike() {
    return guarded(async () => {
      // Optimistic update for instant feedback; server response is authoritative.
      const was = v.viewer.liked;
      applyUpdate({ id: v.id, viewer: { liked: !was }, stats: { ...v.stats, likes: v.stats.likes + (was ? -1 : 1) } });
      try {
        const { video: nv } = was ? await api.del(`/api/videos/${v.id}/like`) : await api.post(`/api/videos/${v.id}/like`);
        emitVideoUpdate(nv);
      } catch (ex) {
        applyUpdate({ id: v.id, viewer: { liked: was }, stats: { ...v.stats, likes: v.stats.likes + (was ? 1 : -1) } });
        throw ex;
      }
    });
  }
  $('.r-like', node).addEventListener('click', (e) => {
    toggleLike();
    const ic = $('.rail-ic', e.currentTarget);
    ic.classList.remove('pop'); void ic.offsetWidth; ic.classList.add('pop');
  });
  $('.r-fav', node).addEventListener('click', () => guarded(async () => {
    const { video: nv } = v.viewer.favorited ? await api.del(`/api/videos/${v.id}/favorite`) : await api.post(`/api/videos/${v.id}/favorite`);
    emitVideoUpdate(nv);
    toast(nv.viewer.favorited ? 'Saved' : 'Removed from Saved');
  }));
  $('.r-share', node).addEventListener('click', () => openShareSheet(v, (nv) => emitVideoUpdate(nv)));
  $('.r-comment', node).addEventListener('click', () => onComments?.(v, (n) => applyUpdate({ id: v.id, stats: { ...v.stats, comments: n } })));
  $('.rail-follow', node).addEventListener('click', () => guarded(() => toggleFollow(v.author.username, false)));

  return {
    el: node,
    get video() { return v; },
    setActive,
    togglePlay,
    setCommentCount(n) { applyUpdate({ id: v.id, stats: { ...v.stats, comments: n } }); },
    toggleLike,
    destroy() {
      if (active) flushView();
      active = false;
      bus.removeEventListener('video', onBusVideo);
      bus.removeEventListener('follow', onBusFollow);
      unsubStore();
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  };
}
