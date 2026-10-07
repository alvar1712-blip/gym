// E2E de los resultados de carrera en «Tu contexto» (docs/MEJORAS6.md): Ajustes › Tu contexto › Añadir hecho ›
// Resultado de carrera con fecha aproximada y exacta, distancia estándar y personalizada, detalles opcionales,
// validación, editar, borrar con deshacer; su uso en Progreso › Tiempos previstos (referencia histórica, «¿Por qué?»,
// enlace a la ficha), un duplicado con una carrera importada, el informe para tu IA y copia/restauración. A 375 px,
// en Chromium y WebKit. Datos sintéticos (nada personal).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/race-results.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, reload, shot, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const clean = (t) => String(t ?? '').replace(/ /g, ' ').replace(/⁠/g, '').replace(/\s+/g, ' ').trim();

async function waitView(page, sel) {
  await page.waitForSelector(sel, { timeout: 8000 });
  await page.waitForTimeout(150);
}
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const smallTargets = (page, sel) => page.locator(`${sel} button, ${sel} select, ${sel} input`).evaluateAll((els) => els
  .filter((e) => e.offsetParent !== null && e.type !== 'checkbox' && !e.closest('[hidden]'))
  .map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
  .filter((r) => r.h < 43.5));
const chip = (page, block, text) => page.locator(`[data-block="${block}"] .chip`, { hasText: text }).first();
async function precision(page, label) { await page.locator('[data-approx="date"] .seg-btn', { hasText: label }).click(); }
async function pick(page, part, value) { await page.locator(`[data-approx="date"] select[data-part="${part}"]`).selectOption(String(value)); }
async function time(page, hh, mm, ss) {
  await page.fill('[data-block="result"] input[aria-label="Tiempo: h"]', String(hh));
  await page.fill('[data-block="result"] input[aria-label="Tiempo: min"]', String(mm));
  await page.fill('[data-block="result"] input[aria-label="Tiempo: s"]', String(ss));
}
async function newResult(page) {
  await go(page, '#/context');
  await waitView(page, '.ctx-now');
  await page.locator('.ctx-add-event').click();
  await waitView(page, '.ctx-form');
  await chip(page, 'type', 'Resultado de carrera').click();
  await page.locator('[data-block="result"]').waitFor();
}
async function save(page) {
  await page.locator('.ctx-save').click();
  await waitView(page, '.ctx-timeline');
}
const rows = async (page) => (await page.locator('.ctx-timeline .ctx-row').allInnerTexts()).map(clean);

