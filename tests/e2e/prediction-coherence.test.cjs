// E2E de la ronda 8 · B1: UN SOLO motor de predicción de carrera. Con los mismos datos (seis carreras de 8 km a 5:40 /km,
// un 5 km a 4:50 /km y un 5 km apuntado en «Tu contexto»), un objetivo «10 km en menos de 51:00» y un evento 10K con
// ese objetivo enlazado, Tiempos previstos (tarjeta y «¿Puedo hacerlo?»), Objetivos, «Cómo vas» del evento y el tile
// «5 km previsto» de Análisis enseñan el MISMO previsto, rango y confianza (data-mid/low/high/confidence) y el mismo
// veredicto. Antes, Objetivos decía «Al alcance» con su propio Riegel (50:23) mientras Eventos decía «Hoy no» (55:30),
// y el tile de Análisis enseñaba el 5 km de un bloque de 4 semanas (sin el resultado del contexto). Capturas de la
// tarjeta del objetivo a 375 px y con el texto al 150 %. Datos sintéticos relativos a hoy. También en WebKit
// (E2E_BROWSER=webkit).
// C4 (mejores tramos): con una carrera importada de 12,4 km que lleva dentro un 5 km a 4:58 /km (24:50), la base de
// Tiempos previstos usa ese tramo («mejor tramo de una carrera de 12,4 km»), el 5 km previsto sale más rápido que con
// la misma carrera a ritmo medio, y Objetivos, «Cómo vas» del evento 5K y el tile de Análisis siguen diciendo lo mismo.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/prediction-coherence.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, settle, shot, BROWSER } = require('./helpers.cjs');

const TARGET = 51 * 60;

async function seed(page) {
  await page.evaluate(async (target) => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const C = await import('./js/context-logic.js');
    const T = u.todayStr();
    const run = (ago, km, sec) => { const date = u.addDays(T, -ago); return { id: `run_${ago}_${km}`, kind: 'run', status: 'done', date, startedAt: u.tsFromDate(date, 8), createdAt: u.tsFromDate(date, 8), durationMin: sec / 60, movingSec: sec, distanceKm: km, rpe: 6 }; };
    const sessions = [];
    for (let i = 0; i < 6; i++) sessions.push(run(3 + 7 * i, 8, 8 * 340));
    sessions.push(run(10, 5, 5 * 290));
    const context = [C.entryRecord({ kind: 'event', type: 'race_result', date: { date: u.addDays(T, -30), precision: 'day' }, text: '', notes: '', result: { km: 5, sec: 1410 } }, { id: 'ctx_5k', now: 1 })];
    const goal = { id: 'goal_10k', kind: 'endurance', sport: 'run', distanceKm: 10, timeSec: target, title: '10 km en menos de 51 min', titleAuto: true, createdAt: u.tsFromDate(u.addDays(T, -60), 9), achievedAt: null, archived: false };
    const race = { id: 'race_10k', name: 'Carrera de ejemplo', type: '10k', date: u.addDays(T, 40), distanceKm: 10, targetSec: target, priority: 'A', note: '', goalId: 'goal_10k', createdAt: 1, updatedAt: 1 };
    await db.putStores({ sessions, context, goals: [goal], races: [race] });
  }, TARGET);
  await reload(page);
}

const ds = (loc) => loc.evaluate((el) => ({ mid: el.dataset.mid, low: el.dataset.low, high: el.dataset.high, confidence: el.dataset.confidence, verdict: el.dataset.verdict }));
const clean = (s) => String(s).replace(/[ ⁠]/g, ' ');

