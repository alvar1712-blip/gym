// Pruebas de la ronda 6, fase C (docs/MEJORAS6.md): confianza común (js/confidence.js), contexto del análisis
// (js/analysis-context.js) y su uso en el peso y la fuerza (js/analysis-weight.js, js/analysis-training.js), con las
// reglas por edad. Hoy = viernes 2 oct 2026. Los datos son sintéticos: ningún ejemplo personal vive en el código.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combine, byCount, bySpan, byNoise, capAt, insufficient, confidenceRow, minLevel, LEVELS } from '../../js/confidence.js';
import { analysisContext, detectReturn, BREAK_DAYS, RETURN_DAYS } from '../../js/analysis-context.js';
import { buildAnalysis } from '../../js/analysis.js';
import { analyzeWeight, weightRegain, SENIOR_MAX_KCAL } from '../../js/analysis-weight.js';
import { analyzeStrength, progressKind, RECOVERY_BELOW_PCT, NEW_EXERCISE_DAYS } from '../../js/analysis-training.js';
import { addDays } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';

const TODAY = '2026-10-02';
const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const settingsFor = (profile) => ({ ...defaultSettings(), profile: { ...defaultSettings().profile, ...profile } });
const ADULT = '2000-05-01';
const MINOR = '2011-03-01';
const SENIOR = '1955-03-01';
const byId = (a, id) => a.all.find((i) => i.id === id);
const allText = (a) => a.all.map((i) => `${i.title} ${i.text}`).join(' | ');

let n = 0;
const benchSes = (date, w, reps = 6, exerciseId = 'press_banca') => ({
  id: `s${++n}`, kind: 'strength', status: 'done', date, startedAt: Date.parse(`${date}T18:00:00`),
  exercises: [{ exerciseId, sets: [0, 1, 2].map((k) => ({ id: `x${n}_${k}`, type: 'effective', done: true, weight: w, reps, rir: 2 })) }],
});
/** Peso: estable en 75 hasta julio, baja a 71,5 en julio-agosto y sube 0,45 kg/sem desde el 1 sep (con ruido). */
function weighIns({ from = 150, up = 0.45, base = 75, low = 71.5 } = {}) {
  const out = [];
  for (let i = from; i >= 0; i--) {
    const d = addDays(TODAY, -i);
    let kg;
    if (d < '2026-07-01') kg = base;
    else if (d < '2026-09-01') kg = base - (base - low) * ((Date.parse(d) - Date.parse('2026-07-01')) / (62 * 864e5));
    else kg = low + up * ((Date.parse(d) - Date.parse('2026-09-01')) / (7 * 864e5));
    const noise = [0.2, -0.3, 0.1, 0.25, -0.15, -0.2, 0.05][i % 7];
    if (i % 2 === 0 || d >= '2026-09-01') out.push({ id: d, kg: Math.round((kg + noise) * 10) / 10 });
  }
  return out;
}
/** Banca: mayo-junio entrenando, parón julio-agosto, vuelta el 8 sep subiendo deprisa. */
function benchHistory() {
  return [
    ...[['2026-05-05', 85], ['2026-05-19', 87.5], ['2026-06-02', 90], ['2026-06-16', 90], ['2026-06-30', 92.5]].map(([d, w]) => benchSes(d, w)),
    ...[['2026-09-08', 72.5], ['2026-09-11', 75], ['2026-09-15', 77.5], ['2026-09-18', 77.5], ['2026-09-22', 80], ['2026-09-25', 82.5], ['2026-09-29', 82.5], ['2026-10-01', 85]].map(([d, w]) => benchSes(d, w)),
  ];
}
const CREATINE = { id: 'c1', kind: 'event', type: 'creatine_start', date: { date: '2026-09-20', precision: 'day' }, text: '' };
// 102,5 × 5 (≈ 119,6 kg est.) supera lo registrado antes del parón (92,5 × 6 @2 ≈ 117,2): la referencia es la marca.
const MARK = { id: 'pr1', exerciseId: 'press_banca', weight: 102.5, reps: 5, rir: null, date: { date: '2025-06-01', precision: 'season' }, beforeApp: true, note: '' };
function data({ profile = {}, sessions = benchHistory(), bodyweight = weighIns(), context = [CREATINE], pastRecords = [MARK], ...over } = {}) {
  return {
    sessions, bodyweight, exercises: EX, templates: new Map(), plan: new Map(),
    settings: settingsFor({ sex: 'male', goal: 'gain', experience: 'advanced', birthDate: ADULT, ...profile }),
    today: TODAY, checkins: [], cycleDays: [], context, pastRecords, ...over,
  };
}

