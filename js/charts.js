// charts.js — gráficas SVG propias, sin librerías: funcionan sin conexión y siguen el tema oscuro.
//
//   lineChart(container, opts) / barChart(container, opts) → { update(opts), destroy(), el }
//   legend(items) → HTMLElement · periodSelector({ value, onChange, key }) → HTMLElement
//   PERIODS · periodStart() · getPeriod() / setPeriod() · COLORS
//
// Ancho = el del contenedor (ResizeObserver, redibuja al cambiar); alto = opts.height (incluye el eje X).
// Tocar o arrastrar en horizontal muestra una guía y un globo con la fecha y el valor EXACTO de cada serie
// (point.label / segment.label si existen). Tocar fuera lo oculta. touch-action: pan-y (el scroll vertical sigue).
// Las funciones puras (niceTicks, timeTicks, barAxisLabels, nearestIndex, dayNum…) se exportan para las pruebas.
import { h, segmented } from './ui.js';
import { todayStr, addDays, addMonths, isDateStr, fmtDate, fmtWeekRange, fmtNum, MONTH_SHORT } from './util.js';

// ---------------------------------------------------------------------------
// Colores (hex, iguales que los tokens de css/app.css)
// ---------------------------------------------------------------------------
export const COLORS = {
  strength: '#b8f34a', // --act-strength
  run: '#f97316', // --act-run
  bike: '#38bdf8', // --act-bike
  swim: '#818cf8', // --act-swim
  other: '#e879f9', // --act-other
  accent: '#b8f34a', // --accent
  info: '#60a5fa', // --info
  warn: '#fbbf24', // --warn
  danger: '#f87171', // --danger
  ok: '#4ade80', // --ok
  muted: '#929baa', // --muted
  grid: '#2d333d', // --border
  text: '#f3f5f7', // --text
  text2: '#c2c9d3', // --text-2
  surface: '#15181d', // --surface (fondo de las tarjetas)
  band: '#4ade80', // franja de rango objetivo (verde «ok», semitransparente)
};
const SERIES_ORDER = [COLORS.accent, COLORS.info, COLORS.run, COLORS.swim, COLORS.other, COLORS.warn];

// ---------------------------------------------------------------------------
// Periodos
// ---------------------------------------------------------------------------
export const PERIODS = [
  { id: '4w', label: '4 sem' }, { id: '3m', label: '3 meses' }, { id: '6m', label: '6 meses' },
  { id: '1y', label: '1 año' }, { id: 'all', label: 'Todo' },
];
export const DEFAULT_PERIOD = '3m';
const PERIOD_IDS = new Set(PERIODS.map((p) => p.id));
const LS_PREFIX = 'entreno.period.';
const memPeriods = new Map(); // respaldo si localStorage no está disponible (modo privado…)

/**
 * Primer día (incluido) del periodo: el mismo día hace 4 semanas / 3, 6 o 12 meses.
 * 'all' (o un id desconocido) → firstDate (primer dato) o null si no hay datos.
 */
export function periodStart(periodId, today = todayStr(), firstDate = null) {
  switch (periodId) {
    case '4w': return addDays(today, -28);
    case '3m': return addMonths(today, -3);
    case '6m': return addMonths(today, -6);
    case '1y': return addMonths(today, -12);
    default: return firstDate || null;
  }
}

/** Periodo recordado para una gráfica o pantalla (`key`); por defecto '3m'. */
export function getPeriod(key = 'global', fallback = DEFAULT_PERIOD) {
  let v = memPeriods.get(key) ?? null;
  if (!PERIOD_IDS.has(v)) {
    try { v = localStorage.getItem(LS_PREFIX + key); } catch { v = null; }
  }
  if (PERIOD_IDS.has(v)) return v;
  return PERIOD_IDS.has(fallback) ? fallback : DEFAULT_PERIOD;
}

/** Guarda el periodo elegido (localStorage con try/catch). Devuelve false si el id no es válido. */
export function setPeriod(key = 'global', id) {
  if (!PERIOD_IDS.has(id)) return false;
  memPeriods.set(key, id);
  try { localStorage.setItem(LS_PREFIX + key, id); } catch { /* sin almacenamiento: queda en memoria */ }
  return true;
}

/**
 * Segmentado «4 sem · 3 meses · 6 meses · 1 año · Todo».
 * Con `key` (opcional) toma el valor recordado y guarda cada cambio con setPeriod(key, id).
 * El elemento devuelto tiene getValue() y setValue(id) (de ui.segmented).
 */
export function periodSelector({ value, onChange = () => {}, key = null, ariaLabel = 'Periodo' } = {}) {
  let cur = PERIOD_IDS.has(value) ? value : (key ? getPeriod(key) : DEFAULT_PERIOD);
  const el = segmented({
    options: PERIODS.map((p) => ({ value: p.id, label: p.label })),
    value: cur,
    ariaLabel,
    onChange: (id) => {
      if (id === cur) return;
      cur = id;
      if (key) setPeriod(key, id);
      onChange(id);
    },
  });
  el.classList.add('chart-period');
  const set = el.setValue;
  el.setValue = (id) => { if (PERIOD_IDS.has(id)) { cur = id; set(id); } };
  return el;
}

// ---------------------------------------------------------------------------
// Utilidades puras (exportadas para pruebas)
// ---------------------------------------------------------------------------
const DAY_MS = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' → nº de día (entero, días desde 1970-01-01, sin horario de verano). */
export function dayNum(str) {
  return Math.round(Date.UTC(+str.slice(0, 4), +str.slice(5, 7) - 1, +str.slice(8, 10)) / DAY_MS);
}
/** Inversa de dayNum. */
export function dayStr(n) {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
/** Día de la semana de un nº de día: 0 = lunes … 6 = domingo. */
const dowNum = (n) => (((n + 3) % 7) + 7) % 7;

/** Índice del valor más cercano a v en un array ORDENADO de números (búsqueda binaria). -1 si está vacío. */
export function nearestIndex(arr, v) {
  const n = arr.length;
  if (!n) return -1;
  if (v <= arr[0]) return 0;
  if (v >= arr[n - 1]) return n - 1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid; else hi = mid;
  }
  return v - arr[lo] <= arr[hi] - v ? lo : hi;
}
function lowerBound(pts, d) { // primer índice con pts[i].d >= d
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pts[m].d < d) lo = m + 1; else hi = m; }
  return lo;
}

/** Ancho estimado de un texto (sin DOM): ~0,56 em por carácter. */
export function estimateText(text, size = 12) {
  return String(text).length * size * 0.56;
}

function decimalsOf(step) {
  for (let d = 0; d < 10; d++) {
    const s = step * 10 ** d;
    if (Math.abs(Math.round(s) - s) < 1e-6) return d;
  }
  return 10;
}
const snapTo = (v, dec) => Number(v.toFixed(dec)) || 0; // también convierte -0 en 0

const NICE_MANTISSAS = [1, 2, 2.5, 5];
const TIME_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600, 900, 1200, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/**
 * Marcas «redondas» del eje Y: paso ∈ {1, 2, 2,5, 5} × 10^n (o, con mode 'time', segundos redondos:
 * 5 s, 10 s, 15 s, 30 s, 1 min, 5 min…), entre minTicks y maxTicks marcas que cubren [min, max].
 * integer: solo pasos enteros (series, sesiones…). fixedMin / fixedMax: ese extremo no se redondea.
 * → { min, max, step, ticks }
 */
