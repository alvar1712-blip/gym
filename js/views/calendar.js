// calendar.js — Calendario (semana / mes) y detalle de un día.
// PROPIETARIO: módulo de calendario. Lógica en ../plan.js; piezas comunes en ../plan-ui.js.
// Los cambios de un día (cambiar, mover, marcar) van al store 'plan' y NUNCA a la semana tipo.
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, header, screen, segmented, sheet, actionSheet, undoToast, emptyState } from '../ui.js';
import {
  todayStr, fmtDate, fmtWeekRange, weekStart, addDays, addMonths, parseDate, isDateStr, weekDates, diffDays, dow,
  DAY_SHORT, DAY_LONG, DAY_LETTER, MONTH_LONG, MONTH_SHORT,
} from '../util.js';
import { pickTemplate } from '../pickers.js';
import {
  ctxFromStore, weekPlan, dayStatus, adherence, adherenceText, monthWeeks, planEmoji, planLabel,
  overrideDay, swapDays, setManualStatus, resetDay, planSnapshot, STATUS_LABEL, MANUAL_STATUSES,
} from '../plan.js';
import { sessionSummary } from '../history-logic.js';
import {
  cap, routeParam, statusPill, sessionRow, summaryOpts, templatePreview, startStrength, pickAndStart,
  otherSessionMenu, activityHref, freeActionLabel, freeSubtype,
} from '../plan-ui.js';

const SCOPE_NOTE = 'Los cambios afectan solo a este día; tu semana tipo no cambia.';

// ===========================================================================
// Calendario: #/calendar?week=YYYY-MM-DD  ·  #/calendar?view=month&month=YYYY-MM
// ===========================================================================
export function mountCalendar(root, params = {}) {
  const today = todayStr();
  const month = params.view === 'month';
  const content = screen(root, {
    title: 'Calendario',
    actions: [{ icon: 'history', label: 'Historial', onClick: () => navigate('#/history') }],
  });
  content.classList.add('cal');
  const ctx = ctxFromStore(today);

  const anchorWeek = weekStart(isDateStr(params.week) ? params.week : today);
  const anchorMonth = /^\d{4}-\d{2}$/.test(params.month || '') ? `${params.month}-01` : `${anchorWeek.slice(0, 7)}-01`;

  content.appendChild(segmented({
    options: [{ value: 'week', label: 'Semana' }, { value: 'month', label: 'Mes' }],
    value: month ? 'month' : 'week',
    ariaLabel: 'Vista',
    onChange: (v) => {
      if (v === 'month') navigate(`#/calendar?view=month&month=${anchorWeek.slice(0, 7)}`, { replace: true });
      else {
        // Del mes a la semana: la semana actual si es este mes; si no, la primera del mes.
        const ws = anchorMonth.slice(0, 7) === today.slice(0, 7) ? weekStart(today) : weekStart(anchorMonth);
        navigate(`#/calendar?week=${ws}`, { replace: true });
      }
    },
  }));

  if (month) renderMonth(content, anchorMonth, ctx, today);
  else renderWeek(content, anchorWeek, ctx, today);

  content.appendChild(h('div.list.cal-links',
    linkRow('calendar', 'Editar semana tipo', 'El orden habitual de tus días', '#/settings/week'),
    linkRow('history', 'Historial', 'Todas tus sesiones y actividades', '#/history')));
}

function linkRow(ic, title, sub, href) {
  return h('button.list-item', { type: 'button', onClick: () => navigate(href) },
    icon(ic, 22, 'muted'),
    h('span.list-item-main', h('span.list-item-title', title), h('span.list-item-sub', sub)),
    icon('chevron-right', 20, 'chev'));
}

/** Barra ‹ título › + «Hoy». */
function navBar({ title, sub, onPrev, onNext, onToday, isCurrent, prevLabel, nextLabel }) {
  return h('div.cal-nav',
    h('button.icon-btn.cal-nav-btn', { type: 'button', 'aria-label': prevLabel, onClick: onPrev }, icon('chevron-left', 26)),
    h('div.cal-nav-title', h('div.cal-nav-main', title), sub ? h('div.cal-nav-sub', sub) : null),
    h('button.icon-btn.cal-nav-btn', { type: 'button', 'aria-label': nextLabel, onClick: onNext }, icon('chevron-right', 26)),
    h('button.btn.btn-sm.btn-secondary.cal-today-btn', { type: 'button', disabled: isCurrent, onClick: onToday }, 'Hoy'));
}

