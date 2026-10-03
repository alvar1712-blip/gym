// Pruebas de js/analysis-weight.js (análisis del peso, ronda 5 §3a) con series de pesajes construidas a mano.
// Hoy = domingo 27 sep 2026. Ruido «normal» determinista de ±0,35 kg; ruido grande de ±1,5 kg.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeWeight, weightTrend, targetFor, classifyRate, kcalSuggestion, proteinFor, paceLabel, theilSen, emaSeries,
  cyclePhaseFor, cycleIrregularity, periodStarts, TARGETS, SOURCES, MIN_POINTS, MIN_SPAN_DAYS, KCAL_PER_KG,
} from '../../js/analysis-weight.js';
import { addDays, diffDays } from '../../js/util.js';

const TODAY = '2026-09-27';
const NOISE = [0.2, -0.3, 0.1, 0.35, -0.15, -0.25, 0.05, 0.3, -0.1, -0.2, 0.15, -0.05];
const BIG = [1.2, -1.4, 0.3, 1.5, -0.8, -1.1, 0.6, 1.0, -1.5, 0.2, 1.3, -0.4, -1.2, 0.9];

/** Pesajes de los últimos `days` días (cada `every`), con ritmo lineal `perWeek` kg/sem, ruido y extra por fecha. */
function series({ start = 75, perWeek = 0, days = 35, every = 1, noise = NOISE, bump = null, today = TODAY } = {}) {
  const out = [];
  let k = 0;
  for (let i = days - 1; i >= 0; i -= every) {
    const d = addDays(today, -i);
    const t = days - 1 - i;
    let kg = start + (perWeek * t) / 7 + (noise ? noise[k % noise.length] : 0);
    if (bump) kg += bump(d) || 0;
    out.push({ id: d, kg: Math.round(kg * 10) / 10 });
    k++;
  }
  return out;
}
const M = (o = {}) => ({ sex: 'male', goal: 'gain', experience: 'intermediate', cycleTracking: true, contraception: null, cycleLengthGuess: 28, periodLengthGuess: 5, ...o });
const F = (o = {}) => M({ sex: 'female', contraception: 'none', ...o });
/** CycleInfo mínimo (contrato §4) con reglas de 5 días en `starts`. */
const cyc = (starts, extra = {}) => ({
  enabled: true, hormonal: false,
  periods: starts.map((s) => ({ start: s, end: addDays(s, 4), lengthDays: 5, heavyDays: 1 })),
  cycles: [], avgCycle: 28, sdCycle: 0, avgPeriod: 5, regular: true, current: null, next: null, lateDays: 0, alerts: [],
  ...extra,
});
const C1 = cyc(['2026-07-07', '2026-08-04', '2026-09-01']); // hoy = día 27 de un ciclo de ~28
/** +1 kg los días de posible retención de líquidos de C1. */
const retBump = (c, kg = 1) => (d) => (cyclePhaseFor(c, d)?.retention ? kg : 0);
const byId = (r, id) => r.insights.find((i) => i.id === id);
const texts = (r) => r.insights.map((i) => `${i.title} ${i.text}`).join(' | ');
const run = (o) => analyzeWeight({ today: TODAY, ...o });

// Fuentes permitidas (docs/MEJORAS5.md §5): autor + año.
const ALLOWED = [
  ['Morton', 2018], ['Jäger', 2017], ['Iraki', 2019], ['Helms', 2014], ['Garthe', 2011], ['Hall', 2008], ['Mountjoy', 2023],
  ['Schoenfeld', 2017], ['Roberts', 2020], ['Seiler', 2010], ['Schumann', 2022], ['Eddens', 2018], ['Knowles', 2018],
  ['McNulty', 2020], ['Colenso-Semple', 2023], ['Elliott-Sale', 2020], ['White', 2011], ['Munro', 2018], ['Fraser', 2018],
  ['Pedlar', 2018], ['Bruinvels', 2016],
  // Ronda 6 (docs/MEJORAS6.md, plan aprobado): creatina, jóvenes y mayores
  ['Kreider', 2017], ['Lloyd', 2014], ['Fragala', 2019],
];
const allowedSource = (s) => ALLOWED.some(([a, y]) => s.short.startsWith(a) && s.short.includes(String(y)));

