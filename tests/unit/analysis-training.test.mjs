// Pruebas de js/analysis-training.js («tu analista» de entrenamiento, docs/MEJORAS5.md §3b) con datos sintéticos.
// Hoy = jueves 24 sep 2026 (inyectado con { today }).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeStrength, analyzeEndurance, analyzeRecovery, theilSen, median, exerciseTrend, stallState, strengthStatus,
  forecastE1rm, classifyIntensity, intensitySplit, findInterference, fitnessBlocks, sessionPerformance, compareByCheckin,
  cyclePhase, experienceOf, isMainExercise, rateText, SOURCES, THRESHOLDS, TAU_WEEKS,
} from '../../js/analysis-training.js';
import { getProfile } from '../../js/profile.js';
import { defaultSettings, SEED_EXERCISES } from '../../js/seed.js';
import { addDays, tsFromDate, fmtDate } from '../../js/util.js';

const TODAY = '2026-09-24';
const ago = (n) => addDays(TODAY, -n);
const EXMAP = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
const approx = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

let seq = 0;
const set = (weight, reps = 5, rir = 0, extra = {}) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir, done: true, doneAt: 1, ...extra });
/** Peso para un 1RM estimado dado (Epley con reps + RIR). */
const wFor = (e1rm, reps = 5, rir = 0) => e1rm / (1 + (reps + rir) / 30);
function ses(date, items, extra = {}) {
  const id = extra.id || `s${++seq}`;
  return {
    id, kind: 'strength', date, planDate: date, status: 'done', parentId: null, templateId: null, templateName: 'Sesión',
    startedAt: tsFromDate(date, extra.hour ?? 18), createdAt: tsFromDate(date, extra.hour ?? 18), durationMin: 60, rpe: extra.rpe ?? 7,
    exercises: items.map(([exerciseId, sets], i) => ({ id: `${id}_se${i}`, exerciseId, exName: exerciseId, sets })),
  };
}
function act(kind, date, { min = 45, km = null, rpe = null, subtype = null, hour = 8, ...extra } = {}) {
  return {
    id: `a${++seq}`, kind, date, planDate: date, status: 'done', parentId: null, startedAt: tsFromDate(date, hour),
    createdAt: tsFromDate(date, hour), durationMin: min, movingSec: extra.movingSec ?? min * 60, distanceKm: km, rpe, subtype, ...extra,
  };
}
function mk(over = {}) {
  return { sessions: [], exercises: EXMAP, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], checkins: [], today: TODAY, ...over };
}
const prof = (o = {}) => getProfile({ profile: o });

/**
 * Sesiones de fuerza: n sesiones cada `step` días (la más reciente hace `first` días); specs = { exerciseId: (i, weeks) →
 * 1RM estimado } (i = 0 la más antigua; weeks = semanas desde la primera). sets = series por ejercicio.
 */
function strengthSessions(specs, { n = 14, step = 4, first = 2, sets = 1, rpe = 7 } = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const offset = first + step * (n - 1 - i);
    const weeks = (step * i) / 7;
    const items = [];
    for (const [id, fn] of Object.entries(specs)) {
      const e = fn(i, weeks);
      if (e == null) continue;
      items.push([id, Array.from({ length: sets }, () => set(wFor(e)))]);
    }
    out.push(ses(ago(offset), items, { rpe: typeof rpe === 'function' ? rpe(i) : rpe }));
  }
  return out;
}

const AREAS = ['weight', 'strength', 'endurance', 'recovery', 'cycle', 'forecast'];
const LEVELS = ['good', 'neutral', 'warn', 'info'];
/** Fuentes permitidas (docs/MEJORAS5.md §5). */
const ALLOWED = [
  'Morton et al., 2018', 'Jäger et al., 2017', 'Iraki et al., 2019', 'Helms et al., 2014', 'Garthe et al., 2011', 'Hall, 2008',
  'Mountjoy et al., 2023', 'Schoenfeld et al., 2017', 'Roberts et al., 2020', 'Seiler, 2010', 'Schumann et al., 2022',
  'Eddens et al., 2018', 'Knowles et al., 2018', 'McNulty et al., 2020', 'Colenso-Semple et al., 2023', 'Elliott-Sale et al., 2020',
  'White et al., 2011', 'Munro et al., 2018', 'Fraser et al., 2018', 'Pedlar et al., 2018', 'Bruinvels et al., 2016',
];
const seen = [];
/** Comprueba la forma de todos los Insight (y los guarda para la prueba de fuentes). */
function checkInsights(list) {
  const ids = new Set();
  for (const i of list) {
    seen.push(i);
    assert.ok(i.id && !ids.has(i.id), `id único: ${i.id}`);
    ids.add(i.id);
    assert.ok(AREAS.includes(i.area), `área ${i.area}`);
    assert.ok(LEVELS.includes(i.level), `nivel ${i.level}`);
    assert.ok(Number.isInteger(i.priority) && i.priority >= 0 && i.priority <= 100, `prioridad ${i.priority}`);
    assert.ok(i.title && i.text, 'título y texto');
    assert.ok(i.why && i.why.rule && i.why.rule.length > 20, 'why.rule');
    assert.ok(Array.isArray(i.why.data) && i.why.data.length > 0, 'why.data');
    for (const r of i.why.data) assert.ok(r.label != null && r.value != null, 'fila de why');
    assert.ok(Array.isArray(i.sources));
    if (i.action) assert.ok(i.action.label && i.action.href.startsWith('#/'));
    assert.ok(!/undefined|NaN|null/.test(`${i.title} ${i.text}`), `sin huecos en el texto: ${i.text}`);
  }
  return list;
}
const byId = (list, id) => list.find((i) => i.id === id);

