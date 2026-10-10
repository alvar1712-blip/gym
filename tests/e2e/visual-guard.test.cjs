// Guardas visuales estables (docs/PULIDO.md): recorre TODAS las pantallas con datos realistas (6 meses de fuerza,
// carrera, bici, peso, ciclo, objetivos, contexto, un evento y una sesión a medias) a 375, 390 y 430 px, también
// con la app vacía y con el texto del sistema al 125 % y al 150 %, y comprueba invariantes de maquetación que no
// dependen de píxeles:
//   · ningún texto roto («null», «undefined», NaN, Infinity, «[object …]», «:-5», ritmos «h:mm:ss /km»);
//   · sin scroll horizontal ni nada que se salga por los lados (salvo dentro de un carrusel);
//   · la cabecera no tapa el principio del contenido y lo último queda por encima de la barra de pestañas;
//   · ningún texto por debajo de 12 px, ninguno cortado con «…» o a N líneas, ninguno que se salga de su caja (un
//     botón, una ficha) y ningún botón por debajo de 44 px de alto;
//   · ningún error en la consola.
// Deja una captura de cada pantalla en test-results/visual/ (para mirarlas, no se comparan píxel a píxel).
// Ejecutar: NODE_PATH=$(npm root -g) node --test tests/e2e/visual-guard.test.cjs  (E2E_BROWSER=webkit para WebKit)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { openApp, go, settle, engineAvailable } = require('./helpers.cjs');
const playwright = require('playwright');
const { seedRealistic } = require('./realistic-data.cjs');

const skipWebkit = engineAvailable('webkit') ? false : 'WebKit no instalado: ejecuta scripts/setup-webkit.sh';
const OUT = path.join(__dirname, '..', '..', 'test-results', 'visual');
const TODAY = '2026-10-07';
const madrid = (date, hh = 12) => new Date(`${date}T${String(hh).padStart(2, '0')}:00:00+02:00`).getTime();

/**
 * Paso «Tu semana» de la bienvenida (ronda 8, B2; solo sin semana tipo, o sea con la app vacía) con tres días elegidos.
 */
async function weekStep(page) {
  await page.locator('.wel-skip').click();
  await page.locator('.wel-skip').click();
  await page.waitForSelector('.wel-title[data-id="week"]');
  for (const d of ['Lun', 'Mié', 'Vie']) await page.locator('.wel-days .chip', { hasText: d }).click();
  await settle(page);
}

/**
 * Punto de restauración (ronda 8, B3): importar la misma copia deja los datos igual y guarda el punto; la tarjeta
 * aparece en Copias y datos (con la app vacía no hay nada que proteger y no sale).
 */
async function restorePoint(page) {
  const protect = await page.evaluate(async () => {
    const st = window.__app.store;
    await st.importData(st.exportData());
    return st.hasDataToProtect();
  });
  await page.waitForFunction(() => location.hash === '#/today');
  await go(page, '#/settings/data');
  if (protect) await page.locator('.cfg-rp').waitFor();
}

/** Lista de eventos con «Pasados» desplegado (ronda 8, D: resultado, «¿Cómo te fue?» y «ya no existe»). */
async function openPast(page) {
  await page.locator('.rc-fold').click();
  await settle(page);
}
/** «¿Cómo te fue?» con «Introducir resultado» abierto. */
async function openManual(page) {
  await page.locator('.rc-result [data-opt="manual"]').click();
  await settle(page);
}

/**
 * Tres eventos pasados (ronda 8, D): uno con la última carrera vinculada, uno sin responder de hace 3 días (sale en Hoy)
 * y uno cuya actividad ya no existe.
 */
