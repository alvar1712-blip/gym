// E2E de la integración de la Fase 3 en Hoy y Progreso: check-in de hoy (3 toques, saltable, solo si no se ha
// hecho ni omitido), tarjeta resumen del panel semanal y de objetivos, accesos a #/weekly y #/goals, y que
// #/weekly, #/goals, #/goal/new y #/goal/:id se abren desde la app y vuelven atrás. «Te toca hoy» y «Empezar»
// siguen arriba. Ronda 5: con datos, «Tu análisis» va la última del hueco y «Análisis» encabeza los accesos. Siembra 6 semanas + la actual (rutina precargada, carreras, bici, pesajes, check-ins y dos
// objetivos) con la fecha fijada (jueves 24 sep 2026). Capturas en test-results/fase3-*.png (390×844 y 375×667).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/fase3.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium, devices } = require('playwright');
const { waitReady, go, idbAll } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24'; // jueves (Día 4 en la semana tipo)
const START = '2026-08-10'; // lunes, 6 semanas antes de la actual (21 sep)
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}

async function launch({ width = 390, height = 844, time = madrid(TODAY, 12) } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    ...devices['iPhone 13'], viewport: { width, height }, deviceScaleFactor: 2, locale: 'es-ES', timezoneId: 'Europe/Madrid', serviceWorkers: 'block',
  });
  if (time) await context.clock.install({ time });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(server.url);
  await waitReady(page);
  return { browser, context, page, errors, close: async () => { await browser.close(); await server.close(); } };
}

/** Espera a que se monte la vista nueva (y, en Hoy, a que se rellene el hueco de la Fase 3). */
async function open(page, hash) {
  await markStale(page);
  await go(page, hash);
  await waitFresh(page);
}
const markStale = (page) => page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
async function waitFresh(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    if (!el || el.dataset.stale || !el.querySelector('.topbar')) return false;
    // Hoy carga la Fase 3 después de pintar lo principal: se marca al terminar (data-extra en el hueco).
    const extra = el.querySelector('.today-extra');
    return !extra || extra.dataset.ready === '1';
  }, null, { timeout: 5000 });
  await page.waitForTimeout(120);
}
async function clickAndWait(page, locator) {
  await markStale(page);
  await locator.click();
  await waitFresh(page);
}
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
async function scrollShots(page, prefix, max = 10) {
  const { H, vh } = await page.evaluate(() => ({ H: document.documentElement.scrollHeight, vh: window.innerHeight }));
  const step = vh - 140;
  for (let y = 0, i = 0; i < max; y += step, i++) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y);
    await page.waitForTimeout(100);
    await shot(page, `${prefix}-${i}`);
    if (y + vh >= H) break;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}
/** Captura con un elemento arriba de la pantalla (bajo la cabecera). */
async function shotAt(page, selector, name, offset = 70) {
  await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.evaluate((o) => window.scrollBy(0, -o), offset);
  await page.waitForTimeout(100);
  await shot(page, name);
  await page.evaluate(() => window.scrollTo(0, 0));
}

