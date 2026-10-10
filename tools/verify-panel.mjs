// Drive the real panel in a real browser and assert on what it does.
//
// This is the part that catches what no amount of reading can: an event handler
// wired to the wrong action, a form that saves nothing, a tap target that is
// 30px tall on a phone, a console error on a path nobody clicked. It also
// screenshots every screen at phone and desktop width, light and dark, which is
// how the layout gets reviewed.
//
//     node tools/verify-panel.mjs
//
// Add --keep to leave the screenshots in tools/shots/.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

// This container ships Chromium at a fixed path; CI and a normal checkout get
// it from Playwright's own download. Preferring the env var keeps both working
// without a branch at every call site.
const CHROME = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);


const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SHOTS = path.join(HERE, 'shots');
const TMP = path.join(HERE, 'shots', '.fixtures');

const fails = [];
let checks = 0;

function check(label, got, want) {
  checks += 1;
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a !== b) fails.push(`${label}\n    got  ${a}\n    want ${b}`);
}

function ok(label, condition, detail = '') {
  checks += 1;
  if (!condition) fails.push(`${label}${detail ? `\n    ${detail}` : ''}`);
}

// Holds the live page so a failure can photograph it.
const CURRENT = { page: null };

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css; charset=utf-8',
};

/** Serve the repo so the panel's ES module imports resolve as they will in HA. */
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // Chromium asks for this unprompted on every navigation. Answering it keeps
    // the request out of the console-error assertion, where it would otherwise
    // look like a missing panel file.
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const PHONE = { width: 390, height: 844 };     // iPhone 14/15
const DESKTOP = { width: 1280, height: 900 };

/**
 * A computed colour as three 0–255 channels.
 *
 * Not every colour comes back as `rgb(…)`. Anything mixed with color-mix()
 * computes to `color(srgb 0.81 0.81 0.81)`, whose channels run 0–1 — read as
 * bytes they look like near-black, which is how a perfectly good border once
 * measured 20:1 against white and failed a test that was itself the thing
 * broken. Normalise before doing arithmetic on a colour.
 */
function parseColor(css) {
  const fn = css.match(/^color\(\s*([\w-]+)\s+([^)]*)\)/);
  if (fn) {
    // Drop the colorspace by name rather than by counting numbers: it may well
    // contain a digit of its own (display-p3), and srgb contains none at all,
    // so there is no fixed offset to skip.
    const n = (fn[2].match(/-?[\d.]+/g) || []).map(Number);
    return n.slice(0, 3).map((v) => v * 255);
  }
  return (css.match(/-?[\d.]+/g) || []).map(Number).slice(0, 3);
}

function luminance(css) {
  const [r, g, b] = parseColor(css).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 1000) / 1000;
}

