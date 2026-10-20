// Fasa 1b: admin role, report queue, hide/delete content, suspend accounts, audit log.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, signUp, client, videoForm } from './helpers.js';

let srv;
const base = () => srv.base;
let admin, maya, raj, lee, anon, videoId, video2Id, commentId;

before(async () => {
  srv = await startServer();
  admin = await signUp(base, 'boss');
  srv.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  maya = await signUp(base, 'maya');
  raj = await signUp(base, 'raj');
  lee = await signUp(base, 'lee');
  anon = client(base);
  videoId = (await maya('POST', '/api/videos', undefined, { form: videoForm('Video bermasalah #ujian') })).json.video.id;
  video2Id = (await maya('POST', '/api/videos', undefined, { form: videoForm('Video kedua') })).json.video.id;
  commentId = (await raj('POST', `/api/videos/${video2Id}/comments`, { body: 'komen kasar' })).json.comment.id;
  await lee('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'spam' });
  await raj('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'violence' });
  await lee('POST', '/api/reports', { targetType: 'comment', targetId: commentId, reason: 'harassment' });
  await lee('POST', '/api/reports', { targetType: 'user', targetId: raj.id, reason: 'hate' });
});
after(() => srv.close());

test('admin endpoints are closed to visitors and normal users', async () => {
  for (const [method, url] of [['GET', '/api/admin/summary'], ['GET', '/api/admin/reports'], ['POST', `/api/admin/videos/${videoId}/hide`],
    ['DELETE', `/api/admin/comments/${commentId}`], ['POST', `/api/admin/users/${raj.id}/suspend`], ['GET', '/api/admin/log']]) {
    const body = method === 'GET' ? undefined : {};
    assert.equal((await anon(method, url, body)).status, 401, `${method} ${url} anon`);
    assert.equal((await lee(method, url, body)).status, 403, `${method} ${url} user`);
  }
});

test('auth/me tells the client who is an admin', async () => {
  assert.equal((await admin('GET', '/api/auth/me')).json.user.isAdmin, true);
  assert.equal((await lee('GET', '/api/auth/me')).json.user.isAdmin, false);
  assert.equal((await lee('GET', '/api/users/boss')).json.user.isAdmin, undefined, 'role is not exposed on public profiles');
});

test('report queue groups by target and shows the current state', async () => {
  const s = (await admin('GET', '/api/admin/summary')).json;
  assert.equal(s.openReports, 4);
  const r = await admin('GET', '/api/admin/reports');
  assert.equal(r.json.items.length, 4);
  const first = r.json.items[0];
  assert.equal(first.targetType, 'video', 'the most-reported target comes first');
  assert.equal(first.openOnTarget, 2);
  assert.equal(first.owner.username, 'maya');
  assert.equal(first.reporter.username, 'lee');
  assert.equal(first.target.exists, true);
  assert.match(first.target.videoUrl, /^\/media\/videos\//, 'admins can preview the video');
  const c = r.json.items.find((x) => x.targetType === 'comment');
  assert.equal(c.target.body, 'komen kasar');
});

test('hide and unhide a video', async () => {
  let r = await admin('POST', `/api/admin/videos/${videoId}/hide`, { note: 'spam berulang' });
  assert.deepEqual(r.json, { ok: true, hidden: true });
  assert.equal((await lee('GET', `/api/videos/${videoId}`)).status, 404, 'hidden from others');
  assert.equal((await anon('GET', '/api/explore')).json.items.some((v) => v.id === videoId), false);
  assert.equal((await anon('GET', '/api/search?q=bermasalah&type=videos')).json.videos.length, 0);
  assert.equal((await anon('GET', '/api/hashtags/ujian')).json.items.length, 0);
  const own = await maya('GET', `/api/videos/${videoId}`);
  assert.equal(own.status, 200, 'the owner can still see it');
  assert.equal(own.json.video.viewer.hiddenByModerator, true);
  assert.equal((await maya('GET', '/api/studio')).json.items.find((v) => v.id === videoId).viewer.hiddenByModerator, true);
  const open = srv.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_type = 'video' AND status = 'open'").get().n;
  assert.equal(open, 0, 'both reports on the video were closed');
  r = await admin('GET', '/api/admin/reports?status=actioned');
  assert.equal(r.json.items.length, 2);

  await admin('POST', `/api/admin/videos/${videoId}/unhide`);
  assert.equal((await lee('GET', `/api/videos/${videoId}`)).status, 200);
  assert.equal((await maya('GET', `/api/videos/${videoId}`)).json.video.viewer.hiddenByModerator, false);
});

test('hide and delete a comment', async () => {
  await admin('POST', `/api/admin/comments/${commentId}/hide`);
  assert.equal((await anon('GET', `/api/videos/${video2Id}/comments`)).json.items.length, 0);
  assert.equal((await lee('POST', `/api/videos/${video2Id}/comments`, { body: 'balas', parentId: commentId })).status, 400, 'cannot reply to a hidden comment');
  await admin('POST', `/api/admin/comments/${commentId}/unhide`);
  assert.equal((await anon('GET', `/api/videos/${video2Id}/comments`)).json.items.length, 1);
  assert.equal((await admin('DELETE', `/api/admin/comments/${commentId}`)).status, 200);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM comments WHERE id = ?').get(commentId).n, 0);
  const rep = (await admin('GET', '/api/admin/reports?status=actioned')).json.items.find((x) => x.targetType === 'comment');
  assert.equal(rep.target.exists, false, 'the report remembers a removed target');
  assert.equal(rep.snapshot, 'komen kasar');
});

test('delete a video removes the row and its media files', async () => {
  const row = srv.db.prepare('SELECT * FROM videos WHERE id = ?').get(video2Id);
  const file = path.join(srv.uploadDir, row.video_path);
  assert.ok(fs.existsSync(file));
  assert.equal((await admin('DELETE', `/api/admin/videos/${video2Id}`)).status, 200);
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM videos WHERE id = ?').get(video2Id).n, 0);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(fs.existsSync(file), false);
  assert.equal((await admin('DELETE', `/api/admin/videos/${video2Id}`)).status, 404);
});

test('suspend an account: logged out, cannot log in, content and profile hidden', async () => {
  const rajVideo = (await raj('POST', '/api/videos', undefined, { form: videoForm('Video raj') })).json.video.id;
  const rajComment = (await raj('POST', `/api/videos/${videoId}/comments`, { body: 'komen raj' })).json.comment.id;
  await raj('POST', '/api/users/lee/follow');
  await lee('POST', '/api/reports', { targetType: 'video', targetId: rajVideo, reason: 'spam' });
  assert.equal((await admin('POST', `/api/admin/users/${raj.id}/suspend`, {})).status, 400, 'a reason is required');
  assert.equal((await admin('POST', `/api/admin/users/${raj.id}/suspend`, { reason: 'ucapan kebencian' })).status, 200);

  assert.equal((await raj('GET', '/api/auth/me')).json.user, null, 'existing session ended');
  const login = await client(base)('POST', '/api/auth/login', { username: 'raj', password: 'password123' });
  assert.equal(login.status, 403);
  assert.match(login.json.error, /suspended/);
  assert.equal((await lee('GET', `/api/videos/${rajVideo}`)).status, 404);
  assert.equal((await lee('GET', `/api/videos/${videoId}/comments`)).json.items.some((c) => c.id === rajComment), false);
  assert.equal((await lee('GET', '/api/users/raj')).status, 404);
  assert.equal((await admin('GET', '/api/users/raj')).status, 200, 'admins can still open the profile');
  assert.equal((await lee('GET', '/api/search?q=raj')).json.users.length, 0);
  assert.ok((await lee('GET', '/api/notifications')).json.items.every((n) => n.actor.username !== 'raj'));
  assert.equal((await admin('GET', '/api/admin/users')).json.items[0].suspendedReason, 'ucapan kebencian');
  assert.equal(srv.db.prepare("SELECT status FROM reports WHERE target_type = 'user'").get().status, 'actioned');
  assert.equal(srv.db.prepare("SELECT status FROM reports WHERE target_type = 'video' AND target_id = ?").get(rajVideo).status, 'actioned',
    'reports about the suspended user\'s content are closed too');

  assert.equal((await admin('POST', `/api/admin/users/${admin.id}/suspend`, { reason: 'x' })).status, 400, 'cannot suspend yourself');

  await admin('POST', `/api/admin/users/${raj.id}/unsuspend`);
  assert.equal((await client(base)('POST', '/api/auth/login', { username: 'raj', password: 'password123' })).status, 200);
  assert.equal((await lee('GET', `/api/videos/${rajVideo}`)).status, 200);
});

test('dismiss closes every open report on the target; the log records all actions', async () => {
  await lee('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'other' });
  await raj('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'spam' });
  const id = (await admin('GET', '/api/admin/reports')).json.items[0].id;
  assert.equal((await admin('POST', `/api/admin/reports/${id}/dismiss`, { note: 'tiada pelanggaran' })).status, 200);
  assert.equal((await admin('GET', '/api/admin/summary')).json.openReports, 0);
  const log = (await admin('GET', '/api/admin/log')).json.items;
  const actions = log.map((l) => l.action);
  for (const a of ['hide_video', 'unhide_video', 'hide_comment', 'delete_comment', 'delete_video', 'suspend_user', 'unsuspend_user', 'dismiss_reports']) {
    assert.ok(actions.includes(a), `log has ${a}`);
  }
  assert.equal(log[0].admin, 'boss');
  assert.equal(log[0].note, 'tiada pelanggaran');
});

test('a database from before this release gains the new columns without losing data', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { openDatabase } = await import('../server/db.js');
  const os = await import('node:os');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'clipwave-mig-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '', avatar_path TEXT, password_hash TEXT NOT NULL, verified INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
    INSERT INTO users (username, display_name, password_hash, created_at) VALUES ('lama', 'Lama', 'x', 1);`);
  old.close();
  const db = openDatabase(file);
  const u = db.prepare('SELECT * FROM users').get();
  assert.equal(u.username, 'lama');
  assert.equal(u.role, 'user');
  assert.equal(u.suspended_at, null);
  db.close();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});
