// Change account passwords before sharing TikTik with other people.
//   npm run set-password -- <username> <new-password>   set one account's password
//   npm run set-password -- --lock-seed                   give every seed account (demo, mira.cooks, ...) a new random password
// Existing sessions for the changed accounts are logged out. No other data is touched.
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_USERS = ['demo', 'mira.cooks', 'pixelpaul', 'wanderlena', 'beatsbyjo', 'codewithkai', 'paws.and.tails', 'fitwithnoor', 'inkandsky'];

const db = openDatabase(path.join(ROOT, 'data', 'clipwave.db'));
const findUser = db.prepare('SELECT id FROM users WHERE username = ?');
const setHash = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const dropSessions = db.prepare('DELETE FROM sessions WHERE user_id = ?');

function setPassword(username, password) {
  const u = findUser.get(username);
  if (!u) return false;
  setHash.run(hashPassword(password), u.id);
  dropSessions.run(u.id);
  return true;
}

const args = process.argv.slice(2);
if (args[0] === '--lock-seed') {
  console.log('New passwords (keep these private):');
  for (const name of SEED_USERS) {
    const pw = crypto.randomBytes(9).toString('base64url');
    if (setPassword(name, pw)) console.log(`  ${name.padEnd(16)} ${pw}`);
  }
} else if (args.length === 2) {
  if (args[1].length < 8) { console.error('Password must be at least 8 characters.'); process.exit(1); }
  if (!setPassword(args[0], args[1])) { console.error(`No account named "${args[0]}".`); process.exit(1); }
  console.log(`Password changed for ${args[0]}.`);
} else {
  console.log('Usage:\n  npm run set-password -- <username> <new-password>\n  npm run set-password -- --lock-seed');
  process.exit(1);
}
