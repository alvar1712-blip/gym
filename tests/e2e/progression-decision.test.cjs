// Ronda 8 (B4): estancamiento frente a doble progresión. El «Siguiente paso» de la sesión y el panel semanal salen
// de UNA decisión (progression.progressionHint): «Sube a …» · «Mantén y vuelve a evaluar» · «Llevas N sesiones sin
// progresar · revisar» (discreto; «revisar» lleva al progreso del ejercicio). En la línea del objetivo, sin sumar
// altura: en un iPhone SE «Registrar serie» sigue a la vista sin desplazar (también con el texto al 150 %).
// 375 px, Chromium y WebKit. Datos sintéticos.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/progression-decision.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, waitRoute, shot, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const clean = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();

// Historiales de press banca (Día 1: 3 × 4–6), una sesión por semana hasta la semana pasada: [peso, reps, rir] × 3
const x3 = (w, r, rir = 2) => [[w, r, rir], [w, r, rir], [w, r, rir]];
const CASES = {
  // progresa; la última vez, una serie sin llegar al tope → mantén hasta 6/6/6 (la pista de siempre: la referencia de altura)
  hold: [x3(75, 5), x3(75, 6), x3(77.5, 5), [[77.5, 6, 2], [77.5, 6, 2], [77.5, 5, 2]]],
  // progresa y la última vez, las tres al tope con RIR 2 → sube
  up: [x3(75, 5), x3(75, 6), x3(77.5, 5), x3(77.5, 6)],
  // la última vez al tope, pero sin RIR registrado → ambiguo
  review: [x3(75, 5), x3(75, 6), x3(77.5, 5), x3(77.5, 6, null)],
  // cinco semanas con 80 × 6/6/6: al tope, pero el 1RM estimado no mejora → estancado (antes: «Sube a 82,5 kg»)
  stalled: [x3(80, 6), x3(80, 6), x3(80, 6), x3(80, 6), x3(80, 6)],
};

/** Borra las sesiones, guarda el historial y abre una sesión del Día 1 de hoy; devuelve la tarjeta de press banca. */
async function openCase(page, rows) {
  const id = await page.evaluate(async ({ rows, today }) => {
    const { store } = window.__app;
    const u = await import('./js/util.js');
    const sl = await import('./js/session-logic.js');
    for (const s of store.all('sessions')) await store.remove('sessions', s.id);
    const tpl = store.get('templates', 'tpl_d1');
    const it = tpl.items.find((x) => x.exerciseId === 'press_banca');
    for (let i = 0; i < rows.length; i++) {
      const date = u.addDays(today, -7 * (rows.length - i));
      const at = u.tsFromDate(date, 18);
      await store.save('sessions', {
        id: `h${i}`, kind: 'strength', date, planDate: date, templateId: 'tpl_d1', templateName: tpl.name, status: 'done',
        startedAt: at, endedAt: at + 3600e3, durationMin: 60, rpe: 7, notes: '', createdAt: at, updatedAt: at,
        exercises: [{
          id: `h${i}_se`, exerciseId: 'press_banca', templateItemId: it.id, alternatives: [], notes: '', section: '',
          target: { sets: it.sets, repMin: it.repMin, repMax: it.repMax },
          sets: rows[i].map(([w, r, rir], k) => ({ id: `h${i}_${k}`, type: 'effective', done: true, weight: w, reps: r, rir, doneAt: at })),
        }],
      });
    }
    const s = await sl.createStrengthSession({ templateId: 'tpl_d1', date: today, planDate: today });
    return s.id;
  }, { rows, today: TODAY });
  await go(page, `#/session/${id}`);
  const card = page.locator('.ses-card', { has: page.locator('.ses-name', { hasText: /^Press banca$/ }) });
  await card.locator('.ses-target').waitFor();
  return { id, card };
}

