// E2E de objetivos (Fase 3): #/goals, #/goal/new, #/goal/:id y goalsSummaryCard(). Siembra ~10 semanas de datos
// realistas (remo, press banca, dominadas con lastre, hip thrust con solo 2 sesiones, carreras, bici y pesajes) con
// la fecha fijada (jueves 24 sep 2026). Crea cada tipo de objetivo desde la interfaz, comprueba progreso, rango de
// fechas, «datos insuficientes» con recuentos, «¿Por qué?» con los datos usados, edición con guardado inmediato,
// archivar/desarchivar, borrar con confirmación y deshacer, «conseguido», la tarjeta resumen, desbordamiento
// horizontal (390×844 y 375×667) y consola. Deja capturas en test-results/goals-*.png.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/goals.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
// Motor: Chromium por defecto o WebKit con E2E_BROWSER=webkit (fase H de la ronda 6).
const playwright = require('playwright');
const { devices } = playwright;
const { waitReady, go, idbAll, BROWSER } = require('./helpers.cjs');

const RESULTS = path.join(__dirname, '..', '..', 'test-results');
const TODAY = '2026-09-24'; // jueves
const START = '2026-07-13'; // lunes, 10 semanas antes
/** Hora local de Madrid (CEST, +02:00 hasta el 25 de octubre). */
const madrid = (date, hh = 18) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

function addDays(s, n) {
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n));
  return d.toISOString().slice(0, 10);
}
const roundTo = (v, step) => Math.round(v / step) * step;
const r1 = (v) => Math.round(v * 10) / 10;
/** Ruido determinista en [-1, 1]. */
const noise = (i) => Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 4.1414) * 0.5;

async function launch({ width = 390, height = 844, time = madrid(TODAY, 12) } = {}) {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, '..', 'serve.mjs')).href);
  const server = await startServer(0);
  const browser = await playwright[BROWSER].launch();
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