// ===========================================================================
// confidence.js
// ===========================================================================

test('confianza: cuatro niveles sin probabilidades; manda el factor más débil y se dice por qué', () => {
  assert.deepEqual(LEVELS, ['insufficient', 'low', 'medium', 'high']);
  assert.equal(minLevel('high', 'low'), 'low');
  const th = { low: 8, medium: 12, high: 18 };
  assert.deepEqual([3, 8, 12, 18, 40].map((k) => byCount(k, th, (x) => `${x} pesajes`).level), ['insufficient', 'low', 'medium', 'high', 'high']);
  assert.equal(bySpan(27, { low: 14, medium: 21, high: 28 }).reason, 'datos de solo 27 días (para confianza alta, 4 semanas o más)');
  assert.equal(bySpan(28, { low: 14, medium: 21, high: 28 }).reason, 'datos de 4 semanas');
  assert.equal(byNoise(2, { medium: 0.9, low: 1.5 }).level, 'low');
  const c = combine([byCount(20, th, (x) => `${x} pesajes`), capAt('medium', 'empezaste creatina'), capAt('medium', 'empezaste creatina'), null]);
  assert.equal(c.level, 'medium');
  assert.equal(c.label, 'Confianza media');
  assert.deepEqual(c.reasons, ['empezaste creatina'], 'motivos sin repetir, solo los que la limitan');
  assert.deepEqual(c.basis, ['20 pesajes', 'empezaste creatina']);
  assert.equal(insufficient('sin pesajes').level, 'insufficient');
  assert.deepEqual(confidenceRow(c), { label: 'Confianza', value: 'Media: empezaste creatina' });
  assert.equal(combine([]).level, 'high', 'sin factores no se inventa nada que la baje');
  for (const v of Object.values(c)) assert.ok(typeof v !== 'number', 'nunca un número (no es una probabilidad)');
});

// ===========================================================================
// analysis-context.js
// ===========================================================================

test('contexto: parón y vuelta detectados por las fechas, o apuntados; creatina; fase; salud; edad', () => {
  const ses = (date) => ({ id: date, date, kind: 'strength', status: 'done' });
  // Hueco de 10 semanas que termina el 8 sep (hace < 8 semanas) → vuelta detectada
  const sessions = [ses('2026-06-10'), ses('2026-07-01'), ses('2026-09-08'), ses('2026-09-15')];
  assert.deepEqual(detectReturn(sessions, TODAY), { since: '2026-09-08', gapDays: 69, gapFrom: '2026-07-01' });
  assert.equal(detectReturn([ses('2026-06-01'), ses('2026-06-10')], TODAY), null, 'sin sesiones recientes no hay «vuelta»');
  const weekly = [];
  for (let d = '2026-03-08'; d <= '2026-09-27'; d = addDays(d, 7)) weekly.push(ses(d));
  assert.equal(detectReturn([ses('2026-01-01'), ...weekly], TODAY), null, 'el parón de hace meses ya no cuenta');
  assert.ok(BREAK_DAYS === 21 && RETURN_DAYS === 56);

  const ctx = analysisContext({
    context: [CREATINE, { id: 'p1', kind: 'phase', type: 'deficit', start: { date: '2026-09-01', precision: 'month' }, end: null, text: '' },
      { id: 'u', kind: 'event', type: 'usual_weight', date: { date: '2026-01-01', precision: 'year' }, kg: 76, text: '' },
      { id: 'i', kind: 'event', type: 'illness', date: { date: '2026-09-25', precision: 'day' }, text: '' }],
    sessions, today: TODAY, profile: { birthDate: SENIOR },
  });
  assert.deepEqual([ctx.training.returning, ctx.training.source, ctx.training.since], [true, 'detected', '2026-09-08']);
  assert.deepEqual([ctx.creatine.start, ctx.creatine.days, ctx.creatine.early, ctx.creatine.water], ['2026-09-20', 12, true, true]);
  assert.deepEqual([ctx.body.type, ctx.body.goal], ['deficit', 'lose']);
  assert.ok(ctx.health.illness, 'enfermedad reciente');
  assert.deepEqual(ctx.usualWeight.kg, 76);
  assert.equal(ctx.age.group, 'senior');
  assert.ok(ctx.labels.some((l) => /^Vuelta tras 10 semanas sin entrenar/.test(l.text)));
  assert.ok(ctx.labels.some((l) => l.text === 'Peso habitual apuntado: 76 kg'));
  assert.ok(ctx.changes.some((c) => c.text === 'Empiezo creatina (20 sep)'));

  // Apuntada: una fase «Vuelta» manda sobre la detectada; dejar la creatina la quita
  const ctx2 = analysisContext({
    context: [{ id: 'r', kind: 'phase', type: 'return', start: { date: '2026-09-01', precision: 'month' }, end: null, text: '' }, CREATINE,
      { id: 'c2', kind: 'event', type: 'creatine_stop', date: { date: '2026-09-28', precision: 'day' }, text: '' }],
    sessions: [], today: TODAY,
  });
  assert.deepEqual([ctx2.training.returning, ctx2.training.source, ctx2.creatine], [true, 'context', null]);
  assert.equal(ctx2.age.group, 'unknown', 'sin fecha de nacimiento: reglas de adulto');
});

