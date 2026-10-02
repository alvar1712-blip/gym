// Contexto del usuario (ronda 6, docs/MEJORAS6.md): fechas aproximadas, registros, línea temporal y contexto vigente.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeApprox, makeApprox, approxFrom, approxTo, approxLabel, approxParts, normalizeEntry, normalizeAll, validateEntry,
  entryRecord, entryRange, phaseActiveOn, entryTitle, entryWhen, entryLine, timeline, contextOn, recentChanges, currentLabel,
  contextSummary, weightReferences, PHASE_TYPES, EVENT_TYPES, ASPECTS,
} from '../../js/context-logic.js';

const ap = (date, precision) => ({ date, precision });

/** El ejemplo del usuario: hechos anteriores a la app con fecha aproximada. */
const EXAMPLE = [
  { id: 'usual', kind: 'event', type: 'usual_weight', date: ap('2026-05-01', 'year'), kg: 75, text: 'Peso habitual previo', createdAt: 1 },
  { id: 'summer', kind: 'phase', type: 'break', start: ap('2026-06-01', 'month'), end: ap('2026-08-01', 'month'), text: 'Entrenamiento irregular y pérdida de peso', createdAt: 2 },
  { id: 'low', kind: 'event', type: 'weight', date: ap('2026-08-28', 'day'), kg: 72.7, createdAt: 3 },
  { id: 'back', kind: 'phase', type: 'return', start: ap('2026-09-01', 'month'), end: null, createdAt: 4 },
  { id: 'gym', kind: 'event', type: 'gym_return', date: ap('2026-09-01', 'month'), createdAt: 5 },
  { id: 'crea', kind: 'event', type: 'creatine_start', date: ap('2026-09-01', 'month'), createdAt: 6 },
];

test('fechas aproximadas: se normalizan al primer día del periodo', () => {
  assert.deepEqual(normalizeApprox('2026-08-28'), ap('2026-08-28', 'day'));
  assert.deepEqual(normalizeApprox(ap('2026-08-28', 'month')), ap('2026-08-01', 'month'));
  assert.deepEqual(normalizeApprox(ap('2026-08-28', 'year')), ap('2026-01-01', 'year'));
  assert.deepEqual(normalizeApprox(ap('2026-07-15', 'season')), ap('2026-06-01', 'season'));
  // Enero y febrero son del invierno que empezó en diciembre del año anterior.
  assert.deepEqual(normalizeApprox(ap('2027-01-20', 'season')), ap('2026-12-01', 'season'));
  assert.deepEqual(normalizeApprox(ap('2026-12-05', 'season')), ap('2026-12-01', 'season'));
  assert.deepEqual(normalizeApprox(ap('2026-08-28', 'semana')), ap('2026-08-28', 'day'), 'precisión desconocida → día');
  assert.equal(normalizeApprox(ap('2026-02-30', 'day')), null);
  assert.equal(normalizeApprox(null), null);
  assert.equal(normalizeApprox('ayer'), null);
});

test('fechas aproximadas: fin del periodo, textos y piezas del formulario', () => {
  assert.equal(approxTo(ap('2026-08-28', 'day')), '2026-08-28');
  assert.equal(approxTo(ap('2026-08-01', 'month')), '2026-08-31');
  assert.equal(approxTo(ap('2024-02-01', 'month')), '2024-02-29');
  assert.equal(approxTo(ap('2026-06-01', 'season')), '2026-08-31');
  assert.equal(approxTo(ap('2026-12-01', 'season')), '2027-02-28');
  assert.equal(approxTo(ap('2026-01-01', 'year')), '2026-12-31');
  assert.equal(approxFrom(ap('2026-08-17', 'month')), '2026-08-01');
  assert.equal(approxLabel(ap('2026-08-28', 'day')), '28 ago 2026');
  assert.equal(approxLabel(ap('2026-08-01', 'month')), 'agosto 2026');
  assert.equal(approxLabel(ap('2026-08-01', 'month'), { short: true }), 'ago 2026');
  assert.equal(approxLabel(ap('2026-06-01', 'season')), 'verano 2026');
  assert.equal(approxLabel(ap('2026-12-01', 'season')), 'invierno 2026-27');
  assert.equal(approxLabel(ap('2026-01-01', 'year')), '2026');
  assert.equal(approxLabel(null), '—');
  assert.deepEqual(makeApprox('month', { year: 2026, month: 8 }), ap('2026-08-01', 'month'));
  assert.deepEqual(makeApprox('season', { year: 2026, season: 'winter' }), ap('2026-12-01', 'season'));
  assert.deepEqual(makeApprox('year', { year: 2025 }), ap('2025-01-01', 'year'));
  assert.deepEqual(makeApprox('day', { date: '2026-08-28' }), ap('2026-08-28', 'day'));
  assert.equal(makeApprox('month', { year: 2026, month: 13 }), null);
  assert.equal(makeApprox('season', { year: 2026, season: 'monsoon' }), null);
  assert.equal(makeApprox('year', { year: null }), null);
  assert.deepEqual(approxParts(ap('2027-01-01', 'season')), { precision: 'season', date: '2026-12-01', year: 2026, month: 12, season: 'winter' });
  assert.equal(approxParts(null, '2026-10-02').precision, 'day');
});