async function seedPastRaces(page) {
  await page.evaluate(async () => {
    const u = await import('./js/util.js');
    const st = window.__app.store;
    const T = u.todayStr();
    const runs = st.all('sessions').filter((s) => s.kind === 'run' && s.status === 'done' && s.date < T).sort((a, b) => (a.date < b.date ? 1 : -1));
    const r = runs[0];
    const base = { name: '', type: '10k', distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 };
    await st.save('races', { ...base, id: 'vg_past_done', name: 'Carrera popular de otoño', type: 'custom', distanceKm: r.distanceKm, date: r.date, targetSec: Math.round((r.movingSec || r.durationMin * 60) + 42), outcome: { status: 'done', activityId: r.id, contextId: null, manual: null, place: 128, note: 'Salida rápida, calor al final.', at: 1 } });
    await st.save('races', { ...base, id: 'vg_past_pending', type: 'half', distanceKm: 21.0975, targetSec: 6300, date: u.addDays(T, -3), priority: 'B' });
    await st.save('races', { ...base, id: 'vg_past_missing', date: u.addDays(T, -20), priority: 'C', outcome: { status: 'done', activityId: 'vg_gone', contextId: null, manual: null, place: null, note: '', at: 1 } });
  });
}

/**
 * Pantallas: [clave, hash, preparar?]; `ids` da las que dependen de los datos (null → se omiten con la app vacía).
 * `preparar(page)` deja la pantalla en el estado que se mide (p. ej. un paso concreto de la bienvenida).
 */
const routes = (ids) => [
  ['today', '#/today'], ['calendar', '#/calendar'], ['day', `#/day/${ids.doneDate || TODAY}`], ['history', '#/history'],
  ids.activeId && ['session', `#/session/${ids.activeId}`], ids.done && ['summary', `#/session/${ids.done}/summary`],
  ['activity-new', '#/activity/new?kind=run'], ['activity-new-hike', '#/activity/new?kind=hike'], ids.run && ['activity', `#/activity/${ids.run}`],
  ['bodyweight', '#/bodyweight'], ['exercises', '#/exercises'], ['exercise', '#/exercise/press_banca'], ['exercise-edit', '#/exercise/press_banca/edit'],
  ['templates', '#/templates'], ['template', '#/template/tpl_d1'],
  ['settings', '#/settings'], ['settings-week', '#/settings/week'], ['settings-thresholds', '#/settings/thresholds'], ['settings-data', '#/settings/data'],
  ['settings-data-rp', '#/settings/data', restorePoint], ['profile', '#/settings/profile'],
  ['progress', '#/progress'], ['progress-exercise', '#/progress/exercise/press_banca'], ['records', '#/records'], ['records-past', '#/records/past'], ['records-past-new', '#/records/past/new'],
  ['races', '#/races', ids.pastRaces ? openPast : null], ['race-new', '#/races/new'],
  // Ronda 8 (D): la tarjeta del resultado de un evento pasado (con resultado, sin responder con el formulario a mano
  // abierto, y con la actividad vinculada borrada)
  ids.pastRaces && ['race-result', '#/races/vg_past_done'], ids.pastRaces && ['race-result-pending', '#/races/vg_past_pending', openManual],
  ids.pastRaces && ['race-result-missing', '#/races/vg_past_missing'], ['weekly', '#/weekly'], ['goals', '#/goals'], ['goal-new', '#/goal/new'],
  ['import', '#/import'], ['predictions', '#/predictions'], ['summary-period', '#/summary'], ['analysis', '#/analysis'],
  ids.female && ['cycle', '#/cycle'], ['context', '#/context'], ['context-new', '#/context/new?kind=event&type=race_result'],
  ['welcome', '#/welcome'], !ids.done && ['welcome-week', '#/welcome', weekStep],
].filter(Boolean);

