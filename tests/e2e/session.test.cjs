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
    await bc.locator('.ses-register').click();
    await bc.locator('.ses-register').click();
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
    await bc.locator('.ses-editor button[aria-label="Sumar 2,5"]').first().click();
    assert.strictEqual(await bc.locator('.ses-editor input[aria-label="Peso"]').inputValue(), '82,5');
    await bc.locator('.ses-register').click();
    const prToast = page.locator('.toast.toast-pr');
    await prToast.waitFor();
    assert.match(await prToast.innerText(), /Récord: 82,5 kg en Press banca/);
    assert.strictEqual(await bc.locator('.ses-row-pr').count(), 1, 'badge 🏆 en la fila');
    await shot(page, 'session-pr');
    // la tercera pendiente tenía otro peso (77,5): no hereda
    s = await getSession(page, id);
    assert.strictEqual(s.exercises[0].sets[2].weight, 77.5);

    // Herencia de peso en dominadas (lastre +10 → +12,5 en todas las pendientes con +10)
    const pc = card(page, pull.id);
    assert.strictEqual(await pc.locator('.ses-editor input[aria-label="Lastre"]').inputValue(), '10');
    await pc.locator('.ses-editor button[aria-label="Sumar 2,5"]').first().click();
    await pc.locator('.ses-register').click();
    s = await getSession(page, id);
    assert.deepStrictEqual(s.exercises[1].sets.map((x) => x.weight), [12.5, 12.5, 12.5]);
    assert.match(await page.locator('.toast.toast-pr').innerText(), /Récord: \+12,5 kg en Dominadas/);

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
    await card(page, added.id).locator('.ses-editor input[aria-label="Peso"]').fill('14');
    // sin historial ni objetivo de reps: hay que indicarlas
    await card(page, added.id).locator('.ses-register').click();
    assert.match(await page.locator('.toast.toast-error').innerText(), /Indica las repeticiones/);
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
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, id);

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
    await page.waitForTimeout(200);
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
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.strictEqual(await fin.locator('.ses-dur input').inputValue(), '25');
    assert.match(await fin.innerText(), /100 min desde el inicio − 75 min/);
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

    // Terminar: la duración se pide a mano
    await page.locator('.ses-finish').click();
    const fin = page.locator('.sheet-panel.ses-finish-sheet');
    await fin.waitFor();
    assert.strictEqual(await fin.locator('.ses-dur input').inputValue(), '');
    assert.match(await fin.innerText(), /indica la duración a mano/i);
    await fin.locator('.ses-dur input').fill('55');
    await fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' }).click();
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}/summary`, id);
    s = await getSession(page, id);
    assert.strictEqual(s.durationMin, 55);
    assert.strictEqual(s.endedAt, null);
    assert.strictEqual(s.status, 'done');

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

    // Cambiar fecha
    await page.locator('.ses-menu-btn').click();
    await page.locator('.action-item', { hasText: 'Cambiar fecha' }).click();
    const newDate = await page.evaluate(async () => { const u = await import('./js/util.js'); return u.addDays(u.todayStr(), -4); });
    const di = page.locator('.ses-date-input');
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