// ===========================================================================
// Peso con contexto
// ===========================================================================

test('peso: sube 0,45 kg/sem tras una bajada, la vuelta a entrenar y creatina → mantener y reevaluar (sin recortar calorías)', () => {
  const a = buildAnalysis(data(), TODAY);
  assert.deepEqual(a.errors, []);
  const w = byId(a, 'weight-rate');
  assert.equal(w.title, 'Subes rápido, pero hay contexto');
  assert.equal(w.level, 'neutral');
  assert.match(w.parts.observation, /^Tu tendencia sube 0,\d+ kg por semana/);
  assert.match(w.parts.interpretation, /^Ese ritmo sería elevado en una fase estable de ganancia muscular/);
  assert.match(w.parts.interpretation, /vienes de una bajada de peso reciente .* has vuelto a entrenar .* empezaste creatina el 20 sep/);
  assert.match(w.parts.interpretation, /Parte del aumento podría corresponder a recuperar peso previo, glucógeno y agua .* agua por la creatina/);
  assert.equal(w.parts.recommendation, 'Mantén lo que haces y reevalúa en 3–4 semanas, cuando haya más datos estables.');
  assert.equal(w.text, `${w.parts.observation} ${w.parts.interpretation} ${w.parts.recommendation}`, 'el texto completo sigue ahí (compatibilidad)');
  assert.ok(['low', 'medium'].includes(w.confidence.level), w.confidence.level);
  assert.ok(w.confidence.reasons.some((r) => /creatina/.test(r)));
  assert.equal(w.context.length, 3);
  assert.ok(w.why.data.some((r) => r.label === 'Confianza'));
  assert.ok(w.sources.some((s) => s.short === 'Kreider et al., 2017'));
  // Sin cifras de dieta ni proyección ni objetivo propuesto
  assert.deepEqual(a.weight.kcalPerDay, { estimate: null, suggestion: null });
  assert.equal(a.weight.goalSuggestion, undefined);
  assert.equal(byId(a, 'forecast-weight'), undefined);
  assert.doesNotMatch(allText(a), /kcal menos|has ganado .* de músculo|seguro que es agua/i);
  // «Peso y fuerza»: no afirma que sea músculo
  const ws = byId(a, 'weight-strength');
  assert.match(ws.text, /Aún no se puede saber cuánto de lo que ganas es músculo/);
  assert.doesNotMatch(ws.text, /sobre todo músculo/);
});

test('peso: el mismo ritmo SIN contexto (sin bajada previa ni vuelta ni creatina) sí pide ajustar la comida', () => {
  const bw = weighIns({ from: 31 }); // solo el tramo de subida
  const ses = benchHistory().filter((s) => s.date >= '2026-09-01');
  const a = buildAnalysis(data({ bodyweight: bw, context: [], sessions: ses }), TODAY);
  const w = byId(a, 'weight-rate');
  assert.equal(w.title, 'Subes más rápido de lo necesario');
  assert.match(w.text, /kcal menos al día/);
  assert.equal(a.weight.regain, null);
  assert.ok(w.confidence, 'con su confianza');
});