// ---------------------------------------------------------------------------
// Datos sembrados (deterministas; mismo esquema que tests/e2e/weekly.test.cjs, más pesajes y objetivos)
// ---------------------------------------------------------------------------
const top = (it) => it.repMax ?? it.repMin ?? 8;
const lin = (base, inc) => (w) => base + inc * w;
const PLAN = {
  press_banca: (w) => ({ weight: 70 + 2.5 * w, reps: w === 6 ? [6, 6, 6] : [6, 5, 5], rir: [2, 1, 1] }),
  remo_pecho_apoyado: () => ({ weight: 60, reps: [10, 9, 8], rir: [1, 1, 1] }),
  jalon_pecho: () => ({ weight: 55, reps: [12, 11, 10], rir: [1, 1, 1] }),
  sentadilla: () => ({ weight: 100, reps: [6, 5, 5], rir: [2, 2, 2] }),
  curl_supinador: () => ({ weight: 12, reps: [15, 15], rir: [1, 1] }),
};
function setsFor(sid, i, it, ex, w, at) {
  const sets = [];
  const mk = (o) => ({
    id: `${sid}_s${i}_${sets.length}`, type: 'effective', weight: null, reps: null, repsR: null, rir: null, timeSec: null,
    distanceM: null, heightCm: null, note: '', done: true, doneAt: at + (i * 5 + sets.length) * 60000, ...o,
  });
  const n = it.sets || 1;
  const plan = PLAN[ex.id] ? PLAN[ex.id](w, it) : null;
  const t = top(it);
  const repsDefault = Array.from({ length: n }, (_, j) => Math.max(it.repMin ?? t, t - j));
  switch (ex.logType) {
    case 'weight_reps':
    case 'bodyweight': {
      const p = plan || { weight: ex.logType === 'bodyweight' ? null : lin(20, 0.5)(w), reps: repsDefault, rir: repsDefault.map(() => 1) };
      p.reps.forEach((r, j) => sets.push(mk({ weight: p.weight, reps: r, rir: p.rir[j] ?? 1 })));
      break;
    }
    case 'unilateral': {
      const p = plan || { weight: lin(16, 0.5)(w), reps: repsDefault, rir: repsDefault.map(() => 1) };
      p.reps.forEach((r, j) => sets.push(mk({ weight: p.weight, reps: r, repsR: r, rir: p.rir[j] ?? 1 })));
      break;
    }
    case 'time':
      for (let j = 0; j < n; j++) sets.push(mk({ timeSec: 45 + 3 * w - 5 * j }));
      break;
    case 'distance_time':
      for (let j = 0; j < n; j++) sets.push(mk({ distanceM: it.distance || 20, timeSec: 3.4 + 0.02 * j }));
      break;
    case 'jumps':
      for (let j = 0; j < n; j++) sets.push(mk({ reps: t }));
      break;
    default:
      break;
  }
  return sets;
}
function strength(id, date, tpl, w, exById, { dur = 65, rpe = 8 } = {}) {
  const at = madrid(date, 18);
  return {
    id, kind: 'strength', date, planDate: date, templateId: tpl.id, templateName: tpl.name, status: 'done',
    startedAt: at, endedAt: at + dur * 60000, durationMin: dur, rpe, notes: '', parentId: null, templateItemId: null, cursor: 0,
    templateItemIds: tpl.items.map((it) => it.id), createdAt: at, updatedAt: at,
    exercises: tpl.items.map((it, i) => {
      const ex = exById[it.exerciseId];
      return {
        id: `${id}_se${i}`, exerciseId: ex.id, exName: ex.name, templateItemId: it.id, alternatives: it.alternatives || [],
        target: { sets: it.sets, setsMax: null, repMin: it.repMin ?? null, repMax: it.repMax ?? null, timeMin: it.timeMin ?? null, timeMax: it.timeMax ?? null, distance: it.distance ?? null },
        notes: '', section: it.section || '', groupId: null, groupType: null, sets: setsFor(id, i, it, ex, w, at),
      };
    }),
  };
}
function activity(id, kind, date, { km = null, sec, rpe = 5, subtype = null, hh = 8 }) {
  const at = madrid(date, hh);
  return {
    id, kind, date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: null, endedAt: null,
    movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe, distanceKm: km, subtype, notes: '', parentId: null, parentItemId: null,
    templateItemId: null, createdAt: at, updatedAt: at,
  };
}
function buildSeed(templates, exercises) {
  const tpl = Object.fromEntries(templates.map((t) => [t.id, t]));
  const exById = Object.fromEntries(exercises.map((e) => [e.id, e]));
  const sessions = [];
  const bodyweight = [];
  for (let w = 0; w <= 6; w++) {
    const mon = addDays(START, 7 * w);
    const day = (d) => addDays(mon, d);
    const add = (s) => { if (s.date < TODAY) sessions.push(s); };
    const hard = w >= 5 ? 9 : 8;
    add(strength(`s${w}_d1`, day(0), tpl.tpl_d1, w, exById, { rpe: hard }));
    add(strength(`s${w}_d2`, day(1), tpl.tpl_d2, w, exById, { dur: 70, rpe: hard }));
    add(activity(`r${w}_z2`, 'run', day(2), { km: 6, sec: 2160 - 10 * w, rpe: 5, subtype: 'z2' }));
    add(activity(`b${w}_easy`, 'bike', day(2), { km: 30, sec: 4500, rpe: 5, subtype: 'easy', hh: 19 }));
    add(strength(`s${w}_d4`, day(3), tpl.tpl_d4, w, exById, { dur: 70, rpe: hard }));
    add(strength(`s${w}_d6`, day(5), tpl.tpl_d6, w, exById, { dur: 60, rpe: 8 }));
    add(activity(`r${w}_long`, 'run', day(6), { km: w === 5 ? 16 : 12, sec: w === 5 ? 5600 : 4200, rpe: 6, subtype: 'long', hh: 9 }));
    for (const d of [0, 2, 4, 6]) {
      const date = day(d);
      // De ~78,6 a ~77 kg en 6 semanas (objetivo 74 kg: aún lejos, con tendencia a favor)
      if (date < TODAY) bodyweight.push({ id: date, kg: Math.round((78.6 - 0.035 * (w * 7 + d) + (d % 4 ? 0.2 : -0.1)) * 10) / 10, createdAt: madrid(date, 8), updatedAt: madrid(date, 8) });
    }
  }
  // Check-ins de días anteriores (hoy no hay: Hoy debe ofrecerlo)
  const checkins = [
    { id: 'ck1', date: '2026-09-21', timing: 'pre', sessionId: 's6_d1', sleep: 2, energy: 2, soreness: 2 },
    { id: 'ck2', date: '2026-09-22', timing: 'pre', sessionId: 's6_d2', sleep: 1, energy: 2, soreness: 2 },
  ].map((c) => ({ ...c, createdAt: madrid(c.date, 17) }));
  const created = madrid('2026-08-24', 10);
  const goal = (o) => ({ titleAuto: false, updatedAt: o.createdAt, achievedAt: null, archived: false, ...o });
  const goals = [
    goal({ id: 'g_press', kind: 'strength', title: 'Press banca 90 kg × 5', exerciseId: 'press_banca', weight: 90, reps: 5, createdAt: created }),
    goal({ id: 'g_bw', kind: 'bodyweight', title: 'Bajar a 74 kg', targetKg: 74, direction: 'down', createdAt: created + 1 }),
  ];
  return { sessions, bodyweight, checkins, goals };
}

