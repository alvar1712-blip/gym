// Pruebas de la ronda 6, fase G (docs/MEJORAS6.md): caché del análisis con contadores de revisión
// (js/analysis-cache.js). Cada causa de invalidación se prueba por separado: fecha, versión, epoch y cada almacén.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisCache, cacheKey, DEPENDS, ANALYSIS_VERSION } from '../../js/analysis-cache.js';
import { STORES } from '../../js/db.js';

/** Revisiones de prueba (como store.revisions()) que se pueden subir a mano. */
function fakeRevisions() {
  const r = { epoch: 1, ...Object.fromEntries(STORES.map((s) => [s, 0])) };
  return { r, revisions: () => ({ ...r }) };
}

test('mientras no cambia nada, se reutiliza el mismo resultado (sin recalcular)', () => {
  const { revisions } = fakeRevisions();
  const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
  let n = 0;
  const compute = () => ({ n: ++n });
  const a = cache.get('2026-10-02', compute);
  const b = cache.get('2026-10-02', compute);
  assert.equal(n, 1);
  assert.equal(a, b, 'el mismo objeto');
  assert.deepEqual(cache.stats(), { hits: 1, misses: 1 });
});

test('cambiar la fecha recalcula', () => {
  const { revisions } = fakeRevisions();
  const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
  let n = 0;
  cache.get('2026-10-02', () => ++n);
  assert.equal(cache.get('2026-10-03', () => ++n), 2);
  assert.equal(cache.get('2026-10-03', () => ++n), 2);
});

test('cada almacén del que depende el análisis invalida al cambiar su revisión (alta, cambio o borrado)', () => {
  assert.deepEqual([...DEPENDS].sort(), [...STORES].sort(), 'el análisis depende de todos los almacenes de datos');
  for (const s of DEPENDS) {
    const { r, revisions } = fakeRevisions();
    const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
    let n = 0;
    cache.get('2026-10-02', () => ++n);
    r[s]++;
    assert.equal(cache.get('2026-10-02', () => ++n), 2, `${s}: recalcula`);
    assert.equal(cache.get('2026-10-02', () => ++n), 2, `${s}: y luego reutiliza`);
  }
});

test('perfil, contexto y configuración del analista: viven en meta y context, que invalidan', () => {
  const { r, revisions } = fakeRevisions();
  const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
  let n = 0;
  cache.get('2026-10-02', () => ++n);
  r.meta++; // perfil o ajustes del analista (settings)
  assert.equal(cache.get('2026-10-02', () => ++n), 2);
  r.context++; // una fase o un hecho de «Tu contexto»
  assert.equal(cache.get('2026-10-02', () => ++n), 3);
});

test('importar una copia o borrar todo (epoch) recalcula aunque los contadores coincidan', () => {
  const { r, revisions } = fakeRevisions();
  const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
  let n = 0;
  cache.get('2026-10-02', () => ++n);
  r.epoch++;
  assert.equal(cache.get('2026-10-02', () => ++n), 2);
});

test('otra versión de la app o del análisis da otra clave; clear() vacía la caché', () => {
  const revs = fakeRevisions().revisions();
  assert.notEqual(cacheKey({ today: '2026-10-02', appVersion: '1.0.0', revisions: revs }), cacheKey({ today: '2026-10-02', appVersion: '1.0.1', revisions: revs }));
  assert.ok(JSON.parse(cacheKey({ today: '2026-10-02', appVersion: '1.0.0', revisions: revs })).includes(ANALYSIS_VERSION));
  const { revisions } = fakeRevisions();
  const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
  let n = 0;
  cache.get('2026-10-02', () => ++n);
  cache.clear();
  assert.equal(cache.get('2026-10-02', () => ++n), 2);
});

test('con las revisiones del momento en que se tomaron los datos: una escritura entre medias nunca deja un resultado viejo con la clave nueva', () => {
  const { r, revisions } = fakeRevisions();
  const cache = createAnalysisCache({ revisions, appVersion: '1.0.0' });
  const taken = revisions(); // Hoy toma sus datos…
  r.sessions++; // …se guarda una serie antes de pintar la tarjeta del análisis…
  let n = 0;
  cache.get('2026-10-02', () => ({ from: 'datos viejos', n: ++n }), taken); // …y se calcula con los datos viejos
  const now = cache.get('2026-10-02', () => ({ from: 'datos nuevos', n: ++n }));
  assert.equal(now.from, 'datos nuevos', 'con las revisiones actuales no se reutiliza lo calculado con datos viejos');
  assert.equal(n, 2);
});
