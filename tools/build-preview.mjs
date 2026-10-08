// Build a standalone preview of the panel: one HTML file that opens from disk,
// with no server, no Home Assistant and no install.
//
// It bundles the real panel source together with the test harness's fake hass,
// so what you are looking at is the shipping code driven by sample data — not a
// mockup that can drift away from it.
//
//     node tools/build-preview.mjs [output.html] [--empty]
//
// --empty opens on a fresh install rather than the sample house, which is what
// somebody sees the first time they open the panel.

import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const args = process.argv.slice(2);
const EMPTY = args.includes('--empty');
const OUT = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'elmer-ha-preview.html');

const result = await build({
  entryPoints: [path.join(ROOT, 'tools/harness/fake-hass.js')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].text;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Elmer for Home Assistant</title>
<style>
  html, body { margin: 0; height: 100%; background: #d8dedb;
    font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
  .bar { position: fixed; top: 0; left: 0; right: 0; height: 48px; display: flex;
    align-items: center; gap: 10px; padding: 0 16px; background: #16211e;
    color: #e9efec; font-size: 13px; z-index: 999; }
  .bar b { font-weight: 650; letter-spacing: 0.08em; }
  .bar .note { opacity: 0.55; }
  .bar .sp { flex: 1; }
  .bar button { background: #2a3230; color: #e9efec; border: 0; border-radius: 8px;
    padding: 8px 12px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
    white-space: nowrap; flex: none; }
  .bar button:hover { background: #3a4441; }
  .stage { position: fixed; inset: 48px 0 0; display: grid; place-items: center;
    overflow: auto; padding: 20px; }
  .frame { width: 390px; height: 844px; border-radius: 32px; overflow: hidden;
    background: #fff; box-shadow: 0 24px 60px rgba(22,33,30,0.3);
    transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease; }
  .frame[data-wide] { width: min(1200px, calc(100vw - 40px));
    height: min(900px, calc(100vh - 104px)); border-radius: 12px; }
  elmer-panel { display: block; height: 100%; }
  @media (max-width: 760px) { .bar .note { display: none; } }
  @media (max-width: 460px) {
    .stage { padding: 0; }
    .frame { width: 100%; height: 100%; border-radius: 0; box-shadow: none; }
    .bar .note { display: none; }
  }
</style>
</head>
<body>
<div class="bar">
  <b>ELMER</b>
  <span class="note">Home Assistant sidebar panel &middot; ${EMPTY ? 'a fresh install' : 'sample data'}, nothing is saved</span>
  <span class="sp"></span>
  <button id="data">${EMPTY ? 'Add the sample house' : 'Empty it'}</button>
  <button id="size">Desktop width</button>
  <button id="theme">Dark</button>
</div>
<div class="stage"><div class="frame" id="frame"></div></div>
<script>
${js}
</script>
<script>
  // The bundle appends the panel to the body; move it into the device frame.
  (function () {
    var frame = document.getElementById('frame');
    var panel = window.__panel;
    frame.appendChild(panel);
    panel.narrow = true;

    document.getElementById('size').onclick = function (e) {
      var wide = frame.hasAttribute('data-wide');
      if (wide) {
        frame.removeAttribute('data-wide');
        panel.narrow = true;
        e.target.textContent = 'Desktop width';
      } else {
        frame.setAttribute('data-wide', '');
        panel.narrow = false;
        e.target.textContent = 'Phone width';
      }
    };

    var empty = ${EMPTY ? 'true' : 'false'};
    if (empty) window.__setData('empty');
    document.getElementById('data').onclick = function (e) {
      empty = !empty;
      window.__setData(empty ? 'empty' : 'sample');
      e.target.textContent = empty ? 'Add the sample house' : 'Empty it';
    };

    document.getElementById('theme').onclick = function (e) {
      var hass = panel.hass;
      hass.themes.darkMode = !hass.themes.darkMode;
      panel.hass = hass;           // re-running the setter is what re-reads it
      e.target.textContent = hass.themes.darkMode ? 'Light' : 'Dark';
    };
  }());
</script>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
console.log(`${OUT}  ${(html.length / 1024).toFixed(0)} KB`);
