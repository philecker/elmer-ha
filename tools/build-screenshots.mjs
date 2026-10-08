// Render the screenshots the README and the HACS page show.
//
// These are committed to the repository, so they have to be reproducible rather
// than whatever happened to be on screen the day someone took them. They are
// made from the real panel driven by the sample data in tools/harness, so a
// change to the interface shows up here the next time this is run — a stale
// screenshot is a lie about the software, and the way to avoid one is to
// regenerate rather than to remember.
//
//     node tools/build-screenshots.mjs
//
// Output goes to images/, which the README links to by relative path so GitHub
// and the HACS frontend both resolve them.

import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This container ships Chromium at a fixed path; CI and a normal checkout get
// it from Playwright's own download. Preferring the env var keeps both working
// without a branch at every call site.
const CHROME = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);


const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'images');

const PHONE = { width: 420, height: 880 };
const DESKTOP = { width: 1180, height: 820 };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function serve() {
  const server = http.createServer((req, res) => {
    if (new URL(req.url, 'http://x').pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port })));
}

const { server, port } = await serve();
const base = `http://127.0.0.1:${port}/tools/harness/index.html`;

const browser = await chromium.launch({ executablePath: CHROME });
const made = [];

async function open({ viewport, dark = false, narrow = true }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}?narrow=${narrow ? 1 : 0}&dark=${dark ? 1 : 0}`);
  await page.waitForSelector('.tabs .tab');
  await page.waitForSelector('.card .row');
  return { ctx, page };
}

async function shot(page, name) {
  // Sheets and the toast animate in; a screenshot taken the instant a selector
  // appears catches them half-transparent.
  await page.waitForTimeout(350);
  const file = path.join(OUT, name);
  await page.screenshot({ path: file });
  made.push(name);
}

// Only clear the files this script owns. images/ also holds the wordmark that
// build-brand.mjs puts there, and emptying the whole folder meant running these
// two in the wrong order silently deleted it.
const OWNED = [
  'routines.png', 'equipment.png', 'parts.png', 'history.png', 'settings.png',
  'log-service.png', 'routines-dark.png', 'desktop.png', 'desktop-dark.png',
];
fs.mkdirSync(OUT, { recursive: true });
for (const name of OWNED) fs.rmSync(path.join(OUT, name), { force: true });

/* ---------------------------------------------------------------- phone -- */
{
  const { ctx, page } = await open({ viewport: PHONE });
  await shot(page, 'routines.png');

  await page.click('.tab[data-value="equipment"]');
  await page.click('.row[data-id="eq1"]');
  await shot(page, 'equipment.png');

  await page.click('[data-act="back"]');
  await page.click('.tab[data-value="parts"]');
  await shot(page, 'parts.png');

  await page.click('.tab[data-value="history"]');
  await shot(page, 'history.png');

  await page.click('.tab[data-value="settings"]');
  await shot(page, 'settings.png');

  // The sheet, which is where most of the typing happens.
  await page.click('.tab[data-value="routines"]');
  await page.click('.row[data-id="t1"]');
  await page.waitForSelector('.sheet');
  await shot(page, 'log-service.png');
  await ctx.close();
}

/* ----------------------------------------------------------------- dark -- */
{
  const { ctx, page } = await open({ viewport: PHONE, dark: true });
  await shot(page, 'routines-dark.png');
  await ctx.close();
}

/* -------------------------------------------------------------- desktop -- */
{
  const { ctx, page } = await open({ viewport: DESKTOP, narrow: false });
  await shot(page, 'desktop.png');
  await ctx.close();
}
{
  const { ctx, page } = await open({ viewport: DESKTOP, narrow: false, dark: true });
  await shot(page, 'desktop-dark.png');
  await ctx.close();
}

await browser.close();
server.close();

for (const name of made) {
  const kb = (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(0);
  console.log(`  ${name.padEnd(22)} ${kb} KB`);
}
console.log(`\n${made.length} screenshots in images/`);
