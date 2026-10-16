// E2E de los borradores de los formularios con «Guardar» (auditoría final, states-3): eventos deportivos, marcas
// históricas y contexto, nuevos y en edición. iOS descarga la PWA en segundo plano y al volver la recarga: lo tecleado
// tiene que seguir ahí, con el aviso «Borrador recuperado · Vaciar». Guardar lo quita; si el registro cambió por otro
// lado, el borrador no lo pisa; el de un evento no lleva su resultado. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/form-drafts.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll } = require('./helpers.cjs');

/** Un evento (pasado, con resultado), una marca histórica y una fase de contexto. */
async function seed(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const { store } = window.__app;
    const T = u.todayStr();
    await store.save('races', { id: 'r1', name: 'San Silvestre', type: '10k', date: u.addDays(T, -3), distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: null, createdAt: 1, outcome: { status: 'dns' } });
    await store.save('pastRecords', { id: 'pr1', exerciseId: 'press_banca', weight: 100, reps: 5, rir: null, date: null, beforeApp: true, bodyweightKg: null, note: '', createdAt: 1 });
    await store.save('context', { id: 'ctx1', kind: 'phase', type: 'break', start: { date: u.addDays(T, -60), precision: 'day' }, end: null, text: '', notes: '', goalIds: [], sports: [], createdAt: 1 });
  });
}

// Ruta → el campo de texto en el que se teclea
const CASES = [
  ['#/races/new', '[data-block="note"] textarea'],
  ['#/races/r1', '[data-block="note"] textarea'],
  ['#/records/past/new', '[data-block="note"] textarea'],
  ['#/records/past/pr1', '[data-block="note"] textarea'],
  ['#/context/new', 'textarea[aria-label="Observaciones"]'],
  ['#/context/ctx1', 'textarea[aria-label="Observaciones"]'],
];
const drafts = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => /Draft:/.test(k)).sort());

test('eventos, marcas históricas y contexto: lo tecleado sobrevive a una recarga, con «Borrador recuperado»', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page);
    const lost = [];
    for (const [route, sel] of CASES) {
      await go(page, route);
      const text = `borrador de ${route}`;
      await page.locator(sel).fill(text);
      await reload(page);
      await go(page, route);
      const kept = await page.locator(sel).inputValue();
      const banner = await page.locator('.form-draft').count();
      if (kept !== text || banner !== 1) lost.push(`${route}: «${kept}» · aviso ${banner}`);
    }
    assert.deepStrictEqual(lost, [], 'en las 6 rutas se recupera lo tecleado con el aviso');
    assert.deepStrictEqual(await drafts(page), ['entreno.contextDraft:ctx1', 'entreno.contextDraft:new', 'entreno.pastRecordDraft:new', 'entreno.pastRecordDraft:pr1', 'entreno.raceDraft:new', 'entreno.raceDraft:r1']);
    // El borrador del evento no lleva el resultado (lo guarda su propia tarjeta; ronda 8, bug 7)
    const raw = await page.evaluate(() => JSON.parse(localStorage.getItem('entreno.raceDraft:r1')));
    assert.strictEqual('outcome' in raw.data || 'result' in raw.data, false);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('borradores: guardar los quita, «Vaciar» se deshace, el registro cambiado no se pisa y el resultado se conserva', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seed(page);
    // Evento: borrador de la nota; entretanto, su resultado cambia (se guarda desde otra pantalla) → al guardar el
    // formulario se conserva el resultado del almacén
    await go(page, '#/races/r1');
    await page.locator('[data-block="note"] textarea').fill('salida a las 9');
    await page.evaluate(async () => {
      const { store } = window.__app;
      await store.save('races', { ...store.get('races', 'r1'), outcome: { status: 'skipped' } });
    });
    await reload(page);
    await go(page, '#/races/r1');
    assert.strictEqual(await page.locator('.form-draft').count(), 1, 'cambiar el resultado no invalida el borrador de la ficha');
    await page.locator('.rc-save').click();
    await page.waitForFunction(() => location.hash !== '#/races/r1');
    const race = (await idbAll(page, 'races')).find((r) => r.id === 'r1');
    assert.deepStrictEqual({ note: race.note, outcome: race.outcome?.status }, { note: 'salida a las 9', outcome: 'skipped' });
    assert.deepStrictEqual(await drafts(page), [], 'guardar quita el borrador');

    // Marca histórica: «Vaciar» vuelve al registro guardado; «Deshacer» devuelve el borrador
    await go(page, '#/records/past/pr1');
    await page.locator('[data-block="note"] textarea').fill('con cinturón');
    await reload(page);
    await go(page, '#/records/past/pr1');
    await page.locator('.form-draft-discard').click();
    await page.waitForFunction(() => !document.querySelector('.form-draft'));
    assert.strictEqual(await page.locator('[data-block="note"] textarea').inputValue(), '');
    await page.locator('.toast .toast-action').click();
    await page.locator('.form-draft').waitFor();
    assert.strictEqual(await page.locator('[data-block="note"] textarea').inputValue(), 'con cinturón');

    // Si la marca cambia por otro lado (otra pantalla, una copia restaurada), el borrador viejo se descarta
    await page.evaluate(async () => {
      const { store } = window.__app;
      await store.save('pastRecords', { ...store.get('pastRecords', 'pr1'), note: 'editada en otro sitio' });
    });
    await go(page, '#/context');
    await go(page, '#/records/past/pr1');
    assert.strictEqual(await page.locator('.form-draft').count(), 0);
    assert.strictEqual(await page.locator('[data-block="note"] textarea').inputValue(), 'editada en otro sitio');
    assert.deepStrictEqual(await drafts(page), []);

    // Contexto nuevo: guardar lo crea y quita el borrador
    await go(page, '#/context/new');
    await page.locator('.ctx-types .chip').first().click();
    await page.locator('textarea[aria-label="Observaciones"]').fill('vuelta tras el verano');
    await reload(page);
    await go(page, '#/context/new');
    assert.strictEqual(await page.locator('.ctx-types .chip[aria-pressed="true"]').count(), 1, 'también lo elegido, no solo lo tecleado');
    await page.locator('.ctx-save').click();
    await page.waitForFunction(() => location.hash !== '#/context/new');
    assert.ok((await idbAll(page, 'context')).some((c) => c.notes === 'vuelta tras el verano'));
    assert.deepStrictEqual(await drafts(page), []);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
