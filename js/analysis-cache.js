// analysis-cache.js — caché en memoria de «tu analista» (ronda 6, fase G; docs/MEJORAS6.md). Sin store ni DOM: recibe
// la función que da las revisiones (store.revisions) y la versión de la app, para poder probarla en Node.
//
//   const cache = createAnalysisCache({ revisions: store.revisions, appVersion: store.APP_VERSION });
//   cache.get(today, () => buildAnalysis(...))   → el resultado guardado si la clave coincide; si no, lo calcula
//
// Clave = fecha + versión de la app + versión del análisis + epoch + revisión de cada almacén de DEPENDS. Si cualquiera
// cambia, se recalcula (ante la duda, recalcular). Solo la última entrada; nada se guarda en disco. El resultado es
// compartido: quien lo usa no debe modificarlo.

/** Sube si cambia lo que calcula el análisis sin cambiar la versión de la app (en la práctica, el código nuevo llega con
 * una recarga, que vacía la caché). */
export const ANALYSIS_VERSION = 1;

/**
 * Almacenes de los que depende el análisis (todos los de datos): sesiones, ejercicios, plantillas y plan (adherencia),
 * peso, check-ins, ciclo, objetivos, contexto, marcas, eventos y `meta` (ajustes: perfil, configuración del analista,
 * umbrales, semana tipo).
 */
export const DEPENDS = ['meta', 'exercises', 'templates', 'sessions', 'plan', 'bodyweight', 'checkins', 'goals', 'cycle',
  'context', 'pastRecords', 'races'];

/** Clave de la caché (texto): cambia si cambia la fecha, la versión, el epoch o la revisión de cualquier dependencia. */
export function cacheKey({ today, appVersion = '', revisions = {} }) {
  return JSON.stringify([today, appVersion, ANALYSIS_VERSION, revisions.epoch ?? null, DEPENDS.map((s) => revisions[s] ?? null)]);
}

export function createAnalysisCache({ revisions = () => ({}), appVersion = '' } = {}) {
  let entry = null;
  const stats = { hits: 0, misses: 0 };
  return {
    /**
     * El análisis de `today`: el guardado si nada cambió; si no, `compute()` (y se guarda). `revs`: las revisiones del
     * momento en que se tomaron los datos que usará `compute` (si se tomaron antes, p. ej. el `data` de Hoy): así una
     * escritura entre medias nunca deja un resultado viejo con la clave nueva (a lo sumo, un recálculo de más).
     */
    get(today, compute, revs = null) {
      const key = cacheKey({ today, appVersion, revisions: revs || revisions() });
      if (entry && entry.key === key) {
        stats.hits++;
        return entry.value;
      }
      stats.misses++;
      const value = compute();
      entry = { key, value };
      return value;
    },
    clear() { entry = null; },
    stats() { return { ...stats }; },
  };
}
