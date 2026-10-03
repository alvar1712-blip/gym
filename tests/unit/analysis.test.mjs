// Pruebas de js/analysis.js (orquestador de «tu analista») y js/analysis-report.js (informe para una IA),
// docs/MEJORAS5.md §3c, con datos sintéticos de un hombre y de una mujer con seguimiento del ciclo.
// Hoy = jueves 24 sep 2026 (inyectado).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalysis, pickKeyPoints, isPlaceholder, enduranceMinutesPerWeek, weightForecast, cycleSummary, areaInsights,
  sortInsights, AREAS, DISCLAIMER,
} from '../../js/analysis.js';
import { reportText, reportable, CYCLE_WEIGHT_IDS, SHOWN_IN_SECTIONS } from '../../js/analysis-report.js';
import { defaultSettings, SEED_EXERCISES } from '../../js/seed.js';
import { addDays, tsFromDate } from '../../js/util.js';

const TODAY = '2026-09-24';
const ago = (n) => addDays(TODAY, -n);
const EXMAP = new Map(SEED_EXERCISES.map((e) => [e.id, e]));

let seq = 0;
const set = (weight, reps = 5, rir = 0) => ({ id: `st${++seq}`, type: 'effective', weight, reps, repsR: null, rir, done: true, doneAt: 1 });
/** Peso para un 1RM estimado dado (Epley con reps + RIR). */
const wFor = (e1rm, reps = 5, rir = 0) => e1rm / (1 + (reps + rir) / 30);
function ses(date, items, { rpe = 7, id = null } = {}) {
  const sid = id || `s${++seq}`;
  return {
    id: sid, kind: 'strength', date, planDate: date, status: 'done', parentId: null, templateId: null, templateName: 'Sesión',
    startedAt: tsFromDate(date, 18), createdAt: tsFromDate(date, 18), durationMin: 60, rpe,
    exercises: items.map(([exerciseId, sets], i) => ({ id: `${sid}_se${i}`, exerciseId, exName: exerciseId, sets })),
  };
}
function act(kind, date, { min = 45, km = null, rpe = null, subtype = null } = {}) {
  return {
    id: `a${++seq}`, kind, date, planDate: date, status: 'done', parentId: null, startedAt: tsFromDate(date, 8),
    createdAt: tsFromDate(date, 8), durationMin: min, movingSec: min * 60, distanceKm: km, rpe, subtype,
  };
}
const settingsFor = (profile) => ({ ...defaultSettings(), profile: { ...defaultSettings().profile, ...profile } });
const mk = (over = {}) => ({
  sessions: [], exercises: EXMAP, templates: new Map(), plan: new Map(), settings: defaultSettings(), bodyweight: [], checkins: [],
  cycleDays: [], today: TODAY, ...over,
});

/** Hombre intermedio que quiere ganar músculo: press y sentadilla suben, el peso muerto rumano se estanca; carrera. */
function maleData(profile = {}) {
  const sessions = [];
  for (let i = 0; i < 16; i++) {
    const off = 2 + 4 * (15 - i);
    const w = (4 * i) / 7;
    sessions.push(ses(ago(off), [
      ['press_banca', [set(wFor(90 * (1 + 0.008 * w)))]],
      ['sentadilla', [set(wFor(120 * (1 + 0.004 * w)))]],
      ['peso_muerto_rumano', [set(wFor(110))]],
    ]));
  }
  for (let i = 0; i < 20; i++) sessions.push(act('run', ago(2 + 3 * i), { min: 40, km: 7, rpe: i % 4 ? 4 : 8, subtype: i % 4 ? 'z2' : 'intervals' }));
  const bodyweight = [];
  for (let i = 0; i < 40; i++) bodyweight.push({ id: ago(40 - i), kg: Math.round((78 + 0.04 * i + (i % 3 ? 0.3 : -0.3)) * 10) / 10 });
  return mk({ sessions, bodyweight, settings: settingsFor({ sex: 'male', goal: 'gain', experience: 'intermediate', ...profile }) });
}

/**
 * Mujer con ciclo natural de 29 días (reglas de 5 días; la última empezó hace 11 días → hoy, día 12), fuerza cada
 * 3 días durante 16 semanas con check-ins y pesajes con retención de líquidos antes de la regla.
 */
