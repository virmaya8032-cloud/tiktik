// Give or remove moderator (admin) access. Admins see the moderation panel at /admin.
//   npm run set-admin -- <username>            make the account an admin
//   npm run set-admin -- <username> --remove   make it a normal account again
//   npm run set-admin -- --list                list current admins
// In Docker: docker compose exec app node scripts/set-admin.js <username>
// DB_FILE overrides the database path (default data/clipwave.db).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(process.env.DB_FILE || path.join(ROOT, 'data', 'clipwave.db'));

const args = process.argv.slice(2);
if (args[0] === '--list') {
  const rows = db.prepare("SELECT username FROM users WHERE role = 'admin' ORDER BY username").all();
  console.log(rows.length ? rows.map((r) => `  ${r.username}`).join('\n') : 'No admins yet.');
} else if (args.length >= 1 && !args[0].startsWith('--')) {
  const remove = args.includes('--remove');
  const info = db.prepare('UPDATE users SET role = ? WHERE username = ?').run(remove ? 'user' : 'admin', args[0]);
  if (!info.changes) { console.error(`No account named "${args[0]}".`); process.exit(1); }
  console.log(remove ? `${args[0]} is no longer an admin.` : `${args[0]} is now an admin. Open /admin after logging in.`);
} else {
  console.log('Usage:\n  npm run set-admin -- <username> [--remove]\n  npm run set-admin -- --list');
  process.exit(1);
}
