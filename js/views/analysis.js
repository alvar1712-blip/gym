// views/analysis.js — #/analysis «Tu análisis» (ronda 5, docs/MEJORAS5.md §3c) y la tarjeta resumen «Tu análisis»
// para Hoy y el panel semanal. PROPIETARIO: analista y perfil (ronda 5). Los números y los textos salen de
// js/analysis.js (puro, orquesta analysis-weight / analysis-training / cycle-logic) y el informe de
// js/analysis-report.js; aquí solo DOM y store. Cada Insight lleva su nivel, título, texto, «¿Por qué?» (regla y
// datos, con los estilos .wk-why del panel semanal) y «Fuentes» plegadas.
//
// CONTRATO:
//   analysisData(today?, base?) → data de buildAnalysis desde el store (dataFromStore + checkins + cycleDays). Si se
//     pasa `base` (p. ej. el weeklyData() de la pantalla), se completa ESE objeto (conserva la caché de stats.js).
//   analysisSummaryCard({ data?, today?, max = 3, compact = false }) → section.card.an-sum (2–3 puntos clave y «Ver
//     análisis») | null si aún no hay nada que analizar (solo «faltan datos»).
//   mountAnalysis(root) → pantalla completa (back '#/progress').
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, screen, emptyState, toast, sheet } from '../ui.js';
import { todayStr, addDays, fmtNum, fmtDuration, clamp } from '../util.js';
import { dataFromStore, chartHeight } from '../progress-ui.js';
import { lineChart, COLORS } from '../charts.js';
import { buildAnalysis, areaInsights, isPlaceholder, AREA_LABEL, LEVEL_LABEL, DISCLAIMER } from '../analysis.js';
import { reportText } from '../analysis-report.js';
import { rateText } from '../analysis-training.js';
import { getProfile, profileExtrasMissing } from '../profile.js';

const LEVEL_ICON = { good: 'check', warn: 'alert', neutral: 'info', info: 'info' };
const STATUS_TAG = { fast: 'Rápido', good: 'Bien', stalled: 'Estancado', down: 'Bajando' };
const STATUS_CLASS = { fast: 'ok', good: 'ok', stalled: 'warn', down: 'danger' };
const PACE_CLASS = { in: 'ok', below: 'warn', above: 'warn' };
/** Ronda 6: clase de mejora en la lista de ejercicios («al 88 % de tu marca», «ejercicio nuevo»…). */
const KIND_SUB = (x) => (x.kind === 'recovery' && x.recovery ? `al ${x.recovery.pct}${NB}% de tu marca`
  : x.kind === 'new_exercise' ? 'ejercicio nuevo' : x.kind === 'new_best' ? 'por encima de tu marca' : null);
/** Ejercicios visibles en «Fuerza» antes de «Ver N más». */
const EX_VISIBLE = 6;
/** Semanas de la minigráfica del peso. */
const CHART_WEEKS = 8;
const PERIOD_COLOR = '#d9506f'; // --cyc-menstrual (css/cycle.css), como las marcas de la gráfica de Peso
const NB = ' ';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const sgn = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
const kgTxt = (v) => `${fmtNum(v, 1)}${NB}kg`;
const signedKg = (v) => `${sgn(v)}${fmtNum(Math.abs(v), Math.abs(v) < 0.095 ? 2 : 1)}${NB}kg`;
const signedPct = (v) => `${sgn(v)}${fmtNum(Math.abs(v), 2)}${NB}%`;
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Entrada de buildAnalysis desde el store. `base`: un dataFromStore() de la pantalla, que se completa (mismo objeto). */
export function analysisData(today = todayStr(), base = null) {
  const d = base || dataFromStore(today);
  if (!d.checkins) d.checkins = store.all('checkins');
  if (!d.cycleDays) d.cycleDays = store.all('cycle');
  // Ronda 6: tu contexto y tus marcas históricas (el análisis los usa para interpretar y para la confianza)
  if (!d.context) d.context = store.all('context');
  if (!d.pastRecords) d.pastRecords = store.all('pastRecords');
  return d;
}

// ===========================================================================
// Piezas comunes
// ===========================================================================

function levelBadge(level, small = false) {
  return h(`span.an-level.an-level-${level}${small ? '.an-level-sm' : ''}`, icon(LEVEL_ICON[level] || 'info', 14), LEVEL_LABEL[level] || 'Info');
}

/** Ronda 6: «Confianza media» (o «Datos insuficientes»); los motivos van en el «¿Por qué?». */
function confBadge(c, small = false) {
  if (!c) return null;
  return h(`span.an-conf.an-conf-${c.level}${small ? '.an-conf-sm' : ''}`, { title: c.reasons?.length ? c.reasons.join('; ') : c.label }, c.label);
}

