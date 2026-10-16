// Guardas visuales estables (docs/PULIDO.md): recorre TODAS las pantallas con datos realistas (6 meses de fuerza,
// carrera, bici, peso, ciclo, objetivos, contexto, un evento y una sesión a medias) a 375, 390 y 430 px, también
// con la app vacía y con el texto del sistema al 125 % y al 150 %, y comprueba invariantes de maquetación que no
// dependen de píxeles:
//   · ningún texto roto («null», «undefined», NaN, Infinity, «[object …]», «:-5», ritmos «h:mm:ss /km»);
//   · sin scroll horizontal ni nada que se salga por los lados (salvo dentro de un carrusel);
//   · la cabecera no tapa el principio del contenido y lo último queda por encima de la barra de pestañas;
//   · ningún texto por debajo de 12 px, ninguno cortado con «…» o a N líneas, ninguno que se salga de su caja (un
//     botón, una ficha), ningún botón por debajo de 44 px de alto y ningún botón ni ficha por debajo de 44 px de ancho
//     (con su área ampliada con ::before; excepciones explícitas en WIDTH_EXCEPTIONS);
//   · las gráficas con la franja de contexto (ronda 8, E) y el globo de un hecho abierto;
//   · el panel de la semana pasada con «Puesta a punto» y su «¿Por qué?» abierto (ronda 8, G);
//   · una sesión larga con superserie y ejercicios plegados, uno desplegado a mano y otro en curso (ronda 8, H);
//   · icono junto a su texto, sin encogerse (PULIDO §«Icono + etiqueta»): el primer glifo de la etiqueta, a la
//     distancia del gap aunque parta de línea, y ningún icono SVG más estrecho que su tamaño; ningún emoji que
//     encabeza una etiqueta solo en su línea;
//   · el texto atenuado con opacidad (la suya o la de un antepasado) mantiene ≥ 4,5:1 (≥ 3:1 si es grande) sobre su
//     fondo (PULIDO §17: se atenúa con color, no con opacity);
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

/** #/recovery en «4 semanas» (el periodo se recuerda: tras «12 semanas» de la anchura anterior, se vuelve). */
async function recovery4w(page) {
  const b = page.locator('.rcv-period .seg-btn', { hasText: '4 semanas' });
  if (!(await b.count())) return; // app vacía: estado vacío, sin selector
  await b.click();
  await page.locator('.rcv-feel[data-period="4w"]').waitFor();
}

/** #/recovery con «12 semanas» elegido (ronda 8, F): una celda por semana. */
async function recovery12w(page) {
  await page.locator('.rcv-period .seg-btn', { hasText: '12 semanas' }).click();
  await page.locator('.rcv-feel[data-period="12w"]').waitFor();
}

/**
 * Franja de contexto (ronda 8, E): toca el primer hecho de la primera gráfica con franja (encendida) y deja su globo
 * abierto. En Progreso es la de peso; en la ficha de ejercicio, el 1RM.
 */
async function openContextTip(page) {
  const fact = page.locator('.chart-ctx-fact').first();
  await fact.waitFor();
  await fact.evaluate((el) => el.closest('.chart').scrollIntoView({ block: 'center' }));
  await settle(page);
  const b = await fact.boundingBox();
  await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('.chart:has(.chart-ctx-fact) .chart-tip:not([hidden])').first().waitFor();
}

/**
 * Ronda 8 (G): panel de la semana pasada con «Puesta a punto». Los datos traen un 10K A dentro de los 28 días tras el
 * domingo; aquí se quitan las sesiones de fuerza de esa semana (la carga baja, sin llegar a 0) y `restoreTaperWeek` las
 * devuelve después de medir, para que el resto de pantallas vea los datos de siempre.
 */
