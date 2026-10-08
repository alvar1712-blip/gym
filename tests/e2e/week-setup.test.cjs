// E2E de «Tu semana» (ronda 8, B2): un perfil nuevo empieza SIN semana tipo (no hereda la de ejemplo ni ve «Te toca
// Día 3 — Cardio»); Hoy ofrece «Empezar sesión libre» y el acceso para planificar; la bienvenida tiene un paso corto
// para elegir los días (con o sin rutina) o saltarlo. Usuarios existentes y copias restauradas conservan su semana.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/week-setup.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, idbAll, settle, waitRoute, reload } = require('./helpers.cjs');

const TODAY = '2026-10-02'; // viernes (índice 4 de la semana tipo)
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();
const atToday = (scale = 1) => ({
  beforeLoad: async (page) => {
    await page.context().clock.install({ time: madrid(TODAY) });
    if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
  },
});
const diskWeek = async (page) => (await idbAll(page, 'meta')).find((m) => m.id === 'settings').weekPatterns;
const hashOf = (page) => page.evaluate(() => location.hash);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
/** Botones y campos visibles de menos de 44 px de alto dentro de `sel`. */
const smallTargets = (page, sel) => page.locator(`${sel} button, ${sel} select`).evaluateAll((els) => els
  .filter((e) => e.offsetParent !== null)
  .map((e) => ({ t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30), h: e.getBoundingClientRect().height }))
  .filter((r) => r.h < 43.5));
/** Elementos de `sel` que se salen por la derecha de la pantalla. */
const overflowRight = (page, sel) => page.locator(`${sel} *`).evaluateAll((els) => els
  .filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > window.innerWidth + 1)
  .map((e) => `${e.tagName} ${(e.textContent || '').trim().slice(0, 30)}`));
const shotTo = (page, name) => page.screenshot({ path: `test-results/week-setup-${name}.png`, fullPage: true });

