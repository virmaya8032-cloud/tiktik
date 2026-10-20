// Fasa 1a: reporting videos, comments and users, and blocking users.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, signUp, client, videoForm } from './helpers.js';

let srv;
const base = () => srv.base;
let maya, raj, lee, anon, videoId, rajVideoId, commentId;

before(async () => {
  srv = await startServer();
  maya = await signUp(base, 'maya');
  raj = await signUp(base, 'raj');
  lee = await signUp(base, 'lee');
  anon = client(base);
  videoId = (await maya('POST', '/api/videos', undefined, { form: videoForm('Nasi lemak #sarapan') })).json.video.id;
  rajVideoId = (await raj('POST', '/api/videos', undefined, { form: videoForm('Roti canai #sarapan') })).json.video.id;
  commentId = (await raj('POST', `/api/videos/${videoId}/comments`, { body: 'Sedapnya' })).json.comment.id;
});
after(() => srv.close());

test('report reasons are published', async () => {
  const r = await anon('GET', '/api/reports/reasons');
  assert.ok(r.json.reasons.includes('spam') && r.json.reasons.includes('other'));
});

test('report a video, a comment and a user', async () => {
  let r = await lee('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'spam', details: 'iklan' });
  assert.equal(r.status, 201, r.text);
  r = await lee('POST', '/api/reports', { targetType: 'comment', targetId: commentId, reason: 'harassment' });
  assert.equal(r.status, 201, r.text);
  r = await lee('POST', '/api/reports', { targetType: 'user', targetId: raj.id, reason: 'hate' });
  assert.equal(r.status, 201, r.text);
  const rows = srv.db.prepare('SELECT * FROM reports ORDER BY id').all();
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((x) => x.target_user_id), [maya.id, raj.id, raj.id], 'content owner is recorded');
  assert.equal(rows[0].snapshot, 'Nasi lemak #sarapan', 'snapshot keeps the reported text');
  assert.equal(rows[1].status, 'open');
});