/** «¿Por qué?»: la regla y los datos (mismas clases que el panel semanal). */
function whyBody(why) {
  const stack = why.data.some((d) => String(d.label).length + String(d.value).length > 36);
  return h('div.wk-why',
    h('p.wk-why-rule', h('b', 'Regla. '), why.rule),
    h('p.wk-why-head', 'Datos'),
    h(`ul.wk-why-data${stack ? '.wk-why-stacked' : ''}`, why.data.map((d) => h('li.wk-why-row',
      h('span.wk-why-label', d.label),
      h('span.wk-why-value', d.value)))));
}

function sourcesBody(sources) {
  return h('ul.an-sources', sources.map((s) => h('li.an-source', h('b', s.short), h('span', ` · ${s.detail}`))));
}

/** Botones «¿Por qué?» y «Fuentes (n)» en una fila; cada uno despliega su caja debajo. */
function folds(ins) {
  const parts = [['why', '¿Por qué?', 'info', () => whyBody(ins.why)]];
  if (ins.sources?.length) parts.push(['sources', `Fuentes (${ins.sources.length})`, 'note', () => sourcesBody(ins.sources)]);
  const btns = [];
  const bodies = [];
  for (const [key, label, ic, make] of parts) {
    const body = h('div.why-body.an-fold-body', { hidden: true, dataset: { fold: key } }, make());
    const btn = h('button.why-btn.an-fold-btn', {
      type: 'button',
      'aria-expanded': 'false',
      dataset: { fold: key },
      onClick: () => {
        body.hidden = !body.hidden;
        btn.setAttribute('aria-expanded', String(!body.hidden));
        btn.classList.toggle('open', !body.hidden);
      },
    }, icon(ic, 16), label);
    btns.push(btn);
    bodies.push(body);
  }
  return h('div.an-folds', h('div.an-fold-btns', btns), bodies);
}

function insightItem(ins) {
  const parts = ins.parts;
  return h('article.an-ins', { class: `an-ins-${ins.level}`, dataset: { insight: ins.id, level: ins.level, area: ins.area, confidence: ins.confidence?.level || '' } },
    h('div.an-ins-head', levelBadge(ins.level), confBadge(ins.confidence)),
    h('h3.an-ins-title', ins.title),
    // Ronda 6: dato e interpretación; el contexto que se tuvo en cuenta; y qué hacer, aparte
    h('p.an-ins-text', parts ? [parts.observation, parts.interpretation].filter(Boolean).join(' ') : ins.text),
    ins.context?.length ? h('p.an-ins-ctx', h('b', 'Contexto: '), ins.context.join(' · ')) : null,
    parts?.recommendation ? h('p.an-ins-rec', h('b', 'Qué hacer: '), parts.recommendation) : null,
    ins.action && ins.action.href
      ? h('button.btn.btn-ghost.an-ins-action', { type: 'button', onClick: () => navigate(ins.action.href) }, ins.action.label, icon('chevron-right', 16))
      : null,
    folds(ins));
}

const insightList = (list) => (list.length ? h('div.an-ins-list', list.map(insightItem)) : null);

function cardHead(ic, title, sub = null, right = null) {
  return h('div.an-card-head',
    h('span.an-card-icon', { 'aria-hidden': 'true' }, icon(ic, 20)),
    h('div.an-card-titles', h('h2.an-card-title', title), sub ? h('p.an-card-sub', sub) : null),
    right);
}

const card = (area, ...children) => h(`section.card.an-card.an-card-${area}`, { dataset: { area } }, ...children);

function kpi(label, value, sub = null, key = null) {
  return h('div.kpi.an-kpi', { dataset: key ? { kpi: key } : {} },
    h('div.kpi-label', label),
    h('div.kpi-value', value),
    sub ? h('div.kpi-sub', sub) : null);
}

const note = (text) => h('p.an-empty', text);

function linkRow(ic, title, href) {
  return h('button.list-item.an-link', { type: 'button', onClick: () => navigate(href) },
    icon(ic, 20),
    h('span.list-item-main', h('span.list-item-title', title)),
    icon('chevron-right', 20, 'chev'));
}

// ===========================================================================
// Tarjeta resumen (Hoy y panel semanal)
// ===========================================================================

/**
 * «Tu análisis»: 2–3 puntos clave (nivel, área, título y texto) y «Ver análisis». null sin sesiones ni pesajes o si solo
 * hay «faltan datos».
 * @param {{data?:object, today?:string, max?:number, compact?:boolean}} [opts] data: el de la pantalla (se completa)
 * @returns {HTMLElement|null}
 */
