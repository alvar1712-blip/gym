// Animaciones de inicio y fin de sesión (js/celebrate.js, js/celebrate-logic.js):
//   · terminar: guarda y SOLO después se felicita (mensaje corto y variado); acaba en el resumen; se puede omitir;
//   · récord: solo de ejercicios principales (celebrate-logic.MAIN_LIFTS), nunca de accesorios; uno solo;
//   · si guardar falla: error, la sesión vuelve a estar activa y se puede reintentar sin perder nada; sin duplicados;
//   · empezar: destello breve que no bloquea; movimiento reducido: sin destello y solo mensaje;
//   · bloquear y desbloquear (iOS recarga la página) con una sesión en curso: vuelve a la sesión sin bienvenida.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/celebrate.test.cjs  (E2E_BROWSER=webkit para Safari)
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, reload, idbAll, settle } = require('./helpers.cjs');

const MESSAGES = ['¡Buen trabajo!', '¡Bien hecho!', '¡Gran esfuerzo!', '¡Así se hace!'];
const summaryHash = (id) => `#/session/${id}/summary`;
const atSummary = (page, id) => page.waitForFunction((h) => location.hash.split('?')[0] === h, summaryHash(id), { timeout: 8000 });

/** Historial (sesión terminada hace meses) y una sesión de hoy en curso; cada ejercicio: [id, kg, reps] con la serie hecha. */
async function seed(page, { hist, today }) {
  return page.evaluate(async ({ hist, today }) => {
    const m = await import('./js/session-logic.js');
    const st = window.__app.store;
    const fill = (s, list) => {
      for (const [eid, w, r] of list) {
        const se = m.newSessionExercise(eid, s);
        const set = m.newSet(null, se);
        Object.assign(set, { weight: w, reps: r, done: true, doneAt: Date.now() });
        se.sets = [set];
        s.exercises.push(se);
      }
    };
    const h = await m.createStrengthSession({ templateId: null, date: '2026-01-05', past: true });
    fill(h, hist);
    Object.assign(h, { status: 'done', durationMin: 50, rpe: 7 });
    await st.save('sessions', h);
    const t = await m.createStrengthSession({ templateId: null });
    fill(t, today);
    await st.save('sessions', t);
    return t.id;
  }, { hist, today });
}

async function openFinish(page, id) {
  await go(page, `#/session/${id}`);
  await page.locator('.ses-finish').click();
  const fin = page.locator('.sheet-panel.ses-finish-sheet');
  await fin.waitFor();
  await fin.locator('.ses-dur input').fill('45');
  return fin;
}
const pressFinish = (fin) => fin.locator('.sheet-actions button', { hasText: 'Terminar sesión' });
const sessionOf = (page, id) => page.evaluate((sid) => window.__app.store.get('sessions', sid), id);

async function withApp(fn) {
  const app = await openApp({ exampleWeek: true });
  try {
    await fn(app);
    assert.deepStrictEqual(app.errors.filter((e) => !/No se pudo guardar|simulado/.test(e)), []);
  } finally {
    await app.close();
  }
}

test('terminar: se guarda, felicita con un mensaje corto, destaca el récord de un ejercicio principal y acaba en el resumen', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [['press_banca', 80, 5], ['elevaciones_laterales', 10, 12]], today: [['press_banca', 90, 5], ['elevaciones_laterales', 12, 12]] });
  const fin = await openFinish(page, id);
  await pressFinish(fin).click();
  await page.locator('.cele').waitFor();
  // Guardada ANTES de la animación
  assert.strictEqual((await sessionOf(page, id)).status, 'done');
  assert.ok((await idbAll(page, 'sessions')).some((s) => s.id === id && s.status === 'done'), 'en disco');
  const msg = await page.locator('.cele-msg').innerText();
  assert.ok(MESSAGES.includes(msg), `mensaje de la colección: ${msg}`);
  assert.strictEqual(await page.locator('.cele-pr').innerText(), '¡Nuevo récord en press banca!', 'un solo récord, el del ejercicio principal');
  assert.strictEqual(await page.locator('.cele-pr').count(), 1, 'ni listas ni accesorios (laterales también batió su marca)');
  // Acaba sola, en el resumen de ESA sesión, en unos 2-3 s
  const t0 = Date.now();
  await page.waitForFunction(() => !document.querySelector('.cele'), null, { timeout: 6000 });
  assert.ok(Date.now() - t0 < 5200, `dura 2-3 s (${Date.now() - t0} ms restantes)`);
  await atSummary(page, id);
}));

