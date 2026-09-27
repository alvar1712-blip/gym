// bodymap.js — mapa corporal: silueta SVG propia (delante y detrás, lado a lado) con las 16 zonas de
// seed.MUSCLES coloreadas según las series de la semana frente al rango de cada músculo.
//
//   bodyMap({ muscles, onSelect, selected, label, compact }) → HTMLElement (div.bm)
//     muscles: { [muscleId]: { sets, min, max, status:'below'|'in'|'above'|'none', name? } }
//     onSelect(muscleId): al tocar (o activar con teclado) una zona. selected: zona elegida al montar (sin
//     llamar a onSelect). compact: figura más pequeña (≤ 250 px de ancho) para tarjetas resumen.
//     El elemento devuelto trae el.select(id|null, { silent }) y el.update(muscles) para no volver a montarlo.
//   bodyMapData(muscleSets, ranges?, { zeroAsNone = true }) → objeto `muscles` (función PURA, sin DOM)
//   detailText(id, entry) / detailHint(entry) / zoneAriaLabel(id, entry) → textos del detalle
//     («Pecho · 8 series · objetivo 10–20 · por debajo» · «Faltan 2 series para el mínimo»)
//   BODY_ZONES · STATUS_LABEL · outlinePath() (geometría y textos, exportados para las pruebas)
//
// Sin dependencias del DOM al importar (las pruebas unitarias lo cargan en Node). No depende solo del color:
// tocar una zona la resalta y escribe debajo nombre, series, objetivo y estado; cada zona es un botón accesible
// (role="button", tabindex, aria-label con el dato, aria-pressed). Tocar cerca de una zona pequeña (antebrazo,
// tibial…) también la elige: se busca la zona más cercana al punto dentro de un margen.
import { MUSCLES, MUSCLE_LABEL, defaultSettings } from './seed.js';
import { fmtNum } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const EPS = 1e-9;

/** Estados posibles y su texto (en minúscula: van dentro de la frase del detalle). */
export const STATUS_LABEL = { below: 'por debajo', in: 'en rango', above: 'por encima', none: 'sin series' };
const STATUSES = ['below', 'in', 'above', 'none'];
const LEGEND_LABEL = { below: 'Por debajo', in: 'En rango', above: 'Por encima', none: 'Sin series' };

// ===========================================================================
// Datos (puro)
// ===========================================================================

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** [min, max] | null a partir de [min, max] o { min, max }. */
function rangeOf(t) {
  if (Array.isArray(t)) return t.length >= 2 && (isNum(t[0]) || isNum(t[1])) ? [isNum(t[0]) ? t[0] : null, isNum(t[1]) ? t[1] : null] : null;
  if (t && typeof t === 'object' && (isNum(t.min) || isNum(t.max))) return [isNum(t.min) ? t.min : null, isNum(t.max) ? t.max : null];
  return null;
}

/**
 * Convierte lo que ya calcula la app en el objeto `muscles` de bodyMap().
 * @param {object|Map|Array} muscleSets series por músculo de la semana:
 *   - `{ back: 12, chest: 7.5, … }` (p. ej. `weeklySeries(data)[i].muscleSets` o `calc.weeklyMuscleSets`),
 *   - un `Map(muscleId → series)`,
 *   - o filas `[{ muscleId, sets, min?, max? }]` (p. ej. `stats.muscleTable(data, week)` o los `items` del
 *     mensaje 'muscles' de insights.js); si una fila trae min/max/target, ese es su rango (null = sin rango).
 * @param {object} [ranges] rangos: `settings.muscleTargets` (`{ id: [min, max] }`), el objeto `settings` entero o
 *   `{ id: { min, max } }`. Manda sobre el de las filas. Sin rangos (ni en las filas) → los de `seed.defaultSettings()`.
 * @param {{ zeroAsNone?: boolean }} [opts] zeroAsNone (por defecto true): un músculo sin ninguna serie queda
 *   «sin series» (gris) aunque su mínimo sea > 0; con false sigue la regla del rango (0 < mín → por debajo).
 * @returns {{ [muscleId]: { sets:number, min:number|null, max:number|null, status:'below'|'in'|'above'|'none' } }}
 *   con los 16 músculos de seed.MUSCLES, en su orden.
 */
