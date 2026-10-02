// E2E del módulo de ajustes: índice, semana tipo, umbrales, copias (JSON), CSV, almacenamiento y borrado.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/settings.test.cjs
// La fecha se fija con page.clock: miércoles 23 de septiembre de 2026 (semana del lunes 21).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { openApp, go, reload, storeAll, idbAll, shot } = require('./helpers.cjs');

const NOW = new Date('2026-09-23T10:00:00Z'); // 12:00 en Madrid
const WS = '2026-09-21';
const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];

const settle = (page, ms = 250) => page.waitForTimeout(ms);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const hash = (page) => page.evaluate(() => location.hash);
const settingsOf = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.store.settings())));
const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
const sheetBtn = (page, text) => sheetPanel(page).locator('button', { hasText: text });

async function setup() {
  const app = await openApp();
  await app.page.clock.setFixedTime(NOW);
  await reload(app.page);
  return app;
}

/** Espera a que se cierren las hojas (animación de 200 ms). */
async function waitNoSheet(page) {
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 5000 });
}

/** Datos variados: fuerza con series, actividades, pesajes, excepción de calendario, check-in, objetivo y ajustes cambiados. */
async function seedData(page) {
  await page.evaluate(async () => {
    const st = window.__app.store;
    const plan = await import('./js/plan.js');
    const now = Date.now();
    const mkSet = (id, o) => ({ id, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: now, ...o });
    const strength = (id, tplId, date, rpe, sets) => {
      const t = st.get('templates', tplId);
      return {
        id, kind: 'strength', date, planDate: date, templateId: t.id, templateName: t.name, status: 'done',
        startedAt: now - 5400000, endedAt: now - 1800000, durationMin: 60, rpe, notes: 'Nota; con "comillas"\ny salto', parentId: null, templateItemId: null, cursor: 0,
        exercises: t.items.slice(0, sets.length).map((it, i) => ({
          id: `${id}_se${i}`, exerciseId: it.exerciseId, exName: st.exercise(it.exerciseId)?.name || '', templateItemId: it.id, alternatives: [],
          target: { sets: it.sets, repMin: it.repMin ?? null, repMax: it.repMax ?? null }, notes: '', section: it.section || '', groupId: null, groupType: null,
          sets: sets[i].map((o, j) => mkSet(`${id}_s${i}_${j}`, o)),
        })),
      };
    };
    await st.save('sessions', strength('ses_a', 'tpl_d1', '2026-09-14', 8, [
      [{ type: 'warmup', weight: 40, reps: 10 }, { weight: 80, reps: 6, rir: 2 }, { weight: 82.5, reps: 5, rir: 1, note: 'buena' }],
      [{ weight: 0, reps: 8, rir: 2 }, { weight: 5, reps: 6, rir: 'F', type: 'failure' }],
    ]));
    await st.save('sessions', strength('ses_b', 'tpl_d1', '2026-09-21', 7, [
      [{ weight: 82.5, reps: 6, rir: 1 }, { weight: 82.5, reps: 6, rir: 1 }, { weight: 60, reps: 12, type: 'drop' }],
    ]));
    await st.save('sessions', strength('ses_c', 'tpl_d2', '2026-09-22', 9, [
      [{ reps: 3, heightCm: 52.5 }, { reps: 3 }],
      [{ reps: 18 }],
      [{ weight: 100, reps: 5, rir: 2 }],
    ]));
    const act = (o) => ({ status: 'done', planDate: o.date, templateId: null, templateName: '', startedAt: null, endedAt: null, notes: '', parentId: null, ...o });
    await st.save('sessions', act({ id: 'act_run', kind: 'run', date: '2026-09-16', subtype: 'z2', distanceKm: 8.4, movingSec: 2700, elapsedSec: 2790, durationMin: 45, elevationM: 40, hrAvg: 145, hrMax: 162, cadence: 170, rpe: 5, feel: 'Z2', notes: 'Rodaje suave' }));
    await st.save('sessions', act({ id: 'act_swim', kind: 'swim', date: '2026-09-17', distanceKm: 1.2, movingSec: 1500, durationMin: 25, poolType: 'pool', poolLengthM: 25, stroke: 'free', rpe: 6 }));
    await st.save('sessions', act({ id: 'act_bike', kind: 'bike', date: '2026-09-19', subtype: 'route', distanceKm: 52.3, movingSec: 7200, durationMin: 120, powerAvg: 175, powerNp: 190, rpe: 6 }));
    await st.save('sessions', act({ id: 'act_other', kind: 'other', date: '2026-09-20', subtype: 'basketball', movingSec: 3600, durationMin: 60, rpe: 7 }));
    for (const [id, kg] of [['2026-09-14', 75.4], ['2026-09-18', 75.1], ['2026-09-22', 74.9]]) await st.save('bodyweight', { id, kg });
    await st.save('checkins', { id: 'chk1', date: '2026-09-21', timing: 'pre', sessionId: 'ses_b', sleep: 2, energy: 3, soreness: 1 });
    await st.save('goals', { id: 'goal1', kind: 'strength', title: 'Banca 100 kg × 5', exerciseId: 'press_banca', weight: 100, reps: 5, achievedAt: null, archived: false });
    await st.save('exercises', { id: 'ex_custom', name: 'Remo en máquina «Hammer»', aliases: [], primary: ['back'], secondary: ['biceps'], pattern: 'pull_h', logType: 'weight_reps', category: 'compound', region: 'upper', notes: '', custom: true, archived: false });
    const t = st.get('templates', 'tpl_d4');
    t.name = 'Día 4 — Upper hipertrofia (v2)';
    await st.save('templates', t);
    // Excepción del calendario: el sábado de esta semana, ruta en bici.
    await plan.overrideDay('2026-09-26', { kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
    // Ajustes cambiados (umbrales y semana tipo desde esta semana).
    const s = st.settings();
    s.secondaryFactor = 0.75;
    s.muscleTargets.back = [16, 24];
    s.increments.upperCompound = 2;
    await st.save('meta', s);
    const days = JSON.parse(JSON.stringify(plan.currentPattern()));
    days[6] = { kind: 'free', label: 'Carrera', activityKind: 'run' };
    await plan.setWeekPattern(days);
  });
}

/** Sustituye navigator.share para capturar los archivos compartidos (modo: 'ok' | 'abort'). */
async function stubShare(page, mode = 'ok') {
  await page.evaluate((m) => {
    window.__shared = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async ({ files }) => {
        if (m === 'abort') throw new DOMException('cancelado', 'AbortError');
        for (const f of files) {
          const bytes = new Uint8Array(await f.arrayBuffer());
          window.__shared.push({ name: f.name, type: f.type, head: Array.from(bytes.slice(0, 3)), text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes) });
        }
      },
    });
  }, mode);
}
const shared = (page) => page.evaluate(() => window.__shared);