// ---------------------------------------------------------------------------
// Piezas puras
// ---------------------------------------------------------------------------

test('theilSen: pendiente robusta (un valor atípico no la mueve) y casos límite', () => {
  const pts = [0, 1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 2 * x + 1 }));
  pts[3].y = 40; // atípico
  const f = theilSen(pts);
  approx(f.slope, 2);
  approx(f.intercept, 1);
  assert.equal(f.n, 7);
  approx(f.mad, 0); // el resto está en la recta
  assert.equal(theilSen([{ x: 1, y: 2 }]), null);
  assert.equal(theilSen([{ x: 1, y: 2 }, { x: 1, y: 3 }]), null); // misma x
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test('strengthStatus y umbrales por experiencia; experiencia sin contestar → intermedio', () => {
  assert.equal(strengthStatus({ ratePctPerWeek: 1 }, 'beginner').status, 'good');
  assert.equal(strengthStatus({ ratePctPerWeek: 1.6 }, 'beginner').status, 'fast');
  assert.equal(strengthStatus({ ratePctPerWeek: 1 }, 'advanced').status, 'fast');
  assert.equal(strengthStatus({ ratePctPerWeek: 0.3 }, 'intermediate').status, 'good');
  const slow = strengthStatus({ ratePctPerWeek: 0.3 }, 'beginner');
  assert.equal(slow.status, 'good');
  assert.equal(slow.slow, true);
  assert.equal(strengthStatus({ ratePctPerWeek: 1, stalled: true }, 'beginner').status, 'stalled');
  assert.equal(strengthStatus({ ratePctPerWeek: -0.05 }, 'beginner').status, 'stalled');
  assert.equal(strengthStatus({ ratePctPerWeek: -0.5, totalChangePct: -3 }, 'advanced').status, 'down');
  assert.equal(strengthStatus({ ratePctPerWeek: -0.5, totalChangePct: -1 }, 'advanced').status, 'stalled'); // caída pequeña
  assert.deepEqual(experienceOf({ experience: null }), { id: 'intermediate', assumed: true });
  assert.deepEqual(experienceOf({ experience: 'advanced' }), { id: 'advanced', assumed: false });
  assert.equal(rateText(1.123), '+1,1 %/sem');
  assert.equal(rateText(0.154), '+0,15 %/sem');
  assert.equal(rateText(-0.4), '−0,4 %/sem');
  assert.equal(isMainExercise(EXMAP.get('sentadilla')), true);
  assert.equal(isMainExercise(EXMAP.get('curl_barra')), false);
  assert.equal(isMainExercise(EXMAP.get('saltos_verticales')), false);
});

// ---------------------------------------------------------------------------
// Fuerza
// ---------------------------------------------------------------------------

test('fuerza: el mismo progreso es «bien» para un principiante y «rápido» para un avanzado', () => {
  const data = mk({ sessions: strengthSessions({ sentadilla: (i, w) => 100 * (1 + 0.01 * w) }) });
  const beg = analyzeStrength(data, { today: TODAY, profile: prof({ experience: 'beginner' }) });
  const adv = analyzeStrength(data, { today: TODAY, profile: prof({ experience: 'advanced' }) });
  checkInsights(beg.insights);
  checkInsights(adv.insights);
  const b = beg.exercises[0];
  const a = adv.exercises[0];
  assert.equal(b.exerciseId, 'sentadilla');
  assert.ok(b.ratePctPerWeek > 0.8 && b.ratePctPerWeek < 1.0, `ritmo ${b.ratePctPerWeek}`);
  assert.equal(b.status, 'good');
  assert.equal(a.status, 'fast');
  assert.equal(b.sessions, 10); // ventana de 6 semanas (≥ 6 sesiones)
  assert.ok(b.e1rmNow > 100 && b.e1rmNow < 110);
  assert.equal(b.lastPrDate, ago(2));
  assert.equal(beg.summary.experience, 'beginner');
  assert.equal(beg.summary.experienceAssumed, false);
});

