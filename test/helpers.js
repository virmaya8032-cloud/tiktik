// Shared helpers for the API test files: an isolated server per file and a cookie-jar client.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

/** Start an isolated app (in-memory DB, temp upload dir). Returns { base, db, uploadDir, close }. */
export async function startServer(options = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipwave-test-'));
  const uploadDir = path.join(tmp, 'uploads');
  const { app, db } = createApp({ dbFile: ':memory:', uploadDir, ...options });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    db,
    uploadDir,
    close: () => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); },
  };
}

/** Minimal cookie-jar client: call(method, url, body?, { form? }) -> { status, json, text, headers }. */
export function client(getBase) {
  let cookie = '';
  return async function call(method, url, body, { form } = {}) {
    const headers = { 'X-Requested-With': 'clipwave' };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(getBase() + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
}

export function videoForm(caption, extra = {}) {
  const form = new FormData();
  form.append('video', new Blob([Buffer.alloc(2048, 7)], { type: 'video/webm' }), 'clip.webm');
  form.append('cover', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'cover.png');
  form.append('caption', caption);
  form.append('category', extra.category || 'food');
  if (extra.privacy) form.append('privacy', extra.privacy);
  return form;
}

/** Register a user and return their client. */
export async function signUp(getBase, username, password = 'password123') {
  const c = client(getBase);
  const r = await c('POST', '/api/auth/register', { username, password });
  if (r.status !== 201) throw new Error(`register ${username}: ${r.status} ${r.text}`);
  c.id = r.json.user.id;
  c.username = username;
  return c;
}
