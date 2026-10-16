// Sesiones largas (ronda 8, H): con 4, 8 y 12 ejercicios, superseries y circuitos.
//   · lo terminado se pliega solo (un ejercicio suelto o el grupo entero) cuando el cursor pasa al siguiente pendiente;
//   · desplegar y volver a plegar a mano, con el foco en el botón; un editor abierto impide plegar;
//   · «Siguiente pendiente» (centro de la barra de la sesión) recorre los pendientes con vuelta y se desactiva al final;
//   · al terminar un ejercicio se salta al siguiente PENDIENTE (antes, al índice + 1 aunque estuviera hecho);
//   · sin nada hecho, o en una sesión terminada, nada se pliega;
//   · con «reducir movimiento», sin animaciones y con desplazamiento instantáneo;
//   · a 375 × 667 con el texto al 150 %: líneas de 44 px, nada cortado ni scroll horizontal.
// Datos sintéticos (realistic-data.cjs) y sesiones creadas con evaluate. Sin esperas fijas: el reloj de la página es
// falso y se adelanta (page.clock) para pasar la guarda de doble toque (400 ms) y el salto (350 ms).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/session-long.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { openApp, go, settle, idbAll, engineAvailable } = require('./helpers.cjs');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const OUT = path.join(__dirname, '..', '..', 'test-results', 'visual');
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

const beforeLoad = (scale = 1) => async (page) => {
  await page.context().clock.install({ time: madrid(TODAY) });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
};

/**
 * Crea una sesión de fuerza en curso con `n` ejercicios de peso × reps (3 series de 40 × 8 cada uno) y la abre.
 * done: índices terminados; progress: {índice: series hechas}; groups: [{start, len, type}]; cursor; status.
 * Borra antes la sesión creada por la llamada anterior.
 */
async function build(page, { n, done = [], progress = {}, groups = [], cursor = 0, status = 'active', open = true }) {
  const out = await page.evaluate(async (spec) => {
    const { store } = window.__app;
    const sl = await import('./js/session-logic.js');
    for (const id of window.__longIds || []) if (store.get('sessions', id)) await store.remove('sessions', id);
    const exs = store.all('exercises').filter((e) => e.logType === 'weight_reps' && !e.archived).slice(0, spec.n);
    if (exs.length < spec.n) throw new Error(`solo hay ${exs.length} ejercicios de peso × reps`);
    const s = await sl.createStrengthSession({});
    s.templateName = `Sesión larga ${spec.n}`;
    s.exercises = exs.map((e, i) => {
      const se = sl.newSessionExercise(e.id, s);
      const k = spec.done.includes(i) ? 3 : spec.progress[i] || 0;
      se.sets = [0, 1, 2].map((j) => ({ ...sl.newSet(null, se, 'weight_reps'), weight: 40, reps: 8, rir: 2, done: j < k, doneAt: j < k ? Date.now() : null }));
      return se;
    });
    spec.groups.forEach((g, gi) => {
      for (let i = g.start; i < g.start + g.len; i++) Object.assign(s.exercises[i], { groupId: `g${gi}`, groupType: g.type });
    });
    s.cursor = spec.cursor;
    if (spec.status === 'done') sl.finishSession(s, { durationMin: 60, rpe: 7 });
    await store.save('sessions', s);
    window.__longIds = [s.id];
    return { id: s.id, se: s.exercises.map((x) => x.id), names: exs.map((e) => e.name) };
  }, { n, done, progress, groups, cursor, status });
  if (open) {
    await go(page, '#/today');
    await go(page, `#/session/${out.id}`);
    await page.waitForSelector('.ses-card');
  }
  return out;
}

const mem = (page, id) => page.evaluate((sid) => {
  const s = window.__app.store.get('sessions', sid);
  return { cursor: s.cursor, done: s.exercises.map((x) => x.sets.filter((y) => y.done).length) };
}, id);
const block = (page, key) => page.locator(`[data-block="${key}"]`);
const folded = (page, key) => page.waitForFunction((k) => document.querySelector(`[data-block="${k}"]`)?.dataset.folded === '1', key, { timeout: 5000 });
const cardOf = (page, seId) => page.locator(`[data-se="${seId}"]`);

