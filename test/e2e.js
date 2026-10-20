// End-to-end browser test: drives every major feature against a fresh server
// with an isolated database. Usage: npm run e2e  (requires Chrome or Edge).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createApp } from '../server/index.js';
import { findChrome } from '../scripts/seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = path.join(ROOT, 'test', 'artifacts');
fs.mkdirSync(ART, { recursive: true });

// Use a seed clip as the upload fixture (run `npm run seed` first).
const seedVideos = path.join(ROOT, 'data', 'uploads', 'videos');
const fixture = fs.existsSync(seedVideos) ? fs.readdirSync(seedVideos).map((f) => path.join(seedVideos, f))[0] : null;
if (!fixture) { console.error('No fixture video - run "npm run seed" first.'); process.exit(1); }

// Fresh isolated server; copy the seeded DB so the feed has content.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clipwave-e2e-'));
for (const f of ['clipwave.db', 'clipwave.db-wal']) {
  const src = path.join(ROOT, 'data', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, f));
}
fs.cpSync(path.join(ROOT, 'data', 'uploads'), path.join(tmp, 'uploads'), { recursive: true });
const { app, db } = createApp({ dbFile: path.join(tmp, 'clipwave.db'), uploadDir: path.join(tmp, 'uploads') });
const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const problems = [];
const results = [];
let failPage = null;
const uname = `tester${Date.now().toString(36).slice(-5)}`;

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${label}] console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
}
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(['PASS', name, Date.now() - t]);
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push(['FAIL', name, Date.now() - t]);
    console.log(`  FAIL ${name}\n       ${err.message.split('\n')[0]}`);
    if (failPage) {
      await failPage.screenshot({ path: path.join(ART, 'FAILED.png') }).catch(() => {});
      const dump = await failPage.evaluate(() => (document.querySelector('.drawer:not([hidden])') || document.querySelector('main'))?.outerHTML.slice(0, 2500)).catch(() => '');
      console.log('       DOM:', dump);
    }
    throw err;
  }
}

