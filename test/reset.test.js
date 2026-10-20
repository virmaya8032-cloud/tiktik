// Fasa 1d: password reset with single-use tokens that expire after 30 minutes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, signUp, client } from './helpers.js';

let srv;
let mailSrv;
const sent = [];
const base = () => srv.base;
const mailBase = () => mailSrv.base;
let admin, lee, anon;

const tokenFrom = (url) => new URL(url).searchParams.get('token');

before(async () => {
  srv = await startServer({ mailer: null }); // email off: admin links only
  mailSrv = await startServer({ mailer: { send: async (m) => { sent.push(m); } }, publicUrl: 'https://tiktik.example' });
  admin = await signUp(base, 'boss');
  srv.db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  lee = await signUp(base, 'lee');
  anon = client(base);
});
after(() => { srv.close(); mailSrv.close(); });

test('email is optional, validated, unique and private', async () => {
  const c = client(mailBase);
  assert.equal((await c('POST', '/api/auth/register', { username: 'ana', password: 'password123', email: 'bukan-emel' })).status, 400);
  let r = await c('POST', '/api/auth/register', { username: 'ana', password: 'password123', email: 'Ana@Example.com' });
  assert.equal(r.status, 201);
  assert.equal((await c('GET', '/api/auth/me')).json.user.email, 'Ana@Example.com');
  assert.equal(r.json.user.email, undefined, 'not part of the public user shape');
  const other = client(mailBase);
  r = await other('POST', '/api/auth/register', { username: 'ben', password: 'password123', email: 'ana@example.com' });
  assert.equal(r.status, 409, 'unique regardless of case');
  await other('POST', '/api/auth/register', { username: 'ben', password: 'password123' });
  const form = new FormData();
  form.append('displayName', 'Ben');
  form.append('email', 'ben@example.com');
  r = await other('PATCH', '/api/me', undefined, { form });
  assert.equal(r.status, 200);
  assert.equal((await other('GET', '/api/auth/me')).json.user.email, 'ben@example.com');
  const noEmail = new FormData();
  noEmail.append('bio', 'hai');
  await other('PATCH', '/api/me', undefined, { form: noEmail });
  assert.equal((await other('GET', '/api/auth/me')).json.user.email, 'ben@example.com', 'a profile edit without the field keeps it');
  const clear = new FormData();
  clear.append('email', '');
  await other('PATCH', '/api/me', undefined, { form: clear });
  assert.equal((await other('GET', '/api/auth/me')).json.user.email, '');
});

test('forgot password emails a link when email is configured', async () => {
  const c = client(mailBase);
  const r = await c('POST', '/api/auth/forgot', { login: 'ana@example.com' });
  assert.deepEqual(r.json, { ok: true, emailEnabled: true });
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'Ana@Example.com');
  const url = sent[0].text.match(/https:\/\/\S+/)[0];
  assert.match(url, /^https:\/\/tiktik\.example\/reset-password\?token=/, 'uses PUBLIC_URL');
  const token = tokenFrom(url);
  assert.equal((await c('GET', `/api/auth/reset/${token}`)).json.username, 'ana');
  const row = mailSrv.db.prepare('SELECT token_hash FROM password_resets').get();
  assert.notEqual(row.token_hash, token, 'only a hash of the token is stored');
  assert.equal((await c('POST', '/api/auth/reset', { token, password: 'baru-12345' })).status, 200);
  assert.equal((await client(mailBase)('POST', '/api/auth/login', { username: 'ana', password: 'baru-12345' })).status, 200);
});

test('forgot password gives the same answer for unknown accounts and accounts without email', async () => {
  const before = sent.length;
  for (const login of ['ben', 'tiada-sesiapa', 'nobody@example.com']) {
    const r = await client(mailBase)('POST', '/api/auth/forgot', { login });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true, emailEnabled: true });
  }
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(sent.length, before, 'no email was sent');
  assert.equal((await client(mailBase)('POST', '/api/auth/forgot', {})).status, 400);
  const off = await anon('POST', '/api/auth/forgot', { login: 'lee' });
  assert.deepEqual(off.json, { ok: true, emailEnabled: false }, 'tells the client to ask a moderator');
  assert.equal(srv.db.prepare('SELECT COUNT(*) AS n FROM password_resets').get().n, 0);
});

test('admins create reset links; normal users cannot', async () => {
  assert.equal((await lee('POST', '/api/admin/reset-link', { username: 'lee' })).status, 403);
  assert.equal((await admin('POST', '/api/admin/reset-link', { username: 'nobody' })).status, 404);
  const r = await admin('POST', '/api/admin/reset-link', { username: '@lee' });
  assert.equal(r.status, 200);
  assert.equal(r.json.username, 'lee');
  assert.match(r.json.url, /\/reset-password\?token=[\w-]{43}$/);
  assert.ok(Math.abs(r.json.expiresAt - (Date.now() + 30 * 60 * 1000)) < 5000, 'expires in 30 minutes');
  const log = (await admin('GET', '/api/admin/log')).json.items[0];
  assert.equal(log.action, 'reset_link');
  assert.doesNotMatch(JSON.stringify(log), new RegExp(tokenFrom(r.json.url)), 'the token is not written to the log');
});

test('a reset link works once, logs out every device and changes the password', async () => {
  const phone = client(base);
  await phone('POST', '/api/auth/login', { username: 'lee', password: 'password123' });
  const token = tokenFrom((await admin('POST', '/api/admin/reset-link', { username: 'lee' })).json.url);
  assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'pendek' })).status, 400);
  assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'rahsia-baru-1' })).status, 200);
  assert.equal((await anon('POST', '/api/auth/reset', { token, password: 'rahsia-baru-2' })).status, 404, 'single use');
  assert.equal((await anon('GET', `/api/auth/reset/${token}`)).status, 404);
  assert.equal((await lee('GET', '/api/auth/me')).json.user, null, 'existing sessions ended');
  assert.equal((await phone('GET', '/api/auth/me')).json.user, null);
  assert.equal((await client(base)('POST', '/api/auth/login', { username: 'lee', password: 'password123' })).status, 401);
  assert.equal((await client(base)('POST', '/api/auth/login', { username: 'lee', password: 'rahsia-baru-1' })).status, 200);
});

test('a newer link replaces the older one; expired and bogus tokens fail', async () => {
  const first = tokenFrom((await admin('POST', '/api/admin/reset-link', { username: 'lee' })).json.url);
  const second = tokenFrom((await admin('POST', '/api/admin/reset-link', { username: 'lee' })).json.url);
  assert.equal((await anon('GET', `/api/auth/reset/${first}`)).status, 404, 'older link revoked');
  assert.equal((await anon('GET', `/api/auth/reset/${second}`)).status, 200);
  srv.db.prepare('UPDATE password_resets SET expires_at = ? WHERE used_at IS NULL').run(Date.now() - 1);
  assert.equal((await anon('POST', '/api/auth/reset', { token: second, password: 'rahsia-baru-3' })).status, 404, 'expired after 30 minutes');
  assert.equal((await anon('POST', '/api/auth/reset', { token: 'palsu', password: 'rahsia-baru-3' })).status, 404);
  assert.equal((await anon('POST', '/api/auth/reset', { password: 'rahsia-baru-3' })).status, 404);
});