export function bodyMapData(muscleSets, ranges = null, { zeroAsNone = true } = {}) {
  const sets = new Map();
  const rowRange = new Map();
  if (muscleSets instanceof Map) {
    for (const [id, v] of muscleSets) sets.set(id, Number(v) || 0);
  } else if (Array.isArray(muscleSets)) {
    for (const r of muscleSets) {
      if (!r) continue;
      const id = r.muscleId ?? r.id;
      if (id == null) continue;
      sets.set(id, (sets.get(id) || 0) + (Number(r.sets) || 0));
      if ('target' in r) rowRange.set(id, rangeOf(r.target));
      else if ('min' in r || 'max' in r) rowRange.set(id, rangeOf({ min: r.min, max: r.max }));
    }
  } else if (muscleSets && typeof muscleSets === 'object') {
    for (const [id, v] of Object.entries(muscleSets)) sets.set(id, Number(v) || 0);
  }

  const targets = ranges && typeof ranges === 'object'
    ? (ranges.muscleTargets && typeof ranges.muscleTargets === 'object' ? ranges.muscleTargets : ranges)
    : null;
  let seedTargets = null;
  const out = {};
  for (const { id } of MUSCLES) {
    const n = Math.max(0, sets.get(id) || 0);
    let range;
    if (targets && id in targets) range = rangeOf(targets[id]);
    else if (rowRange.has(id)) range = rowRange.get(id);
    else if (targets) range = null;
    else range = rangeOf((seedTargets ||= defaultSettings().muscleTargets || {})[id]);
    const [min, max] = range || [null, null];
    out[id] = { sets: n, min, max, status: statusOf(n, min, max, zeroAsNone) };
  }
  return out;
}

/** Estado de unas series frente a [min, max] (misma regla que stats.targetStatus; 0 series → 'none'). */
function statusOf(sets, min, max, zeroAsNone = true) {
  if (zeroAsNone && sets <= EPS) return 'none';
  if (min == null && max == null) return 'none';
  if (min != null && sets < min - EPS) return 'below';
  if (max != null && sets > max + EPS) return 'above';
  return 'in';
}

/** Entrada normalizada de un músculo (acepta entradas incompletas o ausentes; sin estado válido, se calcula). */
function entryOf(e) {
  const sets = e && isNum(e.sets) ? Math.max(0, e.sets) : 0;
  const min = e && isNum(e.min) ? e.min : null;
  const max = e && isNum(e.max) ? e.max : null;
  const status = e && STATUSES.includes(e.status) ? e.status : statusOf(sets, min, max);
  return { sets, min, max, status, name: e && e.name };
}

const setsTxt = (n) => `${fmtNum(n, 1)} ${Math.abs(n - 1) < EPS ? 'serie' : 'series'}`;
function rangeTxt(min, max) {
  if (min != null && max != null) return `objetivo ${fmtNum(min, 1)}–${fmtNum(max, 1)}`;
  if (min != null) return `objetivo ≥ ${fmtNum(min, 1)}`;
  if (max != null) return `objetivo ≤ ${fmtNum(max, 1)}`;
  return 'sin objetivo';
}
/** Texto del estado; «sin objetivo» cuando hay series pero no rango. */
function statusTxt(x) {
  if (x.status === 'none' && x.sets > EPS) return 'sin objetivo';
  return STATUS_LABEL[x.status];
}
const nameOf = (id, x) => (x && x.name) || MUSCLE_LABEL[id] || id;

/** Partes del detalle: [nombre, series, objetivo, estado] (sin repetir «sin objetivo»). */
function detailParts(id, entry) {
  const x = entryOf(entry);
  const range = rangeTxt(x.min, x.max);
  const status = statusTxt(x);
  return status === range ? [nameOf(id, entry), setsTxt(x.sets), range] : [nameOf(id, entry), setsTxt(x.sets), range, status];
}

