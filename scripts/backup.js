// Make a consistent backup of the database now (safe while the server is running).
//   npm run backup                 writes data/backups/tiktik-YYYYMMDD-HHMMSS.db and keeps the newest 7
// In Docker: docker compose exec app node scripts/backup.js
// The uploaded videos are plain files in data/uploads; copy that folder alongside the backup.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../server/db.js';
import { backup } from '../server/maintenance.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = openDatabase(process.env.DB_FILE || path.join(ROOT, 'data', 'clipwave.db'));
const file = backup(db, process.env.BACKUP_DIR || path.join(ROOT, 'data', 'backups'), { keep: Number(process.env.BACKUP_KEEP) || 7 });
db.close();
console.log(`Backup written: ${file}`);
