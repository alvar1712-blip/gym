// summary.js — resúmenes mensual y anual (#/summary?p=month|year&d=YYYY-MM-DD), MEJORAS §5.
// PROPIETARIO: módulo de resúmenes. Los números salen de js/summary-logic.js (puro); aquí solo se pintan:
// segmentado Mes / Año, navegación ‹ › (sin pasar del periodo actual; replaceUrl, sin llenar el historial),
// aviso «en curso», totales, tarjetas por deporte (color de cada tipo + emoji y nombre), días entrenados,
// fuerza (volumen y series por músculo), récords, ejercicios que más progresan y comparación con el anterior.
// También exporta deltaChip(), que usa el bloque «Resumen de la semana» del panel semanal (views/weekly.js).
import { navigate, replaceUrl } from '../router.js';
import { h, icon, screen, emptyState, segmented } from '../ui.js';
import { todayStr, isDateStr, fmtDate, fmtNum, addMonths, DAY_LONG, deltaTone } from '../util.js';
import { dataFromStore } from '../progress-ui.js';
import {
  periodSummary, periodStart, periodTitle, periodName, kindInfo, deltaInfo, fmtValue, fmtKm, monthGrid, summaryHref,
} from '../summary-logic.js';

/** Filas visibles de una lista larga (récords) antes de «Ver N más». */
const LIST_VISIBLE = 6;
const UNIT_OPTS = [{ value: 'month', label: 'Mes' }, { value: 'year', label: 'Año' }];
const WORD = {
  month: { cur: 'Este mes', go: 'Ir a este mes', prev: 'Mes anterior', next: 'Mes siguiente', the: 'el mes', label: 'Resumen mensual', inProgress: 'Mes en curso' },
  year: { cur: 'Este año', go: 'Ir a este año', prev: 'Año anterior', next: 'Año siguiente', the: 'el año', label: 'Resumen anual', inProgress: 'Año en curso' },
};

/** Color de un tipo de sesión (token --act-<tipo>; un tipo sin token usa el de «otras»). */
export function kindColorStyle(kind) {
  const k = /^[a-z0-9_-]+$/i.test(String(kind)) ? kind : 'other';
  return `--kc: var(--act-${k}, var(--act-other))`;
}

/** Métrica principal de un deporte: km si tiene distancia, si no sesiones. */
const hasKm = (b) => b && b.km > 0;
const sessionsTxt = (n) => `${fmtNum(n, 0)} ${n === 1 ? 'sesión' : 'sesiones'}`;
const daysTxt = (n) => `${fmtNum(n, 0)} ${n === 1 ? 'día' : 'días'}`;
const dayTxt = (date, today) => fmtDate(date, date.slice(0, 4) === today.slice(0, 4) ? 'day' : 'full');

/**
 * Diferencia con el periodo anterior, con flecha y texto (nunca solo color): «▲ +3 (+25 %)», «▼ −1 (−10 %)»,
 * «= igual». La usa también el bloque semanal de #/weekly.
 * @param {{cur, prev, delta, pct}|null} d  diferencia de summary-logic.delta()
 * Color (ronda 8, A4): neutro por defecto; solo verde/ámbar si una regla lo determina (util.deltaTone).
 * @param {(v:number)=>string} [fmt] formato del valor absoluto de la diferencia
 * @param {{better?:'up'|'down', warn?:'up'|'down'}} [rule] regla analítica que da tono (ver deltaTone)
 * @returns {HTMLElement}
 */
export function deltaChip(d, fmt, rule) {
  const info = deltaInfo(d, fmt);
  const tone = deltaTone(info.dir, rule);
  // La diferencia y el % van cada uno entero (se parte entre los dos, nunca «−12 / %»).
  const text = info.absText
    ? [h('span.sum-delta-part', info.absText), ' ', h('span.sum-delta-part', `(${info.pctText || 'antes 0'})`)]
    : info.text;
  return h(`span.sum-delta.sum-delta-${info.dir}.sum-delta-tone-${tone}`, { dataset: { dir: info.dir, tone } },
    info.arrow ? h('span.sum-delta-arrow', { 'aria-hidden': 'true' }, info.arrow) : null,
    h('span.sum-delta-text', text));
}

// ===========================================================================
// #/summary?p=month|year&d=YYYY-MM-DD
// ===========================================================================