/** Forma común de la salida y de cada Insight (contrato §3 y §3a). */
function checkShape(r) {
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(['below', 'in', 'above', 'insufficient', 'no_goal'].includes(r.status), r.status);
  for (const k of ['points', 'currentKg', 'ratePerWeekKg', 'ratePerWeekPct', 'windowDays', 'n']) assert.ok(k in r.trend, k);
  for (const p of r.trend.points) {
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(typeof p.kg, 'number');
    assert.equal(typeof p.trendKg, 'number');
  }
  assert.ok('estimate' in r.kcalPerDay && 'suggestion' in r.kcalPerDay);
  assert.ok('min' in r.proteinG && 'max' in r.proteinG);
  if (r.target) for (const k of ['minPct', 'maxPct', 'label']) assert.ok(k in r.target, k);
  if (!r.ok) assert.equal(typeof r.reason, 'string');
  let prev = Infinity;
  for (const i of r.insights) {
    assert.equal(i.area, 'weight');
    assert.ok(['good', 'neutral', 'warn', 'info'].includes(i.level), i.level);
    assert.ok(i.priority >= 0 && i.priority <= 100);
    assert.ok(i.priority <= prev, 'ordenados por prioridad');
    prev = i.priority;
    assert.ok(i.id && i.title && i.text, i.id);
    assert.ok(i.why && i.why.rule && i.why.data.length, `why de ${i.id}`);
    for (const d of i.why.data) assert.ok(typeof d.label === 'string' && typeof d.value === 'string' && d.value, `${i.id}: ${d.label}`);
    assert.ok(Array.isArray(i.sources));
    for (const s of i.sources) {
      assert.ok(allowedSource(s), `fuente no permitida: ${s.short}`);
      assert.ok(s.detail && s.detail.length > 10);
    }
    if (i.action) assert.ok(i.action.label && i.action.href.startsWith('#/'));
    assert.doesNotMatch(`${i.title} ${i.text} ${i.why.rule} ${JSON.stringify(i.why.data)}`, /undefined|NaN|null|\[object/);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Ayudas puras
// ---------------------------------------------------------------------------

test('theilSen: pendiente exacta, robusta a un valor raro y con intervalo', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const ys = xs.map((x) => 70 + 0.1 * x);
  ys[4] = 80; // errata
  const r = theilSen(xs, ys);
  assert.ok(Math.abs(r.slope - 0.1) < 1e-9);
  assert.ok(r.lo <= r.slope && r.hi >= r.slope);
  assert.equal(theilSen([1], [1]), null);
});

test('emaSeries: ≈ 10 días, sembrada con la mediana y con saltos limitados', () => {
  const pts = [{ date: '2026-09-01', kg: 70 }, { date: '2026-09-02', kg: 70 }, { date: '2026-09-03', kg: 70 }, { date: '2026-09-04', kg: 90 }];
  const e = emaSeries(pts);
  assert.equal(e[0], 70);
  assert.ok(e[3] > 70 && e[3] < 70.3, `salto limitado a ±2,5 kg × peso de un día: ${e[3]}`);
  const skip = emaSeries(pts, { skip: (p) => p.kg > 80 });
  assert.equal(skip[3], 70);
});

test('targetFor: rangos del contrato por objetivo, sexo y experiencia', () => {
  assert.deepEqual([targetFor(M()).minPct, targetFor(M()).maxPct], [0.25, 0.5]);
  assert.deepEqual([targetFor(M({ experience: 'beginner' })).minPct, targetFor(M({ experience: 'beginner' })).maxPct], [0.25, 0.5]);
  assert.deepEqual([targetFor(M({ experience: 'advanced' })).minPct, targetFor(M({ experience: 'advanced' })).maxPct], [0.1, 0.25]);
  assert.deepEqual([targetFor(F()).minPct, targetFor(F()).maxPct], [0.2, 0.4]);
  assert.deepEqual([targetFor(F({ experience: 'advanced' })).minPct, targetFor(F({ experience: 'advanced' })).maxPct], [0.1, 0.2]);
  const lose = targetFor(M({ goal: 'lose' }), { currentKg: 80 });
  assert.deepEqual([lose.minPct, lose.maxPct, lose.minKg, lose.maxKg], [-1, -0.5, -0.8, -0.4]);
  assert.equal(lose.recommended, null);
  assert.deepEqual(targetFor(M({ goal: 'lose' }), { enduranceHigh: true }).recommended.maxPct, -0.5);
  assert.equal(targetFor(F({ goal: 'lose' })).recommended.minPct, -0.75);
  assert.deepEqual([targetFor(M({ goal: 'maintain' })).minPct, targetFor(M({ goal: 'performance' })).maxPct], [-0.25, 0.25]);
  assert.equal(targetFor(M({ goal: null })), null);
  const noExp = targetFor(M({ experience: null }));
  assert.equal(noExp.experience, 'intermediate');
  assert.ok(noExp.experienceGuessed);
  assert.match(targetFor(M()).label, /subir 0,25–0,5 %/);
  assert.match(targetFor(M({ goal: 'lose' })).label, /bajar 0,5–1 %/);
  assert.deepEqual(TARGETS.gain.female.beginner, [0.2, 0.4]);
});

test('classifyRate, kcalSuggestion, proteinFor y paceLabel', () => {
  const t = targetFor(M(), { currentKg: 75 });
  assert.equal(classifyRate(0.1, t), 'below');
  assert.equal(classifyRate(0.4, t), 'in');
  assert.equal(classifyRate(0.6, t), 'above');
  // Ejemplo del usuario: sube 0,05 kg/sem con 75 kg → comer ~150–250 kcal más.
  assert.deepEqual(kcalSuggestion(0.05, 75, t), { min: 150, max: 250 });
  assert.equal(kcalSuggestion(0.3, 75, t), null);
  const cut = kcalSuggestion(0.7, 75, t);
  assert.ok(cut.min < cut.max && cut.max < 0);
  const big = kcalSuggestion(-1, 75, t);
  assert.ok(big.max <= 500 && big.min >= 100);
  assert.deepEqual([proteinFor(75).min, proteinFor(75).max], [120, 165]);
  assert.equal(proteinFor(75).focus, null);
  assert.deepEqual(proteinFor(75, true).focus, { min: 150, max: 165 });
  assert.deepEqual([proteinFor(null).min, proteinFor(null).max], [null, null]);
  assert.equal(paceLabel('lose', 'below', 'down'), 'Bajas muy rápido');
  assert.equal(paceLabel('gain', 'below', 'up'), 'Subes poco');
  assert.equal(paceLabel('gain', 'in', 'up'), 'Buen ritmo');
  assert.equal(paceLabel('maintain', 'in', 'stable'), 'Estable');
  assert.equal(paceLabel(null, 'insufficient', null), 'Faltan datos');
});

test('cyclePhaseFor: fases estimadas y días de retención (lútea tardía y días 1–3)', () => {
  const at = (d) => cyclePhaseFor(C1, d);
  assert.equal(at('2026-09-01').retention, 'menstrual'); // día 1
  assert.equal(at('2026-09-03').retention, 'menstrual'); // día 3
  assert.equal(at('2026-09-04').retention, null); // día 4 (aún regla, pero ya sin marca)
  assert.equal(at('2026-09-04').phase, 'menstrual');
  assert.equal(at('2026-09-08').phase, 'follicular');
  assert.equal(at('2026-09-14').phase, 'ovulation'); // día 14 ≈ 28 − 14
  assert.equal(at('2026-09-20').phase, 'luteal');
  assert.equal(at('2026-09-24').phase, 'premenstrual'); // día 24 de ~28
  assert.equal(at('2026-09-24').retention, 'premenstrual');
  assert.equal(at('2026-08-31').retention, 'premenstrual'); // día 28 del ciclo de agosto (completo)
  assert.equal(at('2026-08-31').estimated, false);
  assert.equal(at('2026-09-27').estimated, true);
  assert.equal(at('2026-06-01'), null); // antes de la primera regla
  assert.equal(cyclePhaseFor({ ...C1, hormonal: true }, '2026-09-24'), null);
  assert.deepEqual(periodStarts(C1), ['2026-07-07', '2026-08-04', '2026-09-01']);
});

test('cycleIrregularity: retraso, ausencia y alertas; nada con anticonceptivo hormonal', () => {
  assert.equal(cycleIrregularity(C1, TODAY).flagged, false);
  assert.equal(cycleIrregularity(cyc(['2026-07-27'], { lateDays: 34 }), TODAY).flagged, true);
  assert.equal(cycleIrregularity(cyc(['2026-06-01']), TODAY).absent, true);
  assert.equal(cycleIrregularity(cyc(['2026-09-01'], { alerts: [{ id: 'cycle-late', title: 'Regla retrasada' }] }), TODAY).flagged, true);
  assert.equal(cycleIrregularity({ ...cyc(['2026-06-01']), hormonal: true }, TODAY), null);
  const long = cycleIrregularity(cyc(['2026-05-10', '2026-06-25', '2026-08-12', '2026-09-25'], { avgCycle: 46 }), TODAY);
  assert.equal(long.longCycles, true);
  assert.equal(long.flagged, true);
  // Alertas reales de cycle-logic.js: 'cycle-late' y 'cycle-amenorrhea' cuentan; 'cycle-heavy' no.
  assert.equal(cycleIrregularity(cyc(['2026-09-01'], { alerts: [{ id: 'cycle-amenorrhea', title: 'Sin regla' }] }), TODAY).flagged, true);
  assert.equal(cycleIrregularity(cyc(['2026-09-01'], { alerts: [{ id: 'cycle-heavy', title: 'Reglas abundantes' }] }), TODAY).flagged, false);
});

// ---------------------------------------------------------------------------
// Datos insuficientes y sin objetivo
// ---------------------------------------------------------------------------

test('datos insuficientes: < 8 pesajes o < 14 días → insufficient con consejos para pesarse', () => {
  for (const bw of [series({ days: 10 }), series({ days: 30, every: 5 })]) {
    const r = checkShape(run({ bodyweight: bw, profile: M() }));
    assert.equal(r.status, 'insufficient');
    assert.equal(r.ok, false);
    assert.equal(r.reasonCode, 'few_data');
    assert.equal(r.trend.ratePerWeekKg, null);
    assert.equal(r.kcalPerDay.estimate, null);
    const i = byId(r, 'weight-insufficient');
    assert.match(i.text, /por la mañana/);
    assert.match(i.text, /3–4 veces por semana/);
    assert.match(i.text, /0,5–1,5 kg/);
    assert.ok(r.trend.points.length > 0, 'los puntos sirven para la gráfica');
    assert.ok(r.proteinG.min > 0, 'la proteína solo necesita un peso');
  }
  const none = checkShape(run({ bodyweight: [], profile: M() }));
  assert.equal(none.reasonCode, 'no_data');
  assert.equal(none.proteinG.min, null);
  assert.match(byId(none, 'weight-insufficient').title, /Empieza/);
  assert.equal(MIN_POINTS, 8);
  assert.equal(MIN_SPAN_DAYS, 14);
});

test('pesajes antiguos: el último hace > 14 días → insufficient (stale)', () => {
  const bw = series({ days: 60 }).filter((b) => b.id < '2026-09-05');
  const r = checkShape(run({ bodyweight: bw, profile: M() }));
  assert.equal(r.status, 'insufficient');
  assert.equal(r.reasonCode, 'stale');
  assert.match(byId(r, 'weight-insufficient').text, /4 sep 2026/);
});

test('fechas futuras, erratas y duplicados se ignoran', () => {
  const bw = [...series({ perWeek: 0.3 }), { id: '2026-10-05', kg: 90 }, { id: 'mal', kg: 70 }, { id: '2026-09-10', kg: 7.5 }];
  const r = checkShape(run({ bodyweight: bw, profile: M() }));
  assert.ok(r.trend.points.every((p) => p.date <= TODAY && p.kg > 20));
  assert.equal(r.status, 'in');
});

test('sin objetivo → no_goal: invita a elegir objetivo en Perfil y aun así describe la tendencia', () => {
  const r = checkShape(run({ bodyweight: series({ perWeek: 0.3 }), profile: M({ goal: null }) }));
  assert.equal(r.status, 'no_goal');
  assert.equal(r.ok, true);
  assert.equal(r.target, null);
  const i = byId(r, 'weight-no-goal');
  assert.deepEqual(i.action, { label: 'Elegir objetivo', href: '#/settings/profile' });
  assert.match(i.text, /^Subes 0,3 kg por semana/);
  assert.match(i.text, /ganar músculo, perder grasa, mantener o rendir/);
  assert.ok(r.kcalPerDay.estimate > 0);
  assert.equal(r.kcalPerDay.suggestion, null);
  assert.equal(r.goalSuggestion, undefined);
  // Sin objetivo y sin datos: los dos mensajes.
  const r2 = checkShape(run({ bodyweight: series({ days: 5 }), profile: M({ goal: null }) }));
  assert.equal(r2.status, 'insufficient');
  assert.ok(byId(r2, 'weight-no-goal') && byId(r2, 'weight-insufficient'));
});

// ---------------------------------------------------------------------------
// Ganar músculo: por debajo / dentro / por encima
// ---------------------------------------------------------------------------

test('ganar músculo, hombre intermedio: por debajo, dentro y por encima', () => {
  const below = checkShape(run({ bodyweight: series({ perWeek: 0.05 }), profile: M() }));
  assert.equal(below.status, 'below');
  const bi = byId(below, 'weight-rate');
  assert.equal(bi.level, 'warn');
  assert.match(bi.text, /150–(250|300) kcal más al día/);
  assert.match(bi.text, /bocadillo o un batido/);
  assert.match(bi.text, /revisa en 3 semanas/);
  assert.ok(below.kcalPerDay.suggestion.min >= 100 && below.kcalPerDay.suggestion.max <= 300);

  const inR = checkShape(run({ bodyweight: series({ perWeek: 0.3 }), profile: M() }));
  assert.equal(inR.status, 'in');
  assert.equal(inR.trend.direction, 'up');
  assert.ok(Math.abs(inR.trend.ratePerWeekKg - 0.3) < 0.05, `${inR.trend.ratePerWeekKg}`);
  const ii = byId(inR, 'weight-rate');
  assert.equal(ii.level, 'good');
  assert.match(ii.text, /^Subes 0,3 kg por semana \(0,\d+ % de tu peso\): dentro del rango para ganar músculo con poca grasa \(0,25–0,5 %\)/);
  assert.match(ii.text, /Si en el espejo no notas que acumulas grasa, vas bien/);
  assert.equal(inR.kcalPerDay.suggestion, null);
  assert.equal(inR.paceLabel, 'Buen ritmo');

  const above = checkShape(run({ bodyweight: series({ perWeek: 0.7 }), profile: M() }));
  assert.equal(above.status, 'above');
  assert.match(byId(above, 'weight-rate').text, /más rápido de lo necesario/);
  assert.ok(above.kcalPerDay.suggestion.max < 0);
  assert.match(byId(above, 'weight-rate').text, /kcal menos al día/);
  assert.ok(byId(above, 'weight-rate').priority > byId(inR, 'weight-rate').priority, 'fuera de rango > dentro');
});

test('ganar músculo, hombre principiante y avanzado', () => {
  const beg = checkShape(run({ bodyweight: series({ perWeek: 0.3 }), profile: M({ experience: 'beginner' }) }));
  assert.equal(beg.status, 'in');
  const adv = checkShape(run({ bodyweight: series({ perWeek: 0.3 }), profile: M({ experience: 'advanced' }) }));
  assert.equal(adv.status, 'above', 'avanzado: 0,1–0,25 %');
  assert.match(adv.target.basis, /avanzado/);
  const advIn = checkShape(run({ bodyweight: series({ perWeek: 0.13 }), profile: M({ experience: 'advanced' }) }));
  assert.equal(advIn.status, 'in');
});

test('ganar músculo, mujer principiante y avanzada (rangos más prudentes, textos en femenino)', () => {
  const inR = checkShape(run({ bodyweight: series({ start: 60, perWeek: 0.18 }), profile: F({ experience: 'beginner' }) }));
  assert.equal(inR.status, 'in');
  assert.match(byId(inR, 'weight-rate').text, /\(0,2–0,4 %\)/);
  assert.match(inR.target.basis, /mujer, principiante/);
  assert.ok(byId(inR, 'weight-rate').sources.some((s) => s.short.startsWith('Roberts')));
  const above = checkShape(run({ bodyweight: series({ start: 60, perWeek: 0.3 }), profile: F({ experience: 'beginner' }) }));
  assert.equal(above.status, 'above');
  const adv = checkShape(run({ bodyweight: series({ start: 60, perWeek: 0.18 }), profile: F({ experience: 'advanced' }) }));
  assert.equal(adv.status, 'above', 'avanzada: 0,1–0,2 %');
  assert.match(adv.target.basis, /mujer, avanzada/);
  const below = checkShape(run({ bodyweight: series({ start: 60, perWeek: 0 }), profile: F({ experience: 'advanced' }) }));
  assert.equal(below.status, 'below');
  // Mujer sin datos del ciclo: ventana de al menos un ciclo.
  assert.ok(inR.trend.windowDays >= 28);
});

// ---------------------------------------------------------------------------
// Perder grasa y mantener
// ---------------------------------------------------------------------------

test('perder grasa demasiado rápido → below (bajas más rápido de lo recomendado) y comer más', () => {
  const r = checkShape(run({ bodyweight: series({ start: 80, perWeek: -1.0 }), profile: M({ goal: 'lose' }) }));
  assert.equal(r.status, 'below');
  assert.equal(r.paceLabel, 'Bajas muy rápido');
  const i = byId(r, 'weight-rate');
  assert.match(i.text, /^Bajas 1,\d+ % de tu peso por semana/);
  assert.match(i.text, /más rápido de lo recomendado para conservar músculo \(0,5–1 %\)/);
  assert.match(i.text, /Sube un poco lo que comes/);
  assert.ok(r.kcalPerDay.suggestion.min > 0);
  assert.ok(r.kcalPerDay.estimate < -900);
  assert.equal(r.goalSuggestion, undefined, 'no se sugiere un objetivo de bajar peso si ya baja demasiado rápido');
  // Pérdida > 1 %/sem → también aviso de energía baja, con más prioridad.
  const reds = byId(r, 'weight-reds');
  assert.ok(reds && reds.priority > i.priority);
});

test('perder grasa en rango; con mucha resistencia se recomienda la mitad baja', () => {
  const ok = checkShape(run({ bodyweight: series({ start: 80, perWeek: -0.5 }), profile: M({ goal: 'lose' }) }));
  assert.equal(ok.status, 'in');
  assert.equal(byId(ok, 'weight-rate').level, 'good');
  assert.ok(ok.goalSuggestion && ok.goalSuggestion.targetKg < ok.trend.currentKg);
  const end = checkShape(run({ bodyweight: series({ start: 80, perWeek: -0.7 }), profile: M({ goal: 'lose' }), endurance: { weeklyMinutes4w: 420 } }));
  assert.equal(end.status, 'in');
  assert.equal(end.target.recommended.reason, 'endurance');
  assert.match(byId(end, 'weight-rate').text, /mitad baja \(0,5–0,75 %\)/);
  assert.ok(end.kcalPerDay.suggestion && end.kcalPerDay.suggestion.min > 0);
});

test('perder grasa: baja poco → come algo menos', () => {
  const r = checkShape(run({ bodyweight: series({ start: 80, perWeek: -0.15 }), profile: M({ goal: 'lose' }) }));
  assert.equal(r.status, 'above');
  assert.match(r.paceLabel, /Bajas poco|Sin bajar/);
  assert.match(byId(r, 'weight-rate').text, /kcal menos al día/);
});

test('mantener: peso estable → in; subida → above', () => {
  const r = checkShape(run({ bodyweight: series({ perWeek: 0 }), profile: M({ goal: 'maintain' }) }));
  assert.equal(r.status, 'in');
  assert.equal(r.trend.direction, 'stable');
  assert.match(byId(r, 'weight-rate').text, /^Tu peso está estable/);
  assert.match(byId(r, 'weight-rate').text, /mantener/);
  assert.equal(r.kcalPerDay.suggestion, null);
  assert.equal(r.goalSuggestion, undefined);
  const up = checkShape(run({ bodyweight: series({ perWeek: 0.45 }), profile: M({ goal: 'maintain' }) }));
  assert.equal(up.status, 'above');
  assert.match(byId(up, 'weight-rate').text, /más de lo que encaja con mantener/);
  const perf = checkShape(run({ bodyweight: series({ perWeek: -0.4 }), profile: M({ goal: 'performance' }) }));
  assert.equal(perf.status, 'below');
  assert.match(byId(perf, 'weight-rate').text, /rendir/);
});

test('ruido diario grande sin tendencia: no inventa ritmo', () => {
  for (const bw of [series({ days: 30, noise: BIG }), series({ days: 30, every: 3, noise: BIG })]) {
    const r = checkShape(run({ bodyweight: bw, profile: M() }));
    const t = r.trend;
    assert.equal(t.clear, false, 'el margen incluye el 0');
    if (r.ok) {
      assert.equal(t.direction, 'stable');
      assert.doesNotMatch(byId(r, 'weight-rate').text, /^(Subes|Bajas) \d/);
    } else {
      assert.equal(r.reasonCode, 'noisy');
      assert.equal(t.ratePerWeekKg, null);
      assert.match(byId(r, 'weight-insufficient').text, /no se ve una tendencia clara/);
    }
    assert.doesNotMatch(texts(r), /Subes \d|Bajas \d/);
  }
  // Mismo ruido pero con una tendencia real y más pesajes: sí la ve.
  const real = checkShape(run({ bodyweight: series({ days: 56, perWeek: 0.6, noise: BIG }), profile: M() }));
  assert.equal(real.trend.direction, 'up');
});

// ---------------------------------------------------------------------------
// Cruces con la fuerza y la resistencia
// ---------------------------------------------------------------------------

test('cruce con la fuerza: peso ↑ rápido y fuerza plana → probablemente más grasa', () => {
  const r = checkShape(run({ bodyweight: series({ perWeek: 0.7 }), profile: M(), strength: { trendPctPerWeek: 0.05, n: 4 } }));
  const s = byId(r, 'weight-strength');
  assert.equal(s.level, 'warn');
  assert.match(s.text, /más grasa que músculo/);
  assert.match(s.text, /estancada/);
  const good = checkShape(run({ bodyweight: series({ perWeek: 0.3 }), profile: M(), strength: { trendPctPerWeek: 0.8, n: 4 } }));
  assert.equal(byId(good, 'weight-strength').level, 'good');
  assert.match(byId(good, 'weight-strength').text, /sobre todo músculo/);
  // Sin datos de fuerza: sin cruce.
  assert.equal(byId(run({ bodyweight: series({ perWeek: 0.7 }), profile: M(), strength: null }), 'weight-strength'), undefined);
  assert.equal(byId(run({ bodyweight: series({ perWeek: 0.7 }), profile: M(), strength: { trendPctPerWeek: null } }), 'weight-strength'), undefined);
});

test('cruce con la fuerza: peso ↓ y fuerza ↓ → déficit agresivo (y sin sugerir objetivo de bajar)', () => {
  const r = checkShape(run({ bodyweight: series({ start: 80, perWeek: -0.6 }), profile: M({ goal: 'lose' }), strength: { trendPctPerWeek: -0.6, n: 3 } }));
  const s = byId(r, 'weight-strength');
  assert.equal(s.level, 'warn');
  assert.match(s.text, /déficit demasiado agresivo/);
  assert.equal(r.goalSuggestion, undefined);
  const keep = checkShape(run({ bodyweight: series({ start: 80, perWeek: -0.6 }), profile: M({ goal: 'lose' }), strength: { trendPctPerWeek: 0.3, n: 3 } }));
  assert.equal(byId(keep, 'weight-strength').level, 'good');
  assert.match(byId(keep, 'weight-strength').text, /conservas el músculo/);
});

test('REDs: pérdida rápida con muchos minutos de resistencia → aviso de salud de máxima prioridad', () => {
  const r = checkShape(run({ bodyweight: series({ start: 80, perWeek: -1.0 }), profile: M({ goal: 'lose' }), endurance: { weeklyMinutes4w: 420 } }));
  const reds = byId(r, 'weight-reds');
  assert.equal(reds.level, 'warn');
  assert.ok(reds.priority >= 85);
  assert.equal(r.insights[0].id, 'weight-reds');
  assert.match(reds.text, /energía baja \(REDs\)/);
  assert.match(reds.text, /profesional/);
  assert.ok(reds.sources.some((s) => s.short.startsWith('Mountjoy')));
  // Pérdida moderada sin buscarla (objetivo ganar) + mucha resistencia → también.
  const unint = checkShape(run({ bodyweight: series({ perWeek: -0.3 }), profile: M(), endurance: { weeklyMinutes4w: 420 } }));
  const u = byId(unint, 'weight-reds');
  assert.ok(u && u.priority >= 85);
  assert.match(u.text, /sin buscarlo/);
  assert.match(u.text, /cansado/);
  assert.match(byId(unint, 'weight-rate').text, /7 h de resistencia/);
  // Misma pérdida con poca resistencia: sin aviso de energía baja.
  assert.equal(byId(run({ bodyweight: series({ perWeek: -0.3 }), profile: M(), endurance: { weeklyMinutes4w: 120 } }), 'weight-reds'), undefined);
});

test('REDs en mujer: regla retrasada + pérdida de peso → consultar a un profesional; sin animar a bajar más', () => {
  const late = cyc(['2026-06-01', '2026-06-29', '2026-07-27'], { lateDays: 34 });
  const r = checkShape(run({ bodyweight: series({ start: 58, perWeek: -0.4 }), profile: F({ goal: 'lose' }), cycle: late }));
  const reds = byId(r, 'weight-reds-cycle');
  assert.ok(reds, texts(r));
  assert.equal(reds.priority, 95);
  assert.equal(r.insights[0].id, 'weight-reds-cycle');
  assert.match(reds.text, /retrasa 34 días/);
  assert.match(reds.text, /test/);
  assert.match(reds.text, /médico|ginecología/);
  assert.ok(reds.sources.some((s) => s.short.startsWith('Mountjoy')));
  const rate = byId(r, 'weight-rate');
  assert.notEqual(rate.level, 'good');
  assert.match(rate.text, /no seguir bajando/);
  assert.equal(r.goalSuggestion, undefined);
  // Solo mucha resistencia (peso estable) + regla retrasada → también.
  const end = checkShape(run({ bodyweight: series({ start: 58 }), profile: F({ goal: 'performance' }), cycle: late, endurance: { weeklyMinutes4w: 300 } }));
  assert.ok(byId(end, 'weight-reds-cycle'));
  // Mujer: pérdida > 0,75 %/sem ya avisa (más sensible que en hombre).
  const fem = checkShape(run({ bodyweight: series({ start: 65, perWeek: -0.58 }), profile: F({ goal: 'lose' }) }));
  assert.ok(byId(fem, 'weight-reds'));
  const male = checkShape(run({ bodyweight: series({ start: 65, perWeek: -0.58 }), profile: M({ goal: 'lose' }) }));
  assert.equal(byId(male, 'weight-reds'), undefined);
});

// ---------------------------------------------------------------------------
// Ciclo: retención de líquidos, fases equivalentes y anticonceptivo hormonal
// ---------------------------------------------------------------------------

test('mujer con el último pesaje en días premenstruales: mensaje de retención, sin alarma', () => {
  const bw = series({ start: 60, days: 58, bump: retBump(C1) });
  const r = checkShape(run({ bodyweight: bw, profile: F({ goal: 'maintain' }), cycle: C1 }));
  assert.equal(r.status, 'in', 'el pico de retención no cuenta como subida');
  assert.equal(r.trend.direction, 'stable');
  assert.ok(r.insights.every((i) => i.level !== 'warn'), texts(r));
  const ret = byId(r, 'weight-cycle-retention');
  assert.equal(ret.level, 'info');
  assert.match(ret.text, /^Es normal que ahora peses algo más: estás en los días previos a la regla/);
  assert.match(ret.text, /no cuenta como subida/);
  assert.ok(ret.sources.some((s) => s.short.startsWith('White')));
  // Marcas en los puntos y en why.data.
  const last = r.trend.points[r.trend.points.length - 1];
  assert.equal(last.retention, 'premenstrual');
  assert.ok(r.trend.points.some((p) => p.retention === 'menstrual'));
  assert.ok(r.trend.excluded.includes(TODAY));
  assert.ok(byId(r, 'weight-rate').why.data.some((d) => d.label === 'Posible retención de líquidos'));
  // La tendencia no sube con el pico (la curva no se mueve esos días).
  assert.ok(Math.abs(last.trendKg - 60) < 0.3, `${last.trendKg}`);
});

test('mujer con ≥ 2 ciclos: el ritmo compara fases equivalentes', () => {
  const bw = series({ start: 60, perWeek: 0.18, days: 58, bump: retBump(C1, 1.2) });
  const r = checkShape(run({ bodyweight: bw, profile: F({ goal: 'gain', experience: 'beginner' }), cycle: C1 }));
  assert.equal(r.trend.method, 'phase');
  assert.ok(r.trend.phaseCompare && r.trend.phaseCompare.startA === '2026-08-04' && r.trend.phaseCompare.startB === '2026-09-01');
  assert.ok(Math.abs(r.trend.ratePerWeekKg - 0.18) < 0.06, `${r.trend.ratePerWeekKg}`);
  assert.equal(r.status, 'in');
  assert.ok(byId(r, 'weight-rate').why.data.some((d) => d.label === 'Fases equivalentes'));
  // Sin marcar la retención (ciclo desconocido) el pico final inflaría la tendencia.
  const noCycle = run({ bodyweight: bw, profile: F({ goal: 'gain', experience: 'beginner' }) });
  assert.ok(noCycle.trend.points[noCycle.trend.points.length - 1].trendKg > r.trend.points[r.trend.points.length - 1].trendKg);
});

test('mujer con un solo ciclo registrado: excluye los días de retención del ritmo', () => {
  const c = cyc(['2026-09-01']);
  const bw = series({ start: 60, days: 35, bump: retBump(c) });
  const r = checkShape(run({ bodyweight: bw, profile: F({ goal: 'maintain' }), cycle: c }));
  assert.equal(r.trend.method, 'no-retention');
  assert.ok(r.trend.excluded.length >= 3);
  assert.equal(r.status, 'in');
});

test('anticonceptivo hormonal: sin fases ni marcas de retención', () => {
  const hc = { ...C1, hormonal: true };
  const bw = series({ start: 60, days: 40 });
  for (const [profile, cycle] of [[F({ goal: 'maintain', contraception: 'combined_pill' }), C1], [F({ goal: 'maintain' }), hc]]) {
    const r = checkShape(run({ bodyweight: bw, profile, cycle }));
    assert.equal(r.trend.method, 'all');
    assert.ok(r.trend.points.every((p) => !p.retention));
    assert.equal(byId(r, 'weight-cycle-retention'), undefined);
    assert.ok(byId(r, 'weight-rate').why.data.some((d) => /hormonal/.test(d.value)));
    assert.equal(r.status, 'in');
  }
  // Hombre con un CycleInfo por error: se ignora.
  const m = run({ bodyweight: bw, profile: M({ goal: 'maintain' }), cycle: C1 });
  assert.ok(m.trend.points.every((p) => !p.retention));
});

// ---------------------------------------------------------------------------
// kcal, proteína y sugerencia de objetivo
// ---------------------------------------------------------------------------

test('kcal/día ≈ ritmo × 7700 / 7 y proteína 1,6–2,2 g/kg con su cálculo', () => {
  const r = checkShape(run({ bodyweight: series({ perWeek: 0.3 }), profile: M() }));
  const expected = (r.trend.ratePerWeekKg * KCAL_PER_KG) / 7;
  assert.ok(Math.abs(r.kcalPerDay.estimate - expected) <= 5, `${r.kcalPerDay.estimate} vs ${expected}`);
  assert.ok(r.kcalPerDay.estimate > 250 && r.kcalPerDay.estimate < 400);
  const kg = r.proteinG.refKg;
  assert.ok(Math.abs(r.proteinG.min - kg * 1.6) <= 2.5 && Math.abs(r.proteinG.max - kg * 2.2) <= 2.5);
  const p = byId(r, 'weight-protein');
  assert.equal(p.level, 'info');
  assert.match(p.text, /1,6–2,2 g por kilo/);
  assert.ok(p.why.data.some((d) => d.label === 'Cálculo' && /× 1,6/.test(d.value)));
  assert.ok(p.sources.some((s) => s.short.startsWith('Morton')));
  assert.ok(p.priority < byId(r, 'weight-rate').priority, 'informativo < dentro de rango');
  // En déficit: hacia la parte alta.
  const lose = checkShape(run({ bodyweight: series({ start: 80, perWeek: -0.5 }), profile: M({ goal: 'lose' }) }));
  assert.ok(lose.proteinG.focus && lose.proteinG.focus.min >= lose.proteinG.refKg * 2 - 2.5);
  assert.match(byId(lose, 'weight-protein').text, /parte alta/);
  assert.ok(byId(lose, 'weight-rate').why.data.some((d) => d.label === 'Balance estimado' && /7700/.test(d.value)));
});

test('goalSuggestion: ganar músculo con ritmo bajo → objetivo de peso con fechas coherentes', () => {
  const r = checkShape(run({ bodyweight: series({ perWeek: 0.05 }), profile: M() }));
  const gs = r.goalSuggestion;
  assert.ok(gs);
  assert.ok(gs.targetKg > r.trend.currentKg + 1);
  assert.equal(gs.targetKg * 2, Math.round(gs.targetKg * 2), 'redondeado a 0,5 kg');
  assert.match(gs.title, /^Llegar a \d+(,\d)? kg$/);
  assert.ok(gs.byFrom > TODAY && gs.byTo > gs.byFrom);
  // Coherente con el rango (0,25–0,5 %/sem): el extremo rápido al ritmo máximo, el lento al mínimo.
  const gap = gs.targetKg - r.trend.currentKg;
  const weeksFast = diffDays(TODAY, gs.byFrom) / 7;
  const weeksSlow = diffDays(TODAY, gs.byTo) / 7;
  assert.ok(Math.abs(gap / weeksFast - (r.trend.currentKg * 0.5) / 100) < 0.02);
  assert.ok(Math.abs(gap / weeksSlow - (r.trend.currentKg * 0.25) / 100) < 0.02);
  assert.equal(gs.direction, 'up');
  assert.equal(gs.href, `#/goal/new?kind=bodyweight&target=${gs.targetKg}&direction=up`);
  assert.match(gs.text, /^Al ritmo recomendado/);
  // Subiendo demasiado rápido: sin sugerencia.
  assert.equal(run({ bodyweight: series({ perWeek: 0.7 }), profile: M() }).goalSuggestion, undefined);
});

test('todas las fuentes citadas pertenecen a la lista permitida', () => {
  for (const s of Object.values(SOURCES)) assert.ok(allowedSource(s), s.short);
  const late = cyc(['2026-06-01', '2026-06-29', '2026-07-27'], { lateDays: 34 });
  const cases = [
    run({ bodyweight: series({ days: 5 }), profile: F() }),
    run({ bodyweight: series({ perWeek: 0.3 }), profile: M({ goal: null }) }),
    run({ bodyweight: series({ perWeek: 0.7 }), profile: M(), strength: { trendPctPerWeek: 0, n: 2 } }),
    run({ bodyweight: series({ start: 80, perWeek: -1 }), profile: M({ goal: 'lose' }), endurance: { weeklyMinutes4w: 500 }, strength: { trendPctPerWeek: -1, n: 2 } }),
    run({ bodyweight: series({ start: 58, perWeek: -0.4 }), profile: F({ goal: 'lose' }), cycle: late }),
    run({ bodyweight: series({ start: 60, days: 58, bump: retBump(C1) }), profile: F({ goal: 'maintain' }), cycle: C1 }),
    run({ bodyweight: series({ perWeek: -0.3 }), profile: M({ goal: 'performance' }), endurance: { weeklyMinutes4w: 400 } }),
  ];
  let n = 0;
  for (const r of cases) {
    checkShape(r);
    for (const i of r.insights) n += i.sources.length;
  }
  assert.ok(n > 10);
});

test('weightTrend: salida para la vista (puntos, ventana y método)', () => {
  const t = weightTrend(series({ perWeek: 0.3, days: 70, every: 2 }), { today: TODAY, profile: M() });
  assert.equal(t.ok, true);
  assert.equal(t.windowDays, 28);
  assert.ok(t.points.length === 35 && t.points.every((p) => typeof p.trendKg === 'number'));
  assert.ok(t.n >= MIN_POINTS && t.from >= addDays(TODAY, -27));
  assert.equal(t.method, 'all');
  assert.ok(t.ci.lo < t.ratePerWeekKg && t.ci.hi > t.ratePerWeekKg);
  // Pocos pesajes por semana: la ventana se amplía hasta tener 8.
  const sparse = weightTrend(series({ perWeek: 0.3, days: 56, every: 7 }), { today: TODAY, profile: M() });
  assert.equal(sparse.ok, true);
  assert.equal(sparse.windowDays, 56);
  assert.equal(sparse.extended, true);
});