test('registros: se sanean al leer (campos de menos o de más, tipos desconocidos, fechas dañadas)', () => {
  assert.equal(normalizeEntry(null), null);
  assert.equal(normalizeEntry({ id: 'x', kind: 'phase', type: 'gain' }), null, 'una fase sin inicio no se puede leer');
  assert.equal(normalizeEntry({ id: 'x', kind: 'raro', type: 'gain', start: '2026-01-01' }), null);
  const p = normalizeEntry({ id: 'p', kind: 'phase', type: 'nuevo-tipo', start: '2026-09-03', extra: 1 });
  assert.deepEqual([p.type, p.end, p.goalIds, p.sports, p.text, p.notes], ['custom', null, [], [], '', '']);
  assert.equal('extra' in p, false);
  // Un fin anterior al inicio no deja la fase «vigente»: la cierra en su inicio.
  const bad = normalizeEntry({ id: 'b', kind: 'phase', type: 'gain', start: ap('2026-09-01', 'month'), end: ap('2026-05-01', 'month') });
  assert.deepEqual(bad.end, ap('2026-09-01', 'month'));
  assert.equal(phaseActiveOn(bad, '2026-10-15'), false);
  const e = normalizeEntry({ id: 'e', kind: 'event', type: 'creatine_start', date: '2026-09-10', kg: 80 });
  assert.equal(e.kg, null, 'solo los hechos de peso llevan kg');
  assert.equal(normalizeEntry({ id: 'w', kind: 'event', type: 'weight', date: '2026-08-28', kg: 5000 }).kg, null);
  assert.equal(normalizeEntry({ id: 'u', kind: 'event', type: 'zzz', date: '2026-08-28' }).type, 'other');
  assert.deepEqual(normalizeEntry({ id: 's', kind: 'phase', type: 'hybrid', start: '2026-09-01', sports: ['run', 'run', 3, ''] }).sports, ['run']);
  assert.equal(normalizeAll([null, { id: 1 }, EXAMPLE[0]]).length, 1);
  assert.equal(normalizeAll('no es una lista').length, 0);
});

test('validateEntry: lo mínimo para guardar', () => {
  assert.deepEqual(validateEntry({ kind: 'phase', type: 'return', start: ap('2026-09-01', 'month'), end: null }), {});
  assert.ok(validateEntry({ kind: 'phase', type: 'return' }).start);
  assert.ok(validateEntry({ kind: 'phase', type: 'nope', start: '2026-09-01' }).type);
  assert.ok(validateEntry({ kind: 'phase', type: 'custom', start: '2026-09-01', text: '  ' }).text);
  assert.ok(validateEntry({ kind: 'phase', type: 'gain', start: ap('2026-09-01', 'month'), end: ap('2026-08-01', 'month') }).end);
  // Mismo mes de inicio y fin: válido (el fin es el último día del mes).
  assert.deepEqual(validateEntry({ kind: 'phase', type: 'travel', start: '2026-09-20', end: ap('2026-09-01', 'month') }), {});
  assert.deepEqual(validateEntry({ kind: 'event', type: 'creatine_start', date: ap('2026-09-01', 'month') }), {});
  assert.ok(validateEntry({ kind: 'event', type: 'usual_weight', date: ap('2026-01-01', 'year') }).kg);
  assert.ok(validateEntry({ kind: 'event', type: 'weight', date: '2026-08-28', kg: 7 }).kg);
  assert.ok(validateEntry({ kind: 'event', type: 'other', date: '2026-08-28' }).text);
  assert.ok(validateEntry({ kind: 'event', type: 'gym_return' }).date);
  assert.ok(validateEntry({}).kind);
});

test('entryRecord: conserva id y alta; los hechos sin peso no llevan kg', () => {
  const r = entryRecord({ kind: 'event', type: 'creatine_start', date: '2026-09-10', text: ' 3 g/día ' }, { id: 'ctx_1', now: 100 });
  assert.deepEqual(r, { id: 'ctx_1', kind: 'event', type: 'creatine_start', date: ap('2026-09-10', 'day'), text: '3 g/día', notes: '', createdAt: 100, updatedAt: 100 });
  const again = entryRecord({ ...r, text: 'otra' }, { now: 200 });
  assert.deepEqual([again.id, again.createdAt, again.updatedAt, again.text], ['ctx_1', 100, 200, 'otra']);
  assert.throws(() => entryRecord({ kind: 'phase', type: 'gain' }, { id: 'x' }));
});