let exitCode = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  failPage = page;
  const shot = (n) => page.screenshot({ path: path.join(ART, `${n}.png`) });

  await step('feed loads and autoplays the active video', async () => {
    await page.goto(BASE);
    await page.waitForSelector('article.vcard.active');
    await page.waitForFunction(() => { const v = document.querySelector('article.vcard.active video'); return v && v.currentTime > 0.3 && !v.paused; }, null, { timeout: 15000 });
    assert.match(page.url(), /\?v=\d+/, 'URL tracks the active video');
    await shot('01-feed');
  });

  await step('keyboard navigation moves to the next video', async () => {
    const first = await page.getAttribute('article.vcard.active', 'data-id');
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction((id) => document.querySelector('article.vcard.active')?.dataset.id !== id, first, { timeout: 8000 });
  });

  await step('logged-out like opens the auth modal', async () => {
    await page.click('article.vcard.active .r-like');
    await page.waitForSelector('.modal-auth');
  });

  await step('sign up from the modal', async () => {
    await page.click('.modal-auth [data-mode=register]');
    await page.click('.modal-auth .auth-opt');
    await page.fill('.modal-auth input[name=displayName]', 'E2E Tester');
    await page.fill('.modal-auth input[name=username]', uname);
    await page.fill('.modal-auth input[name=password]', 'password123');
    await page.click('.modal-auth button[type=submit]');
    await page.waitForSelector('.modal-auth', { state: 'detached' });
    await page.waitForSelector('.me-card');
  });

  await step('the like that triggered login completes; unlike/like/favorite/double-tap', async () => {
    const pressed = () => page.getAttribute('article.vcard.active .r-like', 'aria-pressed');
    const likes = async () => Number((await page.getAttribute('article.vcard.active .r-like', 'aria-label')).match(/(\d+) likes/)[1]);
    await page.waitForFunction(() => document.querySelector('article.vcard.active .r-like')?.getAttribute('aria-pressed') === 'true', null, { timeout: 8000 });
    const liked = await likes();
    await page.click('article.vcard.active .r-like');
    await page.waitForFunction(() => document.querySelector('article.vcard.active .r-like')?.getAttribute('aria-pressed') === 'false');
    assert.equal(await likes(), liked - 1);
    await page.click('article.vcard.active .r-like');
    await page.waitForFunction(() => document.querySelector('article.vcard.active .r-like')?.getAttribute('aria-pressed') === 'true');
    assert.equal(await likes(), liked);
    assert.equal(await pressed(), 'true');
    await page.click('article.vcard.active .r-fav');
    await page.waitForFunction(() => document.querySelector('article.vcard.active .r-fav')?.getAttribute('aria-pressed') === 'true');
    // Next video: double-click the stage to like.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(900);
    await page.locator('article.vcard.active .v-tap').dblclick();
    await page.waitForFunction(() => document.querySelector('article.vcard.active .r-like')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
  });

  await step('mute toggle and play/pause', async () => {
    await page.click('article.vcard.active .v-mute');
    assert.equal(await page.evaluate(() => document.querySelector('article.vcard.active video').muted), false);
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.querySelector('article.vcard.active video').paused);
    await page.keyboard.press(' ');
    await page.waitForFunction(() => !document.querySelector('article.vcard.active video').paused);
  });

  await step('seek with the progress bar', async () => {
    const bar = page.locator('article.vcard.active .v-bar');
    const box = await bar.boundingBox();
    await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.waitForFunction(() => { const v = document.querySelector('article.vcard.active video'); return v.duration && v.currentTime / v.duration > 0.6; }, null, { timeout: 5000 });
  });

  await step('comment drawer: post, reply, like, delete', async () => {
    await page.click('article.vcard.active .r-comment');
    await page.waitForSelector('.drawer .comments .comment, .drawer .c-empty');
    const countBefore = await page.locator('.drawer .comment').count();
    await page.fill('.drawer .c-form input', 'Great clip from the e2e test #testing');
    await page.click('.drawer .c-form button[type=submit]');
    await page.waitForFunction((n) => document.querySelectorAll('.drawer .comment').length === n + 1, countBefore);
    const mine = page.locator('.drawer .comment').first();
    await mine.locator('.c-reply').first().click();
    await page.fill('.drawer .c-form input', 'replying to myself');
    await page.click('.drawer .c-form button[type=submit]');
    await page.waitForSelector('.drawer .comment.reply');
    await mine.locator('.c-like').last().click();
    await page.waitForFunction(() => document.querySelector('.drawer .comment .c-like.on'));
    await page.waitForFunction(() => !document.querySelector('.heart-pop'), null, { timeout: 2000 }); // hearts clean up after their animation
    await shot('02-comments');
    const reply = page.locator('.drawer .comment.reply').first();
    await reply.locator('.c-del').click();
    await reply.locator('.c-del').click();
    await page.waitForSelector('.drawer .comment.reply', { state: 'detached' });
    await page.click('.drawer .c-close');
  });

  await step('share sheet copies link and counts the share', async () => {
    const before = await page.locator('article.vcard.active .r-share strong').textContent();
    await page.click('article.vcard.active .r-share');
    await page.waitForSelector('.modal-share');
    await page.click('.modal-share [data-ch=copy_link]');
    await page.waitForSelector('.modal-share', { state: 'detached' });
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(clip, /\/@[\w.]+\/video\/\d+$/);
    await page.waitForFunction((b) => document.querySelector('article.vcard.active .r-share strong').textContent !== b, before);
  });

  await step('follow a creator from the rail', async () => {
    const follow = page.locator('article.vcard.active .rail-follow');
    if (await follow.isVisible()) {
      await follow.click();
      await page.waitForFunction(() => document.querySelector('article.vcard.active .rail-follow')?.hidden === true);
    }
  });

  await step('following feed shows followed creators', async () => {
    await page.click('.side-nav a[href="/following"]');
    await page.waitForSelector('article.vcard, .feed-empty');
    assert.ok(await page.locator('article.vcard').count() > 0, 'following feed has videos');
  });

  await step('explore categories and grid', async () => {
    await page.click('.side-nav a[href="/explore"]');
    await page.waitForSelector('.explore .tile');
    await page.click('.chip[href="/explore?category=food"]');
    await page.waitForSelector('.chip[aria-selected=true][href="/explore?category=food"]');
    await page.waitForSelector('.explore .tile');
    await shot('03-explore');
  });

  await step('search suggestions and results tabs', async () => {
    await page.click('.search input');
    await page.fill('.search input', 'mira');
    await page.waitForSelector('#suggest:not([hidden]) [role=option]');
    await page.press('.search input', 'Enter');
    await page.waitForURL(/\/search\?q=mira/);
    await page.waitForSelector('.user-row');
    await page.click('.tabs a:has-text("Videos")');
    await page.waitForSelector('.results .tile');
    await page.goto(`${BASE}/search?q=%23food`);
    await page.waitForSelector('.tag-row, .tile');
    await shot('04-search');
  });

  await step('hashtag page from a caption link', async () => {
    await page.goto(`${BASE}/tag/food`);
    await page.waitForSelector('.tag-head h1');
    assert.equal(await page.textContent('.tag-head h1'), '#food');
  });

  await step('video page with comments and related tabs', async () => {
    await page.click('.tile');
    await page.waitForSelector('.video-page .vcard');
    await page.waitForSelector('.vp-panel[data-panel=comments] .comments');
    await page.click('[data-tab=related]');
    await page.waitForSelector('[data-panel=related] .tile, [data-panel=related] .empty');
    const overflow = await page.evaluate(() => { const p = document.querySelector('[data-panel=related]'); return p.scrollWidth - p.clientWidth; });
    assert.ok(overflow <= 1, `related grid fits its panel (overflow ${overflow}px)`);
    await shot('05-video-page');
  });

  await step('upload a video with caption, cover and privacy', async () => {
    await page.click('.side-nav a[href="/upload"]');
    await page.setInputFiles('.drop input[type=file]', fixture);
    await page.waitForSelector('.up-preview:not([hidden])');
    await page.waitForFunction(() => document.querySelector('.cover-img')?.src.startsWith('blob:'), null, { timeout: 10000 });
    await page.fill('.up-form textarea[name=caption]', 'My first Clipwave upload #e2e #testing @mira.cooks');
    await page.selectOption('.up-form select[name=category]', 'tech');
    await shot('06-upload');
    await page.click('.up-post');
    await page.waitForURL(/\/video\/\d+$/, { timeout: 20000 });
    await page.waitForSelector('.video-page .v-caption a.tag');
  });

  await step('profile shows upload; edit profile', async () => {
    await page.click('.me-link');
    await page.waitForSelector('.profile .tile');
    await page.click('.p-edit');
    await page.fill('.edit-profile textarea[name=bio]', 'I test things for a living.');
    await page.click('.edit-profile button.btn-primary');
    await page.waitForFunction(() => document.querySelector('.p-bio')?.textContent.includes('I test things'));
    await page.click('.p-tabs a:has-text("Liked")');
    await page.waitForSelector('.profile .tile');
    await page.click('.p-tabs a:has-text("Saved")');
    await page.waitForSelector('.profile .tile');
    await shot('07-profile');
  });

  await step('creator studio shows stats and can change privacy', async () => {
    await page.goto(`${BASE}/studio`);
    await page.waitForSelector('.studio tbody tr');
    await page.selectOption('.studio tbody tr:first-child select.priv', 'followers');
    await page.waitForSelector('#toast.show');
    await shot('08-studio');
  });

  await step('mention notification reaches the mentioned creator', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 800 } });
    const p2 = await ctx2.newPage();
    watch(p2, 'mira');
    await p2.goto(`${BASE}/login`);
    await p2.fill('input[name=username]', 'mira.cooks');
    await p2.fill('input[name=password]', 'clipwave123');
    await p2.click('button[type=submit]');
    await p2.waitForSelector('.me-card');
    await p2.goto(`${BASE}/inbox?type=mention`);
    await p2.waitForSelector('.notif');
    assert.ok((await p2.textContent('.notif-list')).includes('E2E Tester'));
    await p2.screenshot({ path: path.join(ART, '09-inbox.png') });
    await ctx2.close();
  });

  await step('theme toggle and logout', async () => {
    const initial = await page.getAttribute('html', 'data-theme');
    await page.click('.theme-toggle');
    assert.equal(await page.getAttribute('html', 'data-theme'), initial === 'dark' ? 'light' : 'dark');
    await shot('13-theme-toggled');
    await page.click('.theme-toggle');
    assert.equal(await page.getAttribute('html', 'data-theme'), initial);
    await page.click('.logout');
    await page.waitForSelector('.login-btn');
  });

  await step('mobile layout: full-screen feed with bottom tab bar and comment sheet', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await m.newPage();
    watch(mp, 'mobile');
    await mp.goto(BASE);
    await mp.waitForSelector('article.vcard.active');
    assert.ok(await mp.isVisible('.tabbar'));
    assert.ok(!(await mp.isVisible('.sidebar')));
    const stage = await mp.locator('article.vcard.active .vstage').boundingBox();
    assert.ok(stage.width >= 388, `stage fills width (${stage.width})`);
    await mp.screenshot({ path: path.join(ART, '10-mobile-feed.png') });
    await mp.tap('article.vcard.active .r-comment');
    await mp.waitForSelector('.drawer:not([hidden]) .comments');
    await mp.waitForTimeout(400); // let the sheet animation finish
    const sheet = await mp.locator('.drawer').boundingBox();
    const bar = await mp.locator('.tabbar').boundingBox();
    assert.ok(sheet.y + sheet.height <= bar.y + 1, 'comment sheet sits above the tab bar');
    await mp.screenshot({ path: path.join(ART, '11-mobile-comments.png') });
    await mp.goto(`${BASE}/explore`);
    await mp.waitForSelector('.tile');
    await mp.screenshot({ path: path.join(ART, '12-mobile-explore.png') });
    await m.close();
  });

  await step('no browser errors during the run', async () => {
    const real = problems.filter((p) => !/401 \(Unauthorized\)/.test(p));
    assert.deepEqual(real, []);
  });
} catch (err) {
  exitCode = 1;
  if (problems.length) console.log('\nBrowser problems:\n  ' + problems.join('\n  '));
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
  db.close();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
}
const passed = results.filter((r) => r[0] === 'PASS').length;
console.log(`\n${passed}/${results.length} e2e steps passed. Screenshots: test/artifacts/`);
process.exit(exitCode);