export function mountSummary(root, params = {}) {
  const today = todayStr();
  const data = dataFromStore(today); // una vez por montaje: stats.js y summary-logic cachean por objeto
  const state = {
    unit: params.p === 'year' ? 'year' : 'month',
    anchor: isDateStr(params.d) && params.d <= today ? params.d : today,
  };

  const go = (patch, { top = false } = {}) => {
    Object.assign(state, patch);
    if (state.anchor > today) state.anchor = today;
    const d = state.unit === 'month' ? periodStart('month', state.anchor) : state.anchor;
    replaceUrl(summaryHref(state.unit, d));
    render();
    if (top) window.scrollTo(0, 0);
  };

  function render() {
    const sum = periodSummary(data, { unit: state.unit, start: state.anchor, today });
    const w = WORD[state.unit];
    const c = screen(root, { title: sum.title, subtitle: sum.inProgress ? `${w.label} · en curso` : w.label, back: '#/progress' });
    c.classList.add('sum');
    c.dataset.unit = state.unit;
    c.dataset.start = sum.start;
    c.appendChild(h('div.sum-seg', segmented({
      options: UNIT_OPTS,
      value: state.unit,
      ariaLabel: 'Periodo del resumen',
      onChange: (v) => { if (v !== state.unit) go({ unit: v }); },
    })));
    c.appendChild(periodNav(sum, w, state, go));

    if (!sum.hasHistory) {
      c.appendChild(h('section.card.sum-empty', emptyState({
        emoji: '📊',
        title: 'Aún no hay datos',
        text: 'Cuando registres sesiones, aquí verás el resumen de cada mes y de cada año: totales por deporte, días entrenados, fuerza, récords y la comparación con el periodo anterior.',
        action: { label: 'Ir a Hoy', onClick: () => navigate('#/today') },
      })));
      return;
    }
    if (sum.beforeHistory) {
      c.appendChild(h('section.card.sum-empty', emptyState({
        emoji: '🗓️',
        title: `Sin registros en ${sum.name}`,
        text: `Tu primer registro es del ${fmtDate(sum.firstDate, 'full')}.`,
        action: { label: `Ir a ${periodName(state.unit, sum.firstDate)}`, onClick: () => go({ anchor: sum.firstDate }) },
      })));
      return;
    }
    if (sum.inProgress) {
      c.appendChild(h('p.sum-provisional', icon('clock', 16), h('span',
        `${w.inProgress}: ${sum.daysLeft === 1 ? 'queda 1 día (hoy)' : `quedan ${sum.daysLeft} días (hoy incluido)`}. `
        + 'Los totales son provisionales y la comparación es con el mismo tramo del periodo anterior.')));
    }
    if (sum.empty) {
      const parts = [];
      if (sum.lastBefore) parts.push(`Tu último registro anterior es del ${fmtDate(sum.lastBefore, 'full')}.`);
      if (sum.nextAfter) parts.push(`El siguiente, del ${fmtDate(sum.nextAfter, 'full')}.`);
      if (sum.inProgress) parts.push('Cuando registres algo, aparecerá aquí.');
      c.appendChild(h('section.card.sum-empty', emptyState({
        emoji: '🌱',
        title: sum.inProgress ? `Aún no hay entrenamientos ${state.unit === 'month' ? 'este mes' : 'este año'}` : `Sin entrenamientos en ${sum.name}`,
        text: parts.join(' '),
        action: sum.lastBefore ? { label: `Ver ${periodName(state.unit, sum.lastBefore)}`, onClick: () => go({ anchor: sum.lastBefore }) } : null,
      })));
      return;
    }

    c.appendChild(totalsCard(sum));
    c.appendChild(sportsSection(sum));
    c.appendChild(state.unit === 'year' ? monthsCard(sum, (ms) => go({ unit: 'month', anchor: ms }, { top: true })) : calendarCard(sum, today));
    const st = strengthCard(sum);
    if (st) c.appendChild(st);
    c.appendChild(recordsCard(sum, today));
    if (sum.strength.sessions > 0 || sum.topProgress.length) c.appendChild(progressCard(sum, today));
    c.appendChild(compareCard(sum));
  }

  render();
}

