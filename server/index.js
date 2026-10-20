import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db.js';
import { sessionMiddleware } from './auth.js';
import { createApi } from './api.js';
import { createMailer } from './mailer.js';
import { startMaintenance } from './maintenance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({
  dbFile = path.join(ROOT, 'data', 'clipwave.db'),
  uploadDir = path.join(ROOT, 'data', 'uploads'),
  inviteCode = process.env.INVITE_CODE || '',
  mailer = createMailer(),
  publicUrl = process.env.PUBLIC_URL || '',
} = {}) {
  const db = openDatabase(dbFile);
  const app = express();
  app.disable('x-powered-by');
  // Behind a reverse proxy (e.g. Caddy in Docker) set TRUST_PROXY=uniquelocal so client IPs and https are detected.
  app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
    });
    next();
  });

  // Liveness probe for Docker / uptime monitors: the process is up and the database answers.
  app.get('/healthz', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false });
    }
  });

  app.use(express.json({ limit: '64kb' }));
  app.use(sessionMiddleware(db));
  app.use('/api', createApi({ db, uploadDir, inviteCode, mailer, publicUrl }));
  // Media is served with HTTP Range support (express.static) so the player can seek.
  app.use('/media', express.static(uploadDir, { maxAge: '7d', immutable: true, fallthrough: false }));
  app.use(express.static(path.join(ROOT, 'public'), { index: false, maxAge: 0 }));
  // SPA fallback: client-side router handles every other path.
  app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).send(status === 404 ? 'Not found' : 'Server error');
  });

  return { app, db };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  const { app, db } = createApp();
  // BACKUP_HOURS=0 turns automatic backups off; BACKUP_KEEP is how many daily copies to keep.
  startMaintenance(db, {
    backupDir: process.env.BACKUP_DIR || path.join(ROOT, 'data', 'backups'),
    backupHours: process.env.BACKUP_HOURS !== undefined ? Number(process.env.BACKUP_HOURS) : 24,
    keep: Number(process.env.BACKUP_KEEP) || 7,
  });
  app.listen(port, host, () => console.log(`TikTik running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`));
}