/** «Pecho · 8 series · objetivo 10–20 · por debajo» */
export function detailText(id, entry) {
  return detailParts(id, entry).join(' · ');
}

/** Línea secundaria: cuánto falta (también sin ninguna serie) o sobra («Faltan 2 series para el mínimo»), o ''. */
export function detailHint(entry) {
  const x = entryOf(entry);
  const short = x.status === 'below' || (x.status === 'none' && x.sets <= EPS);
  if (short && x.min != null && x.min - x.sets > EPS) {
    const d = x.min - x.sets;
    return `${Math.abs(d - 1) < EPS ? 'Falta 1 serie' : `Faltan ${setsTxt(d)}`} para el mínimo`;
  }
  if (x.status === 'above' && x.max != null) return `${setsTxt(x.sets - x.max)} por encima del máximo`;
  return '';
}

/** aria-label de una zona: «Pecho: 8 series, objetivo 10–20, por debajo». */
export function zoneAriaLabel(id, entry) {
  const [name, ...rest] = detailParts(id, entry);
  return `${name}: ${rest.join(', ')}`;
}

// ===========================================================================
// Geometría
// ===========================================================================
// Una figura mide 404 de alto (cabeza arriba en y = 0, planta en y ≈ 402) y se centra en x = 0; ~8 cabezas de
// 50 unidades: hombros ±57, cintura ±33, cadera ±39, brazos algo separados del tronco. Cada forma se da solo con
// los puntos del lado derecho (x ≥ 0) y se refleja. Los puntos se unen con curvas suaves (Catmull-Rom); un tercer
// valor 1 marca una esquina. Las zonas se recortan con la silueta y un borde del color del cuerpo las separa.

const C = 1; // esquina

/** Contorno de la silueta (mitad derecha, de la coronilla a la entrepierna). */
const OUTLINE = [
  [0, 0], [8.5, 1.6], [14.5, 6.5], [17.2, 15], [17.6, 25], [16.6, 33], [14, 40], [10, 45.5], [8.6, 49.5, C],
  [9, 54], [11, 58.5], [18, 61.5], [30, 64.5], [41, 67.5], [49, 71], [54.5, 78], [57.5, 89], [58.5, 101],
  [60, 116], [61.5, 132], [62.5, 146], [66.5, 160], [69.5, 176], [71, 191], [71.5, 201], [74.5, 211],
  [76.5, 224], [76, 236], [72, 243.5], [67, 242], [64.5, 231], [63.5, 216], [63, 204], [60.5, 190],
  [56, 174], [52, 160], [49, 148], [46, 133], [43, 117], [41.3, 106], [40.3, 101.2], [38.9, 101.6], [37.6, 109], [35.5, 126],
  [32.8, 146], [33.2, 162], [36.5, 178], [39, 194], [38.8, 212], [37.2, 234], [34.2, 257], [30.6, 280],
  [30.2, 292], [31.6, 307], [31.2, 323], [27.6, 344], [23.4, 365], [21.2, 382], [24, 390], [27, 397.5],
  [23.5, 402], [12.5, 402], [10, 397], [10.6, 385], [9.2, 366], [7.2, 344], [6.2, 323], [6.6, 305],
  [8.2, 291], [7.6, 279], [5.4, 257], [3.6, 233], [1.8, 212], [0, 207, C],
];

// Formas compartidas por las dos vistas (la silueta es simétrica delante/detrás).
const DELT_INNER = [[38.5, 70.5], [45, 70.5], [49.5, 76], [51, 86], [49.5, 98], [46.8, 108, C], [42.5, 100], [40.5, 90], [39.5, 80]];
const DELT_OUTER = [[47, 69.5], [53, 73.5], [57, 82], [58.5, 94], [56.5, 104], [49.5, 111, C], [52.5, 99], [53, 86], [51, 76]];
const FOREARM = [[51.5, 156], [56, 152], [62.5, 152.5], [66, 160], [68.5, 172], [69.5, 186], [69, 196], [66, 199], [62.5, 190], [57.5, 177], [53.5, 165]];

