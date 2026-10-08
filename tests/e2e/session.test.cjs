// E2E del registro de sesiones de fuerza (módulo de sesión).
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

/** Siembra una sesión de Día 1 terminada ayer (historial para «Última vez» y récords). */
async function seedHistory(page) {
  return page.evaluate(async () => {
    const u = await import('./js/util.js');
    const { store } = window.__app;
    const date = u.addDays(u.todayStr(), -7);
    const set = (type, weight, reps, rir, extra = {}) => ({ id: u.uid('set_'), type, weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: Date.now() - 7 * 864e5, ...extra });
    const se = (exerciseId, templateItemId, sets) => ({ id: u.uid('se_'), exerciseId, exName: store.exercise(exerciseId).name, templateItemId, baseExerciseId: exerciseId, alternatives: [], target: { sets: 3 }, notes: '', note: '', section: '', groupId: null, groupType: null, sets });
    const s = {
      id: 'hist_d1', kind: 'strength', date, planDate: date, templateId: 'tpl_d1', templateName: 'Día 1 — Upper pesado',
      status: 'done', startedAt: u.tsFromDate(date, 18), endedAt: u.tsFromDate(date, 19), durationMin: 60, rpe: 8, notes: '', parentId: null, cursor: 0,
      exercises: [
        se('press_banca', 'ti_d1_1', [set('warmup', 40, 8, null), set('effective', 80, 6, 2), set('effective', 80, 5, 1), set('effective', 77.5, 6, 1)]),
        se('dominadas', 'ti_d1_2', [set('effective', 10, 8, 1), set('effective', 10, 7, 1), set('effective', 10, 6, 0)]),
      ],
    };
    await store.save('sessions', s);
    return date;
  });
}

async function createSession(page, opts) {
  return page.evaluate(async (o) => {
    const m = await import('./js/session-logic.js');
    const s = await m.createStrengthSession(o);
    return s.id;
  }, opts);
}

const getSession = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', i))), id);
const card = (page, seId) => page.locator(`[data-se="${seId}"]`);
// Entre dos registros seguidos en la misma tarjeta (el botón ignora dobles toques durante 300 ms).
const settle = (page) => page.waitForTimeout(320);

