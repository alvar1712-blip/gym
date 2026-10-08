// Pruebas de la ronda 6, fase F (docs/MEJORAS6.md): el informe para tu IA (js/analysis-report.js) con todo el contexto.
// Escenario sintético (ningún dato personal real): bajada de peso, parón de 10 semanas, vuelta, creatina, marca histórica
// de banca, carreras, una ruta, check-ins con estrés y zonas, un 10K apuntado y un objetivo de fuerza.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAnalysis } from '../../js/analysis.js';
import { reportText } from '../../js/analysis-report.js';
import { addDays, tsFromDate } from '../../js/util.js';
import { SEED_EXERCISES, defaultSettings } from '../../js/seed.js';

function scenario({ profile = {}, extra = {} } = {}) {
  const T = '2026-10-02';
  const back = (k) => addDays(T, -k);
  const EX = new Map(SEED_EXERCISES.map((e) => [e.id, e]));
  let n = 0;
  const sessions = []; const checkins = []; const bodyweight = [];
  for (let i = 150; i >= 0; i--) {
    let kg; if (i > 93) kg = 75; else if (i > 31) kg = 75 - 3.5 * ((93 - i) / 62); else kg = 71.5 + 0.45 * ((31 - i) / 7);
    if (i % 2 === 0 || i <= 31) bodyweight.push({ id: back(i), kg: Math.round((kg + [0.2, -0.3, 0.1, 0.25, -0.15, -0.2, 0.05][i % 7]) * 10) / 10 });
  }
  const st = (date, items, rpe = 7) => { const id = `s${n++}`; sessions.push({ id, kind: 'strength', status: 'done', date, startedAt: tsFromDate(date, 18), durationMin: 60, rpe, exercises: items.map(([e, w, sets = 3, reps = 6], k) => ({ id: `${id}_${k}`, exerciseId: e, sets: Array.from({ length: sets }, (_, j) => ({ id: `${id}_${k}_${j}`, type: 'effective', done: true, weight: w, reps, rir: 2 })) })) }); return id; };
  for (const [a, w] of [[150, 85], [136, 87.5], [122, 90], [108, 90], [94, 92.5]]) st(back(a), [['press_banca', w], ['sentadilla', w + 20]]);
  const ret = [[24, 72.5], [21, 75], [17, 77.5], [14, 77.5], [10, 80], [7, 82.5], [3, 82.5], [1, 85]];
  for (const [a, w] of ret) {
    const id = st(back(a), [['press_banca', w], ['sentadilla', w + 15, 4]]);
    checkins.push({ id: `c${n++}`, date: back(a), timing: 'pre', sessionId: id, sleep: a % 3 ? 2 : 1, energy: 2, stress: a % 2 ? 3 : 2, soreness: 2, createdAt: 1 });
    checkins.push({ id: `c${n++}`, date: back(a - 1), timing: 'pre', sessionId: null, sleep: 2, energy: 2, soreness: 2, areas: [{ id: `z${n}`, kind: 'muscle', zone: 'quads', side: null, level: 6, note: '' }, { id: `y${n}`, kind: 'joint', zone: 'knee', side: 'left', level: 3, note: '' }], createdAt: 1 });
  }
  for (const a of [20, 16, 12, 9, 5, 2]) sessions.push({ id: `r${n++}`, kind: 'run', status: 'done', date: back(a), startedAt: tsFromDate(back(a), 8), durationMin: 50, movingSec: 3000, distanceKm: 9, rpe: 6, subtype: 'z2' });
  sessions.push({ id: `h${n++}`, kind: 'hike', status: 'done', date: back(13), startedAt: tsFromDate(back(13), 8), durationMin: 180, movingSec: 10800, distanceKm: 14, rpe: 3 });
  const context = [{ id: 'c1', kind: 'event', type: 'creatine_start', date: { date: back(12), precision: 'day' }, text: '', notes: '', createdAt: 1, updatedAt: 1 },
    { id: 'c2', kind: 'event', type: 'usual_weight', date: { date: '2025-01-01', precision: 'year' }, kg: 75, text: '', notes: '', createdAt: 1, updatedAt: 1 }];
  const pastRecords = [{ id: 'pr1', exerciseId: 'press_banca', weight: 102.5, reps: 5, rir: null, date: { date: '2025-06-01', precision: 'season' }, beforeApp: true, note: '', createdAt: 1, updatedAt: 1 }];
  const races = [{ id: 'race1', name: 'San Silvestre', type: '10k', date: addDays(T, 73), distanceKm: 10, targetSec: 3000, priority: 'A', note: '', goalId: null, createdAt: 1, updatedAt: 1 }];
  const goals = [{ id: 'g1', kind: 'strength', exerciseId: 'press_banca', weight: 100, reps: 5, title: 'Press banca 100 kg × 5', createdAt: 1, achievedAt: null, archived: false }];
  const settings = { ...defaultSettings(), weekPatterns: [], profile: { sex: 'male', goal: 'gain', experience: 'advanced', birthDate: '1990-05-01', sports: ['strength', 'run'], weeklyFrequency: 4, limitations: 'Molestia leve en la rodilla izquierda' } };

  settings.profile = { ...settings.profile, ...profile };
  const data = { sessions, exercises: EX, templates: new Map(), plan: new Map(), settings, bodyweight, checkins, context, pastRecords, races, goals, today: T, ...extra };
  return buildAnalysis(data, T);
}

