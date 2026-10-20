// Small DOM/templating helpers shared by every view.

const RAW = Symbol('raw');

/** Mark a string as trusted HTML so html`` does not escape it. */
export const raw = (s) => ({ [RAW]: String(s) });

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function interp(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return String(v); // aria-pressed="${flag}" etc.
  if (Array.isArray(v)) return v.map(interp).join('');
  if (typeof v === 'object' && RAW in v) return v[RAW];
  return esc(v);
}

/** Tagged template: interpolations are HTML-escaped unless wrapped with raw() or html``. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += interp(v) + strings[i + 1]; });
  return raw(out);
}

/** Build a single element from an html`` result or string. */
export function el(markup) {
  const t = document.createElement('template');
  t.innerHTML = (typeof markup === 'object' && RAW in markup ? markup[RAW] : String(markup)).trim();
  return t.content.firstElementChild;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function fmtCount(n) {
  n = Number(n) || 0;
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${+(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  return `${+(n / 1_000_000_000).toFixed(1)}B`;
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d > 300 ? 'numeric' : undefined });
}

/** Escape caption text and turn #hashtags and @mentions into in-app links. */
export function richText(text) {
  const escaped = esc(text);
  return raw(escaped
    .replace(/#([\p{L}\p{N}_]{1,50})/gu, (_m, tag) => `<a href="/tag/${encodeURIComponent(tag.toLowerCase())}" class="tag">#${tag}</a>`)
    .replace(/(^|[^\w])@([a-z0-9_.]{3,24})/gi, (_m, pre, u) => `${pre}<a href="/@${u}" class="mention">@${u}</a>`));
}

const PALETTE = ['#7c5cff', '#00c2a8', '#ff8a3d', '#e84d8a', '#3d9bff', '#9bcf3a', '#c86bfa', '#f5b700'];

export function avatar(user, size = 40, cls = '') {
  if (user?.avatarUrl) {
    return html`<img class="avatar ${cls}" src="${user.avatarUrl}" alt="${user.username}" width="${size}" height="${size}" loading="lazy">`;
  }
  const name = user?.displayName || user?.username || '?';
  const color = PALETTE[[...String(user?.username || name)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];
  return html`<span class="avatar avatar-fallback ${cls}" data-size="${size}" data-color="${color}" role="img" aria-label="${user?.username || name}">${name.slice(0, 1).toUpperCase()}</span>`;
}

/** Apply sizes/colours that cannot be inline style attributes under our CSP. */
export function hydrateAvatars(root) {
  for (const a of $$('.avatar-fallback[data-size]', root)) {
    const s = `${a.dataset.size}px`;
    a.style.width = s; a.style.height = s; a.style.fontSize = `${Math.round(a.dataset.size * 0.45)}px`;
    a.style.background = a.dataset.color;
    a.removeAttribute('data-size');
  }
  for (const img of $$('img.avatar[width]', root)) {
    img.style.width = `${img.getAttribute('width')}px`; img.style.height = `${img.getAttribute('height')}px`;
  }
  return root;
}

let toastTimer;
export function toast(message, kind = 'info') {
  let t = $('#toast');
  if (!t) { t = el('<div id="toast" role="status" aria-live="polite"></div>'); document.body.append(t); }
  t.textContent = message;
  t.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 2600);
}

/** Open a modal dialog. Returns { root, close }. */
export function modal(content, { title = '', cls = '', onClose } = {}) {
  const root = el(html`<div class="modal-backdrop" role="presentation">
    <div class="modal ${cls}" role="dialog" aria-modal="true" aria-label="${title || 'Dialog'}">
      <div class="modal-head">${title ? html`<h2>${title}</h2>` : ''}<button class="icon-btn modal-close" aria-label="Close">${raw(ICON_CLOSE)}</button></div>
      <div class="modal-body"></div>
    </div></div>`);
  const body = $('.modal-body', root);
  if (typeof content === 'string' || (content && RAW in content)) body.append(el(html`<div>${content}</div>`));
  else body.append(content);
  hydrateAvatars(root);
  const prevFocus = document.activeElement;
  const close = () => {
    root.remove();
    document.removeEventListener('keydown', onKey, true);
    prevFocus?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  $('.modal-close', root).addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.append(root);
  ($('input, textarea, button:not(.modal-close)', body) || $('.modal-close', root)).focus();
  return { root, body, close };
}

const ICON_CLOSE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('<textarea class="offscreen"></textarea>');
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/** Calls cb when sentinel scrolls into view; returns disconnect fn. */
export function onVisible(sentinel, cb, rootMargin = '600px') {
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) cb(); }, { rootMargin });
  io.observe(sentinel);
  return () => io.disconnect();
}