test('peso: recuperar el peso habitual apuntado también explica la subida; ya recuperado, deja de explicarla', () => {
  const bw = weighIns({ from: 31 });
  const usual = { id: 'u', kind: 'event', type: 'usual_weight', date: { date: '2026-01-01', precision: 'year' }, kg: 75, text: '' };
  const a = buildAnalysis(data({ bodyweight: bw, context: [usual], sessions: [] }), TODAY);
  assert.equal(byId(a, 'weight-rate').title, 'Subes rápido, pero hay contexto');
  assert.match(byId(a, 'weight-rate').parts.interpretation, /estás por debajo de tu peso habitual \(75 kg\)/);
  // weightRegain: con el peso ya en el habitual, `complete`
  const t = { ok: true, ratePerWeekKg: 0.4, from: '2026-09-04', currentKg: 75.1, points: [{ date: '2026-09-04', kg: 72, trendKg: 72 }] };
  assert.equal(weightRegain(t, { usualWeight: { kg: 75 } }).complete, true);
  assert.equal(weightRegain({ ...t, ratePerWeekKg: -0.1 }, { usualWeight: { kg: 75 } }), null, 'solo si sube');
});

test('peso: con pocos pesajes (confianza baja) no se cambia lo que comes; bajar demasiado rápido sí se dice', () => {
  const few = [];
  for (let i = 15; i >= 0; i -= 2) few.push({ id: addDays(TODAY, -i), kg: 75 + (15 - i) * 0.12 }); // 8 pesajes en 14 días, +0,8 kg/sem
  const a = analyzeWeight({ bodyweight: few, today: TODAY, profile: { sex: 'male', goal: 'maintain', experience: 'intermediate' } });
  const w = a.insights.find((i) => i.id === 'weight-rate');
  assert.equal(a.confidence.level, 'low');
  assert.equal(w.title, 'Aún es pronto para ajustar');
  assert.match(w.parts.recommendation, /^Aún es pronto para cambiar lo que comes/);
  assert.equal(a.kcalPerDay.suggestion, null);
  assert.equal(a.projectable, false);
  const fast = [];
  for (let i = 15; i >= 0; i -= 2) fast.push({ id: addDays(TODAY, -i), kg: 80 - (15 - i) * 0.2 }); // bajando ~1,4 kg/sem
  const b = analyzeWeight({ bodyweight: fast, today: TODAY, profile: { sex: 'male', goal: 'lose', experience: 'intermediate' } });
  assert.ok(b.insights.some((i) => /weight-reds|weight-rate/.test(i.id) && /rápido/.test(i.title)), 'bajar demasiado rápido se avisa igual');
});

test('peso: la fase de composición vigente manda sobre el objetivo del perfil; una enfermedad explica una bajada', () => {
  const down = [];
  for (let i = 35; i >= 0; i--) down.push({ id: addDays(TODAY, -i), kg: Math.round((76 - (35 - i) * 0.12 + [0.2, -0.2, 0.1, -0.1][i % 4]) * 10) / 10 });
  const deficit = { id: 'p', kind: 'phase', type: 'deficit', start: { date: '2026-08-01', precision: 'month' }, end: null, text: '' };
  const a = buildAnalysis(data({ bodyweight: down, context: [deficit], sessions: [], pastRecords: [] }), TODAY);
  assert.equal(a.weight.goal, 'lose');
  assert.equal(a.weight.goalSource, 'phase');
  assert.match(byId(a, 'weight-rate').why.rule, /según tu fase actual/);
  const ill = { id: 'i', kind: 'phase', type: 'illness', start: { date: '2026-09-10', precision: 'day' }, end: null, text: '' };
  const b = buildAnalysis(data({ bodyweight: down, context: [ill], sessions: [], pastRecords: [] }), TODAY); // objetivo del perfil: ganar
  const w = byId(b, 'weight-rate');
  assert.equal(w.title, 'Bajas, pero hay contexto');
  assert.match(w.parts.interpretation, /has estado o estás enfermo/);
  assert.match(w.parts.recommendation, /^Mientras te recuperas, come lo suficiente/);
  assert.equal(b.weight.kcalPerDay.suggestion, null);
});

