// weekly.js — Fase 3: panel semanal (#/weekly?week=YYYY-MM-DD) y tarjeta resumen para Hoy y Progreso.
// PROPIETARIO: módulo del panel. Los mensajes salen de js/insights.js (puro); aquí solo se pintan:
// bloque INFORMACIÓN y después bloque SUGERENCIAS, cada mensaje con su nivel (color + texto), su texto, sus
// filas (tabla de músculos, carga por tipo…) y su «¿Por qué?» (ui.whyBox) con la regla y los datos concretos.
// Encima de los dos bloques, el «Resumen de la semana» (totales frente a la semana anterior y enlaces a #/summary),
// del módulo de resúmenes (weekRecap; números de js/summary-logic.js).
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, screen, emptyState, whyBox } from '../ui.js';
import { todayStr, weekStart, addDays, fmtWeekRange, fmtDate, isDateStr, fmtNum } from '../util.js';
import { dataFromStore } from '../progress-ui.js';
import { weeklyInsights, keyMessages, LEVEL_LABEL } from '../insights.js';
import { periodSummary, kindInfo, fmtValue, fmtKm, summaryHref } from '../summary-logic.js';
import { deltaChip, kindColorStyle } from './summary.js';
import { bodyMap, bodyMapData } from '../bodymap.js';

const LEVEL_ICON = { neutral: 'info', good: 'check', warn: 'alert' };
/** Mensajes cuyas filas se enseñan siempre en la tarjeta (aunque haya una sola). */
const ALWAYS_ITEMS = new Set(['load', 'km']);
/** Mensajes cuyas filas ya están en la tabla de músculos (no se repiten). */
const NO_ITEMS = new Set(['muscles-below', 'muscles-above']);

/** «quedan 4 días (hoy incluido)» / «queda 1 día (hoy)» (el domingo, concordado). */
const leftTxt = (n) => (n === 1 ? 'queda 1 día (hoy)' : `quedan ${n} días (hoy incluido)`);
/** Filas visibles de una lista antes de «Ver N más». */
const ITEMS_VISIBLE = 6;
/** Fila larga (etiqueta + valor): se apila (etiqueta arriba, valor debajo) en vez de partir dos columnas. */
const isLong = (label, value) => String(label).length + String(value).length > 36;
/** Secciones de la tarjeta resumen, en el orden del panel: información primero, sugerencias después. */
const SUMMARY_GROUPS = [['info', 'Información'], ['suggestion', 'Sugerencias']];

/** Entrada de insights.js con los datos actuales del store (stats + check-ins). Una vez por render. */
export function weeklyData(today = todayStr()) {
  return { ...dataFromStore(today), checkins: store.all('checkins') };
}

// ===========================================================================
// #/weekly?week=YYYY-MM-DD
// ===========================================================================

