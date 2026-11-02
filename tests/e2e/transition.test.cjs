// Pulido de la fase 7: (1) la hoja «Discos» dibuja la barra COMPLETA y simétrica, sin recortes, con pocos y con muchos
// discos; (2) la transición al registrar una serie: la fila hecha se despliega, la página acompaña lo justo en un solo
// movimiento, «Registrar» sigue a la vista, el usuario puede desplazar a mano sin que la app luche, y con «Reducir movimiento»
// todo es inmediato. Mide fotograma a fotograma (requestAnimationFrame) la posición de la página.
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/transition.test.cjs   (SHOTS=<carpeta> guarda capturas)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { openApp, go, settle, engineAvailable } = require('./helpers.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const shot = async (page, name) => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); } };

// ---------------------------------------------------------------------------------------------------------------- discos
async function runPlates(browser) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    if (browser === 'chromium') await page.setViewportSize({ width: 375, height: 667 });
    // peso → [discos por lado esperados]
    const cases = [[20, []], [60, [20]], [82.5, [25, 5, 1.25]], [100, [25, 15]], [41.25, [10]], [300, [25, 25, 25, 25, 25, 15]], [600, Array(11).fill(25).concat([15])]];
    for (const [kg, side] of cases) {
      await page.evaluate(async (w) => (await import('./js/plates-view.js')).openPlates(w), kg);
      await page.locator('.pl-svg').waitFor();
      await page.waitForTimeout(450);
      const m = await page.evaluate(() => {
        const svg = document.querySelector('.pl-svg');
        const vb = svg.viewBox.baseVal;
        const panel = document.querySelector('.sheet-panel').getBoundingClientRect();
        const r = svg.getBoundingClientRect();
        const discs = [...svg.querySelectorAll('.pl-disc')].map((n) => ({ x: +n.getAttribute('x'), w: +n.getAttribute('width'), h: +n.getAttribute('height'), cls: n.getAttribute('class') }));
        const bar = svg.querySelector('.pl-bar');
        const out = [...svg.querySelectorAll('rect,text')].filter((n) => { const b = n.getBBox(); return b.x < -0.5 || b.y < -0.5 || b.x + b.width > vb.width + 0.5 || b.y + b.height > vb.height + 0.5; }).length;
        return { vbW: vb.width, discs, barX: +bar.getAttribute('x'), barW: +bar.getAttribute('width'), outside: out, inPanel: r.left >= panel.left - 1 && r.right <= panel.right + 1, w: r.width, h: r.height, label: svg.getAttribute('aria-label'), total: document.querySelector('.pl-total').textContent };
      });
      const tag = `${kg} kg`;
      assert.strictEqual(m.outside, 0, `${tag}: nada fuera del lienzo (recortado)`);
      assert.ok(m.inPanel && m.w > 250, `${tag}: el dibujo cabe en la hoja (${Math.round(m.w)} px)`);
      assert.ok(m.barX <= 8 && m.barX + m.barW >= m.vbW - 8, `${tag}: barra completa, de extremo a extremo`);
      assert.strictEqual(m.discs.length, side.length * 2, `${tag}: los mismos discos a los dos lados`);
      // simetría: cada disco de la izquierda tiene su espejo en la derecha respecto al centro
      const cx = m.vbW / 2;
      const left = m.discs.filter((d) => d.x + d.w <= cx);
      const right = m.discs.filter((d) => d.x >= cx);
      assert.strictEqual(left.length, right.length, `${tag}: simetría en número`);
      for (const l of left) assert.ok(right.some((r) => Math.abs((l.x + l.w + r.x) / 2 - cx) < 0.5 && r.w === l.w && r.h === l.h), `${tag}: espejo de un disco de ${l.w} px`);
      if (side.length > 1) {
        const h25 = m.discs.find((d) => /pl-25\b/.test(d.cls))?.h;
        const h5 = m.discs.find((d) => /pl-5\b/.test(d.cls))?.h;
        if (h25 && h5) assert.ok(h25 > h5, `${tag}: el alto sigue al peso`);
      }
      assert.match(m.total, new RegExp(`^${String(kg).replace('.', ',')} kg$`), `${tag}: peso total a la vista`);
      assert.match(m.label, /Barra de 20 kilos/);
      await shot(page, `discos-${browser}-${String(kg).replace('.', '_')}`);
      await page.keyboard.press('Escape');
      await page.locator('.sheet-panel').waitFor({ state: 'detached' });
    }
    // el texto de la hoja: por lado, total por lado y aviso si no se puede montar exacto
    await page.evaluate(async () => (await import('./js/plates-view.js')).openPlates(82.5));
    await page.locator('.pl-svg').waitFor();
    const txt = await page.locator('.pl-sheet').innerText();
    assert.match(txt, /Por lado: 25 \+ 5 \+ 1,25 kg/);
    assert.match(txt, /31,25 kg por lado · barra 20 kg · 82,5 kg montados/);
    await page.keyboard.press('Escape');
    await page.locator('.sheet-panel').waitFor({ state: 'detached' });
    await page.evaluate(async () => (await import('./js/plates-view.js')).openPlates(41.25));
    await page.locator('.pl-svg').waitFor();
    assert.match(await page.locator('.pl-warn').innerText(), /faltan 1,25 kg/, 'la carga inexacta se sigue avisando');
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

// ----------------------------------------------------------------------------------------------------------- transición
async function seed(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const m = await import('./js/session-logic.js');
    const { store } = window.__app;
    const s = await m.createStrengthSession({ templateId: 'tpl_d1', date: u.addDays(u.todayStr(), -7), past: true });
    for (const se of s.exercises) {
      const lt = store.exercise(se.exerciseId).logType;
      se.sets.forEach((x) => Object.assign(x, { weight: lt === 'bodyweight' ? 5 : 80, reps: 8, rir: 1, done: true, doneAt: 1 }));
    }
    m.finishSession(s, { durationMin: 60, rpe: 7 });
    await store.save('sessions', s);
  });
  const id = await page.evaluate(async () => (await (await import('./js/session-logic.js')).createStrengthSession({ templateId: 'tpl_d1' })).id);
  await go(page, `#/session/${id}`);
  await page.waitForSelector('.ses-editor');
  await settle(page);
  await page.locator('#tabbar .fb-next').first().click().catch(() => {});
  await page.waitForTimeout(1100);
  return id;
}
/** Empieza a anotar, fotograma a fotograma, la posición de la página y del botón «Registrar» del editor abierto. */
const startSampling = (page, ms = 1500) => page.evaluate((dur) => {
  window.__fr = [];
  window.__clickT = null;
  const gen = (window.__gen = (window.__gen || 0) + 1); // un muestreo nuevo detiene el anterior
  const t0 = performance.now();
  document.addEventListener('click', () => { window.__clickT = Math.round(performance.now() - t0); }, { capture: true, once: true });
  const f = () => {
    if (window.__gen !== gen) return;
    const b = document.querySelector('.ses-editor[data-state="editing"] .ses-register')?.getBoundingClientRect();
    const c2 = document.querySelectorAll('.ses-card[data-se]')[1]?.getBoundingClientRect().top;
    window.__fr.push({ c2: c2 == null ? null : Math.round(c2), t: Math.round(performance.now() - t0), y: Math.round(window.scrollY), btm: b ? Math.round(b.bottom) : null, anims: document.getAnimations().length, sh: document.scrollingElement.scrollHeight });
    if (performance.now() - t0 < dur) requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}, ms);
const frames = (page) => page.evaluate(() => window.__fr);
const clickT = (page) => page.evaluate(() => window.__clickT);
const bar = (page) => page.evaluate(() => ({ tab: Math.round(document.getElementById('tabbar').getBoundingClientRect().top), hdr: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom) }));
const ready = async (page) => { await page.locator('.ses-editor[data-state="editing"] .ses-register').first().scrollIntoViewIfNeeded(); await page.waitForTimeout(150); };
const register = (page) => page.locator('.ses-editor[data-state="editing"] .ses-register').first().click();
const dump = (tag, fr) => { if (process.env.DBGFR) { let p = ''; console.log(tag, fr.filter((f) => { const k = `${f.y},${f.btm}`; const r = k !== p; p = k; return r; }).map((f) => `${f.t}:${f.y}/${f.btm}/${f.sh}`).join(' ')); } };
/** Salto visual máximo entre fotogramas de la tarjeta del ejercicio siguiente (lo que ve el usuario, no el scroll: plegar compensa el scroll a propósito). */
const maxVisual = (fr) => fr.slice(1).reduce((m, f, i) => (f.c2 != null && fr[i].c2 != null ? Math.max(m, Math.abs(f.c2 - fr[i].c2)) : m), 0);
const maxStep = (fr) => fr.slice(1).reduce((m, f, i) => Math.max(m, Math.abs(f.y - fr[i].y)), 0);