const TAPER_WEEK = '2026-09-28';
async function taperWeek(page) {
  await page.evaluate(async (from) => {
    const st = window.__app.store;
    const u = await import('./js/util.js');
    const to = u.addDays(from, 6);
    const gone = st.all('sessions').filter((x) => x.kind === 'strength' && x.status === 'done' && x.date >= from && x.date <= to);
    window.__vgTaper = gone;
    for (const x of gone) await st.remove('sessions', x.id);
  }, TAPER_WEEK);
  await go(page, '#/today');
  await go(page, `#/weekly?week=${TAPER_WEEK}`);
  const tag = await page.locator('.wk-msg[data-id="load"] .wk-level').textContent();
  assert.strictEqual(tag.trim(), 'Puesta a punto', 'el panel muestra la puesta a punto');
  // «¿Por qué?» abierto: la fila «Evento próximo» también se mide
  await page.locator('.wk-msg[data-id="load"] .why-btn').click();
  await settle(page);
}
async function restoreTaperWeek(page) {
  await page.evaluate(async () => {
    const st = window.__app.store;
    for (const x of window.__vgTaper || []) await st.save('sessions', x);
    window.__vgTaper = null;
    await st.flush();
  });
}

/**
 * Ronda 8 (H): sesión larga en curso de 12 ejercicios: superserie terminada (plegada), 4 terminados plegados, uno
 * terminado desplegado a mano, uno en curso (2/4) con el cursor y el resto pendientes. `removeLongSession` la borra.
 */
async function longSession(page) {
  await page.evaluate(async () => {
    const { store } = window.__app;
    const sl = await import('./js/session-logic.js');
    const exs = store.all('exercises').filter((e) => e.logType === 'weight_reps' && !e.archived).slice(0, 12);
    const s = await sl.createStrengthSession({});
    await store.remove('sessions', s.id);
    s.id = 'vg_long';
    s.templateName = 'Sesión larga';
    s.exercises = exs.map((e, i) => {
      const se = sl.newSessionExercise(e.id, s);
      const n = i === 7 ? 4 : 3;
      const k = i <= 6 ? n : i === 7 ? 2 : 0;
      se.sets = Array.from({ length: n }, (_, j) => ({ ...sl.newSet(null, se, 'weight_reps'), weight: 40, reps: 8, rir: 2, done: j < k, doneAt: j < k ? 1 : null }));
      if (i < 2) Object.assign(se, { groupId: 'vg_g', groupType: 'superset' });
      return se;
    });
    s.cursor = 7;
    await store.save('sessions', s);
  });
  await go(page, '#/session/vg_long');
  await page.locator('[data-block^="se:"][data-folded="1"] .ses-fold').nth(4).click(); // el 7.º, desplegado a mano
  await page.waitForFunction(() => document.querySelectorAll('[data-folded="1"]').length === 5);
  // La entrada al desplegar (fundido de 220 ms) termina antes de medir: a medio fundido la guarda no vería la tarjeta
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
  await settle(page);
}
async function removeLongSession(page) {
  await page.evaluate(async () => { await window.__app.store.remove('sessions', 'vg_long'); await window.__app.store.flush(); });
}

/**
 * Pantallas: [clave, hash, preparar?, deshacer?]; `ids` da las que dependen de los datos (null → se omiten con la app vacía).
 * `preparar(page)` deja la pantalla en el estado que se mide (p. ej. un paso concreto de la bienvenida).
 */
