import { api } from '../api.js';
import { html, el, $, $$, toast, copyText } from '../ui.js';
import { createVideoCard } from '../components/player.js';
import { commentsPanel } from '../components/comments.js';
import { videoTile } from '../components/grid.js';
import { navigate } from '../router.js';

/** Single video page: player on the left, Comments / You may like on the right. */
export async function videoView({ params }) {
  const { video } = await api.get(`/api/videos/${encodeURIComponent(params.id)}`);
  if (video.author.username.toLowerCase() !== params.username.toLowerCase()) {
    // Canonicalise the URL if the handle was wrong or changed.
    history.replaceState(null, '', `/@${video.author.username}/video/${video.id}`);
  }
  const url = `${location.origin}/@${video.author.username}/video/${video.id}`;
  const root = el(html`<div class="video-page">
    <div class="vp-player"></div>
    <aside class="vp-side">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="comments">Comments</button>
        <button role="tab" aria-selected="false" data-tab="related">You may like</button>
      </div>
      <div class="vp-copy"><input readonly value="${url}" aria-label="Video link"><button class="btn btn-sm">Copy link</button></div>
      <div class="vp-panel" data-panel="comments"></div>
      <div class="vp-panel" data-panel="related" hidden><div class="grid grid-2"></div></div>
    </aside>
  </div>`);
  const card = createVideoCard(video, { mode: 'detail', onComments: () => selectTab('comments') });
  $('.vp-player', root).append(card.el);
  $('[data-panel=comments]', root).append(commentsPanel(video, { onCount: (n) => card.setCommentCount(n) }));

  let relatedLoaded = false;
  async function selectTab(tab) {
    for (const b of $$('[data-tab]', root)) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of $$('[data-panel]', root)) p.hidden = p.dataset.panel !== tab;
    if (tab === 'comments') $('.c-form input', root)?.focus();
    if (tab === 'related' && !relatedLoaded) {
      relatedLoaded = true;
      try {
        const { items } = await api.get(`/api/videos/${video.id}/related`);
        const grid = $('[data-panel=related] .grid', root);
        if (!items.length) grid.replaceWith(el('<p class="empty small">No similar videos yet.</p>'));
        else grid.append(...items.map((v) => videoTile(v)));
      } catch (ex) { toast(ex.message, 'error'); }
    }
  }
  for (const b of $$('[data-tab]', root)) b.addEventListener('click', () => selectTab(b.dataset.tab));
  $('.vp-copy button', root).addEventListener('click', async () => {
    if (await copyText(url)) toast('Link copied', 'success');
    api.post(`/api/videos/${video.id}/share`, { channel: 'copy_link' }).catch(() => {});
  });

  const onKey = (e) => {
    if (e.target.closest('input, textarea, .modal')) return;
    if (e.key === ' ') { e.preventDefault(); card.togglePlay(); }
    if (e.key === 'Escape') navigate('/');
  };
  document.addEventListener('keydown', onKey);
  return {
    el: root,
    mounted() { card.setActive(true); },
    destroy() { document.removeEventListener('keydown', onKey); card.destroy(); },
  };
}