function weekSubLabel(ws, today) {
  const n = diffDays(weekStart(today), ws) / 7;
  if (n === 0) return 'Esta semana';
  if (n === -1) return 'Semana pasada';
  if (n === 1) return 'Semana que viene';
  const y = parseDate(ws).getFullYear();
  return n < 0 ? `Hace ${-n} semanas${y !== parseDate(today).getFullYear() ? ` · ${y}` : ''}` : `Dentro de ${n} semanas`;
}

// ---------------------------------------------------------------------------
// Semana
// ---------------------------------------------------------------------------
function renderWeek(content, ws, ctx, today) {
  const go = (w) => navigate(`#/calendar?week=${w}`, { replace: true });
  content.appendChild(navBar({
    title: fmtWeekRange(ws),
    sub: weekSubLabel(ws, today),
    onPrev: () => go(addDays(ws, -7)),
    onNext: () => go(addDays(ws, 7)),
    onToday: () => go(weekStart(today)),
    isCurrent: ws === weekStart(today),
    prevLabel: 'Semana anterior',
    nextLabel: 'Semana siguiente',
  }));

  const a = adherence(ws, ctx);
  content.appendChild(h('section.card.cal-adherence',
    h('div.row-between',
      h('div.cal-adh-text', adherenceText(a)),
      a.pct != null ? h('div.cal-adh-pct.tnum', `${a.pct}\u00a0%`) : null),
    h('div.cal-bar', { role: 'img', 'aria-label': `Adherencia ${a.pct ?? 0} %` },
      h('div.cal-bar-fill', { style: { width: `${Math.min(100, a.pct ?? 0)}%` } }))));

  const opts = summaryOpts();
  const days = weekPlan(ws, ctx);
  content.appendChild(h('div.list.cal-week', days.map((d, i) => dayRow(d, i, today, opts))));
  content.appendChild(h('p.small.muted.cal-hint', 'Toca un día para cambiarlo, moverlo, marcarlo o registrar una sesión.'));
}

function dayRow(d, i, today, opts) {
  const num = parseDate(d.date).getDate();
  const sessions = d.sessions.map((s) => {
    const sum = sessionSummary(s, opts);
    // Si la sesión se llama como el plan, no se repite el nombre.
    const txt = [sum.title === d.plan.label ? '' : sum.title, sum.duration].filter(Boolean).join(' · ') || 'Registrada';
    return h('span.cal-row-ses', `${sum.emoji} ${txt}`);
  });
  return h('button.cal-row', {
    type: 'button',
    class: `${d.date === today ? 'is-today' : ''} ${d.date < today ? 'is-past' : ''}`,
    dataset: { date: d.date, status: d.status },
    onClick: () => navigate(`#/day/${d.date}`),
  },
  h('span.cal-row-date', h('span.cal-row-dow', DAY_SHORT[i]), h('span.cal-row-num.tnum', String(num))),
  h('span.cal-row-main',
    h('span.cal-row-plan',
      h('span.cal-row-plan-name', `${planEmoji(d.plan)} ${d.plan.label}`),
      d.plan.substituted ? h('span.badge.badge-info.cal-changed-badge', 'cambiado') : null),
    // En un descanso sin nada más, la píldora «Descanso» repetiría el plan.
    d.plan.kind === 'rest' && d.status === 'rest' && !d.manual
      ? null
      : h('span.cal-row-state', statusPill(d.status, { manual: d.manual }), d.extra ? h('span.cal-extra', '· extra') : null),
    sessions),
  icon('chevron-right', 20, 'chev'));
}