export function mountWeekly(root, params = {}) {
  const today = todayStr();
  const cur = weekStart(today);
  const ws = isDateStr(params.week) ? weekStart(params.week) : cur;
  const data = weeklyData(today); // el mismo objeto para insights y el resumen (comparten la caché de stats.js)
  const r = weeklyInsights(data, ws);
  const otherYear = ws.slice(0, 4) !== today.slice(0, 4) ? `${ws.slice(0, 4)} · ` : '';
  const subtitle = r.future ? 'Semana futura' : r.inProgress ? `En curso · ${leftTxt(r.daysLeft)}` : `${otherYear}Semana terminada`;
  const c = screen(root, { title: `Semana ${fmtWeekRange(ws)}`, subtitle, back: '#/progress' });
  c.classList.add('wk');
  c.dataset.week = ws;
  c.appendChild(weekNav(ws, cur));

  if (!r.hasHistory) {
    c.appendChild(h('section.card.wk-empty', emptyState({
      emoji: '📋',
      title: 'Aún no hay datos',
      text: 'Cuando registres sesiones, aquí verás cada semana primero la información (series por músculo, empuje y tirón, carga, kilómetros y cómo progresa cada ejercicio) y después las sugerencias, cada una con su «¿Por qué?».',
      action: { label: 'Ir a Hoy', onClick: () => navigate('#/today') },
    })));
    return;
  }
  if (r.future) {
    c.appendChild(h('section.card.wk-empty', emptyState({
      emoji: '🗓️', title: 'Semana futura', text: 'Aún no hay datos de esta semana.',
      action: { label: 'Ir a esta semana', onClick: () => goWeek(cur) },
    })));
    return;
  }
  if (r.beforeHistory) {
    c.appendChild(h('section.card.wk-empty', emptyState({
      emoji: '🗓️', title: 'Sin registros hasta esta semana', text: `Tu primer registro es del ${fmtDate(r.firstDate, 'full')}.`,
      action: { label: 'Ir a esa semana', onClick: () => goWeek(weekStart(r.firstDate)) },
    })));
    return;
  }

  if (r.inProgress) {
    c.appendChild(h('p.wk-provisional', icon('clock', 16),
      h('span', `Semana en curso, ${leftTxt(r.daysLeft)}: los recuentos son provisionales y lo que aún no llega al mínimo se puede completar.`)));
  }
  c.appendChild(weekRecap(data, ws, today));
  c.appendChild(block('info', 'Información', 'Lo que ha pasado esta semana, con los datos de tus registros.', r.info));
  c.appendChild(block('suggestion', 'Sugerencias', 'Qué podrías hacer según tus reglas (Ajustes › Umbrales). Son orientativas.', r.suggestions));
  c.appendChild(h('button.list-item.wk-settings-link', { type: 'button', onClick: () => navigate('#/settings/thresholds') },
    icon('sliders', 22),
    h('span.list-item-main',
      h('span.list-item-title', 'Rangos y umbrales'),
      h('span.list-item-sub', 'Series, incrementos, avisos y descarga')),
    icon('chevron-right', 20, 'chev')));
}

const goWeek = (w) => navigate(`#/weekly?week=${w}`, { replace: true });

function weekNav(ws, cur) {
  return h('nav.wk-nav', { 'aria-label': 'Cambiar de semana' },
    h('button.wk-nav-btn', { type: 'button', 'aria-label': 'Semana anterior', dataset: { nav: 'prev' }, onClick: () => goWeek(addDays(ws, -7)) },
      icon('chevron-left', 22)),
    h('button.wk-nav-cur', { type: 'button', disabled: ws === cur, dataset: { nav: 'current' }, onClick: () => goWeek(cur) },
      ws === cur ? 'Esta semana' : 'Ir a esta semana'),
    h('button.wk-nav-btn', { type: 'button', 'aria-label': 'Semana siguiente', disabled: ws >= cur, dataset: { nav: 'next' }, onClick: () => goWeek(addDays(ws, 7)) },
      icon('chevron-right', 22)));
}

// ===========================================================================
// «Resumen de la semana» (módulo de resúmenes, MEJORAS §5): arriba del panel, antes de Información
// ===========================================================================

/**
 * Bloque compacto con los totales de la semana (sesiones, tiempo, carga, volumen de fuerza y km por deporte)
 * frente a la semana anterior (en curso: el mismo tramo, lunes → hoy) y enlaces al resumen del mes y del año.
 * Los números salen de summary-logic.periodSummary (los mismos que en #/summary).
 */