export function analysisSummaryCard({ data = null, today = null, max = 3, compact = false } = {}) {
  const t = today || data?.today || todayStr();
  const a = buildAnalysis(analysisData(t, data), t);
  if (a.errors.length) console.error('[análisis]', a.errors);
  const pts = a.hasData ? a.keyPoints.filter((i) => !isPlaceholder(i)).slice(0, max) : [];
  if (!pts.length) return null;
  return h(`section.card.an-sum${compact ? '.an-sum-compact' : ''}`, { dataset: { card: 'analysis' } },
    h('div.an-sum-head',
      h('span.an-card-icon', { 'aria-hidden': 'true' }, icon('bolt', 20)),
      h('div.an-sum-titles',
        h('h2.an-sum-title', 'Tu análisis'),
        h('p.an-sum-sub', 'Lo más importante ahora · orientativo'))),
    h('ul.an-sum-list', pts.map((i) => h('li.an-sum-item', { dataset: { insight: i.id, level: i.level, area: i.area } },
      h('span.an-sum-top', levelBadge(i.level, true), h('span.an-area', AREA_LABEL[i.area]), confBadge(i.confidence, true)),
      h('span.an-sum-mtitle', i.title),
      h('p.an-sum-mtext', i.text)))),
    h('button.btn.btn-secondary.btn-block.an-sum-btn', { type: 'button', onClick: () => navigate('#/analysis') },
      'Ver análisis', icon('chevron-right', 18)));
}

// ===========================================================================
// #/analysis
// ===========================================================================

export function mountAnalysis(root) {
  const today = todayStr();
  const profile = getProfile(store.settings());
  const a = buildAnalysis(analysisData(today), today);
  if (a.errors.length) console.error('[análisis]', a.errors);
  const charts = [];
  const report = { include: !!profile.cycleInReport };
  const c = screen(root, {
    title: 'Análisis',
    subtitle: 'Tu analista · con tus datos',
    back: '#/progress',
    actions: a.hasData ? [{ icon: 'copy', label: 'Copiar informe para tu IA', onClick: () => copyReport(a, report) }] : [],
  });
  c.classList.add('an');

  c.appendChild(h('p.an-note', icon('info', 16), h('span', DISCLAIMER)));
  if (a.profileIncomplete) c.appendChild(profileBanner(a));
  else if (profileExtrasMissing(profile).length) c.appendChild(profileMoreLink(profile));
  if (a.hasData) c.appendChild(contextStrip(a));

  if (!a.hasData) {
    c.appendChild(h('section.card.an-nodata', emptyState({
      emoji: '🧠',
      title: 'Aún no hay datos que analizar',
      text: 'Registra tus sesiones, tus actividades y tu peso (3–4 veces por semana). En 2–3 semanas verás aquí tu ritmo de mejora, tu peso, tu resistencia, tu recuperación y tus previsiones, con su «¿Por qué?».',
      action: { label: 'Ir a Hoy', onClick: () => navigate('#/today') },
    })));
    return undefined;
  }

  c.appendChild(summaryCard(a, c));
  c.appendChild(weightCard(a, charts));
  c.appendChild(strengthCard(a));
  c.appendChild(enduranceCard(a));
  c.appendChild(recoveryCard(a));
  if (a.cycle) c.appendChild(cycleCard(a));
  c.appendChild(forecastCard(a));
  c.appendChild(reportCard(a, report));
  return () => { for (const ch of charts) ch.destroy(); charts.length = 0; };
}

/**
 * Ronda 6: lo que el análisis tiene en cuenta de tu contexto (fases vigentes, vuelta a entrenar, creatina, peso habitual)
 * y los cambios recientes, con acceso a «Tu contexto». Sin nada apuntado ni detectado, una fila discreta para añadirlo.
 */
function contextStrip(a) {
  const ctx = a.context;
  const labels = ctx?.labels || [];
  const changes = (ctx?.changes || []).filter((x) => !labels.some((l) => l.key === `phase:${x.type}`)).slice(0, 3);
  if (!labels.length && !changes.length) {
    return h('button.cal-link-btn.an-ctx-add', { type: 'button', onClick: () => navigate('#/context') },
      h('span', 'Añade tu contexto (fases, creatina, peso habitual) para interpretar mejor tus datos'), icon('chevron-right', 18));
  }
  return h('section.card.an-ctx', { dataset: { block: 'context' } },
    h('div.an-ctx-head', h('h2.an-ctx-title', 'Tu contexto'),
      h('button.btn.btn-ghost.btn-sm.an-ctx-edit', { type: 'button', onClick: () => navigate('#/context') }, 'Editar', icon('chevron-right', 16))),
    labels.length ? h('ul.an-ctx-list', labels.map((l) => h('li.an-ctx-item', { dataset: { key: l.key } }, l.text))) : null,
    changes.length ? h('p.an-ctx-changes', h('b', 'Cambios recientes: '), changes.map((x) => x.text).join(' · ')) : null,
    h('p.an-ctx-why', 'El análisis lo tiene en cuenta al interpretar tus datos y al decir cuánta confianza tiene.'));
}

