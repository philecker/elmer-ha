/**
 * The sidebar icon, and the race it has to survive.
 *
 * Home Assistant resolves a custom icon set exactly once per ha-icon, inside
 * willUpdate, and only when that element's own icon property changes. If the
 * set is not registered at that moment the element sets a legacy flag and
 * renders <iron-icon>, which the frontend no longer ships — so the row is
 * blank, and nothing in the frontend ever notices the set arriving later.
 *
 * The ha-icon stood up here is a model of that behaviour, read off
 * src/components/ha-icon.ts and src/data/custom_icons.ts: resolution on
 * property change only, a live read of the registry, and a legacy flag when
 * the set is missing. It is a model, not Home Assistant. What it can prove is
 * that sidebar-icon.js repairs an icon that has already given up; what it
 * cannot prove is that Home Assistant gives up in exactly this way. That part
 * rests on the source.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ICON = path.join(ROOT, 'custom_components/elmer/frontend/sidebar-icon.js');

let passed = 0;
const failures = [];

function ok(what, cond, detail = '') {
  if (cond) passed += 1;
  else failures.push([what, detail]);
}

function check(what, got, want) {
  ok(what, JSON.stringify(got) === JSON.stringify(want), `got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`);
}

// Stand-ins for ha-icon and the ha-svg-icon it renders into. ha-icon resolves
// once and never again; what it found is handed down as a property, and when
// it found nothing it renders the <iron-icon> the frontend no longer ships.
const FAKE_HA_ICON = `
  class HaSvgIcon extends HTMLElement {}
  customElements.define('ha-svg-icon', HaSvgIcon);

  class HaIcon extends HTMLElement {
    static get observedAttributes() { return ['icon']; }
    constructor() { super(); this.attachShadow({ mode: 'open' }); }
    attributeChangedCallback(_n, _o, v) { this.icon = v; }
    get icon() { return this._icon; }
    set icon(value) {
      if (value === this._icon) return;
      this._icon = value;
      this.resolutions = (this.resolutions || 0) + 1;
      this._loadIcon();
    }
    _render() {
      this.shadowRoot.textContent = '';
      if (this.legacy) {
        this.shadowRoot.append(document.createElement('iron-icon'));
        return;
      }
      const svg = document.createElement('ha-svg-icon');
      svg.path = this.path;
      this.shadowRoot.append(svg);
    }
    async _loadIcon() {
      this.path = undefined;
      this.legacy = false;
      const [prefix, name] = String(this._icon || '').split(':', 2);
      if (!prefix || !name) { this._render(); return; }
      // The live lookup custom_icons.ts performs through its Proxy.
      const direct = window.customIcons && window.customIcons[prefix];
      const viaSet = window.customIconsets && window.customIconsets[prefix]
        ? { getIcon: window.customIconsets[prefix] }
        : undefined;
      const set = direct || viaSet;
      if (set && typeof set.getIcon === 'function') {
        const requested = this._icon;
        const icon = await set.getIcon(name);
        if (this._icon !== requested) return;
        this.path = icon.path;
        this._render();
        return;
      }
      this.legacy = true;
      this._render();
    }
  }
  customElements.define('ha-icon', HaIcon);
`;

async function main() {
  if (!fs.existsSync(ICON)) {
    console.error('sidebar-icon.js is missing. Run: node tools/build-sidebar-icon.mjs');
    process.exit(1);
  }
  const source = fs.readFileSync(ICON, 'utf8');

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const blank = async () => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: FAKE_HA_ICON });
  };

  // --- the control: registered first, which is the race going our way ------
  // The icon is created only once the file has finished everything it does,
  // its second pass at load included. Created in between, it can be caught
  // mid-resolution — its lookup is a promise, so for a tick it has an icon
  // name and nothing drawn yet, which is indistinguishable from one that
  // gave up. The repair pokes it, harmlessly, and the count below reads 3.
  // That is the test being unlucky rather than the file being wrong, but an
  // assertion that fails one run in ten teaches you to ignore it.
  await blank();
  await page.addScriptTag({ content: source, type: 'module' });
  await page.waitForLoadState('load');
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const el = document.createElement('ha-icon');
    el.icon = 'elmer:elmer';
    document.body.append(el);
  });
  await page.waitForTimeout(60);
  const won = await page.evaluate(() => {
    const el = document.querySelector('ha-icon');
    return { path: (el.path || '').slice(0, 12), legacy: el.legacy, resolutions: el.resolutions };
  });
  ok('registered before the icon draws, it resolves', won.path.startsWith('M'), JSON.stringify(won));
  check('and nothing had to be repaired', won.resolutions, 1);

  // --- the bug: the icon drew first and gave up ----------------------------
  await blank();
  await page.evaluate(() => {
    const el = document.createElement('ha-icon');
    el.icon = 'elmer:elmer';
    document.body.append(el);
  });
  await page.waitForTimeout(60);
  const gaveUp = await page.evaluate(() => {
    const el = document.querySelector('ha-icon');
    return { path: el.path, legacy: el.legacy };
  });
  ok('an icon that draws first gives up, as Home Assistant does',
    gaveUp.legacy === true && !gaveUp.path, JSON.stringify(gaveUp));
  check('and renders the element the frontend no longer ships',
    await page.evaluate(() => !!document.querySelector('ha-icon').shadowRoot.querySelector('iron-icon')),
    true);

  await page.addScriptTag({ content: source, type: 'module' });
  await page.waitForTimeout(80);
  const repaired = await page.evaluate(() => {
    const el = document.querySelector('ha-icon');
    return { path: (el.path || '').slice(0, 12), legacy: el.legacy, icon: el.icon };
  });
  ok('and loading the icon set afterwards repairs it', repaired.path.startsWith('M'), JSON.stringify(repaired));
  check('with its icon name put back', repaired.icon, 'elmer:elmer');
  check('and the legacy flag cleared', repaired.legacy, false);

  // --- the same, two shadow roots down, which is where the sidebar lives ---
  await blank();
  await page.evaluate(() => {
    const outer = document.createElement('div');
    document.body.append(outer);
    const a = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    a.append(inner);
    const b = inner.attachShadow({ mode: 'open' });
    const el = document.createElement('ha-icon');
    el.icon = 'elmer:elmer';
    b.append(el);
  });
  await page.waitForTimeout(60);
  await page.addScriptTag({ content: source, type: 'module' });
  await page.waitForTimeout(80);
  const nested = await page.evaluate(() => {
    const el = document.body.firstElementChild.shadowRoot
      .firstElementChild.shadowRoot.querySelector('ha-icon');
    return (el.path || '').slice(0, 12);
  });
  ok('an icon two shadow roots down is found too', nested.startsWith('M'), nested);

  // --- somebody else's page: nothing of ours on it -------------------------
  await blank();
  await page.evaluate(() => {
    const el = document.createElement('ha-icon');
    el.icon = 'mdi:home';
    document.body.append(el);
  });
  await page.waitForTimeout(40);
  await page.addScriptTag({ content: source, type: 'module' });
  await page.waitForTimeout(80);
  const other = await page.evaluate(() => {
    const el = document.querySelector('ha-icon');
    return { icon: el.icon, resolutions: el.resolutions };
  });
  check('an icon that is not ours is left alone', other, { icon: 'mdi:home', resolutions: 1 });
  check('and the registration threw nothing', errors, []);

  // --- the icon set itself -------------------------------------------------
  const shape = await page.evaluate(async () => {
    const icon = await window.customIconsets.elmer('elmer');
    return { keys: Object.keys(icon), head: icon.path.slice(0, 1), length: icon.path.length };
  });
  check('the set hands back one filled path', shape.keys, ['path']);
  ok('that starts with a move', shape.head === 'M', shape.head);
  ok('and is the whole mark', shape.length > 1500, String(shape.length));

  await browser.close();

  if (failures.length) {
    console.log(`FAIL — ${failures.length} of ${passed + failures.length} checks\n`);
    for (const [what, detail] of failures) console.log(`  ${what}\n    ${detail}`);
    process.exit(1);
  }
  console.log(`PASS — ${passed} checks, no console errors`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