async function flow(browser) {
  const app = await openApp({ browser });
  const { page, errors } = app;
  try {
    await seed(page);
    // Lo que calcula el motor (la referencia; la vista debe enseñar exactamente esto)
    const ref = await page.evaluate(async (target) => {
      const rp = await import('./js/race-predict.js');
      const u = await import('./js/util.js');
      const pu = await import('./js/progress-ui.js');
      const d = pu.dataFromStore(u.todayStr());
      const p = rp.predictFor(d, 10).prediction;
      const p5 = rp.predictFor(d, 5).prediction;
      return {
        mid: String(p.mid), low: String(p.low), high: String(p.high), confidence: p.confidence, time: u.fmtRaceTime(p.mid),
        verdict: rp.checkTarget(d, 10, target).verdict, mid5: String(p5.mid), time5: u.fmtRaceTime(p5.mid),
      };
    }, TARGET);
    const base = { mid: ref.mid, low: ref.low, high: ref.high, confidence: ref.confidence };

    // Tiempos previstos: tarjeta de 10 km y «¿Puedo hacerlo?» con 10 km en 51:00
    await go(page, '#/predictions');
    const card10 = page.locator('.prd-race[data-race="10k"]');
    const c10 = await ds(card10);
    assert.deepStrictEqual({ ...c10, verdict: undefined }, { ...base, verdict: undefined }, 'tarjeta 10 km');
    assert.ok(clean(await card10.innerText()).includes(ref.time));
    const card5 = await ds(page.locator('.prd-race[data-race="5k"]'));
    await page.locator('.prd-seg .seg-btn', { hasText: /^10 km$/ }).click();
    await page.fill('.prd-check input[aria-label="Tiempo objetivo: h"]', '');
    await page.fill('.prd-check input[aria-label="Tiempo objetivo: min"]', '51');
    await page.fill('.prd-check input[aria-label="Tiempo objetivo: s"]', '0');
    await page.locator('.prd-verdict').waitFor();
    const chk = await ds(page.locator('.prd-verdict'));
    assert.deepStrictEqual(chk, { ...base, verdict: ref.verdict }, '¿Puedo hacerlo?');

    // Objetivos: «Actual» = el mismo previsto, mismo rango y confianza, mismo veredicto
    await go(page, '#/goals');
    const gcard = page.locator('.goal-card[data-goal="goal_10k"]');
    assert.deepStrictEqual(await ds(gcard), { ...base, verdict: ref.verdict }, 'objetivo');
    assert.strictEqual(clean(await gcard.locator('.goal-val-v').first().innerText()), ref.time, 'antes: 50:23 (Riegel propio)');
    assert.notStrictEqual(await gcard.getAttribute('data-status'), 'ready', 'antes: «Al alcance» frente a «Hoy no»');
    assert.match(clean(await gcard.locator('.goal-verdict').innerText()), /^(Probable|Ajustado|Hoy no) · /);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desplazamiento horizontal');

    // Eventos › «Cómo vas»: el bloque del evento y el del objetivo enlazado dicen lo mismo
    await go(page, '#/races/race_10k');
    const how = page.locator('.rc-how');
    await how.waitFor();
    assert.deepStrictEqual(await ds(how.locator('.rc-how-pred')), { ...base, verdict: ref.verdict }, 'evento');
    assert.deepStrictEqual(await ds(how.locator('.rc-how-goal')), { ...base, verdict: ref.verdict }, 'objetivo enlazado');
    assert.ok(clean(await how.locator('.rc-how-text').first().innerText()).includes(ref.time));
    await go(page, '#/races');
    assert.deepStrictEqual(await ds(page.locator('.rc-row-pred').first()), { ...base, verdict: ref.verdict }, 'lista de eventos');

    // Análisis: el tile «5 km previsto» es el de Tiempos previstos (antes, el de un bloque de 4 semanas sin el contexto)
    await go(page, '#/analysis');
    const tile = page.locator('[data-kpi="fivek"]');
    await tile.waitFor();
    assert.deepStrictEqual({ ...(await ds(tile)), verdict: undefined }, { ...card5, verdict: undefined }, 'tile 5 km = tarjeta 5 km');
    assert.ok(clean(await tile.innerText()).includes(ref.time5));
    assert.deepStrictEqual(errors, []);
  } finally {
    await app.close();
  }
}

