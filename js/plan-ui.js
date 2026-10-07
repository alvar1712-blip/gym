// plan-ui.js — piezas de interfaz compartidas por Hoy, Calendario, Día e Historial.
// PROPIETARIO: módulo de calendario.
import * as store from './store.js';
import { navigate } from './router.js';
import { h, icon, confirmDialog, actionSheet, toast } from './ui.js';
import { todayStr, fmtDate } from './util.js';
import { makeBodyweightFn } from './calc.js';
import * as sessionLogic from './session-logic.js';
import { pickTemplate } from './pickers.js';
import { STATUS_LABEL } from './plan.js';
import { sessionSummary } from './history-logic.js';
import { subtypeFromNotes } from './activity-logic.js';

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Píldora de estado («● Hecho parcialmente · a mano»). */
export function statusPill(status, { manual = false } = {}) {
  return h(`span.status.status-${status}.cal-status`, { dataset: { status } },
    cap(STATUS_LABEL[status] || status),
    manual ? h('span.cal-manual', ' · a mano') : null);
}

/** Datos para calcular volúmenes en los resúmenes (constrúyelo una vez por render). */
export function summaryOpts() {
  return {
    sessions: store.all('sessions'), // actividades enlazadas (duración total de una sesión de fuerza)
    exMap: new Map(store.all('exercises').map((e) => [e.id, e])),
    bwFn: makeBodyweightFn(store.bodyweightList(), store.settings()?.bodyweightDefault ?? 75),
  };
}

/** Fila de sesión (emoji, nombre, fecha/duración/carga y dato clave) → abre la sesión. */
export function sessionRow(s, opts, { showDate = false, note = '' } = {}) {
  const sum = sessionSummary(s, opts);
  // En curso: la insignia va en la línea de detalle (no dentro del título, donde el «…» la escondía) y sin repetir
  // «en curso» en texto. El nombre de la rutina ocupa hasta dos líneas en vez de cortarse.
  const sub = [showDate ? fmtDate(s.date) : null, sum.active ? null : sum.duration, sum.load].filter(Boolean).join(' · ');
  const live = sum.active ? h('span.badge.badge-accent.cal-live-badge', 'En curso') : null;
  return h('button.list-item.cal-ses-row', { type: 'button', dataset: { id: s.id, kind: s.kind }, onClick: () => navigate(sum.href) },
    h(`span.cal-emoji.cal-emoji-${s.kind}`, { 'aria-hidden': 'true' }, sum.emoji),
    h('span.list-item-main',
      h('span.list-item-title.lines-2', sum.title),
      sub || live ? h('span.list-item-sub', sub, live) : null,
      sum.key ? h('span.cal-ses-key.tnum', sum.key) : null,
      note ? h('span.cal-ses-note', note) : null),
    icon('chevron-right', 20, 'chev'));
}

/** Texto del objetivo de un ítem («3×4–6»); lo da el módulo de sesión (si faltase, «N series»). */
function itemTarget(it, logType) {
  if (typeof sessionLogic.targetText === 'function') return sessionLogic.targetText(it, logType);
  return it.sets ? `${it.sets} ${it.sets === 1 ? 'serie' : 'series'}` : '';
}

/** Lista breve de ejercicios de una plantilla con su objetivo («Press banca · 3×4–6»). */
export function templatePreview(tpl, { max = 6 } = {}) {
  const items = (tpl && tpl.items) || [];
  if (!items.length) return h('p.muted.small', 'Esta rutina no tiene ejercicios.');
  const rows = items.map((it) => {
    const ex = store.exercise(it.exerciseId);
    const alt = (it.alternatives || []).length ? h('span.cal-tpl-alt', ` o ${(it.alternatives || []).map((a) => store.exercise(a)?.name || a).join(' / ')}`) : null;
    return h('li.cal-tpl-item',
      h('span.cal-tpl-name', ex ? ex.name : it.exerciseId, alt),
      h('span.cal-tpl-target.tnum', itemTarget(it, ex?.logType)));
  });
  const list = h('ul.cal-tpl-list', rows.slice(0, max));
  if (items.length <= max) return list;
  const more = h('button.cal-tpl-more', {
    type: 'button',
    onClick: () => { list.replaceChildren(...rows); more.remove(); },
  }, `Ver los ${items.length} ejercicios`, icon('chevron-down', 18));
  return h('div.cal-tpl', list, more);
}

