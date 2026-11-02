// plates.js — discos por lado para una carga total con barra (Fase 7). PURO.
// Supuestos explícitos (no se conoce el inventario del gimnasio): discos de 25, 20, 15, 10, 5, 2,5 y 1,25 kg en
// parejas, barra de 20 kg por defecto (se puede cambiar a 15 o 10 kg). Es una orientación para montar la barra,
// nunca un dato guardado: no toca ninguna serie.

export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
export const BARS = [20, 15, 10];

const c = (kg) => Math.round(kg * 100); // céntimos de kg: sin errores de coma flotante

/**
 * Discos de UN lado para `total` kg con una barra de `bar` kg (reparto voraz: primero los más grandes).
 * @returns {{ bar:number, total:number, perSide:number[], loaded:number, missing:number, reason:null|'below-bar'|'inexact' }}
 *  loaded: lo que realmente se monta; missing: kg totales que no se pueden montar con esos discos (≥ 0);
 *  reason: 'below-bar' (menos que la barra vacía, perSide vacío) · 'inexact' (sobra un resto) · null (exacto).
 */
export function platesPerSide(total, { bar = 20, plates = DEFAULT_PLATES } = {}) {
  const out = { bar, total, perSide: [], loaded: bar, missing: 0, reason: null };
  if (!Number.isFinite(total) || total < bar) return { ...out, reason: 'below-bar' };
  let rest = Math.floor(c(total - bar) / 2); // por debajo del reparto: nunca se monta más de lo pedido
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (rest >= c(p)) { out.perSide.push(p); rest -= c(p); }
  }
  out.loaded = (c(bar) + 2 * out.perSide.reduce((s, p) => s + c(p), 0)) / 100;
  out.missing = Math.round((total - out.loaded) * 100) / 100;
  if (out.missing > 0.001) out.reason = 'inexact';
  return out;
}
