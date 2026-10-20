// Seeds Clipwave with original, procedurally generated demo content.
// Clips are rendered in headless Chrome (canvas + WebAudio -> MediaRecorder),
// so no third-party media is used.  Usage: npm run seed [-- --reset] [-- --clips=12]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { openDatabase } from '../server/db.js';
import { hashPassword } from '../server/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const args = process.argv.slice(2);
const reset = args.includes('--reset');
const clipCount = Number(args.find((a) => a.startsWith('--clips='))?.split('=')[1]) || 14;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
export const findChrome = () => CHROME_CANDIDATES.find((p) => fs.existsSync(p));

const CREATORS = [
  { username: 'demo', name: 'Demo Account', bio: 'Log in as me to try everything: demo / demo12345', verified: 0 },
  { username: 'mira.cooks', name: 'Mira Cooks', bio: 'Weeknight recipes in under a minute.', verified: 1 },
  { username: 'pixelpaul', name: 'Pixel Paul', bio: 'Retro games, speedruns and pixel art.', verified: 0 },
  { username: 'wanderlena', name: 'Lena Wanders', bio: 'Slow travel and sunsets around the world.', verified: 1 },
  { username: 'beatsbyjo', name: 'Jo Beats', bio: 'Lo-fi loops, one bar at a time.', verified: 0 },
  { username: 'codewithkai', name: 'Kai Codes', bio: 'Tiny programming tips. Ship it!', verified: 0 },
  { username: 'paws.and.tails', name: 'Paws & Tails', bio: 'Daily dose of animal energy.', verified: 0 },
  { username: 'fitwithnoor', name: 'Noor Fitness', bio: '5-minute workouts, zero equipment.', verified: 1 },
  { username: 'inkandsky', name: 'Ink & Sky', bio: 'Watercolor experiments and studio vlogs.', verified: 0 },
];

const CLIPS = [
  { by: 'mira.cooks', cat: 'food', title: 'Garlic butter pasta', sub: 'in 60 seconds', cap: 'Garlic butter pasta, the 15-minute version #food #quickrecipe #pasta', hue: [18, 42], fx: 'steam' },
  { by: 'mira.cooks', cat: 'food', title: 'Crispy tofu bowl', sub: 'meal prep friendly', cap: 'Crispy tofu bowl you can prep on Sunday #mealprep #food #vegan', hue: [95, 150], fx: 'bubbles' },
  { by: 'pixelpaul', cat: 'gaming', title: 'Level 1-1', sub: 'any% route', cap: 'New personal best on the classic route #speedrun #gaming #retro', hue: [250, 290], fx: 'pixels' },
  { by: 'pixelpaul', cat: 'art', title: 'Pixel sunset', sub: '16 colors only', cap: 'Painting a sunset with a 16-color palette #pixelart #art', hue: [300, 20], fx: 'stripes' },
  { by: 'wanderlena', cat: 'travel', title: 'Golden hour', sub: 'coastal road trip', cap: 'Chasing golden hour along the coast #travel #sunset #roadtrip', hue: [28, 330], fx: 'waves' },
  { by: 'wanderlena', cat: 'travel', title: 'Night market', sub: 'street food tour', cap: 'Ten stalls, one night. Which would you try first? #travel #streetfood #food', hue: [200, 270], fx: 'lights' },
  { by: 'beatsbyjo', cat: 'music', title: 'Rainy day loop', sub: '82 bpm', cap: 'Rainy day lo-fi loop. Headphones on #lofi #music #beats', hue: [205, 235], fx: 'eq' },
  { by: 'beatsbyjo', cat: 'music', title: 'Synth arp', sub: 'one take', cap: 'One-take synth arpeggio, unmute for this one #music #synth', hue: [280, 180], fx: 'rings' },
  { by: 'codewithkai', cat: 'tech', title: 'Array.at(-1)', sub: 'JS tip #12', cap: 'Stop writing arr[arr.length - 1] #javascript #codingtips #tech', hue: [160, 200], fx: 'code' },
  { by: 'codewithkai', cat: 'tech', title: 'git switch -', sub: 'jump back fast', cap: 'The fastest way back to your previous branch #git #codingtips', hue: [10, 45], fx: 'code' },
  { by: 'paws.and.tails', cat: 'pets', title: 'Zoomies', sub: 'at 6 a.m.', cap: 'Every morning at 6. Every. Morning. #pets #dogs #funny', hue: [40, 60], fx: 'bounce' },
  { by: 'fitwithnoor', cat: 'sports', title: '5-min core', sub: 'no equipment', cap: 'Five minutes, no equipment, full core burn #fitness #workout #sports', hue: [340, 15], fx: 'pulse' },
  { by: 'inkandsky', cat: 'art', title: 'Wet on wet', sub: 'watercolor sky', cap: 'Wet-on-wet sky in three colors #watercolor #art #painting', hue: [190, 260], fx: 'blobs' },
  { by: 'demo', cat: 'comedy', title: 'Monday mood', sub: 'a short film', cap: 'Me opening my laptop on Monday #comedy #relatable @codewithkai', hue: [260, 320], fx: 'bounce' },
  { by: 'beatsbyjo', cat: 'dance', title: 'Step count', sub: '8 counts, try it', cap: 'Learn this 8-count in under a minute #dance #tutorial', hue: [300, 340], fx: 'pulse' },
  { by: 'wanderlena', cat: 'travel', title: 'Mountain fog', sub: 'sunrise hike', cap: 'Worth the 4 a.m. alarm #hiking #travel #nature', hue: [210, 160], fx: 'blobs' },
];