async function seed(page, { goals = true } = {}) {
  const base = await page.evaluate(() => ({
    templates: window.__app.store.all('templates').map((t) => ({ id: t.id, name: t.name, items: t.items })),
    exercises: window.__app.store.all('exercises').map((e) => ({ id: e.id, name: e.name, logType: e.logType })),
  }));
  const s = buildSeed(base.templates, base.exercises);
  if (!goals) s.goals = [];
  await page.evaluate(async ({ sessions, bodyweight, checkins, goals: gs, createdAt }) => {
    const { store } = window.__app;
    const meta = store.get('meta', 'app');
    meta.createdAt = createdAt;
    await store.save('meta', meta);
    await Promise.all([
      ...sessions.map((x) => store.save('sessions', x)),
      ...bodyweight.map((x) => store.save('bodyweight', x)),
      ...checkins.map((x) => store.save('checkins', x)),
      ...gs.map((x) => store.save('goals', x)),
    ]);
  }, { ...s, createdAt: madrid(START, 9) });
  return s;
}

/** Hijos del hueco de la Fase 3 en Hoy, en orden (ronda 5: «Tu análisis» al final → 'analysis'). */
const extraKinds = (page) => page.locator('.today-extra > *').evaluateAll((els) => els.filter((e) => !e.hidden).map((e) => (
  e.classList.contains('today-checkin') ? `checkin:${e.dataset.checkin}` : e.classList.contains('wk-summary') ? 'weekly' : e.classList.contains('goal-sum') ? 'goals'
    : e.classList.contains('an-sum') ? 'analysis' : e.className)));
