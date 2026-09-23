// E2E del módulo de actividades (carrera, bici, natación, otras) y peso corporal.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/activity.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const hash = (page) => page.evaluate(() => location.hash);
const val = (page, sel) => page.locator(sel).inputValue();
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const settle = (page, ms = 450) => page.waitForTimeout(ms); // saveSoon escribe a los 250 ms

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

    // El borrador se restaura al volver.
    await reload(page);
    assert.strictEqual(await hash(page), '#/activity/new?kind=run&date=2026-09-20');
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '10');
    assert.match(await page.locator('.toast').innerText(), /Borrador recuperado/);

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

    // Carga: sin esfuerzo no hay carga; con esfuerzo 7 → 50 × 7 = 350.
    assert.strictEqual(await page.locator('.act-load').innerText(), '—');
    assert.match(await page.locator('.act-live').innerText(), /Sin esfuerzo percibido no hay carga/);
    await page.locator('.rpe-chips .chip').nth(6).click();
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
    assert.deepStrictEqual(await seg.allInnerTexts(), ['Carrera', 'Bici', 'Natación', 'Otra']);
    await seg.nth(3).click();
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

    // Descartar un borrador sin guardar
    await go(page, '#/activity/new?kind=run');
    await page.fill('[aria-label="Distancia (km)"]', '5');
    await page.locator('.act-discard').click();
    assert.strictEqual(await val(page, '[aria-label="Distancia (km)"]'), '');
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
    await page.evaluate(() => { location.hash = '#/activity/new?kind=run&date=2026-09-22&parent=s_test&item=se_run'; });
    await page.waitForTimeout(250);
    const banner = await page.locator('.act-link').innerText();
    assert.match(banner, /Día 3 — Cardio/);
    assert.match(banner, /Objetivo 30–45 min/);
    assert.strictEqual(await page.locator('[aria-label="Fecha"]').count(), 0, 'la fecha la pone la sesión');
    assert.ok(await page.getByRole('button', { name: 'Rodaje / Z2', exact: true }).evaluate((b) => b.classList.contains('active')), 'tipo prellenado de las notas');
    assert.match(await page.locator('.act-dur-hint').innerText(), /Objetivo: 30–45 min/);
    assert.strictEqual(await val(page, '[aria-label="Tiempo en movimiento: min"]'), '', 'la duración objetivo es pista, no valor');
    await shot(page, 'activity-linked');

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

    await page.locator('.act-done').click();
    await page.waitForTimeout(250);
    assert.strictEqual(await hash(page), '#/session/s_test');

    // Sin kind: se deduce del deporte del ejercicio del ítem.
    await page.evaluate(() => { location.hash = '#/activity/new?parent=s_test&item=se_run'; });
    await page.waitForTimeout(250);
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Nueva carrera');

    // Una sesión de fuerza abierta como actividad redirige al registro de fuerza.
    await go(page, '#/activity/s_test');
    await page.waitForTimeout(200);
    assert.strictEqual(await hash(page), '#/session/s_test');
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
    await page.locator('.bw-entry [aria-label="Sumar 0,1"]').click();
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
    await page.waitForTimeout(150);
    const summary = await page.locator('.bw-summary').innerText();
    assert.match(summary, /\+0,3\d kg\/sem/, summary);
    assert.match(summary, /subiendo/);
    assert.strictEqual(await page.locator('.bw-row').count(), 28);
    assert.match(await page.locator('.bw-row').first().innerText(), /75,4 kg\s+(±0|[+−]0,\d)$/, 'variación respecto al anterior');
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
    await page.locator('.sheet-panel [aria-label="Sumar 0,1"]').click();
    await settle(page, 200);
    const after = (await idbAll(page, 'bodyweight')).find((b) => b.id === secondId).kg;
    assert.strictEqual(after, Math.round((before + 0.1) * 10) / 10);

    // Borrar desde la hoja → deshacer
    await page.locator('.sheet-panel .btn-danger-ghost').click();
    await settle(page, 300);
    assert.strictEqual((await idbAll(page, 'bodyweight')).some((b) => b.id === secondId), false);
    assert.strictEqual(await page.locator('.bw-row').count(), 27);
    await page.locator('.toast-action').click();
    await settle(page, 300);
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
    await shot(page, 'bodyweight-quick');

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
