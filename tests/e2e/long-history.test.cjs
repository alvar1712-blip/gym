// Historiales largos (bloque perf/final, M20; docs/PULIDO.md §32): el «Historial completo» del progreso de un ejercicio
// se pinta por lotes de 30 con «Ver más (N)» (con 5 años eran ~480 filas y 50.000 px de golpe) y los récords 🏆 se
// siguen marcando con todo el historial; restaurar una copia muestra «Restaurando copia…» mientras dura, monta Hoy UNA
// sola vez (antes, dos) y deja exactamente los datos de la copia. Datos sintéticos (tests/e2e/realistic-data.cjs).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/long-history.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, settle, waitRoute, reload, engineAvailable, chromiumOnly } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const STORES = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle', 'context', 'pastRecords', 'races'];
const sheetPanel = (page) => page.locator('.sheet-overlay.open .sheet-panel').last();
const sheetBtn = (page, text) => sheetPanel(page).locator('button', { hasText: text });

/** Ejercicio con más sesiones (con peso) y su número de sesiones. */
const topExercise = (page) => page.evaluate(() => {
  const c = new Map();
  for (const s of window.__app.store.all('sessions')) {
    if (s.kind !== 'strength' || s.status !== 'done') continue;
    for (const e of new Set((s.exercises || []).filter((x) => (x.sets || []).some((st) => st.weight != null)).map((x) => x.exerciseId))) c.set(e, (c.get(e) || 0) + 1);
  }
  return [...c].sort((a, b) => b[1] - a[1])[0][0];
});

const rowsOf = (page) => page.locator('.prg-hrow').evaluateAll((els) => els.map((e) => ({ id: e.dataset.session, pr: e.dataset.pr })));

test('progreso de un ejercicio con 5 años: 30 filas al abrir, «Ver más (N)» por lotes de 30 y los récords de siempre', { timeout: 240000 }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedRealistic(page, { months: 60, female: false });
    const ex = await topExercise(page);
    await go(page, `#/progress/exercise/${ex}`);
    await page.locator('.prg-hist').waitFor();
    const total = Number((await page.locator('.prg-hist-head .muted').innerText()).match(/\d+/)[0]);
    assert.ok(total > 90, `historial largo: ${total} sesiones`);
    const first = await rowsOf(page);
    assert.strictEqual(first.length, 30, `al abrir, solo las 30 más recientes (${first.length} de ${total})`);
    const more = page.locator('.prg-hist-more');
    assert.strictEqual(await more.innerText(), `Ver más (${total - 30})`);

    await more.click();
    assert.strictEqual(await page.locator('.prg-hrow').count(), 60, 'un lote más de 30');
    assert.strictEqual(await more.innerText(), `Ver más (${total - 60})`);
    while (await more.isVisible()) await more.click();
    const all = await rowsOf(page);
    assert.strictEqual(all.length, total, 'al final, todas las sesiones');
    assert.strictEqual(new Set(all.map((r) => r.id)).size, total, 'sin filas repetidas');
    // Las 30 primeras no cambian al ampliar (mismas sesiones, mismos 🏆: se calculan con TODO el historial)
    assert.deepStrictEqual(all.slice(0, 30), first);
    assert.ok(all.some((r) => r.pr === '1'), 'hay récords marcados');
    assert.strictEqual(all.at(-1).pr, '', 'la primera sesión nunca marca récord');
    // El botón desaparece con el último lote: el foco no cae a <body>, pasa a la primera fila nueva
    assert.ok(await page.evaluate(() => document.activeElement?.classList.contains('prg-hrow')), 'foco en una fila del historial');

    // Abrir una sesión de un lote ampliado y volver: las mismas filas y la misma posición (no solo las 30 primeras)
    const target = all[total - 5].id;
    await page.locator(`.prg-hrow[data-session="${target}"]`).click();
    await page.waitForFunction((id) => location.hash === `#/session/${id}`, target);
    await settle(page);
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith('#/progress/exercise/'));
    await page.locator(`.prg-hrow[data-session="${target}"]`).waitFor();
    await settle(page);
    assert.strictEqual(await page.locator('.prg-hrow').count(), total, 'al volver, todas las filas que había');
    assert.ok(await page.locator(`.prg-hrow[data-session="${target}"]`).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < window.innerHeight;
    }), 'al volver, la fila tocada sigue a la vista');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// Con navigate + refresh, WebKit (Safari, el del iPhone) montaba Hoy dos veces; en Chromium el segundo anulaba al primero.
