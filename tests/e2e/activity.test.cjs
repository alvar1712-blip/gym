// E2E del módulo de actividades (carrera, bici, natación, otras) y peso corporal.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/activity.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const hash = (page) => page.evaluate(() => location.hash);
const val = (page, sel) => page.locator(sel).inputValue();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const settle = (page, ms = 450) => page.waitForTimeout(ms); // saveSoon escribe a los 250 ms
/** Espera por condición (fase H): `fn` en Node (p. ej. leer IndexedDB) hasta que da true, o hasta `ms`. */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
/** Espera a que la pantalla montada tenga ese título (cambio de ruta por condición, no por tiempo). */
const titleIs = (page, t) => page.waitForFunction((x) => document.querySelector('.topbar h1')?.textContent === x, t, { timeout: 5000 }).catch(() => {});

/** Sesión de fuerza sembrada con un ítem de cardio (como Día 3), para las actividades enlazadas. */
async function seedStrength(page, { status = 'done' } = {}) {
  await page.evaluate(async (st) => {
    await window.__app.store.save('sessions', {
      id: 's_test', kind: 'strength', date: '2026-09-22', planDate: '2026-09-23', templateId: 'tpl_d3',
      templateName: 'Día 3 — Cardio', status: st, startedAt: null, endedAt: null, durationMin: 80, rpe: 6, notes: '',
      parentId: null, templateItemId: null, cursor: 0,
      exercises: [{
        id: 'se_run', exerciseId: 'correr', exName: 'Correr', templateItemId: 'ti_d3_1', alternatives: [],
        target: { sets: 1, setsMax: null, repMin: null, repMax: null, timeMin: 1800, timeMax: 2700, distance: null },
        notes: 'Zona 2', section: '', groupId: null, groupType: null, sets: [],
      }],
    });
  }, status);
}

