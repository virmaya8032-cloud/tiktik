import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

let server;
let base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipwave-test-'));

before(async () => {
  const { app } = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads') });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

/** Minimal cookie-jar client per test user. */
function client() {
  let cookie = '';
  return async function call(method, url, body, { form } = {}) {
    const headers = { 'X-Requested-With': 'clipwave' };
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  };
}

function videoForm(caption, extra = {}) {
  const form = new FormData();
  form.append('video', new Blob([Buffer.alloc(2048, 7)], { type: 'video/webm' }), 'clip.webm');
  form.append('cover', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'cover.png');
  form.append('caption', caption);
  form.append('category', extra.category || 'food');
  form.append('duration', '6.5');
  form.append('width', '720');
  form.append('height', '1280');
  if (extra.privacy) form.append('privacy', extra.privacy);
  if (extra.allowComments !== undefined) form.append('allowComments', String(extra.allowComments));
  return form;
}

const alice = client();
const bob = client();
const anon = client();
let videoId;

test('register, duplicate, validation, session', async () => {
  let r = await alice('POST', '/api/auth/register', { username: 'alice', password: 'password123', displayName: 'Alice' });
  assert.equal(r.status, 201);
  assert.equal(r.json.user.username, 'alice');
  r = await bob('POST', '/api/auth/register', { username: 'bob', password: 'password123' });
  assert.equal(r.status, 201);
  r = await anon('POST', '/api/auth/register', { username: 'ALICE', password: 'password123' });
  assert.equal(r.status, 409, 'usernames are case-insensitive unique');
  r = await anon('POST', '/api/auth/register', { username: 'x', password: 'short' });
  assert.equal(r.status, 400);
  r = await alice('GET', '/api/auth/me');
  assert.equal(r.json.user.username, 'alice');
  r = await anon('GET', '/api/auth/me');
  assert.equal(r.json.user, null);
});

test('login rejects wrong password and accepts right one', async () => {
  const c = client();
  assert.equal((await c('POST', '/api/auth/login', { username: 'alice', password: 'nope-nope' })).status, 401);
  assert.equal((await c('POST', '/api/auth/login', { username: 'alice', password: 'password123' })).status, 200);
  assert.equal((await c('POST', '/api/auth/logout')).status, 200);
  assert.equal((await c('GET', '/api/auth/me')).json.user, null);
});

test('CSRF header is required for mutations', async () => {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});

test('upload requires auth and validates mime type', async () => {
  assert.equal((await anon('POST', '/api/videos', undefined, { form: videoForm('x') })).status, 401);
  const bad = new FormData();
  bad.append('video', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  assert.equal((await alice('POST', '/api/videos', undefined, { form: bad })).status, 400);
});

test('upload a video with hashtags and a mention', async () => {
  const r = await alice('POST', '/api/videos', undefined, { form: videoForm('Pasta night #Food #quickrecipe cc @bob') });
  assert.equal(r.status, 201, r.text);
  videoId = r.json.video.id;
  assert.equal(r.json.video.author.username, 'alice');
  assert.equal(r.json.video.viewer.isAuthor, true);
  assert.match(r.json.video.videoUrl, /^\/media\/videos\//);
  const media = await fetch(base + r.json.video.videoUrl, { headers: { Range: 'bytes=0-99' } });
  assert.equal(media.status, 206, 'media supports range requests');
  assert.equal((await media.arrayBuffer()).byteLength, 100);
  const tag = await anon('GET', '/api/hashtags/food');
  assert.equal(tag.json.items.length, 1);
});

test('like / favorite / share toggles and counters', async () => {
  let r = await bob('POST', `/api/videos/${videoId}/like`);
  assert.equal(r.json.video.stats.likes, 1);
  assert.equal(r.json.video.viewer.liked, true);
  r = await bob('POST', `/api/videos/${videoId}/like`);
  assert.equal(r.json.video.stats.likes, 1, 'like is idempotent');
  r = await bob('DELETE', `/api/videos/${videoId}/like`);
  assert.equal(r.json.video.stats.likes, 0);
  await bob('POST', `/api/videos/${videoId}/like`);
  r = await bob('POST', `/api/videos/${videoId}/favorite`);
  assert.equal(r.json.video.stats.favorites, 1);
  r = await anon('POST', `/api/videos/${videoId}/share`, { channel: 'copy_link' });
  assert.equal(r.json.video.stats.shares, 1);
  assert.equal((await anon('POST', `/api/videos/${videoId}/like`)).status, 401);
});

test('comments, replies, comment likes, delete permissions', async () => {
  let r = await bob('POST', `/api/videos/${videoId}/comments`, { body: 'Looks delicious!' });
  assert.equal(r.status, 201);
  const cid = r.json.comment.id;
  r = await alice('POST', `/api/videos/${videoId}/comments`, { body: 'Thanks @bob', parentId: cid });
  assert.equal(r.json.comment.parentId, cid);
  r = await alice('POST', `/api/comments/${cid}/like`);
  assert.equal(r.json.comment.likes, 1);
  r = await anon('GET', `/api/videos/${videoId}/comments`);
  assert.equal(r.json.items.length, 1);
  assert.equal(r.json.items[0].replyCount, 1);
  r = await anon('GET', `/api/videos/${videoId}/comments?parent=${cid}`);
  assert.equal(r.json.items[0].body, 'Thanks @bob');
  assert.equal((await bob('POST', `/api/videos/${videoId}/comments`, { body: '   ' })).status, 400);
  const third = client();
  await third('POST', '/api/auth/register', { username: 'carol', password: 'password123' });
  assert.equal((await third('DELETE', `/api/comments/${cid}`)).status, 403);
  // Video owner may moderate comments on their video.
  const extra = await bob('POST', `/api/videos/${videoId}/comments`, { body: 'second' });
  assert.equal((await alice('DELETE', `/api/comments/${extra.json.comment.id}`)).status, 200);
});

test('follow graph, profile stats and following feed', async () => {
  let r = await bob('POST', '/api/users/alice/follow');
  assert.equal(r.json.followers, 1);
  assert.equal((await bob('POST', '/api/users/bob/follow')).status, 400);
  r = await bob('GET', '/api/users/alice');
  assert.equal(r.json.viewer.isFollowing, true);
  assert.equal(r.json.stats.likes, 1);
  assert.equal(r.json.stats.videos, 1);
  r = await bob('GET', '/api/feed/following');
  assert.equal(r.json.items.length, 1);
  r = await anon('GET', '/api/users/alice/followers');
  assert.equal(r.json.items[0].username, 'bob');
  assert.equal((await anon('GET', '/api/feed/following')).status, 401);
});

test('privacy: followers-only and private videos', async () => {
  const f = await alice('POST', '/api/videos', undefined, { form: videoForm('friends only', { privacy: 'followers' }) });
  const p = await alice('POST', '/api/videos', undefined, { form: videoForm('just me', { privacy: 'private' }) });
  assert.equal((await anon('GET', `/api/videos/${f.json.video.id}`)).status, 404);
  assert.equal((await bob('GET', `/api/videos/${f.json.video.id}`)).status, 200, 'followers can see followers-only');
  assert.equal((await bob('GET', `/api/videos/${p.json.video.id}`)).status, 404);
  assert.equal((await alice('GET', `/api/videos/${p.json.video.id}`)).status, 200);
  const explore = await anon('GET', '/api/explore');
  assert.ok(explore.json.items.every((v) => v.privacy === 'public'));
  const del = await alice('DELETE', `/api/videos/${p.json.video.id}`);
  assert.equal(del.status, 200);
  assert.equal((await bob('DELETE', `/api/videos/${f.json.video.id}`)).status, 403);
});

test('comments can be turned off', async () => {
  const r = await alice('POST', '/api/videos', undefined, { form: videoForm('no comments', { allowComments: false }) });
  assert.equal((await bob('POST', `/api/videos/${r.json.video.id}/comments`, { body: 'hi' })).status, 403);
});

test('for you feed ranks, paginates with exclude, and records views', async () => {
  let r = await anon('GET', '/api/feed/foryou?count=2');
  assert.equal(r.status, 200);
  assert.ok(r.json.items.length >= 1);
  const ids = r.json.items.map((v) => v.id);
  r = await anon('GET', `/api/feed/foryou?count=20&exclude=${ids.join(',')}`);
  assert.ok(r.json.items.every((v) => !ids.includes(v.id)), 'excluded ids are not repeated');
  r = await bob('POST', `/api/videos/${videoId}/view`, { watchedMs: 6000, completed: true });
  assert.equal(r.status, 200);
  r = await anon('GET', `/api/videos/${videoId}`);
  assert.equal(r.json.video.stats.views, 1);
});

test('search users / videos / hashtags and suggestions', async () => {
  let r = await anon('GET', '/api/search?q=ali');
  assert.equal(r.json.users[0].username, 'alice');
  r = await anon('GET', '/api/search?q=%23quick&type=videos');
  assert.equal(r.json.videos.length, 1);
  r = await anon('GET', '/api/search?q=pasta&type=videos');
  assert.equal(r.json.videos[0].id, videoId);
  r = await anon('GET', '/api/search?q=100%25');
  assert.equal(r.status, 200, 'LIKE wildcards are escaped');
  r = await anon('GET', '/api/search/suggest?q=fo');
  assert.ok(r.json.items.some((s) => s.text === '#food'));
});

test('notifications fan out and can be marked read', async () => {
  let r = await alice('GET', '/api/notifications');
  const types = r.json.items.map((n) => n.type).sort();
  assert.ok(types.includes('like') && types.includes('comment') && types.includes('follow'), types.join());
  r = await bob('GET', '/api/notifications');
  assert.ok(r.json.items.some((n) => n.type === 'mention'), 'bob was @mentioned');
  assert.ok(r.json.items.some((n) => n.type === 'reply'));
  await alice('POST', '/api/notifications/read');
  r = await alice('GET', '/api/auth/me');
  assert.equal(r.json.unreadNotifications, 0);
});

test('profile edit, liked tab privacy, studio analytics', async () => {
  const form = new FormData();
  form.append('displayName', 'Alice Cooks');
  form.append('bio', 'Home chef');
  form.append('avatar', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'a.png');
  let r = await alice('PATCH', '/api/me', undefined, { form });
  assert.equal(r.json.user.displayName, 'Alice Cooks');
  assert.ok(r.json.user.avatarUrl);
  assert.equal((await alice('GET', '/api/users/bob/videos?tab=liked')).status, 403);
  r = await bob('GET', '/api/users/bob/videos?tab=liked');
  assert.equal(r.json.items.length, 1);
  r = await alice('GET', '/api/studio');
  assert.ok(r.json.totals.views >= 1);
  assert.ok(r.json.items.find((v) => v.id === videoId).analytics.completionRate > 0);
});

test('SPA fallback and unknown API route', async () => {
  const page = await fetch(`${base}/@alice/video/1`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="app"/);
  assert.equal((await anon('GET', '/api/nope')).status, 404);
});

test('invite code gates sign-up in private-group mode', async () => {
  const { app } = createApp({ dbFile: ':memory:', uploadDir: path.join(tmp, 'uploads-invite'), inviteCode: 'kawan2026' });
  const srv = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api/auth`;
  const post = (body) => fetch(`${url}/register`, { method: 'POST', headers: { 'X-Requested-With': 'clipwave', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.deepEqual(await (await fetch(`${url}/config`)).json(), { inviteRequired: true });
    assert.equal((await post({ username: 'eve', password: 'password123' })).status, 403);
    assert.equal((await post({ username: 'eve', password: 'password123', inviteCode: 'wrong' })).status, 403);
    assert.equal((await post({ username: 'eve', password: 'password123', inviteCode: 'kawan2026' })).status, 201);
  } finally { srv.close(); }
  // default instance (no code) stays open
  assert.deepEqual(await (await fetch(`${base}/api/auth/config`)).json(), { inviteRequired: false });
});

test('session cookie is Secure only when the request came in over https', async () => {
  const reg = (username, proto) => fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'clipwave', 'Content-Type': 'application/json', ...(proto ? { 'X-Forwarded-Proto': proto } : {}) },
    body: JSON.stringify({ username, password: 'password123' }),
  });
  assert.match((await reg('https.user', 'https')).headers.get('set-cookie'), /;\s*Secure/i);
  assert.doesNotMatch((await reg('plain.user')).headers.get('set-cookie'), /;\s*Secure/i);
});