for (const browser of ['chromium', 'webkit']) {
  test(`restaurar una copia con 12 meses: «Restaurando copia…» mientras dura, Hoy se monta UNA vez y los datos son los de la copia (${browser})`, { timeout: 180000, skip: browser === 'webkit' && skipWebkit }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await seedRealistic(page, { months: 12, female: true });
      // Exportar sin copiar los datos (se serializan en el acto): el archivo es idéntico al de una copia profunda.
      const exp = await page.evaluate(async () => {
        const { buildBackupObject } = await import('./js/backup.js');
        const store = window.__app.store;
        const now = Date.now();
        const live = store.exportData({ clone: false });
        const s0 = live.data.sessions[0];
        return {
          same: JSON.stringify(buildBackupObject(live, now)) === JSON.stringify(buildBackupObject(store.exportData(), now)),
          shared: s0 === store.get('sessions', s0.id),
          cloned: store.exportData().data.sessions[0] !== store.get('sessions', s0.id),
        };
      });
      assert.deepStrictEqual(exp, { same: true, shared: true, cloned: true });
      const text = await page.evaluate(async () => {
        const { buildBackupObject } = await import('./js/backup.js');
        return JSON.stringify(buildBackupObject(window.__app.store.exportData()));
      });
      // Montajes y el indicador, vistos desde la página (MutationObserver: el indicador puede durar poco). Un montaje =
      // un contenedor .view-inner nuevo en #view (router.mountView); los ganchos onMount no sirven para contarlos: con
      // una vista asíncrona como Hoy se llaman dos veces en cada montaje.
      await page.evaluate(async () => {
        window.__mounts = null;
        new MutationObserver((recs) => {
          for (const rec of recs) {
            for (const n of rec.addedNodes) if (window.__mounts && n.classList?.contains('view-inner')) window.__mounts.push(location.hash);
          }
        }).observe(document.getElementById('view'), { childList: true });
        window.__busy = [];
        new MutationObserver(() => {
          const el = document.querySelector('.cfg-busy');
          if (el) window.__busy.push({ text: el.innerText, inert: document.getElementById('app').inert });
        }).observe(document.body, { childList: true });
      });

      // 1) Desde Ajustes → Datos, con la interfaz
      await go(page, '#/settings/data');
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.locator('.cfg-import').click()]);
      await fc.setFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf8') });
      await page.evaluate(() => { window.__mounts = []; });
      await sheetBtn(page, 'Sustituir todo').click();
      await page.locator('.toast', { hasText: 'Copia importada' }).waitFor({ timeout: 60000 });
      await settle(page);
      assert.strictEqual(await page.evaluate(() => location.hash), '#/today');
      assert.deepStrictEqual(await page.evaluate(() => window.__mounts), ['#/today'], 'Hoy se monta una sola vez');
      const busy = await page.evaluate(() => window.__busy);
      assert.ok(busy.length > 0, 'se mostró el indicador');
      assert.match(busy[0].text, /Restaurando copia…/);
      assert.strictEqual(busy[0].inert, true, 'la app no admite toques mientras restaura');
      assert.strictEqual(await page.locator('.cfg-busy').count(), 0, 'el indicador se quita al terminar');
      assert.strictEqual(await page.evaluate(() => document.getElementById('app').inert), false);
      // Los datos, exactamente los de la copia (memoria)
      const backup = JSON.parse(text).data;
      const mem = await page.evaluate(() => window.__app.store.exportData().data);
      const byId = (arr) => [...arr].sort((a, b) => (String(a.id) < String(b.id) ? -1 : 1));
      for (const s of STORES) assert.deepStrictEqual(byId(mem[s]), byId(backup[s] || []), `almacén «${s}»`);

      // 2) Ya en Hoy (misma URL): también un solo montaje
      await page.evaluate(() => { window.__mounts = []; });
      await page.evaluate(async (t) => { await window.__app.store.importData(JSON.parse(t)); }, text);
      await settle(page);
      assert.deepStrictEqual(await page.evaluate(() => window.__mounts), ['#/today'], 'desde Hoy, también una vez');
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}