/** Zonas de la vista frontal: muscleId → formas. */
const FRONT = {
  chest: [[[2, 73, C], [10, 70.5], [21, 70], [31, 72.5], [37.5, 78], [39, 86], [37.5, 95], [32, 103.5], [23, 110], [13, 111.5], [3.5, 108.5, C]]],
  frontdelt: [DELT_INNER],
  sidedelt: [DELT_OUTER],
  biceps: [[[44.5, 118], [47, 112.5], [51.5, 112], [56, 115.5], [58.6, 125], [59.2, 137], [57, 146], [53, 149.5], [49.5, 143], [46.5, 131]]],
  forearms: [FOREARM],
  core: [
    [[1.8, 114.5, C], [11, 113], [13, 117], [13, 127], [11.5, 129.5], [1.8, 130, C]],
    [[1.8, 133, C], [11.5, 132.5], [13.3, 135], [13.3, 145.5], [11.5, 148], [1.8, 148.5, C]],
    [[1.8, 151.5, C], [11.5, 151], [13.3, 154], [13, 164], [11, 166.5], [1.8, 167, C]],
    [[1.8, 170, C], [11, 169.5], [12.8, 173], [11.5, 184], [8, 194], [1.8, 198, C]],
    [[15.5, 117], [23, 113.5], [30, 110.5], [31.8, 115], [30.5, 128], [29, 146], [29.5, 160], [30.8, 171], [27.5, 181], [21, 190], [15.5, 195], [15, 180], [15.5, 160], [16, 140], [15.5, 128]],
  ],
  // Dorsal ancho asomando bajo la axila (se ve de frente).
  back: [[[34.2, 104], [38.8, 100.5], [38.2, 112], [36.2, 125], [33.4, 137], [33, 126], [33.6, 114]]],
  quads: [
    [[28, 196], [36.5, 193], [39.5, 204], [38.5, 226], [35.5, 250], [31, 270], [27, 280], [24.5, 272], [25.5, 246], [26.5, 220], [25.5, 204]],
    [[18, 207], [23.5, 199], [25, 208], [24.5, 230], [23.5, 252], [22, 268], [19.5, 274], [17, 264], [16, 244], [16.5, 222]],
    [[9.5, 256], [14, 246], [16.5, 256], [18, 269], [15.5, 279], [10.5, 280], [8.5, 270]],
  ],
  adductors: [[[3, 213], [9, 206], [15, 207], [15.5, 218], [13.5, 236], [9.5, 252], [6, 247], [3.8, 232]]],
  tibialis: [[[19, 299], [25, 296], [29.5, 305], [29.5, 322], [26.5, 340], [22, 356], [19.5, 362], [18.5, 345], [18, 322], [18, 307]]],
  calves: [[[8.5, 300], [13, 297.5], [15.8, 308], [15.5, 326], [12.5, 342], [9, 345], [7.3, 328], [7.2, 311]]],
};

