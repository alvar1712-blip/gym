// E2E del calentamiento sugerido en la sesión de fuerza (MEJORAS §3).
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, shot } = require('./helpers.cjs');

/** Historial: un Día 1 hace una semana (press banca 80 kg, dominadas con lastre, elevaciones laterales 10 kg). */
async function seedHistory(page) {
  return page.evaluate(async () => {
    const u = await import('./js/util.js');
    const { store } = window.__app;
    const date = u.addDays(u.todayStr(), -7);
    const set = (type, weight, reps, rir) => ({ id: u.uid('set_'), type, weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: Date.now() - 7 * 864e5 });
    const se = (exerciseId, templateItemId, sets) => ({ id: u.uid('se_'), exerciseId, exName: store.exercise(exerciseId).name, templateItemId, baseExerciseId: exerciseId, alternatives: [], target: { sets: 3 }, notes: '', note: '', section: '', groupId: null, groupType: null, sets });
    await store.save('sessions', {
      id: 'hist_d1', kind: 'strength', date, planDate: date, templateId: 'tpl_d1', templateName: 'Día 1 — Upper pesado',
      status: 'done', startedAt: u.tsFromDate(date, 18), endedAt: u.tsFromDate(date, 19), durationMin: 60, rpe: 8, notes: '', parentId: null, cursor: 0,
      exercises: [
        se('press_banca', 'ti_d1_1', [set('warmup', 40, 8, null), set('effective', 80, 6, 2), set('effective', 80, 5, 1), set('effective', 77.5, 6, 1)]),
        se('dominadas', 'ti_d1_2', [set('effective', 10, 8, 1), set('effective', 10, 7, 1), set('effective', 10, 6, 0)]),
        se('elevaciones_laterales', 'ti_d1_5', [set('effective', 10, 15, 2), set('effective', 10, 14, 1), set('effective', 10, 12, 1)]),
      ],
    });
  });
}

const getSession = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', i))), id);
/** Textos sin espacios duros («40\u00a0%» → «40 %»). */
const plain = (arr) => arr.map((t) => t.replace(/\u00a0/g, ' '));
const settle = (page) => page.waitForTimeout(450); // el botón «Registrar» ignora dobles toques durante 400 ms