async function flow(page, tag) {
  await page.setViewportSize({ width: 375, height: 812 });

  // --- 1) El ejemplo: Ajustes › Tu contexto › Añadir hecho › Resultado de carrera · 10 km · 1:00:00 · mayo 2026 ---
  await go(page, '#/settings');
  await waitView(page, '.cfg-context-row');
  await page.locator('.cfg-context-row').click();
  await waitView(page, '.ctx-now');
  await page.locator('.ctx-add-event').click();
  await waitView(page, '.ctx-form');
  await chip(page, 'type', 'Resultado de carrera').click();
  await page.locator('[data-block="result"]').waitFor();
  await chip(page, 'result', '10 km').click();
  await time(page, 1, 0, 0);
  assert.strictEqual(clean(await page.locator('.ctx-result-pace').textContent()), 'Ritmo: 6:00/km');
  await precision(page, 'Mes');
  await pick(page, 'mes', 5);
  await pick(page, 'año', 2026);
  assert.ok(await noHScroll(page), `${tag}: sin scroll horizontal en el formulario`);
  assert.deepStrictEqual(await smallTargets(page, '.ctx-form'), [], `${tag}: objetivos táctiles ≥ 44 px`);
  await shot(page, `race-results-form-${tag}`);
  await save(page);
  assert.strictEqual(await hashOf(page), '#/context');
  let r = await rows(page);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0], 'May 2026 Hecho 🏁 10 km · 1:00:00 6:00/km');
  // Guardado como dato estructurado (no como texto)
  let disk = await idbAll(page, 'context');
  assert.strictEqual(disk.length, 1);
  assert.deepStrictEqual({ type: disk[0].type, date: disk[0].date, result: disk[0].result, text: disk[0].text },
    { type: 'race_result', date: { date: '2026-05-01', precision: 'month' }, result: { km: 10, sec: 3600, effort: null, elevationM: null, surface: null }, text: '' });
  const tenK = disk[0].id;

  // --- 2) Fecha exacta, distancia personalizada, nombre y detalles opcionales ---
  await newResult(page);
  await chip(page, 'result', 'Otra').click();
  await page.locator('[data-block="result"] input[aria-label="Distancia (km)"]').fill('7,5');
  await time(page, 0, 40, 0);
  assert.strictEqual(clean(await page.locator('.ctx-result-pace').textContent()), 'Ritmo: 5:20/km');
  await page.locator('[data-approx="date"] input[type="date"]').fill('2026-09-15');
  await page.locator('[data-block="text"] input[aria-label="Nombre de la carrera"]').fill('Carrera popular');
  await page.locator('.ctx-more-btn').click();
  await chip(page, 'more', 'Carrera oficial').click();
  await page.locator('[data-block="more"] input[aria-label="Desnivel positivo (m)"]').fill('85');
  await chip(page, 'more', 'Trail').click();
  assert.ok(await noHScroll(page));
  assert.deepStrictEqual(await smallTargets(page, '.ctx-form'), []);
  await save(page);
  r = await rows(page);
  assert.deepStrictEqual(r, [
    '15 sep 2026 Hecho 🏁 Carrera popular · 7,5 km · 40:00 5:20/km · Carrera oficial · Trail · +85 m',
    'May 2026 Hecho 🏁 10 km · 1:00:00 6:00/km',
  ]);
  disk = await idbAll(page, 'context');
  const popular = disk.find((e) => e.text === 'Carrera popular');
  assert.deepStrictEqual(popular.result, { km: 7.5, sec: 2400, effort: 'race', elevationM: 85, surface: 'trail' });
  assert.deepStrictEqual(popular.date, { date: '2026-09-15', precision: 'day' });

  // --- 3) Validación: sin distancia ni tiempo; en el futuro (eso es un evento deportivo) ---
  await newResult(page);
  await page.locator('.ctx-save').click();
  assert.strictEqual(await page.locator('[data-err="km"]').textContent(), 'Indica la distancia.');
  assert.strictEqual(await page.locator('[data-err="sec"]').textContent(), 'Indica el tiempo.');
  await chip(page, 'result', '5 km').click();
  await time(page, 0, 25, 0);
  await page.locator('[data-approx="date"] input[type="date"]').fill('2026-12-31');
  await page.locator('.ctx-save').click();
  assert.match(await page.locator('[data-err="date"]').textContent(), /usa «Eventos deportivos»/);
  // Ritmo imposible: avisa (como en una actividad)
  await time(page, 25, 0, 0);
  assert.match(clean(await page.locator('.ctx-result-pace').textContent()), /más lento que caminar\. ¿Escribiste los minutos en la casilla de las horas\?/);
  assert.strictEqual((await idbAll(page, 'context')).length, 2, 'no se guardó nada');

  // --- 4) Editar: el 10K pasa a 58:00 ---
  await go(page, '#/context');
  await waitView(page, '.ctx-timeline');
  await page.locator(`.ctx-row[data-id="${tenK}"]`).click();
  await waitView(page, '.ctx-form');
  assert.strictEqual(await page.locator('[data-block="result"] .chip.active, [data-block="result"] .chip[aria-pressed="true"]').first().textContent(), '10 km');
  await time(page, 0, 58, 0);
  await save(page);
  assert.strictEqual((await rows(page))[1], 'May 2026 Hecho 🏁 10 km · 58:00 5:48/km');
  assert.strictEqual((await idbAll(page, 'context')).find((e) => e.id === tenK).result.sec, 3480);

  // --- 5) Borrar con deshacer ---
  await page.locator(`.ctx-row[data-id="${popular.id}"]`).click();
  await waitView(page, '.ctx-form');
  await page.locator('.ctx-delete').click();
  await page.locator('.sheet-panel .btn-danger').click();
  await waitView(page, '.ctx-timeline');
  assert.strictEqual((await rows(page)).length, 1);
  await page.locator('.toast-action', { hasText: 'Deshacer' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.ctx-timeline .ctx-row').length === 2);
  assert.strictEqual((await idbAll(page, 'context')).length, 2);
  await shot(page, `race-results-timeline-${tag}`);

  // --- 6) Tiempos previstos: sin carreras registradas, la de septiembre (reciente) y la de mayo (referencia histórica) ---
  await go(page, '#/predictions');
  await waitView(page, '.prd-races');
  assert.strictEqual(await page.locator('.content.prd').getAttribute('data-ok'), '1', 'no «Datos insuficientes»: hay marcas reales');
  const ten = page.locator('.prd-race[data-race="10k"]');
  assert.strictEqual(await ten.getAttribute('data-status'), 'tentative');
  assert.strictEqual(clean(await ten.locator('.prd-conf').textContent()), 'Confianza baja');
  assert.strictEqual(clean(await ten.locator('.prd-race-state').textContent()), 'Predicción todavía poco fiable');
  assert.match(clean(await ten.locator('.prd-race-explain').textContent()), /^Tienes pocos datos recientes\. Tu referencia es 10 km en 58:00 \(may 2026\), pero es de hace 5 meses y después hubo 17 semanas sin correr, así que sirve como orientación, no como predicción de hoy\.$/);
  await ten.locator('.prd-reveal').click();
  assert.match(clean(await ten.locator('.prd-race-time').textContent()), /^\d{1,2}:\d{2}$/);
  await ten.locator('.why-btn').click();
  const why = clean(await ten.locator('.why-body').textContent());
  for (const re of [/may 2026 · 10 km en 58:00 \(5:48\/km\) · referencia histórica/, /15 sep · 7,5 km en 40:00 \(5:20\/km\) · de tu contexto/, /Por qué pesa menos \(10 km, may 2026\)Es de hace 5 meses y después hubo 17 semanas sin correr\./, /Tus resultados de carrera de «Tu contexto» también cuentan/, /Tu historial importa, pero tu estado reciente importa más/]) {
    assert.match(why, re);
  }
  assert.ok(!/(^|[^\d])[-−]\d|:-|NaN|undefined/.test(clean(await page.locator('.prd-races').textContent())));
  // «Con qué se calcula»: la reciente y la referencia histórica, cada una abre su ficha de tu contexto
  const hist = page.locator('.prd-history .prd-effort');
  assert.strictEqual(await hist.count(), 1);
  assert.strictEqual(await hist.getAttribute('data-entry'), tenK);
  assert.strictEqual(clean(await hist.locator('.list-item-title').textContent()), '10 km en 58:00');
  assert.strictEqual(clean(await hist.locator('.list-item-sub').textContent()), 'may 2026 · 5:48/km · referencia histórica · antes de un parón');
  assert.ok(await noHScroll(page));
  await shot(page, `race-results-predictions-${tag}`, true);
  await hist.click();
  await page.waitForFunction((id) => location.hash === `#/context/${encodeURIComponent(id)}`, tenK);

  // --- 7) Duplicado: se importa la misma carrera del 15 sep → cuenta una vez (la registrada) ---
  await page.evaluate(async (at) => {
    const s = { id: 'imp_popular', kind: 'run', status: 'done', date: '2026-09-15', planDate: '2026-09-15', startedAt: at, endedAt: null, movingSec: 2430, elapsedSec: 2460, durationMin: 40.5, rpe: null, distanceKm: 7.62, source: 'import', subtype: null, notes: '', parentId: null, createdAt: at, updatedAt: at };
    await window.__app.store.save('sessions', s);
  }, madrid('2026-09-15', 10));
  await go(page, '#/today');
  await go(page, '#/predictions');
  await waitView(page, '.prd-basis');
  const basis = await page.locator('.prd-efforts:not(.prd-history) .prd-effort').evaluateAll((els) => els.map((e) => [e.dataset.source, e.dataset.session, e.dataset.entry]));
  assert.deepStrictEqual(basis, [['run', 'imp_popular', '']]);
  assert.match(clean(await page.locator('.prd-dup').textContent()), /^No se cuenta dos veces: 7,5 km en 40:00 \(15 sep\) de tu contexto es la misma carrera que la registrada el 15 sep\.$/);
  assert.strictEqual((await idbAll(page, 'context')).length, 2, 'nada se borra');

  // --- 8) Informe para tu IA ---
  const report = await page.evaluate(async (today) => {
    const v = await import('./js/views/analysis.js');
    const r = await import('./js/analysis-report.js');
    return r.reportText(v.analysisFor(today));
  }, TODAY);
  // Récords (la mejor de siempre) separados de lo que usa la predicción actual (con antigüedad y peso)
  const recs = report.split('\n\n').find((b) => b.startsWith('RÉCORDS DE RUNNING'));
  const pred = report.split('\n\n').find((b) => b.startsWith('REFERENCIAS PARA LA PREDICCIÓN ACTUAL'));
  assert.ok(recs && pred, report);
  assert.match(recs, /\n- 10 km — 58:00 — may 2026 — marca histórica\n/);
  assert.match(pred, /\n- 10 km — 58:00 — mayo 2026 \(hace 5 meses; marca histórica, pesa menos por antigua\)/);
  assert.match(pred, /\n- 7,62 km — 40:30 — 15 sep 2026 \(hace 3 semanas; carrera registrada\)/);
  assert.match(pred, /1 resultado apuntado coincide con una carrera registrada: se cuenta una sola vez/);
  assert.ok(!report.includes('Carrera popular'), 'sin nombres');

  // --- 9) Copia de seguridad: exportar, borrar todo, importar ---
  const before = await idbAll(page, 'context');
  await page.evaluate(async () => {
    const { store } = window.__app;
    window.__backup = store.exportData();
    await store.wipeAll();
  });
  assert.strictEqual((await idbAll(page, 'context')).length, 0);
  await page.evaluate(async () => { await window.__app.store.importData(window.__backup); });
  await reload(page);
  const after = await idbAll(page, 'context');
  const byId = (l) => [...l].sort((a, b) => (a.id < b.id ? -1 : 1));
  assert.deepStrictEqual(byId(after), byId(before));
  await go(page, '#/context');
  await waitView(page, '.ctx-timeline');
  assert.strictEqual((await rows(page)).length, 2);
}

test('resultado de carrera: crear, ver, editar, borrar, predicciones, duplicado, informe y copia (375 px)', async () => {
  const app = await openApp({ beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    await flow(app.page, 'chromium');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: resultado de carrera (375 px)', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit', beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    await flow(app.page, 'webkit');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