test('registro de fuerza: prellenado, 1 toque, récord, calentamiento, recarga, añadir/quitar y terminar aplicando a la plantilla', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const histDate = await seedHistory(page);
    const id = await createSession(page, { templateId: 'tpl_d1' });
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    let s = await getSession(page, id);
    const [bench, pull] = s.exercises;

    // Cabecera: nombre de plantilla y cronómetro en marcha
    assert.match(await page.locator('.topbar h1').innerText(), /Día 1/);
    const clock1 = await page.locator('.ses-clock').innerText();
    assert.match(clock1, /^\d+:\d\d$/);

    // Prellenado y «Última vez»
    const bc = card(page, bench.id);
    const lastTxt = await bc.locator('.ses-last').innerText();
    assert.match(lastTxt, /ÚLTIMA VEZ/i);
    assert.ok(lastTxt.includes('80×6 @2 · 80×5 @1 · 77,5×6 @1'), lastTxt);
    assert.ok(lastTxt.includes('C 40×8'), 'muestra también el calentamiento');
    assert.strictEqual(await bc.locator('.ses-editor input[aria-label="Peso"]').inputValue(), '80');
    assert.strictEqual(await bc.locator('.ses-editor input[aria-label="Repeticiones"]').inputValue(), '6');
    assert.strictEqual(await bc.locator('.ses-rir .chip.active').innerText(), '2');
    assert.match(await bc.locator('.ses-target').innerText(), /Objetivo 3×4–6/);
    assert.match(await page.locator(`[data-se="${s.exercises[2].id}"] .ses-last`).innerText(), /Primera vez con este ejercicio/);
    await shot(page, 'session-start');

    // 1 toque registra la serie prellenada (y se guarda al instante).
    // El segundo toque inmediato (doble toque accidental) no registra también la serie 2.
    // Los dos toques en el mismo instante (sobre el botón que haya tras el primero): dos .click() de Playwright seguidos
    // tardan ~70 ms en Chromium pero ~400 ms en WebKit, y a partir de 400 ms la app lo trata, con razón, como un segundo
    // toque deliberado.
    await page.evaluate((seId) => {
      const sel = `[data-se="${seId}"] .ses-register`;
      document.querySelector(sel).click();
      document.querySelector(sel).click();
    }, bench.id);
    s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets.filter((x) => x.done).length, 1, 'doble toque ignorado');
    const b1 = s.exercises[0].sets[0];
    assert.deepStrictEqual([b1.done, b1.weight, b1.reps, b1.rir, b1.type], [true, 80, 6, 2, 'effective']);
    let disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.strictEqual(disk.exercises[0].sets[0].done, true, 'en disco');
    // el editor pasa a la siguiente pendiente (serie 2: 80×5)
    assert.match(await bc.locator('.ses-editor-num').innerText(), /Serie 2/i);
    assert.strictEqual(await bc.locator('.ses-editor input[aria-label="Repeticiones"]').inputValue(), '5');
    assert.strictEqual(await bc.locator('.ses-row[data-state="done"]').count(), 1);
    // no hay récord con los mismos valores
    assert.strictEqual(await bc.locator('.ses-row-pr').count(), 0);


    // Récord de peso: +2,5 kg y registrar
    await settle(page);
    await bc.locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').first().click();
    assert.strictEqual(await bc.locator('.ses-editor input[aria-label="Peso"]').inputValue(), '82,5');
    await bc.locator('.ses-register').click();
    const prToast = page.locator('.toast.toast-pr');
    await prToast.waitFor();
    assert.match(await prToast.innerText(), /Récord: 82,5 kg en Press banca/);
    // durante la sesión el aviso va arriba (abajo taparía «Registrar serie»)
    const toastBox = await prToast.boundingBox();
    assert.ok(toastBox.y < 150, `aviso arriba (${toastBox.y})`);
    assert.strictEqual(await bc.locator('.ses-row-pr').count(), 1, 'badge 🏆 en la fila');
    await shot(page, 'session-pr');
    // la tercera pendiente tenía otro peso (77,5): no hereda
    s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets[2].weight, 77.5);

    // Herencia de peso en dominadas (lastre +10 → +12,5 en todas las pendientes con +10),
    // también si la app se cierra entre el cambio y la confirmación (el peso prellenado va en la serie).
    let pc = card(page, pull.id);
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '10');
    await pc.locator('.ses-editor button[aria-label^="Sumar 2,5 a "]').first().click();
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.deepStrictEqual([disk.exercises[1].sets[0].weight, disk.exercises[1].sets[0].origWeight], [12.5, 10], 'un toque se guarda al instante');
    await reload(page);
    await page.waitForSelector('.ses-card');
    pc = card(page, pull.id);
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '12,5');
    await pc.locator('.ses-register').click();
    s = await getSession(page, id);
    assert.deepStrictEqual(s.exercises[1].sets.map((x) => x.weight), [12.5, 12.5, 12.5]);
    assert.match(await page.locator('.toast.toast-pr').innerText(), /Récord: \+12,5 kg en Dominadas/);
    assert.strictEqual('origWeight' in s.exercises[1].sets[0], false, 'se limpia al confirmar');

    // Calentamiento: se inserta antes de la pendiente y no cuenta para récords
    await bc.locator('.ses-add-warm').click();
    assert.match(await bc.locator('.ses-editor-num').innerText(), /Calentamiento/i);
    const w = bc.locator('.ses-editor input[aria-label="Peso"]');
    await w.fill('120');
    await w.dispatchEvent('change');
    await bc.locator('.ses-register').click();
    s = await getSession(page, id);
    const warm = s.exercises[0].sets.find((x) => x.type === 'warmup');
    assert.ok(warm && warm.done && warm.weight === 120);
    assert.strictEqual(await bc.locator('.ses-row-pr').count(), 1, 'el calentamiento no es récord');
    const counts = await page.evaluate(async (sid) => {
      const calc = await import('./js/calc.js');
      const { store } = window.__app;
      const sess = store.get('sessions', sid);
      const exMap = new Map(store.all('exercises').map((e) => [e.id, e]));
      const prs = calc.sessionPRs(sess, store.all('sessions'), exMap, () => 75);
      const warmId = sess.exercises[0].sets.find((x) => x.type === 'warmup').id;
      return { prs: prs.size, warmPr: prs.has(warmId), work: calc.workSetCount(sess.exercises[0]) };
    }, id);
    assert.deepStrictEqual(counts, { prs: 2, warmPr: false, work: 2 });

    // Recargar a mitad de sesión: sigue abierta, con las series, y está en IndexedDB
    await reload(page);
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await page.evaluate(() => location.hash), `#/session/${id}`);
    assert.strictEqual(await card(page, bench.id).locator('.ses-row[data-state="done"]').count(), 3);
    assert.strictEqual(await card(page, pull.id).locator('.ses-row[data-state="done"]').count(), 1);
    assert.ok(await page.locator('.ses-clock').isVisible(), 'el cronómetro sigue');
    disk = (await idbAll(page, 'sessions')).find((x) => x.id === id);
    assert.strictEqual(disk.status, 'active');
    assert.strictEqual(disk.exercises[0].sets.filter((x) => x.done).length, 3);
    assert.strictEqual(disk.cursor, 0);

    // Añadir ejercicio (prellenado 3 series) → quitarlo → deshacer
    await page.locator('.ses-add-ex').click();
    await page.locator('.pick-sheet .search-input').fill('martillo');
    await page.locator('.pick-row', { hasText: 'Curl martillo' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.length === 8, id);
    s = await getSession(page, id);
    const added = s.exercises[7];
    assert.strictEqual(added.exerciseId, 'curl_martillo');
    assert.strictEqual(added.sets.length, 3);
    assert.strictEqual(added.templateItemId, null);
    await card(page, added.id).locator('.ses-more').click();
    await page.locator('.action-item', { hasText: 'Quitar de esta sesión' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.length === 7, id);
    assert.strictEqual(await card(page, added.id).count(), 0);
    await page.locator('.toast-undo .toast-action').click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.length === 8, id);
    assert.strictEqual(await card(page, added.id).count(), 1);
    // registra una serie del añadido y quita Face pull (sin deshacer)
    // sin historial: sin peso no se registra (una serie efectiva sin carga no cuenta bien) y lleva al campo
    await card(page, added.id).locator('.ses-register').click();
    assert.match(await page.locator('.toast.toast-error').innerText(), /Indica el peso y las repeticiones/);
    assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Peso');
    await card(page, added.id).locator('.ses-editor input[aria-label="Peso"]').fill('14');
    // sin historial ni objetivo de reps: hay que indicarlas
    await card(page, added.id).locator('.ses-register').click();
    assert.match(await page.locator('.toast.toast-error').innerText(), /Indica las repeticiones/);
    assert.strictEqual(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Repeticiones');
    await card(page, added.id).locator('.ses-editor input[aria-label="Repeticiones"]').fill('12');
    await settle(page);
    await card(page, added.id).locator('.ses-register').click();
    assert.strictEqual(await card(page, added.id).locator('.ses-row[data-state="done"]').count(), 1);
    const face = s.exercises.find((x) => x.exerciseId === 'face_pull');
    await card(page, face.id).locator('.ses-more').click();
    await page.locator('.action-item', { hasText: 'Quitar de esta sesión' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises.length === 7, id);
    // la plantilla no se ha tocado durante la sesión
    const tplBefore = (await storeAll(page, 'templates')).find((t) => t.id === 'tpl_d1');
    assert.strictEqual(tplBefore.items.length, 7);

    // Terminar: duración prellenada, RPE, aviso de pendientes
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    const durVal = await fin.locator('.ses-dur input').inputValue();
    assert.match(durVal, /^\d+$/);
    assert.match(await fin.innerText(), /desde que empezaste/);
    assert.match(await fin.locator('.ses-pending-warn').innerText(), /se descartarán/);
    await fin.locator('.rpe-chips .chip', { hasText: /^8$/ }).click();
    await shot(page, 'session-finish');
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();

    // ¿Aplicar a la plantilla? (añadido + quitado)
    const diff = page.locator('.sheet-panel.ses-diff-sheet');
    await diff.waitFor();
    const diffTxt = await diff.innerText();
    assert.match(diffTxt, /Añadir «Curl martillo»/);
    assert.match(diffTxt, /Quitar «Face pull»/);
    assert.strictEqual(await diff.locator('.ses-check').count(), 2);
    await shot(page, 'session-diff');
    await diff.locator('.sheet-actions button', { hasText: 'Aplicar a la plantilla' }).click();
    await page.waitForFunction((sid) => location.hash.split("?")[0] === `#/session/${sid}/summary`, id);

    s = await getSession(page, id);
    assert.strictEqual(s.status, 'done');
    assert.strictEqual(s.rpe, 8);
    assert.ok(typeof s.durationMin === 'number');
    assert.ok(s.endedAt > 0);
    assert.strictEqual(s.exercises.flatMap((x) => x.sets).filter((x) => !x.done).length, 0, 'pendientes descartadas');
    const tpl = (await storeAll(page, 'templates')).find((t) => t.id === 'tpl_d1');
    const ids = tpl.items.map((i) => i.exerciseId);
    assert.ok(ids.includes('curl_martillo') && !ids.includes('face_pull'), ids.join(','));
    assert.strictEqual(ids.indexOf('curl_martillo'), ids.length - 1);

    // Resumen
    const sum = await page.locator('#view').innerText();
    assert.match(sum, /Récords batidos/i);
    assert.match(sum, /Series por músculo/i);
    assert.match(sum, /Mejor serie por ejercicio/i);
    assert.match(sum, /Series de trabajo\n4\n/, 'series de trabajo sin calentamientos');
    assert.match(sum, /8\/10/);
    assert.match(sum, /🏆 en esta sesión/);
    // récord: nombre y serie en líneas separadas (el peso × reps no se corta)
    assert.deepStrictEqual(await page.locator('.ses-sum-pr .ses-sum-pr-set').allInnerTexts(), ['82,5 kg × 5 @1', '+12,5 kg × 8 @1']);
    assert.deepStrictEqual(await page.locator('.ses-sum-pr .ses-sum-pr-name').allInnerTexts(), ['Press banca', 'Dominadas']);
    await shot(page, 'session-summary');
    assert.ok(histDate);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('alternativas, cardio enlazado y cursor al volver', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // Día 2: alternativas «Prensa · Sentadilla hack», secciones y una superserie (gemelos + tibial)
    await page.evaluate(async () => {
      const { store } = window.__app;
      const t = store.get('templates', 'tpl_d2');
      for (const it of t.items.filter((i) => ['ti_d2_7', 'ti_d2_8'].includes(i.id))) { it.groupId = 'g1'; it.groupType = 'superset'; }
      await store.save('templates', t);
    });
    const id2 = await createSession(page, { templateId: 'tpl_d2' });
    await go(page, `#/session/${id2}`);
    await page.waitForSelector('.ses-card');
    const grp = page.locator('.ses-group');
    assert.strictEqual(await grp.count(), 1);
    assert.match(await grp.locator('.ses-group-head').innerText(), /Superserie A/i);
    assert.deepStrictEqual(await grp.locator('.ses-label').allInnerTexts(), ['A1', 'A2']);
    assert.strictEqual(await grp.locator('.ses-card').count(), 2);
    assert.strictEqual(await page.locator('.ses-section', { hasText: 'Bloque potencia' }).count(), 1);
    assert.strictEqual(await page.locator('.ses-section', { hasText: 'Bloque fuerza' }).count(), 1);
    let s = await getSession(page, id2);
    const prensa = s.exercises.find((x) => x.exerciseId === 'prensa');
    const pc = card(page, prensa.id);
    assert.strictEqual(await pc.locator('.ses-alt-chips .chip').count(), 2);
    await pc.locator('.ses-alt-chips .chip', { hasText: 'Sentadilla hack' }).click();
    s = await getSession(page, id2);
    assert.strictEqual(s.exercises.find((x) => x.id === prensa.id).exerciseId, 'hack_squat');
    // con una serie hecha, cambiar pide confirmación
    await card(page, prensa.id).locator('.ses-editor input[aria-label="Peso"]').fill('100');
    await card(page, prensa.id).locator('.ses-register').click();
    await card(page, prensa.id).locator('.ses-alt-chips .chip', { hasText: 'Prensa' }).click();
    const conf = page.locator('.sheet-panel', { hasText: '¿Cambiar a «Prensa»?' });
    await conf.waitFor();
    assert.match(await conf.innerText(), /pasarán a contar como «Prensa»/);
    await conf.locator('button', { hasText: 'Cancelar' }).click();
    s = await getSession(page, id2);
    assert.strictEqual(s.exercises.find((x) => x.id === prensa.id).exerciseId, 'hack_squat');
    await shot(page, 'session-alternatives');
    // saltos: editor de reps + altura
    const jumps = s.exercises.find((x) => x.exerciseId === 'saltos_verticales');
    assert.strictEqual(await card(page, jumps.id).locator('.ses-editor input[aria-label^="Altura"]').count(), 1);
    // elegir la alternativa no es un cambio de plantilla
    const diff = await page.evaluate(async (sid) => {
      const m = await import('./js/session-logic.js');
      const { store } = window.__app;
      const ses = store.get('sessions', sid);
      return m.templateDiff(store.get('templates', ses.templateId), ses).length;
    }, id2);
    assert.strictEqual(diff, 0);
    // cursor: se guardó el último ejercicio tocado y al volver se desplaza a él
    s = await getSession(page, id2);
    assert.strictEqual(s.cursor, s.exercises.findIndex((x) => x.id === prensa.id));
    await reload(page);
    await page.waitForSelector('.ses-card');
    // Por condición (no una pausa fija): la app desplaza a la tarjeta del cursor tras dos fotogramas.
    await page.waitForFunction(() => window.scrollY > 0, null, { timeout: 4000 }).catch(() => {});
    const top = await card(page, prensa.id).evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(await page.evaluate(() => window.scrollY) > 0, 'se ha desplazado');
    assert.ok(top > 40 && top < 200, `la tarjeta del cursor queda arriba (${top})`);
    // descartar la sesión para poder abrir otra
    await page.evaluate(async (sid) => { await window.__app.store.remove('sessions', sid); }, id2);

    // Día 3: ítem de cardio → formulario de actividad con parent e item
    const id3 = await createSession(page, { templateId: 'tpl_d3' });
    await go(page, `#/session/${id3}`);
    await page.waitForSelector('.ses-card');
    s = await getSession(page, id3);
    const run = s.exercises.find((x) => x.exerciseId === 'correr');
    assert.strictEqual(run.sets.length, 0);
    const rc = card(page, run.id);
    assert.match(await rc.locator('.ses-target').innerText(), /Objetivo 30–45 min/);
    assert.match(await rc.locator('.ses-target').innerText(), /Zona 2/);
    // una actividad enlazada ya registrada se muestra con distancia, tiempo y ritmo
    await page.evaluate(async ({ sid, seId }) => {
      const { store } = window.__app;
      const ses = store.get('sessions', sid);
      await store.save('sessions', { id: 'act_1', kind: 'bike', date: ses.date, planDate: ses.date, status: 'done', parentId: sid, parentItemId: 'otro', distanceKm: 20, movingSec: 2400, durationMin: 40 });
      await store.save('sessions', { id: 'act_2', kind: 'run', date: ses.date, planDate: ses.date, status: 'done', parentId: sid, parentItemId: seId, templateItemId: 'ti_d3_1', distanceKm: 6.2, movingSec: 2100, durationMin: 35 });
    }, { sid: id3, seId: run.id });
    await go(page, '#/today');
    await go(page, `#/session/${id3}`);
    await page.waitForSelector('.ses-card');
    const actTxt = await card(page, run.id).locator('.ses-act').innerText();
    assert.match(actTxt, /6,2 km · 35:00 · 5:39 \/km/);
    assert.strictEqual(await card(page, run.id).locator('.ses-act').count(), 1, 'solo la de su ítem');
    await shot(page, 'session-cardio');
    await card(page, run.id).locator('.ses-cardio-btn').click();
    await page.waitForFunction(() => location.hash.startsWith('#/activity/new'));
    const hash = await page.evaluate(() => location.hash);
    const q = new URLSearchParams(hash.split('?')[1]);
    assert.strictEqual(q.get('kind'), 'run');
    assert.strictEqual(q.get('parent'), id3);
    assert.strictEqual(q.get('item'), run.id);
    assert.strictEqual(q.get('date'), s.date);
    // al terminar, la duración propuesta descuenta las actividades enlazadas (35 + 40 min)
    await page.evaluate((sid) => { const ses = window.__app.store.get('sessions', sid); ses.startedAt = Date.now() - 100 * 60000; }, id3);
    await go(page, `#/session/${id3}`);
    await page.waitForSelector('.ses-card');
    // la bici enlazada a un ítem que ya no está no queda oculta
    assert.strictEqual(await page.locator('.ses-orphans .ses-act').count(), 1);
    assert.match(await page.locator('.ses-orphans').innerText(), /Otras actividades de esta sesión/i);
    // quitar el ítem de la carrera: avisa y la borra con él (con deshacer), no la deja huérfana
    await card(page, run.id).locator('.ses-more').click();
    await page.locator('.action-item', { hasText: 'Quitar de esta sesión' }).click();
    const confRm = page.locator('.sheet-panel', { hasText: '¿Quitar «Correr' });
    await confRm.waitFor();
    assert.match(await confRm.innerText(), /6,2 km · 35:00/);
    await confRm.locator('button', { hasText: 'Sí, borrar también la actividad' }).click();
    await page.waitForFunction(() => !window.__app.store.get('sessions', 'act_2'));
    assert.strictEqual(await card(page, run.id).count(), 0);
    assert.strictEqual((await idbAll(page, 'sessions')).some((x) => x.id === 'act_2'), false);
    await page.locator('.toast-undo .toast-action').click();
    await card(page, run.id).locator('.ses-act').waitFor();
    assert.strictEqual(await card(page, run.id).locator('.ses-act').count(), 1, 'deshacer restaura el ítem y su carrera');
    await page.waitForFunction(async () => (await new Promise((res) => {
      const r = indexedDB.open('entreno');
      r.onsuccess = () => { const q = r.result.transaction('sessions').objectStore('sessions').get('act_2'); q.onsuccess = () => { res(!!q.result); r.result.close(); }; };
    })));
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.strictEqual(await fin.locator('.ses-dur input').inputValue(), '25');
    assert.match(await fin.innerText(), /100 min desde el inicio − 75 min/);
    // campo vacío = la propuesta (no el transcurrido entero, que contaría dos veces el cardio)
    await fin.locator('.ses-dur input').fill('');
    await fin.locator('.rpe-chips .chip', { hasText: /^5$/ }).click();
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    await page.waitForFunction((sid) => location.hash.split("?")[0] === `#/session/${sid}/summary`, id3);
    s = await getSession(page, id3);
    assert.deepStrictEqual([s.status, s.durationMin, s.durationAuto], ['done', 25, true]);
    // resumen: duración y carga totales (fuerza + actividades), con la de la fuerza aparte
    await page.waitForSelector('.ses-kpi-total');
    const kpis = await page.locator('.ses-sum-hero .kpis').innerText();
    assert.match(kpis, /Duración total\n1 h 40 min\nfuerza 25 min/);
    // La carga va en la línea secundaria del resumen (las tres cifras grandes: duración, series y récords)
    assert.match(await page.locator('.ses-sum-meta').innerText(), /Carga total 125 \(fuerza 125\)/);
    await shot(page, 'session-summary-cardio');
    // se borra luego la bici enlazada: la duración automática de la fuerza se recalcula (100 − 35)
    await page.evaluate(async () => { await window.__app.store.remove('sessions', 'act_1'); });
    await go(page, `#/session/${id3}`);
    await page.waitForSelector('.ses-card');
    assert.match(await page.locator('.toast').innerText(), /recalculada: 1 h 05 min/);
    s = await getSession(page, id3);
    assert.strictEqual(s.durationMin, 65);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('sesión pasada: sin cronómetro, duración a mano, edición, borrar serie y sesión con deshacer', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const date = await page.evaluate(async () => { const u = await import('./js/util.js'); return u.addDays(u.todayStr(), -3); });
    const id = await createSession(page, { templateId: 'tpl_d4', date, past: true });
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await page.locator('.ses-clock').count(), 0, 'sin cronómetro');
    assert.match(await page.locator('.topbar-sub').innerText(), /a posteriori/);
    let s = await getSession(page, id);
    // unilateral: peso + reps izquierda + derecha
    const uni = s.exercises.find((x) => x.exerciseId === 'remo_unilateral');
    const uc = card(page, uni.id);
    assert.strictEqual(await uc.locator('.ses-editor input[aria-label="Repeticiones lado izquierdo"]').inputValue(), '8');
    assert.strictEqual(await uc.locator('.ses-editor input[aria-label="Repeticiones lado derecho"]').inputValue(), '8');
    await uc.locator('.ses-editor input[aria-label="Peso"]').fill('22,5');
    await uc.locator('.ses-register').click();
    s = await getSession(page, id);
    assert.strictEqual(s.exercises.find((x) => x.id === uni.id).sets[0].weight, 22.5);
    const first = s.exercises[0];
    await card(page, first.id).locator('.ses-editor input[aria-label="Peso"]').fill('60');
    await card(page, first.id).locator('.ses-register').click();
    await shot(page, 'session-past');

    // Terminar: la duración se pide a mano y es obligatoria (sin ella no hay carga)
    await page.locator('.ses-finish').click();
    let fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.strictEqual(await fin.locator('.ses-dur input').inputValue(), '');
    assert.match(await fin.innerText(), /indica cuánto duró la fuerza/i);
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    assert.match(await fin.locator('.ses-dur-error').innerText(), /Indica la duración/);
    assert.strictEqual((await getSession(page, id)).status, 'active', 'no se termina sin duración');
    // lo escrito en la hoja se guarda al momento: si la app se cierra antes de confirmar, sigue ahí
    await fin.locator('.ses-dur input').fill('55');
    await fin.locator('.rpe-chips .chip', { hasText: /^6$/ }).click();
    await page.waitForTimeout(300);
    await reload(page);
    await page.waitForSelector('.ses-card');
    await page.locator('.ses-finish').click();
    fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.strictEqual(await fin.locator('.ses-dur input').inputValue(), '55');
    assert.strictEqual(await fin.locator('.rpe-chips .chip.active').innerText(), '6');
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    await page.waitForFunction((sid) => location.hash.split("?")[0] === `#/session/${sid}/summary`, id);
    s = await getSession(page, id);
    assert.strictEqual(s.durationMin, 55);
    assert.strictEqual(s.rpe, 6);
    assert.strictEqual(s.endedAt, null);
    assert.strictEqual(s.status, 'done');
    assert.strictEqual(s.durationAuto, false);

    // Editar la sesión pasada: sin «Terminar»; editar y borrar una serie con deshacer
    await page.locator('.ses-sum-edit').click();
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}`, id);
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await page.locator('.ses-finish, .ses-finish-top').count(), 0);
    const fc = card(page, first.id);
    await fc.locator('.ses-row[data-state="done"]').click();
    assert.strictEqual(await fc.locator('.ses-editor-edit').count(), 1);
    await fc.locator('.ses-editor input[aria-label="Repeticiones"]').fill('9');
    await fc.locator('.ses-editor input[aria-label="Repeticiones"]').dispatchEvent('change');
    await settle(page);
    await fc.locator('.ses-register', { hasText: 'Listo' }).click();
    s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets[0].reps, 9);
    await fc.locator('.ses-row[data-state="done"]').click();
    await fc.locator('.ses-del-set').click();
    s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets.length, 0);
    await page.locator('.toast-undo .toast-action').click();
    s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets.length, 1);

    // Cambiar fecha: no se admiten días futuros (como en el calendario y el peso)
    await page.locator('.ses-menu-btn').click();
    await page.locator('.action-item', { hasText: 'Cambiar fecha' }).click();
    const [newDate, future, today] = await page.evaluate(async () => { const u = await import('./js/util.js'); return [u.addDays(u.todayStr(), -4), u.addDays(u.todayStr(), 3), u.todayStr()]; });
    const di = page.locator('.ses-date-input');
    assert.strictEqual(await di.getAttribute('max'), today);
    await di.fill(future);
    await di.dispatchEvent('change');
    assert.match(await page.locator('.toast.toast-error').innerText(), /no puede ser posterior a hoy/);
    assert.strictEqual((await getSession(page, id)).date, date);
    await di.fill(newDate);
    await di.dispatchEvent('change');
    s = await getSession(page, id);
    assert.strictEqual(s.date, newDate);
    assert.strictEqual(s.planDate, newDate);
    await page.locator('.sheet-actions button', { hasText: 'Listo' }).click();

    // Borrar la sesión: confirmación y deshacer desde la pantalla a la que se vuelve
    await page.waitForTimeout(250);
    await page.locator('.ses-menu-btn').click();
    await page.locator('.action-item', { hasText: 'Borrar sesión' }).click();
    const conf = page.locator('.sheet-panel', { hasText: '¿Borrar esta sesión?' });
    await conf.waitFor();
    await conf.locator('button', { hasText: 'Borrar sesión' }).click();
    await page.waitForFunction((sid) => !location.hash.startsWith(`#/session/${sid}`), id);
    assert.strictEqual((await storeAll(page, 'sessions')).some((x) => x.id === id), false);
    await page.locator('.toast-undo .toast-action').click();
    await page.waitForFunction((sid) => !!window.__app.store.get('sessions', sid), id);
    assert.strictEqual((await idbAll(page, 'sessions')).some((x) => x.id === id), true);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('ejercicio repetido (Sprint 20 m y 30 m), asistencia en peso corporal y cambio a un ejercicio de otro tipo', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // Día 6 de hace una semana: sprints de 20 m (~3,1 s) y de 30 m (~4,4 s); dominadas asistidas (−15 kg).
    await page.evaluate(async () => {
      const u = await import('./js/util.js');
      const m = await import('./js/session-logic.js');
      const { store } = window.__app;
      const s = await m.createStrengthSession({ templateId: 'tpl_d6', date: u.addDays(u.todayStr(), -7), past: true });
      const byItem = (ti) => s.exercises.find((x) => x.templateItemId === ti);
      byItem('ti_d6_3').sets.forEach((x, i) => Object.assign(x, { distanceM: 20, timeSec: 3.1 + i * 0.05, done: true, doneAt: 1 }));
      const s30 = byItem('ti_d6_4');
      s30.sets.forEach((x, i) => Object.assign(x, { distanceM: 30, timeSec: 4.4 + i * 0.1, done: true, doneAt: 1 }));
      byItem('ti_d6_9').sets.forEach((x) => Object.assign(x, { weight: -15, reps: 8, rir: 1, done: true, doneAt: 1 }));
      m.finishSession(s, { durationMin: 60, rpe: 7 });
      await store.save('sessions', s);
    });
    const id = await createSession(page, { templateId: 'tpl_d6' });
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    let s = await getSession(page, id);
    const se20 = s.exercises.find((x) => x.templateItemId === 'ti_d6_3');
    const se30 = s.exercises.find((x) => x.templateItemId === 'ti_d6_4');
    // Cada bloque ve SU última vez y se prellena con ella (no el de 30 m con los de 20 m)
    const c30 = card(page, se30.id);
    const last30 = await c30.locator('.ses-last').innerText();
    assert.ok(last30.includes('30 m en 4,4 s · 30 m en 4,5 s'), last30);
    assert.ok(!last30.includes('20 m'), last30);
    assert.match(await c30.locator('.ses-target').innerText(), /Objetivo 2–3×30 m/);
    assert.strictEqual(await c30.locator('.ses-editor input[aria-label="Metros"]').inputValue(), '30');
    assert.strictEqual(await c30.locator('.ses-editor input[aria-label="Segundos"]').inputValue(), '4,4');
    assert.match(await card(page, se20.id).locator('.ses-last').innerText(), /20 m en 3,1 s/);
    assert.strictEqual(await card(page, se20.id).locator('.ses-editor input[aria-label="Metros"]').inputValue(), '20');
    await c30.locator('.ses-register').click();
    s = await getSession(page, id);
    const r30 = s.exercises.find((x) => x.id === se30.id).sets[0];
    assert.deepStrictEqual([r30.done, r30.distanceM, r30.timeSec], [true, 30, 4.4]);

    // Dominadas asistidas: el signo se elige con «Lastre / Asistencia» (el teclado decimal no tiene «−»)
    const pull = s.exercises.find((x) => x.templateItemId === 'ti_d6_9');
    const pc = card(page, pull.id);
    assert.strictEqual(await pc.locator('.ses-sign .seg-btn.active').innerText(), 'Asistencia');
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Asistencia"]').inputValue(), '15');
    await pc.locator('.ses-sign .seg-btn', { hasText: 'Lastre' }).click();
    s = await getSession(page, id);
    assert.strictEqual(s.exercises.find((x) => x.id === pull.id).sets[0].weight, 15);
    await pc.locator('.ses-sign .seg-btn', { hasText: 'Asistencia' }).click();
    const inp = pc.locator('.ses-editor input[aria-label="Asistencia"]');
    await inp.fill('20');
    await inp.dispatchEvent('change');
    s = await getSession(page, id);
    assert.strictEqual(s.exercises.find((x) => x.id === pull.id).sets[0].weight, -20);
    await pc.locator('.ses-register').click();
    s = await getSession(page, id);
    // la serie hecha es −20 y la pendiente (prellenada con −15) hereda la nueva asistencia
    assert.deepStrictEqual(s.exercises.find((x) => x.id === pull.id).sets.map((x) => x.weight), [-20, -20]);
    assert.match(await pc.locator('.ses-row[data-state="done"]').innerText(), /−20 kg asist\./);

    // Cambiar Pogo jumps (saltos) por Plancha (tiempo): el objetivo pasa a ser de tiempo
    const pogo = s.exercises[0];
    await card(page, pogo.id).locator('.ses-more').click();
    await page.locator('.action-item', { hasText: 'Cambiar por otro ejercicio' }).click();
    await page.locator('.pick-sheet .search-input').fill('plancha');
    await page.locator('.pick-row', { hasText: 'Plancha' }).first().click();
    await page.waitForFunction(({ sid, seId }) => window.__app.store.get('sessions', sid).exercises.find((x) => x.id === seId).exerciseId === 'plancha', { sid: id, seId: pogo.id });
    assert.match(await card(page, pogo.id).locator('.ses-target').innerText(), /Objetivo 2×30–45 s/);
    s = await getSession(page, id);
    assert.deepStrictEqual(s.exercises[0].sets.map((x) => [x.reps, x.timeSec]), [[null, 30], [null, 30]]);
    await shot(page, 'session-repeated');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('una mano en iPhone SE: «Registrar serie» siempre a la vista (sin desplazar) y avisos arriba', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.addStyleTag({ content: ':root{--sat:20px !important}' });
    // Día 1 anterior con todos los ejercicios hechos (el prellenado trae peso y reps)
    await page.evaluate(async () => {
      const u = await import('./js/util.js');
      const m = await import('./js/session-logic.js');
      const { store } = window.__app;
      const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -7), past: true });
      for (const se of s.exercises) {
        const lt = store.exercise(se.exerciseId).logType;
        se.sets.forEach((x, i) => Object.assign(x, { weight: lt === 'bodyweight' ? 5 : 40, reps: (se.target.repMax || 8) - i, rir: 1, done: true, doneAt: 1 }));
      }
      m.finishSession(s, { durationMin: 60, rpe: 7 });
      await store.save('sessions', s);
    });
    const id = await createSession(page, { templateId: 'tpl_d1' });
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-card');
    const state = () => page.evaluate(() => {
      const ed = document.querySelector('.ses-editor[data-state="editing"]');
      if (!ed) return null;
      const b = ed.querySelector('.ses-register');
      const r = b.getBoundingClientRect();
      const hdr = document.querySelector('.topbar').getBoundingClientRect().bottom;
      const tab = document.getElementById('tabbar').getBoundingClientRect().top;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { label: b.textContent, top: Math.round(r.top), bottom: Math.round(r.bottom), ok: r.top >= hdr - 1 && r.bottom <= tab + 1 && b.contains(hit) };
    });
    // «+ Calent.» a mano junto a «Serie 1» (no al final de la tarjeta, bajo las pestañas)
    const warmBtn = await page.locator('.ses-card').first().locator('.ses-editor-head .ses-add-warm').boundingBox();
    assert.ok(warmBtn && warmBtn.y + warmBtn.height < 610, `«+ Calent.» visible (${warmBtn && warmBtn.y})`);
    const misses = [];
    let taps = 0;
    for (let guard = 0; guard < 40; guard++) {
      const st = await state();
      if (!st) break;
      if (!st.ok) misses.push(`${st.label} ${st.top}-${st.bottom}`);
      if (taps === 1) await page.locator('.ses-editor[data-state="editing"] button[aria-label^="Sumar 2,5 a "]').first().click();
      await page.locator('.ses-editor[data-state="editing"] .ses-register').first().click();
      taps++;
      if (taps === 2) {
        // récord (+2,5 kg): el aviso va arriba, no sobre «Registrar serie 3»
        const t = await page.locator('.toast.toast-pr').boundingBox();
        assert.ok(t && t.y < 120, `aviso de récord arriba (${t && t.y})`);
      }
      // Ritmo del usuario: no vuelve a tocar «Registrar» antes de 400 ms (antes, la app lo toma por un doble toque y lo
      // ignora, con razón). No es una espera al desplazamiento: esa va por condición justo debajo.
      await page.waitForTimeout(400);
      // El desplazamiento automático (el usuario no desplaza nada): la app desplaza 350 ms después del toque al terminar
      // un ejercicio, y en WebKit el toque de Playwright ya tarda más. Primero, a que el «Registrar» que toca quede a la
      // vista (si nunca llega, lo cuenta state() como fallo)…
      await page.waitForFunction(() => {
        const ed = document.querySelector('.ses-editor[data-state="editing"]');
        if (!ed) return true;
        const r = ed.querySelector('.ses-register').getBoundingClientRect();
        const hdr = document.querySelector('.topbar').getBoundingClientRect().bottom;
        const tab = document.getElementById('tabbar').getBoundingClientRect().top;
        return r.top >= hdr - 1 && r.bottom <= tab + 1;
      }, null, { timeout: 4000 }).catch(() => {});
      // …y después, a que el desplazamiento termine (la posición no cambia en 5 fotogramas seguidos).
      await page.evaluate(() => new Promise((res) => {
        let y = -1; let same = 0;
        const tick = () => { const y2 = window.scrollY; same = y2 === y ? same + 1 : 0; y = y2; if (same >= 5) res(); else requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      }));
    }
    assert.ok(taps >= 18, `series registradas: ${taps}`);
    assert.deepStrictEqual(misses, [], 'el botón «Registrar» siempre visible y tocable');
    const s = await getSession(page, id);
    assert.strictEqual(s.exercises.flatMap((x) => x.sets).filter((x) => !x.done).length, 0);
    await shot(page, 'session-se-onehand');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