test('calentamiento sugerido: plegado, desplegar, añadir series, 1 toque y sin contar como trabajo ni récord', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedHistory(page);
    const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    let s = await getSession(page, id);
    const seOf = (eid) => s.exercises.find((e) => e.exerciseId === eid);
    const card = (eid) => page.locator(`[data-se="${seOf(eid).id}"]`);
    const bc = card('press_banca');

    // --- Plegado por defecto: un enlace discreto en la fila de «+ Serie» ---
    const toggle = bc.locator('.ses-warm-toggle');
    const panel = bc.locator('.ses-warmup');
    assert.strictEqual(await toggle.count(), 1);
    assert.match(await toggle.innerText(), /Calentamiento sugerido\s*▸/);
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await toggle.getAttribute('aria-controls'), await panel.getAttribute('id'));
    assert.strictEqual(await panel.isHidden(), true, 'plegado: el panel no se ve');
    const tb = await toggle.boundingBox();
    const ab0 = await bc.locator('.ses-add-set').boundingBox();
    const sb = await bc.locator('.ses-sets').boundingBox();
    assert.ok(tb.height >= 44, `objetivo táctil ≥ 44 px (${tb.height})`);
    assert.ok(Math.abs((tb.y + tb.height / 2) - (ab0.y + ab0.height / 2)) < 2 && tb.x > ab0.x + ab0.width, 'en la fila de «+ Serie», a su derecha');
    assert.ok(tb.y >= sb.y + sb.height, 'debajo de las series: no mueve «Registrar serie 1»');
    assert.ok(tb.x + tb.width <= 390 - 16, 'dentro de la tarjeta');
    // Sin la sugerencia, la tarjeta mide lo mismo (no ocupa espacio plegada)
    const withH = (await bc.boundingBox()).height;
    const withoutH = await page.evaluate((sel) => {
      const c = document.querySelector(sel);
      const t = c.querySelector('.ses-warm-toggle');
      t.hidden = true;
      const hh = c.getBoundingClientRect().height;
      t.hidden = false;
      return hh;
    }, `[data-se="${seOf('press_banca').id}"]`);
    assert.ok(Math.abs(withH - withoutH) < 1, `plegada no ocupa espacio (${withH} vs ${withoutH})`);
    // el registro de 1 toque no cambia
    assert.match(await bc.locator('.ses-register').innerText(), /Registrar serie 1/);
    // Solo con carga: no en peso corporal (dominadas) ni sin peso de referencia (primera vez); sí en aislamiento.
    assert.strictEqual(await card('dominadas').locator('.ses-warm-toggle').count(), 0, 'peso corporal: sin sugerencia');
    assert.strictEqual(await card('press_inclinado_mancuerna').locator('.ses-warm-toggle').count(), 0, 'sin carga: sin sugerencia');
    assert.strictEqual(await card('elevaciones_laterales').locator('.ses-warm-toggle').count(), 1, 'aislamiento con carga: sí');
    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), `[data-se="${seOf('press_banca').id}"] .ses-card-actions`);
    await page.waitForTimeout(100);
    await shot(page, 'warmup-folded');

    // --- Desplegar ---
    await toggle.click();
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'true');
    await panel.waitFor({ state: 'visible' });
    assert.match(await panel.locator('.ses-warm-for').innerText(), /Antes de 80 kg × 6/);
    assert.deepStrictEqual(plain(await panel.locator('.ses-warm-step').allInnerTexts()), ['40 % · 32,5 kg × 8', '60 % · 47,5 kg × 5', '80 % · 65 kg × 3']);
    const addBtn = panel.locator('.ses-warm-add');
    assert.match(await addBtn.innerText(), /Añadir estas series/);
    // Se mide con todo quieto: mientras se anima algo que la contiene (transform), la caja mide un pelo menos
    // (43,9999 px en WebKit con la máquina cargada). Por condición: se esperan las animaciones finitas en curso.
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter((a) => a.effect?.getTiming?.().iterations !== Infinity)
      .map((a) => a.finished.catch(() => {}))));
    const ab = await addBtn.boundingBox();
    assert.ok(ab.height >= 44 && ab.height < 50, `«Añadir estas series» en una línea y ≥ 44 px (${ab.height})`);
    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), `[data-se="${seOf('press_banca').id}"] .ses-warmup`);
    await page.waitForTimeout(300); // fin de la entrada del panel
    await shot(page, 'warmup-open');

    // Aislamiento: redondeo a 1 kg; otro toque en la línea lo pliega de nuevo
    const lc = card('elevaciones_laterales');
    await lc.locator('.ses-warm-toggle').click();
    assert.deepStrictEqual(plain(await lc.locator('.ses-warm-step').allInnerTexts()), ['50 % · 5 kg × 10']);
    await lc.locator('.ses-warm-toggle').click();
    assert.strictEqual(await lc.locator('.ses-warm-toggle').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await lc.locator('.ses-warmup').isHidden(), true);

    // Abierto sigue abierto al salir y volver a la sesión (la vista se vuelve a montar)
    await go(page, '#/');
    await go(page, `#/session/${id}`);
    await page.waitForSelector(`[data-se="${seOf('press_banca').id}"] .ses-warm-toggle`);
    assert.strictEqual(await toggle.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(await panel.isVisible(), true);
    assert.strictEqual(await lc.locator('.ses-warm-toggle').getAttribute('aria-expanded'), 'false');

    // --- Añadir estas series ---
    await addBtn.click();
    assert.strictEqual(await bc.locator('.ses-warm-toggle').count(), 0, 'tras añadir, la línea desaparece');
    assert.strictEqual(await bc.locator('.ses-warmup').count(), 0);
    s = await getSession(page, id);
    let sets = seOf('press_banca').sets;
    assert.deepStrictEqual(sets.map((x) => [x.type, x.weight, x.reps, x.done]), [
      ['warmup', 32.5, 8, false], ['warmup', 47.5, 5, false], ['warmup', 65, 3, false],
      ['effective', 80, 6, false], ['effective', 80, 5, false], ['effective', 77.5, 6, false],
    ], 'calentamientos pendientes al principio del ejercicio');
    assert.match(await bc.locator('.ses-editor-num').innerText(), /Calentamiento/i);
    assert.match(await bc.locator('.ses-register').innerText(), /Registrar calentamiento/);
    assert.deepStrictEqual(await bc.locator('.ses-row .ses-row-num').allInnerTexts(), ['C', 'C', '1', '2', '3'], 'numeración: C y luego 1, 2, 3');
    await shot(page, 'warmup-added');

    // Deshacer lo quita y la sugerencia vuelve (plegada)
    await page.locator('.toast .toast-action').click();
    s = await getSession(page, id);
    assert.deepStrictEqual(seOf('press_banca').sets.map((x) => x.type), ['effective', 'effective', 'effective']);
    assert.strictEqual(await bc.locator('.ses-warm-toggle').getAttribute('aria-expanded'), 'false');
    await bc.locator('.ses-warm-toggle').click();
    await bc.locator('.ses-warm-add').click();
    assert.strictEqual(await bc.locator('.ses-warm-toggle').count(), 0);

    // --- 1 toque por calentamiento, luego la serie 1 ---
    for (let i = 0; i < 3; i++) {
      assert.match(await bc.locator('.ses-register').innerText(), /Registrar calentamiento/);
      await bc.locator('.ses-register').click();
      await settle(page);
    }
    assert.match(await bc.locator('.ses-editor-num').innerText(), /Serie 1/i);
    assert.strictEqual(await bc.locator('.ses-editor input[aria-label="Peso"]').inputValue(), '80');
    await bc.locator('.ses-register').click();
    s = await getSession(page, id);
    sets = seOf('press_banca').sets;
    assert.deepStrictEqual(sets.slice(0, 4).map((x) => [x.type, x.weight, x.done]), [['warmup', 32.5, true], ['warmup', 47.5, true], ['warmup', 65, true], ['effective', 80, true]]);
    assert.strictEqual(await bc.locator('.ses-row-pr').count(), 0, 'ningún récord');
    assert.strictEqual(await page.locator('.toast.toast-pr').count(), 0);

    // No cuentan como series de trabajo ni volumen
    const calc = await page.evaluate(async (sid) => {
      const c = await import('./js/calc.js');
      const { store } = window.__app;
      const ses = store.get('sessions', sid);
      const se = ses.exercises[0];
      const exMap = new Map(store.all('exercises').map((e) => [e.id, e]));
      return { work: c.workSetCount(se), volume: c.sessionVolume({ ...ses, exercises: [se] }, exMap) };
    }, id);
    assert.deepStrictEqual(calc, { work: 1, volume: 480 });

    // Con calentamientos hechos no vuelve a aparecer (tampoco tras recargar)
    await reload(page);
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await bc.locator('.ses-warm-toggle').count(), 0);
    assert.strictEqual(await card('elevaciones_laterales').locator('.ses-warm-toggle').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