const routes = (ids) => [
  ['today', '#/today'], ['calendar', '#/calendar'], ['day', `#/day/${ids.doneDate || TODAY}`], ['history', '#/history'],
  ids.activeId && ['session', `#/session/${ids.activeId}`], ids.done && ['summary', `#/session/${ids.done}/summary`],
  // Ronda 8 (H): sesión larga con lo terminado plegado, uno desplegado a mano y otro en curso (2/4)
  ids.activeId && ['session-long', '#/today', longSession, removeLongSession],
  ['activity-new', '#/activity/new?kind=run'], ['activity-new-hike', '#/activity/new?kind=hike'], ids.run && ['activity', `#/activity/${ids.run}`],
  ['bodyweight', '#/bodyweight'], ['exercises', '#/exercises'], ['exercise', '#/exercise/press_banca'], ['exercise-edit', '#/exercise/press_banca/edit'],
  ['templates', '#/templates'], ['template', '#/template/tpl_d1'],
  ['settings', '#/settings'], ['settings-week', '#/settings/week'], ['settings-thresholds', '#/settings/thresholds'], ['settings-data', '#/settings/data'],
  ['settings-data-rp', '#/settings/data', restorePoint], ['profile', '#/settings/profile'],
  ['progress', '#/progress'], ['progress-exercise', '#/progress/exercise/press_banca'],
  // Ronda 8 (E): contexto encendido con el globo de un hecho abierto (Progreso y ficha de ejercicio)
  ids.done && ['progress-ctx-tip', '#/progress', openContextTip], ids.done && ['progress-exercise-ctx-tip', '#/progress/exercise/press_banca', openContextTip], ['records', '#/records'], ['records-past', '#/records/past'], ['records-past-new', '#/records/past/new'],
  ['races', '#/races', ids.pastRaces ? openPast : null], ['race-new', '#/races/new'],
  // Ronda 8 (D): la tarjeta del resultado de un evento pasado (con resultado, sin responder con el formulario a mano
  // abierto, y con la actividad vinculada borrada)
  ids.pastRaces && ['race-result', '#/races/vg_past_done'], ids.pastRaces && ['race-result-pending', '#/races/vg_past_pending', openManual],
  ids.pastRaces && ['race-result-missing', '#/races/vg_past_missing'], ['weekly', '#/weekly'],
  ids.done && ['weekly-taper', `#/weekly?week=${TAPER_WEEK}`, taperWeek, restoreTaperWeek], ['goals', '#/goals'], ['goal-new', '#/goal/new'],
  ['import', '#/import'], ['predictions', '#/predictions'], ['summary-period', '#/summary'], ['analysis', '#/analysis'],
  // Ronda 8 (F): evolución de los check-ins (con datos: tiras, tendencia y zonas; vacía: su estado vacío) y 12 semanas
  ['recovery', '#/recovery', recovery4w], ids.done && ['recovery-12w', '#/recovery', recovery12w],
  ids.female && ['cycle', '#/cycle'], ['context', '#/context'], ['context-new', '#/context/new?kind=event&type=race_result'],
  ['welcome', '#/welcome'], !ids.done && ['welcome-week', '#/welcome', weekStep],
].filter(Boolean);