test('récord solo en un accesorio: felicitación normal, sin mensaje de récord', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [['elevaciones_laterales', 10, 12]], today: [['elevaciones_laterales', 12, 12]] });
  await pressFinish(await openFinish(page, id)).click();
  await page.locator('.cele').waitFor();
  assert.ok(MESSAGES.includes(await page.locator('.cele-msg').innerText()));
  assert.strictEqual(await page.locator('.cele-pr').count(), 0);
}));

test('primera sesión con el ejercicio o igualar la marca: no es récord', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [['sentadilla', 100, 5]], today: [['press_banca', 90, 5], ['sentadilla', 100, 5]] });
  await pressFinish(await openFinish(page, id)).click();
  await page.locator('.cele').waitFor();
  assert.strictEqual(await page.locator('.cele-pr').count(), 0);
}));

test('omitir con un toque: sale enseguida y llega al resumen correcto', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [['press_banca', 80, 5]], today: [['press_banca', 90, 5]] });
  await pressFinish(await openFinish(page, id)).click();
  await page.locator('.cele').waitFor();
  const t0 = Date.now();
  await page.locator('.cele').click({ position: { x: 20, y: 200 } });
  await page.waitForFunction(() => !document.querySelector('.cele'), null, { timeout: 2000 });
  // La salida es de 160 ms; el margen cubre la latencia del clic en WebKit y sigue lejos de los ~2,2 s de la natural
  assert.ok(Date.now() - t0 < 1500, `salida corta (${Date.now() - t0} ms)`);
  await atSummary(page, id);
  assert.strictEqual(await page.locator('.cele').count(), 0);
}));

test('omitir con el teclado (Escape): mismo resultado', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [], today: [['press_banca', 90, 5]] });
  await pressFinish(await openFinish(page, id)).click();
  await page.locator('.cele').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.cele'), null, { timeout: 2000 });
  await atSummary(page, id);
}));

test('doble toque en «Terminar sesión»: una sola sesión terminada y una sola felicitación', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [], today: [['press_banca', 90, 5]] });
  const before = (await idbAll(page, 'sessions')).length;
  await pressFinish(await openFinish(page, id)).dblclick();
  await page.locator('.cele').waitFor();
  assert.strictEqual(await page.locator('.cele').count(), 1);
  await page.evaluate(() => window.__app.store.flush());
  const all = await idbAll(page, 'sessions');
  assert.strictEqual(all.length, before, 'sin sesiones duplicadas');
  assert.strictEqual(all.filter((s) => s.id === id && s.status === 'done').length, 1);
}));

test('fallo al guardar: error, la sesión sigue activa con todo lo apuntado, sin animación; reintentar funciona', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [], today: [['press_banca', 90, 5]] });
  const fin = await openFinish(page, id);
  const before = await sessionOf(page, id);
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    window.__fails = 2; // db.put reintenta una vez (iOS pierde la conexión al volver de segundo plano): fallan los dos intentos
    IDBObjectStore.prototype.put = function (v, k) {
      if (window.__fails > 0 && this.name === 'sessions' && v && v.status === 'done') {
        window.__fails--;
        throw new DOMException('simulado', 'QuotaExceededError');
      }
      return orig.call(this, v, k);
    };
  });
  await pressFinish(fin).click();
  await page.locator('.toast.toast-error').waitFor();
  assert.match(await page.locator('.toast.toast-error').innerText(), /No se pudo guardar/);
  assert.strictEqual(await page.locator('.cele').count(), 0, 'sin felicitación si no se guardó');
  assert.ok(await fin.isVisible(), 'la hoja sigue abierta para reintentar');
  assert.match(await fin.innerText(), /No se pudo guardar la sesión/);
  const mid = await sessionOf(page, id);
  assert.strictEqual(mid.status, 'active', 'vuelve a estar activa');
  assert.deepStrictEqual(mid.exercises, before.exercises, 'las series siguen intactas');
  const n0 = (await idbAll(page, 'sessions')).length;
  // Reintentar
  await pressFinish(fin).click();
  await page.locator('.cele').waitFor();
  assert.strictEqual((await sessionOf(page, id)).status, 'done');
  await page.evaluate(() => window.__app.store.flush());
  const all = await idbAll(page, 'sessions');
  assert.ok(all.some((s) => s.id === id && s.status === 'done'), 'guardada en disco tras reintentar');
  assert.strictEqual(all.length, n0, 'el fallo y el reintento no duplican sesiones');
  assert.strictEqual(all.filter((s) => s.id === id).length, 1);
  await atSummary(page, id);
}));

