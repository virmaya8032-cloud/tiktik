// Fasa 2b: the web app manifest is valid and every file it points to is served with the right size and type.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let srv;
let manifest;
before(async () => {
  srv = await startServer();
  const r = await fetch(`${srv.base}/manifest.webmanifest`);
  assert.equal(r.status, 200);
  manifest = await r.json();
});
after(() => srv.close());

/** Width and height of a PNG or JPEG from its bytes. */
function imageSize(buf) {
  if (buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  for (let i = 2; i < buf.length;) {
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
}

test('manifest has what browsers need to offer "Install app"', () => {
  for (const k of ['name', 'short_name', 'start_url', 'display', 'icons', 'theme_color', 'background_color']) assert.ok(manifest[k], k);
  assert.equal(manifest.display, 'standalone');
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192') && sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'), 'maskable icon for Android');
  assert.ok(manifest.screenshots.some((s) => s.form_factor === 'narrow') && manifest.screenshots.some((s) => s.form_factor === 'wide'));
});

test('every icon and screenshot exists with the declared size and type', async () => {
  for (const img of [...manifest.icons, ...manifest.screenshots, ...manifest.shortcuts.flatMap((s) => s.icons)]) {
    const r = await fetch(srv.base + img.src);
    assert.equal(r.status, 200, img.src);
    if (img.sizes === 'any') continue;
    if (img.type) assert.equal(r.headers.get('content-type'), img.type, img.src);
    assert.equal(imageSize(Buffer.from(await r.arrayBuffer())).join('x'), img.sizes, img.src);
  }
});

test('shortcuts point at app routes and the service worker is served from the root', async () => {
  for (const s of manifest.shortcuts) {
    const r = await fetch(srv.base + s.url);
    assert.equal(r.status, 200, s.url);
    assert.match(await r.text(), /<div id="app"/);
  }
  const sw = await fetch(`${srv.base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
});