/** Medición en la página (pantalla arriba del todo): devuelve la lista de problemas. */
function inspectTop() {
  const vw = innerWidth;
  const issues = [];
  const cls = (el) => String(el.className?.baseVal ?? el.className ?? '').split(/\s+/).filter(Boolean).slice(0, 2).join('.');
  const desc = (el) => `${el.tagName.toLowerCase()}${cls(el) ? `.${cls(el)}` : ''} «${(el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40)}»`;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || el.closest('[hidden], [aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  /** ¿Lo recorta (o lo desplaza) un antepasado con overflow? Entonces no «se sale» de la pantalla. */
  const clipped = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== 'visible') return true;
    }
    return false;
  };
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`scroll horizontal: ${document.documentElement.scrollWidth} px > ${vw}`);
  const root = document.querySelector('#view');
  for (const el of root.querySelectorAll('*')) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) issues.push(`se sale por el lado: ${desc(el)} [${Math.round(r.left)}–${Math.round(r.right)}]`);
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
    // Recortado con «…» (una etiqueta, una cifra, un nombre): con los datos de prueba, nada debe cortarse
    if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim()) issues.push(`texto cortado con «…»: ${desc(el)}`);
    // Recortado a N líneas (-webkit-line-clamp) con más texto del que cabe. Excepto los avances marcados con
    // data-preview (el resumen del analista: el texto entero está a un toque, en «Ver análisis» / su tarjeta)
    if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none' && el.scrollHeight > el.clientHeight + 1 && !el.closest('[data-preview]')) issues.push(`texto cortado a ${cs.webkitLineClamp} líneas: ${desc(el)}`);
    // Texto que se sale de su propia caja (un botón, una ficha) y pisa lo de al lado
    if ((own.trim() || el.matches('button, [role=button]')) && !el.closest('svg') && cs.overflowX === 'visible' && cs.display !== 'inline' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) issues.push(`texto que se sale de su caja (${el.scrollWidth} > ${el.clientWidth} px): ${desc(el)}`);
    if (own.trim()) {
      if (parseFloat(cs.fontSize) < 11.9) issues.push(`texto de ${cs.fontSize}: ${desc(el)}`);
      if (/\bnull\b|\bundefined\b|NaN|Infinity|\[object |:-\d|\d+:\d{2}:\d{2}\s?\/km/.test(own)) issues.push(`texto roto: ${desc(el)}`);
    }
    const tappable = el.matches('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button], [role=tab]');
    // Las zonas del mapa corporal (SVG) son regiones del dibujo, no botones: se tocan por su área
    if (tappable && r.height < 43.5 && !el.closest('svg, .why-body')) issues.push(`objetivo táctil de ${Math.round(r.width)}×${Math.round(r.height)}: ${desc(el)}`);
  }
  issues.push(...overlapIssues(root, desc, shown));
  // La cabecera (título compacto) no tapa el primer bloque del contenido
  const top = root.querySelector('.topbar');
  const content = root.querySelector('.content');
  const first = content && [...content.children].find((c) => c.getBoundingClientRect().height > 0);
  if (top && first && first.getBoundingClientRect().top < top.getBoundingClientRect().bottom - 1) issues.push(`la cabecera tapa ${desc(first)}`);
  return [...new Set(issues)];
}

/**
 * Solapes que no son «salirse de la caja» (docs/PULIDO.md §17, texto grande):
 *   · una palabra corta partida a media palabra («Senderism|o», «RECUPERACIÓ|N»): la caja es más estrecha que la
 *     palabra y hay que reorganizar (filas en vez de columnas), no partirla;
 *   · el valor de un campo (o su ejemplo) que pisa la unidad superpuesta («00» sobre «min», «/km», «kg») o que no
 *     cabe en el campo;
 *   · texto superpuesto a un anillo (SVG redondo) que se sale de su hueco interior y pisa el trazo.
 * Se mide con rectángulos de texto (Range), no con cajas: una caja centrada puede ser más ancha que su texto.
 * page.evaluate serializa una sola función: `inspectTop` la recibe en su ámbito (ver `measureTop`).
 */