/** Ronda 6: invitación discreta a añadir los datos nuevos del perfil (edad, deportes, días por semana). */
function profileMoreLink(p) {
  const NAMES = { birthDate: 'fecha de nacimiento', sports: 'deportes', weeklyFrequency: 'días por semana' };
  return h('button.cal-link-btn.an-profile-more', { type: 'button', onClick: () => navigate('#/settings/profile') },
    h('span', `Completa tu perfil para mejorar el análisis (${profileExtrasMissing(p).map((k) => NAMES[k]).join(', ')})`),
    icon('chevron-right', 18));
}

function profileBanner(a) {
  const p = a.profile;
  const missing = [!p.sex && 'sexo', !p.goal && 'objetivo', !p.experience && 'experiencia'].filter(Boolean);
  return h('button.banner.banner-info.an-profile', { type: 'button', onClick: () => navigate('#/settings/profile') },
    icon('sliders', 20),
    h('span.banner-main',
      h('span.banner-title', 'Completa tu perfil (30 s)'),
      h('span.banner-text', `Falta: ${missing.join(', ')}. Afina los rangos, las comparaciones y los textos.`)),
    icon('chevron-right', 20, 'chev'));
}

// ---------- Resumen ----------
function summaryCard(a, content) {
  const pts = a.keyPoints;
  const go = (id) => {
    const el = [...content.querySelectorAll('.an-card:not(.an-card-summary) [data-insight]')].find((x) => x.dataset.insight === id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.remove('an-flash');
    void el.offsetWidth; // reinicia la animación
    el.classList.add('an-flash');
  };
  return card('summary',
    cardHead('bolt', 'Resumen', 'Lo más importante ahora'),
    pts.length
      ? h('ul.an-keys', pts.map((i) => h('li.an-key', { dataset: { insight: i.id, level: i.level } },
        h('button.an-key-btn', { type: 'button', 'aria-label': `${i.title}. Ver el detalle en ${AREA_LABEL[i.area]}`, onClick: () => go(i.id) },
          h('span.an-key-top', levelBadge(i.level, true), h('span.an-area', AREA_LABEL[i.area])),
          h('span.an-key-title', i.title),
          h('span.an-key-text', i.text),
          h('span.an-key-more', 'Ver detalle', icon('chevron-down', 16))))))
      : note('Sin puntos destacados por ahora.'));
}

// ---------- Peso ----------
function weightCard(a, charts) {
  const w = a.weight || {};
  const t = w.trend;
  const badge = w.paceLabel ? h(`span.badge.an-pace.badge-${PACE_CLASS[w.status] || 'info'}`, w.paceLabel) : null;
  // Ronda 6: menores de 18, sin rango de pérdida, sin barra frente a ese rango y sin kcal (solo tendencia y ritmo).
  const minor = w.age === 'minor';
  const el = card('weight', cardHead('scale', 'Peso', w.target && !minor ? cap(w.target.label) : 'Tendencia y ritmo', badge));
  if (t && isNum(t.currentKg)) {
    const kc = w.kcalPerDay;
    el.appendChild(h(`div.kpis.an-kpis${minor ? '.kpis-2' : ''}`,
      kpi('Tendencia', kgTxt(t.currentKg), 'media de ~10 días', 'trend'),
      kpi('Ritmo', w.ok ? signedKg(t.ratePerWeekKg) : '—', w.ok ? `por semana · ${signedPct(t.ratePerWeekPct)}` : 'faltan datos', 'rate'),
      minor ? null : kpi('Balance', kc && isNum(kc.estimate) ? `${sgn(kc.estimate)}${fmtNum(Math.abs(kc.estimate), 0)}` : '—', 'kcal/día (aprox.)', 'kcal')));
    const chart = weightChart(a);
    if (chart) {
      el.appendChild(chart.wrap);
      charts.push(chart.chart);
    }
  }
  if (w.ok && w.target && t && !minor) el.appendChild(paceGauge(w));
  // nutritionRow es null con objetivo elegido y ningún pesaje (sin proteína ni ajuste que mostrar)
  el.append(...[nutritionRow(w), w.goalSuggestion ? goalBox(w.goalSuggestion) : null, insightList(areaInsights(a, 'weight')), linkRow('scale', 'Peso corporal: registrar y ver la gráfica', '#/bodyweight')].filter(Boolean));
  return el;
}

function weightChart(a) {
  const t = a.weight.trend;
  const from = addDays(a.today, -(CHART_WEEKS * 7 - 1));
  const pts = (t.points || []).filter((p) => p.date >= from);
  if (pts.length < 2) return null;
  const female = !!a.cycle;
  const daily = pts.map((p) => ({ x: p.date, y: p.kg, note: p.retention ? 'Posible retención de líquidos: no cuenta para el ritmo' : undefined }));
  const trend = pts.map((p) => ({ x: p.date, y: p.trendKg }));
  const bands = female && !a.cycle.hormonal
    ? (a.cycle.info.periods || []).filter((p) => p.end >= from).map((p) => ({ from: p.start < from ? from : p.start, to: p.end, color: PERIOD_COLOR, opacity: 0.18, note: 'Días de regla' }))
    : [];
  const slot = h('div.an-chart');
  const wrap = h('div.an-chart-wrap', slot,
    h('p.an-chart-note', `Últimas ${CHART_WEEKS} semanas: puntos = pesajes; línea = tendencia (la que cuenta).`));
  const chart = lineChart(slot, {
    series: [
      { id: 'daily', label: 'Pesaje', color: COLORS.text2, points: daily, line: false, dots: true },
      { id: 'trend', label: 'Tendencia', color: COLORS.accent, points: trend, emphasis: true, dots: false },
    ],
    height: chartHeight(150),
    yFormat: (v) => `${fmtNum(v, 1)} kg`,
    yTickFormat: (v) => fmtNum(v, 1),
    xDomain: [from, a.today],
    bands,
    bandsLegend: bands.length ? { label: 'Regla', color: PERIOD_COLOR } : null,
    empty: 'Sin pesajes recientes',
    ariaLabel: 'Peso de las últimas semanas: pesajes y tendencia',
  });
  return { wrap, chart };
}

/** Barra «tu ritmo frente al rango de tu objetivo» (% del peso por semana, con signo). */
function paceGauge(w) {
  const rate = w.trend.ratePerWeekPct;
  const tg = w.target;
  const rec = tg.recommended;
  const lo = clamp(Math.min(tg.minPct, rate, 0) - 0.35, -2.5, 0);
  const hi = clamp(Math.max(tg.maxPct, rate, 0) + 0.35, 0, 2);
  const pos = (v) => `${(((clamp(v, lo, hi) - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const span = (a1, b1, cls) => h(`span.${cls}`, { style: { left: pos(a1), width: `calc(${pos(b1)} - ${pos(a1)})` } });
  const out = rate < lo || rate > hi;
  return h('div.an-gauge', { role: 'img', 'aria-label': `Tu ritmo: ${signedPct(rate)} del peso por semana. Rango de tu objetivo: ${tg.label}${rec ? `; recomendado: ${rec.label}` : ''}.` },
    h('div.an-gauge-top',
      h('span.an-gauge-title', 'Tu ritmo y tu rango'),
      h('span.an-gauge-val.tnum', `${signedPct(rate)}/sem`)),
    h('div.an-gauge-track', { 'aria-hidden': 'true' },
      span(tg.minPct, tg.maxPct, 'an-gauge-band'),
      rec ? span(rec.minPct, rec.maxPct, 'an-gauge-rec') : null,
      h('span.an-gauge-zero', { style: { left: pos(0) } }),
      h(`span.an-gauge-mark.an-gauge-mark-${PACE_CLASS[w.status] || 'info'}${out ? '.an-gauge-mark-out' : ''}`, { style: { left: pos(rate) } })),
    h('div.an-gauge-axis', { 'aria-hidden': 'true' }, h('span', '← bajar'), h('span', '0'), h('span', 'subir →')),
    h('p.an-gauge-legend',
      h('span.an-swatch', { 'aria-hidden': 'true' }),
      `Rango: ${tg.label}${rec ? ` (mejor ${rec.label.replace(/^bajar /, '')})` : ''}${tg.experienceGuessed && tg.goal === 'gain' ? ' · experiencia sin indicar: se usa la intermedia' : ''}.`));
}

function nutritionRow(w) {
  const p = w.proteinG;
  const sug = w.kcalPerDay?.suggestion;
  const tiles = [];
  if (p && isNum(p.min)) {
    const focus = p.focus ? ` · en déficit, ${fmtNum(p.focus.min, 0)}–${fmtNum(p.focus.max, 0)}${NB}g` : '';
    tiles.push(kpi('Proteína', `${fmtNum(p.min, 0)}–${fmtNum(p.max, 0)}${NB}g`, `al día (1,6–2,2 g/kg)${focus}`, 'protein'));
  }
  if (sug) {
    const a1 = Math.min(Math.abs(sug.min), Math.abs(sug.max));
    const b1 = Math.max(Math.abs(sug.min), Math.abs(sug.max));
    tiles.push(kpi('Ajuste orientativo', `${sug.max > 0 ? '+' : '−'}${fmtNum(a1, 0)}–${fmtNum(b1, 0)}`, `kcal/día ${sug.max > 0 ? 'más' : 'menos'}`, 'adjust'));
  } else if (w.ok && w.target && w.age !== 'minor') {
    // Sin ajuste: o estás en tu rango, o el análisis no lo propone aún (contexto o confianza baja).
    tiles.push(kpi('Calorías', 'Sin cambios', w.status === 'in' ? 'estás en tu rango' : 'por ahora: reevalúa en unas semanas', 'adjust'));
  } else if (!w.target && w.age !== 'minor') {
    tiles.push(kpi('Objetivo', 'Sin elegir', 'en tu perfil', 'goal'));
  }
  if (!tiles.length) return null;
  return h('div.kpis.kpis-2.an-kpis', tiles);
}

function goalBox(gs) {
  return h('div.an-goal', { dataset: { target: String(gs.targetKg) } },
    h('div.an-goal-texts',
      h('span.an-goal-kicker', 'Objetivo propuesto'),
      h('span.an-goal-title', gs.title),
      gs.text ? h('span.an-goal-text', gs.text) : null),
    h('button.btn.btn-primary.btn-block.an-goal-btn', { type: 'button', onClick: () => navigate(gs.href) }, icon('target', 20), 'Crear objetivo'));
}

// ---------- Fuerza ----------
function strengthCard(a) {
  const s = a.strength || {};
  const sum = s.summary || {};
  const analyzed = (s.exercises || []).filter((x) => x.status !== 'insufficient');
  const few = (s.exercises || []).length - analyzed.length;
  const el = card('strength', cardHead('dumbbell', 'Fuerza', 'Ritmo de tu 1RM estimado (6–12 semanas)'));
  if (analyzed.length) {
    el.appendChild(h('div.kpis.an-kpis',
      kpi('Ritmo típico', isNum(sum.trendPctPerWeek) ? rateText(sum.trendPctPerWeek).replace('/sem', '') : '—', 'por semana (mediana)', 'typical'),
      kpi('Mejoran', `${sum.improving}${NB}de${NB}${sum.mainCount}`, sum.mainOnly ? 'principales' : 'ejercicios', 'improving'),
      kpi('Estancados', String(sum.stalled || 0), sum.down ? `${sum.down} bajando` : 'ninguno bajando', 'stalled')));
    el.appendChild(exerciseList(analyzed));
  }
  if (few > 0) {
    el.appendChild(note(`${few} ${few === 1 ? 'ejercicio' : 'ejercicios'} ${analyzed.length ? 'más ' : ''}aún sin datos suficientes (hacen falta 4 sesiones en 3 semanas distintas).`));
  } else if (!analyzed.length) {
    el.appendChild(note('Aún no hay ejercicios con peso y repeticiones registrados en las últimas semanas.'));
  }
  const list = insightList(areaInsights(a, 'strength'));
  if (list) el.appendChild(list);
  return el;
}

function exerciseList(rows) {
  const items = rows.map((x, i) => h('button.list-item.an-ex', {
    type: 'button',
    hidden: i >= EX_VISIBLE,
    dataset: { exercise: x.exerciseId, status: x.status },
    onClick: () => navigate(`#/progress/exercise/${x.exerciseId}`),
  },
  h('span.list-item-main',
    h('span.list-item-title', x.name),
    h('span.list-item-sub', [`1RM est. ${kgTxt(x.e1rmNow)}`, `${x.sessions}${NB}sesiones`, KIND_SUB(x)].filter(Boolean).join(' · '))),
  h('span.an-ex-right',
    h('span.an-ex-rate.tnum', rateText(x.ratePctPerWeek)),
    h(`span.badge.badge-${STATUS_CLASS[x.status] || 'info'}.an-ex-status`, x.status === 'good' && x.slow ? 'Despacio' : STATUS_TAG[x.status])),
  icon('chevron-right', 18, 'chev')));
  const list = h('div.list.an-ex-list', items);
  const extra = rows.length - EX_VISIBLE;
  if (extra <= 0) return list;
  const more = `Ver ${extra} más`;
  const btn = h('button.wk-more.an-more', {
    type: 'button',
    'aria-expanded': 'false',
    onClick: () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      items.forEach((r, i) => { if (i >= EX_VISIBLE) r.hidden = !open; });
      btn.setAttribute('aria-expanded', String(open));
      btn.firstChild.textContent = open ? 'Ver menos' : more;
      btn.classList.toggle('open', open);
    },
  }, h('span', more), icon('chevron-down', 18));
  return h('div.an-ex-wrap', list, btn);
}