/** Registra la serie pendiente del editor de la tarjeta y adelanta el reloj más allá de la guarda (400 ms) y del salto (350 ms). */
async function register(page, seId) {
  await cardOf(page, seId).locator('.ses-editor .ses-register').click();
  await page.clock.fastForward(450);
}

/** ¿El «Registrar» de la tarjeta queda a la vista entre la cabecera y la barra, y se puede tocar? */
function registerVisible(seId) {
  const b = document.querySelector(`[data-se="${seId}"] .ses-editor .ses-register`);
  if (!b) return false;
  const r = b.getBoundingClientRect();
  const hdr = document.querySelector('.topbar').getBoundingClientRect().bottom;
  const tab = document.getElementById('tabbar').getBoundingClientRect().top;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return r.top >= hdr - 1 && r.bottom <= tab + 1 && b.contains(hit);
}
const focusIn = (page, seId) => page.evaluate((id) => !!document.querySelector(`[data-se="${id}"]`)?.contains(document.activeElement), seId);
const srNext = (page) => page.locator('#tabbar .fb-next .sr-only').textContent();
/** Índice del ejercicio que nombra «Siguiente pendiente» (tras el fotograma en que se actualiza la etiqueta). */
async function targetFromLabel(page, names) {
  await settle(page);
  const t = await srNext(page);
  const i = names.findIndex((nm) => t.includes(`Siguiente pendiente: ${nm}.`));
  assert.ok(i >= 0, t);
  return i;
}

