// E2E de las marcas históricas (ronda 6, fase B; docs/MEJORAS6.md): Récords › «Marcas históricas», añadir con el
// selector de ejercicios y fecha aproximada, la comparación «Rendimiento actual ≈ N % de tu mejor marca histórica» con
// su «¿Cómo se calcula?», la tarjeta de la ficha de progreso, editar, borrar con deshacer, peso corporal con
// asistencia (375 px), la copia de seguridad y el mismo recorrido en WebKit si está instalado.
// La fecha se fija con el reloj de Playwright (viernes 2 oct 2026, 18:00 en Madrid).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/past-records.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const playwright = require('playwright');
const { waitReady, go, reload, idbAll, settle, waitRoute, shot, engineAvailable } = require('./helpers.cjs');

const TODAY = '2026-10-02';
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const epley = (w, reps, rir = 0) => w * (1 + (reps + rir) / 30);
/** Como fmtNum(v, 1) de la app: «68,4» · «76». */
const es1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

async function launch({ width = 390, height = 844, browser: name = 'chromium' } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await playwright[name].launch();
  const context = await browser.newContext({
    ...playwright.devices['iPhone 13'], viewport: { width, height }, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
  });
  await context.clock.install({ time: madrid(TODAY) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  return { browser, context, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

/** Press banca en Entreno (nada más): 80 × 8 @2 hace 40 días (antes de la ventana) y 87,5 × 8 @2 hace 6 días. */
async function seed(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    for (const [ago, w] of [[40, 80], [6, 87.5]]) {
      const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -ago), past: true });
      // Solo el press banca se hace: el resto de la rutina (también las dominadas) queda sin series.
      for (const se of s.exercises) if (se.exerciseId === 'press_banca') se.sets.forEach((x) => Object.assign(x, { weight: w, reps: 8, rir: 2, done: true, doneAt: 1 }));
      m.finishSession(s, { durationMin: 60, rpe: 7 });
      await store.save('sessions', s);
    }
    await store.save('bodyweight', { id: u.addDays(u.todayStr(), -3), kg: 74 });
  });
}

const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const errors = (page) => page.locator('.pr-form .form-error:not([hidden])').allInnerTexts();
/** Ningún campo del formulario se sale de su caja (p. ej. el segmentado «Lastre · Asistencia» sobre las repeticiones). */
const fieldsFit = (page) => page.evaluate(() => [...document.querySelectorAll('.pr-field')].filter((f) => f.scrollWidth > f.clientWidth + 1).map((f) => f.dataset.field));

