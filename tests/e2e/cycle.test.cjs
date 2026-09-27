// E2E del ciclo menstrual (ronda 5, docs/MEJORAS5.md §4): #/cycle, hoja del día, tarjeta de Hoy y marcas en el
// calendario y en la gráfica de peso. Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/cycle.test.cjs
// La fecha se fija con page.clock: domingo 27 de septiembre de 2026.
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll, shot } = require('./helpers.cjs');

const TODAY = '2026-09-27';
const at = (date, time = '10:00:00') => new Date(`${date}T${time}`);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const settle = (page, ms = 250) => page.waitForTimeout(ms);
const sheetOpen = '.sheet-overlay.open';

/** App con la fecha fijada; `sex`: 'female' | 'male' | null (perfil sin contestar). */
async function setup({ date = TODAY, sex = 'female', contraception = null } = {}) {
  const app = await openApp();
  await app.page.clock.setFixedTime(at(date));
  await reload(app.page);
  await app.page.evaluate(async ({ sex, contraception }) => {
    const s = window.__app.store;
    const st = s.settings();
    st.profile.sex = sex;
    if (contraception) st.profile.contraception = contraception;
    await s.save('meta', st);
  }, { sex, contraception });
  return app;
}

/**
 * Siembra 3 ciclos completos + el actual (reglas del 10 jun, 8 jul, 6 ago y 4 sep) con síntomas, y, si `extra`,
 * check-ins, sesiones de fuerza y pesajes realistas (energía más baja antes de la regla, retención de líquidos y
 * algo menos de fuerza los días de regla).
 */