/** Zonas de la vista posterior. */
const BACK = {
  back: [
    [[1.5, 52, C], [6.5, 52], [9, 55.5], [12, 59.5], [22, 63.5], [35, 67.5], [42, 71.5], [36, 77], [25, 84], [17, 95], [10, 108], [4.5, 119], [1.5, 122, C]],
    [[22, 95], [27, 87], [38, 80], [43.5, 84], [44, 94], [40, 100.5], [33, 104], [26, 101]],
    [[12.5, 116], [19, 101], [27, 105], [35, 107.5], [38.6, 105.5], [38.4, 114], [36, 128], [33, 144], [27, 158], [20, 167], [16, 169], [12.5, 156], [11.5, 140], [11.5, 126]],
  ],
  reardelt: [DELT_INNER],
  sidedelt: [DELT_OUTER],
  triceps: [
    [[44.5, 116], [48, 110], [51.5, 111], [52.5, 124], [52.5, 138], [51, 147], [49, 141], [46.5, 129]],
    [[53.5, 111], [57.5, 113.5], [59.8, 124], [60, 137], [57.5, 147], [54, 149], [54.8, 136], [54.8, 122]],
  ],
  forearms: [FOREARM],
  lowerback: [[[1.8, 133, C], [5.5, 130], [9, 134], [9.5, 146], [11, 160], [14, 172], [13, 182], [7, 188], [1.8, 189, C]]],
  glutes: [[[1.8, 195, C], [7, 189], [17, 185], [28, 186], [35, 191.5], [37.5, 202], [36.5, 214], [32, 224.5], [23, 230], [12, 231], [4.5, 228], [1.8, 224, C]]],
  hamstrings: [
    [[23, 236], [33, 231], [36.5, 240], [35, 256], [31.5, 272], [28, 284], [24, 288], [22.5, 276], [22.5, 258]],
    [[10.5, 236], [20.5, 235.5], [21, 254], [20.5, 272], [18.5, 286], [14, 288], [11, 278], [9.5, 258]],
  ],
  adductors: [[[3.5, 231], [8.2, 233], [9, 246], [8.5, 260], [6.2, 266], [4.5, 252], [3.5, 240]]],
  calves: [
    [[7.2, 304], [11, 296.5], [17, 296], [18.8, 307], [18, 324], [15, 340], [11.5, 349], [8.2, 339], [6.8, 320]],
    [[19.8, 300], [24, 295], [29.5, 299], [31, 311], [29.5, 326], [25, 338], [21, 343], [19.8, 328], [19.6, 312]],
  ],
};

/** Qué músculos se ven en cada vista (para pruebas y documentación). */
export const BODY_ZONES = { front: Object.keys(FRONT), back: Object.keys(BACK) };

const FIG_H = 404;
const HALF_W = 80; // media anchura de una figura con margen (manos a ±76,5)
const GAP = 14; // entre figuras
const VIEWS = [
  { id: 'front', label: 'Delante', cx: HALF_W, zones: FRONT },
  { id: 'back', label: 'Detrás', cx: HALF_W * 3 + GAP, zones: BACK },
];
const VB_W = HALF_W * 4 + GAP;
const VB = `0 -3 ${VB_W} ${FIG_H + 4}`;

const f2 = (v) => String(Math.round(v * 100) / 100);

