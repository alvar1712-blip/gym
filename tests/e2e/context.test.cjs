// E2E de «Tu contexto» (ronda 6, docs/MEJORAS6.md): hechos y fases anteriores a la app con fecha aproximada (el ejemplo
// del usuario), orden de la línea temporal, línea «Ahora» de Hoy, validación, editar, borrar con deshacer, guardado en
// IndexedDB y fila en Ajustes. Botones ≥ 44 px y sin scroll horizontal a 375 px.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/context.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, reload, shot } = require('./helpers.cjs');

const TODAY = '2026-10-02';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

async function waitView(page, sel) {
  await page.waitForSelector(sel, { timeout: 8000 });
  await page.waitForTimeout(200);
}
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const smallButtons = (page, sel) => page.locator(`${sel} button, ${sel} select, ${sel} input, ${sel} label.switch-row`).evaluateAll((els) => els
  .filter((e) => e.offsetParent !== null && e.type !== 'checkbox')
  .map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
  .filter((r) => r.h < 43.5));

/** Abre el editor desde la lista (así «Guardar» vuelve a la lista). */
async function openEditor(page, kind) {
  await go(page, '#/context');
  await waitView(page, '.ctx-now');
  await page.locator(kind === 'phase' ? '.ctx-add-phase' : '.ctx-add-event').click();
  await waitView(page, '.ctx-form');
}
const chip = (page, block, text) => page.locator(`[data-block="${block}"] .chip`, { hasText: text }).first();
async function precision(page, key, label) { await page.locator(`[data-approx="${key}"] .seg-btn`, { hasText: label }).click(); }
async function pick(page, key, part, value) { await page.locator(`[data-approx="${key}"] select[data-part="${part}"]`).selectOption(String(value)); }
async function save(page) {
  await page.locator('.ctx-save').click();
  await waitView(page, '.ctx-timeline');
}

