import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { tx } from './db.js';
import { hashPassword, verifyPassword, createSession, destroySession, requireAuth, requireAdmin } from './auth.js';
import { rankForYou } from './ranking.js';

export const CATEGORIES = ['comedy', 'music', 'dance', 'food', 'sports', 'travel', 'gaming', 'tech', 'art', 'pets', 'other'];
const USERNAME_RE = /^[a-z0-9_.]{3,24}$/i;
const HASHTAG_RE = /#([\p{L}\p{N}_]{1,50})/gu;
const MENTION_RE = /@([a-z0-9_.]{3,24})/gi;
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'violence', 'sexual', 'minor_safety', 'self_harm', 'misinformation', 'intellectual_property', 'other'];

// SQL: true when users a and b have blocked each other in either direction.
const BLOCKED_PAIR = (a, b) => `EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ${a} AND blocked_id = ${b}) OR (blocker_id = ${b} AND blocked_id = ${a}))`;
// SQL: true when the user is not suspended by a moderator.
const ACTIVE_USER = (id) => `(SELECT suspended_at FROM users WHERE id = ${id}) IS NULL`;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const notFound = (what = 'Not found') => new HttpError(404, what);

const toInt = (v, def, min, max) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
};

export function createApi({ db, uploadDir, inviteCode = '' }) {
  const router = express.Router();
  for (const sub of ['videos', 'covers', 'avatars']) fs.mkdirSync(path.join(uploadDir, sub), { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, file, cb) => cb(null, path.join(uploadDir, file.fieldname === 'video' ? 'videos' : file.fieldname === 'cover' ? 'covers' : 'avatars')),
    filename: (_req, file, cb) => {
      const ext = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '';
      cb(null, `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  });
  const upload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024, files: 2 },
    fileFilter: (_req, file, cb) => {
      const ok = file.fieldname === 'video' ? VIDEO_MIME.has(file.mimetype) : IMAGE_MIME.has(file.mimetype);
      cb(ok ? null : bad(`Unsupported ${file.fieldname} type: ${file.mimetype}`), ok);
    },
  });

  // Simple CSRF defence: every state-changing API call must carry a custom header,
  // which cross-site forms cannot set without a CORS preflight.
  router.use((req, _res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('X-Requested-With') !== 'clipwave') {
      return next(new HttpError(403, 'Missing X-Requested-With header.'));
    }
    next();
  });

  // Fixed-window rate limit for credential endpoints.
  const attempts = new Map();
  const authLimit = (req, _res, next) => {
    const key = req.ip;
    const now = Date.now();
    const rec = attempts.get(key);
    if (!rec || now - rec.start > 60_000) attempts.set(key, { start: now, n: 1 });
    else if (++rec.n > 30) return next(new HttpError(429, 'Too many attempts. Try again in a minute.'));
    next();
  };

  const viewerId = (req) => req.user?.id ?? 0;
  const mediaUrl = (p) => (p ? `/media/${p.replace(/\\/g, '/')}` : null);

  // ---------- serializers ----------
  const VISIBLE = `((v.privacy = 'public' OR v.user_id = :viewer OR (v.privacy = 'followers' AND EXISTS (
      SELECT 1 FROM follows f WHERE f.follower_id = :viewer AND f.followee_id = v.user_id)))
    AND NOT ${BLOCKED_PAIR(':viewer', 'v.user_id')}
    AND (v.hidden_at IS NULL OR v.user_id = :viewer) AND ${ACTIVE_USER('v.user_id')})`;
  const VIDEO_COLS = `
    v.*, u.username, u.display_name, u.avatar_path, u.verified,
    (SELECT COUNT(*) FROM likes WHERE video_id = v.id) AS like_count,
    (SELECT COUNT(*) FROM comments WHERE video_id = v.id) AS comment_count,
    (SELECT COUNT(*) FROM favorites WHERE video_id = v.id) AS favorite_count,
    (SELECT COUNT(*) FROM shares WHERE video_id = v.id) AS share_count,
    EXISTS (SELECT 1 FROM likes WHERE video_id = v.id AND user_id = :viewer) AS liked,
    EXISTS (SELECT 1 FROM favorites WHERE video_id = v.id AND user_id = :viewer) AS favorited,
    EXISTS (SELECT 1 FROM follows WHERE followee_id = v.user_id AND follower_id = :viewer) AS following_author`;

  function serializeVideo(r) {
    return {
      id: r.id,
      caption: r.caption,
      category: r.category,
      sound: r.sound_title || `original sound - ${r.display_name}`,
      videoUrl: mediaUrl(r.video_path),
      coverUrl: mediaUrl(r.cover_path),
      mimeType: r.mime_type,
      duration: r.duration,
      width: r.width,
      height: r.height,
      privacy: r.privacy,
      allowComments: !!r.allow_comments,
      createdAt: r.created_at,
      author: {
        id: r.user_id,
        username: r.username,
        displayName: r.display_name,
        avatarUrl: mediaUrl(r.avatar_path),
        verified: !!r.verified,
      },
      stats: {
        views: r.views,
        likes: r.like_count,
        comments: r.comment_count,
        favorites: r.favorite_count,
        shares: r.share_count,
      },
      viewer: {
        liked: !!r.liked,
        favorited: !!r.favorited,
        followingAuthor: !!r.following_author,
        isAuthor: r.viewer_id === r.user_id,
        hiddenByModerator: r.viewer_id === r.user_id && !!r.hidden_at,
      },
    };
  }

  function queryVideos(where, params, tail = '') {
    const sql = `SELECT ${VIDEO_COLS}, :viewer AS viewer_id FROM videos v JOIN users u ON u.id = v.user_id
                 WHERE ${VISIBLE} ${where ? `AND (${where})` : ''} ${tail}`;
    return db.prepare(sql).all(params).map(serializeVideo);
  }

  function getVideo(id, viewer) {
    return queryVideos('v.id = :id', { viewer, id })[0] || null;
  }

  function serializeUser(r) {
    return {
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      bio: r.bio,
      avatarUrl: mediaUrl(r.avatar_path),
      verified: !!r.verified,
    };
  }

  function userStats(userId, viewer) {
    return db.prepare(`SELECT
      (SELECT COUNT(*) FROM follows WHERE followee_id = :u) AS followers,
      (SELECT COUNT(*) FROM follows WHERE follower_id = :u) AS following,
      (SELECT COUNT(*) FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.user_id = :u) AS likes,
      (SELECT COUNT(*) FROM videos v WHERE v.user_id = :u AND ${VISIBLE}) AS videos,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = :viewer AND followee_id = :u) AS is_following,
      EXISTS (SELECT 1 FROM follows WHERE follower_id = :u AND followee_id = :viewer) AS follows_you`).get({ u: userId, viewer });
  }

  const findUser = db.prepare('SELECT * FROM users WHERE username = ?');
  function mustUser(username) {
    const u = findUser.get(String(username || ''));
    if (!u) throw notFound('User not found');
    return u;
  }
  function mustVisibleVideo(id, viewer) {
    const v = getVideo(toInt(id, 0, 0, Number.MAX_SAFE_INTEGER), viewer);
    if (!v) throw notFound('Video not found');
    return v;
  }

  const blockedPair = db.prepare(`SELECT ${BLOCKED_PAIR(':a', ':b')} AS blocked`);
  const isBlocked = (a, b) => !!blockedPair.get({ a, b }).blocked;

  const insertNotif = db.prepare(`INSERT INTO notifications (user_id, actor_id, type, video_id, comment_id, created_at)
                                  VALUES (?, ?, ?, ?, ?, ?)`);
  function notify(userId, actorId, type, videoId = null, commentId = null) {
    if (userId === actorId || isBlocked(userId, actorId)) return;
    insertNotif.run(userId, actorId, type, videoId, commentId, Date.now());
  }
  function notifyMentions(text, actorId, videoId, commentId) {
    const seen = new Set();
    for (const [, name] of String(text).matchAll(MENTION_RE)) {
      const u = findUser.get(name);
      if (u && !seen.has(u.id)) { seen.add(u.id); notify(u.id, actorId, 'mention', videoId, commentId); }
    }
  }

  // ---------- auth ----------
  // Private-group mode: when INVITE_CODE is set, sign-up requires it.
  router.get('/auth/config', (_req, res) => res.json({ inviteRequired: !!inviteCode }));

  router.post('/auth/register', authLimit, (req, res) => {
    if (inviteCode) {
      const given = Buffer.from(String(req.body?.inviteCode || '').trim());
      const want = Buffer.from(inviteCode);
      if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(403, 'That invite code is not valid.');
    }
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const displayName = String(req.body?.displayName || username).trim().slice(0, 40);
    if (!USERNAME_RE.test(username)) throw bad('Username must be 3-24 characters: letters, numbers, _ or .');
    if (password.length < 8) throw bad('Password must be at least 8 characters.');
    if (findUser.get(username)) throw new HttpError(409, 'That username is taken.');
    const info = db.prepare(`INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)`)
      .run(username, displayName || username, hashPassword(password), Date.now());
    createSession(db, res, Number(info.lastInsertRowid));
    res.status(201).json({ user: serializeUser(findUser.get(username)) });
  });

  router.post('/auth/login', authLimit, (req, res) => {
    const u = findUser.get(String(req.body?.username || '').trim());
    if (!u || !verifyPassword(String(req.body?.password || ''), u.password_hash)) {
      throw new HttpError(401, 'Incorrect username or password.');
    }
    if (u.suspended_at) throw new HttpError(403, 'This account has been suspended for breaking the community guidelines.');
    createSession(db, res, u.id);
    res.json({ user: serializeUser(u) });
  });

  router.post('/auth/logout', (req, res) => {
    destroySession(db, req, res);
    res.json({ ok: true });
  });

  router.get('/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null });
    const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(req.user.id).n;
    res.json({ user: { ...serializeUser(req.user), isAdmin: req.user.role === 'admin' }, unreadNotifications: unread });
  });

  router.get('/categories', (_req, res) => res.json({ categories: CATEGORIES }));

  // ---------- feeds ----------
  function parseExclude(raw) {
    return String(raw || '').split(',').map((s) => Number.parseInt(s, 10)).filter(Number.isFinite).slice(0, 500);
  }

  router.get('/feed/foryou', (req, res) => {
    const viewer = viewerId(req);
    const count = toInt(req.query.count, 6, 1, 20);
    const exclude = new Set(parseExclude(req.query.exclude));
    const candidates = queryVideos('', { viewer }).filter((v) => !exclude.has(v.id));
    const items = rankForYou(db, candidates, viewer, count);
    res.json({ items, hasMore: candidates.length > items.length });
  });

  router.get('/feed/following', requireAuth, (req, res) => {
    const viewer = viewerId(req);
    const count = toInt(req.query.count, 6, 1, 20);
    const offset = toInt(req.query.cursor, 0, 0, 1e6);
    const items = queryVideos('v.user_id IN (SELECT followee_id FROM follows WHERE follower_id = :viewer)',
      { viewer, count: count + 1, offset }, 'ORDER BY v.created_at DESC LIMIT :count OFFSET :offset');
    res.json({ items: items.slice(0, count), hasMore: items.length > count, cursor: offset + count });
  });

  router.get('/explore', (req, res) => {
    const viewer = viewerId(req);
    const category = String(req.query.category || 'all');
    const count = toInt(req.query.count, 24, 1, 60);
    const offset = toInt(req.query.cursor, 0, 0, 1e6);
    const where = category === 'all' ? `v.privacy = 'public'` : `v.privacy = 'public' AND v.category = :category`;
    const params = { viewer, count: count + 1, offset, ...(category === 'all' ? {} : { category }) };
    const items = queryVideos(where, params,
      `ORDER BY (like_count * 2 + comment_count * 3 + share_count * 4 + v.views * 0.1) DESC, v.created_at DESC LIMIT :count OFFSET :offset`);
    res.json({ items: items.slice(0, count), hasMore: items.length > count, cursor: offset + count });
  });

  // ---------- videos ----------
  router.post('/videos', requireAuth, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), (req, res) => {
    const videoFile = req.files?.video?.[0];
    const coverFile = req.files?.cover?.[0];
    const cleanup = () => { for (const f of [videoFile, coverFile]) if (f) fs.rm(f.path, { force: true }, () => {}); };
    try {
      if (!videoFile) throw bad('A video file is required.');
      const caption = String(req.body.caption || '').slice(0, 2200);
      const category = CATEGORIES.includes(req.body.category) ? req.body.category : 'other';
      const privacy = ['public', 'followers', 'private'].includes(req.body.privacy) ? req.body.privacy : 'public';
      const allowComments = req.body.allowComments === 'false' ? 0 : 1;
      const duration = Math.max(0, Math.min(3600, Number(req.body.duration) || 0));
      const width = toInt(req.body.width, 0, 0, 8192);
      const height = toInt(req.body.height, 0, 0, 8192);
      const sound = String(req.body.sound || '').trim().slice(0, 100);
      const rel = (f) => path.relative(uploadDir, f.path).replace(/\\/g, '/');

      const id = tx(db, () => {
        const info = db.prepare(`INSERT INTO videos (user_id, caption, category, sound_title, video_path, cover_path, mime_type,
                                   duration, width, height, privacy, allow_comments, created_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(req.user.id, caption, category, sound, rel(videoFile), coverFile ? rel(coverFile) : null, videoFile.mimetype,
            duration, width, height, privacy, allowComments, Date.now());
        const vid = Number(info.lastInsertRowid);
        attachHashtags(vid, caption);
        notifyMentions(caption, req.user.id, vid, null);
        return vid;
      });
      res.status(201).json({ video: getVideo(id, req.user.id) });
    } catch (err) {
      cleanup();
      throw err;
    }
  });

  function attachHashtags(videoId, caption) {
    const names = new Set([...String(caption).matchAll(HASHTAG_RE)].map((m) => m[1].toLowerCase()));
    for (const name of names) {
      db.prepare('INSERT OR IGNORE INTO hashtags (name) VALUES (?)').run(name);
      const tag = db.prepare('SELECT id FROM hashtags WHERE name = ?').get(name);
      db.prepare('INSERT OR IGNORE INTO video_hashtags (video_id, hashtag_id) VALUES (?, ?)').run(videoId, tag.id);
    }
  }

  router.get('/videos/:id', (req, res) => {
    res.json({ video: mustVisibleVideo(req.params.id, viewerId(req)) });
  });

  router.patch('/videos/:id', requireAuth, (req, res) => {
    const v = mustVisibleVideo(req.params.id, req.user.id);
    if (!v.viewer.isAuthor) throw new HttpError(403, 'You can only edit your own videos.');
    const privacy = ['public', 'followers', 'private'].includes(req.body?.privacy) ? req.body.privacy : v.privacy;
    const allowComments = typeof req.body?.allowComments === 'boolean' ? Number(req.body.allowComments) : Number(v.allowComments);
    db.prepare('UPDATE videos SET privacy = ?, allow_comments = ? WHERE id = ?').run(privacy, allowComments, v.id);
    res.json({ video: getVideo(v.id, req.user.id) });
  });

  router.delete('/videos/:id', requireAuth, (req, res) => {
    const row = db.prepare('SELECT * FROM videos WHERE id = ?').get(toInt(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER));
    if (!row) throw notFound('Video not found');
    if (row.user_id !== req.user.id) throw new HttpError(403, 'You can only delete your own videos.');
    removeVideo(row);
    res.json({ ok: true });
  });

  /** Delete a video row and its media files. */
  function removeVideo(row) {
    db.prepare('DELETE FROM videos WHERE id = ?').run(row.id);
    for (const p of [row.video_path, row.cover_path]) if (p) fs.rm(path.join(uploadDir, p), { force: true }, () => {});
  }

  router.get('/videos/:id/related', (req, res) => {
    const viewer = viewerId(req);
    const v = mustVisibleVideo(req.params.id, viewer);
    const items = queryVideos(`v.id <> :id AND v.privacy = 'public' AND (v.category = :category OR v.user_id = :author OR v.id IN (
        SELECT vh.video_id FROM video_hashtags vh WHERE vh.hashtag_id IN (SELECT hashtag_id FROM video_hashtags WHERE video_id = :id)))`,
    { viewer, id: v.id, category: v.category, author: v.author.id }, 'ORDER BY like_count DESC, v.created_at DESC LIMIT 12');
    res.json({ items });
  });

  function toggle(table, notifType) {
    return [
      (req, res) => {
        const v = mustVisibleVideo(req.params.id, req.user.id);
        const info = db.prepare(`INSERT OR IGNORE INTO ${table} (user_id, video_id, created_at) VALUES (?, ?, ?)`).run(req.user.id, v.id, Date.now());
        if (info.changes && notifType) notify(v.author.id, req.user.id, notifType, v.id);
        res.json({ video: getVideo(v.id, req.user.id) });
      },
      (req, res) => {
        const v = mustVisibleVideo(req.params.id, req.user.id);
        db.prepare(`DELETE FROM ${table} WHERE user_id = ? AND video_id = ?`).run(req.user.id, v.id);
        res.json({ video: getVideo(v.id, req.user.id) });
      },
    ];
  }
  const [like, unlike] = toggle('likes', 'like');
  const [fav, unfav] = toggle('favorites', null);
  router.post('/videos/:id/like', requireAuth, like);
  router.delete('/videos/:id/like', requireAuth, unlike);
  router.post('/videos/:id/favorite', requireAuth, fav);
  router.delete('/videos/:id/favorite', requireAuth, unfav);

  router.post('/videos/:id/share', (req, res) => {
    const v = mustVisibleVideo(req.params.id, viewerId(req));
    const channel = ['copy_link', 'native', 'embed', 'email', 'other'].includes(req.body?.channel) ? req.body.channel : 'other';
    db.prepare('INSERT INTO shares (video_id, user_id, channel, created_at) VALUES (?, ?, ?, ?)').run(v.id, req.user?.id ?? null, channel, Date.now());
    res.json({ video: getVideo(v.id, viewerId(req)) });
  });

  router.post('/videos/:id/view', (req, res) => {
    const v = mustVisibleVideo(req.params.id, viewerId(req));
    const watchedMs = toInt(req.body?.watchedMs, 0, 0, 3_600_000);
    const completed = req.body?.completed ? 1 : 0;
    tx(db, () => {
      db.prepare('UPDATE videos SET views = views + 1, watch_ms = watch_ms + ? WHERE id = ?').run(watchedMs, v.id);
      db.prepare('INSERT INTO watch_events (video_id, user_id, watched_ms, completed, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(v.id, req.user?.id ?? null, watchedMs, completed, Date.now());
    });
    res.json({ ok: true });
  });

  // ---------- comments ----------
  function serializeComment(r) {
    return {
      id: r.id,
      videoId: r.video_id,
      parentId: r.parent_id,
      body: r.body,
      createdAt: r.created_at,
      likes: r.like_count,
      liked: !!r.liked,
      replyCount: r.reply_count,
      isMine: r.user_id === r.viewer_id,
      author: { id: r.user_id, username: r.username, displayName: r.display_name, avatarUrl: mediaUrl(r.avatar_path), verified: !!r.verified },
    };
  }
  const COMMENT_SQL = `SELECT c.*, u.username, u.display_name, u.avatar_path, u.verified, :viewer AS viewer_id,
      (SELECT COUNT(*) FROM comment_likes WHERE comment_id = c.id) AS like_count,
      (SELECT COUNT(*) FROM comments r WHERE r.parent_id = c.id AND r.hidden_at IS NULL AND ${ACTIVE_USER('r.user_id')}
        AND NOT ${BLOCKED_PAIR(':viewer', 'r.user_id')}) AS reply_count,
      EXISTS (SELECT 1 FROM comment_likes WHERE comment_id = c.id AND user_id = :viewer) AS liked
    FROM comments c JOIN users u ON u.id = c.user_id`;

  router.get('/videos/:id/comments', (req, res) => {
    const viewer = viewerId(req);
    const v = mustVisibleVideo(req.params.id, viewer);
    const parent = req.query.parent ? toInt(req.query.parent, 0, 0, Number.MAX_SAFE_INTEGER) : null;
    const shown = `c.hidden_at IS NULL AND u.suspended_at IS NULL AND NOT ${BLOCKED_PAIR(':viewer', 'c.user_id')}`;
    const rows = parent
      ? db.prepare(`${COMMENT_SQL} WHERE c.video_id = :vid AND c.parent_id = :parent AND ${shown} ORDER BY c.created_at ASC`).all({ viewer, vid: v.id, parent })
      : db.prepare(`${COMMENT_SQL} WHERE c.video_id = :vid AND c.parent_id IS NULL AND ${shown} ORDER BY like_count DESC, c.created_at DESC LIMIT 200`).all({ viewer, vid: v.id });
    res.json({ items: rows.map(serializeComment), allowComments: v.allowComments });
  });

  router.post('/videos/:id/comments', requireAuth, (req, res) => {
    const v = mustVisibleVideo(req.params.id, req.user.id);
    if (!v.allowComments && !v.viewer.isAuthor) throw new HttpError(403, 'Comments are turned off for this video.');
    const body = String(req.body?.body || '').trim();
    if (!body) throw bad('Comment cannot be empty.');
    if (body.length > 500) throw bad('Comments are limited to 500 characters.');
    let parentId = req.body?.parentId ? toInt(req.body.parentId, 0, 0, Number.MAX_SAFE_INTEGER) : null;
    let parent = null;
    if (parentId) {
      parent = db.prepare('SELECT * FROM comments WHERE id = ? AND video_id = ? AND hidden_at IS NULL').get(parentId, v.id);
      if (!parent) throw bad('Reply target not found.');
      if (isBlocked(req.user.id, parent.user_id)) throw new HttpError(403, "You can't reply to this comment.");
      if (parent.parent_id) parentId = parent.parent_id; // keep threads one level deep
    }
    const id = tx(db, () => {
      const info = db.prepare('INSERT INTO comments (video_id, user_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(v.id, req.user.id, parentId, body, Date.now());
      const cid = Number(info.lastInsertRowid);
      notify(v.author.id, req.user.id, 'comment', v.id, cid);
      if (parent) notify(parent.user_id, req.user.id, 'reply', v.id, cid);
      notifyMentions(body, req.user.id, v.id, cid);
      return cid;
    });
    const row = db.prepare(`${COMMENT_SQL} WHERE c.id = :id`).get({ viewer: req.user.id, id });
    res.status(201).json({ comment: serializeComment(row) });
  });

  router.delete('/comments/:id', requireAuth, (req, res) => {
    const c = db.prepare('SELECT c.*, v.user_id AS video_owner FROM comments c JOIN videos v ON v.id = c.video_id WHERE c.id = ?')
      .get(toInt(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER));
    if (!c) throw notFound('Comment not found');
    if (c.user_id !== req.user.id && c.video_owner !== req.user.id) throw new HttpError(403, 'Not allowed.');
    db.prepare('DELETE FROM comments WHERE id = ?').run(c.id);
    res.json({ ok: true });
  });

  router.post('/comments/:id/like', requireAuth, (req, res) => {
    const id = toInt(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER);
    if (!db.prepare('SELECT 1 FROM comments WHERE id = ?').get(id)) throw notFound('Comment not found');
    db.prepare('INSERT OR IGNORE INTO comment_likes (user_id, comment_id) VALUES (?, ?)').run(req.user.id, id);
    res.json({ comment: serializeComment(db.prepare(`${COMMENT_SQL} WHERE c.id = :id`).get({ viewer: req.user.id, id })) });
  });
  router.delete('/comments/:id/like', requireAuth, (req, res) => {
    const id = toInt(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER);
    db.prepare('DELETE FROM comment_likes WHERE user_id = ? AND comment_id = ?').run(req.user.id, id);
    const row = db.prepare(`${COMMENT_SQL} WHERE c.id = :id`).get({ viewer: req.user.id, id });
    if (!row) throw notFound('Comment not found');
    res.json({ comment: serializeComment(row) });
  });

  // ---------- users ----------
  router.get('/users/:username', (req, res) => {
    const viewer = viewerId(req);
    const u = mustUser(req.params.username);
    if (u.suspended_at && req.user?.role !== 'admin') throw notFound('User not found');
    const s = userStats(u.id, viewer);
    res.json({
      user: serializeUser(u),
      stats: { followers: s.followers, following: s.following, likes: s.likes, videos: s.videos },
      viewer: {
        isMe: u.id === viewer, isFollowing: !!s.is_following, followsYou: !!s.follows_you,
        isBlocked: !!db.prepare('SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?').get(viewer, u.id),
      },
    });
  });

  router.get('/users/:username/videos', (req, res) => {
    const viewer = viewerId(req);
    const u = mustUser(req.params.username);
    const tab = String(req.query.tab || 'videos');
    let items;
    if (tab === 'videos') {
      items = queryVideos('v.user_id = :u', { viewer, u: u.id }, 'ORDER BY v.created_at DESC');
    } else if (tab === 'liked' || tab === 'favorites') {
      if (u.id !== viewer) throw new HttpError(403, `This user's ${tab} videos are private.`);
      const table = tab === 'liked' ? 'likes' : 'favorites';
      items = queryVideos(`v.id IN (SELECT video_id FROM ${table} WHERE user_id = :u)`, { viewer, u: u.id }, 'ORDER BY v.created_at DESC');
    } else {
      throw bad('Unknown tab.');
    }
    res.json({ items });
  });

  function followList(direction) {
    return (req, res) => {
      const viewer = viewerId(req);
      const u = mustUser(req.params.username);
      const sql = direction === 'followers'
        ? 'SELECT u.* FROM follows f JOIN users u ON u.id = f.follower_id WHERE f.followee_id = ? ORDER BY f.created_at DESC LIMIT 200'
        : 'SELECT u.* FROM follows f JOIN users u ON u.id = f.followee_id WHERE f.follower_id = ? ORDER BY f.created_at DESC LIMIT 200';
      const isFollowing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?');
      res.json({
        items: db.prepare(sql).all(u.id).map((r) => ({ ...serializeUser(r), isFollowing: !!isFollowing.get(viewer, r.id), isMe: r.id === viewer })),
      });
    };
  }
  router.get('/users/:username/followers', followList('followers'));
  router.get('/users/:username/following', followList('following'));

  router.post('/users/:username/follow', requireAuth, (req, res) => {
    const u = mustUser(req.params.username);
    if (u.id === req.user.id) throw bad("You can't follow yourself.");
    if (isBlocked(req.user.id, u.id)) throw new HttpError(403, "You can't follow this account.");
    const info = db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(req.user.id, u.id, Date.now());
    if (info.changes) notify(u.id, req.user.id, 'follow');
    res.json({ following: true, followers: userStats(u.id, req.user.id).followers });
  });
  router.delete('/users/:username/follow', requireAuth, (req, res) => {
    const u = mustUser(req.params.username);
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?').run(req.user.id, u.id);
    res.json({ following: false, followers: userStats(u.id, req.user.id).followers });
  });

  router.get('/users', (req, res) => {
    // Suggested accounts: most-followed users the viewer does not follow yet.
    const viewer = viewerId(req);
    const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS followers FROM users u
      WHERE u.id <> :viewer AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = :viewer)
        AND NOT ${BLOCKED_PAIR(':viewer', 'u.id')} AND u.suspended_at IS NULL
      ORDER BY followers DESC, u.created_at ASC LIMIT 8`).all({ viewer });
    res.json({ items: rows.map((r) => ({ ...serializeUser(r), followers: r.followers })) });
  });

  // ---------- blocking ----------
  router.post('/users/:username/block', requireAuth, (req, res) => {
    const u = mustUser(req.params.username);
    if (u.id === req.user.id) throw bad("You can't block yourself.");
    tx(db, () => {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(req.user.id, u.id, Date.now());
      // A block also ends any follow relationship in both directions.
      db.prepare('DELETE FROM follows WHERE (follower_id = :a AND followee_id = :b) OR (follower_id = :b AND followee_id = :a)').run({ a: req.user.id, b: u.id });
    });
    res.json({ blocked: true });
  });
  router.delete('/users/:username/block', requireAuth, (req, res) => {
    const u = mustUser(req.params.username);
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(req.user.id, u.id);
    res.json({ blocked: false });
  });
  router.get('/me/blocks', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id
      WHERE b.blocker_id = ? ORDER BY b.created_at DESC`).all(req.user.id);
    res.json({ items: rows.map(serializeUser) });
  });

  // ---------- reports ----------
  router.get('/reports/reasons', (_req, res) => res.json({ reasons: REPORT_REASONS }));

  router.post('/reports', requireAuth, (req, res) => {
    const type = String(req.body?.targetType || '');
    const targetId = toInt(req.body?.targetId, 0, 0, Number.MAX_SAFE_INTEGER);
    const reason = String(req.body?.reason || '');
    const details = String(req.body?.details || '').trim().slice(0, 500);
    if (!REPORT_REASONS.includes(reason)) throw bad('Choose a reason for this report.');
    let ownerId;
    let snapshot;
    if (type === 'video') {
      const v = mustVisibleVideo(targetId, req.user.id);
      ownerId = v.author.id;
      snapshot = v.caption;
    } else if (type === 'comment') {
      const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(targetId);
      if (!c) throw notFound('Comment not found');
      mustVisibleVideo(c.video_id, req.user.id);
      ownerId = c.user_id;
      snapshot = c.body;
    } else if (type === 'user') {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
      if (!u) throw notFound('User not found');
      ownerId = u.id;
      snapshot = `@${u.username} - ${u.display_name}${u.bio ? ` - ${u.bio}` : ''}`;
    } else {
      throw bad('Unknown report type.');
    }
    if (ownerId === req.user.id) throw bad("You can't report your own content.");
    const info = db.prepare(`INSERT OR IGNORE INTO reports (reporter_id, target_type, target_id, target_user_id, reason, details, snapshot, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(req.user.id, type, targetId, ownerId, reason, details, snapshot.slice(0, 500), Date.now());
    res.status(info.changes ? 201 : 200).json({ ok: true, duplicate: !info.changes });
  });

  router.patch('/me', requireAuth, upload.single('avatar'), (req, res) => {
    const displayName = req.body.displayName !== undefined ? String(req.body.displayName).trim().slice(0, 40) : req.user.display_name;
    const bio = req.body.bio !== undefined ? String(req.body.bio).slice(0, 160) : req.user.bio;
    if (!displayName) throw bad('Name cannot be empty.');
    let avatar = req.user.avatar_path;
    if (req.file) {
      if (avatar) fs.rm(path.join(uploadDir, avatar), { force: true }, () => {});
      avatar = path.relative(uploadDir, req.file.path).replace(/\\/g, '/');
    }
    db.prepare('UPDATE users SET display_name = ?, bio = ?, avatar_path = ? WHERE id = ?').run(displayName, bio, avatar, req.user.id);
    res.json({ user: serializeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
  });

  // ---------- search ----------
  const likeEscape = (s) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  function searchUsers(q, viewer, limit) {
    return db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM follows WHERE followee_id = u.id) AS followers,
        EXISTS (SELECT 1 FROM follows WHERE follower_id = :viewer AND followee_id = u.id) AS is_following
      FROM users u WHERE (u.username LIKE :q ESCAPE '\\' OR u.display_name LIKE :q ESCAPE '\\') AND NOT ${BLOCKED_PAIR(':viewer', 'u.id')}
        AND u.suspended_at IS NULL
      ORDER BY (u.username = :exact) DESC, followers DESC LIMIT :limit`)
      .all({ q: likeEscape(q), exact: q, viewer, limit })
      .map((r) => ({ ...serializeUser(r), followers: r.followers, isFollowing: !!r.is_following, isMe: r.id === viewer }));
  }
  function searchVideos(q, viewer, limit) {
    const tag = q.replace(/^#/, '');
    return queryVideos(`v.privacy = 'public' AND (v.caption LIKE :q ESCAPE '\\' OR u.username LIKE :q ESCAPE '\\' OR v.sound_title LIKE :q ESCAPE '\\'
        OR v.id IN (SELECT vh.video_id FROM video_hashtags vh JOIN hashtags h ON h.id = vh.hashtag_id WHERE h.name LIKE :tag ESCAPE '\\'))`,
    { viewer, q: likeEscape(q), tag: likeEscape(tag), limit }, 'ORDER BY like_count DESC, v.views DESC LIMIT :limit');
  }
  function searchHashtags(q, limit) {
    return db.prepare(`SELECT h.name, COUNT(vh.video_id) AS videos FROM hashtags h LEFT JOIN video_hashtags vh ON vh.hashtag_id = h.id
      WHERE h.name LIKE :q ESCAPE '\\' GROUP BY h.id ORDER BY videos DESC LIMIT :limit`).all({ q: likeEscape(q.replace(/^#/, '')), limit });
  }

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const type = String(req.query.type || 'top');
    const viewer = viewerId(req);
    if (!q) return res.json({ users: [], videos: [], hashtags: [] });
    if (type === 'users') return res.json({ users: searchUsers(q, viewer, 50) });
    if (type === 'videos') return res.json({ videos: searchVideos(q, viewer, 60) });
    if (type === 'hashtags') return res.json({ hashtags: searchHashtags(q, 50) });
    res.json({ users: searchUsers(q, viewer, 4), videos: searchVideos(q, viewer, 24), hashtags: searchHashtags(q, 6) });
  });

  router.get('/search/suggest', (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 50);
    if (!q) {
      const trending = db.prepare(`SELECT h.name FROM hashtags h JOIN video_hashtags vh ON vh.hashtag_id = h.id
        GROUP BY h.id ORDER BY COUNT(*) DESC LIMIT 8`).all();
      return res.json({ items: trending.map((t) => ({ kind: 'hashtag', text: `#${t.name}` })) });
    }
    const tags = searchHashtags(q, 5).map((t) => ({ kind: 'hashtag', text: `#${t.name}` }));
    const users = searchUsers(q, viewerId(req), 5).map((u) => ({ kind: 'user', text: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl }));
    res.json({ items: [...users, ...tags].slice(0, 8) });
  });

  router.get('/hashtags/:name', (req, res) => {
    const viewer = viewerId(req);
    const name = String(req.params.name).toLowerCase();
    const tag = db.prepare('SELECT * FROM hashtags WHERE name = ?').get(name);
    if (!tag) throw notFound('Hashtag not found');
    const items = queryVideos(`v.privacy = 'public' AND v.id IN (SELECT video_id FROM video_hashtags WHERE hashtag_id = :tag)`,
      { viewer, tag: tag.id }, 'ORDER BY like_count DESC, v.created_at DESC');
    const views = items.reduce((n, v) => n + v.stats.views, 0);
    res.json({ hashtag: { name: tag.name, videos: items.length, views }, items });
  });

  // ---------- notifications ----------
  router.get('/notifications', requireAuth, (req, res) => {
    const rows = db.prepare(`SELECT n.*, a.username, a.display_name, a.avatar_path, a.verified, v.cover_path, c.body AS comment_body
      FROM notifications n JOIN users a ON a.id = n.actor_id
      LEFT JOIN videos v ON v.id = n.video_id LEFT JOIN comments c ON c.id = n.comment_id
      WHERE n.user_id = :me AND NOT ${BLOCKED_PAIR(':me', 'n.actor_id')} AND a.suspended_at IS NULL ORDER BY n.created_at DESC LIMIT 100`).all({ me: req.user.id });
    res.json({
      items: rows.map((r) => ({
        id: r.id, type: r.type, read: !!r.is_read, createdAt: r.created_at, videoId: r.video_id,
        coverUrl: mediaUrl(r.cover_path), commentBody: r.comment_body,
        actor: { username: r.username, displayName: r.display_name, avatarUrl: mediaUrl(r.avatar_path), verified: !!r.verified },
      })),
    });
  });
  router.post('/notifications/read', requireAuth, (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
    res.json({ ok: true });
  });

  // ---------- creator studio ----------
  router.get('/studio', requireAuth, (req, res) => {
    const viewer = req.user.id;
    const items = queryVideos('v.user_id = :viewer', { viewer }, 'ORDER BY v.created_at DESC').map((v) => {
      const w = db.prepare('SELECT COUNT(*) AS n, COALESCE(AVG(watched_ms), 0) AS avg, COALESCE(SUM(completed), 0) AS done FROM watch_events WHERE video_id = ?').get(v.id);
      return { ...v, analytics: { avgWatchMs: Math.round(w.avg), completionRate: w.n ? w.done / w.n : 0 } };
    });
    const s = userStats(viewer, viewer);
    const totals = items.reduce((t, v) => ({
      views: t.views + v.stats.views, likes: t.likes + v.stats.likes, comments: t.comments + v.stats.comments, shares: t.shares + v.stats.shares,
    }), { views: 0, likes: 0, comments: 0, shares: 0 });
    res.json({ items, totals: { ...totals, followers: s.followers, videos: items.length } });
  });

  // ---------- admin moderation ----------
  // Every moderator action is written to moderation_log and closes the open reports on that target.
  function moderate(req, action, type, id, note = '', reportStatus = 'actioned') {
    const now = Date.now();
    db.prepare('INSERT INTO moderation_log (admin_id, action, target_type, target_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user.id, action, type, id, String(note || '').slice(0, 500), now);
    if (reportStatus) {
      db.prepare(`UPDATE reports SET status = ?, resolved_at = ?, resolved_by = ? WHERE target_type = ? AND target_id = ? AND status = 'open'`)
        .run(reportStatus, now, req.user.id, type, id);
    }
  }
  const adminId = (req) => toInt(req.params.id, 0, 0, Number.MAX_SAFE_INTEGER);
  function mustRow(table, id) {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw notFound('Not found');
    return row;
  }

  router.get('/admin/summary', requireAdmin, (_req, res) => {
    res.json(db.prepare(`SELECT
      (SELECT COUNT(*) FROM reports WHERE status = 'open') AS openReports,
      (SELECT COUNT(*) FROM users WHERE suspended_at IS NOT NULL) AS suspendedUsers,
      (SELECT COUNT(*) FROM videos WHERE hidden_at IS NOT NULL) AS hiddenVideos,
      (SELECT COUNT(*) FROM comments WHERE hidden_at IS NOT NULL) AS hiddenComments`).get());
  });

  function reportTarget(r) {
    if (r.target_type === 'video') {
      const v = db.prepare('SELECT v.*, u.username FROM videos v JOIN users u ON u.id = v.user_id WHERE v.id = ?').get(r.target_id);
      return v ? { exists: true, hidden: !!v.hidden_at, url: `/@${v.username}/video/${v.id}`, videoUrl: mediaUrl(v.video_path), coverUrl: mediaUrl(v.cover_path) } : { exists: false };
    }
    if (r.target_type === 'comment') {
      const c = db.prepare('SELECT c.*, u.username FROM comments c JOIN videos v ON v.id = c.video_id JOIN users u ON u.id = v.user_id WHERE c.id = ?').get(r.target_id);
      return c ? { exists: true, hidden: !!c.hidden_at, url: `/@${c.username}/video/${c.video_id}`, body: c.body } : { exists: false };
    }
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.target_id);
    return u ? { exists: true, suspended: !!u.suspended_at, url: `/@${u.username}` } : { exists: false };
  }

  router.get('/admin/reports', requireAdmin, (req, res) => {
    const status = ['open', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const rows = db.prepare(`SELECT r.*, rep.username AS reporter_username, o.username AS owner_username, o.suspended_at AS owner_suspended, o.role AS owner_role,
        (SELECT COUNT(*) FROM reports x WHERE x.target_type = r.target_type AND x.target_id = r.target_id AND x.status = 'open') AS open_on_target
      FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users o ON o.id = r.target_user_id
      WHERE r.status = ? ORDER BY ${status === 'open' ? 'open_on_target DESC, r.created_at ASC' : 'r.resolved_at DESC'} LIMIT 200`).all(status);
    res.json({
      items: rows.map((r) => ({
        id: r.id, targetType: r.target_type, targetId: r.target_id, reason: r.reason, details: r.details, snapshot: r.snapshot,
        status: r.status, createdAt: r.created_at, resolvedAt: r.resolved_at, openOnTarget: r.open_on_target,
        reporter: r.reporter_username ? { username: r.reporter_username } : null,
        owner: r.target_user_id && r.owner_username
          ? { id: r.target_user_id, username: r.owner_username, suspended: !!r.owner_suspended, isAdmin: r.owner_role === 'admin' } : null,
        target: reportTarget(r),
      })),
    });
  });

  router.post('/admin/reports/:id/dismiss', requireAdmin, (req, res) => {
    const r = mustRow('reports', adminId(req));
    moderate(req, 'dismiss_reports', r.target_type, r.target_id, req.body?.note, 'dismissed');
    res.json({ ok: true });
  });

  for (const [table, type] of [['videos', 'video'], ['comments', 'comment']]) {
    router.post(`/admin/${table}/:id/hide`, requireAdmin, (req, res) => {
      const row = mustRow(table, adminId(req));
      db.prepare(`UPDATE ${table} SET hidden_at = ? WHERE id = ?`).run(Date.now(), row.id);
      moderate(req, `hide_${type}`, type, row.id, req.body?.note);
      res.json({ ok: true, hidden: true });
    });
    router.post(`/admin/${table}/:id/unhide`, requireAdmin, (req, res) => {
      const row = mustRow(table, adminId(req));
      db.prepare(`UPDATE ${table} SET hidden_at = NULL WHERE id = ?`).run(row.id);
      moderate(req, `unhide_${type}`, type, row.id, req.body?.note, null);
      res.json({ ok: true, hidden: false });
    });
    router.delete(`/admin/${table}/:id`, requireAdmin, (req, res) => {
      const row = mustRow(table, adminId(req));
      tx(db, () => {
        moderate(req, `delete_${type}`, type, row.id, req.body?.note);
        if (type === 'video') removeVideo(row);
        else db.prepare('DELETE FROM comments WHERE id = ?').run(row.id);
      });
      res.json({ ok: true });
    });
  }

  router.post('/admin/users/:id/suspend', requireAdmin, (req, res) => {
    const u = mustRow('users', adminId(req));
    if (u.id === req.user.id || u.role === 'admin') throw bad('Admins cannot be suspended here.');
    const reason = String(req.body?.reason || '').trim().slice(0, 300);
    if (!reason) throw bad('Give a reason for the suspension.');
    tx(db, () => {
      db.prepare('UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ?').run(Date.now(), reason, u.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
      moderate(req, 'suspend_user', 'user', u.id, reason);
      // Their videos and comments are hidden by the suspension, so reports about them are handled too.
      db.prepare(`UPDATE reports SET status = 'actioned', resolved_at = ?, resolved_by = ? WHERE target_user_id = ? AND status = 'open'`)
        .run(Date.now(), req.user.id, u.id);
    });
    res.json({ ok: true, suspended: true });
  });
  router.post('/admin/users/:id/unsuspend', requireAdmin, (req, res) => {
    const u = mustRow('users', adminId(req));
    db.prepare("UPDATE users SET suspended_at = NULL, suspended_reason = '' WHERE id = ?").run(u.id);
    moderate(req, 'unsuspend_user', 'user', u.id, req.body?.note, null);
    res.json({ ok: true, suspended: false });
  });
  router.get('/admin/users', requireAdmin, (_req, res) => {
    const rows = db.prepare('SELECT * FROM users WHERE suspended_at IS NOT NULL ORDER BY suspended_at DESC LIMIT 200').all();
    res.json({ items: rows.map((u) => ({ ...serializeUser(u), suspendedAt: u.suspended_at, suspendedReason: u.suspended_reason })) });
  });

  router.get('/admin/log', requireAdmin, (_req, res) => {
    const rows = db.prepare(`SELECT l.*, a.username AS admin_username FROM moderation_log l LEFT JOIN users a ON a.id = l.admin_id
      ORDER BY l.created_at DESC, l.id DESC LIMIT 200`).all();
    res.json({
      items: rows.map((l) => ({ id: l.id, action: l.action, targetType: l.target_type, targetId: l.target_id, note: l.note, createdAt: l.created_at, admin: l.admin_username })),
    });
  });

  router.use((_req, _res, next) => next(notFound('Unknown API route')));

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 200 MB).' : err.message });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong on our side.' : err.message });
  });

  return router;
}