test('edad: menores sin calorías, sin ritmos de pérdida, sin «déficit» ni proyección del peso; mayores con ajustes prudentes', () => {
  const minor = buildAnalysis(data({ profile: { birthDate: MINOR, goal: 'lose' }, context: [] }), TODAY);
  assert.equal(minor.context.age.group, 'minor');
  const w = byId(minor, 'weight-rate');
  assert.equal(w.title, 'Tu peso, sin cifras de dieta');
  assert.match(w.parts.interpretation, /no se marcan ritmos para bajar de peso ni calorías/);
  assert.ok(w.sources.some((s) => s.short === 'Lloyd et al., 2014'));
  assert.deepEqual(minor.weight.kcalPerDay, { estimate: null, suggestion: null });
  assert.equal(minor.weight.goalSuggestion, undefined);
  assert.equal(byId(minor, 'forecast-weight'), undefined);
  assert.equal(minor.forecast.filter((f) => /^forecast-press/.test(f.id)).length, 0, 'sin previsiones de 1RM');
  assert.doesNotMatch(allText(minor), /kcal|déficit/);
  assert.match(byId(minor, 'strength-summary').text, /Con menos de 18 años lo importante es la técnica/);

  // 65 o más perdiendo poco: mitad prudente del rango y ajuste ≤ 250 kcal
  const slow = [];
  for (let i = 35; i >= 0; i--) slow.push({ id: addDays(TODAY, -i), kg: Math.round((80 - (35 - i) * 0.014 + [0.2, -0.2, 0.1, -0.1][i % 4]) * 10) / 10 });
  const senior = buildAnalysis(data({ profile: { birthDate: SENIOR, goal: 'lose' }, bodyweight: slow, context: [], pastRecords: [] }), TODAY);
  assert.equal(senior.weight.target.recommended.reason, 'senior');
  const sug = senior.weight.kcalPerDay.suggestion;
  assert.ok(sug && Math.max(Math.abs(sug.min), Math.abs(sug.max)) <= SENIOR_MAX_KCAL, JSON.stringify(sug));
  assert.ok(byId(senior, 'weight-rate').sources.some((s) => s.short === 'Fragala et al., 2019'));
  assert.match(byId(senior, 'strength-summary').text, /A partir de los 65, mejor progresar con calma/);
});

// ===========================================================================
// Fuerza: nueva marca, recuperación, ejercicio nuevo, datos insuficientes
// ===========================================================================

test('fuerza: por debajo de la marca histórica y subiendo → recuperación (no «progreso por encima de tu nivel»)', () => {
  const a = buildAnalysis(data(), TODAY);
  const row = a.strength.exercises.find((x) => x.exerciseId === 'press_banca');
  assert.equal(row.kind, 'recovery');
  assert.ok(row.recovery.pct < RECOVERY_BELOW_PCT, String(row.recovery.pct));
  assert.equal(row.recovery.refSource, 'mark');
  assert.match(row.recovery.refLabel, /^102,5 kg × 5 · verano 2025 \(marca histórica\)$/);
  const r = byId(a, 'strength-recovery');
  assert.equal(r.title, 'Press banca: recuperando tu marca anterior');
  assert.match(r.parts.interpretation, /^Es compatible con recuperar rendimiento que ya habías alcanzado/);
  assert.match(r.parts.interpretation, /No es un dato de tu músculo/);
  assert.ok(['low', 'medium'].includes(r.confidence.level));
  assert.match(byId(a, 'strength-summary').text, /No estás necesariamente progresando a \+\d+,\d %\/sem por encima de tu nivel/);
  assert.equal(a.strength.summary.recoveryShare, 1);
  // La previsión no pasa de la marca anterior
  const fc = row.forecast;
  assert.ok(fc.length && fc.every((f) => f.high <= Math.ceil(row.recovery.refE1rm * 2) / 2), JSON.stringify(fc));
  // Marca cercana (97,5 × 5 ≈ 113,8 kg est.) y solo lo registrado tras el parón: el tope se aplica y se dice
  const near = { ...MARK, weight: 97.5 };
  const b = buildAnalysis(data({ pastRecords: [near], sessions: benchHistory().filter((x) => x.date >= '2026-09-01') }), TODAY);
  const rb = b.strength.exercises.find((x) => x.exerciseId === 'press_banca');
  assert.equal(rb.kind, 'recovery');
  assert.ok(rb.forecast.some((f) => f.capped), JSON.stringify(rb.forecast));
  assert.ok(rb.forecast.every((f) => f.high <= Math.ceil(rb.recovery.refE1rm * 2) / 2 && f.low <= f.mid && f.mid <= f.high));
  assert.match(byId(b, 'forecast-press_banca').text, /el tope de la previsión es esa marca/);
});