function seedCycles(page, { extra = true } = {}) {
  return page.evaluate(async (extra) => {
    const s = window.__app.store;
    const logic = await import('./js/cycle-logic.js');
    const pad = (n) => String(n).padStart(2, '0');
    const add = (d, n) => { const t = new Date(`${d}T12:00:00`); t.setDate(t.getDate() + n); return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`; };
    const days = [];
    const per = (start, n, flows = [], sym = {}) => { for (let i = 0; i < n; i++) days.push({ id: add(start, i), flow: flows[i] || (i >= n - 1 ? 'light' : 'medium'), symptoms: sym[i] || [], notes: '' }); };
    per('2026-06-10', 5, ['heavy'], { 0: ['cramps', 'fatigue'], 1: ['cramps', 'back_pain'] });
    per('2026-07-08', 5, ['heavy', 'heavy'], { 0: ['cramps'], 1: ['cramps', 'bloating'] });
    per('2026-08-06', 4, [], { 0: ['cramps', 'headache'], 1: ['cramps'] });
    per('2026-09-04', 5, [], { 0: ['cramps'], 1: ['cramps', 'fatigue'] });
    days.push({ id: '2026-07-04', flow: 'none', symptoms: ['bloating', 'cravings'], notes: '' });
    days.push({ id: '2026-08-02', flow: 'none', symptoms: ['bloating', 'breast'], notes: '' });
    days.push({ id: '2026-09-24', flow: 'none', symptoms: ['bloating'], notes: 'Hinchada' });
    await Promise.all(days.map((d) => s.save('cycle', d)));
    if (!extra) return;
    const prof = { sex: 'female', cycleTracking: true, cycleLengthGuess: 28, periodLengthGuess: 5 };
    const info = logic.cycleInfo(days, prof, '2026-09-27');
    const jobs = [];
    let k = 0;
    for (let d = '2026-06-10'; d <= '2026-09-27'; d = add(d, 1), k++) {
      const ph = logic.phaseForDate(info, d)?.phase;
      if (k % 2 === 0) jobs.push(s.save('checkins', { id: `ci_${d}`, date: d, timing: 'pre', sessionId: null, sleep: ph === 'luteal' || ph === 'premenstrual' ? 2 : 3, energy: ph === 'premenstrual' ? 1 : ph === 'menstrual' ? 2 : 3, soreness: 2 }));
      const noise = [0, 0.2, -0.1, 0.1, -0.2, 0][k % 6];
      jobs.push(s.save('bodyweight', { id: d, kg: Math.round((61.5 + noise + (ph === 'menstrual' || ph === 'premenstrual' ? 0.7 : 0)) * 10) / 10 }));
      if (k % 3 === 0) {
        const w = ph === 'menstrual' ? 58 : 60 + Math.floor(k / 21) * 1.25;
        const t = new Date(`${d}T18:00:00`).getTime();
        jobs.push(s.save('sessions', {
          id: `ses_${d}`, kind: 'strength', date: d, planDate: d, templateId: null, templateName: 'Sesión libre', status: 'done',
          startedAt: t, endedAt: t + 3600000, durationMin: 60, rpe: ph === 'menstrual' ? 8 : 7, notes: '', parentId: null, cursor: 0, templateItemIds: [],
          exercises: [{
            id: `se_${d}`, exerciseId: 'sentadilla', exName: 'Sentadilla', templateItemId: null, alternatives: [], target: { sets: 3, repMin: 5, repMax: 5 },
            notes: '', section: '', groupId: null, groupType: null,
            sets: [0, 1, 2].map((j) => ({ id: `set_${d}_${j}`, type: 'effective', weight: w, reps: 5, repsR: null, rir: 2, timeSec: null, distanceM: null, heightCm: null, note: '', done: true, doneAt: t + j * 60000 })),
          }],
        }));
      }
    }
    await Promise.all(jobs);
  }, extra);
}

/** Captura con la parte de arriba de `sel` justo bajo la cabecera. */
async function shotAt(page, sel, name) {
  await page.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => window.scrollBy(0, -66));
  await settle(page, 150);
  return shot(page, name);
}

// ---------------------------------------------------------------------------

test('sin modo mujer: estado vacío que explica y lleva al perfil; sin tarjeta de Hoy ni marcas', async () => {
  const app = await setup({ sex: null });
  const { page } = app;
  try {
    await seedCycles(page, { extra: false });
    await go(page, '#/cycle');
    assert.ok(await page.locator('.cyc-disabled').isVisible());
    assert.match(await page.locator('.cyc-disabled').innerText(), /modo mujer/);
    assert.match(await page.locator('.cyc-disabled').innerText(), /solo se guardan en este iPhone/);
    assert.strictEqual(await page.locator('.cyc-hero').count(), 0);
    assert.strictEqual(await page.evaluate(async () => (await import('./js/views/cycle.js')).cycleTodayCard({ today: '2026-09-27' })), null);
    // Hombre: ni marcas en el calendario ni franjas en la gráfica de peso
    await page.evaluate(async () => { const s = window.__app.store; const st = s.settings(); st.profile.sex = 'male'; await s.save('meta', st); });
    await go(page, '#/calendar?view=month&month=2026-09');
    assert.strictEqual(await page.locator('.cal-cyc-mark').count(), 0);
    assert.strictEqual(await page.locator('[data-cycle]').count(), 0);
    await go(page, '#/bodyweight');
    assert.strictEqual(await page.locator('[data-chart="bodyweight"][data-cycle]').count(), 0);
    await go(page, '#/cycle');
    await shot(page, 'cycle-disabled');
    await page.getByRole('button', { name: 'Ir al perfil' }).click();
    await page.waitForFunction(() => location.hash === '#/settings/profile');
    // Mujer con el seguimiento desactivado
    await page.evaluate(async () => { const s = window.__app.store; const st = s.settings(); st.profile.sex = 'female'; st.profile.cycleTracking = false; await s.save('meta', st); });
    await go(page, '#/cycle');
    assert.match(await page.locator('.cyc-disabled').innerText(), /desactivado/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('«Me ha venido hoy» crea el día (moderado), persiste al recargar, se deshace y pasa a «Ha terminado»', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/cycle');
    assert.match(await page.locator('.cyc-ring').innerText(), /Sin datos/);
    assert.match(await page.locator('.cyc-hero').innerText(), /Me ha venido hoy/);
    assert.match(await page.locator('.cyc-privacy').innerText(), /Estos datos solo se guardan en este iPhone \(y en tus copias de seguridad\)/);
    await shot(page, 'cycle-empty');
    const start = page.locator('.cyc-main-btn[data-act="start"]');
    const box = await start.boundingBox();
    assert.ok(box.height >= 48, `botón grande (${box.height}px)`);
    await start.click();
    await settle(page);
    let rows = await idbAll(page, 'cycle');
    assert.deepStrictEqual(rows.map((r) => [r.id, r.flow]), [[TODAY, 'medium']]);
    assert.strictEqual(await page.locator('.cyc-main-btn[data-act="end"]').innerText(), 'Ha terminado');
    assert.match(await page.locator('.cyc-ring').innerText(), /1[\s\S]*Regla/);
    // Deshacer
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await settle(page);
    assert.deepStrictEqual(await idbAll(page, 'cycle'), []);
    assert.strictEqual(await page.locator('.cyc-main-btn[data-act="start"]').count(), 1);
    // Otra vez y recarga: sigue en disco y en pantalla
    await page.locator('.cyc-main-btn[data-act="start"]').click();
    await settle(page);
    await reload(page);
    await go(page, '#/cycle');
    rows = await idbAll(page, 'cycle');
    assert.deepStrictEqual(rows.map((r) => [r.id, r.flow]), [[TODAY, 'medium']]);
    assert.strictEqual(await page.locator('.cyc-main-btn[data-act="end"]').count(), 1);
    assert.strictEqual(await page.locator(`.cyc-cal-day[data-date="${TODAY}"].m-period`).count(), 1);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('«Ha terminado»: elige el último día, rellena los días sin anotar y se puede deshacer', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await page.evaluate(() => window.__app.store.save('cycle', { id: '2026-09-24', flow: 'heavy', symptoms: ['cramps'], notes: '' }));
    await go(page, '#/cycle');
    assert.match(await page.locator('.cyc-kpis').innerText(), /Regla\s+Día 4/);
    await page.locator('.cyc-main-btn[data-act="end"]').click();
    await page.waitForSelector(`${sheetOpen} .cyc-end-opts`);
    assert.match(await page.locator(`${sheetOpen} .sheet-msg`).innerText(), /Empezó el 24 sep/);
    await page.locator(`${sheetOpen} .cyc-end-opts button[data-date="2026-09-26"]`).click();
    await settle(page, 450);
    const rows = (await idbAll(page, 'cycle')).sort((a, b) => (a.id < b.id ? -1 : 1));
    assert.deepStrictEqual(rows.map((r) => [r.id, r.flow, !!r.auto, !!r.ended]), [
      ['2026-09-24', 'heavy', false, false],
      ['2026-09-25', 'medium', true, false],
      ['2026-09-26', 'medium', true, true],
    ]);
    assert.strictEqual(await page.locator('.cyc-main-btn[data-act="start"]').count(), 1, 'ya no está en curso');
    assert.strictEqual(await page.locator('.cyc-cal-day.m-period').count(), 3);
    assert.match(await page.locator('.toast').innerText(), /Regla terminada: 3 días/);
    // Deshacer: vuelve a estar en curso, solo con el día anotado
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await settle(page);
    assert.deepStrictEqual((await idbAll(page, 'cycle')).map((r) => [r.id, !!r.ended]), [['2026-09-24', false]]);
    assert.strictEqual(await page.locator('.cyc-main-btn[data-act="end"]').count(), 1);
    // Otra vez, con «Ayer»; el día rellenado lo dice en su hoja
    await page.locator('.cyc-main-btn[data-act="end"]').click();
    await page.waitForSelector(`${sheetOpen} .cyc-end-opts`);
    await shot(page, 'cycle-end-sheet');
    await page.locator(`${sheetOpen} .cyc-end-opts button`, { hasText: 'Ayer' }).click();
    await settle(page, 450);
    assert.strictEqual((await idbAll(page, 'cycle')).find((r) => r.id === '2026-09-26')?.ended, true);
    await page.locator('.cyc-cal-day[data-date="2026-09-25"]').click();
    await page.waitForSelector(`${sheetOpen} .cyc-day`);
    assert.ok(await page.locator(`${sheetOpen} .cyc-auto-note`).isVisible());
    assert.strictEqual(await page.locator(`${sheetOpen} .cyc-flow .chip.active`).innerText(), 'Moderado');
    await page.locator(`${sheetOpen} .sheet-actions .btn`, { hasText: 'Listo' }).click();
    await settle(page, 400);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('hoja «Registrar día»: sangrado y síntomas con chips, notas, guardado inmediato, persistencia y borrar con deshacer', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await go(page, '#/cycle');
    await page.locator('.cyc-log-btn').click();
    await page.waitForSelector(`${sheetOpen} .cyc-day`);
    assert.strictEqual(await page.locator(`${sheetOpen} .sheet-title`).innerText(), 'Hoy');
    assert.deepStrictEqual(await page.locator(`${sheetOpen} .cyc-flow .chip`).allInnerTexts(), ['Nada', 'Manchado', 'Leve', 'Moderado', 'Abundante']);
    assert.strictEqual(await page.locator(`${sheetOpen} .cyc-flow .chip.active`).innerText(), 'Nada');
    assert.strictEqual(await page.locator(`${sheetOpen} .cyc-sym .chip`).count(), 10);
    await shot(page, 'cycle-day-sheet');
    // Síntomas sin sangrado: se guarda al momento
    await page.locator(`${sheetOpen} .cyc-sym .chip`, { hasText: 'Hinchazón' }).click();
    await page.locator(`${sheetOpen} .cyc-sym .chip`, { hasText: 'Dolor de cabeza' }).click();
    await settle(page);
    let rows = await idbAll(page, 'cycle');
    assert.deepStrictEqual(rows.map((r) => [r.id, r.flow, r.symptoms]), [[TODAY, 'none', ['bloating', 'headache']]]);
    // Sangrado leve y notas
    await page.locator(`${sheetOpen} .cyc-flow .chip`, { hasText: 'Leve' }).click();
    await page.locator(`${sheetOpen} .cyc-notes`).fill('Algo de dolor por la mañana');
    await settle(page, 700);
    rows = await idbAll(page, 'cycle');
    assert.strictEqual(rows[0].flow, 'light');
    assert.strictEqual(rows[0].notes, 'Algo de dolor por la mañana');
    // Otra fecha desde la misma hoja
    await page.locator(`${sheetOpen} .cyc-day-date`).fill('2026-09-20');
    await page.locator(`${sheetOpen} .cyc-day-date`).dispatchEvent('change');
    await settle(page);
    assert.match(await page.locator(`${sheetOpen} .sheet-title`).innerText(), /Domingo 20 sep/);
    await page.locator(`${sheetOpen} .cyc-sym .chip`, { hasText: 'Acné' }).click();
    await settle(page);
    await page.locator(`${sheetOpen} .sheet-actions .btn`, { hasText: 'Listo' }).click();
    await settle(page, 400);
    assert.strictEqual((await idbAll(page, 'cycle')).length, 2);

    // Recarga → el día sigue ahí (calendario: regla + síntomas) y su hoja muestra lo guardado
    await reload(page);
    await go(page, '#/cycle');
    const cell = page.locator(`.cyc-cal-day[data-date="${TODAY}"]`);
    assert.match(await cell.getAttribute('class'), /m-period/);
    assert.match(await cell.getAttribute('class'), /m-sym/);
    assert.match(await page.locator('.cyc-cal-day[data-date="2026-09-20"]').getAttribute('class'), /m-sym/);
    await cell.click();
    await page.waitForSelector(`${sheetOpen} .cyc-day`);
    assert.strictEqual(await page.locator(`${sheetOpen} .cyc-flow .chip.active`).innerText(), 'Leve');
    assert.deepStrictEqual(await page.locator(`${sheetOpen} .cyc-sym .chip.active`).allInnerTexts(), ['Hinchazón', 'Dolor de cabeza']);
    assert.strictEqual(await page.locator(`${sheetOpen} .cyc-notes`).inputValue(), 'Algo de dolor por la mañana');
    // Borrar con deshacer
    await page.locator(`${sheetOpen} .cyc-day-del`).click();
    await settle(page, 400);
    assert.strictEqual((await idbAll(page, 'cycle')).length, 1);
    await page.locator('.toast .toast-action', { hasText: 'Deshacer' }).click();
    await settle(page);
    const back = (await idbAll(page, 'cycle')).find((r) => r.id === TODAY);
    assert.deepStrictEqual([back.flow, back.symptoms], ['light', ['bloating', 'headache']]);
    // Quitarlo todo (Nada y sin síntomas ni notas) elimina el registro
    await page.locator('.cyc-cal-day[data-date="2026-09-20"]').click();
    await page.waitForSelector(`${sheetOpen} .cyc-day`);
    await page.locator(`${sheetOpen} .cyc-sym .chip`, { hasText: 'Acné' }).click();
    await settle(page);
    assert.strictEqual((await idbAll(page, 'cycle')).some((r) => r.id === '2026-09-20'), false);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('con 3 ciclos: anillo, próxima regla con rango, calendario, «Tus ciclos», «Cómo te afecta», consejos (capturas)', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedCycles(page);
    await go(page, '#/cycle');
    await settle(page, 300);
    // Cabecera: anillo con las fases, día y fase estimada, próxima regla con rango
    const ring = page.locator('.cyc-ring');
    assert.match(await ring.getAttribute('aria-label'), /^Día 24 · fase lútea \(estimada\)\. Próxima regla ~2–4 oct$/);
    assert.match(await ring.innerText(), /24[\s\S]*Fase lútea[\s\S]*estimada/);
    const phases = await page.locator('.cyc-ring-svg .cyc-seg').evaluateAll((els) => [...new Set(els.map((e) => e.dataset.phase))]);
    assert.deepStrictEqual(phases, ['menstrual', 'follicular', 'ovulation', 'luteal', 'premenstrual']);
    assert.strictEqual(await page.locator('.cyc-ring-svg .cyc-marker').count(), 1);
    assert.deepStrictEqual(await page.locator('.cyc-legend-item').allInnerTexts(), ['Regla', 'Folicular', 'Ovulación aprox.', 'Lútea', 'Premenstrual']);
    assert.match(await page.locator('.cyc-kpis').innerText(), /Próxima regla\s+~2–4 oct\s+en 5–7 días/);
    assert.match(await page.locator('.cyc-basis').innerText(), /Estimado con tus 3 últimos ciclos \(media de 28,7 días\)/);
    assert.match(await page.locator('.cyc-hero-tip').innerText(), /cansancio/);
    assert.strictEqual(await page.locator('.cyc-hero .cyc-actions .btn').count(), 2);
    assert.strictEqual(await page.locator('section.cyc-ins').count(), 0, 'sin alertas con ciclos normales');
    await shot(page, 'cycle-top');
    assert.ok(await noHScroll(page));

    // Calendario: regla anotada (relleno), prevista (punteada, oct), ovulación aprox., síntomas, nota
    const cls = (d) => page.locator(`.cyc-cal-day[data-date="${d}"]`).getAttribute('class');
    for (const d of ['2026-09-04', '2026-09-08']) assert.match(await cls(d), /m-period/);
    assert.match(await cls('2026-09-04'), /m-sym/);
    assert.match(await cls('2026-09-24'), /m-sym/);
    assert.doesNotMatch(await cls('2026-09-09'), /m-period/);
    const ov = await page.locator('.cyc-cal-day.m-ov').evaluateAll((els) => els.map((e) => e.dataset.date));
    assert.deepStrictEqual(ov, ['2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']);
    assert.match(await cls('2026-10-03'), /m-predicted/);
    assert.match(await page.locator('.cyc-cal-note').innerText(), /no sirve como método anticonceptivo/);
    assert.match(await page.locator('.cyc-cal-legend').innerText(), /Regla\s+Prevista\s+Ovulación aprox\.\s+Síntomas/);
    await shotAt(page, '.cyc-cal', 'cycle-calendar');
    await page.getByRole('button', { name: 'Mes siguiente' }).click();
    assert.strictEqual(await page.locator('.cyc-cal-title').innerText(), 'Octubre 2026');
    const pred = await page.locator('.cyc-cal-day.m-predicted:not(.is-out)').evaluateAll((els) => els.map((e) => e.dataset.date));
    assert.deepStrictEqual(pred.slice(0, 5), ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
    assert.strictEqual(await page.locator('div.cyc-cal-day[data-date="2026-10-10"]').count(), 1, 'días futuros: no se pueden tocar');
    await page.getByRole('button', { name: 'Mes anterior' }).click();
    await page.getByRole('button', { name: 'Mes anterior' }).click();
    assert.strictEqual(await page.locator('.cyc-cal-title').innerText(), 'Agosto 2026');
    assert.strictEqual(await page.locator('.cyc-cal-day.m-period:not(.is-out)').count(), 4);
    await page.locator('.cyc-cal-today').click();
    assert.strictEqual(await page.locator('.cyc-cal-title').innerText(), 'Septiembre 2026');

    // Tus ciclos: media, variación, regla media, gráfica y lista
    const hist = page.locator('.cyc-hist');
    assert.match(await hist.innerText(), /Ciclo medio\s+28,7 d\s+3 ciclos/);
    assert.match(await hist.innerText(), /Variación\s+1 d\s+regular/);
    assert.match(await hist.innerText(), /Regla media\s+4,8 d/);
    assert.strictEqual(await hist.locator('.chart-svg').count(), 1);
    assert.strictEqual(await hist.locator('.cyc-cycle-row').count(), 4);
    assert.match(await hist.locator('.cyc-cycle-row').nth(1).innerText(), /6 ago – 3 sep[\s\S]*regla 4 días[\s\S]*29 días/);
    await shotAt(page, '.cyc-hist', 'cycle-history');
    // Tocar un ciclo lleva el calendario a su mes
    await hist.locator('.cyc-cycle-row[data-start="2026-07-08"]').click();
    await settle(page, 500);
    assert.strictEqual(await page.locator('.cyc-cal-title').innerText(), 'Julio 2026');

    // Cómo te afecta: medias por fase con sus datos + nota de la evidencia
    const eff = page.locator('.cyc-effect');
    assert.strictEqual(await eff.locator('.cyc-eff-phase').count(), 5);
    assert.deepStrictEqual(await eff.locator('.cyc-eff-th').allInnerTexts(), ['Energía', 'Sueño', 'RPE', 'Fuerza', 'Peso kg']);
    const pre = await eff.locator('.cyc-eff-phase[data-phase="premenstrual"] .cyc-eff-val').allInnerTexts();
    assert.strictEqual(pre[0], '1,0');
    const menstrual = await eff.locator('.cyc-eff-phase[data-phase="menstrual"] .cyc-eff-val').allInnerTexts();
    assert.match(menstrual[3], /^−\d/, `fuerza en la regla ${menstrual[3]}`);
    assert.match(menstrual[4], /^\+0,\d/, `peso en la regla ${menstrual[4]}`);
    const insIds = await eff.locator('.cyc-ins').evaluateAll((els) => els.map((e) => e.dataset.id));
    assert.ok(insIds.includes('cycle-energy-premenstrual'), insIds.join());
    assert.ok(insIds.includes('cycle-weight'), insIds.join());
    assert.ok(insIds.includes('cycle-evidence'), insIds.join());
    assert.match(await eff.innerText(), /Lo que dice la ciencia/);
    assert.match(await eff.innerText(), /Dolor\/calambres|dolor\/calambres/);
    // «¿Por qué?» con regla, datos y fuentes
    const evidence = eff.locator('.cyc-ins[data-id="cycle-evidence"]');
    await evidence.locator('.why-btn').click();
    assert.match(await evidence.locator('.why-body').innerText(), /McNulty et al\., 2020[\s\S]*Colenso-Semple et al\., 2023/);
    await shotAt(page, '.cyc-effect', 'cycle-effect');
    await page.locator('.cyc-eff').evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -66));
    await settle(page, 150);
    await shot(page, 'cycle-effect-table');

    // Consejos por fase: la actual abierta, cada uno con «¿Por qué?» y fuentes
    const tips = page.locator('.cyc-tips');
    assert.strictEqual(await tips.locator('details.cyc-tip-group').count(), 5);
    assert.strictEqual(await tips.locator('details.cyc-tip-group[open]').getAttribute('data-phase'), 'luteal');
    await tips.locator('details.cyc-tip-group[data-phase="menstrual"] summary').click();
    assert.match(await tips.locator('details.cyc-tip-group[data-phase="menstrual"]').innerText(), /sesión más corta o suave[\s\S]*ferritina/);
    const iron = tips.locator('details.cyc-tip-group[data-phase="menstrual"] .cyc-tip-item').nth(1);
    await iron.locator('.why-btn').click();
    assert.match(await iron.locator('.why-body').innerText(), /Bruinvels et al\., 2016[\s\S]*Pedlar et al\., 2018/);
    await shotAt(page, '.cyc-tips', 'cycle-tips');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('alertas con «¿Por qué?»: regla retrasada > 7 días', async () => {
  const app = await setup({ date: '2026-10-12' });
  const { page } = app;
  try {
    await seedCycles(page, { extra: false });
    await go(page, '#/cycle');
    const late = page.locator('section.cyc-ins[data-id="cycle-late"]');
    assert.ok(await late.isVisible());
    assert.match(await late.innerText(), /Regla con 9 días de retraso/);
    assert.match(await late.innerText(), /haz un test/);
    await late.locator('.why-btn').click();
    assert.match(await late.locator('.why-body').innerText(), /Munro et al\. \(FIGO\), 2018/);
    assert.match(await page.locator('.cyc-ring').innerText(), /Retraso: 9 días/);
    assert.match(await page.locator('.cyc-kpis').innerText(), /Se esperaba/);
    await shot(page, 'cycle-late');
    // La acción del aviso abre la hoja del día
    await late.locator('.cyc-ins-action').click();
    await page.waitForSelector(`${sheetOpen} .cyc-day`);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('anticonceptivo hormonal: sin fases naturales; registra sangrados y lo explica', async () => {
  const app = await setup({ contraception: 'combined_pill' });
  const { page } = app;
  try {
    await seedCycles(page, { extra: false });
    await go(page, '#/cycle');
    assert.match(await page.locator('.cyc-hormonal-note').innerText(), /no una regla natural/);
    assert.match(await page.locator('.cyc-ring').innerText(), /24[\s\S]*desde el último sangrado/);
    assert.strictEqual(await page.locator('.cyc-legend').count(), 0);
    assert.strictEqual(await page.locator('.cyc-cal-day.m-ov, .cyc-cal-day.m-predicted').count(), 0);
    assert.strictEqual(await page.locator('.cyc-cal-note').count(), 0);
    assert.strictEqual(await page.locator('.cyc-main-btn').innerText(), 'Sangrado hoy');
    assert.match(await page.locator('.cyc-effect').innerText(), /no hay fases naturales/);
    assert.strictEqual(await page.locator('.cyc-tips').count(), 0);
    await shot(page, 'cycle-hormonal');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('marcas discretas: calendario de la app (semana y mes) y franjas de regla en la gráfica de peso', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedCycles(page);
    // Mes: días de regla anotados y previstos
    await go(page, '#/calendar?view=month&month=2026-09');
    assert.strictEqual(await page.locator('.cal-month-cell').count(), 35);
    const period = await page.locator('.cal-month-cell[data-cycle="period"]').evaluateAll((els) => els.map((e) => e.dataset.date));
    assert.deepStrictEqual(period, ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08']);
    const pred = await page.locator('.cal-month-cell[data-cycle="predicted"]').evaluateAll((els) => els.map((e) => e.dataset.date));
    assert.deepStrictEqual(pred, ['2026-10-03', '2026-10-04']);
    assert.match(await page.locator('.cal-month-cell[data-date="2026-09-04"]').getAttribute('aria-label'), /· regla$/);
    assert.match(await page.locator('.cal-cyc-legend').innerText(), /Regla/);
    // El diseño no cambia: misma altura de celda que sin marca
    const hs = await page.locator('.cal-month-cell').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
    assert.strictEqual(hs.length, 1, `alturas ${hs}`);
    await shot(page, 'cycle-calendar-month-marks');
    assert.ok(await noHScroll(page));
    await page.locator('.cal-cyc-link').click();
    await page.waitForFunction(() => location.hash === '#/cycle');
    // Semana con regla
    await go(page, '#/calendar?week=2026-09-07');
    assert.deepStrictEqual(await page.locator('.cal-row[data-cycle="period"]').evaluateAll((els) => els.map((e) => e.dataset.date)), ['2026-09-07', '2026-09-08']);
    assert.strictEqual(await page.locator('.cal-row .cal-cyc-mark').count(), 2);
    await shot(page, 'cycle-calendar-week-marks');
    // Gráfica de peso: franjas en los días de regla, leyenda y nota en el globo
    await go(page, '#/bodyweight');
    const card = page.locator('[data-chart="bodyweight"][data-cycle="1"]');
    assert.strictEqual(await card.count(), 1);
    assert.ok(await card.locator('.chart-vband').count() >= 3, 'franjas de regla');
    assert.match(await card.locator('.chart-legend').innerText(), /Regla/);
    assert.match(await card.locator('.prg-howto').innerText(), /retención de líquidos/);
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await settle(page, 150);
    const b = await card.locator('.chart-svg').evaluate((svg) => {
      const r = svg.getBoundingClientRect();
      return { x: r.x, y: r.y, h: r.height, x0: +svg.dataset.x0, x1: +svg.dataset.x1, from: svg.dataset.from, to: svg.dataset.to };
    });
    const dn = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
    const x = b.x + b.x0 + ((dn('2026-09-05') - dn(b.from)) / (dn(b.to) - dn(b.from))) * (b.x1 - b.x0);
    await page.touchscreen.tap(x, b.y + b.h / 2);
    assert.match(await card.locator('.chart-tip').innerText(), /5 sep 2026[\s\S]*retención de líquidos/);
    await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
    await page.evaluate(() => window.scrollBy(0, -66));
    await settle(page, 150);
    await shot(page, 'cycle-bodyweight-bands');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('tarjeta de Hoy (cycleTodayCard): estado, próxima regla, consejo y botón rápido', async () => {
  const app = await setup();
  const { page } = app;
  try {
    await seedCycles(page, { extra: false });
    await go(page, '#/today');
    /** Monta la tarjeta arriba de Hoy (la integración real la hace today.js). */
    const mount = (today) => page.evaluate(async (t) => {
      const m = await import('./js/views/cycle.js');
      document.querySelector('.cyc-today')?.remove();
      const el = m.cycleTodayCard({ today: t });
      if (el) document.querySelector('.content.today').prepend(el);
      window.scrollTo(0, 0);
      return !!el;
    }, today);
    assert.ok(await mount(TODAY));
    const card = page.locator('.cyc-today');
    assert.match(await card.locator('.cyc-today-title').innerText(), /^Día 24 · fase lútea \(estimada\)$/);
    assert.match(await card.locator('.cyc-today-sub').innerText(), /^Próxima regla ~2–4 oct$/);
    assert.match(await card.locator('.cyc-today-tip').innerText(), /cansancio/);
    assert.strictEqual(await card.locator('.cyc-today-quick').innerText(), 'Registrar síntomas');
    await settle(page, 150);
    await shot(page, 'cycle-today-card');
    assert.ok(await noHScroll(page));
    // Registrar síntomas → hoja del día de hoy
    await card.locator('.cyc-today-quick').click();
    await page.waitForSelector(`${sheetOpen} .cyc-day`);
    assert.strictEqual(await page.locator(`${sheetOpen} .sheet-title`).innerText(), 'Hoy');
    await page.locator(`${sheetOpen} .sheet-actions .btn`, { hasText: 'Listo' }).click();
    await settle(page, 400);

    // Cerca de la próxima regla: «Me ha venido hoy» → la tarjeta pasa a «Ha terminado»
    await page.clock.setFixedTime(at('2026-10-02'));
    assert.ok(await mount('2026-10-02'));
    assert.match(await card.locator('.cyc-today-sub').innerText(), /puede venir ya/);
    assert.strictEqual(await card.locator('.cyc-today-quick').innerText(), 'Me ha venido hoy');
    await card.locator('.cyc-today-quick').click();
    await settle(page);
    assert.strictEqual(await page.locator('.cyc-today .cyc-today-quick').innerText(), 'Ha terminado');
    assert.match(await page.locator('.cyc-today .cyc-today-title').innerText(), /^Día 1 · regla$/);
    assert.ok((await idbAll(page, 'cycle')).some((r) => r.id === '2026-10-02' && r.flow === 'medium'));
    await shot(page, 'cycle-today-card-period');
    // Enlace a #/cycle
    await page.locator('.cyc-today .cyc-today-main').click();
    await page.waitForFunction(() => location.hash === '#/cycle');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
