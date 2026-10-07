// E2E del módulo de calendario: Hoy, Calendario (semana/mes), Día e Historial.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/calendar.test.cjs
// La fecha se fija con page.clock (semana del lunes 21 al domingo 27 de septiembre de 2026).
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, waitRoute, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const MON = '2026-09-21';
const TUE = '2026-09-22';
const WED = '2026-09-23';
const FRI = '2026-09-25';
const SAT = '2026-09-26';
const NEXT_SAT = '2026-10-03';
const at = (date, time = '10:00:00') => new Date(`${date}T${time}`);

const hash = (page) => page.evaluate(() => location.hash);
/** Espera a que el hash cumpla `re` y a que la vista termine de montarse. */
/** La URL cumple `re` y su pantalla está montada y quieta (helpers.waitRoute: por condición, no por tiempo). */
const waitHash = (page, re) => waitRoute(page, re);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const settle = (page, ms = 250) => page.waitForTimeout(ms);
/** Nodos de texto «null»/«undefined» dentro de `sel` (un Element.append(null) los mete como texto). */
const strayText = (page, sel) => page.evaluate((s) => {
  const out = [];
  for (const root of document.querySelectorAll(s)) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) if (/^\s*(null|undefined)\s*$/.test(n.nodeValue)) out.push(n.nodeValue.trim());
  }
  return out;
}, sel);

/** Abre la app con la fecha fijada y un inicio de registro antiguo (para que haya días «saltados»). */
async function setup(date = WED) {
  const app = await openApp();
  await app.page.clock.setFixedTime(at(date));
  await reload(app.page);
  await app.page.evaluate(async () => {
    const s = window.__app.store;
    const meta = s.get('meta', 'app');
    meta.createdAt = new Date(2026, 0, 1, 12).getTime();
    await s.save('meta', meta);
  });
  return app;
}

/** Cambia la fecha del reloj y vuelve a abrir la app en Hoy. */
async function setClock(app, date) {
  await app.page.clock.setFixedTime(at(date));
  await app.page.evaluate(() => history.replaceState(null, '', '#/today'));
  await reload(app.page);
}

/** Guarda una sesión de fuerza terminada de una plantilla (skip = índices de ítems sin series). */
function seedStrength(page, { id, tpl, date, planDate = date, skip = [], status = 'done' }) {
  return page.evaluate(async (o) => {
    const st = window.__app.store;
    const t = st.get('templates', o.tpl);
    const now = Date.now();
    await st.save('sessions', {
      id: o.id, kind: 'strength', date: o.date, planDate: o.planDate, templateId: t.id, templateName: t.name,
      status: o.status, startedAt: now - 3600000, endedAt: o.status === 'done' ? now : null,
      durationMin: o.status === 'done' ? 60 : null, rpe: o.status === 'done' ? 7 : null, notes: '', parentId: null, cursor: 0,
      exercises: t.items.map((it, i) => ({
        id: `${o.id}_se${i}`, exerciseId: it.exerciseId, exName: st.exercise(it.exerciseId)?.name || '', templateItemId: it.id,
        alternatives: [], target: { sets: it.sets, repMin: it.repMin ?? null, repMax: it.repMax ?? null }, notes: '', section: '',
        groupId: null, groupType: null,
        sets: o.skip.includes(i) ? [] : [{ id: `${o.id}_set${i}`, type: 'effective', weight: 40, reps: 8, repsR: null, rir: 2, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: now }],
      })),
    });
  }, { id, tpl, date, planDate, skip, status });
}

function seedActivity(page, { id, kind, date, planDate = date, km = null, sec = 3600, rpe = 5, subtype = null, templateName = null }) {
  return page.evaluate(async (o) => {
    await window.__app.store.save('sessions', {
      id: o.id, kind: o.kind, date: o.date, planDate: o.planDate, templateId: null, templateName: o.templateName,
      status: 'done', startedAt: null, endedAt: null, movingSec: o.sec, durationMin: o.sec / 60, rpe: o.rpe,
      distanceKm: o.km, subtype: o.subtype, notes: '', parentId: null, parentItemId: null, templateItemId: null,
    });
  }, { id, kind, date, planDate, km, sec, rpe, subtype, templateName });
}

const planName = (page) => page.locator('.today-plan-name').innerText();

// ---------------------------------------------------------------------------