async function run(browser) {
  const app = await openApp({ browser, beforeLoad: beforeLoad() });
  const { page } = app;
  fs.mkdirSync(OUT, { recursive: true });
  try {
    await seedRealistic(page, { months: 2 });

    // 1) 8 ejercicios: al terminar el primero se pliega, el foco y el cursor pasan al segundo, y tras recargar sigue así
    let s = await build(page, { n: 8, progress: { 0: 2, 1: 2 }, cursor: 0 });
    assert.strictEqual(await page.locator('[data-folded="1"]').count(), 0, 'nada plegado al empezar');
    assert.strictEqual(await cardOf(page, s.se[0]).locator(".ses-prog [aria-hidden]").innerText(), '2/3', 'en curso: 2/3 en la cabecera');
    await cardOf(page, s.se[0]).locator('.ses-register').focus();
    await register(page, s.se[0]);
    await folded(page, `se:${s.se[0]}`);
    const f0 = block(page, `se:${s.se[0]}`);
    assert.strictEqual(await f0.locator('.ses-fold').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await f0.locator('.ses-fold-name').innerText(), s.names[0]);
    assert.strictEqual(await f0.locator('.ses-fold-meta').innerText(), '3 series');
    assert.strictEqual(await f0.locator('.ses-done-mark[aria-label="Completado"]').count(), 1);
    assert.strictEqual(await f0.locator('.ses-row, .ses-editor').count(), 0, 'plegado: sin filas ni editor');
    assert.ok(await focusIn(page, s.se[1]), 'el foco pasa a la tarjeta 2');
    assert.strictEqual((await mem(page, s.id)).cursor, 1, 'el cursor pasa al siguiente pendiente');
    await page.waitForFunction(registerVisible, s.se[1], { timeout: 5000 }).catch(() => {});
    assert.ok(await page.evaluate(registerVisible, s.se[1]), '«Registrar» de la 2 a la vista');
    await page.evaluate(() => window.__app.store.flush());
    assert.strictEqual((await idbAll(page, 'sessions')).find((x) => x.id === s.id).cursor, 1, 'cursor en disco');
    await page.screenshot({ path: path.join(OUT, `long-${browser}-folded-390.png`) });
    await page.reload();
    await page.waitForSelector('.ses-card');
    assert.strictEqual(await block(page, `se:${s.se[0]}`).getAttribute('data-folded'), '1', 'tras recargar sigue plegado');
    assert.strictEqual(await block(page, `se:${s.se[1]}`).getAttribute('data-folded'), '0');
    assert.strictEqual(await cardOf(page, s.se[1]).locator('.ses-editor .ses-register').count(), 1, 'la 2 abierta');

    // 2) Desplegar a mano, editar una serie hecha: no se pliega al terminar otra; «Listo» y el chevron la pliegan
    await block(page, `se:${s.se[0]}`).locator('.ses-fold').click();
    await page.waitForFunction((k) => document.querySelector(`[data-block="${k}"]`)?.dataset.folded === '0', `se:${s.se[0]}`);
    const open0 = block(page, `se:${s.se[0]}`);
    assert.strictEqual(await open0.locator('.ses-fold').getAttribute('aria-expanded'), 'true');
    assert.ok(await page.evaluate((k) => document.activeElement === document.querySelector(`[data-block="${k}"] .ses-fold`), `se:${s.se[0]}`), 'foco en el botón');
    assert.strictEqual(await open0.locator('.ses-row[data-state="done"]').count(), 3);
    await open0.locator('.ses-row[data-state="done"]').first().click();
    assert.strictEqual(await cardOf(page, s.se[0]).locator('.ses-editor .badge-ok').innerText(), 'Hecha · editando');
    await register(page, s.se[1]); // termina la 2
    await folded(page, `se:${s.se[1]}`);
    assert.strictEqual(await block(page, `se:${s.se[0]}`).getAttribute('data-folded'), '0', 'con el editor abierto no se pliega');
    assert.strictEqual((await mem(page, s.id)).cursor, 2);
    await cardOf(page, s.se[0]).locator('.ses-editor .ses-register', { hasText: 'Listo' }).click();
    assert.strictEqual(await cardOf(page, s.se[0]).locator('.ses-editor').count(), 0, '«Listo» cierra el editor');
    await cardOf(page, s.se[0]).locator('.ses-fold[aria-expanded="true"]').click();
    await folded(page, `se:${s.se[0]}`);
    assert.ok(await page.evaluate((k) => document.activeElement === document.querySelector(`[data-block="${k}"] .ses-fold`), `se:${s.se[0]}`), 'foco en el botón tras plegar');

    // 3) Superserie A1 + A2: con A1 hecho no se pliega nada; con A2, el grupo entero en una línea
    s = await build(page, { n: 6, progress: { 0: 2, 1: 2 }, groups: [{ start: 0, len: 2, type: 'superset' }], cursor: 0 });
    await register(page, s.se[0]);
    await page.waitForFunction((id) => window.__app.store.get('sessions', id).cursor === 1, s.id);
    assert.strictEqual(await page.locator('[data-folded="1"]').count(), 0, 'A1 hecho: no se pliega un ejercicio suelto del grupo');
    await register(page, s.se[1]);
    await folded(page, 'g:g0');
    const g = block(page, 'g:g0');
    assert.strictEqual((await g.locator('.ses-fold').textContent()).trim(), 'Superserie A · 2 ejercicios · 6 series');
    assert.strictEqual(await g.locator('.ses-fold').getAttribute('aria-expanded'), 'false');
    assert.strictEqual(await g.locator('.ses-card').count(), 0, 'sus tarjetas no se pintan');
    assert.strictEqual((await mem(page, s.id)).cursor, 2);
    await g.locator('.ses-fold').click();
    await page.waitForFunction(() => document.querySelector('[data-block="g:g0"]')?.dataset.folded === '0');
    assert.strictEqual(await block(page, 'g:g0').locator('.ses-card').count(), 2, 'desplegado: las dos tarjetas');
    assert.strictEqual(await block(page, 'g:g0').locator('.ses-group-head .ses-fold').getAttribute('aria-expanded'), 'true');

    // 4) Circuito de 3
    s = await build(page, { n: 5, progress: { 0: 2, 1: 2, 2: 2 }, groups: [{ start: 0, len: 3, type: 'circuit' }], cursor: 0 });
    await register(page, s.se[0]);
    await register(page, s.se[1]);
    assert.strictEqual(await page.locator('[data-folded="1"]').count(), 0);
    await register(page, s.se[2]);
    await folded(page, 'g:g0');
    assert.strictEqual((await block(page, 'g:g0').locator('.ses-fold').textContent()).trim(), 'Circuito A · 3 ejercicios · 9 series');

    // 5) 12 ejercicios con 1, 2 y 5 hechos: «Siguiente pendiente» recorre los pendientes y vuelve al principio
    for (const doneIdx of [[0], [0, 2], [0, 2, 3, 6, 9]]) {
      s = await build(page, { n: 12, done: doneIdx, cursor: 0 });
      await page.evaluate(() => window.scrollTo(0, 0));
      const pending = [...Array(12).keys()].filter((i) => !doneIdx.includes(i));
      const seen = [];
      for (let k = 0; k <= pending.length; k++) {
        const want = pending[k % pending.length];
        // La etiqueta se actualiza al terminar de desplazar (una vez por fotograma): por condición, no por tiempo
        const label = `Siguiente pendiente: ${s.names[want]}.`;
        await page.waitForFunction((t) => document.querySelector('#tabbar .fb-next .sr-only').textContent.includes(t), label, { timeout: 5000 })
          .catch(async () => assert.fail(`etiqueta (${doneIdx.length} hechos, paso ${k}): «${await srNext(page)}» en vez de «${label}»`));
        await page.locator('#tabbar .fb-next').click();
        // Se comprueba ADÓNDE llega el desplazamiento (suave), no lo rápido que llega: con la batería completa en
        // paralelo los fotogramas se espacian y 5 s no siempre bastaban; límite estándar de Playwright
        await page.waitForFunction(registerVisible, s.se[want]);
        const m = await mem(page, s.id);
        seen.push(m.cursor);
        assert.ok(await focusIn(page, s.se[want]), 'el foco pasa a la tarjeta de destino');
      }
      assert.deepStrictEqual(seen, [...pending, pending[0]], 'recorre todos los pendientes y vuelve al principio');
      if (doneIdx.length === 5) await settle(page);
      if (doneIdx.length === 5) await page.screenshot({ path: path.join(OUT, `long-${browser}-jump-390.png`) });
    }
    // Al terminar un ejercicio se salta al siguiente PENDIENTE (la 3 está hecha: de la 2 se va a la 4)
    s = await build(page, { n: 12, done: [0, 2], progress: { 1: 2 }, cursor: 1 });
    await register(page, s.se[1]);
    await page.waitForFunction((id) => window.__app.store.get('sessions', id).cursor !== 1, s.id);
    assert.strictEqual((await mem(page, s.id)).cursor, 3, 'no salta a una tarjeta hecha');
    await page.waitForFunction(registerVisible, s.se[3], { timeout: 5000 });
    // Todo hecho: el botón queda desactivado y sin ⌄
    s = await build(page, { n: 12, done: [...Array(12).keys()], cursor: 11 });
    assert.strictEqual(await page.locator('#tabbar .fb-next').isDisabled(), true);
    assert.strictEqual(await page.locator('#tabbar .fb-next-chev:visible').count(), 0, 'sin ⌄');
    assert.match(await srNext(page), /36 de 36 series hechas\. No queda ningún ejercicio pendiente\./);
    assert.strictEqual(await page.locator('[data-folded="1"]').count(), 11, 'todo plegado menos el del cursor');

    // 6) 4 ejercicios sin nada hecho: nada plegado ni «n/N»; una sesión terminada (editar): ningún botón de plegar
    s = await build(page, { n: 4, cursor: 0 });
    assert.strictEqual(await page.locator('[data-folded="1"], .ses-prog').count(), 0);
    assert.strictEqual(await page.locator('#tabbar .fb-next').isDisabled(), false);
    s = await build(page, { n: 4, done: [0, 1, 2, 3], status: 'done' });
    assert.strictEqual(await page.locator('.ses-fold').count(), 0, 'sesión terminada: nada se pliega');
    assert.strictEqual(await page.locator('.ses-card-done').count(), 4);

    // 7) Reducir movimiento: plegar, desplegar y saltar sin animaciones y con desplazamiento instantáneo
    await page.emulateMedia({ reducedMotion: 'reduce' });
    s = await build(page, { n: 12, done: [0, 1, 2, 3, 6], cursor: 4 });
    // Cuentan las animaciones que se ven: con «reducir movimiento» la app deja las transiciones en 0,01 ms (css/app.css),
    // p. ej. la cabecera compacta al desplazar; esas no se ven. reveal() (Web Animations) no debe lanzarse en absoluto.
    const anims = () => page.evaluate(() => document.getAnimations()
      .filter((a) => a.constructor.name === 'Animation' || (a.effect?.getComputedTiming?.().duration ?? 0) > 1)
      .map((a) => `${a.constructor.name}:${a.transitionProperty || a.animationName || ''}@${a.effect?.target?.className}`).join(' | '));
    await block(page, `se:${s.se[0]}`).locator('.ses-fold').click();
    assert.strictEqual(await anims(), '', 'desplegar sin animación');
    await block(page, `se:${s.se[0]}`).locator('.ses-fold').click();
    assert.strictEqual(await anims(), '', 'plegar sin animación');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.evaluate(() => window.scrollBy(0, 1)); // la etiqueta se actualiza con el desplazamiento
    await page.evaluate(() => window.scrollTo(0, 0));
    const want7 = await targetFromLabel(page, s.names);
    await page.locator('#tabbar .fb-next').click();
    assert.ok(await page.evaluate(registerVisible, s.se[want7]), 'salto instantáneo (sin esperar al desplazamiento)');
    assert.strictEqual(await anims(), '', 'saltar sin animación');
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/** 8) iPhone SE con el texto al 150 %: líneas plegadas de 44 px, nada cortado ni scroll horizontal; el salto deja «Registrar» a la vista. */
async function bigText(browser) {
  const app = await openApp({ browser, beforeLoad: beforeLoad(1.5) });
  const { page } = app;
  fs.mkdirSync(OUT, { recursive: true });
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await seedRealistic(page, { months: 2 });
    const s = await build(page, { n: 12, done: [0, 1, 4, 5, 6], progress: { 2: 2 }, groups: [{ start: 0, len: 2, type: 'superset' }], cursor: 2 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page);
    const issues = await page.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`scroll horizontal ${document.documentElement.scrollWidth}`);
      for (const b of document.querySelectorAll('.ses-fold')) {
        const r = b.getBoundingClientRect();
        if (r.height < 43.5) out.push(`botón de ${Math.round(r.height)} px: ${b.textContent}`);
        if (r.right > innerWidth + 1) out.push(`se sale: ${b.textContent}`);
        for (const el of [b, ...b.querySelectorAll('*')]) {
          if (el.closest('svg')) continue;
          const cs = getComputedStyle(el);
          if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`cortado: ${el.textContent}`);
          if (cs.display !== 'inline' && el.scrollWidth > el.clientWidth + 1) out.push(`se sale de su caja: ${el.className} «${el.textContent}»`);
        }
      }
      return out;
    });
    assert.deepStrictEqual(issues, [], issues.join('\n'));
    assert.strictEqual(await page.locator('[data-folded="1"]').count(), 4, 'la superserie y los tres sueltos hechos');
    assert.strictEqual(await page.locator('.ses-group-folded').count(), 1);
    await page.screenshot({ path: path.join(OUT, `long-${browser}-150-375.png`) });
    // El destino lo dice la etiqueta (la 3 en curso si no se ve; si se ve, la siguiente pendiente)
    const want = await targetFromLabel(page, s.names);
    assert.ok(want >= 2, await srNext(page));
    await page.locator('#tabbar .fb-next').click();
    await page.waitForFunction(registerVisible, s.se[want], { timeout: 5000 });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/**
 * 9) Tocar la tarjeta recién terminada antes del salto (350 ms) —«+ Serie» o una fila hecha para corregirla—: ni se
 * pliega, ni el cursor se va, ni la pantalla salta a otra tarjeta. Nada se mueve bajo el dedo. El reloj se para para
 * que el toque caiga dentro de los 350 ms sin depender de la velocidad de la máquina.
 */
