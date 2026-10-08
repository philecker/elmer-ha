// Build the integration's brand images.
//
// Home Assistant 2026.3 lets a custom integration ship its own brand images in
// a `brand/` folder beside the manifest, which is what puts a real icon next to
// Elmer in the integrations list instead of a grey placeholder. The sizes and
// shapes follow the home-assistant/brands spec:
//
//   icon.png       256x256, square
//   icon@2x.png    512x512, square
//   logo.png       landscape, shortest side 128-256 (256 here)
//   logo@2x.png    landscape, shortest side 256-512 (512 here)
//   dark_*         the same images for a dark background
//
// The glyph is drawn from the same path data the panel uses, so the icon in the
// integrations list and the mark in the panel header cannot drift apart.
//
// Two things are deliberate:
//
// * The icon is a filled tile rather than a bare outline. A stroke-only glyph
//   on transparency disappears against Home Assistant's cards; a tile holds its
//   own on both the light and the dark theme.
// * The stroke is lighter than the panel's. Both are drawn into the same
//   viewBox, so the weight is a proportion and does not change with the output
//   size — but the panel's 1.95 closes up the latch once the glyph is big
//   enough to see it. 1.6 keeps the latch open at 256px and still holds
//   together at the ~40px the integrations list draws it at.
//
//     node tools/build-brand.mjs

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// This container ships Chromium at a fixed path; CI and a normal checkout get
// it from Playwright's own download. Preferring the env var keeps both working
// without a branch at every call site.
const CHROME = process.env.CHROMIUM_PATH
  || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);


const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'custom_components', 'elmer', 'brand');

// Straight from the panel's icons.js, cropped viewBox and all.
const GLYPH = '<path d="M9.4 6.4V5.4a1.5 1.5 0 0 1 1.5-1.5h2.2a1.5 1.5 0 0 1 1.5 1.5v1"/>'
  + '<path d="M2.6 12.1h7.6M13.8 12.1h7.6"/>'
  + '<rect x="2.6" y="6.4" width="18.8" height="13.2" rx="2.2"/>'
  + '<rect x="9.8" y="10.2" width="4.4" height="3.8" rx="1.2"/>';
const BOX = '1.62 2.92 20.73 17.62';

// Elmer's palette. The light pair is the app's accent on paper; the dark pair
// is the one the panel itself switches to, so the two themes agree.
const LIGHT = { tile: '#0f5c4e', glyph: '#f4f7f5', ink: '#16211e' };
const DARK = { tile: '#4fbfa3', glyph: '#07251e', ink: '#e9efec' };

/**
 * Stroke weight for a given rendered size.
 *
 * Scaling the stroke with the artwork keeps the ratio but not the look: the
 * same ratio reads as hairline on a 24px list row and as a blob at 512. These
 * are hand-set so the glyph reads the same at every size it is shown at.
 */
// In viewBox units, so it is the same proportion at every output size.
const STROKE = 1.6;

function iconSvg(px, theme) {
  // 18% corner radius and a 20% inset are what let the toolbox sit optically
  // centred in the tile at every size.
  const r = Math.round(px * 0.18);
  const pad = Math.round(px * 0.20);
  const inner = px - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
    <rect width="${px}" height="${px}" rx="${r}" fill="${theme.tile}"/>
    <svg x="${pad}" y="${pad}" width="${inner}" height="${inner}" viewBox="${BOX}"
      fill="none" stroke="${theme.glyph}" stroke-width="${STROKE}"
      stroke-linecap="round" stroke-linejoin="round">${GLYPH}</svg>
  </svg>`;
}

// The cropped viewBox is wider than it is tall, so the glyph's box has to carry
// that ratio or the renderer letterboxes it and leaves padding the brands spec
// asks to be trimmed away.
const GLYPH_ASPECT = 20.73 / 17.62;

function logoSvg(height, theme) {
  // The glyph fills the full height and starts at x=0, so the artwork touches
  // every edge and there is nothing left to trim.
  const glyphW = Math.round(height * GLYPH_ASPECT);
  const gap = Math.round(height * 0.17);
  const fontSize = Math.round(height * 0.44);
  const tracking = fontSize * 0.1;
  // A first guess at the canvas; measureLogo reads the real extent back.
  const width = Math.round(glyphW + gap + fontSize * 3.9);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"
    viewBox="0 0 ${width} ${height}" font-family="Avenir Next, Avenir, system-ui, sans-serif">
    <svg x="0" y="0" width="${glyphW}" height="${height}" viewBox="${BOX}"
      preserveAspectRatio="none"
      fill="none" stroke="${theme.tile}" stroke-width="${STROKE}"
      stroke-linecap="round" stroke-linejoin="round">${GLYPH}</svg>
    <text x="${glyphW + gap}" y="${height / 2}" dominant-baseline="central"
      fill="${theme.ink}" font-size="${fontSize}" font-weight="600"
      letter-spacing="${tracking}">ELMER</text>
  </svg>`;
}

async function shoot(page, svg, file, expect) {
  await page.setContent(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
    { waitUntil: 'load' },
  );
  const el = await page.$('body > svg');
  await el.screenshot({ path: file, omitBackground: true });
  if (expect) {
    const got = await page.evaluate(() => {
      const s = document.querySelector('body > svg').getBoundingClientRect();
      return [Math.round(s.width), Math.round(s.height)];
    });
    if (got[0] !== expect[0] || got[1] !== expect[1]) {
      throw new Error(`${path.basename(file)} rendered ${got} not ${expect}`);
    }
  }
}

/** Trim a logo's canvas to its ink, which the brands spec asks for. */
async function measureLogo(page, height, theme) {
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}</style>${logoSvg(height, theme)}`,
    { waitUntil: 'load' },
  );
  return page.evaluate(() => {
    const t = document.querySelector('text');
    return Math.ceil(t.getBBox().x + t.getBBox().width);
  });
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ deviceScaleFactor: 1 });

fs.mkdirSync(OUT, { recursive: true });
const made = [];

for (const [name, theme] of [['icon', LIGHT], ['dark_icon', DARK]]) {
  for (const [suffix, px] of [['', 256], ['@2x', 512]]) {
    const file = path.join(OUT, `${name}${suffix}.png`);
    await shoot(page, iconSvg(px, theme), file, [px, px]);
    made.push([path.basename(file), `${px}x${px}`]);
  }
}

for (const [name, theme] of [['logo', LIGHT], ['dark_logo', DARK]]) {
  for (const [suffix, h] of [['', 256], ['@2x', 512]]) {
    const width = await measureLogo(page, h, theme);
    const svg = logoSvg(h, theme).replace(
      /width="\d+" height="(\d+)"\s+viewBox="0 0 \d+ \1"/,
      `width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"`,
    );
    const file = path.join(OUT, `${name}${suffix}.png`);
    await shoot(page, svg, file, [width, h]);
    made.push([path.basename(file), `${width}x${h}`]);
  }
}

// The README shows the wordmark too. Copying it here rather than linking into
// custom_components keeps the readable paths readable, and means the brand
// folder stays purely what Home Assistant consumes.
const images = path.join(ROOT, 'images');
fs.mkdirSync(images, { recursive: true });
for (const name of ['logo.png', 'dark_logo.png']) {
  fs.copyFileSync(path.join(OUT, name), path.join(images, name));
}

await browser.close();

for (const [file, size] of made) {
  const bytes = fs.statSync(path.join(OUT, file)).size;
  console.log(`  ${file.padEnd(18)} ${size.padEnd(10)} ${(bytes / 1024).toFixed(1)} KB`);
}
console.log(`\n${made.length} files in custom_components/elmer/brand/`);