test('fuerza: estancado (settings.stall), bajando e insuficiente', () => {
  const flat = [100, 101, 102, 100, 101, 100.5, 101, 100, 101.5, 100.5, 101, 100.5, 101, 100.5];
  const data = mk({
    sessions: strengthSessions({
      press_banca: (i) => flat[i],
      peso_muerto: (i, w) => 150 * (1 - 0.01 * w),
      curl_barra: (i) => (i >= 11 ? 30 + i : null), // 3 sesiones
    }),
  });
  const r = analyzeStrength(data, { today: TODAY, profile: prof({ experience: 'intermediate' }) });
  checkInsights(r.insights);
  const ex = Object.fromEntries(r.exercises.map((x) => [x.exerciseId, x]));
  assert.equal(ex.press_banca.status, 'stalled');
  assert.equal(ex.peso_muerto.status, 'down');
  assert.ok(ex.peso_muerto.ratePctPerWeek < -0.9);
  assert.equal(ex.curl_barra.status, 'insufficient');
  assert.match(ex.curl_barra.reason, /3 sesiones/);
  assert.deepEqual(ex.curl_barra.forecast, []);
  assert.equal(r.exercises[r.exercises.length - 1].status, 'insufficient'); // los insuficientes, al final
  assert.equal(r.summary.stalled, 1);
  assert.equal(r.summary.down, 1);
  assert.equal(r.summary.improving, 0);
  const st = byId(r.insights, 'strength-stalled-press_banca');
  assert.ok(st);
  assert.equal(st.level, 'warn');
  assert.match(st.text, /Qué probar/);
  assert.match(st.text, /repeticiones/);
  assert.match(st.text, /proteína \(1,6–2,2 g\/kg/);
  const dn = byId(r.insights, 'strength-down-peso_muerto');
  assert.ok(dn);
  assert.match(dn.title, /Peso muerto baja/);
  assert.match(dn.text, /baja un 1 % por semana|baja un 1,\d % por semana|baja un 0,9 % por semana/);
  assert.equal(dn.action.href, '#/progress/exercise/peso_muerto');
  // En déficit, bajar es esperable: neutral y con Helms.
  const lose = analyzeStrength(data, { today: TODAY, profile: prof({ experience: 'intermediate', goal: 'lose' }) });
  const dl = byId(lose.insights, 'strength-down-peso_muerto');
  assert.equal(dl.level, 'neutral');
  assert.ok(dl.sources.some((s) => s.short === SOURCES.helms2014.short));
});

test('fuerza: datos insuficientes en todo → un único aviso con lo que falta', () => {
  const data = mk({ sessions: strengthSessions({ sentadilla: (i) => 100 + i }, { n: 3 }) });
  const r = analyzeStrength(data, { today: TODAY });
  checkInsights(r.insights);
  assert.equal(r.exercises.length, 1);
  assert.equal(r.exercises[0].status, 'insufficient');
  assert.equal(r.summary.trendPctPerWeek, null);
  assert.deepEqual(r.insights.map((i) => i.id), ['strength-insufficient']);
  assert.match(r.insights[0].text, /Sentadilla \(3 sesiones\)/);
  // 4 sesiones en solo 2 semanas → insuficiente por semanas
  const t = exerciseTrend([0, 3, 6, 9].map((d) => ({ date: ago(d), e1rm: 100 + d })), { today: TODAY });
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'weeks');
  // Solo ejercicios sin sesiones recientes → mensaje de retomar
  const stale = analyzeStrength(mk({ sessions: strengthSessions({ sentadilla: (i) => 100 + i }, { n: 5, first: 40 }) }), { today: TODAY });
  checkInsights(stale.insights);
  assert.match(stale.insights[0].text, /^Hace más de 4 semanas que no registras/);
  // Sin nada de fuerza → sin mensajes
  assert.deepEqual(analyzeStrength(mk(), { today: TODAY }).insights, []);
  // Última sesión de hace más de 4 semanas → 'old'
  const old = exerciseTrend([40, 45, 50, 55, 60].map((d) => ({ date: ago(d), e1rm: 100 })), { today: TODAY });
  assert.equal(old.reason, 'old');
});