function periodNav(sum, w, state, go) {
  const isCur = sum.start === sum.nav.current;
  // Año: se conserva el mes de referencia (al volver a «Mes» se ve el mismo mes de ese año).
  const shift = (n) => (state.unit === 'year' ? { anchor: addMonths(state.anchor, 12 * n) } : { anchor: n < 0 ? sum.nav.prev : sum.nav.next });
  return h('nav.sum-nav', { 'aria-label': 'Cambiar de periodo' },
    h('button.sum-nav-btn', { type: 'button', 'aria-label': w.prev, dataset: { nav: 'prev' }, disabled: !sum.nav.prev, onClick: () => go(shift(-1)) },
      icon('chevron-left', 22)),
    h('button.sum-nav-cur', { type: 'button', disabled: isCur, dataset: { nav: 'current' }, onClick: () => go({ anchor: sum.today }) },
      isCur ? w.cur : w.go),
    h('button.sum-nav-btn', { type: 'button', 'aria-label': w.next, dataset: { nav: 'next' }, disabled: !sum.nav.next, onClick: () => go(shift(1)) },
      icon('chevron-right', 22)));
}

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------

function cardHead(title, sub = null, iconName = null) {
  return h('div.sum-card-head',
    iconName ? h('span.sum-card-icon', { 'aria-hidden': 'true' }, icon(iconName, 20)) : null,
    h('div.sum-card-titles',
      h('h2.sum-card-title', title),
      sub ? h('p.sum-card-sub', sub) : null));
}

/** KPI con su diferencia frente al periodo anterior (si hay con qué comparar). */
function kpi({ key, label, value, sub = null, d = null, fmt = undefined, cmp = true, wide = false }) {
  return h(`div.sum-kpi${wide ? '.sum-kpi-wide' : ''}`, { dataset: { kpi: key } },
    h('span.sum-kpi-label', label),
    h('span.sum-kpi-value', value),
    sub ? h('span.sum-kpi-sub', sub) : null,
    cmp && d ? deltaChip(d, fmt) : null);
}

function totalsCard(sum) {
  const c = sum.compare;
  const cmp = c.available;
  return h('section.card.sum-totals', { dataset: { card: 'totals' } },
    cardHead('Totales', cmp ? c.label : 'Sin periodo anterior con registros para comparar', 'chart'),
    h('div.sum-kpis',
      kpi({ key: 'days', label: 'Días entrenados', value: fmtNum(sum.days, 0), sub: `de ${daysTxt(sum.daysElapsed)}${sum.inProgress ? ' hasta hoy' : ''}`, d: c.days, cmp }),
      kpi({ key: 'sessions', label: 'Sesiones', value: fmtNum(sum.sessions, 0), d: c.sessions, cmp }),
      kpi({ key: 'minutes', label: 'Tiempo', value: fmtValue('minutes', sum.minutes), d: c.minutes, fmt: (v) => fmtValue('minutes', v), cmp }),
      kpi({ key: 'load', label: 'Carga', value: fmtValue('load', sum.load), sub: 'min × esfuerzo', d: c.load, cmp })),
    sum.noLoad > 0
      ? h('p.sum-note', `${sessionsTxt(sum.noLoad)} sin carga (falta la duración o el esfuerzo percibido).`)
      : null);
}

function sportsSection(sum) {
  const cmp = sum.compare.available;
  return h('section.sum-sports', { dataset: { card: 'sports' }, 'aria-labelledby': 'sum-sports-title' },
    h('h2#sum-sports-title.section-title', 'Por deporte'),
    h('div.sum-sport-grid', sum.kinds.map((k) => {
      const b = sum.byKind[k];
      const info = kindInfo(k);
      const ck = sum.compare.kinds[k] || null;
      const km = hasKm(b);
      const main = km ? fmtKm(k, b.km) : sessionsTxt(b.count);
      const d = ck ? (km && ck.km ? ck.km : ck.count) : null;
      const fmt = km ? (v) => fmtKm(k, v) : undefined;
      return h('article.sum-sport', { dataset: { kind: k }, style: kindColorStyle(k) },
        h('div.sum-sport-head',
          h('span.sum-sport-emoji', { 'aria-hidden': 'true' }, info.emoji),
          h('h3.sum-sport-name', info.label)),
        h('div.sum-sport-main', main),
        h('ul.sum-sport-lines',
          km ? h('li', sessionsTxt(b.count)) : null,
          h('li', fmtValue('minutes', b.minutes)),
          h('li', `Carga ${fmtValue('load', b.load)}`),
          b.elevationM > 0 ? h('li', `Desnivel +${fmtNum(b.elevationM, 0)} m`) : null),
        cmp && d ? deltaChip(d, fmt) : null);
    })));
}

// Envoltorio con el rol (celda / elemento de lista) y el botón dentro ocupándolo entero: mismo aspecto que antes.
const WRAP_STYLE = { display: 'flex', minWidth: '0' };
const FILL_STYLE = { flex: '1 1 0', minWidth: '0' };