function weekRecap(data, ws, today) {
  const sum = periodSummary(data, { unit: 'week', start: ws, today });
  const cmp = sum.compare;
  const ok = cmp.available;
  // Mes / año de la semana: el de hoy si está en curso; si no, el del jueves (el que tiene más días de la semana).
  const ref = sum.inProgress ? today : addDays(ws, 3);
  const kmKinds = sum.kindOrder.filter((k) => sum.byKind[k].km > 0 || (cmp.kinds[k] && cmp.kinds[k].km));
  const stat = (key, label, value, d, fmt) => h('div.wk-recap-kpi', { dataset: { kpi: key } },
    h('span.wk-recap-label', label),
    h('span.wk-recap-value', value),
    ok ? deltaChip(d, fmt) : null);
  const minutes = (v) => fmtValue('minutes', v);
  const volume = (v) => fmtValue('volume', v);
  return h('section.card.wk-recap', { dataset: { card: 'week-summary' }, 'aria-labelledby': 'wk-recap-title' },
    h('div.wk-recap-head',
      h('span.wk-block-icon', { 'aria-hidden': 'true' }, icon('calendar', 20)),
      h('div.wk-recap-titles',
        h('h2#wk-recap-title.wk-recap-title', 'Resumen de la semana'),
        h('p.wk-recap-sub', ok ? cmp.label : 'Sin semana anterior con registros para comparar'))),
    sum.empty ? h('p.wk-recap-empty', 'Sin entrenamientos registrados esta semana.') : null,
    h('div.wk-recap-kpis',
      stat('sessions', 'Sesiones', fmtNum(sum.sessions, 0), cmp.sessions),
      stat('minutes', 'Tiempo', minutes(sum.minutes), cmp.minutes, minutes),
      stat('load', 'Carga', fmtValue('load', sum.load), cmp.load),
      stat('volume', 'Volumen de fuerza', volume(sum.strength.volume), cmp.volume, volume)),
    kmKinds.length
      ? h('ul.wk-recap-km', { 'aria-label': 'Distancia por deporte' }, kmKinds.map((k) => {
        const info = kindInfo(k);
        const d = cmp.kinds[k] && cmp.kinds[k].km;
        return h('li.wk-recap-km-row', { dataset: { kind: k }, style: kindColorStyle(k) },
          h('span.wk-recap-km-name', h('span', { 'aria-hidden': 'true' }, `${info.emoji} `), info.label),
          h('span.wk-recap-km-right',
            h('span.wk-recap-km-val', fmtKm(k, sum.byKind[k].km)),
            ok && d ? deltaChip(d, (v) => fmtKm(k, v)) : null));
      }))
      : null,
    h('div.wk-recap-links',
      h('button.btn.btn-secondary.wk-recap-link', { type: 'button', dataset: { link: 'month' }, onClick: () => navigate(summaryHref('month', ref)) },
        'Ver mes', icon('chevron-right', 18)),
      h('button.btn.btn-secondary.wk-recap-link', { type: 'button', dataset: { link: 'year' }, onClick: () => navigate(summaryHref('year', ref)) },
        'Ver año', icon('chevron-right', 18))));
}

function block(section, title, sub, msgs) {
  const id = `wk-block-${section}`;
  return h(`section.wk-block.wk-block-${section}`, { dataset: { section }, 'aria-labelledby': id },
    h('header.wk-block-head',
      h('span.wk-block-icon', { 'aria-hidden': 'true' }, icon(section === 'info' ? 'chart' : 'target', 20)),
      h('div.wk-block-titles',
        h('h2.wk-block-title', { id }, title),
        h('p.wk-block-sub', sub)),
      h('span.wk-block-count', { 'aria-label': `${msgs.length} mensajes` }, String(msgs.length))),
    msgs.length
      ? msgs.map(messageCard)
      : h('p.wk-none', section === 'info' ? 'Sin información para esta semana.' : 'Sin sugerencias para esta semana.'));
}

function levelBadge(m, extra = '') {
  return h(`span.wk-level.wk-level-${m.level}${extra}`, icon(LEVEL_ICON[m.level] || 'info', 14), m.tag || LEVEL_LABEL[m.level]);
}

function messageCard(m) {
  return h('article.card.wk-msg', { class: `wk-msg-${m.level}`, dataset: { id: m.id, level: m.level, section: m.section } },
    h('div.wk-msg-head', levelBadge(m)),
    h('h3.wk-msg-title', m.title),
    h('p.wk-msg-text', m.text),
    itemsView(m),
    whyBox(whyContent(m.why)));
}

