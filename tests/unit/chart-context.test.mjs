// Pruebas de js/chart-context.js (ronda 8, E): qué contexto entra en cada gráfica, con qué nombre, la línea del globo,
// la descripción accesible y la caché por revisiones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextItems, chartContext, ctxLine, ctxAria, CHART_PROFILES } from '../../js/chart-context.js';
import { PHASE_TYPES, EVENT_TYPES } from '../../js/context-logic.js';

const TODAY = '2026-10-07';
let revN = 0;
const rev = () => ({ epoch: 1, context: ++revN, races: 1, sessions: 1 }); // revisiones nuevas en cada prueba
const ap = (date, precision = 'day') => ({ date, precision });
const phase = (id, type, start, end = null, text = '') => ({ id, kind: 'phase', type, start, end, text, notes: '', goalIds: [], sports: [], createdAt: 1, updatedAt: 1 });
const event = (id, type, date, extra = {}) => ({ id, kind: 'event', type, date, text: '', notes: '', kg: null, createdAt: 1, updatedAt: 1, ...extra });
const items = (context, races = [], sessions = []) => contextItems({ context, races, sessions, today: TODAY, rev: rev() });

test('nombres cortos: todos los tipos de fase y de hecho tienen `short`', () => {
  for (const t of [...PHASE_TYPES, ...EVENT_TYPES]) assert.ok(typeof t.short === 'string' && t.short.length > 0, t.id);
  assert.equal(PHASE_TYPES.find((t) => t.id === 'break').short, 'Parón');
  assert.equal(EVENT_TYPES.find((t) => t.id === 'creatine_start').short, 'Inicio creatina');
});

test('fases: día, mes y estación; abierta (to:null) y cerrada; personalizada con su texto', () => {
  const it = items([
    phase('p1', 'break', ap('2026-08-03'), ap('2026-08-20')),
    phase('p2', 'gain', ap('2026-06-01', 'month'), null),
    phase('p3', 'custom', ap('2026-06-01', 'season'), ap('2026-06-01', 'season'), 'Parón de verano'),
    phase('p4', 'creatine', ap('2026-09-01'), null, 'Algo'), // tipo desconocido → personalizada
  ]);
  const byId = Object.fromEntries(it.phases.map((p) => [p.id, p]));
  assert.deepEqual([byId.p1.from, byId.p1.to, byId.p1.name], ['2026-08-03', '2026-08-20', 'Parón']);
  assert.deepEqual([byId.p2.from, byId.p2.to, byId.p2.name], ['2026-06-01', null, 'Ganancia']);
  assert.deepEqual([byId.p3.from, byId.p3.to, byId.p3.name], ['2026-06-01', '2026-08-31', 'Parón de verano']);
  assert.equal(byId.p4.name, 'Algo');
  // La descripción de una fase de un tipo con nombre NO es su nombre
  const it2 = items([phase('p5', 'break', ap('2026-08-03'), null, 'vacaciones en la playa')]);
  assert.equal(it2.phases[0].name, 'Parón');
});

test('hechos: día (relleno, «15 sep»), mes (hueco, mitad de mes, «sep 2026»), estación y año omitidos, pesos omitidos, futuro omitido', () => {
  const it = items([
    event('e1', 'creatine_start', ap('2026-09-15')),
    event('e2', 'routine_change', ap('2026-09-01', 'month')),
    event('e3', 'holidays', ap('2026-06-01', 'season')),
    event('e4', 'illness', ap('2025-01-01', 'year')),
    event('e5', 'usual_weight', ap('2026-09-10'), { kg: 75 }),
    event('e6', 'weight', ap('2026-09-11'), { kg: 76 }),
    event('e7', 'other', ap('2026-09-20'), { text: 'Mudanza' }),
    event('e8', 'holidays', ap('2026-12-01')),
  ]);
  assert.deepEqual(it.facts.map((f) => [f.id, f.date, f.when, f.name, f.hollow]), [
    ['e1', '2026-09-15', '15 sep', 'Inicio creatina', false],
    ['e2', '2026-09-15', 'sep 2026', 'Cambio de rutina', true], // el mismo día, el de fecha exacta primero
    ['e7', '2026-09-20', '20 sep', 'Mudanza', false],
  ]);
});