// ---------- Resistencia ----------
function enduranceCard(a) {
  const e = a.endurance || {};
  const el = card('endurance', cardHead('clock', 'Resistencia', 'Forma, reparto de intensidad y combinación con la fuerza'));
  const tiles = [kpi('Resistencia', `${fmtNum(e.weeklyMinutes4w || 0, 0)}${NB}min`, 'por semana (4 sem)', 'minutes')];
  const it = e.intensity;
  if (it && isNum(it.easyShare) && it.easyMin + it.hardMin > 0) tiles.push(kpi('Suave', `${fmtNum(it.easyShare * 100, 0)}${NB}%`, 'referencia ~80 %', 'easy'));
  const last = (e.fitness || []).at(-1);
  if (last && isNum(last.pred5kSec)) tiles.push(kpi('5 km previsto', fmtDuration(last.pred5kSec), 'bloque de 4 semanas', 'fivek'));
  const list = areaInsights(a, 'endurance');
  const loadTable = sportLoadTable(a.hybrid?.sportLoad);
  if (!e.weeklyMinutes4w && !list.length && !last) {
    el.appendChild(note('Sin carreras, bici, natación ni rutas en las últimas semanas. Cuando las registres verás aquí tu forma y tu reparto suave / intenso.'));
    if (loadTable) el.appendChild(loadTable);
    return el;
  }
  el.appendChild(h(`div.kpis.an-kpis${tiles.length === 2 ? '.kpis-2' : ''}`, tiles));
  if (loadTable) el.appendChild(loadTable);
  const l = insightList(list);
  if (l) el.appendChild(l);
  return el;
}