test('carrera: 10 km en 50:00 → ritmo 5:00 /km, carga con esfuerzo; borrador y guardado automático', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/activity/new?kind=run&date=2026-09-20');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nueva carrera');
    assert.strictEqual(await page.locator('.act-kinds').count(), 0, 'con kind en la query no hay selector de tipo');
    assert.strictEqual(await val(page, '[aria-label="Fecha"]'), '2026-09-20');

    // Antes de la duración: no se crea la actividad, pero hay borrador.
    await page.fill('[aria-label="Distancia (km)"]', '10');
    await settle(page);
    assert.strictEqual((await storeAll(page, 'sessions')).length, 0);
    const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('draft:activity:run') || 'null'));
    assert.ok(draft && draft.form.distanceKm === 10, 'borrador en localStorage');
    assert.match(await page.locator('.act-status').innerText(), /falta la duración/i);

    // El borrador se restaura al volver, con un aviso dentro del formulario (no un toast sobre «Listo»).
    await reload(page);
    assert.strictEqual(await hash(page), '#/activity/new?kind=run&date=2026-09-20');
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '10');
    assert.match(await page.locator('.act-restored').innerText(), /Borrador recuperado[\s\S]*Guardado hoy a las \d\d:\d\d/);
    assert.strictEqual(await page.locator('.toast').count(), 0);
    await shot(page, 'activity-draft-restored');

    // Con la duración ya es válida: se crea y la URL pasa a #/activity/:id sin perder el foco.
    const minInput = page.locator('[aria-label="Tiempo en movimiento: min"]');
    await minInput.fill('50');
    assert.strictEqual(await page.locator('.act-live-value').first().innerText(), '5:00 /km');
    let sessions = await storeAll(page, 'sessions');
    assert.strictEqual(sessions.length, 1);
    const id = sessions[0].id;
    assert.strictEqual(await hash(page), `#/activity/${id}`);
    assert.ok(await minInput.evaluate((el) => el === document.activeElement), 'el foco sigue en el campo');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('draft:activity:run')), null);
    assert.match(await page.locator('.act-status').innerText(), /Guardado/);
    // La URL cambia con router.replaceUrl: la ruta actual del router también es la nueva.
    assert.strictEqual(await page.evaluate(async () => (await import('./js/router.js')).currentRoute().path), `/activity/${id}`);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Carrera');
    assert.strictEqual(await page.locator('.act-restored').count(), 0, 'el aviso de borrador se quita al crear');

    // Carga: sin esfuerzo no hay carga; con esfuerzo 7 → 50 × 7 = 350.
    assert.strictEqual(await page.locator('.act-load').innerText(), '—');
    assert.match(await page.locator('.act-live').innerText(), /Sin esfuerzo percibido no hay carga/);
    await page.locator('.rpe-chips .chip').nth(6).click();
    assert.strictEqual(await page.locator('.act-load').innerText(), '350');
    assert.match(await page.locator('.act-live').innerText(), /50 min × esfuerzo 7/);
    // Con segundos, la explicación no redondea los minutos: 50:20 × 7 = 352,3 → 352 (no «50 min × 7»).
    const secInput = page.locator('[aria-label="Tiempo en movimiento: s"]');
    await secInput.fill('20');
    assert.strictEqual(await page.locator('.act-load').innerText(), '352');
    assert.match(await page.locator('.act-live').innerText(), /50 min 20 s × esfuerzo 7/);
    await secInput.fill('');
    assert.strictEqual(await page.locator('.act-load').innerText(), '350');

    // Opcionales
    await page.getByRole('button', { name: 'Tempo', exact: true }).click();
    await page.fill('[aria-label="Tiempo total: min"]', '52');
    await page.fill('[aria-label="Desnivel (m)"]', '85');
    await page.fill('[aria-label="FC media (lpm)"]', '152');
    await page.fill('[aria-label="FC máxima (lpm)"]', '171');
    await page.fill('[aria-label="Cadencia (ppm)"]', '174');
    await page.fill('[aria-label="Zona o sensaciones"]', 'Z3 controlada');
    await page.fill('[aria-label="Notas"]', 'Buen día');
    await shot(page, 'activity-run');
    assert.ok(await noHScroll(page), 'sin scroll horizontal');
    await page.evaluate(() => { document.activeElement.blur(); window.scrollTo(0, 0); });
    await page.waitForTimeout(100);
    await shot(page, 'activity-run-top');
    await settle(page);

    const [rec] = await idbAll(page, 'sessions');
    assert.strictEqual(rec.kind, 'run');
    assert.strictEqual(rec.status, 'done');
    assert.strictEqual(rec.date, '2026-09-20');
    assert.strictEqual(rec.planDate, '2026-09-20');
    assert.strictEqual(rec.distanceKm, 10);
    assert.strictEqual(rec.movingSec, 3000);
    assert.strictEqual(rec.durationMin, 50);
    assert.strictEqual(rec.elapsedSec, 3120);
    assert.strictEqual(rec.rpe, 7);
    assert.strictEqual(rec.subtype, 'tempo');
    assert.strictEqual(rec.elevationM, 85);
    assert.strictEqual(rec.hrAvg, 152);
    assert.strictEqual(rec.hrMax, 171);
    assert.strictEqual(rec.cadence, 174);
    assert.strictEqual(rec.feel, 'Z3 controlada');
    assert.strictEqual(rec.notes, 'Buen día');
    assert.strictEqual(rec.parentId, null);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    await shot(page, 'activity-run-bottom');

    // Recargar (cerrar y abrir la app) y editar.
    await reload(page);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Carrera');
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '10');
    assert.strictEqual(await val(page, '[aria-label="Tiempo en movimiento: min"]'), '50');
    assert.strictEqual(await page.locator('.rpe-chips .chip.active').innerText(), '7');
    await page.fill('[aria-label="Distancia (km)"]', '12,5');
    assert.strictEqual(await page.locator('.act-live-value').first().innerText(), '4:00 /km');
    await settle(page);
    assert.strictEqual((await idbAll(page, 'sessions'))[0].distanceKm, 12.5);

    // «Listo» vuelve atrás (sin historial interno → Hoy).
    await page.locator('.act-done').click();
    await page.waitForTimeout(200);
    assert.strictEqual(await hash(page), '#/today');

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('bici con velocidad media y natación con ritmo /100 m', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // Bici: 31,5 km en 1:10:00 → 27 km/h
    await go(page, '#/activity/new?kind=bike&date=2026-09-21');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nueva salida en bici');
    await page.fill('[aria-label="Distancia (km)"]', '31,5');
    await page.fill('[aria-label="Tiempo: h"]', '1');
    await page.fill('[aria-label="Tiempo: min"]', '10');
    assert.strictEqual(await page.locator('.act-live-value').first().innerText(), '27 km/h');
    await page.getByRole('button', { name: 'Ruta', exact: true }).click();
    await page.locator('.rpe-chips .chip').nth(4).click();
    assert.strictEqual(await page.locator('.act-load').innerText(), '350');
    await page.fill('[aria-label="Potencia media (W)"]', '185');
    await page.fill('[aria-label="Potencia normalizada (W)"]', '201');
    await page.fill('[aria-label="Cadencia (rpm)"]', '88');
    await shot(page, 'activity-bike');
    assert.ok(await noHScroll(page));
    await settle(page);
    let bike = (await idbAll(page, 'sessions')).find((s) => s.kind === 'bike');
    assert.strictEqual(bike.distanceKm, 31.5);
    assert.strictEqual(bike.movingSec, 4200);
    assert.strictEqual(bike.durationMin, 70);
    assert.strictEqual(bike.subtype, 'route');
    assert.strictEqual(bike.powerAvg, 185);
    assert.strictEqual(bike.powerNp, 201);
    assert.strictEqual(bike.cadence, 88);
    assert.strictEqual(bike.rpe, 5);
    assert.strictEqual(bike.templateName, 'Bici · Ruta');

    // Natación: 1500 m en 30:00 → 2:00 /100 m
    await go(page, '#/activity/new?kind=swim&date=2026-09-22');
    await page.fill('[aria-label="Distancia (m)"]', '1500');
    await page.fill('[aria-label="Tiempo: min"]', '30');
    assert.strictEqual(await page.locator('.act-live-value').first().innerText(), '2:00 /100 m');
    // La unidad va aparte (más pequeña) y no se corta.
    assert.strictEqual((await page.locator('.act-live-value .act-live-unit').first().innerText()).trim(), '/100 m');
    assert.ok(await page.locator('.act-live-value').first().evaluate((el) => el.scrollWidth <= el.clientWidth), 'ritmo /100 m sin cortar');
    await page.getByRole('button', { name: 'Piscina', exact: true }).click();
    await page.getByRole('button', { name: '25 m', exact: true }).click();
    await page.getByRole('button', { name: 'Crol', exact: true }).click();
    await page.locator('.rpe-chips .chip').nth(5).click();
    assert.strictEqual(await page.locator('.act-load').innerText(), '180');
    await shot(page, 'activity-swim');
    assert.ok(await noHScroll(page));
    await settle(page);
    const swim = (await idbAll(page, 'sessions')).find((s) => s.kind === 'swim');
    assert.strictEqual(swim.distanceKm, 1.5);
    assert.strictEqual(swim.movingSec, 1800);
    assert.strictEqual(swim.poolType, 'pool');
    assert.strictEqual(swim.poolLengthM, 25);
    assert.strictEqual(swim.stroke, 'free');
    assert.strictEqual(swim.elapsedSec, null);
    // Aguas abiertas oculta y vacía la longitud.
    await page.getByRole('button', { name: 'Aguas abiertas', exact: true }).click();
    assert.strictEqual(await page.getByRole('button', { name: '25 m', exact: true }).isVisible(), false);
    const swim2 = (await storeAll(page, 'sessions')).find((s) => s.kind === 'swim');
    assert.strictEqual(swim2.poolType, 'open');
    assert.strictEqual(swim2.poolLengthM, null);

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('otra actividad con selector de tipo y tipo libre; borrar con confirmación y deshacer', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/activity/new');
    await shot(page, 'activity-new-top');
    const seg = page.locator('.act-kinds .seg-btn');
    assert.deepStrictEqual(await seg.allInnerTexts(), ['Carrera', 'Bici', 'Natación', 'Senderismo', 'Otra']);
    await seg.nth(4).click();
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nueva actividad');
    assert.strictEqual(await page.locator('[aria-label="Distancia (km)"]').count(), 0);
    await page.getByRole('button', { name: 'Otro…', exact: true }).click();
    await page.fill('[aria-label="Otro tipo de actividad"]', 'Pádel');
    await page.fill('[aria-label="Duración: h"]', '1');
    await page.locator('.rpe-chips .chip').nth(5).click();
    assert.strictEqual(await page.locator('.act-load').innerText(), '360');
    await page.fill('[aria-label="Notas"]', 'Partido con amigos');
    await shot(page, 'activity-other');
    assert.ok(await noHScroll(page));
    await settle(page);
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    let [rec] = await idbAll(page, 'sessions');
    assert.strictEqual(rec.kind, 'other');
    assert.strictEqual(rec.subtype, 'Pádel');
    assert.strictEqual(rec.templateName, 'Pádel');
    assert.strictEqual(rec.durationMin, 60);
    assert.strictEqual(rec.rpe, 6);
    assert.strictEqual(rec.date, today);
    assert.strictEqual(rec.distanceKm, null);

    // Editar tras recargar: el tipo libre se conserva.
    await reload(page);
    assert.strictEqual(await val(page, '[aria-label="Otro tipo de actividad"]'), 'Pádel');
    assert.ok(await page.getByRole('button', { name: 'Otro…', exact: true }).evaluate((b) => b.classList.contains('active')));
    await page.getByRole('button', { name: 'Baloncesto', exact: true }).click();
    assert.strictEqual((await storeAll(page, 'sessions'))[0].subtype, 'basketball');

    // Borrar: confirmación → vuelve atrás → deshacer lo restaura.
    await go(page, '#/today');
    await go(page, `#/activity/${rec.id}`);
    await page.getByRole('button', { name: 'Borrar actividad' }).first().click();
    await page.locator('.sheet-panel .btn-danger').click();
    await page.waitForTimeout(300);
    assert.strictEqual(await hash(page), '#/today');
    assert.strictEqual((await storeAll(page, 'sessions')).length, 0);
    assert.strictEqual((await idbAll(page, 'sessions')).length, 0);
    assert.match(await page.locator('.toast').innerText(), /Actividad borrada/);
    await page.locator('.toast-action').click();
    await page.waitForTimeout(300);
    assert.strictEqual((await storeAll(page, 'sessions')).length, 1);
    [rec] = await idbAll(page, 'sessions');
    assert.strictEqual(rec.subtype, 'basketball');

    // Cancelar la confirmación no borra nada.
    await go(page, `#/activity/${rec.id}`);
    await page.getByRole('button', { name: 'Borrar actividad' }).first().click();
    await page.locator('.sheet-panel .btn-secondary').click();
    await page.waitForTimeout(250);
    assert.strictEqual((await storeAll(page, 'sessions')).length, 1);

    // Descartar un borrador sin guardar (con deshacer)
    await go(page, '#/activity/new?kind=run');
    await page.fill('[aria-label="Distancia (km)"]', '5');
    await page.locator('.act-discard').click();
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('draft:activity:run')), null);
    assert.match(await page.locator('.toast').innerText(), /Borrador descartado/);
    await page.locator('.toast-action').click();
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '5');
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('draft:activity:run')).form.distanceKm), 5);

    // Descartar desde el aviso de borrador recuperado
    await go(page, '#/today');
    await go(page, '#/activity/new?kind=run');
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '5');
    await page.locator('.act-restored-discard').click();
    assert.strictEqual(await page.locator('.act-restored').count(), 0);
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('draft:activity:run')), null);

    // Vaciar lo escrito y salir no deja un borrador viejo que se recupere después.
    await page.fill('[aria-label="Distancia (km)"]', '7');
    await settle(page);
    await page.fill('[aria-label="Distancia (km)"]', '');
    await go(page, '#/today');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('draft:activity:run')), null);

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('actividad enlazada a una sesión de fuerza (parent + item)', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedStrength(page);
    // Abierta sin historial interno: «Listo» usa el fallback #/session/:parent.
    const linkedUrl = '#/activity/new?kind=run&date=2026-09-22&parent=s_test&item=se_run';
    await page.evaluate((u) => { location.hash = u; }, linkedUrl);
    await page.waitForTimeout(250);
    const banner = await page.locator('.act-link').innerText();
    assert.match(banner, /Día 3 — Cardio/);
    assert.match(banner, /Objetivo 30–45 min/);
    assert.strictEqual(await page.locator('[aria-label="Fecha"]').count(), 0, 'la fecha la pone la sesión');
    assert.ok(await page.getByRole('button', { name: 'Rodaje / Z2', exact: true }).evaluate((b) => b.classList.contains('active')), 'tipo prellenado de las notas');
    assert.match(await page.locator('.act-dur-hint').innerText(), /Objetivo: 30–45 min/);
    assert.strictEqual(await val(page, '[aria-label="Tiempo en movimiento: min"]'), '', 'la duración objetivo es pista, no valor');
    // Lo prellenado (tipo de sesión de las notas) no es un borrador: «Listo» sale y no queda nada guardado.
    // .trim(): WebKit añade un salto final al innerText de un bloque (Chromium no)
    assert.strictEqual((await page.locator('.act-status').innerText()).trim(), 'Se guarda al poner la duración');
    assert.strictEqual(await page.locator('.act-discard').isVisible(), false);
    await shot(page, 'activity-linked');
    await page.locator('.act-done').click();
    await page.waitForTimeout(250);
    assert.strictEqual(await hash(page), '#/session/s_test');
    assert.deepStrictEqual(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('draft:'))), []);
    await page.evaluate((u) => { location.hash = u; }, linkedUrl);
    await page.waitForTimeout(250);
    assert.strictEqual(await page.locator('.act-restored').count(), 0, 'sin «Borrador recuperado» fantasma');

    await page.fill('[aria-label="Tiempo en movimiento: min"]', '40');
    await page.fill('[aria-label="Distancia (km)"]', '7');
    await settle(page);
    const rec = (await idbAll(page, 'sessions')).find((s) => s.kind === 'run');
    assert.strictEqual(rec.parentId, 's_test');
    assert.strictEqual(rec.parentItemId, 'se_run');
    assert.strictEqual(rec.templateItemId, 'ti_d3_1');
    assert.strictEqual(rec.date, '2026-09-22');
    assert.strictEqual(rec.planDate, '2026-09-23');
    assert.strictEqual(rec.subtype, 'z2');
    assert.strictEqual(rec.movingSec, 2400);
    assert.deepStrictEqual(app.errors, []);
    // Una actividad enlazada ya guardada no ofrece cambiar de deporte.
    await reload(page);
    assert.strictEqual(await hash(page), `#/activity/${rec.id}`);
    assert.strictEqual(await page.locator('.act-link').count(), 1);
    assert.strictEqual(await page.locator('.act-kinds').count(), 0);

    await page.locator('.act-done').click();
    await page.waitForFunction(() => location.hash === '#/session/s_test', null, { timeout: 5000 }).catch(() => {});
    assert.strictEqual(await hash(page), '#/session/s_test');

    // Sin kind: se deduce del deporte del ejercicio del ítem.
    await page.evaluate(() => { location.hash = '#/activity/new?parent=s_test&item=se_run'; });
    await titleIs(page, 'Nueva carrera');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nueva carrera');

    // Una sesión de fuerza abierta como actividad redirige al registro de fuerza.
    await go(page, '#/activity/s_test');
    await page.waitForTimeout(200);
    assert.strictEqual(await hash(page), '#/session/s_test');
  } finally {
    await app.close();
  }
});

