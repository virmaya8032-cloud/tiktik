import crypto from 'node:crypto';

const SESSION_COOKIE = 'cw_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function createSession(db, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
    path: '/',
    secure: !!res.req?.secure, // set when served over https (e.g. through a tunnel)
  });
}

export function destroySession(db, req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Express middleware: attaches req.user (or null) from the session cookie. */
export function sessionMiddleware(db) {
  const find = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.bio, u.avatar_path, u.verified, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`);
  const drop = db.prepare('DELETE FROM sessions WHERE token = ?');
  return (req, _res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const row = find.get(token);
      if (row && row.expires_at > Date.now()) req.user = row;
      else if (row) drop.run(token);
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Log in to continue.' });
  next();
}
