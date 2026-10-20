# Clipwave architecture

```
Browser (ES-module SPA, no build step)          Node.js 24 + Express
┌───────────────────────────────┐   JSON/REST   ┌──────────────────────────────┐
│ router.js  History-API routes │ ────────────▶ │ /api  (server/api.js)        │
│ views/*    feed, explore, ... │ ◀──────────── │   auth.js  scrypt + sessions │
│ components/player, comments,  │               │   ranking.js For You ranker  │
│   share, auth, grid           │   Range GET   │ /media  express.static       │
│ api.js  fetch + XHR upload    │ ────────────▶ │   (HTTP 206 for seeking)     │
└───────────────────────────────┘               │ SQLite (node:sqlite, WAL)    │
                                                │ data/uploads/{videos,covers, │
                                                │   avatars}                   │
                                                └──────────────────────────────┘
```

## Backend

- **Runtime:** Node.js ≥ 22.13 (developed on 24.18) using the built-in
  `node:sqlite` driver, so there are no native modules to compile on Windows.
- **Express 4** app factory (`createApp`) so tests can run isolated instances
  (in-memory DB, temp upload dir).
- **Data model** (`server/db.js`): `users`, `sessions`, `videos`, `hashtags`,
  `video_hashtags`, `likes`, `favorites`, `follows`, `comments`,
  `comment_likes`, `shares`, `watch_events`, `notifications`. Foreign keys with
  cascades, composite primary keys make toggles idempotent, and indexes sit on
  the hot paths.
- **Visibility** is enforced in SQL for every video query: public, or own, or
  followers-only when the viewer follows the author. Liked and Favorites tabs
  are owner-only.
- **Auth:** scrypt password hashes with a random salt, 32-byte session tokens in
  an `HttpOnly; SameSite=Lax` cookie, 30-day expiry, a fixed-window rate limit
  on login and register.
- **CSRF:** every non-GET `/api` request must send
  `X-Requested-With: clipwave`, which a cross-site form cannot do without a
  CORS preflight.
- **Uploads:** multer disk storage with random file names and a MIME allow-list
  (MP4, WebM, MOV; JPEG, PNG, WebP), a 200 MB limit, and file cleanup when a
  request fails.
- **Media:** `express.static` serves `/media` with `Accept-Ranges`, so the
  player can seek within progressive files.
- **Security headers:** strict CSP (`script-src 'self'`, `style-src 'self'`,
  no inline code), `nosniff`, `SAMEORIGIN` frames, `same-origin` referrer.
- **Ranking:** `ranking.js` scores candidates by
  `log2(1 + weighted engagement) × completion × (0.5 + freshness) ×
  category affinity × follow boost × novelty × jitter`, then runs a diversity
  pass so the same creator never appears twice in a row.

## Frontend

- Dependency-free ES modules served as static files. The CSP forbids inline
  styles and scripts, so dynamic sizes are applied through the CSSOM.
- `ui.js`: an auto-escaping `html` tagged template, plus `richText` for
  hashtag and mention links, a modal with Escape and focus restore, a toast,
  and number and time formatting.
- `components/player.js`: the video card. It handles the IntersectionObserver
  active state, autoplay with a muted fallback, seeking, double-tap like,
  watch-time accounting with loop detection, optimistic like, and a
  cross-card event bus with timestamps that drops stale updates.
- The router re-renders on navigation; views may implement `onAuthChange()`
  to update in place after login so the feed keeps its scroll position.

## Testing

- `npm test` runs 15 API integration tests (node:test) against an in-memory
  database. They cover auth, CSRF, uploads, privacy, social toggles, comments,
  search, notifications, the studio and the SPA fallback.
- `npm run e2e` runs 22 browser steps with playwright-core driving locally
  installed Chrome or Edge against an isolated copy of the seeded data. It
  covers the feed, keyboard, auth modal, likes, mute, seek, comments, share,
  follow, Explore, search, hashtags, the video page, upload, profile editing,
  the studio, mention notifications, theme, the mobile layout, and checks
  that no console errors occur. Screenshots land in `test/artifacts/`.

## Scaling path (not needed for local use)

| Concern | Today | Production swap |
|---|---|---|
| Database | SQLite file | PostgreSQL, with counters denormalised into `video_stats` |
| Media | local disk, progressive files | object storage + CDN; a transcode worker (ffmpeg) producing HLS/DASH ladders and posters |
| Search | `LIKE` queries | Postgres full-text search, Meilisearch or OpenSearch |
| Feed | rank all candidates per request | candidate generation + feature store + cached ranked lists per user |
| Notifications | polling every 30 s | WebSocket/SSE push |
| Sessions | DB table | Redis, or keep the table with periodic cleanup |
| Live, DMs, duets | not built | separate services: WebRTC/RTMP ingest, a chat service, an editing pipeline |