function femaleData(profile = {}) {
  const starts = [ago(11), ago(40), ago(69), ago(98), ago(127)];
  const cycleDays = [];
  for (const s of starts) {
    for (let k = 0; k < 5; k++) {
      const id = addDays(s, k);
      if (id <= TODAY) cycleDays.push({ id, flow: k < 2 ? 'medium' : 'light', symptoms: k === 0 ? ['cramps'] : [], notes: '', createdAt: 1, updatedAt: 1 });
    }
  }
  const sessions = [];
  const checkins = [];
  for (let i = 0; i < 38; i++) {
    const off = 1 + 3 * (37 - i);
    const w = (3 * i) / 7;
    const s = ses(ago(off), [
      ['hip_thrust', [set(wFor(80 * (1 + 0.006 * w)))]],
      ['sentadilla', [set(wFor(60 * (1 + 0.005 * w)))]],
      ['press_banca', [set(wFor(40 * (1 + 0.004 * w)))]],
    ]);
    sessions.push(s);
    checkins.push({ id: `ci${i}`, date: s.date, timing: 'pre', sessionId: s.id, sleep: i % 5 === 0 ? 1 : 2, energy: i % 4 === 0 ? 1 : 2, soreness: 2 });
  }
  const bodyweight = [];
  for (let i = 0; i < 60; i++) {
    const id = ago(60 - i);
    const pre = starts.some((s) => { const d = (Date.parse(s) - Date.parse(id)) / 864e5; return d >= 0 && d <= 5; });
    bodyweight.push({ id, kg: Math.round((62 + 0.012 * i + (pre ? 0.9 : 0) + (i % 2 ? 0.2 : -0.2)) * 10) / 10 });
  }
  return mk({
    sessions, checkins, bodyweight, cycleDays,
    settings: settingsFor({ sex: 'female', goal: 'gain', experience: 'intermediate', cycleTracking: true, contraception: 'none', ...profile }),
  });
}

