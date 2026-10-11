// Ronda 8 (G): puesta a punto contextual en el panel semanal. Una bajada de carga en la semana anterior a un evento A
// o B (≤ 28 días tras el domingo) se explica como «Compatible con una puesta a punto antes del …»: la tarjeta «Carga
// semanal» sigue neutra (etiqueta «Puesta a punto», estado info) y el chip de Carga del resumen, también. Sin el evento,
// la tarjeta es la de siempre («Info», sin la frase). Datos sintéticos (realistic-data.cjs): la semana pasada sin sus
// sesiones de fuerza (la carga baja mucho, pero no a 0). Fecha fijada: miércoles 7 oct 2026. Chromium y WebKit.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/taper.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, shot, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const TODAY = '2026-10-07'; // miércoles
const LAST_WEEK = '2026-09-28'; // lunes de la semana pasada (acaba el domingo 4 oct)
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const PHRASE = 'Compatible con una puesta a punto antes del 10K del 14 oct.';

/** Datos realistas; la semana pasada sin fuerza y el evento A (10K) el 14 oct (10 días tras el domingo). */
async function openTaper(browser, { scale = 1 } = {}) {
  const app = await openApp({
    browser,
    beforeLoad: async (page) => {
      await page.context().clock.install({ time: madrid(TODAY) });
      if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
    },
  });
  await seedRealistic(app.page, { months: 3, female: false });
  await app.page.evaluate(async ({ from }) => {
    const st = window.__app.store;
    const u = await import('./js/util.js');
    const to = u.addDays(from, 6);
    for (const s of st.all('sessions').filter((x) => x.kind === 'strength' && x.date >= from && x.date <= to)) await st.remove('sessions', s.id);
    await st.save('races', { ...st.get('races', 'rs_race1'), date: '2026-10-14' });
    await st.flush();
  }, { from: LAST_WEEK });
  return app;
}

/** Abre el panel de una semana y espera a su tarjeta «Carga semanal». */
async function openWeek(page, week) {
  await go(page, '#/today');
  await go(page, week ? `#/weekly?week=${week}` : '#/weekly');
  await page.locator('.wk[data-week] .wk-msg[data-id="load"]').waitFor();
}

const loadCard = (page) => page.evaluate(() => {
  const el = document.querySelector('.wk-msg[data-id="load"]');
  const chip = document.querySelector('.wk-recap-kpi[data-kpi="load"] .sum-delta');
  return {
    level: el.dataset.level,
    tag: el.querySelector('.wk-level').textContent.trim(),
    tagInfo: el.querySelector('.wk-level').classList.contains('state-info'),
    text: el.querySelector('.wk-msg-text').textContent.trim(),
    why: [...el.querySelectorAll('.wk-why-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
    chip: chip ? { dir: chip.dataset.dir, tone: chip.dataset.tone } : null,
    warnLoad: document.querySelectorAll('.wk-msg[data-id="load-warn"]').length,
  };
});

for (const browser of ['chromium', 'webkit']) {
  test(`[${browser}] bajada de carga antes de un evento A: «Puesta a punto», neutra; sin el evento, como siempre`, { skip: engineAvailable(browser) ? false : `${browser} no instalado` }, async () => {
    const app = await openTaper(browser);
    try {
      const { page, errors } = app;
      await openWeek(page, LAST_WEEK);
      const c = await loadCard(page);
      assert.strictEqual(c.level, 'neutral', JSON.stringify(c));
      assert.strictEqual(c.tag, 'Puesta a punto');
      assert.ok(c.tagInfo, 'etiqueta con el estado info (no ámbar)');
      assert.match(c.text, /^[\d.]+ \(minutos × esfuerzo\), −\d+(,\d)? % frente a la media de las 4 semanas previas \([\d.]+\)\. /, c.text);
      assert.ok(c.text.endsWith(PHRASE), c.text);
      assert.ok(c.why.some((r) => /^Evento próximo\s*10K · mié 14 oct · 10 km · Prioridad A · en 7 días$/.test(r)), c.why.join(' | '));
      assert.deepStrictEqual(c.chip, { dir: 'down', tone: 'neutral' });
      assert.strictEqual(c.warnLoad, 0, 'una bajada nunca es aviso');
      await shot(page, `taper-${browser}-390`);

      // Esta semana (en curso): nunca hay frase
      await openWeek(page, null);
      const now = await loadCard(page);
      assert.ok(!now.text.includes('puesta a punto'), now.text);
      assert.notStrictEqual(now.tag, 'Puesta a punto');

      // Sin el evento: la tarjeta de siempre
      await page.evaluate(async () => { await window.__app.store.remove('races', 'rs_race1'); });
      await openWeek(page, LAST_WEEK);
      const none = await loadCard(page);
      assert.strictEqual(none.tag, 'Info');
      assert.strictEqual(none.level, 'neutral');
      assert.ok(!none.text.includes('puesta a punto'), none.text);
      assert.ok(!none.why.some((r) => r.startsWith('Evento próximo')));
      assert.deepStrictEqual(none.chip, { dir: 'down', tone: 'neutral' });
      assert.deepStrictEqual(errors, []);
    } finally {
      await app.close();
    }
  });
}

test('texto al 150 % a 375 px: la tarjeta con «Puesta a punto» cabe (captura para revisar)', async () => {
  const app = await openTaper('chromium', { scale: 1.5 });
  try {
    const { page, errors } = app;
    await page.setViewportSize({ width: 375, height: 844 });
    await openWeek(page, LAST_WEEK);
    const card = page.locator('.wk-msg[data-id="load"]');
    // «¿Por qué?» abierto: la fila «Evento próximo» también tiene que caber
    await card.locator('.why-btn').click();
    await card.locator('.why-body:not([hidden])').waitFor();
    const fits = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const tag = el.querySelector('.wk-level').getBoundingClientRect();
      const row = [...el.querySelectorAll('.wk-why-row')].find((x) => x.textContent.startsWith('Evento próximo')).getBoundingClientRect();
      return { right: r.right <= innerWidth, tagIn: tag.right <= r.right + 0.5, rowIn: row.right <= r.right + 0.5, scroll: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.deepStrictEqual(fits, { right: true, tagIn: true, rowIn: true, scroll: true });
    // En una semana pasada los chips del resumen llevan diferencias largas («−4 h 13 min», «−33.207 kg»): dentro de su ficha
    const out = await page.evaluate(() => [...document.querySelectorAll('.wk-recap-kpi')].flatMap((k) => {
      const kr = k.getBoundingClientRect();
      return [...k.querySelectorAll('.sum-delta-part')].filter((p) => p.getBoundingClientRect().right > kr.right + 0.5).map((p) => `${k.dataset.kpi}: ${p.textContent}`);
    }));
    assert.deepStrictEqual(out, []);
    // …y el % no se parte («(−57 %)» en una sola línea)
    const split = await page.evaluate(() => [...document.querySelectorAll('.wk-recap-kpi .sum-delta-part:last-child')]
      .filter((p) => p.getClientRects().length > 1).map((p) => p.textContent));
    assert.deepStrictEqual(split, []);
    // Sin la cabecera fija encima de la captura
    await page.evaluate(() => document.querySelector('.topbar')?.style.setProperty('visibility', 'hidden'));
    await card.screenshot({ path: require('path').join(__dirname, '..', '..', 'test-results', 'taper-150-375.png') });
    assert.deepStrictEqual(errors, []);
  } finally {
    await app.close();
  }
});
