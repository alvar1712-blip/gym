// PRUEBAS DE ACEPTACIÓN de la Fase 1 (docs/REQUISITOS.md §15), de punta a punta y por la interfaz real.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/acceptance.test.cjs
//
//  1. «Cierro Safari o la app a mitad de sesión, vuelvo y no se ha perdido nada.»
//  2. «Exporto una copia, borro los datos, importo la copia y todo queda idéntico.»
//  3. «Registrar una serie con los valores prellenados me cuesta 1–2 toques.»
//  4. «Sustituir el Día 6 de esta semana por una ruta en bici no modifica mi semana tipo.»
//  5. «Funciona sin conexión una vez instalada en la pantalla de inicio.»
// (El criterio del «¿Por qué?» del panel semanal es de la Fase 3.)
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
const { chromium, devices } = require('playwright');
const { waitReady, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals'];
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
  const browser = await chromium.launch();
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
  return {
    browser, context, page, server, url: server.url, errors, newPage,
    close: async () => { await browser.close(); await server.close(); },
  };
}

const hashOf = (page) => page.evaluate(() => location.hash);
const getSession = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', i))), id);
const card = (page, seId) => page.locator(`[data-se="${seId}"]`);
/** El botón «Registrar» ignora un segundo toque durante 300 ms (doble toque accidental). */
const guard = (page) => page.waitForTimeout(320);
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
const sheetBtn = (page, text) => sheetPanel(page).locator('button', { hasText: text });
const waitNoSheet = (page) => page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 5000 });
const tab = (page, id) => page.locator(`#tabbar .tab[data-tab="${id}"]`);
const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

const settingsOf = (snap) => snap.meta.find((m) => m.id === 'settings');
/** Copia de una instantánea sin el sello `updatedAt` de los ajustes. */
const noSettingsStamp = (snap) => ({
  ...snap,
  meta: snap.meta.map((m) => {
    if (m.id !== 'settings') return m;
    const { updatedAt, ...rest } = m;
    return rest;
  }),
});

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

/** Todas las stores tal como están en IndexedDB (disco). */
async function idbSnapshot(page) {
  const out = {};
  for (const s of STORES) out[s] = byId(await idbAll(page, s));
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
    await bc.locator('.ses-editor button[aria-label="Sumar 2,5"]').click();
    await bc.locator('.ses-register').click();
    await guard(page);
    // Dominadas: serie 1 EDITADA con los steppers (+2,5 kg de lastre, −1 rep) y RIR 0, SIN confirmar.
    const pc = card(page, pull.id);
    await pc.locator('.ses-editor button[aria-label="Sumar 2,5"]').click();
    await pc.locator('.ses-editor button[aria-label="Restar 1"]').click();
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
    await card(page, pullId).locator('.ses-editor button[aria-label="Sumar 2,5"]').click();
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
    await bc.locator('.ses-editor button[aria-label="Sumar 2,5"]').click();
    await bc.locator('.ses-editor button[aria-label="Sumar 1"]').click();
    await page.locator('textarea.ses-notes').fill('Nota escrita justo antes de salir');
    const expected = await getSession(page, id);
    assert.deepStrictEqual([expected.exercises[0].sets[1].weight, expected.exercises[0].sets[1].reps], [82.5, 6]);
    let disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual([disk.exercises[0].sets[1].weight, disk.notes], [80, ''], 'aún no está en disco (guardado diferido)');

    // Pasar a segundo plano (cambiar de app / bloquear el iPhone).
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual(disk, expected, 'al pasar a segundo plano se escribe todo en disco sin esperar');

    // iOS mata la app en segundo plano: sin pagehide ni beforeunload (el proceso muere).
    await app.context.clock.resume();
    const cdp = await app.context.newCDPSession(page);
    const crashed = page.waitForEvent('crash');
    cdp.send('Page.crash').catch(() => {});
    await crashed;

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

    // Ajustes → Copias y datos → Exportar copia (hoja de compartir de iOS).
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
    // Nota: al anotar la copia, los ajustes en disco reciben un updatedAt nuevo (posterior al archivo);
    // es el único campo que no puede coincidir con el archivo (ver informe). El resto de «before» = archivo.
    assert.deepStrictEqual(noSettingsStamp(before), noSettingsStamp(fileData));

    // Borrar todos los datos: doble confirmación (Continuar → escribir BORRAR → Borrar todo).
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Continuar').click();
    await page.waitForFunction(() => document.querySelector('.sheet-overlay.open input'));
    assert.ok(await sheetBtn(page, 'Borrar todo').isDisabled(), 'sin escribir BORRAR no se puede');
    await sheetPanel(page).locator('input').fill('BORRAR');
    await sheetBtn(page, 'Borrar todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 0, null, { timeout: 5000 });
    const wiped = await idbSnapshot(page);
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
    // …y al estado del disco en el momento de exportar (salvo el sello updatedAt de los ajustes, ver arriba).
    const b = noSettingsStamp(before);
    const a = noSettingsStamp(after);
    for (const s of STORES) assert.deepStrictEqual(a[s], b[s], `IndexedDB «${s}» idéntica a la de antes de borrar`);
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
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, prevId, { timeout: 5000 });
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
    await b.locator('.ses-editor button[aria-label="Sumar 2,5"]').click();
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
    // La primera visita instala el SW; al tomar el control la app se recarga sola.
    // Esperar a un documento que ya se cargó controlado por el SW (marcado por un script de inicio) y listo.
    await page.waitForFunction(() => document.documentElement.classList.contains('ready')
      && !!navigator.serviceWorker.controller && window.__controlledAtLoad === true, null, { timeout: 15000 });
    assert.strictEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.state), 'activated');
    await seedLastD1(page, PREV_MON);

    assert.match(app.url, /\/gym\/$/);
    assert.strictEqual(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).scope), app.url);

    // Sin red: modo avión y, además, el servidor apagado (no responde a nada).
    await app.context.setOffline(true);
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
    // Pantallas secundarias (todas las de la Fase 1).
    for (const r of ['#/history', `#/day/${MON}`, '#/calendar?view=month', '#/exercises?seg=library', '#/exercises?seg=templates', '#/template/tpl_d1',
      '#/exercise/press_banca', '#/exercise/new', '#/bodyweight', '#/activity/new?kind=run', '#/activity/new?kind=swim',
      '#/settings/week', '#/settings/thresholds', '#/settings/data']) {
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
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, id, { timeout: 5000 });
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
