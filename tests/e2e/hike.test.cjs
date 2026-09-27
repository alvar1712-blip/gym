// E2E del senderismo (kind 'hike', docs/MEJORAS.md §1): acceso rápido de Hoy, formulario con todos sus campos,
// historial y su filtro, selector de tipo, sesión libre del calendario, Progreso (carga, km, récords), panel
// semanal y objetivos. Capturas a 390 px en test-results/hike-*.png.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/hike.test.cjs
// La fecha se fija con page.clock: sábado 26 sep 2026.
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll, storeAll, shot } = require('./helpers.cjs');

const FRI = '2026-09-25';
const SAT = '2026-09-26';
const at = (date, time = '10:00:00') => new Date(`${date}T${time}`);
const hash = (page) => page.evaluate(() => location.hash);
const settle = (page, ms = 450) => page.waitForTimeout(ms); // saveSoon escribe a los 250 ms
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
async function waitHash(page, re) {
  await page.waitForFunction((src) => new RegExp(src).test(location.hash), re.source, { timeout: 5000 });
  await page.waitForTimeout(150);
}
/** Cajas de los elementos (para comprobar filas, tamaños y que el texto no se corta). */
const boxes = (loc) => loc.evaluateAll((els) => els.map((e) => {
  const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), left: Math.round(r.left), w: r.width, h: r.height, text: e.innerText.trim(), cut: e.scrollWidth > e.clientWidth + 1 };
}));

/** Abre la app a 390 px (iPhone 13) con la fecha fijada. */
async function setup(date = SAT) {
  const app = await openApp();
  await app.page.setViewportSize({ width: 390, height: 844 });
  await app.page.clock.setFixedTime(at(date));
  await reload(app.page);
  return app;
}

/** Siembra rutas de senderismo y carreras con buildRecord (lo mismo que guarda el formulario). */
function seedActivities(page, list) {
  return page.evaluate(async (items) => {
    const L = await import('./js/activity-logic.js');
    for (const it of items) {
      const f = { ...L.emptyForm(it.kind, { date: it.date }), ...it.form };
      await window.__app.store.save('sessions', L.buildRecord(f, null, { id: it.id, now: new Date(`${it.date}T09:00:00`).getTime() }));
    }
  }, list);
}

