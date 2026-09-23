// today.js — pantalla «Hoy»: aviso de copia, sesión en curso, lo que toca hoy (1 toque para
// empezar), accesos rápidos, peso corporal y mini semana.
// PROPIETARIO: módulo de calendario.
import * as store from '../store.js';
import { navigate, refresh } from '../router.js';
import { h, icon, screen } from '../ui.js';
import { todayStr, fmtDate, fmtDuration, addDays, weekStart, parseDate, DAY_LETTER } from '../util.js';
import {
  ctxFromStore, dayStatus, weekPlan, effectiveDay, adherence, adherenceText, planEmoji, planLabel, STATUS_LABEL,
} from '../plan.js';
import {
  cap, statusPill, sessionRow, summaryOpts, templatePreview, startStrength, pickAndStart, otherSessionMenu,
  activityMenu, activityHref, freeActionLabel,
} from '../plan-ui.js';
import { bodyweightQuickEntry } from './bodyweight.js';

const QUICK = [
  { kind: 'run', emoji: '🏃', label: 'Carrera' },
  { kind: 'bike', emoji: '🚴', label: 'Bici' },
  { kind: 'swim', emoji: '🏊', label: 'Natación' },
  { kind: 'other', emoji: '⚡', label: 'Otra' },
  { kind: 'strength', emoji: '🏋️', label: 'Fuerza libre' },
];

export function mountToday(root) {
  const today = todayStr();
  const ctx = ctxFromStore(today);
  const content = screen(root, { title: 'Hoy', subtitle: cap(fmtDate(today, 'long')) });
  content.classList.add('today');
  const timers = [];

  if (store.backupOverdue()) content.appendChild(backupBanner());
  const active = store.activeSession();
  if (active) content.appendChild(activeCard(active, timers));
  content.appendChild(planCard(today, ctx, active));

  content.appendChild(h('h2.section-title', 'Registrar'));
  content.appendChild(quickGrid(today));
  content.appendChild(bodyweightQuickEntry({}));
  content.appendChild(weekCard(today, ctx));
  // Hueco para el panel semanal / objetivos (fase 3).
  content.appendChild(h('div.today-extra'));

  // Si la app se queda abierta y cambia el día, se vuelve a montar al volver.
  const onVisible = () => { if (document.visibilityState === 'visible' && todayStr() !== today) refresh({ keepScroll: false }); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    timers.forEach(clearInterval);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Aviso de copia de seguridad pendiente → Ajustes › Datos. */
function backupBanner() {
  const last = store.settings()?.lastBackupAt;
  const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86400000)) : null;
  const title = days == null
    ? 'Aún no has hecho ninguna copia'
    : `Tu última copia es de hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return h('button.banner.banner-warn.today-backup', { type: 'button', onClick: () => navigate('#/settings/data') },
    icon('alert', 22, 'warn'),
    h('span.banner-main',
      h('span.banner-title', title),
      h('span.banner-text', 'Tus datos solo están en este iPhone. Toca para exportar una copia.')),
    icon('chevron-right', 20, 'chev'));
}

/** Tarjeta destacada de la sesión en curso con su cronómetro. */
function activeCard(s, timers) {
  const clock = h('span.today-clock.tnum');
  const tick = () => { clock.textContent = s.startedAt ? fmtDuration((Date.now() - s.startedAt) / 1000) : fmtDate(s.date); };
  tick();
  if (s.startedAt) timers.push(setInterval(tick, 1000));
  return h('button.card.card-accent.today-active', { type: 'button', onClick: () => navigate(`#/session/${s.id}`) },
    h('span.today-active-title', 'Sesión en curso: ', h('b', s.templateName || 'Sesión'), ' · ', clock),
    h('span.btn.btn-primary.btn-lg.btn-block', icon('play', 20), 'Continuar'));
}

