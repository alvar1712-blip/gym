// Fase 6b: la regla de peso/repeticiones con TOQUE real (no ratón). En iPhone el arrastre sobre el <input> no llegaba a la
// regla; ahora el gesto lo recibe un elemento que no es un campo de texto (.stepper-field / .ruler) y la regla es una franja
// propia, visible y con cifras. Chromium: eventos táctiles reales por CDP (Input.dispatchTouchEvent). WebKit: Playwright solo
// sabe «tap» táctil; los arrastres se envían como PointerEvent pointerType=touch sobre el elemento que de verdad recibiría el
// dedo (elementFromPoint), lo que comprueba el destino del gesto pero NO sustituye a un Safari físico.
// SHOTS=<carpeta> guarda capturas. Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/ruler-touch.test.cjs
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
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
const sets = (page, id) => page.evaluate((sid) => window.__app.store.get('sessions', sid).exercises[0].sets.map((x) => ({ w: x.weight, r: x.reps, done: x.done })), id);
const num = (page, key) => page.locator(`.ses-editor [data-field="${key}"]`);
const fieldOf = (page, key) => page.locator('.ses-editor .stepper-field', { has: page.locator(`[data-field="${key}"]`) });
const rulerOf = (page, key) => page.locator('.ses-editor .stepper', { has: page.locator(`[data-field="${key}"]`) }).locator('.ruler');