async function touchBeforeJump(browser) {
  const app = await openApp({ browser, beforeLoad: beforeLoad() });
  const { page } = app;
  try {
    await seedRealistic(page, { months: 2 });
    for (const action of ['add-set', 'edit-done']) {
      const s = await build(page, { n: 8, progress: { 0: 2 }, cursor: 0 });
      // Margen de 1 s: con la máquina cargada, +10 ms ya era pasado al llegar la orden («Cannot fast-forward to the
      // past»). Adelantar el reloj ANTES del toque no cambia lo que se prueba (aún no hay salto programado).
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 1000));
      await cardOf(page, s.se[0]).locator('.ses-editor .ses-register').click();
      if (action === 'add-set') await cardOf(page, s.se[0]).locator('.ses-add-set').click();
      else await cardOf(page, s.se[0]).locator('.ses-row[data-state="done"]').first().click();
      await page.clock.fastForward(450);
      await page.clock.resume();
      await settle(page);
      assert.strictEqual((await mem(page, s.id)).cursor, 0, `${action}: el cursor sigue en la tarjeta que se toca`);
      assert.strictEqual(await block(page, `se:${s.se[0]}`).getAttribute('data-folded'), '0', `${action}: no se pliega`);
      assert.strictEqual(await cardOf(page, s.se[0]).locator('.ses-editor').count(), 1, `${action}: su editor sigue abierto`);
      assert.ok(await focusIn(page, s.se[0]) || await page.evaluate(() => document.activeElement === document.body),
        `${action}: el foco no se va a otra tarjeta`);
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/**
 * Rendimiento (revisión final de la ronda 8): pintar la lista o actualizar el aviso de series pendientes no mide la
 * página. «Siguiente pendiente» miraba si se veía la tarjeta del cursor (getBoundingClientRect) dentro de renderList,
 * y eso forzaba un layout síncrono de la lista a medio montar: ~110 ms con la CPU ×4 al abrir 12 ejercicios. La
 * medida va ahora al fotograma siguiente y la etiqueta sigue siendo correcta.
 */
async function noSyncLayout(browser) {
  const app = await openApp({ browser, beforeLoad: beforeLoad() });
  const { page } = app;
  try {
    await seedRealistic(page, { months: 2 });
    const s = await build(page, { n: 12, done: [0, 1, 2], progress: { 3: 2 }, cursor: 3, open: false });
    await page.evaluate(() => {
      window.__syncLayout = [];
      for (const [proto, name] of [[Element.prototype, 'getBoundingClientRect'], [HTMLElement.prototype, 'offsetHeight']]) {
        const d = Object.getOwnPropertyDescriptor(proto, name);
        const wrap = (fn) => function (...a) {
          const st = new Error().stack || '';
          if (/renderList|updateFinishHint/.test(st)) window.__syncLayout.push(`${name}\n${st.split('\n').slice(0, 6).join('\n')}`);
          return fn.apply(this, a);
        };
        if (d.value) Object.defineProperty(proto, name, { ...d, value: wrap(d.value) });
        else Object.defineProperty(proto, name, { ...d, get: wrap(d.get) });
      }
    });
    await go(page, '#/today');
    await go(page, `#/session/${s.id}`);
    await page.waitForSelector('.ses-card');
    await register(page, s.se[3]);
    await settle(page);
    await cardOf(page, s.se[4]).locator('.ses-add-set').click();
    await settle(page);
    const forced = await page.evaluate(() => window.__syncLayout);
    assert.deepStrictEqual(forced, [], 'ninguna medida síncrona al pintar la lista ni al actualizar el aviso');
    // La etiqueta se actualiza en el fotograma siguiente: nombra un pendiente y da la cuenta al día
    const i = await targetFromLabel(page, s.names);
    assert.ok(i > 3, `nombra un pendiente posterior al terminado (${i})`);
    const { done } = await mem(page, s.id);
    const total = await page.evaluate((id) => window.__app.store.get('sessions', id).exercises.reduce((a, x) => a + x.sets.length, 0), s.id);
    assert.ok((await srNext(page)).includes(`${done.reduce((a, b) => a + b, 0)} de ${total} series hechas.`), await srNext(page));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('abrir una sesión de 12 y registrar no fuerzan un layout síncrono de la lista (Chromium)', () => noSyncLayout('chromium'));
test('WebKit: abrir una sesión de 12 y registrar no fuerzan un layout síncrono de la lista', { skip: skipWebkit }, () => noSyncLayout('webkit'));
test('tocar la tarjeta recién terminada antes del salto: no se pliega ni se va (Chromium)', () => touchBeforeJump('chromium'));
test('WebKit: tocar la tarjeta recién terminada antes del salto: no se pliega ni se va', { skip: skipWebkit }, () => touchBeforeJump('webkit'));
test('sesiones largas: plegado, desplegar, superserie, circuito y «Siguiente pendiente» (Chromium)', () => run('chromium'));
test('WebKit: sesiones largas: plegado, desplegar, superserie, circuito y «Siguiente pendiente»', { skip: skipWebkit }, () => run('webkit'));
test('sesiones largas a 375 × 667 con el texto al 150 % (Chromium)', () => bigText('chromium'));
test('WebKit: sesiones largas a 375 × 667 con el texto al 150 %', { skip: skipWebkit }, () => bigText('webkit'));

/**
 * El motor ignora o cancela el desplazamiento suave (WebKit al sustituir contenido; Chromium con una animación
 * anterior pendiente: en la batería completa «Siguiente pendiente» se quedaba a veces sin mover la página). Se simula
 * un motor que no hace nada con behavior:'smooth': ui.scrollPageTo debe llevar igualmente la tarjeta a la vista.
 */
async function smoothIgnored(browser) {
  const app = await openApp({ browser, beforeLoad: beforeLoad() });
  const { page } = app;
  try {
    await seedRealistic(page, { months: 2 });
    const s = await build(page, { n: 12, done: [0], cursor: 0 });
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      const orig = window.scrollTo.bind(window);
      window.scrollTo = (a, b) => (a && typeof a === 'object' && a.behavior === 'smooth' ? undefined : orig(a, b));
    });
    for (const want of [1, 2, 3]) {
      await page.waitForFunction((t) => document.querySelector('#tabbar .fb-next .sr-only').textContent.includes(t), `Siguiente pendiente: ${s.names[want]}.`, { timeout: 5000 });
      await page.locator('#tabbar .fb-next').click();
      await page.waitForFunction(registerVisible, s.se[want], { timeout: 5000 })
        .catch(() => assert.fail(`«Siguiente pendiente» no llevó a la ${want + 1} con el desplazamiento suave ignorado`));
    }
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}
test('«Siguiente pendiente» llega aunque el motor ignore el desplazamiento suave (Chromium)', () => smoothIgnored('chromium'));
test('WebKit: «Siguiente pendiente» llega aunque el motor ignore el desplazamiento suave', { skip: skipWebkit }, () => smoothIgnored('webkit'));

/**
 * 10) Un desplazamiento DURANTE el toque en «Siguiente pendiente» no se lo come. Cada fotograma de desplazamiento
 * actualiza la barra, y antes sustituía los nodos de «n/N series» (replaceChildren): si caía entre pointerdown y
 * pointerup —la corrección tardía de ui.scrollPageTo del salto anterior, la inercia en un móvil—, el nodo pulsado
 * quedaba fuera del DOM y Chromium no lanzaba `click` (WebKit lo lanza al antecesor común; se prueba igual). En la
 * batería completa el salto no ocurría y la tarjeta no llegaba a la vista. Se reproduce sin depender del tiempo: botón abajo, desplazamiento y fotogramas, botón arriba.
 */
async function tapDuringScroll(browser) {
  const app = await openApp({ browser, beforeLoad: beforeLoad() });
  const { page } = app;
  try {
    await seedRealistic(page, { months: 2 });
    const s = await build(page, { n: 12, done: [0], cursor: 0 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForFunction((t) => document.querySelector('#tabbar .fb-next .sr-only').textContent.includes(t), `Siguiente pendiente: ${s.names[1]}.`, { timeout: 5000 });
    const b = await page.locator('#tabbar .fb-next').boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.evaluate(() => window.scrollBy(0, 1));
    await settle(page); // el fotograma que actualiza la barra cae entre el botón abajo y arriba
    await page.mouse.up();
    await page.waitForFunction((id) => window.__app.store.get('sessions', id).cursor === 1, s.id, { timeout: 5000 })
      .catch(() => assert.fail('el toque en «Siguiente pendiente» se perdió al desplazarse la página durante el toque'));
    await page.waitForFunction(registerVisible, s.se[1], { timeout: 5000 });
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}
test('un desplazamiento durante el toque no se come «Siguiente pendiente» (Chromium)', () => tapDuringScroll('chromium'));
test('WebKit: un desplazamiento durante el toque no se come «Siguiente pendiente»', { skip: skipWebkit }, () => tapDuringScroll('webkit'));
