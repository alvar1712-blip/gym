// analysis-report.js — «Copiar informe para tu IA» (ronda 5, docs/MEJORAS5.md §3c; ronda 6, fase F, docs/MEJORAS6.md).
// PURO: convierte el resultado de analysis.buildAnalysis() en texto plano en español para pegar en ChatGPT, Claude u
// otra IA, o dárselo a un entrenador. Prioriza lo que otra IA necesita para no equivocarse por falta de contexto:
//   PERFIL · OBJETIVO · CONTEXTO DEL USUARIO · CAMBIOS RECIENTES · PESO · FUERZA · MARCAS HISTÓRICAS · VOLUMEN ·
//   RUNNING · RÉCORDS DE RUNNING · REFERENCIAS PARA LA PREDICCIÓN ACTUAL · BICI · NATACIÓN · SENDERISMO ·
//   OTRAS ACTIVIDADES · CARGA · RECUPERACIÓN · SUEÑO · ENERGÍA · ESTRÉS ·
//   AGUJETAS/MOLESTIAS · (CICLO MENSTRUAL, solo con permiso) · EVENTOS FUTUROS · TENDENCIAS · INSIGHTS ·
//   CONFIANZA (DATOS CON BAJA CONFIANZA) · PREGUNTA
// «CONTEXTO DEL USUARIO», «CAMBIOS RECIENTES» y «DATOS CON BAJA CONFIANZA» salen siempre (decir que no hay nada también
// es información); las demás secciones solo si tienen algo útil. Cada valoración lleva su confianza.
// Privacidad: sin `includeCycle` no sale NADA del ciclo (ni la sección, ni el anticonceptivo, ni los Insights del área
// 'cycle', ni los de peso que hablan de la regla o de la retención de líquidos por fase). No incluye notas, nombres de
// rutinas ni la fecha de nacimiento (solo la edad). Menores: sin calorías. Pruebas: tests/unit/analysis-report.test.mjs
// y tests/unit/analysis.test.mjs.
import { fmtNum, fmtDate, fmtDuration } from './util.js';
import { SEXES, GOALS, SECONDARY_GOALS, EXPERIENCES, CONTRACEPTION, SPORTS as PROFILE_SPORTS, label, g, isFemale } from './profile.js';
import { MUSCLE_LABEL } from './seed.js';
import { LEVEL_LABEL, DISCLAIMER, isPlaceholder } from './analysis.js';
import { REPORT_HISTORY_MAX, rangeText } from './race-predict.js';

/** Insights de peso que revelan datos del ciclo (fuera del informe sin permiso). */
export const CYCLE_WEIGHT_IDS = ['weight-cycle-retention', 'weight-reds-cycle'];
/**
 * Insights cuyo contenido ya está en su sección (proteína en PESO; el reparto de carga, sin pico, en CARGA): no se
 * repiten en INSIGHTS.
 */