/**
 * Contenido del «¿Por qué?» de un mensaje: la regla con los umbrales y la lista de datos concretos.
 * Toda la lista va igual: en dos columnas o, si alguna fila es larga, todas apiladas (etiqueta arriba y valor
 * debajo), para no ir en zigzag ni partir un valor a media frase. La usan #/weekly y la tarjeta resumen.
 * @param {{rule:string, data:{label:string, value:string, sub?:boolean}[]}} why
 * @returns {HTMLElement}
 */
export function whyContent(why) {
  const stack = why.data.some((d) => isLong(d.label, d.value));
  return h('div.wk-why',
    h('p.wk-why-rule', h('b', 'Regla. '), why.rule),
    h('p.wk-why-head', 'Datos'),
    h(`ul.wk-why-data${stack ? '.wk-why-stacked' : ''}`, why.data.map((d) => h('li.wk-why-row', { class: d.sub ? 'wk-why-sub' : null },
      h('span.wk-why-label', d.label),
      h('span.wk-why-value', d.value)))));
}

function itemsView(m) {
  if (!m.items || !m.items.length) return null;
  if (m.id === 'muscles') {
    return h('div.wk-muscles',
      bodyMap({ muscles: bodyMapData(m.items), inProgress: !!m.inProgress, label: 'Mapa corporal: series de la semana por músculo' }),
      muscleTable(m.items, m.inProgress));
  }
  if (NO_ITEMS.has(m.id) || (m.items.length < 2 && !ALWAYS_ITEMS.has(m.id))) return null;
  const stack = m.items.some((it) => isLong(it.label, it.value));
  const rows = m.items.map((it, i) => h('li.wk-item', { hidden: i >= ITEMS_VISIBLE },
    h('span.wk-item-label', it.label),
    h('span.wk-item-value', it.value)));
  const list = h(`ul.wk-items${stack ? '.wk-items-stack' : ''}`, rows);
  const extra = m.items.length - ITEMS_VISIBLE;
  if (extra <= 0) return list;
  const more = `Ver ${extra} más`;
  const btn = h('button.wk-more', {
    type: 'button',
    'aria-expanded': 'false',
    onClick: () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      rows.forEach((r, i) => { if (i >= ITEMS_VISIBLE) r.hidden = !open; });
      btn.setAttribute('aria-expanded', String(open));
      btn.firstChild.textContent = open ? 'Ver menos' : more;
      btn.classList.toggle('open', open);
    },
  }, h('span', more), icon('chevron-down', 18));
  return h('div.wk-items-wrap', list, btn);
}

const STATUS_CLASS = { below: 'below', in: 'in', above: 'above', none: 'none' };