test('senderismo desde Hoy: acceso rápido, formulario con todos los campos, guardado y filtro del historial', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/today');
    // Accesos rápidos: seis botones en 3 × 2, todos cómodos (≥ 44 px) y sin cortar «Senderismo».
    const quick = page.locator('.today-quick-btn');
    const q = await boxes(quick);
    assert.deepStrictEqual(q.map((b) => b.text.replace(/\s+/g, ' ')), ['🏃 Carrera', '🚴 Bici', '🏊 Natación', '🥾 Senderismo', '⚡ Otra', '🏋️ Fuerza libre']);
    assert.ok(q.every((b) => b.h >= 44 && b.w >= 90), 'botones grandes');
    assert.ok(q[0].top === q[1].top && q[1].top === q[2].top && q[3].top > q[0].top && q[3].top === q[5].top, '3 × 2');
    assert.ok(!(await page.locator('.today-quick-btn[data-kind="hike"] .today-quick-label').evaluate((e) => e.scrollWidth > e.clientWidth + 1)));
    assert.ok(await noHScroll(page));
    await page.locator('.today-quick').scrollIntoViewIfNeeded();
    await shot(page, 'hike-today');

    await page.locator('.today-quick-btn[data-kind="hike"]').click();
    await waitHash(page, /^#\/activity\/new/);
    assert.strictEqual(await hash(page), `#/activity/new?kind=hike&date=${SAT}`);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nuevo senderismo');
    assert.strictEqual(await page.locator('.act-kinds').count(), 0, 'con kind en la query no hay selector de tipo');
    // Lo que no aplica al senderismo no aparece
    assert.strictEqual(await page.locator('[aria-label^="Cadencia"]').count(), 0);
    assert.strictEqual(await page.getByText('Tipo de sesión', { exact: true }).count(), 0);
    assert.strictEqual(await page.locator('[aria-label="Zona o sensaciones"]').count(), 0);

    await page.fill('[aria-label="Distancia (km)"]', '14,2');
    await page.fill('[aria-label="Tiempo en movimiento: h"]', '4');
    await page.fill('[aria-label="Tiempo en movimiento: min"]', '5');
    await settle(page);
    assert.match(await hash(page), /^#\/activity\/a_/, 'se crea en cuanto tiene duración');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Senderismo');
    // 14 700 s / 14,2 km = 1035 s/km → 17:15 /km
    assert.strictEqual(await page.locator('.act-live-value').first().innerText(), '17:15 /km');
    await page.locator('.rpe-chips .chip').nth(5).click(); // esfuerzo 6
    assert.strictEqual(await page.locator('.act-load').innerText(), '1.470'); // 245 min × 6
    await page.fill('[aria-label="Tiempo total: h"]', '5');
    await page.fill('[aria-label="Tiempo total: min"]', '10');
    await page.fill('[aria-label="Desnivel positivo (m)"]', '850');
    await page.fill('[aria-label="Desnivel negativo (m)"]', '830');
    await page.fill('[aria-label="Altitud máxima (m)"]', '2150');
    await page.fill('[aria-label="Peso de la mochila (kg)"]', '7,5');
    await page.fill('[aria-label="FC media (lpm)"]', '118');
    await page.fill('[aria-label="FC máxima (lpm)"]', '162');
    await page.fill('[aria-label="Notas"]', 'Peñalara por Dos Hermanas');
    assert.match(await page.locator('.act-live').innerText(), /14,2 km a 3,5 km\/h · \+850 m/);
    await settle(page);
    assert.ok(await noHScroll(page));
    // Campos cómodos: ≥ 44 px de alto y texto ≥ 16 px (sin zoom de iOS)
    const inputs = await page.locator('.act-body input').evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize), l: e.getAttribute('aria-label') })));
    for (const i of inputs) assert.ok(i.h >= 44 && i.fs >= 16, `${i.l}: ${i.h} px, ${i.fs} px`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'hike-form-top');
    await page.locator('.act-hike-grid').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 120));
    await shot(page, 'hike-form-details');

    const [rec] = await idbAll(page, 'sessions');
    const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));
    assert.deepStrictEqual(pick(rec, ['kind', 'status', 'date', 'planDate', 'movingSec', 'elapsedSec', 'durationMin', 'distanceKm', 'elevationM', 'elevationLossM', 'altMaxM', 'hrAvg', 'hrMax', 'rpe', 'packKg', 'notes', 'templateName']), {
      kind: 'hike', status: 'done', date: SAT, planDate: SAT, movingSec: 14700, elapsedSec: 18600, durationMin: 245, distanceKm: 14.2,
      elevationM: 850, elevationLossM: 830, altMaxM: 2150, hrAvg: 118, hrMax: 162, rpe: 6, packKg: 7.5, notes: 'Peñalara por Dos Hermanas', templateName: 'Senderismo',
    });

    // «Listo» vuelve a Hoy, donde la ruta cuenta para el día
    await page.locator('.act-done').click();
    await waitHash(page, /^#\/today$/);
    assert.match(await page.locator(`.today-plan .cal-ses-row[data-id="${rec.id}"]`).innerText(), /🥾[\s\S]*Senderismo[\s\S]*14,2 km · \+850 m/);

    // Historial: filtro «Senderismo» (tras Natación), filas con distancia y desnivel
    await seedActivities(page, [{ id: 'r1', kind: 'run', date: '2026-09-24', form: { movingSec: 3000, distanceKm: 10, rpe: 6 } }]);
    await go(page, '#/history');
    const chipsTxt = await page.locator('.hist-filters .chip').allInnerTexts();
    assert.deepStrictEqual(chipsTxt, ['Todas', 'Fuerza', 'Carrera', 'Bici', 'Natación', 'Senderismo', 'Otras']);
    await page.locator('.hist-filters .chip', { hasText: 'Senderismo' }).click();
    assert.strictEqual(await hash(page), '#/history?f=hike');
    const ids = await page.locator('.hist-list .cal-ses-row').evaluateAll((els) => els.map((e) => e.dataset.id));
    assert.deepStrictEqual(ids, [rec.id]);
    assert.match(await page.locator(`.cal-ses-row[data-id="${rec.id}"]`).innerText(), /Senderismo[\s\S]*sáb 26 sep · 4 h 05 min · carga 1.470[\s\S]*14,2 km · \+850 m/);
    const bg = await page.locator(`.cal-ses-row[data-id="${rec.id}"] .cal-emoji`).evaluate((e) => getComputedStyle(e).backgroundColor);
    assert.strictEqual(bg, 'rgba(45, 212, 191, 0.16)', 'fondo turquesa del senderismo');
    assert.ok(await noHScroll(page));
    await go(page, '#/history');
    await shot(page, 'hike-history');
    await go(page, '#/history?f=run');
    assert.deepStrictEqual(await page.locator('.hist-list .cal-ses-row').evaluateAll((els) => els.map((e) => e.dataset.id)), ['r1'], 'el senderismo no sale en Carrera');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('selector de tipo: cinco deportes en dos filas sin cortar; carrera → senderismo conserva el desnivel', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/activity/new');
    const seg = page.locator('.act-kinds .seg-btn');
    const b = await boxes(seg);
    assert.deepStrictEqual(b.map((x) => x.text), ['Carrera', 'Bici', 'Natación', 'Senderismo', 'Otra']);
    assert.ok(b.every((x) => x.h >= 44 && !x.cut), 'botones ≥ 44 px y sin texto cortado');
    assert.ok(b[0].top === b[2].top && b[3].top > b[0].top && b[3].top === b[4].top, '3 + 2');
    await seg.nth(3).click();
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nuevo senderismo');
    assert.strictEqual(await page.locator('[aria-label="Desnivel positivo (m)"]').count(), 1);
    await shot(page, 'hike-kind-picker');

    // Carrera guardada con desnivel → senderismo: se avisa de lo que se pierde (cadencia, tipo) y el desnivel sigue
    await seedActivities(page, [{ id: 'a_run', kind: 'run', date: '2026-09-25', form: { movingSec: 3600, distanceKm: 9, elevationM: 320, cadence: 168, subtype: 'long', rpe: 5 } }]);
    await go(page, '#/activity/a_run');
    await page.locator('.act-kinds .seg-btn', { hasText: 'Senderismo' }).click();
    await page.waitForTimeout(250);
    const msg = await page.locator('.sheet-panel').innerText();
    assert.match(msg, /¿Cambiar a senderismo\?/);
    assert.match(msg, /cadencia/);
    assert.doesNotMatch(msg, /desnivel/);
    await page.locator('.sheet-panel .btn-danger').click();
    await settle(page);
    const r = (await storeAll(page, 'sessions')).find((x) => x.id === 'a_run');
    assert.deepStrictEqual([r.kind, r.elevationM, r.cadence, r.subtype, r.templateName], ['hike', 320, null, null, 'Senderismo']);
    assert.strictEqual(await page.locator('[aria-label="Desnivel positivo (m)"]').inputValue(), '320');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('sesión libre de senderismo en el calendario; Progreso, récords, panel semanal y objetivo', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedActivities(page, [
      { id: 'h1', kind: 'hike', date: '2026-09-06', form: { movingSec: 5 * 3600, distanceKm: 18.5, elevationM: 700, rpe: 6 } },
      { id: 'h2', kind: 'hike', date: '2026-09-13', form: { movingSec: 4 * 3600, distanceKm: 12, elevationM: 1250, elevationLossM: 1250, altMaxM: 2428, rpe: 7 } },
      { id: 'h3', kind: 'hike', date: '2026-09-20', form: { movingSec: 3 * 3600, distanceKm: 10, elevationM: 400, rpe: 5 } },
      { id: 'r1', kind: 'run', date: '2026-09-15', form: { movingSec: 3000, distanceKm: 10, rpe: 6 } },
      { id: 'r2', kind: 'run', date: '2026-09-22', form: { movingSec: 3000, distanceKm: 10, rpe: 6 } },
    ]);

    // Calendario: cambiar el viernes (descanso en la semana tipo) por «Senderismo» (sesión libre) y registrarla
    // desde el día: el tipo coincide → hecho.
    await go(page, `#/day/${FRI}`);
    await page.locator('.cal-act-change').click();
    const row = page.locator('.pick-row', { hasText: 'Senderismo' });
    assert.strictEqual(await row.innerText(), '🥾 Senderismo');
    await row.click();
    await page.locator('.toast').waitFor();
    await settle(page, 300);
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Senderismo');
    const plan = (await idbAll(page, 'plan')).find((p) => p.id === FRI);
    assert.deepStrictEqual([plan.kind, plan.activityKind, plan.label], ['free', 'hike', 'Senderismo']);
    await page.getByRole('button', { name: 'Registrar senderismo' }).click();
    await waitHash(page, /^#\/activity\/new/);
    assert.match(await hash(page), /kind=hike&date=2026-09-25&planDate=2026-09-25/);
    await page.fill('[aria-label="Tiempo en movimiento: h"]', '2');
    await page.fill('[aria-label="Distancia (km)"]', '8');
    await settle(page);
    await page.locator('.act-done').click();
    await waitHash(page, new RegExp(`^#/day/${FRI}$`));
    assert.strictEqual(await page.locator('.cal-state .status').first().getAttribute('data-status'), 'done', 'la sesión libre planificada queda hecha');
    assert.strictEqual(await page.locator('.cal-sessions .cal-ses-row[data-kind="hike"]').count(), 1);

    // Progreso: carga y km con su propio tipo y color
    await go(page, '#/progress');
    const km = page.locator('[data-chart="km"]');
    const kmSeg = await boxes(km.locator('.seg-btn'));
    assert.deepStrictEqual(kmSeg.map((x) => x.text), ['Todos', 'Carrera', 'Bici', 'Natación', 'Senderismo']);
    assert.ok(kmSeg.every((x) => x.h >= 44 && !x.cut), 'filtro de km ≥ 44 px y sin cortar');
    assert.match(await km.innerText(), /🥾 Senderismo\s*8 km/);
    assert.match(await km.innerText(), /🏃 Carrera\s*10 km/);
    const loadLegend = await page.locator('[data-chart="load"] .chart-legend').innerText();
    assert.match(loadLegend, /Senderismo/);
    const colors = await page.locator('[data-chart="km"] svg *').evaluateAll((els) => els.filter((e) => e.style.fill === 'rgb(45, 212, 191)').length);
    assert.ok(colors > 0, 'barras de km con el color del senderismo');
    await km.locator('.seg-btn', { hasText: 'Senderismo' }).click();
    await km.scrollIntoViewIfNeeded();
    assert.ok(await noHScroll(page));
    await shot(page, 'hike-progress-km');

    // Récords: mayor distancia y mayor desnivel en senderismo
    await go(page, '#/records');
    await page.locator('.prg-seg .seg-btn', { hasText: 'Resistencia' }).click();
    const card = page.locator('.prg-rec[data-sport="hike"]');
    assert.match(await card.locator('.prg-rec-khead').innerText(), /Senderismo[\s\S]*4 rutas/);
    assert.strictEqual(await card.locator('[data-rec="longest"] .prg-rec-value').innerText(), '18,5 km');
    assert.match(await card.locator('[data-rec="longest"] .prg-rec-sub').innerText(), /5:00:00 · \+700 m · 6 sep 2026/);
    assert.strictEqual(await card.locator('[data-rec="gain"] .prg-rec-value').innerText(), '+1.250 m');
    assert.match(await card.locator('[data-rec="gain"] .prg-rec-sub').innerText(), /12 km · 4:00:00 · 13 sep 2026/);
    assert.strictEqual(await page.locator('.prg-rec[data-sport="run"] [data-rec="longest"] .prg-rec-value').innerText(), '10 km', 'la carrera más larga no es una ruta');
    await card.scrollIntoViewIfNeeded();
    await shot(page, 'hike-records');
    await card.locator('[data-rec="gain"]').click();
    await waitHash(page, /^#\/activity\/h2$/);

    // Panel semanal: km de senderismo aparte
    await go(page, '#/weekly');
    await page.waitForFunction(() => document.body.innerText.includes('Kilómetros semanales'), null, { timeout: 5000 });
    assert.match(await page.locator('body').innerText(), /Senderismo 8 km/);

    // Objetivo de senderismo (solo distancia); al crearlo se vuelve a la lista
    await go(page, '#/goals');
    await go(page, '#/goal/new');
    await page.locator('.goal-form .seg-btn', { hasText: 'Resistencia' }).first().click();
    await page.waitForTimeout(80);
    const sp = await boxes(page.locator('.goal-form .act-seg-wrap .seg-btn'));
    assert.deepStrictEqual(sp.map((x) => x.text), ['Carrera', 'Bici', 'Natación', 'Senderismo']);
    assert.ok(sp.every((x) => x.h >= 44 && !x.cut), 'deporte ≥ 44 px y sin cortar');
    await page.locator('.goal-form .seg-btn', { hasText: 'Senderismo' }).click();
    assert.strictEqual(await page.locator('input.input[aria-label="Distancia (km)"]').inputValue(), '15');
    await page.locator('.goal-presets .chip', { hasText: /^20 km$/ }).click();
    assert.strictEqual(await page.locator('input.input[aria-label="Título del objetivo"]').inputValue(), 'Ruta de 20 km');
    await page.waitForTimeout(250);
    await shot(page, 'hike-goal-new');
    await page.locator('.goal-create').click();
    await waitHash(page, /^#\/goals/);
    const goalCard = page.locator('.goal-card', { hasText: 'Ruta de 20 km' });
    assert.match(await goalCard.innerText(), /Senderismo · distancia/);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