function calendarCard(sum, today) {
  const weeks = monthGrid(sum.start, sum.trainedDates, today);
  const kindsHere = sum.kinds;
  const heads = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  return h('section.card.sum-days', { dataset: { card: 'days' } },
    cardHead('Días entrenados', `${daysTxt(sum.days)} de ${daysTxt(sum.daysElapsed)}${sum.inProgress ? ' hasta hoy' : ''} · toca un día para verlo`, 'calendar'),
    h('div.sum-cal', { role: 'grid', 'aria-label': `Días entrenados de ${sum.name}` },
      h('div.sum-cal-row.sum-cal-heads', { role: 'row' }, heads.map((t, i) => h('span.sum-cal-head', { role: 'columnheader', title: DAY_LONG[i] }, t))),
      weeks.map((wk) => h('div.sum-cal-row', { role: 'row' }, wk.map((cell) => {
        if (!cell.date) return h('span.sum-cal-cell.sum-cal-pad', { role: 'gridcell', 'aria-hidden': 'true' });
        const trained = cell.kinds.length > 0;
        const names = cell.kinds.map((k) => kindInfo(k).label).join(', ');
        const label = `${fmtDate(cell.date, 'long')}: ${trained ? names : cell.future ? 'aún no ha llegado' : 'sin entrenar'}`;
        const inner = [
          h('span.sum-cal-num', String(cell.day)),
          h('span.sum-cal-dots', { 'aria-hidden': 'true' }, cell.kinds.slice(0, 3).map((k) => h('span.sum-cal-dot', { style: kindColorStyle(k) }))),
        ];
        const cls = `${trained ? '.sum-cal-on' : ''}${cell.future ? '.sum-cal-future' : ''}${cell.today ? '.sum-cal-today' : ''}`;
        const current = cell.today ? 'date' : null;
        if (!trained) return h(`span.sum-cal-cell${cls}`, { role: 'gridcell', 'aria-label': label, 'aria-current': current, dataset: { date: cell.date } }, inner);
        // El rol de celda va en un envoltorio: en el propio <button> taparía el botón (VoiceOver).
        return h('span.sum-cal-wrap', { role: 'gridcell', style: WRAP_STYLE },
          h(`button.sum-cal-cell${cls}`, { type: 'button', 'aria-label': label, 'aria-current': current, dataset: { date: cell.date }, style: FILL_STYLE, onClick: () => navigate(`#/day/${cell.date}`) }, inner));
      })))),
    kindsHere.length ? h('ul.sum-legend', { 'aria-label': 'Leyenda' }, kindsHere.map((k) => h('li.sum-legend-item', { style: kindColorStyle(k) },
      h('span.sum-cal-dot', { 'aria-hidden': 'true' }), `${kindInfo(k).emoji} ${kindInfo(k).label}`))) : null);
}

function monthsCard(sum, onMonth) {
  const max = Math.max(1, ...sum.months.map((m) => m.days));
  return h('section.card.sum-months', { dataset: { card: 'months' } },
    cardHead('Días entrenados por mes', `${daysTxt(sum.days)} en ${sum.inProgress ? 'lo que va de año' : 'el año'} · toca un mes para ver su resumen`, 'calendar'),
    h('div.sum-mbars', { role: 'list', 'aria-label': 'Días entrenados por mes' }, sum.months.map((m) => {
      const pct = `${((m.days / max) * 100).toFixed(1)}%`;
      const label = `${m.title}: ${m.future ? 'aún no ha llegado' : `${daysTxt(m.days)}, ${sessionsTxt(m.sessions)}`}`;
      return h('div.sum-mbar-item', { role: 'listitem', style: WRAP_STYLE }, h('button.sum-mbar', {
        type: 'button', disabled: m.future, 'aria-label': label, dataset: { month: m.start, days: String(m.days) },
        class: m.inProgress ? 'sum-mbar-cur' : null, style: FILL_STYLE, onClick: () => onMonth(m.start),
      },
      h('span.sum-mbar-val', m.future ? '' : String(m.days)),
      h('span.sum-mbar-track', { 'aria-hidden': 'true' }, h('span.sum-mbar-fill', { style: { height: m.days > 0 ? pct : '0' } })),
      h('span.sum-mbar-label', m.label.charAt(0).toUpperCase() + m.label.slice(1, 3))));
    })));
}