/** Curva cerrada suave por los puntos (Catmull-Rom → Bézier cúbica), con esquinas donde p[2] = 1. */
function smoothClosed(pts) {
  const n = pts.length;
  const P = (i) => pts[((i % n) + n) % n];
  let d = `M${f2(P(0)[0])} ${f2(P(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P(i - 1); const p1 = P(i); const p2 = P(i + 1); const p3 = P(i + 2);
    const c1 = p1[2] ? p1 : [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = p2[2] ? p2 : [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f2(c1[0])} ${f2(c1[1])} ${f2(c2[0])} ${f2(c2[1])} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return `${d}Z`;
}

const place = (pts, cx, sx) => pts.map(([x, y, c]) => [cx + sx * x, y, c]);

/** Contorno completo de la silueta centrada en cx (las dos mitades en un solo trazo). */
export function outlinePath(cx = 0) {
  const right = place(OUTLINE, cx, 1);
  const left = place(OUTLINE.slice(1, -1), cx, -1).reverse();
  return smoothClosed([...right, ...left]);
}

/** Los dos lados (derecho e izquierdo reflejado) de una forma. */
function shapePaths(pts, cx) {
  return [smoothClosed(place(pts, cx, 1)), smoothClosed(place(pts, cx, -1).reverse())];
}

// ===========================================================================
// Componente
// ===========================================================================

let uidSeq = 0;

function svgEl(tag, attrs = {}, ...children) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : String(v));
  for (const c of children) if (c) el.appendChild(c);
  return el;
}
function htmlEl(tag, cls, ...children) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  for (const c of children) {
    if (c == null || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Orden de las zonas en el DOM (y del tabulador): de arriba abajo, delante y después detrás. */
const ZONE_ORDER = ['frontdelt', 'sidedelt', 'reardelt', 'chest', 'back', 'biceps', 'triceps', 'forearms', 'core',
  'lowerback', 'glutes', 'adductors', 'quads', 'hamstrings', 'tibialis', 'calves'];

/**
 * Mapa corporal interactivo.
 * @param {{ muscles?: object, onSelect?: (id:string)=>void, selected?: string|null, label?: string, compact?: boolean, inProgress?: boolean }} opts
 *   inProgress: semana en curso → lo que aún no llega al mínimo sale en gris claro («Faltan series»), no como aviso
 *   (igual que las tablas de músculos de Progreso y del panel semanal).
 * @returns {HTMLElement} div.bm con el.select(id|null, {silent}) y el.update(muscles)
 */
export function bodyMap({ muscles = {}, onSelect = null, selected = null, label = 'Mapa corporal: series de la semana por músculo', compact = false, inProgress = false } = {}) {
  const uid = ++uidSeq;
  const clipId = `bm-clip-${uid}`;
  const detailId = `bm-detail-${uid}`;
  let data = muscles || {};
  let current = null;

  const svg = svgEl('svg', {
    class: 'bm-svg', viewBox: VB, role: 'group', 'aria-label': label, 'aria-describedby': detailId,
    preserveAspectRatio: 'xMidYMid meet',
  });
  const defs = svgEl('defs');
  const clip = svgEl('clipPath', { id: clipId });
  for (const v of VIEWS) clip.appendChild(svgEl('path', { d: outlinePath(v.cx) }));
  defs.appendChild(clip);
  svg.appendChild(defs);

  // Cuerpo (base), zonas recortadas por la silueta, borde que limpia el contorno y capa de resaltado.
  const body = svgEl('g', { class: 'bm-body', 'aria-hidden': 'true' });
  for (const v of VIEWS) body.appendChild(svgEl('path', { class: 'bm-silhouette', d: outlinePath(v.cx), 'data-view': v.id }));
  const zonesG = svgEl('g', { class: 'bm-zones', 'clip-path': `url(#${clipId})` });
  const rim = svgEl('g', { class: 'bm-rim', 'aria-hidden': 'true' });
  for (const v of VIEWS) rim.appendChild(svgEl('path', { class: 'bm-rim-path', d: outlinePath(v.cx) }));
  const hl = svgEl('g', { class: 'bm-hl', 'aria-hidden': 'true' });
  svg.append(body, zonesG, rim, hl);

  /** @type {Map<string, SVGGElement>} */
  const zones = new Map();
  for (const id of ZONE_ORDER) {
    const g = svgEl('g', { class: 'bm-zone', 'data-muscle': id, role: 'button', tabindex: '0', 'aria-pressed': 'false' });
    for (const v of VIEWS) {
      for (const pts of v.zones[id] || []) {
        for (const d of shapePaths(pts, v.cx)) g.appendChild(svgEl('path', { class: 'bm-shape', d, 'data-view': v.id }));
      }
    }
    if (!g.firstChild) continue;
    zones.set(id, g);
    zonesG.appendChild(g);
  }

  const captions = htmlEl('div', 'bm-captions', ...VIEWS.map((v) => htmlEl('span', 'bm-caption', v.label)));
  captions.setAttribute('aria-hidden', 'true');
  const figure = htmlEl('div', 'bm-figure', svg, captions);

  const legend = htmlEl('ul', 'bm-legend');
  legend.setAttribute('aria-label', 'Leyenda');
  const legendCounts = {};
  const legendLabels = {};
  for (const st of STATUSES) {
    legendCounts[st] = htmlEl('span', 'bm-legend-n', '0');
    legendLabels[st] = htmlEl('span', 'bm-legend-label', inProgress && st === 'below' ? 'Faltan series' : LEGEND_LABEL[st]);
    const sw = htmlEl('span', `bm-swatch bm-swatch-${st}`);
    sw.setAttribute('aria-hidden', 'true');
    const li = htmlEl('li', 'bm-legend-item', sw, legendLabels[st], legendCounts[st]);
    li.dataset.status = st;
    legend.appendChild(li);
  }

  const detail = htmlEl('div', 'bm-detail');
  detail.id = detailId;
  detail.setAttribute('aria-live', 'polite');

  const root = htmlEl('div', `bm${compact ? ' bm-compact' : ''}${inProgress ? ' bm-in-progress' : ''}`, legend, figure, detail);

  function paintDetail() {
    detail.replaceChildren();
    if (!current) {
      detail.dataset.status = '';
      detail.appendChild(htmlEl('p', 'bm-detail-hint', 'Toca un músculo para ver sus series.'));
      return;
    }
    const e = data[current];
    const x = entryOf(e);
    const [name, sets, range, status] = detailParts(current, e);
    detail.dataset.status = x.status;
    const main = htmlEl('p', 'bm-detail-main',
      htmlEl('strong', 'bm-detail-name', name), ' · ',
      htmlEl('span', 'bm-detail-sets', sets), ' · ',
      htmlEl('span', 'bm-detail-range', range),
      status ? ' · ' : null,
      status ? htmlEl('span', `bm-detail-status bm-st-${x.status}`, status) : null);
    detail.appendChild(main);
    const hint = detailHint(e);
    if (hint) detail.appendChild(htmlEl('p', 'bm-detail-sub', hint));
  }

  function paintHighlight() {
    hl.replaceChildren();
    if (!current || !zones.has(current)) return;
    for (const p of zones.get(current).querySelectorAll('path')) {
      hl.appendChild(svgEl('path', { class: 'bm-hl-path', d: p.getAttribute('d') }));
    }
  }

  function paintZones() {
    const counts = { below: 0, in: 0, above: 0, none: 0 };
    let noneWithSets = false;
    for (const [id, g] of zones) {
      const x = entryOf(data[id]);
      counts[x.status]++;
      if (x.status === 'none' && x.sets > EPS) noneWithSets = true;
      g.dataset.status = x.status;
      g.setAttribute('aria-label', zoneAriaLabel(id, data[id]));
    }
    for (const st of STATUSES) {
      legendCounts[st].textContent = String(counts[st]);
      legendCounts[st].parentNode.classList.toggle('is-empty', counts[st] === 0);
    }
    legendLabels.none.textContent = noneWithSets ? 'Sin series u objetivo' : LEGEND_LABEL.none;
  }

  function select(id, { silent = false } = {}) {
    const next = id && zones.has(id) ? id : null;
    current = next;
    for (const [zid, g] of zones) {
      const on = zid === next;
      g.classList.toggle('is-sel', on);
      g.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    svg.classList.toggle('has-sel', !!next);
    root.dataset.selected = next || '';
    paintHighlight();
    paintDetail();
    if (next && !silent && typeof onSelect === 'function') onSelect(next);
  }

  /** Zona más cercana a un punto de la pantalla (para zonas pequeñas), dentro de un margen en unidades SVG. */
  function nearestZone(clientX, clientY, margin = 12) {
    const ctm = svg.getScreenCTM && svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    let best = null; let bestD = margin;
    for (const [id, g] of zones) {
      for (const path of g.querySelectorAll('path')) {
        let b;
        try { b = path.getBBox(); } catch { continue; }
        const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width));
        const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
        const dist = Math.hypot(dx, dy);
        if (dist < bestD) { bestD = dist; best = id; }
      }
    }
    return best;
  }

  svg.addEventListener('click', (e) => {
    const g = e.target && e.target.closest ? e.target.closest('.bm-zone') : null;
    const id = g ? g.dataset.muscle : nearestZone(e.clientX, e.clientY);
    if (id) select(id);
  });
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const g = e.target && e.target.closest ? e.target.closest('.bm-zone') : null;
    if (!g) return;
    e.preventDefault();
    select(g.dataset.muscle);
  });

  paintZones();
  select(selected, { silent: true });

  root.select = (id, opts) => select(id, opts);
  root.update = (next) => {
    data = next || {};
    paintZones();
    paintDetail();
  };
  return root;
}