test('perfiles: el peso no lleva resultados de carrera; resistencia de carrera excluye Prep. ciclismo y deja Híbrido', () => {
  const it = items([
    phase('p1', 'prep_cycling', ap('2026-08-01'), null),
    phase('p2', 'hybrid', ap('2026-08-01'), null),
    phase('p3', 'prep_10k', ap('2026-08-01'), null),
    phase('p4', 'gain', ap('2026-08-01'), null),
    event('r1', 'race_result', ap('2026-09-01'), { text: 'San Silvestre', result: { km: 10, sec: 2958 } }),
    event('r2', 'race_result', ap('2026-09-03'), { result: { km: 21.0975, sec: 6300 } }),
  ]);
  const w = chartContext(it, 'weight', { key: 'bodyweight' });
  assert.deepEqual(w.facts, []);
  assert.deepEqual(w.phases.map((p) => p.name), ['Ganancia']);
  const run = chartContext(it, 'endurance', { key: 'run-pace', sport: 'run' });
  assert.deepEqual(run.phases.map((p) => p.name).sort(), ['Híbrido', 'Prep. 10K']);
  assert.deepEqual(run.facts.map((f) => f.name), ['San Silvestre · 49:18', 'Media maratón · 1:45:00']);
  // En bici no entran los resultados de carrera a pie ni la Prep. 10K
  const bike = chartContext(it, 'endurance', { key: 'bike-speed', sport: 'bike' });
  assert.deepEqual(bike.phases.map((p) => p.name).sort(), ['Híbrido', 'Prep. ciclismo']);
  assert.deepEqual(bike.facts, []);
  // Sin deporte (km con «Todos»): todas las de deporte
  assert.equal(chartContext(it, 'endurance', { key: 'km' }).phases.length, 3);
  assert.deepEqual(Object.keys(CHART_PROFILES), ['weight', 'strength', 'endurance', 'load']);
});

test('eventos pasados: por actividad, por contextId (sin duplicar el resultado) y a mano; dns, skipped, sin responder y futuro no', () => {
  const sessions = [{ id: 'a1', kind: 'run', status: 'done', date: '2026-09-27', distanceKm: 10, movingSec: 2958, durationMin: 50 }];
  const context = [event('c1', 'race_result', ap('2026-09-13'), { text: 'Popular', result: { km: 10, sec: 3000 } })];
  const base = { distanceKm: 10, targetSec: null, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 };
  const races = [
    { ...base, id: 'r1', name: '10K Valencia', type: '10k', date: '2026-09-27', outcome: { status: 'done', activityId: 'a1' } },
    { ...base, id: 'r2', name: '', type: '10k', date: '2026-09-13', outcome: { status: 'done', contextId: 'c1' } },
    { ...base, id: 'r3', name: 'Marcha', type: 'cycling', distanceKm: null, date: '2026-08-30', outcome: { status: 'done', manual: { sec: 7200, km: 60 } } },
    { ...base, id: 'r4', name: 'No fui', type: '10k', date: '2026-08-20', outcome: { status: 'dns' } },
    { ...base, id: 'r5', name: 'Omitido', type: '10k', date: '2026-08-21', outcome: { status: 'skipped' } },
    { ...base, id: 'r6', name: 'Sin responder', type: '10k', date: '2026-08-22' },
    { ...base, id: 'r7', name: 'Futuro', type: '10k', date: '2026-11-22' },
  ];
  const it = items(context, races, sessions);
  assert.deepEqual(it.facts.map((f) => [f.date, f.name, f.race]), [
    ['2026-08-30', 'Marcha · 2:00:00', true],
    ['2026-09-13', '10K · 50:00', true],
    ['2026-09-27', '10K Valencia · 49:18', true],
  ]);
  const run = chartContext(it, 'endurance', { key: 'run-pace', sport: 'run' });
  assert.deepEqual(run.facts.map((f) => f.name), ['10K · 50:00', '10K Valencia · 49:18'], 'la marcha en bici no es de carrera');
  assert.equal(chartContext(it, 'load', { key: 'load' }).facts.length, 3);
});