export function niceTicks(min, max, { maxTicks = 5, minTicks = 3, integer = false, mode = 'auto', fixedMin = false, fixedMax = false } = {}) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) { min = 0; max = 1; }
  if (min > max) [min, max] = [max, min];
  if (max - min < 1e-9) { // todos iguales: margen alrededor del valor
    const padV = min === 0 ? 1 : Math.max(Math.abs(min) * 0.02, integer ? 1 : 0);
    if (fixedMin && fixedMax) max = min + 1;
    else if (fixedMin) max = min + padV * 2;
    else if (fixedMax) min = max - padV * 2;
    else { min -= padV; max += padV; }
  }
  const span = max - min;
  let steps;
  if (mode === 'time') {
    steps = [...TIME_STEPS];
    for (let k = 2; steps[steps.length - 1] < span; k *= 2) steps.push(86400 * k);
  } else {
    const p = Math.floor(Math.log10(span / maxTicks));
    steps = [];
    for (let e = p - 1; e <= p + 2; e++) for (const m of NICE_MANTISSAS) steps.push(m * 10 ** e);
  }
  if (integer) {
    steps = steps.filter((s) => s >= 1 && Math.abs(Math.round(s) - s) < 1e-9);
    if (!steps.length) steps = [1, 2, 5, 10];
  }
  // Entre los pasos que dan minTicks–maxTicks marcas, el que menos espacio vacío deja (y, a igualdad, más marcas).
  let pick = null;
  let bestScore = Infinity;
  let firstFit = null;
  for (const step of steps) {
    const lo = fixedMin ? min : Math.floor(min / step + 1e-9) * step;
    const hi = fixedMax ? max : Math.ceil(max / step - 1e-9) * step;
    const first = Math.ceil(lo / step - 1e-9) * step;
    const count = Math.floor((hi - first) / step + 1e-9) + 1;
    if (count > maxTicks) continue;
    if (!firstFit) firstFit = { step, lo, hi };
    if (count < minTicks) continue;
    const score = (hi - lo - span) / (hi - lo || 1) + 0.05 * (maxTicks - count);
    if (score < bestScore - 1e-9) { bestScore = score; pick = { step, lo, hi }; }
  }
  if (!pick) pick = firstFit;
  if (!pick) {
    const step = steps[steps.length - 1];
    pick = { step, lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step };
  }
  let { step, lo, hi } = pick;
  const dec = decimalsOf(step);
  const ticks = [];
  const first = Math.ceil(lo / step - 1e-9) * step;
  for (let i = 0; first + i * step <= hi + step * 1e-6 && i < 50; i++) ticks.push(snapTo(first + i * step, dec));
  if (!ticks.length) ticks.push(snapTo(lo, dec), snapTo(hi, dec));
  // Mínimo de marcas: se amplía el dominio hacia arriba (o hacia abajo si el máximo está fijo).
  while (ticks.length < minTicks && !(fixedMin && fixedMax)) {
    if (!fixedMax) { hi = ticks[ticks.length - 1] + step; ticks.push(snapTo(hi, dec)); } else { lo = ticks[0] - step; ticks.unshift(snapTo(lo, dec)); }
  }
  const outMin = fixedMin ? min : Math.min(lo, ticks[0]);
  const outMax = fixedMax ? max : Math.max(hi, ticks[ticks.length - 1]);
  return { min: snapTo(outMin, Math.max(dec, 6)), max: snapTo(outMax, Math.max(dec, 6)), step, ticks };
}

// Candidatos de marcas temporales, de más densas a menos.
const TIME_CANDIDATES = [
  { u: 'd', n: 1 }, { u: 'd', n: 2 }, { u: 'w', n: 1 }, { u: 'w', n: 2 },
  { u: 'm', n: 1 }, { u: 'm', n: 2 }, { u: 'm', n: 3 }, { u: 'm', n: 6 }, { u: 'm', n: 12 },
  { u: 'm', n: 24 }, { u: 'm', n: 60 }, { u: 'm', n: 120 },
];
function monthIndexOf(str) { return +str.slice(0, 4) * 12 + (+str.slice(5, 7) - 1); }
function monthStartNum(mi) { return dayNum(`${Math.floor(mi / 12)}-${pad2((mi % 12) + 1)}-01`); }
/** Etiqueta de mes: 'sep' ; enero → el año ('2027'), para que se vea el cambio de año. */
export function monthLabel(str) {
  const m = +str.slice(5, 7) - 1;
  return m === 0 ? str.slice(0, 4) : MONTH_SHORT[m];
}
function genTimeTicks(c, d0, d1) {
  const out = [];
  if (c.u === 'd') {
    for (let d = Math.ceil(d0 / c.n) * c.n; d <= d1; d += c.n) out.push(d);
  } else if (c.u === 'w') {
    let d = d0 + ((7 - dowNum(d0)) % 7); // primer lunes >= d0
    while ((((d + 3) / 7) % c.n + c.n) % c.n !== 0) d += 7; // semanas alineadas (estables al redibujar)
    for (; d <= d1; d += 7 * c.n) out.push(d);
  } else {
    const s = dayStr(d0);
    let mi = monthIndexOf(s) + (s.endsWith('-01') ? 0 : 1);
    while (mi % c.n) mi++;
    for (let d = monthStartNum(mi); d <= d1; mi += c.n, d = monthStartNum(mi)) out.push(d);
  }
  return out;
}
const MIN_DAYS = { d: 1, w: 7, m: 28 };

/**
 * Marcas del eje X temporal entre los días d0 y d1 (dayNum) para `width` px: días o semanas ('23 sep') en
 * periodos cortos, meses ('sep'; enero = '2027') en largos. Como mucho maxTicks y sin solaparse.
 * → [{ d, label }]
 */
export function timeTicks(d0, d1, width, { measure = estimateText, maxTicks = 6, gap = 14 } = {}) {
  const span = Math.max(1, d1 - d0);
  const pxPerDay = width / span;
  for (const c of TIME_CANDIDATES) {
    if (MIN_DAYS[c.u] * c.n * pxPerDay < 18) continue;
    const ticks = genTimeTicks(c, d0, d1);
    if (!ticks.length || ticks.length > maxTicks) continue;
    const labels = ticks.map((d) => (c.u === 'm' ? monthLabel(dayStr(d)) : fmtDate(dayStr(d), 'day')));
    let fits = true;
    for (let i = 1; i < ticks.length && fits; i++) {
      const px = (ticks[i] - ticks[i - 1]) * pxPerDay;
      if (px < (measure(labels[i]) + measure(labels[i - 1])) / 2 + gap) fits = false;
    }
    if (!fits) continue;
    return ticks.map((d, i) => ({ d, label: labels[i] }));
  }
  return [{ d: d0, label: fmtDate(dayStr(d0), 'day') }];
}

/** ¿Todas las x son lunes de semanas consecutivas (o separadas por semanas enteras)? */
export function isWeekly(xs) {
  if (!xs.length || !xs.every((x) => isDateStr(x))) return false;
  const ds = xs.map(dayNum);
  if (!ds.every((d) => dowNum(d) === 0)) return false;
  for (let i = 1; i < ds.length; i++) if ((ds[i] - ds[i - 1]) % 7 !== 0 || ds[i] === ds[i - 1]) return false;
  return true;
}

