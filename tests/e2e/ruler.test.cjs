// Fase 6: regla táctil de peso y repeticiones del editor de series (js/ruler.js).
//   · arrastrar mueve el valor y NO guarda hasta soltar; un arrastre cancelado no cambia nada;
//   · 40→100 kg en una pasada; 17,5 y 12,5 alcanzables; un peso como 41,25 no se redondea si no se toca;
//   · escribir un valor exacto y los −/+ siguen funcionando y mueven la regla; la regla es aria-hidden;
//   · un peso absurdo arrastrado hasta el tope sigue pidiendo confirmación al registrar;
//   · sin desbordamiento horizontal a 375 px.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/ruler.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const { openApp, go, settle, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';

async function openSession(page, weight = 40, reps = 8) {
  const id = await page.evaluate(async ([w, r]) => {
    const { store } = window.__app;
    const sl = await import('./js/session-logic.js');
    const ex = store.all('exercises').find((e) => e.logType === 'weight_reps' && !e.archived);
    const s = await sl.createStrengthSession({});
    const se = sl.newSessionExercise(ex.id, s);
    se.sets = [0, 1].map(() => ({ ...sl.newSet(null, se, 'weight_reps'), weight: w, reps: r, rir: 2, done: false }));
    s.exercises = [se];
    await store.save('sessions', s);
    return s.id;
  }, [weight, reps]);
  await go(page, '#/today');
  await go(page, `#/session/${id}`);
  await page.waitForSelector('.ses-editor');
  return id;
}
const stored = (page, id) => page.evaluate((sid) => { const x = window.__app.store.get('sessions', sid).exercises[0].sets[0]; return { w: x.weight, r: x.reps, done: x.done }; }, id);
const field = (page, key) => page.locator(`.ses-editor [data-field="${key}"]`);
const rulerOf = (page, key) => page.locator('.ses-editor .ses-field', { has: page.locator(`[data-field="${key}"]`) }).locator('.ruler');

async function drag(page, loc, dx, { release = true } = {}) {
  const b = await loc.boundingBox();
  const y = b.y + b.height / 2;
  const x = b.x + b.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 6 });
  await page.mouse.move(x + dx, y, { steps: 6 });
  if (release) await page.mouse.up();
}

async function run(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    const id = await openSession(page);
    assert.strictEqual(await page.locator('.ses-editor .ruler[aria-hidden="true"]').count(), 2, 'regla de peso y de repeticiones, ocultas a VoiceOver');
    // arrastrar 264 px a la izquierda: 40 → 100 kg; durante el arrastre no se guarda
    await drag(page, rulerOf(page, 'weight'), -264, { release: false });
    assert.strictEqual(await field(page, 'weight').inputValue(), '100');
    assert.strictEqual((await stored(page, id)).w, 40, 'nada guardado mientras se arrastra');
    await page.mouse.up();
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0].weight === 100, id);
    // repeticiones: 8 → 12 (4 marcas)
    await drag(page, rulerOf(page, 'reps'), -44);
    assert.strictEqual(await field(page, 'reps').inputValue(), '12');
    // 12,5 → escribir exacto y luego tocar sin arrastrar no cambia nada
    await field(page, 'weight').fill('41,25');
    await field(page, 'weight').blur();
    await field(page, "weight").click();
    assert.strictEqual(await field(page, 'weight').inputValue(), '41,25');
    // desde 41,25 una marca (2,5) suma exacto: 43,75
    await drag(page, rulerOf(page, 'weight'), -11);
    assert.strictEqual(await field(page, 'weight').inputValue(), '43,75');
    // −/+ también mueven la regla (la posición de las marcas cambia)
    const pos = () => rulerOf(page, 'weight').evaluate((e) => e.style.getPropertyValue('--x'));
    const p0 = await pos();
    await page.locator('.ses-editor .stepper-btn[aria-label^="Sumar"]').first().click();
    assert.notStrictEqual(await pos(), p0);
    // 17,5 y 12,5 alcanzables desde 10 y 15
    await field(page, 'weight').fill('15'); await field(page, 'weight').blur();
    await drag(page, rulerOf(page, 'weight'), -11);
    assert.strictEqual(await field(page, 'weight').inputValue(), '17,5');
    // un valor absurdo arrastrado al tope pide confirmación y no se registra solo
    await field(page, 'weight').fill('990'); await field(page, 'weight').blur();
    await drag(page, rulerOf(page, 'weight'), -300);
    assert.strictEqual(await field(page, 'weight').inputValue(), '999');
    await page.locator('.ses-editor .ses-register').click();
    await settle(page);
    const dlg = await page.locator('[role="dialog"], [role="alertdialog"]').count();
    const st = await stored(page, id);
    assert.ok(dlg > 0 || !st.done, 'peso sospechoso: confirmación o rechazo, nunca guardado directo');
    assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin scroll horizontal');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}
test('regla de peso y repeticiones (Chromium)', () => run('chromium'));
test('WebKit: regla de peso y repeticiones', { skip: skipWebkit }, () => run('webkit'));