function overlapIssues(root, desc, shown) {
  const issues = [];
  const rectsOf = (node, from, to) => {
    const rg = document.createRange();
    rg.setStart(node, from);
    rg.setEnd(node, to);
    return [...rg.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || el.closest('svg, [data-preview]') || !shown(el)) continue;
    texts.push(n);
  }
  // 1) Palabras partidas (≤ 14 letras: una palabra más larga puede no caber de ninguna manera)
  for (const n of texts) {
    const re = /[^\s ·—–\-/]+/g;
    for (let m = re.exec(n.textContent); m; m = re.exec(n.textContent)) {
      if (m[0].length < 2 || m[0].length > 14) continue;
      const lines = new Set(rectsOf(n, m.index, m.index + m[0].length).map((r) => Math.round(r.top / 4)));
      if (lines.size > 1) issues.push(`palabra partida «${m[0]}»: ${desc(n.parentElement)}`);
    }
  }
  // 2) Campos con una unidad superpuesta (posición absoluta dentro del mismo envoltorio)
  const seen = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width >= 1 && r.height >= 1 && !el.closest('[hidden]') && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const ctx = document.createElement('canvas').getContext('2d');
  for (const inp of root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=date]):not([type=time]):not([type=range])')) {
    if (!shown(inp)) continue;
    const wrap = inp.parentElement;
    // (la unidad suele llevar aria-hidden —el campo ya la dice—: aquí cuenta si se ve)
    const units = [...wrap.children].filter((u) => u !== inp && getComputedStyle(u).position === 'absolute' && u.textContent.trim() && seen(u));
    if (!units.length) continue;
    const text = inp.value || inp.placeholder;
    if (!text) continue;
    const cs = getComputedStyle(inp); // la caja (márgenes interiores, alineación) es la del campo
    // El ejemplo (placeholder) se mide con su propia letra. Todos los campos lo pintan en gris (--muted): si el
    // estilo de ::placeholder sale con el color del campo, el motor no lo da (WebKit) y el ejemplo no se mide
    const ph = !inp.value;
    const fcs = ph ? getComputedStyle(inp, '::placeholder') : cs; // la letra, la del texto que se ve
    if (ph && fcs.color === cs.color) continue;
    ctx.font = `${fcs.fontStyle} ${fcs.fontWeight} ${fcs.fontSize} ${fcs.fontFamily}`;
    const tw = ctx.measureText(text).width;
    const r = inp.getBoundingClientRect();
    const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft);
    const avail = inp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (tw > avail + 1) { issues.push(`texto que no cabe en el campo («${text}», ${Math.round(tw)} > ${Math.round(avail)} px): ${desc(wrap)}`); continue; }
    const start = cs.textAlign === 'center' ? left + (avail - tw) / 2 : cs.textAlign === 'right' || cs.textAlign === 'end' ? left + avail - tw : left;
    // En vertical: la línea va centrada en la caja de contenido; la tinta, de la línea base arriba y abajo
    const m = ctx.measureText(text);
    const cTop = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop);
    const cBottom = r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom);
    const base = (cTop + cBottom) / 2 - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent) / 2 + m.fontBoundingBoxAscent;
    const inkTop = base - m.actualBoundingBoxAscent;
    const inkBottom = base + m.actualBoundingBoxDescent;
    for (const u of units) {
      // La tinta de la unidad, igual: su caja de texto (Range) empieza en lo alto de la fuente, no de las letras
      const ucs = getComputedStyle(u);
      ctx.font = `${ucs.fontStyle} ${ucs.fontWeight} ${ucs.fontSize} ${ucs.fontFamily}`;
      const um = ctx.measureText(u.textContent.trim());
      const ur = [...u.childNodes].filter((c) => c.nodeType === 3).flatMap((c) => rectsOf(c, 0, c.textContent.length)).map((q) => {
        const ub = q.top + (q.height - (um.fontBoundingBoxAscent + um.fontBoundingBoxDescent)) / 2 + um.fontBoundingBoxAscent;
        return { left: q.left, right: q.right, top: ub - um.actualBoundingBoxAscent, bottom: ub + um.actualBoundingBoxDescent };
      });
      if (ur.some((q) => q.left < start + tw - 1 && q.right > start + 1 && q.top < inkBottom - 2 && q.bottom > inkTop + 2)) issues.push(`el valor pisa la unidad «${u.textContent.trim()}» («${text}»): ${desc(wrap)}`);
    }
  }
  // 3) Anillos (círculo SVG sin relleno, con trazo): ninguna línea de texto puede pisar el trazo. Una línea que
  //    toca el disco exterior tiene que caber entera en el hueco interior (radio − medio trazo).
  for (const c of root.querySelectorAll('svg circle')) {
    const ccs = getComputedStyle(c);
    const ctm = c.getScreenCTM();
    // (los dibujos llevan aria-hidden: aquí cuenta si se ven, no si los lee VoiceOver)
    if (ccs.fill !== 'none' || !(parseFloat(ccs.strokeWidth) > 0) || !ctm || !seen(c.ownerSVGElement)) continue;
    const k = Math.hypot(ctm.a, ctm.b);
    const r0 = c.r.baseVal.value * k;
    const half = (parseFloat(ccs.strokeWidth) / 2) * k;
    if (r0 < 15) continue;
    const cx = ctm.a * c.cx.baseVal.value + ctm.c * c.cy.baseVal.value + ctm.e;
    const cy = ctm.b * c.cx.baseVal.value + ctm.d * c.cy.baseVal.value + ctm.f;
    const outer = r0 + half;
    const inner = r0 - half;
    for (const n of texts) {
      for (const q of rectsOf(n, 0, n.textContent.length)) {
        // Un píxel de margen por lado (antialiasing y la caja de línea, algo más alta que las letras)
        const L = q.left + 1, R = q.right - 1, T = q.top + 1, B = q.bottom - 1;
        const near = Math.hypot(Math.max(L - cx, 0, cx - R), Math.max(T - cy, 0, cy - B));
        if (near >= outer) continue;
        const far = Math.max(...[[L, T], [R, T], [L, B], [R, B]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
        if (far > inner) issues.push(`texto que pisa un anillo («${n.textContent.trim().slice(0, 20)}»): ${desc(n.parentElement)}`);
      }
    }
  }
  return issues;
}

/** inspectTop con overlapIssues a su alcance (page.evaluate solo serializa la función que recibe). */
const measureTop = (page) => page.evaluate(`(() => { const overlapIssues = ${overlapIssues}; return (${inspectTop})(); })()`);

/** Al final de la pantalla: lo último visible queda por encima de la barra de pestañas (o del pie fijo). */
function inspectBottom() {
  const tab = document.querySelector('#tabbar');
  const tr = tab && getComputedStyle(tab).display !== 'none' ? tab.getBoundingClientRect() : null;
  let limit = tr && tr.height ? tr.top : innerHeight;
  for (const f of document.querySelectorAll('#view *')) {
    const cs = getComputedStyle(f);
    const r = f.getBoundingClientRect();
    if (cs.position === 'fixed' && r.top > innerHeight / 2 && r.height > 20 && !f.closest('.toast')) limit = Math.min(limit, r.top);
  }
  let last = null;
  for (const el of document.querySelectorAll('#view *')) {
    if (el.children.length) continue;
    const cs = getComputedStyle(el);
    if (cs.position === 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || el.closest('[hidden], .sticky-foot, [class*="footer"]')) continue;
    let r = el.getBoundingClientRect();
    if (r.height < 1 || r.width < 1) continue;
    // Recortado por un antepasado (carrusel, gráfica): cuenta solo lo que se ve
    let bottom = r.bottom;
    for (let p = el.parentElement; p && p.id !== 'view'; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowY !== 'visible' || pcs.overflowX !== 'visible') bottom = Math.min(bottom, p.getBoundingClientRect().bottom);
      if (pcs.position === 'sticky' || pcs.position === 'fixed') { bottom = -1; break; }
    }
    if (!last || bottom > last.bottom) last = { bottom, who: `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className).split(' ')[0]} «${(el.textContent || '').trim().slice(0, 30)}»` };
  }
  return last && last.bottom > limit + 1 ? [`lo último (${last.who}) acaba en ${Math.round(last.bottom)} px, por debajo de la barra (${Math.round(limit)} px)`] : [];
}

