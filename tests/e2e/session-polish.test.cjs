// Sesión y resumen (docs/PULIDO.md §9–10): «Última vez» bien visible y el siguiente paso discreto de la doble
// progresión (la misma regla que el panel semanal); al terminar, dos cifras protagonistas, los récords en su tarjeta (solo si los hay; ronda 8, A6) y «Frente a la anterior»
// (la misma rutina, solo datos reales; sin sesión comparable, no sale). 375 px, Chromium y WebKit. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/session-polish.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const TODAY = '2026-10-07';
const PREV = '2026-10-05';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

async function flow(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  // La anterior del Día 1: press banca 3 × 80 kg × 6 (el tope de 4–6) con RIR 2 → toca subir; dominadas 2 × 6 con +10 kg
  const prevId = await page.evaluate(async ({ date, at }) => {
    const { store } = window.__app;
    const tpl = store.get('templates', 'tpl_d1');
    const mk = (id, w, r) => ({ id, type: 'effective', done: true, weight: w, reps: r, rir: 2, doneAt: at });
    const exercises = tpl.items.map((it, k) => ({
      id: `prev_se${k}`, exerciseId: it.exerciseId, templateItemId: it.id, alternatives: [], notes: '', section: '', target: { sets: it.sets, repMin: it.repMin, repMax: it.repMax },
      sets: it.exerciseId === 'press_banca' ? [mk('pb1', 80, 6), mk('pb2', 80, 6), mk('pb3', 80, 6)]
        : it.exerciseId === 'dominadas' ? [mk('d1', 10, 6), mk('d2', 10, 6)] : [],
    }));
    await store.save('sessions', { id: 'prev_d1', kind: 'strength', date, planDate: date, templateId: 'tpl_d1', templateName: tpl.name, status: 'done', startedAt: at, endedAt: at + 3600e3, durationMin: 60, rpe: 7, notes: '', exercises, createdAt: at, updatedAt: at });
    return 'prev_d1';
  }, { date: PREV, at: madrid(PREV, 18) });

  // --- Sesión de hoy (Día 1): «Última vez» y, junto al objetivo, «Sube a 82,5 kg» ---
  const id = await page.evaluate(async (d) => {
    const sl = await import('./js/session-logic.js');
    const s = await sl.createStrengthSession({ templateId: 'tpl_d1', date: d, planDate: d });
    return s.id;
  }, TODAY);
  await go(page, `#/session/${id}`);
  const bench = page.locator('.ses-card', { has: page.locator('.ses-name', { hasText: /^Press banca$/ }) });
  await bench.waitFor();
  assert.strictEqual(clean(await bench.locator('.ses-last-label').innerText()).toLowerCase(), 'última vez');
  assert.strictEqual(clean(await bench.locator('.ses-last-date').innerText()), '· 5 oct');
  assert.strictEqual(clean(await bench.locator('.ses-last-sets').innerText()), '80×6 @2 · 80×6 @2 · 80×6 @2');
  const fs = await bench.locator('.ses-last-sets').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  assert.ok(fs >= 16, `las series de la última vez, más grandes que el resto (${fs} px)`);
  assert.strictEqual(await bench.locator('.ses-next').getAttribute('data-kind'), 'up');
  assert.strictEqual(clean(await bench.locator('.ses-next').innerText()), 'Sube a 82,5 kg');
  // En la línea del objetivo (no añade altura a la tarjeta) y con la frase entera para VoiceOver
  assert.strictEqual(await bench.locator('.ses-target .ses-next').count(), 1);
  assert.strictEqual(await bench.locator('.ses-next').getAttribute('aria-label'), 'Siguiente paso: sube a 82,5 kg');
  const pull = page.locator('.ses-card', { has: page.locator('.ses-name', { hasText: /^Dominadas$/ }) });
  if (await pull.count()) {
    // 2 series de 6 (la rutina pide 3 de 6–8) → aún no se sube: cuándo (las 3 al tope) y cuánto
    assert.match(clean(await pull.locator('.ses-next').innerText()), /^8\/8\/8 → \+2,5 kg de lastre$/);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // --- Terminar con 82,5 × 6 en press banca y 10 × 7 en dominadas → resumen y «Frente a la anterior» ---
  await page.evaluate(async (sid) => {
    const { store } = window.__app;
    const s = store.get('sessions', sid);
    for (const se of s.exercises) {
      se.sets = se.exerciseId === 'press_banca' ? [{ id: 'n1', type: 'effective', done: true, weight: 82.5, reps: 6, rir: 1 }, { id: 'n2', type: 'effective', done: true, weight: 82.5, reps: 5, rir: 1 }]
        : se.exerciseId === 'dominadas' ? [{ id: 'n3', type: 'effective', done: true, weight: 10, reps: 7, rir: 1 }] : [];
    }
    s.status = 'done';
    s.endedAt = s.startedAt + 50 * 60e3;
    s.durationMin = 50;
    s.rpe = 8;
    await store.save('sessions', s);
  }, id);
  await go(page, `#/session/${id}/summary`);
  await page.locator('.ses-sum-hero').waitFor();
  // Ronda 8 (A6): dos cifras (sin casilla «Récords»); los récords, en su tarjeta destacada
  assert.deepStrictEqual(await page.locator('.ses-sum-kpis .kpi-label').allInnerTexts(), ['Duración', 'Series de trabajo']);
  // 82,5 × 6 en press banca (antes 80) y +10 × 7 en dominadas (antes × 6): 2 series récord, con cuáles y de qué tipo
  const prs = page.locator('.ses-sum-prs');
  assert.strictEqual(await prs.getAttribute('data-count'), '2');
  assert.strictEqual(clean(await prs.locator('.ses-sum-prs-title').innerText()), '2 récords en esta sesión');
  assert.deepStrictEqual((await prs.locator('.ses-sum-pr-name').allInnerTexts()).map(clean), ['Press banca', 'Dominadas']);
  assert.deepStrictEqual((await prs.locator('.ses-sum-pr-set').allInnerTexts()).map(clean), ['82,5 kg × 6 @1', '+10 kg × 7 @1']);
  assert.match(clean(await prs.locator('.ses-sum-pr-kind').first().innerText()), /^Peso máximo: 82,5 kg \(antes 80 kg\)/);
  // justo bajo la cabecera, antes de «Frente a la anterior»
  assert.ok(await page.evaluate(() => document.querySelector('.ses-sum-hero').nextElementSibling?.classList.contains('ses-sum-prs')));
  assert.strictEqual(clean(await page.locator('.ses-sum-kpis .kpi').nth(0).locator('.kpi-value').innerText()), '50 min');
  assert.match(await page.locator('.ses-sum-meta').innerText(), /^Esfuerzo 8\/10 · .+ · Volumen [\d.]+ kg · Carga 400$/);
  const cmp = page.locator('.ses-sum-cmp');
  assert.strictEqual(await cmp.getAttribute('data-prev'), prevId);
  assert.match(await cmp.locator('.ses-cmp-sub').innerText(), /el 5 oct/);
  const rows = await cmp.locator('.ses-cmp-row').evaluateAll((els) => els.map((e) => [e.dataset.ex, e.dataset.dir, e.querySelector('.ses-cmp-val').textContent]));
  assert.deepStrictEqual(rows, [['press_banca', 'up', '+2,5 kg'], ['dominadas', 'up', '+1 rep']]);
  // Ronda 8 (A4): tono de util.deltaTone (subir en el mismo ejercicio = mejora; bajar sería neutro, no ámbar)
  assert.deepStrictEqual(await cmp.locator('.ses-cmp-row').evaluateAll((els) => els.map((e) => e.dataset.tone)), ['good', 'good']);
  assert.match(await cmp.locator('.ses-cmp-totals').innerText(), /^Series de trabajo 3 \(antes 5\) · volumen [+−]\d+ % · duración 50 min \(antes 1 h 00 min\)$/);
  // Cada fila dice qué pasó con texto e icono con nombre accesible (no solo color)
  assert.deepStrictEqual(await cmp.locator('.ses-cmp-icon').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label'))), ['Mejora', 'Mejora']);
  const cut = await page.locator('.ses-sum-hero .kpi-value, .ses-sum-hero .kpi-label').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
  assert.deepStrictEqual(cut, [], 'nada cortado a 375 px');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

  // --- Sin sesión comparable (borrada la anterior): no hay «Frente a la anterior» ---
  await page.evaluate(async () => { await window.__app.store.remove('sessions', 'prev_d1'); });
  await go(page, '#/today');
  await go(page, `#/session/${id}/summary`);
  await page.locator('.ses-sum-hero').waitFor();
  assert.strictEqual(await page.locator('.ses-sum-cmp').count(), 0);
  // Sin récords (ya no hay con qué compararla): ni tarjeta ni casilla «Récords 0 / ninguno esta vez»
  assert.strictEqual(await page.locator('.ses-sum-prs').count(), 0);
  assert.doesNotMatch(await page.locator('#view').innerText(), /Récords|ninguno esta vez/);

  // --- «1 h 10 min» en UNA línea a 375 px (antes, «1 h 10» / «min» en la casilla estrecha) ---
  await page.evaluate(async (sid) => {
    const { store } = window.__app;
    const s = store.get('sessions', sid);
    s.durationMin = 70;
    s.endedAt = s.startedAt + 70 * 60e3;
    await store.save('sessions', s);
  }, id);
  await go(page, '#/today');
  await go(page, `#/session/${id}/summary`);
  const durVal = page.locator('.ses-sum-kpis .kpi').nth(0).locator('.kpi-value');
  await durVal.waitFor();
  assert.strictEqual(clean(await durVal.innerText()), '1 h 10 min');
  const lines = await durVal.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    // Cifras y unidades tienen alturas distintas: misma línea = sus rectángulos se solapan en vertical
    const rects = [...r.getClientRects()].filter((q) => q.width > 0);
    return Math.max(...rects.map((q) => q.top)) < Math.min(...rects.map((q) => q.bottom)) ? 1 : 2;
  });
  assert.strictEqual(lines, 1, '«1 h 10 min» en una sola línea');
  const fits = await durVal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  assert.ok(fits, '«1 h 10 min» cabe en su casilla');
}

for (const browser of ['chromium', 'webkit']) {
  test(`${browser === 'webkit' ? 'WebKit: ' : ''}sesión: «Última vez» + «Siguiente paso»; resumen: dos cifras, récords y «Frente a la anterior» (375 px)`,
    { skip: browser === 'webkit' ? skipWebkit : false }, async () => {
      const app = await openApp({ browser, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
      try {
        await flow(app.page);
        assert.deepStrictEqual(app.errors, []);
      } finally {
        await app.close();
      }
    });
}
