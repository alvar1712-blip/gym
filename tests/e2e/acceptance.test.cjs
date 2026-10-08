// PRUEBAS DE ACEPTACIÓN (docs/REQUISITOS.md §15), de punta a punta y por la interfaz real.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/acceptance.test.cjs
//
//  1. «Cierro Safari o la app a mitad de sesión, vuelvo y no se ha perdido nada.»
//  2. «Exporto una copia, borro los datos, importo la copia y todo queda idéntico.»
//  3. «Registrar una serie con los valores prellenados me cuesta 1–2 toques.»
//  4. «Sustituir el Día 6 de esta semana por una ruta en bici no modifica mi semana tipo.»
//  5. «Funciona sin conexión una vez instalada en la pantalla de inicio.»
//  6. «Cada sugerencia del panel muestra su "¿Por qué?" con los datos concretos que la generan.» (Fase 3)
//
// La fecha se fija con el reloj de Playwright (context.clock.install, el tiempo sigue corriendo) ANTES de
// abrir la app por primera vez, para que la instalación, la semana tipo y el «Hoy» sean deterministas:
// semana del lunes 21 al domingo 27 de septiembre de 2026 (Día 1 el lunes, Día 6 el sábado).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
// Motor: Chromium por defecto o WebKit con E2E_BROWSER=webkit (fase H de la ronda 6).
const playwright = require('playwright');
const { devices } = playwright;
const { waitReady, go, reload, storeAll, idbAll, shot, BROWSER, chromiumOnly, useExampleWeek } = require('./helpers.cjs');

const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];
const PREV_MON = '2026-09-14';
const MON = '2026-09-21';
const WED = '2026-09-23';
const SAT = '2026-09-26';
const NEXT_WEEK = '2026-09-28';
const NEXT_SAT = '2026-10-03';
/** Hora local de Madrid (CEST, +02:00, hasta el 25 de octubre). */
const madrid = (date, hhmm = '18:00') => new Date(`${date}T${hhmm}:00+02:00`);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Registra errores de la página (excepciones y console.error) en `errors`. */
function watchErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
}

/**
 * Servidor estático que publica la app bajo una subruta, como GitHub Pages (https://usuario.github.io/gym/).
 * `close()` corta también las conexiones abiertas (keep-alive): después no responde NADA.
 */
function startPagesServer(prefix = '/gym/') {
  const ROOT = path.resolve(__dirname, '..', '..');
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (!p.startsWith(prefix)) { res.writeHead(404); res.end('404'); return; }
    p = p.slice(prefix.length - 1);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, path.normalize(p));
    if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  });
  let closed = null;
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    close: () => {
      if (!closed) closed = new Promise((r) => { server.close(() => r()); server.closeAllConnections(); });
      return closed;
    },
  })));
}

/**
 * Como helpers.openApp(), pero instala el reloj ANTES de la primera carga (la «instalación» de la app
 * ocurre ya en la fecha fijada). `pages: true` publica la app bajo /gym/ (como GitHub Pages).
 * Devuelve {browser, context, page, server, url, errors, newPage, close}.
 */
async function launch({ time, serviceWorkers = 'block', hash = '', init = null, pages = false } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = pages ? await startPagesServer('/gym/') : await startServer(0);
  const browser = await playwright[BROWSER].launch();
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers });
  if (time) await context.clock.install({ time });
  if (init) await context.addInitScript(init);
  const errors = [];
  const newPage = async (h = hash) => {
    const p = await context.newPage();
    watchErrors(p, errors);
    await p.goto(server.url + (h ? `#${h.replace(/^#/, '')}` : ''));
    await waitReady(p);
    return p;
  };
  const page = await newPage();
  // Las pruebas de aceptación son las de un usuario con su semana tipo (la de ejemplo): desde la ronda 8 (B2) un perfil
  // nuevo empieza sin ella, así que se siembra explícitamente. Con service worker NO se recarga aquí: la prueba de la
  // instalación (criterio 5) comprueba que la primera visita no se recarga, y una recarga del arnés con el SW ya
  // activo (WebKit lo activa antes) la cargaría controlada. La semana queda en memoria y en disco igualmente.
  if (serviceWorkers === 'allow') {
    await page.evaluate(async () => {
      const { exampleWeekPatterns } = await import('./js/seed.js');
      await window.__app.store.saveSettings({ weekPatterns: exampleWeekPatterns() });
    });
  } else await useExampleWeek(page);
  return {
    browser, context, page, server, url: server.url, errors, newPage,
    close: async () => { await browser.close(); await server.close(); },
  };
}

const hashOf = (page) => page.evaluate(() => location.hash);
const getSession = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', i))), id);
const card = (page, seId) => page.locator(`[data-se="${seId}"]`);
/** El botón «Registrar» ignora un segundo toque durante 400 ms (doble toque accidental). */
const guard = (page) => page.waitForTimeout(450);
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
const sheetBtn = (page, text) => sheetPanel(page).locator('button', { hasText: text });
const waitNoSheet = (page) => page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 5000 });
const tab = (page, id) => page.locator(`#tabbar .tab[data-tab="${id}"]`);
/** Sale de la sesión en curso por «Hoy» de la barra de la sesión (modo foco; la sesión sigue abierta). */
async function leaveSession(page) {
  await page.locator('#tabbar .fb-exit').click();
  await page.waitForFunction(() => location.hash === '#/today' && !document.getElementById('tabbar').classList.contains('tabbar-focus'));
}
const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

const settingsOf = (snap) => snap.meta.find((m) => m.id === 'settings');

/**
 * Ejecuta `action` (navegación) y espera a que se monte la vista NUEVA (con su cabecera) o la pantalla de error
 * del router; así no se lee por error la vista anterior mientras se carga el módulo de la siguiente.
 */
async function freshView(page, action) {
  await page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
  await action();
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    return !!el && !el.dataset.stale && !!el.querySelector('.topbar, .card-danger');
  }, null, { timeout: 5000 });
}

/**
 * Todas las stores tal como están en IndexedDB (disco). Sin los registros reservados de 'meta' (el punto de
 * restauración del dispositivo, ronda 8 B3: no son datos de la app ni viajan en las copias).
 */
async function idbSnapshot(page) {
  const out = {};
  for (const s of STORES) out[s] = byId((await idbAll(page, s)).filter((o) => !String(o.id).startsWith('~')));
  return out;
}

/** Espera (sondeando IndexedDB, no la memoria) a que `pred(sesión en disco)` se cumpla. */
async function waitDiskSession(page, id, pred, timeout = 3000) {
  const t0 = Date.now();
  let last = null;
  for (;;) {
    last = (await idbAll(page, 'sessions')).find((x) => x.id === id) || null;
    if (last && pred(last)) return last;
    if (Date.now() - t0 > timeout) assert.fail(`la sesión ${id} no llegó a disco con el estado esperado: ${JSON.stringify(last)?.slice(0, 400)}`);
    await page.waitForTimeout(50);
  }
}

/** Sesión de Día 1 terminada (historial para «Última vez»). */
async function seedLastD1(page, date) {
  await page.evaluate(async (d) => {
    const u = await import('./js/util.js');
    const { store } = window.__app;
    const at = u.tsFromDate(d, 18);
    const set = (type, weight, reps, rir) => ({ id: u.uid('set_'), type, weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: at });
    const se = (exerciseId, templateItemId, sets) => ({
      id: u.uid('se_'), exerciseId, exName: store.exercise(exerciseId).name, templateItemId, baseExerciseId: exerciseId, alternatives: [],
      target: { sets: 3 }, notes: '', note: '', section: '', groupId: null, groupType: null, sets,
    });
    await store.save('sessions', {
      id: 'hist_d1', kind: 'strength', date: d, planDate: d, templateId: 'tpl_d1', templateName: store.get('templates', 'tpl_d1').name,
      status: 'done', startedAt: at, endedAt: at + 3600000, durationMin: 60, rpe: 8, notes: '', parentId: null, templateItemId: null, cursor: 0,
      exercises: [
        se('press_banca', 'ti_d1_1', [set('warmup', 40, 8, null), set('effective', 80, 6, 2), set('effective', 80, 5, 1), set('effective', 77.5, 6, 1)]),
        se('dominadas', 'ti_d1_2', [set('effective', 10, 8, 1), set('effective', 10, 7, 1), set('effective', 10, 6, 0)]),
      ],
    });
  }, date);
}

