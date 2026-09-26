// E2E del núcleo: controles comunes (duración, avisos, compartir), router, pestañas, selector rápido
// y service worker (instalación, actualización y caché en uso).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { openApp, go, storeAll, shot, waitReady } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..', '..');
const wait = (page, ms) => page.waitForTimeout(ms);

test('duración: lo escrito es lo que se guarda (75 min = 4500 s) y al salir del campo se normaliza', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // Bici: 75 en «min» (la plantilla D3 propone 45–75 min)
    await go(page, '#/activity/new?kind=bike');
    const h = page.locator('input[aria-label="Tiempo: h"]');
    const m = page.locator('input[aria-label="Tiempo: min"]');
    await m.fill('75');
    await page.locator('.rpe-chips .chip', { hasText: /^5$/ }).click(); // sale del campo → normaliza
    assert.strictEqual(await h.inputValue(), '1');
    assert.strictEqual(await m.inputValue(), '15');
    await page.locator('.act-done').click();
    await wait(page, 400);
    const bike = (await storeAll(page, 'sessions')).find((s) => s.kind === 'bike');
    assert.strictEqual(bike.movingSec, 4500);
    assert.strictEqual(bike.durationMin, 75);
    await go(page, `#/activity/${bike.id}`);
    assert.strictEqual(await h.inputValue(), '1');
    assert.strictEqual(await m.inputValue(), '15');

    // Carrera: 20 min + 90 s → 21:30 (1290 s)
    await go(page, '#/activity/new?kind=run');
    const rm = page.locator('input[aria-label="Tiempo en movimiento: min"]');
    const rs = page.locator('input[aria-label="Tiempo en movimiento: s"]');
    await rm.fill('20');
    await rs.fill('90');
    await rs.dispatchEvent('change');
    assert.strictEqual(await rm.inputValue(), '21');
    assert.strictEqual(await rs.inputValue(), '30');
    await page.locator('.act-done').click();
    await wait(page, 400);
    const run = (await storeAll(page, 'sessions')).find((s) => s.kind === 'run');
    assert.strictEqual(run.movingSec, 1290);

    // Sin campo de horas: se admiten 3 cifras de minutos (120 min = 7200 s)
    const got = await page.evaluate(async () => {
      const ui = await import('./js/ui.js');
      let last = null;
      const el = ui.durationInput({ showHours: false, showSeconds: false, onChange: (v) => { last = v; } });
      document.body.appendChild(el);
      const inp = el.querySelector('input');
      inp.value = '120';
      inp.dispatchEvent(new Event('input'));
      inp.dispatchEvent(new Event('change'));
      const out = { last, shown: inp.value, value: el.getValue() };
      el.remove();
      return out;
    });
    assert.deepStrictEqual(got, { last: 7200, shown: '120', value: 7200 });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('avisos: «Deshacer» se cierra al cambiar de pantalla, sigue en la de destino y no tapa «Listo»', async () => {
  const app = await openApp();
  const { page } = app;
  const toastText = () => page.evaluate(() => document.querySelector('.toast')?.innerText || '');
  try {
    await go(page, '#/calendar');
    await page.evaluate(async () => { (await import('./js/ui.js')).undoToast('Día cambiado', () => {}); });
    assert.match(await toastText(), /Día cambiado/);
    await go(page, '#/today');
    await wait(page, 250);
    assert.strictEqual(await toastText(), '', 'el deshacer del calendario no sigue activo en Hoy');

    // Mostrado justo después de navegar (borrar y volver): pertenece a la pantalla de destino.
    await page.evaluate(async () => {
      const ui = await import('./js/ui.js');
      window.__app.navigate('#/history', { replace: true });
      ui.undoToast('Sesión borrada', () => {});
    });
    await wait(page, 400);
    assert.match(await toastText(), /Sesión borrada/);
    await go(page, '#/settings');
    await page.evaluate(async () => {
      const [ui, router] = await Promise.all([import('./js/ui.js'), import('./js/router.js')]);
      router.back('#/today');
      ui.undoToast('Actividad borrada', () => {});
    });
    await wait(page, 400);
    assert.match(await toastText(), /Actividad borrada/);
    assert.notStrictEqual(await page.evaluate(() => location.hash), '#/settings');

    // Un aviso informativo (sin acción) no se cierra al navegar.
    await page.evaluate(async () => { (await import('./js/ui.js')).toast('Peso guardado: 75 kg', { duration: 5000 }); });
    await go(page, '#/calendar');
    assert.match(await toastText(), /Peso guardado/);

    // En las actividades, el aviso sube por encima del pie fijo con «Listo».
    await go(page, '#/activity/new?kind=bike');
    await page.evaluate(async () => { (await import('./js/ui.js')).toast('Borrador recuperado', { actionLabel: 'Descartar', duration: 5000 }); });
    await wait(page, 300);
    const t = await page.locator('.toast').boundingBox();
    const done = await page.locator('.act-done').boundingBox();
    assert.ok(t.y + t.height <= done.y, `el aviso (${t.y}+${t.height}) no debe tapar «Listo» (${done.y})`);
    await shot(page, 'core-toast-footer');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('router y pestañas: % inválido no rompe, pestaña de origen al abrir una sesión, error con margen de la barra de estado', async () => {
  const app = await openApp();
  const { page, context } = app;
  try {
    // Pantalla de error (vista que no se puede cargar, como un archivo que falta sin conexión)
    const cdp = await context.newCDPSession(page);
    const inset = await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } }).then(() => true, () => false);
    // (una vista que Hoy no carga al arrancar: Hoy ya importa weekly.js y goals.js para sus tarjetas de la Fase 3)
    await context.route('**/js/views/progress.js', (r) => r.abort());
    await go(page, '#/records');
    await page.waitForSelector('.content-safe .card-danger');
    const pad = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.content-safe')).paddingTop));
    assert.ok(pad >= (inset ? 47 + 14 : 14), `padding-top ${pad}`);
    const cardTop = await page.locator('.content-safe .card-danger').boundingBox();
    if (inset) assert.ok(cardTop.y >= 47, 'la tarjeta de error empieza bajo la barra de estado');
    await shot(page, 'core-router-error');
    await context.unroute('**/js/views/progress.js');
    app.errors.length = 0; // el fallo de carga provocado deja errores en consola

    // Codificación % inválida: sin URIError y la pantalla corresponde a la URL
    await go(page, '#/today');
    await go(page, '#/session/%');
    await wait(page, 200);
    assert.ok(!app.errors.some((e) => /URI malformed/i.test(e)), app.errors.join('\n'));
    assert.strictEqual(await page.evaluate(() => document.body.dataset.route), '/session/:id');

    // Pestaña resaltada: la de origen (Calendario › Historial › sesión), «Hoy» si se abre desde Hoy
    const id = await page.evaluate(async () => {
      const u = await import('./js/util.js');
      const { store } = window.__app;
      const date = u.addDays(u.todayStr(), -3);
      const s = {
        id: 'ses_core', kind: 'strength', date, planDate: date, templateId: null, templateName: 'Libre', status: 'done',
        startedAt: u.tsFromDate(date, 18), endedAt: u.tsFromDate(date, 19), durationMin: 60, rpe: 7, notes: '', parentId: null, cursor: 0, exercises: [],
      };
      await store.save('sessions', s);
      return s.id;
    });
    const activeTab = () => page.evaluate(() => document.querySelector('#tabbar .tab.active')?.dataset.tab);
    await go(page, '#/history');
    assert.strictEqual(await activeTab(), 'calendar');
    await go(page, `#/session/${id}`);
    assert.strictEqual(await activeTab(), 'calendar');
    await go(page, '#/today');
    await go(page, `#/session/${id}`);
    assert.strictEqual(await activeTab(), 'today');
    // Una sesión en curso es siempre de «Hoy» (aunque se empiece desde el calendario)
    const active = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
    await go(page, '#/calendar');
    await go(page, `#/session/${active}`);
    assert.strictEqual(await activeTab(), 'today');
    // Las pestañas no muestran el menú de enlace de iOS al mantener pulsado
    const callout = await page.evaluate(() => getComputedStyle(document.querySelector('#tabbar .tab')).webkitTouchCallout ?? 'none');
    assert.strictEqual(callout, 'none');
    assert.deepStrictEqual(app.errors.filter((e) => !/Failed to load resource/.test(e)), []);
  } finally {
    await app.close();
  }
});

test('crear ejercicio rápido de cardio guarda el deporte; doble toque en «Exportar copia» no da la copia por hecha', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/today');
    const created = page.evaluate(async () => (await import('./js/pickers.js')).quickCreateExercise('Bici estática'));
    await page.locator('.sheet-panel .chip', { hasText: /^Cardio/ }).click();
    await page.locator('.sheet-panel .seg-btn', { hasText: 'Bici' }).click();
    await shot(page, 'core-quick-cardio');
    await page.locator('.sheet-panel .btn-primary', { hasText: 'Crear ejercicio' }).click();
    const exId = await created;
    const ex = await page.evaluate((i) => window.__app.store.exercise(i), exId);
    assert.strictEqual(ex.logType, 'cardio');
    assert.strictEqual(ex.sport, 'bike');

    // Hoja de compartir según la especificación: un segundo share() con otro abierto → InvalidStateError
    await page.evaluate(() => {
      let pending = null;
      navigator.canShare = () => true;
      navigator.share = () => {
        if (pending) return Promise.reject(new DOMException('An earlier share has not yet completed.', 'InvalidStateError'));
        pending = new Promise((res, rej) => {
          window.__finishShare = () => { pending = null; res(); };
          window.__cancelShare = () => { pending = null; rej(new DOMException('Share canceled', 'AbortError')); };
        });
        return pending;
      };
      window.__downloads = 0;
      const orig = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function click() { if (this.download) { window.__downloads++; return undefined; } return orig.call(this); };
    });
    await page.evaluate(() => window.__app.store.save('bodyweight', { id: '2026-09-20', kg: 75 }));
    await go(page, '#/settings/data');
    await page.locator('.cfg-export').dblclick();
    await wait(page, 300);
    let r = await page.evaluate(() => ({ downloads: window.__downloads, last: window.__app.store.settings().lastBackupAt }));
    assert.deepStrictEqual(r, { downloads: 0, last: null }, 'con la hoja aún abierta no hay copia');
    await page.evaluate(() => window.__cancelShare());
    await wait(page, 200);
    r = await page.evaluate(() => ({ downloads: window.__downloads, last: window.__app.store.settings().lastBackupAt }));
    assert.deepStrictEqual(r, { downloads: 0, last: null }, 'cancelada: sigue sin copia');
    await page.locator('.cfg-export').click();
    await page.evaluate(() => window.__finishShare());
    await wait(page, 300);
    r = await page.evaluate(() => ({ downloads: window.__downloads, last: window.__app.store.settings().lastBackupAt }));
    assert.strictEqual(r.downloads, 0);
    assert.ok(r.last > 0, 'compartida: se anota la copia');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('carga inicial: completa y en una transacción; una carga antigua a medias se recupera una vez', async () => {
  const app = await openApp();
  const { page } = app;
  const idb = (fn) => page.evaluate(fn);
  try {
    const first = await page.evaluate(() => ({ app: window.__app.store.get('meta', 'app'), ex: window.__app.store.count('exercises'), tpl: window.__app.store.count('templates') }));
    assert.strictEqual(first.app.seedComplete, true);
    assert.ok(first.ex > 50 && first.tpl >= 5);
    // Estado que dejaba la versión antigua si la primera apertura se cortaba tras escribir meta.
    await idb(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('entreno');
      req.onsuccess = () => {
        const tx = req.result.transaction(['meta', 'exercises', 'templates'], 'readwrite');
        tx.objectStore('exercises').clear();
        tx.objectStore('templates').clear();
        const meta = tx.objectStore('meta');
        meta.get('app').onsuccess = (e) => { const a = e.target.result; delete a.seedComplete; meta.put(a); };
        tx.oncomplete = () => { req.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    }));
    await page.reload();
    await waitReady(page);
    const fixed = await page.evaluate(() => ({ app: window.__app.store.get('meta', 'app'), ex: window.__app.store.count('exercises'), tpl: window.__app.store.count('templates') }));
    assert.strictEqual(fixed.ex, first.ex);
    assert.strictEqual(fixed.tpl, first.tpl);
    assert.strictEqual(fixed.app.seedComplete, true);
    // Una vez completa, borrar las rutinas es decisión del usuario: no reaparecen.
    await page.evaluate(async () => { for (const t of window.__app.store.all('templates')) await window.__app.store.remove('templates', t.id); });
    await page.reload();
    await waitReady(page);
    assert.strictEqual(await page.evaluate(() => window.__app.store.count('templates')), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// Service worker (copia de la app servida bajo /gym/, como GitHub Pages)
// ---------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function serveCopy(root) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith('/gym/')) { res.writeHead(404); res.end(); return; }
    p = p.slice(4);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, path.normalize(p));
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}/gym/`,
    close: () => new Promise((r) => server.close(r)),
  })));
}

test('service worker: primera instalación sin recarga; versión nueva con aviso fijo; misma VERSION no toca la caché en uso', async () => {
  const stampMod = await import(pathToFileURL(path.join(ROOT, 'scripts', 'stamp-sw.mjs')).href);
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'entreno-sw-'));
  for (const f of ['index.html', 'manifest.json', 'sw.js', 'js', 'css', 'icons']) fs.cpSync(path.join(ROOT, f), path.join(copy, f), { recursive: true });
  stampMod.stamp(copy);
  const server = await serveCopy(copy);
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'allow' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  let loads = 0;
  page.on('load', () => { loads++; });
  const edit = (f, fn) => fs.writeFileSync(path.join(copy, f), fn(fs.readFileSync(path.join(copy, f), 'utf8')));
  const update = () => page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()).then(() => true, (e) => String(e)));
  try {
    await page.goto(server.url);
    await waitReady(page);
    await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 15000 });
    await wait(page, 800);
    assert.strictEqual(loads, 1, 'la primera instalación no recarga la página');
    const v1 = await page.evaluate(() => caches.keys());
    assert.strictEqual(v1.length, 1);

    // Versión nueva (con stamp-sw). Antes, una instalación interrumpida dejó a medias la caché de esa versión.
    edit('js/views/today.js', (s) => s.replace("title: 'Hoy'", "title: 'Hoy v2'"));
    const next = stampMod.computeVersion(copy).expected;
    await page.evaluate(async (name) => { const c = await caches.open(name); await c.put('index.html', new Response('a medias')); }, `entreno-${next}`);
    stampMod.stamp(copy);
    await update();
    await page.waitForSelector('.update-bar:not([hidden])', { timeout: 10000 });
    // Otro aviso no lo sustituye
    await page.evaluate(async () => { (await import('./js/ui.js')).toast('Peso guardado: 75 kg'); });
    assert.ok(await page.locator('.update-bar').isVisible());
    await shot(page, 'core-update-bar');
    // «Ahora no» y la app vuelve a primer plano: se vuelve a ofrecer
    await page.locator('.update-bar-close').click();
    assert.strictEqual(await page.locator('.update-bar').count(), 0);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForSelector('.update-bar:not([hidden])', { timeout: 5000 });
    // No se ve fuera de las pantallas raíz (no interrumpe un formulario)
    await go(page, '#/activity/new?kind=run');
    assert.strictEqual(await page.locator('.update-bar').isVisible(), false);
    await go(page, '#/today');
    await Promise.all([page.waitForEvent('load'), page.locator('.update-bar-btn').click()]);
    await waitReady(page);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Hoy v2');
    assert.deepStrictEqual(await page.evaluate(() => caches.keys()), [`entreno-${next}`]);
    const idx = await page.evaluate(() => fetch('index.html').then((r) => r.text()));
    assert.match(idx, /<title>Entreno<\/title>/, 'la caché a medias se rehízo');

    // sw.js distinto con la MISMA VERSION: la instalación falla y la caché en uso queda intacta.
    edit('sw.js', (s) => `${s}\n// cambio sin stamp\n`);
    edit('js/ui.js', (s) => `${s}\nexport const NUEVO = 1;\n`);
    edit('js/views/history.js', (s) => `import { NUEVO } from '../ui.js';\n${s}`);
    await update();
    await wait(page, 1500);
    assert.strictEqual(await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => !!r.waiting)), false);
    assert.strictEqual(await page.locator('.update-bar').count(), 0);
    await go(page, '#/history');
    await wait(page, 300);
    const txt = await page.locator('#view').innerText();
    assert.ok(!txt.includes('Algo ha fallado'), txt.slice(0, 300));
    assert.deepStrictEqual(errors, []);
  } finally {
    await browser.close();
    await server.close();
    fs.rmSync(copy, { recursive: true, force: true });
  }
});