/**
 * Etiquetas del eje X de las barras: [{ i, label }] (índices de barra con etiqueta).
 * - Fechas: '23 sep' en cada barra (o cada 2, empezando por la última) si caben; si no, meses ('sep', '2027')
 *   en la primera barra de cada mes, aclarando (1, 2, 3, 6, 12 meses) hasta que quepan.
 * - Texto: cada k barras, las que quepan.
 * `format(x, i)` fuerza el texto de cada barra.
 */
export function barAxisLabels(xs, plotW, { measure = estimateText, maxLabels = 6, gap = 10, format = null, labels = null } = {}) {
  const n = xs.length;
  if (!n) return [];
  const slot = plotW / n;
  const everyK = (texts) => {
    const w = Math.max(...texts.map((t) => measure(t)));
    let k = 1;
    while (k < n && (k * slot < w + gap || Math.ceil(n / k) > maxLabels)) k++;
    const out = [];
    for (let i = n - 1; i >= 0; i -= k) out.unshift({ i, label: texts[i] });
    return { k, out };
  };
  const dates = !format && xs.every((x) => isDateStr(x));
  if (!dates) {
    const texts = xs.map((x, i) => (format ? String(format(x, i)) : String(labels?.[i] ?? x)));
    return everyK(texts).out;
  }
  const day = everyK(xs.map((x) => fmtDate(x, 'day')));
  if (day.k <= 2) return day.out;
  const starts = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 ? +xs[0].slice(8, 10) <= 7 : xs[i].slice(0, 7) !== xs[i - 1].slice(0, 7)) starts.push(i);
  }
  for (const step of [1, 2, 3, 6, 12, 24, 60]) {
    const sel = starts.filter((i) => monthIndexOf(xs[i]) % step === 0);
    if (!sel.length || sel.length > maxLabels) continue;
    const texts = sel.map((i) => monthLabel(xs[i]));
    let ok = true;
    for (let j = 1; j < sel.length; j++) {
      if ((sel[j] - sel[j - 1]) * slot < (measure(texts[j]) + measure(texts[j - 1])) / 2 + gap) { ok = false; break; }
    }
    if (ok) return sel.map((i, j) => ({ i, label: texts[j] }));
  }
  return day.out;
}

/** Título del globo para una fecha: '23 sep 2026' o, en barras semanales, '21–27 sep 2026'. */
export function dateTitle(x, weekly = false) {
  if (!isDateStr(x)) return String(x ?? '');
  if (weekly) return `${fmtWeekRange(x)} ${addDays(x, 6).slice(0, 4)}`;
  return fmtDate(x, 'full');
}

// ---------------------------------------------------------------------------
// DOM común
// ---------------------------------------------------------------------------
const NS = 'http://www.w3.org/2000/svg';
const AXIS_FS = 12; // px del texto de los ejes
let uidSeq = 0;
let measureCtx;

function sv(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) { const v = attrs[k]; if (v != null && v !== false) el.setAttribute(k, v); }
  if (parent) parent.appendChild(el);
  return el;
}
function svText(parent, x, y, text, attrs = {}) {
  const t = sv('text', { x: r1(x), y: r1(y), ...attrs }, parent);
  t.textContent = text;
  return t;
}
const r1 = (v) => Math.round(v * 10) / 10;
const crisp = (v) => Math.round(v) + 0.5;

function measureText(text) {
  if (measureCtx === undefined) {
    measureCtx = null;
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        const ff = getComputedStyle(document.body || document.documentElement).fontFamily || 'system-ui, sans-serif';
        ctx.font = `${AXIS_FS}px ${ff}`;
        measureCtx = ctx;
      }
    } catch { measureCtx = null; }
  }
  return measureCtx ? measureCtx.measureText(String(text)).width : estimateText(text, AXIS_FS);
}

