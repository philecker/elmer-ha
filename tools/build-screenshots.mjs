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
  // Park the pointer in the corner first. Clicking leaves the mouse where it
  // landed, and after a re-render some unrelated button can be sitting under
  // it wearing its hover state — which then ships in the screenshot as if it
  // were the normal appearance of that control.
  await page.mouse.move(0, 0);
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
// Every phone screen is captured in both themes from one sequence, so a light
// shot and its dark twin are always the same screen in the same state. They
// used to be captured separately and only Routines had a dark counterpart.
const SCREENS = [
  'routines', 'equipment', 'cards', 'parts', 'history', 'settings',
  'log-service', 'snooze', 'schedule',
];
const OWNED = [
  ...SCREENS.map((n) => `${n}.png`),
  ...SCREENS.map((n) => `${n}-dark.png`),
  'desktop.png', 'desktop-dark.png',
];
fs.mkdirSync(OUT, { recursive: true });
for (const name of OWNED) fs.rmSync(path.join(OUT, name), { force: true });

/** The same walk through the app, in whichever theme is asked for. */
async function phoneScreens(dark) {
  const suffix = dark ? '-dark' : '';
  const { ctx, page } = await open({ viewport: PHONE, dark });

  await shot(page, `routines${suffix}.png`);

  await page.click('.tab[data-value="equipment"]');
  await page.click('.row[data-id="eq1"]');
  await shot(page, `equipment${suffix}.png`);

  // The card view, on the list it suits best: equipment is scanned by its
  // glyph. Switched back straight after, so every later shot is the list the
  // panel opens on rather than whatever this left behind.
  await page.click('[data-act="back"]');
  await page.click('.viewseg button[data-value="cards"]');
  await shot(page, `cards${suffix}.png`);
  await page.click('.viewseg button[data-value="list"]');
  await page.waitForTimeout(200);

  await page.click('.tab[data-value="parts"]');
  await shot(page, `parts${suffix}.png`);

  await page.click('.tab[data-value="history"]');
  await shot(page, `history${suffix}.png`);

  await page.click('.tab[data-value="settings"]');
  await shot(page, `settings${suffix}.png`);

  // The sheet, which is where most of the typing happens.
  await page.click('.tab[data-value="routines"]');
  await page.click('.row[data-id="t1"]');
  await page.waitForSelector('.sheet');
  await shot(page, `log-service${suffix}.png`);

  // Snooze, with its durations open. Nothing is saved until one is picked, so
  // this leaves the data exactly as it found it.
  await page.click('.sheet [data-act="snooze-open"]');
  await page.waitForSelector('.sheet [data-act="snooze"]');
  await shot(page, `snooze${suffix}.png`);
  await page.click('.sheet [data-act="snooze-cancel"]');
  await page.waitForTimeout(200);

  // A routine anchored to months rather than an interval. The form is shot
  // and then cancelled, for the same reason.
  await page.click('.sheet [data-act="edit-routine"]');
  await page.waitForSelector('.sheet [data-act="pick-schedule"]');
  await page.selectOption('.sheet [data-act="pick-schedule"]', 'seasonal');
  await page.waitForSelector('.sheet .monthgrid');
  for (const month of ['month:4', 'month:10']) {
    await page.click(`.sheet .monthgrid input[name="${month}"]`);
  }
  await page.waitForTimeout(150);
  await shot(page, `schedule${suffix}.png`);
  await page.click('.sheet [data-act="close"]');
  await page.waitForTimeout(200);

  await ctx.close();
}

await phoneScreens(false);
await phoneScreens(true);

/* -------------------------------------------------------------- desktop -- */
for (const dark of [false, true]) {
  const { ctx, page } = await open({ viewport: DESKTOP, narrow: false, dark });
  await shot(page, `desktop${dark ? '-dark' : ''}.png`);
  await ctx.close();
}

await browser.close();
server.close();

for (const name of made) {
  const kb = (fs.statSync(path.join(OUT, name)).size / 1024).toFixed(0);
  console.log(`  ${name.padEnd(22)} ${kb} KB`);
}
console.log(`\n${made.length} screenshots in images/`);