const pick = (root, field, label) => root.locator(`.ci-row[data-field="${field}"] .seg-btn`, { hasText: new RegExp(`^${label}$`) });
/** «Empezar» (y todo «Te toca hoy») a la vista sin hacer scroll, por encima de la barra de pestañas. */
const startVisible = (page) => page.evaluate(() => {
  const b = document.querySelector('.today-plan .today-start');
  const tab = document.getElementById('tabbar').getBoundingClientRect().top;
  return !!b && b.getBoundingClientRect().bottom <= tab;
});

// ===========================================================================
// Pruebas
// ===========================================================================

test('Hoy con datos (390×844): check-in de hoy, resumen del panel semanal y objetivos al final; «Empezar» sigue arriba', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/today');
    assert.strictEqual(await page.locator('.today-plan .today-plan-name').innerText(), 'Día 4 — Upper hipertrofia');
    assert.ok(await startVisible(page), '«Empezar» a la vista sin scroll');
    // El hueco va después de la mini semana, con el check-in, el panel, los objetivos y «Tu análisis» (en ese orden)
    assert.deepStrictEqual(await extraKinds(page), ['checkin:pre', 'weekly', 'goals', 'analysis']);
    const order = await page.evaluate(() => {
      const y = (s) => document.querySelector(s).getBoundingClientRect().top;
      return [y('.today-plan'), y('.today-quick'), y('.today-weekcard'), y('.today-extra')];
    });
    assert.deepStrictEqual([...order].sort((a, b) => a - b), order, 'Te toca hoy → Registrar → Esta semana → Fase 3');

    // Check-in: tres filas a la vista (3 toques), opcional y con «Omitir»
    const ci = page.locator('.today-checkin');
    assert.match(await ci.innerText(), /¿Cómo llegas hoy\?/);
    assert.strictEqual(await ci.locator('.ci-row').count(), 3);
    assert.strictEqual(await ci.locator('.ci-skip').count(), 1);
    for (const b of await ci.locator('.ci-row .seg-btn, .ci-skip').all()) assert.ok((await b.boundingBox()).height >= 44, 'botones ≥ 44 px');

    // Panel semanal: 2–3 mensajes clave + «Ver panel semanal»
    const wk = page.locator('.today-extra .wk-summary');
    assert.strictEqual(await wk.locator('.wk-summary-title').innerText(), 'Panel semanal');
    assert.match(await wk.locator('.wk-summary-sub').innerText(), /21–27 sep · quedan 4 días/);
    const n = await wk.locator('.wk-summary-item').count();
    assert.ok(n >= 2 && n <= 3, `2–3 mensajes clave (${n})`);
    // Objetivos: los dos activos
    assert.deepStrictEqual(await page.locator('.today-extra .goal-sum .goal-sum-row').evaluateAll((els) => els.map((e) => e.dataset.goal)), ['g_bw', 'g_press']);
    // La cifra «actual / objetivo» dice qué mide (sin la ficha al lado, «107,7 kg / 105 kg» no se entiende)
    assert.match(await page.locator('.today-extra .goal-sum-row[data-goal="g_press"] .goal-sum-eta').innerText(), /1RM est\.\s\d/);
    assert.match(await page.locator('.today-extra .goal-sum-row[data-goal="g_bw"] .goal-sum-eta').innerText(), /Media 7 días\s\d/);
    assert.ok(await noHScroll(page), 'sin desbordamiento horizontal');
    await scrollShots(page, 'fase3-today-390');
    await shotAt(page, '.today-extra', 'fase3-today-390-extra');

    // 3 toques → guardado al instante (uno por día y momento)
    await pick(ci, 'sleep', 'Normal').click();
    await pick(ci, 'energy', 'Alto').click();
    await pick(ci, 'soreness', 'Bajo').click();
    await page.waitForTimeout(250);
    const saved = (await idbAll(page, 'checkins')).filter((c) => c.date === TODAY);
    assert.strictEqual(saved.length, 1);
    assert.deepStrictEqual({ timing: saved[0].timing, sessionId: saved[0].sessionId, sleep: saved[0].sleep, energy: saved[0].energy, soreness: saved[0].soreness },
      { timing: 'pre', sessionId: null, sleep: 2, energy: 3, soreness: 1 });
    await shotAt(page, '.today-extra', 'fase3-today-390-checkin-done');
    // Ya hecho hoy: al volver a Hoy ya no se ofrece
    await open(page, '#/calendar');
    await open(page, '#/today');
    assert.deepStrictEqual(await extraKinds(page), ['weekly', 'goals', 'analysis']);

    // «Ver panel semanal» → #/weekly de esta semana; atrás vuelve a Hoy
    await page.locator('.wk-summary-btn').scrollIntoViewIfNeeded();
    await clickAndWait(page, page.locator('.wk-summary-btn'));
    assert.strictEqual(await hashOf(page), '#/weekly?week=2026-09-21');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    assert.ok(await page.locator('.wk-block[data-section="info"]').count() === 1 && await page.locator('.wk-block[data-section="suggestion"]').count() === 1);
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/today');
    // «Ver todos» (objetivos) → #/goals; atrás vuelve a Hoy
    await page.locator('.goal-sum-link').scrollIntoViewIfNeeded();
    await clickAndWait(page, page.locator('.goal-sum-link'));
    assert.strictEqual(await hashOf(page), '#/goals');
    assert.strictEqual(await page.locator('.goal-list .goal-card').count(), 2);
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/today');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Hoy y Progreso a 375×667: «Empezar» a la vista, «Omitir» el check-in (con deshacer) y capturas', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/today');
    assert.ok(await startVisible(page), '«Empezar» a la vista sin scroll en un iPhone SE');
    assert.ok(await noHScroll(page));
    await scrollShots(page, 'fase3-today-375');
    await shotAt(page, '.today-extra', 'fase3-today-375-extra');

    // «Omitir»: se oculta sin guardar nada; «Deshacer» lo recupera; omitido, no vuelve a salir hoy
    const ci = page.locator('.today-checkin');
    await ci.locator('.ci-skip').click();
    assert.ok(await ci.isHidden());
    await page.getByRole('button', { name: 'Deshacer' }).click();
    assert.ok(await ci.isVisible(), 'deshacer vuelve a mostrarlo');
    await ci.locator('.ci-skip').click();
    assert.ok(await ci.isHidden());
    assert.strictEqual((await idbAll(page, 'checkins')).filter((c) => c.date === TODAY).length, 0, 'omitir no guarda nada');
    await open(page, '#/calendar');
    await open(page, '#/today');
    assert.deepStrictEqual(await extraKinds(page), ['weekly', 'goals', 'analysis']);

    // Progreso: accesos (panel semanal y objetivos junto a Récords/Peso/Ejercicios) y las dos tarjetas resumen
    await open(page, '#/progress');
    assert.ok(await noHScroll(page));
    const small = await page.locator('.prg-links button, .wk-summary-btn, .goal-sum-link, .goal-sum-row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).filter((r) => r.height < 44).length);
    assert.strictEqual(small, 0, 'botones de al menos 44 px');
    const labels = await page.locator('.prg-link-label').evaluateAll((els) => els.map((e) => ({ t: e.textContent, cut: e.scrollWidth > e.clientWidth + 1 })));
    assert.deepStrictEqual(labels.map((l) => l.t), ['Análisis', 'Panel semanal', 'Objetivos', 'Resúmenes', 'Predicciones', 'Récords', 'Peso', 'Ejercicios']);
    assert.ok(labels.every((l) => !l.cut), `etiquetas sin recortar: ${JSON.stringify(labels)}`);
    await scrollShots(page, 'fase3-progress-375', 3);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Progreso con datos (390×844): accesos y tarjetas; #/weekly, #/goals, #/goal/new y #/goal/:id se abren y vuelven atrás', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/progress');
    // Accesos arriba y, debajo, el resumen del panel semanal y los objetivos; después, las gráficas
    const y = await page.evaluate(() => ['.prg-links', '.progress-extra .wk-summary', '.progress-extra .goal-sum', '.prg-charts']
      .map((s) => document.querySelector(s)?.getBoundingClientRect().top ?? null));
    assert.ok(y.every((v) => v != null), `todo presente: ${y}`);
    assert.deepStrictEqual([...y].sort((a, b) => a - b), y, 'accesos → panel → objetivos → gráficas');
    assert.strictEqual(await page.locator('.progress-extra .wk-summary-title').innerText(), 'Panel semanal');
    assert.ok(await noHScroll(page));
    await scrollShots(page, 'fase3-progress-390', 3);

    // Acceso «Panel semanal» → #/weekly; atrás → Progreso
    await clickAndWait(page, page.locator('.prg-links [data-link="weekly"]'));
    assert.strictEqual(await hashOf(page), '#/weekly');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 21–27 sep');
    await clickAndWait(page, page.locator('[data-nav="prev"]'));
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Semana 14–20 sep');
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/progress');
    // «Ver panel semanal» de la tarjeta
    await clickAndWait(page, page.locator('.progress-extra .wk-summary-btn'));
    assert.strictEqual(await hashOf(page), '#/weekly?week=2026-09-21');
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/progress');

    // Acceso «Objetivos» → #/goals → #/goal/:id → atrás → «Nuevo objetivo» (#/goal/new) → atrás → Progreso
    await clickAndWait(page, page.locator('.prg-links [data-link="goals"]'));
    assert.strictEqual(await hashOf(page), '#/goals');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Objetivos');
    await clickAndWait(page, page.locator('.goal-card[data-goal="g_press"] .goal-head'));
    assert.strictEqual(await hashOf(page), '#/goal/g_press');
    assert.strictEqual(await page.locator('.back-btn').count(), 1);
    assert.match(await page.locator('#view').innerText(), /Press banca/);
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/goals');
    await clickAndWait(page, page.locator('.goal-new'));
    assert.strictEqual(await hashOf(page), '#/goal/new');
    assert.strictEqual(await page.locator('.back-btn').count(), 1);
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/goals');
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/progress');
    // Una fila de la tarjeta de objetivos también abre #/goals
    await clickAndWait(page, page.locator('.progress-extra .goal-sum-row').first());
    assert.strictEqual(await hashOf(page), '#/goals');
    // Entrada directa (recarga en esa ruta): el botón atrás lleva a su pantalla de origen
    await open(page, '#/goal/g_bw');
    await page.reload();
    await waitReady(page);
    await waitFresh(page);
    assert.strictEqual(await hashOf(page), '#/goal/g_bw');
    await clickAndWait(page, page.locator('.back-btn'));
    assert.strictEqual(await hashOf(page), '#/goals');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Sin datos: Hoy solo ofrece el check-in; Progreso sin tarjetas pero con accesos; sin objetivos, sin tarjeta de objetivos', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await open(page, '#/today');
    assert.deepStrictEqual(await extraKinds(page), ['checkin:pre']);
    assert.ok(await startVisible(page));
    await open(page, '#/progress');
    assert.strictEqual(await page.locator('.progress-extra > *').count(), 0);
    assert.ok(await page.locator('.progress-extra').isHidden(), 'hueco vacío oculto (sin hueco en blanco)');
    assert.strictEqual(await page.locator('.prg-links [data-link="weekly"]').count(), 1);
    assert.strictEqual(await page.locator('.prg-links [data-link="goals"]').count(), 1);
    await shot(page, 'fase3-progress-390-empty');
    await clickAndWait(page, page.locator('.prg-links [data-link="goals"]'));
    assert.strictEqual(await page.locator('.empty-title').innerText(), 'Sin objetivos todavía');
    await clickAndWait(page, page.locator('.back-btn'));
    await clickAndWait(page, page.locator('.prg-links [data-link="weekly"]'));
    assert.strictEqual(await page.locator('.wk-empty .empty-title').innerText(), 'Aún no hay datos');

    // Con sesiones pero sin objetivos: panel sí, objetivos no
    await seed(page, { goals: false });
    await open(page, '#/progress');
    assert.strictEqual(await page.locator('.progress-extra .wk-summary').count(), 1);
    assert.strictEqual(await page.locator('.progress-extra .goal-sum').count(), 0);
    await open(page, '#/today');
    assert.deepStrictEqual(await extraKinds(page), ['checkin:pre', 'weekly', 'analysis']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Hoy: con la sesión de hoy en curso el check-in se enlaza a ella; tras terminar la fuerza de hoy ya no se ofrece', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/today');
    // Empezar (1 toque) abre la sesión; volver a Hoy: el check-in sigue ofrecido y se enlaza a la sesión
    await clickAndWait(page, page.locator('.today-plan .today-start'));
    assert.match(await hashOf(page), /^#\/session\//);
    const sid = (await hashOf(page)).split('/')[2];
    await open(page, '#/today');
    assert.deepStrictEqual(await extraKinds(page), ['checkin:pre', 'weekly', 'goals', 'analysis']);
    await pick(page.locator('.today-checkin'), 'energy', 'Normal').click();
    await page.waitForTimeout(250);
    const rec = (await idbAll(page, 'checkins')).find((c) => c.date === TODAY);
    assert.strictEqual(rec.sessionId, sid);
    // La sesión ve el mismo registro (uno por día y momento)
    await open(page, `#/session/${sid}`);
    assert.strictEqual(await page.locator('.ci-card[data-checkin="pre"]').getAttribute('data-state'), 'partial');

    // Sin check-in y con la fuerza de hoy terminada: Hoy no lo ofrece (la sesión ya lo hizo antes y después)
    await page.evaluate(async (id) => {
      const { store } = window.__app;
      for (const c of store.all('checkins').filter((x) => x.date === '2026-09-24')) await store.remove('checkins', c.id);
      const s = store.get('sessions', id);
      s.status = 'done';
      s.endedAt = Date.now();
      s.durationMin = 60;
      s.rpe = 8;
      await store.save('sessions', s);
    }, sid);
    await open(page, '#/today');
    assert.deepStrictEqual(await extraKinds(page), ['weekly', 'goals', 'analysis']);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('Selector de ejercicios: al buscar, los sugeridos que coinciden siguen en la lista', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await open(page, '#/today');
    await page.evaluate(() => {
      import('./js/pickers.js').then((m) => { window.__picked = m.pickExercise({ title: 'Prueba', preferIds: ['press_banca', 'sentadilla'] }); });
    });
    const sheet = page.locator('.sheet-panel').last();
    await sheet.waitFor();
    assert.ok(await sheet.getByText('Sugeridos', { exact: true }).isVisible());
    await sheet.locator('.search-input').fill('press ban');
    await page.waitForTimeout(150);
    const names = await sheet.locator('.pick-name').allInnerTexts();
    assert.ok(names.includes('Press banca'), `Press banca al buscar: ${names}`);
    assert.strictEqual(await sheet.locator('.pick-empty').count(), 0);
    await sheet.locator('.pick-row', { hasText: 'Press banca' }).first().click();
    assert.strictEqual(await page.evaluate(() => window.__picked), 'press_banca');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