// ---------------------------------------------------------------------------

test('índice de Ajustes: secciones, semana tipo resumida, aviso de copia, instalación y acerca de', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/settings');
    const view = page.locator('#view');
    for (const txt of ['Semana tipo', 'Umbrales y reglas', 'Rutinas', 'Biblioteca de ejercicios', 'Copias y datos', 'Añadir a la pantalla de inicio', 'Acerca de']) {
      assert.ok(await view.getByText(txt, { exact: false }).first().isVisible(), `falta «${txt}»`);
    }
    // Resumen L–D de la semana tipo por defecto.
    const mini = await page.locator('.cfg-week-mini .cfg-wm-label').allTextContents();
    assert.deepStrictEqual(mini, ['D1', 'D2', 'D3', 'D4', '—', 'D6', '—']);
    assert.match(await page.locator('.cfg-week-row').getAttribute('aria-label'), /L D1 · M D2 · X D3 · J D4 · V — · S D6 · D —/);
    // Sin datos del usuario no hay aviso de copia.
    assert.strictEqual(await page.locator('.cfg-banner').count(), 0);
    assert.match(await page.locator('.cfg-data-row').innerText(), /Todavía no has hecho ninguna copia/);
    // Versión y texto de privacidad.
    const about = await page.locator('.cfg-about').innerText();
    assert.match(about, /versión 1\.0\.0/);
    assert.match(about, /sin servidor, sin cuentas/i);
    assert.match(about, /haz copias/);
    // Instalación: pasos para Safari.
    assert.strictEqual(await page.locator('.cfg-install').getAttribute('data-installed'), 'no');
    assert.strictEqual(await page.locator('.cfg-steps li').count(), 4);
    assert.ok(await noHScroll(page));
    await page.locator('.cfg-about').scrollIntoViewIfNeeded();
    await shot(page, 'settings-index-bottom');

    // Con datos y sin copia: aviso destacado + insignia.
    await seedData(page);
    await go(page, '#/today');
    await go(page, '#/settings');
    assert.strictEqual(await page.locator('.cfg-banner').count(), 1);
    assert.match(await page.locator('.cfg-banner').innerText(), /Aún no has hecho ninguna copia/);
    assert.match(await page.locator('.cfg-data-row').innerText(), /Copia pendiente/);
    // La insignia va junto al título, dentro del texto: en 375 y 390 px el título se lee entero y el
    // subtítulo no se queda en una columna estrecha (antes: «Copias y…» y 6–7 líneas).
    const vp = page.viewportSize();
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: vp.height });
      const fit = await page.evaluate(() => {
        const row = document.querySelector('.cfg-data-row');
        const title = row.querySelector('.list-item-title');
        return {
          inMain: !!row.querySelector('.list-item-main .cfg-badge'),
          clipped: title.scrollWidth > title.clientWidth,
          mainW: row.querySelector('.list-item-main').offsetWidth,
        };
      });
      assert.ok(fit.inMain, 'insignia dentro del bloque de texto');
      assert.ok(!fit.clipped, `${width} px: título «Copias y datos» sin cortar`);
      assert.ok(fit.mainW > 200, `${width} px: el texto tiene ancho (${fit.mainW} px)`);
      assert.ok(await noHScroll(page));
    }
    await page.setViewportSize(vp);
    // La semana tipo nueva (domingo = carrera) se refleja.
    assert.strictEqual((await page.locator('.cfg-week-mini .cfg-wm-label').allTextContents())[6], '🏃');
    await shot(page, 'settings-index');

    // Última copia hace 10 días → aviso con los días del recordatorio.
    await page.evaluate(() => window.__app.store.saveSettings({ lastBackupAt: Date.now() - 10 * 86400000 }));
    await go(page, '#/today');
    await go(page, '#/settings');
    assert.match(await page.locator('.cfg-banner').innerText(), /Hace más de 7 días/);
    assert.match(await page.locator('.cfg-data-row').innerText(), /13 sep 2026 \(hace 10 días\)/);
    // Copia reciente → sin aviso.
    await page.evaluate(() => window.__app.store.saveSettings({ lastBackupAt: Date.now() - 3600000 }));
    await go(page, '#/today');
    await go(page, '#/settings');
    assert.strictEqual(await page.locator('.cfg-banner').count(), 0);
    assert.match(await page.locator('.cfg-data-row').innerText(), /Última copia: hoy, 11:00/);

    // Navegación desde el índice.
    const cases = [
      ['.cfg-week-row', /#\/settings\/week$/],
      ['button:has-text("Umbrales y reglas")', /#\/settings\/thresholds$/],
      ['button:has-text("Rutinas")', /#\/exercises\?seg=templates$/],
      ['button:has-text("Biblioteca de ejercicios")', /#\/exercises\?seg=library$/],
      ['.cfg-data-row', /#\/settings\/data$/],
    ];
    for (const [sel, re] of cases) {
      await go(page, '#/settings');
      await page.locator(sel).first().click();
      await settle(page);
      assert.match(await hash(page), re, sel);
    }
    // Pantallas no raíz con botón atrás.
    for (const r of ['#/settings/week', '#/settings/thresholds', '#/settings/data']) {
      await go(page, r);
      assert.strictEqual(await page.locator('.topbar .back-btn').count(), 1, `${r} sin botón atrás`);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('instalada en la pantalla de inicio: «Instalada ✓»', async () => {
  const app = await setup();
  const { page, context } = app;
  try {
    await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true }));
    await reload(page);
    await go(page, '#/settings');
    assert.strictEqual(await page.locator('.cfg-install').getAttribute('data-installed'), 'yes');
    assert.match(await page.locator('.cfg-install').innerText(), /Instalada ✓/);
    assert.strictEqual(await page.locator('.cfg-steps').count(), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('semana tipo: cambiar un día crea una vigencia desde el lunes (el pasado no cambia), deshacer y restaurar', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/settings/week');
    const rows = page.locator('.cfg-day');
    assert.strictEqual(await rows.count(), 7);
    const names = await page.locator('.cfg-day .cfg-day-name').allTextContents();
    assert.ok(names[0].startsWith('Lunes') && names[6].startsWith('Domingo'), names.join('|'));
    assert.match(names[2], /Hoy/, 'el miércoles es hoy');
    assert.match(await rows.nth(0).innerText(), /Día 1 — Upper pesado/);
    assert.match(await rows.nth(4).innerText(), /Descanso/);
    assert.match(await page.locator('.cfg-intro').innerText(), /Se aplica desde esta semana\. Para cambiar solo una semana concreta usa el Calendario/);
    assert.match(await page.locator('.cfg-week-info').innerText(), /semana tipo inicial/);
    await shot(page, 'settings-week');

    // Viernes (descanso) → ruta en bici.
    await rows.nth(4).click();
    await sheetPanel(page).waitFor();
    await shot(page, 'settings-week-picker');
    await sheetPanel(page).locator('.pick-row', { hasText: 'Ruta en bici' }).click();
    await waitNoSheet(page);
    await settle(page);
    assert.match(await rows.nth(4).innerText(), /Ruta en bici/);
    assert.strictEqual(await rows.nth(4).getAttribute('data-kind'), 'free');
    let s = await settingsOf(page);
    assert.strictEqual(s.weekPatterns.length, 2);
    assert.strictEqual(s.weekPatterns[0].from, '2000-01-01');
    assert.deepStrictEqual(s.weekPatterns[0].days[4], { kind: 'rest' }, 'la vigencia anterior no cambia');
    assert.strictEqual(s.weekPatterns[1].from, WS, 'nueva vigencia desde el lunes de esta semana');
    assert.deepStrictEqual(s.weekPatterns[1].days[4], { kind: 'free', label: 'Ruta en bici', activityKind: 'bike' });
    assert.match(await page.locator('.cfg-week-info').innerText(), /Vigente desde el 21 sep 2026/);
    // Semana pasada: sigue el descanso; esta semana: bici.
    const plans = await page.evaluate(async () => {
      const p = await import('./js/plan.js');
      const st = window.__app.store.settings();
      return [p.patternFor(st, '2026-09-18')[4], p.patternFor(st, '2026-09-25')[4], p.patternFor(st, '2026-10-02')[4]];
    });
    assert.deepStrictEqual(plans[0], { kind: 'rest' });
    assert.strictEqual(plans[1].kind, 'free');
    assert.strictEqual(plans[2].kind, 'free');

    // Segundo cambio la misma semana: se reemplaza la vigencia (no se acumulan).
    await rows.nth(6).click();
    await sheetPanel(page).locator('.pick-row', { hasText: 'Día 3 — Cardio' }).click();
    await waitNoSheet(page);
    await settle(page);
    s = await settingsOf(page);
    assert.strictEqual(s.weekPatterns.length, 2);
    assert.deepStrictEqual(s.weekPatterns[1].days[6], { kind: 'template', templateId: 'tpl_d3' });
    // Deshacer el último cambio.
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await settle(page);
    s = await settingsOf(page);
    assert.deepStrictEqual(s.weekPatterns[1].days[6], { kind: 'rest' });
    assert.match(await rows.nth(6).innerText(), /Descanso/);

    // Persistencia tras recargar (en disco).
    await reload(page);
    await go(page, '#/settings/week');
    assert.match(await page.locator('.cfg-day').nth(4).innerText(), /Ruta en bici/);
    const meta = await idbAll(page, 'meta');
    const disk = meta.find((m) => m.id === 'settings');
    assert.strictEqual(disk.weekPatterns.length, 2);
    assert.strictEqual(disk.weekPatterns[1].days[4].activityKind, 'bike');

    // Restaurar por defecto (con confirmación; cancelar no cambia nada).
    await page.locator('.cfg-restore').click();
    await sheetPanel(page).waitFor();
    assert.match(await sheetPanel(page).innerText(), /L D1 · M D2 · X D3 · J D4 · V — · S D6 · D —/);
    await sheetBtn(page, 'Cancelar').click();
    await waitNoSheet(page);
    assert.strictEqual((await settingsOf(page)).weekPatterns[1].days[4].kind, 'free');
    await page.locator('.cfg-restore').click();
    await sheetBtn(page, 'Restaurar').click();
    await waitNoSheet(page);
    await settle(page);
    s = await settingsOf(page);
    const def = s.weekPatterns[0].days;
    assert.deepStrictEqual(s.weekPatterns.find((p) => p.from === WS).days, def, 'la semana por defecto rige desde esta semana');
    assert.match(await page.locator('.cfg-day').nth(4).innerText(), /Descanso/);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('umbrales: guardado inmediato con coma decimal, pareja mín–máx, persistencia y restaurar por defecto', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await page.evaluate(() => window.__app.store.saveSettings({ lastBackupAt: 1234567 }));
    await go(page, '#/settings/thresholds');
    const inp = (path) => page.locator(`.cfg-stepper[data-path="${path}"] input`);
    const btn = (path, dir) => page.locator(`.cfg-stepper[data-path="${path}"] .stepper-btn[aria-label^="${dir}"]`);
    // Todos los bloques pedidos, cada uno con su explicación.
    const blocks = await page.locator('.cfg-block').evaluateAll((els) => els.map((e) => [e.dataset.block, e.querySelector('.cfg-why')?.textContent.length || 0]));
    assert.deepStrictEqual(blocks.map((b) => b[0]), ['muscles', 'factors', 'progression', 'load', 'runkm', 'stall', 'deload', 'goals', 'backup', 'bodyweight']);
    assert.ok(blocks.every((b) => b[1] > 30), 'cada bloque explica para qué sirve');
    assert.strictEqual(await page.locator('.cfg-range').count(), 16, 'un rango por músculo');
    // Campos: texto con teclado numérico, nunca type=number, fuente ≥ 16 px.
    const inputs = await page.locator('.cfg-stepper input').evaluateAll((els) => els.map((e) => [e.type, e.inputMode, parseFloat(getComputedStyle(e).fontSize)]));
    assert.ok(inputs.length >= 50);
    assert.ok(inputs.every(([t, m, f]) => t === 'text' && ['decimal', 'numeric'].includes(m) && f >= 16), JSON.stringify(inputs.slice(0, 3)));
    assert.strictEqual(await inp('secondaryFactor').getAttribute('inputmode'), 'decimal');
    assert.strictEqual(await inp('stall.sessions').getAttribute('inputmode'), 'numeric');
    // Botones de ± de 44 px como mínimo.
    const sizes = await page.locator('.cfg-stepper .stepper-btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => Math.min(r.width, r.height)));
    assert.ok(Math.min(...sizes) >= 44, `botón de ${Math.min(...sizes)} px`);
    assert.ok(await noHScroll(page));
    await shot(page, 'settings-thresholds');

    // Coma decimal: se guarda mientras se teclea (saveSoon) y al terminar.
    await inp('secondaryFactor').fill('0,75');
    await settle(page, 400);
    assert.strictEqual((await settingsOf(page)).secondaryFactor, 0.75);
    await inp('secondaryFactor').press('Enter');
    await settle(page);
    assert.strictEqual(await inp('secondaryFactor').inputValue(), '0,75');
    // Botón +: 2,5 → 3 kg.
    await btn('increments.upperCompound', 'Sumar').click();
    await settle(page);
    assert.strictEqual((await settingsOf(page)).increments.upperCompound, 3);
    assert.strictEqual(await inp('increments.upperCompound').inputValue(), '3');
    await btn('deload.rpeHigh', 'Restar').click();
    assert.strictEqual((await settingsOf(page)).deload.rpeHigh, 7.5);
    // Peso corporal por defecto con decimales.
    await inp('bodyweightDefault').fill('76,4');
    await inp('bodyweightDefault').press('Enter');
    // Mínimo por encima del máximo → el máximo sube con él.
    await inp('muscleTargets.back.0').fill('30');
    await inp('muscleTargets.back.0').press('Enter');
    await settle(page);
    let s = await settingsOf(page);
    assert.deepStrictEqual(s.muscleTargets.back, [30, 30]);
    assert.strictEqual(await inp('muscleTargets.back.1').inputValue(), '30');
    // Máximo por debajo del mínimo → el mínimo baja.
    await inp('muscleTargets.chest.1').fill('5');
    await inp('muscleTargets.chest.1').press('Enter');
    await settle(page);
    assert.deepStrictEqual((await settingsOf(page)).muscleTargets.chest, [5, 5]);
    // Umbral bajo de carga por encima del alto → el alto sube.
    await inp('loadWarn.low').fill('40');
    await inp('loadWarn.low').press('Enter');
    await settle(page);
    assert.deepStrictEqual((await settingsOf(page)).loadWarn, { low: 40, high: 40 });
    // Fuera de rango: se ajusta al máximo permitido.
    await inp('backupReminderDays').fill('500');
    await inp('backupReminderDays').press('Enter');
    await settle(page);
    assert.strictEqual((await settingsOf(page)).backupReminderDays, 90);
    assert.strictEqual(await inp('backupReminderDays').inputValue(), '90');
    // Vaciar el campo: vuelve al valor guardado.
    await inp('stall.weeks').fill('');
    await inp('stall.weeks').press('Enter');
    await settle(page);
    assert.strictEqual(await inp('stall.weeks').inputValue(), '3');
    assert.strictEqual((await settingsOf(page)).stall.weeks, 3);

    // En disco y tras recargar.
    await settle(page, 400);
    const disk = (await idbAll(page, 'meta')).find((m) => m.id === 'settings');
    assert.strictEqual(disk.secondaryFactor, 0.75);
    assert.strictEqual(disk.bodyweightDefault, 76.4);
    assert.deepStrictEqual(disk.muscleTargets.back, [30, 30]);
    await reload(page);
    await go(page, '#/settings/thresholds');
    assert.strictEqual(await inp('secondaryFactor').inputValue(), '0,75');
    assert.strictEqual(await inp('bodyweightDefault').inputValue(), '76,4');
    assert.strictEqual(await inp('muscleTargets.back.1').inputValue(), '30');
    await page.locator('.cfg-block[data-block="deload"]').scrollIntoViewIfNeeded();
    await shot(page, 'settings-thresholds-2');

    // Restaurar valores por defecto: solo umbrales.
    const before = await settingsOf(page);
    await page.locator('.cfg-restore').click();
    await sheetBtn(page, 'Restaurar').click();
    await waitNoSheet(page);
    await settle(page, 400);
    s = await settingsOf(page);
    assert.strictEqual(s.secondaryFactor, 0.5);
    assert.deepStrictEqual(s.muscleTargets.back, [14, 22]);
    assert.deepStrictEqual(s.increments, { upperCompound: 2.5, lowerCompound: 5, isolation: 1 });
    assert.strictEqual(s.backupReminderDays, 7);
    assert.strictEqual(s.bodyweightDefault, 75);
    assert.deepStrictEqual(s.weekPatterns, before.weekPatterns, 'no toca la semana tipo');
    assert.strictEqual(s.lastBackupAt, 1234567, 'no toca la fecha de la última copia');
    assert.strictEqual(await inp('secondaryFactor').inputValue(), '0,5');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('CRITERIO: exportar copia → borrar todo (doble confirmación) → importar deja los datos IDÉNTICOS', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedData(page);
    // Ajustes guardados hace un rato (el reloj está fijo): anotar la copia no debe dejarles un sello distinto del archivo.
    await page.evaluate(() => {
      const st = window.__app.store;
      return st.restore('meta', { ...st.settings(), updatedAt: Date.now() - 60000 });
    });
    await go(page, '#/settings/data');
    assert.match(await page.locator('.cfg-last-value').innerText(), /Nunca/);
    assert.strictEqual(await page.locator('.cfg-overdue').count(), 1, 'aviso de copia pendiente');
    assert.strictEqual(await page.locator('[data-count="strength"] .cfg-kv-value').innerText(), '3');
    assert.strictEqual(await page.locator('[data-count="activities"] .cfg-kv-value').innerText(), '4');
    assert.strictEqual(await page.locator('[data-count="bodyweight"] .cfg-kv-value').innerText(), '3');
    assert.strictEqual(await page.locator('[data-count="plan"] .cfg-kv-value').innerText(), '1');
    await shot(page, 'settings-data');

    // 1) Exportar: sin hoja de compartir en Chromium → descarga.
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.cfg-export').click()]);
    assert.strictEqual(dl.suggestedFilename(), 'entreno-copia-2026-09-23-1200.json');
    const text = fs.readFileSync(await dl.path(), 'utf8');
    const backup = JSON.parse(text);
    await settle(page);
    assert.strictEqual(backup.app, 'entreno-pwa');
    assert.strictEqual(backup.format, 2); // ronda 6: formato 2 (almacenes context, pastRecords, races)
    assert.deepStrictEqual(Object.keys(backup.data).sort(), [...STORES].sort());
    const fileSettings = backup.data.meta.find((m) => m.id === 'settings');
    assert.strictEqual(fileSettings.lastBackupAt, NOW.getTime(), 'lastBackupAt = ahora DENTRO de la copia');
    assert.strictEqual(fileSettings.secondaryFactor, 0.75);
    assert.strictEqual(backup.data.sessions.length, 7);
    assert.strictEqual(backup.data.plan.length, 1);
    // La app registra la copia.
    let s = await settingsOf(page);
    assert.strictEqual(s.lastBackupAt, NOW.getTime());
    assert.match(await page.locator('.cfg-last-value').innerText(), /23 sep 2026, 12:00/);
    assert.match(await page.locator('.cfg-last-ago').innerText(), /Hoy/);
    assert.strictEqual(await page.locator('.cfg-overdue').count(), 0);
    // El archivo coincide con lo que hay ahora en la app y en disco, ajustes incluidos (también su updatedAt:
    // anotar la copia no le pone un sello posterior al del archivo).
    const live = await page.evaluate(() => window.__app.store.exportData().data);
    for (const st of STORES) {
      assert.deepStrictEqual(byId(live[st]), byId(backup.data[st]), `store ${st}`);
      assert.deepStrictEqual(byId(await idbAll(page, st)), byId(backup.data[st]), `IndexedDB «${st}» = archivo`);
    }
    const diskAtExport = {};
    for (const st of STORES) diskAtExport[st] = byId(await idbAll(page, st));

    // 2) Borrar todo: cancelar en la 1ª y en la 2ª confirmación no borra nada.
    await page.locator('.cfg-wipe').click();
    await sheetPanel(page).waitFor();
    assert.match(await sheetPanel(page).innerText(), /exporta una copia/i);
    await sheetBtn(page, 'Cancelar').click();
    await waitNoSheet(page);
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Continuar').click();
    await page.waitForFunction(() => document.querySelectorAll('.sheet-overlay').length === 1 && document.querySelector('.sheet-overlay input'));
    const confirmBtn = sheetBtn(page, 'Borrar todo');
    assert.ok(await confirmBtn.isDisabled(), 'sin escribir BORRAR no se puede confirmar');
    await sheetPanel(page).locator('input').fill('BORRA');
    assert.ok(await confirmBtn.isDisabled());
    await shot(page, 'settings-wipe-confirm');
    await sheetBtn(page, 'Cancelar').click();
    await waitNoSheet(page);
    assert.strictEqual((await storeAll(page, 'sessions')).length, 7, 'cancelar no borra');
    // Ahora sí.
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Continuar').click();
    await page.waitForFunction(() => document.querySelector('.sheet-overlay input'));
    await sheetPanel(page).locator('input').fill('borrar');
    assert.ok(!(await sheetBtn(page, 'Borrar todo').isDisabled()));
    await sheetBtn(page, 'Borrar todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 0, null, { timeout: 5000 });
    await settle(page, 400);
    for (const st of ['sessions', 'plan', 'bodyweight', 'checkins', 'goals']) {
      assert.strictEqual((await storeAll(page, st)).length, 0, `${st} en memoria`);
      assert.strictEqual((await idbAll(page, st)).length, 0, `${st} en disco`);
    }
    s = await settingsOf(page);
    assert.strictEqual(s.secondaryFactor, 0.5, 'ajustes por defecto');
    assert.strictEqual(s.lastBackupAt, null);
    assert.strictEqual(s.weekPatterns.length, 1);
    assert.ok((await storeAll(page, 'templates')).length === 5, 'plantillas iniciales');
    assert.ok(!(await storeAll(page, 'exercises')).some((e) => e.id === 'ex_custom'));

    // 3) Importar el mismo archivo.
    await go(page, '#/settings/data');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
    await fc.setFiles({ name: dl.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
    await sheetPanel(page).waitFor();
    const summary = await sheetPanel(page).innerText();
    assert.match(summary, /23 sep 2026, 12:00/, 'fecha de la copia');
    assert.match(summary, /3 sesiones de fuerza/);
    assert.match(summary, /4 actividades/);
    assert.match(summary, /5 plantillas/);
    assert.match(summary, /\d+ ejercicios/);
    assert.match(summary, /3 pesajes/);
    assert.match(summary, /SUSTITUYE/);
    await shot(page, 'settings-import-confirm');
    await sheetBtn(page, 'Sustituir todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 7, null, { timeout: 5000 });
    await settle(page, 500);

    // Idéntico: en memoria (mismo orden incluido) y en disco.
    const after = await page.evaluate(() => window.__app.store.exportData().data);
    assert.deepStrictEqual(after, backup.data, 'store.exportData().data idéntico al exportado');
    for (const st of STORES) {
      assert.deepStrictEqual(byId(await idbAll(page, st)), byId(backup.data[st]), `IndexedDB «${st}» idéntico`);
      assert.deepStrictEqual(byId(await idbAll(page, st)), diskAtExport[st], `IndexedDB «${st}» igual que al exportar`);
    }
    // Tras recargar (cerrar y abrir la app) sigue idéntico y coherente: última copia = la importada.
    await reload(page);
    const reloaded = await page.evaluate(() => window.__app.store.exportData().data);
    for (const st of STORES) assert.deepStrictEqual(byId(reloaded[st]), byId(backup.data[st]), `tras recargar: ${st}`);
    s = await settingsOf(page);
    assert.strictEqual(s.lastBackupAt, NOW.getTime());
    assert.strictEqual(s.secondaryFactor, 0.75);
    await go(page, '#/settings/data');
    assert.strictEqual(await page.locator('.cfg-overdue').count(), 0);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('importar: archivo que no es JSON, copia de otra app o cancelar no tocan los datos', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedData(page);
    const snapshot = await page.evaluate(() => window.__app.store.exportData().data);
    const tryImport = async (name, content) => {
      await go(page, '#/settings/data');
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
      await fc.setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(content, 'utf8') });
      await sheetPanel(page).waitFor();
      return sheetPanel(page).innerText();
    };
    let msg = await tryImport('notas.txt', 'esto no es una copia');
    assert.match(msg, /No se puede importar/);
    assert.match(msg, /no tiene formato JSON/);
    await shot(page, 'settings-import-error');
    await sheetBtn(page, 'Entendido').click();
    await waitNoSheet(page);
    msg = await tryImport('otra.json', JSON.stringify({ app: 'otra', format: 1, data: {} }));
    assert.match(msg, /no es una copia de esta app/);
    await sheetBtn(page, 'Entendido').click();
    await waitNoSheet(page);
    msg = await tryImport('vacia.json', '');
    assert.match(msg, /vacío/);
    await sheetBtn(page, 'Entendido').click();
    await waitNoSheet(page);
    // Copia válida, pero se cancela en el resumen.
    const other = await page.evaluate(() => {
      const o = window.__app.store.exportData();
      o.data.sessions = [];
      return JSON.stringify(o);
    });
    msg = await tryImport('buena.json', other);
    assert.match(msg, /¿Importar esta copia\?/);
    assert.match(msg, /0 sesiones de fuerza/);
    await sheetBtn(page, 'Cancelar').click();
    await waitNoSheet(page);
    const now = await page.evaluate(() => window.__app.store.exportData().data);
    assert.deepStrictEqual(now, snapshot, 'los datos no han cambiado');
    assert.strictEqual(await hash(page), '#/settings/data');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('exportar con la hoja de compartir: compartido anota la copia; cancelado no cambia nada', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedData(page);
    await go(page, '#/settings/data');
    await stubShare(page, 'abort');
    await page.locator('.cfg-export').click();
    await settle(page, 300);
    assert.strictEqual((await settingsOf(page)).lastBackupAt, null, 'cancelado: no se anota');
    assert.match(await page.locator('.cfg-last-value').innerText(), /Nunca/);
    await stubShare(page, 'ok');
    await page.locator('.cfg-export').click();
    await settle(page, 300);
    const [f] = await shared(page);
    assert.strictEqual(f.name, 'entreno-copia-2026-09-23-1200.json');
    assert.strictEqual(f.type, 'application/json');
    assert.strictEqual(JSON.parse(f.text).data.meta.find((m) => m.id === 'settings').lastBackupAt, NOW.getTime());
    assert.strictEqual((await settingsOf(page)).lastBackupAt, NOW.getTime());
    assert.match(await page.locator('.toast').innerText(), /Copia exportada/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('borrar todo e importar eliminan los borradores de localStorage (sin «Borrador recuperado» de los datos anteriores)', async () => {
  const app = await setup();
  const { page } = app;
  const appKeys = () => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('draft:') || k.startsWith('entreno.')).sort());
  /** Carrera a medias (sin duración) y ejercicio nuevo a medias. */
  async function makeDrafts(km, name) {
    await go(page, '#/activity/new?kind=run');
    await page.fill('[aria-label="Distancia (km)"]', km);
    await page.fill('[aria-label="Notas"]', 'nota a medias');
    await settle(page);
    await go(page, '#/exercise/new');
    await page.locator('input[aria-label="Nombre del ejercicio"]').fill(name);
    await settle(page);
    const keys = await appKeys();
    assert.ok(keys.includes('draft:activity:run') && keys.includes('entreno.exercise.draft'), keys.join(', '));
  }
  async function expectNoDrafts() {
    await go(page, '#/activity/new?kind=run');
    assert.strictEqual(await page.locator('.act-restored').count(), 0, 'sin «Borrador recuperado» en la carrera');
    assert.strictEqual(await page.locator('[aria-label="Distancia (km)"]').inputValue(), '');
    await go(page, '#/exercise/new');
    assert.strictEqual(await page.locator('.lib-draft').count(), 0, 'sin «Borrador recuperado» en el ejercicio');
    assert.strictEqual(await page.locator('input[aria-label="Nombre del ejercicio"]').inputValue(), '');
  }
  try {
    await seedData(page);
    const backupText = await page.evaluate(() => JSON.stringify(window.__app.store.exportData()));
    await page.evaluate(() => localStorage.setItem('otra-app', 'conservar'));

    // 1) Borrar todo.
    await makeDrafts('12', 'Borrador secreto');
    await go(page, '#/settings/data');
    await page.locator('.cfg-wipe').click();
    await sheetBtn(page, 'Continuar').click();
    await page.waitForFunction(() => document.querySelector('.sheet-overlay input'));
    await sheetPanel(page).locator('input').fill('BORRAR');
    await sheetBtn(page, 'Borrar todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 0, null, { timeout: 5000 });
    await settle(page, 300);
    assert.deepStrictEqual(await appKeys(), [], 'borrado: ni borradores ni estado de pantallas');
    assert.strictEqual(await page.evaluate(() => localStorage.getItem('otra-app')), 'conservar', 'claves ajenas intactas');
    await expectNoDrafts();

    // 2) Importar una copia.
    await makeDrafts('7', 'Otro borrador');
    await go(page, '#/settings/data');
    const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
    await fc.setFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(backupText, 'utf8') });
    await sheetBtn(page, 'Sustituir todo').click();
    await page.waitForFunction(() => location.hash === '#/today' && window.__app.store.count('sessions') === 7, null, { timeout: 5000 });
    await settle(page, 300);
    assert.deepStrictEqual(await appKeys(), [], 'importado: sin borradores de antes');
    await expectNoDrafts();
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('CSV de fuerza y de cardio: archivos separados, formato Excel (;, coma, BOM) o estándar (,, punto)', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/settings/data');
    // Sin datos: no se genera un CSV vacío.
    await stubShare(page, 'ok');
    await page.locator('.cfg-csv-fuerza').click();
    await settle(page);
    assert.strictEqual((await shared(page)).length, 0);
    assert.match(await page.locator('.toast').innerText(), /no hay series/);

    await seedData(page);
    await go(page, '#/today');
    await go(page, '#/settings/data');
    await stubShare(page, 'ok');
    assert.match(await page.locator('.cfg-csv-fuerza').innerText(), /12 series/);
    assert.match(await page.locator('.cfg-csv-cardio').innerText(), /4 actividades/);
    assert.strictEqual(await page.locator('.cfg-csv-format .seg-btn.active').innerText(), 'Excel (español)');
    await page.locator('.cfg-block[data-block="csv"]').scrollIntoViewIfNeeded();
    await shot(page, 'settings-data-csv');

    await page.locator('.cfg-csv-fuerza').click();
    await settle(page);
    await page.locator('.cfg-csv-cardio').click();
    await settle(page);
    let [fz, cd] = await shared(page);
    assert.strictEqual(fz.name, 'entreno-fuerza-2026-09-23-1200.csv');
    assert.strictEqual(fz.type, 'text/csv');
    assert.deepStrictEqual(fz.head, [0xef, 0xbb, 0xbf], 'BOM UTF-8');
    let lines = fz.text.replace(/^﻿/, '').split('\r\n');
    assert.ok(lines[0].startsWith('Fecha;Sesión;Ejercicio;Músculo principal;Orden ejercicio;Nº serie;Tipo de serie;Peso (kg);Reps'), lines[0]);
    assert.strictEqual(lines[0].split(';').length, 21);
    assert.ok(lines.some((l) => l.includes(';82,5;')), 'coma decimal');
    assert.ok(fz.text.includes('"Nota; con ""comillas""\ny salto"'), 'nota de sesión escapada');
    // 12 series hechas + cabecera + línea final vacía.
    assert.strictEqual(lines.length, 14);
    assert.strictEqual(cd.name, 'entreno-cardio-2026-09-23-1200.csv');
    assert.strictEqual(cd.type, 'text/csv');
    const cl = cd.text.replace(/^﻿/, '').split('\r\n');
    assert.strictEqual(cl.length, 6);
    assert.ok(cl[0].startsWith('Fecha;Tipo;Subtipo;Distancia (km)'));
    assert.ok(cl.some((l) => l.startsWith('2026-09-16;Carrera;Rodaje / Z2;8,4;45;')), cl.join('\n'));

    // Formato estándar: se guarda al instante y persiste.
    await page.locator('.cfg-csv-format .seg-btn', { hasText: 'Estándar' }).click();
    await settle(page);
    assert.strictEqual((await settingsOf(page)).csv.excel, false);
    assert.match(await page.locator('.cfg-csv-hint').innerText(), /punto decimal/);
    await page.locator('.cfg-csv-fuerza').click();
    await settle(page);
    fz = (await shared(page))[2];
    assert.notDeepStrictEqual(fz.head, [0xef, 0xbb, 0xbf], 'sin BOM');
    lines = fz.text.split('\r\n');
    assert.strictEqual(lines[0].split(',').length, 21);
    assert.ok(lines.some((l) => l.includes(',82.5,')), 'punto decimal');
    await reload(page);
    await go(page, '#/settings/data');
    assert.strictEqual(await page.locator('.cfg-csv-format .seg-btn.active').innerText(), 'Estándar');
    assert.strictEqual((await idbAll(page, 'meta')).find((m) => m.id === 'settings').csv.excel, false);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('almacenamiento: persistente, espacio usado y recuento por tipo', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedData(page);
    await go(page, '#/settings/data');
    await page.waitForFunction(() => !document.querySelector('.cfg-usage')?.textContent.includes('Calculando'));
    const usage = await page.locator('.cfg-usage').innerText();
    assert.match(usage, /(B|KB|MB|GB)|No disponible/);
    const persist = await page.locator('.cfg-persist').innerText();
    assert.match(persist, /^(Sí|No|No disponible)$/);
    const status = await page.evaluate(() => window.__app.store.persistStatus());
    assert.strictEqual(persist, status.persisted ? 'Sí' : status.supported ? 'No' : 'No disponible');
    // El botón de volver a pedirlo solo aparece si no está concedido.
    assert.strictEqual(await page.locator('.cfg-persist-btn').isVisible(), !status.persisted && status.supported);
    const counts = Object.fromEntries(await page.locator('.cfg-counts .cfg-kv').evaluateAll((els) => els.map((e) => [e.dataset.count, e.querySelector('.cfg-kv-value').textContent])));
    assert.deepStrictEqual({ ...counts, exercises: undefined }, { strength: '3', activities: '4', bodyweight: '3', templates: '5', plan: '1', checkins: '1', goals: '1', context: '0', exercises: undefined });
    assert.match(counts.exercises, /^\d+ \(1 propio\)$/);
    await page.locator('.cfg-block[data-block="storage"]').scrollIntoViewIfNeeded();
    await shot(page, 'settings-data-storage');
    // Volver a pedir persistencia (si procede) actualiza el estado sin errores.
    if (await page.locator('.cfg-persist-btn').isVisible()) {
      await page.locator('.cfg-persist-btn').click();
      await settle(page, 300);
      assert.match(await page.locator('.toast').innerText(), /persistente|no lo ha concedido/);
    }
    await page.locator('.cfg-danger').scrollIntoViewIfNeeded();
    await shot(page, 'settings-data-bottom');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