test('ctxLine: tres fases a la vez → «Parón · +2» por prioridad; un hecho el mismo día va primero; semana entera', () => {
  const it = items([
    phase('p1', 'gain', ap('2026-08-01'), null),
    phase('p2', 'break', ap('2026-08-10'), ap('2026-08-30')),
    phase('p3', 'deload', ap('2026-08-12'), ap('2026-08-18')),
    event('e1', 'creatine_start', ap('2026-08-14')),
    event('e2', 'routine_change', ap('2026-08-20')),
  ]);
  const cc = chartContext(it, 'weight', { key: 'bodyweight' });
  // entrenamiento (la más reciente primero) > cuerpo
  assert.equal(ctxLine(cc, '2026-08-13', '2026-08-13'), 'Descarga · +2');
  assert.equal(ctxLine(cc, '2026-08-25'), 'Parón · +1');
  assert.equal(ctxLine(cc, '2026-08-14', '2026-08-14'), 'Inicio creatina · +3');
  assert.equal(ctxLine(cc, '2026-08-05', '2026-08-05'), 'Ganancia');
  assert.equal(ctxLine(cc, '2026-07-05', '2026-07-05'), null);
  // Semana del 17 al 23 de agosto: el cambio de rutina del 20 y las tres fases
  assert.equal(ctxLine(cc, '2026-08-17', '2026-08-23'), 'Cambio de rutina · +3');
  assert.equal(cc.line('2026-08-17', '2026-08-23'), 'Cambio de rutina · +3', 'cc.line es ctxLine');
  // Con la vida (enfermedad), es la que da el nombre
  const it2 = items([phase('a', 'gain', ap('2026-08-01'), null), phase('b', 'break', ap('2026-08-01'), null), phase('c', 'illness', ap('2026-08-01'), null)]);
  assert.equal(ctxLine(chartContext(it2, 'weight', { key: 'bodyweight' }), '2026-08-05'), 'Enfermedad · +2');
});

test('ctxAria: como mucho 3 elementos y «y N más»; vacío sin nada', () => {
  const it = items([
    phase('p1', 'break', ap('2026-08-10'), ap('2026-08-30')),
    event('e1', 'creatine_start', ap('2026-09-15')),
    event('e2', 'routine_change', ap('2026-09-01', 'month')),
    event('e3', 'holidays', ap('2026-09-20')),
    event('e4', 'injury', ap('2026-09-25')),
  ]);
  const cc = chartContext(it, 'weight', { key: 'bodyweight' });
  assert.equal(ctxAria(cc, '2026-08-01', '2026-10-07'), 'Contexto: Parón (fase), Inicio creatina el 15 sep, Cambio de rutina en sep 2026 y 2 más');
  assert.equal(ctxAria(cc, '2026-09-14', '2026-09-16'), 'Contexto: Inicio creatina el 15 sep y Cambio de rutina en sep 2026');
  assert.equal(ctxAria(cc, '2026-08-11', '2026-08-12'), 'Contexto: Parón (fase)');
  assert.equal(ctxAria(cc, '2026-01-01', '2026-02-01'), '');
});

test('caché: mismas revisiones → el mismo objeto; otra revisión del contexto → uno nuevo; chartContext por perfil', () => {
  const context = [event('e1', 'creatine_start', ap('2026-09-15'))];
  const r = { epoch: 7, context: 900, races: 3, sessions: 4 };
  let calls = 0;
  const lazy = () => { calls++; return context; };
  const a = contextItems({ context: lazy, races: [], sessions: [], today: TODAY, rev: r });
  const b = contextItems({ context: lazy, races: [], sessions: [], today: TODAY, rev: { ...r } });
  assert.equal(a, b);
  assert.equal(calls, 1, 'los datos perezosos solo se leen al recalcular');
  const c = contextItems({ context: lazy, races: [], sessions: [], today: TODAY, rev: { ...r, context: 901 } });
  assert.notEqual(a, c);
  const d = contextItems({ context: lazy, races: [], sessions: [], today: '2026-10-08', rev: { ...r, context: 901 } });
  assert.notEqual(c, d, 'otro día, otra clave');
  const w1 = chartContext(d, 'weight', { key: 'bodyweight' });
  const w2 = chartContext(d, 'weight', { key: 'bodyweight', defaultOn: false });
  assert.equal(w1.facts, w2.facts, 'misma lista por perfil');
  assert.equal(w2.defaultOn, false);
});

test('hecho de un mes del mes en curso: no desaparece (mitad de mes aún en el futuro → hoy, hueco)', () => {
  // Revisión (ronda 8, E): «oct 2026» con hoy 7 oct se situaba el 15 oct (> hoy) y se descartaba de todas las gráficas
  const it = items([
    event('m1', 'routine_change', ap('2026-10-01', 'month')),
    event('m2', 'routine_change', ap('2026-11-01', 'month')), // mes que aún no ha empezado: fuera
  ]);
  assert.deepEqual(it.facts.map((f) => [f.id, f.date, f.when, f.hollow]), [['m1', TODAY, 'oct 2026', true]]);
});
