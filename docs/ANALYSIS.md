# TikTok Web — Observed Feature Breakdown (REA investigation)

Target: `https://www.tiktok.com/` (public, logged-out), analysed 2026-10-19 from a
local Windows 11 session using the **REA MCP server 6.7.0** (`rea-agents`, 207 tools).
Browser: REA-launched headless Chromium 155 (`capture_browser_scenario`, launch mode,
owned temporary profile). Viewport 1366×800 unless stated.

This document separates **Observed** facts (backed by REA Evidence IDs), **Inferred**
conclusions, and **Unknowns**. It informs an *independent* rebuild (Clipwave); no
TikTok code, assets, or branding are reused.

## Evidence ledger

| ID (prefix) | Scenario | Result |
|---|---|---|
| `ev_31999ad9…` | Home `/`, settle 8 s, screenshot + a11y + network | complete (network budget 300 reached) |
| `ev_02591a3e…` | Home → click comment button (`aria-label*='comments'`) | click timed out (selector matched multiple nodes) |
| `ev_12309a7d…` | `/explore`, `/search?q=cooking`, `/@tiktok`, `/tiktokstudio/upload` | all navigated; search errored; profile showed CAPTCHA; upload → login redirect |
| `ev_8cef9c0e…` | Home → click `[data-e2e=comment-icon]` → share icon | comment click navigated to `/@user/video/<id>`; share click timed out (hover menu) |
| `ev_a5b14e70…` | Direct video detail URL | Comments / "You may like" tabs observed |
| `ev_ade02993…` | Home at 390×844 @2x | narrow layout observed |
| `ev_eb4d81d4…` | `/explore` with response bodies | `/api/explore/item_list/` JSON **shape** extracted (values discarded) |

Reference screenshots: `docs/reference-screenshots/` (analysis only — not shipped in the app).

## Investigation boundaries (honest limits)

- **Anti-bot defences engaged.** `/search?q=cooking` rendered "Something went wrong /
  Try again" and `/@tiktok` displayed a slider CAPTCHA ("Drag the slider to fit the
  puzzle", `verification-sg.tiktok.com/captcha/get` observed). The CAPTCHA was **not**
  solved or bypassed. Search results and full profile grids are therefore *unobserved*.
- **Logged-out only.** Upload / Studio redirect to `/login?redirect_url=…`. Creator
  tooling was not observed beyond the login gate and the Studio API names in network.
- Passive `inspect_web_page` on an external CDP browser returned `target_not_allowed`
  (REA policy); scenario capture was used instead.
- Network capture hit budgets (300/1500 transactions); scenario events carry no
  initiator stacks, so request→feature attribution below is by URL name (Inferred).

## 1. Home page & video feed

Observed (`ev_31999ad9`, screenshot 01):
- Three-column desktop layout: left nav sidebar (logo, search box, For You, Explore,
  Following, Short dramas, LIVE, Upload, Profile, More, Log in, footer links), centre
  feed column with one vertical 9:16 video card, right floating "Get Coins / Get App /
  Log in" pill and up/down chevron buttons.
- Feed is a list of `<article>` elements, each = one video; next article pre-rendered.
- Feed data: `GET /api/recommend/item_list/` (For You), `GET /api/preload/item_list/`,
  `POST /api/prefetch/explore/item_list/`.
- URL follows the active video: as the feed advanced the URL changed
  `/@bellaastillah_94/video/7650…` → `/@aisarkhaledd/video/7661…` (`ev_8cef9c0e`).

## 2. Vertical video player & controls

Observed (a11y tree):
- Region "Watch in full screen"; overlay: effect chip (link `/effect/<slug>-<id>`),
  author display name link, caption text, music link "Watch more videos with music …"
  (`/music/<slug>-<id>`), elapsed `00:05 / 00:13`, `slider "Video progress"`,
  `button "Volume" [pressed]` (starts muted), play/pause button.
- Red progress bar along the bottom edge of the card.
- Media: progressive MP4 from `v16-webapp*.tiktok.com/video/tos/...` (resource type `media`).
- Workers loaded: `vodsr-worker` (inferred: video super-resolution), `multiple.worker`.
- Item JSON exposes `video.duration, width, height, ratio, cover, dynamicCover,
  playAddr, bitrateInfo[]` (multiple quality ladders) and `volumeInfo.Loudness/Peak`.

## 3. Search & discovery

Observed (`ev_12309a7d`, screenshots 02–03):
- Explore: horizontal category chips (All, Singing & Dancing, Comedy, Sports, Anime &
  Comics, Relationship, Shows, Lipsync, …) with a scroll arrow; 6-column thumbnail grid,
  each tile with ♡ like-count overlay and author avatar + name (verified badge).
  Data: `GET /api/explore/item_list/?categoryType=&count=…`.
