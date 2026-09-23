// E2E de rutinas (plantillas) y biblioteca de ejercicios (módulo de biblioteca).
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const getTpl = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.get('templates', i))), id);
const getEx = (page, id) => page.evaluate((i) => JSON.parse(JSON.stringify(window.__app.store.exercise(i))), id);
const byName = async (page, name) => (await storeAll(page, 'templates')).find((t) => t.name === name) || null;
const currentHash = (page) => page.evaluate(() => location.hash);
/** Espera a que se cumpla una condición sobre el store (fn recibe store y arg). */
const until = (page, fn, arg) => page.waitForFunction(fn, arg, { timeout: 5000 });

/** Elige un ejercicio en el selector (hoja con buscador). */
async function pick(page, query, name) {
  const sheetEl = page.locator('.pick-sheet');
  await sheetEl.locator('input.search-input').fill(query);
  await sheetEl.locator('.pick-row', { has: page.locator('.pick-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await page.locator('.pick-sheet').waitFor({ state: 'detached' });
}

/** Botón +/− del stepper cuyo input tiene ese aria-label, dentro de la tarjeta desplegada. */
const stepBtn = (page, label, dir) => page.locator('.lib-item.open .stepper', { has: page.locator(`input[aria-label="${label}"]`) })
  .locator(`button[aria-label^="${dir > 0 ? 'Sumar' : 'Restar'}"]`);
const action = (page, label) => page.locator('.action-item', { hasText: label });

test('rutinas: crear, editar reps y alternativa, superserie, reordenar, quitar con deshacer, duplicar, subir, empezar y borrar con deshacer', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/exercises?seg=templates');
    await page.waitForSelector('.lib-tpl');
    const seedCount = (await storeAll(page, 'templates')).length;
    assert.strictEqual(await page.locator('.lib-tpl').count(), seedCount);
    assert.match(await page.locator('.lib-tpl').first().innerText(), /Día 1 — Upper pesado[\s\S]*7 ejercicios · semana tipo: lun[\s\S]*Press banca · Dominadas/);
    await shot(page, 'library-templates');

    // --- crear ---
    await page.locator('.lib-add', { hasText: 'Nueva rutina' }).click();
    await page.waitForSelector('.lib-editor');
    const hash = await currentHash(page);
    assert.match(hash, /^#\/template\/tpl_[^?]+$/, 'se abre el editor (sin «?new=1» en la URL)');
    const id = hash.split('/')[2];
    let t = await getTpl(page, id);
    assert.strictEqual(t.name, 'Nueva rutina');
    assert.strictEqual(t.order, seedCount);
    await page.locator('input[aria-label="Nombre de la rutina"]').fill('Mi rutina test');
    await until(page, (i) => window.__app.store.get('templates', i).name === 'Mi rutina test', id);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Mi rutina test');

    // --- añadir ejercicios ---
    await page.locator('.lib-add', { hasText: 'Añadir ejercicio' }).click();
    await pick(page, 'remo', 'Remo con barra');
    await page.waitForSelector('.lib-item.open');
    t = await getTpl(page, id);
    assert.strictEqual(t.items.length, 1);
    assert.deepStrictEqual([t.items[0].exerciseId, t.items[0].sets, t.items[0].repMin, t.items[0].repMax], ['remo_barra', 3, 8, 12]);
    const remoId = t.items[0].id;

    // --- editar reps: mín +2, máx escrito, rango de series ---
    await stepBtn(page, 'Reps mín.', 1).click();
    await stepBtn(page, 'Reps mín.', 1).click();
    const maxInp = page.locator('.lib-item.open input[aria-label="Reps máx."]');
    await maxInp.fill('15');
    await maxInp.dispatchEvent('change');
    await stepBtn(page, 'Series máximas', 1).click();
    t = await getTpl(page, id);
    assert.deepStrictEqual([t.items[0].sets, t.items[0].setsMax, t.items[0].repMin, t.items[0].repMax], [3, 4, 10, 15]);
    assert.strictEqual(await page.locator('.lib-item.open .lib-item-target').innerText(), '3–4×10–15');
    // mín por encima del máx arrastra el máx
    const minInp = page.locator('.lib-item.open input[aria-label="Reps mín."]');
    await minInp.fill('16');
    await minInp.dispatchEvent('change');
    t = await getTpl(page, id);
    assert.deepStrictEqual([t.items[0].repMin, t.items[0].repMax], [16, 16]);
    await minInp.fill('10');
    await minInp.dispatchEvent('change');
    await maxInp.fill('15');
    await maxInp.dispatchEvent('change');

    // --- alternativa ---
    await page.locator('.lib-item.open .lib-alt-add').click();
    await pick(page, 'polea', 'Remo en polea baja');
    t = await getTpl(page, id);
    assert.deepStrictEqual(t.items[0].alternatives, ['remo_polea_baja']);
    assert.match(await page.locator(`[data-item="${remoId}"] .lib-item-alt`).innerText(), /o Remo en polea baja/);
    // nota del ejercicio (guardado al teclear)
    await page.locator('.lib-item.open textarea[aria-label="Notas del ejercicio"]').fill('Espalda neutra');
    await until(page, (i) => window.__app.store.get('templates', i).items[0].notes === 'Espalda neutra', id);

    await page.locator('.lib-add', { hasText: 'Añadir ejercicio' }).click();
    await pick(page, 'face', 'Face pull');
    t = await getTpl(page, id);
    assert.deepStrictEqual(t.items.map((x) => x.exerciseId), ['remo_barra', 'face_pull']);
    const faceId = t.items[1].id;
    await shot(page, 'library-template-edit');

    // --- superserie ---
    await page.locator(`[data-item="${remoId}"] .lib-item-head`).click();
    await page.locator('.lib-item.open .lib-grp-btn', { hasText: 'Agrupar con el siguiente' }).click();
    await page.locator('.sheet-panel .action-item', { hasText: 'Superserie' }).click();
    await page.waitForSelector('.lib-group');
    t = await getTpl(page, id);
    assert.ok(t.items[0].groupId && t.items[0].groupId === t.items[1].groupId, 'mismo groupId');
    assert.deepStrictEqual(t.items.map((x) => x.groupType), ['superset', 'superset']);
    assert.deepStrictEqual(await page.locator('.lib-item-label').allInnerTexts(), ['A1', 'A2']);
    assert.match(await page.locator('.lib-group-head').innerText(), /SUPERSERIE[\s\S]*Grupo A · 2 ejercicios/i);
    await page.locator('.sheet-overlay').waitFor({ state: 'detached' });
    await page.locator('.lib-group').scrollIntoViewIfNeeded();
    await shot(page, 'library-superset');
    // superserie → circuito → superserie
    await page.locator('.lib-group-btn').click();
    await until(page, (i) => window.__app.store.get('templates', i).items.every((x) => x.groupType === 'circuit'), id);
    assert.match(await page.locator('.lib-group-head').innerText(), /CIRCUITO/i);
    await page.locator('.lib-group-btn').click();
    await until(page, (i) => window.__app.store.get('templates', i).items.every((x) => x.groupType === 'superset'), id);

    // --- reordenar dentro del grupo ---
    await page.locator('.lib-item.open .lib-act', { hasText: 'Bajar' }).click();
    t = await getTpl(page, id);
    assert.deepStrictEqual(t.items.map((x) => x.id), [faceId, remoId]);
    assert.deepStrictEqual(await page.locator('.lib-item-label').allInnerTexts(), ['A1', 'A2']);

    // --- quitar con deshacer (el grupo se recompone) ---
    await page.locator('.lib-item.open .lib-act', { hasText: 'Quitar' }).click();
    t = await getTpl(page, id);
    assert.deepStrictEqual(t.items.map((x) => x.id), [faceId]);
    assert.strictEqual(t.items[0].groupId, null, 'un ítem solo no es grupo');
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await until(page, (i) => window.__app.store.get('templates', i).items.length === 2, id);
    t = await getTpl(page, id);
    assert.deepStrictEqual(t.items.map((x) => x.id), [faceId, remoId]);
    assert.ok(t.items[0].groupId && t.items[0].groupId === t.items[1].groupId);
    assert.strictEqual(await page.locator('.lib-group').count(), 1);

    // --- todo está en disco al recargar ---
    await reload(page);
    const disk = (await idbAll(page, 'templates')).find((x) => x.id === id);
    assert.strictEqual(disk.name, 'Mi rutina test');
    assert.deepStrictEqual(disk.items.map((x) => [x.exerciseId, x.sets, x.setsMax ?? null, x.repMin, x.repMax, x.groupType]),
      [['face_pull', 3, null, 8, 12, 'superset'], ['remo_barra', 3, 4, 10, 15, 'superset']]);
    assert.deepStrictEqual(disk.items[1].alternatives, ['remo_polea_baja']);

    // --- duplicar desde la lista ---
    await go(page, '#/exercises?seg=templates');
    await page.waitForSelector('.lib-tpl');
    assert.match(await page.locator(`.lib-tpl[data-id="${id}"]`).innerText(), /Mi rutina test[\s\S]*2 ejercicios[\s\S]*Face pull · Remo con barra/);
    await page.locator('button[aria-label="Opciones de Mi rutina test"]').click();
    await action(page, 'Duplicar').click();
    await until(page, () => window.__app.store.all('templates').some((x) => x.name === 'Mi rutina test (copia)'));
    const copy = await byName(page, 'Mi rutina test (copia)');
    t = await getTpl(page, id);
    assert.notStrictEqual(copy.id, id);
    assert.deepStrictEqual(copy.items.map((x) => x.exerciseId), t.items.map((x) => x.exerciseId));
    assert.ok(copy.items.every((x) => !t.items.some((y) => y.id === x.id)), 'ids de ítems nuevos');
    assert.ok(copy.items[0].groupId && copy.items[0].groupId === copy.items[1].groupId && copy.items[0].groupId !== t.items[0].groupId, 'grupo nuevo');
    assert.strictEqual(copy.order, t.order + 1, 'justo debajo de la original');
    await page.waitForSelector(`.lib-tpl[data-id="${copy.id}"]`);
    let order = await page.locator('.lib-tpl').evaluateAll((els) => els.map((e) => e.dataset.id));
    assert.deepStrictEqual(order.slice(-2), [id, copy.id]);

    // --- subir la copia ---
    await page.locator('button[aria-label="Opciones de Mi rutina test (copia)"]').click();
    await action(page, 'Subir').click();
    await until(page, (a) => window.__app.store.get('templates', a[0]).order < window.__app.store.get('templates', a[1]).order, [copy.id, id]);
    await page.waitForFunction((a) => {
      const els = [...document.querySelectorAll('.lib-tpl')].map((e) => e.dataset.id);
      return els.indexOf(a[0]) < els.indexOf(a[1]);
    }, [copy.id, id]);
    order = await page.locator('.lib-tpl').evaluateAll((els) => els.map((e) => e.dataset.id));
    assert.deepStrictEqual(order.slice(-2), [copy.id, id]);

    // --- borrar (está en la semana tipo) y deshacer ---
    await page.locator('button[aria-label="Opciones de Día 1 — Upper pesado"]').click();
    await action(page, 'Borrar').click();
    const dlg = page.locator('.sheet-panel', { hasText: '¿Borrar «Día 1 — Upper pesado»?' });
    await dlg.waitFor();
    assert.match(await dlg.innerText(), /semana tipo \(lunes\)[\s\S]*Plantilla eliminada/);
    await dlg.locator('button', { hasText: 'Borrar rutina' }).click();
    await until(page, () => !window.__app.store.get('templates', 'tpl_d1'));
    await page.waitForFunction(() => !document.querySelector('.lib-tpl[data-id="tpl_d1"]'));
    assert.strictEqual((await idbAll(page, 'templates')).some((x) => x.id === 'tpl_d1'), false, 'borrada en disco');
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await until(page, () => !!window.__app.store.get('templates', 'tpl_d1'));
    await page.waitForSelector('.lib-tpl[data-id="tpl_d1"]');
    assert.strictEqual((await getTpl(page, 'tpl_d1')).items.length, 7);

    // --- borrar la copia desde el editor (sin deshacer) ---
    await go(page, `#/template/${copy.id}`);
    await page.locator('button[aria-label="Opciones de la rutina"]').click();
    await action(page, 'Borrar rutina').click();
    const dlg2 = page.locator('.sheet-panel', { hasText: '¿Borrar' });
    await dlg2.locator('button', { hasText: 'Borrar rutina' }).click();
    await until(page, (i) => !window.__app.store.get('templates', i), copy.id);
    await page.waitForFunction(() => location.hash.startsWith('#/exercises'));

    // --- empezar ahora y, con sesión en curso, ofrecer continuarla ---
    await go(page, '#/exercises?seg=templates');
    await page.locator('button[aria-label="Opciones de Mi rutina test"]').click();
    await action(page, 'Empezar ahora').click();
    await page.waitForFunction(() => location.hash.startsWith('#/session/'));
    const active = await page.evaluate(() => window.__app.store.activeSession());
    assert.strictEqual(active.templateId, id);
    assert.deepStrictEqual(active.exercises.map((x) => x.exerciseId), ['face_pull', 'remo_barra']);
    await go(page, '#/exercises?seg=templates');
    await page.locator('button[aria-label="Opciones de Día 1 — Upper pesado"]').click();
    await action(page, 'Empezar ahora').click();
    const dlg3 = page.locator('.sheet-panel', { hasText: 'Ya hay una sesión en curso' });
    await dlg3.waitFor();
    await dlg3.locator('button', { hasText: 'Continuar la sesión en curso' }).click();
    await page.waitForFunction((sid) => location.hash === `#/session/${sid}`, active.id);
    assert.strictEqual((await storeAll(page, 'sessions')).filter((s) => s.status === 'active').length, 1);

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('rutina nueva sin tocar se descarta al salir; el editor muestra secciones y objetivos', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/exercises?seg=templates');
    const before = (await storeAll(page, 'templates')).length;
    await page.locator('.lib-add', { hasText: 'Nueva rutina' }).click();
    await page.waitForSelector('.lib-editor');
    await page.locator('.back-btn').click();
    await page.waitForFunction(() => location.hash.startsWith('#/exercises'));
    await until(page, (n) => window.__app.store.all('templates').length === n, before);

    // Día 2: secciones y objetivos tal y como se verán
    await go(page, '#/template/tpl_d2');
    await page.waitForSelector('.lib-item');
    assert.deepStrictEqual(await page.locator('.lib-section').allInnerTexts(), ['BLOQUE POTENCIA', 'BLOQUE FUERZA']);
    const targets = await page.locator('.lib-item-target').allInnerTexts();
    assert.deepStrictEqual(targets.slice(0, 3), ['3×3', '2×15–20', '3×4–6']);
    // Día 3: cardio en minutos (guardado en segundos)
    await go(page, '#/template/tpl_d3');
    await page.waitForSelector('.lib-item');
    assert.deepStrictEqual(await page.locator('.lib-item-target').allInnerTexts(), ['30–45 min', '45–75 min', '3 series']);
    await page.locator('.lib-item-head').first().click();
    await stepBtn(page, 'Duración máx. (min)', 1).click();
    const d3 = await getTpl(page, 'tpl_d3');
    assert.strictEqual(d3.items[0].timeMax, 50 * 60);
    assert.strictEqual(await page.locator('.lib-item.open .lib-item-target').innerText(), '30–50 min');
    await shot(page, 'library-template-cardio');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('biblioteca: buscar sin tildes, crear ejercicio propio, editar músculos, ficha con historial, archivar un ejercicio usado', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // --- buscar ---
    await go(page, '#/exercises?seg=library');
    await page.waitForSelector('.lib-ex-row');
    const search = page.locator('input[aria-label="Buscar ejercicio"]');
    await search.fill('remo');
    const remo = await page.locator('.lib-ex-row .lib-ex-name > span:first-child').allInnerTexts();
    assert.ok(remo.length >= 7, remo.join(', '));
    assert.ok(remo.slice(0, 7).every((n) => /^Remo/.test(n)), remo.join(', '));
    assert.ok(remo.includes('Remo unilateral con mancuerna'));
    await search.fill('bulgara');
    assert.deepStrictEqual(await page.locator('.lib-ex-row .lib-ex-name > span:first-child').allInnerTexts(), ['Sentadilla búlgara']);
    assert.match(await page.locator('.lib-ex-row').first().innerText(), /Cuádriceps, Glúteos[\s\S]*Unilateral de pierna · Unilateral/);
    await search.fill('');
    // filtro por músculo y patrón
    await page.locator('.lib-chips[aria-label="Filtrar por patrón"] .chip', { hasText: 'Tirón vertical' }).click();
    const pullV = await page.locator('.lib-ex-row .lib-ex-name > span:first-child').allInnerTexts();
    assert.ok(pullV.includes('Dominadas') && pullV.includes('Jalón al pecho') && !pullV.includes('Remo con barra'), pullV.join(', '));
    await page.locator('.lib-chips[aria-label="Filtrar por músculo"] .chip', { hasText: 'Bíceps' }).click();
    const pullB = await page.locator('.lib-ex-row .lib-ex-name > span:first-child').allInnerTexts();
    assert.ok(pullB.includes('Dominadas supinas') && pullB.length <= pullV.length);
    await page.locator('.lib-chips[aria-label="Filtrar por músculo"] .chip', { hasText: 'Todos' }).click();
    await page.locator('.lib-chips[aria-label="Filtrar por patrón"] .chip', { hasText: 'Todos' }).click();
    await shot(page, 'library-list');

    // la pestaña recuerda el segmento
    await go(page, '#/exercises');
    assert.strictEqual(await page.locator('.lib-seg .seg-btn.active').innerText(), 'Biblioteca');
    await page.locator('.lib-seg .seg-btn', { hasText: 'Rutinas' }).click();
    assert.strictEqual(await currentHash(page), '#/exercises?seg=templates');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.exercises.seg')), 'templates');
    // replaceUrl: la ruta actual del router también cambia (sin volver a montar la vista)
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('lastRoute')), '/exercises?seg=templates');
    assert.strictEqual(await page.locator('.lib-seg').count(), 1);
    await page.locator('.lib-seg .seg-btn', { hasText: 'Biblioteca' }).click();

    // --- crear ejercicio propio ---
    await page.locator('.lib-add', { hasText: 'Nuevo ejercicio' }).click();
    await page.waitForSelector('.lib-form');
    const name = page.locator('input[aria-label="Nombre del ejercicio"]');
    await name.fill('press BANCA');
    await page.locator('.lib-create').click();
    assert.match(await page.locator('.form-error').innerText(), /Ya existe un ejercicio con ese nombre/);
    assert.strictEqual(await currentHash(page), '#/exercise/new');
    await name.fill('Remo Kroc');
    await page.locator('input[aria-label="Alias"]').fill('kroc row, remo pesado');
    await page.locator('.lib-type-chips .chip', { hasText: 'Unilateral (por lado)' }).click();
    await page.locator('[data-group="primary"] .chip', { hasText: 'Espalda' }).click();
    await page.locator('[data-group="secondary"] .chip', { hasText: 'Bíceps' }).click();
    await page.locator('.lib-pattern-chips .chip', { hasText: 'Tirón horizontal' }).click();
    await page.locator('.lib-form .seg-btn', { hasText: 'Compuesto' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await shot(page, 'library-exercise-new');
    await page.locator('.lib-create').click();
    await page.waitForFunction(() => /^#\/exercise\/ex_[^/]+$/.test(location.hash));
    const exId = (await currentHash(page)).split('/')[2];
    let ex = await getEx(page, exId);
    assert.deepStrictEqual(
      [ex.name, ex.aliases, ex.logType, ex.primary, ex.secondary, ex.pattern, ex.category, ex.custom, ex.archived],
      ['Remo Kroc', ['kroc row', 'remo pesado'], 'unilateral', ['back'], ['biceps'], 'pull_h', 'compound', true, false]);
    await page.waitForSelector('.lib-detail');
    assert.match(await page.locator('.lib-badges').innerText(), /Propio/);
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('entreno.exercise.draft')), null, 'borrador borrado');

    // --- editar músculos (guardado automático; un músculo no puede estar en ambos) ---
    await page.locator('button[aria-label="Editar ejercicio"]').click();
    await page.waitForSelector('.lib-form');
    await page.locator('[data-group="primary"] .chip', { hasText: 'Bíceps' }).click();
    ex = await getEx(page, exId);
    assert.deepStrictEqual([ex.primary, ex.secondary], [['back', 'biceps'], []]);
    assert.strictEqual(await page.locator('[data-group="secondary"] .chip.active').count(), 0);
    await page.locator('[data-group="secondary"] .chip', { hasText: 'Antebrazo' }).click();
    await page.locator('[data-group="secondary"] .chip', { hasText: 'Hombro posterior' }).click();
    // nombre repetido: aviso y no se guarda
    const ename = page.locator('input[aria-label="Nombre del ejercicio"]');
    await ename.fill('Dominadas');
    assert.match(await page.locator('.form-error').innerText(), /Ya existe/);
    await ename.fill('Remo Kroc pesado');
    await until(page, (i) => window.__app.store.exercise(i).name === 'Remo Kroc pesado', exId);
    await shot(page, 'library-exercise-edit');
    const onDisk = (await idbAll(page, 'exercises')).find((x) => x.id === exId);
    assert.deepStrictEqual([onDisk.primary, onDisk.secondary], [['back', 'biceps'], ['forearms', 'reardelt']]);

    // --- borrar el propio (no usado) con deshacer ---
    await go(page, `#/exercise/${exId}`);
    await page.locator('.lib-actions button', { hasText: 'Borrar' }).click();
    const del = page.locator('.sheet-panel', { hasText: '¿Borrar «Remo Kroc pesado»?' });
    await del.locator('button', { hasText: 'Borrar ejercicio' }).click();
    await until(page, (i) => !window.__app.store.exercise(i), exId);
    await page.waitForFunction(() => location.hash.startsWith('#/exercises'));
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await until(page, (i) => !!window.__app.store.exercise(i), exId);
    await page.locator('input[aria-label="Buscar ejercicio"]').fill('kroc');
    await page.waitForSelector(`.lib-ex-row[data-id="${exId}"]`);

    // --- ficha con historial ---
    const sid = await page.evaluate(async () => {
      const u = await import('./js/util.js');
      const { store } = window.__app;
      const date = u.addDays(u.todayStr(), -3);
      const set = (type, weight, reps, rir) => ({ id: u.uid('set_'), type, weight, reps, repsR: null, rir, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: Date.now() });
      const s = {
        id: 'hist_lib', kind: 'strength', date, planDate: date, templateId: 'tpl_d1', templateName: 'Día 1 — Upper pesado', status: 'done',
        startedAt: u.tsFromDate(date, 18), endedAt: u.tsFromDate(date, 19), durationMin: 60, rpe: 8, notes: '', parentId: null, cursor: 0,
        exercises: [{ id: 'se_h1', exerciseId: 'press_banca', exName: 'Press banca', templateItemId: 'ti_d1_1', baseExerciseId: 'press_banca', alternatives: [], target: { sets: 3 }, notes: '', note: '', section: '', groupId: null, groupType: null,
          sets: [set('warmup', 40, 8, null), set('effective', 80, 6, 2), set('effective', 80, 5, 1)] }],
      };
      await store.save('sessions', s);
      return s.id;
    });
    await go(page, '#/exercise/press_banca');
    await page.waitForSelector('.lib-hist-row');
    const hrow = page.locator('.lib-hist-row');
    assert.strictEqual(await hrow.count(), 1);
    const htxt = await hrow.innerText();
    assert.match(htxt, /Día 1 — Upper pesado[\s\S]*80×6 · 80×5[\s\S]*101,3 kg[\s\S]*1RM est\./i);
    assert.ok(!htxt.includes('40×8'), 'sin calentamientos');
    assert.match(await page.locator('.lib-e1rm-note').innerText(), /estimación/);
    assert.match(await page.locator('.lib-count-rule').innerText(), /1 serie efectiva = 1 para cada principal y 0,5 para cada secundario/);
    assert.match(await page.locator('.lib-muscles').innerText(), /Pecho[\s\S]*Tríceps[\s\S]*Hombro anterior/);
    await shot(page, 'library-detail');
    await hrow.click();
    await page.waitForFunction((i) => location.hash === `#/session/${i}`, sid);

    // --- cambiar el tipo de registro con historial: avisa (y se puede cancelar) ---
    await go(page, '#/exercise/press_banca/edit');
    await page.locator('.lib-type-chips .chip', { hasText: 'Por tiempo' }).click();
    const warn = page.locator('.sheet-panel', { hasText: '¿Cambiar el tipo de registro?' });
    await warn.waitFor();
    assert.match(await warn.innerText(), /1 sesión registrada/);
    await warn.locator('button', { hasText: 'Cancelar' }).click();
    await warn.waitFor({ state: 'detached' });
    assert.strictEqual((await getEx(page, 'press_banca')).logType, 'weight_reps');
    assert.strictEqual(await page.locator('.lib-type-chips .chip.active').innerText(), 'Peso × repeticiones');

    // --- archivar un ejercicio usado (no se puede borrar) ---
    await go(page, '#/exercise/press_banca');
    await page.locator('.lib-actions button', { hasText: 'Borrar' }).click();
    const cant = page.locator('.sheet-panel', { hasText: 'No se puede borrar' });
    await cant.waitFor();
    assert.match(await cant.innerText(), /1 sesión y la rutina «Día 1 — Upper pesado»[\s\S]*Archívalo/);
    await cant.locator('button', { hasText: 'Archivar' }).click();
    await until(page, () => window.__app.store.exercise('press_banca').archived === true);
    assert.ok(await page.locator('.lib-badges .badge', { hasText: 'Archivado' }).isVisible());
    assert.strictEqual(await page.locator('.lib-actions .btn-secondary').innerText(), 'Desarchivar');
    assert.ok(!!(await getEx(page, 'press_banca')), 'no se ha borrado');
    // oculto en la biblioteca salvo con «Ver archivados»
    await go(page, '#/exercises?seg=library');
    await page.locator('input[aria-label="Buscar ejercicio"]').fill('press banca');
    assert.strictEqual(await page.locator('.lib-ex-row[data-id="press_banca"]').count(), 0);
    await page.locator('.lib-switch-row').click();
    await page.waitForSelector('.lib-ex-row[data-id="press_banca"]');
    assert.match(await page.locator('.lib-ex-row[data-id="press_banca"]').innerText(), /Archivado/);
    // y en disco
    assert.strictEqual((await idbAll(page, 'exercises')).find((x) => x.id === 'press_banca').archived, true);
    // desarchivar
    await page.locator('.lib-ex-row[data-id="press_banca"]').click();
    await page.locator('.lib-actions .btn-secondary', { hasText: 'Desarchivar' }).click();
    await until(page, () => window.__app.store.exercise('press_banca').archived === false);

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
