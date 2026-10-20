// Fasa 1c: deleting an account removes the user's data and media files.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, signUp, client, videoForm } from './helpers.js';

let srv;
const base = () => srv.base;
let gone, stay, anon, goneVideo, stayVideo, files;

const count = (sql, ...p) => srv.db.prepare(sql).get(...p).n;

before(async () => {
  srv = await startServer();
  gone = await signUp(base, 'pergi');
  stay = await signUp(base, 'kekal');
  anon = client(base);

  const avatar = new FormData();
  avatar.append('avatar', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'a.png');
  await gone('PATCH', '/api/me', undefined, { form: avatar });
  goneVideo = (await gone('POST', '/api/videos', undefined, { form: videoForm('Video saya #pergi') })).json.video.id;
  stayVideo = (await stay('POST', '/api/videos', undefined, { form: videoForm('Video kekal #kekal') })).json.video.id;

  // The leaving user's activity on someone else's video...
  await gone('POST', `/api/videos/${stayVideo}/like`);
  await gone('POST', `/api/videos/${stayVideo}/favorite`);
  const c = (await gone('POST', `/api/videos/${stayVideo}/comments`, { body: 'komen saya' })).json.comment.id;
  await stay('POST', `/api/videos/${stayVideo}/comments`, { body: 'balasan kekal', parentId: c });
  await gone('POST', '/api/users/kekal/follow');
  await gone('POST', '/api/users/kekal/block').then(() => gone('DELETE', '/api/users/kekal/block'));
  await gone('POST', '/api/users/kekal/follow');
  // ...and other people's activity on theirs.
  await stay('POST', `/api/videos/${goneVideo}/like`);
  await stay('POST', `/api/videos/${goneVideo}/comments`, { body: 'komen pada video pergi' });
  await stay('POST', '/api/users/pergi/follow');
  await stay('POST', `/api/videos/${goneVideo}/view`, { watchedMs: 3000, completed: true });
  await stay('POST', '/api/reports', { targetType: 'user', targetId: gone.id, reason: 'spam' });
  const keep = (await stay('POST', `/api/videos/${stayVideo}/comments`, { body: 'komen kekal sendiri' })).json.comment.id;
  await gone('POST', `/api/comments/${keep}/like`);

  const u = srv.db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(gone.id);
  const v = srv.db.prepare('SELECT video_path, cover_path FROM videos WHERE id = ?').get(goneVideo);
  files = [u.avatar_path, v.video_path, v.cover_path].map((p) => path.join(srv.uploadDir, p));
});
after(() => srv.close());

test('delete requires login and the right password', async () => {
  assert.equal((await anon('DELETE', '/api/me', { password: 'password123' })).status, 401);
  assert.equal((await gone('DELETE', '/api/me', {})).status, 400);
  assert.equal((await gone('DELETE', '/api/me', { password: 'salah-salah' })).status, 403);
  assert.equal((await gone('GET', '/api/auth/me')).json.user.username, 'pergi', 'nothing happened yet');
});

test('deleting removes the account, its content, activity and media', async () => {
  assert.ok(files.every((f) => fs.existsSync(f)), 'fixture files exist');
  const r = await gone('DELETE', '/api/me', { password: 'password123' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie'), /cw_session=;/, 'session cookie is cleared');
  assert.equal((await gone('GET', '/api/auth/me')).json.user, null);

  const id = gone.id;
  assert.equal(count('SELECT COUNT(*) AS n FROM users WHERE id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM videos WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM comments WHERE video_id = ?', goneVideo), 0, "comments on the user's videos");
  assert.equal(count('SELECT COUNT(*) AS n FROM likes WHERE user_id = ? OR video_id = ?', id, goneVideo), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM comment_likes WHERE user_id = ?', id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ? OR followee_id = ?', id, id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM blocks WHERE blocker_id = ? OR blocked_id = ?', id, id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? OR actor_id = ?', id, id), 0);
  assert.equal(count('SELECT COUNT(*) AS n FROM watch_events WHERE user_id = ? OR video_id = ?', id, goneVideo), 0);
  assert.equal(count("SELECT COUNT(*) AS n FROM hashtags WHERE name = 'pergi'"), 0, 'orphaned hashtags are removed');
  assert.equal(count("SELECT COUNT(*) AS n FROM hashtags WHERE name = 'kekal'"), 1);
  const rep = srv.db.prepare("SELECT * FROM reports WHERE target_type = 'user'").get();
  assert.equal(rep.target_user_id, null, 'reports keep their snapshot but drop the link');
  assert.match(rep.snapshot, /pergi/);

  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(files.every((f) => !fs.existsSync(f)), 'avatar, video and cover files are deleted');
});

test('other people keep their content; counts and pages update', async () => {
  const v = (await stay('GET', `/api/videos/${stayVideo}`)).json.video;
  assert.equal(v.stats.likes, 0);
  assert.equal(v.stats.favorites, 0);
  const comments = (await stay('GET', `/api/videos/${stayVideo}/comments`)).json.items;
  assert.deepEqual(comments.map((c) => c.body), ['komen kekal sendiri'], 'the deleted comment and its replies are gone');
  assert.equal(comments[0].likes, 0);
  const prof = (await stay('GET', '/api/users/kekal')).json.stats;
  assert.equal(prof.followers, 0);
  assert.equal(prof.following, 0);
  assert.equal((await anon('GET', '/api/users/pergi')).status, 404);
  assert.equal((await anon('GET', `/api/videos/${goneVideo}`)).status, 404);
  assert.equal((await anon('GET', '/api/search?q=pergi')).json.users.length, 0);
});

test('the username can be registered again', async () => {
  const again = await signUp(base, 'pergi', 'katalaluan-baru');
  assert.notEqual(again.id, undefined);
  assert.equal((await again('GET', '/api/users/pergi')).json.stats.videos, 0);
});
