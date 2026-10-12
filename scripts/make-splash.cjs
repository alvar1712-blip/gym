// Genera las imágenes de arranque de iOS (apple-touch-startup-image) a partir de la pantalla de arranque de
// index.html (#splash y su <style> en línea): misma marca, mismo fondo, misma posición de «by Álvar» con el margen
// inferior (safe area) de cada iPhone. Así la pantalla que pinta iOS antes de cargar la web y la nuestra son la
// misma imagen. Escribe splash/*.png y, entre los marcadores de index.html, sus <link> con media queries.
// Uso: NODE_PATH=$(npm root -g) node scripts/make-splash.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// [ancho CSS, alto CSS, densidad, safe area inferior en vertical (px CSS), modelos]
const DEVICES = [
  [320, 568, 2, 0, 'SE (1.ª)'],
  [375, 667, 2, 0, 'SE (2.ª/3.ª), 8'],
  [375, 812, 3, 34, 'X/XS/11 Pro/12 mini/13 mini'],
  [390, 844, 3, 34, '12/13/14'],
  [393, 852, 3, 34, '14 Pro/15/15 Pro/16'],
  [402, 874, 3, 34, '16 Pro'],
  [414, 896, 2, 34, 'XR/11'],
  [414, 896, 3, 34, 'XS Max/11 Pro Max'],
  [428, 926, 3, 34, '12/13 Pro Max/14 Plus'],
  [430, 932, 3, 34, '14 Pro Max/15 Plus/15 Pro Max/16 Plus'],
  [440, 956, 3, 34, '16 Pro Max'],
];

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  const splash = html.match(/<div id="splash"[\s\S]*?<\/svg>\s*<div class="splash-by"[^>]*>[^<]*<\/div>\s*<\/div>/)[0];
  fs.mkdirSync(path.join(ROOT, 'splash'), { recursive: true });
  const browser = await chromium.launch();
  const links = [];
  for (const [w, h, dpr, inset, models] of DEVICES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const css = style.replace(/env\(safe-area-inset-bottom, 0px\)/g, `${inset}px`);
    await page.setContent(`<!doctype html><html class="splash-static"><head><meta charset="utf-8"><style>${css} body{margin:0}</style></head><body>${splash}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    const name = `splash-${w * dpr}x${h * dpr}.png`;
    await page.screenshot({ path: path.join(ROOT, 'splash', name) });
    await page.close();
    links.push(`  <link rel="apple-touch-startup-image" href="splash/${name}" media="(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)"><!-- ${models} -->`);
  }
  await browser.close();
  const START = '  <!-- splash:start (scripts/make-splash.cjs) -->';
  const END = '  <!-- splash:end -->';
  const block = [START, ...links, END].join('\n');
  const out = html.includes(START)
    ? html.replace(new RegExp(`${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END}`), block)
    : html.replace('  <link rel="stylesheet" href="css/app.css">', `${block}\n  <link rel="stylesheet" href="css/app.css">`);
  fs.writeFileSync(path.join(ROOT, 'index.html'), out);
  console.log(`ok: ${DEVICES.length} imágenes en splash/`);
})();