/**
 * Baja hasta el final y espera a que la página deje de crecer (listas y gráficas que se pintan después): por
 * condición —la altura no cambia entre dos fotogramas y se está abajo del todo—, no por tiempo.
 */
async function scrollToEnd() {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  let last = -1;
  for (let i = 0; i < 40; i++) {
    const sh = document.documentElement.scrollHeight;
    window.scrollTo(0, sh);
    await frame();
    if (sh === last && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1) return;
    last = sh;
  }
}

async function sweep(app, { tag, widths, ids }) {
  const { page } = app;
  fs.mkdirSync(OUT, { recursive: true });
  const problems = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 844 });
    for (const [key, hash, prepare] of routes(ids)) {
      await go(page, '#/today'); // se entra siempre desde Hoy (como en el uso real)
      await go(page, hash);
      if (prepare) await prepare(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const top = await measureTop(page);
      await page.screenshot({ path: path.join(OUT, `${tag}-${key}-${w}.png`) });
      await page.evaluate(scrollToEnd);
      const bottom = await page.evaluate(inspectBottom);
      for (const p of [...top, ...bottom]) problems.push(`${key} @${w}: ${p}`);
    }
  }
  return problems;
}

/**
 * Tamaño del texto del sistema (iOS: Ajustes › Pantalla y brillo › Tamaño del texto). En iPhone la app lo lee de
 * `-apple-system-body` (app.js); en las pruebas se fuerza con la misma clave que usa app.js para depurar.
 */
