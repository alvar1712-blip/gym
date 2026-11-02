// Fase 7: sesión activa rediseñada. Serie abierta protagonista con regla, RIR visible, avance automático al registrar,
// menú de la serie (tipo, nota, quitar) en vez de controles fijos, «Hoy / Usar», historial en la sesión, hoja de discos,
// paso de la regla por ejercicio y resumen final. Nada de esto cambia el formato de los datos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/fase7.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, settle, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

/** Historial de la rutina D1 (hace 7 días): peso 80, reps 8/7/7 (por encima del tope del objetivo 3×4–6 → «sube»). */
async function seedHistory(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -7), past: true });
    for (const se of s.exercises) {
      const lt = store.exercise(se.exerciseId).logType;
      se.sets.forEach((x, i) => Object.assign(x, { weight: lt === 'bodyweight' ? 5 : 80, reps: 8 - (i ? 1 : 0), rir: 1, done: true, doneAt: 1 }));
    }
    m.finishSession(s, { durationMin: 60, rpe: 7 });
    await store.save('sessions', s);
  });
}
const newSession = (page, opts) => page.evaluate(async (o) => (await (await import('./js/session-logic.js')).createStrengthSession(o)).id, opts);
const sess = (page, id) => page.evaluate((sid) => JSON.parse(JSON.stringify(window.__app.store.get('sessions', sid))), id);
const first = (page) => page.locator('.ses-card').first();

async function run(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    if (browser === 'chromium') await page.setViewportSize({ width: 390, height: 844 }); // WebKit: con otro tamaño las hojas quedan fuera del viewport de diseño (entorno)
    await seedHistory(page);
    const id = await newSession(page, { templateId: 'tpl_d1' });
    await go(page, `#/session/${id}`);
    await page.waitForSelector('.ses-editor');
    const card = first(page);

    // 1. Superficie limpia: sin tipo de serie, nota ni quitar a la vista; el RIR, sí
    for (const sel of ['.ses-type', '.ses-note-btn', '.ses-del-set', '.ses-note-input']) assert.strictEqual(await card.locator(sel).count(), 0, `${sel} fuera de la superficie principal`);
    assert.strictEqual(await card.locator('.ses-editor .ses-rir .chip').count(), 7, 'RIR: Fallo, 0–5');
    assert.strictEqual(await card.locator('.ses-editor .ruler').count(), 2, 'regla de peso y de repeticiones');

    // 2. «Hoy»: misma decisión que «Siguiente paso» (sube a 82,5) y «Usar» la pasa a la serie abierta sin registrar
    const today = card.locator('.ses-today');
    assert.match(await today.innerText(), /82,5 kg × 4/);
    assert.match(await card.locator('.ses-next').first().innerText(), /82,5/);
    await today.locator('.ses-today-use').click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0].weight === 82.5, id);
    let s = await sess(page, id);
    assert.deepStrictEqual([s.exercises[0].sets[0].weight, s.exercises[0].sets[0].reps, s.exercises[0].sets[0].done], [82.5, 4, false]);
    assert.strictEqual(await card.locator('.ses-today-use').count(), 0, 'ya aplicado: sin botón');

    // 3. Historial dentro de la sesión: hoja ligera, se cierra sin tocar nada
    await card.locator('.ses-hist-btn').click();
    const sheet = page.locator('.sheet-panel');
    await sheet.waitFor();
    assert.match(await sheet.innerText(), /Historial · Press banca/);
    assert.ok((await sheet.locator('.ses-hist-row').count()) >= 1);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });
    assert.deepStrictEqual((await sess(page, id)).exercises[0].sets.map((x) => x.done), [false, false, false]);

    // 4. Discos: por lado y con otra barra (80 kg → 25 + 5; barra de 15 kg → 25 + 5 + 2,5 si cargamos 80)
    await card.locator('.ses-editor [data-field="weight"]').fill('80');
    await card.locator('.ses-editor [data-field="weight"]').blur();
    await card.locator('.ses-plates').click();
    await sheet.waitFor();
    assert.match(await sheet.innerText(), /Por lado: 25 \+ 5 kg/);
    await sheet.getByRole('button', { name: 'Barra 15 kg' }).click();
    assert.match(await sheet.innerText(), /Por lado: 25 \+ 5 \+ 2,5 kg/);
    await page.keyboard.press('Escape');
    await sheet.waitFor({ state: 'detached' });

    // 5. Menú de la serie: tipo (Drop set y Al fallo siguen existiendo), nota y quitar
    await card.locator('.ses-set-more').click();
    await page.locator('.action-item', { hasText: 'Drop set' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0].type === 'drop', id);
    assert.ok(await card.locator('.ses-editor-type', { hasText: 'Drop' }).isVisible(), 'el tipo no estándar se ve en la cabecera');
    await card.locator('.ses-set-more').click();
    await page.locator('.action-item', { hasText: 'Al fallo' }).click();
    await page.waitForFunction((sid) => { const x = window.__app.store.get('sessions', sid).exercises[0].sets[0]; return x.type === 'failure' && x.rir === 'F'; }, id);
    await card.locator('.ses-set-more').click();
    await page.locator('.action-item', { hasText: 'Serie efectiva' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0].type === 'effective', id);
    await card.locator('.ses-set-more').click();
    await page.locator('.action-item', { hasText: 'Añadir nota' }).click();
    await page.locator('.sheet-panel input.input').fill('banco a 30°');
    await page.getByRole('button', { name: 'Guardar nota' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0].note === 'banco a 30°', id);
    assert.ok(await card.locator('.ses-editor-note').isVisible());

    // 7. Avance automático: registrar la 1 pliega la fila y abre la 2 con los valores preparados; nada se registra solo
    await card.locator('.ses-editor [data-field="reps"]').fill('6');
    await card.locator('.ses-editor [data-field="reps"]').blur();
    await card.locator('.ses-editor .ses-register').click();
    await settle(page);
    await card.locator('.ses-editor[data-set]').waitFor();
    s = await sess(page, id);
    assert.deepStrictEqual(s.exercises[0].sets.map((x) => x.done), [true, false, false], 'solo la registrada');
    assert.strictEqual(await card.locator('.ses-row[data-state="done"]').count(), 1);
    assert.match(await card.locator('.ses-editor .ses-editor-num').innerText(), /serie 2/i);
    assert.strictEqual(await card.locator('.ses-editor [data-field="weight"]').inputValue(), '80', 'la siguiente hereda el peso');
    assert.strictEqual(await card.locator('.ses-today-use').count(), 1, 'la propuesta sigue disponible para la siguiente');

    // 8. Quitar una serie desde el menú, con deshacer
    await card.locator('.ses-set-more').click();
    await page.locator('.action-item', { hasText: 'Quitar serie' }).click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.length === 2, id);
    await page.locator('.toast-undo .toast-action').click();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.length === 3, id);

    // 9. Paso de la regla: aislamiento 1 kg, compuestos 2,5 kg
    const iso = await page.evaluate(async () => {
      const { store } = window.__app;
      const sl = await import('./js/session-logic.js');
      const ex = store.all('exercises').find((e) => e.logType === 'weight_reps' && e.category === 'isolation' && !e.archived);
      const s2 = await sl.createStrengthSession({});
      const se = sl.newSessionExercise(ex.id, s2);
      se.sets = [{ ...sl.newSet(null, se, 'weight_reps'), weight: 12, reps: 10, done: false }];
      s2.exercises = [se];
      await store.save('sessions', s2);
      return s2.id;
    });
    await go(page, `#/session/${iso}`);
    await page.waitForSelector('.ses-editor');
    assert.ok(await page.locator('.ses-editor .stepper-btn[aria-label^="Sumar 1 a"]').count() >= 1, 'aislamiento: paso de 1 kg');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

