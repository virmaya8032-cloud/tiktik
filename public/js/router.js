// History-API router. Views are async functions returning { el, destroy? }.

const routes = [];
let current = null;
let outlet = null;
let onChange = () => {};
let navToken = 0;

export function route(pattern, view) {
  // '/@:username/video/:id' -> regex with named groups
  const re = new RegExp(`^${pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, '(?<$1>[^/]+)')}\\/?$`);
  routes.push({ re, view });
}

export function startRouter(container, changed) {
  outlet = container;
  onChange = changed;
  window.addEventListener('popstate', () => render());
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download') || a.dataset.external !== undefined) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname.startsWith('/media/') || url.pathname.startsWith('/api/')) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });
  return render();
}

export function navigate(url, { replace = false } = {}) {
  if (url === location.pathname + location.search && !replace) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', url);
  return render();
}

/** Re-render the current URL (e.g. after login). */
export function refresh() { return render(); }

/**
 * Tell the mounted view the session changed. Views that can update in place
 * (keeping scroll position and playback) implement onAuthChange() returning true.
 */
export function authChanged() {
  if (current?.onAuthChange?.()) return;
  render();
}

async function render() {
  const token = ++navToken;
  const path = decodeURIComponent(location.pathname);
  const query = Object.fromEntries(new URLSearchParams(location.search));
  let match = null;
  let view = null;
  for (const r of routes) {
    match = path.match(r.re);
    if (match) { view = r.view; break; }
  }
  current?.destroy?.();
  current = null;
  outlet.replaceChildren();
  outlet.setAttribute('aria-busy', 'true');
  onChange(path);
  try {
    const result = await (view || notFoundView)({ params: match?.groups || {}, query, path });
    if (token !== navToken) { result?.destroy?.(); return; } // a newer navigation won
    current = result;
    outlet.replaceChildren(result.el);
    result.mounted?.();
  } catch (err) {
    if (token !== navToken) return;
    console.error(err);
    const box = document.createElement('div');
    box.className = 'empty-state';
    const h = document.createElement('h2');
    h.textContent = err.status === 404 ? "Couldn't find this page" : 'Something went wrong';
    const p = document.createElement('p');
    p.textContent = err.message;
    box.append(h, p);
    outlet.replaceChildren(box);
  } finally {
    if (token === navToken) outlet.removeAttribute('aria-busy');
  }
}

function notFoundView() {
  const err = new Error('The link may be broken or the page may have been removed.');
  err.status = 404;
  throw err;
}