/** Medición en la página (pantalla arriba del todo): devuelve la lista de problemas. */
function inspectTop() {
  // Excepciones explícitas al ancho táctil de 44 px: [selector, mínimo]. Cada una, con su porqué. (Las zonas del mapa
  // corporal son regiones de un dibujo SVG: no cuentan, como en el alto.)
  const WIDTH_EXCEPTIONS = [
    // RIR a 100 %: Fallo y 0–5 en una fila de ~293 px (375 px) no llegan a 44 px; el ::before cubre el hueco (≥ 40).
    // Con texto grande van en dos filas y sí se exigen 44 (tests/e2e/large-text-rows.test.cjs).
    ['html:not(.text-large) .ses-editor .ses-rir .chip', 39.5],
    // Celdas del calendario del resumen: 7 por semana (41–43 px a 375–390 px).
    ['.sum-cal-cell', 39.5],
  ];
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
    // Área táctil ampliada con un ::before absoluto (fichas de RIR): no es texto, pero cuenta en scrollWidth
    const bf = getComputedStyle(el, '::before');
    const hitArea = bf.content !== 'none' && bf.position === 'absolute';
    const extL = hitArea ? Math.max(0, -parseFloat(bf.left) || 0) : 0;
    const extR = hitArea ? Math.max(0, -parseFloat(bf.right) || 0) : 0;
    // Texto que se sale de su propia caja (un botón, una ficha) y pisa lo de al lado
    if ((own.trim() || el.matches('button, [role=button]')) && !el.closest('svg') && cs.overflowX === 'visible' && cs.display !== 'inline' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + extR + 1) issues.push(`texto que se sale de su caja (${el.scrollWidth} > ${el.clientWidth} px): ${desc(el)}`);
    if (own.trim()) {
      if (parseFloat(cs.fontSize) < 11.9) issues.push(`texto de ${cs.fontSize}: ${desc(el)}`);
      if (/\bnull\b|\bundefined\b|NaN|Infinity|\[object |:-\d|\d+:\d{2}:\d{2}\s?\/km/.test(own)) issues.push(`texto roto: ${desc(el)}`);
    }
    const tappable = el.matches('button, a[href], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button], [role=tab]');
    // Las zonas del mapa corporal (SVG) son regiones del dibujo, no botones: se tocan por su área
    if (tappable && r.height < 43.5 && !el.closest('svg, .why-body')) issues.push(`objetivo táctil de ${Math.round(r.width)}×${Math.round(r.height)}: ${desc(el)}`);
    // Ancho táctil (ronda 9, M14): ≥ 44 px para botones y fichas, contando el área ampliada con ::before.
    if (el.matches('button, .chip, [role=button]') && !el.closest('svg, .why-body')) {
      const min = WIDTH_EXCEPTIONS.find(([sel]) => el.matches(sel))?.[1] ?? 43.5;
      if (r.width + extL + extR < min) issues.push(`objetivo táctil de ${Math.round(r.width + extL + extR)} px de ancho: ${desc(el)}`);
    }
  }
  issues.push(...overlapIssues(root, desc, shown));
  issues.push(...iconGapIssues(root, desc, shown), ...iconShrinkIssues(root, desc));
  issues.push(...contrastIssues(root, desc, shown), ...emojiOrphanIssues(root, desc));
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

/**
 * Icono + etiqueta (docs/PULIDO.md, «Icono + etiqueta»): en un botón, una baldosa, una fila de lista o una cabecera
 * (`*-head`) en fila cuyo PRIMER hijo es un icono (SVG o emoji en su span), el primer glifo de la etiqueta queda a la
 * distancia del gap: ni lejos (≤ gap + 6 px; una etiqueta centrada que parte de línea lo aleja 30–50 px) ni encima
 * (≥ 2 px; un emoji que crece más que su caja fija se le monta). El glifo se mide con Range, no con la caja de la
 * etiqueta. No cuentan los iconos que van detrás del texto («Ver progreso ›») ni la salida del modo foco (§18).
 */
function iconGapIssues(root, desc, shown) {
  const issues = [];
  // (los iconos llevan aria-hidden —la etiqueta ya lo dice—: aquí cuenta si se ven)
  const seen = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width >= 1 && r.height >= 1 && !el.closest('[hidden]') && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const EMOJI = /^[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D]+$/u;
  const textRect = (node, from, to) => {
    const rg = document.createRange();
    rg.setStart(node, from);
    rg.setEnd(node, to);
    return [...rg.getClientRects()].find((r) => r.width > 0.5 && r.height > 0.5) || null;
  };
  for (const el of root.querySelectorAll('.btn, .prg-link-wide, .list-item, [class*="-head"]')) {
    if (el.matches('.fb-exit') || ![...el.classList].some((c) => c === 'btn' || c === 'prg-link-wide' || c === 'list-item' || c.endsWith('-head'))) continue;
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    if (!/flex/.test(cs.display) || cs.flexDirection !== 'row') continue;
    const ic = el.firstElementChild;
    // El icono tiene que ser lo primero (sin texto delante)
    if (!ic || [...el.childNodes].slice(0, [...el.childNodes].indexOf(ic)).some((n) => n.textContent.trim())) continue;
    const isSvg = ic.matches('svg.icon');
    const isEmoji = !isSvg && ic.tagName === 'SPAN' && EMOJI.test(ic.textContent.trim());
    if ((!isSvg && !isEmoji) || !seen(ic)) continue;
    let ir = ic.getBoundingClientRect();
    const ics = getComputedStyle(ic);
    // Un emoji sobre baldosa (fondo o borde) se mide desde la baldosa; uno suelto, desde su tinta: su caja puede ser
    // más ancha que el glifo (una columna fija) o más estrecha (el glifo crece con el texto y se sale)
    const tile = !/^(transparent|rgba\(0, 0, 0, 0\))$/.test(ics.backgroundColor) || ics.backgroundImage !== 'none' || parseFloat(ics.borderRightWidth) > 0;
    if (isEmoji && !tile) {
      const t = [...ic.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
      ir = (t && textRect(t, 0, t.textContent.length)) || ir;
    }
    // Primer glifo de la etiqueta: el primer texto visible después del icono
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let glyph = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (ic.contains(n) || !n.parentElement || !shown(n.parentElement) || n.parentElement.closest('svg')) continue;
      const i = n.textContent.search(/\S/);
      if (i < 0) continue;
      glyph = textRect(n, i, i + 1);
      if (glyph) break;
    }
    if (!glyph) continue;
    const gap = parseFloat(cs.columnGap) || 0;
    const d = glyph.left - ir.right;
    if (d > gap + 6) issues.push(`texto lejos de su icono (${Math.round(d)} px, gap ${gap}): ${desc(el)}`);
    else if (d < 2) issues.push(`texto pegado o encima de su icono (${Math.round(d)} px): ${desc(el)}`);
  }
  return issues;
}

/**
 * Ningún icono SVG se encoge (PULIDO, «Icono + etiqueta»): un ítem flex sin `flex: none` cede ancho cuando el texto no
 * cabe y el icono queda de 9–16 px. Se compara con su atributo `width` (icon()), o con su alto si una regla lo
 * redimensiona (los iconos son cuadrados: una regla cambia los dos lados; encogerse solo cambia el ancho).
 */
function iconShrinkIssues(root, desc) {
  const issues = [];
  for (const svg of root.querySelectorAll('svg.icon')) {
    // (lleva aria-hidden: cuenta si se ve)
    const cs = getComputedStyle(svg);
    const r = svg.getBoundingClientRect();
    if (r.height < 1 || svg.closest('[hidden]') || cs.display === 'none' || cs.visibility === 'hidden') continue;
    const aw = parseFloat(svg.getAttribute('width'));
    const ah = parseFloat(svg.getAttribute('height'));
    if (!(aw > 0)) continue;
    const want = Math.abs(r.height - ah) <= 0.5 ? aw : r.height;
    if (r.width < want - 0.5) issues.push(`icono encogido (${r.width.toFixed(1)} de ${want} px): ${desc(svg.parentElement)}`);
  }
  return issues;
}

/**
 * Contraste del texto atenuado (docs/PULIDO.md §17, «sin opacidad»): un texto con opacidad acumulada < 1 (la suya o la
 * de un antepasado) se mezcla con el fondo y puede quedar ilegible aunque su color dé ≥ 4,5:1. Para esos textos (y
 * solo esos: el resto usa los tokens ya medidos), su color mezclado sobre lo que hay debajo debe dar ≥ 4,5:1, o ≥ 3:1
 * si es texto grande (≥ 24 px, o ≥ 18,66 px en negrita). No cuentan los controles :disabled (WCAG los exime) ni lo
 * oculto a VoiceOver (aria-hidden, ya fuera por `shown`). La pila se compone como el navegador: cada fondo encima del
 * anterior y cada grupo con opacidad mezclado al cerrar con lo que tenía detrás; con una imagen o un degradado de
 * fondo no se sabe el color y no se mide. Una opacidad en plena animación es de paso y tampoco se mide.
 */
function contrastIssues(root, desc, shown) {
  const issues = [];
  const ctx = document.createElement('canvas').getContext('2d');
  // El motor da el color como rgb(), rgba() o color(srgb …): el lienzo lo normaliza a #rrggbb o rgba()
  const parse = (c) => {
    ctx.fillStyle = '#000';
    ctx.fillStyle = c;
    const s = ctx.fillStyle;
    if (s[0] === '#') return { r: parseInt(s.slice(1, 3), 16), g: parseInt(s.slice(3, 5), 16), b: parseInt(s.slice(5, 7), 16), a: 1 };
    const p = s.match(/[\d.]+/g).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const seen = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!n.textContent.trim() || !el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest('svg, :disabled') || !shown(el)) continue;
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.unshift(e);
    const styles = chain.map((e) => getComputedStyle(e));
    const op = styles.reduce((a, cs) => a * Number(cs.opacity), 1);
    if (op >= 0.999) continue;
    if (chain.some((e, i) => Number(styles[i].opacity) < 1 && e.getAnimations().some((a) => a.playState === 'running'))) continue;
    // Con imagen o degradado de fondo por encima del último fondo opaco, el color de debajo no se conoce
    const lastOpaque = Math.max(0, ...styles.map((cs, i) => (parse(cs.backgroundColor).a >= 1 ? i : -1)));
    if (styles.slice(lastOpaque).some((cs) => cs.backgroundImage !== 'none')) continue;
    // Lo que se ve en el punto del texto, con texto (fg) y sin él (bg)
    const paint = (withText) => {
      let px = { r: 255, g: 255, b: 255, a: 1 };
      const groups = [];
      styles.forEach((cs) => {
        if (Number(cs.opacity) < 1) groups.push({ back: px, a: Number(cs.opacity) });
        px = over(parse(cs.backgroundColor), px);
      });
      if (withText) px = over(parse(styles[styles.length - 1].color), px);
      for (let i = groups.length - 1; i >= 0; i--) px = over({ ...px, a: groups[i].a }, groups[i].back);
      return px;
    };
    const L1 = lum(paint(true));
    const L2 = lum(paint(false));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const cs = styles[styles.length - 1];
    const fs = parseFloat(cs.fontSize);
    const need = fs >= 24 || (Number(cs.fontWeight) >= 700 && fs >= 18.66) ? 3 : 4.5;
    if (ratio < need - 0.005) issues.push(`contraste ${ratio.toFixed(2)}:1 (< ${need}) con opacidad ${op.toFixed(2)}: ${desc(el)}`);
  }
  return issues;
}

