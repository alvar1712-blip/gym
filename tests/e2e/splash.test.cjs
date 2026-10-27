// Pantalla de arranque (index.html #splash, js/app.js hideSplash; docs/PULIDO.md §27):
//   · el logo (el símbolo de icons/icon.svg, sin fondo) centrado y «by Álvar» abajo, por encima de la safe area;
//   · mientras está, no se puede tocar nada de debajo (la app es inerte y el splash recibe el toque);
//   · dura máx(800 ms, Hoy listo): nunca menos de 800 ms desde que se ve, y si Hoy tarda más no se añade espera;
//   · Hoy está completo DEBAJO antes de empezar a fundir (las tarjetas ya están); después sale del DOM;
//   · movimiento reducido: sin animación de entrada y salida casi instantánea;
//   · volver a primer plano o navegar no la vuelve a enseñar; sin conexión (service worker) arranca igual;
//   · un mismo fondo en todas partes (CSS, theme-color, manifest) y una imagen de arranque de iOS por iPhone.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/splash.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const playwright = require('playwright');
const { engineAvailable } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..', '..');
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const MIN = 800;

async function launch(browserName, { width = 390, height = 844, reducedMotion = 'no-preference', serviceWorkers = 'block' } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'tests', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await playwright[browserName].launch();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion, serviceWorkers });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return { server, browser, context, page, errors, close: async () => { await browser.close(); await server.close(); } };
}
const gone = (page) => page.waitForFunction(() => !document.getElementById('splash'), null, { timeout: 15000 });