const beforeLoad = (scale) => async (page) => {
  await page.context().clock.install({ time: madrid(TODAY) });
  if (scale !== 1) await page.addInitScript((s) => { try { localStorage.setItem('entreno.textScale', String(s)); } catch { /* */ } }, scale);
};

async function withData(browser, tag, { scale = 1, widths = [375, 390, 430] } = {}) {
  const app = await openApp({ browser, beforeLoad: beforeLoad(scale) });
  try {
    const { activeId } = await seedRealistic(app.page, { months: 6, female: true, activeSession: true });
    await seedPastRaces(app.page);
    const ids = await app.page.evaluate(() => {
      const ss = window.__app.store.all('sessions');
      const done = ss.filter((s) => s.status === 'done' && s.kind === 'strength').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const run = ss.filter((s) => s.kind === 'run').sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      return { done: done.id, doneDate: done.date, run: run.id, pastRaces: true };
    });
    if (scale !== 1) {
      assert.strictEqual(await app.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ts').trim()), String(scale), 'el texto se agranda');
    }
    const problems = await sweep(app, { tag, widths, ids: { ...ids, activeId, female: true } });
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

async function empty(browser, tag) {
  const app = await openApp({ browser, beforeLoad: async (page) => { await page.context().clock.install({ time: madrid(TODAY) }); } });
  try {
    const problems = await sweep(app, { tag, widths: [375], ids: {} });
    assert.deepStrictEqual(problems, [], problems.join('\n'));
    assert.deepStrictEqual(app.errors, []);
  } finally {
    await app.close();
  }
}

test('guardas visuales con datos realistas: todas las pantallas a 375, 390 y 430 px', () => withData('chromium', 'chromium'));
test('guardas visuales con la app vacía (estados vacíos) a 375 px', () => empty('chromium', 'chromium-vacia'));
test('WebKit: guardas visuales con datos realistas a 375, 390 y 430 px', { skip: skipWebkit }, () => withData('webkit', 'webkit'));
test('WebKit: guardas visuales con la app vacía a 375 px', { skip: skipWebkit }, () => empty('webkit', 'webkit-vacia'));
// Texto grande (125 % y 150 %): nada cortado, nada que se salga, botones a 44 px, la cabecera sin tapar nada
test('texto al 125 %: guardas visuales con datos realistas a 375 px', () => withData('chromium', 'chromium-125', { scale: 1.25, widths: [375] }));
test('texto al 150 %: guardas visuales con datos realistas a 375 y 430 px', () => withData('chromium', 'chromium-150', { scale: 1.5, widths: [375, 430] }));
test('WebKit: texto al 150 % con datos realistas a 375 px', { skip: skipWebkit }, () => withData('webkit', 'webkit-150', { scale: 1.5, widths: [375] }));

/**
 * La guarda de solapes, contra casos conocidos (ronda 8, A2): con texto al 150 % el anillo del ciclo, la duración
 * («00» sobre «min»), «Senderismo» en un tercio de fila y «RECUPERACIÓ|N» pasaban la guarda. Se monta cada caso
 * roto y su arreglo en una página mínima y se comprueba que la guarda avisa del roto y calla con el arreglo.
 */
async function selfTest(browserName) {
  const browser = await playwright[browserName].launch();
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
    await page.setContent(`<!doctype html><html lang="es"><body style="margin:0;font-family:sans-serif;background:#111;color:#eee">
      <div id="view">
        <div class="case" id="ring-bad" style="position:relative;width:120px;height:120px">
          <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#888" stroke-width="16"/></svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;text-align:center">Ovulación aprox.</div>
        </div>
        <div class="case" id="ring-ok" style="position:relative;width:120px;height:120px">
          <svg viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"><circle cx="60" cy="60" r="50" fill="none" stroke="#888" stroke-width="16"/></svg>
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px">15</div>
        </div>
        <label class="case" id="unit-bad" style="position:relative;display:flex;width:100px">
          <input value="00" style="width:100%;height:44px;font-size:30px;text-align:center;padding:0 8px;box-sizing:border-box">
          <span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:19px">min</span>
        </label>
        <label class="case" id="unit-ok" style="position:relative;display:flex;width:100px">
          <input value="00" style="width:100%;height:70px;font-size:30px;text-align:center;padding:2px 4px 30px;box-sizing:border-box">
          <span style="position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:19px;line-height:1.2">min</span>
        </label>
        <div class="case" id="word-bad" style="width:60px;font-size:20px;overflow-wrap:anywhere">Senderismo</div>
        <div class="case" id="word-ok" style="width:200px;font-size:20px;overflow-wrap:anywhere">Senderismo</div>
      </div></body></html>`);
    const run = (id) => page.evaluate(`(() => {
      const overlapIssues = ${overlapIssues};
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 && !el.closest('[aria-hidden="true"]'); };
      const desc = (el) => el.tagName.toLowerCase();
      return overlapIssues(document.getElementById(${JSON.stringify(id)}), desc, shown);
    })()`);
    const ring = await run('ring-bad');
    assert.ok(ring.some((x) => /pisa un anillo/.test(x)), `anillo: ${ring.join(' | ')}`);
    assert.deepStrictEqual(await run('ring-ok'), []);
    const unit = await run('unit-bad');
    assert.ok(unit.some((x) => /pisa la unidad «min»/.test(x)), `unidad: ${unit.join(' | ')}`);
    assert.deepStrictEqual(await run('unit-ok'), []);
    const word = await run('word-bad');
    assert.ok(word.some((x) => /palabra partida «Senderismo»/.test(x)), `palabra: ${word.join(' | ')}`);
    assert.deepStrictEqual(await run('word-ok'), []);
  } finally {
    await browser.close();
  }
}
test('la guarda de solapes avisa de un texto sobre el anillo, un valor sobre su unidad y una palabra partida', () => selfTest('chromium'));
test('WebKit: la guarda de solapes avisa de los mismos casos', { skip: skipWebkit }, () => selfTest('webkit'));
