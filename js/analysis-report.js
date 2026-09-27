// analysis-report.js — «Copiar informe para tu IA» (ronda 5, docs/MEJORAS5.md §3c). PURO: convierte el resultado de
// analysis.buildAnalysis() en texto plano en español para pegar en ChatGPT, Claude u otra IA: perfil, peso, fuerza,
// resistencia, recuperación, ciclo (solo si se permite), próximas semanas y una pregunta final.
// Privacidad: sin `includeCycle` no sale NADA del ciclo (ni la sección, ni el anticonceptivo, ni los Insights del área
// 'cycle', ni los de peso que hablan de la regla o de la retención de líquidos por fase). No incluye notas ni nombres
// de rutinas. Pruebas: tests/unit/analysis.test.mjs.
import { fmtNum, fmtDate, fmtDuration } from './util.js';
import { SEXES, GOALS, EXPERIENCES, CONTRACEPTION, label, g, isFemale } from './profile.js';
import { LEVEL_LABEL, DISCLAIMER } from './analysis.js';

/** Insights de peso que revelan datos del ciclo (fuera del informe sin permiso). */
export const CYCLE_WEIGHT_IDS = ['weight-cycle-retention', 'weight-reds-cycle'];
/** Máximo de ejercicios listados en «Fuerza». */
const MAX_EXERCISES = 12;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const kg = (v, dec = 1) => `${fmtNum(v, dec)} kg`;
const signed = (v, dec, unit) => `${sgn(v)}${fmtNum(Math.abs(v), dec)}${unit}`;
const rate = (pct) => (isNum(pct) ? signed(pct, Math.abs(pct) < 1 ? 2 : 1, ' %/sem') : '—');
const day = (d, today) => (d ? fmtDate(d, d.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full') : '—');
const STATUS = { fast: 'rápido', good: 'bien', stalled: 'estancado', down: 'bajando', insufficient: 'sin datos suficientes' };

/** ¿Se puede incluir este Insight en el informe? */
export function reportable(i, includeCycle) {
  if (!i) return false;
  if (includeCycle) return true;
  return i.area !== 'cycle' && !CYCLE_WEIGHT_IDS.includes(i.id);
}

function expLabel(p) {
  const e = EXPERIENCES.find((x) => x.id === p.experience);
  if (!e) return 'sin indicar';
  const name = e.id === 'intermediate' ? g(p, 'Intermedio', 'Intermedia') : e.id === 'advanced' ? g(p, 'Avanzado', 'Avanzada') : e.label;
  return `${name} (${e.sub})`;
}

function insightLine(i) {
  const src = (i.sources || []).map((s) => s.short).filter(Boolean);
  return `  • [${LEVEL_LABEL[i.level] || 'Info'}] ${i.title}. ${i.text}${src.length ? ` (Fuentes: ${src.join('; ')})` : ''}`;
}

function observations(list, includeCycle) {
  const ok = list.filter((i) => reportable(i, includeCycle));
  if (!ok.length) return [];
  return ['- Valoraciones de la app:', ...ok.map(insightLine)];
}

function weightSection(a, includeCycle) {
  const w = a.weight || {};
  const t = w.trend;
  const out = ['PESO CORPORAL'];
  if (t && isNum(t.currentKg)) {
    out.push(`- Peso de tendencia: ${kg(t.currentKg)} (media exponencial de ~10 días)${t.lastDate && isNum(t.lastKg) ? `; último pesaje ${kg(t.lastKg)} el ${day(t.lastDate, a.today)}` : ''}`);
  }
  if (w.ok && t) {
    const win = t.windowDays >= 21 ? `las últimas ${Math.round(t.windowDays / 7)} semanas` : `los últimos ${t.windowDays} días`;
    out.push(`- Ritmo: ${signed(t.ratePerWeekKg, 2, ' kg/semana')} (${signed(t.ratePerWeekPct, 2, ' %')} del peso por semana) en ${win}, con ${t.n} pesajes${t.ci ? `; margen del 95 %: ${signed(t.ci.lo, 2, '')} a ${signed(t.ci.hi, 2, ' kg/sem')}` : ''}`);
  } else {
    out.push(`- Sin ritmo fiable todavía: ${w.reason || 'faltan pesajes'}`);
  }
  if (w.target) {
    out.push(`- Rango recomendado para mi objetivo: ${w.target.label}${w.target.recommended ? ` (mejor ${w.target.recommended.label})` : ''} → ${w.paceLabel || '—'}`);
  }
  const kc = w.kcalPerDay;
  if (kc && isNum(kc.estimate)) out.push(`- Balance energético estimado: ${signed(kc.estimate, 0, ' kcal/día')} (aproximación con 7700 kcal/kg)`);
  if (kc && kc.suggestion) {
    const a1 = Math.min(Math.abs(kc.suggestion.min), Math.abs(kc.suggestion.max));
    const b1 = Math.max(Math.abs(kc.suggestion.min), Math.abs(kc.suggestion.max));
    out.push(`- Ajuste orientativo: ${fmtNum(a1, 0)}–${fmtNum(b1, 0)} kcal ${kc.suggestion.max > 0 ? 'más' : 'menos'} al día`);
  }
  const p = w.proteinG;
  if (p && isNum(p.min) && isNum(p.max)) out.push(`- Proteína orientativa: ${fmtNum(p.min, 0)}–${fmtNum(p.max, 0)} g/día (1,6–2,2 g/kg)`);
  out.push(...observations(w.insights || [], includeCycle));
  return out;
}

function strengthSection(a, includeCycle) {
  const s = a.strength || {};
  const sum = s.summary || {};
  const out = ['FUERZA (1RM estimado con Epley; tendencia robusta de 6–12 semanas)'];
  const analyzed = (s.exercises || []).filter((x) => x.status !== 'insufficient');
  if (!analyzed.length) {
    out.push('- Aún no hay ejercicios con datos suficientes (4 sesiones en 3 semanas).');
  } else {
    if (isNum(sum.trendPctPerWeek)) {
      out.push(`- Ritmo típico: ${rate(sum.trendPctPerWeek)} (mediana de ${sum.mainCount} ${sum.mainOnly ? 'ejercicios principales' : 'ejercicios'}) · mejoran ${sum.improving} · estancados ${sum.stalled} · bajando ${sum.down}`);
    }
    for (const x of analyzed.slice(0, MAX_EXERCISES)) {
      out.push(`- ${x.name}: 1RM est. ${kg(x.e1rmNow)} · ${rate(x.ratePctPerWeek)} · ${x.status === 'good' && x.slow ? 'bien, despacio para mi nivel' : STATUS[x.status]} · ${x.sessions} sesiones en ${x.windowWeeks} semanas${x.lastPrDate ? ` · último récord ${day(x.lastPrDate, a.today)}` : ''}`);
    }
    if (analyzed.length > MAX_EXERCISES) out.push(`- (${analyzed.length - MAX_EXERCISES} ejercicios más con datos)`);
  }
  out.push(...observations((s.insights || []).filter((i) => i.area === 'strength'), includeCycle));
  return out;
}

function enduranceSection(a, includeCycle) {
  const e = a.endurance || {};
  const out = ['RESISTENCIA'];
  out.push(`- Minutos semanales de carrera, bici, natación y senderismo (media de 4 semanas): ${fmtNum(e.weeklyMinutes4w || 0, 0)} min`);
  const it = e.intensity;
  if (it && isNum(it.easyShare) && (it.easyMin + it.hardMin) > 0) {
    out.push(`- Reparto de intensidad (4 semanas): ${fmtNum(it.easyShare * 100, 0)} % suave / ${fmtNum(100 - it.easyShare * 100, 0)} % intenso (${fmtNum(it.easyMin, 0)} y ${fmtNum(it.hardMin, 0)} min)`);
  }
  const fit = e.fitness || [];
  if (fit.length) {
    out.push(`- 5 km previsto por bloques de 4 semanas: ${fit.map((b) => `${fmtDuration(b.pred5kSec)} (${day(b.weekStart, a.today)}–${day(b.weekEnd, a.today)})`).join(' → ')}`);
  }
  out.push(...observations((e.insights || []).filter((i) => i.area === 'endurance'), includeCycle));
  return out;
}

function recoverySection(a, includeCycle) {
  const r = a.recovery || {};
  const out = ['RECUPERACIÓN (sueño y energía del check-in frente al rendimiento de la sesión)'];
  if (isNum(r.linked)) out.push(`- Sesiones de fuerza con check-in: ${r.linked}`);
  out.push(...observations((r.insights || []).filter((i) => i.area !== 'cycle'), includeCycle));
  return out;
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
  out.push(...observations(c.insights || [], true));
  return out;
}

function forecastSection(a, includeCycle) {
  const list = (a.forecast || []).filter((i) => reportable(i, includeCycle));
  if (!list.length) return [];
  // El texto ya lleva las cifras; del título solo hace falta el sujeto («Press banca: …», «Peso: …», «5 km: …»).
  const subject = (i) => (i.title.includes(':') ? `${i.title.split(':')[0]}: ` : '');
  return ['PRÓXIMAS SEMANAS (si sigo así)', ...list.map((i) => `- ${subject(i)}${i.text}`)];
}

function question(a) {
  const p = a.profile || {};
  const who = [];
  if (p.sex) who.push(g(p, 'hombre', 'mujer'));
  const exp = EXPERIENCES.find((x) => x.id === p.experience);
  // «experiencia» es femenino para todos: «experiencia intermedia», «experiencia avanzada».
  if (exp) who.push(`con experiencia ${{ beginner: 'de principiante', intermediate: 'intermedia', advanced: 'avanzada' }[exp.id]} en fuerza (${exp.sub})`);
  const goal = p.goal ? label(GOALS, p.goal).toLowerCase() : null;
  const intro = `${who.length ? `Soy ${who.join(', ')}` : 'Entreno fuerza y resistencia'}${goal ? ` y mi objetivo es ${goal}` : ''}.`;
  return [
    'PREGUNTA',
    `${intro} Con estos datos, ¿qué ajustarías en las próximas 4–8 semanas en mi entrenamiento (volumen, intensidad, ejercicios estancados, resistencia), mi alimentación (calorías y proteína) y mi descanso? Dime qué harías primero, por qué, y qué datos te faltarían para afinar. Ten en cuenta que no registro la comida y que las cifras son estimaciones de la app.`,
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
  const profile = [
    'PERFIL',
    `- Sexo: ${p.sex ? label(SEXES, p.sex) : 'sin indicar'}`,
    `- Objetivo: ${p.goal ? label(GOALS, p.goal) : 'sin indicar'}`,
    `- Experiencia en fuerza: ${expLabel(p)}`,
  ];
  const sections = [
    head,
    profile,
    weightSection(a, withCycle),
    strengthSection(a, withCycle),
    enduranceSection(a, withCycle),
    recoverySection(a, withCycle),
    withCycle ? cycleSection(a) : [],
    forecastSection(a, withCycle),
    question(a),
  ].filter((s) => s.length);
  return `${sections.map((s) => s.join('\n')).join('\n\n')}\n`;
}
