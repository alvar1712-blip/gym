// Pruebas de la parte pura de js/bodymap.js: datos del mapa (bodyMapData), textos del detalle y geometría.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bodyMapData, detailText, detailHint, zoneAriaLabel, BODY_ZONES, STATUS_LABEL, outlinePath,
} from '../../js/bodymap.js';
import { MUSCLES, defaultSettings } from '../../js/seed.js';
import { weeklyMuscleSets } from '../../js/calc.js';
import { muscleTable } from '../../js/stats.js';

const IDS = MUSCLES.map((m) => m.id);
const settings = defaultSettings();

test('BODY_ZONES: las 16 zonas de seed.MUSCLES, ni una más (delante ∪ detrás)', () => {
  const all = new Set([...BODY_ZONES.front, ...BODY_ZONES.back]);
  assert.equal(all.size, 16);
  assert.deepEqual([...all].sort(), [...IDS].sort());
  // Las que solo se ven de un lado están en su vista; las compartidas, en las dos.
  for (const id of ['chest', 'frontdelt', 'biceps', 'core', 'quads', 'tibialis']) assert.ok(BODY_ZONES.front.includes(id), id);
  for (const id of ['back', 'reardelt', 'triceps', 'lowerback', 'glutes', 'hamstrings']) assert.ok(BODY_ZONES.back.includes(id), id);
  for (const id of ['sidedelt', 'forearms', 'adductors', 'calves']) {
    assert.ok(BODY_ZONES.front.includes(id) && BODY_ZONES.back.includes(id), id);
  }
});

test('bodyMapData: objeto de series + settings.muscleTargets → 16 músculos en orden con estado', () => {
  const d = bodyMapData({ chest: 8, back: 16, glutes: 21, core: 12, frontdelt: 0, forearms: 4 }, settings.muscleTargets);
  assert.deepEqual(Object.keys(d), IDS, 'todos los músculos, en el orden de seed.MUSCLES');
  assert.deepEqual(d.chest, { sets: 8, min: 12, max: 22, status: 'below' });
  assert.deepEqual(d.back, { sets: 16, min: 14, max: 22, status: 'in' });
  assert.deepEqual(d.glutes, { sets: 21, min: 10, max: 20, status: 'above' });
  assert.equal(d.core.status, 'in', 'justo en el mínimo = en rango');
  assert.equal(d.forearms.status, 'in', 'rango 0–10');
  assert.deepEqual(d.frontdelt, { sets: 0, min: 0, max: 12, status: 'none' }, 'sin series → none');
  assert.deepEqual(d.calves, { sets: 0, min: 10, max: 20, status: 'none' }, 'ausente = 0 series');
});

test('bodyMapData: acepta el objeto settings entero, un Map y rangos { min, max }', () => {
  const a = bodyMapData({ quads: 25 }, settings);
  assert.equal(a.quads.status, 'above');
  const b = bodyMapData(new Map([['quads', 15], ['calves', 3]]), settings);
  assert.equal(b.quads.status, 'in');
  assert.equal(b.calves.status, 'below');
  const c = bodyMapData({ biceps: 5 }, { biceps: { min: 4, max: 6 } });
  assert.deepEqual(c.biceps, { sets: 5, min: 4, max: 6, status: 'in' });
  assert.deepEqual(c.triceps, { sets: 0, min: null, max: null, status: 'none' }, 'rangos explícitos sin ese músculo → sin rango');
});

test('bodyMapData: sin rangos usa los de seed; filas con min/max usan los suyos (null = sin rango)', () => {
  const seedOnly = bodyMapData({ back: 10 });
  assert.deepEqual(seedOnly.back, { sets: 10, min: 14, max: 22, status: 'below' });
  const rows = [
    { muscleId: 'chest', sets: 9, min: 6, max: 8 },
    { muscleId: 'back', sets: 4, target: null, min: null, max: null },
    { id: 'core', sets: 3 },
  ];
  const d = bodyMapData(rows);
  assert.deepEqual(d.chest, { sets: 9, min: 6, max: 8, status: 'above' });
  assert.deepEqual(d.back, { sets: 4, min: null, max: null, status: 'none' }, 'la fila dice que no tiene rango');
  assert.deepEqual(d.core, { sets: 3, min: 12, max: 22, status: 'below' }, 'fila sin rango propio → seed');
  // Los rangos explícitos mandan sobre los de las filas.
  const e = bodyMapData(rows, { chest: [8, 12] });
  assert.equal(e.chest.status, 'in');
});

test('bodyMapData: límites con decimales, zeroAsNone y valores raros', () => {
  const r = { chest: [10, 20] };
  assert.equal(bodyMapData({ chest: 10 }, r).chest.status, 'in');
  assert.equal(bodyMapData({ chest: 20 }, r).chest.status, 'in');
  assert.equal(bodyMapData({ chest: 9.5 }, r).chest.status, 'below');
  assert.equal(bodyMapData({ chest: 20.5 }, r).chest.status, 'above');
  assert.equal(bodyMapData({ chest: 0.1 + 0.2 + 9.7 }, r).chest.status, 'in', 'errores de coma flotante');
  assert.equal(bodyMapData({ chest: 0 }, r, { zeroAsNone: false }).chest.status, 'below');
  assert.equal(bodyMapData({ frontdelt: 0 }, settings, { zeroAsNone: false }).frontdelt.status, 'in', 'rango 0–12');
  const odd = bodyMapData({ chest: -3, back: 'x', core: NaN, foo: 12 }, settings);
  assert.equal(odd.chest.sets, 0);
  assert.equal(odd.back.sets, 0);
  assert.equal(odd.core.sets, 0);
  assert.ok(!('foo' in odd), 'ids desconocidos fuera');
  assert.equal(Object.keys(bodyMapData(null)).length, 16);
  assert.equal(bodyMapData({ back: 5 }, { back: [8, null] }).back.status, 'below', 'solo mínimo');
  assert.equal(bodyMapData({ back: 50 }, { back: [8, null] }).back.status, 'in');
});