/**
 * Ronda 6 (fase D): carga por deporte de las 4 últimas semanas completas (minutos × esfuerzo), con su cambio frente a las
 * 4 anteriores. Cada deporte por separado: 3 h de senderismo suave no pesan como 3 h de carrera. null si no hay nada.
 */
function sportLoadTable(sl) {
  const rows = (sl?.rows || []).filter((r) => r.sessions4w > 0);
  if (!rows.length) return null;
  return h('div.an-load', { dataset: { block: 'sport-load' } },
    h('p.an-load-title', 'Carga por deporte · media semanal de las 4 últimas semanas completas'),
    h('ul.an-load-list', rows.map((r) => h('li.an-load-row', { dataset: { sport: r.kind } },
      h('span.an-load-name', r.label),
      h('span.an-load-val.tnum', `${fmtNum(r.minutes4w, 0)}${NB}min · carga ${fmtNum(r.load4w, 0)}`),
      h(`span.an-load-chg.tnum${r.changePct == null ? '' : r.changePct >= 25 ? '.up' : r.changePct <= -25 ? '.down' : ''}`,
        r.changePct == null ? 'nuevo' : `${Math.round(Math.abs(r.changePct)) === 0 ? '' : r.changePct > 0 ? '+' : '−'}${fmtNum(Math.abs(r.changePct), 0)}${NB}%`)))),
    h('p.an-load-why', 'Carga = minutos × esfuerzo (RPE). Cada deporte se mide aparte; el % compara con las 4 semanas anteriores.'));
}