/** Tabla de músculos: series frente al rango (banda) y Δ con la semana anterior. */
function muscleTable(rows, inProgress) {
  const scale = Math.max(1, ...rows.map((r) => Math.max(r.sets, r.max ?? 0))) * 1.08;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / scale) * 100)).toFixed(2)}%`;
  return h('div.wk-mtable', { role: 'list', 'aria-label': 'Series por músculo' },
    rows.map((r) => {
      const st = r.pending ? 'pending' : STATUS_CLASS[r.status] || 'none';
      return h('div.wk-mrow', {
        role: 'listitem',
        dataset: { muscle: r.muscleId, status: st },
        'aria-label': `${r.name}: ${fmtNum(r.sets, 1)} series${r.range ? `, rango ${r.range}` : ''}, ${r.statusLabel}, semana anterior ${fmtNum(r.prevSets, 1)}`,
      },
      h('div.wk-mrow-top',
        h('span.wk-mrow-name', r.name),
        h('span.wk-mrow-val', h('b', fmtNum(r.sets, 1)), r.range ? h('span.wk-mrow-range', ` / ${r.range}`) : null),
        h(`span.wk-mstatus.wk-mstatus-${st}`, r.statusLabel)),
      h('div.wk-mrow-bottom',
        h('span.wk-mbar', { 'aria-hidden': 'true' },
          r.range ? h('span.wk-mbar-band', { style: { left: pct(r.min), width: `calc(${pct(r.max)} - ${pct(r.min)})` } }) : null,
          h('span.wk-mbar-fill', { style: { width: r.sets > 0 ? pct(r.sets) : '0' } })),
        // En curso, una semana a medias frente a una entera daría Δ negativos engañosos: se enseña la anterior.
        h('span.wk-mrow-delta', inProgress ? `ant. ${fmtNum(r.prevSets, 1)}` : `Δ ${r.deltaLabel}`)));
    }),
    h('p.wk-mnote', inProgress
      ? 'Barra: series de esta semana; zona verde: tu rango. «Faltan N» = series que quedan para el mínimo (la semana sigue en curso). «ant.»: series de la semana anterior completa.'
      : 'Barra: series de la semana; zona verde: tu rango. Δ: diferencia con la semana anterior.'));
}

// ===========================================================================
// Tarjeta resumen (Hoy y Progreso)
// ===========================================================================

/**
 * CONTRATO (lo usan Hoy y Progreso): tarjeta breve con 2–3 mensajes clave de la semana actual y el botón
 * «Ver panel semanal». Los mensajes van agrupados como en el panel (primero «Información», después
 * «Sugerencias»), con su texto completo (las cifras que lo justifican) y su «¿Por qué?».
 * Devuelve null si aún no hay ninguna sesión registrada.
 * @param {{data?: object, max?: number}} [opts] data: entrada de insights (por defecto weeklyData()); puede
 *   ser el dataFromStore() de la pantalla: si no trae `checkins`, se le añaden al MISMO objeto (así se conserva
 *   la caché de stats.js, que va por objeto).
 * @returns {HTMLElement|null}
 */
export function weeklySummaryCard({ data = null, max = 3 } = {}) {
  const d = data || weeklyData();
  if (!d.checkins) d.checkins = store.all('checkins');
  const r = weeklyInsights(d, d.today);
  if (!r.hasHistory) return null;
  const msgs = keyMessages(r, max);
  const sub = `${fmtWeekRange(r.week)}${r.inProgress ? ` · ${leftTxt(r.daysLeft)}` : ''}`;
  return h('section.card.wk-summary', { dataset: { card: 'weekly' } },
    h('div.wk-summary-head',
      h('span.wk-block-icon', { 'aria-hidden': 'true' }, icon('chart', 20)),
      h('div.wk-summary-titles',
        // «Panel semanal» y no «Esta semana»: en Hoy va justo debajo de la mini semana, que ya se llama así.
        h('h2.wk-summary-title', 'Panel semanal'),
        h('p.wk-summary-sub', sub))),
    msgs.length
      ? SUMMARY_GROUPS.map(([sec, label]) => {
        const list = msgs.filter((m) => m.section === sec);
        if (!list.length) return null;
        return h(`section.wk-summary-group.wk-summary-group-${sec}`, { dataset: { section: sec }, 'aria-label': label },
          h('h3.wk-summary-ghead', label),
          h('ul.wk-summary-list', list.map(summaryItem)));
      })
      : h('p.wk-summary-empty', 'Sin avisos ni sugerencias destacadas esta semana.'),
    h('button.btn.btn-secondary.btn-block.wk-summary-btn', { type: 'button', onClick: () => navigate(`#/weekly?week=${r.week}`) },
      'Ver panel semanal', icon('chevron-right', 18)));
}

function summaryItem(m) {
  return h('li.wk-summary-item', { dataset: { id: m.id, level: m.level, section: m.section } },
    levelBadge(m, '.wk-level-sm'),
    h('span.wk-summary-mtitle', m.title),
    h('p.wk-summary-mtext', m.text),
    whyBox(whyContent(m.why)));
}
