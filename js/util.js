// util.js — helpers puros (sin DOM ni almacenamiento). Importable desde Node para tests.

// ---------- IDs ----------
export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- Fechas (siempre fechas LOCALES 'YYYY-MM-DD'; nunca toISOString) ----------
const pad = (n) => String(n).padStart(2, '0');

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayStr(now = new Date()) {
  return toDateStr(now);
}
// Los cálculos de fechas se hacen decenas de miles de veces al abrir la app (análisis): 'YYYY-MM-DD' se lee
// cifra a cifra y la aritmética de días va en UTC (sin zona horaria; mismo resultado que con fechas locales a mediodía).
function isYmd(s) {
  if (typeof s !== 'string' || s.length !== 10) return false;
  for (let i = 0; i < 10; i++) {
    const c = s.charCodeAt(i);
    if (i === 4 || i === 7 ? c !== 45 : c < 48 || c > 57) return false;
  }
  return true;
}
function digits(s, i, n) {
  let v = 0;
  for (let k = i; k < i + n; k++) v = v * 10 + s.charCodeAt(k) - 48;
  return v;
}
/** 'YYYY-MM-DD' -> Date local a mediodía (evita problemas de cambio de hora). */
export function parseDate(str) {
  if (isYmd(str)) return new Date(digits(str, 0, 4), digits(str, 5, 2) - 1, digits(str, 8, 2), 12, 0, 0, 0);
  const [y, m, d] = String(str).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
const utcMs = (s, add = 0) => Date.UTC(digits(s, 0, 4), digits(s, 5, 2) - 1, digits(s, 8, 2) + add);
function utcStr(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export function isDateStr(str) {
  if (!isYmd(str)) return false;
  const y = digits(str, 0, 4);
  const m = digits(str, 5, 2);
  const d = digits(str, 8, 2);
  // Años < 1000 no salen igual al escribirlos (toDateStr no rellena el año): no son fechas válidas.
  if (y < 1000 || m < 1 || m > 12 || d < 1) return false;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  return d <= (m === 2 && leap ? 29 : MONTH_DAYS[m - 1]);
}
export function addDays(str, n) {
  if (Number.isInteger(n) && isYmd(str)) return utcStr(utcMs(str, n));
  const d = parseDate(str);
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}
/** Días de a hasta b (b - a). */
export function diffDays(a, b) {
  if (isYmd(a) && isYmd(b)) return (utcMs(b) - utcMs(a)) / 86400000;
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
/** Día de la semana 0 = lunes … 6 = domingo. */
export function dow(str) {
  if (isYmd(str)) return (new Date(utcMs(str)).getUTCDay() + 6) % 7;
  return (parseDate(str).getDay() + 6) % 7;
}
/** Lunes de la semana de la fecha. */
export function weekStart(str) {
  return addDays(str, -dow(str));
}
export function weekDates(ws) {
  return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
}
export function dateFromTs(ts) {
  return toDateStr(new Date(ts));
}
/** Timestamp (ms) de una fecha a una hora local dada (por defecto 12:00). */
export function tsFromDate(str, h = 12, m = 0) {
  const d = parseDate(str);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
export function hhmm(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function addMonths(str, n) {
  const d = parseDate(str);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toDateStr(d);
}

export const DAY_SHORT = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const DAY_LONG = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const DAY_LETTER = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const MONTH_LONG = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Formatos:
 *  'short' → 'mar 23 sep'   'day' → '23 sep'   'full' → '23 sep 2026'
 *  'long'  → 'martes, 23 de septiembre'   'longy' → 'martes, 23 de septiembre de 2026'
 *  'num'   → '23/09/2026'
 */
export function fmtDate(str, style = 'short') {
  if (!str) return '—';
  const d = parseDate(str);
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '—'; // «ayer», «2026-13-45»: nunca «undefined NaN»
  const wd = (d.getDay() + 6) % 7;
  const dd = d.getDate();
  const m = d.getMonth();
  const y = d.getFullYear();
  switch (style) {
    case 'day': return `${dd} ${MONTH_SHORT[m]}`;
    case 'full': return `${dd} ${MONTH_SHORT[m]} ${y}`;
    case 'long': return `${DAY_LONG[wd]}, ${dd} de ${MONTH_LONG[m]}`;
    case 'longy': return `${DAY_LONG[wd]}, ${dd} de ${MONTH_LONG[m]} de ${y}`;
    case 'num': return `${pad(dd)}/${pad(m + 1)}/${y}`;
    default: return `${DAY_SHORT[wd]} ${dd} ${MONTH_SHORT[m]}`;
  }
}
/** '21–27 sep' o '29 sep – 5 oct' */
export function fmtWeekRange(ws) {
  const a = parseDate(ws);
  const b = parseDate(addDays(ws, 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
  return `${a.getDate()} ${MONTH_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTH_SHORT[b.getMonth()]}`;
}
/** 'hoy', 'ayer', 'mañana', 'hace 3 días', 'en 2 días' */
export function relDay(str, today = todayStr()) {
  const n = diffDays(today, str);
  if (n === 0) return 'hoy';
  if (n === -1) return 'ayer';
  if (n === 1) return 'mañana';
  if (n < 0) return `hace ${-n} días`;
  return `en ${n} días`;
}

// ---------- Números (entrada con coma o punto; salida es-ES) ----------
export function parseNum(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '' || s === '-' || s === '.' || s === '-.') return null;
  if (!/^-?\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
export function parseIntSafe(v) {
  const n = parseNum(v);
  return n == null ? null : Math.round(n);
}
// toLocaleString crea un formateador en cada llamada (lentísimo con miles de series al abrir la app).
const NUM_FMT = new Map();
/** 72.5 → '72,5' ; null → '—' */
export function fmtNum(n, dec = 1, minDec = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  const key = `${dec}|${minDec}`;
  let f = NUM_FMT.get(key);
  if (!f) {
    f = new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: minDec, useGrouping: true });
    NUM_FMT.set(key, f);
  }
  return f.format(n);
}
/** Para rellenar <input>: sin separador de miles, coma decimal, '' si null. */
export function numToInput(n, dec = 2) {
  if (n == null || !Number.isFinite(n)) return '';
  const r = round(n, 1 / 10 ** dec);
  return String(r).replace('.', ',');
}
export function fmtKg(n, dec = 1) {
  return n == null ? '—' : `${fmtNum(n, dec)} kg`;
}
export function fmtPct(n, dec = 0, signed = true) {
  if (n == null || !Number.isFinite(n)) return '—';
  const s = fmtNum(Math.abs(n), dec);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${signed ? sign : ''}${s} %`;
}
export function fmtSigned(n, dec = 1, unit = '') {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '±';
  return `${sign}${fmtNum(Math.abs(n), dec)}${unit ? ' ' + unit : ''}`;
}
/**
 * Tono de una diferencia comparativa (ronda 8, A4): ÚNICO camino para colorear deltas (resúmenes, panel semanal,
 * «Frente a la anterior»…). Por defecto 'neutral': subir no es «bueno» ni bajar «malo» (0 km a mitad de semana
 * no es una alerta). Solo cambia si una regla analítica existente lo determina:
 *   better: 'up'|'down'  dirección que esa regla considera mejora (p. ej. 1RM que sube) → 'good'
 *   warn:   'up'|'down'  dirección de un aviso que el analista/panel YA ha dado (p. ej. km de carrera) → 'warn'
 * El aviso solo tiñe si la diferencia va en su misma dirección (nunca un ▼ en ámbar por un aviso de subida).
 * @param {'up'|'down'|'same'|'none'|string} dir
 * @returns {'neutral'|'good'|'warn'}
 */
export function deltaTone(dir, { better = null, warn = null } = {}) {
  if (dir !== 'up' && dir !== 'down') return 'neutral';
  if (warn && dir === warn) return 'warn';
  if (better && dir === better) return 'good';
  return 'neutral';
}
export function round(n, step = 1) {
  if (n == null || !Number.isFinite(n)) return n;
  const inv = 1 / step;
  return Math.round(n * inv + Number.EPSILON) / inv;
}
export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// ---------- Duraciones y ritmos ----------
/** 3930 → '1:05:30' ; 330 → '5:30' ; −2795 → '−46:35' (un solo signo delante, nunca «-47:-35»). */
export function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return '—';
  sec = Math.round(sec);
  if (sec < 0) return `−${fmtDuration(-sec)}`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

// Tiempos de carrera y ritmos (tiempos previstos, eventos): formato estricto. Devuelven null si el dato no vale
// (null, undefined, no número, NaN, ±Infinity, ≤ 0): quien llama decide qué enseñar («Datos insuficientes»), nunca
// basura como «-47:-35» o «5:55:34 /km».
/** Ritmo más lento que se escribe como ritmo de carrera (1 h/km): a partir de ahí no es un ritmo, es un error de datos. */
export const PACE_FMT_MAX = 3600;
const posSec = (v) => (typeof v === 'number' && Number.isFinite(v) && Math.round(v) > 0 ? Math.round(v) : null);
/** Tiempo de carrera redondeado al segundo: '5:03', '29:37', '59:59' (< 1 h) o '1:00:00', '1:45:08' (sin 0 delante). */
export function fmtRaceTime(sec) {
  const s = posSec(sec);
  return s == null ? null : fmtDuration(s);
}
/** Ritmo por km redondeado al segundo: 355 → '5:55/km', 359,6 → '6:00/km'. null si no vale o si llega a 1 h/km. */
export function fmtPaceKm(secPerKm) {
  const s = posSec(secPerKm);
  if (s == null || s >= PACE_FMT_MAX) return null;
  return `${Math.floor(s / 60)}:${pad(s % 60)}/km`;
}
/**
 * Rango de tiempos, siempre de la mejor estimación (menor) a la más prudente (mayor): '29:38–34:10'. Si al redondear
 * coinciden, un solo tiempo. null si alguno no vale.
 */
export function fmtRaceRange(a, b) {
  const x = posSec(a);
  const y = posSec(b);
  if (x == null || y == null) return null;
  return x === y ? fmtDuration(x) : `${fmtDuration(Math.min(x, y))}–${fmtDuration(Math.max(x, y))}`;
}
/** Rango de ritmos: '5:55–6:20/km' (de más rápido a más lento). null si alguno no vale. */
export function fmtPaceRange(a, b) {
  const x = posSec(a);
  const y = posSec(b);
  if (x == null || y == null || Math.max(x, y) >= PACE_FMT_MAX) return null;
  if (x === y) return fmtPaceKm(x);
  const t = (s) => `${Math.floor(s / 60)}:${pad(s % 60)}`;
  return `${t(Math.min(x, y))}–${t(Math.max(x, y))}/km`;
}
/** 65 → '1 h 05 min' ; 45 → '45 min' */
export function fmtMinutes(min) {
  if (min == null || !Number.isFinite(min)) return '—';
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return `${h} h ${pad(m)} min`;
}
/**
 * Acepta 'h:mm:ss', 'mm:ss', o un número suelto (interpretado según bareUnit: 'min' | 's').
 * Devuelve segundos o null.
 */
export function parseDuration(str, bareUnit = 'min') {
  if (str == null) return null;
  const s = String(str).trim().replace(',', '.');
  if (!s) return null;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p));
    if (parts.some((p) => !Number.isFinite(p) || p < 0)) return null;
    let sec = 0;
    for (const p of parts) sec = sec * 60 + p;
    return Math.round(sec);
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(bareUnit === 'min' ? n * 60 : n);
}
/** seg/km → '5:12 /km' */
export function fmtPace(secPerKm, unit = '/km') {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  // Una hora o más (también 59:59,6 redondeado): no es un ritmo sino un error de datos; nunca «1:05:00 /km»
  if (Math.round(secPerKm) >= PACE_FMT_MAX) return '—';
  return `${fmtDuration(secPerKm)} ${unit}`;
}
export function fmtSpeed(kmh) {
  return kmh == null || !Number.isFinite(kmh) ? '—' : `${fmtNum(kmh, 1)} km/h`;
}
export function fmtKm(km, dec = 2) {
  return km == null || !Number.isFinite(km) ? '—' : `${fmtNum(km, dec)} km`;
}

// ---------- Texto ----------
export function normalize(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
export function plural(n, one, many) {
  return `${fmtNum(n, 1)} ${Math.abs(n) === 1 ? one : many}`;
}

// ---------- Colecciones ----------
export function sum(arr, fn = (x) => x) {
  let t = 0;
  for (const x of arr) {
    const v = fn(x);
    if (v != null && Number.isFinite(v)) t += v;
  }
  return t;
}
export function mean(arr, fn = (x) => x) {
  let t = 0;
  let n = 0;
  for (const x of arr) {
    const v = fn(x);
    if (v != null && Number.isFinite(v)) { t += v; n++; }
  }
  return n ? t / n : null;
}
export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}
export function sortBy(arr, ...keys) {
  return [...arr].sort((a, b) => {
    for (const k of keys) {
      const desc = typeof k === 'string' && k.startsWith('-');
      const f = typeof k === 'function' ? k : (x) => x[desc ? k.slice(1) : k];
      const va = f(a);
      const vb = f(b);
      if (va === vb) continue;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : 1) * (desc ? -1 : 1);
    }
    return 0;
  });
}
export function uniq(arr) {
  return [...new Set(arr)];
}
export function deepClone(o) {
  return o == null ? o : JSON.parse(JSON.stringify(o));
}
/** Rellena en `target` las claves que falten según `defaults` (recursivo para objetos planos). */
export function fillDefaults(target, defaults) {
  for (const [k, v] of Object.entries(defaults)) {
    if (!(k in target) || target[k] === undefined) target[k] = deepClone(v);
    else if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      fillDefaults(target[k], v);
    }
  }
  return target;
}

// ---------- Tiempo de ejecución ----------
export function debounce(fn, ms = 300) {
  let t = null;
  const d = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...args); }, ms);
  };
  d.cancel = () => { clearTimeout(t); t = null; };
  return d;
}