async function pick(page, query, name) {
  await page.locator('.pr-pick').click();
  await page.locator('.pick-sheet .search-input').fill(query);
  await page.locator('.pick-row', { has: page.locator('.pick-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await page.waitForSelector('.sheet-overlay', { state: 'detached' });
  await settle(page);
}

/** Añadir → guardar → editar → borrar (con deshacer): el recorrido de siempre, en el motor que toque. */
async function marksFlow(page, { shots = false } = {}) {
  await seed(page);
  // Récords › Fuerza: la fila de marcas históricas, aparte de los récords de Entreno
  await go(page, '#/records');
  const link = page.locator('.pr-link');
  assert.strictEqual(await link.locator('.list-item-sub').innerText(), 'Añade tus mejores marcas de antes de Entreno');
  await link.click();
  await waitRoute(page, /^#\/records\/past$/);
  assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Marcas históricas');
  assert.match(await page.locator('.pr-empty').innerText(), /Aún no hay marcas históricas/);
  await page.locator('.pr-empty .btn-primary').click();
  await waitRoute(page, /^#\/records\/past\/new$/);

  // Formulario: sin nada, dice qué falta y no guarda
  await page.locator('.pr-save').click();
  assert.deepStrictEqual(await errors(page), ['Elige el ejercicio.', 'Escribe el peso (kg).', 'Repeticiones: de 1 a 50.']);
  assert.deepStrictEqual(await idbAll(page, 'pastRecords'), []);
  await pick(page, 'press banca', 'Press banca');
  assert.strictEqual(await page.locator('.pr-pick .list-item-title').innerText(), 'Press banca');
  await page.locator('input[aria-label="Peso"]').fill('100');
  await page.locator('input[aria-label="Repeticiones"]').fill('5');
  assert.strictEqual(await page.locator('.pr-preview').innerText(), '1RM estimado ≈ 116,7 kg (estimación).', 'sin RIR: como al fallo');
  await page.locator('.pr-rir .chip', { hasText: /^1$/ }).click();
  assert.strictEqual(await page.locator('.pr-preview').innerText(), '1RM estimado ≈ 120 kg (estimación).');
  // Fecha aproximada: apagada por defecto (sin fecha vale); verano 2025
  assert.strictEqual(await page.locator('[data-switch="date"] input').isChecked(), false);
  assert.strictEqual(await page.locator('.ctx-approx').count(), 0);
  await page.locator('[data-switch="date"] input').check();
  await page.locator('.ctx-approx .seg-btn', { hasText: 'Estación' }).click();
  await page.locator('select[data-part="estación"]').selectOption('summer');
  await page.locator('select[data-part="año"]').selectOption('2025');
  assert.strictEqual(await page.locator('[data-switch="before"] input').isChecked(), true, '«Anterior a Entreno» encendido por defecto');
  await page.locator('textarea[aria-label="Nota"]').fill('En mi antiguo gimnasio');
  assert.ok(await noHScroll(page));
  if (shots) await shot(page, 'past-form');
  await page.locator('.pr-save').click();
  await waitRoute(page, /^#\/records\/past$/);

  let disk = await idbAll(page, 'pastRecords');
  assert.strictEqual(disk.length, 1);
  const rec = disk[0];
  assert.match(rec.id, /^pr_/);
  assert.deepStrictEqual(
    { exerciseId: rec.exerciseId, weight: rec.weight, reps: rec.reps, rir: rec.rir, date: rec.date, beforeApp: rec.beforeApp, bodyweightKg: rec.bodyweightKg, note: rec.note },
    { exerciseId: 'press_banca', weight: 100, reps: 5, rir: 1, date: { date: '2025-06-01', precision: 'season' }, beforeApp: true, bodyweightKg: null, note: 'En mi antiguo gimnasio' },
  );
  // Recién creada: createdAt sale de pastRecordFrom y updatedAt del sello de store.save (dos Date.now() seguidos, que
  // pueden caer en milisegundos distintos): se comprueba que es de ahora y que no hay una edición posterior.
  assert.ok(rec.createdAt > 0 && rec.updatedAt >= rec.createdAt && rec.updatedAt - rec.createdAt < 1000, `${rec.createdAt} / ${rec.updatedAt}`);

  // Lista: por ejercicio, con la comparación (87,5 × 8 @2 hace 6 días frente a 100 × 5 @1)
  const grp = page.locator('.pr-group[data-ex="press_banca"]');
  const pct = Math.round((epley(87.5, 8, 2) / epley(100, 5, 1)) * 100);
  assert.strictEqual(pct, 97);
  assert.strictEqual(await grp.locator('.pr-recovery-line').innerText(), 'Rendimiento actual ≈ 97 % de tu mejor marca histórica.');
  assert.strictEqual(await grp.locator('.pr-recovery').getAttribute('data-pct'), '97');
  assert.strictEqual(await grp.locator('.pr-row-mark').innerText(), '100 kg × 5 @1');
  assert.strictEqual(await grp.locator('.pr-row-meta').innerText(), 'verano 2025 · antes de Entreno · 1RM est. ≈ 120 kg');
  assert.strictEqual(await grp.locator('.pr-row-note').innerText(), 'En mi antiguo gimnasio');
  await grp.locator('.why-btn').click();
  const why = grp.locator('.pr-why');
  assert.deepStrictEqual(await why.locator('.wk-why-label').allInnerTexts(), ['Ahora', 'Mejor marca histórica', 'Cálculo']);
  assert.deepStrictEqual(await why.locator('.wk-why-value').allInnerTexts(), ['116,7 kg · 87,5 kg × 8 @2 · 26 sep', '120 kg · 100 kg × 5 @1 · verano 2025', '116,7 ÷ 120 = 97 %']);
  assert.match(await why.locator('.pr-why-notes').innerText(), /Epley[\s\S]*estimación[\s\S]*Fecha aproximada \(verano 2025\)/);
  if (shots) await shot(page, 'past-list');

  // Ficha de progreso del ejercicio: la tarjeta bajo los datos clave
  await grp.locator('.pr-group-head').click();
  await waitRoute(page, /^#\/progress\/exercise\/press_banca$/);
  const card = page.locator('.pr-card');
  assert.strictEqual(await card.locator('.pr-card-best').innerText(), '100 kg × 5 @1 · verano 2025 · antes de Entreno');
  assert.strictEqual(await card.locator('.pr-recovery-line').innerText(), 'Rendimiento actual ≈ 97 % de tu mejor marca histórica.');
  const order = await page.evaluate(() => [document.querySelector('.prg-kpis'), document.querySelector('.pr-card'), document.querySelector('.prg-charts')].map((e) => e.getBoundingClientRect().top));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'datos clave → marca histórica → gráficas');
  if (shots) await shot(page, 'past-exercise');
  await card.locator('.pr-card-all').click();
  await waitRoute(page, /^#\/records\/past$/);

  // Editar: mismo registro, createdAt intacto
  await page.locator('.pr-row').click();
  await waitRoute(page, /^#\/records\/past\/pr_/);
  assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Editar marca');
  assert.strictEqual(await page.locator('input[aria-label="Peso"]').inputValue(), '100');
  assert.strictEqual(await page.locator('.pr-rir .chip.active').innerText(), '1');
  assert.strictEqual(await page.locator('select[data-part="año"]').inputValue(), '2025');
  await page.locator('input[aria-label="Repeticiones"]').fill('6');
  await page.locator('.pr-save').click();
  await waitRoute(page, /^#\/records\/past$/);
  disk = await idbAll(page, 'pastRecords');
  assert.deepStrictEqual([disk.length, disk[0].id, disk[0].reps, disk[0].createdAt], [1, rec.id, 6, rec.createdAt]);
  assert.ok(disk[0].updatedAt >= rec.updatedAt);
  assert.strictEqual(await page.locator('.pr-recovery-line').innerText(), `Rendimiento actual ≈ ${Math.round((epley(87.5, 8, 2) / epley(100, 6, 1)) * 100)} % de tu mejor marca histórica.`);

  // Borrar con deshacer
  await page.locator('.pr-row').click();
  await waitRoute(page, /^#\/records\/past\/pr_/);
  await page.locator('.pr-delete').click();
  await page.locator('.sheet-panel .btn-danger', { hasText: 'Borrar' }).click();
  await waitRoute(page, /^#\/records\/past$/);
  assert.deepStrictEqual(await idbAll(page, 'pastRecords'), []);
  await page.locator('.toast .toast-action').click();
  await page.waitForFunction(async () => (await new Promise((res) => {
    const r = indexedDB.open('entreno');
    r.onsuccess = () => { const q = r.result.transaction('pastRecords').objectStore('pastRecords').count(); q.onsuccess = () => { res(q.result); r.result.close(); }; };
  })) === 1);
  await settle(page);
  assert.strictEqual(await page.locator('.pr-row').count(), 1, 'deshacer la devuelve (y la lista se repinta)');
  return rec.id;
}

test('marcas históricas: añadir con fecha aproximada, % de recuperación con su porqué, ficha, editar y borrar con deshacer', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const id = await marksFlow(page, { shots: true });
    // Copia de seguridad: va en la copia y vuelve al restaurarla
    const back = await page.evaluate(async () => {
      const { store } = window.__app;
      const data = store.exportData();
      await store.importData({ ...data, data: { ...data.data, pastRecords: [] } });
      const emptied = store.all('pastRecords').length;
      await store.importData(data);
      return { inBackup: data.data.pastRecords.map((r) => r.id), emptied, restored: store.all('pastRecords').map((r) => r.id) };
    });
    assert.deepStrictEqual(back, { inBackup: [id], emptied: 0, restored: [id] });
    // Ajustes › Copias y datos la cuenta
    await go(page, '#/settings/data');
    assert.strictEqual(await page.locator('[data-count="pastRecords"] .cfg-kv-value').innerText(), '1');
    // Cerrar y volver a abrir: sigue ahí
    await reload(page);
    await go(page, '#/records/past');
    assert.strictEqual(await page.locator('.pr-row').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: marcas históricas (añadir, comparar, editar y borrar con deshacer)', { skip: skipWebkit }, async () => {
  const app = await launch({ browser: 'webkit' });
  try {
    await marksFlow(app.page);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('peso corporal con asistencia (375 px), ficha sin marcas y ejercicio sin series en las últimas 4 semanas', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    await seed(page);
    // Dominadas: sin marcas, la ficha ofrece una fila discreta que abre el formulario con el ejercicio elegido
    await go(page, '#/progress/exercise/dominadas');
    const add = page.locator('.pr-link-add');
    assert.strictEqual(await add.locator('.list-item-title').innerText(), 'Añadir marca histórica');
    assert.strictEqual(await page.locator('.pr-card').count(), 0);
    await add.click();
    await waitRoute(page, /^#\/records\/past\/new\?exercise=dominadas$/);
    assert.strictEqual(await page.locator('.pr-pick .list-item-title').innerText(), 'Dominadas');
    // Lastre o asistencia: el signo con el segmentado (el teclado decimal del iPhone no tiene «−»)
    assert.deepStrictEqual(await page.locator('[data-field="weight"] .seg-btn').allInnerTexts(), ['Lastre', 'Asistencia']);
    await page.locator('[data-field="weight"] .seg-btn', { hasText: 'Asistencia' }).click();
    await page.locator('input[aria-label="Kilos de lastre o asistencia"]').fill('20');
    await page.locator('input[aria-label="Repeticiones"]').fill('8');
    // Sin peso de entonces: usa el último pesaje (74 kg) y lo dice
    assert.strictEqual(await page.locator('.pr-preview').innerText(), `1RM estimado ≈ ${es1(epley(54, 8))} kg (estimación, con 74 kg de peso corporal).`);
    await page.locator('input[aria-label="Peso corporal entonces"]').fill('80');
    assert.strictEqual(await page.locator('.pr-preview').innerText(), `1RM estimado ≈ ${es1(epley(60, 8))} kg (estimación, con 80 kg de peso corporal).`);
    for (const b of await page.locator('.pr-form .seg-btn, .pr-rir .chip, .pr-save, .pr-pick').all()) {
      assert.ok((await b.boundingBox()).height >= 44, 'botones ≥ 44 px');
    }
    assert.ok(await noHScroll(page), 'sin desplazamiento horizontal a 375 px');
    assert.deepStrictEqual(await fieldsFit(page), [], 'cada campo cabe en su sitio');
    await shot(page, 'past-bodyweight');
    await page.locator('.pr-save').click();
    await waitRoute(page, /^#\/progress\/exercise\/dominadas$/);
    const disk = (await idbAll(page, 'pastRecords'))[0];
    assert.deepStrictEqual([disk.exerciseId, disk.weight, disk.reps, disk.rir, disk.date, disk.bodyweightKg], ['dominadas', -20, 8, null, null, 80]);
    // La ficha ya tiene la tarjeta; sin series de dominadas en Entreno → aún no se puede comparar (y se dice)
    const card = page.locator('.pr-card');
    await card.waitFor();
    assert.match(await card.locator('.pr-card-best').innerText(), /^−20 kg.* × 8 · sin fecha · antes de Entreno$/);
    assert.match(await card.locator('.pr-recovery-line').innerText(), /^Cuando registres este ejercicio/);
    assert.strictEqual(await card.locator('.pr-recovery').getAttribute('data-status'), 'no_current');
    assert.ok(await noHScroll(page));

    // Una marca con más de 12 repeticiones: se guarda, pero no se compara
    await go(page, '#/records/past/new?exercise=press_banca');
    await page.locator('input[aria-label="Peso"]').fill('60');
    await page.locator('input[aria-label="Repeticiones"]').fill('20');
    assert.strictEqual(await page.locator('.pr-preview').innerText(), 'Con más de 12 repeticiones no se estima el 1RM: se guarda, pero no se compara.');
    assert.deepStrictEqual(await fieldsFit(page), [], 'peso y repeticiones en dos columnas, sin salirse');
    // Fecha encendida pero futura: no se guarda
    await page.locator('[data-switch="date"] input').check();
    await page.locator('.ctx-approx .seg-btn', { hasText: 'Mes' }).click();
    await page.locator('select[data-part="mes"]').selectOption('12');
    await page.locator('select[data-part="año"]').selectOption('2026');
    await page.locator('.pr-save').click();
    assert.deepStrictEqual(await errors(page), ['La fecha no puede ser futura.']);
    await page.locator('select[data-part="año"]').selectOption('2024');
    await page.locator('.pr-save').click();
    await page.waitForFunction(() => !/new/.test(location.hash));
    await go(page, '#/records/past');
    const grp = page.locator('.pr-group[data-ex="press_banca"]');
    assert.strictEqual(await grp.locator('.pr-row-meta').innerText(), 'diciembre 2024 · antes de Entreno · sin 1RM (más de 12 reps)');
    // Referencia: lo de Entreno de antes de las 4 semanas (80 × 8 @2), porque la marca no se puede estimar
    assert.strictEqual(await grp.locator('.pr-recovery-line').innerText(), `Rendimiento actual ≈ ${Math.round((epley(87.5, 8, 2) / epley(80, 8, 2)) * 100)} % de tu mejor marca anterior en Entreno: ya la has superado.`);
    assert.deepStrictEqual(await page.locator('.pr-group').evaluateAll((els) => els.map((e) => e.dataset.ex)).then((l) => l.sort()), ['dominadas', 'press_banca']);
    assert.ok(await noHScroll(page));
    await shot(page, 'past-list-375');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