test('bodyMapData: integra en una línea lo que ya calcula la app (calc.weeklyMuscleSets y stats.muscleTable)', () => {
  const ws = '2026-09-21';
  const exercises = [
    { id: 'bench', name: 'Press banca', primary: ['chest'], secondary: ['triceps', 'frontdelt'], logType: 'weight_reps', category: 'compound' },
    { id: 'row', name: 'Remo', primary: ['back'], secondary: ['biceps', 'reardelt'], logType: 'weight_reps', category: 'compound' },
  ];
  const exMap = new Map(exercises.map((e) => [e.id, e]));
  const set = (i) => ({ id: `s${i}`, type: 'effective', weight: 60, reps: 8, rir: 2, done: true });
  const sessions = [{
    id: 'a', kind: 'strength', status: 'done', date: '2026-09-22', planDate: '2026-09-22',
    exercises: [
      { id: 'e1', exerciseId: 'bench', sets: [0, 1, 2, 3].map(set) },
      { id: 'e2', exerciseId: 'row', sets: [0, 1, 2, 3, 4, 5].map(set) },
    ],
  }];
  const weekly = weeklyMuscleSets(sessions, ws, exMap, settings);
  const a = bodyMapData(weekly, settings.muscleTargets);
  assert.deepEqual(a.chest, { sets: 4, min: 12, max: 22, status: 'below' });
  assert.equal(a.triceps.sets, 2, 'secundario × 0,5');
  assert.equal(a.back.sets, 6);
  assert.equal(a.quads.status, 'none');

  const rows = muscleTable({ sessions, exercises: exMap, settings, today: '2026-09-24', bodyweight: [] }, '2026-09-24');
  const b = bodyMapData(rows);
  for (const id of IDS) assert.deepEqual(b[id], a[id], id);
});

test('detailText / zoneAriaLabel / detailHint: textos del detalle', () => {
  const e = { sets: 8, min: 10, max: 20, status: 'below' };
  assert.equal(detailText('chest', e), 'Pecho · 8 series · objetivo 10–20 · por debajo');
  assert.equal(zoneAriaLabel('chest', e), 'Pecho: 8 series, objetivo 10–20, por debajo');
  assert.equal(detailHint(e), 'Faltan 2 series para el mínimo');
  assert.equal(detailText('triceps', { sets: 7.5, min: 10, max: 20, status: 'below' }), 'Tríceps · 7,5 series · objetivo 10–20 · por debajo');
  assert.equal(detailText('biceps', { sets: 1, min: 0, max: 10, status: 'in' }), 'Bíceps · 1 serie · objetivo 0–10 · en rango');
  assert.equal(detailText('glutes', { sets: 21, min: 10, max: 20, status: 'above' }), 'Glúteos · 21 series · objetivo 10–20 · por encima');
  assert.equal(detailHint({ sets: 21, min: 10, max: 20, status: 'above' }), '1 serie por encima del máximo');
  assert.equal(detailHint({ sets: 9, min: 10, max: 20, status: 'below' }), 'Falta 1 serie para el mínimo');
  assert.equal(detailHint({ sets: 12, min: 10, max: 20, status: 'in' }), '');
  assert.equal(detailText('calves', { sets: 0, min: 10, max: 20, status: 'none' }), 'Gemelos · 0 series · objetivo 10–20 · sin series');
  assert.equal(detailHint({ sets: 0, min: 10, max: 20, status: 'none' }), 'Faltan 10 series para el mínimo');
  assert.equal(detailHint({ sets: 0, min: 0, max: 12, status: 'none' }), '');
  assert.equal(detailText('back', { sets: 4, min: null, max: null, status: 'none' }), 'Espalda · 4 series · sin objetivo', 'sin rango: no repite');
  assert.equal(zoneAriaLabel('back', { sets: 4, min: null, max: null, status: 'none' }), 'Espalda: 4 series, sin objetivo');
  assert.equal(detailText('core', undefined), 'Core / abdomen · 0 series · sin objetivo · sin series', 'entrada ausente');
  assert.equal(detailText('core', { sets: 14, min: 12, max: 22 }), 'Core / abdomen · 14 series · objetivo 12–22 · en rango', 'sin estado: se calcula');
  assert.equal(detailText('chest', { sets: 3, min: 5, max: null, status: 'below' }), 'Pecho · 3 series · objetivo ≥ 5 · por debajo');
  assert.equal(detailText('chest', { sets: 3, min: 5, max: 9, status: 'rara', name: 'Pectoral' }), 'Pectoral · 3 series · objetivo 5–9 · por debajo', 'estado desconocido: se calcula; name manda');
  assert.deepEqual(STATUS_LABEL, { below: 'por debajo', in: 'en rango', above: 'por encima', none: 'sin series' });
});

test('outlinePath: trazo cerrado con números finitos y simétrico', () => {
  const d = outlinePath(100);
  assert.match(d, /^M[\d.]+ [\d.]+C/);
  assert.ok(d.endsWith('Z'));
  const nums = d.match(/-?[\d.]+/g).map(Number);
  assert.ok(nums.every(Number.isFinite));
  const xs = nums.filter((_, i) => i % 2 === 0);
  assert.ok(Math.abs(Math.min(...xs) - 100 + (Math.max(...xs) - 100)) < 0.5, 'mismo ancho a cada lado del eje');
});
