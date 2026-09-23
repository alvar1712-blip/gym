// Genera los PNG de icons/ a partir de icons/icon.svg con Chromium (Playwright).
// Uso: NODE_PATH=$(npm root -g) node scripts/make-icons.cjs
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const svg = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon.svg'), 'utf8');
  const b = await chromium.launch();
  const p = await b.newPage();
  const shots = [
    ['icon-180.png', 180, false], ['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true],
  ];
  for (const [name, size, maskable] of shots) {
    await p.setViewportSize({ width: size, height: size });
    // iOS recorta las esquinas él mismo: el PNG va a sangre (sin transparencia).
    const inner = maskable
      ? `<div style="width:${size}px;height:${size}px;background:#15181d;display:grid;place-items:center"><div style="width:${size * 0.8}px;height:${size * 0.8}px">${svg}</div></div>`
      : `<div style="width:${size}px;height:${size}px;background:#15181d">${svg.replace('rx="112" fill="#0b0d10"', 'rx="0" fill="#15181d"')}</div>`;
    await p.setContent(`<html><body style="margin:0;background:#15181d">${inner}<style>svg{width:100%;height:100%;display:block}</style></body></html>`);
    await p.screenshot({ path: path.join(__dirname, '..', 'icons', name), omitBackground: false });
  }
  await b.close();
  console.log('ok');
})();