export const SHOWN_IN_SECTIONS = (i) => i.id === 'weight-protein' || (i.id === 'load-sport' && i.level === 'info');
/** Máximo de ejercicios listados en «Fuerza» y de músculos en «Volumen». */
const MAX_EXERCISES = 10;
/** Distancias de los récords de running en el informe (las de Progreso › Récords). */
const RECORD_LABELS = [['1k', '1 km'], ['5k', '5 km'], ['10k', '10 km'], ['half', 'Media maratón'], ['marathon', 'Maratón']];
const ORIGIN_TXT = { app: 'registrada en Entreno', import: 'actividad importada', context: 'marca histórica' };
const MAX_MUSCLES = 8;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const kg = (v, dec = 1) => `${fmtNum(v, dec)} kg`;
const signed = (v, dec, unit) => `${sgn(v)}${fmtNum(Math.abs(v), dec)}${unit}`;
const rate = (pct) => (isNum(pct) ? signed(pct, Math.abs(pct) < 1 ? 2 : 1, ' %/sem') : '—');
const pct = (v) => `${fmtNum(v, 0)} %`;
const day = (d, today) => (d ? fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full') : '—');
const STATUS = { fast: 'rápido', good: 'bien', stalled: 'estancado', down: 'bajando', insufficient: 'sin datos suficientes' };
const KIND_TAG = { recovery: 'recuperando una marca anterior', new_exercise: 'ejercicio nuevo (adaptación inicial)', new_best: 'mejor marca' };
const CONF = { insufficient: 'datos insuficientes', low: 'confianza baja', medium: 'confianza media', high: 'confianza alta' };
const DECISION = { keep: 'mantener', add: 'añadir 1–2 series', reduce: 'reducir', none: 'sin datos para decidir' };
const SPORT_SECTIONS = [['run', 'RUNNING (CARRERA A PIE)'], ['bike', 'BICI'], ['swim', 'NATACIÓN'], ['hike', 'SENDERISMO'], ['other', 'OTRAS ACTIVIDADES']];

/** ¿Se puede incluir este Insight en el informe? */
export function reportable(i, includeCycle) {
  if (!i) return false;
  if (includeCycle) return true;
  return i.area !== 'cycle' && !CYCLE_WEIGHT_IDS.includes(i.id);
}

const section = (title, lines) => (lines.filter(Boolean).length ? [title, ...lines.filter(Boolean)] : []);
const confTxt = (c) => (c ? CONF[c.level] || '' : '');

function expLabel(p) {
  const e = EXPERIENCES.find((x) => x.id === p.experience);
  if (!e) return 'sin indicar';
  const name = e.id === 'intermediate' ? g(p, 'Intermedio', 'Intermedia') : e.id === 'advanced' ? g(p, 'Avanzado', 'Avanzada') : e.label;
  return `${name} (${e.sub})`;
}

// ---------------------------------------------------------------------------
// Perfil, objetivo, contexto y cambios
// ---------------------------------------------------------------------------

function profileSection(a) {
  const p = a.profile || {};
  const years = a.context?.age?.years;
  const sports = (p.sports || []).map((s) => label(PROFILE_SPORTS, s)).filter((x) => x && x !== '—');
  return section('PERFIL', [
    `- Sexo: ${p.sex ? label(SEXES, p.sex) : 'sin indicar'}`,
    `- Edad: ${isNum(years) ? `${years} años` : 'sin indicar'}`,
    `- Experiencia en fuerza: ${expLabel(p)}`,
    sports.length ? `- Practico: ${sports.join(', ')}` : null,
    isNum(p.weeklyFrequency) ? `- Días de entrenamiento por semana (habitual): ${p.weeklyFrequency}` : null,
    p.limitations ? `- Limitaciones o molestias que indiqué: ${String(p.limitations).trim()}` : null,
  ]);
}

function goalSection(a) {
  const p = a.profile || {};
  const w = a.weight || {};
  const c = a.context || {};
  const lines = [`- Objetivo principal: ${p.goal ? label(GOALS, p.goal) : 'sin indicar'}`];
  const sec = (p.secondaryGoals || []).map((x) => label(SECONDARY_GOALS, x)).filter((x) => x && x !== '—');
  if (sec.length) lines.push(`- Otros objetivos: ${sec.join(', ')}`);
  if (w.goalSource === 'phase' && c.body) lines.push(`- Fase vigente en mi contexto: ${labelOf(c, `phase:${c.body.type}`) || c.body.type} (la app la usa para el rango de peso en lugar del objetivo del perfil)`);
  if (w.target && w.age !== 'minor') lines.push(`- Rango de peso que usa la app para ese objetivo: ${w.target.label}`);
  for (const goal of (a.goals || []).slice(0, 5)) lines.push(`- Objetivo apuntado: ${goal.title}`);
  const main = (a.events || []).find((x) => x.race.priority === 'A');
  if (main) lines.push(`- Evento principal: ${eventName(main.race)} el ${day(main.race.date, a.today)} (en ${main.days} días)`);
  return section('OBJETIVO', lines);
}

const labelOf = (c, key) => (c.labels || []).find((l) => l.key === key)?.text || null;

function contextSection(a) {
  const c = a.context || {};
  const lines = (c.labels || []).filter((l) => !l.key.startsWith('race:')).map((l) => `- ${l.text}`);
  const age = c.age?.group;
  if (age === 'minor') lines.push('- Menor de 18 años: la app no da calorías, ritmos de pérdida ni objetivos de peso; prioriza técnica, constancia y supervisión.');
  if (age === 'senior') lines.push('- 65 años o más: la app usa progresiones prudentes y ajustes de calorías pequeños.');
  if (c.training?.breakActive) lines.push('- Estoy en un parón de entrenamiento.');
  if (!lines.length) lines.push('- Nada apuntado ni detectado (ni fases, ni parones, ni suplementos, ni enfermedad o lesión).');
  return ['CONTEXTO DEL USUARIO (lo que está pasando ahora; tenlo en cuenta antes de interpretar)', ...lines];
}

function changesSection(a) {
  const c = a.context || {};
  const lines = (c.changes || []).map((x) => `- ${x.text}`);
  if (c.training?.returning && c.training.source === 'detected') lines.push(`- Vuelta a entrenar el ${day(c.training.since, a.today)} tras ${Math.round(c.training.gapDays / 7)} semanas sin sesiones (detectado por la app)`);
  for (const v of (a.hybrid?.volumeChanges || []).filter((x) => x.pattern !== 'none').slice(0, 3)) {
    lines.push(`- Volumen de ${v.name.toLowerCase()}: de ${fmtNum(v.avgA, 1)} a ${fmtNum(v.avgB, 1)} series/semana (últimas 6 semanas frente a las 6 anteriores)`);
  }
  if (!lines.length) lines.push('- Ninguno en las últimas 6 semanas.');
  return ['CAMBIOS RECIENTES', ...lines];
}

// ---------------------------------------------------------------------------
// Peso, fuerza, marcas, volumen
// ---------------------------------------------------------------------------

function weightSection(a) {
  const w = a.weight || {};
  const t = w.trend;
  const minor = w.age === 'minor';
  const out = [];
  if (t && isNum(t.currentKg)) {
    out.push(`- Peso de tendencia: ${kg(t.currentKg)} (media exponencial de ~10 días)${t.lastDate && isNum(t.lastKg) ? `; último pesaje ${kg(t.lastKg)} el ${day(t.lastDate, a.today)}` : ''}`);
  }
  if (w.ok && t) {
    const win = t.windowDays >= 21 ? `las últimas ${Math.round(t.windowDays / 7)} semanas` : `los últimos ${t.windowDays} días`;
    out.push(`- Ritmo: ${signed(t.ratePerWeekKg, 2, ' kg/semana')} (${signed(t.ratePerWeekPct, 2, ' %')} del peso por semana) en ${win}, con ${t.n} pesajes${t.ci ? `; margen del 95 %: ${signed(t.ci.lo, 2, '')} a ${signed(t.ci.hi, 2, ' kg/sem')}` : ''}${w.confidence ? ` (${confTxt(w.confidence)})` : ''}`);
  } else {
    out.push(`- Sin ritmo fiable todavía: ${w.reason || 'faltan pesajes'}`);
  }
  if (w.target && !minor) out.push(`- Rango recomendado para mi objetivo: ${w.target.label}${w.target.recommended ? ` (mejor ${w.target.recommended.label})` : ''} → ${w.paceLabel || '—'}`);
  const kc = w.kcalPerDay;
  if (!minor && kc && isNum(kc.estimate)) out.push(`- Balance energético estimado: ${signed(kc.estimate, 0, ' kcal/día')} (aproximación con 7700 kcal/kg)`);
  if (!minor && kc && kc.suggestion) {
    const a1 = Math.min(Math.abs(kc.suggestion.min), Math.abs(kc.suggestion.max));
    const b1 = Math.max(Math.abs(kc.suggestion.min), Math.abs(kc.suggestion.max));
    out.push(`- Ajuste orientativo: ${fmtNum(a1, 0)}–${fmtNum(b1, 0)} kcal ${kc.suggestion.max > 0 ? 'más' : 'menos'} al día`);
  }
  const p = w.proteinG;
  if (p && isNum(p.min) && isNum(p.max)) out.push(`- Proteína orientativa: ${fmtNum(p.min, 0)}–${fmtNum(p.max, 0)} g/día (1,6–2,2 g/kg)`);
  return section('PESO', out);
}

function strengthSection(a) {
  const s = a.strength || {};
  const sum = s.summary || {};
  const out = [];
  const load = sportRow(a, 'strength');
  if (load) out.push(`- Últimas 4 semanas completas: ${load.sessions4w} sesiones · ${fmtNum(load.minutes4w, 0)} min/semana`);
  const analyzed = (s.exercises || []).filter((x) => x.status !== 'insufficient');
  if (!analyzed.length) {
    out.push('- Aún no hay ejercicios con datos suficientes (4 sesiones en 3 semanas).');
  } else {
    if (isNum(sum.trendPctPerWeek)) {
      out.push(`- Ritmo típico del 1RM estimado: ${rate(sum.trendPctPerWeek)} (mediana de ${sum.mainCount} ${sum.mainOnly ? 'ejercicios principales' : 'ejercicios'}) · mejoran ${sum.improving} · estancados ${sum.stalled} · bajando ${sum.down}${sum.recovering ? ` · ${sum.recovering} recuperando una marca anterior` : ''}`);
    }
    for (const x of analyzed.slice(0, MAX_EXERCISES)) {
      const tag = KIND_TAG[x.kind] ? ` · ${KIND_TAG[x.kind]}` : '';
      out.push(`- ${x.name}: 1RM est. ${kg(x.e1rmNow)} · ${rate(x.ratePctPerWeek)} · ${x.status === 'good' && x.slow ? 'bien, despacio para mi nivel' : STATUS[x.status]}${tag} · ${x.sessions} sesiones en ${x.windowWeeks} semanas${x.confidence ? ` · ${confTxt(x.confidence)}` : ''}`);
    }
    if (analyzed.length > MAX_EXERCISES) out.push(`- (${analyzed.length - MAX_EXERCISES} ejercicios más con datos)`);
  }
  return section('FUERZA (1RM estimado con Epley; tendencia robusta de 6–12 semanas)', out);
}

function marksSection(a) {
  const rows = (a.strength?.exercises || []).filter((x) => x.recovery?.hasMarks);
  return section('MARCAS HISTÓRICAS (anteriores a la app o fuera de ella; la app las compara con lo de las últimas 4 semanas)', rows.map((x) => {
    const r = x.recovery;
    const now = r.status === 'ok' && isNum(r.pct) ? ` · ahora ≈ ${r.pct} % de esa referencia` : r.status === 'no_current' ? ' · sin series comparables en las últimas 4 semanas' : '';
    return `- ${x.name}: mejor referencia ${r.refLabel}${now}`;
  }));
}

function volumeSection(a) {
  const v = a.hybrid?.volume;
  if (!v || !v.weeks) return [];
  const rows = (v.muscles || []).filter((m) => m.decision !== 'none').slice(0, MAX_MUSCLES);
  const lines = rows.map((m) => `- ${m.name}: ${fmtNum(m.avgSets, 1)} series/semana (rango ${m.target[0]}–${m.target[1]}) → ${DECISION[m.decision]}: ${m.reasons.join(', ')}`);
  if (v.adherence?.planned && v.adherence.pctPast != null) lines.push(`- Constancia (4 semanas): ${v.adherence.completed} de ${v.adherence.planned - v.adherence.pending} sesiones planificadas (${v.adherence.pctPast} %)`);
  return section('VOLUMEN (series efectivas por músculo, media de las 4 semanas completas)', lines);
}

// ---------------------------------------------------------------------------
// Deportes, carga, recuperación
// ---------------------------------------------------------------------------

const sportRow = (a, kind) => (a.hybrid?.sportLoad?.rows || []).find((r) => r.kind === kind && (r.sessions4w > 0 || r.lastWeekLoad > 0)) || null;

function sportLine(r) {
  const bits = [`${r.sessions4w} ${r.sessions4w === 1 ? 'sesión' : 'sesiones'}`];
  if (isNum(r.km4w) && r.km4w > 0) bits.push(`${fmtNum(r.km4w, r.km4w < 10 ? 1 : 0)} km`);
  bits.push(`${fmtNum(r.minutes4w, 0)} min/semana`);
  if (r.load4w > 0) bits.push(`carga ${fmtNum(r.load4w, 0)}/semana${r.changePct != null ? ` (${signed(r.changePct, 0, ' %')} frente a las 4 anteriores)` : ''}`);
  if (r.noRpe4w) bits.push(`${r.noRpe4w} sin esfuerzo (RPE) apuntado`);
  return `- Últimas 4 semanas completas: ${bits.join(' · ')}`;
}

/**
 * RÉCORD PERSONAL: la mejor marca de siempre en cada distancia (registrada, importada o marca histórica de tu contexto);
 * su antigüedad no le quita valor. Sin nombres ni notas.
 */
function runRecordsSection(a) {
  const best = a.running?.records?.best;
  if (!best || !Object.values(best).some(Boolean)) return [];
  const lines = RECORD_LABELS.map(([id, label]) => {
    const b = best[id];
    if (!b) return `- ${label} — sin marca`;
    return `- ${label} — ${fmtDuration(b.timeSec)} — ${b.when} — ${ORIGIN_TXT[b.source] || ''}${b.how === 'partial' ? ` (mejor tramo dentro de una carrera de ${fmtNum(b.fromKm, 2)} km)` : b.estimated ? ` (estimado a ritmo medio desde una carrera de ${fmtNum(b.fromKm, 2)} km)` : ''}`;
  });
  return section('RÉCORDS DE RUNNING (mi mejor marca de siempre en cada distancia; su antigüedad no le quita valor)', lines);
}

/**
 * PREDICCIÓN ACTUAL: lo que usa la estimación de hoy (carreras recientes y referencias históricas, con su antigüedad y
 * el parón posterior) y el tiempo previsto. Aquí sí importa cuándo fue y qué hice después.
 */
function runPredictionSection(a) {
  const r = a.running;
  if (!r || (!r.refs?.length && !r.predictions?.length)) return [];
  const lines = r.refs.map((x) => {
    const dist = Math.abs(x.km - 21.0975) < 0.001 ? 'Media maratón' : Math.abs(x.km - 42.195) < 0.001 ? 'Maratón' : `${fmtNum(x.km, 2)} km`;
    const what = x.source === 'context' ? (x.old ? 'marca histórica, pesa menos por antigua' : 'resultado apuntado')
      : x.partial ? `mejor tramo de ${dist.replace(/^M/, 'm')} dentro de una carrera de ${fmtNum(x.partial.ofKm, 2)} km` : 'carrera registrada';
    return `- ${dist} — ${fmtDuration(x.sec)} — ${x.whenLong} (${x.ageText}; ${what})${x.interrupted ? ` · después hubo ${x.interrupted}${x.old ? '' : ' (pesa la mitad)'}` : ''}`;
  });
  if (r.historyTotal > REPORT_HISTORY_MAX) lines.push(`- (${r.historyTotal - REPORT_HISTORY_MAX} marcas históricas más antiguas sin listar)`);
  if (r.duplicates?.length) lines.push(`- ${r.duplicates.length === 1 ? '1 resultado apuntado coincide' : `${r.duplicates.length} resultados apuntados coinciden`} con una carrera registrada: se cuenta una sola vez`);
  const pred = (r.predictions || []).map((p) => {
    if (p.mid == null) return `${p.label}: sin previsión útil`;
    // El mismo trío que las pantallas: previsto (rango, confianza)
    return `${p.label} ≈ ${fmtDuration(p.mid)} (${rangeText(p)}, ${p.status === 'tentative' ? 'orientativo, ' : ''}confianza ${p.confidence})`;
  });
  if (pred.length) lines.push(`- Tiempo previsto hoy: ${pred.join(' · ')}`);
  return section('REFERENCIAS PARA LA PREDICCIÓN ACTUAL (aquí sí importa cuándo fue y qué he hecho después: lo reciente pesa más y lo anterior a un parón, menos)', lines);
}

function sportSections(a) {
  const e = a.endurance || {};
  return SPORT_SECTIONS.map(([kind, title]) => {
    const r = sportRow(a, kind);
    const lines = r ? [sportLine(r)] : [];
    if (kind === 'run') {
      const it = e.intensity;
      if (it && isNum(it.easyShare) && (it.easyMin + it.hardMin) > 0) lines.push(`- Reparto de intensidad de la resistencia (4 semanas): ${pct(it.easyShare * 100)} suave / ${pct(100 - it.easyShare * 100)} intenso`);
      const fit = e.fitness || [];
      // Forma por bloques (solo carreras registradas de cada bloque): NO es el 5 km previsto de hoy (ese va en
      // «Referencias para la predicción actual»)
      if (fit.length) lines.push(`- Forma en 5 km por bloques de 4 semanas: ${fit.map((b) => fmtDuration(b.pred5kSec)).join(' → ')}`);
    }
    return lines.length ? section(title, lines) : [];
  });
}

function loadSection(a) {
  const sl = a.hybrid?.sportLoad;
  const rows = (sl?.rows || []).filter((r) => r.load4w > 0);
  if (!rows.length) return [];
  const prev = (sl.rows || []).reduce((t, r) => t + (r.prevLoad4w || 0), 0) / 4;
  const total = sl.total4w;
  const change = prev > 0 ? ((total - prev) / prev) * 100 : null;
  const lines = [`- Carga total (minutos × esfuerzo RPE), media semanal de las 4 semanas completas: ${fmtNum(total, 0)}${change != null ? ` (${signed(change, 0, ' %')} frente a las 4 anteriores)` : ''}`,
    `- Reparto: ${rows.map((r) => `${r.label.toLowerCase()} ${pct(r.share)}`).join(', ')} (cada deporte se mide aparte: 3 h de senderismo suave no pesan como 3 h de carrera)`];
  for (const r of (sl.rows || []).filter((x) => x.spike)) lines.push(`- Esta semana: pico de carga de ${r.label.toLowerCase()} (${fmtNum(r.lastWeekLoad, 0)} frente a ${fmtNum(r.load4w, 0)} de media)`);
  return section('CARGA', lines);
}

const assocOf = (a, id) => (a.hybrid?.associations || []).find((x) => x.id === id) || null;
function assocLine(x, what) {
  if (!x) return null;
  if (x.pattern === 'insufficient') return `- ${what}: aún no hay datos suficientes para relacionarlo (${x.n1} y ${x.n2}; hacen falta 6 y 6)`;
  const d = x.diff;
  const diffTxt = Math.abs(d) < 0.05 ? 'sin diferencia' : x.id === 'doms-after-leg-volume' ? `${signed(d, 1, ' puntos de 10')}` : x.id === 'skips-with-endurance' ? `${signed(d, 0, ' puntos')}` : signed(d, 1, ' %');
  const verdict = x.pattern === 'worse' ? 'aparece asociado a peor resultado' : x.pattern === 'better' ? 'sin peor resultado (incluso mejor)' : 'sin diferencia apreciable';
  return `- ${what}: ${verdict} (${diffTxt}; ${x.n1} frente a ${x.n2}; ${confTxt(x.confidence)})`;
}

function recoverySection(a) {
  const r = a.recovery || {};
  const lines = [];
  if (isNum(r.linked)) lines.push(`- Sesiones de fuerza con check-in (últimas semanas): ${r.linked}`);
  const items = [
    [assocOf(a, 'legs-after-endurance'), 'Pierna con resistencia exigente el día antes'],
    [assocOf(a, 'run-after-legs'), 'Rodajes suaves al día siguiente de pierna'],
    [assocOf(a, 'skips-with-endurance'), 'Sesiones de fuerza saltadas o a medias en semanas de mucha resistencia'],
  ].filter(([x]) => x);
  for (const [x, what] of items) if (x.pattern !== 'insufficient') lines.push(assocLine(x, what));
  const few = items.filter(([x]) => x.pattern === 'insufficient');
  if (few.length) lines.push(`- Aún sin datos suficientes para relacionar (hacen falta 6 veces con y 6 sin): ${few.map(([x, what]) => `${what.charAt(0).toLowerCase()}${what.slice(1)} (${x.n1} y ${x.n2})`).join('; ')}`);
  return section('RECUPERACIÓN (comparaciones con mis propios registros; asociaciones, no causas)', lines);
}

function levelCounts(c, words) {
  if (!c || !c.n) return null;
  return `${c.n} respuestas · ${words[0]} ${c.low}, normal ${c.normal}, ${words[1]} ${c.high}`;
}

function compareLine(cmp, noun) {
  if (!cmp) return null;
  if (cmp.low == null || cmp.other == null) return null;
  const verdict = cmp.pattern ? 'rindo menos' : 'sin diferencia clara';
  return `- Rendimiento con ${noun} bajo frente a normal o alto: ${pct(cmp.low * 100)} y ${pct(cmp.other * 100)} de mi máximo reciente (${cmp.nLow} y ${cmp.nOther} sesiones) → ${verdict}`;
}

function wellbeingSections(a) {
  const wb = a.wellbeing;
  if (!wb || !wb.count) return [];
  const r = a.recovery || {};
  const head = (key, words) => { const t = levelCounts(wb[key], words); return t ? `- Últimas 4 semanas: ${t}` : null; };
  const sleep = section('SUEÑO (check-in: bajo · normal · alto)', [head('sleep', ['bajo', 'alto']), compareLine(r.sleep, 'sueño')]);
  const energy = section('ENERGÍA (check-in: baja · normal · alta)', [head('energy', ['baja', 'alta']), compareLine(r.energy, 'energía')]);
  const stress = section('ESTRÉS (check-in: bajo · normal · alto)', [head('stress', ['bajo', 'alto']), assocLine(assocOf(a, 'perf-with-stress'), 'Rendimiento con estrés alto')]);
  const zones = (wb.areas || []).slice(0, 6).map((z) => `${z.name}: ${z.kind === 'muscle' ? 'agujetas' : 'molestia'} ${z.times} ${z.times === 1 ? 'día' : 'días'}, media ${fmtNum(z.avg, 1)}/10 (máx. ${z.max})`);
  const doms = (a.hybrid?.doms || []).filter((x) => x.pattern === 'worse').slice(0, 2)
    .map((x) => `- En mis registros, ${x.name} aparece asociado a más agujetas de ${(MUSCLE_LABEL[x.muscleId] || x.muscleId).toLowerCase()} (${fmtNum(x.withEx, 1)}/10 frente a ${fmtNum(x.without, 1)}/10 sin él)`);
  const general = levelCounts(wb.soreness, ['bajas', 'altas']);
  const soreness = section('AGUJETAS/MOLESTIAS', [
    general ? `- Agujetas generales (últimas 4 semanas): ${general}` : null,
    zones.length ? `- Zonas apuntadas (4 semanas): ${zones.join(' · ')}` : null,
    assocLine(assocOf(a, 'perf-with-doms'), 'Rendimiento con agujetas fuertes antes de entrenar'),
    assocLine(assocOf(a, 'doms-after-leg-volume'), 'Más series de pierna y agujetas después'),
    ...doms,
  ]);
  return [sleep, energy, stress, soreness];
}

function cycleSection(a) {
  const c = a.cycle;
  if (!c) return [];
  const p = a.profile || {};
  const out = ['CICLO MENSTRUAL'];
  out.push(`- Anticonceptivo: ${p.contraception ? label(CONTRACEPTION, p.contraception) : 'sin indicar'}`);
  if (c.basis) out.push(`- ${c.basis}`);
  out.push(`- Hoy: ${c.state}${c.next ? ` · ${c.next}` : ''}`);
  const info = c.info || {};
  const lens = (info.cycles || []).slice(-6).map((x) => x.lengthDays);
  if (lens.length) out.push(`- Duración de los últimos ciclos: ${lens.join(', ')} días`);
  return out;
}

// ---------------------------------------------------------------------------
// Eventos, tendencias, insights y confianza
// ---------------------------------------------------------------------------

const TYPE_LABEL = { '5k': '5K', '10k': '10K', half: 'Media maratón', marathon: 'Maratón', cycling: 'Ciclismo', hiking: 'Senderismo', triathlon: 'Triatlón', custom: 'Evento' };
function eventName(race) {
  const t = TYPE_LABEL[race.type] || 'Evento';
  return race.name ? `${race.name} (${t})` : t;
}

function eventsSection(a) {
  return section('EVENTOS FUTUROS (apuntados; la app no cambia el plan por ellos)', (a.events || []).map((x) => {
    const r = x.race;
    const bits = [`${eventName(r)} · ${day(r.date, a.today)} (en ${x.days} días) · prioridad ${r.priority}`];
    if (isNum(r.distanceKm) && !['5k', '10k', 'half', 'marathon'].includes(r.type)) bits.push(`${fmtNum(r.distanceKm, 1)} km`);
    if (isNum(r.targetSec)) bits.push(`objetivo <${fmtDuration(r.targetSec)}`);
    const p = x.prediction;
    if (p && p.range) bits.push(`previsto hoy ${fmtDuration(p.mid)} (${p.range}${p.confidence ? `, confianza ${p.confidence}` : ''})${p.verdict !== 'prevision' ? ` · ${p.label.toLowerCase()}` : ''}`);
    return `- ${bits.join(' · ')}`;
  }));
}

function trendsSection(a, includeCycle) {
  const lines = [];
  const t = a.weight?.trend;
  if (a.weight?.ok && t && isNum(t.ratePerWeekKg)) lines.push(`- Peso: ${t.direction === 'stable' ? 'estable' : t.ratePerWeekKg > 0 ? 'sube' : 'baja'} (${signed(t.ratePerWeekKg, 2, ' kg/semana')})`);
  const sum = a.strength?.summary;
  if (sum && isNum(sum.trendPctPerWeek)) lines.push(`- Fuerza: ${rate(sum.trendPctPerWeek)} de ritmo típico; ${sum.improving} mejoran, ${sum.stalled} estancados, ${sum.down} bajando`);
  const fit = a.endurance?.fitness || [];
  if (fit.length >= 2) lines.push(`- Forma en 5 km por bloques de 4 semanas: ${fmtDuration(fit[0].pred5kSec)} → ${fmtDuration(fit[fit.length - 1].pred5kSec)}`);
  const sl = a.hybrid?.sportLoad;
  if (sl && sl.total4w > 0) {
    const prev = (sl.rows || []).reduce((s, r) => s + (r.prevLoad4w || 0), 0) / 4;
    if (prev > 0) lines.push(`- Carga semanal: ${signed(((sl.total4w - prev) / prev) * 100, 0, ' %')} frente a las 4 semanas anteriores`);
  }
  // Título y texto completos: el texto de una previsión continúa su título («Press banca: 1RM est. 106–112,5 kg en 4
  // semanas. Previsto hacia el …»).
  for (const i of (a.forecast || []).filter((x) => reportable(x, includeCycle))) lines.push(`- Si sigo así · ${i.title}. ${i.text}`);
  return section('TENDENCIAS', lines);
}

function insightLine(i) {
  const src = (i.sources || []).map((s) => s.short).filter(Boolean);
  const tags = [LEVEL_LABEL[i.level] || 'Info', confTxt(i.confidence)].filter(Boolean).join(' · ');
  return `  • [${tags}] ${i.title}. ${i.text}${src.length ? ` (Fuentes: ${src.join('; ')})` : ''}`;
}

function insightsSection(a, includeCycle) {
  const list = (a.all || []).filter((i) => i.area !== 'forecast' && reportable(i, includeCycle) && !SHOWN_IN_SECTIONS(i));
  const real = list.filter((i) => !isPlaceholder(i));
  const missing = list.filter(isPlaceholder);
  const lines = real.map(insightLine);
  if (missing.length) lines.push(`- Faltan datos para: ${missing.map((i) => i.title.replace(/\.$/, '')).join(' · ')}`);
  return section('INSIGHTS (valoraciones de la app, en segunda persona: se refieren a mí; por importancia)', lines);
}

function confidenceSection(a, includeCycle) {
  // Las previsiones nunca pasan de «media» y ya dicen que son estimaciones: aquí no se repiten.
  const low = (a.all || []).filter((i) => i.area !== 'forecast' && reportable(i, includeCycle) && !isPlaceholder(i) && i.confidence && (i.confidence.level === 'low' || i.confidence.level === 'insufficient'));
  const lines = ['- Niveles: alta · media · baja · datos insuficientes (no son probabilidades). Las asociaciones salen de mis registros: no demuestran causa.'];
  for (const i of low) lines.push(`- ${i.title}: ${confTxt(i.confidence)}${i.confidence.reasons?.length ? ` — ${i.confidence.reasons.slice(0, 3).join('; ')}` : ''}`);
  const gaps = [];
  const noRpe = (a.hybrid?.sportLoad?.rows || []).reduce((t, r) => t + (r.noRpe4w || 0), 0);
  if (noRpe) gaps.push(`${noRpe} ${noRpe === 1 ? 'sesión' : 'sesiones'} sin esfuerzo (RPE) en 4 semanas: su carga no cuenta`);
  if (!a.weight?.ok) gaps.push('sin ritmo de peso fiable');
  if (!a.wellbeing?.count) gaps.push('sin check-ins en las últimas 4 semanas (sueño, energía, estrés, agujetas)');
  if (gaps.length) lines.push(`- Datos que faltan o están incompletos: ${gaps.join('; ')}`);
  if (lines.length === 1) lines.push('- Ninguna valoración con confianza baja.');
  return ['CONFIANZA — DATOS CON BAJA CONFIANZA (tómalos con cautela)', ...lines];
}

function question(a) {
  const p = a.profile || {};
  const minor = a.context?.age?.group === 'minor' || a.weight?.age === 'minor';
  const who = [];
  if (p.sex) who.push(g(p, 'hombre', 'mujer'));
  const exp = EXPERIENCES.find((x) => x.id === p.experience);
  // «experiencia» es femenino para todos: «experiencia intermedia», «experiencia avanzada».
  if (exp) who.push(`con experiencia ${{ beginner: 'de principiante', intermediate: 'intermedia', advanced: 'avanzada' }[exp.id]} en fuerza (${exp.sub})`);
  const goal = p.goal ? label(GOALS, p.goal).toLowerCase() : null;
  const intro = `${who.length ? `Soy ${who.join(', ')}` : 'Entreno fuerza y resistencia'}${goal ? ` y mi objetivo es ${goal}` : ''}.`;
  const food = minor ? 'mi alimentación en general (sin dietas ni calorías: soy menor de edad)' : 'mi alimentación (calorías y proteína)';
  return [
    'PREGUNTA',
    `${intro} Con estos datos, ¿qué ajustarías en las próximas 4–8 semanas en mi entrenamiento (volumen, intensidad, ejercicios estancados, resistencia), ${food} y mi descanso? Antes de concluir, ten en cuenta el CONTEXTO DEL USUARIO y los CAMBIOS RECIENTES, y trata con cautela los DATOS CON BAJA CONFIANZA. Dime qué harías primero, por qué, y qué datos te faltarían para afinar. No registro la comida y las cifras son estimaciones de la app.`,
  ];
}

/**
 * Texto para pegar en una IA. PURO.
 * @param {object} analysis resultado de buildAnalysis()
 * @param {{ includeCycle?: boolean }} [opts] includeCycle: solo tiene efecto en modo mujer con seguimiento del ciclo
 * @returns {string}
 */
export function reportText(analysis, { includeCycle = false } = {}) {
  const a = analysis || {};
  const p = a.profile || {};
  const today = a.today || '';
  const withCycle = !!includeCycle && !!a.cycle && isFemale(p);
  const head = [
    `INFORME DE ENTRENAMIENTO · Entreno · ${today ? fmtDate(today, 'full') : ''}`.trim(),
    'Datos de mi app de entrenamiento (Entreno), que calcula en el móvil tendencias con estadística y reglas basadas en estudios. Las valoraciones de la app están escritas en segunda persona (se refieren a mí).',
    DISCLAIMER,
  ];
  const sports = sportSections(a); // RUNNING primero, y justo después sus referencias históricas
  const sections = [
    head,
    profileSection(a),
    goalSection(a),
    contextSection(a),
    changesSection(a),
    weightSection(a),
    strengthSection(a),
    marksSection(a),
    volumeSection(a),
    sports[0],
    runRecordsSection(a),
    runPredictionSection(a),
    ...sports.slice(1),
    loadSection(a),
    recoverySection(a),
    ...wellbeingSections(a),
    withCycle ? cycleSection(a) : [],
    eventsSection(a),
    trendsSection(a, withCycle),
    insightsSection(a, withCycle),
    confidenceSection(a, withCycle),
    question(a),
  ].filter((s) => s.length);
  return `${sections.map((s) => s.join('\n')).join('\n\n')}\n`;
}