// Actividades que se cierran con «Listo» (no tienen «Terminar sesión»): carrera, bici, natación, senderismo y otra
for (const kind of ['run', 'bike', 'swim', 'hike', 'other']) {
  test(`actividad (${kind}): «Listo» en una nueva guarda una sola vez y felicita (sin récord); omitir vuelve a la pantalla anterior`, () => withApp(async ({ page }) => {
    await go(page, '#/today');
    await go(page, `#/activity/new?kind=${kind}`);
    await page.locator('input[aria-label$=": min"]').first().fill('40');
    await settle(page);
    await page.locator('.act-done').click();
    await page.locator('.cele').waitFor();
    assert.ok(MESSAGES.includes(await page.locator('.cele-msg').innerText()));
    assert.strictEqual(await page.locator('.cele-pr').count(), 0, 'las actividades no destacan récords de ejercicio');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.cele'), null, { timeout: 2000 });
    assert.ok(!(await page.evaluate(() => location.hash)).startsWith('#/activity'), 'ya no está en el formulario');
    const mine = (await idbAll(page, 'sessions')).filter((s) => s.kind === kind);
    assert.strictEqual(mine.length, 1, 'guardada una sola vez');
  }));
}

test('actividad: editar una antigua y pulsar «Listo» NO felicita', () => withApp(async ({ page }) => {
  await go(page, '#/today');
  await go(page, '#/activity/new?kind=run');
  await page.locator('input[aria-label$=": min"]').first().fill('40');
  await settle(page);
  await page.locator('.act-done').click();
  await page.locator('.cele').waitFor();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.cele'), null, { timeout: 2000 });
  const run = (await idbAll(page, 'sessions')).find((s) => s.kind === 'run');
  await go(page, `#/activity/${run.id}`);
  await page.locator('.act-done').click();
  await page.waitForTimeout(600);
  assert.strictEqual(await page.locator('.cele').count(), 0);
}));

test('actividad: si no se puede guardar lo pendiente, error, sin felicitación y sigue en el formulario; reintentar no duplica', () => withApp(async ({ page }) => {
  await go(page, '#/today');
  await go(page, '#/activity/new?kind=run');
  await page.locator('input[aria-label$=": min"]').first().fill('40');
  await settle(page);
  const n0 = (await idbAll(page, 'sessions')).length;
  await page.evaluate(() => {
    const orig = IDBObjectStore.prototype.put;
    window.__fails = 4; // db.put reintenta una vez; el guardado diferido también cuenta
    IDBObjectStore.prototype.put = function (v, k) {
      if (window.__fails > 0 && this.name === 'sessions' && v && v.kind === 'run') { window.__fails--; throw new DOMException('simulado', 'QuotaExceededError'); }
      return orig.call(this, v, k);
    };
  });
  await page.fill('[aria-label="Distancia (km)"]', '8');
  await page.locator('.act-done').click();
  await page.locator('.toast.toast-error').waitFor();
  assert.strictEqual(await page.locator('.cele').count(), 0, 'sin felicitación si no se guardó');
  assert.match(await page.evaluate(() => location.hash), /^#\/activity\//, 'se queda en el formulario');
  await page.evaluate(() => { window.__fails = 0; });
  await page.locator('.act-done').click();
  await page.locator('.cele').waitFor();
  await page.evaluate(() => window.__app.store.flush());
  const runs = (await idbAll(page, 'sessions')).filter((s) => s.kind === 'run');
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(runs[0].distanceKm, 8, 'lo escrito se conservó');
  assert.strictEqual((await idbAll(page, 'sessions')).length, n0, 'sin duplicados');
}));

test('empezar sesión: abre la sesión al instante, sin pantalla de destello encima ni toques bloqueados', () => withApp(async ({ page }) => {
  await go(page, '#/today');
  const t0 = Date.now();
  const id = await page.evaluate(async () => (await (await import('./js/plan-ui.js')).startStrength({ templateId: 'tpl_d1' })).id);
  assert.strictEqual(await page.evaluate(() => location.hash.split('?')[0]), `#/session/${id}`, 'ya está en la sesión');
  await page.locator('.ses-menu-btn').waitFor({ timeout: 2000 });
  assert.strictEqual(await page.locator('.cele-start').count(), 0, 'nada tapa la entrada');
  // El menú de la sesión responde enseguida (no hay capa encima)
  await page.locator('.ses-menu-btn').click({ timeout: 1000 });
  await page.locator('.sheet-panel').waitFor({ timeout: 1000 });
  assert.ok(Date.now() - t0 < 2500, `entrar y tocar: ${Date.now() - t0} ms`);
}));
test('movimiento reducido: sin animación al empezar y, al terminar, solo el mensaje (sin barrido, iconos ni cintas)', () => withApp(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await go(page, '#/today');
  await page.evaluate(async () => { await (await import('./js/plan-ui.js')).startStrength({ templateId: 'tpl_d1' }); });
  await page.waitForFunction(() => location.hash.startsWith('#/session/'));
  assert.strictEqual(await page.locator('.cele-start').count(), 0);
  await page.evaluate(() => window.__app.navigate('#/today'));
  const id = await seed(page, { hist: [], today: [['press_banca', 90, 5]] });
  await pressFinish(await openFinish(page, id)).click();
  await page.locator('.cele').waitFor();
  const shown = await page.evaluate(() => ['.cele-sweep', '.cele-ribbon', '.cele-amb'].map((s) => getComputedStyle(document.querySelector(s)).display));
  assert.deepStrictEqual(shown, ['none', 'none', 'none']);
  assert.ok(MESSAGES.includes(await page.locator('.cele-msg').innerText()));
  const t0 = Date.now();
  await page.waitForFunction(() => !document.querySelector('.cele'), null, { timeout: 4000 });
  assert.ok(Date.now() - t0 < 2200, 'más corta con movimiento reducido');
  await atSummary(page, id);
}));

