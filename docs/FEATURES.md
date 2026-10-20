# Clipwave feature breakdown

Each row links what REA **observed** on the reference site (see `ANALYSIS.md`)
to what Clipwave **implements**. Clipwave's code, name, logo, colours, icons and
demo media are all original. "Design choice" marks places where Clipwave
intentionally differs from, or goes beyond, what was observed.

## 1. Feed & navigation

| Observed on reference | Clipwave implementation | Where |
|---|---|---|
| Vertical one-video-per-screen feed of `<article>` cards | Scroll-snap feed (`scroll-snap-type: y mandatory`), one `<article class="vcard">` per video | `views/feed.js`, `styles.css` |
| Next card pre-rendered; feed refills | Infinite loading when ≤3 cards remain; `exclude=` cursor prevents repeats | `feed.js`, `GET /api/feed/foryou` |
| "For You" + "Following" feeds | Both, with a tab switcher at the top of the feed | `/`, `/following` |
| Up/down chevrons + keyboard | Chevron buttons; ↑/↓/J/K move, Space play/pause, L like, M mute, C comments, Esc closes drawer | `feed.js` |
| URL follows the active video (`/@user/video/id`) | **Design choice:** URL becomes `/?v=<id>` so refresh/share reopens the *feed* at that video instead of leaving it | `feed.js` |
| Empty/logged-out Following | Inline login form; when following nobody: suggested accounts with Follow buttons | `feed.js`, `GET /api/users` |
| Ranking (unknown internals) | Transparent ranker: engagement quality × completion rate × freshness × category affinity × follow boost × novelty (seen penalty) × jitter, plus a no-same-creator-twice diversity pass | `server/ranking.js` |

## 2. Player

| Observed | Implemented |
|---|---|
| Starts muted, Volume toggle | Global mute state shared by every card (browser autoplay rules require muted start) |
| Play/pause button, tap to pause | Single tap toggles; big play glyph when paused |
| `slider "Video progress"`, `00:05 / 00:13` | Seekable progress bar (pointer drag, click, ←/→ keys), elapsed/total time, ARIA slider values |
| Overlay: author, caption, music link | Author + verified badge + relative date, caption with clickable `#hashtags`/`@mentions`, scrolling sound title linking to a sound search |
| Effect chip (`/effect/...`) | Not implemented (no effects pipeline) |
| Double-tap like (well-known gesture) | Double-tap/double-click likes with a heart burst animation |
| Watch metrics (impression/screen-time endpoints) | Per-activation watch time + completion (loop detection) sent to `POST /api/videos/:id/view`; feeds ranking and Studio analytics |
| Multiple bitrates / HLS | **Not implemented:** progressive MP4/WebM with HTTP Range seeking |

## 3. Search & discovery

| Observed | Implemented |
|---|---|
| Explore category chips + 6-column grid with like counts | Explore page with 11 categories, responsive grid, like-count overlay, author row, hover-to-preview, infinite scroll |
| Search tabs: Top / Users / Videos / LIVE / Photo | Top / Accounts / Videos / Hashtags (no LIVE/Photo) |
| Search suggestions endpoint | Live suggestions dropdown (users + hashtags; trending tags when empty), keyboard navigable |
| Hashtag pages (inferred from item `textExtra`) | `/tag/:name` with video and view counts |

## 4. Profiles

| Observed | Implemented |
|---|---|
| Avatar, display name, @handle, verified, Following/Followers/Likes, bio, link | Same header; follower/following lists open in a modal |
| Video grid + tabs | Videos tab (public); Favorites and Liked tabs visible to the owner only (private by default) |
| Follow button | Follow / Following / Follow back states |
| (self) Edit profile | Edit name, bio (160 chars), avatar upload with preview |

## 5. Social actions

| Observed | Implemented |
|---|---|
| Like / Comments / Favorites / Share counts on the rail | All four with live counts, optimistic like, ARIA labels with counts |
| Follow "+" on author avatar | Hidden once following or for your own videos; synced across all cards |
| Comments panel (detail page tab, "You may like") | Comments drawer in the feed (side panel on desktop, bottom sheet on mobile) **and** on the video page with a "You may like" tab |
| Comment features (inferred) | Post, one-level replies, comment likes, delete own comments, video owner can moderate, Creator badge, comments-off setting |
| Share menu | Share sheet: copy link, native device share sheet (when available), email; every share is counted |
| Logged-out interaction → login | Any protected action opens the auth modal; the action completes after login without losing feed position |

## 6. Upload & creator tools

| Observed (login-gated) | Implemented |
|---|---|
| Upload route → login redirect | `/upload` requires login (inline form) |
| Studio analytics endpoints | Creator Studio: totals (views, likes, comments, shares, followers, videos) + per-post table with average watch time, completion %, privacy switcher, two-step delete |
| Upload form (unobserved) | Drag-and-drop or file picker; type/size/duration validation; metadata probe; cover chosen from any frame (canvas capture); caption with #/@ helpers and counter; sound name; category; privacy (Everyone / Followers / Only me); allow-comments toggle; real upload progress bar |

## 7. Notifications

| Observed (`inbox/notice` endpoints) | Implemented |
|---|---|
| Inbox notices | Activity page with filters (All, Likes, Comments, Mentions, Followers); fan-out on like, comment, reply, follow and @mention; unread dot in navigation (polled every 30 s) |

## 8. Responsive & accessibility

| Observed | Implemented |
|---|---|
| Desktop 3-column; icon rail at narrow widths | ≥1100 px full sidebar; 720–1100 px icon rail; <720 px true mobile layout: full-bleed video, overlaid action rail, bottom tab bar with Upload button, comment bottom sheet |
| — | Dark and light themes (system default + toggle), reduced-motion support, focus rings, ARIA roles/labels, keyboard shortcuts |

## 9. Backend services

Accounts (scrypt + HttpOnly session cookie), CSRF header check, auth rate
limit, privacy-aware queries everywhere, relational tables for likes,
favorites, follows, comments, comment likes, shares, watch events,
hashtags and notifications, multipart uploads with type/size limits,
Range-capable media serving, and a strict Content-Security-Policy. See
`ARCHITECTURE.md`.

## Not implemented (out of scope)

LIVE streaming, gifts/coins, direct messages, duets/stitches, effects,
server-side transcoding/HLS, OAuth/social
login. The architecture doc notes how each would fit. (Reporting, blocking,
moderation, account deletion and password reset were added in fasa 1.)