const COMMENTS = [
  'This is so good!', 'Saving this for later', 'Wait, how did you do that?', 'The colors though', 'Need a part 2 please',
  'Instant follow', 'Watched this five times', 'Tutorial when?', 'Okay this made my day', 'Underrated creator',
  'Trying this tonight', 'The ending got me', 'Can you do one with a twist?', 'Love the vibe here',
];

// Runs inside the browser: renders one clip and returns base64 media + cover.
async function renderClipInPage({ title, sub, hue, fx, seconds, w, h, seed }) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts = Array.from({ length: 40 }, () => ({ x: rnd() * w, y: rnd() * h, r: 6 + rnd() * 40, v: 0.3 + rnd() * 1.6, p: rnd() * 6.28 }));
  const code = ['const last = arr.at(-1);', '// works on strings too', "'clip'.at(-1) // 'p'", '$ git switch -', '# back where you were'];

  function frame(t) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue[0] + Math.sin(t * 0.4) * 12} 75% 52%)`);
    g.addColorStop(1, `hsl(${hue[1] + Math.cos(t * 0.3) * 12} 70% 30%)`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.save();
    if (fx === 'waves' || fx === 'stripes') {
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue[1] + i * 8} 80% ${70 - i * 6}% / ${0.25 + i * 0.05})`;
        const y0 = h * (0.45 + i * 0.07);
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 12) ctx.lineTo(x, y0 + Math.sin(x / (fx === 'waves' ? 70 : 30) + t * (1 + i * 0.3)) * (18 + i * 4));
        ctx.lineTo(w, h); ctx.fill();
      }
    } else if (fx === 'eq') {
      const n = 18;
      for (let i = 0; i < n; i++) {
        const bh = (0.15 + 0.6 * Math.abs(Math.sin(t * 3 + i * 0.7) * Math.cos(t * 1.3 + i))) * h * 0.5;
        ctx.fillStyle = `hsl(${hue[0] + i * 6} 90% 70%)`;
        ctx.fillRect(w * 0.08 + i * (w * 0.84 / n), h * 0.78 - bh, w * 0.84 / n - 6, bh);
      }
    } else if (fx === 'rings' || fx === 'pulse') {
      for (let i = 0; i < 6; i++) {
        const r = ((t * 120 + i * 90) % 540);
        ctx.strokeStyle = `hsla(${hue[1]} 90% 80% / ${1 - r / 540})`;
        ctx.lineWidth = fx === 'pulse' ? 18 : 6;
        ctx.beginPath(); ctx.arc(w / 2, h * 0.42, r, 0, 6.29); ctx.stroke();
      }
    } else if (fx === 'pixels') {
      const sz = 36;
      for (let x = 0; x < w; x += sz) for (let y = 0; y < h; y += sz) {
        const v = Math.sin(x * 0.02 + t * 2) + Math.cos(y * 0.015 - t * 1.5);
        if (v > 0.9) { ctx.fillStyle = `hsla(${hue[0] + v * 40} 90% 65% / .7)`; ctx.fillRect(x + 2, y + 2, sz - 4, sz - 4); }
      }
    } else if (fx === 'code') {
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      ctx.fillRect(w * 0.07, h * 0.52, w * 0.86, h * 0.3);
      ctx.font = `600 ${Math.round(w * 0.045)}px Consolas, monospace`;
      const shown = Math.floor(t * 1.4);
      code.slice(0, Math.min(code.length, shown + 1)).forEach((line, i) => {
        ctx.fillStyle = i % 2 ? '#9cdcfe' : '#c3e88d';
        const chars = i === shown ? Math.floor((t * 1.4 - shown) * line.length) : line.length;
        ctx.fillText(line.slice(0, chars), w * 0.11, h * 0.58 + i * w * 0.075);
      });
    } else {
      for (const p of parts) {
        let x = p.x; let y = p.y;
        if (fx === 'bubbles' || fx === 'steam') y = (p.y - t * 60 * p.v + h * 2) % h;
        if (fx === 'bounce') { y = h * 0.75 - Math.abs(Math.sin(t * 2.4 * p.v + p.p)) * h * 0.4; }
        if (fx === 'lights') x = p.x + Math.sin(t + p.p) * 20;
        if (fx === 'blobs') { x = p.x + Math.sin(t * 0.6 + p.p) * 60; y = p.y + Math.cos(t * 0.5 + p.p) * 60; }
        ctx.beginPath();
        ctx.fillStyle = `hsla(${hue[1] + p.r} 90% ${fx === 'lights' ? 75 : 85}% / ${fx === 'blobs' ? 0.18 : 0.35})`;
        ctx.arc(x, y, fx === 'blobs' ? p.r * 3 : p.r * 0.6, 0, 6.29); ctx.fill();
      }
    }
    ctx.restore();
    // Title card with a gentle entrance.
    const k = Math.min(1, t / 0.8);
    ctx.globalAlpha = k;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 18;
    ctx.font = `800 ${Math.round(w * 0.105)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(title, w / 2, h * 0.3 + (1 - k) * 30);
    ctx.font = `500 ${Math.round(w * 0.055)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(sub, w / 2, h * 0.36 + (1 - k) * 30);
    ctx.shadowBlur = 0;
    // Small watermark in the top-right corner, clear of the caption overlay.
    ctx.globalAlpha = 0.7;
    ctx.textAlign = 'end';
    ctx.font = `700 ${Math.round(w * 0.034)}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText('clipwave demo', w * 0.95, h * 0.1);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
  }

  // Simple melody so the mute/unmute control has something to toggle.
  const ac = new AudioContext();
  const dest = ac.createMediaStreamDestination();
  const gain = ac.createGain();
  gain.gain.value = 0.08;
  gain.connect(dest);
  const scale = [0, 3, 5, 7, 10, 12];
  const base = 196 * 2 ** ((seed % 7) / 12);
  for (let i = 0; i < seconds * 4; i++) {
    const o = ac.createOscillator();
    const env = ac.createGain();
    o.type = i % 8 === 0 ? 'triangle' : 'sine';
    o.frequency.value = base * 2 ** (scale[Math.floor(rnd() * scale.length)] / 12);
    const at = ac.currentTime + 0.1 + i * 0.25;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + 0.02);
    env.gain.exponentialRampToValueAtTime(0.001, at + 0.24);
    o.connect(env); env.connect(gain);
    o.start(at); o.stop(at + 0.25);
  }

  const stream = canvas.captureStream(30);
  for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
  const types = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mimeType = types.find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((r) => { rec.onstop = r; });
  let coverData = null;
  const start = performance.now();
  rec.start(250);
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      frame(t);
      if (!coverData && t > 1.2) coverData = canvas.toDataURL('image/jpeg', 0.85);
      if (t < seconds) requestAnimationFrame(tick); else resolve();
    };
    tick();
  });
  rec.stop();
  await done;
  ac.close();
  const blob = new Blob(chunks, { type: mimeType });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { media: btoa(bin), mimeType: mimeType.split(';')[0], cover: coverData.split(',')[1] };
}

async function renderAvatarInPage({ letter, hue }) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, `hsl(${hue} 80% 60%)`); g.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 40%)`);
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(255,255,255,.15)';
  x.beginPath(); x.arc(200, 60, 90, 0, 6.29); x.fill();
  x.fillStyle = '#fff'; x.font = '800 128px "Segoe UI", system-ui, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(letter, 128, 140);
  return c.toDataURL('image/png').split(',')[1];
}