/** Tarjeta del objetivo a 375 px (texto 100 % y 150 %): sin desbordes y con los valores sin montarse. */
async function shots(browser, tag) {
  for (const scale of [1, 1.5]) {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.evaluate((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
      await seed(page);
      await go(page, '#/goals');
      const gcard = page.locator('.goal-card[data-goal="goal_10k"]');
      await gcard.scrollIntoViewIfNeeded();
      await settle(page);
      await shot(page, `prediction-coherence-goal-${tag}-${scale === 1 ? '100' : '150'}`);
      const bad = await gcard.evaluate((card) => {
        const out = [];
        const cr = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.right > cr.right + 1 || r.left < cr.left - 1)) out.push(`${el.className} se sale de la tarjeta`);
        }
        const vals = [...card.querySelectorAll('.goal-val-v')];
        for (const v of vals) if (v.scrollWidth > v.clientWidth + 1) out.push(`${v.textContent} recortado`);
        return out;
      });
      assert.deepStrictEqual(bad, [], `texto ${scale * 100} %`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desplazamiento horizontal');
    } finally {
      await app.close();
    }
  }
}

test(`mismo previsto, rango, confianza y veredicto en Tiempos previstos, Objetivos, Eventos y Análisis (${BROWSER})`, () => flow(BROWSER));
test(`tarjeta del objetivo de carrera a 375 px con texto al 100 % y al 150 % (${BROWSER})`, () => shots(BROWSER, BROWSER));

// --- C4: mejores tramos de una carrera importada ---------------------------------------------------------------------
const TARGET5 = 25 * 60;

/** Seis carreras de 8 km a 5:40 /km y una importada de 12,4 km (3,12 km a 5:30, 5 km a 4:58, 4,28 km a 5:30) con sus
 *  parciales calculados como en la importación; un objetivo 5 km en 25:00 y un evento 5K enlazado. */
async function seedPartial(page) {
  await page.evaluate(async (target) => {
    const u = await import('./js/util.js');
    const db = await import('./js/db.js');
    const be = await import('./js/best-efforts.js');
    const T = u.todayStr();
    const run = (ago, km, sec, extra = {}) => { const date = u.addDays(T, -ago); return { id: `run_${ago}_${km}`, kind: 'run', status: 'done', date, startedAt: u.tsFromDate(date, 8), createdAt: u.tsFromDate(date, 8), durationMin: sec / 60, movingSec: sec, distanceKm: km, rpe: 6, ...extra }; };
    const sessions = [];
    for (let i = 0; i < 6; i++) sessions.push(run(3 + 7 * i, 8, 8 * 340));
    const t = [0]; const d = [0]; let ts = 0; let dm = 0;
    for (const p of [{ km: 3.12, pace: 330 }, { km: 5, pace: 298 }, { km: 4.28, pace: 330 }]) {
      const n = Math.round(p.km * p.pace);
      for (let i = 1; i <= n; i++) { t.push(ts + i); d.push(dm + (p.km * 1000 * i) / n); }
      ts += n; dm += p.km * 1000;
    }
    const date = u.addDays(T, -5);
    const t0 = u.tsFromDate(date, 8) / 1000;
    const series = be.buildSeries({ t: t.map((x) => t0 + x), d, src: 'device' });
    const km = Math.round(dm) / 1000;
    sessions.push(run(5, km, ts, {
      id: 'run_import_12k', source: { type: 'fit', fileName: 'carrera.fit' }, track: be.encodeTrack(series),
      bestEfforts: be.computeBestEfforts({ series, basis: { km, sec: ts } }),
    }));
    const goal = { id: 'goal_5k', kind: 'endurance', sport: 'run', distanceKm: 5, timeSec: target, title: '5 km en menos de 25 min', titleAuto: true, createdAt: u.tsFromDate(u.addDays(T, -60), 9), achievedAt: null, archived: false };
    const race = { id: 'race_5k', name: 'Carrera de ejemplo', type: '5k', date: u.addDays(T, 30), distanceKm: 5, targetSec: target, priority: 'A', note: '', goalId: 'goal_5k', createdAt: 1, updatedAt: 1 };
    await db.putStores({ sessions, goals: [goal], races: [race] });
  }, TARGET5);
  await reload(page);
}

