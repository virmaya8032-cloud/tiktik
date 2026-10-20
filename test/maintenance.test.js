// Fasa 2a: health check, expired-row cleanup and database backups.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startServer, signUp } from './helpers.js';
import { cleanup, backup, startMaintenance } from '../server/maintenance.js';

let srv;
const base = () => srv.base;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipwave-maint-'));

before(async () => { srv = await startServer(); });
after(() => { srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('GET /healthz answers when the database is up', async () => {
  const r = await fetch(`${srv.base}/healthz`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test('cleanup removes expired sessions and spent reset links only', async () => {
  const u = await signUp(base, 'sesi');
  const now = Date.now();
  const db = srv.db;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run('lama', u.id, now - 1);
  const insertReset = db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, ?, ?)');
  insertReset.run('tamat', u.id, now - 1, null, now);
  insertReset.run('diguna', u.id, now + 60_000, now, now);
  insertReset.run('hidup', u.id, now + 60_000, null, now);
  const removed = cleanup(db, now);
  assert.deepEqual(removed, { sessions: 1, resets: 2 });
  assert.equal((await u('GET', '/api/auth/me')).json.user.username, 'sesi', 'live session kept');
  assert.deepEqual(db.prepare('SELECT token_hash FROM password_resets').all().map((r) => r.token_hash), ['hidup']);
});

test('backup writes a readable copy and keeps only the newest files', () => {
  const dir = path.join(tmp, 'backups');
  const files = [];
  for (let i = 0; i < 4; i++) files.push(backup(srv.db, dir, { keep: 2, now: new Date(Date.UTC(2026, 9, 20, 10, 0, i)) }));
  assert.match(path.basename(files[3]), /^tiktik-20261020-100003\.db$/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['tiktik-20261020-100002.db', 'tiktik-20261020-100003.db']);
  const copy = new DatabaseSync(files[3], { readOnly: true });
  assert.equal(copy.prepare("SELECT username FROM users WHERE username = 'sesi'").get().username, 'sesi');
  copy.close();
});

test('startMaintenance runs cleanup at once and its timers can be stopped', () => {
  const db = srv.db;
  const u = db.prepare("SELECT id FROM users WHERE username = 'sesi'").get();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run('lama2', u.id, Date.now() - 1);
  const errors = [];
  const stop = startMaintenance(db, { backupDir: path.join(tmp, 'auto'), log: { log() {}, error: (...a) => errors.push(a) } });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token = 'lama2'").get().n, 0);
  stop();
  assert.deepEqual(errors, []);
});