test('fuerza: superar la marca → mejor marca; ejercicio nuevo sin marca → adaptación inicial; pocas sesiones → insuficiente', () => {
  // Marca baja y sin historial anterior en Entreno: ya la has superado
  const low = { ...MARK, weight: 70 };
  const afterBreak = benchHistory().filter((x) => x.date >= '2026-09-01');
  const a = buildAnalysis(data({ pastRecords: [low], sessions: afterBreak }), TODAY);
  assert.equal(a.strength.exercises.find((x) => x.exerciseId === 'press_banca').kind, 'new_best');
  // Con lo registrado antes del parón por encima, en cambio, es recuperación (referencia: Entreno)
  const withApp = buildAnalysis(data({ pastRecords: [low] }), TODAY).strength.exercises.find((x) => x.exerciseId === 'press_banca');
  assert.deepEqual([withApp.kind, withApp.recovery.refSource], ['recovery', 'app']);
  assert.equal(byId(a, 'strength-recovery'), undefined);
  // Ejercicio nuevo: empezado hace < 6 semanas y sin marca
  const fresh = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'].map((d, i) => benchSes(d, 40 + i * 2.5, 8, 'press_militar'));
  const b = buildAnalysis(data({ sessions: fresh, pastRecords: [], context: [] }), TODAY);
  const row = b.strength.exercises.find((x) => x.exerciseId === 'press_militar');
  assert.equal(row.kind, 'new_exercise');
  const ni = byId(b, 'strength-new');
  assert.equal(ni.title, 'Press militar con barra: primeras semanas');
  assert.match(ni.parts.interpretation, /adaptación inicial/);
  assert.equal(ni.confidence.level, 'low');
  assert.ok(NEW_EXERCISE_DAYS === 42);
  // Pocas sesiones: sin conclusión
  const c = buildAnalysis(data({ sessions: fresh.slice(0, 2), pastRecords: [], context: [], bodyweight: [] }), TODAY);
  const ins = byId(c, 'strength-insufficient');
  assert.equal(ins.confidence.level, 'insufficient');
  assert.equal(c.strength.exercises[0].kind, 'insufficient');
  assert.equal(progressKind({ trend: { ok: false } }), 'insufficient');
});

test('fuerza: todas las conclusiones llevan su confianza; los récords de Entreno y las marcas siguen separados', () => {
  const a = buildAnalysis(data(), TODAY);
  for (const i of a.all.filter((x) => (x.area === 'strength' || x.id.startsWith('forecast-')) && x.id !== 'forecast-weight')) {
    assert.ok(i.confidence && LEVELS.includes(i.confidence.level), `${i.id} sin confianza`);
  }
  // analyzeStrength no toca las marcas: solo las lee
  const d = data();
  const before = JSON.stringify(d.pastRecords);
  analyzeStrength(d, { today: TODAY });
  assert.equal(JSON.stringify(d.pastRecords), before);
});

test('modo mujer: el ciclo sigue funcionando junto al contexto y la confianza', () => {
  const cycleDays = [];
  for (const start of ['2026-07-10', '2026-08-07', '2026-09-04']) for (let k = 0; k < 5; k++) cycleDays.push({ id: addDays(start, k), flow: k < 2 ? 'medium' : 'light', symptoms: [], notes: '' });
  const bw = [];
  for (let i = 60; i >= 0; i--) bw.push({ id: addDays(TODAY, -i), kg: 62 + [0.2, -0.2, 0.1, -0.1, 0.3][i % 5] });
  const a = buildAnalysis(data({ profile: { sex: 'female', goal: 'maintain', experience: 'intermediate', cycleTracking: true, contraception: 'none' }, bodyweight: bw, cycleDays, context: [CREATINE] }), TODAY);
  assert.deepEqual(a.errors, []);
  assert.ok(a.cycle && a.cycle.info.periods.length === 3, 'ciclo con sus reglas');
  assert.ok(byId(a, 'weight-rate').confidence, 'el peso lleva su confianza');
  assert.ok(a.context.creatine);
  // Anticonceptivo hormonal: sin fases, sin errores
  const h = buildAnalysis(data({ profile: { sex: 'female', goal: 'maintain', contraception: 'combined_pill' }, bodyweight: bw, cycleDays }), TODAY);
  assert.deepEqual(h.errors, []);
  assert.equal(h.cycle.hormonal, true);
});