test('fuerza: previsión a 4 y 8 semanas con rango, fechas y rendimientos decrecientes; tope por experiencia', () => {
  const noise = [0.6, -0.4, 0.2, -0.6, 0.5, 0, -0.3, 0.4, -0.5, 0.3, 0, -0.2, 0.4, -0.1];
  const data = mk({ sessions: strengthSessions({ press_banca: (i, w) => 80 * (1 + 0.006 * w) + noise[i] }) });
  const r = analyzeStrength(data, { today: TODAY, profile: prof({ experience: 'intermediate' }) });
  checkInsights(r.insights);
  const x = r.exercises[0];
  assert.equal(x.forecast.length, 2);
  const [f4, f8] = x.forecast;
  assert.equal(f4.weeks, 4);
  assert.equal(f8.weeks, 8);
  assert.equal(f4.date, addDays(TODAY, 28));
  assert.equal(f8.date, addDays(TODAY, 56));
  assert.ok(f4.low < f4.mid && f4.mid < f4.high, JSON.stringify(f4));
  assert.ok(f8.high - f8.low > f4.high - f4.low, 'el rango se abre con el tiempo');
  assert.ok(f4.mid > x.e1rmNow && f8.mid > f4.mid);
  assert.ok(f8.mid - x.e1rmNow < 2 * (f4.mid - x.e1rmNow), 'rendimientos decrecientes');
  for (const v of [f4.low, f4.mid, f4.high]) assert.equal(v * 2, Math.round(v * 2)); // a 0,5 kg
  const fi = byId(r.insights, 'forecast-press_banca');
  assert.equal(fi.area, 'forecast');
  assert.ok(fi.text.includes(`hacia el ${fmtDate(f4.date, 'day')}`));
  assert.ok(fi.text.includes(`hacia el ${fmtDate(f8.date, 'day')}`));
  assert.match(fi.text, /si sigues así/);
  assert.match(fi.text, /estimación/);
  assert.match(fi.title, /^Press banca: 1RM est\. \d+(,5)?–\d+(,5)? kg en 4 semanas$/);
  assert.ok(!fi.text.includes(fi.title.split(': ')[1]), 'el texto no repite la cifra del título');

  // Tope: un principiante que sube un 4 %/sem se proyecta como mucho al 2 %/sem.
  const fast = mk({ sessions: strengthSessions({ sentadilla: (i, w) => 60 * (1 + 0.04 * w) }) });
  const rf = analyzeStrength(fast, { today: TODAY, profile: prof({ experience: 'beginner' }) });
  const s = rf.exercises[0];
  assert.equal(s.status, 'fast');
  approx(s.forecast[0].rateUsed, THRESHOLDS.beginner.cap);
  const L = s.e1rmNow;
  const maxMid = L * (1 + (THRESHOLDS.beginner.cap / 100) * TAU_WEEKS * Math.log(1 + (4 + 2 / 7) / TAU_WEEKS));
  assert.ok(s.forecast[0].mid <= maxMid + 0.5, `${s.forecast[0].mid} ≤ ${maxMid}`);

  // Estancado → previsión plana (ritmo 0)
  const tr = exerciseTrend([0, 4, 8, 12, 16, 20].map((d) => ({ date: ago(d), e1rm: 100 })), { today: TODAY });
  const flat = forecastE1rm(tr, { today: TODAY, status: 'stalled' });
  assert.equal(flat[0].mid, 100);
  assert.equal(flat[0].rateUsed, 0);
  assert.ok(flat[0].low < 100 && flat[0].high > 100); // ruido mínimo ±1 %
});

test('fuerza: resumen global de los principales («Vas mejorando en X de Y…») y sin experiencia en el perfil', () => {
  const data = mk({
    sessions: strengthSessions({
      sentadilla: (i, w) => 100 * (1 + 0.012 * w),
      press_banca: (i, w) => 80 * (1 + 0.005 * w),
      peso_muerto: (i, w) => 150 * (1 - 0.01 * w),
      curl_barra: (i, w) => 30 * (1 + 0.03 * w), // aislamiento: no es principal
    }),
  });
  const r = analyzeStrength(data, { today: TODAY }); // perfil vacío
  checkInsights(r.insights);
  assert.equal(r.summary.mainCount, 3);
  assert.equal(r.summary.improving, 2);
  assert.equal(r.summary.down, 1);
  assert.equal(r.summary.experienceAssumed, true);
  const rates = r.exercises.filter((x) => x.main).map((x) => x.ratePctPerWeek);
  approx(r.summary.trendPctPerWeek, median(rates), 0.011);
  const sum = byId(r.insights, 'strength-summary');
  assert.match(sum.text, /^Vas mejorando en 2 de 3 ejercicios principales; el que más, Sentadilla \+1,\d %\/sem\./);
  assert.match(sum.text, /1 bajando/);
  assert.match(sum.why.rule, /sin experiencia en el perfil se usa intermedio/);
  assert.equal(sum.why.data[0].value, 'Intermedio (sin experiencia en el perfil)');
  assert.equal(sum.action.href, '#/settings/profile');
  assert.equal(sum.title, 'Mejoras en 2 de 3 ejercicios principales');
  // Lo que más progresa: curl y sentadilla (el curl no es principal, pero progresa)
  const top = byId(r.insights, 'strength-top');
  assert.ok(top);
  assert.match(top.text, /^Curl con barra \+/);
  // Hay previsión de los que mejoran, primero los principales
  const fc = r.insights.filter((i) => i.area === 'forecast').map((i) => i.id);
  assert.deepEqual(fc.slice(0, 2), ['forecast-sentadilla', 'forecast-press_banca']);
});

test('fuerza: estancado con músculo por debajo de su rango y fatiga → descarga y +1–2 series (Schoenfeld)', () => {
  const flat = [100, 101, 102, 100, 101, 100.5, 101, 100, 101.5, 100.5, 101, 100.5, 101, 100.5];
  const data = mk({ sessions: strengthSessions({ press_banca: (i) => flat[i] }, { sets: 2, rpe: (i) => (i >= 10 ? 9 : 7) }), bodyweight: [{ id: ago(3), kg: 80 }] });
  const r = analyzeStrength(data, { today: TODAY, profile: prof({ experience: 'intermediate' }) });
  checkInsights(r.insights);
  const st = byId(r.insights, 'strength-stalled-press_banca');
  assert.match(st.text, /descarga/);
  assert.match(st.text, /\+1–2 series por semana de pecho/);
  assert.match(st.text, /≈ 130–175 g para tus 80 kg/);
  const shorts = st.sources.map((s) => s.short);
  assert.ok(shorts.includes('Schoenfeld et al., 2017'));
  assert.ok(shorts.includes('Morton et al., 2018'));
  assert.ok(shorts.includes('Knowles et al., 2018'));
  assert.ok(st.why.data.some((d) => /Series\/sem de pecho/.test(d.label)));
});