/** «Te toca hoy»: plan efectivo con su acción principal (o lo ya hecho). */
function planCard(today, ctx, active) {
  const st = dayStatus(today, ctx);
  const eff = st.plan;
  const card = h('section.card.today-plan', { dataset: { kind: eff.kind, status: st.status } },
    h('div.today-plan-top',
      h('span.today-kicker', 'Te toca hoy'),
      // En un descanso normal la píldora «Descanso» repetiría el título.
      eff.kind === 'rest' && st.status === 'rest' && !st.manual ? null : statusPill(st.status, { manual: st.manual })),
    h('div.today-plan-title',
      h('span.today-plan-emoji', { 'aria-hidden': 'true' }, planEmoji(eff)),
      h('h2.today-plan-name', eff.label)),
    eff.substituted
      ? h('div.cal-changed', h('span.badge.badge-info', 'Cambiado'), ` Semana tipo: ${planLabel(eff.patternDay, ctx.templates)}`)
      : null);

  // Ya hay sesiones que cuentan para hoy: estado + resumen + «Otra sesión».
  if (st.sessions.length) {
    const opts = summaryOpts();
    card.append(
      st.status === 'done' && !st.extra ? null : h('p.small.text-2', st.reason),
      h('div.list.today-sessions', st.sessions.map((s) => sessionRow(s, opts))),
      h('button.btn.btn-secondary.btn-lg.btn-block', { type: 'button', onClick: () => otherSessionMenu({ date: today }) }, icon('plus', 20), 'Otra sesión'));
    card.append(dayLink(today));
    return card;
  }

  const continueBtn = () => h('button.btn.btn-primary.btn-lg.btn-block.today-start', {
    type: 'button', onClick: () => navigate(`#/session/${active.id}`),
  }, icon('play', 20), 'Continuar sesión en curso');

  if (eff.kind === 'template' && !eff.missing) {
    card.append(templatePreview(eff.template, { max: 6 }));
    card.append(active ? continueBtn() : h('button.btn.btn-primary.btn-lg.btn-block.today-start', {
      type: 'button',
      onClick: () => startStrength({ templateId: eff.templateId, date: today, planDate: today }),
    }, icon('play', 20), 'Empezar'));
  } else if (eff.kind === 'template') {
    card.append(
      h('p.text-2', 'La rutina de este día ya no existe. Elige otra para hoy o cambia tu semana tipo.'),
      active ? continueBtn() : h('button.btn.btn-primary.btn-lg.btn-block.today-start', {
        type: 'button', onClick: () => pickAndStart({ date: today }),
      }, 'Elegir rutina'),
      h('button.btn.btn-ghost.btn-block', { type: 'button', onClick: () => navigate('#/settings/week') }, 'Editar semana tipo'));
  } else if (eff.kind === 'free') {
    if (eff.activityKind === 'strength') {
      card.append(active ? continueBtn() : h('button.btn.btn-primary.btn-lg.btn-block.today-start', {
        type: 'button', onClick: () => startStrength({ templateId: null, date: today, planDate: today }),
      }, icon('play', 20), 'Empezar fuerza libre'));
    } else {
      card.append(h('button.btn.btn-primary.btn-lg.btn-block.today-start', {
        type: 'button', onClick: () => navigate(activityHref(eff.activityKind, today, today)),
      }, freeActionLabel(eff.label)));
    }
  } else {
    card.append(
      h('p.text-2', 'Hoy toca descansar. Si entrenas, contará como entreno extra.'),
      h('div.stack-sm.today-rest-actions',
        active ? continueBtn() : h('button.btn.btn-secondary.btn-block', { type: 'button', onClick: () => pickAndStart({ date: today, title: '¿Qué vas a entrenar?' }) }, icon('dumbbell', 20), 'Entrenar igualmente'),
        h('button.btn.btn-secondary.btn-block', { type: 'button', onClick: () => activityMenu({ date: today }) }, icon('plus', 20), 'Registrar actividad')));
  }
  card.append(dayLink(today));
  return card;
}

function dayLink(date) {
  return h('button.cal-link-btn', { type: 'button', onClick: () => navigate(`#/day/${date}`) },
    'Cambiar, mover o marcar este día', icon('chevron-right', 18));
}

/** Accesos rápidos: actividades de hoy y fuerza libre. */
function quickGrid(today) {
  return h('div.today-quick', QUICK.map((q) => h('button.today-quick-btn', {
    type: 'button',
    dataset: { kind: q.kind },
    onClick: () => (q.kind === 'strength'
      ? startStrength({ templateId: null, date: today })
      : navigate(activityHref(q.kind, today, null))),
  }, h('span.today-quick-emoji', { 'aria-hidden': 'true' }, q.emoji), h('span.today-quick-label', q.label))));
}

/** Mini semana (7 días con su estado) + adherencia + «Mañana: …». */
function weekCard(today, ctx) {
  const ws = weekStart(today);
  const days = weekPlan(ws, ctx);
  const strip = h('div.today-week', days.map((d, i) => h('button.today-week-day', {
    type: 'button',
    class: d.date === today ? 'is-today' : '',
    dataset: { date: d.date, status: d.status },
    'aria-label': `${fmtDate(d.date, 'long')}: ${d.plan.label}, ${STATUS_LABEL[d.status]}`,
    onClick: () => navigate(`#/day/${d.date}`),
  },
  h('span.today-week-letter', DAY_LETTER[i]),
  h('span.today-week-num.tnum', String(parseDate(d.date).getDate())),
  h(`span.cal-dot.st-${d.status}`))));
  const tomorrow = addDays(today, 1);
  const t = effectiveDay(tomorrow, ctx);
  return h('section.card.today-weekcard',
    h('div.card-head',
      h('div.card-title', 'Esta semana'),
      h('button.cal-link-btn', { type: 'button', onClick: () => navigate(`#/calendar?week=${ws}`) }, 'Calendario', icon('chevron-right', 18))),
    strip,
    h('p.small.text-2.today-adherence', adherenceText(adherence(ws, ctx))),
    h('button.list-item.today-tomorrow', { type: 'button', onClick: () => navigate(`#/day/${tomorrow}`) },
      h('span.list-item-main',
        h('span.list-item-sub', 'Mañana'),
        h('span.list-item-title', `${planEmoji(t)} ${t.label}`)),
      icon('chevron-right', 20, 'chev')));
}