test('cambiar el tipo de una actividad guardada pide confirmación, se puede deshacer y conserva el tipo de sesión', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await page.evaluate(async () => {
      const L = await import('./js/activity-logic.js');
      const f = L.emptyForm('bike', { date: '2026-09-20' });
      Object.assign(f, { movingSec: 5400, distanceKm: 45, rpe: 6, hrAvg: 140, hrMax: 172, powerAvg: 190, powerNp: 205, elevationM: 600, cadence: 85, subtype: 'route', notes: 'Ruta' });
      await window.__app.store.save('sessions', L.buildRecord(f, null, { id: 'a_bike' }));
    });
    const original = (await idbAll(page, 'sessions'))[0];
    await go(page, '#/activity/a_bike');
    const seg = page.locator('.act-kinds .seg-btn');

    // Cancelar: no cambia nada y el selector vuelve a «Bici».
    await seg.nth(2).click();
    await page.waitForTimeout(250);
    const msg = await page.locator('.sheet-panel').innerText();
    assert.match(msg, /¿Cambiar a natación\?/);
    assert.match(msg, /tipo de sesión «Ruta»/);
    assert.match(msg, /FC media/);
    assert.match(msg, /potencia normalizada/);
    assert.doesNotMatch(msg, /distancia/, 'la distancia sí aplica a natación');
    await shot(page, 'activity-kind-confirm');
    await page.locator('.sheet-panel .btn-secondary').click();
    await page.waitForTimeout(250);
    assert.ok(await seg.nth(1).evaluate((b) => b.classList.contains('active')), 'sigue en Bici');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Bici');
    assert.deepStrictEqual(await idbAll(page, 'sessions'), [original]);

    // Confirmar: se quita lo que no aplica; «Deshacer» deja el registro exactamente como estaba.
    await seg.nth(2).click();
    await page.waitForTimeout(250);
    await page.locator('.sheet-panel .btn-danger').click();
    await page.waitForTimeout(300);
    let rec = (await idbAll(page, 'sessions'))[0];
    assert.strictEqual(rec.kind, 'swim');
    assert.strictEqual(rec.distanceKm, 45);
    assert.strictEqual(rec.hrAvg, null);
    assert.strictEqual(rec.subtype, null);
    assert.match(await page.locator('.toast').innerText(), /Tipo cambiado a natación/);
    await page.locator('.toast-action').click();
    await page.waitForTimeout(300);
    rec = (await idbAll(page, 'sessions'))[0];
    const { updatedAt: _a, ...restoredRec } = rec;
    const { updatedAt: _b, ...origRec } = original;
    assert.deepStrictEqual(restoredRec, origRec);
    assert.ok(await seg.nth(1).evaluate((b) => b.classList.contains('active')), 'el selector vuelve a Bici');
    assert.strictEqual(await val(page, '[aria-label="Potencia media (W)"]'), '190');
    assert.ok(await page.getByRole('button', { name: 'Ruta', exact: true }).evaluate((b) => b.classList.contains('active')));

    // Ir a «Otra» y volver a «Bici» en la misma pantalla recupera los datos y el tipo de sesión.
    await seg.nth(4).click();
    await page.waitForTimeout(250);
    await page.locator('.sheet-panel .btn-danger').click();
    await page.waitForTimeout(300);
    assert.strictEqual((await storeAll(page, 'sessions'))[0].kind, 'other');
    await seg.nth(1).click();
    await page.waitForTimeout(300);
    assert.strictEqual(await page.locator('.sheet-panel').count(), 0, 'volver a Bici no quita nada: sin confirmación');
    rec = (await storeAll(page, 'sessions'))[0];
    assert.strictEqual(rec.kind, 'bike');
    assert.strictEqual(rec.subtype, 'route');
    assert.strictEqual(rec.hrAvg, 140);
    assert.strictEqual(rec.powerNp, 205);

    // Una actividad sin datos específicos cambia de tipo sin preguntar.
    await page.evaluate(async () => {
      const L = await import('./js/activity-logic.js');
      const f = { ...L.emptyForm('run', { date: '2026-09-21' }), movingSec: 1800, distanceKm: 5 };
      await window.__app.store.save('sessions', L.buildRecord(f, null, { id: 'a_run' }));
    });
    await go(page, '#/activity/a_run');
    await page.locator('.act-kinds .seg-btn').nth(1).click();
    await page.waitForTimeout(250);
    assert.strictEqual(await page.locator('.sheet-panel').count(), 0);
    assert.strictEqual((await storeAll(page, 'sessions')).find((x) => x.id === 'a_run').kind, 'bike');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('el borrador se guarda al pasar a segundo plano o cerrar la app, sin esperar', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await go(page, '#/activity/new?kind=run');
    await page.fill('[aria-label="Distancia (km)"]', '8,4');
    // Ocultar enseguida (antes de los 300 ms del borrador)
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('draft:activity:run') || 'null')?.form.distanceKm), 8.4);
    await page.evaluate(() => { delete document.visibilityState; localStorage.removeItem('draft:activity:run'); });
    await page.fill('[aria-label="Distancia (km)"]', '9');
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.strictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('draft:activity:run') || 'null')?.form.distanceKm), 9);
    await reload(page);
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '9');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('peso corporal: guardar 75,4 (con coma), media móvil, tendencia, editar y borrar con deshacer', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    const today = await page.evaluate(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    await go(page, '#/bodyweight');
    assert.match(await page.locator('.bw-stats').innerText(), /Aún no hay pesajes/);
    assert.strictEqual(await val(page, '[aria-label="Peso (kg)"]'), '75', 'prellenado con el valor por defecto');
    assert.strictEqual(await page.locator('.bw-chart-slot').count(), 1);

    await page.fill('[aria-label="Peso (kg)"]', '75,4');
    await page.locator('.bw-entry .btn-primary').click();
    await settle(page, 200);
    let bw = await idbAll(page, 'bodyweight');
    assert.strictEqual(bw.length, 1);
    assert.strictEqual(bw[0].id, today);
    assert.strictEqual(bw[0].kg, 75.4);
    assert.strictEqual(await page.locator('.bw-ma').innerText(), '75,4 kg');
    assert.match(await page.locator('.bw-summary').innerText(), /Datos insuficientes/);
    assert.strictEqual(await page.locator('.bw-row').count(), 1);
    assert.match(await page.locator('.bw-hint').innerText(), /Ya hay un pesaje hoy/);

    // Mismo día otra vez: el último manda (con deshacer).
    await page.locator('.bw-entry [aria-label^="Sumar 0,1 a "]').click();
    await page.locator('.bw-entry .btn-primary').click();
    await settle(page, 200);
    assert.strictEqual((await storeAll(page, 'bodyweight'))[0].kg, 75.5);
    assert.match(await page.locator('.toast').innerText(), /antes 75,4 kg/);
    await page.locator('.toast-action').click();
    await settle(page, 200);
    assert.strictEqual((await idbAll(page, 'bodyweight'))[0].kg, 75.4);

    // 27 días anteriores con subida lineal de 0,05 kg/día → ≈ +0,35 kg/semana.
    await page.evaluate(async (t) => {
      const st = window.__app.store;
      const base = new Date(`${t}T12:00:00`);
      for (let i = 27; i >= 1; i--) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        await st.save('bodyweight', { id, kg: Math.round((75.4 - 0.05 * i) * 10) / 10 });
      }
    }, today);
    // La pantalla se repinta sola al cambiar el store: se espera a que estén las 28 filas (antes, 150 ms fijos)
    await page.waitForFunction(() => document.querySelectorAll('.bw-row').length === 28);
    const summary = await page.locator('.bw-summary').innerText();
    assert.match(summary, /\+0,3\d kg\/sem/, summary);
    assert.match(summary, /subiendo/);
    assert.strictEqual(await page.locator('.bw-row').count(), 28);
    assert.match((await page.locator('.bw-row').first().innerText()).trim(), /75,4 kg\s+(±0|[+−]0,\d)$/, 'variación respecto al anterior'); // .trim(): salto final de WebKit
    await shot(page, 'bodyweight');
    assert.ok(await noHScroll(page));
    await page.locator('.why-btn').click();
    await page.locator('.bw-summary').scrollIntoViewIfNeeded();
    await shot(page, 'bodyweight-why');

    // Editar un pesaje desde la lista (guardado inmediato).
    const second = page.locator('.bw-row').nth(1);
    const secondId = await second.getAttribute('data-id');
    const before = (await storeAll(page, 'bodyweight')).find((b) => b.id === secondId).kg;
    await second.click();
    await page.waitForTimeout(250);
    await shot(page, 'bodyweight-edit');
    await page.locator('.sheet-panel [aria-label^="Sumar 0,1 a "]').click();
    await settle(page, 200);
    const after = (await idbAll(page, 'bodyweight')).find((b) => b.id === secondId).kg;
    assert.strictEqual(after, Math.round((before + 0.1) * 10) / 10);

    // Cambiar la fecha dos veces seguidas (selector girando): se mueve al último día, sin perder el peso.
    const kgNow = (await storeAll(page, 'bodyweight')).find((b) => b.id === secondId).kg;
    const free = await page.evaluate(async (t) => { const u = await import('./js/util.js'); return [u.addDays(t, -40), u.addDays(t, -41)]; }, today);
    await page.evaluate(([d1, d2]) => {
      const i = document.querySelector('.sheet-panel input[type=date]');
      i.value = d1; i.dispatchEvent(new Event('change'));
      i.value = d2; i.dispatchEvent(new Event('change'));
    }, free);
    await settle(page, 400);
    let all = await idbAll(page, 'bodyweight');
    assert.strictEqual(all.some((b) => b.id === secondId || b.id === free[0]), false);
    assert.strictEqual(all.find((b) => b.id === free[1])?.kg, kgNow);
    assert.ok(all.every((b) => b.kg > 0), 'ningún pesaje sin kg');
    // …y vuelta a su fecha
    await page.evaluate((d) => { const i = document.querySelector('.sheet-panel input[type=date]'); i.value = d; i.dispatchEvent(new Event('change')); }, secondId);
    await settle(page, 300);
    all = await idbAll(page, 'bodyweight');
    assert.strictEqual(all.find((b) => b.id === secondId)?.kg, kgNow);
    assert.strictEqual(all.length, 28);

    // Borrar desde la hoja → deshacer (esperas por condición: la lista repintada y el disco)
    await page.locator('.sheet-panel .btn-danger-ghost').click();
    await until(async () => !(await idbAll(page, 'bodyweight')).some((b) => b.id === secondId));
    await page.waitForFunction(() => document.querySelectorAll('.bw-row').length === 27, null, { timeout: 5000 }).catch(() => {});
    assert.strictEqual((await idbAll(page, 'bodyweight')).some((b) => b.id === secondId), false);
    assert.strictEqual(await page.locator('.bw-row').count(), 27);
    await page.locator('.toast-action').click();
    await until(async () => (await idbAll(page, 'bodyweight')).some((b) => b.id === secondId));
    await page.waitForFunction(() => document.querySelectorAll('.bw-row').length === 28, null, { timeout: 5000 }).catch(() => {});
    assert.strictEqual((await idbAll(page, 'bodyweight')).some((b) => b.id === secondId), true);
    assert.strictEqual(await page.locator('.bw-row').count(), 28);

    // Tarjeta rápida (contrato para Hoy)
    await page.evaluate(async () => {
      const m = await import('./js/views/bodyweight.js');
      const el = m.bodyweightQuickEntry({ onSaved: (e) => { window.__bwSaved = e; } });
      el.id = 'bwq-test';
      document.querySelector('#view .content').prepend(el);
      window.scrollTo(0, 0);
    });
    assert.strictEqual(await val(page, '#bwq-test [aria-label="Peso de hoy (kg)"]'), '75,4');
    assert.match(await page.locator('#bwq-test .bwq-info').innerText(), /Hoy 75,4 kg · media 7 días/);
    await page.fill('#bwq-test [aria-label="Peso de hoy (kg)"]', '76,2');
    await page.locator('#bwq-test .bwq-save').click();
    await settle(page, 200);
    assert.strictEqual(await page.evaluate(() => window.__bwSaved && window.__bwSaved.kg), 76.2);
    assert.strictEqual((await idbAll(page, 'bodyweight')).find((b) => b.id === today).kg, 76.2);
    assert.match(await page.locator('#bwq-test .bwq-info').innerText(), /Hoy 76,2 kg/);
    // Sustituye el pesaje de hoy (75,4 → 76,2): lo dice y se puede deshacer.
    assert.match(await page.locator('.toast').innerText(), /Peso guardado: 76,2 kg \(antes 75,4 kg\)/);
    await shot(page, 'bodyweight-quick');
    await page.locator('.toast-action').click();
    await settle(page, 200);
    assert.strictEqual((await idbAll(page, 'bodyweight')).find((b) => b.id === today).kg, 75.4);
    assert.strictEqual(await val(page, '#bwq-test [aria-label="Peso de hoy (kg)"]'), '75,4');
    assert.match(await page.locator('#bwq-test .bwq-info').innerText(), /Hoy 75,4 kg/);
    // Guardar el mismo valor no sustituye nada: sin deshacer.
    await page.locator('#bwq-test .bwq-save').click();
    await settle(page, 200);
    assert.strictEqual(await page.locator('.toast-action').count(), 0);

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