test('fuerza: peso corporal — si solo sube la báscula no hay tendencia al alza', () => {
  const sessions = [];
  const bodyweight = [];
  for (let i = 0; i < 12; i++) {
    const d = ago(2 + 4 * (11 - i));
    sessions.push(ses(d, [['dominadas', [set(0, 8, 1)]]]));
    bodyweight.push({ id: d, kg: 70 + i });
  }
  const r = analyzeStrength(mk({ sessions, bodyweight }), { today: TODAY, profile: prof({ experience: 'beginner' }) });
  checkInsights(r.insights);
  const x = r.exercises[0];
  assert.equal(x.exerciseId, 'dominadas');
  approx(x.ratePctPerWeek, 0, 1e-9);
  assert.equal(x.status, 'stalled');
});

test('fuerza en modo mujer: textos en femenino y referencia relativa (Roberts et al., 2020)', () => {
  const flat = [100, 101, 102, 100, 101, 100.5, 101, 100, 101.5, 100.5, 101, 100.5, 101, 100.5];
  const data = mk({ sessions: strengthSessions({ sentadilla: (i, w) => 60 * (1 + 0.006 * w), press_banca: (i) => flat[i] / 2 }) });
  const p = prof({ sex: 'female', experience: 'intermediate' });
  const r = analyzeStrength(data, { today: TODAY, profile: p });
  checkInsights(r.insights);
  const sum = byId(r.insights, 'strength-summary');
  assert.match(sum.why.data[0].value, /^Intermedia$/);
  assert.match(sum.why.rule, /Las mujeres progresan/);
  assert.ok(sum.sources.some((s) => s.short === 'Roberts et al., 2020'));
  const st = byId(r.insights, 'strength-stalled-press_banca');
  assert.match(st.text, /cansada/);
  assert.doesNotMatch(st.text, /cansado/);
  // Sin experiencia: «se usa intermedia»
  const r2 = analyzeStrength(data, { today: TODAY, profile: prof({ sex: 'female' }) });
  assert.match(byId(r2.insights, 'strength-summary').why.rule, /se usa intermedia/);
});

// ---------------------------------------------------------------------------
// Resistencia
// ---------------------------------------------------------------------------

test('resistencia: clasificación suave / intenso', () => {
  assert.equal(classifyIntensity({ kind: 'run', subtype: 'z2', rpe: 8 }), 'easy');
  assert.equal(classifyIntensity({ kind: 'bike', subtype: 'route' }), 'easy');
  assert.equal(classifyIntensity({ kind: 'run', subtype: 'tempo' }), 'hard');
  assert.equal(classifyIntensity({ kind: 'bike', subtype: 'trainer', rpe: 7 }), 'hard');
  assert.equal(classifyIntensity({ kind: 'swim', rpe: 5 }), 'easy');
  assert.equal(classifyIntensity({ kind: 'hike' }), 'easy');
  assert.equal(classifyIntensity({ kind: 'bike' }), null);
});

test('resistencia: reparto ~80/20 alto (bien) y bajo (aviso con minutos concretos, Seiler 2010)', () => {
  const good = [];
  for (let k = 0; k < 7; k++) good.push(act('run', ago(1 + k * 3), { km: 10, min: 60, subtype: 'z2' }));
  good.push(act('run', ago(4), { km: 8, min: 40, subtype: 'intervals' }));
  good.push(act('hike', ago(6), { min: 180, km: 12 })); // sin RPE: suave
  good.push(act('bike', ago(9), { min: 60 })); // sin tipo ni RPE: no cuenta
  const r = analyzeEndurance(mk({ sessions: good }), { today: TODAY });
  checkInsights(r.insights);
  assert.equal(r.intensity.weeks, 4);
  assert.equal(r.intensity.easyMin, 7 * 60 + 180);
  assert.equal(r.intensity.hardMin, 40);
  assert.equal(r.intensity.unknownCount, 1);
  approx(r.intensity.easyShare, 600 / 640);
  const gi = byId(r.insights, 'endurance-intensity');
  assert.equal(gi.level, 'good');
  assert.match(gi.text, /94 %/);
  assert.match(gi.text, /añade el RPE/);
  assert.deepEqual(gi.sources.map((s) => s.short), ['Seiler, 2010']);

  const bad = [];
  for (let k = 0; k < 4; k++) bad.push(act('run', ago(1 + k * 6), { km: 8, min: 45, subtype: 'z2' }));
  for (let k = 0; k < 4; k++) bad.push(act('run', ago(3 + k * 6), { km: 10, min: 50, subtype: 'intervals' }));
  bad.push(act('bike', ago(5), { min: 60, rpe: 8 }));
  const rb = analyzeEndurance(mk({ sessions: bad }), { today: TODAY, profile: prof({ sex: 'female' }) });
  checkInsights(rb.insights);
  const bi = byId(rb.insights, 'endurance-intensity');
  assert.equal(bi.level, 'warn');
  approx(rb.intensity.easyShare, 180 / 440);
  assert.match(bi.text, /Solo el 41 %/);
  assert.match(bi.text, /80 %/);
  assert.match(bi.text, /pasa ~172 min de intenso a suave \(unos 43 min por semana\)/);
  assert.match(bi.text, /fresca/); // femenino
  // Poco volumen → sin comentario
  const few = analyzeEndurance(mk({ sessions: [act('run', ago(2), { km: 5, min: 30, subtype: 'z2' })] }), { today: TODAY });
  assert.equal(byId(few.insights, 'endurance-intensity'), undefined);
});

