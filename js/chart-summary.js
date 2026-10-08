// chart-summary.js — la frase que va encima de una gráfica (docs/PULIDO.md §12): lo que hay que entender del
// periodo que se ve, sin interpretar la gráfica a mano. PURO; nunca NaN, Infinity ni signos dobles (sin datos
// suficientes → null y la gráfica va sin frase). Pruebas: tests/unit/chart-summary.test.mjs.
//   levelSummary  → para magnitudes que suben o bajan (peso medio, 1RM estimado): «+7,5 kg desde septiembre» o, si
//                   apenas cambia, «Estable: ±0,4 kg en el periodo».
//   weeklySummary → para totales por semana (carga, km): «Media 24 km/sem · +12 % frente al periodo anterior».
import { fmtNum, MONTH_LONG, MONTH_SHORT, diffDays } from './util.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');

/** «desde septiembre» (más de ~6 semanas, mismo año), «desde septiembre de 2025» (otro año) o «desde el 5 sep». */
export function sinceText(date, today) {
  if (!date) return '';
  const days = today ? diffDays(date, today) : 999;
  const [y, m, d] = date.split('-').map(Number);
  if (days <= 45) return `desde el ${d} ${MONTH_SHORT[m - 1]}`;
  const month = MONTH_LONG[m - 1];
  return today && today.slice(0, 4) === String(y) ? `desde ${month}` : `desde ${month} de ${y}`;
}

/**
 * Cambio de nivel en el periodo: del principio al final (de la serie que manda: la media de 7 días, el 1RM estimado
 * por sesión…), con los extremos promediados (hasta 3 puntos por lado) para que un día raro no decida la frase.
 * @param {{x:string, y:number}[]} points ordenados por x
 * @param {{ from?: string|null, today: string, unit?: string, decimals?: number, stable?: number }} o
 *   stable: por debajo de este cambio se dice «Estable» con la oscilación (± la mitad del rango).
 * @returns {null|{ text: string, dir: 'up'|'down'|'flat' }}
 */
export function levelSummary(points, { from = null, today, unit = 'kg', decimals = 1, stable = 0 } = {}) {
  const pts = (points || []).filter((p) => p && isNum(p.y) && typeof p.x === 'string' && (!from || p.x >= from) && (!today || p.x <= today));
  if (pts.length < 2) return null;
  const first = pts[0];
  // Los extremos, promediados (hasta 3 puntos por lado): una sesión rara al principio o al final no decide la frase
  const k = Math.max(1, Math.min(3, Math.floor(pts.length / 3)));
  const mean = (list) => list.reduce((t, p) => t + p.y, 0) / list.length;
  const d = mean(pts.slice(-k)) - mean(pts.slice(0, k));
  const u = unit ? ` ${unit}` : '';
  if (Math.abs(d) <= stable) {
    const ys = pts.map((p) => p.y);
    const half = (Math.max(...ys) - Math.min(...ys)) / 2;
    return { text: `Estable: ±${fmtNum(half, decimals)}${u} en el periodo`, dir: 'flat' };
  }
  const r = Math.round(Math.abs(d) * 10 ** decimals) / 10 ** decimals;
  if (r === 0) return { text: `Estable: ±0${u} en el periodo`, dir: 'flat' };
  return { text: `${sign(d)}${fmtNum(r, decimals)}${u} ${sinceText(first.x, today)}`.trim(), dir: d > 0 ? 'up' : 'down' };
}

/**
 * Media semanal del periodo (solo semanas completas: la de hoy está a medias) y su cambio frente al periodo anterior
 * de la misma duración, si lo hay entero.
 * @param {{week:string, current?:boolean}[]} rows todas las semanas (de la más antigua a la actual)
 * @param {(r)=>number} get valor de una semana
 * @param {{ from: string, unit: string, decimals?: number }} o from: el lunes desde el que se ve
 * @returns {null|{ text: string, dir: 'up'|'down'|'flat'|null }}
 */
export function weeklySummary(rows, get, { from, unit, decimals = 0 } = {}) {
  const full = (rows || []).filter((r) => r && !r.current);
  const inRange = full.filter((r) => !from || r.week >= from);
  if (!inRange.length) return null;
  const val = (r) => (isNum(get(r)) ? get(r) : 0);
  const avg = inRange.reduce((t, r) => t + val(r), 0) / inRange.length;
  if (!(avg > 0)) return null;
  const base = `Media ${fmtNum(avg, decimals)}${unit ? ` ${unit}` : ''}/sem`;
  const before = full.filter((r) => from && r.week < from).slice(-inRange.length);
  if (before.length < inRange.length) return { text: base, dir: null };
  const prev = before.reduce((t, r) => t + val(r), 0) / before.length;
  if (!(prev > 0)) return { text: base, dir: null };
  const pct = Math.round(((avg - prev) / prev) * 100);
  if (pct === 0) return { text: `${base} · igual que el periodo anterior`, dir: 'flat' };
  return { text: `${base} · ${sign(pct)}${Math.abs(pct)} % frente al periodo anterior`, dir: pct > 0 ? 'up' : 'down' };
}