/** Bienvenida hasta el paso «Tu semana» (saltando los dos primeros). */
async function toWeekStep(page) {
  await page.locator('.today-profile .an-prompt-go').click();
  await waitRoute(page, /#\/welcome/);
  await page.locator('.wel-skip').click();
  await page.locator('.wel-skip').click();
  await page.waitForSelector('.wel-title[data-id="week"]');
}
const dayChip = (page, label) => page.locator('.wel-days .chip', { hasText: label });

test('perfil nuevo: sin semana de ejemplo; Hoy ofrece «Empezar sesión libre» y planificar la semana', async () => {
  const app = await openApp(atToday());
  const { page } = app;
  try {
    assert.deepStrictEqual(await diskWeek(page), [], 'no hereda la semana de ejemplo');
    const card = page.locator('.today-plan');
    assert.strictEqual(await card.getAttribute('data-kind'), 'none');
    const txt = await card.innerText();
    assert.doesNotMatch(txt, /Te toca hoy|Día \d|Descanso/i);
    assert.match(txt, /Sin semana planificada/i);
    assert.match(txt, /¿Qué entrenas hoy\?/);
    assert.match(await page.locator('.today-start').innerText(), /Empezar sesión libre/);
    assert.match(await card.locator('.today-pick').innerText(), /Elegir una rutina/);
    // La mini semana no inventa «Mañana: 😴 Descanso»
    assert.strictEqual(await page.locator('.today-tomorrow').count(), 0);
    assert.match(await page.locator('.today-adherence').innerText(), /Sin días planificados/);
    // «Lo importante esta semana» y compañía van al final: lo primero es empezar
    const order = await page.evaluate(() => [...document.querySelectorAll('.today > *')].map((e) => e.className));
    assert.ok(order.findIndex((c) => /today-extra/.test(c)) > order.findIndex((c) => /today-weekcard/.test(c)), 'sin plan no es un día de descanso: el resto va al final');
    // Una sola acción verde
    assert.strictEqual(await page.locator('.today .btn-primary').count(), 1);
    assert.ok(await noHScroll(page));
    await shotTo(page, 'today-375');

    // «Planificar tu semana» → Ajustes › Semana tipo (sin planificar)
    await card.locator('.today-plan-week').click();
    await waitRoute(page, /#\/settings\/week/);
    assert.match(await page.locator('.cfg-week-info').innerText(), /Aún no has planificado tu semana/);
    assert.match(await page.locator('.cfg-restore').innerText(), /Usar la semana de ejemplo/);
    await go(page, '#/settings');
    assert.match(await page.locator('.cfg-week-row').innerText(), /Sin planificar/);

    // «Empezar sesión libre» → sesión de fuerza sin rutina, que cuenta para hoy
    await go(page, '#/today');
    await page.locator('.today-start').click();
    await waitRoute(page, /#\/session\//);
    const ses = (await idbAll(page, 'sessions')).find((s) => s.status === 'active');
    assert.deepStrictEqual([ses.kind, ses.templateId, ses.date], ['strength', null, TODAY]);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('perfil nuevo con texto al 150 %: la tarjeta sin plan cabe y sus botones miden 44 px', async () => {
  const app = await openApp(atToday(1.5));
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 844 });
    await settle(page);
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await overflowRight(page, '.today-plan'), []);
    assert.deepStrictEqual(await smallTargets(page, '.today-plan'), []);
    await shotTo(page, 'today-150');
    await toWeekStep(page);
    await dayChip(page, 'Lun').click();
    await dayChip(page, 'Mié').click();
    await page.locator('.wel-day-select[data-day="0"]').selectOption('tpl:tpl_d1');
    assert.ok(await noHScroll(page));
    assert.deepStrictEqual(await overflowRight(page, '.wel'), []);
    assert.deepStrictEqual(await smallTargets(page, '.wel'), []);
    // Apiladas (nombre encima del selector) sin huecos: la base de 96 px del nombre no se vuelve su alto
    const rows = await page.locator('.wel-day-row').evaluateAll((els) => els.map((r) => {
      const name = r.querySelector('.wel-day-name');
      return { row: r.getBoundingClientRect().height, name: name.getBoundingClientRect().height, line: parseFloat(getComputedStyle(name).lineHeight), sel: r.querySelector('select').getBoundingClientRect().height };
    }));
    assert.strictEqual(rows.length, 2);
    for (const r of rows) {
      assert.ok(r.name <= r.line * 1.5, `el nombre del día mide ${r.name} px (una línea son ${r.line})`);
      assert.ok(r.row <= r.name + r.sel + 8, `hueco entre el día y su selector (${r.row} px)`);
    }
    await shotTo(page, 'welcome-week-150');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('bienvenida · «Tu semana» saltada: empieza sin planificación', async () => {
  const app = await openApp(atToday());
  const { page } = app;
  try {
    await toWeekStep(page);
    assert.match(await page.locator('.wel-title').innerText(), /3\. Tu semana/);
    assert.strictEqual(await page.locator('.wel-progress').getAttribute('aria-valuemax'), '4');
    assert.strictEqual(await page.locator('[data-block="week-plan"]').isVisible(), false, 'sin días elegidos no hay nada por día');
    // Elegir un día y saltar: no se guarda nada
    await dayChip(page, 'Vie').click();
    await page.locator('.wel-skip').click();
    await page.waitForSelector('.wel-title[data-id="now"]');
    assert.match(await page.locator('.wel-title').innerText(), /4\. Ahora mismo/);
    await page.locator('.wel-skip').click(); // «Saltar y terminar»
    await waitRoute(page, /#\/today/);
    assert.deepStrictEqual(await diskWeek(page), []);
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-kind'), 'none');
    assert.match(await page.locator('.today-start').innerText(), /Empezar sesión libre/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('bienvenida · «Tu semana» con días sin rutina: sesión libre del deporte que practica; los demás, descanso', async () => {
  const app = await openApp(atToday());
  const { page } = app;
  try {
    await page.locator('.today-profile .an-prompt-go').click();
    await waitRoute(page, /#\/welcome/);
    await page.locator('.wel-skip').click();
    // Paso 2: practica carrera y 3 días por semana
    await page.locator('[data-block="sports"] .chip', { hasText: 'Carrera' }).click();
    await page.locator('[data-block="frequency"] .chip', { hasText: '3' }).click();
    await page.locator('.wel-next').click();
    await page.waitForSelector('.wel-title[data-id="week"]');
    assert.match(await page.locator('[data-block="week-days"]').innerText(), /Has dicho 3 días por semana/);
    for (const d of ['Lun', 'Mié', 'Vie']) await dayChip(page, d).click();
    assert.strictEqual(await page.locator('.wel-day-select').count(), 3);
    assert.strictEqual(await page.locator('.wel-day-select[data-day="4"]').inputValue(), 'free:run', 'por defecto, su deporte');
    await page.locator('.wel-day-select[data-day="0"]').selectOption('free:strength');
    // Quitar el miércoles: deja de tener selector
    await dayChip(page, 'Mié').click();
    assert.strictEqual(await page.locator('.wel-day-select[data-day="2"]').count(), 0);
    await shotTo(page, 'welcome-week-375');
    await page.locator('.wel-next').click();
    await page.waitForSelector('.wel-title[data-id="now"]');
    const week = await diskWeek(page);
    assert.strictEqual(week.length, 1);
    assert.strictEqual(week[0].from, '2026-09-28', 'desde el lunes de esta semana');
    assert.deepStrictEqual(week[0].days, [
      { kind: 'free', label: 'Fuerza libre', activityKind: 'strength' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' },
      { kind: 'free', label: 'Carrera', activityKind: 'run' }, { kind: 'rest' }, { kind: 'rest' },
    ]);
    await page.locator('.wel-next').click(); // Listo
    await waitRoute(page, /#\/today/);
    const card = page.locator('.today-plan');
    assert.strictEqual(await card.getAttribute('data-kind'), 'free');
    assert.match(await card.innerText(), /Te toca hoy[\s\S]*Carrera/i);
    assert.match(await page.locator('.today-tomorrow').innerText(), /Descanso/, 'el sábado, descanso (elegido)');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('bienvenida · «Tu semana» con una rutina: Hoy la propone con «Empezar»', async () => {
  const app = await openApp(atToday());
  const { page } = app;
  try {
    await toWeekStep(page);
    await dayChip(page, 'Vie').click();
    const names = await page.locator('.wel-day-select[data-day="4"] option').allInnerTexts();
    assert.ok(names.includes('Día 1 — Upper pesado'), 'ofrece las rutinas existentes');
    await page.locator('.wel-day-select[data-day="4"]').selectOption('tpl:tpl_d1');
    await page.locator('.wel-next').click();
    await page.waitForSelector('.wel-title[data-id="now"]');
    // Atrás: el paso recuerda lo elegido
    await page.locator('.wel-prev').click();
    await page.waitForSelector('.wel-title[data-id="week"]');
    assert.strictEqual(await page.locator('.wel-day-select[data-day="4"]').inputValue(), 'tpl:tpl_d1');
    await page.locator('.wel-next').click();
    await page.locator('.wel-next').click();
    await waitRoute(page, /#\/today/);
    const days = (await diskWeek(page))[0].days;
    assert.deepStrictEqual(days[4], { kind: 'template', templateId: 'tpl_d1' });
    assert.strictEqual(days.filter((d) => d.kind !== 'rest').length, 1);
    const card = page.locator('.today-plan');
    assert.strictEqual(await card.getAttribute('data-kind'), 'template');
    assert.match(await card.innerText(), /Te toca hoy[\s\S]*Día 1 — Upper pesado/i);
    assert.match(await page.locator('.today-start').innerText(), /^Empezar$/);
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('usuario existente (ya tiene semana): no ve «Tu semana» y su semana no cambia', async () => {
  const app = await openApp({ ...atToday(), exampleWeek: true });
  const { page } = app;
  try {
    const before = await diskWeek(page);
    assert.strictEqual(before[0].days[0].templateId, 'tpl_d1');
    // Hoy: su plan de siempre (el viernes de la semana de ejemplo es descanso)
    assert.strictEqual(await page.locator('.today-plan').getAttribute('data-kind'), 'rest');
    assert.match(await page.locator('.today-plan').innerText(), /Te toca hoy[\s\S]*Descanso/i);
    // Con el perfil vacío aún puede abrir la bienvenida, pero son 3 pasos y ninguno es «Tu semana»
    await page.locator('.today-profile .an-prompt-go').click();
    await waitRoute(page, /#\/welcome/);
    assert.strictEqual(await page.locator('.wel-progress').getAttribute('aria-valuemax'), '3');
    await page.locator('.wel-skip').click();
    await page.locator('.wel-skip').click();
    assert.strictEqual(await page.locator('.wel-title').getAttribute('data-id'), 'now');
    await page.locator('.wel-next').click();
    await waitRoute(page, /#\/today/);
    assert.deepStrictEqual(await diskWeek(page), before);
    // Al volver a abrir la app, igual
    await reload(page);
    assert.deepStrictEqual(await diskWeek(page), before);
    assert.strictEqual(await hashOf(page), '#/today');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

test('copia de seguridad antigua restaurada en un perfil nuevo: conserva su semana tal cual', async () => {
  const app = await openApp(atToday());
  const { page } = app;
  try {
    assert.deepStrictEqual(await diskWeek(page), []);
    const custom = [
      { from: '2000-01-01', days: [{ kind: 'template', templateId: 'tpl_d2' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'template', templateId: 'tpl_d4' }, { kind: 'rest' }, { kind: 'free', label: 'Ruta en bici', activityKind: 'bike' }] },
      { from: '2026-09-21', days: [{ kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'rest' }, { kind: 'template', templateId: 'tpl_d2' }, { kind: 'rest' }, { kind: 'rest' }] },
    ];
    const r = await page.evaluate(async (week) => {
      const store = window.__app.store;
      const base = store.exportData();
      // Copia de formato 1 (app anterior), con su semana tipo
      const v1 = JSON.parse(JSON.stringify(base));
      v1.format = 1;
      for (const k of ['context', 'pastRecords', 'races']) delete v1.data[k];
      v1.data.meta.find((m) => m.id === 'settings').weekPatterns = week;
      await store.importData(v1);
      const afterV1 = store.settings().weekPatterns;
      // Copia más antigua aún, cuyos ajustes no guardaban semana tipo: conserva la de ejemplo que veía
      const legacy = JSON.parse(JSON.stringify(v1));
      delete legacy.data.meta.find((m) => m.id === 'settings').weekPatterns;
      await store.importData(legacy);
      const afterLegacy = store.settings().weekPatterns;
      await store.importData(v1);
      return { afterV1, afterLegacy };
    }, custom);
    assert.deepStrictEqual(r.afterV1, custom, 'la semana de la copia, sin tocar');
    assert.deepStrictEqual(r.afterLegacy.map((p) => p.days.map((d) => d.templateId || d.kind)),
      [['tpl_d1', 'tpl_d2', 'tpl_d3', 'tpl_d4', 'rest', 'tpl_d6', 'rest']]);
    await reload(page);
    assert.deepStrictEqual(await diskWeek(page), custom);
    const card = page.locator('.today-plan');
    assert.strictEqual(await card.getAttribute('data-kind'), 'template');
    assert.match(await card.innerText(), /Te toca hoy[\s\S]*Día 2/i);
    // Con la semana restaurada, la bienvenida ya no ofrece «Tu semana»
    await go(page, '#/welcome');
    assert.strictEqual(await page.locator('.wel-progress').getAttribute('aria-valuemax'), '3');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
