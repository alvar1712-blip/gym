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

/**
 * Una sola curva suave por los puntos `pts` ([x, y] en px): cúbicas de Bézier (Catmull-Rom uniforme pasado a Bézier), con la
 * tangente continua en cada unión (los dos manejadores de un punto son colineales): ni esquinas ni tramos rectos pegados.
 * Con 2 puntos es una recta; los extremos se repiten para que la curva empiece y acabe en ellos.
 */
export function smoothPath(pts) {
  const at = (i) => pts[Math.min(pts.length - 1, Math.max(0, i))];
  const xy = (q) => `${f1(q[0])} ${f1(q[1])}`;
  let d = `M${xy(pts[0])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${xy(c1)} ${xy(c2)} ${xy(p2)}`;
  }
  return d;
}

/**
 * Cima de la masa por filas: el trazado deja encima de la cabeza unas filas estrechísimas (una aguja de 2-4 px). Aquí se
 * descartan las filas de arriba más estrechas que `minW` px y la cima se cierra con un semicírculo del ancho del cuerpo.
 * Si la masa ya llega al borde superior, no toca nada. Devuelve a y b nuevos.
 */
export function roundTop(a, b, W, H, minW = 0.03 * W) {
  const n = a.length;
  const dy = H / n;
  const wpx = (k) => ((b[k] - a[k]) / 1000) * W;
  let k0 = 0;
  while (k0 < n && wpx(k0) < minW) k0++;
  if (k0 === 0 || k0 >= n) return { a, b };
  const A = a.slice();
  const B = b.slice();
  for (let k = 0; k < k0; k++) A[k] = B[k] = (a[k0] + b[k0]) / 2;
  let body = 0;
  for (let k = k0; k < Math.min(n, k0 + 8); k++) body = Math.max(body, wpx(k));
  if (body > 0.3 * W) return { a: A, b: B }; // masa ancha (o el botón): su cima ya es una cúpula, solo sobraba la aguja
  const R = Math.min(body / 2, 36);
  for (let k = k0; k < n; k++) {
    const d = (k + 0.5) * dy - k0 * dy;
    if (d >= R) break;
    const cap = ((body - 2 * R + 2 * R * Math.sqrt(Math.max(0, 1 - (1 - d / R) ** 2))) / W) * 1000; // esquinas de radio R
    if (b[k] - a[k] > cap) { const m = (a[k] + b[k]) / 2; A[k] = m - cap / 2; B[k] = m + cap / 2; }
  }
  return { a: A, b: B };
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