/** Hoy → «Empezar» (1 toque) → espera a la pantalla de la sesión. Devuelve el id de la sesión. */
async function startTodayFromHoy(page) {
  if ((await hashOf(page)) !== '#/today') await tab(page, 'today').click();
  await page.waitForSelector('.today-plan .today-start');
  assert.match(await page.locator('.today-plan .today-start').innerText(), /Empezar/);
  await page.locator('.today-plan .today-start').click();
  await page.waitForFunction(() => /^#\/session\/[^/]+$/.test(location.hash), null, { timeout: 5000 });
  await page.waitForSelector('.ses-card');
  return (await hashOf(page)).split('/')[2];
}

// ===========================================================================
// 1. Cerrar a mitad de sesión y volver
// ===========================================================================

test('CRITERIO 1: cierro la app de golpe a mitad de sesión, vuelvo y se reabre la sesión con todo intacto', async () => {
  const app = await launch({ time: madrid(MON, '18:00') });
  let { page } = app;
  try {
    await seedLastD1(page, PREV_MON);
    await reload(page);
    const id = await startTodayFromHoy(page);
    let s = await getSession(page, id);
    assert.strictEqual(s.templateId, 'tpl_d1');
    assert.strictEqual(s.date, MON);
    const [bench, pull] = s.exercises;
    assert.deepStrictEqual([bench.exerciseId, pull.exerciseId], ['press_banca', 'dominadas']);

    // Press banca: serie 1 confirmada tal cual (80×6 @2); serie 2 con +2,5 kg y confirmada (82,5×5 @1).
    const bc = card(page, bench.id);
    await bc.locator('.ses-register').click();
    await guard(page);
    await bc.locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').click();
    await bc.locator('.ses-register').click();
    await guard(page);
    // Dominadas: serie 1 EDITADA con los steppers (+2,5 kg de lastre, −1 rep) y RIR 0, SIN confirmar.
    const pc = card(page, pull.id);
    await pc.locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').click();
    await pc.locator('.ses-editor button[aria-label^="Restar 1 a "]').click();
    await pc.locator('.ses-rir .chip', { hasText: /^0$/ }).click();
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '12,5');
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Repeticiones"]').inputValue(), '7');
    // Añadir un ejercicio que no está en la plantilla.
    await page.locator('.ses-add-ex').click();
    await page.locator('.pick-sheet .search-input').fill('martillo');
    await page.locator('.pick-row', { hasText: 'Curl martillo' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.length === 8, id);
    await waitNoSheet(page);
    // Nota general de la sesión (se escribe con guardado diferido mientras se teclea).
    const NOTE = 'Hombro derecho algo cargado.\nSubir banca la próxima «si va bien» 💪';
    await page.locator('textarea.ses-notes').fill(NOTE);

    // Lo que el usuario ve ahora mismo (memoria) es lo que debe sobrevivir.
    const expected = await getSession(page, id);
    const eb = expected.exercises[0].sets;
    assert.deepStrictEqual(eb.map((x) => [x.done, x.weight, x.reps, x.rir]), [[true, 80, 6, 2], [true, 82.5, 5, 1], [false, 77.5, 6, 1]]);
    const ep = expected.exercises[1].sets[0];
    assert.deepStrictEqual([ep.done, ep.weight, ep.reps, ep.rir], [false, 12.5, 7, 0]);
    assert.strictEqual(expected.exercises[7].exerciseId, 'curl_martillo');
    assert.strictEqual(expected.notes, NOTE);

    // Cerrar de golpe, sin esperar a nada (como cerrar Safari o deslizar la app fuera).
    // WebKit (Playwright) aborta al cerrar la página las escrituras de IndexedDB aún sin confirmar, y lo tecleado hace
    // < 250 ms (guardado diferido) se perdería: no es lo que pasa en iOS, donde la app pasa ANTES a segundo plano (el
    // selector de apps) y ahí se guarda todo (la prueba siguiente lo comprueba en los dos motores). En WebKit se
    // reproduce esa secuencia: segundo plano, esperar a que esté en disco y cerrar. Chromium: cierre inmediato.
    if (BROWSER !== 'chromium') {
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await waitDiskSession(page, id, (d) => d.notes === NOTE);
    }
    await page.close();

    // Volver a abrir la app (start_url «./», sin hash).
    page = await app.newPage('');
    assert.strictEqual(await hashOf(page), `#/session/${id}`, 'abre directamente la sesión en curso');
    await page.waitForSelector('.ses-card');
    // En disco y en memoria: idéntica a lo que había en pantalla al cerrar.
    const disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual(disk, expected, 'IndexedDB conserva la sesión exactamente como estaba');
    assert.deepStrictEqual(await getSession(page, id), expected, 'memoria tras reabrir');
    assert.strictEqual(disk.status, 'active');

    // Y en pantalla: series confirmadas, la editada sin confirmar con sus valores, el ejercicio añadido y la nota.
    const bc2 = card(page, bench.id);
    assert.strictEqual(await bc2.locator('.ses-row[data-state="done"]').count(), 2);
    assert.match(await bc2.locator('.ses-editor-num').innerText(), /Serie 3/i);
    const pc2 = card(page, pull.id);
    assert.strictEqual(await pc2.locator('.ses-row[data-state="done"]').count(), 0);
    assert.match(await pc2.locator('.ses-editor-num').innerText(), /Serie 1/i);
    assert.strictEqual(await pc2.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '12,5');
    assert.strictEqual(await pc2.locator('.ses-editor input[aria-label="Repeticiones"]').inputValue(), '7');
    assert.strictEqual(await pc2.locator('.ses-rir .chip.active').innerText(), '0');
    assert.strictEqual(await card(page, expected.exercises[7].id).count(), 1, 'el ejercicio añadido sigue');
    assert.match(await card(page, expected.exercises[7].id).locator('.ses-name').innerText(), /Curl martillo/);
    assert.strictEqual(await page.locator('textarea.ses-notes').inputValue(), NOTE);
    // El cronómetro sigue contando desde el inicio real (no se reinicia).
    assert.strictEqual(disk.startedAt, expected.startedAt);
    assert.match(await page.locator('.ses-clock').innerText(), /^\d+:\d\d$/);
    await shot(page, 'acceptance-1-reopened');

    // Cerrar estando en otra pestaña (Calendario) con la sesión en curso: al volver, también abre la sesión.
    // En la sesión en curso la barra es la de la sesión (modo foco): se sale por «Hoy» y ahí están las pestañas.
    await leaveSession(page);
    await tab(page, 'calendar').click();
    await page.waitForFunction(() => location.hash.startsWith('#/calendar'));
    await page.close();
    page = await app.newPage('');
    assert.strictEqual(await hashOf(page), `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    assert.deepStrictEqual((await idbAll(page, 'sessions')).find((x) => x.id === id), expected);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('CRITERIO 1: al volver, confirmar la serie editada antes de cerrar da el mismo resultado que sin cerrar', async () => {
  // Sin cerrar: confirmar la serie 1 de dominadas con +2,5 kg hace que las series pendientes 2 y 3
  // (prellenadas con el mismo lastre, +10) pasen también a +12,5 («herencia de peso»; lo comprueba
  // tests/e2e/session.test.cjs sin cerrar la app). Tras cerrar y volver, confirmar esa misma serie
  // debe dejar la sesión igual: «al volver, la sesión sigue donde la dejé».
  const app = await launch({ time: madrid(MON, '18:00') });
  let { page } = app;
  try {
    await seedLastD1(page, PREV_MON);
    await reload(page);
    const id = await startTodayFromHoy(page);
    const pullId = (await getSession(page, id)).exercises[1].id;
    await card(page, pullId).locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').click();
    const expected = await getSession(page, id);
    assert.deepStrictEqual(expected.exercises[1].sets.map((x) => x.weight), [12.5, 10, 10]);

    await page.close();
    page = await app.newPage('');
    assert.strictEqual(await hashOf(page), `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    const pc = card(page, pullId);
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '12,5');
    await pc.locator('.ses-register').click();
    const s = await getSession(page, id);
    assert.strictEqual(s.exercises[1].sets[0].done, true);
    assert.deepStrictEqual(s.exercises[1].sets.map((x) => x.weight), [12.5, 12.5, 12.5],
      'tras volver, las pendientes con el lastre prellenado (+10) deben heredar el nuevo lastre como si no se hubiera cerrado');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('CRITERIO 1: pasar a segundo plano guarda al instante lo pendiente; si iOS mata la app después, no se pierde', async () => {
  const app = await launch({ time: madrid(MON, '18:00') });
  let { page } = app;
  try {
    await seedLastD1(page, PREV_MON);
    await reload(page);
    const id = await startTodayFromHoy(page);
    const benchId = (await getSession(page, id)).exercises[0].id;
    const bc = card(page, benchId);
    await bc.locator('.ses-register').click();
    await waitDiskSession(page, id, (d) => d.exercises[0].sets[0].done === true);
    await guard(page);

    // Congelar los temporizadores: el guardado diferido (250 ms) no puede dispararse por sí solo.
    const now = await page.evaluate(() => Date.now());
    await app.context.clock.pauseAt(new Date(now + 50));
    await bc.locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').click();
    await bc.locator('.ses-editor button[aria-label^="Sumar 1 a "]').click();
    await page.locator('textarea.ses-notes').fill('Nota escrita justo antes de salir');
    const expected = await getSession(page, id);
    assert.deepStrictEqual([expected.exercises[0].sets[1].weight, expected.exercises[0].sets[1].reps], [82.5, 6]);
    let disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    // Los toques del stepper se guardan al instante; lo tecleado (la nota) va con guardado diferido.
    assert.deepStrictEqual([disk.exercises[0].sets[1].weight, disk.exercises[0].sets[1].reps], [82.5, 6], 'los toques del stepper ya están en disco');
    assert.strictEqual(disk.notes, '', 'la nota aún no está en disco (guardado diferido)');

    // Pasar a segundo plano (cambiar de app / bloquear el iPhone).
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual(disk, expected, 'al pasar a segundo plano se escribe todo en disco sin esperar');

    // iOS mata la app en segundo plano: sin pagehide ni beforeunload (el proceso muere). Chromium: se mata la página
    // con CDP. WebKit no tiene CDP: se cierra la página (lo que importa ya está comprobado en disco, justo arriba).
    await app.context.clock.resume();
    if (BROWSER === 'chromium') {
      const cdp = await app.context.newCDPSession(page);
      const crashed = page.waitForEvent('crash');
      cdp.send('Page.crash').catch(() => {});
      await crashed;
    } else {
      await page.close();
    }

    page = await app.newPage('');
    assert.strictEqual(await hashOf(page), `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual(disk, expected);
    assert.strictEqual(await card(page, benchId).locator('.ses-editor input[aria-label="Peso"]').inputValue(), '82,5');
    assert.strictEqual(await card(page, benchId).locator('.ses-editor input[aria-label="Repeticiones"]').inputValue(), '6');
    assert.strictEqual(await page.locator('textarea.ses-notes').inputValue(), 'Nota escrita justo antes de salir');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// ===========================================================================
// 2. Exportar → borrar → importar
// ===========================================================================

/** Datos variados de todas las stores (incluida una sesión en curso con series pendientes). */
async function seedEverything(page) {
  await page.evaluate(async () => {
    const st = window.__app.store;
    const u = await import('./js/util.js');
    const plan = await import('./js/plan.js');
    const now = Date.now();
    const mk = (id, o) => ({ id, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: now, ...o });
    const strength = (id, tplId, date, status, rows) => {
      const t = st.get('templates', tplId);
      return {
        id, kind: 'strength', date, planDate: date, templateId: t.id, templateName: t.name, status,
        startedAt: u.tsFromDate(date, 18), endedAt: status === 'done' ? u.tsFromDate(date, 19) : null, durationMin: status === 'done' ? 62 : null,
        rpe: status === 'done' ? 8 : null, notes: 'Nota; con "comillas", emoji 🏋️\ny salto de línea', parentId: null, templateItemId: null, cursor: 1,
        exercises: rows.map(([exerciseId, sets], i) => ({
          id: `${id}_se${i}`, exerciseId, exName: st.exercise(exerciseId).name, templateItemId: t.items[i]?.id ?? null, baseExerciseId: exerciseId,
          alternatives: t.items[i]?.alternatives || [], target: { sets: 3, setsMax: null, repMin: 6, repMax: 8, timeMin: null, timeMax: null, distance: null },
          notes: '', note: i === 0 ? 'nota del ejercicio' : '', section: t.items[i]?.section || '', groupId: i < 2 ? 'g1' : null, groupType: i < 2 ? 'superset' : null,
          sets: sets.map((o, j) => mk(`${id}_s${i}_${j}`, o)),
        })),
      };
    };
    await st.save('sessions', strength('ses_1', 'tpl_d1', '2026-09-14', 'done', [
      ['press_banca', [{ type: 'warmup', weight: 40, reps: 10 }, { weight: 80, reps: 6, rir: 2 }, { weight: 82.5, reps: 5, rir: 'F', type: 'failure', note: 'buena' }, { weight: 60, reps: 12, type: 'drop' }]],
      ['dominadas', [{ weight: -15, reps: 8, rir: 1 }, { weight: 10, reps: 6, rir: 0 }]],
      ['remo_unilateral', [{ weight: 30, reps: 10, repsR: 9, rir: 2 }]],
      ['plancha', [{ timeSec: 60 }, { timeSec: 45.5, weight: 10 }]],
    ]));
    await st.save('sessions', strength('ses_2', 'tpl_d2', '2026-09-15', 'done', [
      ['saltos_verticales', [{ reps: 3, heightCm: 52.5 }]],
      ['sprint', [{ distanceM: 20, timeSec: 3.21 }]],
    ]));
    // Sesión en curso: una serie hecha y dos pendientes.
    await st.save('sessions', strength('ses_live', 'tpl_d4', '2026-09-23', 'active', [
      ['press_inclinado_smith', [{ weight: 60, reps: 8, rir: 2 }, { weight: 60, reps: 8, rir: 2, done: false, doneAt: null }, { weight: 60, reps: 7, rir: 1, done: false, doneAt: null }]],
    ]));
    const act = (o) => ({ status: 'done', planDate: o.date, templateId: null, templateName: '', startedAt: null, endedAt: null, notes: '', parentId: null, rpe: null, ...o });
    await st.save('sessions', act({ id: 'act_run', kind: 'run', date: '2026-09-16', subtype: 'z2', distanceKm: 8.42, movingSec: 2712, elapsedSec: 2790, durationMin: 45.2, elevationM: 40, hrAvg: 145, hrMax: 162, cadence: 170, rpe: 5, feel: 'Z2 cómoda', notes: 'Rodaje' }));
    await st.save('sessions', act({ id: 'act_swim', kind: 'swim', date: '2026-09-17', distanceKm: 1.2, movingSec: 1500, durationMin: 25, poolType: 'pool', poolLengthM: 25, stroke: 'free', rpe: 6 }));
    await st.save('sessions', act({ id: 'act_bike', kind: 'bike', date: '2026-09-19', subtype: 'route', distanceKm: 52.3, movingSec: 7200, durationMin: 120, powerAvg: 175, powerNp: 190, elevationM: 640, rpe: 6 }));
    await st.save('sessions', act({ id: 'act_other', kind: 'other', date: '2026-09-20', subtype: 'Pádel', movingSec: 3600, durationMin: 60, rpe: 7 }));
    await st.save('sessions', act({ id: 'act_link', kind: 'run', date: '2026-09-16', planDate: '2026-09-16', parentId: 'ses_2', parentItemId: 'ses_2_se0', templateItemId: null, distanceKm: 5, movingSec: 1800, durationMin: 30 }));
    for (const [id, kg] of [['2026-09-14', 75.4], ['2026-09-18', 75.1], ['2026-09-22', 74.85]]) await st.save('bodyweight', { id, kg });
    await st.save('checkins', { id: 'chk1', date: '2026-09-21', timing: 'pre', sessionId: 'ses_1', sleep: 2, energy: 3, soreness: 1 });
    await st.save('goals', { id: 'goal1', kind: 'endurance', title: '10 km en menos de 45 min', sport: 'run', distanceKm: 10, timeSec: 2700, achievedAt: null, archived: false });
    await st.save('exercises', { id: 'ex_custom', name: 'Remo en máquina «Hammer»', aliases: ['hammer row'], primary: ['back'], secondary: ['biceps', 'reardelt'], pattern: 'pull_h', logType: 'weight_reps', category: 'compound', region: 'upper', notes: '', custom: true, archived: false });
    const arch = st.exercise('curl_martillo');
    arch.archived = true;
    await st.save('exercises', arch);
    const t = st.get('templates', 'tpl_d4');
    t.name = 'Día 4 — Upper hipertrofia (v2)';
    t.items[0].alternatives = ['press_banca'];
    await st.save('templates', t);
    await st.save('templates', { id: 'tpl_custom', name: 'Full body de viaje', order: 9, notes: 'Hotel', archived: false, items: [{ id: 'ti_c1', exerciseId: 'ex_custom', alternatives: [], sets: 3, repMin: 8, repMax: 12, notes: '', section: '', groupId: null, groupType: null }] });
    await plan.overrideDay('2026-09-26', { kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
    await plan.setManualStatus('2026-09-22', 'skipped');
    const s = st.settings();
    s.secondaryFactor = 0.75;
    s.muscleTargets.back = [16, 24];
    s.increments.upperCompound = 2;
    s.csv = { ...(s.csv || {}), excel: false };
    await st.save('meta', s);
    const days = JSON.parse(JSON.stringify(plan.currentPattern()));
    days[6] = { kind: 'free', label: 'Carrera', activityKind: 'run' };
    await plan.setWeekPattern(days);
  });
}

/** Sustituye navigator.share (hoja de compartir de iOS) para capturar el archivo exportado. */
async function stubShare(page) {
  await page.evaluate(() => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }) => {
        for (const f of files) window.__shared.push({ name: f.name, type: f.type, text: await f.text() });
      },
    });
  });
}

test('CRITERIO 2: exporto una copia, borro los datos, importo la copia y todo queda idéntico (IndexedDB)', async () => {
  const app = await launch({ time: madrid(WED, '12:00') });
  let { page } = app;
  try {
    await seedEverything(page);
    await reload(page); // hay una sesión en curso: la app la abre
    assert.strictEqual(await hashOf(page), '#/session/ses_live');

    // Ajustes → Copias y datos → Exportar copia (hoja de compartir de iOS). Desde la sesión, por «Hoy» (modo foco).
    await leaveSession(page);
    await tab(page, 'settings').click();
    await page.locator('.cfg-data-row').click();
    await page.waitForSelector('.cfg-export');
    assert.strictEqual(await page.locator('.cfg-overdue').count(), 1, 'aviso de copia pendiente');
    await stubShare(page);
    const pre = await idbSnapshot(page); // disco justo antes de exportar
    await page.locator('.cfg-export').click();
    await page.waitForFunction(() => window.__shared.length === 1);
    await page.locator('.toast', { hasText: 'Copia exportada' }).waitFor();
    const [file] = await page.evaluate(() => window.__shared);
    assert.match(file.name, /^entreno-copia-2026-09-23-\d{4}\.json$/);
    assert.strictEqual(file.type, 'application/json');
    const backup = JSON.parse(file.text);
    await page.waitForFunction(() => window.__app.store.settings().lastBackupAt > 0);
    await page.evaluate(() => window.__app.store.flush());
    assert.strictEqual(await page.locator('.cfg-overdue').count(), 0, 'la copia quita el aviso');

    // Estado de referencia: TODAS las stores en disco justo después de exportar.
    const before = await idbSnapshot(page);
    assert.strictEqual(before.sessions.length, 8);
    assert.ok(before.plan.length >= 2 && before.bodyweight.length === 3 && before.checkins.length === 1 && before.goals.length === 1);
    const lastBackupAt = settingsOf(before).lastBackupAt;
    assert.ok(lastBackupAt > 0);
    // El archivo contiene exactamente los datos del disco: lo de antes de exportar + la fecha de esta copia.
    const fileData = Object.fromEntries(STORES.map((s) => [s, byId(backup.data[s])]));
    for (const s of STORES) {
      if (s !== 'meta') assert.deepStrictEqual(fileData[s], pre[s], `el archivo contiene la store «${s}» tal cual`);
    }
    assert.deepStrictEqual(fileData.meta.find((m) => m.id === 'app'), pre.meta.find((m) => m.id === 'app'));
    assert.deepStrictEqual(settingsOf(fileData), { ...settingsOf(pre), lastBackupAt }, 'ajustes del archivo = los del disco + lastBackupAt');
    // Al anotar la copia, los ajustes se guardan tal cual van en el archivo (mismo updatedAt): disco = archivo.
    assert.deepStrictEqual(before, fileData);

    // Borrar todos los datos: doble confirmación (Continuar → escribir BORRAR → Borrar todo).
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Continuar').click();
    await page.waitForFunction(() => document.querySelector('.sheet-overlay.open input'));
    assert.ok(await sheetBtn(page, 'Borrar todo').isDisabled(), 'sin escribir BORRAR no se puede');
    await sheetPanel(page).locator('input').fill('BORRAR');
    await sheetBtn(page, 'Borrar todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 0, null, { timeout: 5000 });
    const wiped = await idbSnapshot(page);
    // Antes de borrar se guardó en el dispositivo el punto de restauración: lo de antes, entero (ronda 8, B3).
    const rp = (await idbAll(page, 'meta')).find((o) => o.id === '~restorePoint:data');
    for (const s of STORES) assert.deepStrictEqual(byId(rp.backup.data[s]), before[s], `punto de restauración: «${s}»`);
    for (const s of ['sessions', 'plan', 'bodyweight', 'checkins', 'goals']) assert.strictEqual(wiped[s].length, 0, `«${s}» borrada en disco`);
    assert.ok(!wiped.exercises.some((e) => e.id === 'ex_custom'));
    assert.strictEqual(wiped.meta.find((m) => m.id === 'settings').lastBackupAt, null);
    assert.notDeepStrictEqual(wiped, before);

    // Importar la copia con el selector de archivos → confirmar «Sustituir todo».
    await tab(page, 'settings').click();
    await page.locator('.cfg-data-row').click();
    await page.waitForSelector('.cfg-import');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
    await fc.setFiles({ name: file.name, mimeType: 'application/json', buffer: Buffer.from(file.text, 'utf8') });
    await sheetPanel(page).waitFor();
    assert.match(await sheetPanel(page).innerText(), /SUSTITUYE/);
    await sheetBtn(page, 'Sustituir todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 8, null, { timeout: 5000 });
    await page.evaluate(() => window.__app.store.flush());

    // IDÉNTICO: todas las stores en disco, registro a registro, iguales al archivo…
    const after = await idbSnapshot(page);
    for (const s of STORES) assert.deepStrictEqual(after[s], fileData[s], `IndexedDB «${s}» idéntica a la copia tras importar`);
    // …y al estado del disco en el momento de exportar.
    for (const s of STORES) assert.deepStrictEqual(after[s], before[s], `IndexedDB «${s}» idéntica a la de antes de borrar`);
    // Y al volver a abrir la app: igual, y la sesión en curso se reabre.
    await page.close();
    page = await app.newPage('');
    assert.strictEqual(await hashOf(page), '#/session/ses_live');
    const reopened = await idbSnapshot(page);
    for (const s of STORES) assert.deepStrictEqual(reopened[s], after[s], `tras reabrir: «${s}»`);
    assert.strictEqual(await page.locator('.ses-row[data-state="done"]').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// ===========================================================================
// 3. Registrar una serie prellenada: 1–2 toques
// ===========================================================================

test('CRITERIO 3: con una sesión anterior (hecha por la interfaz), registrar la serie prellenada cuesta 1 toque', async () => {
  const app = await launch({ time: madrid(PREV_MON, '18:00') });
  let { page } = app;
  try {
    // --- Lunes anterior: Día 1 registrado a mano por la interfaz ---
    const prevId = await startTodayFromHoy(page);
    let s = await getSession(page, prevId);
    const bc = card(page, s.exercises[0].id);
    assert.match(await bc.locator('.ses-last').innerText(), /Primera vez/);
    // calentamiento 40×8
    await bc.locator('.ses-add-warm').click();
    await bc.locator('.ses-editor input[aria-label="Peso"]').fill('40');
    await bc.locator('.ses-editor input[aria-label="Repeticiones"]').fill('8');
    await bc.locator('.ses-register').click();
    await guard(page);
    // 80×6 @2, 80×5 @1, 77,5×6 @1
    const typeSet = async (loc, w, reps, rir) => {
      if (w != null) await loc.locator('.ses-editor input[aria-label="Peso"]').fill(w);
      await loc.locator('.ses-editor input[aria-label="Repeticiones"]').fill(reps);
      await loc.locator('.ses-rir .chip', { hasText: new RegExp(`^${rir}$`) }).click();
      await loc.locator('.ses-register').click();
      await guard(page);
    };
    await typeSet(bc, '80', '6', 2);
    await typeSet(bc, null, '5', 1); // hereda 80
    await typeSet(bc, '77,5', '6', 1);
    // Dominadas: +10×8 @1, +10×7 @1
    const pc = card(page, s.exercises[1].id);
    await pc.locator('.ses-editor input[aria-label="Lastre"]').fill('10');
    await pc.locator('.ses-editor input[aria-label="Repeticiones"]').fill('8');
    await pc.locator('.ses-rir .chip', { hasText: /^1$/ }).click();
    await pc.locator('.ses-register').click();
    await guard(page);
    await typeSet(pc, null, '7', 1);
    // Terminar (RPE 8) → resumen
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    await fin.locator('.rpe-chips .chip', { hasText: /^8$/ }).click();
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    await page.waitForFunction((sid) => location.hash.split("?")[0] === `#/session/${sid}/summary`, prevId, { timeout: 5000 });
    s = await getSession(page, prevId);
    assert.strictEqual(s.status, 'done');
    const lastBench = s.exercises[0].sets.map((x) => [x.type, x.weight, x.reps, x.rir]);
    assert.deepStrictEqual(lastBench, [['warmup', 40, 8, null], ['effective', 80, 6, 2], ['effective', 80, 5, 1], ['effective', 77.5, 6, 1]]);

    // --- Una semana después: lunes, Día 1 otra vez ---
    await app.context.clock.setSystemTime(madrid(MON, '18:00'));
    await page.close();
    page = await app.newPage('');
    assert.strictEqual(await hashOf(page), '#/today');
    const id = await startTodayFromHoy(page);
    s = await getSession(page, id);
    const bench = s.exercises[0];
    const b = card(page, bench.id);
    const lastTxt = await b.locator('.ses-last').innerText();
    assert.match(lastTxt, /Última vez/i);
    assert.ok(lastTxt.includes('C 40×8 · 80×6 @2 · 80×5 @1 · 77,5×6 @1'), lastTxt);
    // Prellenado = última vez (sin calentamientos).
    assert.strictEqual(await b.locator('.ses-editor input[aria-label="Peso"]').inputValue(), '80');
    assert.strictEqual(await b.locator('.ses-editor input[aria-label="Repeticiones"]').inputValue(), '6');
    assert.strictEqual(await b.locator('.ses-rir .chip.active').innerText(), '2');

    // Contador de toques del usuario (eventos de clic reales).
    await page.evaluate(() => {
      window.__taps = 0;
      document.addEventListener('click', (e) => { if (e.isTrusted) window.__taps++; }, true);
    });
    const taps = () => page.evaluate(() => { const n = window.__taps; window.__taps = 0; return n; });

    // Serie 1: UN toque.
    await b.locator('.ses-register').click();
    let disk = await waitDiskSession(page, id, (d) => d.exercises[0].sets[0].done === true, 1000);
    assert.strictEqual(await taps(), 1, 'la serie 1 se registra con 1 toque');
    assert.strictEqual(await page.locator('.sheet-overlay').count(), 0, 'sin diálogos ni confirmaciones');
    const s1 = disk.exercises[0].sets[0];
    assert.deepStrictEqual([s1.type, s1.weight, s1.reps, s1.rir, s1.done], ['effective', 80, 6, 2, true], 'valores = última vez');
    // Serie 2: otro toque, valores de la 2.ª serie de la última vez.
    await guard(page);
    await b.locator('.ses-register').click();
    disk = await waitDiskSession(page, id, (d) => d.exercises[0].sets[1].done === true, 1000);
    assert.strictEqual(await taps(), 1);
    assert.deepStrictEqual([disk.exercises[0].sets[1].weight, disk.exercises[0].sets[1].reps, disk.exercises[0].sets[1].rir], [80, 5, 1]);
    // Serie 3 ajustando el peso: 2 toques (+2,5 y registrar).
    await guard(page);
    await b.locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').click();
    await b.locator('.ses-register').click();
    disk = await waitDiskSession(page, id, (d) => d.exercises[0].sets[2].done === true, 1000);
    assert.strictEqual(await taps(), 2);
    assert.deepStrictEqual([disk.exercises[0].sets[2].weight, disk.exercises[0].sets[2].reps, disk.exercises[0].sets[2].rir], [80, 6, 1]);
    // Dominadas (peso corporal con lastre): 1 toque, +10×8 @1.
    const p = card(page, s.exercises[1].id);
    assert.strictEqual(await p.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '10');
    await p.locator('.ses-register').click();
    disk = await waitDiskSession(page, id, (d) => d.exercises[1].sets[0].done === true, 1000);
    assert.strictEqual(await taps(), 1);
    assert.deepStrictEqual([disk.exercises[1].sets[0].weight, disk.exercises[1].sets[0].reps, disk.exercises[1].sets[0].rir], [10, 8, 1]);
    await shot(page, 'acceptance-3-one-tap');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// ===========================================================================
// 4. Sustituir el Día 6 de esta semana por una ruta en bici
// ===========================================================================

test('CRITERIO 4: sustituir el Día 6 de esta semana por una ruta en bici (Calendario → día) no modifica la semana tipo', async () => {
  const app = await launch({ time: madrid(WED, '10:00') });
  let { page } = app;
  try {
    const settingsDisk = async (p) => (await idbAll(p, 'meta')).find((m) => m.id === 'settings');
    const before = await settingsDisk(page);
    const d6Name = await page.evaluate(() => window.__app.store.get('templates', 'tpl_d6').name);
    assert.deepStrictEqual(before.weekPatterns[0].days[5], { kind: 'template', templateId: 'tpl_d6' });

    // Calendario → sábado de esta semana (Día 6).
    await tab(page, 'calendar').click();
    const satRow = page.locator(`.cal-row[data-date="${SAT}"]`);
    await satRow.waitFor();
    assert.ok((await satRow.innerText()).includes(d6Name), await satRow.innerText());
    await satRow.click();
    await page.waitForFunction((d) => location.hash === `#/day/${d}`, SAT);
    await page.locator('.cal-act-change').click();
    await sheetPanel(page).waitFor();
    await sheetPanel(page).locator('.pick-row', { hasText: 'Ruta en bici' }).click();
    await page.locator('.toast', { hasText: 'Tu semana tipo no cambia' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.cal-plan .today-plan-name')?.textContent === 'Ruta en bici');
    assert.ok((await page.locator('.cal-plan .cal-changed').innerText()).includes(`Semana tipo: ${d6Name}`));

    // En disco: solo una excepción para ese día; la semana tipo, idéntica.
    const planDisk = await idbAll(page, 'plan');
    assert.strictEqual(planDisk.length, 1);
    assert.deepStrictEqual({ id: planDisk[0].id, kind: planDisk[0].kind, label: planDisk[0].label, activityKind: planDisk[0].activityKind },
      { id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
    let after = await settingsDisk(page);
    assert.deepStrictEqual(after.weekPatterns, before.weekPatterns, 'settings.weekPatterns sin cambios');

    // El calendario: este sábado «Ruta en bici · cambiado»; el sábado siguiente sigue siendo el Día 6.
    await page.locator('.topbar .back-btn, .topbar [aria-label="Atrás"]').first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/calendar'));
    await page.locator(`.cal-row[data-date="${SAT}"]`).waitFor();
    assert.match(await page.locator(`.cal-row[data-date="${SAT}"]`).innerText(), /Ruta en bici\s+cambiado/);
    await page.locator('button[aria-label="Semana siguiente"]').click();
    await page.waitForFunction((w) => location.hash === `#/calendar?week=${w}`, NEXT_WEEK);
    const nextSat = page.locator(`.cal-row[data-date="${NEXT_SAT}"]`);
    await nextSat.waitFor();
    assert.ok((await nextSat.innerText()).includes(d6Name), await nextSat.innerText());
    assert.ok(!(await nextSat.innerText()).includes('cambiado'));
    // Ajustes → Semana tipo sigue L D1 · M D2 · X D3 · J D4 · V — · S D6 · D —.
    await tab(page, 'settings').click();
    await page.locator('.cfg-week-mini .cfg-wm-label').first().waitFor();
    assert.deepStrictEqual(await page.locator('.cfg-week-mini .cfg-wm-label').allTextContents(), ['D1', 'D2', 'D3', 'D4', '—', 'D6', '—']);

    // El sábado: Hoy propone la ruta en bici; se registra y el día queda «sustituido».
    await app.context.clock.setSystemTime(madrid(SAT, '10:00'));
    await page.close();
    page = await app.newPage('');
    await page.waitForSelector('.today-plan');
    assert.strictEqual(await page.locator('.today-plan .today-plan-name').innerText(), 'Ruta en bici');
    await page.locator('.today-plan .today-start').click();
    await page.waitForFunction(() => location.hash.startsWith('#/activity/new'));
    await page.fill('[aria-label="Distancia (km)"]', '62,4');
    await page.fill('[aria-label="Tiempo: h"]', '2');
    await page.fill('[aria-label="Tiempo: min"]', '35');
    await page.waitForFunction(() => window.__app.store.all('sessions').some((x) => x.kind === 'bike'));
    await page.locator('.act-done').click();
    await page.waitForFunction(() => location.hash === '#/today');
    await page.evaluate(() => window.__app.store.flush());
    const bike = (await idbAll(page, 'sessions')).find((x) => x.kind === 'bike');
    assert.deepStrictEqual([bike.date, bike.planDate, bike.distanceKm, bike.movingSec], [SAT, SAT, 62.4, 9300]);
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-status'), 'substituted');
    after = await settingsDisk(page);
    assert.deepStrictEqual(after.weekPatterns, before.weekPatterns, 'tras registrar la ruta, la semana tipo sigue igual');
    await go(page, `#/calendar?week=${NEXT_WEEK}`);
    assert.ok((await page.locator(`.cal-row[data-date="${NEXT_SAT}"]`).innerText()).includes(d6Name));
    await shot(page, 'acceptance-4-next-week');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// ===========================================================================
// 5. Sin conexión una vez instalada
// ===========================================================================

test('CRITERIO 5: instalada (service worker activo), funciona sin conexión: pestañas, pantallas y una sesión completa', async () => {
  const app = await launch({
    time: madrid(MON, '18:00'),
    serviceWorkers: 'allow',
    pages: true, // publicada en una subruta, como en GitHub Pages
    init: () => { window.__controlledAtLoad = !!(navigator.serviceWorker && navigator.serviceWorker.controller); },
  });
  let { page } = app;
  try {
    // La primera visita instala el SW, que toma el control de la página abierta SIN recargarla (no se pierde
    // lo que se esté tecleando; lo comprueba core.test.cjs). Esperar a que controle la página y esté activado.
    await page.waitForFunction(() => document.documentElement.classList.contains('ready')
      && navigator.serviceWorker.controller?.state === 'activated', null, { timeout: 15000 });
    assert.strictEqual(await page.evaluate(() => window.__controlledAtLoad), false, 'la primera visita no se recarga');
    assert.strictEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state), 'activated');
    // Con conexión, volver a abrirla: este documento ya se carga controlado por el SW.
    await page.reload();
    await waitReady(page);
    assert.strictEqual(await page.evaluate(() => window.__controlledAtLoad), true);
    await seedLastD1(page, PREV_MON);

    assert.match(app.url, /\/gym\/$/);
    assert.strictEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope), app.url);

    // Sin red: modo avión y, además, el servidor apagado (no responde a nada). En WebKit, el modo sin conexión de
    // Playwright (setOffline) rompe hasta la navegación servida por el service worker («internal error», también sin
    // apagar el servidor): ahí la falta de red es solo el servidor apagado, que es lo que comprueba la prueba.
    if (BROWSER === 'chromium') await app.context.setOffline(true);
    await app.server.close();
    const failed = [];
    const network = [];
    // En todo el contexto (páginas y el propio service worker).
    app.context.on('requestfailed', (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
    let fromCache = 0;
    app.context.on('response', (r) => {
      if (r.fromServiceWorker()) fromCache++;
      else if (!/^(data|blob):/.test(r.url())) network.push(r.url());
    });

    // Abrir la app sin conexión.
    await page.reload();
    await waitReady(page);
    assert.strictEqual(await hashOf(page), '#/today');
    const view = page.locator('#view');
    const assertOk = async (where) => {
      const txt = await view.innerText();
      assert.ok(txt.trim().length > 20, `${where}: pantalla vacía`);
      assert.ok(!txt.includes('Algo ha fallado'), `${where}: ${txt.slice(0, 300)}`);
    };
    await assertOk('Hoy');

    // Las cinco pestañas (tocando la barra inferior).
    for (const [id, re] of [['calendar', /Calendario/], ['progress', /Progreso|En construcción/ /* pantalla de la Fase 2 */], ['exercises', /Ejercicios|Rutinas/], ['settings', /Ajustes/], ['today', /Hoy/]]) {
      await freshView(page, () => tab(page, id).click());
      assert.ok(await tab(page, id).evaluate((el) => el.classList.contains('active')), `pestaña ${id} activa`);
      await assertOk(`pestaña ${id}`);
      assert.match(await page.locator('#view .topbar h1').innerText(), re, `pestaña ${id}`);
    }
    // Pantallas secundarias (todas las de la Fase 1 y las de las fases 2 y 3).
    for (const r of ['#/history', `#/day/${MON}`, '#/calendar?view=month', '#/exercises?seg=library', '#/exercises?seg=templates', '#/template/tpl_d1',
      '#/exercise/press_banca', '#/exercise/new', '#/bodyweight', '#/activity/new?kind=run', '#/activity/new?kind=swim',
      '#/settings/week', '#/settings/thresholds', '#/settings/data',
      '#/records', '#/progress/exercise/press_banca', '#/weekly', `#/weekly?week=${PREV_MON}`, '#/goals', '#/goal/new']) {
      await freshView(page, () => page.evaluate((h) => window.__app.navigate(h), r));
      await assertOk(r);
    }

    // Una sesión completa sin conexión: Hoy → Empezar → series → añadir ejercicio → terminar → resumen.
    await go(page, '#/today');
    const id = await startTodayFromHoy(page);
    const s = await getSession(page, id);
    const bc = card(page, s.exercises[0].id);
    assert.match(await bc.locator('.ses-last').innerText(), /Última vez/i);
    await bc.locator('.ses-register').click();
    await guard(page);
    await bc.locator('.ses-register').click();
    await page.locator('.ses-add-ex').click();
    await page.locator('.pick-sheet .search-input').fill('martillo');
    await page.locator('.pick-row', { hasText: 'Curl martillo' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.length === 8, id);
    await waitNoSheet(page);
    // Reabrir sin conexión a mitad de sesión.
    await page.reload();
    await waitReady(page);
    assert.strictEqual(await hashOf(page), `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await card(page, s.exercises[0].id).locator('.ses-row[data-state="done"]').count(), 2);
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    await fin.locator('.rpe-chips .chip', { hasText: /^7$/ }).click();
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    const diff = page.locator('.sheet-panel.ses-diff-sheet');
    await diff.waitFor();
    await diff.locator('.sheet-actions button', { hasText: 'Solo esta vez' }).click();
    await page.waitForFunction((sid) => location.hash.split("?")[0] === `#/session/${sid}/summary`, id, { timeout: 5000 });
    await page.waitForFunction(() => /Series por músculo/i.test(document.querySelector('#view').innerText));
    await assertOk('resumen');
    const done = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.strictEqual(done.status, 'done');
    assert.strictEqual(done.rpe, 7);
    // Registrar peso corporal y una carrera sin conexión.
    await go(page, '#/activity/new?kind=run');
    await page.fill('[aria-label="Distancia (km)"]', '5');
    await page.fill('[aria-label="Tiempo en movimiento: min"]', '27');
    await page.waitForFunction(() => window.__app.store.all('sessions').some((x) => x.kind === 'run'));
    await go(page, '#/today');
    await assertOk('Hoy tras registrar');
    await shot(page, 'acceptance-5-offline');

    // Abrir la app «en frío» sin conexión (cerrarla y volver a tocar el icono: start_url «./»).
    await page.close();
    const cold = await app.newPage('');
    assert.strictEqual(await hashOf(cold), '#/today');
    assert.match(await cold.locator('#view .topbar h1').innerText(), /Hoy/);
    assert.ok((await storeAll(cold, 'sessions')).some((x) => x.id === id && x.status === 'done'), 'lo registrado sin conexión sigue ahí');

    assert.deepStrictEqual(failed, [], 'ninguna petición fallida (todo sale de la caché)');
    assert.deepStrictEqual(network, [], 'ninguna respuesta de la red');
    assert.ok(fromCache >= 20, `la app sale de la caché del service worker (${fromCache} respuestas)`);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// ===========================================================================
// 6. «Cada sugerencia del panel muestra su "¿Por qué?" con los datos concretos que la generan»
// ===========================================================================
// Datos sembrados (5 semanas, del 17 ago al 20 sep, + la semana en curso) para que salgan TODAS las sugerencias
// que puede dar el panel (js/insights.js):
//  - semana terminada 14–20 sep: doble progresión «sube» en sus seis variantes (compuesto de tren superior e
//    inferior, aislamiento, lastre, asistencia y unilateral por lado), «mantén» agrupado con sus tres motivos
//    (faltan reps, RIR por debajo, faltan series), aviso de carga (alto), aviso de km de carrera (suave) y descarga;
//  - semana en curso 21–27 sep: «Sin avisos de carga» y «Sin señales de necesitar descarga» (sus alternativas).
// Cada «¿Por qué?» se abre en pantalla y se comprueba la regla (con los umbrales actuales de Ajustes) y las cifras
// concretas que la disparan, calculadas aquí a partir de lo sembrado (no del código de la app).
const WHY_WEEKS = ['2026-08-17', '2026-08-24', '2026-08-31', '2026-09-07', PREV_MON];
const WHY_PLAN = {
  // [ejercicio, objetivo [series, repMin, repMax], semana i → [peso, reps[], rir[]]]
  A: [
    ['press_banca', [3, 4, 6], (i) => [75 + 2.5 * i, i === 4 ? [6, 6, 6] : [6, 5, 5], i === 4 ? [2, 1, 1] : [1, 1, 1]]],
    ['sentadilla', [3, 6, 8], (i) => [90 + 2.5 * i, i === 4 ? [8, 8, 8] : [8, 7, 7], [2, 2, 2]]],
    ['curl_barra', [3, 10, 12], (i) => [26 + i, i === 4 ? [12, 12, 12] : [12, 11, 10], [1, 1, 1]]],
    ['remo_pecho_apoyado', [3, 8, 10], () => [60, [10, 9, 8], [1, 1, 1]]], // no llega al tope → estancado (ronda 8, B4: no «mantén»)
  ],
  B: [
    ['dominadas', [3, 6, 8], (i) => [1.25 * i, i === 4 ? [8, 8, 8] : [8, 7, 7], [1, 1, 1]]], // lastre
    ['fondos', [3, 8, 10], (i) => [-30 + 2.5 * i, i === 4 ? [10, 10, 10] : [10, 9, 9], [1, 1, 1]]], // asistencia
    ['bulgara', [3, 8, 10], (i) => [12 + i, i === 4 ? [10, 10, 10] : [10, 9, 9], [1, 1, 1]]], // unilateral
    ['jalon_pecho', [3, 10, 12], () => [55, [12, 12, 12], [0, 0, 0]]], // tope con RIR 0 → estancado
    ['peso_muerto_rumano', [3, 8, 10], () => [90, [10, 10], [2, 2]]], // 2 de 3 series → estancado
  ],
};

/** Sesiones, actividades y check-ins del criterio 6. `exById`: {id: {name, logType}} de la biblioteca. */
function whySeed(exById) {
  const sessions = [];
  const strength = (id, date, name, items, { dur = 60, rpe }) => {
    const at = madrid(date, '18:00').getTime();
    sessions.push({
      id, kind: 'strength', date, planDate: date, templateId: null, templateName: name, status: 'done',
      startedAt: at, endedAt: at + dur * 60000, durationMin: dur, rpe, notes: '', parentId: null, templateItemId: null, cursor: 0,
      createdAt: at, updatedAt: at,
      exercises: items.map(([exId, [sets, repMin, repMax], weight, reps, rir], k) => {
        const ex = exById[exId];
        const mk = (n, o) => ({
          id: `${id}_${k}_${n}`, type: 'effective', weight, reps: null, repsR: null, rir: null, timeSec: null, distanceM: null,
          heightCm: null, note: '', done: true, doneAt: at + (k * 6 + n) * 60000, ...o,
        });
        // Un calentamiento en el press banca: no cuenta (no puede aparecer entre las series del porqué).
        const list = exId === 'press_banca' ? [mk(9, { type: 'warmup', weight: 40, reps: 8 })] : [];
        reps.forEach((r, j) => list.push(mk(j, { reps: r, repsR: ex.logType === 'unilateral' ? r : null, rir: rir[j] })));
        return {
          id: `${id}_se${k}`, exerciseId: exId, exName: ex.name, templateItemId: null, alternatives: [],
          target: { sets, setsMax: null, repMin, repMax, timeMin: null, timeMax: null, distance: null },
          notes: '', section: '', groupId: null, groupType: null, sets: list,
        };
      }),
    });
  };
  const activity = (id, kind, date, km, sec, rpe, subtype) => {
    const at = madrid(date, '09:00').getTime();
    sessions.push({
      id, kind, date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: null, endedAt: null,
      movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe, distanceKm: km, subtype, notes: '', parentId: null,
      parentItemId: null, templateItemId: null, createdAt: at, updatedAt: at,
    });
  };
  const items = (plan, i) => plan.map(([exId, target, f]) => [exId, target, ...f(i)]);
  WHY_WEEKS.forEach((mon, i) => {
    // Esfuerzo alto sostenido en las dos últimas semanas (RPE 8 y 9 → media 8,5); antes, RPE 7.
    strength(`why_a${i}`, mon, 'Torso A', items(WHY_PLAN.A, i), { rpe: i < 3 ? 7 : i === 3 ? 8 : 9 });
    strength(`why_b${i}`, addDays(mon, 3), 'Torso B y pierna', items(WHY_PLAN.B, i), { rpe: i < 3 ? 7 : i === 3 ? 9 : 8 });
    // Carrera los sábados: 10 km (60 min); la última semana 11,2 km (+12 % → aviso suave).
    activity(`why_r${i}`, 'run', addDays(mon, 5), i === 4 ? 11.2 : 10, i === 4 ? 4032 : 3600, 5, 'long');
  });
  // Ruta en bici de 2 h el último domingo: la carga de esa semana sube más de un 30 %.
  activity('why_bike', 'bike', addDays(PREV_MON, 6), 60, 7200, 5, 'route');
  // Semana en curso: una sesión suave (RPE 6) y un rodaje corto.
  strength('why_cur', MON, 'Torso A', [
    ['press_banca', [3, 4, 6], 87.5, [6, 5, 5], [1, 1, 1]],
    ['sentadilla', [3, 6, 8], 105, [8, 7, 7], [2, 2, 2]],
    ['curl_barra', [3, 10, 12], 31, [12, 11, 10], [1, 1, 1]],
    ['remo_pecho_apoyado', [3, 8, 10], 60, [10, 9, 8], [1, 1, 1]],
  ], { dur: 45, rpe: 6 });
  activity('why_rcur', 'run', WED, 5, 1800, 5, 'z2');
  // Check-ins: 2 de 3 bajos entre el 7 y el 20 sep; 1 de 2 entre el 13 y el 26.
  const checkins = [
    { id: 'why_ck1', date: '2026-09-10', timing: 'pre', sessionId: null, sleep: 1, energy: 2, soreness: 2 },
    { id: 'why_ck2', date: PREV_MON, timing: 'pre', sessionId: 'why_a4', sleep: 2, energy: 1, soreness: 2 },
    { id: 'why_ck3', date: '2026-09-17', timing: 'post', sessionId: 'why_b4', sleep: 2, energy: 2, soreness: 2 },
  ].map((c) => ({ ...c, createdAt: madrid(c.date, '17:00').getTime(), updatedAt: madrid(c.date, '17:00').getTime() }));
  return { sessions, checkins };
}

/** 'YYYY-MM-DD' + n días (UTC, sin horas). */
function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
const nf = (v, max = 0) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: max, useGrouping: true }).format(v);
/** Carga semanal (min × RPE de cada sesión, redondeada) de las sesiones de la semana que empieza en `ws`. */
const weekLoad = (sessions, ws) => sessions.filter((s) => s.date >= ws && s.date <= addDays(ws, 6))
  .reduce((t, s) => t + Math.round(s.durationMin * s.rpe), 0);

/** Tarjetas de un bloque del panel (en orden de pantalla). */
const blockCards = (page, section) => page.locator(`.wk-block[data-section="${section}"] .wk-msg`).evaluateAll((els) => els.map((el) => ({
  id: el.dataset.id, level: el.dataset.level,
  badge: el.querySelector('.wk-level')?.textContent.trim(),
  title: el.querySelector('.wk-msg-title')?.textContent,
  text: el.querySelector('.wk-msg-text')?.textContent,
  whyLabel: el.querySelector('.why-btn')?.textContent.trim() ?? null,
  whyClosed: el.querySelector('.why-btn')?.getAttribute('aria-expanded') === 'false' && !!el.querySelector('.why-body')?.hidden,
})));

/** Toca «¿Por qué?» de una tarjeta y devuelve lo que se ve: { rule, rows:[{label, value, sub}] }. */
async function tapWhy(page, root, id) {
  const cardEl = page.locator(`${root}[data-id="${id}"]`);
  const btn = cardEl.locator('.why-btn');
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  assert.strictEqual(await btn.getAttribute('aria-expanded'), 'true', `${id}: «¿Por qué?» abierto`);
  const body = cardEl.locator('.why-body');
  assert.ok(await body.isVisible(), `${id}: el porqué se ve`);
  return body.evaluate((b) => ({
    rule: b.querySelector('.wk-why-rule').textContent,
    rows: [...b.querySelectorAll('.wk-why-row')].map((r) => ({
      label: r.querySelector('.wk-why-label').textContent, value: r.querySelector('.wk-why-value').textContent, sub: r.classList.contains('wk-why-sub'),
    })),
  }));
}

/** Dos capturas del porqué abierto de un mensaje: la tarjeta desde arriba y la lista «Datos». */
async function shotWhy(page, id, name) {
  for (const [sel, suffix] of [['', ''], [' .wk-why-head', '-data']]) {
    await page.locator(`.wk-msg[data-id="${id}"]${sel}`).evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -80));
    await shot(page, `${name}${suffix}`);
  }
}

/** Sugerencias del modelo (js/insights.js con los datos del store), para comprobar que la vista enseña TODO su porqué. */
const modelSuggestions = (page, week) => page.evaluate(async (wk) => {
  const [{ weeklyInsights }, { weeklyData }] = await Promise.all([import('./js/insights.js'), import('./js/views/weekly.js')]);
  return weeklyInsights(weeklyData(), wk).suggestions.map((m) => ({
    id: m.id, rule: m.why.rule, rows: m.why.data.map((d) => ({ label: d.label, value: d.value, sub: !!d.sub })),
  }));
}, week);

test('CRITERIO 6: cada sugerencia del panel semanal abre su «¿Por qué?» con la regla y los datos concretos que la generan', async () => {
  const app = await launch({ time: madrid(SAT, '20:00') });
  const { page } = app;
  try {
    // Sembrar por el store de la app (como si se hubiera registrado a lo largo de 6 semanas).
    const exById = await page.evaluate(() => Object.fromEntries(window.__app.store.all('exercises').map((e) => [e.id, { name: e.name, logType: e.logType }])));
    const seed = whySeed(exById);
    await page.evaluate(async ({ sessions, checkins, createdAt }) => {
      const { store } = window.__app;
      const meta = store.get('meta', 'app');
      meta.createdAt = createdAt;
      await store.save('meta', meta);
      for (const s of sessions) await store.save('sessions', s);
      for (const c of checkins) await store.save('checkins', c);
    }, { ...seed, createdAt: madrid(WHY_WEEKS[0], '09:00').getTime() });
    await reload(page);

    // Lo sembrado, calculado aquí: carga de cada semana (min × RPE) y su media de 4 semanas.
    const loads = WHY_WEEKS.map((w) => weekLoad(seed.sessions, w));
    assert.deepStrictEqual(loads, [1140, 1140, 1140, 1320, 1956]);
    const mean4 = (loads[0] + loads[1] + loads[2] + loads[3]) / 4; // 1185
    const loadPct = Math.round(((loads[4] - mean4) / mean4) * 100); // 65
    const curLoad = weekLoad(seed.sessions, MON); // 45×6 + 30×5 = 420
    const curMean = (loads[1] + loads[2] + loads[3] + loads[4]) / 4; // 1389
    const e1rm = (w, reps, rir) => Math.round(w * (1 + (reps + rir) / 30)); // Epley con reps + RIR

    // Revisa TODAS las sugerencias de la semana abierta: cada una con su botón «¿Por qué?» (cerrado al entrar); al
    // tocarlo muestra la regla y los datos, exactamente los del modelo, con cifras. Devuelve {id: porqué visto}.
    const checkAll = async (week, expectedIds) => {
      const list = await blockCards(page, 'suggestion');
      assert.deepStrictEqual(list.map((c) => c.id), expectedIds, `sugerencias de la semana ${week}`);
      const model = await modelSuggestions(page, week);
      assert.deepStrictEqual(model.map((m) => m.id), expectedIds);
      const seen = {};
      for (const c of list) {
        assert.strictEqual(c.whyLabel, '¿Por qué?', `${c.id}: botón «¿Por qué?»`);
        assert.ok(c.whyClosed, `${c.id}: el porqué empieza plegado`);
        assert.ok(c.badge && c.title && /\d/.test(`${c.title} ${c.text}`), `${c.id}: título y texto con cifras`);
        const w = await tapWhy(page, '.wk-msg', c.id);
        const m = model.find((x) => x.id === c.id);
        assert.strictEqual(w.rule, `Regla. ${m.rule}`, `${c.id}: la regla completa`);
        assert.deepStrictEqual(w.rows, m.rows, `${c.id}: todos los datos del porqué, en orden`);
        assert.ok(w.rule.length > 120, `${c.id}: la regla se explica`);
        assert.ok(w.rows.length >= 3 && w.rows.every((r) => r.label.trim() && r.value.trim()), `${c.id}: filas de datos`);
        assert.ok(w.rows.filter((r) => /\d/.test(r.value)).length >= 3, `${c.id}: cifras concretas`);
        seen[c.id] = { ...c, ...w };
      }
      return seen;
    };
    const row = (w, label) => {
      const r = w.rows.find((x) => x.label === label);
      assert.ok(r, `falta la fila «${label}»: ${JSON.stringify(w.rows.map((x) => x.label))}`);
      return r.value;
    };
    const setRows = (w) => w.rows.filter((r) => /^Serie \d/.test(r.label)).map((r) => r.value);

    // --- Semana terminada 14–20 sep: todas las sugerencias que avisan o proponen algo ------------------------------
    await freshView(page, () => go(page, `#/weekly?week=${PREV_MON}`));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 14–20 sep');
    const blocks = await page.locator('.wk-block').evaluateAll((els) => els.map((e) => e.dataset.section));
    assert.deepStrictEqual(blocks, ['info', 'suggestion'], 'información primero, sugerencias después');
    const DP_UP = [
      // id, título, «próxima vez», objetivo, serie, incremento, última sesión
      ['dominadas', 'Dominadas: añade 2,5 kg de lastre', 'lastre de +5 a +7,5 kg', '3×6–8 (tope 8 reps)', '+5 kg × 8 @1', 'compuesto de tren superior: 2,5 kg', 'jue 17 sep · Torso B y pierna'],
      ['fondos', 'Fondos en paralelas: reduce 2,5 kg la asistencia', 'asistencia de 20 a 17,5 kg', '3×8–10 (tope 10 reps)', '−20 kg asist. × 10 @1', 'compuesto de tren superior: 2,5 kg', 'jue 17 sep · Torso B y pierna'],
      ['bulgara', 'Sentadilla búlgara: sube 5 kg por lado', 'de 16 a 21 kg por lado', '3×8–10/lado (tope 10 reps)', '16 kg × 10/10 @1', 'compuesto de tren inferior: 5 kg por lado', 'jue 17 sep · Torso B y pierna'],
      ['curl_barra', 'Curl con barra: sube 1–2 kg', 'de 30 a 31–32 kg', '3×10–12 (tope 12 reps)', '30 kg × 12 @1', 'aislamiento o core: 1–2 kg', 'lun 14 sep · Torso A'],
      ['press_banca', 'Press banca: sube 2,5 kg', 'de 85 a 87,5 kg', '3×4–6 (tope 6 reps)', '85 kg × 6 @1', 'compuesto de tren superior: 2,5 kg', 'lun 14 sep · Torso A'],
      ['sentadilla', 'Sentadilla: sube 5 kg', 'de 100 a 105 kg', '3×6–8 (tope 8 reps)', '100 kg × 8 @2', 'compuesto de tren inferior: 5 kg', 'lun 14 sep · Torso A'],
    ];
    const prev = await checkAll(PREV_MON, [...DP_UP.map(([id]) => `dp-up-${id}`), 'load-warn', 'runkm-warn', 'deload']);
    await shotWhy(page, 'dp-up-press_banca', 'acceptance-6-why-dp-up');
    await shotWhy(page, 'load-warn', 'acceptance-6-why-load');

    // Doble progresión «sube»: las series efectivas concretas (sin el calentamiento), el objetivo y el incremento.
    for (const [id, title, next, target, set, inc, last] of DP_UP) {
      const w = prev[`dp-up-${id}`];
      assert.strictEqual(w.title, title);
      assert.match(w.text, new RegExp(`Próxima vez: ${next.replace(/[+]/g, '\\+')}\\.$`), `${id}: ${w.text}`);
      assert.match(w.rule, /llegaron al tope del rango con RIR ≥ 1/);
      assert.match(w.rule, /2,5 kg en compuestos de tren superior, 5 kg en compuestos de tren inferior y 1–2 kg en aislamiento y core/);
      assert.strictEqual(row(w, 'Última sesión'), last);
      assert.strictEqual(row(w, 'Objetivo'), target);
      assert.strictEqual(row(w, 'Series efectivas'), '3 de 3 en el tope con RIR ≥ 1 (objetivo: 3 series)');
      assert.strictEqual(setRows(w).length, 3, `${id}: solo las 3 series efectivas`);
      assert.ok(setRows(w).every((v) => v.endsWith('· ✓ tope y RIR')), `${id}: ${setRows(w)}`);
      assert.ok(setRows(w).includes(`${set} · ✓ tope y RIR`), `${id}: ${setRows(w)}`);
      assert.strictEqual(row(w, 'Incremento'), inc);
    }
    assert.deepStrictEqual(setRows(prev['dp-up-press_banca']), ['85 kg × 6 @2 · ✓ tope y RIR', '85 kg × 6 @1 · ✓ tope y RIR', '85 kg × 6 @1 · ✓ tope y RIR']);

    // Ronda 8 (B4): remo con pecho apoyado, jalón al pecho y peso muerto rumano no llegan a subir y llevan 5 semanas sin
    // mejorar su 1RM estimado: estancados (cuentan para la descarga). Antes salían A LA VEZ en «Mantén el peso»; ahora
    // no (una sola decisión, la de la sesión): su siguiente paso va en «Ejercicios estancados», con lo que falta.
    assert.strictEqual(prev['dp-hold'], undefined, 'estancados: no en «Mantén el peso»');
    const stalled = await tapWhy(page, '.wk-msg', 'ex-stalled');
    for (const name of ['Remo con pecho apoyado', 'Jalón al pecho', 'Peso muerto rumano']) {
      assert.strictEqual(row(stalled, `${name} · siguiente paso`), 'Llevas 3 sesiones sin progresar · revisar');
    }
    await shotWhy(page, 'ex-stalled', 'acceptance-6-why-stalled');

    // Aviso de carga: la semana, la media de las 4 previas con cada semana, la variación y los umbrales.
    const lw = prev['load-warn'];
    assert.strictEqual(lw.badge, 'Aviso');
    assert.strictEqual(lw.title, `Aviso: la carga sube un ${loadPct} %`);
    assert.match(lw.text, new RegExp(`\\(${nf(loads[4])}\\) supera en un ${loadPct} % la media de las 4 semanas previas \\(${nf(mean4)}\\)`));
    assert.match(lw.rule, /más de un 20 % \(aviso suave\) o de un 30 % \(aviso\)/);
    assert.match(lw.rule, /no una predicción de lesión/);
    assert.strictEqual(row(lw, 'Esta semana'), nf(loads[4]));
    assert.strictEqual(row(lw, 'Media de las 4 semanas previas'), nf(mean4));
    assert.deepStrictEqual(['Semana 17–23 ago', 'Semana 24–30 ago', 'Semana 31 ago – 6 sep', 'Semana 7–13 sep'].map((l) => row(lw, l)), loads.slice(0, 4).map((v) => nf(v)));
    assert.strictEqual(row(lw, 'Variación'), `+${loadPct} %`);
    assert.strictEqual(row(lw, 'Umbrales'), '+20 % aviso suave · +30 % aviso');

    // Aviso de km de carrera (suave): 11,2 km frente a 10 km.
    const rk = prev['runkm-warn'];
    assert.strictEqual(rk.badge, 'Aviso suave');
    assert.strictEqual(rk.title, 'Aviso suave: km de carrera +12 %');
    assert.match(rk.rule, /más de un 10 % \(aviso suave\) o de un 15 % \(aviso\) frente a la semana anterior; solo se evalúa si la semana anterior tuvo al menos 5 km/);
    assert.match(rk.rule, /no una predicción de lesión/);
    assert.strictEqual(row(rk, 'Km de carrera esta semana'), '11,2 km');
    assert.strictEqual(row(rk, 'Semana anterior'), '10 km');
    assert.strictEqual(row(rk, 'Variación'), '+12 %');
    assert.strictEqual(row(rk, 'Umbrales'), '+10 % aviso suave · +15 % aviso · mínimo 5 km la semana anterior');

    // Descarga: las tres condiciones con sus cifras (estancados con su 1RM estimado, RPE de cada sesión y check-ins).
    const dl = prev.deload;
    assert.strictEqual(dl.title, 'Valora una semana de descarga');
    assert.match(dl.rule, /\(a\) al menos 3 ejercicios estancados.*\(b\) esfuerzo percibido alto sostenido: RPE medio de las sesiones de fuerza de 8 o más en cada una de las últimas 2 semanas.*\(c\) si registraste check-ins en ese periodo, que al menos la mitad sean bajos/);
    assert.strictEqual(row(dl, '(a) Ejercicios estancados'), '3 (mínimo 3) · se cumple');
    assert.strictEqual(row(dl, 'Jalón al pecho'), `mejor previo ${e1rm(55, 12, 0)} kg · última ${e1rm(55, 12, 0)} kg`);
    assert.strictEqual(row(dl, 'Peso muerto rumano'), `mejor previo ${e1rm(90, 10, 2)} kg · última ${e1rm(90, 10, 2)} kg`);
    assert.strictEqual(row(dl, 'Remo con pecho apoyado'), `mejor previo ${e1rm(60, 10, 1)} kg · última ${e1rm(60, 10, 1)} kg`);
    assert.strictEqual(row(dl, '(b) RPE medio de fuerza (7–20 sep)'), 'medias por semana: 8,5 · 8,5 (umbral 8; 4 sesiones) · se cumple');
    assert.deepStrictEqual(['7 sep · Torso A', '10 sep · Torso B y pierna', '14 sep · Torso A', '17 sep · Torso B y pierna'].map((l) => row(dl, l)), ['RPE 8', 'RPE 9', 'RPE 9', 'RPE 8']);
    assert.strictEqual(row(dl, '(c) Check-ins (7–20 sep)'), '2 de 3 bajos (hace falta la mitad) · se cumple');
    assert.strictEqual(row(dl, '10 sep · antes'), 'sueño bajo · energía normal · agujetas normales → cuenta como bajo');
    assert.strictEqual(row(dl, '14 sep · antes'), 'sueño normal · energía baja · agujetas normales → cuenta como bajo');
    assert.strictEqual(row(dl, '17 sep · después'), 'sueño normal · energía normal · agujetas normales');
    await shotWhy(page, 'deload', 'acceptance-6-why-deload');

    // --- Semana en curso 21–27 sep: sin avisos de carga y sin señales de descarga (también con su porqué) ---------
    await freshView(page, () => page.locator('[data-nav="current"]').click());
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    const cur = await checkAll(MON, ['dp-up-dominadas', 'dp-up-fondos', 'dp-up-bulgara', 'dp-hold', 'load-ok', 'deload-none']);
    const ok = cur['load-ok'];
    assert.strictEqual(ok.title, 'Sin avisos de carga');
    assert.match(ok.text, new RegExp(`^De momento, la carga \\(${curLoad}\\) no supera la media de las 4 semanas previas \\(${nf(curMean)}\\) en más de un 20 %; km de carrera: de momento 5 km frente a 11,2 km \\(aviso desde \\+10 %\\)\\.$`));
    assert.strictEqual(row(ok, 'Esta semana'), `${curLoad} (en curso)`);
    assert.strictEqual(row(ok, 'Media de las 4 semanas previas'), nf(curMean));
    assert.strictEqual(row(ok, 'Semana 14–20 sep'), nf(loads[4]));
    assert.strictEqual(row(ok, 'Km de carrera esta semana'), '5 km (en curso)');
    assert.match(ok.rule, /Aviso orientativo si la carga.*Aviso orientativo si los km de carrera/, 'las dos reglas');
    const none = cur['deload-none'];
    assert.strictEqual(none.title, 'Sin señales de necesitar descarga');
    assert.strictEqual(none.text, 'No coinciden las condiciones. Estancados 3 (mínimo 3): sí · RPE medio de fuerza por semana 8,5 · 6 (umbral 8): no · check-ins bajos 1 de 2: sí.');
    assert.strictEqual(row(none, '(b) RPE medio de fuerza (13–26 sep)'), 'no se cumple: semana 20–26 sep con RPE medio 6 (umbral 8)');
    assert.strictEqual(row(none, '21 sep · Torso A'), 'RPE 6');
    assert.strictEqual(row(none, '(c) Check-ins (13–26 sep)'), '1 de 2 bajos (hace falta la mitad) · se cumple');
    assert.match(row(cur['dp-hold'], 'Press banca · 3×4–6'), /^21 sep · 1 de 3 series en el tope \(6 reps\)$/);
    await shotWhy(page, 'deload-none', 'acceptance-6-why-none');

    // Entre las dos semanas han salido todas las sugerencias que puede dar el panel.
    const kinds = new Set([...Object.keys(prev), ...Object.keys(cur)].map((id) => id.replace(/^dp-up-.*/, 'dp-up')));
    assert.deepStrictEqual([...kinds].sort(), ['deload', 'deload-none', 'dp-hold', 'dp-up', 'load-ok', 'load-warn', 'runkm-warn']);

    // La regla usa los umbrales actuales de Ajustes: al cambiarlos, cambian la sugerencia y su porqué.
    await page.evaluate(() => window.__app.store.saveSettings({
      increments: { upperCompound: 5, lowerCompound: 10, isolation: 1 }, loadWarn: { low: 20, high: 70 },
    }));
    await freshView(page, () => go(page, `#/weekly?week=${PREV_MON}`));
    const changed = await checkAll(PREV_MON, [...DP_UP.map(([id]) => `dp-up-${id}`), 'load-warn', 'runkm-warn', 'deload']);
    assert.strictEqual(changed['dp-up-press_banca'].title, 'Press banca: sube 5 kg');
    assert.strictEqual(row(changed['dp-up-press_banca'], 'Incremento'), 'compuesto de tren superior: 5 kg');
    assert.match(changed['dp-up-press_banca'].rule, /5 kg en compuestos de tren superior, 10 kg en compuestos de tren inferior/);
    assert.strictEqual(changed['dp-up-sentadilla'].title, 'Sentadilla: sube 10 kg');
    assert.strictEqual(changed['load-warn'].badge, 'Aviso suave');
    assert.match(changed['load-warn'].rule, /más de un 20 % \(aviso suave\) o de un 70 % \(aviso\)/);
    assert.strictEqual(row(changed['load-warn'], 'Umbrales'), '+20 % aviso suave · +70 % aviso');

    // «Lo importante esta semana» (Hoy; junta el panel y el analista): lo que destaca también lleva su «¿Por qué?» con datos.
    await freshView(page, () => tab(page, 'today').click());
    await page.waitForSelector('.today-extra[data-ready="1"] .focus');
    const summary = await page.locator('.focus-item').evaluateAll((els) => els.map((el) => el.dataset.id));
    assert.ok(summary.length >= 1, `la tarjeta de Hoy destaca algo: ${summary}`);
    for (const id of summary) {
      const w = await tapWhy(page, '.focus-item', id);
      assert.ok(w.rule.startsWith('Regla. ') && w.rule.length > 120, `${id}: regla`);
      assert.ok(w.rows.length >= 3 && w.rows.filter((r) => /\d/.test(r.value)).length >= 3, `${id}: datos con cifras`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desbordamiento horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
