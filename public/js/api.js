// Thin fetch wrapper for the Clipwave REST API plus the shared session store.

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function api(method, url, body) {
  const opts = { method, headers: { 'X-Requested-With': 'clipwave' }, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(url, opts);
  } catch {
    throw new ApiError(0, 'Network error - check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) store.requireLogin?.();
    throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  }
  return data;
}

api.get = (url) => api('GET', url);
api.post = (url, body) => api('POST', url, body ?? {});
api.patch = (url, body) => api('PATCH', url, body ?? {});
api.del = (url) => api('DELETE', url);

/** Multipart upload with progress callback (fetch has no upload progress). */
export function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('X-Requested-With', 'clipwave');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload.'));
    xhr.send(formData);
  });
}

// ---- session store ----
const listeners = new Set();
export const store = {
  me: null,
  unread: 0,
  muted: true, // browsers only autoplay muted media; user unmutes once per session
  requireLogin: null,
  async refresh() {
    const data = await api.get('/api/auth/me').catch(() => ({ user: null }));
    this.me = data.user;
    this.unread = data.unreadNotifications || 0;
    this.emit();
  },
  set(patch) { Object.assign(this, patch); this.emit(); },
  emit() { for (const fn of listeners) fn(this); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};