test('línea temporal del ejemplo: textos, orden y contexto vigente', () => {
  const tl = timeline(EXAMPLE);
  assert.deepEqual(tl.map((e) => e.id), ['crea', 'gym', 'back', 'low', 'summer', 'usual'], 'más reciente primero; a igualdad, lo último creado');
  const byId = Object.fromEntries(tl.map((e) => [e.id, e]));
  assert.equal(entryWhen(byId.summer), 'jun 2026 – ago 2026');
  assert.equal(entryWhen(byId.back), 'desde sep 2026');
  assert.equal(entryWhen(byId.low), '28 ago 2026');
  assert.equal(entryLine(byId.low), 'Peso en esa fecha: 72,7 kg');
  assert.equal(entryLine(byId.usual), 'Peso habitual: 75 kg · Peso habitual previo');
  assert.equal(entryLine(byId.summer), 'Parón o entrenamiento irregular · Entrenamiento irregular y pérdida de peso');
  assert.equal(entryTitle({ kind: 'phase', type: 'custom', text: 'Selectividad' }), 'Selectividad');
  assert.deepEqual(entryRange(byId.summer), { from: '2026-06-01', to: '2026-08-31' });

  const now = contextOn(EXAMPLE, '2026-10-02');
  assert.deepEqual(now.phases.map((e) => e.id), ['back']);
  assert.deepEqual(now.usualWeight, { kg: 75, date: ap('2026-01-01', 'year') });
  assert.deepEqual(contextOn(EXAMPLE, '2026-07-10').phases.map((e) => e.id), ['summer']);
  assert.deepEqual(contextOn(EXAMPLE, '2026-09-20').events.map((e) => e.id).sort(), ['crea', 'gym'], 'los hechos de «sep 2026» cubren todo septiembre');
  assert.equal(currentLabel(EXAMPLE, '2026-10-02'), 'Vuelta tras vacaciones o parón · desde sep 2026');
  assert.equal(currentLabel(EXAMPLE, '2026-05-10'), null);
  assert.equal(phaseActiveOn(byId.summer, '2026-08-31'), true);
  assert.equal(phaseActiveOn(byId.summer, '2026-09-01'), false);
});

test('cambios recientes: inicios, fines y hechos de las últimas 6 semanas', () => {
  const rc = recentChanges(EXAMPLE, '2026-10-02');
  assert.deepEqual(rc.map((x) => [x.what, x.entry.id, x.date]).sort(), [
    ['end', 'summer', '2026-08-31'],
    ['event', 'crea', '2026-09-01'],
    ['event', 'gym', '2026-09-01'],
    ['event', 'low', '2026-08-28'],
    ['start', 'back', '2026-09-01'],
  ]);
  assert.deepEqual(rc.map((x) => x.date), ['2026-09-01', '2026-09-01', '2026-09-01', '2026-08-31', '2026-08-28'], 'de lo más reciente a lo más antiguo');
  // Fechas gruesas: cuenta el principio del periodo, y el peso habitual nunca es un cambio.
  const coarse = [
    { id: 'y', kind: 'event', type: 'holidays', date: ap('2026-01-01', 'year') },
    { id: 's', kind: 'event', type: 'holidays', date: ap('2026-06-01', 'season') },
    { id: 'u', kind: 'event', type: 'usual_weight', date: ap('2026-09-20', 'day'), kg: 75 },
  ];
  assert.deepEqual(recentChanges(coarse, '2026-10-02'), []);
  assert.deepEqual(recentChanges(coarse, '2026-06-20').map((x) => x.entry.id), ['s']);
  assert.deepEqual(recentChanges(EXAMPLE, '2027-06-01'), []);
});

test('catálogo: tipos con id y texto únicos; cada fase con su aspecto', () => {
  for (const list of [PHASE_TYPES, EVENT_TYPES]) {
    assert.equal(new Set(list.map((t) => t.id)).size, list.length);
    assert.ok(list.every((t) => t.label));
  }
  assert.ok(PHASE_TYPES.every((t) => ASPECTS.includes(t.aspect)));
});