test('Hoy muestra el plan de la semana tipo para cada día (L D1 · M D2 · X D3 · J D4 · V descanso · S D6 · D descanso)', async () => {
  const app = await setup(MON);
  const { page } = app;
  try {
    const expected = [
      [MON, 'Día 1 — Upper pesado'],
      [TUE, 'Día 2 — Pierna fuerza + potencia'],
      [WED, 'Día 3 — Cardio'],
      ['2026-09-24', 'Día 4 — Upper hipertrofia'],
      [FRI, 'Descanso'],
      [SAT, 'Día 6 — Atlético + pierna ligera'],
      ['2026-09-27', 'Descanso'],
    ];
    for (const [date, name] of expected) {
      await setClock(app, date);
      assert.strictEqual(await hash(page), '#/today');
      assert.strictEqual(await planName(page), name, `plan del ${date}`);
    }
    // Domingo (descanso): «Entrenar igualmente» y «Registrar actividad».
    assert.ok(await page.getByRole('button', { name: 'Entrenar igualmente' }).isVisible());
    assert.ok(await page.getByRole('button', { name: 'Registrar actividad' }).isVisible());
    assert.match(await page.locator('.topbar-sub').innerText(), /^Domingo, 27 de septiembre$/);
    await shot(page, 'calendar-today-rest');
    // Mini semana: 7 días, hoy resaltado; «Mañana: …».
    assert.strictEqual(await page.locator('.today-week-day').count(), 7);
    assert.strictEqual(await page.locator('.today-week-day.is-today').getAttribute('data-date'), '2026-09-27');
    assert.match(await page.locator('.today-tomorrow').innerText(), /Mañana\s+🏋️ Día 1 — Upper pesado/i);
    assert.strictEqual(await page.locator('.today-extra').count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Empezar crea una sesión activa con UN toque; con sesión en curso se ofrece continuarla', async () => {
  const app = await setup(MON);
  const { page } = app;
  try {
    await go(page, '#/today');
    assert.match(await page.locator('.today-plan').innerText(), /Press banca\s+3×4–6/);
    await shot(page, 'calendar-today');
    assert.ok(await noHScroll(page), 'sin scroll horizontal');
    const btn = page.locator('.today-start');
    assert.strictEqual(await btn.innerText(), 'Empezar');
    const box = await btn.boundingBox();
    assert.ok(box.height >= 48, `botón grande (${box.height}px)`);

    await btn.click();
    await waitHash(page, /^#\/session\/s_/);
    const sessions = await idbAll(page, 'sessions');
    assert.strictEqual(sessions.length, 1);
    const s = sessions[0];
    assert.strictEqual(await hash(page), `#/session/${s.id}`);
    assert.deepStrictEqual([s.kind, s.status, s.templateId, s.date, s.planDate], ['strength', 'active', 'tpl_d1', MON, MON]);

    // De vuelta en Hoy: la tarjeta de la sesión en curso manda (nombre, cronómetro, series y «Continuar»); «Te toca
    // hoy» no la repite debajo (ni la vista previa, ni «Empezar», ni «Pendiente»).
    await go(page, '#/today');
    const live = page.locator('.today-active');
    assert.strictEqual(await live.getAttribute('data-live'), '1');
    assert.strictEqual(await live.locator('.today-active-name').innerText(), 'Día 1 — Upper pesado');
    assert.match(await live.locator('.today-clock').innerText(), /^\d+:\d\d$/);
    assert.match(await live.locator('.today-active-sub').innerText(), /^0 de \d+ series$/, 'es lo planificado: sin «En lugar de»');
    assert.strictEqual(await page.locator('.today-start').count(), 0);
    assert.strictEqual(await page.getByRole('button', { name: /Continuar/ }).count(), 1);
    assert.strictEqual(await page.locator('.today-plan').count(), 0);
    assert.strictEqual(await page.locator('.cal-tpl-item').count(), 0);
    await shot(page, 'calendar-today-active');
    // Fuerza libre con una sesión en curso → aviso, sin crear otra.
    await page.locator('.today-quick-btn[data-kind="strength"]').click();
    await page.getByText('Ya hay una sesión en curso').waitFor();
    await page.getByRole('button', { name: 'Continuar la sesión en curso' }).click();
    await waitHash(page, new RegExp(`^#/session/${s.id}$`));
    assert.strictEqual((await storeAll(page, 'sessions')).length, 1);

    // Accesos rápidos de actividad → formulario con fecha de hoy.
    await go(page, '#/today');
    await page.locator('.today-quick-btn[data-kind="run"]').click();
    await waitHash(page, /^#\/activity\/new/);
    assert.strictEqual(await hash(page), `#/activity/new?kind=run&date=${MON}`);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('CRITERIO: sustituir el sábado de esta semana por una ruta en bici no cambia la semana tipo', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    const before = (await idbAll(page, 'meta')).find((m) => m.id === 'settings').weekPatterns;
    await go(page, `#/day/${SAT}`);
    assert.match(await page.locator('.topbar h1').innerText(), /^Sábado 26 sep$/);
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Día 6 — Atlético + pierna ligera');
    assert.match(await page.locator('.cal-scope').innerText(), /Los cambios afectan solo a este día; tu semana tipo no cambia/);

    // Se cambia desde abajo del todo: después la vista vuelve arriba (plan nuevo y su acción a la vista).
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.locator('.cal-act-change').click();
    await page.locator('.pick-row', { hasText: 'Ruta en bici' }).click();
    await page.locator('.toast').waitFor();
    // Condición con margen: el desplazamiento suave avanza por fotogramas, y WebKit sin pantalla con la batería en
    // paralelo los da muy espaciados (solo, pasa en < 1 s).
    await page.waitForFunction(() => window.scrollY === 0, null, { timeout: 8000 });
    await settle(page);
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Ruta en bici');
    assert.match(await page.locator('.cal-plan').innerText(), /Cambiado\s+Semana tipo: Día 6 — Atlético \+ pierna ligera/);
    await shot(page, 'calendar-day-changed');

    // En disco: una excepción para ese sábado y la semana tipo intacta.
    const plan = await idbAll(page, 'plan');
    assert.strictEqual(plan.length, 1);
    assert.deepStrictEqual({ id: plan[0].id, kind: plan[0].kind, label: plan[0].label, activityKind: plan[0].activityKind },
      { id: SAT, kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
    const after = (await idbAll(page, 'meta')).find((m) => m.id === 'settings').weekPatterns;
    assert.deepStrictEqual(after, before, 'weekPatterns sin cambios');

    // Calendario: esta semana sábado = bici «cambiado»; la siguiente sigue con el Día 6.
    await go(page, `#/calendar?week=${MON}`);
    const satRow = page.locator(`.cal-row[data-date="${SAT}"]`);
    assert.match(await satRow.innerText(), /Ruta en bici\s+cambiado/);
    await go(page, '#/calendar?week=2026-09-28');
    const next = await page.locator(`.cal-row[data-date="${NEXT_SAT}"]`).innerText();
    assert.match(next, /Día 6 — Atlético/);
    assert.doesNotMatch(next, /cambiado/);

    // El sábado, Hoy ofrece registrar la ruta en bici con fecha y fecha de plan.
    await setClock(app, SAT);
    assert.strictEqual(await planName(page), 'Ruta en bici');
    await page.getByRole('button', { name: 'Registrar ruta en bici' }).click();
    await waitHash(page, /^#\/activity\/new/);
    assert.strictEqual(await hash(page), `#/activity/new?kind=bike&date=${SAT}&planDate=${SAT}&subtype=route`);

    // Restaurar semana tipo (con deshacer).
    await go(page, `#/day/${SAT}`);
    await page.locator('.cal-act-reset').click();
    await page.locator('.toast').waitFor();
    await settle(page);
    assert.strictEqual((await idbAll(page, 'plan')).length, 0);
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Día 6 — Atlético + pierna ligera');
    await page.getByRole('button', { name: 'Deshacer' }).click();
    await settle(page);
    assert.strictEqual((await idbAll(page, 'plan'))[0].activityKind, 'bike');
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Ruta en bici');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('mover días: intercambia los planes de dos días de la semana (y se puede deshacer)', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    const before = (await idbAll(page, 'meta')).find((m) => m.id === 'settings').weekPatterns;
    await go(page, `#/day/${MON}`);
    await page.locator('.cal-act-move').click();
    assert.strictEqual(await page.locator('.cal-move-row').count(), 6);
    await shot(page, 'calendar-move-sheet');
    await page.locator(`.cal-move-row[data-date="${TUE}"]`).click();
    await page.locator('.toast').waitFor();
    await settle(page);
    const plan = Object.fromEntries((await idbAll(page, 'plan')).map((p) => [p.id, p.templateId]));
    assert.deepStrictEqual(plan, { [MON]: 'tpl_d2', [TUE]: 'tpl_d1' });
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Día 2 — Pierna fuerza + potencia');
    assert.deepStrictEqual((await idbAll(page, 'meta')).find((m) => m.id === 'settings').weekPatterns, before);

    await page.getByRole('button', { name: 'Deshacer' }).click();
    await settle(page);
    assert.strictEqual((await idbAll(page, 'plan')).length, 0);
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Día 1 — Upper pesado');

    // Otra vez y comprobación en el calendario.
    await page.locator('.cal-act-move').click();
    await page.locator(`.cal-move-row[data-date="${TUE}"]`).click();
    await settle(page);
    await go(page, `#/calendar?week=${MON}`);
    assert.match(await page.locator(`.cal-row[data-date="${MON}"]`).innerText(), /Día 2 — Pierna fuerza \+ potencia\s+cambiado/);
    assert.match(await page.locator(`.cal-row[data-date="${TUE}"]`).innerText(), /Día 1 — Upper pesado\s+cambiado/);
    // Hacer la rutina movida: «hecho» o «hecho parcialmente» (no «sustituido»); otra rutina sí es «sustituido».
    await seedStrength(page, { id: 's_mv', tpl: 'tpl_d2', date: MON });
    await seedStrength(page, { id: 's_mv2', tpl: 'tpl_d1', date: TUE, skip: [0, 1] });
    await go(page, '#/today');
    await go(page, `#/calendar?week=${MON}`);
    assert.strictEqual(await page.locator(`.cal-row[data-date="${MON}"]`).getAttribute('data-status'), 'done');
    assert.strictEqual(await page.locator(`.cal-row[data-date="${TUE}"]`).getAttribute('data-status'), 'partial');
    assert.match(await page.locator(`.cal-row[data-date="${MON}"]`).innerText(), /cambiado/);
    await seedStrength(page, { id: 's_mv', tpl: 'tpl_d4', date: MON });
    await go(page, '#/today');
    await go(page, `#/calendar?week=${MON}`);
    assert.strictEqual(await page.locator(`.cal-row[data-date="${MON}"]`).getAttribute('data-status'), 'substituted');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('marcar estado a mano y volver a automático', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    await go(page, `#/day/${TUE}`);
    assert.strictEqual(await page.locator('.cal-state .status').getAttribute('data-status'), 'skipped');
    await page.locator('.cal-act-mark').click();
    await page.locator('.action-item', { hasText: 'Hecho parcialmente' }).click();
    await page.locator('.toast').waitFor();
    await settle(page);
    assert.match(await page.locator('.cal-state').innerText(), /Hecho parcialmente\s+· a mano/);
    assert.match(await page.locator('.cal-state').innerText(), /Sin marca manual sería: saltado/);
    const rec = (await idbAll(page, 'plan'))[0];
    assert.deepStrictEqual([rec.id, rec.status, rec.kind], [TUE, 'partial', undefined]);
    await shot(page, 'calendar-day-manual');

    await go(page, `#/calendar?week=${MON}`);
    assert.strictEqual(await page.locator(`.cal-row[data-date="${TUE}"] .status`).getAttribute('data-status'), 'partial');

    await go(page, `#/day/${TUE}`);
    await page.locator('.cal-act-mark').click();
    await page.locator('.action-item', { hasText: 'Automático' }).click();
    await settle(page);
    assert.strictEqual((await idbAll(page, 'plan')).length, 0);
    assert.strictEqual(await page.locator('.cal-state .status').getAttribute('data-status'), 'skipped');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('calendario: estados de la semana, adherencia, sesiones hechas y vista mensual', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    await seedStrength(page, { id: 's_mon', tpl: 'tpl_d1', date: MON });
    await seedStrength(page, { id: 's_tue', tpl: 'tpl_d2', date: TUE, skip: [0, 1] });
    await seedActivity(page, { id: 'a_fri', kind: 'run', date: FRI, km: 8, sec: 2400, templateName: 'Carrera · Rodaje / Z2' });
    await go(page, '#/calendar');
    const st = await page.locator('.cal-row').evaluateAll((els) => els.map((e) => e.dataset.status));
    assert.deepStrictEqual(st, ['done', 'partial', 'pending', 'pending', 'done', 'pending', 'rest']);
    assert.strictEqual(await page.locator('.cal-adh-text').innerText(), '2 de 5 hechas · 1 parcial · 1 extra');
    assert.match(await page.locator(`.cal-row[data-date="${MON}"]`).innerText(), /Día 1 — Upper pesado\s+Hecho\s+🏋️ 1 h 00 min/);
    assert.match(await page.locator(`.cal-row[data-date="${FRI}"]`).innerText(), /extra\s+🏃 Carrera · Rodaje \/ Z2 · 40 min/);
    // «Hecho · extra» con espacio antes del punto medio.
    const gap = await page.locator(`.cal-row[data-date="${FRI}"] .cal-row-state`).evaluate((el) => {
      const [a, b] = [el.querySelector('.status'), el.querySelector('.cal-extra')];
      return b.getBoundingClientRect().left - a.getBoundingClientRect().right;
    });
    assert.ok(gap >= 3, `hueco antes de «· extra» (${gap}px)`);
    assert.match(await page.locator('.cal-nav').innerText(), /21–27 sep\s+Esta semana/);
    await shot(page, 'calendar-week');
    assert.ok(await noHScroll(page));

    // Navegación de semanas y «Hoy».
    await page.getByRole('button', { name: 'Semana anterior' }).click();
    await waitHash(page, /week=2026-09-14/);
    assert.match(await page.locator('.cal-nav').innerText(), /14–20 sep\s+Semana pasada/);
    assert.strictEqual(await page.locator('.cal-row[data-status="skipped"]').count(), 5);
    await page.getByRole('button', { name: 'Hoy', exact: true }).click();
    await waitHash(page, /week=2026-09-21/);

    // Toca una fila → detalle del día con sus sesiones.
    await page.locator(`.cal-row[data-date="${TUE}"]`).click();
    await waitHash(page, new RegExp(`^#/day/${TUE}$`));
    assert.match(await page.locator('.cal-state').innerText(), /Hecho parcialmente[\s\S]*7 de 9 ejercicios/);
    assert.strictEqual(await page.locator('.cal-sessions .cal-ses-row').count(), 1);
    await page.locator('.cal-sessions .cal-ses-row').click();
    await waitHash(page, /^#\/session\/s_tue$/);

    // Vista mensual: cuadrícula de puntos; tocar un día abre su semana.
    await go(page, '#/calendar?view=month&month=2026-09');
    assert.strictEqual(await page.locator('.cal-month-cell').count(), 35);
    assert.strictEqual(await page.locator(`.cal-month-cell[data-date="${MON}"]`).getAttribute('data-status'), 'done');
    await shot(page, 'calendar-month');
    assert.ok(await noHScroll(page));
    await page.locator('.cal-month-cell[data-date="2026-09-09"]').click();
    await waitHash(page, /^#\/calendar\?week=2026-09-07$/);
    assert.match(await page.locator('.cal-nav').innerText(), /7–13 sep/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('día pasado: registrar la sesión de fuerza de ese día (pasada) y hoy «hecho» con resumen y «Otra sesión»', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    await go(page, `#/day/${MON}`);
    await page.getByRole('button', { name: 'Registrar sesión de fuerza' }).click();
    await waitHash(page, /^#\/session\/s_/);
    const s = (await idbAll(page, 'sessions'))[0];
    assert.deepStrictEqual([s.date, s.planDate, s.templateId, s.startedAt], [MON, MON, 'tpl_d1', null]);
    await page.evaluate((id) => window.__app.store.remove('sessions', id), s.id);

    // Hoy (D3) a medias con su propia rutina: motivo + resumen, sin «Empezar la rutina» (ni «null» suelto).
    await seedStrength(page, { id: 's_wed', tpl: 'tpl_d3', date: WED, skip: [0] });
    await go(page, '#/today');
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-status'), 'partial');
    assert.match(await page.locator('.today-plan').innerText(), /2 de 3 ejercicios registrados/);
    assert.strictEqual(await page.getByRole('button', { name: 'Empezar la rutina' }).count(), 0);
    assert.deepStrictEqual(await strayText(page, '.today-plan'), [], 'sin «null» sueltos en la tarjeta (parcial)');

    // Hoy (D3) ya hecho: estado + resumen + «Otra sesión».
    await seedStrength(page, { id: 's_wed', tpl: 'tpl_d3', date: WED });
    await go(page, '#/today');
    assert.strictEqual(await page.locator('.today-plan .status').getAttribute('data-status'), 'done');
    assert.strictEqual(await page.locator('.today-plan .cal-ses-row').count(), 1);
    assert.match(await page.locator('.today-plan .cal-ses-row').innerText(), /Día 3 — Cardio[\s\S]*1 h 00 min · carga 420/);
    assert.ok(await page.getByRole('button', { name: 'Otra sesión' }).isVisible());
    assert.deepStrictEqual(await strayText(page, '.today-plan'), [], 'sin «null» sueltos en la tarjeta');
    assert.doesNotMatch(await page.locator('.today-plan').innerText(), /\bnull\b/);
    // Aviso de copia (hay datos y nunca se ha hecho copia) → Ajustes › Datos.
    assert.match(await page.locator('.today-backup').innerText(), /Sin copia de seguridad/);
    await shot(page, 'calendar-today-done');
    await page.getByRole('button', { name: 'Otra sesión' }).click();
    await page.locator('.action-item', { hasText: 'Bici' }).click();
    await waitHash(page, /^#\/activity\/new/);
    assert.strictEqual(await hash(page), `#/activity/new?kind=bike&date=${WED}&planDate=${WED}`);
    await go(page, '#/today');
    await page.locator('.today-backup').click();
    await waitHash(page, /^#\/settings\/data$/);
    // Copia de hace 9 días.
    await page.evaluate(() => window.__app.store.saveSettings({ lastBackupAt: Date.now() - 9 * 86400000 }));
    await go(page, '#/today');
    assert.match(await page.locator('.today-backup').innerText(), /Última copia: hace 9 días/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('historial: todas las sesiones por mes, filtros por tipo y apertura de cada sesión', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    await seedStrength(page, { id: 's_d1', tpl: 'tpl_d1', date: MON });
    await seedActivity(page, { id: 'r1', kind: 'run', date: TUE, km: 10, sec: 3000, rpe: 7, templateName: 'Carrera · Tempo' });
    await seedActivity(page, { id: 'b1', kind: 'bike', date: '2026-08-30', km: 42.5, sec: 5400, templateName: 'Bici · Ruta' });
    await seedActivity(page, { id: 'w1', kind: 'swim', date: '2026-09-02', km: 1.5, sec: 1800, templateName: 'Natación' });
    await seedActivity(page, { id: 'o1', kind: 'other', date: '2026-09-10', templateName: 'Baloncesto' });
    await go(page, '#/calendar');
    await page.locator('.cal-links .list-item', { hasText: 'Historial' }).click();
    await waitHash(page, /^#\/history$/);
    assert.ok(await page.locator('.topbar .back-btn').isVisible(), 'pantalla no raíz con botón atrás');
    const months = await page.locator('.hist-month-head .section-title').allInnerTexts();
    assert.deepStrictEqual(months.map((m) => m.toLowerCase()), ['septiembre 2026', 'agosto 2026']);
    const ids = await page.locator('.hist-list .cal-ses-row').evaluateAll((els) => els.map((e) => e.dataset.id));
    assert.deepStrictEqual(ids, ['r1', 's_d1', 'o1', 'w1', 'b1']);
    const run = await page.locator('.cal-ses-row[data-id="r1"]').innerText();
    assert.match(run, /Carrera · Tempo[\s\S]*mar 22 sep · 50 min · carga 350[\s\S]*10 km · 5:00 \/km/);
    assert.match(await page.locator('.cal-ses-row[data-id="s_d1"]').innerText(), /Día 1 — Upper pesado[\s\S]*7 series · 2.840 kg/);
    assert.match(await page.locator('.cal-ses-row[data-id="b1"]').innerText(), /42,5 km · 28,3 km\/h/);
    await shot(page, 'calendar-history');
    assert.ok(await noHScroll(page));

    // Filtro Carrera → solo carreras; el filtro sobrevive a abrir una sesión y volver.
    await page.locator('.hist-filters .chip', { hasText: 'Carrera' }).click();
    assert.strictEqual(await hash(page), '#/history?f=run');
    assert.deepStrictEqual(await page.locator('.hist-list .cal-ses-row').evaluateAll((els) => els.map((e) => e.dataset.id)), ['r1']);
    await page.locator('.cal-ses-row[data-id="r1"]').click();
    await waitHash(page, /^#\/activity\/r1$/);
    await page.goBack();
    await waitHash(page, /^#\/history\?f=run$/);
    await settle(page);
    assert.strictEqual(await page.locator('.hist-filters .chip.active').innerText(), 'Carrera');
    assert.strictEqual(await page.locator('.hist-list .cal-ses-row').count(), 1);

    await page.locator('.hist-filters .chip', { hasText: 'Fuerza' }).click();
    await page.locator('.cal-ses-row[data-id="s_d1"]').click();
    await waitHash(page, /^#\/session\/s_d1$/);
    await go(page, '#/history?f=swim');
    assert.deepStrictEqual(await page.locator('.hist-list .cal-ses-row').evaluateAll((els) => els.map((e) => e.dataset.id)), ['w1']);
    await go(page, '#/history?f=other');
    assert.deepStrictEqual(await page.locator('.hist-list .cal-ses-row').evaluateAll((els) => els.map((e) => e.dataset.id)), ['o1']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('plantilla archivada en la semana tipo → «Plantilla eliminada» sin romper; primer uso sin días «saltados»', async () => {
  const app = await openApp();
  const { page } = app;
  try {
    // Primer uso (instalada hoy miércoles): lunes y martes no salen como saltados.
    await page.clock.setFixedTime(at(WED));
    await reload(page);
    await page.evaluate(async (ts) => {
      const s = window.__app.store;
      const meta = s.get('meta', 'app');
      meta.createdAt = ts;
      await s.save('meta', meta);
    }, at(WED).getTime());
    await go(page, '#/calendar');
    const st = await page.locator('.cal-row').evaluateAll((els) => els.map((e) => e.dataset.status));
    assert.deepStrictEqual(st, ['none', 'none', 'pending', 'pending', 'rest', 'pending', 'rest']);
    assert.strictEqual(await page.locator('.cal-adh-text').innerText(), '0 de 3 hechas');
    assert.match(await page.locator(`.cal-row[data-date="${MON}"]`).innerText(), /Sin registro/);

    // Día 1 archivado: el lunes muestra «Plantilla eliminada» y permite elegir otra rutina.
    await page.evaluate(async () => {
      const s = window.__app.store;
      const t = s.get('templates', 'tpl_d1');
      t.archived = true;
      await s.save('templates', t);
    });
    await go(page, '#/calendar?week=2026-09-28');
    assert.match(await page.locator('.cal-row[data-date="2026-09-28"]').innerText(), /Plantilla eliminada/);
    await setClock(app, '2026-09-28');
    assert.strictEqual(await planName(page), 'Plantilla eliminada');
    assert.ok(await page.getByRole('button', { name: 'Elegir rutina' }).isVisible());
    await go(page, '#/day/2026-09-28');
    assert.strictEqual(await page.locator('.cal-plan .today-plan-name').innerText(), 'Plantilla eliminada');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('iPhone SE con aviso de copia: «Empezar» se ve sin desplazar; el Día 3 lleva el emoji de carrera', async () => {
  const app = await setup(MON);
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.evaluate(async () => {
      const st = window.__app.store;
      await st.save('bodyweight', { id: '2026-09-20', kg: 75.4 }); // hay datos → el aviso de copia aplica
      await st.saveSettings({ lastBackupAt: Date.now() - 9 * 86400000 });
    });
    await reload(page);
    await go(page, '#/today');
    assert.match(await page.locator('.today-backup').innerText(), /Última copia: hace 9 días/);
    const r = await page.evaluate(() => {
      const b = document.querySelector('.today-start').getBoundingClientRect();
      const tab = document.getElementById('tabbar').getBoundingClientRect().top;
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { bottom: b.bottom, tab, tappable: document.querySelector('.today-start').contains(hit), banner: document.querySelector('.today-backup').getBoundingClientRect().height };
    });
    assert.ok(r.bottom <= r.tab && r.tappable, `«Empezar» a la vista (${JSON.stringify(r)})`);
    assert.ok(r.banner <= 72, `aviso de copia compacto (${r.banner}px)`);
    // Pantalla baja: vista previa corta con «Ver los 7 ejercicios».
    assert.strictEqual(await page.locator('.today-plan .cal-tpl-item').count(), 3);
    await page.locator('.cal-tpl-more').click();
    assert.strictEqual(await page.locator('.today-plan .cal-tpl-item').count(), 7);
    await shot(page, 'calendar-today-se');
    assert.ok(await noHScroll(page));
    // Miércoles: «🏃 Día 3 — Cardio» (no 🏋️) en Hoy y en la mini semana («Mañana» el martes).
    await setClock(app, WED);
    assert.strictEqual(await page.locator('.today-plan .today-plan-emoji').innerText(), '🏃');
    await setClock(app, TUE);
    assert.match(await page.locator('.today-tomorrow').innerText(), /🏃 Día 3 — Cardio/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Día 3: la carrera registrada con el acceso rápido de Hoy cuenta para la rutina (parcial, no «sustituido»)', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    // Como la guarda el acceso rápido «Carrera»: suelta, sin sesión padre ni fecha de plan.
    await seedActivity(page, { id: 'a_run', kind: 'run', date: WED, planDate: null, km: 6.2, sec: 2100, templateName: 'Carrera' });
    await go(page, '#/today');
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-status'), 'partial');
    assert.match(await page.locator('.today-plan').innerText(), /1 de 3 ejercicios registrados\. Sin registrar: Bici, Plancha/);
    assert.deepStrictEqual(await strayText(page, '.today-plan'), [], 'sin «null» sueltos en la tarjeta');
    await shot(page, 'calendar-today-d3-run');
    // También en la vista Día, y sin «sustituido».
    await go(page, `#/day/${WED}`);
    assert.strictEqual(await page.locator('.cal-state .status').getAttribute('data-status'), 'partial');
    assert.strictEqual(await page.locator('.cal-primary').innerText(), 'Empezar');
    await go(page, '#/today');
    // La rutina se puede empezar igualmente (para la bici y la plancha).
    await page.getByRole('button', { name: 'Empezar la rutina' }).click();
    await waitHash(page, /^#\/session\/s_/);
    const s = (await idbAll(page, 'sessions')).find((x) => x.kind === 'strength');
    assert.deepStrictEqual([s.templateId, s.date, s.planDate], ['tpl_d3', WED, WED]);
    // Con la bici también suelta y la plancha hecha en la sesión → hecho.
    await seedActivity(page, { id: 'a_bike', kind: 'bike', date: WED, planDate: null, km: 30, sec: 3600, templateName: 'Bici' });
    await page.evaluate(async (id) => {
      const st = window.__app.store;
      const ses = st.get('sessions', id);
      const plank = ses.exercises.find((se) => se.exerciseId === 'plancha');
      plank.sets = [{ id: 'set_p', type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: 60, distanceM: null, heightCm: null, note: '', done: true, doneAt: Date.now() }];
      ses.status = 'done';
      ses.endedAt = Date.now();
      await st.save('sessions', ses);
    }, s.id);
    await go(page, `#/calendar?week=${MON}`);
    assert.strictEqual(await page.locator(`.cal-row[data-date="${WED}"]`).getAttribute('data-status'), 'done');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('ejercicio quitado de una sesión registrada a posteriori: «hecho parcialmente», también tras editar la rutina', async () => {
  const app = await setup(WED);
  const { page } = app;
  try {
    // Sesión pasada del martes (Día 2, 9 ejercicios) creada con la lógica real; se quita el último y
    // se registran los demás.
    await page.evaluate(async (date) => {
      const S = await import('./js/session-logic.js');
      const st = window.__app.store;
      const s = await S.createStrengthSession({ templateId: 'tpl_d2', date, planDate: date, past: true });
      s.exercises.pop();
      for (const se of s.exercises) se.sets = [{ id: `${se.id}_w`, type: 'effective', weight: 40, reps: 8, repsR: 8, rir: 2, timeSec: 30, distanceM: 20, heightCm: null, note: '', done: true, doneAt: Date.now() }];
      s.status = 'done';
      s.durationMin = 60;
      await st.save('sessions', s);
    }, TUE);
    const status = async () => {
      await go(page, '#/today');
      await go(page, `#/calendar?week=${MON}`);
      return page.locator(`.cal-row[data-date="${TUE}"]`).getAttribute('data-status');
    };
    assert.strictEqual(await status(), 'partial');
    await go(page, `#/day/${TUE}`);
    assert.match(await page.locator('.cal-state').innerText(), /8 de 9 ejercicios registrados\. Sin registrar: Elevaciones de piernas/);
    // Guardar la rutina después (reordenar + renombrar): el día pasado no cambia de estado.
    await page.evaluate(async () => {
      const st = window.__app.store;
      const t = st.get('templates', 'tpl_d2');
      [t.items[0], t.items[1]] = [t.items[1], t.items[0]];
      t.name = 'Día 2 — Pierna';
      t.updatedAt = Date.now() + 60000;
      await st.save('templates', t);
    });
    assert.strictEqual(await status(), 'partial');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