- Search page: tabs **Top, Users, Videos, LIVE, Photo**; query reflected in the
  sidebar search box. Endpoints observed: `/api/search/general/full/`,
  `/api/search/suggest/guide/`. Results not observed (anti-bot error).

## 4. User profiles

Observed (screenshot 04, behind CAPTCHA overlay):
- Header: large round avatar, display name + `@handle` + verified badge, counters
  **Following / Followers / Likes**, action buttons row, bio, external link.
- Below: tab bar and video grid (skeletons only). Endpoints: `/api/post/item_list/`,
  `/api/user/playlist/`, `/api/story/item_list/`.
- Route pattern `/@<uniqueId>`; sidebar "Profile" link is `/@` (self).

## 5. Likes, comments, sharing, following

Observed:
- Action rail per video: author avatar with **＋ follow** badge, Like (count),
  Comments (count), Favorites/bookmark (count), Share (count) — a11y labels e.g.
  "Like video 642.2K likes", "Add to Favorites. 25.1K added to Favorites".
- Clicking comments opens the video detail route with a right panel: tabs
  **Comments / You may like** (`ev_a5b14e70`, screenshot 05).
- Share opens on hover (click timed out) — Inferred: hover popover menu.
- Counts abbreviated (642.2K, 1.4M). `GET /api/share/settings/` loaded on start.
- Item flags: `digged` (liked by viewer), `collected` (favorited), `author.relation`
  (follow state), `itemCommentStatus`, `shareEnabled`, `duetEnabled`, `stitchEnabled`.
- Logged-out interactions route to login (login strings `WebApp_Login` fetched lazily).

## 6. Upload & creator features

Observed: `/tiktokstudio/upload` → `/login?redirect_url=…&enter_from=tiktokstudio`
(screenshot 06): QR code, phone/email/username, Facebook, Google login options.
Studio API names seen: `/tiktokstudio/api/web/user`, `/tiktokstudio/api/web/validate-bot`,
`/tiktok/v1/analytics/insights/`, `/tiktok/v1/creator/m10n_center/reward_analytics`,
`/api/v1/user/profile/upload/`.
Unknown: upload form fields, processing pipeline, editor.

## 7. Navigation & responsive layout

Observed (`ev_ade02993`, screenshot 07): at 390 px the desktop web app collapses the
sidebar to an icon-only rail; labels removed from a11y names; the video card fills
the remaining width. (Inferred: true mobile UA is served a separate mobile web app;
not tested.) Keyboard/chevron navigation between videos on desktop.

## 8. Observable API & frontend behaviour

- Stack: React 18 (`/webapp/main/react-v18/webapp-desktop/static/js/async/*.js`),
  heavy code-splitting (≈200+ chunks on first load), Rsbuild/Webpack-style hashed chunks,
  Module federation manifests (`vmok-manifest.json`), Web Workers, a WASM audio worklet.
- First-party REST under `/api/*`, `/tiktok/v1/*`, `/aweme/v1/*`, `/node-webapp/api/*`
  (BFF), one GraphQL endpoint (`/api/global-footer/graphql`).
- Common query params on every API call: `aid, app_name, device_id, region, language,
  browser_*, screen_*, tz_name, user_is_login, WebIdLastTime, odinId, count, …`.
- Telemetry/infra: `mon*.tiktokv.com` (monitoring), `mcs*.tiktokv.com` (analytics/webid),
  `libraweb` (A/B config), `starling` (i18n strings), `mssdk` (security SDK),
  `verification` (CAPTCHA), screen-time & impression tracking.
- Response envelope: `{statusCode, status_code, status_msg, hasMore, itemList[],
  extra{now, logid}, log_pb{impr_id}}`. Item fields: see `observed-item-shape.json`.

## 9. Features that need a backend + database

| Feature | Backend responsibility |
|---|---|
| Accounts & sessions | user table, password hashing, session tokens |
| Feed ranking | engagement counters, watch events, follow graph, affinity |
| Uploads | multipart ingest, file storage, metadata, cover, privacy |
| Likes / favorites / follows | relation tables, idempotent toggles, counters |
| Comments & replies | threaded table, comment likes, moderation (delete own) |
| Shares | share events + counters |
| Search | users/videos/hashtags index, suggestions |
| Notifications | fan-out on like/comment/follow, read state |
| Creator analytics | per-video views, likes, comments, shares, watch time |
| Video delivery | HTTP range requests for seeking |

## 10. Recommended architecture for an original rebuild

See `ARCHITECTURE.md`. Summary: Node.js 24 + Express REST API, SQLite (built-in
`node:sqlite`) with WAL, local disk media storage served with HTTP Range, scrypt
passwords + HttpOnly session cookie, a dependency-free ES-module SPA with a History
API router, scroll-snap vertical feed driven by IntersectionObserver, and a
transparent engagement × recency × affinity ranker. Swappable later for Postgres,
object storage + CDN, HLS transcoding workers, and a search engine.