test('resistencia: interferencia solo si se repite (series el día antes de pierna); mismo día solo si va pegada', () => {
  const legs = (d, hour = 18) => ses(d, [['sentadilla', [set(80), set(80), set(80)]]], { hour });
  const once = [legs(ago(3)), act('run', ago(4), { km: 8, min: 40, subtype: 'intervals' })];
  const r1 = analyzeEndurance(mk({ sessions: once }), { today: TODAY });
  assert.equal(r1.interference.length, 1);
  assert.equal(r1.interference[0].kind, 'day-before');
  assert.equal(byId(r1.insights, 'endurance-interference'), undefined);

  const rep = [
    legs(ago(3)), act('run', ago(4), { km: 8, min: 40, subtype: 'intervals' }),
    legs(ago(17)), act('run', ago(18), { km: 8, min: 40, subtype: 'tempo' }),
    legs(ago(31)), act('bike', ago(32), { min: 60, rpe: 8 }),
    legs(ago(10)), act('run', ago(11), { km: 10, min: 60, subtype: 'z2' }), // suave: no cuenta
    legs(ago(24)), act('run', ago(24), { km: 8, min: 40, subtype: 'intervals', hour: 8 }), // por la mañana: no cuenta
    legs(ago(38)), act('run', ago(38), { km: 8, min: 40, subtype: 'intervals', hour: 17 }), // justo antes: cuenta
    ses(ago(45), [['press_banca', [set(60), set(60), set(60)]]]), act('run', ago(46), { km: 8, min: 40, subtype: 'intervals' }), // sin pierna
  ];
  const r = analyzeEndurance(mk({ sessions: rep }), { today: TODAY });
  checkInsights(r.insights);
  assert.deepEqual(r.interference.map((x) => [x.date, x.kind]), [[ago(38), 'same-day'], [ago(31), 'day-before'], [ago(17), 'day-before'], [ago(3), 'day-before']]);
  const ii = byId(r.insights, 'endurance-interference');
  assert.ok(ii);
  assert.match(ii.text, /3 veces resistencia exigente el día antes de pierna/);
  assert.match(ii.text, /1 vez la resistencia justo antes de la pierna/);
  assert.match(ii.text, /haz la fuerza primero/);
  assert.deepEqual(ii.sources.map((s) => s.short), ['Schumann et al., 2022', 'Eddens et al., 2018']);
  assert.equal(ii.level, 'warn'); // 4 veces
  // Repetida pero antigua (la última hace más de 4 semanas) → no se comenta
  const oldRep = [legs(ago(35)), act('run', ago(36), { km: 8, min: 40, subtype: 'intervals' }), legs(ago(45)), act('run', ago(46), { km: 8, min: 40, subtype: 'intervals' })];
  const ro = analyzeEndurance(mk({ sessions: oldRep }), { today: TODAY });
  assert.equal(ro.interference.length, 2);
  assert.equal(byId(ro.insights, 'endurance-interference'), undefined);
  assert.deepEqual(findInterference(mk({ sessions: oldRep }), { today: TODAY }).length, 2);
});

test('resistencia: forma (5 km previsto por bloques de 4 semanas) mejora y previsión a 4 semanas', () => {
  // Bloques: 6 jul–2 ago, 3–30 ago, 31 ago–hoy. 3 carreras de 5 km por bloque, cada vez más rápidas.
  const runs = [];
  const block = [['2026-07-08', '2026-07-18', '2026-07-28', 1500], ['2026-08-05', '2026-08-15', '2026-08-25', 1460], ['2026-09-02', '2026-09-12', '2026-09-22', 1420]];
  for (const [a, b, c, t] of block) for (const d of [a, b, c]) runs.push(act('run', d, { km: 5, min: t / 60, movingSec: t, subtype: 'tempo' }));
  runs.push(act('hike', '2026-09-20', { km: 15, min: 300 })); // senderismo: no cuenta para la forma
  const r = analyzeEndurance(mk({ sessions: runs }), { today: TODAY });
  checkInsights(r.insights);
  assert.deepEqual(r.fitness.map((b) => b.weekStart), ['2026-07-06', '2026-08-03', '2026-08-31']);
  assert.deepEqual(r.fitness.map((b) => b.pred5kSec), [1500, 1460, 1420]);
  assert.ok(r.fitness.every((b) => b.low < b.pred5kSec && b.high > b.pred5kSec && b.runs === 3));
  const fi = byId(r.insights, 'endurance-fitness');
  assert.equal(fi.level, 'good');
  assert.match(fi.text, /~23:40, frente a ~24:20 en el bloque anterior/);
  // Sin carreras en el bloque del medio → se compara con el de hace 8 semanas
  const gap = analyzeEndurance(mk({ sessions: runs.filter((a) => !a.date.startsWith('2026-08')) }), { today: TODAY });
  assert.match(byId(gap.insights, 'endurance-fitness').text, /frente a ~25:00 hace 8 semanas/);
  assert.equal(fi.action.href, '#/predictions');
  const f5 = byId(r.insights, 'forecast-5k');
  assert.equal(f5.area, 'forecast');
  assert.ok(f5.text.includes(`hacia el ${fmtDate(addDays(TODAY, 28), 'day')}`));
  assert.match(f5.text, /Si sigues así/);
  assert.equal(fitnessBlocks(mk({ sessions: [runs[0], runs[3]] }), { today: TODAY }).length, 0); // 1 carrera por bloque: no basta
  assert.equal(fitnessBlocks(mk({ sessions: runs.slice(0, 2) }), { today: TODAY }).length, 1); // 2 en el mismo bloque: sí
  // Solo la bici y el senderismo → sin forma de carrera
  const rn = analyzeEndurance(mk({ sessions: [act('bike', ago(2), { km: 40, min: 90, subtype: 'route' })] }), { today: TODAY });
  assert.deepEqual(rn.fitness, []);
});