test('Tu contexto: el ejemplo del usuario con fechas aproximadas, Hoy, editar y borrar con deshacer', async () => {
  const app = await openApp({ beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  const { page } = app;
  try {
    // Ajustes › Tu contexto (fila bajo Perfil) → lista vacía con ejemplos
    await go(page, '#/settings');
    await waitView(page, '.cfg-context-row');
    assert.match(await page.locator('.cfg-context-row').innerText(), /Tu contexto[\s\S]*parones, vuelta al gimnasio, creatina/);
    await page.locator('.cfg-context-row').click();
    await waitView(page, '.ctx-now');
    assert.strictEqual(await hashOf(page), '#/context');
    assert.match(await page.locator('.ctx-empty').innerText(), /Verano 2026: entrenamiento irregular/);

    // 1) Peso habitual previo: 75 kg (año 2026)
    await openEditor(page, 'event');
    await chip(page, 'type', 'Peso habitual').click();
    await precision(page, 'date', 'Año');
    await pick(page, 'date', 'año', 2026);
    await page.locator('[data-block="kg"] input').fill('75');
    await page.locator('[data-block="text"] input').fill('Peso habitual previo');
    await save(page);

    // 2) Verano 2026 – agosto 2026: parón (fase terminada)
    await openEditor(page, 'phase');
    await chip(page, 'type', 'Parón o entrenamiento irregular').click();
    await precision(page, 'start', 'Estación');
    await pick(page, 'start', 'estación', 'summer');
    await pick(page, 'start', 'año', 2026);
    await page.locator('[data-switch="ongoing"] .switch').click();
    await precision(page, 'end', 'Mes');
    await pick(page, 'end', 'mes', 8);
    await pick(page, 'end', 'año', 2026);
    await page.locator('[data-block="text"] input').fill('Entrenamiento irregular y pérdida de peso');
    await save(page);

    // 3) 28 ago 2026: 72,7 kg (día exacto)
    await openEditor(page, 'event');
    await chip(page, 'type', 'Peso en esa fecha').click();
    await page.locator('[data-approx="date"] input[type="date"]').fill('2026-08-28');
    await page.locator('[data-block="kg"] input').fill('72,7');
    await save(page);

    // 4) Septiembre 2026: vuelta al gimnasio (fase vigente) y 5) inicio de creatina
    await openEditor(page, 'phase');
    await chip(page, 'type', 'Vuelta tras vacaciones o parón').click();
    await pick(page, 'start', 'mes', 9);
    await save(page);
    await openEditor(page, 'event');
    await chip(page, 'type', 'Empiezo creatina').click();
    await precision(page, 'date', 'Mes');
    await pick(page, 'date', 'mes', 9);
    await save(page);

    // Lista: «Ahora» y el historial de lo más reciente a lo más antiguo
    assert.match(await page.locator('.ctx-now').innerText(), /Desde sep 2026[\s\S]*Ahora[\s\S]*Vuelta tras vacaciones o parón/);
    const rows = await page.locator('.ctx-timeline .ctx-row').allInnerTexts();
    const norm = rows.map((t) => t.replace(/\s+/g, ' ').trim());
    assert.strictEqual(norm.length, 5);
    assert.match(norm[0], /^Sep 2026 Hecho Empiezo creatina/);
    assert.match(norm[1], /^Desde sep 2026 Ahora Vuelta tras vacaciones o parón/);
    assert.match(norm[2], /^28 ago 2026 Hecho Peso en esa fecha: 72,7 kg/);
    assert.match(norm[3], /^Verano 2026 – ago 2026 Fase Parón o entrenamiento irregular · Entrenamiento irregular y pérdida de peso/);
    assert.match(norm[4], /^2026 Hecho Peso habitual: 75 kg · Peso habitual previo/);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.ctx'), []);
    await shot(page, 'context-list');

    // En disco, con su precisión
    const disk = await idbAll(page, 'context');
    assert.strictEqual(disk.length, 5);
    const summer = disk.find((e) => e.type === 'break');
    assert.deepStrictEqual([summer.start, summer.end], [{ date: '2026-06-01', precision: 'season' }, { date: '2026-08-01', precision: 'month' }]);
    assert.strictEqual(disk.find((e) => e.type === 'weight').kg, 72.7);
    assert.strictEqual(disk.find((e) => e.type === 'creatine_start').kg, undefined);

    // Hoy: una sola línea «Ahora», que lleva a Tu contexto
    await go(page, '#/today');
    await waitView(page, '.today-context');
    assert.strictEqual(await page.locator('.today-context').count(), 1);
    assert.match(await page.locator('.today-context').innerText(), /Ahora: Vuelta tras vacaciones o parón · desde sep 2026/);
    await page.locator('.today-context').click();
    await waitView(page, '.ctx-now');
    assert.strictEqual(await hashOf(page), '#/context');

    // Validación: fin anterior al inicio y fase personalizada sin texto
    await page.locator('.ctx-add-phase').click();
    await waitView(page, '.ctx-form');
    await page.locator('.ctx-save').click();
    assert.match(await page.locator('[data-err="type"]').innerText(), /Elige el tipo de fase/);
    await chip(page, 'type', 'Personalizada').click();
    await page.locator('[data-switch="ongoing"] .switch').click();
    await pick(page, 'end', 'año', 2025);
    await page.locator('.ctx-save').click();
    assert.match(await page.locator('[data-err="end"]').innerText(), /anterior al inicio/);
    assert.match(await page.locator('[data-err="text"]').innerText(), /Escribe de qué se trata/);
    assert.strictEqual((await idbAll(page, 'context')).length, 5, 'no se guarda nada inválido');
    await page.locator('.topbar .back-btn').click();
    await waitView(page, '.ctx-timeline');

    // Editar: la vuelta al gimnasio termina; deja de estar «Ahora» y Hoy ya no muestra la línea
    await page.locator('.ctx-timeline .ctx-row', { hasText: 'Vuelta tras vacaciones' }).click();
    await waitView(page, '.ctx-form');
    assert.strictEqual(await page.locator('[data-block="kind"]').count(), 0, 'al editar no se cambia la clase');
    await page.locator('[data-switch="ongoing"] .switch').click();
    await pick(page, 'end', 'mes', 9);
    await save(page);
    assert.match(await page.locator('.ctx-now').innerText(), /Sin ninguna fase marcada ahora/);
    await go(page, '#/today');
    await waitView(page, '.today-plan');
    assert.strictEqual(await page.locator('.today-context').count(), 0);

    // Borrar con deshacer
    await go(page, '#/context');
    await waitView(page, '.ctx-timeline');
    await page.locator('.ctx-timeline .ctx-row', { hasText: 'Empiezo creatina' }).click();
    await waitView(page, '.ctx-delete');
    await page.locator('.ctx-delete').click();
    await page.locator('.sheet-panel button', { hasText: 'Borrar' }).click();
    await waitView(page, '.ctx-timeline');
    assert.strictEqual(await page.locator('.ctx-timeline .ctx-row').count(), 4);
    await page.locator('.toast .toast-action').click();
    await page.waitForTimeout(300);
    assert.strictEqual((await idbAll(page, 'context')).length, 5, 'deshacer lo devuelve');
    await reload(page);
    await go(page, '#/context');
    await waitView(page, '.ctx-timeline');
    assert.strictEqual(await page.locator('.ctx-timeline .ctx-row').count(), 5);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Tu contexto a 375 px: sin scroll horizontal y objetivos táctiles ≥ 44 px en el editor', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await openEditor(page, 'phase');
    await chip(page, 'type', 'Preparación media maratón').click();
    await page.locator('[data-switch="ongoing"] .switch').click();
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.ctx-form'), []);
    await shot(page, 'context-edit-375');
    await openEditor(page, 'event');
    await chip(page, 'type', 'Peso habitual').click();
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await smallButtons(page, '.ctx-form'), []);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('fases simultáneas: «Ahora» las lista todas y Hoy las nombra en una sola línea', async () => {
  const app = await openApp({ beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  const { page } = app;
  try {
    await page.evaluate(async () => {
      const { store } = window.__app;
      const C = await import('./js/context-logic.js');
      const add = (d, id, createdAt) => store.save('context', C.entryRecord(d, { id, now: createdAt }));
      await add({ kind: 'phase', type: 'gain', start: { date: '2026-07-01', precision: 'month' }, end: null }, 'p_gain', 1);
      await add({ kind: 'phase', type: 'prep_10k', start: { date: '2026-09-01', precision: 'month' }, end: null, sports: ['run'] }, 'p_10k', 2);
      await add({ kind: 'phase', type: 'stress', start: '2026-10-01', end: '2026-10-20', text: 'Exámenes' }, 'p_exams', 3);
      await add({ kind: 'phase', type: 'deficit', start: { date: '2026-03-01', precision: 'month' }, end: { date: '2026-05-01', precision: 'month' } }, 'p_old', 4);
    });
    await go(page, '#/today');
    await waitView(page, '.today-context');
    assert.strictEqual(await page.locator('.today-context').count(), 1, 'una sola línea');
    assert.match(await page.locator('.today-context').innerText(), /Ahora: Exámenes o época de estrés · Preparación 10K · Ganancia muscular/);
    assert.ok(await noHScroll(page));
    await page.locator('.today-context').click();
    await waitView(page, '.ctx-now');
    const now = await page.locator('.ctx-now .ctx-row').evaluateAll((els) => els.map((e) => e.dataset.id));
    assert.deepStrictEqual(now, ['p_exams', 'p_10k', 'p_gain'], 'las tres vigentes; la terminada, no');
    const summary = await page.evaluate(async () => {
      const C = await import('./js/context-logic.js');
      const s = C.contextSummary(window.__app.store.all('context'), '2026-10-02');
      return Object.fromEntries(Object.entries(s.byAspect).map(([k, v]) => [k, v.map((p) => p.id)]));
    });
    assert.deepStrictEqual(summary, { body: ['p_gain'], training: [], sport: ['p_10k'], life: ['p_exams'], custom: [] });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