test('composición: mensaje en una línea, icono según el deporte, el récord no mueve el mensaje y la duración total es la prevista', () => withApp(async ({ page }) => {
  const info = (kind, record) => page.evaluate(async ({ kind, record }) => {
    const c = await import('./js/celebrate.js');
    const p = c.celebrate({ message: '¡Gran esfuerzo!', record, kind });
    await new Promise((r) => setTimeout(r, 1300)); // ya entrada del todo
    const m = document.querySelector('.cele-msg').getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(document.querySelector('.cele-msg')).lineHeight);
    const out = { top: Math.round(m.top), lines: Math.round(m.height / lineH), right: m.right, left: m.left, vw: innerWidth, d: document.querySelector('.cele-mark > svg.icon path').getAttribute('d').slice(0, 12) };
    const t0 = performance.now();
    await p;
    out.ms = Math.round(performance.now() - t0);
    return out;
  }, { kind, record });
  const strength = await info('strength', null);
  const run = await info('run', null);
  const withRecord = await info('strength', '¡Nuevo récord en press banca!');
  for (const r of [strength, run, withRecord]) {
    assert.strictEqual(r.lines, 1, 'una sola línea');
    assert.ok(r.left >= 0 && r.right <= r.vw, 'dentro de la pantalla');
  }
  assert.notStrictEqual(run.d, strength.d, 'una carrera no usa la mancuerna');
  assert.strictEqual(withRecord.top, strength.top, 'el récord no desplaza al mensaje');
  // Total ≈ 3,0 s de espera + 0,86 s de salida (menos los 1,3 s ya transcurridos al medir)
  assert.ok(strength.ms > 2200 && strength.ms < 3200, `sin récord ${strength.ms} ms`);
  assert.ok(withRecord.ms > strength.ms + 300, `con récord dura algo más (${withRecord.ms} ms)`);
}));

test('bloquear y desbloquear con la sesión en curso (iOS recarga la página): vuelve a la sesión, sin bienvenida y sin perder nada', () => withApp(async ({ page }) => {
  const id = await seed(page, { hist: [], today: [['press_banca', 90, 5]] });
  await go(page, `#/session/${id}`);
  await page.waitForSelector('.ses-finish');
  const before = await sessionOf(page, id);
  // Bloquear: segundo plano; el sistema descarta la página y al desbloquear se vuelve a cargar
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.evaluate(() => { delete document.visibilityState; });
  await reload(page);
  assert.strictEqual(await page.locator('#splash').count(), 0, 'sin bienvenida');
  assert.strictEqual(await page.evaluate(() => window.__boot.skipped), true);
  assert.strictEqual(await page.evaluate(() => location.hash.split('?')[0]), `#/session/${id}`, 'misma sesión en curso');
  await page.waitForSelector('.ses-finish');
  assert.deepStrictEqual((await sessionOf(page, id)).exercises, before.exercises, 'series intactas');
}));