const LEVELS = ['good', 'neutral', 'warn', 'info'];
function checkShape(list) {
  const ids = new Set();
  for (const i of list) {
    assert.ok(i.id && !ids.has(i.id), `id único: ${i.id}`);
    ids.add(i.id);
    assert.ok(AREAS.includes(i.area), `área ${i.area}`);
    assert.ok(LEVELS.includes(i.level), `nivel ${i.level}`);
    assert.ok(i.priority >= 0 && i.priority <= 100);
    assert.ok(i.title && i.text && i.why?.rule && i.why.data.length, `forma de ${i.id}`);
    assert.ok(Array.isArray(i.sources));
  }
}
const sortedByPriority = (list) => list.every((x, k) => k === 0 || list[k - 1].priority >= x.priority);
const clean = (txt) => !/undefined|NaN|\bnull\b|\[object/.test(txt);

// ---------------------------------------------------------------------------
// buildAnalysis
// ---------------------------------------------------------------------------

test('buildAnalysis (hombre): todos los análisis, resumen de 3 áreas distintas y lista completa ordenada', () => {
  const a = buildAnalysis(maleData(), TODAY);
  assert.deepEqual(a.errors, []);
  assert.equal(a.today, TODAY);
  assert.equal(a.female, false);
  assert.equal(a.profileIncomplete, false);
  assert.equal(a.hasData, true);
  assert.equal(a.cycle, null, 'sin modo mujer no hay ciclo');
  // Peso: ritmo fiable en el rango de ganar músculo (hombre intermedio 0,25–0,5 %/sem) y cruce con la fuerza
  assert.equal(a.weight.ok, true);
  assert.equal(a.weight.status, 'in');
  assert.ok(a.weight.insights.some((i) => i.id === 'weight-strength'), 'cruce con la fuerza (strength.summary pasado a analyzeWeight)');
  // Fuerza: press y sentadilla mejoran, el rumano se estanca
  const st = Object.fromEntries(a.strength.exercises.map((x) => [x.exerciseId, x.status]));
  assert.equal(st.peso_muerto_rumano, 'stalled');
  assert.ok(['good', 'fast'].includes(st.press_banca));
  // Resistencia: minutos semanales de las 4 últimas semanas (carreras de 40 min cada 3 días)
  const runs = maleData().sessions.filter((s) => s.kind === 'run' && s.date >= ago(27)).length;
  assert.equal(a.endurance.weeklyMinutes4w, Math.round((runs * 40) / 4));
  assert.ok(a.endurance.insights.some((i) => i.id === 'endurance-intensity'));
  // Previsiones: fuerza y peso (proyección de este módulo)
  assert.ok(a.forecast.some((i) => i.id === 'forecast-weight'));
  assert.ok(a.forecast.some((i) => i.id === 'forecast-press_banca'));
  assert.ok(a.forecast.every((i) => i.area === 'forecast'));
  // Lista completa: sin repetir, ordenada, con forma de Insight
  checkShape(a.all);
  assert.ok(sortedByPriority(a.all));
  // Resumen: 3, áreas distintas, de los de mayor prioridad
  assert.equal(a.keyPoints.length, 3);
  assert.equal(new Set(a.keyPoints.map((i) => i.area)).size, 3);
  assert.ok(a.keyPoints.every((k) => a.all.includes(k)));
  assert.equal(a.keyPoints[0], a.all[0], 'el primero es el más importante');
  assert.ok(sortedByPriority(a.keyPoints));
  assert.ok(!a.keyPoints.some(isPlaceholder));
});

test('buildAnalysis (mujer con ciclo): CycleInfo al peso y a la recuperación, tarjeta del ciclo y textos en femenino', () => {
  const a = buildAnalysis(femaleData(), TODAY);
  assert.deepEqual(a.errors, []);
  assert.equal(a.female, true);
  assert.ok(a.cycle, 'modo mujer con seguimiento → ciclo');
  assert.equal(a.cycle.hormonal, false);
  assert.match(a.cycle.state, /^Día 12 · /);
  assert.match(a.cycle.next, /^Próxima regla ~/);
  assert.match(a.cycle.basis, /Ciclo medio de 29 días/);
  assert.ok(a.cycle.info.periods.length >= 4);
  // Peso con el ciclo: pesajes de los días previos a la regla marcados como posible retención
  assert.ok(a.weight.trend.points.some((p) => p.retention), 'retención marcada (el CycleInfo llega a analyzeWeight)');
  // Los Insights de ciclo de la recuperación se enseñan en «Ciclo», no en «Recuperación»
  assert.ok(a.cycle.insights.every((i) => i.area === 'cycle'));
  assert.ok(areaInsights(a, 'recovery').every((i) => i.area !== 'cycle'));
  const recCycle = a.recovery.insights.filter((i) => i.area === 'cycle');
  for (const i of recCycle) assert.ok(a.cycle.insights.includes(i));
  checkShape(a.all);
  assert.ok(sortedByPriority(a.all));
  assert.ok(a.keyPoints.length >= 2 && a.keyPoints.length <= 3);
  // Rango de ganancia de mujer intermedia (0,2–0,4 %/sem)
  assert.equal(a.weight.target.minPct, 0.2);
  assert.equal(a.weight.target.maxPct, 0.4);
});

test('buildAnalysis: sin seguimiento del ciclo o en modo hombre no se calcula el ciclo; anticonceptivo hormonal sin fases', () => {
  assert.equal(buildAnalysis(femaleData({ cycleTracking: false }), TODAY).cycle, null);
  assert.equal(buildAnalysis({ ...femaleData(), settings: settingsFor({ sex: 'male', goal: 'gain' }) }, TODAY).cycle, null);
  const h = buildAnalysis(femaleData({ contraception: 'combined_pill' }), TODAY);
  assert.ok(h.cycle);
  assert.equal(h.cycle.hormonal, true);
  assert.equal(h.cycle.next, null);
  assert.match(h.cycle.state, /desde el último sangrado/);
  assert.ok(!h.all.some((i) => i.id === 'cycle-performance'), 'sin fases naturales no hay análisis por fase');
});

test('buildAnalysis sin datos ni perfil: no falla, hasData false y el resumen solo dice qué hacer', () => {
  const a = buildAnalysis(mk(), TODAY);
  assert.deepEqual(a.errors, []);
  assert.equal(a.hasData, false);
  assert.equal(a.profileIncomplete, true);
  assert.equal(a.weight.ok, false);
  assert.ok(a.keyPoints.length >= 1);
  // «Faltan datos» de prioridad baja (check-ins) no entra en el resumen
  assert.ok(!a.keyPoints.some((i) => i.id === 'recovery-insufficient'));
  // Sin argumento `today`: usa data.today
  assert.equal(buildAnalysis(mk()).today, TODAY);
  // data vacío o raro
  assert.doesNotThrow(() => buildAnalysis(null, TODAY));
});

test('buildAnalysis aísla los fallos: un análisis que se rompe queda vacío y se anota en errors', () => {
  const d = maleData();
  Object.defineProperty(d, 'checkins', { get() { throw new Error('check-ins rotos'); } });
  const a = buildAnalysis(d, TODAY);
  assert.ok(a.errors.some((e) => e.area === 'recovery' && /check-ins rotos/.test(e.message)));
  assert.equal(a.weight.ok, true, 'el resto sigue');
  assert.ok(a.keyPoints.length === 3);
});

// ---------------------------------------------------------------------------
// Piezas
// ---------------------------------------------------------------------------

const ins = (id, area, priority, level = 'info') => ({ id, area, priority, level, title: id, text: id, why: { rule: 'r', data: [{ label: 'a', value: 'b' }] }, sources: [] });

test('pickKeyPoints: áreas distintas, sin «faltan datos» de poca prioridad, sin repetir lo mismo y relleno con lo importante', () => {
  const list = [
    ins('strength-stalled-x', 'strength', 64, 'warn'), ins('strength-summary', 'strength', 62, 'good'),
    ins('weight-rate', 'weight', 50, 'good'), ins('forecast-x', 'forecast', 42), ins('endurance-intensity', 'endurance', 38),
    ins('recovery-insufficient', 'recovery', 8),
  ];
  assert.deepEqual(pickKeyPoints(list).map((i) => i.id), ['strength-stalled-x', 'weight-rate', 'forecast-x']);
  // Variados aunque el orden de entrada sea otro
  assert.deepEqual(pickKeyPoints([...list].reverse()).map((i) => i.id), ['strength-stalled-x', 'weight-rate', 'forecast-x']);
  // Los que analizan van antes que «faltan datos» aunque este tenga más prioridad
  const k2 = pickKeyPoints([ins('weight-insufficient', 'weight', 30), ins('strength-summary', 'strength', 62), ins('endurance-fitness', 'endurance', 22)]);
  assert.deepEqual(k2.map((i) => i.id), ['strength-summary', 'weight-insufficient', 'endurance-fitness']);
  // Una sola área: se rellena con lo importante (≥ 40) del mismo área, nunca con lo flojo
  const k3 = pickKeyPoints([ins('strength-summary', 'strength', 62), ins('strength-top', 'strength', 48), ins('strength-x', 'strength', 20)]);
  assert.deepEqual(k3.map((i) => i.id), ['strength-summary', 'strength-top']);
  // El aviso de energía baja con la regla alterada ya dice lo del retraso: no se repite con la alerta del ciclo
  const k4 = pickKeyPoints([ins('weight-reds-cycle', 'weight', 95, 'warn'), ins('cycle-late', 'cycle', 80, 'warn'), ins('strength-summary', 'strength', 62), ins('forecast-x', 'forecast', 40)]);
  assert.deepEqual(k4.map((i) => i.id), ['weight-reds-cycle', 'strength-summary', 'forecast-x']);
  assert.deepEqual(pickKeyPoints([]), []);
  assert.equal(pickKeyPoints(list, 2).length, 2);
});

test('sortInsights: prioridad, luego área y id', () => {
  const s = sortInsights([ins('b', 'strength', 40), ins('a', 'weight', 40), ins('c', 'weight', 60)]);
  assert.deepEqual(s.map((i) => i.id), ['c', 'a', 'b']);
});

test('enduranceMinutesPerWeek: solo resistencia terminada de las 4 últimas semanas (hoy incluido)', () => {
  const sessions = [
    act('run', TODAY, { min: 60 }), act('bike', ago(27), { min: 120 }), act('swim', ago(28), { min: 500 }),
    act('hike', ago(5), { min: 180 }), act('other', ago(3), { min: 300 }), ses(ago(2), []),
    { ...act('run', ago(1), { min: 100 }), status: 'planned' }, act('run', addDays(TODAY, 1), { min: 999 }),
  ];
  assert.equal(enduranceMinutesPerWeek(sessions, TODAY), Math.round((60 + 120 + 180) / 4));
  assert.equal(enduranceMinutesPerWeek([], TODAY), 0);
});

test('weightForecast: proyección a 4 semanas con margen mínimo; null sin ritmo o con aviso de energía baja', () => {
  const a = buildAnalysis(maleData(), TODAY);
  const f = weightForecast(a.weight, { today: TODAY });
  assert.equal(f.date, addDays(TODAY, 28));
  assert.ok(f.low < f.mid && f.mid < f.high);
  assert.ok(f.high - f.mid >= 0.29 && f.mid - f.low >= 0.29);
  assert.ok(Math.abs(f.mid - (a.weight.trend.currentKg + 4 * a.weight.trend.ratePerWeekKg)) < 0.06);
  assert.match(f.title, /^Peso: \d+,\d–\d+,\d kg hacia el 22 oct$/);
  assert.ok(!/retención/.test(f.text));
  assert.match(weightForecast(a.weight, { today: TODAY, female: true }).text, /retención de líquidos/);
  assert.equal(weightForecast({ ok: false, trend: null }, { today: TODAY }), null);
  const reds = { ...a.weight, insights: [...a.weight.insights, ins('weight-reds', 'weight', 88, 'warn')] };
  assert.equal(weightForecast(reds, { today: TODAY }), null);
});

test('cycleSummary: regla en curso, retraso y sin reglas', () => {
  assert.equal(cycleSummary(null), null);
  const base = { today: TODAY, hormonal: false, periods: [{}], cycles: [], basis: 'guess', cycleLength: 28, avgCycle: null };
  assert.equal(cycleSummary({ ...base, periods: [], current: null, next: null }).state, 'Sin reglas registradas');
  const on = cycleSummary({ ...base, current: { day: 2, phase: 'menstrual', phaseLabel: 'regla' }, ongoing: { day: 2 }, next: { from: '2026-10-20', to: '2026-10-24', start: '2026-10-22' } });
  assert.equal(on.state, 'Día 2 · regla');
  assert.equal(on.next, 'Regla en curso · día 2');
  assert.match(on.basis, /indicaste en tu perfil \(28 días\)/);
  const late = cycleSummary({ ...base, current: { day: 40, phase: null }, ongoing: null, lateDays: 10, next: { from: '2026-09-10', to: '2026-09-14', start: '2026-09-12' } });
  assert.match(late.next, /^Retraso de 10 días · se esperaba ~10–14 sep$/);
});

// ---------------------------------------------------------------------------
// reportText
// ---------------------------------------------------------------------------

test('reportText (hombre): perfil, objetivo, contexto, peso, fuerza, tendencias, insights, confianza y pregunta final; sin ciclo', () => {
  const a = buildAnalysis(maleData(), TODAY);
  const txt = reportText(a);
  assert.ok(clean(txt), 'sin huecos');
  for (const s of ['INFORME DE ENTRENAMIENTO', '\nPERFIL\n', '\nOBJETIVO\n', '\nCONTEXTO DEL USUARIO', '\nCAMBIOS RECIENTES\n', '\nPESO\n', '\nFUERZA', '\nTENDENCIAS\n', '\nINSIGHTS', 'DATOS CON BAJA CONFIANZA', '\nPREGUNTA\n']) {
    assert.ok(txt.includes(s), `sección ${s}`);
  }
  assert.ok(txt.includes(DISCLAIMER));
  assert.match(txt, /- Sexo: Hombre\n- Edad: sin indicar\n- Experiencia en fuerza: Intermedio \(1–3 años\)/);
  assert.match(txt, /OBJETIVO\n- Objetivo principal: Ganar músculo/);
  assert.match(txt, /Press banca: 1RM est\. \d+,\d kg · \+0,\d+ %\/sem · (bien|rápido)/);
  assert.match(txt, /Peso muerto rumano: .* estancado/);
  assert.match(txt, /Ritmo: \+0,\d+ kg\/semana/);
  assert.match(txt, /Proteína orientativa: \d+–\d+ g\/día/);
  assert.match(txt, /Soy hombre, con experiencia intermedia en fuerza \(1–3 años\) y mi objetivo es ganar músculo\./);
  assert.ok(!/CICLO|\bregla\b|Anticonceptivo/.test(txt));
  // Previsiones con su título completo (el texto lo continúa): «Press banca: 1RM est. 80–85 kg en 4 semanas. Previsto…»
  assert.match(txt, /\n- Si sigo así · Press banca: 1RM est\. [\d,]+–[\d,]+ kg en 4 semanas\. Previsto hacia el /);
  assert.match(txt, /\n- Si sigo así · Peso: [\d,]+–[\d,]+ kg hacia el .*\. Si sigues/);
  // Todas las valoraciones que no son del ciclo están (salvo las que ya salen en su sección: proteína, reparto de carga)
  for (const i of a.all.filter((x) => x.area !== 'forecast' && !SHOWN_IN_SECTIONS(x))) assert.ok(txt.includes(i.title), `valoración ${i.id}`);
  // Cada valoración lleva su confianza
  assert.match(txt, /• \[(Bien|Nota|Atención|Info) · confianza (alta|media|baja)\] /);
  assert.ok(txt.endsWith('\n'));
});

test('reportText (mujer): sin permiso no sale nada del ciclo; con permiso, sección del ciclo y femenino', () => {
  const a = buildAnalysis(femaleData({ experience: 'advanced' }), TODAY);
  const cycleTitles = a.all.filter((i) => i.area === 'cycle' || CYCLE_WEIGHT_IDS.includes(i.id)).map((i) => i.title);
  const off = reportText(a, { includeCycle: false });
  assert.ok(clean(off));
  assert.ok(!/CICLO MENSTRUAL|Anticonceptivo|Día 12|Próxima regla/.test(off), 'nada del ciclo sin permiso');
  for (const t of cycleTitles) assert.ok(!off.includes(t), `sin «${t}»`);
  assert.match(off, /Experiencia en fuerza: Avanzada \(más de 3 años\)/);
  assert.match(off, /Soy mujer, con experiencia avanzada en fuerza \(más de 3 años\)/);
  const on = reportText(a, { includeCycle: true });
  assert.ok(clean(on));
  assert.match(on, /CICLO MENSTRUAL\n- Anticonceptivo: Ninguno hormonal/);
  assert.match(on, /- Hoy: Día 12 · .* · Próxima regla ~/);
  assert.match(on, /Duración de los últimos ciclos: 29, 29, 29, 29 días/);
  assert.ok(on.indexOf('CICLO MENSTRUAL') < on.indexOf('INSIGHTS'));
  for (const t of cycleTitles) assert.ok(on.includes(t), `con «${t}»`);
  // includeCycle no hace nada en modo hombre
  const m = buildAnalysis(maleData(), TODAY);
  assert.equal(reportText(m, { includeCycle: true }), reportText(m, { includeCycle: false }));
});

test('reportText sin datos ni perfil y reportable()', () => {
  const txt = reportText(buildAnalysis(mk(), TODAY));
  assert.ok(clean(txt));
  assert.match(txt, /- Sexo: sin indicar/);
  assert.match(txt, /Sin ritmo fiable todavía: Aún no hay pesajes\./);
  assert.match(txt, /Aún no hay ejercicios con datos suficientes/);
  assert.match(txt, /PREGUNTA\nEntreno fuerza y resistencia\. Con estos datos/);
  // Las tres secciones de siempre dicen que no hay nada (también es información); el resto no se rellena con ruido
  assert.match(txt, /CONTEXTO DEL USUARIO \(.*\)\n- Nada apuntado ni detectado/);
  assert.match(txt, /CAMBIOS RECIENTES\n- Ninguno en las últimas 6 semanas\./);
  assert.match(txt, /DATOS CON BAJA CONFIANZA .*\n- Niveles: /);
  for (const s of ['MARCAS HISTÓRICAS', 'VOLUMEN', 'RUNNING', 'BICI', 'NATACIÓN', 'SENDERISMO', 'OTRAS ACTIVIDADES', 'CARGA', 'SUEÑO', 'ENERGÍA', 'ESTRÉS', 'AGUJETAS', 'EVENTOS FUTUROS']) assert.ok(!txt.includes(`\n${s}`), `sin «${s}» vacía`);
  assert.doesNotThrow(() => reportText(null));
  assert.equal(reportable(ins('cycle-late', 'cycle', 80), false), false);
  assert.equal(reportable(ins('weight-cycle-retention', 'weight', 42), false), false);
  assert.equal(reportable(ins('weight-rate', 'weight', 50), false), true);
  assert.equal(reportable(ins('cycle-late', 'cycle', 80), true), true);
});