/**
 * Emoji huérfano (PULIDO, «Icono + etiqueta»): un emoji que encabeza una etiqueta («🎯 Objetivos», «🏃 Carrera ·
 * distancia») va en la misma línea que su primera palabra. Con un espacio normal, al 150 % el emoji se queda solo en
 * una línea y el título baja a la siguiente. Se mide con Range: el centro del emoji y el del primer glifo que lo sigue
 * dentro del mismo bloque, a más de 0,6 líneas → huérfano. (El emoji suele ir en un span aria-hidden: cuenta si se ve.)
 */
function emojiOrphanIssues(root, desc) {
  const issues = [];
  const EMO = /\p{Extended_Pictographic}/u;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width >= 1 && r.height >= 1 && !el.closest('[hidden]') && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const rect = (node, from, to) => {
    const rg = document.createRange();
    rg.setStart(node, from);
    rg.setEnd(node, to);
    return [...rg.getClientRects()].find((r) => r.width > 0.5 && r.height > 0.5) || null;
  };
  const blockOf = (el) => {
    for (let e = el; e && e !== root; e = e.parentElement) if (!getComputedStyle(e).display.startsWith('inline')) return e;
    return root;
  };
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.textContent.trim() && n.parentElement && !n.parentElement.closest('svg') && visible(n.parentElement)) nodes.push(n);
  }
  nodes.forEach((n, k) => {
    const t = n.textContent;
    const i = t.search(/\S/);
    if (!EMO.test(t.slice(i, i + 2))) return; // solo el emoji que encabeza su texto
    const len = t.codePointAt(i) > 0xffff ? 2 : 1;
    const er = rect(n, i, i + len);
    if (!er) return;
    const block = blockOf(n.parentElement);
    // Primer glifo que no es emoji ni espacio, en este texto o en los siguientes del mismo bloque
    let gr = null;
    for (let j = k, from = i + len; j < nodes.length && !gr; j++, from = 0) {
      const m = nodes[j];
      if (j > k && blockOf(m.parentElement) !== block) break;
      const rest = m.textContent.slice(from);
      const g = rest.search(/[^\s\p{Extended_Pictographic}️‍\u{1F3FB}-\u{1F3FF}]/u);
      if (g >= 0) gr = rect(m, from + g, from + g + 1);
    }
    if (!gr) return;
    const lh = parseFloat(getComputedStyle(n.parentElement).lineHeight) || er.height;
    const dy = (gr.top + gr.bottom) / 2 - (er.top + er.bottom) / 2;
    if (Math.abs(dy) > 0.6 * lh) issues.push(`emoji solo en su línea, separado de su texto (${Math.round(dy)} px): ${desc(block)}`);
  });
  return issues;
}