// Ronda 10 (docs/PULIDO.md §34.1): Hoy→Progreso ya no congela Hoy hasta tener montada TODA la pantalla. La View
// Transition empezaba cuando acababa el montaje entero (cabecera, «Cómo vas», accesos, objetivos, 8 gráficas, la tabla por
// músculo y la lista de ejercicios, en una sola tarea: 0,9 s con 1 año y CPU ×4). Ahora la vista avisa al router en cuanto
// tiene lo de arriba (lo que se ve al entrar) y monta las gráficas y la lista en las tareas siguientes, ya con la animación
// en marcha. Se mide por orden de eventos, no por tiempo: qué hay en la pantalla cuando el navegador empieza la
// transición. Y al terminar (router.settled) la pantalla es la misma que montada de una vez (vuelta desde una hija).
for (const browser of ['chromium', 'webkit']) {
  test(`Hoy→Progreso con 12 meses: la transición empieza con lo de arriba, sin esperar a las gráficas ni a la lista, y acaba en la pantalla de siempre (${browser})`, { timeout: 180000, skip: browser === 'webkit' && skipWebkit }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await seedRealistic(page, { months: 12, female: false });
      // Qué hay en Progreso: bloques de primer nivel (clase y texto), las gráficas (su descripción accesible) y la lista.
      await page.evaluate(() => {
        window.__prgSnap = () => {
          const c = document.querySelector('.view-inner .prg');
          if (!c) return null;
          return {
            blocks: [...c.children].map((el) => `${el.tagName}.${[...el.classList].join('.')}|${el.innerText.replace(/\s+/g, ' ').trim()}`),
            charts: [...c.querySelectorAll('.prg-card[data-chart] svg.chart-svg')].map((s) => s.getAttribute('aria-label') || ''),
            cards: c.querySelectorAll('.prg-charts .prg-card').length,
            list: c.querySelectorAll('.prg-ex .prg-ex-row').length,
          };
        };
        // Lo que hay en el momento en que el navegador recibe la vista nueva (cuando se resuelve update()).
        const orig = document.startViewTransition && document.startViewTransition.bind(document);
        window.__atStart = [];
        if (orig) {
          document.startViewTransition = (cb) => orig(() => Promise.resolve(cb()).then(() => {
            if (location.hash === '#/progress') window.__atStart.push(window.__prgSnap());
          }));
        }
      });

      // Referencia: Progreso montado de una vez (vuelta desde una hija, con el scroll arriba)
      await go(page, '#/progress');
      await page.locator('.prg-link[data-link="records"]').click();
      await waitRoute(page, /#\/records$/);
      await page.evaluate(async () => { const r = await import('./js/router.js'); r.back('#/progress'); });
      await waitRoute(page, /#\/progress$/);
      assert.strictEqual(await page.evaluate(async () => (await import('./js/router.js')).navInfo().kind), 'pop');
      const ref = await page.evaluate(() => window.__prgSnap());
      assert.ok(ref.cards >= 6 && ref.charts.length >= 6, `gráficas en la referencia: ${ref.cards}`);
      assert.ok(ref.list > 5, `lista de ejercicios en la referencia: ${ref.list}`);

      // Hoy → Progreso con el toque de la barra (View Transition 'tab')
      await go(page, '#/today');
      await page.evaluate(() => { window.__atStart = []; });
      const res = await page.evaluate(async () => {
        const r = await import('./js/router.js');
        r.navigate('#/progress', { transition: 'tab' });
        await new Promise((res) => setTimeout(res, 0));
        await r.settled();
        // router.settled() espera al montaje COMPLETO (las e2e cuentan con ello)
        return { mode: r.navInfo().mode, snap: window.__prgSnap() };
      });
      await settle(page);
      assert.strictEqual(res.mode, 'vt', 'navegación con View Transition');
      const start = await page.evaluate(() => window.__atStart);
      assert.strictEqual(start.length, 1, 'una transición hacia Progreso');
      const s0 = start[0];
      assert.ok(s0, 'Progreso ya está en la pantalla al empezar la transición');
      assert.ok(s0.blocks.some((b) => b.startsWith('SECTION.card.prg-ov|')), `«Cómo vas» al empezar: ${s0.blocks.map((b) => b.slice(0, 40)).join(' · ')}`);
      assert.ok(s0.blocks.some((b) => b.startsWith('NAV.prg-links|')), 'accesos al empezar');
      assert.strictEqual(s0.cards, 0, `al empezar la transición, sin gráficas montadas todavía (había ${s0.cards})`);
      assert.strictEqual(s0.list, 0, `al empezar la transición, sin la lista de ejercicios todavía (había ${s0.list} filas)`);
      assert.deepStrictEqual(res.snap, ref, 'al acabar settled(), la misma pantalla que montada de una vez');

      // Salir a mitad del montaje (en cuanto empieza la transición): nada de Progreso queda vivo y sin errores
      await go(page, '#/today');
      await page.evaluate(async () => {
        const r = await import('./js/router.js');
        const orig = document.startViewTransition.bind(document);
        let once = true;
        document.startViewTransition = (cb) => orig(() => Promise.resolve(cb()).then(() => {
          if (once && location.hash === '#/progress') { once = false; r.navigate('#/today', { transition: 'tab' }); }
        }));
        r.navigate('#/progress', { transition: 'tab' });
        await new Promise((res) => setTimeout(res, 0));
        for (let i = 0; i < 5; i++) await r.settled();
      });
      await settle(page);
      assert.strictEqual(await page.evaluate(() => location.hash), '#/today');
      assert.strictEqual(await page.locator('.prg').count(), 0, 'sin restos de Progreso');
      assert.strictEqual(await page.locator('.view-inner').count(), 1);
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}

// Ronda 10 (docs/PULIDO.md §34.1): el montaje por partes es solo para entrar arriba del todo. Si el router va a dejar la
// pantalla con scroll (refresh() con el scroll de ahora, atrás/adelante del navegador, recarga), Progreso se monta de una
// vez: montada a medias, la página aún es corta y el router la colocaba ya en un scroll recortado (salto arriba y vuelta).
for (const browser of ['chromium', 'webkit']) {
  test(`Progreso con scroll que se mantiene (refresh): se monta de una vez, sin pasar por un scroll recortado (${browser})`, { timeout: 180000, skip: browser === 'webkit' && skipWebkit }, async () => {
    const app = await openApp({ browser });
    const { page } = app;
    try {
      await seedRealistic(page, { months: 12, female: false });
      await go(page, '#/progress');
      const y = await page.evaluate(() => {
        const list = document.querySelector('.prg .prg-ex');
        const target = Math.round(list.getBoundingClientRect().top + window.scrollY);
        window.scrollTo(0, target);
        return Math.round(window.scrollY);
      });
      assert.ok(y > 1000, `scroll de partida: ${y}`);
      const res = await page.evaluate(async () => {
        const r = await import('./js/router.js');
        // Dónde queda el scroll tras cada scrollTo del montaje (el navegador lo recorta al alto de la página de ese momento)
        const seen = [];
        const orig = window.scrollTo.bind(window);
        window.scrollTo = (...a) => { orig(...a); seen.push(Math.round(window.scrollY)); };
        try {
          r.refresh();
          await new Promise((res) => setTimeout(res, 0));
          await r.settled();
        } finally {
          window.scrollTo = orig;
        }
        return { seen, final: Math.round(window.scrollY), list: document.querySelectorAll('.prg .prg-ex-row').length };
      });
      await settle(page);
      assert.ok(res.list > 5, `lista montada: ${res.list}`);
      assert.ok(Math.abs(res.final - y) <= 1, `scroll final ${res.final} (era ${y})`);
      assert.ok(res.seen.every((v) => Math.abs(v - y) <= 1), `scrolls durante el montaje: ${res.seen.join(', ')} (era ${y})`);
      assert.deepStrictEqual(app.errors, []);
    } finally {
      await app.close();
    }
  });
}

// Ronda 10 (docs/PULIDO.md §34.1 y §34.4): la tarjeta de objetivos (ya solo en Hoy) no recalcula lo que acaba de
// calcular al volver a Hoy desde otra pestaña. Con un
// objetivo de 10 km, goalProgress() saca la serie de tiempos previstos (decenas de reconstrucciones de carreras: 250 ms
// con 5 años y CPU ×4, en la parte que se ve al entrar). Mientras no cambie ningún almacén ni la fecha, el resultado es
// el mismo; tras cualquier escritura se recalcula. Se cuentan las llamadas de verdad (cobertura precisa de V8 por CDP).
test('Hoy→otra pestaña→Hoy sin cambios: los objetivos no se recalculan (tras guardar algo, sí) y la tarjeta dice lo mismo', { timeout: 180000, skip: chromiumOnly('recuento de llamadas con la cobertura de CDP') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedRealistic(page, { months: 12, female: false });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    await reload(page); // los módulos se compilan ya con la cobertura activa
    // Llamadas a goalProgress desde la toma anterior (takePreciseCoverage pone los contadores a cero)
    const calls = async () => {
      const { result } = await cdp.send('Profiler.takePreciseCoverage');
      let n = 0;
      for (const sc of result) {
        if (!sc.url.endsWith('/js/goals-logic.js')) continue;
        for (const fn of sc.functions) if (fn.functionName === 'goalProgress') n += fn.ranges[0].count;
      }
      return n;
    };
    // Ronda 10 (UX-2): la tarjeta de objetivos ya solo está en Hoy; la caché evita recalcularla al volver a Hoy
    const card = () => page.locator('#view .goal-sum').innerText();
    const openToday = async () => {
      await go(page, '#/today');
      await page.locator('.today-extra[data-ready="1"]').waitFor({ state: 'attached' });
      await page.locator('#view .goal-sum').waitFor();
    };
    const nGoals = await page.evaluate(() => window.__app.store.all('goals').length);
    assert.ok(nGoals >= 2, `objetivos sembrados: ${nGoals}`);
    // Calentar: módulos cargados y los «conseguido» ya sincronizados (syncAchieved escribe la primera vez)
    await go(page, '#/progress');
    await openToday();
    await calls();

    // 1) Después de guardar algo: Hoy calcula (referencia)
    await page.evaluate(() => window.__app.store.saveSettings({ weekPatterns: window.__app.store.settings().weekPatterns }));
    await go(page, '#/progress');
    await openToday();
    assert.ok(await calls() >= nGoals, 'tras una escritura, se recalcula');
    const ref = await card();

    // 2) Otra pestaña (Progreso) y vuelta a Hoy sin escrituras entre medias: nada que recalcular
    await go(page, '#/progress');
    await openToday();
    const again = await calls();
    assert.strictEqual(again, 0, `Hoy→Progreso→Hoy sin cambios: ${again} llamadas a goalProgress`);
    assert.strictEqual(await card(), ref, 'la tarjeta de objetivos dice lo mismo');

    // 3) Una escritura cualquiera (un pesaje) invalida: Hoy vuelve a calcular
    await page.evaluate(async () => {
      const { store } = window.__app;
      const util = await import('./js/util.js');
      const last = store.bodyweightList().at(-1);
      await store.save('bodyweight', { ...last, id: util.todayStr(), kg: last.kg });
    });
    await go(page, '#/progress');
    await openToday();
    assert.ok(await calls() >= nGoals, 'tras guardar un pesaje, se recalcula');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});

// Ronda 10 (docs/PULIDO.md §34.1): Hoy y Progreso comparten los datos del store y el índice de stats.js mientras no
// cambie nada. Antes, cada pantalla creaba arrays nuevos (dataFromStore) y stats.js reconstruía su índice y las semanas
// (100-335 ms con 5 años y CPU ×4). Tras cualquier escritura, datos e índice nuevos. Recuento de llamadas por CDP.
test('Hoy→Progreso sin cambios: stats.js no reconstruye su índice (tras guardar algo, sí) y Progreso dice lo mismo', { timeout: 180000, skip: chromiumOnly('recuento de llamadas con la cobertura de CDP') }, async () => {
  const app = await openApp();
  const { page } = app;
  try {
    await seedRealistic(page, { months: 12, female: false });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.startPreciseCoverage', { callCount: true, detailed: false });
    await reload(page); // los módulos se compilan ya con la cobertura activa
    const builds = async () => {
      const { result } = await cdp.send('Profiler.takePreciseCoverage');
      let n = 0;
      for (const sc of result) {
        if (!sc.url.endsWith('/js/stats.js')) continue;
        for (const fn of sc.functions) if (fn.functionName === 'buildIndex') n += fn.ranges[0].count;
      }
      return n;
    };
    const text = () => page.locator('.view-inner .prg').innerText();
    await go(page, '#/progress');
    await go(page, '#/today');
    await page.locator('.goal-sum').waitFor();
    await page.evaluate(() => window.__app.store.saveSettings({ weekPatterns: window.__app.store.settings().weekPatterns }));
    await go(page, '#/progress');
    assert.ok(await builds() >= 1, 'tras una escritura, índice nuevo');
    const ref = await text();

    await go(page, '#/today');
    await page.locator('.goal-sum').waitFor();
    await builds();
    await go(page, '#/progress');
    const n = await builds();
    assert.strictEqual(n, 0, `Hoy→Progreso sin cambios: ${n} reconstrucciones del índice de stats.js`);
    assert.strictEqual(await text(), ref, 'Progreso dice lo mismo');

    await page.evaluate(async () => {
      const { store } = window.__app;
      const util = await import('./js/util.js');
      const last = store.bodyweightList().at(-1);
      await store.save('bodyweight', { ...last, id: util.todayStr(), kg: last.kg + 0.4 });
    });
    await go(page, '#/today');
    await go(page, '#/progress');
    assert.ok(await builds() >= 1, 'tras guardar un pesaje, índice nuevo');
    assert.notStrictEqual(await text(), ref, 'y Progreso lo refleja');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
});
