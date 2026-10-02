// Utilidades para pruebas E2E con Playwright: iPhone 13 emulado en Chromium (por defecto) o en WebKit, el motor de
// Safari (openApp({ browser: 'webkit' }) o E2E_BROWSER=webkit). WebKit en Linux necesita
// `scripts/setup-webkit.sh` una vez por máquina (docs/PRUEBAS.md).
// Ejecutar con: NODE_PATH=$(npm root -g) node --test tests/e2e/
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const playwright = require('playwright');

const { devices } = playwright;
/** Motor por defecto: 'chromium', o 'webkit' con E2E_BROWSER=webkit. */
const BROWSER = process.env.E2E_BROWSER === 'webkit' ? 'webkit' : 'chromium';

/** ¿Está instalado el navegador de ese motor? (WebKit no viene de serie en todas las máquinas). */
function engineAvailable(name = BROWSER) {
  try {
    return fs.existsSync(playwright[name].executablePath());
  } catch {
    return false;
  }
}

async function startServer() {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  return mod.startServer(0);
}

/**
 * Abre la app en un contexto iPhone nuevo (almacenamiento vacío).
 * @param {{serviceWorkers?:'block'|'allow', hash?:string, browser?:'chromium'|'webkit', beforeLoad?:(page)=>Promise}} [opts]
 *   beforeLoad: se ejecuta en una página del mismo origen ANTES de cargar la app (p. ej. crear una base de datos antigua).
 * @returns {{browser, context, page, server, url, errors:string[], close:()=>Promise<void>}}
 */
async function openApp({ serviceWorkers = 'block', hash = '', browser: name = BROWSER, beforeLoad = null } = {}) {
  const server = await startServer();
  const browser = await playwright[name].launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  if (beforeLoad) {
    await page.goto(`${server.url}tests/fixtures/blank.html`);
    await beforeLoad(page);
  }
  await page.goto(server.url + (hash ? `#${hash.replace(/^#/, '')}` : ''));
  await waitReady(page);
  return {
    browser, context, page, server, url: server.url, errors,
    close: async () => { await browser.close(); await server.close(); },
  };
}

async function waitReady(page) {
  await page.waitForFunction(() => document.documentElement.classList.contains('ready'), null, { timeout: 15000 });
}

/** Recarga la página (simula cerrar y volver a abrir la app). */
async function reload(page) {
  await page.reload();
  await waitReady(page);
}

/** Navega por hash y espera a que la vista se monte. */
async function go(page, hash) {
  await page.evaluate((h) => window.__app.navigate(h), hash.startsWith('#') ? hash : `#${hash}`);
  await page.waitForTimeout(150);
}

/** Lee datos del store en memoria. */
async function storeAll(page, storeName) {
  return page.evaluate((s) => window.__app.store.all(s), storeName);
}

/** Lee directamente IndexedDB (lo que está en disco). */
async function idbAll(page, storeName) {
  return page.evaluate((s) => new Promise((resolve, reject) => {
    const req = indexedDB.open('entreno');
    req.onsuccess = () => {
      const tx = req.result.transaction(s, 'readonly');
      const r = tx.objectStore(s).getAll();
      r.onsuccess = () => { resolve(r.result); req.result.close(); };
      r.onerror = () => reject(r.error);
    };
    req.onerror = () => reject(req.error);
  }), storeName);
}

async function shot(page, name) {
  const dir = path.join(__dirname, '..', '..', 'test-results');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

module.exports = { openApp, waitReady, reload, go, storeAll, idbAll, shot, devices, BROWSER, engineAvailable };