const defaultFormat = (v) => fmtNum(v, 2);
function validBand(b) {
  if (!b || typeof b !== 'object') return null;
  const lo = Number(b.min);
  const hi = Number(b.max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  return { ...b, min: Math.min(lo, hi), max: Math.max(lo, hi) };
}

/** Marco común: márgenes según el ancho de las etiquetas del eje Y. */
function frame(W, H, yLabels) {
  const labW = Math.max(0, ...yLabels.map((t) => measureText(t)));
  const L = Math.ceil(labW) + 10;
  const R = 10;
  const T = 10;
  const B = 24; // banda del eje X
  return { L, R, T, B, W, H, pw: Math.max(20, W - L - R), ph: Math.max(20, H - T - B), bottom: H - B };
}
function yMapper(scale, f, invert) {
  const span = scale.max - scale.min || 1;
  return (v) => {
    const t = (v - scale.min) / span;
    return invert ? f.T + t * f.ph : f.T + f.ph - t * f.ph;
  };
}
function drawYAxis(svg, scale, labels, f, yPx) {
  const g = sv('g', { class: 'chart-yaxis' }, svg);
  scale.ticks.forEach((v, i) => {
    const y = crisp(yPx(v));
    let cls = 'chart-grid';
    if (v === 0 && scale.min < 0 && scale.max > 0) cls += ' chart-zero';
    else if (Math.abs(y - 0.5 - f.bottom) < 1) cls += ' chart-base';
    sv('line', { class: cls, x1: f.L, x2: f.L + f.pw, y1: y, y2: y }, g);
    svText(g, f.L - 8, y, labels[i], { class: 'chart-ylabel', 'text-anchor': 'end', dy: '0.35em' });
  });
  return g;
}
/** Etiquetas del eje X centradas en x, sin salirse del SVG ni solaparse. */
function drawXLabels(svg, items, f, ticks = false) {
  const g = sv('g', { class: 'chart-xaxis' }, svg);
  let lastRight = -Infinity;
  for (const it of items) {
    const w = measureText(it.label);
    const cx = Math.min(Math.max(it.x, w / 2 + 1), f.W - w / 2 - 1);
    if (cx - w / 2 < lastRight + 6) continue;
    if (ticks) {
      const x = crisp(it.x);
      sv('line', { class: 'chart-tick', x1: x, x2: x, y1: f.bottom, y2: f.bottom + 4 }, g);
    }
    svText(g, cx, f.bottom + 17, it.label, { class: 'chart-xlabel', 'text-anchor': 'middle' });
    lastRight = cx + w / 2;
  }
  return g;
}
function drawBandH(svg, band, f, yPx, fmt, withLabel = true) {
  const color = band.color || COLORS.band;
  const ya = Math.min(Math.max(yPx(band.max), f.T), f.bottom);
  const yb = Math.min(Math.max(yPx(band.min), f.T), f.bottom);
  const top = Math.min(ya, yb);
  const hgt = Math.max(1, Math.abs(yb - ya));
  const g = sv('g', { class: 'chart-band' }, svg);
  const rect = sv('rect', { x: f.L, y: r1(top), width: f.pw, height: r1(hgt), class: 'chart-band-fill' }, g);
  rect.style.fill = color;
  for (const y of [top, top + hgt]) {
    const ln = sv('line', { x1: f.L, x2: f.L + f.pw, y1: crisp(y), y2: crisp(y), class: 'chart-band-edge' }, g);
    ln.style.stroke = color;
  }
  const label = withLabel ? (band.label ?? `${fmt(band.min)}–${fmt(band.max)}`) : '';
  // La etiqueta se pinta al final (encima de líneas y barras, con halo del color de fondo).
  return () => {
    if (!label) return;
    const inside = hgt >= 18;
    svText(svg, f.L + 6, inside ? top + 13 : Math.max(f.T + 2, top - 5), label, { class: 'chart-band-label' });
  };
}
function dotsPath(pts) {
  let d = '';
  for (const p of pts) d += `M${r1(p[0])} ${r1(p[1])}h0.01`;
  return d;
}

// ---------------------------------------------------------------------------
// Núcleo: contenedor, redimensionado, toque/arrastre, globo y destroy
// ---------------------------------------------------------------------------
function createChart(container, initialOpts, spec) {
  let opts = { ...initialOpts };
  let alive = true;
  let width = 0;
  let model = null;
  let selKey = null;
  let gesture = null;
  let holdTimer = 0;
  let raf = 0;
  let legendEl = null;

  const svg = sv('svg', { class: 'chart-svg', role: 'img', focusable: 'false' });
  const tip = h('div.chart-tip', { hidden: true, 'aria-hidden': 'true' });
  const emptyEl = h('div.chart-empty', { hidden: true });
  const plot = h('div.chart-plot', svg, tip, emptyEl);
  const root = h(`div.chart.chart--${spec.kind}`, plot);
  container.appendChild(root);

  function height() { return Math.max(80, Math.round(Number(opts.height) || 200)); }

  function paintLegend() {
    const items = spec.legendItems(opts);
    legendEl?.remove();
    legendEl = items && items.length ? legend(items) : null;
    if (legendEl) { legendEl.hidden = !model; root.appendChild(legendEl); }
  }

  function render() {
    if (!alive) return;
    const w = Math.floor(plot.clientWidth);
    if (!w) return; // aún sin maquetar: el ResizeObserver volverá a llamar
    width = w;
    const H = height();
    svg.replaceChildren();
    svg.setAttribute('width', w);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${w} ${H}`);
    svg.style.height = `${H}px`;
    model = spec.draw(svg, opts, w, H);
    const empty = !model;
    svg.toggleAttribute('hidden', empty);
    emptyEl.hidden = !empty;
    emptyEl.style.height = `${H}px`;
    emptyEl.textContent = opts.empty || 'Sin datos en este periodo';
    svg.setAttribute('aria-label', opts.ariaLabel || (model ? model.aria : '') || 'Gráfica');
    if (legendEl) legendEl.hidden = empty;
    root.classList.toggle('chart-is-empty', empty);
    if (model) {
      model.hover = sv('g', { class: 'chart-hover' }, svg);
      if (selKey != null) {
        const s = model.select(selKey);
        if (s) showSel(s); else hide();
      } else tip.hidden = true;
    } else hide();
  }

  function showSel(s) {
    selKey = s.key;
    model.hover.replaceChildren();
    model.hoverUnder?.replaceChildren();
    s.draw(model.hover, model.hoverUnder || model.hover);
    tip.replaceChildren(
      h('div.chart-tip-title', s.title),
      ...s.rows.map((r) => h('div.chart-tip-row', { class: r.strong ? 'chart-tip-total' : '' },
        r.kind === 'none' ? null : h(`span.chart-key.chart-key-${r.kind || 'line'}`, { style: { color: r.color } }),
        h('span.chart-tip-val', r.value),
        r.name ? h('span.chart-tip-name', r.name) : null)),
      ...(s.notes || []).filter((t) => t != null && t !== '').map((t) => h('div.chart-tip-note', String(t))));
    tip.hidden = false;
    const W = plot.clientWidth;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    // Al lado de la guía si cabe; si no, centrado y arriba o abajo, donde no tape los puntos marcados.
    let left = s.gx + 14;
    let top = 4;
    if (left + tw > W - 2) left = s.gx - 14 - tw;
    if (left < 2) {
      left = Math.max(2, Math.min(W - tw - 2, s.gx - tw / 2));
      const ys = s.marksY || [];
      const low = Math.max(4, (s.plotBottom ?? height()) - th - 4);
      const hitsTop = ys.filter((y) => y < top + th + 8).length;
      const hitsLow = ys.filter((y) => y > low - 8).length;
      if (hitsTop && hitsLow < hitsTop) top = low;
    }
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    root.classList.add('chart-active');
  }
  function hide() {
    selKey = null;
    model?.hover?.replaceChildren();
    model?.hoverUnder?.replaceChildren();
    tip.hidden = true;
    root.classList.remove('chart-active');
  }
  function pick(clientX) {
    if (!model) return;
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;
    const px = (clientX - rect.left) * (width / rect.width);
    const s = model.hit(px);
    if (s && !(s.key === selKey && !tip.hidden)) showSel(s); // mismo punto: no se rehace el globo
  }

  // Toque: tocar (al levantar), mantener pulsado o arrastrar en horizontal. Ratón: al pasar por encima.
  function onDown(e) {
    if (!model) return;
    clearTimeout(holdTimer);
    if (e.pointerType === 'mouse') {
      if (e.button !== 0) return;
      gesture = { id: e.pointerId, mouse: true };
      try { plot.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      pick(e.clientX);
      return;
    }
    gesture = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, scrub: false };
    const g = gesture;
    holdTimer = setTimeout(() => { if (gesture === g) { g.scrub = true; pick(g.x); } }, 180);
  }
  function onMove(e) {
    if (!model) return;
    if (e.pointerType === 'mouse') { if (!gesture || gesture.mouse) pick(e.clientX); return; }
    if (!gesture || e.pointerId !== gesture.id) return;
    gesture.x = e.clientX;
    if (!gesture.scrub) {
      const dx = Math.abs(e.clientX - gesture.x0);
      const dy = Math.abs(e.clientY - gesture.y0);
      if (dx > 6 && dx > dy) { gesture.scrub = true; clearTimeout(holdTimer); }
    }
    if (gesture.scrub) pick(e.clientX);
  }
  function onUp(e) {
    if (!gesture || e.pointerId !== gesture.id) return;
    clearTimeout(holdTimer);
    if (!gesture.mouse) pick(e.clientX); // el globo se queda visible al levantar el dedo
    gesture = null;
  }
  function onCancel(e) { // el navegador empezó a desplazar la página (pan-y)
    if (!gesture || e.pointerId !== gesture.id) return;
    clearTimeout(holdTimer);
    gesture = null;
    hide();
  }
  function onLeave(e) { if (e.pointerType === 'mouse' && !gesture) hide(); }
  function onDocDown(e) { if (!plot.contains(e.target)) hide(); } // fuera del área de dibujo (también la leyenda)

  plot.addEventListener('pointerdown', onDown);
  plot.addEventListener('pointermove', onMove);
  plot.addEventListener('pointerup', onUp);
  plot.addEventListener('pointercancel', onCancel);
  plot.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointerdown', onDocDown, true);

  function schedule() {
    if (raf || !alive) return;
    raf = requestAnimationFrame(() => { raf = 0; if (Math.floor(plot.clientWidth) !== width) render(); });
  }
  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { if (alive && Math.floor(plot.clientWidth) !== width) render(); })
    : null;
  if (ro) ro.observe(plot); else window.addEventListener('resize', schedule);

  paintLegend();
  render();

  return {
    el: root,
    update(next = {}) {
      if (!alive) return;
      opts = { ...opts, ...next };
      hide();
      paintLegend();
      render();
    },
    destroy() {
      if (!alive) return;
      alive = false;
      clearTimeout(holdTimer);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('pointerdown', onDocDown, true);
      plot.removeEventListener('pointerdown', onDown);
      plot.removeEventListener('pointermove', onMove);
      plot.removeEventListener('pointerup', onUp);
      plot.removeEventListener('pointercancel', onCancel);
      plot.removeEventListener('pointerleave', onLeave);
      model = null;
      root.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Leyenda
// ---------------------------------------------------------------------------
/**
 * items: [{ key?, label, color, kind?: 'rect' (defecto) | 'line' | 'dashed' | 'dot' | 'band' }]
 * El texto va en color de texto; la identidad la lleva la marca de color.
 */
export function legend(items = []) {
  return h('div.chart-legend', { role: 'list' },
    items.filter((it) => it && it.label).map((it) => h('span.chart-legend-item', { role: 'listitem', dataset: { key: it.key ?? '' } },
      h(`span.chart-key.chart-key-${it.kind || 'rect'}`, { style: { color: it.color || COLORS.muted } }),
      h('span.chart-legend-label', String(it.label)))));
}

// ---------------------------------------------------------------------------
// Gráfica de líneas (escala temporal real)
// ---------------------------------------------------------------------------
/**
 * opts = {
 *   series: [{ id, label, color, points:[{ x:'YYYY-MM-DD', y:number|null, label?:string }],
 *              line?:true, dots?:bool (defecto: sí si hay ≤ 24 puntos a la vista), width?:2, dashed?:false,
 *              emphasis?:false, opacity?, hidden? }],
 *   height: 200, yFormat(v) → texto (globo y eje), yTickFormat?(v) (solo eje), xLabel?(x) → título del globo,
 *   xDomain?: [from|null, to|null], yMin?, yMax?, zeroBased?: false, invertY?: false,
 *   yTicks?: 'auto' | 'time' (segundos redondos) | number[],
 *   band?: { min, max, label?, color? }, legend?: true | false | items (defecto: automática con ≥ 2 series),
 *   empty: 'Sin datos en este periodo', ariaLabel }
 * y:null corta la línea. Con alguna serie emphasis, las demás se atenúan.
 */
export function lineChart(container, opts = {}) {
  return createChart(container, opts, { kind: 'line', draw: drawLine, legendItems: lineLegendItems });
}

function lineLegendItems(o) {
  if (o.legend === false) return null;
  if (Array.isArray(o.legend)) return o.legend;
  const series = (o.series || []).filter((s) => s && !s.hidden && s.label);
  if (o.legend !== true && series.length < 2) return null;
  return series.map((s, i) => ({
    key: s.id, label: s.label, color: s.color || SERIES_ORDER[i % SERIES_ORDER.length],
    kind: s.line === false ? 'dot' : s.dashed ? 'dashed' : 'line',
  }));
}

function prepSeries(series) {
  const out = [];
  (series || []).forEach((s, si) => {
    if (!s || s.hidden || !Array.isArray(s.points)) return;
    const pts = [];
    for (const p of s.points) {
      if (!p || !isDateStr(p.x)) continue;
      const y = typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : null;
      pts.push({ d: dayNum(p.x), y, p });
    }
    pts.sort((a, b) => a.d - b.d);
    out.push({ s, si, color: s.color || SERIES_ORDER[si % SERIES_ORDER.length], pts });
  });
  return out;
}

function drawLine(svg, o, W, H) {
  const fmtY = typeof o.yFormat === 'function' ? o.yFormat : defaultFormat;
  const fmtTick = typeof o.yTickFormat === 'function' ? o.yTickFormat : fmtY;
  const list = prepSeries(o.series);

  // Dominio X: xDomain o la extensión de los datos.
  let minD = Infinity;
  let maxD = -Infinity;
  for (const P of list) for (const q of P.pts) if (q.y != null) { if (q.d < minD) minD = q.d; if (q.d > maxD) maxD = q.d; }
  if (minD === Infinity) return null;
  let d0 = isDateStr(o.xDomain?.[0]) ? dayNum(o.xDomain[0]) : minD;
  let d1 = isDateStr(o.xDomain?.[1]) ? dayNum(o.xDomain[1]) : maxD;
  if (d0 > d1) [d0, d1] = [d1, d0];

  const vis = [];
  for (const P of list) {
    const a = lowerBound(P.pts, d0);
    const b = lowerBound(P.pts, d1 + 1);
    const inside = [];
    for (let i = a; i < b; i++) if (P.pts[i].y != null) inside.push(P.pts[i]);
    if (!inside.length) continue;
    P.inside = inside;
    P.path = P.pts.slice(Math.max(0, a - 1), Math.min(P.pts.length, b + 1)); // + vecinos fuera, recortados
    vis.push(P);
  }
  if (!vis.length) return null;
  const singleDay = d1 === d0 ? d0 : null;
  if (singleDay != null) { d0 -= 3; d1 += 3; } // un único día: centrado

  // Dominio Y
  let lo = Infinity;
  let hi = -Infinity;
  let ints = true;
  for (const P of vis) for (const q of P.inside) { if (q.y < lo) lo = q.y; if (q.y > hi) hi = q.y; if (!Number.isInteger(q.y)) ints = false; }
  const band = validBand(o.band);
  if (band) { lo = Math.min(lo, band.min); hi = Math.max(hi, band.max); if (!Number.isInteger(band.min) || !Number.isInteger(band.max)) ints = false; }
  const scale = yScale(lo, hi, o, ints);
  const tickLabels = scale.ticks.map((v) => fmtTick(v));
  const f = frame(W, H, tickLabels);
  const yPx = yMapper(scale, f, !!o.invertY);
  const padX = 6;
  const x0 = f.L + padX;
  const x1 = f.L + f.pw - padX;
  const xPx = (d) => x0 + ((d - d0) / (d1 - d0)) * (x1 - x0);
  svg.dataset.l = f.L; svg.dataset.r = f.L + f.pw; svg.dataset.t = f.T; svg.dataset.b = f.bottom;
  svg.dataset.x0 = r1(x0); svg.dataset.x1 = r1(x1); svg.dataset.from = dayStr(d0); svg.dataset.to = dayStr(d1);

  drawYAxis(svg, scale, tickLabels, f, yPx);
  const bandLabel = band ? drawBandH(svg, band, f, yPx, fmtY) : null;
  const xt = singleDay != null ? [{ d: singleDay, label: fmtDate(dayStr(singleDay), 'day') }] : timeTicks(d0, d1, x1 - x0, { measure: measureText });
  drawXLabels(svg, xt.map((t) => ({ x: xPx(t.d), label: t.label })), f, true);

  // Series: primero las atenuadas, encima las destacadas.
  const clipId = `chart-clip-${++uidSeq}`;
  const defs = sv('defs', null, svg);
  const cp = sv('clipPath', { id: clipId }, defs);
  sv('rect', { x: f.L, y: f.T - 8, width: f.pw, height: f.ph + 16 }, cp);
  const gS = sv('g', { class: 'chart-series', 'clip-path': `url(#${clipId})` }, svg);
  const anyEmph = vis.some((P) => P.s.emphasis);
  const ordered = [...vis].sort((a, b) => (a.s.emphasis ? 1 : 0) - (b.s.emphasis ? 1 : 0));
  for (const P of ordered) {
    const s = P.s;
    const faded = anyEmph && !s.emphasis;
    const opacity = Number.isFinite(s.opacity) ? s.opacity : faded ? 0.5 : 1;
    const g = sv('g', { class: `chart-s${s.emphasis ? ' chart-s-emph' : ''}`, 'data-id': s.id ?? P.si, opacity: opacity < 1 ? opacity : null }, gS);
    const n = P.inside.length;
    const showLine = s.line !== false && n >= 2;
    if (showLine) {
      let d = '';
      let pen = false;
      for (const q of P.path) {
        if (q.y == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${r1(xPx(q.d))} ${r1(yPx(q.y))}`;
        pen = true;
      }
      const w = Number.isFinite(s.width) ? s.width : s.emphasis ? 3 : faded ? 1.5 : 2;
      const path = sv('path', { d, class: 'chart-line', 'stroke-width': w, 'stroke-dasharray': s.dashed ? '5 4' : null }, g);
      path.style.stroke = P.color;
    }
    const wantDots = s.dots ?? (s.line === false || n <= 24);
    if (wantDots || !showLine) {
      const spacing = (x1 - x0) / Math.max(1, n);
      const r = spacing < 4 ? 2 : spacing < 9 ? 2.5 : spacing < 18 ? 3 : 3.75;
      const pts = P.inside.map((q) => [xPx(q.d), yPx(q.y)]);
      const dd = dotsPath(pts);
      if (spacing >= 18 && showLine) sv('path', { d: dd, class: 'chart-dot-ring', 'stroke-width': r * 2 + 3 }, g);
      const dp = sv('path', { d: dd, class: 'chart-dots', 'stroke-width': r * 2 }, g);
      dp.style.stroke = P.color;
    }
    P.byDay = new Map(P.inside.map((q) => [q.d, q]));
  }
  bandLabel?.();

  // Índice para el toque: días con algún valor, ordenados (búsqueda binaria).
  const keySet = new Set();
  for (const P of vis) for (const q of P.inside) keySet.add(q.d);
  const keys = [...keySet].sort((a, b) => a - b);
  const title = (d) => { const x = dayStr(d); return typeof o.xLabel === 'function' ? String(o.xLabel(x)) : dateTitle(x); };
  const selAt = (d) => {
    const gx = xPx(d);
    const rows = [];
    const marks = [];
    for (const P of vis) {
      const q = P.byDay.get(d);
      if (!q) continue;
      rows.push({ color: P.color, kind: P.s.line === false ? 'dot' : P.s.dashed ? 'dashed' : 'line', value: q.p.label ?? fmtY(q.y), name: P.s.label || '' });
      marks.push([yPx(q.y), P.color]);
    }
    return {
      key: d, gx, title: title(d), rows, marksY: marks.map((m) => m[0]), plotBottom: f.bottom,
      draw(g) {
        const x = crisp(gx);
        sv('line', { class: 'chart-guide', x1: x, x2: x, y1: f.T, y2: f.bottom }, g);
        for (const [y, color] of marks) {
          const c = sv('circle', { class: 'chart-mark', cx: r1(gx), cy: r1(y), r: 4.5 }, g);
          c.style.fill = color;
        }
      },
    };
  };
  const total = vis.reduce((t, P) => t + P.inside.length, 0);
  const names = vis.map((P) => P.s.label).filter(Boolean).join(', ');
  return {
    aria: `Gráfica de líneas${names ? ` (${names})` : ''}: ${total} valores del ${fmtDate(dayStr(d0), 'full')} al ${fmtDate(dayStr(d1), 'full')}`,
    hit(px) {
      const d = d0 + ((px - x0) / (x1 - x0)) * (d1 - d0);
      return selAt(keys[nearestIndex(keys, d)]);
    },
    select(d) { const i = nearestIndex(keys, d); return i >= 0 && keys[i] === d ? selAt(d) : null; },
  };
}

function yScale(lo, hi, o, ints) {
  if (o.zeroBased) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const fixedMin = Number.isFinite(o.yMin);
  const fixedMax = Number.isFinite(o.yMax);
  if (fixedMin) lo = o.yMin;
  if (fixedMax) hi = o.yMax;
  if (Array.isArray(o.yTicks) && o.yTicks.length) {
    const ticks = o.yTicks.filter(Number.isFinite).sort((a, b) => a - b);
    return { min: Math.min(ticks[0], lo), max: Math.max(ticks[ticks.length - 1], hi), ticks, step: null };
  }
  return niceTicks(lo, hi, {
    integer: ints,
    mode: o.yTicks === 'time' ? 'time' : 'auto',
    fixedMin: fixedMin || (!!o.zeroBased && lo === 0),
    fixedMax,
  });
}

// ---------------------------------------------------------------------------
// Gráfica de barras (apiladas o agrupadas)
// ---------------------------------------------------------------------------
/**
 * opts = {
 *   bars: [{ x:'YYYY-MM-DD' | 'texto', label?: nombre de la barra (título del globo; eje en barras de texto),
 *            segments:[{ key, value, color?, label?: valor exacto ya formateado, name?: nombre }],
 *            tooltip?: string[] (líneas extra del globo) }],
 *   stacked: true, height: 200, yFormat(v), yTickFormat?(v), xFormat?(x, i) → etiqueta del eje, xLabel?(x, bar) → título,
 *   band?: { min, max, label?, color? } | (bar, i) => ({ min, max } | null), bandLabel?: 'Rango objetivo',
 *   overlay?: { points:[{ x, y, label? }], color?, label?, dashed? },   // se une a las barras por x
 *   legend?: [{ key, label, color, kind? }], totalLabel?: 'Total', yMin?, yMax?, yTicks?, barMax?: 24,
 *   bandColor?, overlap?: auto (agrupadas superpuestas —la mayor detrás— si no caben de lado; true/false fuerza),
 *   emptyWhenZero?: true (todo a cero → mensaje empty), empty, ariaLabel }
 * Nombre de cada segmento en el globo: segment.name, o la etiqueta de la leyenda con su key, o la key.
 * Con legend, se añaden solas la línea overlay (si tiene label) y la franja (su label o bandLabel).
 */
export function barChart(container, opts = {}) {
  return createChart(container, opts, { kind: 'bar', draw: drawBars, legendItems: barLegendItems });
}

function barLegendItems(o) {
  if (!Array.isArray(o.legend) || !o.legend.length) return null;
  const items = o.legend.map((it) => ({ kind: 'rect', ...it }));
  const ov = o.overlay;
  if (ov && ov.label && !items.some((it) => it.label === ov.label)) {
    items.push({ key: '__overlay', label: ov.label, color: ov.color || COLORS.text, kind: ov.dashed ? 'dashed' : 'line' });
  }
  const bc = typeof o.band === 'function' ? null : validBand(o.band);
  const bl = typeof o.band === 'function' ? (o.bandLabel ?? 'Rango objetivo')
    : bc ? (bc.label ?? o.bandLabel ?? 'Rango objetivo') : null;
  if (bl && !items.some((it) => it.label === bl)) {
    items.push({ key: '__band', label: bl, color: (bc && bc.color) || o.bandColor || COLORS.band, kind: 'band' });
  }
  return items;
}

function barPathUp(x, top, w, hgt, r) {
  r = Math.max(0, Math.min(r, hgt, w / 2));
  const b = top + hgt;
  if (r < 0.3) return `M${r1(x)} ${r1(top)}h${r1(w)}V${r1(b)}H${r1(x)}Z`;
  return `M${r1(x)} ${r1(b)}V${r1(top + r)}Q${r1(x)} ${r1(top)} ${r1(x + r)} ${r1(top)}H${r1(x + w - r)}`
    + `Q${r1(x + w)} ${r1(top)} ${r1(x + w)} ${r1(top + r)}V${r1(b)}Z`;
}
function barPathDown(x, top, w, hgt, r) {
  r = Math.max(0, Math.min(r, hgt, w / 2));
  const b = top + hgt;
  if (r < 0.3) return `M${r1(x)} ${r1(top)}h${r1(w)}V${r1(b)}H${r1(x)}Z`;
  return `M${r1(x)} ${r1(top)}V${r1(b - r)}Q${r1(x)} ${r1(b)} ${r1(x + r)} ${r1(b)}H${r1(x + w - r)}`
    + `Q${r1(x + w)} ${r1(b)} ${r1(x + w)} ${r1(b - r)}V${r1(top)}Z`;
}

function drawBars(svg, o, W, H) {
  const bars = (o.bars || []).filter((b) => b && b.x != null);
  if (!bars.length) return null;
  const fmtY = typeof o.yFormat === 'function' ? o.yFormat : defaultFormat;
  const fmtTick = typeof o.yTickFormat === 'function' ? o.yTickFormat : fmtY;
  const stacked = o.stacked !== false;
  const legendMap = new Map((o.legend || []).map((it) => [it.key, it]));
  const n = bars.length;
  const segsOf = (b) => (Array.isArray(b.segments) ? b.segments : []).filter((s) => s && typeof s.value === 'number' && Number.isFinite(s.value));

  const bandFn = typeof o.band === 'function' ? o.band : null;
  const bandC = bandFn ? null : validBand(o.band);
  const bands = bars.map((b, i) => (bandFn ? validBand(bandFn(b, i)) : null));
  const ovMap = new Map();
  if (o.overlay && Array.isArray(o.overlay.points)) {
    for (const p of o.overlay.points) if (p && typeof p.y === 'number' && Number.isFinite(p.y)) ovMap.set(String(p.x), p);
  }

  let lo = 0;
  let hi = 0;
  let ints = true;
  let any = false;
  for (const b of bars) {
    let pos = 0;
    let neg = 0;
    for (const s of segsOf(b)) {
      if (s.value !== 0) any = true;
      if (!Number.isInteger(s.value)) ints = false;
      if (stacked) { if (s.value > 0) pos += s.value; else neg += s.value; } else { pos = Math.max(pos, s.value); neg = Math.min(neg, s.value); }
    }
    hi = Math.max(hi, pos);
    lo = Math.min(lo, neg);
  }
  for (const bd of [bandC, ...bands]) {
    if (!bd) continue;
    hi = Math.max(hi, bd.max); lo = Math.min(lo, bd.min);
    if (!Number.isInteger(bd.min) || !Number.isInteger(bd.max)) ints = false;
  }
  const ovUsed = bars.map((b) => ovMap.get(String(b.x)) || null);
  for (const p of ovUsed) {
    if (!p) continue;
    any = true;
    hi = Math.max(hi, p.y); lo = Math.min(lo, p.y);
    if (!Number.isInteger(p.y)) ints = false;
  }
  if (!any && o.emptyWhenZero !== false) return null;

  const scale = yScale(lo, hi, { ...o, zeroBased: true }, ints);
  const tickLabels = scale.ticks.map((v) => fmtTick(v));
  const f = frame(W, H, tickLabels);
  const yPx = yMapper(scale, f, false);
  const slot = f.pw / n;
  const cx = (i) => f.L + slot * (i + 0.5);
  svg.dataset.l = f.L; svg.dataset.r = f.L + f.pw; svg.dataset.t = f.T; svg.dataset.b = f.bottom; svg.dataset.n = n;

  drawYAxis(svg, scale, tickLabels, f, yPx);
  const hasLegend = Array.isArray(o.legend) && o.legend.length > 0;
  const bandLabel = bandC ? drawBandH(svg, bandC, f, yPx, fmtY, !hasLegend) : null;

  const barMax = Number.isFinite(o.barMax) ? o.barMax : 24;
  const maxSegs = Math.max(1, ...bars.map((b) => segsOf(b).length));
  let k = stacked ? 1 : maxSegs;
  let innerGap = k > 1 ? (slot > 16 ? 2 : 1) : 0;
  let groupW = Math.max(1, Math.min(slot * (stacked ? 0.62 : 0.8), slot - 2, k * barMax + (k - 1) * innerGap));
  let subW = Math.max(0.8, (groupW - (k - 1) * innerGap) / k);
  // Agrupadas demasiado estrechas (p. ej. 53 semanas × 2): superpuestas, la mayor detrás.
  const overlap = !stacked && maxSegs > 1 && (o.overlap === true || (o.overlap !== false && subW < 3));
  if (overlap) {
    k = 1; innerGap = 0;
    groupW = Math.max(1, Math.min(slot * 0.62, slot - 2, barMax));
    subW = groupW;
  }
  const radius = Math.min(4, subW / 2);

  // Franja por barra (rango objetivo que cambia con el tiempo): un único path.
  if (bandFn) {
    const color = o.bandColor || COLORS.band;
    let fill = '';
    let edge = '';
    for (let i = 0; i < n;) {
      const bd = bands[i];
      let j = i + 1;
      if (bd) while (j < n && bands[j] && bands[j].min === bd.min && bands[j].max === bd.max) j++;
      if (bd) {
        const top = Math.min(yPx(bd.max), yPx(bd.min));
        const hgt = Math.max(1, Math.abs(yPx(bd.min) - yPx(bd.max)));
        const x = f.L + slot * i;
        const w = slot * (j - i);
        fill += `M${r1(x)} ${r1(top)}h${r1(w)}v${r1(hgt)}h${r1(-w)}Z`;
        edge += `M${r1(x)} ${crisp(top)}h${r1(w)}M${r1(x)} ${crisp(top + hgt)}h${r1(w)}`;
      }
      i = j;
    }
    const g = sv('g', { class: 'chart-band' }, svg);
    const pf = sv('path', { d: fill, class: 'chart-band-fill' }, g);
    pf.style.fill = color;
    const pe = sv('path', { d: edge, class: 'chart-band-edge' }, g);
    pe.style.stroke = color;
  }

  // Barras: un path por color (pocos nodos aunque haya 52 semanas × 5 tipos).
  const byColor = new Map();
  const layered = []; // superpuestas: por orden de pintado (rango 0 = detrás), un path por (rango, color)
  let layer = 0;
  const add = (color, d) => {
    if (!overlap) { byColor.set(color, (byColor.get(color) || '') + d); return; }
    const key = `${layer}|${color}`;
    const hit = layered.find((e) => e.key === key);
    if (hit) hit[1] += d; else layered.push(Object.assign([color, d], { key, layer }));
  };
  const colorOf = (s, j) => s.color || legendMap.get(s.key)?.color || SERIES_ORDER[j % SERIES_ORDER.length];
  const y0 = yPx(0);
  bars.forEach((b, i) => {
    const segs = segsOf(b);
    if (stacked) {
      const x = cx(i) - groupW / 2;
      const up = segs.map((s, j) => [s, j]).filter(([s]) => s.value > 0);
      const down = segs.map((s, j) => [s, j]).filter(([s]) => s.value < 0);
      let base = 0;
      up.forEach(([s, j], idx) => {
        const yb = yPx(base);
        const yt = yPx(base + s.value);
        base += s.value;
        let top = yt;
        let hgt = Math.max(1, yb - yt);
        if (hgt === 1) top = yb - 1;
        if (idx > 0) hgt -= Math.min(2, Math.max(0, hgt - 1)); // hueco de 2 px entre segmentos
        add(colorOf(s, j), barPathUp(x, top, groupW, hgt, idx === up.length - 1 ? radius : 0));
      });
      base = 0;
      down.forEach(([s, j], idx) => {
        const yt = yPx(base);
        const yb = yPx(base + s.value);
        base += s.value;
        let top = yt;
        let hgt = Math.max(1, yb - yt);
        if (idx > 0) { const g = Math.min(2, Math.max(0, hgt - 1)); top += g; hgt -= g; }
        add(colorOf(s, j), barPathDown(x, top, groupW, hgt, idx === down.length - 1 ? radius : 0));
      });
    } else if (overlap) {
      const order = segs.map((s, j) => [s, j]).filter(([s]) => s.value !== 0).sort((a, b) => Math.abs(b[0].value) - Math.abs(a[0].value));
      order.forEach(([s, j], idx) => {
        layer = idx;
        const w = groupW >= 8 ? groupW * Math.max(0.3, 1 - idx * 0.45) : groupW;
        const x = cx(i) - w / 2;
        const r = Math.min(4, w / 2);
        const yv = yPx(s.value);
        if (s.value > 0) add(colorOf(s, j), barPathUp(x, Math.min(yv, y0 - 1), w, Math.max(1, y0 - yv), r));
        else add(colorOf(s, j), barPathDown(x, y0, w, Math.max(1, yv - y0), r));
      });
    } else {
      const x0g = cx(i) - groupW / 2;
      segs.forEach((s, j) => {
        if (s.value === 0) return;
        const x = x0g + j * (subW + innerGap);
        const yv = yPx(s.value);
        if (s.value > 0) add(colorOf(s, j), barPathUp(x, Math.min(yv, y0 - 1), subW, Math.max(1, y0 - yv), radius));
        else add(colorOf(s, j), barPathDown(x, y0, subW, Math.max(1, yv - y0), radius));
      });
    }
  });
  const gB = sv('g', { class: 'chart-bars' }, svg);
  layered.sort((a, b) => a.layer - b.layer); // todas las capas traseras antes que las delanteras
  for (const [color, d] of (overlap ? layered : byColor)) {
    const p = sv('path', { d, class: 'chart-bar' }, gB);
    p.style.fill = color;
  }

  // Línea superpuesta (p. ej. media de 4 semanas).
  const ovColor = o.overlay?.color || COLORS.text;
  if (ovMap.size) {
    let d = '';
    let pen = false;
    const pts = [];
    ovUsed.forEach((p, i) => {
      if (!p) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${r1(cx(i))} ${r1(yPx(p.y))}`;
      pen = true;
      pts.push([cx(i), yPx(p.y)]);
    });
    const g = sv('g', { class: 'chart-overlay' }, svg);
    const pl = sv('path', { d, class: 'chart-line', 'stroke-width': 2, 'stroke-dasharray': o.overlay.dashed ? '5 4' : null }, g);
    pl.style.stroke = ovColor;
    if (slot >= 9) {
      const dd = dotsPath(pts);
      sv('path', { d: dd, class: 'chart-dot-ring', 'stroke-width': 3 * 2 + 3 }, g);
      const dp = sv('path', { d: dd, class: 'chart-dots', 'stroke-width': 3 * 2 }, g);
      dp.style.stroke = ovColor;
    }
  }

  bandLabel?.();

  // Eje X
  const xs = bars.map((b) => String(b.x));
  const labels = barAxisLabels(xs, f.pw, {
    measure: measureText,
    format: typeof o.xFormat === 'function' ? (x, i) => o.xFormat(bars[i].x, i) : null,
    labels: bars.map((b) => b.label ?? b.x),
  });
  drawXLabels(svg, labels.map((l) => ({ x: cx(l.i), label: l.label })), f, false);

  // Globo
  const weekly = isWeekly(xs);
  const selAt = (i) => {
    const b = bars[i];
    const segs = segsOf(b);
    const nz = segs.map((s, j) => [s, j]).filter(([s]) => s.value !== 0);
    const rows = [];
    const nameOf = (s) => s.name ?? legendMap.get(s.key)?.label ?? String(s.key ?? '');
    if (stacked && nz.length > 1) {
      rows.push({ kind: 'none', value: fmtY(nz.reduce((t, [s]) => t + s.value, 0)), name: o.totalLabel ?? 'Total', strong: true });
    }
    const ordered = stacked ? [...nz].reverse() : nz; // apiladas: de arriba abajo, como se ven
    for (const [s, j] of ordered) rows.push({ kind: 'rect', color: colorOf(s, j), value: s.label ?? fmtY(s.value), name: nameOf(s) });
    if (!nz.length) {
      const s0 = segs[0];
      rows.push({ kind: 'none', value: s0?.label ?? fmtY(0), name: segs.length === 1 ? nameOf(s0) : (o.totalLabel ?? 'Total') });
    }
    const ov = ovUsed[i];
    if (ov) rows.push({ kind: o.overlay.dashed ? 'dashed' : 'line', color: ovColor, value: ov.label ?? fmtY(ov.y), name: o.overlay.label || '' });
    const bd = bandFn ? bands[i] : bandC;
    if (bd) rows.push({ kind: 'band', color: bd.color || o.bandColor || COLORS.band, value: `${fmtY(bd.min)}–${fmtY(bd.max)}`, name: bd.label ?? o.bandLabel ?? 'Rango objetivo' });
    const t = typeof o.xLabel === 'function' ? String(o.xLabel(b.x, b)) : (b.label != null ? String(b.label) : dateTitle(b.x, weekly));
    const gx = cx(i);
    return {
      key: i, gx, title: t, rows, notes: Array.isArray(b.tooltip) ? b.tooltip : [],
      draw(g, under) {
        const pad = Math.min(4, slot * 0.1);
        sv('rect', { class: 'chart-guide chart-guide-col', x: r1(f.L + slot * i + pad), y: f.T - 4, width: r1(Math.max(1, slot - pad * 2)), height: f.ph + 4, rx: Math.min(4, slot / 4) }, under);
        if (ov) {
          const c = sv('circle', { class: 'chart-mark', cx: r1(gx), cy: r1(yPx(ov.y)), r: 4.5 }, g);
          c.style.fill = ovColor;
        }
      },
    };
  };
  // la columna resaltada va debajo de las barras
  const hoverUnder = sv('g', { class: 'chart-hover-under' });
  svg.insertBefore(hoverUnder, gB);
  const first = dateTitle(bars[0].x, weekly);
  const last = dateTitle(bars[n - 1].x, weekly);
  return {
    aria: `Gráfica de barras: ${n} ${n === 1 ? 'barra' : 'barras'}${n > 1 ? `, de ${first} a ${last}` : `, ${first}`}`,
    hit(px) { return selAt(Math.min(n - 1, Math.max(0, Math.floor((px - f.L) / slot)))); },
    select(i) { return Number.isInteger(i) && i >= 0 && i < n ? selAt(i) : null; },
    hoverUnder,
  };
}