async function flowPartial(browser) {
  const app = await openApp({ browser });
  const { page, errors } = app;
  try {
    await seedPartial(page);
    const ref = await page.evaluate(async (target) => {
      const rp = await import('./js/race-predict.js');
      const u = await import('./js/util.js');
      const pu = await import('./js/progress-ui.js');
      const d = pu.dataFromStore(u.todayStr());
      const p = rp.predictFor(d, 5).prediction;
      // La misma carrera sin parciales (a ritmo medio), en una copia de los datos
      const plain = { ...d, sessions: d.sessions.map((s) => (s.id === 'run_import_12k' ? { ...s, bestEfforts: undefined, track: undefined } : s)) };
      const q = rp.predictFor(plain, 5).prediction;
      return {
        mid: String(p.mid), low: String(p.low), high: String(p.high), confidence: p.confidence, time: u.fmtRaceTime(p.mid),
        verdict: rp.checkTarget(d, 5, target).verdict, midExact: p.midExact, plainExact: q.midExact,
        partial: p.efforts.find((e) => e.sessionId === 'run_import_12k')?.partial ?? null,
      };
    }, TARGET5);
    assert.deepStrictEqual(ref.partial, { id: '5k', ofKm: 12.4, atKm: 3.12 });
    assert.ok(ref.midExact < ref.plainExact - 1, `con el tramo ${ref.midExact} < a ritmo medio ${ref.plainExact}`);
    const base = { mid: ref.mid, low: ref.low, high: ref.high, confidence: ref.confidence };

    // Tiempos previstos: tarjeta 5 km y, en «Con qué se calcula», el tramo como esfuerzo (una sola vez)
    await go(page, '#/predictions');
    const card5 = page.locator('.prd-race[data-race="5k"]');
    assert.deepStrictEqual({ ...(await ds(card5)), verdict: undefined }, { ...base, verdict: undefined }, 'tarjeta 5 km');
    const eff = page.locator('.prd-basis .prd-effort[data-session="run_import_12k"]');
    assert.strictEqual(await eff.count(), 1, 'una sola vez por carrera');
    assert.strictEqual(await eff.getAttribute('data-partial'), '5k');
    const effTxt = clean(await eff.innerText());
    assert.match(effTxt, /5 km en 24:50/);
    assert.match(effTxt, /mejor tramo de una carrera de 12,4 km/);

    // Objetivos, «Cómo vas» del evento y el tile de Análisis: el mismo previsto, rango, confianza y veredicto
    await go(page, '#/goals');
    assert.deepStrictEqual(await ds(page.locator('.goal-card[data-goal="goal_5k"]')), { ...base, verdict: ref.verdict }, 'objetivo');
    await go(page, '#/races/race_5k');
    const how = page.locator('.rc-how');
    await how.waitFor();
    assert.deepStrictEqual(await ds(how.locator('.rc-how-pred')), { ...base, verdict: ref.verdict }, 'evento');
    await go(page, '#/analysis');
    const tile = page.locator('[data-kpi="fivek"]');
    await tile.waitFor();
    assert.deepStrictEqual({ ...(await ds(tile)), verdict: undefined }, { ...base, verdict: undefined }, 'tile 5 km');
    assert.deepStrictEqual(errors, []);
  } finally {
    await app.close();
  }
}

/** «Con qué se calcula» con el tramo a 375 px (texto 100 % y 150 %): la línea no se sale ni se monta. */
async function shotsPartial(browser) {
  for (const scale of [1, 1.5]) {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.evaluate((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
      await seedPartial(page);
      await go(page, '#/predictions');
      const eff = page.locator('.prd-basis .prd-effort[data-partial="5k"]');
      await eff.scrollIntoViewIfNeeded();
      await settle(page);
      await shot(page, `prediction-partial-${browser}-${scale === 1 ? '100' : '150'}`);
      const bad = await eff.evaluate((el) => {
        const out = [];
        const r0 = el.getBoundingClientRect();
        for (const c of el.querySelectorAll('*')) {
          const r = c.getBoundingClientRect();
          if (r.width && (r.right > r0.right + 1 || r.left < r0.left - 1)) out.push(`${c.className} se sale`);
        }
        return out;
      });
      assert.deepStrictEqual(bad, [], `texto ${scale * 100} %`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sin desplazamiento horizontal');
    } finally {
      await app.close();
    }
  }
}

test(`C4: el mejor tramo de una carrera importada entra en la base y todas las pantallas coinciden (${BROWSER})`, () => flowPartial(BROWSER));
test(`C4: «Con qué se calcula» con el tramo a 375 px con texto al 100 % y al 150 % (${BROWSER})`, () => shotsPartial(BROWSER));