async function runSummary(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    const id = await newSession(page, { templateId: 'tpl_d1' });
    // Solo ejercicios de peso y repeticiones: 60 kg × 6 en cada serie de trabajo → volumen conocido por ejercicio
    const done = await page.evaluate(async (sid) => {
      const m = await import('./js/session-logic.js');
      const { store } = window.__app;
      const s = store.get('sessions', sid);
      const out = [];
      for (const se of s.exercises.filter((x) => store.exercise(x.exerciseId).logType === 'weight_reps').slice(0, 3)) {
        se.sets.forEach((x) => Object.assign(x, { weight: x.type === 'warmup' ? 20 : 60, reps: 6, rir: 2, done: true, doneAt: Date.now() }));
        out.push({ name: store.exercise(se.exerciseId).name, work: se.sets.filter((x) => x.type !== 'warmup').length });
      }
      m.finishSession(s, { durationMin: 55, rpe: 7 });
      await store.save('sessions', s);
      return out;
    }, id);
    const kg = (n) => `${n >= 1000 ? `${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, '0')}` : n} kg`; // 3240 → «3.240 kg»
    const total = done.reduce((t, e) => t + e.work * 360, 0);
    await go(page, `#/session/${id}/summary`);
    await page.waitForSelector('.ses-sum-hero');
    assert.match(await page.locator('.ses-sum-done').innerText(), /Entrenamiento completado/);
    const labels = await page.locator('.ses-sum-kpis .kpi-label').allInnerTexts();
    assert.deepStrictEqual(labels.map((l) => l.trim()), ['Duración', 'Series de trabajo', 'Ejercicios', 'Volumen']);
    const kpis = await page.locator('.ses-sum-kpis .kpi').allInnerTexts();
    assert.ok(kpis[1].trim().endsWith(String(done.reduce((t, e) => t + e.work, 0))), `series de trabajo sin calentamientos: ${kpis[1]}`);
    assert.ok(kpis[2].trim().endsWith(String(done.length)), `ejercicios: ${kpis[2]}`);
    assert.ok(kpis[3].replace(/s+/g, ' ').includes(kg(total)), `volumen total ${kg(total)} en ${JSON.stringify(kpis)}`);
    // Reparto: una fila por ejercicio con SU volumen (peso × repeticiones de las series de trabajo, sin calentamientos)
    const rows = await page.locator('.ses-sum-vol .ses-bar-row').evaluateAll((els) => els.map((e) => [e.querySelector('.ses-bar-label').textContent, e.querySelector('.ses-bar-val').textContent.replace(/s+/g, ' ')]));
    assert.strictEqual(rows.length, done.length);
    for (const e of done) assert.ok(rows.some(([n, v]) => n === e.name && v === kg(e.work * 360)), `${e.name}: ${kg(e.work * 360)} en ${JSON.stringify(rows)}`);
    assert.match(await page.locator('.ses-sum-vol').innerText(), /no la fuerza de cada ejercicio/);
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin desplazamiento horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('Fase 7: sesión activa (Chromium)', () => run('chromium'));
test('WebKit: Fase 7: sesión activa', { skip: skipWebkit }, () => run('webkit'));
test('Fase 7: resumen final (Chromium)', () => runSummary('chromium'));
test('WebKit: Fase 7: resumen final', { skip: skipWebkit }, () => runSummary('webkit'));