// ---------------------------------------------------------------------------
// Mes: cuadrícula de puntos de estado; tocar un día abre su semana.
// ---------------------------------------------------------------------------
function renderMonth(content, first, ctx, today) {
  const d = parseDate(first);
  const ym = first.slice(0, 7);
  const go = (m) => navigate(`#/calendar?view=month&month=${m.slice(0, 7)}`, { replace: true });
  content.appendChild(navBar({
    title: cap(`${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`),
    sub: null,
    onPrev: () => go(addMonths(first, -1)),
    onNext: () => go(addMonths(first, 1)),
    onToday: () => go(today),
    isCurrent: ym === today.slice(0, 7),
    prevLabel: 'Mes anterior',
    nextLabel: 'Mes siguiente',
  }));

  const weeks = monthWeeks(first);
  const grid = h('div.cal-month', { role: 'grid', 'aria-label': 'Mes' },
    h('div.cal-month-row.cal-month-head', { role: 'row' }, DAY_LETTER.map((l) => h('span.cal-month-dow', { role: 'columnheader' }, l))));
  const summary = h('div.list.cal-month-weeks');
  for (const ws of weeks) {
    const days = weekPlan(ws, ctx);
    const openWeek = () => navigate(`#/calendar?week=${ws}`);
    grid.appendChild(h('div.cal-month-row', { role: 'row', class: ws === weekStart(today) ? 'is-current' : '' },
      days.map((day) => {
        const out = day.date.slice(0, 7) !== ym;
        return h('button.cal-month-cell', {
          type: 'button',
          role: 'gridcell',
          class: `${out ? 'is-out' : ''} ${day.date === today ? 'is-today' : ''}`,
          dataset: { date: day.date, status: day.status },
          'aria-label': `${fmtDate(day.date, 'long')}: ${day.plan.label}, ${STATUS_LABEL[day.status]}`,
          onClick: openWeek,
        }, h('span.cal-month-num.tnum', String(parseDate(day.date).getDate())), h(`span.cal-dot.st-${day.status}`));
      })));
    const a = adherence(ws, ctx);
    summary.appendChild(h('button.list-item.cal-month-week', { type: 'button', dataset: { week: ws }, onClick: openWeek },
      h('span.list-item-main',
        h('span.list-item-title', fmtWeekRange(ws)),
        h('span.list-item-sub', adherenceText(a))),
      a.pct != null ? h('span.cal-adh-pct.small.tnum', `${a.pct}\u00a0%`) : null,
      icon('chevron-right', 20, 'chev')));
  }
  content.appendChild(h('section.card.cal-month-card', grid, legend()));
  content.appendChild(h('h2.section-title', 'Semanas'));
  content.appendChild(summary);
}

function legend() {
  return h('div.cal-legend', ['done', 'partial', 'substituted', 'skipped', 'rest', 'pending', 'none'].map((s) =>
    h('span.cal-legend-item', h(`span.cal-dot.st-${s}`), cap(STATUS_LABEL[s]))));
}

