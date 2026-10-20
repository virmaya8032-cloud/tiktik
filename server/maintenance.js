// Background housekeeping for a long-running server: expired-row cleanup and database backups.
import fs from 'node:fs';
import path from 'node:path';

/** Delete expired sessions and spent or expired password-reset links. Returns the number of rows removed. */
export function cleanup(db, now = Date.now()) {
  const sessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes;
  const resets = db.prepare('DELETE FROM password_resets WHERE used_at IS NOT NULL OR expires_at <= ?').run(now).changes;
  return { sessions, resets };
}

/**
 * Write a consistent copy of the live database (VACUUM INTO is safe while the app is running, unlike copying
 * the file) to dir/tiktik-YYYYMMDD-HHMMSS.db, then keep only the newest `keep` backups. Returns the new file path.
 */
export function backup(db, dir, { keep = 7, now = new Date() } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(dir, `tiktik-${stamp}.db`);
  if (fs.existsSync(file)) fs.rmSync(file);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter((f) => /^tiktik-\d{8}-\d{6}\.db$/.test(f)).sort().reverse().slice(Math.max(1, keep));
  for (const f of old) fs.rmSync(path.join(dir, f), { force: true });
  return file;
}

/**
 * Start the timers: cleanup hourly, backups every `backupHours` (0 turns backups off).
 * Timers are unref'd so they never keep the process alive. Returns a stop() function.
 */
export function startMaintenance(db, { backupDir, backupHours = 24, keep = 7, log = console } = {}) {
  const run = (name, fn) => {
    try { fn(); } catch (err) { log.error(`maintenance ${name} failed:`, err.message); }
  };
  run('cleanup', () => cleanup(db));
  const timers = [setInterval(() => run('cleanup', () => cleanup(db)), 60 * 60 * 1000)];
  if (backupHours > 0 && backupDir) {
    const doBackup = () => run('backup', () => log.log(`backup written: ${backup(db, backupDir, { keep })}`));
    timers.push(setTimeout(doBackup, 60 * 1000)); // first backup a minute after start
    timers.push(setInterval(doBackup, backupHours * 60 * 60 * 1000));
  }
  for (const t of timers) t.unref();
  return () => timers.forEach((t) => clearInterval(t));
}