// ---------- Recuperación ----------
function recoveryCard(a) {
  const el = card('recovery', cardHead('refresh', 'Recuperación', 'Sueño y energía frente a tu rendimiento'));
  const list = areaInsights(a, 'recovery');
  el.appendChild(list.length ? insightList(list) : note('Sin datos de recuperación todavía.'));
  el.appendChild(h('p.an-hint', 'Haz el check-in (sueño, energía, estrés y agujetas, y si quieres las zonas con agujetas o molestias) al empezar tus sesiones de fuerza: son 4 toques.'));
  return el;
}

// ---------- Ciclo ----------
function cycleCard(a) {
  const cy = a.cycle;
  const el = card('cycle', cardHead('calendar', 'Ciclo', 'Lo que dicen tus datos (estimaciones)'));
  el.appendChild(h('div.an-cyc',
    h('span.an-cyc-state', cy.state),
    cy.next ? h('span.an-cyc-next', cy.next) : null,
    cy.basis ? h('span.an-cyc-basis', cy.basis) : null));
  if (!cy.info.periods?.length) el.appendChild(note('Registra tu regla en Ciclo para ver tu fase y cuándo esperar la próxima.'));
  const list = insightList(areaInsights(a, 'cycle'));
  if (list) el.appendChild(list);
  el.appendChild(h('button.btn.btn-secondary.btn-block.an-cyc-btn', { type: 'button', onClick: () => navigate('#/cycle') }, icon('calendar', 20), 'Ver ciclo'));
  return el;
}