test('a repeat report of the same target is idempotent', async () => {
  const r = await lee('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'violence' });
  assert.equal(r.status, 200);
  assert.equal(r.json.duplicate, true);
  assert.equal(srv.db.prepare("SELECT COUNT(*) AS n FROM reports WHERE target_type = 'video'").get().n, 1);
});

test('report validation: login, reason, type, target, own content', async () => {
  assert.equal((await anon('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'spam' })).status, 401);
  assert.equal((await lee('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'because' })).status, 400);
  assert.equal((await lee('POST', '/api/reports', { targetType: 'planet', targetId: 1, reason: 'spam' })).status, 400);
  assert.equal((await lee('POST', '/api/reports', { targetType: 'video', targetId: 99999, reason: 'spam' })).status, 404);
  assert.equal((await lee('POST', '/api/reports', { targetType: 'comment', targetId: 99999, reason: 'spam' })).status, 404);
  assert.equal((await maya('POST', '/api/reports', { targetType: 'video', targetId: videoId, reason: 'spam' })).status, 400);
  assert.equal((await lee('POST', '/api/reports', { targetType: 'user', targetId: lee.id, reason: 'spam' })).status, 400);
  const priv = (await maya('POST', '/api/videos', undefined, { form: videoForm('rahsia', { privacy: 'private' }) })).json.video.id;
  assert.equal((await lee('POST', '/api/reports', { targetType: 'video', targetId: priv, reason: 'spam' })).status, 404, 'cannot report what you cannot see');
});

test('block hides the other user everywhere, in both directions', async () => {
  await lee('POST', '/api/users/raj/follow');
  await raj('POST', '/api/users/lee/follow');
  let r = await lee('POST', '/api/users/raj/block');
  assert.deepEqual(r.json, { blocked: true });
  assert.equal((await lee('POST', '/api/users/raj/block')).status, 200, 'block is idempotent');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM follows WHERE (follower_id = ? AND followee_id = ?) OR (follower_id = ? AND followee_id = ?)')
    .get(lee.id, raj.id, raj.id, lee.id).n, 0, 'follows in both directions are removed');

  for (const [who, other] of [[lee, raj], [raj, lee]]) {
    // feed, explore, video page, profile grid
    r = await who('GET', '/api/feed/foryou?count=20');
    assert.ok(r.json.items.every((v) => v.author.id !== other.id), `${who.username}: for you`);
    r = await who('GET', '/api/explore');
    assert.ok(r.json.items.every((v) => v.author.id !== other.id), `${who.username}: explore`);
    const otherVideo = other === raj ? rajVideoId : null;
    if (otherVideo) assert.equal((await who('GET', `/api/videos/${otherVideo}`)).status, 404);
    r = await who('GET', `/api/users/${other.username}/videos`);
    assert.equal(r.json.items.length, 0, `${who.username}: profile grid`);
    // search and suggestions
    r = await who('GET', `/api/search?q=${other.username}`);
    assert.ok(r.json.users.every((u) => u.id !== other.id), `${who.username}: user search`);
    assert.ok(r.json.videos.every((v) => v.author.id !== other.id), `${who.username}: video search`);
    r = await who('GET', '/api/search?q=sarapan&type=videos');
    assert.ok(r.json.videos.every((v) => v.author.id !== other.id), `${who.username}: hashtag search`);
    r = await who('GET', `/api/search/suggest?q=${other.username}`);
    assert.ok(r.json.items.every((s) => s.text !== other.username), `${who.username}: suggest`);
    r = await who('GET', '/api/users');
    assert.ok(r.json.items.every((u) => u.id !== other.id), `${who.username}: suggested accounts`);
  }

  // comments by raj are hidden from lee on maya's video, and reply counts follow
  r = await lee('GET', `/api/videos/${videoId}/comments`);
  assert.ok(r.json.items.every((c) => c.author.id !== raj.id));
  r = await anon('GET', `/api/videos/${videoId}/comments`);
  assert.ok(r.json.items.some((c) => c.author.id === raj.id), 'others still see the comment');
});

test('a block stops follows, replies and notifications between the pair', async () => {
  assert.equal((await raj('POST', '/api/users/lee/follow')).status, 403);
  assert.equal((await lee('POST', '/api/users/raj/follow')).status, 403);
  const leeComment = (await lee('POST', `/api/videos/${videoId}/comments`, { body: 'Mantap' })).json.comment.id;
  assert.equal((await raj('POST', `/api/videos/${videoId}/comments`, { body: 'hai', parentId: leeComment })).status, 403);
  await raj('POST', `/api/videos/${videoId}/comments`, { body: 'hello @lee' });
  const r = await lee('GET', '/api/notifications');
  assert.ok(r.json.items.every((n) => n.actor.username !== 'raj'), 'no mention notification from a blocked user');
});

test('profile shows block state, block list, and unblock restores visibility', async () => {
  let r = await lee('GET', '/api/users/raj');
  assert.equal(r.status, 200, 'the profile stays reachable so it can be unblocked');
  assert.equal(r.json.viewer.isBlocked, true);
  assert.equal((await raj('GET', '/api/users/lee')).json.viewer.isBlocked, false, 'the blocked user is not told');
  r = await lee('GET', '/api/me/blocks');
  assert.deepEqual(r.json.items.map((u) => u.username), ['raj']);
  assert.equal((await anon('GET', '/api/me/blocks')).status, 401);
  assert.equal((await lee('POST', '/api/users/lee/block')).status, 400);

  r = await lee('DELETE', '/api/users/raj/block');
  assert.deepEqual(r.json, { blocked: false });
  assert.equal((await lee('GET', `/api/videos/${rajVideoId}`)).status, 200);
  assert.equal((await lee('GET', '/api/me/blocks')).json.items.length, 0);
  assert.equal((await lee('POST', '/api/users/raj/follow')).status, 200);
});
