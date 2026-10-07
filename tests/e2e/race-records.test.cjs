// E2E de Récords con tus marcas históricas de running (docs/MEJORAS6.md): una marca apuntada en «Tu contexto» aparece
// en Progreso › Récords (vista derivada, sin copias) con su fecha tal como se apuntó y su origen; una carrera mejor la
// supera al momento (la pantalla escucha el store); editar, borrar y deshacer recalculan; una actividad importada que es
// la misma carrera cuenta una vez; informe para tu IA y copia de seguridad. 375 px, Chromium y WebKit. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/race-records.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, reload, shot, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const clean = (t) => String(t ?? '').replace(/ /g, ' ').replace(/⁠/g, '').replace(/\s+/g, ' ').trim();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function waitView(page, sel) {
  await page.waitForSelector(sel, { timeout: 8000 });
  await page.waitForTimeout(150);
}
function runSession(id, date, km, sec, extra = {}) {
  const at = madrid(date, 8);
  return { id, kind: 'run', date, planDate: date, status: 'done', startedAt: at, endedAt: null, movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe: 6, distanceKm: km, subtype: null, notes: '', parentId: null, createdAt: at, updatedAt: at, ...extra };
}
const save = (page, s) => page.evaluate(async (x) => { await window.__app.store.save('sessions', x); }, s);
/** Fila de un récord de carrera: { value, sub, source, entry, session }. */
const row = (page, id) => page.locator(`.prg-rec[data-sport="run"] [data-rec="${id}"]`).evaluate((el) => ({
  value: el.querySelector('.prg-rec-value').textContent,
  sub: el.querySelector('.prg-rec-sub')?.textContent.replace(/ /g, ' ') ?? '',
  source: el.dataset.source || '', entry: el.dataset.entry || '', session: el.dataset.session || '',
}));
async function openRecords(page) {
  await go(page, '#/records');
  await waitView(page, '.prg-rec-body');
  await page.locator('.seg-btn', { hasText: 'Resistencia' }).click();
  await waitView(page, '.prg-rec[data-sport="run"]');
}
/** Espera a que una fila tenga un valor (la pantalla se recalcula sola al cambiar el store). */
const waitValue = (page, id, value) => page.waitForFunction(([k, v]) => document.querySelector(`.prg-rec[data-sport="run"] [data-rec="${k}"] .prg-rec-value`)?.textContent === v, [id, value]);