/** Espera a que se monte la vista nueva (no la anterior mientras carga el módulo). */
async function open(page, hash) {
  await page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
  await go(page, hash);
  await waitView(page);
}
async function waitView(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#view > *');
    return !!el && !el.dataset.stale && !!el.querySelector('.topbar');
  }, null, { timeout: 5000 });
  await page.waitForTimeout(150);
}
/** Marca la vista actual para poder esperar a la siguiente tras un toque que navega. */
const markStale = (page) => page.evaluate(() => { const el = document.querySelector('#view > *'); if (el) el.dataset.stale = '1'; });
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Elementos que se salen del ancho de la pantalla (para depurar desbordamientos). */
const overflowing = (page) => page.evaluate(() => [...document.querySelectorAll('#view *')]
  .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5); })
  .slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${el.className}`));

async function shot(page, name) {
  fs.mkdirSync(RESULTS, { recursive: true });
  const file = path.join(RESULTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}
/** Capturas de toda la pantalla a varias alturas de scroll. */
async function scrollShots(page, prefix, max = 8) {
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

// ---------------------------------------------------------------------------
// Datos sembrados (deterministas)
// ---------------------------------------------------------------------------
let seq = 0;
const mkSet = (sid, o) => ({
  id: `${sid}_st${++seq}`, type: 'effective', weight: null, reps: null, repsR: null, rir: 1, timeSec: null, distanceM: null,
  heightCm: null, note: '', done: true, doneAt: 1, ...o,
});
function strength(id, date, items, { dur = 60, rpe = 8 } = {}) {
  const at = madrid(date, 18);
  return {
    id, kind: 'strength', date, planDate: date, templateId: null, templateName: 'Sesión libre', status: 'done',
    startedAt: at, endedAt: at + dur * 60000, durationMin: dur, rpe, notes: '', parentId: null, templateItemId: null, cursor: 0,
    createdAt: at, updatedAt: at,
    exercises: items.map(([exerciseId, exName, sets], i) => ({
      id: `${id}_se${i}`, exerciseId, exName, templateItemId: null, alternatives: [], target: { sets: sets.length, repMin: 5, repMax: 8 },
      notes: '', section: '', groupId: null, groupType: null, sets: sets.map((s) => mkSet(id, s)),
    })),
  };
}
function activity(id, kind, date, { km, sec, rpe = 5, subtype = null, hh = 8 }) {
  const at = madrid(date, hh);
  return {
    id, kind, date, planDate: date, templateId: null, templateName: null, status: 'done', startedAt: null, endedAt: null,
    movingSec: sec, elapsedSec: sec, durationMin: sec / 60, rpe, distanceKm: km, subtype, notes: '', parentId: null, parentItemId: null,
    templateItemId: null, createdAt: at, updatedAt: at,
  };
}

function buildSeed() {
  const sessions = [];
  for (let w = 0; w < 11; w++) {
    const mon = addDays(START, 7 * w);
    const day = (d) => addDays(mon, d);
    const add = (s) => { if (s.date < TODAY) sessions.push(s); };
    // Remo con pecho apoyado: lunes y jueves, +1,25 kg por semana (con alguna sesión floja)
    const row = roundTo(50 + 1.25 * w + (w === 5 ? -2.5 : 0), 1.25);
    add(strength(`s${w}_a`, day(0), [
      ['remo_pecho_apoyado', 'Remo con pecho apoyado', [{ weight: row, reps: 8, rir: 2 }, { weight: row, reps: 7 }, { weight: row, reps: 6 }]],
      ['press_banca', 'Press banca', [{ type: 'warmup', weight: 40, reps: 8 }, { weight: roundTo(70 + 1.25 * w, 2.5), reps: 6 }, { weight: roundTo(70 + 1.25 * w, 2.5), reps: 5 }]],
      ['dominadas', 'Dominadas', [{ weight: roundTo(1.25 * w, 1.25) || null, reps: 6 }, { weight: roundTo(1.25 * w, 1.25) || null, reps: 5 }]],
    ]));
    add(strength(`s${w}_b`, day(3), [
      ['remo_pecho_apoyado', 'Remo con pecho apoyado', [{ weight: row, reps: 7 }, { weight: row, reps: 6 }]],
    ], { dur: 50, rpe: 7 }));
    // Carrera: miércoles 6 km cada vez algo más rápida; domingo alterno, tirada larga
    const pace = 342 - 2.2 * w + 3 * noise(w); // s/km
    add(activity(`r${w}_z2`, 'run', day(2), { km: 6, sec: Math.round(6 * pace), subtype: 'z2' }));
    if (w % 2 === 0) add(activity(`r${w}_long`, 'run', day(6), { km: 12, sec: Math.round(12 * (pace + 25)), rpe: 6, subtype: 'long', hh: 9 }));
    // Bici: sábado 40 km
    add(activity(`b${w}`, 'bike', day(5), { km: 40, sec: Math.round((40 / (26 + 0.2 * w)) * 3600), subtype: 'easy', hh: 10 }));
  }
  // Hip thrust: solo 2 sesiones (semanas del 7 y del 14 sep) → datos insuficientes
  sessions.push(strength('ht1', '2026-09-09', [['hip_thrust', 'Hip thrust', [{ weight: 100, reps: 8 }, { weight: 100, reps: 8 }]]]));
  sessions.push(strength('ht2', '2026-09-16', [['hip_thrust', 'Hip thrust', [{ weight: 105, reps: 8 }, { weight: 105, reps: 7 }]]]));
  const bodyweight = [];
  for (let i = 0, d = START; d <= TODAY; i++, d = addDays(d, 1)) {
    if (d !== TODAY && (i % 7 === 3 || i % 11 === 5)) continue; // huecos reales
    bodyweight.push({ id: d, kg: r1(74.8 + 0.02 * i + 0.15 * Math.sin(i * 1.7)) });
  }
  return { sessions, bodyweight };
}

/** Siembra los datos en la app abierta (memoria + IndexedDB). */
async function seed(page, { goals = [], extra = [] } = {}) {
  const s = buildSeed();
  s.sessions.push(...extra);
  await page.evaluate(async ({ sessions, bodyweight, goals: gl, createdAt }) => {
    const { store } = window.__app;
    const meta = store.get('meta', 'app');
    meta.createdAt = createdAt;
    await store.save('meta', meta);
    await Promise.all([
      ...sessions.map((x) => store.save('sessions', x)),
      ...bodyweight.map((b) => store.save('bodyweight', b)),
      ...gl.map((g) => store.save('goals', g)),
    ]);
  }, { ...s, goals, createdAt: madrid(START, 9) });
  return s;
}

const goalRow = (g) => ({ titleAuto: true, achievedAt: null, archived: false, ...g });

// ---------------------------------------------------------------------------
// Interacciones
// ---------------------------------------------------------------------------
async function newGoal(page) {
  await markStale(page);
  await page.locator('.goal-new, .empty .btn-primary').first().click();
  await waitView(page);
  assert.strictEqual(await hashOf(page), '#/goal/new');
}
async function chooseKind(page, label) {
  await page.locator('.goal-form .seg-btn', { hasText: label }).first().click();
  await page.waitForTimeout(80);
}
async function pickExercise(page, query, name) {
  await page.locator('.goal-pick').click();
  await page.locator('.pick-sheet .search-input').fill(query);
  await page.locator('.pick-row', { has: page.locator('.pick-name', { hasText: new RegExp(`^${name}$`) }) }).first().click();
  await page.waitForTimeout(350); // cierre de la hoja
}
async function setStepper(page, field, value) {
  const inp = page.locator(`[data-field="${field}"] .stepper-input`);
  await inp.fill(String(value));
  await inp.press('Enter');
  await page.waitForTimeout(60);
}
async function createGoal(page) {
  await markStale(page);
  await page.locator('.goal-create').click();
  await waitView(page);
  assert.strictEqual(await hashOf(page), '#/goals');
}
const card = (page, title) => page.locator('.goal-card', { has: page.locator('.goal-title', { hasText: title }) });
async function openWhy(loc) {
  await loc.locator('.why-btn').click();
  return loc.locator('.why-body');
}

// ===========================================================================
// Pruebas
// ===========================================================================

test('fuerza: crear desde la interfaz con datos sembrados → rango de fechas, ¿Por qué? con los datos usados y guardado en disco', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/goals');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Objetivos');
    assert.strictEqual(await page.locator('.empty-title').innerText(), 'Sin objetivos todavía');
    await shot(page, 'goals-empty');

    await newGoal(page);
    assert.match(await page.locator('.goal-form .seg-btn.active').first().innerText(), /Fuerza/);
    // Sin ejercicio: la vista previa pide completar los datos
    assert.match(await page.locator('.goal-preview').innerText(), /Completa los datos/);
    await pickExercise(page, 'pecho apoyado', 'Remo con pecho apoyado');
    assert.strictEqual(await page.locator('.goal-pick-name').innerText(), 'Remo con pecho apoyado');
    // Peso sugerido: el más alto registrado (62,5 kg) + 2,5
    assert.strictEqual(await page.locator('[data-field="weight"] .stepper-input').inputValue(), '65');
    // −/+ de 2,5 kg
    await page.locator('[data-field="weight"] .stepper-btn').last().click();
    assert.strictEqual(await page.locator('[data-field="weight"] .stepper-input').inputValue(), '67,5');
    await setStepper(page, 'weight', 80);
    await setStepper(page, 'reps', 5);
    assert.match(await page.locator('.goal-equiv').innerText(), /1RM estimado de 93,3 kg/);
    assert.strictEqual(await page.locator('.goal-form input.input[aria-label="Título del objetivo"]').inputValue(), 'Remo con pecho apoyado 80 kg × 5');
    await page.waitForTimeout(250);
    assert.strictEqual(await page.locator('.goal-preview').getAttribute('data-status'), 'estimate');
    assert.ok(await noHScroll(page), `sin desbordamiento: ${await overflowing(page)}`);
    await shot(page, 'goals-new-strength');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(100);
    await shot(page, 'goals-new-strength-bottom');

    await createGoal(page);
    const c = card(page, 'Remo con pecho apoyado 80 kg × 5');
    assert.strictEqual(await c.count(), 1);
    assert.strictEqual(await c.getAttribute('data-status'), 'estimate');
    assert.strictEqual(await c.locator('.goal-badge').innerText(), 'Estimación');
    const eta = await c.locator('.goal-eta').innerText();
    assert.match(eta, /^Estimación: entre .+ y .+/, eta);
    assert.match(await c.locator('.goal-val').nth(1).innerText(), /93,3 kg/);
    assert.match(await page.locator('.goal-note').innerText(), /no es lineal.*se recalcula con cada registro/s);
    const why = await openWhy(c);
    const whyTxt = await why.innerText();
    assert.match(whyTxt, /Método\. .*Epley/s);
    assert.match(whyTxt, /pendiente ± 1 error típico.*±20 %/s);
    assert.ok(await why.locator('li').count() >= 15, 'una fila por sesión de las últimas 12 semanas');
    assert.match(whyTxt, /kg × \d/);
    assert.ok(await noHScroll(page), `sin desbordamiento: ${await overflowing(page)}`);
    await shot(page, 'goals-list-strength');

    const disk = await idbAll(page, 'goals');
    assert.strictEqual(disk.length, 1);
    const g = disk[0];
    assert.strictEqual(g.kind, 'strength');
    assert.strictEqual(g.exerciseId, 'remo_pecho_apoyado');
    assert.strictEqual(g.weight, 80);
    assert.strictEqual(g.reps, 5);
    assert.strictEqual(g.title, 'Remo con pecho apoyado 80 kg × 5');
    assert.strictEqual(g.titleAuto, true);
    assert.strictEqual(g.achievedAt, null);
    assert.strictEqual(g.archived, false);
    assert.ok(g.createdAt > 0 && g.id.startsWith('goal_'));
    assert.ok(!('sport' in g) && !('targetKg' in g), 'solo los campos de su tipo');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('resistencia (Riegel, bici con aviso, solo distancia) y peso corporal: crear cada uno y ver su progreso', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/goals');

    // 10 km en menos de 45 min (carrera)
    await newGoal(page);
    await chooseKind(page, 'Resistencia');
    assert.match(await page.locator('.goal-form .seg-btn.active').nth(1).innerText(), /Carrera/);
    await page.locator('.goal-presets .chip', { hasText: /^10 km$/ }).click();
    await page.locator('.dur-input[aria-label="Tiempo objetivo: min"]').fill('45');
    await page.waitForTimeout(60);
    assert.match(await page.locator('.goal-pace').innerText(), /4:30 \/km/);
    assert.strictEqual(await page.locator('input.input[aria-label="Título del objetivo"]').inputValue(), '10 km en menos de 45 min');
    await page.waitForTimeout(250);
    await shot(page, 'goals-new-run');
    await createGoal(page);
    let c = card(page, '10 km en menos de 45 min');
    assert.match(await c.locator('.goal-kind').innerText(), /Carrera · predicción de Riegel/);
    assert.strictEqual(await c.getAttribute('data-status'), 'estimate');
    assert.match(await c.locator('.goal-eta').innerText(), /^Estimación: /);
    assert.match(await c.locator('.goal-val').nth(1).innerText(), /45:00/);
    let why = await (await openWhy(c)).innerText();
    assert.match(why, /Riegel/);
    assert.match(why, /Semana \d/);

    // Solo distancia: media maratón
    await newGoal(page);
    await chooseKind(page, 'Resistencia');
    await page.locator('.goal-presets .chip', { hasText: 'Media' }).click();
    assert.strictEqual(await page.locator('input.input[aria-label="Título del objetivo"]').inputValue(), 'Correr una media maratón');
    await createGoal(page);
    c = card(page, 'Correr una media maratón');
    assert.match(await c.locator('.goal-kind').innerText(), /Carrera · distancia/);
    assert.match(await c.locator('.goal-bar-meta').innerText(), /de 21,1 km/);
    assert.match(await c.locator('.goal-val').first().innerText(), /12 km/);

    // Bici con tiempo: aviso de que Riegel es menos fiable
    await newGoal(page);
    await chooseKind(page, 'Resistencia');
    await page.locator('.goal-form .seg-btn', { hasText: 'Bici' }).click();
    assert.strictEqual(await page.locator('input.input[aria-label="Distancia (km)"]').inputValue(), '40');
    await page.locator('.dur-input[aria-label="Tiempo objetivo: h"]').fill('1');
    await page.locator('.dur-input[aria-label="Tiempo objetivo: min"]').fill('20');
    await page.waitForTimeout(60);
    assert.match(await page.locator('.goal-how').innerText(), /menos fiable/);
    assert.strictEqual(await page.locator('input.input[aria-label="Título del objetivo"]').inputValue(), '40 km en bici en menos de 1 h 20 min');
    await createGoal(page);
    c = card(page, '40 km en bici en menos de 1 h 20 min');
    assert.match(await c.locator('.goal-warn').innerText(), /Riegel está pensada para carrera: en bici/);
    assert.strictEqual(await card(page, '10 km en menos de 45 min').locator('.goal-warn').count(), 0, 'en carrera no hay aviso');
    why = await (await openWhy(c)).innerText();
    assert.match(why, /Riegel está pensada para carrera/);

    // Natación en metros
    await newGoal(page);
    await chooseKind(page, 'Resistencia');
    await page.locator('.goal-form .seg-btn', { hasText: 'Natación' }).click();
    assert.strictEqual(await page.locator('input.input[aria-label="Distancia (m)"]').inputValue(), '1500');
    await page.locator('.goal-presets .chip', { hasText: '750 m' }).click();
    await createGoal(page);
    c = card(page, 'Nadar 750 m');
    assert.strictEqual(await c.getAttribute('data-status'), 'insufficient');
    assert.match(await c.locator('.goal-eta').innerText(), /Datos insuficientes: 0 de 4 registros, 0 de 3 semanas/);

    // Peso corporal: subir (la media de 7 días va subiendo)
    await newGoal(page);
    await chooseKind(page, 'Peso');
    assert.match(await page.locator('.goal-bw-info').innerText(), /Media de 7 días actual: 76,\d kg · tendencia \+0,1\d kg\/sem/);
    await setStepper(page, 'targetKg', 78);
    assert.match(await page.locator('.goal-form .seg-btn.active').nth(1).innerText(), /Subir/);
    assert.strictEqual(await page.locator('input.input[aria-label="Título del objetivo"]').inputValue(), 'Subir a 78 kg');
    await page.waitForTimeout(250);
    await shot(page, 'goals-new-bodyweight');
    await createGoal(page);
    c = card(page, 'Subir a 78 kg');
    assert.strictEqual(await c.getAttribute('data-status'), 'estimate');
    assert.match(await c.locator('.goal-eta').innerText(), /^Estimación: entre /);
    why = await (await openWhy(c)).innerText();
    assert.match(why, /media móvil de 7 días/i);
    assert.match(why, /pesajes\)/);

    const disk = await idbAll(page, 'goals');
    assert.strictEqual(disk.length, 5);
    const run = disk.find((g) => g.title === '10 km en menos de 45 min');
    assert.deepStrictEqual([run.kind, run.sport, run.distanceKm, run.timeSec], ['endurance', 'run', 10, 2700]);
    assert.strictEqual(disk.find((g) => g.title === 'Correr una media maratón').timeSec, null);
    assert.strictEqual(disk.find((g) => g.title === 'Nadar 750 m').distanceKm, 0.75);
    const bw = disk.find((g) => g.kind === 'bodyweight');
    assert.deepStrictEqual([bw.targetKg, bw.direction], [78, 'up']);
    assert.ok(await noHScroll(page), `sin desbordamiento: ${await overflowing(page)}`);
    await scrollShots(page, 'goals-list-all');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('datos insuficientes: dice cuántos registros hay y cuántos faltan; «Crear» sin ejercicio marca el error', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    await open(page, '#/goals');
    await newGoal(page);
    // Crear sin ejercicio → error visible, no se guarda
    await page.locator('.goal-create').click();
    await page.waitForTimeout(100);
    assert.strictEqual(await hashOf(page), '#/goal/new');
    assert.strictEqual(await page.locator('[data-err="exerciseId"]').innerText(), 'Elige un ejercicio.');
    assert.strictEqual((await idbAll(page, 'goals')).length, 0);

    await pickExercise(page, 'hip thrust', 'Hip thrust');
    assert.strictEqual(await page.locator('[data-err="exerciseId"]').isHidden(), true);
    await setStepper(page, 'weight', 120);
    await setStepper(page, 'reps', 6);
    await createGoal(page);
    const c = card(page, 'Hip thrust 120 kg × 6');
    assert.strictEqual(await c.getAttribute('data-status'), 'insufficient');
    assert.strictEqual(await c.locator('.goal-badge').innerText(), 'Datos insuficientes');
    assert.strictEqual(await c.locator('.goal-eta').innerText(), 'Datos insuficientes: 2 de 4 registros, 2 de 3 semanas');
    const why = await (await openWhy(c)).innerText();
    assert.match(why, /2 sesiones con Hip thrust en 2 semanas/);
    assert.match(why, /faltan 2 sesiones y 1 semana más con registros/);
    assert.strictEqual(await c.locator('.why-body li').count(), 2);
    await shot(page, 'goals-insufficient');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('editar (guardado inmediato y título automático), archivar/desarchivar y borrar con confirmación y deshacer', async () => {
  const app = await launch();
  const { page } = app;
  try {
    const createdAt = madrid('2026-09-20', 10);
    await seed(page, {
      goals: [goalRow({ id: 'g_row', kind: 'strength', title: 'Remo con pecho apoyado 80 kg × 5', exerciseId: 'remo_pecho_apoyado', weight: 80, reps: 5, createdAt })],
    });
    await open(page, '#/goals');
    await markStale(page);
    await card(page, 'Remo con pecho apoyado 80 kg × 5').locator('.goal-head').click();
    await waitView(page);
    assert.strictEqual(await hashOf(page), '#/goal/g_row');
    assert.strictEqual(await page.locator('.topbar h1').innerText(), 'Editar objetivo');
    assert.strictEqual(await page.locator('.goal-form .seg').count(), 0, 'el tipo no se cambia al editar');

    // +1 rep → guardado al instante en disco y título automático actualizado
    await page.locator('[data-field="reps"] .stepper-btn').last().click();
    await page.waitForTimeout(200);
    let g = (await idbAll(page, 'goals'))[0];
    assert.strictEqual(g.reps, 6);
    assert.strictEqual(g.title, 'Remo con pecho apoyado 80 kg × 6');
    assert.strictEqual(await page.locator('input.input[aria-label="Título del objetivo"]').inputValue(), 'Remo con pecho apoyado 80 kg × 6');
    // Peso vacío → error y no se guarda un valor inválido
    await page.locator('[data-field="weight"] .stepper-input').fill('');
    await page.waitForTimeout(400);
    assert.match(await page.locator('[data-err="weight"]').innerText(), /peso mayor que 0/);
    assert.strictEqual((await idbAll(page, 'goals'))[0].weight, 80);
    await setStepper(page, 'weight', 82.5);
    await page.waitForTimeout(300);
    assert.strictEqual((await idbAll(page, 'goals'))[0].weight, 82.5);
    assert.strictEqual(await page.locator('[data-err="weight"]').isHidden(), true);
    // Título propio
    await page.locator('input.input[aria-label="Título del objetivo"]').fill('Remo pesado');
    await page.waitForTimeout(400);
    g = (await idbAll(page, 'goals'))[0];
    assert.deepStrictEqual([g.title, g.titleAuto], ['Remo pesado', false]);
    assert.strictEqual(await page.locator('.goal-title-auto').isVisible(), true);
    await shot(page, 'goals-edit');

    // Archivar → sale de los activos y aparece plegado en «Archivados»
    await page.locator('.goal-archive').click();
    await page.waitForTimeout(150);
    assert.strictEqual((await idbAll(page, 'goals'))[0].archived, true);
    assert.strictEqual(await page.locator('.goal-archive').innerText(), 'Desarchivar');
    await markStale(page);
    await page.locator('.back-btn').click();
    await waitView(page);
    assert.strictEqual(await hashOf(page), '#/goals');
    assert.strictEqual(await page.locator('.goal-list .goal-card').count(), 0);
    assert.strictEqual(await page.locator('.goal-none').innerText(), 'No tienes objetivos activos.');
    const fold = page.locator('[data-fold="archived"] .goal-fold');
    assert.strictEqual((await fold.innerText()).trim(), 'Archivados (1)'); // .trim(): salto final de WebKit
    assert.strictEqual(await page.locator('[data-fold="archived"] .goal-fold-body').isHidden(), true);
    await fold.click();
    assert.strictEqual(await page.locator('[data-fold="archived"] .goal-card .goal-badge-arch').innerText(), 'Archivado');
    await shot(page, 'goals-archived');
    // Desarchivar
    await markStale(page);
    await page.locator('[data-fold="archived"] .goal-head').click();
    await waitView(page);
    await page.locator('.goal-archive').click();
    await page.waitForTimeout(150);
    assert.strictEqual((await idbAll(page, 'goals'))[0].archived, false);
    await markStale(page);
    await page.locator('.back-btn').click();
    await waitView(page);
    assert.strictEqual(await card(page, 'Remo pesado').count(), 1);
    assert.strictEqual(await page.locator('[data-fold="archived"]').count(), 0);

    // Borrar: confirmación, cancelar no borra
    await markStale(page);
    await card(page, 'Remo pesado').locator('.goal-head').click();
    await waitView(page);
    await page.locator('.goal-delete').click();
    const dlg = page.locator('.sheet-panel');
    await dlg.waitFor();
    assert.match(await dlg.innerText(), /¿Borrar «Remo pesado»\?/);
    await dlg.locator('.btn', { hasText: 'Cancelar' }).click();
    await page.waitForTimeout(250);
    assert.strictEqual((await idbAll(page, 'goals')).length, 1);
    // Confirmar → vuelve a la lista, borrado del disco, «Deshacer» lo recupera
    await page.locator('.goal-delete').click();
    await markStale(page);
    await page.locator('.sheet-panel .btn-danger', { hasText: 'Borrar objetivo' }).click();
    await waitView(page);
    assert.strictEqual(await hashOf(page), '#/goals');
    assert.strictEqual((await idbAll(page, 'goals')).length, 0);
    assert.strictEqual(await page.locator('.empty-title').innerText(), 'Sin objetivos todavía');
    const t = page.locator('.toast');
    assert.match(await t.innerText(), /Objetivo «Remo pesado» borrado/);
    await t.locator('.toast-action', { hasText: 'Deshacer' }).click();
    await page.waitForTimeout(250);
    const back = await idbAll(page, 'goals');
    assert.strictEqual(back.length, 1);
    assert.deepStrictEqual([back[0].id, back[0].title, back[0].weight, back[0].reps], ['g_row', 'Remo pesado', 82.5, 6]);
    assert.strictEqual(await card(page, 'Remo pesado').count(), 1, 'la lista se repinta al deshacer');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('conseguido: se sincroniza achievedAt y pasa a «Conseguidos»; goalsSummaryCard() (máx. 3, null sin objetivos)', async () => {
  const app = await launch();
  const { page } = app;
  try {
    await seed(page);
    // Sin objetivos → null
    assert.strictEqual(await page.evaluate(async () => (await import('./js/views/goals.js')).goalsSummaryCard()), null);
    const older = madrid('2026-08-24', 10);
    await page.evaluate(async (goals) => {
      await Promise.all(goals.map((g) => window.__app.store.save('goals', g)));
    }, [
      // Conseguido: remo 60 kg × 6 o más desde el 24 ago → 60 kg × 8 el 7 sep
      goalRow({ id: 'g_done', kind: 'strength', title: 'Remo 60 × 6', exerciseId: 'remo_pecho_apoyado', weight: 60, reps: 6, createdAt: older }),
      goalRow({ id: 'g_row', kind: 'strength', title: 'Remo 80 × 5', exerciseId: 'remo_pecho_apoyado', weight: 80, reps: 5, createdAt: older + 1 }),
      goalRow({ id: 'g_run', kind: 'endurance', title: '10 km en menos de 45 min', sport: 'run', distanceKm: 10, timeSec: 2700, createdAt: older + 2 }),
      goalRow({ id: 'g_bw', kind: 'bodyweight', title: 'Subir a 78 kg', targetKg: 78, direction: 'up', createdAt: older + 3 }),
      goalRow({ id: 'g_ht', kind: 'strength', title: 'Hip thrust 120 × 6', exerciseId: 'hip_thrust', weight: 120, reps: 6, createdAt: older + 4 }),
      goalRow({ id: 'g_arch', kind: 'bodyweight', title: 'Bajar a 70 kg', targetKg: 70, direction: 'down', createdAt: older + 5, archived: true }),
    ]);

    // Tarjeta resumen: 3 activos (los más nuevos primero) + aviso de los demás
    const sum = await page.evaluate(async () => {
      const el = (await import('./js/views/goals.js')).goalsSummaryCard();
      document.querySelector('#view .content').prepend(el);
      return {
        rows: [...el.querySelectorAll('.goal-sum-row')].map((r) => ({ id: r.dataset.goal, status: r.dataset.status, text: r.innerText })),
        more: el.querySelector('.goal-sum-more')?.textContent || null,
        title: el.querySelector('.card-title').textContent,
      };
    });
    assert.strictEqual(sum.title, '🎯 Objetivos');
    assert.deepStrictEqual(sum.rows.map((r) => r.id), ['g_ht', 'g_bw', 'g_run']);
    assert.match(sum.rows[0].text, /Datos insuficientes: 2 de 4 registros, 2 de 3 semanas/);
    assert.match(sum.rows[1].text, /Estimación: entre/);
    assert.strictEqual(sum.more, 'Otro objetivo activo en Objetivos.');
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'goals-summary-card');
    // «Ver todos» abre #/goals
    await markStale(page);
    await page.locator('.goal-sum .goal-sum-link').click();
    await waitView(page);
    assert.strictEqual(await hashOf(page), '#/goals');

    // achievedAt sincronizado (fecha del registro que lo consiguió) y en «Conseguidos», plegado
    const done = (await idbAll(page, 'goals')).find((g) => g.id === 'g_done');
    assert.strictEqual(done.achievedAt, '2026-09-07');
    assert.strictEqual(await page.locator('.goal-list .goal-card').count(), 4);
    const fold = page.locator('[data-fold="achieved"] .goal-fold');
    assert.strictEqual((await fold.innerText()).trim(), 'Conseguidos (1)'); // .trim(): salto final de WebKit
    await fold.click();
    const dc = page.locator('[data-fold="achieved"] .goal-card');
    assert.strictEqual(await dc.getAttribute('data-status'), 'achieved');
    assert.match(await dc.locator('.goal-eta').innerText(), /^Conseguido el 7\s+sep$/, 'con espacio duro entre día y mes');
    assert.strictEqual(await dc.locator('.goal-pct').innerText(), '100 %');
    const why = await (await openWhy(dc)).innerText();
    assert.match(why, /Conseguido el 7 sep: 60 kg × 8 @2/);
    assert.ok(await noHScroll(page), `sin desbordamiento: ${await overflowing(page)}`);
    await scrollShots(page, 'goals-list-seeded');

    // Conseguido reciente (≤ 7 días) aparece en la tarjeta resumen si queda hueco
    await page.evaluate(async () => {
      const { store } = window.__app;
      for (const g of store.all('goals')) if (g.id !== 'g_done' && g.id !== 'g_row') { g.archived = true; await store.save('goals', g); }
      const d = store.get('goals', 'g_done');
      d.createdAt = new Date('2026-09-20T10:00:00+02:00').getTime();
      d.achievedAt = null;
      await store.save('goals', d);
    });
    const sum2 = await page.evaluate(async () => {
      const el = (await import('./js/views/goals.js')).goalsSummaryCard();
      return [...el.querySelectorAll('.goal-sum-row')].map((r) => ({ id: r.dataset.goal, status: r.dataset.status, text: r.innerText }));
    });
    assert.deepStrictEqual(sum2.map((r) => r.id), ['g_row', 'g_done']);
    assert.strictEqual(sum2[1].status, 'achieved');
    assert.match(sum2[1].text, /Conseguido el 21\s+sep/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('375×667: #/goals y los formularios de cada tipo sin desbordamiento horizontal; botones ≥ 44 px', async () => {
  const app = await launch({ width: 375, height: 667 });
  const { page } = app;
  try {
    const older = madrid('2026-08-24', 10);
    await seed(page, {
      goals: [
        goalRow({ id: 'g_row', kind: 'strength', title: 'Remo con pecho apoyado 80 kg × 5', exerciseId: 'remo_pecho_apoyado', weight: 80, reps: 5, createdAt: older }),
        goalRow({ id: 'g_pull', kind: 'strength', title: 'Dominadas +15 kg × 5', exerciseId: 'dominadas', weight: 15, reps: 5, createdAt: older + 1 }),
        goalRow({ id: 'g_run', kind: 'endurance', title: 'Media maratón en menos de 1 h 45 min', sport: 'run', distanceKm: 21.0975, timeSec: 6300, createdAt: older + 2 }),
        goalRow({ id: 'g_bw', kind: 'bodyweight', title: 'Bajar a 74 kg', targetKg: 74, direction: 'down', createdAt: older + 3 }),
      ],
    });
    await open(page, '#/goals');
    assert.strictEqual(await page.locator('.goal-list .goal-card').count(), 4);
    assert.strictEqual(await card(page, 'Bajar a 74 kg').getAttribute('data-status'), 'no_trend');
    assert.match(await card(page, 'Bajar a 74 kg').locator('.goal-eta').innerText(), /Sin tendencia: al ritmo actual no te acercas/);
    assert.match(await card(page, 'Dominadas +15 kg × 5').locator('.goal-kind').innerText(), /1RM estimado/);
    assert.ok(await noHScroll(page), `sin desbordamiento: ${await overflowing(page)}`);
    await scrollShots(page, 'goals-se-list');
    // Objetivos táctiles (botones e inputs visibles de la vista)
    const smallTargets = () => page.evaluate(() => [...document.querySelectorAll('#view button, #view input')]
      .filter((b) => b.offsetParent !== null).map((b) => ({ c: b.className, h: Math.round(b.getBoundingClientRect().height) }))
      .filter((b) => b.h < 44));
    assert.deepStrictEqual(await smallTargets(), []);
    for (const [hash, kind] of [['#/goal/new', 'Fuerza'], ['#/goal/new', 'Resistencia'], ['#/goal/new', 'Peso'], ['#/goal/g_run', null], ['#/goal/g_pull', null]]) {
      await open(page, hash);
      if (kind) await chooseKind(page, kind);
      await page.waitForTimeout(250);
      assert.ok(await noHScroll(page), `${hash} ${kind}: ${await overflowing(page)}`);
      assert.deepStrictEqual(await smallTargets(), [], `${hash} ${kind}`);
      await scrollShots(page, `goals-se-form-${kind || 'edit'}`, 4);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('estancado, empate de marca, sin inicio y vista previa sin «null» (390×844 y 375×667)', async () => {
  // Sentadilla: sube 4 semanas (90 → 105 kg × 5 @1) y se queda en 105 kg 7 sesiones (martes). Peso muerto rumano:
  // solo en junio (el objetivo se crea el 20 sep, sin nada en los 28 días previos).
  const extra = [];
  [90, 95, 100, 105, 105, 105, 105, 105, 105, 105, 105].forEach((w, i) => {
    extra.push(strength(`sq${i}`, addDays(START, 7 * i + 1), [['sentadilla', 'Sentadilla', [{ weight: w, reps: 5 }, { weight: w, reps: 5 }]]]));
  });
  for (let i = 0; i < 4; i++) extra.push(strength(`rdl${i}`, addDays('2026-06-02', 7 * i), [['peso_muerto_rumano', 'Peso muerto rumano', [{ weight: 90 + 2.5 * i, reps: 8 }]]]));
  // Press militar: domingo 13, lunes 14, domingo 20 y lunes 21 sep → 4 sesiones en 3 semanas, pero solo 8 días
  ['2026-09-13', '2026-09-14', '2026-09-20', '2026-09-21'].forEach((d, i) => extra.push(strength(`ohp${i}`, d, [['press_militar', 'Press militar con barra', [{ weight: 40 + 2.5 * i, reps: 6 }]]])));
  const goals = [
    goalRow({ id: 'g_sq', kind: 'strength', title: 'Sentadilla 120 kg × 5', exerciseId: 'sentadilla', weight: 120, reps: 5, createdAt: madrid(START, 10) }),
    goalRow({ id: 'g_rdl', kind: 'strength', title: 'Peso muerto rumano 110 kg × 8', exerciseId: 'peso_muerto_rumano', weight: 110, reps: 8, createdAt: madrid('2026-09-20', 10) }),
    goalRow({ id: 'g_ohp', kind: 'strength', title: 'Press militar 60 kg × 5', exerciseId: 'press_militar', weight: 60, reps: 5, createdAt: madrid('2026-09-01', 10) }),
    goalRow({ id: 'g_run', kind: 'endurance', title: '10 km en menos de 50 min', sport: 'run', distanceKm: 10, timeSec: 3000, createdAt: madrid(START, 11) }),
    goalRow({ id: 'g_bw', kind: 'bodyweight', title: 'Subir a 77 kg', targetKg: 77, direction: 'up', createdAt: madrid(START, 12) }),
  ];
  /** Textos sueltos «null» / «undefined» dentro de un elemento (replaceChildren convierte null en texto). */
  const junkText = (page, sel) => page.evaluate((q) => {
    const root = document.querySelector(q);
    if (!root) return ['(sin elemento)'];
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/^\s*(null|undefined)\s*$/.test(n.nodeValue) || /\b(null|undefined|NaN)\b/.test(n.nodeValue)) out.push(n.nodeValue);
    return out;
  }, sel);
  for (const [width, height, tag] of [[390, 844, '390'], [375, 667, '375']]) {
    const app = await launch({ width, height });
    const { page } = app;
    try {
      await seed(page, { goals, extra });
      await open(page, '#/goals');
      // Estancado: sin rango de fechas aunque la pendiente de 12 semanas sea positiva
      const sq = card(page, 'Sentadilla 120 kg × 5');
      assert.strictEqual(await sq.getAttribute('data-status'), 'no_trend');
      assert.strictEqual(await sq.locator('.goal-badge').innerText(), 'Sin tendencia');
      assert.strictEqual(await sq.locator('.goal-eta').innerText(), 'Sin tendencia: estancado desde el 4 ago (126 kg)');
      // Empate de marca (105 kg × 5 las 8 últimas sesiones): «Actual» con la más reciente
      assert.match(await sq.locator('.goal-val').first().innerText(), /126\s?kg[\s\S]*105 kg × 5 @1 · 22 sep/);
      const why = await openWhy(sq);
      const whyTxt = await why.innerText();
      assert.match(whyTxt, /no supera 126 kg \(4 ago\) en las 7 sesiones siguientes/);
      assert.match(whyTxt, /umbral de estancamiento \(3 sesiones o 3 semanas sin superar tu mejor marca\)/);
      // Sin inicio: progreso «—» (no 102 kg / 139 kg = 73 %)
      const rdl = card(page, 'Peso muerto rumano 110 kg × 8');
      assert.strictEqual(await rdl.locator('.goal-pct').innerText(), '—');
      assert.strictEqual(await rdl.locator('.goal-bar').getAttribute('aria-valuenow'), '0');
      await rdl.scrollIntoViewIfNeeded();
      await shot(page, `goals-nostart-${tag}`);
      // 4 sesiones que tocan 3 semanas en 8 días: datos insuficientes, con lo que falta
      const ohp = card(page, 'Press militar 60 kg × 5');
      assert.strictEqual(await ohp.getAttribute('data-status'), 'insufficient');
      assert.strictEqual(await ohp.locator('.goal-eta').innerText(), 'Datos insuficientes: solo 8 de 14 días entre el primero y el último');
      assert.match(await (await openWhy(ohp)).innerText(), /4 sesiones con Press militar con barra en 3 semanas, pero entre el primero y el último solo hay 8 días/);
      await ohp.scrollIntoViewIfNeeded();
      await shot(page, `goals-span-${tag}`);
      assert.deepStrictEqual(await junkText(page, '#view'), []);
      assert.ok(await noHScroll(page), `sin desbordamiento: ${await overflowing(page)}`);
      await sq.scrollIntoViewIfNeeded();
      await shot(page, `goals-stall-${tag}`);
      // Vista previa «Con tus datos» de cada tipo (editar y nuevo) sin «null»
      for (const hash of ['#/goal/g_sq', '#/goal/g_run', '#/goal/g_bw', '#/goal/g_rdl', '#/goal/new?kind=bodyweight', '#/goal/new?kind=endurance']) {
        await open(page, hash);
        await page.waitForTimeout(250);
        const prev = page.locator('.goal-preview');
        assert.ok(await prev.locator('.goal-values').count() === 1, `${hash}: vista previa con valores`);
        assert.deepStrictEqual(await junkText(page, '.goal-preview'), [], hash);
        assert.ok(await noHScroll(page), `${hash}: ${await overflowing(page)}`);
      }
      await open(page, '#/goal/g_sq');
      await page.waitForTimeout(250);
      await page.locator('.goal-preview').scrollIntoViewIfNeeded();
      assert.match(await page.locator('.goal-preview .goal-eta').innerText(), /^Sin tendencia: estancado desde el 4 ago/);
      await shot(page, `goals-preview-stall-${tag}`);
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  }
});
