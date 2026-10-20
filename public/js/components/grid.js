import { html, el, avatar, hydrateAvatars, fmtCount } from '../ui.js';
import { icons } from '../icons.js';

/** Thumbnail tile linking to a video page; hover previews play muted. */
export function videoTile(v, { metric = 'likes', showAuthor = true } = {}) {
  const value = metric === 'views' ? v.stats.views : v.stats.likes;
  const tile = el(html`<a class="tile" href="/@${v.author.username}/video/${v.id}" aria-label="${v.caption || 'Video'} by ${v.author.username}">
    <div class="tile-media">
      ${v.coverUrl ? html`<img src="${v.coverUrl}" alt="" loading="lazy">` : html`<video src="${v.videoUrl}#t=0.5" muted preload="metadata" playsinline></video>`}
      <span class="tile-metric">${metric === 'views' ? icons.play16 : icons.heartLine}${fmtCount(value)}</span>
      ${v.privacy !== 'public' ? html`<span class="tile-badge">${v.privacy === 'private' ? 'Only me' : 'Followers'}</span>` : ''}
    </div>
    ${showAuthor ? html`<div class="tile-meta">
      <p class="tile-cap">${v.caption || ' '}</p>
      <span class="tile-author">${avatar(v.author, 20)}<span>${v.author.username}</span>${v.author.verified ? icons.verified : ''}</span>
    </div>` : ''}
  </a>`);
  hydrateAvatars(tile);

  // Lightweight hover preview (desktop pointers only).
  let preview = null;
  tile.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    preview = document.createElement('video');
    Object.assign(preview, { src: v.videoUrl, muted: true, loop: true, playsInline: true, className: 'tile-preview' });
    tile.querySelector('.tile-media').append(preview);
    preview.play().catch(() => {});
  });
  tile.addEventListener('pointerleave', () => { preview?.remove(); preview = null; });
  return tile;
}

export function videoGrid(items, opts) {
  const grid = el('<div class="grid"></div>');
  grid.append(...items.map((v) => videoTile(v, opts)));
  return grid;
}
