// views/focus.js — «Lo importante esta semana» en Hoy (docs/PULIDO.md §6): UNA tarjeta en lugar de las dos que había
// (resumen del panel semanal y «Tu análisis»), con un mensaje principal, hasta dos secundarios —sin repetir tema— y
// un único paso siguiente en cada uno. Sin avisos: «Todo evoluciona dentro de lo esperado…». La lógica es pura
// (js/focus.js) y reutiliza lo ya calculado: weeklyInsights/keyMessages y el análisis en caché (analysisFor).
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, whyBox, stateTag } from '../ui.js';
import { fmtWeekRange } from '../util.js';
import { weeklyInsights, keyMessages } from '../insights.js';
import { weekFocus } from '../focus.js';
import { whyContent } from './weekly.js';
import { analysisFor } from './analysis.js';

const LEVEL_STATE = { good: 'ok', warn: 'warn', neutral: 'info', info: 'info' };
const LEVEL_LABEL = { good: 'Bien', warn: 'Atención', neutral: 'Info', info: 'Info' };
const STEP_ICON = { keep: 'check', none: 'check', data: 'clock', recheck: 'refresh', recover: 'history', reduce: 'minus', add: 'plus', up: 'arrow-up' };
/** Mensajes candidatos de cada fuente (la lógica elige 3 como mucho). */
const CANDIDATES = 6;

/** «quedan 4 días» / «último día» de la semana en curso. */
const leftTxt = (n) => (n <= 1 ? 'último día' : `quedan ${n} días`);

function item(it, main) {
  const tags = [stateTag(it.step === 'up' ? 'progress' : LEVEL_STATE[it.level] || 'info', it.step === 'up' ? 'Subir peso' : LEVEL_LABEL[it.level] || 'Info', { small: true })];
  if (it.confidence) tags.push(stateTag(`conf-${it.confidence.level}`, it.confidence.label, { small: true }));
  return h(`li.focus-item${main ? '.focus-main' : ''}`, { dataset: { key: it.key, id: it.id, topic: it.topic, level: it.level, step: it.step, source: it.source } },
    h('div.focus-tags', tags),
    h(main ? 'h3.focus-title' : 'h4.focus-title', it.title),
    it.text ? h('p.focus-text', it.text) : null,
    h('p.focus-step', icon(STEP_ICON[it.step] || 'check', 16), h('span', h('b', 'Qué hacer: '), it.stepLabel)),
    it.why && it.why.rule ? whyBox(whyContent(it.why)) : null);
}

/**
 * Tarjeta de Hoy. null sin nada que decir (sin historial ni análisis).
 * @param {{ data: object, today: string }} opts  `data` = el de la pantalla (weekly.weeklyData), compartido con las demás
 */
/** La parte del panel semanal (Hoy la calcula en su propia tarea, antes que la del analista). */
export function focusWeekly(data) {
  if (!data.checkins) data.checkins = store.all('checkins');
  return weeklyInsights(data, data.today);
}

/** `weekly`: el resultado de focusWeekly(data), si ya se calculó (Hoy: en otra tarea, para no bloquear). */
export function focusCard({ data, today, weekly: pre = null }) {
  const r = pre || focusWeekly(data);
  const a = analysisFor(today, data);
  if (a.errors?.length) console.error('[análisis]', a.errors);
  const weekly = r.hasHistory ? keyMessages(r, CANDIDATES) : [];
  const analysis = a.hasData ? a.keyPoints : [];
  if (!weekly.length && !analysis.length) return null;
  const f = weekFocus({ weekly, analysis });
  const sub = `${fmtWeekRange(r.week)}${r.inProgress ? ` · ${leftTxt(r.daysLeft)}` : ''}`;
  return h('section.card.focus', { dataset: { card: 'focus', allGood: f.allGood ? '1' : '' } },
    h('div.focus-head',
      h('h2.focus-heading', 'Lo importante esta semana'),
      h('p.focus-sub', sub)),
    f.allGood ? h('p.focus-allgood', icon('check', 18), h('span', f.message)) : null,
    f.items.length ? h('ol.focus-list', f.items.map((it, i) => item(it, i === 0 && !f.allGood))) : null,
    h('div.focus-links',
      h('button.cal-link-btn.focus-link', { type: 'button', dataset: { go: 'weekly' }, onClick: () => navigate(`#/weekly?week=${r.week}`) }, 'Panel semanal', icon('chevron-right', 18)),
      h('button.cal-link-btn.focus-link', { type: 'button', dataset: { go: 'analysis' }, onClick: () => navigate('#/analysis') }, 'Tu análisis', icon('chevron-right', 18))));
}