// ---------- Próximas semanas ----------
function forecastCard(a) {
  const el = card('forecast', cardHead('flag', 'Próximas semanas', 'Si sigues así (estimaciones)'));
  const list = insightList(areaInsights(a, 'forecast'));
  el.appendChild(list || note('Aún no hay previsiones: hacen falta tendencias claras de tu peso, tu fuerza o tu 5 km.'));
  return el;
}

// ---------- Informe para tu IA ----------
function reportCard(a, report) {
  const el = card('report', cardHead('copy', 'Informe para tu IA', 'Para pegar en ChatGPT, Claude u otra IA'));
  el.appendChild(h('p.an-report-why', 'Copia un resumen en texto de tu perfil, tus datos y estas valoraciones, con una pregunta al final, para pedirle a una IA que te ayude a ajustar tu plan. No se envía nada desde la app: tú decides dónde pegarlo.'));
  if (a.cycle) {
    const inp = h('input', {
      type: 'checkbox',
      checked: report.include,
      'aria-label': 'Incluir mi ciclo en el informe',
      onChange: () => {
        report.include = inp.checked;
        const s = store.settings();
        s.profile = { ...getProfile(s), cycleInReport: inp.checked };
        store.save('meta', s);
      },
    });
    el.appendChild(h('label.switch-row.an-report-cycle',
      h('span.an-switch-texts',
        h('span.an-switch-title', 'Incluir mi ciclo'),
        h('span.an-switch-sub', 'Duración, fase estimada y avisos. Si no, el informe no dice nada del ciclo.')),
      h('span.switch', inp, h('span'))));
  }
  el.appendChild(h('button.btn.btn-primary.btn-lg.btn-block.an-copy', { type: 'button', onClick: () => copyReport(a, report) },
    icon('copy', 22), 'Copiar informe para tu IA'));
  el.appendChild(h('button.btn.btn-ghost.btn-block.an-view-report', { type: 'button', onClick: () => textSheet(reportText(a, { includeCycle: report.include })) },
    'Ver el texto'));
  return el;
}

/** Portapapeles; si no deja, la hoja de compartir; si tampoco, el texto seleccionable en una hoja. */
async function copyReport(a, report) {
  const text = reportText(a, { includeCycle: report.include });
  const res = await copyText(text);
  if (res === 'copied') toast('Informe copiado. Pégalo en tu IA (ChatGPT, Claude…).', { kind: 'success', duration: 4000 });
  else if (res === 'fallback') textSheet(text, true);
  return res;
}

/** @returns {Promise<'copied'|'shared'|'cancelled'|'fallback'>} */
async function copyText(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return 'copied';
    }
  } catch { /* sin permiso: se prueba a compartir */ }
  try {
    if (typeof navigator.share === 'function') {
      await navigator.share({ title: 'Informe de entrenamiento', text });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
  }
  return 'fallback';
}

function textSheet(text, failed = false) {
  const area = h('textarea.input.an-report-text', { readOnly: true, rows: 12, 'aria-label': 'Texto del informe', value: text });
  const s = sheet({
    title: 'Informe para tu IA',
    tall: true,
    body: h('div.an-report-sheet',
      failed ? h('p.an-report-fail', 'No se ha podido copiar solo. Mantén pulsado el texto, elige «Seleccionar todo» y «Copiar».') : null,
      area),
    actions: [
      { label: 'Copiar', kind: 'primary', onClick: async (close) => { if ((await copyText(text)) === 'copied') { close(); toast('Informe copiado. Pégalo en tu IA.', { kind: 'success' }); } else { area.focus(); area.select(); } } },
    ],
  });
  setTimeout(() => { try { area.setSelectionRange(0, 0); area.scrollTop = 0; } catch { /* nada */ } }, 50);
  return s;
}