async function main() {
  const dbFile = path.join(DATA, 'clipwave.db');
  if (reset) {
    for (const f of ['clipwave.db', 'clipwave.db-wal', 'clipwave.db-shm']) fs.rmSync(path.join(DATA, f), { force: true });
    fs.rmSync(UPLOADS, { recursive: true, force: true });
    console.log('Reset existing data.');
  }
  const db = openDatabase(dbFile);
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
    console.log('Database already has users - run "npm run seed -- --reset" to start over.');
    return;
  }
  for (const sub of ['videos', 'covers', 'avatars']) fs.mkdirSync(path.join(UPLOADS, sub), { recursive: true });

  const executablePath = findChrome();
  if (!executablePath) throw new Error('Chrome/Edge not found. Set CHROME_PATH to a Chromium-based browser.');
  console.log(`Rendering ${Math.min(clipCount, CLIPS.length)} clips with ${executablePath}`);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext();
  const name = () => `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;

  const now = Date.now();
  const userIds = {};
  const page = await ctx.newPage();
  for (const [i, c] of CREATORS.entries()) {
    const png = await page.evaluate(renderAvatarInPage, { letter: c.name[0], hue: (i * 47) % 360 });
    const rel = `avatars/${name()}.png`;
    fs.writeFileSync(path.join(UPLOADS, rel), Buffer.from(png, 'base64'));
    const info = db.prepare('INSERT INTO users (username, display_name, bio, avatar_path, password_hash, verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(c.username, c.name, c.bio, rel, hashPassword(c.username === 'demo' ? 'demo12345' : 'clipwave123'), c.verified, now - (30 - i) * 86_400_000);
    userIds[c.username] = Number(info.lastInsertRowid);
  }

  const clips = CLIPS.slice(0, clipCount);
  const pages = await Promise.all([0, 1, 2].map(() => ctx.newPage()));
  const results = new Array(clips.length);
  let next = 0;
  await Promise.all(pages.map(async (p) => {
    while (next < clips.length) {
      const idx = next++;
      const c = clips[idx];
      const seconds = 6 + (idx % 4);
      results[idx] = { ...(await p.evaluate(renderClipInPage, { title: c.title, sub: c.sub, hue: c.hue, fx: c.fx, seconds, w: 540, h: 960, seed: 1000 + idx * 7919 })), seconds };
      console.log(`  clip ${idx + 1}/${clips.length}: ${c.title} (${results[idx].mimeType}, ${Math.round(results[idx].media.length * 0.75 / 1024)} KB)`);
    }
  }));
  await browser.close();

  const insertVideo = db.prepare(`INSERT INTO videos (user_id, caption, category, sound_title, video_path, cover_path, mime_type, duration, width, height, privacy, allow_comments, views, watch_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 540, 960, 'public', 1, ?, ?, ?)`);
  const videoIds = [];
  clips.forEach((c, idx) => {
    const r = results[idx];
    const ext = r.mimeType === 'video/mp4' ? '.mp4' : '.webm';
    const vRel = `videos/${name()}${ext}`;
    const cRel = `covers/${name()}.jpg`;
    fs.writeFileSync(path.join(UPLOADS, vRel), Buffer.from(r.media, 'base64'));
    fs.writeFileSync(path.join(UPLOADS, cRel), Buffer.from(r.cover, 'base64'));
    const views = 40 + Math.floor(Math.random() * 900);
    const info = insertVideo.run(userIds[c.by], c.cap, c.cat, c.cat === 'music' ? `${c.title} - ${CREATORS.find((x) => x.username === c.by).name}` : '',
      vRel, cRel, r.mimeType, r.seconds, views, views * 4000, now - (clips.length - idx) * 3_600_000 * 7);
    const vid = Number(info.lastInsertRowid);
    videoIds.push(vid);
    for (const [, tag] of c.cap.matchAll(/#([\p{L}\p{N}_]{1,50})/gu)) {
      db.prepare('INSERT OR IGNORE INTO hashtags (name) VALUES (?)').run(tag.toLowerCase());
      const t = db.prepare('SELECT id FROM hashtags WHERE name = ?').get(tag.toLowerCase());
      db.prepare('INSERT OR IGNORE INTO video_hashtags (video_id, hashtag_id) VALUES (?, ?)').run(vid, t.id);
    }
  });

  // Social graph: follows, likes, favorites, comments - all between seed accounts.
  const ids = Object.values(userIds);
  let n = 0;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  for (const a of ids) for (const b of ids) if (a !== b && Math.random() < 0.45) {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)').run(a, b, now - Math.random() * 1e9);
  }
  for (const vid of videoIds) {
    for (const u of ids) {
      if (Math.random() < 0.55) db.prepare('INSERT OR IGNORE INTO likes (user_id, video_id, created_at) VALUES (?, ?, ?)').run(u, vid, now - Math.random() * 5e8);
      if (Math.random() < 0.2) db.prepare('INSERT OR IGNORE INTO favorites (user_id, video_id, created_at) VALUES (?, ?, ?)').run(u, vid, now - Math.random() * 5e8);
    }
    const k = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < k; i++) {
      db.prepare('INSERT INTO comments (video_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(vid, pick(ids), pick(COMMENTS), now - Math.random() * 4e8);
      n++;
    }
    if (Math.random() < 0.5) db.prepare("INSERT INTO shares (video_id, user_id, channel, created_at) VALUES (?, ?, 'copy_link', ?)").run(vid, pick(ids), now);
  }
  // A few notifications for the demo account so the inbox isn't empty.
  const demo = userIds.demo;
  const demoVideo = db.prepare('SELECT id FROM videos WHERE user_id = ? LIMIT 1').get(demo)?.id ?? null;
  for (const u of ids.filter((x) => x !== demo).slice(0, 4)) {
    db.prepare("INSERT INTO notifications (user_id, actor_id, type, video_id, created_at) VALUES (?, ?, 'like', ?, ?)").run(demo, u, demoVideo, now - Math.random() * 3e7);
  }
  db.prepare("INSERT INTO notifications (user_id, actor_id, type, created_at) VALUES (?, ?, 'follow', ?)").run(demo, userIds['mira.cooks'], now - 6e6);
  db.prepare("INSERT INTO notifications (user_id, actor_id, type, video_id, created_at) VALUES (?, ?, 'mention', ?, ?)").run(userIds.codewithkai, demo, demoVideo, now - 5e6);

  console.log(`Seeded ${ids.length} users, ${videoIds.length} videos, ${n} comments.`);
  console.log('Log in with demo / demo12345 (other seed accounts use clipwave123).');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err); process.exitCode = 1; });
}
