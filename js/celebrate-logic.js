// celebrate-logic.js — qué se dice al terminar una sesión. PURO (sin DOM ni store): se prueba en Node
// (tests/unit/celebrate.test.mjs). La animación está en celebrate.js.

/** Mensajes de felicitación: cortos y sin sermones. */
export const MESSAGES = ['¡Buen trabajo!', '¡Bien hecho!', '¡Gran esfuerzo!', '¡Así se hace!'];

/**
 * Ejercicios cuyos récords se destacan al terminar (por id, no por nombre: renombrar un ejercicio no lo saca de la
 * lista). El orden es la prioridad si en la misma sesión hay varios. Los accesorios (laterales, face pull, curl, crunch…)
 * NUNCA disparan el mensaje de récord; sus marcas siguen en Progreso y en el resumen. Selección inicial, deliberadamente
 * corta: los cuatro básicos y la variante supina de las dominadas (mismo movimiento; cada id lleva su propio historial,
 * así que sus marcas nunca se mezclan con las de otra variante). Press militar y remo con barra, fuera por ahora.
 * Para ampliarla basta con añadir ids aquí.
 */
export const MAIN_LIFTS = ['press_banca', 'sentadilla', 'peso_muerto', 'dominadas', 'dominadas_supinas'];

/** Mensaje distinto del último mostrado (`rand`: () => [0,1), inyectable para probar; `last`: el anterior). */
export function pickMessage(rand = Math.random, last = null) {
  const pool = MESSAGES.filter((m) => m !== last);
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

/**
 * Récord que merece destacarse, o null. `prMap`: Map(setId → récords) de calc.sessionPRs (que ya exige historial previo
 * y compara solo la misma configuración de material: la primera sesión con un ejercicio o una configuración nueva no
 * cuenta). Solo vale una marca real de fuerza: más peso o 1RM estimado más alto; en peso corporal (dominadas) también
 * más repeticiones. Un solo récord: el del ejercicio principal de la lista con más prioridad.
 * @returns {{exerciseId: string, name: string, kind: string, text: string} | null}
 */
export function mainRecord(session, prMap, exerciseOf, mainLifts = MAIN_LIFTS) {
  if (!prMap || !prMap.size) return null;
  let best = null;
  for (const se of session.exercises || []) {
    const rank = mainLifts.indexOf(se.exerciseId);
    if (rank < 0) continue;
    const ex = exerciseOf(se.exerciseId);
    if (!ex) continue;
    for (const set of se.sets || []) {
      const kinds = (prMap.get(set.id) || []).map((p) => p.kind);
      const kind = kinds.includes('e1rm') ? 'e1rm' : kinds.includes('weight') ? 'weight'
        : ex.logType === 'bodyweight' && kinds.includes('reps') ? 'reps' : null;
      if (kind && (!best || rank < best.rank)) best = { rank, exerciseId: se.exerciseId, name: ex.name || se.exerciseId, kind };
    }
  }
  if (!best) return null;
  const { rank, ...rec } = best;
  return { ...rec, text: `¡Nuevo récord en ${rec.name.toLocaleLowerCase('es')}!` };
}

// ---------------------------------------------------------------------------
// Siluetas animadas (datos en celebrate-data.js): interpolación entre fotogramas y construcción del path. Puro.
// ---------------------------------------------------------------------------

/** Fotograma interpolado de `data` ({t, a, b}) en el instante `t` (ms); antes del primero y después del último, se mantiene. */
export function frameAt(data, t) {
  const ts = data.t;
  const last = ts.length - 1;
  if (t <= ts[0]) return { a: data.a[0], b: data.b[0] };
  if (t >= ts[last]) return { a: data.a[last], b: data.b[last] };
  let i = 0;
  while (ts[i + 1] <= t) i++;
  const u = (t - ts[i]) / (ts[i + 1] - ts[i]);
  const mix = (p, q) => p.map((v, k) => v + (q[k] - v) * u);
  return { a: mix(data.a[i], data.a[i + 1]), b: mix(data.b[i], data.b[i + 1]) };
}

const f1 = (v) => (Math.round(v * 10) / 10).toString();

/**
 * Polígono cerrado por FILAS: fila k a la altura y0 + (k + ½)/n·(y1 − y0) (en alto de pantalla), de a[k] a b[k] (×1000
 * del ancho). Con `edges`, la primera y la última fila se prolongan hasta y0 e y1 (para cubrir hasta el borde).
 */
export function rowsPath(a, b, W, H, { y0 = 0, y1 = 1, edges = false } = {}) {
  const n = a.length;
  const pts = (arr) => arr.map((v, k) => [(v / 1000) * W, (y0 + ((k + 0.5) / n) * (y1 - y0)) * H]);
  const L = pts(a);
  const R = pts(b);
  if (edges) {
    L.unshift([L[0][0], y0 * H]); R.unshift([R[0][0], y0 * H]);
    L.push([L[L.length - 1][0], y1 * H]); R.push([R[R.length - 1][0], y1 * H]);
  }
  const left = L.map((p) => `${f1(p[0])} ${f1(p[1])}`);
  const right = R.map((p) => `${f1(p[0])} ${f1(p[1])}`).reverse();
  return `M${left.join('L')}L${right.join('L')}Z`;
}

/** Igual por COLUMNAS: columna k en x = (k + ½)/n, de a[k] (arriba) a b[k] (abajo), ×1000 del alto; `edges` prolonga hasta x = 0 y 1. */
export function colsPath(a, b, W, H, { edges = false } = {}) {
  const n = a.length;
  const pts = (arr) => arr.map((v, k) => [((k + 0.5) / n) * W, (v / 1000) * H]);
  const T = pts(a);
  const B = pts(b);
  if (edges) {
    T.unshift([0, T[0][1]]); B.unshift([0, B[0][1]]);
    T.push([W, T[T.length - 1][1]]); B.push([W, B[B.length - 1][1]]);
  }
  const top = T.map((p) => `${f1(p[0])} ${f1(p[1])}`);
  const bottom = B.map((p) => `${f1(p[0])} ${f1(p[1])}`).reverse();
  return `M${top.join('L')}L${bottom.join('L')}Z`;
}

/**
 * La silueta del botón (rectángulo redondeado, en px) en el mismo formato de filas que MASS: punto de partida de la masa,
 * para que el primer fotograma sea exactamente el botón. `rect`: { left, right, top, bottom }. Filas fuera del botón: ancho cero.
 */
export function pillFrame(rect, rad, W, H, n) {
  const a = new Array(n);
  const b = new Array(n);
  const cx = (rect.left + rect.right) / 2;
  let any = false;
  for (let k = 0; k < n; k++) {
    const y = ((k + 0.5) / n) * H;
    if (y >= rect.top && y <= rect.bottom) {
      const e = Math.min(y - rect.top, rect.bottom - y);
      const inset = e < rad ? rad - Math.sqrt(Math.max(0, rad * rad - (rad - e) * (rad - e))) : 0;
      a[k] = ((rect.left + inset) / W) * 1000;
      b[k] = ((rect.right - inset) / W) * 1000;
      any = true;
    } else { a[k] = b[k] = (cx / W) * 1000; }
  }
  if (!any) { // botón más bajo que una fila: la fila más cercana al centro
    const k = Math.min(n - 1, Math.max(0, Math.floor((((rect.top + rect.bottom) / 2) / H) * n)));
    a[k] = (rect.left / W) * 1000;
    b[k] = (rect.right / W) * 1000;
  }
  return { a, b };
}

/** Los datos de la masa con el botón como fotograma inicial (t = 0). */
export function withPill(data, pill) {
  return { t: [0, ...data.t], a: [pill.a, ...data.a], b: [pill.b, ...data.b] };
}