// ===========================================================================
// Día: #/day/:date
// ===========================================================================
export function mountDay(root, params = {}) {
  const date = routeParam(params, 'date', /^\/day\/([^/]+)/);
  if (!isDateStr(date)) {
    const c = screen(root, { title: 'Día', back: '#/calendar' });
    c.appendChild(emptyState({ emoji: '📅', title: 'Fecha no válida', text: 'Vuelve al calendario y elige un día.', action: { label: 'Ir al calendario', onClick: () => navigate('#/calendar', { replace: true }) } }));
    return undefined;
  }
  const today = todayStr();
  const ws = weekStart(date);
  const rel = date === today ? 'Hoy' : date === addDays(today, -1) ? 'Ayer' : date === addDays(today, 1) ? 'Mañana' : `Semana ${fmtWeekRange(ws)}`;
  const content = h('div.content.cal-dayview');
  // Título corto para que no se corte («Miércoles 23 sep»); el año (si no es el actual) va en el subtítulo.
  const y = parseDate(date).getFullYear();
  const sub = y === parseDate(today).getFullYear() ? rel : `${rel} · ${y}`;
  root.replaceChildren(header({ title: dayTitle(date), subtitle: sub, back: `#/calendar?week=${ws}` }), content);

  function render() {
    const ctx = ctxFromStore(today);
    const st = dayStatus(date, ctx);
    content.replaceChildren(
      planSection(date, st, ctx),
      statusSection(st),
      sessionsSection(date, st, ctx),
      actionsSection(date, st, today),
      planningSection(date, st, ctx));
  }
  render();

  // Tras cambiar el día (o deshacer) se vuelve a pintar; varias escrituras seguidas → un solo pintado.
  let queued = false;
  const off = store.on('change', (e) => {
    if ((e.store !== 'plan' && e.store !== 'sessions') || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  });
  return off;
}

/** «Miércoles 23 sep». */
function dayTitle(date) {
  const d = parseDate(date);
  return cap(`${DAY_LONG[dow(date)]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`);
}

function planSection(date, st, ctx) {
  const eff = st.plan;
  const box = h('section.card.cal-plan', { dataset: { kind: eff.kind } },
    h('div.today-kicker', 'Plan del día'),
    h('div.today-plan-title', h('span.today-plan-emoji', { 'aria-hidden': 'true' }, planEmoji(eff)), h('h2.today-plan-name', eff.label)),
    eff.substituted
      ? h('div.cal-changed', h('span.badge.badge-info', 'Cambiado'), ` Semana tipo: ${planLabel(eff.patternDay, ctx.templates)}`)
      : null);
  if (eff.kind === 'template' && eff.template) box.appendChild(templatePreview(eff.template, { max: 5 }));
  if (eff.missing) box.appendChild(h('p.small.text-2', 'La rutina de este día ya no existe. Puedes cambiar el día por otra rutina.'));
  return box;
}

function statusSection(st) {
  return h('section.card.cal-state',
    h('div.row-between',
      h('div.today-kicker', 'Estado'),
      h('span.small.muted', st.manual ? 'Marcado a mano' : 'Automático')),
    h('div.cal-state-pill', statusPill(st.status, { manual: st.manual })),
    h('p.small.text-2', st.manual ? `Sin marca manual sería: ${STATUS_LABEL[st.auto]}.` : st.reason));
}

function sessionsSection(date, st, ctx) {
  const opts = summaryOpts();
  const wrap = h('section.cal-sessions', h('h2.section-title', 'Sesiones'));
  if (st.sessions.length) wrap.appendChild(h('div.list', st.sessions.map((s) => sessionRow(s, opts))));
  else wrap.appendChild(h('p.small.muted.cal-empty', 'Sin sesiones registradas para este día.'));
  // Sesiones con esta fecha que cuentan para otro día del plan.
  const others = ctx.sessions.filter((s) => s.date === date && !s.parentId && s.status === 'done' && (s.planDate ?? s.date) !== date);
  if (others.length) {
    wrap.appendChild(h('div.list.cal-others', others.map((s) => sessionRow(s, opts, { note: `Cuenta para el ${fmtDate(s.planDate)}` }))));
  }
  return wrap;
}

function actionsSection(date, st, today) {
  const eff = st.plan;
  const box = h('section.stack-sm.cal-actions');
  if (date > today) {
    box.appendChild(h('p.small.muted', 'Podrás registrar sesiones de este día cuando llegue.'));
    return box;
  }
  const past = date < today;
  const active = store.activeSession();
  let primary = null;
  // Solo actividades sueltas que cubren parte de la rutina (la carrera del Día 3): la rutina se puede registrar.
  const looseOnly = st.sessions.length && st.status === 'partial' && !st.manual && eff.kind === 'template' && eff.template
    && !st.sessions.some((s) => s.kind === 'strength' && s.templateId === eff.templateId);
  if (!st.sessions.length || looseOnly) {
    if (eff.kind === 'template' && eff.template) {
      primary = !past && active
        ? { label: 'Continuar sesión en curso', onClick: () => navigate(`#/session/${active.id}`) }
        : { label: past ? 'Registrar sesión de fuerza' : 'Empezar', onClick: () => startStrength({ templateId: eff.templateId, date, planDate: date, past }) };
    } else if (eff.kind === 'template') {
      primary = { label: 'Elegir rutina', onClick: () => pickAndStart({ date, planDate: date, past }) };
    } else if (eff.kind === 'free' && eff.activityKind === 'strength') {
      primary = { label: past ? 'Registrar fuerza libre' : 'Empezar fuerza libre', onClick: () => startStrength({ templateId: null, date, planDate: date, past }) };
    } else if (eff.kind === 'free') {
      primary = { label: freeActionLabel(eff.label), onClick: () => navigate(activityHref(eff.activityKind, date, date, freeSubtype(eff))) };
    } else {
      primary = { label: 'Entrenar igualmente', onClick: () => pickAndStart({ date, planDate: date, past, title: '¿Qué entrenaste?' }) };
    }
  }
  if (primary) box.appendChild(h('button.btn.btn-primary.btn-lg.btn-block.cal-primary', { type: 'button', onClick: primary.onClick }, primary.label));
  box.appendChild(h('button.btn.btn-secondary.btn-block', {
    type: 'button',
    onClick: () => otherSessionMenu({ date, planDate: date, past, title: st.sessions.length ? 'Registrar otra sesión' : 'Registrar otra cosa' }),
  }, icon('plus', 20), st.sessions.length ? 'Registrar otra sesión' : 'Registrar otra cosa…'));
  return box;
}

function planningSection(date, st, ctx) {
  const eff = st.plan;
  const row = (ic, title, sub, onClick, cls = '') => h(`button.list-item${cls}`, { type: 'button', onClick },
    icon(ic, 22, 'muted'),
    h('span.list-item-main', h('span.list-item-title', title), sub ? h('span.list-item-sub', sub) : null),
    icon('chevron-right', 20, 'chev'));
  return h('section.cal-planning',
    h('h2.section-title', 'Cambiar este día'),
    h('div.list',
      row('edit', 'Cambiar este día por…', 'Otra rutina, descanso o sesión libre', () => changeDay(date), '.cal-act-change'),
      row('swap', 'Mover a otro día…', 'Intercambia el plan con otro día de esta semana', () => moveDay(date, ctx), '.cal-act-move'),
      row('check', 'Marcar como…', st.manual ? `Ahora: ${STATUS_LABEL[st.status]} (a mano)` : `Ahora: ${STATUS_LABEL[st.status]} (automático)`, () => markDay(date, st), '.cal-act-mark'),
      eff.source === 'override'
        ? row('refresh', 'Restaurar semana tipo', `Volver a: ${planLabel(eff.patternDay, ctx.templates)}`, () => restoreDay(date, eff, ctx), '.cal-act-reset')
        : null),
    h('p.small.muted.cal-scope', SCOPE_NOTE),
    h('button.cal-link-btn', { type: 'button', onClick: () => navigate('#/settings/week') }, 'Editar semana tipo', icon('chevron-right', 18)));
}

// ---------------------------------------------------------------------------
// Acciones del día (todas con «Deshacer»)
// ---------------------------------------------------------------------------
/**
 * Tras cambiar el plan (se hace desde la parte baja de la vista), vuelve arriba: el plan nuevo y su
 * acción principal («Registrar ruta en bici») quedarían si no ocultos bajo la cabecera.
 */
function showTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function changeDay(date) {
  const choice = await pickTemplate({ title: 'Cambiar este día por…', includeRest: true, includeFree: true });
  if (!choice) return;
  const undo = planSnapshot(date);
  await overrideDay(date, choice);
  showTop();
  undoToast(`Día cambiado a «${planLabel(choice, store.all('templates'))}». Tu semana tipo no cambia.`, undo);
}

function moveDay(date, ctx) {
  const others = weekDates(weekStart(date)).filter((d) => d !== date);
  const days = new Map(weekPlan(weekStart(date), ctx).map((d) => [d.date, d]));
  const s = sheet({
    title: 'Mover a otro día',
    body: h('div.stack-sm',
      h('p.sheet-msg', 'Se intercambian los planes de los dos días. Tu semana tipo no cambia.'),
      h('div.pick-list.cal-move-list', others.map((d) => {
        const info = days.get(d);
        return h('button.pick-row.cal-move-row', {
          type: 'button',
          dataset: { date: d },
          onClick: async () => {
            s.close();
            const undo = planSnapshot(date, d);
            await swapDays(date, d);
            showTop();
            undoToast(`Intercambiado con el ${fmtDate(d)}.`, undo);
          },
        }, h('span.pick-name', cap(fmtDate(d))), h('span.pick-meta', `${planEmoji(info.plan)} ${info.plan.label} · ${STATUS_LABEL[info.status]}`));
      }))),
  });
}

function markDay(date, st) {
  const opt = (status, label) => ({
    label,
    hint: st.manual && st.status === status ? 'actual' : '',
    onClick: async () => {
      const undo = planSnapshot(date);
      await setManualStatus(date, status);
      showTop();
      undoToast(status ? `Marcado como ${STATUS_LABEL[status]}.` : 'Estado automático.', undo);
    },
  });
  actionSheet({
    title: 'Marcar como…',
    actions: [
      ...MANUAL_STATUSES.map((s) => opt(s, cap(STATUS_LABEL[s]))),
      { ...opt(null, `Automático (${STATUS_LABEL[st.auto]})`), hint: st.manual ? '' : 'actual' },
    ],
  });
}

async function restoreDay(date, eff, ctx) {
  const undo = planSnapshot(date);
  await resetDay(date);
  showTop();
  undoToast(`Día restaurado: ${planLabel(eff.patternDay, ctx.templates)}.`, undo);
}