const ORDER = ['PERFIL', 'OBJETIVO', 'CONTEXTO DEL USUARIO', 'CAMBIOS RECIENTES', 'PESO', 'FUERZA', 'MARCAS HISTÓRICAS', 'VOLUMEN',
  'RUNNING', 'SENDERISMO', 'CARGA', 'RECUPERACIÓN', 'SUEÑO', 'ENERGÍA', 'ESTRÉS', 'AGUJETAS/MOLESTIAS', 'EVENTOS FUTUROS', 'TENDENCIAS',
  'INSIGHTS', 'CONFIANZA — DATOS CON BAJA CONFIANZA', 'PREGUNTA'];

test('informe completo: las secciones pedidas, en orden, con el contexto que otra IA necesita y sin secciones vacías', () => {
  const a = scenario();
  assert.deepEqual(a.errors, []);
  const txt = reportText(a);
  const heads = txt.split('\n\n').map((b) => b.split('\n')[0]);
  const pos = ORDER.map((h) => heads.findIndex((x) => x.startsWith(h)));
  assert.ok(pos.every((p) => p >= 0), `faltan: ${ORDER.filter((_, i) => pos[i] < 0).join(', ')}`);
  assert.deepEqual([...pos].sort((x, y) => x - y), pos, 'en el orden pedido');
  for (const b of txt.trim().split('\n\n')) assert.ok(b.split('\n').length >= 2, `sección vacía: ${b}`);
  // Contexto y cambios recientes
  assert.match(txt, /CONTEXTO DEL USUARIO .*\n- Vuelta tras 10 semanas sin entrenar · desde el .*\n- Creatina · desde el /);
  assert.match(txt, /\n- Peso habitual apuntado: 75 kg\n/);
  assert.match(txt, /CAMBIOS RECIENTES\n- Empiezo creatina \(20 sep\)\n- Vuelta a entrenar el 8 sep tras 10 semanas sin sesiones \(detectado por la app\)/);
  // Perfil sin la fecha de nacimiento (solo la edad) y con las limitaciones indicadas
  assert.match(txt, /- Edad: 36 años/);
  assert.ok(!txt.includes('1990-05-01'));
  assert.match(txt, /- Limitaciones o molestias que indiqué: Molestia leve en la rodilla izquierda/);
  // Marca histórica, volumen, deportes, carga
  assert.match(txt, /MARCAS HISTÓRICAS .*\n- Press banca: mejor referencia 102,5 kg × 5 · verano 2025 \(marca histórica\) · ahora ≈ \d+ % de esa referencia/);
  assert.match(txt, /- Pecho: 4,5 series\/semana \(rango 12–22\) → mantener: progresas con este volumen aunque esté por debajo del rango/);
  assert.match(txt, /RUNNING \(CARRERA A PIE\)\n- Últimas 4 semanas completas: 5 sesiones · 45 km · 63 min\/semana · carga 375\/semana/);
  assert.match(txt, /- Reparto: fuerza \d+ %, carrera \d+ %, senderismo \d+ %/);
  // Bienestar: recuentos y zonas (agujetas y molestias), sin conclusiones con pocos datos
  assert.match(txt, /ESTRÉS .*\n- Últimas 4 semanas: 8 respuestas · bajo 0, normal 3, alto 5\n- Rendimiento con estrés alto: aún no hay datos suficientes/);
  assert.match(txt, /- Zonas apuntadas \(4 semanas\): Cuádriceps: agujetas 8 días, media 6\/10 \(máx\. 6\) · Rodilla: molestia 8 días, media 3\/10/);
  assert.match(txt, /- Aún sin datos suficientes para relacionar \(hacen falta 6 veces con y 6 sin\): pierna con resistencia exigente el día antes/);
  // Evento con su tiempo previsto (race-predict) y prioridad
  assert.match(txt, /EVENTOS FUTUROS .*\n- San Silvestre \(10K\) · .* \(en 73 días\) · prioridad A · objetivo <50:00 · previsto hoy \d+:\d\d \(\d+:\d\d–\d+:\d\d, confianza \w+\) · (probable|ajustado|hoy no)/);
  assert.match(txt, /- Evento principal: San Silvestre \(10K\)/);
  assert.match(txt, /- Objetivo apuntado: Press banca 100 kg × 5/);
  // Confianza: las de confianza baja con su motivo; las previsiones no se repiten ahí
  const conf = txt.slice(txt.indexOf('DATOS CON BAJA CONFIANZA'), txt.indexOf('PREGUNTA'));
  assert.match(conf, /- Subes rápido, pero hay contexto: confianza baja — .*creatina/);
  assert.doesNotMatch(conf, /1RM est\./);
  // Pregunta: lee el contexto antes de concluir
  assert.match(txt, /ten en cuenta el CONTEXTO DEL USUARIO y los CAMBIOS RECIENTES, y trata con cautela los DATOS CON BAJA CONFIANZA/);
  // Nunca «causa» (salvo «no demuestran causa»)
  assert.doesNotMatch(txt.replace(/no demuestran causa|no una causa demostrada/g, ''), /\bcausa\b/);
  // No absurdamente largo
  const lines = txt.split('\n').length;
  assert.ok(lines < 140 && txt.length < 14000, `${lines} líneas, ${txt.length} caracteres`);
});