function strengthCard(sum) {
  const st = sum.strength;
  const c = sum.compare;
  const hadBefore = c.available && c.strengthSessions.prev > 0;
  if (!st.sessions && !hadBefore) return null;
  const cmp = c.available;
  const max = Math.max(1, ...st.muscles.map((m) => m.sets));
  return h('section.card.sum-strength', { dataset: { card: 'strength' }, style: kindColorStyle('strength') },
    cardHead('Fuerza', st.sessions ? `${sessionsTxt(st.sessions)} · solo series de trabajo` : 'Sin sesiones de fuerza en este periodo', 'dumbbell'),
    h('div.sum-kpis',
      kpi({ key: 'volume', label: 'Volumen (kg × reps)', value: fmtValue('volume', st.volume), d: c.volume, fmt: (v) => fmtValue('volume', v), cmp, wide: true }),
      kpi({ key: 'strength-sessions', label: 'Sesiones', value: fmtNum(st.sessions, 0), d: c.strengthSessions, cmp }),
      kpi({ key: 'work-sets', label: 'Series de trabajo', value: fmtNum(st.workSets, 0), d: c.workSets, cmp })),
    st.muscles.length
      ? h('div.sum-muscles',
        h('h3.sum-sub-title', 'Series por músculo'),
        h('ul.sum-mlist', { 'aria-label': 'Series por músculo' }, st.muscles.map((m) => h('li.sum-mrow', { dataset: { muscle: m.muscleId } },
          h('div.sum-mrow-top',
            h('span.sum-mrow-name', m.name),
            h('span.sum-mrow-val', h('b', fmtNum(m.sets, 1)), h('span', ` · ${fmtNum(m.perWeek, 1)}/sem${m.target ? ` (rango ${m.target[0]}–${m.target[1]})` : ''}`))),
          h('span.sum-mbar-h', { 'aria-hidden': 'true' }, h('span.sum-mbar-h-fill', { style: { width: `${((m.sets / max) * 100).toFixed(1)}%` } }))))),
        h('p.sum-note', `Principal 1 serie, secundario ${fmtNum(0.5, 1)}. «/sem»: media semanal ${sum.inProgress ? 'de lo que va de periodo' : 'del periodo'}; el rango es tu objetivo semanal (Ajustes › Umbrales).`))
      : null);
}

function recordsCard(sum, today) {
  const list = sum.records;
  const rows = list.map((r, i) => {
    const href = r.type === 'strength' ? `#/session/${r.sessionId}` : `#/activity/${r.sessionId}`;
    return h('li.sum-rec', { hidden: i >= LIST_VISIBLE, dataset: { type: r.type, kind: r.kind } },
      h('button.sum-rec-btn', { type: 'button', style: kindColorStyle(r.kind), onClick: () => navigate(href) },
        h('span.sum-rec-icon', { 'aria-hidden': 'true' }, r.type === 'strength' ? icon('trophy', 18) : kindInfo(r.kind).emoji),
        h('span.sum-rec-main',
          h('span.sum-rec-label', r.label, r.count > 1 ? h('span.badge.badge-pr.sum-rec-count', `${r.count} récords`) : null),
          h('span.sum-rec-detail', keepSets(r.detail))),
        h('span.sum-rec-date', dayTxt(r.date, today)),
        icon('chevron-right', 18, 'chev')));
  });
  return h('section.card.sum-records', { dataset: { card: 'records' } },
    cardHead('Récords del periodo', list.length ? `${fmtNum(list.length, 0)} ${list.length === 1 ? 'marca batida' : 'marcas batidas'} frente a todo tu historial anterior` : null, 'trophy'),
    list.length ? h('div.sum-list-wrap', h('ul.sum-rec-list', rows), moreButton(rows, LIST_VISIBLE))
      : h('p.sum-none', 'Sin récords nuevos en este periodo. Un récord cuenta cuando superas una marca que ya tenías.'));
}

