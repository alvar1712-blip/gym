import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_EXERCISES, SEED_TEMPLATES, MUSCLES, PATTERNS, LOG_TYPES, defaultSettings, exampleWeekPatterns } from '../../js/seed.js';

const M = new Set(MUSCLES.map((m) => m.id));
const P = new Set(PATTERNS.map((p) => p.id));
const L = new Set(LOG_TYPES.map((t) => t.id));

test('biblioteca: ids únicos y campos válidos', () => {
  const ids = new Set();
  for (const e of SEED_EXERCISES) {
    assert.ok(!ids.has(e.id), `id duplicado ${e.id}`);
    ids.add(e.id);
    assert.ok(e.name, e.id);
    assert.ok(P.has(e.pattern), `${e.id}: patrón ${e.pattern}`);
    assert.ok(L.has(e.logType), `${e.id}: tipo ${e.logType}`);
    for (const m of [...e.primary, ...e.secondary]) assert.ok(M.has(m), `${e.id}: músculo ${m}`);
    assert.ok(['compound', 'isolation'].includes(e.category), e.id);
    assert.ok(['upper', 'lower', 'core', 'full'].includes(e.region), e.id);
    if (e.logType === 'cardio') assert.ok(['run', 'bike', 'swim'].includes(e.sport), `${e.id}: sport`);
    else assert.ok(e.primary.length > 0, `${e.id}: sin músculo principal`);
  }
});

test('plantillas: todos los ejercicios existen y la semana tipo apunta a plantillas reales', () => {
  const ex = new Set(SEED_EXERCISES.map((e) => e.id));
  const tpls = new Set();
  for (const t of SEED_TEMPLATES) {
    tpls.add(t.id);
    const itemIds = new Set();
    for (const it of t.items) {
      assert.ok(!itemIds.has(it.id), `ítem duplicado ${it.id}`);
      itemIds.add(it.id);
      assert.ok(ex.has(it.exerciseId), `${t.id}: ${it.exerciseId}`);
      for (const a of it.alternatives) assert.ok(ex.has(a), `${t.id}: alternativa ${a}`);
      assert.ok(it.sets >= 1);
    }
  }
  const days = exampleWeekPatterns()[0].days;
  assert.equal(days.length, 7);
  for (const d of days) if (d.kind === 'template') assert.ok(tpls.has(d.templateId));
  assert.deepEqual(days.map((d) => d.kind), ['template', 'template', 'template', 'template', 'rest', 'template', 'rest']);
});

test('ronda 8 (B2): un perfil nuevo empieza sin semana tipo (la de ejemplo no se hereda) y la de ejemplo es una copia nueva', () => {
  assert.deepEqual(defaultSettings().weekPatterns, []);
  const a = exampleWeekPatterns();
  a[0].days[0] = { kind: 'rest' };
  assert.equal(exampleWeekPatterns()[0].days[0].kind, 'template', 'cada llamada devuelve una copia');
});

test('series por músculo por defecto (REQUISITOS §10): 10–20; más alto en espalda, core y pecho; 0–X en los indirectos', () => {
  const t = defaultSettings().muscleTargets;
  for (const m of MUSCLES) {
    const r = t[m.id];
    assert.ok(Array.isArray(r) && r.length === 2 && r[0] >= 0 && r[0] <= r[1], `${m.id}: ${JSON.stringify(r)}`);
  }
  assert.deepEqual(Object.keys(t).sort(), [...M].sort(), 'un rango por cada músculo, ninguno de más');
  for (const id of ['sidedelt', 'reardelt', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves']) {
    assert.deepEqual(t[id], [10, 20], `${id}: por defecto 10–20`);
  }
  for (const id of ['back', 'core', 'chest']) {
    assert.ok(t[id][0] > 10 && t[id][1] > 20, `${id}: más alto que 10–20 en los dos extremos (${t[id].join('–')})`);
  }
  for (const id of ['frontdelt', 'forearms', 'adductors', 'tibialis', 'lowerback']) {
    assert.equal(t[id][0], 0, `${id}: trabajo indirecto, sin mínimo`);
  }
});