test('informe: privacidad (sin notas del contexto ni del evento) y menores (sin calorías ni dietas)', () => {
  const a = scenario({ extra: {} });
  const base = reportText(a);
  assert.ok(!/SECRETO/.test(base));
  // Notas en el contexto y en el evento: no salen
  const T = a.today;
  const withNotes = scenario({ extra: {
    context: [{ id: 'c1', kind: 'event', type: 'creatine_start', date: { date: addDays(T, -12), precision: 'day' }, text: '', notes: 'SECRETO del contexto', createdAt: 1, updatedAt: 1 }],
    races: [{ id: 'race1', name: 'San Silvestre', type: '10k', date: addDays(T, 73), distanceKm: 10, targetSec: 3000, priority: 'A', note: 'SECRETO del evento', goalId: null, createdAt: 1, updatedAt: 1 }],
  } });
  assert.doesNotMatch(reportText(withNotes), /SECRETO/);
  // Menor de 18: sin kcal, ni ajustes, ni «déficit»; la pregunta no pide calorías
  const minor = reportText(scenario({ profile: { birthDate: '2011-03-01', goal: 'lose' } }));
  assert.doesNotMatch(minor, /kcal|déficit|Ajuste orientativo|Rango recomendado/);
  assert.match(minor, /- Menor de 18 años: la app no da calorías/);
  assert.match(minor, /mi alimentación en general \(sin dietas ni calorías: soy menor de edad\)/);
});

test('informe: modo mujer sin permiso del ciclo no saca nada del ciclo aunque haya check-ins y eventos', () => {
  const a = scenario({ profile: { sex: 'female', cycleTracking: true, contraception: 'none' }, extra: { cycleDays: [] } });
  const txt = reportText(a, { includeCycle: false });
  assert.doesNotMatch(txt, /CICLO MENSTRUAL|Anticonceptivo|\bregla\b|menstrua/i);
  assert.match(txt, /- Sexo: Mujer/);
});