async function runTransition(browser, { reduced = false, large = false } = {}) {
  const app = await openApp({ browser });
  const { page } = app;
  try {
    if (browser === 'chromium') await page.setViewportSize({ width: 375, height: 667 });
    if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
    if (large) await page.evaluate(() => { document.documentElement.classList.add('text-large'); document.documentElement.style.setProperty('--ts', '1.5'); });
    await seed(page);
    const tag = `${browser}${reduced ? ' reducido' : ''}${large ? ' texto grande' : ''}`;

    // Series 1 y 2: la página acompaña con pasos pequeños (sin saltos), «Registrar» queda a la vista y entero
    for (const n of [1, 2]) {
      const y0 = await page.evaluate(() => Math.round(window.scrollY));
      await ready(page);
      await startSampling(page);
      await register(page);
      await page.waitForTimeout(1300);
      const fr = await frames(page);
      dump(`${tag} s${n}`, fr);
      const { tab, hdr } = await bar(page);
      const last = fr[fr.length - 1];
      assert.ok(last.btm != null && last.btm <= tab + 1 && last.btm >= hdr, `${tag} serie ${n}: «Registrar» a la vista al terminar (${last.btm} entre ${hdr} y ${tab})`);
      assert.ok(maxStep(fr) <= (reduced ? 120 : 45), `${tag} serie ${n}: sin saltos bruscos de la página (máx. ${maxStep(fr)} px por fotograma)`);
      assert.ok(Math.min(...fr.map((f) => f.y)) >= Math.min(y0, last.y) - 2, `${tag} serie ${n}: la página nunca baja de donde estaba ni sube a la cabecera`);
      if (reduced) {
        const ct = await clickT(page);
        const settled = fr.find((f) => f.t >= ct && f.y === last.y);
        assert.ok(settled && settled.t - ct <= 250, `${tag} serie ${n}: inmediato con «Reducir movimiento» (${settled && settled.t - ct} ms tras el toque)`);
        assert.strictEqual(Math.max(...fr.map((f) => f.anims)), 0, `${tag}: sin animaciones en marcha`);
      }
      await shot(page, `transicion-${tag.replace(/ /g, '_')}-${n}`);
    }

    // Reabrir una serie anterior y cerrarla: sin saltos
    await page.locator('.ses-row[data-state="done"]').first().scrollIntoViewIfNeeded();
    await page.locator('.ses-row[data-state="done"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('.ses-editor[data-state="editing-done"] .ses-register').first().scrollIntoViewIfNeeded(); // como al desplazar a mano (el clic de Playwright desplazaría solo)
    await page.waitForTimeout(200);
    await startSampling(page, 900);
    await page.locator('.ses-editor[data-state="editing-done"] .ses-register').first().click();
    await page.waitForTimeout(1000);
    const frR = await frames(page);
    dump(`${tag} reabierta`, frR);
    assert.ok(maxStep(frR) <= 60, `${tag} cerrar una serie reabierta: sin saltos`);
    // Última serie del ejercicio: la tarjeta terminada se pliega y la siguiente toma el sitio SIN pasar por la parte de arriba
    const y3 = await page.evaluate(() => Math.round(window.scrollY));
    await ready(page);
    await startSampling(page);
    await register(page);
    await page.waitForTimeout(1400);
    const fr3 = await frames(page);
    dump(`${tag} ultima`, fr3);
    assert.ok(Math.min(...fr3.map((f) => f.y)) > Math.min(y3, 100) - 5 || y3 < 100, `${tag} última serie: no salta al inicio de la página (mín. ${Math.min(...fr3.map((f) => f.y))}, antes ${y3})`);
    const iSwap = fr3.findIndex((f, i) => i > 0 && f.c2 != null && fr3[i - 1].c2 != null && Math.abs(f.c2 - fr3[i - 1].c2) > 200);
    const afterSwap = iSwap < 0 ? fr3 : fr3.slice(iSwap);
    // Al registrar la última, el editor se sustituye por una fila (la tarjeta siguiente sube de golpe: es el cambio de contenido).
    // A partir de ahí: un solo desplazamiento suave hasta ella, y plegar la terminada no mueve lo que se ve (el scroll se compensa)
    assert.ok(maxVisual(afterSwap) <= (reduced ? 500 : browser === 'webkit' ? 150 : 90), `${tag} última serie: sin saltos visuales (máx. ${maxVisual(afterSwap)} px por fotograma)`);
    const b3 = await bar(page);
    const last3 = fr3[fr3.length - 1];
    assert.ok(last3.btm != null && last3.btm <= b3.tab + 1 && last3.btm >= b3.hdr, `${tag} última serie: «Registrar» de la siguiente a la vista`);

    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

/** El usuario desplaza a mano justo después de registrar: la app no vuelve a moverle la página (solo Chromium: toque real por CDP). */
async function runManualScroll() {
  const app = await openApp({ browser: 'chromium' });
  const { page } = app;
  try {
    await page.setViewportSize({ width: 375, height: 667 });
    await seed(page);
    const cdp = await app.context.newCDPSession(page);
    const t = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 187, y }] });
    await register(page);
    await page.waitForTimeout(40); // la página aún acompaña a la fila que se despliega
    await t('touchStart', 300);
    for (let i = 1; i <= 10; i++) { await t('touchMove', 300 + i * 14); await page.waitForTimeout(12); }
    await t('touchEnd');
    await page.waitForTimeout(150);
    const y1 = await page.evaluate(() => window.scrollY);
    await page.waitForTimeout(900);
    const y2 = await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(y2 - y1) <= 3 || y2 <= y1, `la app no lucha contra el gesto del usuario (de ${y1} a ${y2})`); // solo la inercia del propio gesto puede mover
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('Discos: barra completa, simétrica y sin recortes (Chromium)', () => runPlates('chromium'));
test('WebKit: Discos: barra completa, simétrica y sin recortes', { skip: skipWebkit }, () => runPlates('webkit'));
test('Transición al registrar: pasos pequeños, «Registrar» a la vista, última serie sin salto (Chromium)', () => runTransition('chromium'));
test('WebKit: transición al registrar', { skip: skipWebkit }, () => runTransition('webkit'));
test('Transición con «Reducir movimiento»: inmediata y sin animaciones (Chromium)', () => runTransition('chromium', { reduced: true }));
test('Transición con texto ampliado (Chromium)', () => runTransition('chromium', { large: true }));
test('El usuario desplaza a mano tras registrar y la app no lucha (Chromium)', () => runManualScroll());