async function flow(page, tag) {
  await page.setViewportSize({ width: 375, height: 812 });
  // Una carrera registrada en septiembre: 10 km en 1:04:20
  await save(page, runSession('run_sep', '2026-09-10', 10, 64 * 60 + 20));

  // --- El criterio de éxito: Ajustes › Tu contexto › Añadir hecho › Resultado de carrera · 10 km · 1:00:00 · mayo 2026 ---
  await go(page, '#/settings');
  await waitView(page, '.cfg-context-row');
  await page.locator('.cfg-context-row').click();
  await waitView(page, '.ctx-now');
  await page.locator('.ctx-add-event').click();
  await waitView(page, '.ctx-form');
  await page.locator('[data-block="type"] .chip', { hasText: 'Resultado de carrera' }).click();
  await page.locator('[data-block="result"] .chip', { hasText: '10 km' }).click();
  await page.fill('[data-block="result"] input[aria-label="Tiempo: h"]', '1');
  await page.fill('[data-block="result"] input[aria-label="Tiempo: min"]', '0');
  await page.fill('[data-block="result"] input[aria-label="Tiempo: s"]', '0');
  await page.locator('[data-approx="date"] .seg-btn', { hasText: 'Mes' }).click();
  await page.locator('[data-approx="date"] select[data-part="mes"]').selectOption('5');
  await page.locator('.ctx-save').click();
  await waitView(page, '.ctx-timeline');
  const markId = (await idbAll(page, 'context'))[0].id;

  // --- Récords: la marca histórica es el mejor 10 km (mejor que la carrera de septiembre), con su fecha y su origen ---
  await openRecords(page);
  let r10 = await row(page, '10k');
  assert.deepStrictEqual(r10, { value: '1:00:00', sub: 'may 2026 · Marca histórica', source: 'context', entry: markId, session: '' }, tag);
  const r5 = await row(page, '5k');
  assert.strictEqual(r5.value, '30:00');
  assert.strictEqual(r5.sub, 'may 2026 · Marca histórica · de una carrera de 10 km');
  assert.strictEqual(await page.locator('.prg-rec[data-sport="run"] [data-rec="5k"] .badge').textContent(), 'estimado');
  assert.strictEqual(clean((await row(page, '1k')).value), '6:00');
  assert.deepStrictEqual(await row(page, 'half'), { value: '—', sub: 'Sin marca todavía', source: '', entry: '', session: '' });
  assert.strictEqual(clean(await page.locator('.prg-rec[data-sport="run"] .prg-rec-meta').textContent()), '1 carrera · 1 marca histórica');
  assert.ok(await noHScroll(page));
  const small = await page.locator('.prg-rec[data-sport="run"] button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.textContent.trim().slice(0, 30)));
  assert.deepStrictEqual(small, [], 'filas tocables de 44 px o más');
  await page.locator('.prg-rec[data-sport="run"]').screenshot({ path: require('path').join(__dirname, '..', '..', 'test-results', `race-records-${tag}.png`) });

  // --- Una carrera mejor (57:40) lo supera al momento, sin salir de la pantalla; quitarla y deshacer recalculan ---
  const fast = runSession('run_fast', '2026-10-02', 10, 57 * 60 + 40);
  await save(page, fast);
  await waitValue(page, '10k', '57:40');
  r10 = await row(page, '10k');
  assert.deepStrictEqual([r10.sub, r10.source, r10.session], ['2 oct 2026 · Registrado en Entreno', 'app', 'run_fast']);
  await page.evaluate(async () => { window.__removed = await window.__app.store.remove('sessions', 'run_fast'); });
  await waitValue(page, '10k', '1:00:00');
  await page.evaluate(() => window.__app.store.restore('sessions', window.__removed));
  await waitValue(page, '10k', '57:40');
  await page.evaluate(async () => { await window.__app.store.remove('sessions', 'run_fast'); });
  await waitValue(page, '10k', '1:00:00');
  assert.strictEqual((await idbAll(page, 'context')).length, 1, 'la marca sigue guardada');

  // --- Borrar la marca desde su récord (abre su ficha) → la carrera de septiembre; «Deshacer» → la marca otra vez ---
  await page.locator('.prg-rec[data-sport="run"] [data-rec="10k"]').click();
  await page.waitForFunction((id) => location.hash === `#/context/${encodeURIComponent(id)}`, markId);
  await waitView(page, '.ctx-form');
  await page.locator('.ctx-delete').click();
  await page.locator('.sheet-panel .btn-danger').click();
  await openRecords(page);
  r10 = await row(page, '10k');
  assert.deepStrictEqual([r10.value, r10.source, r10.session], ['1:04:20', 'app', 'run_sep']);
  await page.locator('.toast-action', { hasText: 'Deshacer' }).click();
  await waitValue(page, '10k', '1:00:00');

  // --- Editar la marca a 1:05:00 → la carrera de septiembre (1:04:20) pasa a ser el récord ---
  await page.locator('.prg-rec[data-sport="run"] [data-rec="10k"]').click();
  await waitView(page, '.ctx-form');
  await page.fill('[data-block="result"] input[aria-label="Tiempo: min"]', '5');
  await page.locator('.ctx-save').click();
  await page.waitForFunction(() => location.hash === '#/records');
  await waitView(page, '.prg-rec[data-sport="run"]');
  await waitValue(page, '10k', '1:04:20');
  assert.strictEqual((await idbAll(page, 'context')).find((e) => e.id === markId).result.sec, 3900);

  // --- La misma carrera importada (FIT) que la marca: cuenta una sola vez ---
  await save(page, runSession('imp_may', '2026-05-16', 10.05, 3910, { source: { type: 'fit', fileName: 'mayo.fit' } }));
  await waitValue(page, '10k', '1:04:20');
  await page.waitForFunction(() => document.querySelector('.prg-rec[data-sport="run"] .prg-rec-meta')?.textContent === '2 carreras');
  assert.strictEqual(await page.locator('.prg-rec[data-sport="run"] [data-source="context"]').count(), 0, 'la marca no se cuenta además de la importada');
  assert.strictEqual((await idbAll(page, 'context')).length, 1, 'nada se borra');

  // --- Informe para tu IA: récords (la mejor de siempre) y, aparte, la predicción actual ---
  const report = await page.evaluate(async (today) => {
    const v = await import('./js/views/analysis.js');
    const r = await import('./js/analysis-report.js');
    return r.reportText(v.analysisFor(today));
  }, TODAY);
  const rec = report.split('\n\n').find((b) => b.startsWith('RÉCORDS DE RUNNING'));
  assert.ok(rec, report);
  assert.match(rec, /\n- 10 km — 1:04:20 — 10 sep 2026 — registrada en Entreno\n/);
  assert.match(rec, /\n- Media maratón — sin marca\n/);
  assert.ok(report.includes('REFERENCIAS PARA LA PREDICCIÓN ACTUAL'));

  // --- Copia de seguridad: exportar, borrar todo, importar → los mismos récords ---
  const recs = () => page.evaluate(async () => {
    const S = await import('./js/stats.js');
    const { dataFromStore } = await import('./js/progress-ui.js');
    return JSON.stringify(S.enduranceRecords(dataFromStore()).run);
  });
  const before = await recs();
  await page.evaluate(async () => { const { store } = window.__app; window.__backup = store.exportData(); await store.wipeAll(); });
  assert.notStrictEqual(await recs(), before);
  await page.evaluate(async () => { await window.__app.store.importData(window.__backup); });
  await reload(page);
  assert.strictEqual(await recs(), before);
  await openRecords(page);
  assert.strictEqual((await row(page, '10k')).value, '1:04:20');
  await shot(page, `race-records-after-${tag}`);
}

test('récords con marcas históricas: récord, superado al momento, borrar/deshacer, editar, importada, informe y copia (375 px)', async () => {
  const app = await openApp({ beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    await flow(app.page, 'chromium');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('WebKit: récords con marcas históricas (375 px)', { skip: skipWebkit }, async () => {
  const app = await openApp({ browser: 'webkit', beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    await flow(app.page, 'webkit');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