async function main() {
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}/tools/harness/index.html`;

  const browser = await chromium.launch({ executablePath: CHROME });
  const errors = [];

  async function open({ narrow = false, dark = false, viewport = PHONE } = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    // A 404 reaches the console without its URL, which makes it useless as a
    // failure report. Record what was actually asked for.
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
    });
    const q = `?narrow=${narrow ? 1 : 0}&dark=${dark ? 1 : 0}`;
    await page.goto(base + q);
    await page.waitForFunction('window.__ready === true');
    // The first snapshot arrives on a timeout, so wait for real content.
    await page.waitForSelector('.tabs .tab');
    CURRENT.page = page;
    return { ctx, page };
  }

  // Playwright's CSS engine pierces open shadow roots, so a plain selector
  // reaches inside the panel. Kept as a function so the intent stays readable.
  const el = (sel) => sel;

  // Sheets and toasts animate in over ~220ms. Screenshotting the instant a
  // selector appears catches them half-transparent, which reads as a rendering
  // bug in the review and isn't one.
  const shot = async (p, name) => {
    await p.waitForTimeout(330);
    await p.screenshot({ path: path.join(SHOTS, name) });
  };
  fs.rmSync(SHOTS, { recursive: true, force: true });
  fs.mkdirSync(SHOTS, { recursive: true });

  /* ---------------------------------------------------- phone, light ---- */
  let { ctx, page } = await open({ narrow: true, viewport: PHONE });

  // --- the list paints, sorted by urgency ------------------------------
  const titles = await page.$$eval(el('.card .row .title'), (n) => n.map((x) => x.textContent.trim()));
  ok('routines render', titles.length >= 8, `saw ${titles.length}`);
  check('most overdue first', titles[0], 'Professional Service');

  const counts = await page.evaluate(() => window.__snapshot().computed.counts);
  // Each filter pill carries its own count; there is no separate tile strip.
  const pillCounts = await page.$$eval(el('.pill'), (nodes) => nodes.map((n) => ({
    tone: n.dataset.tone,
    n: Number(n.querySelector('.n').textContent),
  })));
  check('every filter carries its count', pillCounts, [
    { tone: 'all', n: counts.overdue + counts.due + counts.ok + counts.new },
    { tone: 'overdue', n: counts.overdue },
    { tone: 'due', n: counts.due },
    { tone: 'new', n: counts.new },
    { tone: 'ok', n: counts.ok },
  ]);
  check('the counting tiles are gone', await page.$$eval(el('.stat'), (n) => n.length), 0);

  // Five equal buttons filling the measure — not a ragged row that scrolls.
  const pillWidths = await page.$$eval(el('.pill'), (n) =>
    n.map((x) => Math.round(x.getBoundingClientRect().width)));
  check('every filter button is the same width', [...new Set(pillWidths)].length, 1);
  const fills = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const row = root.querySelector('.pills').getBoundingClientRect();
    const first = root.querySelector('.pill').getBoundingClientRect();
    const last = [...root.querySelectorAll('.pill')].pop().getBoundingClientRect();
    return [Math.round(first.left - row.left), Math.round(last.right - row.right)];
  });
  check('the filter row fills its width', fills, [0, 0]);

  // Each button is tinted by what it counts, so the control says the same thing
  // as the figure inside it.
  const tints = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const out = {};
    for (const p of root.querySelectorAll('.pill')) {
      out[p.dataset.tone] = getComputedStyle(p.querySelector('.n')).color;
    }
    return out;
  });
  ok('overdue, due and up-to-date are each a different colour',
    new Set([tints.overdue, tints.due, tints.ok]).size === 3, JSON.stringify(tints));
  check('a zero is not painted as an alarm', tints.overdue === tints.new, false);

  // --- grouped by state, and searchable ---------------------------------
  // The "needs attention" banner is gone: it restated the Overdue pill and
  // filtered to the same thing when tapped. A search box is the one thing the
  // pills cannot do.
  check('the banner is gone', await page.$(el('.alert')), null);
  ok('and a search box is there', await page.$(el('.search input[data-act="search"]')) !== null);

  // Unfiltered, the list is grouped by state, worst first, each heading
  // carrying its own tally.
  const grouped = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    return [...root.querySelectorAll('.pad > .label')].map((l) => ({
      label: l.firstChild.textContent.trim(),
      count: Number(l.querySelector('.count').textContent),
      rows: l.nextElementSibling.querySelectorAll('.row').length,
    }));
  });
  check('groups run worst first', grouped.map((g) => g.label),
    ['Overdue', 'Due soon', 'Never done', 'Up to date']);
  ok('every heading counts its own group',
    grouped.every((g) => g.count === g.rows), JSON.stringify(grouped));
  check('and together they are every routine',
    grouped.reduce((n, g) => n + g.rows, 0), counts.overdue + counts.due + counts.new + counts.ok);
  check('the overdue group matches the pill', grouped[0].count, counts.overdue);

  // Typing filters the list. Each keystroke re-renders, which replaces the
  // input the keystroke came from, so the caret has to be put back or the box
  // drops focus after one letter and the rest goes nowhere.
  await page.click(el('.search input'));
  await page.type(el('.search input'), 'furnace', { delay: 30 });
  await page.waitForTimeout(160);
  const searched = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const box = root.querySelector('.search input');
    return {
      value: box.value,
      focused: root.activeElement === box,
      caret: box.selectionStart,
      titles: [...root.querySelectorAll('.row .title')].map((t) => t.textContent.trim()),
      groups: [...root.querySelectorAll('.pad > .label')].map((l) => l.firstChild.textContent.trim()),
    };
  });
  check('the whole word arrives', searched.value, 'furnace');
  ok('the box still has focus after typing', searched.focused);
  check('with the caret at the end', searched.caret, 7);
  ok('the list is narrowed', searched.titles.length > 0
    && searched.titles.length < counts.overdue + counts.due + counts.new + counts.ok,
    JSON.stringify(searched.titles));
  ok('to things that match somewhere', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    return [...root.querySelectorAll('.row')].every(
      (r) => r.textContent.toLowerCase().includes('furnace'));
  }));
  ok('and the groups shrink to what is left',
    searched.groups.length > 0 && searched.groups.length <= 4, JSON.stringify(searched.groups));

  // Equipment and location are searchable too, not just the routine's name.
  await page.fill(el('.search input'), 'basement');
  await page.waitForTimeout(160);
  ok('a location finds its routines', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const rows = [...root.querySelectorAll('.row')];
    return rows.length > 0 && rows.every((r) => r.textContent.toLowerCase().includes('basement'));
  }));

  // Nothing matching says so rather than showing an empty page.
  await page.fill(el('.search input'), 'zzzznothing');
  await page.waitForTimeout(160);
  check('a search with no matches explains itself',
    await page.textContent(el('.empty h3')), 'Nothing matches that');
  check('and no rows are left', (await page.$$(el('.row'))).length, 0);

  // Clearing puts everything back and hands focus to the box.
  await page.click(el('.search .clear'));
  await page.waitForTimeout(160);
  const cleared = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const box = root.querySelector('.search input');
    return {
      value: box.value,
      focused: root.activeElement === box,
      clearGone: !root.querySelector('.search .clear'),
      groups: [...root.querySelectorAll('.pad > .label')].map((l) => l.firstChild.textContent.trim()),
    };
  });
  check('clearing empties the box', cleared.value, '');
  ok('and leaves focus in it', cleared.focused);
  ok('the clear button goes when there is nothing to clear', cleared.clearGone);
  check('and every group is back', cleared.groups,
    ['Overdue', 'Due soon', 'Never done', 'Up to date']);

  // Narrowing with a pill leaves one group, so a heading would only repeat the
  // pill; the list goes flat instead.
  await page.click(el('.pill[data-value="overdue"]'));
  await page.waitForTimeout(140);
  check('a filtered list drops the headings',
    (await page.$$(el('.pad > .label'))).length, 0);
  check('and shows only that state',
    (await page.$$(el('.row'))).length, counts.overdue);
  await page.click(el('.pill[data-value="overdue"]'));
  await page.waitForTimeout(140);
  check('and the headings come back', (await page.$$(el('.pad > .label'))).length, 4);

  // --- every row is the same height -------------------------------------
  // A relative time that wraps to a second line makes its row taller than its
  // neighbours, which is what the list looks wrong about before you can say why.
  const heights = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    return [...root.querySelectorAll('.card .row')].map((r) => Math.round(r.getBoundingClientRect().height));
  });
  check('rows are a uniform height', [...new Set(heights)].length, 1);

  // --- tap targets clear 44px on a phone --------------------------------
  const small = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const out = [];
    for (const b of root.querySelectorAll('button, [role="button"]')) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // 34px controls sit inside a 60px row, which is the real target.
      const row = b.closest('.row');
      const h = row ? Math.max(r.height, row.getBoundingClientRect().height) : r.height;
      if (h < 36 || r.width < 30) out.push(`${b.className || b.tagName} ${Math.round(r.width)}x${Math.round(h)}`);
    }
    return out;
  });
  check('no undersized tap targets on a phone', small, []);

  // --- nothing overflows sideways ---------------------------------------
  const overflow = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const app = root.querySelector('.app');
    return app.scrollWidth - app.clientWidth;
  });
  check('no horizontal overflow on a phone', overflow, 0);

  // --- the chrome is in the same place on every screen -------------------
  // This is the thing the layout is built around: a header and one tab row that
  // do not move as you navigate. Measuring every tab is what keeps it true.
  const chrome = [];
  for (const tab of ['routines', 'equipment', 'parts', 'history', 'settings']) {
    await page.click(el(`.tab[data-value="${tab}"]`));
    await page.waitForTimeout(60);
    chrome.push(await page.evaluate(() => {
      const root = document.querySelector('elmer-panel').shadowRoot;
      const box = (sel) => {
        const n = root.querySelector(sel);
        if (!n) return null;
        const r = n.getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.left), Math.round(r.height)];
      };
      return { header: box('.header'), tabs: box('.tabs'), main: box('.main') };
    }));
  }
  check('header, tabs and content never move between screens',
    chrome.filter((c) => JSON.stringify(c) !== JSON.stringify(chrome[0])).length, 0);

  // The add button says what it adds. That is what lets one control change its
  // action per screen without becoming a trap — "Add Routine" and "Add
  // Equipment" do not look like the same button.
  const addLabels = {};
  for (const tab of ['routines', 'equipment', 'parts', 'history', 'settings']) {
    await page.click(el(`.tab[data-value="${tab}"]`));
    await page.waitForTimeout(60);
    addLabels[tab] = await page.textContent(el('.addbtn')).catch(() => null);
  }
  check('the add button names what it adds', addLabels, {
    routines: 'Add Routine',
    equipment: 'Add Equipment',
    parts: 'Add Part',
    history: null,
    settings: null,
  });

  // --- buttons stay inside their card -----------------------------------
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForSelector(el('.addbtn[data-act="add-equipment"]'));
  const inside = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const pad = root.querySelector('.pad').getBoundingClientRect();
    return [...root.querySelectorAll('.btn')].every((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= pad.left - 0.5 && r.right <= pad.right + 0.5;
    });
  });
  ok('buttons never extend past the content', inside);

  await shot(page, 'phone-equipment.png');

  // --- the hamburger asks HA to open its sidebar ------------------------
  await page.click(el('.tab[data-value="routines"]'));
  await page.click(el('[data-act="menu"]'));
  check('hamburger opens the HA menu', await page.evaluate(() => window.__menuToggles), 1);

  await shot(page, 'phone-routines.png');

  // --- filters ----------------------------------------------------------
  await page.click(el('.pill[data-act="filter"][data-value="overdue"]'));
  await page.waitForTimeout(40);
  const overdueRows = await page.$$eval(el('.card .row .title'), (n) => n.length);
  check('overdue filter narrows the list', overdueRows, counts.overdue);
  // Tapping the active filter again clears it.
  await page.click(el('.pill[data-value="overdue"]'));
  await page.waitForTimeout(40);
  check('tapping the active filter clears it',
    await page.$$eval(el('.card .row .title'), (n) => n.length), titles.length);

  // --- completing a routine draws down stock ----------------------------
  const before = await page.evaluate(() => {
    const s = window.__snapshot();
    return {
      qty: s.supplies.find((x) => x.id === 's1').quantity,
      lastDone: s.tasks.find((t) => t.id === 't1').lastDone,
      log: s.log.length,
    };
  });
  // The furnace filter uses one 20x25x1.
  await page.click(el('.row[data-id="t1"] [data-act="complete"]'));
  await page.waitForSelector(el('.toast'));
  const toast = await page.textContent(el('.toast span'));
  ok('toast names what was done', /Furnace Filter/i.test(toast), toast);
  ok('toast offers an undo', await page.$(el('.toast button[data-act="undo"]')) !== null);

  // The toast inverts its background, which is exactly where an accent colour
  // picked for the normal surface stops being readable.
  const contrast = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = (rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (fg, bg) => {
      const a = lum(parse(fg));
      const b = lum(parse(bg));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };
    const el2 = root.querySelector('.toast button');
    const bg = getComputedStyle(root.querySelector('.toast')).backgroundColor;
    return Math.round(ratio(getComputedStyle(el2).color, bg) * 10) / 10;
  });
  ok('the undo in the toast is readable', contrast >= 4.5, `contrast ${contrast}:1`);

  const after = await page.evaluate(() => {
    const s = window.__snapshot();
    return {
      qty: s.supplies.find((x) => x.id === 's1').quantity,
      lastDone: s.tasks.find((t) => t.id === 't1').lastDone,
      log: s.log.length,
    };
  });
  check('stock drew down by one', after.qty, before.qty - 1);
  check('lastDone moved to today', after.lastDone, await page.evaluate(() => window.__snapshot().computed.today));
  check('history gained an entry', after.log, before.log + 1);
  ok('lastDone actually changed', after.lastDone !== before.lastDone);

  // --- undo puts it back exactly -----------------------------------------
  await page.click(el('.toast button[data-act="undo"]'));
  await page.waitForTimeout(80);
  const undone = await page.evaluate(() => {
    const s = window.__snapshot();
    return {
      qty: s.supplies.find((x) => x.id === 's1').quantity,
      lastDone: s.tasks.find((t) => t.id === 't1').lastDone,
      log: s.log.length,
    };
  });
  check('undo restores the stock', undone.qty, before.qty);
  check('undo restores the date', undone.lastDone, before.lastDone);
  check('undo removes the entry', undone.log, before.log);

  // --- a double tap cannot log twice -------------------------------------
  const logBefore = await page.evaluate(() => window.__snapshot().log.length);
  await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const b = root.querySelector('.row[data-id="t2"] [data-act="complete"]');
    b.click(); b.click(); b.click();
  });
  await page.waitForTimeout(220);
  check('a double tap logs once', await page.evaluate(() => window.__snapshot().log.length), logBefore + 1);

  // --- a routine that takes more than you have ---------------------------
  // The fridge filter needs one LT1000P and there are none on the shelf.
  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(40);
  await page.click(el('.row[data-id="t4"] [data-act="complete"]'));
  await page.waitForTimeout(160);
  const outOfStock = await page.evaluate(() => {
    const s = window.__snapshot();
    const entry = s.log.find((l) => l.taskId === 't4');
    return { qty: s.supplies.find((x) => x.id === 's2').quantity, used: entry.usedParts };
  });
  check('an empty shelf stays at zero', outOfStock.qty, 0);
  check('nothing is recorded as taken', outOfStock.used, []);

  // --- the routine sheet -------------------------------------------------
  await page.click(el('.row[data-id="t6"]'));
  await page.waitForSelector(el('.sheet'));
  ok('sheet titles itself with the routine',
    (await page.textContent(el('.sheet h2'))).includes('Add Salt'));
  await shot(page, 'phone-routine-sheet.png');
  // Escape closes it.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(60);
  check('escape closes the sheet', await page.$(el('.sheet')), null);

  // --- logging a service with detail -------------------------------------
  await page.click(el('.row[data-id="t6"]'));
  await page.waitForSelector(el('.sheet'));
  await page.fill(el('.sheet input[name="cost"]'), '12.99');
  await page.fill(el('.sheet input[name="notes"]'), 'Two bags, topped to the line.');
  await page.fill(el('.sheet input[name="part:s3"]'), '2');
  await page.click(el('.sheet [data-act="save-log"]'));
  await page.waitForTimeout(180);
  const logged = await page.evaluate(() => {
    const s = window.__snapshot();
    const e = s.log.find((l) => l.taskId === 't6');
    return { cost: e.cost, notes: e.notes, used: e.usedParts, salt: s.supplies.find((x) => x.id === 's3').quantity };
  });
  check('cost recorded', logged.cost, '12.99');
  check('notes recorded', logged.notes, 'Two bags, topped to the line.');
  check('two bags taken', logged.used, [{ supplyId: 's3', quantity: 2 }]);
  check('salt drew down by two', logged.salt, 0);

  // --- a re-render must not throw away what you are typing ---------------
  // The panel rebuilds its markup on every render, and renders happen for
  // reasons that have nothing to do with the form: a toast expiring, another
  // browser saving a change. If the open sheet were rebuilt with them, half a
  // filled-in form would vanish under the person's hands.
  await page.click(el('.tab[data-value="equipment"]'));
  await page.click(el('.addbtn[data-act="add-equipment"]'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  await page.fill(el('.sheet input[name="name"]'), 'Half typed name');
  await page.fill(el('.sheet textarea[name="notes"]'), 'and a note in progress');
  await page.evaluate(() => {
    // A change arriving from elsewhere, which pushes a fresh snapshot.
    const p = document.querySelector('elmer-panel');
    return p.hass.connection.sendMessagePromise({
      type: 'elmer/apply',
      ops: [{ kind: 'part.adjust', payload: { id: 's4', delta: 1 } }],
    });
  });
  await page.waitForTimeout(250);
  // Title-cased, because moving to the notes field blurred the name — that is
  // the capitalisation working, not the value being lost.
  check('an outside change does not clear the open form',
    await page.inputValue(el('.sheet input[name="name"]')), 'Half Typed Name');
  check('nor the notes field',
    await page.inputValue(el('.sheet textarea[name="notes"]')), 'and a note in progress');
  ok('and the sheet is still the one you opened',
    (await page.textContent(el('.sheet h2'))) === 'Add equipment');
  await page.click(el('.sheet [data-act="close"]'));
  await page.waitForTimeout(60);

  // --- adding equipment, then its suggested routines ---------------------
  await page.click(el('.tab[data-value="equipment"]'));
  await page.click(el('.addbtn[data-act="add-equipment"]'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  await page.fill(el('.sheet input[name="name"]'), 'water heater');
  // Locations already exist in this data, so the field is a list of them with
  // an escape hatch — not a free text box.
  ok('known locations are offered',
    await page.$(el('.sheet select[name="locationPick"]')) !== null);
  const offeredLocations = await page.$$eval(el('.sheet select[name="locationPick"] option'),
    (n) => n.map((o) => o.value));
  check('the list is the locations in use, plus a way to add one',
    offeredLocations, ['', 'Basement', 'Garage', 'Hallway', 'Kitchen', '__new__']);
  ok('and the new-location box is out of the way until asked for',
    await page.isVisible(el('.sheet input[name="locationNew"]')) === false);

  await page.selectOption(el('.sheet select[name="locationPick"]'), '__new__');
  await page.waitForTimeout(80);
  ok('choosing to add one reveals the box',
    await page.isVisible(el('.sheet input[name="locationNew"]')));
  await page.fill(el('.sheet input[name="locationNew"]'), 'basement');
  await page.selectOption(el('.sheet select[name="category"]'), 'water');
  // Blur is what capitalises, so move focus the way a person would.
  await page.click(el('.sheet input[name="brand"]'));
  await page.waitForTimeout(30);
  check('name capitalised on blur',
    await page.inputValue(el('.sheet input[name="name"]')), 'Water Heater');
  check('location capitalised on blur',
    await page.inputValue(el('.sheet input[name="locationNew"]')), 'Basement');

  // No control may be wider than the field holding it, and no field wider than
  // the form. A date input is the one that breaks this — iOS gives it an
  // intrinsic width and ignores width:100% — but the check is general, because
  // the next one will be some other control with a mind of its own.
  const spill = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const inner = root.querySelector('.sheet .inner').getBoundingClientRect();
    const out = [];
    for (const field of root.querySelectorAll('.sheet .field')) {
      const fb = field.getBoundingClientRect();
      if (fb.right > inner.right + 1 || fb.left < inner.left - 1) {
        out.push(`field ${field.querySelector('label') ? field.querySelector('label').textContent : '?'}`);
      }
      for (const control of field.querySelectorAll('input, select, textarea')) {
        const cb = control.getBoundingClientRect();
        if (cb.width === 0) continue;
        if (cb.right > fb.right + 1 || cb.left < fb.left - 1) {
          out.push(`${control.type || control.tagName} in ${field.querySelector('label') ? field.querySelector('label').textContent : '?'}`);
        }
      }
    }
    return out;
  });
  check('nothing in the form is wider than what holds it', spill, []);
  ok('a date gets a row to itself on a phone', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const date = root.querySelector('.sheet input[type="date"]');
    if (!date) return true;
    const row = date.closest('.two');
    return !row || getComputedStyle(row).gridTemplateColumns.split(' ').length === 1;
  }));

  await page.click(el('.sheet [data-act="pick-icon"][data-value="waterheater"]'));
  await shot(page, 'phone-equipment-form.png');
  await page.click(el('.sheet [data-act="save-equipment"]'));
  await page.waitForSelector(el('.sheet [data-act="save-templates"]'));

  const saved = await page.evaluate(() => window.__snapshot().equipment.find((e) => e.name === 'Water Heater'));
  ok('equipment saved', Boolean(saved));
  check('icon saved', saved.icon, 'waterheater');
  check('category saved', saved.category, 'water');

  await shot(page, 'phone-templates.png');
  await page.click(el('.sheet [data-act="save-templates"]'));
  await page.waitForTimeout(180);
  const withRoutines = await page.evaluate(() => {
    const s = window.__snapshot();
    const eq = s.equipment.find((e) => e.name === 'Water Heater');
    return s.tasks.filter((t) => t.equipmentId === eq.id).map((t) => t.name);
  });
  check('suggested routines added', withRoutines,
    ['Replace filter cartridge', 'Flush tank / sediment drain', 'Check anode rod']);
  ok('landed on the equipment detail', await page.$(el('[data-act="edit-equipment"]')) !== null);
  await shot(page, 'phone-equipment-detail.png');

  // --- the sheet must not cut its own content off -----------------------
  // The overlay is anchored to the viewport, not to the panel. When it was
  // anchored to the panel the sheet's max-height was a percentage of an element
  // that is shorter than the window inside Home Assistant, and the buttons at
  // the foot of every form ended up below the fold.
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(60);
  await page.click(el('.row[data-id="eq1"]'));
  await page.waitForTimeout(60);
  await page.click(el('[data-act="edit-equipment"]'));
  await page.waitForSelector(el('.sheet'));
  await page.waitForTimeout(350);
  const sheetFit = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const scrim = root.querySelector('.scrim').getBoundingClientRect();
    const sheet = root.querySelector('.sheet').getBoundingClientRect();
    const save = root.querySelector('.sheet [data-act="save-equipment"]').getBoundingClientRect();
    return {
      scrimCoversWindow: Math.round(scrim.height - window.innerHeight),
      sheetShare: sheet.height / window.innerHeight,
      saveVisible: save.bottom <= sheet.bottom + 1 && save.top >= sheet.top - 1,
      saveInWindow: save.bottom <= window.innerHeight + 1,
    };
  });
  check('the overlay covers the window', sheetFit.scrimCoversWindow, 0);
  // The border is 2px in every theme but a different grey in each: it is
  // matched on contrast against the sheet rather than on lightness, so it
  // carries the same weight on white as on near-black. Asserting the ratio
  // rather than the hex is the only way to say that — and it has to hold
  // against Home Assistant's own surfaces, not only Elmer's fallbacks, which
  // is what a hardcoded grey quietly failed to do.
  const borderWeight = await page.evaluate(() => {
    const cs = getComputedStyle(
      document.querySelector('elmer-panel').shadowRoot.querySelector('.sheet'));
    return { width: cs.borderTopWidth, style: cs.borderTopStyle,
      edge: cs.borderTopColor, face: cs.backgroundColor };
  });
  check('the modal is bordered', [borderWeight.width, borderWeight.style], ['2px', 'solid']);
  const weight = contrastRatio(borderWeight.edge, borderWeight.face);
  ok('and the border carries the same weight as it does on the other theme',
    Math.abs(weight - 1.47) < 0.06, `${weight}:1`);
  ok('the sheet uses most of the height available',
    sheetFit.sheetShare > 0.5, `${(sheetFit.sheetShare * 100).toFixed(0)}%`);
  ok('the save button is inside the sheet without scrolling', sheetFit.saveVisible);
  ok('and on screen', sheetFit.saveInWindow);

  // A toast about the previous action must not be left sitting on the form's
  // buttons, and one raised while the form is open must move clear of them.
  check('opening a form clears a stale toast',
    await page.$(el('.toast')), null);
  await page.click(el('.sheet [data-act="close"]'));
  await page.waitForTimeout(80);

  // --- a routine only lists the parts it uses ---------------------------
  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(60);
  await page.click(el('.row[data-id="t1"]'));
  await page.waitForSelector(el('.sheet'));
  await page.click(el('.sheet [data-act="edit-routine"]'));
  await page.waitForSelector(el('.sheet .partlist'));
  const partsAtOpen = await page.$$eval(el('.sheet .partrow'), (n) => n.map((r) => r.dataset.part));
  check('only the parts the routine uses are listed', partsAtOpen, ['s1']);
  const offered = await page.$$eval(el('.sheet select[data-act="pick-part"] option'),
    (n) => n.map((o) => o.value).filter(Boolean));
  ok('the picker offers the rest', offered.length === 3 && !offered.includes('s1'),
    JSON.stringify(offered));

  // What you added belongs under the control that added it, with room around it
  // — otherwise picking a part scrolls the thing you just chose off the top.
  ok('the picker comes before the list it fills', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const picker = root.querySelector('.sheet select[data-act="pick-part"]');
    const list = root.querySelector('.sheet .partlist');
    return (picker.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  }));
  const partSpacing = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const rows = [...root.querySelectorAll('.sheet .partrow')];
    const cs = getComputedStyle(rows[0]);
    return {
      gapFromPicker: Math.round(rows[0].getBoundingClientRect().top
        - root.querySelector('.sheet select[data-act="pick-part"]').getBoundingClientRect().bottom),
      bordered: cs.borderTopWidth !== '0px',
      rounded: parseFloat(cs.borderTopLeftRadius) > 0,
      noInline: rows.every((r) => !r.getAttribute('style')),
    };
  });
  ok('an added part is clear of the picker', partSpacing.gapFromPicker >= 20,
    `${partSpacing.gapFromPicker}px`);
  ok('and reads as its own card', partSpacing.bordered && partSpacing.rounded);
  ok('with its look in the stylesheet, not inline', partSpacing.noInline);

  // Every/Unit sit side by side, so the two boxes have to be the same box.
  // A native select on iOS keeps an intrinsic height of its own and ignores
  // min-height, which left UNIT a few pixels shorter than the input beside it.
  const pairs = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const out = [];
    for (const row of root.querySelectorAll('.sheet .two')) {
      const controls = [...row.querySelectorAll('input, select')]
        .map((c) => ({
          tag: c.tagName.toLowerCase(),
          h: Math.round(c.getBoundingClientRect().height * 10) / 10,
          top: Math.round(c.getBoundingClientRect().top * 10) / 10,
          fixed: getComputedStyle(c).height !== 'auto',
        }));
      if (controls.length === 2) out.push(controls);
    }
    return out;
  });
  ok('a side-by-side pair was found', pairs.length > 0);
  for (const [a, b] of pairs) {
    ok(`a ${a.tag} and a ${b.tag} beside it are the same height`,
      a.h === b.h, `${a.h} vs ${b.h}`);
    ok('and sit on the same line', a.top === b.top, `${a.top} vs ${b.top}`);
    ok('because the height is set, not merely floored', a.fixed && b.fixed);
  }

  // Adding one appends a row and takes it out of the picker.
  await page.selectOption(el('.sheet select[data-act="pick-part"]'), 's4');
  await page.waitForTimeout(80);
  check('picking a part adds it',
    await page.$$eval(el('.sheet .partrow'), (n) => n.map((r) => r.dataset.part)), ['s1', 's4']);
  check('and it leaves the picker',
    await page.$$eval(el('.sheet select[data-act="pick-part"] option'),
      (n) => n.map((o) => o.value).filter(Boolean)).then((v) => v.includes('s4')), false);
  check('a new part starts at one',
    await page.inputValue(el('.sheet input[name="part:s4"]')), '1');

  // Removing one puts it back.
  await page.click(el('.sheet .partrow[data-part="s1"] [data-act="unpick-part"]'));
  await page.waitForTimeout(80);
  check('removing a part drops the row',
    await page.$$eval(el('.sheet .partrow'), (n) => n.map((r) => r.dataset.part)), ['s4']);
  check('and returns it to the picker',
    await page.$$eval(el('.sheet select[data-act="pick-part"] option'),
      (n) => n.map((o) => o.value).filter(Boolean)).then((v) => v.includes('s1')), true);

  await page.fill(el('.sheet input[name="part:s4"]'), '2');
  await page.click(el('.sheet [data-act="save-routine"]'));
  await page.waitForTimeout(200);
  check('the saved routine uses exactly what was listed',
    await page.evaluate(() => window.__snapshot().tasks.find((t) => t.id === 't1').partsUsed),
    [{ supplyId: 's4', quantity: 2 }]);

  // --- the chrome does not change on a detail page ----------------------
  // The header used to turn into a back arrow and the thing's name, so the one
  // fixed point in the panel disappeared exactly when you had navigated away
  // from the list. The mark stays; the way back is a breadcrumb at the top of
  // the content, where the list's search box sits.
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(60);
  const listChrome = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const s2 = root.querySelector('.search');
    return {
      word: root.querySelector('.header .brand .word').textContent.trim(),
      searchTop: s2 ? Math.round(s2.getBoundingClientRect().top) : null,
      searchLeft: s2 ? Math.round(s2.getBoundingClientRect().left) : null,
    };
  });
  await page.click(el('.row[data-id="eq1"]'));
  await page.waitForTimeout(80);
  const detailChrome = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const c = root.querySelector('.crumb');
    const card = root.querySelector('.card');
    return {
      word: root.querySelector('.header .brand .word').textContent.trim(),
      hasMark: !!root.querySelector('.header .brand .ic'),
      crumbTop: Math.round(c.getBoundingClientRect().top),
      // The section's label leads the trail now, so that is what should land
      // on the content's edge; the button's own padding is cancelled out.
      upLeft: Math.round(c.querySelector('.up').getBoundingClientRect().left
        + parseFloat(getComputedStyle(c.querySelector('.up')).paddingLeft)),
      cardLeft: Math.round(card.getBoundingClientRect().left),
      // One chevron, between the two, pointing back at the section.
      chevrons: c.querySelectorAll('.ic').length,
      chevronPath: c.querySelector('.ic path').getAttribute('d'),
      upTone: getComputedStyle(c.querySelector('.up')).color,
      hereTone: getComputedStyle(c.querySelector('.here')).color,
      paper: getComputedStyle(root.querySelector('.app')).backgroundColor,
      up: c.querySelector('.up').textContent.trim(),
      here: c.querySelector('.here').textContent.trim(),
      aboveEverything: c.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
      noSearch: !root.querySelector('.search'),
    };
  });
  check('the header still says ELMER on a detail page', detailChrome.word, listChrome.word);
  ok('and still carries the mark', detailChrome.hasMark);
  check('the breadcrumb names where it came from', detailChrome.up, 'Equipment');
  check('and where you are', detailChrome.here, 'Furnace / Air Conditioner');
  ok('it is the first thing in the content', detailChrome.aboveEverything !== 0);
  ok('a detail page has no search box of its own', detailChrome.noSearch);
  check('the crumb sits exactly where the search box sat',
    detailChrome.crumbTop, listChrome.searchTop);
  check('and the section lands on the content edge',
    detailChrome.upLeft - detailChrome.cardLeft, 0);
  check('there is one chevron, not two', detailChrome.chevrons, 1);
  ok('the section stands out more than the page you are on',
    contrastRatio(detailChrome.upTone, detailChrome.paper)
      > contrastRatio(detailChrome.hereTone, detailChrome.paper),
    `${contrastRatio(detailChrome.upTone, detailChrome.paper)}:1 vs `
      + `${contrastRatio(detailChrome.hereTone, detailChrome.paper)}:1`);
  check('and it points back at the section', detailChrome.chevronPath, 'M15 5l-7 7 7 7');
  // The section is the only thing here you can act on, so it carries the
  // weight; the page you are already on is the quiet half. Stated as contrast
  // against the page rather than as "darker", which is only true on a light
  // theme — on a dark one the stronger colour is the lighter of the two.
  await page.click(el('.crumb .up'));
  await page.waitForTimeout(80);
  ok('and it goes back', await page.$(el('.search')) !== null);

  // --- editing equipment must not drop its links ------------------------
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(60);
  await page.click(el('.row[data-id="eq1"]'));
  await page.waitForTimeout(40);
  const linksBefore = await page.evaluate(() => window.__snapshot().equipment.find((e) => e.id === 'eq1').parts.length);
  await page.click(el('[data-act="edit-equipment"]'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  await page.fill(el('.sheet input[name="brand"]'), 'Trane XE');
  await page.click(el('.sheet [data-act="save-equipment"]'));
  await page.waitForTimeout(180);
  const edited = await page.evaluate(() => window.__snapshot().equipment.find((e) => e.id === 'eq1'));
  check('edit kept the replacement-part links', edited.parts.length, linksBefore);
  check('edit saved the change', edited.brand, 'Trane XE');
  check('edit kept the serial', edited.serial, '12345A / 67890B');

  // --- parts ------------------------------------------------------------
  await page.click(el('.tab[data-value="parts"]'));
  await page.waitForSelector(el('.qty'));
  // Out of stock sorts to the top.
  check('out of stock first',
    await page.textContent(el('.card .row .title')), 'LG LT1000P');
  const q0 = await page.evaluate(() => window.__snapshot().supplies.find((s) => s.id === 's1').quantity);
  await page.click(el('.row[data-id="s1"] [data-act="stock"][data-delta="1"]'));
  await page.waitForTimeout(90);
  check('stepper adds one',
    await page.evaluate(() => window.__snapshot().supplies.find((s) => s.id === 's1').quantity), q0 + 1);
  await page.click(el('.row[data-id="s2"] [data-act="stock"][data-delta="-1"]'));
  await page.waitForTimeout(90);
  check('stepper will not go below zero',
    await page.evaluate(() => window.__snapshot().supplies.find((s) => s.id === 's2').quantity), 0);
  await shot(page, 'phone-parts.png');

  // --- a part opens a page, the way a piece of equipment does -----------
  // It used to go straight into the edit form, which is the one thing you
  // cannot do from a form: look at it.
  check('the parts list no longer counts the reorders for you',
    await page.$(el('.alert')), null);
  await page.click(el('.row[data-id="s1"] .title'));
  await page.waitForTimeout(100);
  const partPage = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const c = root.querySelector('.crumb');
    return {
      sheet: !!root.querySelector('.sheet'),
      up: c && c.querySelector('.up').textContent.trim(),
      here: c && c.querySelector('.here').textContent.trim(),
      labels: [...root.querySelectorAll('.pad > .label')].map((l) => l.textContent.trim()),
      hasStepper: !!root.querySelector('.stockrow .stepper'),
      canEdit: !!root.querySelector('[data-act="edit-part"]'),
      canDelete: !!root.querySelector('[data-act="delete-part"]'),
      word: root.querySelector('.header .brand .word').textContent.trim(),
    };
  });
  ok('tapping a part no longer throws you into a form', !partPage.sheet);
  check('it opens a page under Parts', partPage.up, 'Parts');
  check('named for the part', partPage.here, '20x25x1 MERV 11');
  ok('the header is unchanged there too', partPage.word === 'ELMER');
  ok('the page lists what uses it', partPage.labels.includes('Used by'));
  ok('stock can be changed from it', partPage.hasStepper);
  ok('and it offers edit and delete', partPage.canEdit && partPage.canDelete);
  const beforeStep = await page.evaluate(
    () => window.__snapshot().supplies.find((s) => s.id === 's1').quantity);
  await page.click(el('.stockrow [data-act="stock"][data-delta="1"]'));
  await page.waitForTimeout(120);
  check('the stepper on the page works',
    await page.evaluate(() => window.__snapshot().supplies.find((s) => s.id === 's1').quantity),
    beforeStep + 1);
  // Stock and the figures are one card, not two: they are the same subject,
  // and the card is what opens the edit form.
  const oneCard = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const card = root.querySelector('.onepart');
    return {
      cards: root.querySelectorAll('.pad > .card').length,
      holdsStock: !!card.querySelector('.stockrow'),
      holdsFigures: !!card.querySelector('.kv'),
      opensEdit: card.dataset.act === 'edit-part',
      reachable: card.getAttribute('tabindex') === '0',
      // The separate Edit button is gone; the card does that job now.
      editButtons: [...root.querySelectorAll('.btnrow .btn')].map((b) => b.textContent.trim()),
    };
  });
  ok('the stock and the figures share one card',
    oneCard.holdsStock && oneCard.holdsFigures);
  ok('which opens the edit form', oneCard.opensEdit);
  ok('and can be reached from the keyboard', oneCard.reachable);
  check('with no second way to the same place', oneCard.editButtons, ['Delete']);

  // The stepper sits inside that card and must not open the form with it: a
  // click resolves to the nearest thing that handles one, and if that ever
  // stops being true, adding a part to the shelf would throw you into an edit.
  const beforeInner = await page.evaluate(
    () => window.__snapshot().supplies.find((s) => s.id === 's1').quantity);
  await page.click(el('.onepart .stepper [data-act="stock"][data-delta="-1"]'));
  await page.waitForTimeout(140);
  check('the stepper still changes the count',
    await page.evaluate(() => window.__snapshot().supplies.find((s) => s.id === 's1').quantity),
    Math.max(0, beforeInner - 1));
  check('and does not open the edit form', await page.$(el('.sheet')), null);

  await page.click(el('.onepart .kv'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  ok('but the card itself does', true);
  await page.click(el('.sheet [data-act="close"]'));
  await page.waitForTimeout(80);
  await page.click(el('.crumb .up'));
  await page.waitForTimeout(100);
  ok('and the crumb goes back to the list', await page.$(el('.search')) !== null);

  // --- search on every list ---------------------------------------------
  // Each tab keeps its own text: searching routines and then opening Parts
  // must not hand back a parts list narrowed by a word typed elsewhere.
  await page.fill(el('.search input'), 'lg');
  await page.waitForTimeout(140);
  const partsFound = await page.$$eval(el('.card .row .title'), (n) => n.map((t) => t.textContent.trim()));
  ok('parts can be searched', partsFound.length > 0
    && partsFound.every((t) => t.toLowerCase().includes('lg')), JSON.stringify(partsFound));

  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(120);
  check('the parts search did not follow to equipment',
    await page.inputValue(el('.search input')), '');
  await page.fill(el('.search input'), 'basement');
  await page.waitForTimeout(140);
  ok('equipment can be searched by location', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const rows = [...root.querySelectorAll('.card .row')];
    return rows.length > 0;
  }));
  await page.fill(el('.search input'), 'zzzznothing');
  await page.waitForTimeout(140);
  check('equipment says when nothing matches',
    await page.textContent(el('.empty h3')), 'Nothing matches that');

  await page.click(el('.tab[data-value="parts"]'));
  await page.waitForTimeout(120);
  check('and each tab kept its own text',
    await page.inputValue(el('.search input')), 'lg');
  await page.click(el('.search .clear'));
  await page.waitForTimeout(120);
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(120);
  await page.click(el('.search .clear'));
  await page.waitForTimeout(120);

  // The chevron at the end of an equipment row points at the page it opens.
  // Pointing down, it read as a disclosure that would expand in place.
  check('the row chevron points right', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const path = root.querySelector('.card .row > svg path, .card .row > .ic path');
    return path ? path.getAttribute('d') : null;
  }), 'm9 6 6 6-6 6');
  await page.click(el('.tab[data-value="parts"]'));
  await page.waitForTimeout(100);

  await page.click(el('.addbtn[data-act="add-part"]'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  await page.fill(el('.sheet input[name="name"]'), 'anode rod');
  await page.fill(el('.sheet input[name="quantity"]'), '1');
  await page.fill(el('.sheet input[name="reorderAt"]'), '1');
  await page.click(el('.sheet [data-act="save-part"]'));
  await page.waitForTimeout(160);
  const part = await page.evaluate(() => window.__snapshot().supplies.find((s) => s.name === 'Anode Rod'));
  ok('part saved', Boolean(part));
  check('quantity saved as a number', part.quantity, 1);

  // --- history ----------------------------------------------------------
  // A log read top to bottom is a chronology, so it is drawn as one: a rail
  // down the left with a dot per entry, grouped by year, rather than a stack
  // of cards.
  await page.click(el('.tab[data-value="history"]'));
  await page.waitForSelector(el('.timeline .tl'));
  ok('history lists entries', (await page.$$(el('.timeline .tl'))).length >= 3);
  const timeline = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const years = [...root.querySelectorAll('.pad > .label')]
      .filter((l) => /^\d{4}$/.test(l.firstChild.textContent.trim()));
    const ol = root.querySelector('.timeline');
    const first = ol.querySelector('.tl');
    return {
      years: years.map((l) => l.firstChild.textContent.trim()),
      counts: years.map((l) => Number(l.querySelector('.count').textContent)),
      perYear: years.map((l) => l.nextElementSibling.querySelectorAll('.tl').length),
      hasRail: getComputedStyle(ol, '::before').width !== 'auto',
      dots: ol.querySelectorAll('.dot').length,
      rows: ol.querySelectorAll('.tl').length,
      when: first.querySelector('.when').textContent.trim(),
      mono: getComputedStyle(first.querySelector('.when')).fontFamily,
      // The entries are a record to read, not a row of controls. Undo lives
      // on the entry's own sheet, a tap away, where there is room to say what
      // it will put back.
      actions: first.querySelectorAll('button').length,
      ranges: [...root.querySelectorAll('.seg button')].map((b) => b.textContent.trim()),
      pressed: [...root.querySelectorAll('.seg button')]
        .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
    };
  });
  check('grouped by year, newest first', timeline.years,
    [...timeline.years].sort().reverse());
  check('each year counts its own entries', timeline.counts, timeline.perYear);
  ok('there is a rail', timeline.hasRail);
  check('with a dot per entry', timeline.dots, timeline.rows);
  ok('the date reads as a short day', /^[A-Z][a-z]{2} \d{1,2}$/.test(timeline.when), timeline.when);
  ok('set in the mono face so the column lines up', /mono|Mono|Menlo/.test(timeline.mono),
    timeline.mono);
  check('an entry carries no buttons of its own', timeline.actions, 0);
  check('the range picker offers three windows', timeline.ranges,
    ['3 months', '12 months', 'All time']);
  check('and opens on all of it', timeline.pressed, ['All time']);

  // Narrowing the window drops the older entries and says so in the count.
  const allCount = await page.$$eval(el('.timeline .tl'), (n) => n.length);
  await page.click(el('.seg button[data-value="3m"]'));
  await page.waitForTimeout(140);
  const narrowed = await page.$$eval(el('.timeline .tl'), (n) => n.length);
  ok('three months shows fewer than all time', narrowed < allCount,
    `${narrowed} of ${allCount}`);
  check('and the heading counts what is shown',
    Number((await page.textContent(el('.pad > .label'))).trim().split(' ')[0]), narrowed);
  await page.click(el('.seg button[data-value="all"]'));
  await page.waitForTimeout(140);
  check('and it all comes back',
    await page.$$eval(el('.timeline .tl'), (n) => n.length), allCount);

  await page.click(el('.timeline .tl .title'));
  await page.waitForSelector(el('.sheet'));
  // The sheet is titled "History entry", so what the work was done to is what
  // identifies it; the date is a detail of that, not the headline.
  const detailOrder = await page.$$eval(el('.sheet .kv dt'),
    (n) => n.map((d) => d.textContent.trim()));
  check('the history entry leads with the equipment', detailOrder[0], 'Equipment');
  check('then when it was done', detailOrder[1], 'Done on');
  await shot(page, 'phone-history-detail.png');
  await page.click(el('.sheet [data-act="close"]'));
  await page.waitForTimeout(60);
  await shot(page, 'phone-history.png');

  // --- settings ---------------------------------------------------------
  await page.click(el('.tab[data-value="settings"]'));
  await page.waitForSelector(el('select[data-act="set-theme"]'));
  await page.fill(el('input[data-act="set-soon"]'), '30');
  await page.dispatchEvent(el('input[data-act="set-soon"]'), 'change');
  await page.waitForTimeout(120);
  // --- text size ---------------------------------------------------------
  // Growing the type is only safe if the boxes holding it grow too, so the
  // largest setting is checked for the things that break: a row clipping its
  // own text, the layout spilling sideways, a tap target shrinking.
  const measure = () => page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const cs = (sel, prop) => getComputedStyle(root.querySelector(sel))[prop];
    const app = root.querySelector('.app');
    return {
      title: parseFloat(cs('.row .title', 'fontSize')),
      icon: parseFloat(cs('.tab .ic', 'width')),
      row: parseFloat(cs('.row', 'minHeight')),
      overflow: app.scrollWidth - app.clientWidth,
    };
  });

  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(60);
  const atDefault = await measure();

  await page.click(el('.tab[data-value="settings"]'));
  await page.waitForTimeout(60);
  await page.selectOption(el('select[data-act="set-text"]'), 'larger');
  await page.waitForTimeout(160);
  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(80);
  const atLarger = await measure();

  ok('larger text is actually larger', atLarger.title > atDefault.title,
    `${atDefault.title} -> ${atLarger.title}`);
  ok('icons grow with it', atLarger.icon > atDefault.icon,
    `${atDefault.icon} -> ${atLarger.icon}`);
  ok('and the rows holding them grow too', atLarger.row > atDefault.row,
    `${atDefault.row} -> ${atLarger.row}`);
  check('nothing spills sideways at the largest size', atLarger.overflow, 0);

  // Text must not be cut off by its own row at any size.
  const clipped = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    return [...root.querySelectorAll('.row')].filter((r) => r.scrollHeight > r.clientHeight + 1).length;
  });
  check('no row clips its own content when text is largest', clipped, 0);

  // Back to default for the screens that follow.
  await page.click(el('.tab[data-value="settings"]'));
  await page.waitForTimeout(60);
  await page.selectOption(el('select[data-act="set-text"]'), 'default');
  await page.waitForTimeout(160);
  check('the preference round-trips',
    await page.evaluate(() => window.__snapshot().settings.textSize), 'default');

  // --- the tab row sits one step above the rest --------------------------
  // The tabs start at the size the "large" setting used to give them, and
  // nothing else moved. The step is folded into the tabs' own --ui-scale, so
  // the check is that the tabs' scale is 1.12x the panel's at every setting:
  // that says both that the step is applied and that the setting still
  // multiplies on top of it, which a fixed pixel size would not.
  const steps = {};
  for (const size of ['small', 'default', 'large', 'larger']) {
    await page.click(el('.tab[data-value="settings"]'));
    await page.waitForTimeout(70);
    await page.selectOption(el('select[data-act="set-text"]'), size);
    await page.waitForTimeout(160);
    await page.click(el('.tab[data-value="routines"]'));
    await page.waitForTimeout(90);
    steps[size] = await page.evaluate(() => {
      const host = document.querySelector('elmer-panel');
      const root = host.shadowRoot;
      const tab = root.querySelector('.tab');
      const px = (el2, prop) => parseFloat(getComputedStyle(el2)[prop]);
      return {
        tab: px(tab, 'fontSize'),
        tabIcon: px(tab.querySelector('.ic'), 'width'),
        tabTap: px(tab, 'minHeight'),
        body: px(root.querySelector('.row .title'), 'fontSize'),
        hint: px(root.querySelector('.row .sub'), 'fontSize'),
        // --ui-scale is a calc() expression, and an unregistered custom
        // property is not evaluated, so read the two numbers it multiplies.
        scale: parseFloat(getComputedStyle(host).getPropertyValue('--ui-base'))
          * parseFloat(getComputedStyle(host).getPropertyValue('--ui-user')),
      };
    });
  }
  const ratio = (s) => Math.round((steps[s].tab / steps[s].body) * 1000) / 1000;
  check('the tabs keep the same step above the body at every setting',
    [...new Set(['small', 'default', 'large', 'larger'].map(ratio))].length, 1);
  // Against the body rather than against another tab reading: comparing the
  // default tab to the large one only restates the setting's own multiplier
  // and holds whether or not the step exists at all. 11.5 and 14.5 are the
  // declared bases of a tab label and a row title.
  ok('the tabs at the default setting are the size large used to make them',
    Math.abs(ratio('default') - (11.5 * 1.12) / 14.5) < 0.005,
    `tab/body is ${ratio('default')}, unstepped would be ${Math.round((11.5 / 14.5) * 1000) / 1000}`);
  ok('the tab icon took the step too', steps.default.tabIcon > 20,
    `${steps.default.tabIcon}px, up from 20`);
  ok('and the tap target with it', steps.default.tabTap > 46,
    `${steps.default.tabTap}px, up from 46`);
  // Nothing outside the tab row moved: the body is still its own base size
  // times the panel's scale, with no trace of the tabs' step in it. The scale
  // is read rather than assumed because a phone adds a step of its own.
  ok('the body text carries no part of the tab step',
    Math.abs(steps.default.body - 14.5 * steps.default.scale) < 0.02,
    `${steps.default.body} vs ${14.5 * steps.default.scale}`);
  for (const [a, b] of [['small', 'default'], ['default', 'large'], ['large', 'larger']]) {
    ok(`${a} -> ${b} still moves the tabs`, steps[b].tab > steps[a].tab,
      `${steps[a].tab} -> ${steps[b].tab}`);
    ok(`${a} -> ${b} still moves the body`, steps[b].body > steps[a].body,
      `${steps[a].body} -> ${steps[b].body}`);
  }

  await page.click(el('.tab[data-value="settings"]'));
  await page.waitForTimeout(70);
  await page.selectOption(el('select[data-act="set-text"]'), 'default');
  await page.waitForTimeout(160);

  const sections = await page.$$eval(el('.pad .label'), (n) => n.map((x) => x.textContent.trim()));
  check('settings sections read in order', sections,
    ['Appearance', 'Scheduling', 'Where your data lives', 'Data export', 'About', 'Support']);

  // The support link leaves Home Assistant, so it opens in a new tab and must
  // not hand the opener over with it.
  const support = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const a = root.querySelector('.support a.btn');
    if (!a) return null;
    return {
      href: a.getAttribute('href'),
      target: a.getAttribute('target'),
      rel: a.getAttribute('rel'),
      underlined: getComputedStyle(a).textDecorationLine,
      paras: root.querySelectorAll('.support p').length,
      // .note is pre-wrap and would keep the source indentation of a block
      // written inside a template literal; this one must not be.
      wrap: getComputedStyle(root.querySelector('.support p')).whiteSpace,
    };
  });
  ok('settings has a support section', support !== null);
  check('pointing at the right place', support.href, 'https://buymeacoffee.com/philecker');
  check('opening away from Home Assistant', support.target, '_blank');
  ok('without handing over the opener',
    /noopener/.test(support.rel || '') && /noreferrer/.test(support.rel || ''), support.rel);
  check('the link does not arrive underlined', support.underlined, 'none');
  check('and the blurb is there', support.paras, 2);
  check('set as prose, not preformatted', support.wrap, 'normal');

  check('due-soon window saved',
    await page.evaluate(() => window.__snapshot().settings.dueSoonDays), 30);

  // A class that only has a rule inside some other selector silently falls back
  // to body size wherever it is used on its own, which looks like a shouting
  // paragraph rather than a caption.
  // Compared against the body text rather than a literal, because every size is
  // multiplied by the text-size setting now — a fixed number here would only be
  // testing the current scale factor.
  const hints = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const sizes = [...new Set([...root.querySelectorAll('.hint')]
      .map((n) => parseFloat(getComputedStyle(n).fontSize)))];
    const body = parseFloat(getComputedStyle(root.querySelector('.note')).fontSize);
    return { sizes, body };
  });
  check('every hint is the same size', hints.sizes.length, 1);
  ok('and smaller than body text', hints.sizes[0] < hints.body,
    `hint ${hints.sizes[0]} vs body ${hints.body}`);

  await shot(page, 'phone-settings.png');

  // --- backups ----------------------------------------------------------
  // Export writes a file through the browser rather than onto the server, so
  // what there is to assert is that a download actually starts and parses.
  const download = await Promise.all([
    page.waitForEvent('download'),
    page.click(el('[data-act="export"]')),
  ]).then(([d]) => d);
  const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  ok('the export is named for today', /^elmer-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()),
    download.suggestedFilename());
  check('the export carries the routines',
    exported.tasks.length, await page.evaluate(() => window.__snapshot().tasks.length));
  ok('the export carries history', exported.log.length > 0);

  // Importing reads the file in the browser, so the test hands the picker a
  // real file the way a person would.
  fs.mkdirSync(TMP, { recursive: true });
  const backup = path.join(TMP, 'backup.json');
  fs.writeFileSync(backup, JSON.stringify({
    version: 1,
    equipment: [{ id: 'imp1', name: 'Imported Dehumidifier', location: 'Crawlspace', category: 'appliance' }],
    tasks: [{ id: 'impt1', equipmentId: 'imp1', name: 'Empty Reservoir', lastDone: '2026-09-01', intervalCount: 1, intervalUnit: 'months' }],
    supplies: [{ id: 'imps1', name: 'Imported Filter', quantity: 4, reorderAt: 1 }],
    log: [],
  }));

  const before2 = await page.evaluate(() => window.__snapshot().equipment.length);
  await page.setInputFiles('input[type="file"]', backup).catch(() => {});
  // The input is created on demand by the click handler, so drive it the same way.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(el('[data-act="import"]')),
  ]);
  await chooser.setFiles(backup);
  await page.waitForSelector(el('.sheet [data-act="confirm-import"]'));
  ok('the import sheet names the file',
    (await page.textContent(el('.sheet .note'))).includes('backup.json'));
  ok('the import sheet counts what is in it',
    (await page.textContent(el('.sheet .note'))).includes('1 piece'));
  await shot(page, 'phone-import.png');

  await page.click(el('.sheet [data-act="confirm-import"]'));
  await page.waitForTimeout(200);
  const afterImport = await page.evaluate(() => {
    const s = window.__snapshot();
    return {
      equipment: s.equipment.length,
      added: s.equipment.some((e) => e.id === 'imp1'),
      routine: s.tasks.some((t) => t.id === 'impt1'),
      part: s.supplies.some((p) => p.id === 'imps1'),
    };
  });
  check('merging adds what was in the file', afterImport.added, true);
  check('merging brought the routine', afterImport.routine, true);
  check('merging brought the part', afterImport.part, true);
  check('merging kept what was already here', afterImport.equipment, before2 + 1);

  // Importing the same file again must not duplicate anything.
  const [chooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(el('[data-act="import"]')),
  ]);
  await chooser2.setFiles(backup);
  await page.waitForSelector(el('.sheet [data-act="confirm-import"]'));
  await page.click(el('.sheet [data-act="confirm-import"]'));
  await page.waitForTimeout(200);
  check('re-importing the same file changes nothing',
    await page.evaluate(() => window.__snapshot().equipment.length), before2 + 1);

  // A file that is not an Elmer backup is refused before anything is touched.
  const junk = path.join(TMP, 'junk.json');
  fs.writeFileSync(junk, JSON.stringify({ hello: 'world' }));
  const [chooser3] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click(el('[data-act="import"]')),
  ]);
  await chooser3.setFiles(junk);
  await page.waitForTimeout(200);
  check('an unrelated file does not open the import sheet',
    await page.$(el('.sheet [data-act="confirm-import"]')), null);
  ok('and it says so', (await page.textContent(el('.toast'))).toLowerCase().includes('nothing'));
  await page.waitForTimeout(100);

  // --- the in-app theme override ----------------------------------------
  // Measuring the attribute is not enough, and believing it is what let this
  // break: inside Home Assistant the surface colours are read from HA's own
  // custom properties, which carry HA's mode. Setting Elmer to Light while HA
  // ran dark flipped the attribute and the accents and left every surface
  // dark. So assert the colour that actually gets painted.
  const lum = luminance;
  const painted = () => page.evaluate(() => {
    const host = document.querySelector('elmer-panel');
    const root = host.shadowRoot;
    const card = root.querySelector('.row') || root.querySelector('.app');
    return {
      paper: getComputedStyle(host).backgroundColor,
      surface: getComputedStyle(card).backgroundColor,
      ink: getComputedStyle(root.querySelector('.app')).color,
      scheme: getComputedStyle(host).colorScheme,
      pinned: host.hasAttribute('data-pinned'),
      attr: host.getAttribute('data-theme'),
    };
  });

  await page.selectOption(el('select[data-act="set-theme"]'), 'dark');
  await page.waitForTimeout(140);
  let look = await painted();
  check('choosing dark says so', [look.attr, look.pinned], ['dark', true]);
  ok('and the panel is actually dark', lum(look.paper) < 0.1, look.paper);
  ok('with light text on it', lum(look.ink) > 0.5, look.ink);
  check('and the colour scheme follows', look.scheme, 'dark');
  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(80);
  await shot(page, 'phone-routines-dark.png');

  // Now the case that was broken: pin Elmer to light while HA runs dark.
  await page.click(el('.tab[data-value="settings"]'));
  await page.evaluate(() => {
    window.__setHaTheme('dark');
    const p = document.querySelector('elmer-panel');
    p.hass.themes.darkMode = true;
    p.hass = p.hass;
  });
  await page.waitForTimeout(120);
  await page.selectOption(el('select[data-act="set-theme"]'), 'light');
  await page.waitForTimeout(140);
  look = await painted();
  check('choosing light while HA runs dark says so', [look.attr, look.pinned], ['light', true]);
  ok('and the panel is actually light', lum(look.paper) > 0.7, look.paper);
  ok('its cards too', lum(look.surface) > 0.7, look.surface);
  ok('with dark text on them', lum(look.ink) < 0.1, look.ink);
  check('and the colour scheme follows', look.scheme, 'light');

  // Following HA again must go straight back to HA's own colours, not Elmer's.
  await page.selectOption(el('select[data-act="set-theme"]'), 'system');
  await page.waitForTimeout(140);
  look = await painted();
  check('following HA again stops pinning', [look.attr, look.pinned], ['dark', false]);
  ok('and takes HA\'s background, not Elmer\'s own',
    look.paper === 'rgb(17, 17, 17)', look.paper);

  // Put HA back to light for the rest of the run.
  await page.evaluate(() => {
    window.__setHaTheme('light');
    const p = document.querySelector('elmer-panel');
    p.hass.themes.darkMode = false;
    p.hass = p.hass;
  });
  await page.waitForTimeout(120);
  check('following HA gives light when HA is light',
    await page.getAttribute('elmer-panel', 'data-theme'), 'light');

  // The modal border is mixed from the sheet's own ink and paper, so it has to
  // hold its weight in every combination of HA's theme and Elmer's setting —
  // including HA dark with Elmer pinned light, where the paper is Elmer's and
  // nothing about HA's palette applies.
  for (const [ha, pref] of [['light', 'system'], ['dark', 'system'],
    ['dark', 'light'], ['light', 'dark']]) {
    await page.evaluate((mode) => {
      window.__setHaTheme(mode);
      const p = document.querySelector('elmer-panel');
      p.hass.themes.darkMode = mode === 'dark';
      p.hass = p.hass;
    }, ha);
    await page.click(el('.tab[data-value="settings"]'));
    await page.waitForTimeout(80);
    await page.selectOption(el('select[data-act="set-theme"]'), pref);
    await page.waitForTimeout(140);
    await page.click(el('.tab[data-value="routines"]'));
    await page.waitForTimeout(60);
    await page.click(el('.row[data-id="t1"]'));
    await page.waitForSelector(el('.sheet'));
    await page.waitForTimeout(200);
    const edge = await page.evaluate(() => {
      const cs = getComputedStyle(
        document.querySelector('elmer-panel').shadowRoot.querySelector('.sheet'));
      return { edge: cs.borderTopColor, face: cs.backgroundColor };
    });
    const r = contrastRatio(edge.edge, edge.face);
    ok(`the border holds its weight with HA ${ha} and Elmer ${pref}`,
      Math.abs(r - 1.47) < 0.06, `${r}:1`);
    await page.click(el('.sheet [data-act="close"]'));
    await page.waitForTimeout(80);
  }

  // Leave HA light and Elmer following it for the rest of the run.
  await page.evaluate(() => {
    window.__setHaTheme('light');
    const p = document.querySelector('elmer-panel');
    p.hass.themes.darkMode = false;
    p.hass = p.hass;
  });
  await page.click(el('.tab[data-value="settings"]'));
  await page.waitForTimeout(80);
  await page.selectOption(el('select[data-act="set-theme"]'), 'system');
  await page.waitForTimeout(140);

  // --- deleting -----------------------------------------------------------
  page.on('dialog', (d) => d.accept());
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(60);
  await page.click(el('.row[data-id="eq5"]'));
  await page.waitForTimeout(60);
  const tasksOn5 = await page.evaluate(() => window.__snapshot().tasks.filter((t) => t.equipmentId === 'eq5').length);
  ok('equipment has routines to lose', tasksOn5 > 0);
  await page.click(el('[data-act="delete-equipment"]'));
  await page.waitForTimeout(200);
  const afterDelete = await page.evaluate(() => {
    const s = window.__snapshot();
    return {
      eq: s.equipment.some((e) => e.id === 'eq5'),
      tasks: s.tasks.filter((t) => t.equipmentId === 'eq5').length,
      log: s.log.some((l) => l.equipmentId === 'eq5'),
    };
  });
  check('equipment deleted', afterDelete.eq, false);
  check('its routines went too', afterDelete.tasks, 0);
  ok('its history was kept', afterDelete.log);
  ok('returned to the list', await page.$(el('.addbtn[data-act="add-equipment"]')) !== null);

  await ctx.close();

  /* ------------------------------------------- a fresh install, empty -- */
  // What somebody sees the first time they open the panel. Nothing covered it
  // before, and it is the one screen where a new user has no other clues.
  ({ ctx, page } = await open({ narrow: true, viewport: PHONE }));
  await page.evaluate(() => window.__setData('empty'));
  await page.waitForTimeout(200);

  const emptyScreens = {};
  for (const tab of ['routines', 'equipment', 'parts', 'history', 'settings']) {
    await page.click(el(`.tab[data-value="${tab}"]`));
    await page.waitForTimeout(80);
    emptyScreens[tab] = await page.evaluate(() => {
      const root = document.querySelector('elmer-panel').shadowRoot;
      const empty = root.querySelector('.empty');
      const add = root.querySelector('.addbtn');
      return {
        heading: empty ? empty.querySelector('h3').textContent.trim() : null,
        bodyButtons: empty ? empty.querySelectorAll('button').length : 0,
        add: add ? add.textContent.trim() : null,
        hasControls: !!root.querySelector('select, input'),
      };
    });
  }
  ok('every list says what to do when it is empty',
    ['routines', 'equipment', 'parts', 'history'].every((t) => emptyScreens[t].heading),
    JSON.stringify(emptyScreens));
  // The action lives in the header, in the same place on every tab. A second
  // copy in the middle of an empty page is the same action twice, and it moves
  // depending on whether the list happens to be empty.
  ok('and no empty state puts a button in the body',
    Object.values(emptyScreens).every((s) => s.bodyButtons === 0),
    JSON.stringify(emptyScreens));
  ok('the action is in the header instead',
    ['routines', 'equipment', 'parts'].every((t) => emptyScreens[t].add),
    JSON.stringify(emptyScreens));
  check('including a routine on a fresh install, with no equipment yet',
    emptyScreens.routines.add, 'Add Routine');
  check('and history has nothing to add', emptyScreens.history.add, null);
  ok('settings still works with no data', emptyScreens.settings.hasControls);

  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(80);
  check('no filter row when there is nothing to filter',
    await page.$(el('.pills')), null);
  check('nothing spills sideways when empty', await page.evaluate(() => {
    const app = document.querySelector('elmer-panel').shadowRoot.querySelector('.app');
    return app.scrollWidth - app.clientWidth;
  }), 0);

  // A routine that belongs to nothing. The store has always allowed it; until
  // now the panel gave no way to create one, so a fresh install could not
  // record "bleed the radiators" without inventing equipment to hang it on.
  await page.click(el('.addbtn'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  check('the equipment field offers no equipment, and does not insist',
    await page.$$eval(el('.sheet select[name="equipmentId"] option'), (n) => n.map((o) => o.value)),
    ['']);
  await page.fill(el('.sheet input[name="name"]'), 'Bleed the radiators');
  await page.fill(el('.sheet input[name="intervalCount"]'), '1');
  await page.selectOption(el('.sheet select[name="intervalUnit"]'), 'years');
  await page.click(el('.sheet [data-act="save-routine"]'));
  await page.waitForTimeout(240);
  const loose = await page.evaluate(() => window.__snapshot().tasks);
  check('a routine saves with no equipment', loose.length, 1);
  // The name comes back title-cased; that is the form's own long-standing
  // behaviour, and what matters here is the empty equipmentId beside it.
  check('and keeps the field empty rather than inventing one',
    [loose[0].name, loose[0].equipmentId || ''], ['Bleed The Radiators', '']);
  ok('it then shows in the list', await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const row = root.querySelector('.row .title');
    return row && row.textContent.toLowerCase().includes('bleed the radiators');
  }));
  check('and the equipment list is still empty', await page.evaluate(
    () => window.__snapshot().equipment.length), 0);

  // Back to nothing, for the equipment path below.
  await page.evaluate(() => window.__setData('empty'));
  await page.waitForTimeout(200);

  // Adding the first piece of equipment has to work from the header too.
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(60);
  await page.click(el('.addbtn'));
  await page.waitForSelector(el('.sheet input[name="name"]'));
  ok('the first location is a plain text box, not an empty dropdown',
    await page.$(el('.sheet select[name="locationPick"]')) === null
      && await page.isVisible(el('.sheet input[name="locationNew"]')));
  await page.fill(el('.sheet input[name="name"]'), 'water heater');
  await page.fill(el('.sheet input[name="locationNew"]'), 'basement');
  await page.click(el('.sheet [data-act="save-equipment"]'));
  await page.waitForTimeout(220);
  check('the first piece of equipment saves',
    await page.evaluate(() => window.__snapshot().equipment.map((e) => [e.name, e.location])),
    [['Water Heater', 'Basement']]);
  await ctx.close();

  /* ----------------------------------------- escaping, on its own page -- */
  ({ ctx, page } = await open({ narrow: true, viewport: PHONE }));
  await page.evaluate(() => {
    const p = document.querySelector('elmer-panel');
    return p.hass.connection.sendMessagePromise({
      type: 'elmer/apply',
      ops: [{
        kind: 'equipment.put',
        payload: {
          id: 'xss',
          name: '<img src=x onerror="window.__pwned=1">',
          location: '"><script>window.__pwned=1</script>',
          notes: 'ampersand & <b>bold</b>',
          parts: [{ label: '<svg onload="window.__pwned=1">', url: 'javascript:window.__pwned=1' }],
          category: 'other',
        },
      }],
    });
  });
  await page.waitForTimeout(140);
  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(80);
  await page.click(el('.row[data-id="xss"]'));
  await page.waitForTimeout(100);
  check('markup in a name does not execute', await page.evaluate(() => window.__pwned), undefined);
  check('the name is shown as text',
    await page.textContent(el('.crumb .here')), '<img src=x onerror="window.__pwned=1">');
  const jsLink = await page.$(el('a[href^="javascript:"]'));
  check('a javascript: url is never a link', jsLink, null);
  ok('the link label is still shown',
    (await page.textContent(el('.pad'))).includes('<svg onload='));
  await ctx.close();

  /* ----------------------------------------------- desktop, HA in dark -- */
  ({ ctx, page } = await open({ narrow: false, dark: true, viewport: DESKTOP }));
  check('panel follows HA into dark',
    await page.getAttribute('elmer-panel', 'data-theme'), 'dark');
  ok('no hamburger on a wide screen', await page.$(el('[data-act="menu"]')) === null);

  // The tabs sit under the header at every width — they do not move to the
  // bottom on a phone and back to the top on a desktop.
  const order = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const t = (sel) => Math.round(root.querySelector(sel).getBoundingClientRect().top);
    return { header: t('.header'), tabs: t('.tabs'), main: t('.main') };
  });
  ok('tabs sit between the header and the content',
    order.header < order.tabs && order.tabs < order.main, JSON.stringify(order));

  // The search box and the filter row are page content, so they line up with
  // the list because they share its padding box, not because of a separate rule.
  const aligned = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const card = root.querySelector('.card').getBoundingClientRect();
    const probes = {
      '.search': root.querySelector('.search'),
      '.pills': root.querySelector('.pills .pill'),
    };
    const out = {};
    for (const [sel, n] of Object.entries(probes)) {
      if (n) out[sel] = Math.round(n.getBoundingClientRect().left - card.left);
    }
    return out;
  });
  check('search and filters line up with the list', aligned, { '.search': 0, '.pills': 0 });

  // The tab row spans the panel but its tabs sit in the content's column, so
  // the first label starts on the same vertical as the list below it.
  const tabAligned = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const card = root.querySelector('.card').getBoundingClientRect();
    const glyph = root.querySelector('.tab .ic').getBoundingClientRect();
    const bar = root.querySelector('.tabs').getBoundingClientRect();
    const host = document.querySelector('elmer-panel').getBoundingClientRect();
    return {
      tabToContent: Math.round(glyph.left - card.left),
      barSpansPanel: Math.round(bar.width - host.width),
    };
  });
  check('the tab row lines up with the content', tabAligned.tabToContent, 0);

  // Without these the tab row's sideways swipe stays a vertical gesture too, so
  // dragging the tabs left and right drags the page under them and rubber-bands
  // it. Both are invisible until someone uses a touchscreen, so they are
  // measured rather than trusted.
  const tabTouch = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const cs = getComputedStyle(root.querySelector('.tabsinner'));
    return {
      touchAction: cs.touchAction,
      overscrollX: cs.overscrollBehaviorX,
      overscrollY: cs.overscrollBehaviorY,
      overflowY: cs.overflowY,
    };
  });
  check('the tab row pans sideways only', tabTouch.touchAction, 'pan-x');
  check('and does not chain its scroll to the page', [tabTouch.overscrollX, tabTouch.overscrollY], ['contain', 'contain']);
  check('and cannot scroll vertically at all', tabTouch.overflowY, 'hidden');
  check('while its rule still spans the panel', tabAligned.barSpansPanel, 0);

  // The header belongs to the same column: the brand on the list's left edge,
  // the add button on its right, rather than stranded in the window's corners.
  const headAligned = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const card = root.querySelector('.card').getBoundingClientRect();
    const mark = root.querySelector('.brand .ic').getBoundingClientRect();
    const add = root.querySelector('.addbtn');
    return {
      brandToContent: Math.round(mark.left - card.left),
      addToContent: add ? Math.round(add.getBoundingClientRect().right - card.right) : null,
    };
  });
  check('the brand sits on the content edge', headAligned.brandToContent, 0);
  check('and the add button on the other one', headAligned.addToContent, 0);

  // A count sitting on top of its own label is the kind of thing only a
  // measurement catches.
  const badgeClear = await page.evaluate(() => {
    const root = document.querySelector('elmer-panel').shadowRoot;
    const tab = root.querySelector('.tab[data-value="routines"]');
    const badge = tab.querySelector('.badge');
    const label = tab.querySelector('span:not(.badge)');
    if (!badge || !label) return true;
    const a = badge.getBoundingClientRect();
    const b = label.getBoundingClientRect();
    return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
  });
  ok('the overdue badge does not overlap its label', badgeClear);
  await shot(page, 'desktop-routines-dark.png');

  await page.click(el('.tab[data-value="equipment"]'));
  await page.waitForTimeout(80);
  await page.click(el('.row[data-id="eq1"]'));
  await page.waitForTimeout(80);
  await shot(page, 'desktop-equipment-dark.png');
  await ctx.close();

  /* ------------------------------------------------ desktop, HA in light */
  ({ ctx, page } = await open({ narrow: false, dark: false, viewport: DESKTOP }));
  await shot(page, 'desktop-routines.png');
  await page.click(el('.tab[data-value="parts"]'));
  await page.waitForTimeout(80);
  await shot(page, 'desktop-parts.png');

  // --- a sheet is centred on the panel, not on the window ---------------
  // The overlay is fixed to the window so the sheet cannot be cut off by a
  // panel shorter than the viewport. That left it centred on the window too,
  // and inside Home Assistant the panel starts to the right of the sidebar —
  // so on a desktop the sheet sat about half a sidebar left of the column it
  // belongs to. Inset the host the way the sidebar does and measure.
  await page.evaluate(() => {
    const p = document.querySelector('elmer-panel');
    p.style.marginLeft = '256px';
    p.style.width = 'calc(100% - 256px)';
  });
  await page.waitForTimeout(120);
  await page.click(el('.tab[data-value="routines"]'));
  await page.waitForTimeout(60);
  await page.click(el('.row[data-id="t1"]'));
  await page.waitForSelector(el('.sheet'));
  await page.waitForTimeout(260);
  const centring = await page.evaluate(() => {
    const host = document.querySelector('elmer-panel');
    const root = host.shadowRoot;
    const h = host.getBoundingClientRect();
    const s = root.querySelector('.sheet').getBoundingClientRect();
    const scrim = root.querySelector('.scrim').getBoundingClientRect();
    return {
      offPanel: Math.round(((s.left + s.right) / 2) - ((h.left + h.right) / 2)),
      offWindow: Math.round(((s.left + s.right) / 2) - window.innerWidth / 2),
      insidePanel: s.left >= h.left - 1 && s.right <= h.right + 1,
      dimsWholeWindow: Math.round(scrim.width - window.innerWidth) === 0,
    };
  });
  ok('a sheet is centred on the panel', Math.abs(centring.offPanel) <= 1,
    `${centring.offPanel}px off`);
  ok('which is not the same as centred on the window', Math.abs(centring.offWindow) > 100,
    `${centring.offWindow}px off window centre — the bug would read 0`);
  ok('and it sits wholly inside the panel', centring.insidePanel);
  ok('while the dimming still covers everything', centring.dimsWholeWindow);
  await page.click(el('.sheet [data-act="close"]'));
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const p = document.querySelector('elmer-panel');
    p.style.marginLeft = '';
    p.style.width = '';
  });
  await page.waitForTimeout(120);
  const recentred = await page.evaluate(() => {
    const host = document.querySelector('elmer-panel');
    return getComputedStyle(host).getPropertyValue('--panel-l').trim();
  });
  check('and the panel notices when it is given the width back', recentred, '0px');

  // --- only the body scrolls, and only when it has to --------------------
  // Home Assistant does not always give a custom panel a height of its own.
  // When it does not, height:100% computes to auto, the app grows to the
  // length of the list, and the document scrolls instead — carrying the header
  // and the tabs off the top of the screen. The height is therefore measured
  // from the window. Each case below is a shape Home Assistant can present.
  for (const [label, css, tab, shouldScroll] of [
    ['a parent with a height', '', 'routines', true],
    ['a parent with no height at all', 'html,body{height:auto!important}', 'routines', true],
    ['a toolbar above the panel', 'html,body{height:auto!important} body{padding-top:64px}', 'routines', true],
    ['content too short to scroll', 'html,body{height:auto!important}', 'history', false],
    ['a parent shorter than the window', 'html,body{height:auto!important} elmer-panel{height:400px!important}', 'routines', true],
  ]) {
    // A window short enough that the routines list genuinely overflows it;
    // on a tall desktop it fits, and the case would prove nothing.
    const probe = await open({ narrow: false, viewport: { width: 1280, height: 680 } });
    if (css) await probe.page.addStyleTag({ content: css });
    await probe.page.click(`.tab[data-value="${tab}"]`);
    await probe.page.waitForTimeout(320);
    const fit = await probe.page.evaluate(() => {
      const host = document.querySelector('elmer-panel');
      const root = host.shadowRoot;
      const sc = root.querySelector('.scroll');
      const headAt = () => Math.round(root.querySelector('.header').getBoundingClientRect().top);
      const tabsAt = () => Math.round(root.querySelector('.tabs').getBoundingClientRect().top);
      const before = [headAt(), tabsAt()];
      sc.scrollTop = 99999;                     // as far down as it will go
      const after = [headAt(), tabsAt()];
      return {
        appBottomOverrun: Math.round(
          root.querySelector('.app').getBoundingClientRect().bottom - window.innerHeight),
        bodyScrolls: sc.scrollHeight > sc.clientHeight + 1,
        docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        chromeMoved: after[0] !== before[0] || after[1] !== before[1],
      };
    });
    ok(`${label}: the app stops at the bottom of the window`,
      fit.appBottomOverrun <= 0, `${fit.appBottomOverrun}px past it`);
    ok(`${label}: the document itself never scrolls`, !fit.docScrolls);
    check(`${label}: the body scrolls only if it has to`, fit.bodyScrolls, shouldScroll);
    ok(`${label}: and the header and tabs stay put while it does`, !fit.chromeMoved);
    await probe.ctx.close();
  }

  // Every tab must be a scroll container, including the ones whose content
  // happens to fit. With overflow-y:auto a short tab is not one, so a swipe
  // over it has nothing to move and passes outward to whatever can scroll —
  // inside Home Assistant that is the page, and the header goes up with it.
  // Parts and History are the short ones, which is why they misbehaved while
  // the longer tabs looked right.
  ({ ctx, page } = await open({ narrow: false, viewport: { width: 1280, height: 680 } }));
  const containers = {};
  for (const tab of ['routines', 'equipment', 'parts', 'history', 'settings']) {
    await page.click(el(`.tab[data-value="${tab}"]`));
    await page.waitForTimeout(130);
    containers[tab] = await page.evaluate(() => {
      const sc = document.querySelector('elmer-panel').shadowRoot.querySelector('.scroll');
      const cs = getComputedStyle(sc);
      return {
        overflowY: cs.overflowY,
        chains: cs.overscrollBehaviorY !== 'contain' && cs.overscrollBehaviorY !== 'none',
        hasRoom: sc.scrollHeight > sc.clientHeight + 1,
      };
    });
  }
  check('every tab is a scroll container',
    [...new Set(Object.values(containers).map((c) => c.overflowY))], ['scroll']);
  ok('none of them hands the gesture outward',
    Object.values(containers).every((c) => !c.chains), JSON.stringify(containers));
  ok('and the check covers a tab with nothing to scroll',
    Object.values(containers).some((c) => !c.hasRoom), JSON.stringify(containers));
  await ctx.close();

  // The scrollbar's width is held whether or not there is anything to scroll,
  // so moving between a long tab and a short one cannot shift the content
  // sideways by the width of a scrollbar that has just appeared.
  //
  // The shift itself cannot be reproduced here: this Chromium draws scrollbars
  // as an overlay and reports them as zero pixels wide, with or without the
  // flags that are supposed to turn that off, so a scrolling tab and a short
  // one measure identically whatever the stylesheet says. What is checked is
  // that the declaration survives on every tab, and the invariant it exists to
  // protect — the content column lining up with the header above it, which is
  // what visibly breaks when the gutter is reserved on one side only.
  ({ ctx, page } = await open({ narrow: false, viewport: { width: 1280, height: 680 } }));
  const edges = {};
  for (const tab of ['routines', 'history', 'parts', 'settings']) {
    await page.click(el(`.tab[data-value="${tab}"]`));
    await page.waitForTimeout(140);
    edges[tab] = await page.evaluate(() => {
      const root = document.querySelector('elmer-panel').shadowRoot;
      const sc = root.querySelector('.scroll');
      return {
        gutter: getComputedStyle(sc).scrollbarGutter,
        offset: Math.round(root.querySelector('.pad').getBoundingClientRect().left
          - root.querySelector('.headerinner').getBoundingClientRect().left),
        scrolls: sc.scrollHeight > sc.clientHeight + 1,
      };
    });
  }
  ok('the comparison covers a tab that scrolls and one that does not',
    [...new Set(Object.values(edges).map((e) => e.scrolls))].length === 2,
    JSON.stringify(edges));
  check('the gutter is held on both edges, on every tab',
    [...new Set(Object.values(edges).map((e) => e.gutter))], ['stable both-edges']);
  check('so the content stays under the header whether it scrolls or not',
    [...new Set(Object.values(edges).map((e) => e.offset))], [0]);

  // --- the subscription is released on teardown -------------------------
  const leaked = await page.evaluate(async () => {
    const p = document.querySelector('elmer-panel');
    const parent = p.parentNode;
    parent.removeChild(p);
    await new Promise((r) => setTimeout(r, 60));
    // Nothing should repaint a detached panel.
    let threw = false;
    try {
      await p.hass.connection.sendMessagePromise({
        type: 'elmer/apply',
        ops: [{ kind: 'settings.put', payload: { showLocations: true } }],
      });
    } catch { threw = true; }
    return threw;
  });
  check('a detached panel does not error on a push', leaked, false);

  await ctx.close();
  await browser.close();
  server.close();

  /* ------------------------------------------------------------ report -- */
  const noise = errors.filter((e) => !/favicon/i.test(e));
  check('no console or page errors', noise, []);

  const shots = fs.readdirSync(SHOTS).filter((f) => f.endsWith('.png')).sort();
  if (!process.argv.includes('--keep')) {
    // Kept by default — they are the point of the run as much as the asserts.
  }

  if (fails.length) {
    console.log(`FAIL — ${fails.length} of ${checks} checks\n`);
    for (const f of fails) console.log(`  ${f}`);
    return 1;
  }
  console.log(`PASS — ${checks} checks, no console errors`);
  console.log(`  ${shots.length} screenshots in tools/shots/`);
  for (const s of shots) console.log(`    ${s}`);
  return 0;
}

main().then((code) => process.exit(code), async (err) => {
  // A timeout says what selector was missing but not what the screen looked
  // like, which is the thing that actually explains it.
  try {
    const pages = CURRENT.page;
    if (pages) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await pages.screenshot({ path: path.join(SHOTS, 'FAILURE.png') });
      const sheet = await pages.textContent('.sheet h2').catch(() => null);
      console.error(`\nAt the point of failure: sheet=${JSON.stringify(sheet)}`);
      console.error(`Screenshot: ${path.join(SHOTS, 'FAILURE.png')}\n`);
    }
  } catch { /* the screenshot is a nicety, not the report */ }
  console.error(err);
  process.exit(2);
});