/** Tres fases a la vez: ganancia muscular (desde julio), preparación 10K (desde septiembre) y exámenes (desde ayer). */
const OVERLAP = [
  { id: 'gain', kind: 'phase', type: 'gain', start: ap('2026-07-01', 'month'), end: null, createdAt: 1 },
  { id: 'tenk', kind: 'phase', type: 'prep_10k', start: ap('2026-09-01', 'month'), end: null, goalIds: ['goal_10k'], sports: ['run'], createdAt: 2 },
  { id: 'exams', kind: 'phase', type: 'stress', start: ap('2026-10-01', 'day'), end: ap('2026-10-20', 'day'), text: 'Exámenes de la universidad', createdAt: 3 },
  { id: 'old', kind: 'phase', type: 'deficit', start: ap('2026-03-01', 'month'), end: ap('2026-06-01', 'month'), createdAt: 4 },
  { id: 'future', kind: 'phase', type: 'prep_half', start: ap('2026-11-01', 'month'), end: null, createdAt: 5 },
];

test('fases simultáneas: todas las vigentes, por aspecto, sin suponer una sola', () => {
  const now = contextOn(OVERLAP, '2026-10-02');
  assert.deepEqual(now.phases.map((p) => p.id), ['exams', 'tenk', 'gain'], 'las tres, de la más reciente a la más antigua');
  const sum = contextSummary(OVERLAP, '2026-10-02');
  assert.deepEqual(sum.phases.map((p) => p.id), ['exams', 'tenk', 'gain']);
  assert.deepEqual(Object.fromEntries(Object.entries(sum.byAspect).map(([k, v]) => [k, v.map((p) => p.id)])),
    { body: ['gain'], training: [], sport: ['tenk'], life: ['exams'], custom: [] });
  assert.ok(sum.types.has('gain') && sum.types.has('prep_10k') && sum.types.has('stress'));
  assert.ok(!sum.types.has('deficit') && !sum.types.has('prep_half'), 'ni las terminadas ni las que aún no han empezado');
  assert.deepEqual(sum.byAspect.sport[0].goalIds, ['goal_10k']);
  // Tras los exámenes, quedan dos; en noviembre entra la media.
  assert.deepEqual(contextOn(OVERLAP, '2026-10-21').phases.map((p) => p.id), ['tenk', 'gain']);
  assert.deepEqual(contextOn(OVERLAP, '2026-11-05').phases.map((p) => p.id), ['future', 'tenk', 'gain']);
  // Misma fecha de inicio: primero la última creada (orden estable).
  const tie = [
    { id: 'a', kind: 'phase', type: 'gain', start: ap('2026-09-01', 'month'), end: null, createdAt: 10 },
    { id: 'b', kind: 'phase', type: 'hybrid', start: ap('2026-09-01', 'month'), end: null, createdAt: 20 },
  ];
  assert.deepEqual(contextOn(tie, '2026-10-02').phases.map((p) => p.id), ['b', 'a']);
  assert.deepEqual(contextOn([...tie].reverse(), '2026-10-02').phases.map((p) => p.id), ['b', 'a']);
});

test('línea compacta de Hoy: una fase con su fecha; varias, sus nombres (hasta 3 y «+N»)', () => {
  assert.equal(currentLabel(OVERLAP.slice(0, 1), '2026-10-02'), 'Ganancia muscular · desde jul 2026');
  assert.equal(currentLabel(OVERLAP, '2026-10-02'), 'Exámenes o época de estrés · Preparación 10K · Ganancia muscular');
  const four = [...OVERLAP, { id: 'inj', kind: 'phase', type: 'injury', start: ap('2026-10-02', 'day'), end: null, createdAt: 6 }];
  assert.equal(currentLabel(four, '2026-10-02'), 'Lesión o molestia · Exámenes o época de estrés · Preparación 10K · +1');
});

test('referencias de peso estructuradas (sin leer números del texto)', () => {
  const list = [
    ...EXAMPLE,
    { id: 'txt', kind: 'event', type: 'other', date: ap('2026-08-15', 'day'), text: 'Pesaba 71 kg en la báscula del hotel' },
  ];
  const refs = weightReferences(list, '2026-10-02');
  assert.deepEqual(refs.map((r) => [r.kind, r.kg, r.from, r.to, r.precision]), [
    ['usual', 75, '2026-01-01', '2026-12-31', 'year'],
    ['point', 72.7, '2026-08-28', '2026-08-28', 'day'],
  ], 'el «71 kg» escrito en un texto libre no cuenta');
  assert.deepEqual(weightReferences(list, '2026-08-27').map((r) => r.kg), [75], 'solo lo anterior a la fecha');
  const sum = contextSummary(list, '2026-10-02');
  assert.deepEqual(sum.weights.map((r) => r.kg), [75, 72.7]);
  assert.equal(sum.usualWeight.kg, 75);
});
