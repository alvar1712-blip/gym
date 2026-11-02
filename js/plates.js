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

// Alto relativo (respecto al disco de 25 kg) y grosor en px de cada disco: se lee de un vistazo cuál es cuál
const LOOK = { 25: [1, 22], 20: [0.9, 20], 15: [0.78, 16], 10: [0.64, 13], 5: [0.5, 11], 2.5: [0.4, 9], 1.25: [0.32, 7] };

/**
 * Geometría de los discos de UN lado, del mayor (junto al collarín) al menor, para que quepan en `avail` px:
 * si hay tantos que no caben, el grosor se reduce de forma proporcional (mínimo 3 px, y entonces se achica el hueco).
 * @returns {{ p:number, w:number, k:number }[]}  w: grosor en px; k: alto relativo (0–1)
 */
export function plateRects(perSide, { avail = 130, gap = 2 } = {}) {
  const raw = perSide.map((p) => ({ p, w: (LOOK[p] || [0.4, 9])[1], k: (LOOK[p] || [0.4, 9])[0] }));
  const need = raw.reduce((s, r) => s + r.w + gap, 0);
  const f = need > avail ? Math.max(0, (avail - raw.length * gap)) / raw.reduce((s, r) => s + r.w, 0) : 1;
  return raw.map((r) => ({ ...r, w: Math.max(3, Math.round(r.w * f * 10) / 10) }));
}

/** «2 × 25 + 5 + 1,25»: los discos iguales se agrupan (texto para el dibujo y para VoiceOver). */
export function groupPlates(perSide, fmt = (n) => String(n)) {
  const out = [];
  for (const p of perSide) {
    const last = out[out.length - 1];
    if (last && last.p === p) last.n += 1; else out.push({ p, n: 1 });
  }
  return out.map(({ p, n }) => (n > 1 ? `${n} × ${fmt(p)}` : fmt(p))).join(' + ');
}