async function flow(browserName) {
  const app = await launch(browserName);
  const { page } = app;
  try {
    await page.goto(app.server.url);
    await page.waitForSelector('#splash');
    // Mientras está: cubre la pantalla, la app es inerte y un toque en el centro cae en el splash
    const during = await page.evaluate(() => {
      const s = document.getElementById('splash');
      const r = s.getBoundingClientRect();
      const mark = s.querySelector('.splash-mark').getBoundingClientRect();
      const by = s.querySelector('.splash-by');
      const byR = by.getBoundingClientRect();
      const hit = document.elementFromPoint(innerWidth / 2, innerHeight * 0.7);
      return {
        covers: r.left <= 0 && r.top <= 0 && r.right >= innerWidth && r.bottom >= innerHeight,
        inert: document.getElementById('app').hasAttribute('inert'),
        hitSplash: !!hit && s.contains(hit),
        markCx: mark.left + mark.width / 2, markCy: mark.top + mark.height / 2, markW: mark.width,
        byText: by.textContent.trim(), byBottom: byR.bottom, byColor: getComputedStyle(by).color,
        bg: getComputedStyle(s).backgroundColor, vw: innerWidth, vh: innerHeight,
        noTechText: !/Cargando|%/.test(s.textContent),
      };
    });
    assert.ok(during.covers, 'cubre toda la pantalla');
    assert.ok(during.inert, 'la app de debajo no se puede tocar');
    assert.ok(during.hitSplash, 'un toque cae en el splash, no en Hoy');
    assert.ok(Math.abs(during.markCx - during.vw / 2) <= 1 && Math.abs(during.markCy - during.vh / 2) <= 1, 'logo centrado');
    assert.ok(during.markW >= 70 && during.markW <= 90, `logo de 70–90 px (${during.markW})`);
    assert.strictEqual(during.byText, 'by Álvar');
    assert.ok(during.byBottom <= during.vh - 32, 'la firma queda separada del borde inferior');
    assert.strictEqual(during.bg, 'rgb(11, 13, 16)', 'el fondo de la app (#0b0d10)');
    assert.ok(during.noTechText, 'sin «Cargando…» ni porcentajes');

    // Antes de fundir, Hoy ya está completo debajo
    const atFade = await page.evaluate(() => new Promise((resolve) => {
      const s = document.getElementById('splash');
      const obs = new MutationObserver(() => {
        if (!s.classList.contains('splash-out')) return;
        obs.disconnect();
        resolve({ today: !!document.querySelector('.today'), cards: !!document.querySelector('.today-extra[data-ready]') });
      });
      obs.observe(s, { attributes: true, attributeFilter: ['class'] });
    }));
    assert.deepStrictEqual(atFade, { today: true, cards: true }, 'Hoy completo bajo el logo al empezar a fundir');
    await gone(page);
    const b = await page.evaluate(() => ({ ...window.__boot, inert: document.getElementById('app').hasAttribute('inert'), done: document.documentElement.classList.contains('splash-done') }));
    // Duración = máx(mínimo, Hoy listo) + un par de fotogramas; nunca una espera añadida tras estar lista
    // (los tiempos de window.__boot ya cuentan desde t0, el momento en que el splash es visible)
    assert.ok(b.fadeStart >= MIN - 5, `al menos ${MIN} ms visible (${Math.round(b.fadeStart)})`);
    assert.ok(b.fadeStart <= Math.max(MIN, b.appReady) + 60, `sin espera extra: lista a ${Math.round(b.appReady)}, funde a ${Math.round(b.fadeStart)}`);
    assert.ok(b.interactive - b.fadeStart < 400, 'el fundido es corto');
    assert.ok(!b.inert && b.done, 'después, la app se puede tocar y no queda ninguna capa');
    // Navegar o volver a primer plano no la enseña otra vez
    await page.evaluate(() => window.__app.navigate('#/progress'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.strictEqual(await page.locator('#splash').count(), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('arranque: logo centrado, firma, nada tocable debajo, máx(800 ms, Hoy listo) y Hoy completo al fundir', () => flow('chromium'));
test('WebKit: arranque con el mismo comportamiento', { skip: skipWebkit }, () => flow('webkit'));

test('arranque lento (CPU ×8): el splash dura lo que tarda Hoy, sin sumar el mínimo', async () => {
  const app = await launch('chromium');
  const { page } = app;
  try {
    const cdp = await app.context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 });
    await page.goto(app.server.url);
    await gone(page);
    const b = await page.evaluate(() => window.__boot);
    assert.ok(b.appReady > MIN, `con la CPU frenada, Hoy tarda más que el mínimo (${Math.round(b.appReady)})`);
    assert.ok(b.fadeStart - b.appReady < 60, `funde nada más estar lista (${Math.round(b.fadeStart - b.appReady)} ms después)`);
  } finally {
    await app.close();
  }
});

test('movimiento reducido: sin animación de entrada y salida casi instantánea', async () => {
  const app = await launch('chromium', { reducedMotion: 'reduce' });
  const { page } = app;
  try {
    await page.goto(app.server.url);
    await page.waitForSelector('#splash');
    assert.strictEqual(await page.evaluate(() => document.getElementById('splash').getAnimations({ subtree: true }).length), 0);
    await gone(page);
    const b = await page.evaluate(() => window.__boot);
    assert.ok(b.fadeStart >= MIN - 5, 'mantiene el pequeño tiempo visible');
    assert.ok(b.interactive - b.fadeStart < 200, `salida casi instantánea (${Math.round(b.interactive - b.fadeStart)} ms)`);
  } finally {
    await app.close();
  }
});

test('sin conexión con el service worker: arranca con el splash y entra en Hoy', async () => {
  const app = await launch('chromium', { serviceWorkers: 'allow' });
  const { page } = app;
  try {
    await page.goto(app.server.url);
    await gone(page);
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.ready).active);
    await page.reload(); // que la página quede controlada por el service worker
    await gone(page);
    await app.context.setOffline(true);
    // Esta prueba es de la bienvenida: con una marca de uso antigua (la de uso reciente, que la omite, se prueba en
    // «reapertura»). Se fija al cargar la página nueva: al recargar, pagehide vuelve a marcar el uso.
    await page.addInitScript(() => localStorage.setItem('entreno.lastActive', String(Date.now() - 400000)));
    await page.reload();
    await page.waitForSelector('#splash');
    await gone(page);
    assert.ok(await page.locator('.today').count() === 1, 'Hoy sin conexión');
  } finally {
    await app.close();
  }
});

test('un mismo fondo: CSS, theme-color y manifest; imágenes de arranque de iOS presentes y del tamaño de su media query', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
  const bg = css.match(/--bg:\s*(#[0-9a-f]{6})/i)[1].toLowerCase();
  assert.strictEqual(bg, '#0b0d10');
  assert.strictEqual(html.match(/name="theme-color" content="([^"]+)"/)[1].toLowerCase(), bg);
  assert.strictEqual(manifest.background_color.toLowerCase(), bg);
  assert.strictEqual(manifest.theme_color.toLowerCase(), bg);
  assert.match(html, /html, body \{ background: #0b0d10; \}/);
  assert.doesNotMatch(html, /Cargando/);
  const links = [...html.matchAll(/rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)/g)];
  assert.ok(links.length >= 10, 'una imagen por tamaño de iPhone');
  for (const [, href, w, h, dpr] of links) {
    const buf = fs.readFileSync(path.join(ROOT, href));
    assert.strictEqual(buf.readUInt32BE(16), Number(w) * Number(dpr), `${href}: ancho`);
    assert.strictEqual(buf.readUInt32BE(20), Number(h) * Number(dpr), `${href}: alto`);
  }
});

// ---------------------------------------------------------------------------
// Reapertura: la bienvenida solo vuelve tras 5 min sin usar la app (js/app.js trackActivity; index.html, <head>)
// ---------------------------------------------------------------------------
const KEY = 'entreno.lastActive';
const WELCOME_AFTER = 5 * 60 * 1000;

/** Abre la app con la última actividad hace `ageMs` (null: sin marca) y devuelve lo que se vio al empezar y al final. */
async function reopen(ageMs, { browserName = 'chromium', reducedMotion = 'no-preference' } = {}) {
  const app = await launch(browserName, { reducedMotion });
  const { page } = app;
  await page.goto(`${app.server.url}tests/fixtures/blank.html`);
  await page.evaluate(({ KEY, ageMs }) => { if (ageMs == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(Date.now() - ageMs)); }, { KEY, ageMs });
  // Qué se ve ANTES del primer fotograma de la app: la decisión no puede ser «enseñar y quitar»
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.getElementById('splash');
      window.__first = { skipClass: document.documentElement.classList.contains('splash-skip'), display: s ? getComputedStyle(s).display : 'none' };
    });
  });
  await page.goto(app.server.url);
  await page.waitForFunction(() => document.documentElement.classList.contains('ready') && !document.getElementById('splash'), null, { timeout: 15000 });
  const seen = await page.evaluate(() => ({ first: window.__first, boot: { ...window.__boot }, inert: document.getElementById('app').hasAttribute('inert'), today: !!document.querySelector('.today') }));
  return { app, page, seen };
}