/** Líneas de la fila del objetivo (por posición de sus piezas) y si «Registrar serie» se ve sin desplazar. */
function layout(card) {
  return card.evaluate((el) => {
    const t = el.querySelector('.ses-target');
    // Filas = centros verticales distintos (las piezas tienen tamaños de letra distintos: alineadas al centro)
    const mids = [...t.children].map((c) => { const q = c.getBoundingClientRect(); return q.top + q.height / 2; });
    const tops = new Set(mids.map((m) => mids.find((o) => Math.abs(o - m) < 4)));
    const next = el.querySelector('.ses-next');
    // El texto (el botón de «revisar» tiene relleno para el objetivo táctil de 44 px, compensado con margen)
    const r = next.querySelector(':scope > span').getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(next).lineHeight);
    const b = el.querySelector('.ses-register')?.getBoundingClientRect();
    const tab = (document.getElementById('tabbar') || document.querySelector('.focus-bar'))?.getBoundingClientRect().top ?? innerHeight;
    return {
      rows: tops.size, nextLines: Math.round(r.height / lh), targetH: Math.round(t.getBoundingClientRect().height),
      registerVisible: !!b && b.bottom <= Math.min(tab, innerHeight) + 1, overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

async function flow(page, { browser, scale }) {
  const tag = `${browser}${scale > 1 ? '-150' : ''}`;
  await page.setViewportSize({ width: 375, height: 667 });
  const seen = {};
  for (const [kind, rows] of Object.entries(CASES)) {
    const { card } = await openCase(page, rows);
    const next = card.locator('.ses-target .ses-next');
    assert.strictEqual(await next.count(), 1, `${kind}: en la línea del objetivo`);
    assert.strictEqual(await next.getAttribute('data-kind'), kind);
    seen[kind] = { text: clean(await next.innerText()), label: await next.getAttribute('aria-label'), ...(await layout(card)) };
    await shot(page, `progression-${kind}-${tag}`);
  }
  assert.strictEqual(seen.up.text, 'Sube a 80 kg');
  assert.strictEqual(seen.review.text, 'Mantén y reevalúa');
  assert.match(seen.review.label, /^Siguiente paso: mantén el peso y vuelve a evaluar \(llegaste al tope sin RIR registrado\)$/);
  assert.strictEqual(seen.hold.text, '6/6/6 → +2,5 kg');
  assert.strictEqual(seen.stalled.text, 'Estancado · revisar');
  assert.strictEqual(seen.stalled.label, 'Siguiente paso: revisar. Llevas 3 sesiones sin progresar (sin mejorar tu 1RM estimado)');
  for (const [kind, s] of Object.entries(seen)) {
    // Sin altura de más: el siguiente paso en UNA línea, la fila del objetivo no más alta que con la pista de siempre
    // («6/6/6 → +2,5 kg») y, al 100 %, junto al objetivo y con «Registrar serie» a la vista en un iPhone SE sin desplazar
    assert.strictEqual(s.nextLines, 1, `${kind}: el siguiente paso en una línea (${tag})`);
    assert.ok(s.targetH <= seen.hold.targetH + 1, `${kind}: fila del objetivo de ${s.targetH} px (con «mantén», ${seen.hold.targetH} px) (${tag})`);
    if (scale === 1) {
      assert.strictEqual(s.rows, 1, `${kind}: en la misma línea que «Objetivo 3×4–6» (${tag})`);
      assert.ok(s.registerVisible, `${kind}: «Registrar serie» a la vista sin desplazar (${tag})`);
    }
    assert.ok(!s.overflow, `${kind}: sin desplazamiento horizontal (${tag})`);
  }

  // «revisar» lleva al progreso del ejercicio, y el panel semanal dice lo mismo (estancado, sin «Subir peso»)
  const { id } = await openCase(page, CASES.stalled);
  await page.locator('.ses-next-btn').click();
  await waitRoute(page, /^#\/progress\/exercise\/press_banca/);
  await go(page, '#/weekly');
  const panel = clean(await page.locator('#view').innerText());
  assert.match(panel, /Press banca estancado/);
  assert.doesNotMatch(panel, /Press banca: sube/);
  await go(page, `#/session/${id}`);
  await page.locator('.ses-next-btn').waitFor();
}

for (const browser of ['chromium', 'webkit']) {
  for (const scale of [1, 1.5]) {
    test(`${browser === 'webkit' ? 'WebKit: ' : ''}siguiente paso: sube · mantén y vuelve a evaluar · sin progresar · revisar (375 px, texto ${scale * 100} %)`,
      { skip: browser === 'webkit' ? skipWebkit : false }, async () => {
        const app = await openApp({
          browser,
          beforeLoad: async (page) => {
            await page.context().clock.install({ time: madrid(TODAY) });
            if (scale > 1) await page.evaluate((v) => localStorage.setItem('entreno.textScale', v), String(scale));
          },
        });
        try {
          await flow(app.page, { browser, scale });
          assert.deepStrictEqual(app.errors, []);
        } finally {
          await app.close();
        }
      });
  }
}
