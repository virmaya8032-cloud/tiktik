# Clipwave

An original short-video social app: a vertical swipe feed, uploads, likes,
comments, follows, search, profiles, notifications and a creator studio.
It was built clean-room from a REA (Reverse Engineer Anything) behavioural
analysis of a public short-video website. No code, assets or branding from
that site are used.

## Requirements

- Node.js 22.13 or later (tested on 24.18, Windows 11)
- Google Chrome or Microsoft Edge. These are only needed to generate the demo
  clips and to run the browser tests; set `CHROME_PATH` if the browser isn't
  in the default location.

## Run it

```powershell
cd C:\REA-Projects\clipwave
npm install
npm run seed      # generates 14 original demo clips + 9 accounts (about 1 minute)
npm start         # http://127.0.0.1:3000
```

Log in as **demo / demo12345**. The other seed accounts, such as `mira.cooks`,
use the password `clipwave123`. You can also sign up a new account.

| Command | What it does |
|---|---|
| `npm start` | Start the server (set `PORT` / `HOST` to change; default 127.0.0.1:3000) |
| `npm run dev` | Start with auto-restart on server file changes |
| `npm run seed -- --reset` | Wipe `data/` and regenerate the demo content |
| `npm test` | API integration tests (`test/*.test.js`) |
| `npm run set-admin -- <username>` | Make an account a moderator (`--remove` to undo, `--list` to list) |
| `npm run set-password -- <username> <password>` | Set a password from the command line |
| `npm run e2e` | Browser end-to-end tests (22 steps; screenshots go to `test/artifacts/`) |

## Features

- **For You** feed with a transparent ranking algorithm, plus a **Following** feed
- Full-screen vertical player: autoplay, mute, tap to pause, seek bar,
  double-tap to like, keyboard shortcuts (↑/↓, Space, L, M, C)
- Like, favorite, share (copy link, device share, email), and follow from the
  video rail
- Threaded comments with replies, comment likes, deletion and moderation by
  the video owner
- Explore by category, live search suggestions, and search across accounts,
  videos and hashtags, plus hashtag pages
- Profiles with follower lists, profile editing (avatar, name, bio), and
  private Liked and Favorites tabs
- Upload with drag and drop, cover-frame picker, caption hashtags and
  mentions, category, privacy, a comments toggle and a progress bar
- Creator Studio analytics (views, watch time, completion) with privacy and
  delete controls
- Activity inbox for likes, comments, replies, mentions and follows
- Responsive desktop, tablet and mobile layouts, plus dark and light themes
- Safety: report videos, comments and accounts; block accounts (two-way:
  videos, comments, search and notifications are hidden)
- Moderation panel at `/admin` for moderators: report queue with video
  preview, hide/restore/delete content, suspend accounts, audit log
- Delete account (password confirmed): removes videos, media files,
  comments, likes, follows and sessions
- Password reset with single-use links that expire after 30 minutes.
  Moderators create links in Moderation → Account tools. Email links are
  optional: set `SMTP_URL` (and `npm install nodemailer`), `MAIL_FROM`
  and `PUBLIC_URL`; `MAIL_LOG=1` prints emails to the console in development

## Documentation

- `docs/ANALYSIS.md`: REA investigation of the reference site, separating
  observed facts, inferences and unknowns, with Evidence IDs
- `docs/FEATURES.md`: a feature-by-feature map from what was observed to
  what was implemented
- `docs/ARCHITECTURE.md`: system design, security and the scaling path
- `docs/reference-screenshots/`: analysis captures (reference only; not
  part of the app)

## Project layout

```
server/   index.js (app), api.js (REST), auth.js, db.js (schema), ranking.js
public/   index.html, css/styles.css, js/{app,api,router,ui,icons}.js,
          js/components/*, js/views/*
scripts/  seed.js (procedural demo media via headless Chrome)
test/     api.test.js, e2e.js
data/     SQLite DB + uploads (created at runtime; git-ignored)
```