async function reopenCase(ageMs, expectSkip, browserName = 'chromium') {
  const { app, seen } = await reopen(ageMs, { browserName });
  try {
    assert.strictEqual(seen.first.skipClass, expectSkip, `clase splash-skip antes del primer fotograma (${ageMs} ms de inactividad)`);
    assert.strictEqual(seen.first.display === 'none', expectSkip, 'la bienvenida está oculta ANTES de pintar solo si se omite');
    assert.strictEqual(!!seen.boot.skipped, expectSkip);
    if (expectSkip) assert.strictEqual(seen.boot.fadeStart, undefined, 'sin fundido: nunca se enseñó');
    else assert.ok(seen.boot.fadeStart >= MIN - 5, 'bienvenida habitual: al menos 800 ms');
    assert.ok(!seen.inert && seen.today, 'la app se puede tocar y Hoy está montado');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('reapertura a 1 min de usarla: sin bienvenida, directo a Hoy (decidido antes del primer fotograma)', () => reopenCase(60 * 1000, true));
test('reapertura justo dentro del límite (4 min 59 s): sin bienvenida', () => reopenCase(WELCOME_AFTER - 1000, true));
test('reapertura tras más de 5 min sin usarla: bienvenida habitual con icono y nombre', () => reopenCase(WELCOME_AFTER + 1000, false));
test('primera vez o sin marca de uso: bienvenida habitual', () => reopenCase(null, false));
test('WebKit: reapertura reciente sin bienvenida y reapertura tardía con ella', { skip: skipWebkit }, async () => {
  await reopenCase(60 * 1000, true, 'webkit');
  await reopenCase(WELCOME_AFTER + 1000, false, 'webkit');
});

test('uso reciente con la app viva (bloquear y desbloquear): no vuelve la bienvenida y conserva pantalla; la marca se escribe al tocar y al pasar a segundo plano', async () => {
  const { app, page } = await reopen(WELCOME_AFTER + 1000); // arranca con bienvenida: tras ella se marca el uso
  try {
    const mark = () => page.evaluate((k) => Number(localStorage.getItem(k)), KEY);
    const now = () => page.evaluate(() => Date.now());
    assert.ok(Math.abs((await now()) - (await mark())) < 5000, 'al acabar la bienvenida se marca el uso');
    // Tocar: se escribe como mucho cada 15 s (sin temporizadores)
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
    await page.mouse.click(5, 5);
    assert.ok(Math.abs((await now()) - (await mark())) < 5000, 'un toque marca el uso');
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
    await page.mouse.click(5, 5);
    assert.strictEqual(await mark(), 0, 'segundo toque dentro de 15 s: no se vuelve a escribir');
    // Bloquear: pasa a segundo plano (escribe) y al desbloquear sigue donde estaba, sin bienvenida
    await page.evaluate(() => window.__app.navigate('#/progress'));
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.ok(Math.abs((await now()) - (await mark())) < 5000, 'pasar a segundo plano marca el uso');
    await page.evaluate(() => {
      delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.strictEqual(await page.locator('#splash').count(), 0);
    assert.strictEqual(await page.evaluate(() => location.hash.split('?')[0]), '#/progress', 'misma pantalla');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