/** Arrastre táctil: dx px horizontales (y dy verticales) con el dedo sobre el centro de `loc`. */
async function swipe(app, loc, dx, dy = 0, { release = true } = {}) {
  const { page } = app;
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  const N = 10;
  if (app.cdp) {
    const t = (type, xx, yy) => app.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: xx, y: yy }] });
    await t('touchStart', x, y);
    for (let i = 1; i <= N; i++) await t('touchMove', x + (dx * i) / N, y + (dy * i) / N);
    await page.waitForTimeout(80); // el último pointermove se entrega con el siguiente fotograma
    if (release) await t('touchEnd');
    return;
  }
  await page.evaluate(({ x, y, dx, dy, N, release }) => {
    const send = (type, xx, yy) => {
      const el = document.elementFromPoint(xx, yy);
      (window.__touchTarget || el).dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: xx, clientY: yy, button: 0, buttons: type === 'pointerup' ? 0 : 1 }));
      return el;
    };
    window.__touchTarget = send('pointerdown', x, y);
    for (let i = 1; i <= N; i++) send('pointermove', x + (dx * i) / N, y + (dy * i) / N);
    if (release) { send('pointerup', x + dx, y + dy); window.__touchTarget = null; }
  }, { x, y, dx, dy, N, release });
}
const release = (app) => (app.cdp
  ? app.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  : app.page.evaluate(() => { window.__touchTarget?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch', isPrimary: true })); window.__touchTarget = null; }));

async function shot(page, name) {
  if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); }
}

async function run(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  if (browser === 'chromium') app.cdp = await app.context.newCDPSession(page);
  const tag = browser;
  try {
    const id = await openSession(page);
    // 1. El dedo no cae sobre un <input>: sobre el número y sobre la regla el destino es un elemento no editable
    for (const [key, sel] of [['weight', 'field'], ['reps', 'field'], ['weight', 'ruler']]) {
      const loc = sel === 'field' ? fieldOf(page, key) : rulerOf(page, key);
      const b = await loc.boundingBox();
      const tagName = await page.evaluate(([x, y]) => document.elementFromPoint(x, y).tagName, [b.x + b.width / 2, b.y + b.height / 2]);
      assert.notStrictEqual(tagName, 'INPUT', `${key}/${sel}: el toque no debe caer en el <input> (iOS se lo queda)`);
    }
    // 2. Regla visible: franja de ≥ 36 px con cifras en las marcas largas y la aguja central
    const rb = await rulerOf(page, 'weight').boundingBox();
    assert.ok(rb.height >= 24, `regla de peso demasiado baja: ${rb.height}`);
    assert.ok(rb.width >= 110, `regla de peso demasiado estrecha: ${rb.width}`);
    const labels = await rulerOf(page, 'weight').locator('.ruler-num').evaluateAll((els) => els.filter((e) => e.style.visibility !== 'hidden' && e.textContent).map((e) => e.textContent));
    assert.ok(labels.length >= 3, `cifras de la regla: ${labels}`);
    await shot(page, `${tag}-1-inicial`);

    // 3. Arrastre con el dedo SOBRE EL NÚMERO: izquierda sube, no guarda hasta soltar, al soltar guarda una vez
    await swipe(app, fieldOf(page, "weight"), -88, 0, { release: false }); // 8 marcas × 2,5 = +20
    assert.strictEqual(await num(page, 'weight').inputValue(), '60');
    assert.strictEqual((await sets(page, id))[0].w, 40, 'nada guardado mientras el dedo sigue abajo');
    await shot(page, `${tag}-2-arrastrando`);
    await release(app);
    await page.waitForFunction((sid) => window.__app.store.get('sessions', sid).exercises[0].sets[0].weight === 60, id);
    assert.strictEqual((await sets(page, id))[0].done, false, 'arrastrar no registra la serie');
    // derecha baja
    await swipe(app, fieldOf(page, "weight"), 44);
    assert.strictEqual(await num(page, 'weight').inputValue(), '50');
    // 4. Sobre la regla y en repeticiones (5 marcas = 5 reps)
    await swipe(app, rulerOf(page, "weight"), -11);
    assert.strictEqual(await num(page, 'weight').inputValue(), '52,5');
    await swipe(app, fieldOf(page, "reps"), -55);
    assert.strictEqual(await num(page, 'reps').inputValue(), '13');
    await swipe(app, rulerOf(page, "reps"), 22);
    assert.strictEqual(await num(page, 'reps').inputValue(), '11');
    // 5. Decimales: 41,25 intacto con un roce; una marca entera suma 2,5 exacto
    await num(page, 'weight').fill('41,25'); await num(page, 'weight').blur();
    await swipe(app, fieldOf(page, 'weight'), -2);
    assert.strictEqual(await num(page, 'weight').inputValue(), '41,25', 'un roce no redondea');
    await swipe(app, fieldOf(page, "weight"), -11);
    assert.strictEqual(await num(page, 'weight').inputValue(), '43,75');

    // 6. Un toque sin arrastre abre el teclado para el número exacto (y no cambia nada)
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    const before = await num(page, 'weight').inputValue();
    const fb = await fieldOf(page, 'weight').boundingBox();
    await page.touchscreen.tap(fb.x + fb.width / 2, fb.y + fb.height / 2);
    assert.strictEqual(await page.evaluate(() => document.activeElement?.dataset?.field), 'weight', 'el toque enfoca el número (teclado)');
    assert.strictEqual(await num(page, 'weight').inputValue(), before);
    await page.waitForTimeout(60); // selectOnFocus selecciona el número en el siguiente turno
    await page.keyboard.type('47,5'); await page.keyboard.press('Enter');
    assert.strictEqual(await num(page, 'weight').inputValue(), '47,5');

    // 7. El scroll vertical sigue siendo de la página y no toca el valor (solo con dedo real: Chromium)
    if (app.cdp) {
      await page.evaluate(() => window.scrollTo(0, 0));
      const y0 = await page.evaluate(() => document.scrollingElement.scrollTop);
      const h = await fieldOf(page, 'weight').boundingBox();
      await swipe(app, fieldOf(page, 'weight'), 0, -150);
      await page.waitForTimeout(300);
      assert.ok((await page.evaluate(() => document.scrollingElement.scrollTop)) > y0, 'la página se desplaza con el dedo sobre el campo');
      assert.strictEqual(await num(page, 'weight').inputValue(), '47,5');
      await page.evaluate(() => window.scrollTo(0, 0));
    }

    // 8. −/+ siguen ahí; Registrar sigue siendo accesible y la serie 2 tiene también su regla
    await page.locator('.ses-editor .stepper-btn[aria-label^="Restar"]').first().click();
    assert.strictEqual(await num(page, 'weight').inputValue(), '45');
    const reg = page.locator('.ses-editor .ses-register');
    await reg.scrollIntoViewIfNeeded();
    await reg.click();
    await settle(page);
    const st = await sets(page, id);
    assert.deepStrictEqual([st[0].w, st[0].done], [45, true]);
    await page.waitForSelector('.ses-editor .ruler');
    await page.waitForFunction(() => /\S/.test(document.querySelector('.ses-editor [data-field="weight"]')?.value || ''));
    await page.waitForTimeout(700); // la serie siguiente se despliega y la pantalla se acomoda
    const v0 = Number((await num(page, 'weight').inputValue()).replace(',', '.'));
    await swipe(app, fieldOf(page, "weight"), -22); // 2 marcas = +5 kg
    assert.strictEqual(Number((await num(page, 'weight').inputValue()).replace(',', '.')), v0 + 5, 'serie consecutiva: la regla responde');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

// Pantallas pequeñas y texto ampliado: Registrar a la vista, sin desbordes, regla utilizable
async function runSmall(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    await openSession(page);
    for (const [w, h, large] of [[375, 667, false], [320, 568, false], [375, 667, true]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.evaluate((l) => { document.documentElement.classList.toggle('text-large', l); document.documentElement.style.setProperty('--ts', l ? '1.5' : '1'); }, large);
      await settle(page);
      const reg = page.locator('.ses-editor .ses-register');
      await reg.evaluate((e) => e.scrollIntoView({ block: 'center' }));
      await page.waitForTimeout(150);
      const rb = await reg.boundingBox();
      const bar = await page.evaluate(() => document.getElementById('tabbar').getBoundingClientRect().top);
      const rl = await rulerOf(page, 'weight').boundingBox();
      assert.ok(rb.y >= 0 && rb.y + rb.height <= bar, `${w}x${h}${large ? ' texto grande' : ''}: Registrar visible (${rb.y}+${rb.height})`);
      assert.ok(rl.height >= 16 && rl.x >= 0 && rl.x + rl.width <= w, `${w}x${h}: regla dentro de la pantalla`);
      assert.strictEqual(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${w}: sin scroll horizontal`);
      await shot(page, `${browser}-small-${w}x${h}${large ? '-large' : ''}`);
    }
  } finally {
    await app.close();
  }
}

test('regla con toque real (Chromium)', () => run('chromium'));
test('WebKit: regla con toque', { skip: skipWebkit }, () => run('webkit'));
test('regla en pantallas pequeñas y texto grande (Chromium)', () => runSmall('chromium'));
test('WebKit: regla en pantallas pequeñas', { skip: skipWebkit }, () => runSmall('webkit'));