/** Enlace al formulario de actividad nueva con fecha, fecha de plan y, si se conoce, tipo de sesión. */
export function activityHref(kind, date, planDate = date, subtype = null) {
  const q = new URLSearchParams({ kind, date });
  if (planDate) q.set('planDate', planDate);
  if (subtype) q.set('subtype', subtype);
  return `#/activity/new?${q.toString()}`;
}

/** Tipo de sesión que sugiere el nombre de una sesión libre («Ruta en bici» → route), o null. */
export function freeSubtype(plan) {
  return plan && plan.kind === 'free' ? subtypeFromNotes(plan.activityKind, plan.label) : null;
}

/** «Registrar ruta en bici», «Registrar carrera»… */
export function freeActionLabel(label) {
  return `Registrar ${String(label || 'actividad').charAt(0).toLowerCase()}${String(label || 'actividad').slice(1)}`;
}

let starting = false;

/**
 * Crea una sesión de fuerza y la abre. Si ya hay una en curso, ofrece continuarla
 * (solo puede haber una activa). Evita el doble toque.
 */
export async function startStrength({ templateId = null, date = todayStr(), planDate = date, past = false } = {}) {
  if (starting) return null;
  const active = store.activeSession();
  if (active) {
    const ok = await confirmDialog({
      title: 'Ya hay una sesión en curso',
      message: `«${active.templateName || 'Sesión'}» sigue abierta. Termínala antes de empezar otra.`,
      confirmText: 'Continuar la sesión en curso',
    });
    if (ok) navigate(`#/session/${active.id}`);
    return null;
  }
  starting = true;
  try {
    const s = await sessionLogic.createStrengthSession({ templateId, date, planDate, past });
    navigate(`#/session/${s.id}`);
    return s;
  } catch (err) {
    console.error(err);
    toast(`No se pudo crear la sesión: ${err?.message || err}`, { kind: 'error' });
    return null;
  } finally {
    starting = false;
  }
}

/** Elige rutina y empieza (o registra, si es pasada) una sesión de fuerza. */
export async function pickAndStart({ date = todayStr(), planDate = date, past = false, title = 'Elegir rutina' } = {}) {
  const choice = await pickTemplate({ title });
  if (choice && choice.kind === 'template') await startStrength({ templateId: choice.templateId, date, planDate, past });
}

/** Menú «Otra sesión»: fuerza con rutina, fuerza libre o actividad, con fecha y fecha de plan. */
export function otherSessionMenu({ date = todayStr(), planDate = date, past = false, title = 'Registrar otra sesión' } = {}) {
  const act = (kind, label) => ({ label, onClick: () => navigate(activityHref(kind, date, planDate)) });
  actionSheet({
    title,
    actions: [
      { label: '🏋️ Fuerza con una rutina…', onClick: () => pickAndStart({ date, planDate, past }) },
      { label: '🏋️ Fuerza libre', onClick: () => startStrength({ templateId: null, date, planDate, past }) },
      act('run', '🏃 Carrera'),
      act('bike', '🚴 Bici'),
      act('swim', '🏊 Natación'),
      act('hike', '🥾 Senderismo'),
      act('other', '⚡ Otra actividad'),
    ],
  });
}

/** Menú de actividades (sin fuerza). */
export function activityMenu({ date = todayStr(), planDate = date, title = 'Registrar actividad' } = {}) {
  const act = (kind, label) => ({ label, onClick: () => navigate(activityHref(kind, date, planDate)) });
  actionSheet({
    title,
    actions: [act('run', '🏃 Carrera'), act('bike', '🚴 Bici'), act('swim', '🏊 Natación'), act('hike', '🥾 Senderismo'), act('other', '⚡ Otra actividad')],
  });
}