// ---------------------------------------------------------------------------
// Recuperación
// ---------------------------------------------------------------------------

/** 14 sesiones de sentadilla cada 3 días con check-in; lowIdx = sesiones con sueño bajo (rinden `lowE1rm`). */
function recoveryData({ lowIdx = [3, 6, 9, 12], lowE1rm = 94, key = 'sleep', n = 14, withCheckins = n } = {}) {
  const sessions = [];
  const checkins = [];
  for (let i = 0; i < n; i++) {
    const d = ago(1 + 3 * (n - 1 - i));
    const low = lowIdx.includes(i);
    const s = ses(d, [['sentadilla', [set(wFor(low ? lowE1rm : 100))]]]);
    sessions.push(s);
    if (i >= n - withCheckins) {
      checkins.push({ id: `ci${i}`, date: d, timing: 'pre', sessionId: s.id, sleep: key === 'sleep' && low ? 1 : 2, energy: key === 'energy' && low ? 1 : 2, soreness: 2 });
    }
  }
  return mk({ sessions, checkins });
}

test('recuperación: patrón claro con el sueño («rendiste un 6 % menos», Knowles 2018)', () => {
  const data = recoveryData();
  const perf = sessionPerformance(data, { today: TODAY });
  assert.equal(perf.size, 13); // la primera no tiene historial previo
  const r = analyzeRecovery(data, { today: TODAY });
  checkInsights(r.insights);
  assert.equal(r.linked, 13);
  assert.equal(r.sleep.pattern, true);
  approx(r.sleep.pct, 6, 1e-6);
  const si = byId(r.insights, 'recovery-sleep');
  assert.match(si.text, /^Los días que dormiste mal rendiste un 6 % menos \(4 sesiones con sueño bajo frente a 9/);
  assert.equal(si.level, 'warn');
  assert.deepEqual(si.sources.map((s) => s.short), ['Knowles et al., 2018']);
  assert.equal(byId(r.insights, 'recovery-no-pattern'), undefined);
  // Energía baja en modo mujer → «cansada»
  const re = analyzeRecovery(recoveryData({ key: 'energy' }), { today: TODAY, profile: prof({ sex: 'female' }) });
  checkInsights(re.insights);
  const ei = byId(re.insights, 'recovery-energy');
  assert.match(ei.text, /llegaste cansada/);
});

test('recuperación: sin patrón, con pocos check-ins y comparación directa', () => {
  const none = analyzeRecovery(recoveryData({ lowE1rm: 100 }), { today: TODAY });
  checkInsights(none.insights);
  assert.deepEqual(none.insights.map((i) => i.id), ['recovery-no-pattern']);
  assert.match(none.insights[0].text, /no cambia de forma clara/);
  assert.match(none.insights[0].text, /pocos días con energía baja \(0\)/);
  // Diferencia pequeña (2 %) → sin patrón
  const small = analyzeRecovery(recoveryData({ lowE1rm: 98 }), { today: TODAY });
  assert.equal(small.sleep.pattern, false);
  // Menos de 8 check-ins enlazados
  const few = analyzeRecovery(recoveryData({ withCheckins: 5 }), { today: TODAY });
  checkInsights(few.insights);
  assert.deepEqual(few.insights.map((i) => i.id), ['recovery-insufficient']);
  assert.match(few.insights[0].text, /Llevas 5 sesiones/);
  // compareByCheckin: grupos pequeños no dan patrón aunque la diferencia sea grande
  const pairs = [0.9, 0.9, 1, 1, 1, 1].map((ratio, i) => ({ ratio, checkin: { sleep: i < 2 ? 1 : 2 } }));
  const c = compareByCheckin(pairs, 'sleep');
  approx(c.pct, 10);
  assert.equal(c.pattern, false);
});

test('recuperación y ciclo: fases estimadas y lo que dice SU historial (McNulty 2020), sin generalizar', () => {
  const cycle = {
    enabled: true, hormonal: false, avgCycle: 28, avgPeriod: 5,
    cycles: [{ start: '2026-06-30', lengthDays: 28, periodDays: 5 }, { start: '2026-07-28', lengthDays: 28, periodDays: 5 }, { start: '2026-08-25', lengthDays: 28, periodDays: 5 }],
  };
  assert.equal(cyclePhase(cycle, '2026-06-30').phase, 'menstrual');
  assert.equal(cyclePhase(cycle, '2026-07-07').phase, 'follicular'); // día 8
  assert.equal(cyclePhase(cycle, '2026-07-13').phase, 'ovulation'); // día 14
  assert.equal(cyclePhase(cycle, '2026-07-19').phase, 'luteal'); // día 20
  assert.equal(cyclePhase(cycle, '2026-07-25').phase, 'premenstrual'); // día 26
  assert.equal(cyclePhase(cycle, '2026-09-23'), null); // ciclo en curso: sin fase
  assert.equal(cyclePhase({ ...cycle, hormonal: true }, '2026-07-07'), null);

  const build = (pmE1rm) => {
    const sessions = [];
    for (let d = '2026-06-30'; d <= '2026-09-21'; d = addDays(d, 2)) {
      const pm = cyclePhase(cycle, d)?.phase === 'premenstrual';
      sessions.push(ses(d, [['sentadilla', [set(wFor(pm ? pmE1rm : 100))]]]));
    }
    return mk({ sessions });
  };
  const her = prof({ sex: 'female', experience: 'intermediate' });
  const r = analyzeRecovery(build(95), { today: TODAY, profile: her, cycle });
  checkInsights(r.insights);
  const ci = byId(r.insights, 'cycle-performance');
  assert.equal(ci.area, 'cycle');
  assert.equal(r.phases.worst.phase, 'premenstrual');
  assert.match(ci.title, /la fase premenstrual es tu fase más floja/);
  assert.match(ci.text, /rindes un 5 % menos/);
  assert.match(ci.text, /no una regla/);
  assert.deepEqual(ci.sources.map((s) => s.short), ['McNulty et al., 2020']);
  const flat = analyzeRecovery(build(100), { today: TODAY, profile: her, cycle });
  const cf = byId(flat.insights, 'cycle-performance');
  assert.equal(cf.level, 'neutral');
  assert.match(cf.text, /no se ve una diferencia clara/);
  assert.ok(cf.sources.some((s) => s.short === 'Colenso-Semple et al., 2023'));
  // Sin CycleInfo, con anticonceptivo hormonal, en modo hombre o con un solo ciclo → nada del ciclo
  assert.equal(byId(analyzeRecovery(build(95), { today: TODAY, profile: her }).insights, 'cycle-performance'), undefined);
  assert.equal(byId(analyzeRecovery(build(95), { today: TODAY, profile: her, cycle: { ...cycle, hormonal: true } }).insights, 'cycle-performance'), undefined);
  assert.equal(byId(analyzeRecovery(build(95), { today: TODAY, profile: prof({ sex: 'male' }), cycle }).insights, 'cycle-performance'), undefined);
  assert.equal(byId(analyzeRecovery(build(95), { today: TODAY, profile: her, cycle: { ...cycle, cycles: cycle.cycles.slice(0, 1) } }).insights, 'cycle-performance'), undefined);
});

// ---------------------------------------------------------------------------
// Entrada: perfil desde settings, hoy desde data.today
// ---------------------------------------------------------------------------

test('entrada: perfil desde data.settings y hoy desde data.today', () => {
  const settings = { ...defaultSettings(), profile: { ...defaultSettings().profile, sex: 'female', experience: 'advanced' } };
  const data = mk({ settings, sessions: strengthSessions({ sentadilla: (i, w) => 100 * (1 + 0.01 * w) }) });
  const r = analyzeStrength(data);
  assert.equal(r.summary.experience, 'advanced');
  assert.equal(r.exercises[0].status, 'fast');
  assert.equal(r.exercises[0].forecast[0].date, addDays(TODAY, 28));
  assert.match(byId(r.insights, 'strength-summary').why.data[0].value, /^Avanzada$/);
  // intensitySplit y stallState también son puras
  assert.equal(intensitySplit(mk(), { today: TODAY }).easyShare, null);
  assert.equal(stallState([], TODAY, {}).stalled, false);
});

// ---------------------------------------------------------------------------
// Fuentes (al final: revisa todos los Insight generados en las pruebas anteriores)
// ---------------------------------------------------------------------------

test('fuentes: solo de la lista del contrato (§5), con detalle', () => {
  assert.ok(seen.length > 20, `insights revisados: ${seen.length}`);
  for (const s of Object.values(SOURCES)) {
    assert.ok(ALLOWED.includes(s.short), `fuente permitida: ${s.short}`);
    assert.ok(s.detail && s.detail.includes('·'), `detalle: ${s.short}`);
  }
  for (const i of seen) {
    for (const s of i.sources) {
      assert.ok(ALLOWED.includes(s.short), `${i.id}: ${s.short}`);
      assert.ok(s.detail && s.detail.length > 10);
    }
  }
});