/** inspectTop con las guardas auxiliares a su alcance (page.evaluate solo serializa la función que recibe). */
const measureTop = (page) => page.evaluate(`(() => {
  const overlapIssues = ${overlapIssues};
  const iconGapIssues = ${iconGapIssues};
  const iconShrinkIssues = ${iconShrinkIssues};
  const contrastIssues = ${contrastIssues};
  const emojiOrphanIssues = ${emojiOrphanIssues};
  return (${inspectTop})();
})()`);

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
    for (const [key, hash, prepare, undo] of routes(ids)) {
      await go(page, '#/today'); // se entra siempre desde Hoy (como en el uso real)
      await go(page, hash);
      if (prepare) await prepare(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      const top = await measureTop(page);
      await page.screenshot({ path: path.join(OUT, `${tag}-${key}-${w}.png`) });
      await page.evaluate(scrollToEnd);
      const bottom = await page.evaluate(inspectBottom);
      for (const p of [...top, ...bottom]) problems.push(`${key} @${w}: ${p}`);
      if (undo) await undo(page);
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
    const { activeId } = await seedRealistic(app.page, { months: 6, female: true, activeSession: true, recovery: true });
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
        <div class="case" id="icon-far"><button class="btn" style="display:flex;align-items:center;justify-content:center;gap:8px;width:170px;font-size:20px;text-align:center"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" style="flex:none"></svg>Tiempos previstos</button></div>
        <div class="case" id="icon-near"><button class="btn" style="display:flex;align-items:center;justify-content:center;gap:8px;width:170px;font-size:20px;text-align:start"><svg class="icon" width="20" height="20" viewBox="0 0 24 24" style="flex:none"></svg>Tiempos previstos</button></div>
        <div class="case" id="icon-shrunk"><button class="btn" style="display:flex;align-items:center;gap:8px;width:170px;font-size:20px;white-space:nowrap"><svg class="icon" width="20" height="20" viewBox="0 0 24 24"></svg><span>Tiempos previstos</span></button></div>
        <div class="case" id="emoji-over"><div class="goal-head" style="display:flex;align-items:center;gap:4px;font-size:20px"><span style="flex:none;width:20px;font-size:40px;line-height:1;text-align:center">🏃</span><span>10K</span></div></div>
        <div class="case" id="emoji-ok"><div class="goal-head" style="display:flex;align-items:center;gap:10px;font-size:20px"><span style="flex:none;width:34px;font-size:26px;line-height:1;text-align:center">🏃</span><span>10K</span></div></div>
        <div class="case" id="word-ok" style="width:200px;font-size:20px;overflow-wrap:anywhere">Senderismo</div>
        <div class="case" id="dim-bad" style="background:#15181d;font-size:14px"><span style="color:#929baa;opacity:0.4">12</span><span style="opacity:0.6;color:#929baa">Serie 3</span><span style="opacity:0.75;color:#929baa">Normal</span></div>
        <div class="case" id="dim-ok" style="background:#15181d;font-size:14px"><span style="color:#929baa">12</span><span style="opacity:0.9;color:#f3f5f7">Serie 3</span><button disabled style="opacity:0.4;color:#929baa;background:none;border:0">Anterior</button><span aria-hidden="true" style="opacity:0.3">·</span><span style="opacity:0.75;color:#929baa;font-size:24px">Grande</span></div>
        <div class="case" id="emoji-orphan" style="width:120px;font-size:30px;line-height:1.25"><div>🎯 Objetivos</div><div><span aria-hidden="true">🏃 </span>Carrera · distancia</div></div>
        <div class="case" id="emoji-glued" style="width:120px;font-size:30px;line-height:1.25"><div>🎯\u00a0Objetivos</div><div><span aria-hidden="true">🏃\u00a0</span>Carrera · distancia</div></div>
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
    // Icono + etiqueta: lejos (etiqueta centrada que parte de línea), encogido y emoji montado sobre el texto
    const icons = (id) => page.evaluate(`(() => {
      const iconGapIssues = ${iconGapIssues};
      const iconShrinkIssues = ${iconShrinkIssues};
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 && !el.closest('[aria-hidden="true"]'); };
      const desc = (el) => el.tagName.toLowerCase();
      const root = document.getElementById(${JSON.stringify(id)});
      return [...iconGapIssues(root, desc, shown), ...iconShrinkIssues(root, desc)];
    })()`);
    const far = await icons('icon-far');
    assert.ok(far.some((x) => /texto lejos de su icono/.test(x)), `icono lejos: ${far.join(' | ')}`);
    assert.deepStrictEqual(await icons('icon-near'), []);
    const shrunk = await icons('icon-shrunk');
    assert.ok(shrunk.some((x) => /icono encogido/.test(x)), `icono encogido: ${shrunk.join(' | ')}`);
    const over = await icons('emoji-over');
    assert.ok(over.some((x) => /encima de su icono/.test(x)), `emoji encima: ${over.join(' | ')}`);
    assert.deepStrictEqual(await icons('emoji-ok'), []);
    // Contraste del texto atenuado con opacidad (y no los :disabled, lo oculto ni el texto grande a ≥ 3:1) y emoji huérfano
    const more = (id) => page.evaluate(`(() => {
      const contrastIssues = ${contrastIssues};
      const emojiOrphanIssues = ${emojiOrphanIssues};
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 && !el.closest('[aria-hidden="true"]'); };
      const desc = (el) => el.tagName.toLowerCase() + ' «' + el.textContent.trim() + '»';
      const root = document.getElementById(${JSON.stringify(id)});
      return [...contrastIssues(root, desc, shown), ...emojiOrphanIssues(root, desc)];
    })()`);
    const dim = await more('dim-bad');
    assert.strictEqual(dim.length, 3, `contraste: ${dim.join(' | ')}`);
    assert.match(dim[0], /contraste 2\.\d\d:1 \(< 4\.5\) con opacidad 0\.40: span «12»/);
    assert.match(dim[1], /contraste 3\.\d\d:1 \(< 4\.5\) con opacidad 0\.60: span «Serie 3»/);
    // El mismo gris a 24 px (texto grande) pasa en dim-ok: ≥ 3:1
    assert.match(dim[2], /contraste 4\.\d\d:1 \(< 4\.5\) con opacidad 0\.75: span «Normal»/);
    assert.deepStrictEqual(await more('dim-ok'), []);
    const orphan = await more('emoji-orphan');
    assert.strictEqual(orphan.length, 2, `emoji: ${orphan.join(' | ')}`);
    assert.ok(orphan.every((x) => /emoji solo en su línea/.test(x)), orphan.join(' | '));
    assert.deepStrictEqual(await more('emoji-glued'), []);
  } finally {
    await browser.close();
  }
}
test('la guarda de solapes avisa de un texto sobre el anillo, un valor sobre su unidad, una palabra partida, un icono lejos, encogido o encima de su texto, un emoji huérfano y un texto atenuado sin contraste', () => selfTest('chromium'));
test('WebKit: la guarda de solapes avisa de los mismos casos', { skip: skipWebkit }, () => selfTest('webkit'));