function progressCard(sum, today) {
  const list = sum.topProgress;
  const unitWord = sum.unit === 'year' ? 'del año' : 'del mes';
  const prevWord = sum.unit === 'year' ? 'del año anterior' : 'del mes anterior';
  return h('section.card.sum-progress', { dataset: { card: 'progress' } },
    cardHead('Ejercicios que más progresan', '1RM estimado: de dónde partías al mejor del periodo', 'bolt'),
    list.length
      ? h('ul.sum-prog-list', list.map((p) => h('li.sum-prog', { dataset: { exercise: p.exerciseId } },
        h('button.sum-prog-btn', { type: 'button', onClick: () => navigate(`#/progress/exercise/${p.exerciseId}`) },
          h('span.sum-prog-main',
            h('span.sum-prog-name', p.name),
            h('span.sum-prog-vals', `${fmtNum(p.from, 1)} → ${fmtNum(p.to, 1)} kg`),
            h('span.sum-prog-basis', p.basis === 'prev'
              ? `desde tu última sesión ${prevWord} (${dayTxt(p.fromDate, today)})`
              : `desde tu primera sesión ${unitWord} (${dayTxt(p.fromDate, today)})`)),
          deltaChip({ cur: p.to, prev: p.from, delta: p.delta, pct: p.pct }, (v) => `${fmtNum(v, 1)} kg`, { better: 'up' }),
          icon('chevron-right', 18, 'chev')))))
      : h('p.sum-none', 'Ningún ejercicio ha subido su 1RM estimado en este periodo.'),
    sum.progressTotal > list.length ? h('p.sum-note', `Y ${fmtNum(sum.progressTotal - list.length, 0)} más con alguna subida.`) : null);
}

function compareCard(sum) {
  const c = sum.compare;
  const head = cardHead('Comparación con el periodo anterior', c.label, 'swap');
  if (!c.available) {
    return h('section.card.sum-compare', { dataset: { card: 'compare' } }, head,
      h('p.sum-none', 'No hay registros del periodo anterior con los que comparar.'));
  }
  const row = (key, label, d, fmt = (v) => fmtNum(v, 0), style = null) => h('li.sum-cmp-row', { dataset: { row: key }, style },
    h('span.sum-cmp-main',
      h('span.sum-cmp-label', label),
      h('span.sum-cmp-prev', `antes ${fmt(d.prev)}`)),
    h('span.sum-cmp-right',
      h('span.sum-cmp-cur', fmt(d.cur)),
      deltaChip(d, fmt)));
  const rows = [
    row('days', 'Días entrenados', c.days),
    row('sessions', 'Sesiones', c.sessions),
    row('minutes', 'Tiempo', c.minutes, (v) => fmtValue('minutes', v)),
    row('load', 'Carga', c.load),
  ];
  if (c.strengthSessions.cur > 0 || c.strengthSessions.prev > 0) {
    rows.push(row('volume', 'Volumen de fuerza', c.volume, (v) => fmtValue('volume', v)));
    rows.push(row('work-sets', 'Series de fuerza', c.workSets));
  }
  for (const k of sum.kindOrder) {
    const ck = c.kinds[k];
    if (!ck) continue;
    const info = kindInfo(k);
    if (ck.km) rows.push(row(`km-${k}`, `${info.emoji} ${info.label} · distancia`, ck.km, (v) => fmtKm(k, v), kindColorStyle(k)));
    else rows.push(row(`count-${k}`, `${info.emoji} ${info.label} · sesiones`, ck.count, undefined, kindColorStyle(k)));
  }
  const p = c.prevTotals;
  return h('section.card.sum-compare', { dataset: { card: 'compare' } }, head,
    h('ul.sum-cmp-list', rows),
    c.partial
      ? h('p.sum-note', `${capFirst(periodTitle(sum.unit, sum.prevStart))} completo: ${sessionsTxt(p.sessions)} en ${daysTxt(p.days)}, ${fmtValue('minutes', p.minutes).replace(/ /g, '\u00a0')}, carga ${fmtValue('load', p.load)}.`)
      : null);
}

const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** La serie entre paréntesis («(85 kg × 5 @2)») no se parte en dos líneas. */
const keepSets = (t) => String(t).replace(/\([^)]*\)/g, (m) => m.replace(/ /g, '\u00a0'));

/** Botón «Ver N más» / «Ver menos» para una lista con filas ocultas (null si caben todas). */
function moreButton(rows, visible) {
  const extra = rows.length - visible;
  if (extra <= 0) return null;
  const more = `Ver ${extra} más`;
  const btn = h('button.sum-more', {
    type: 'button',
    'aria-expanded': 'false',
    onClick: () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      rows.forEach((r, i) => { if (i >= visible) r.hidden = !open; });
      btn.setAttribute('aria-expanded', String(open));
      btn.firstChild.textContent = open ? 'Ver menos' : more;
      btn.classList.toggle('open', open);
    },
  }, h('span', more), icon('chevron-down', 18));
  return btn;
}
