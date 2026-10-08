// today.js — pantalla «Hoy»: aviso de copia, sesión en curso, lo que toca hoy (1 toque para
// empezar), accesos rápidos, peso corporal y mini semana; (Fase 3) el check-in de hoy, «Lo importante esta semana»
// (panel semanal + analista en una tarjeta, views/focus.js) y los objetivos. Ronda 5: tras «Te toca hoy», la tarjeta
// del ciclo (modo mujer, views/cycle.js) y «Completa tu perfil (30 s)». Ronda 6: «Ahora: …» (tu contexto) y el
// próximo evento deportivo. Pulido (docs/PULIDO.md §8): el orden se adapta al momento del día (ver mountToday).
// PROPIETARIO: módulo de calendario (el hueco .today-extra lo rellena la integración de la Fase 3).
import * as store from '../store.js';
import { navigate, refresh } from '../router.js';
import { h, icon, screen } from '../ui.js';
import { todayStr, fmtDate, fmtDuration, addDays, diffDays, weekStart, parseDate, DAY_LETTER } from '../util.js';
import {
  ctxFromStore, dayStatus, weekPlan, effectiveDay, adherence, adherenceText, planEmoji, planLabel, STATUS_LABEL, hasWeekPattern,
} from '../plan.js';
import {
  cap, statusPill, sessionRow, summaryOpts, templatePreview, startStrength, pickAndStart, otherSessionMenu,
  activityMenu, activityHref, freeActionLabel, freeSubtype,
} from '../plan-ui.js';
import { bodyweightQuickEntry } from './bodyweight.js';
import { setProgress } from '../calc.js';
import { getProfile, profileIncomplete, cycleEnabled, isNewProfile } from '../profile.js';
import { currentLabel } from '../context-logic.js';
import { nextRelevant, todayLine, raceTitle, raceShortLabel, targetText } from '../races-logic.js';

/** Un evento a 14 días o menos pasa de línea a tarjeta, justo debajo de «Te toca hoy». */
const RACE_NEAR_DAYS = 14;

const QUICK = [
  { kind: 'run', emoji: '🏃', label: 'Carrera' },
  { kind: 'bike', emoji: '🚴', label: 'Bici' },
  { kind: 'swim', emoji: '🏊', label: 'Natación' },
  { kind: 'hike', emoji: '🥾', label: 'Senderismo' },
  { kind: 'other', emoji: '⚡', label: 'Otra' },
  { kind: 'strength', emoji: '🏋️', label: 'Fuerza libre' },
];

export async function mountToday(root) {
  const today = todayStr();
  const ctx = ctxFromStore(today);
  const content = screen(root, { title: 'Hoy', subtitle: cap(fmtDate(today, 'long')) });
  content.classList.add('today');
  const timers = [];

  // Orden adaptativo (docs/PULIDO.md §8): lo que toca hacer ahora, arriba; lo demás, después.
  //  · Sesión abierta → «Continuar» manda (y «Te toca hoy» no la repite debajo).
  //  · Antes de entrenar → «Te toca hoy» con «Empezar»; «Lo importante esta semana» y el check-in, al final.
  //  · Hecho o descanso → no queda nada que empezar: «Lo importante esta semana» sube por encima de «Registrar».
  //  · Evento en las próximas 2 semanas → tarjeta justo debajo de «Te toca hoy»; más lejos, una línea.
  if (store.backupOverdue()) content.appendChild(backupBanner());
  const active = store.activeSession();
  const st = dayStatus(today, ctx);
  const live = !!active && (active.planDate ?? active.date) === today && !st.sessions.length && !st.manual;
  if (active) content.appendChild(activeCard(active, timers, live ? st.plan : null));
  if (!live) content.appendChild(planCard(today, ctx, active, st));
  const race = nextRelevant(store.all('races'), today);
  const raceNear = race && diffDays(today, race.date) <= RACE_NEAR_DAYS;
  if (raceNear) content.appendChild(raceCard(race, today));
  // Ronda 5, tras «Te toca hoy» (no lo empujan): el ciclo (se carga aparte) y la invitación a completar el perfil.
  const profile = getProfile(store.settings());
  const cycleSlot = cycleEnabled(profile) ? h('div.today-cycle-slot') : null;
  if (cycleSlot) content.appendChild(cycleSlot);
  if (profileIncomplete(profile) && !profile.promptDismissed) content.appendChild(profilePrompt(isNewProfile(profile)));
  // Ronda 6: una sola línea con la fase vigente de «Tu contexto» (nada si no hay ninguna).
  const ctxNow = currentLabel(store.all('context'), today);
  if (ctxNow) {
    content.appendChild(h('button.cal-link-btn.today-context', { type: 'button', onClick: () => navigate('#/context') },
      h('span.today-context-text', h('span.today-context-kicker', 'Ahora: '), ctxNow), icon('chevron-right', 18)));
  }
  // Ronda 6 (fase E): como mucho una línea con el próximo evento deportivo relevante («🏁 10K · 73 días · objetivo <50:00»).
  if (race && !raceNear) content.appendChild(raceLine(race, today));

  // Fase 3 (check-in, «Lo importante esta semana» y objetivos): se rellena después del montaje.
  const extra = h('div.today-extra');
  // Nada que empezar: hecho, saltado, descanso o la rutina de hoy ya terminada (aunque quede «parcial»)
  const ownDone = st.plan.kind === 'template' && st.sessions.some((s) => s.kind === 'strength' && s.status === 'done' && s.templateId === st.plan.templateId);
  // Sin semana planificada (ronda 8, B2) no es un descanso: «Empezar sesión libre» sigue mandando.
  const restDay = st.plan.kind === 'rest' && !st.sessions.length && !unplanned(ctx, st);
  const settled = !active && (st.status === 'done' || st.status === 'skipped' || ownDone || restDay);
  if (settled) content.appendChild(extra);
  content.appendChild(h('h2.section-title', 'Registrar'));
  content.appendChild(quickGrid(today));
  content.appendChild(h('button.cal-link-btn.today-import', { type: 'button', onClick: () => navigate('#/import') },
    'Importar desde un archivo', icon('chevron-right', 18)));
  content.appendChild(bodyweightQuickEntry({}));
  content.appendChild(weekCard(today, ctx));
  // Antes de entrenar, al final: no empuja «Te toca hoy» ni «Empezar».
  if (!settled) content.appendChild(extra);

  // Si la app se queda abierta y cambia el día, se vuelve a montar al volver.
  const onVisible = () => { if (document.visibilityState === 'visible' && todayStr() !== today) refresh({ keepScroll: false }); };
  document.addEventListener('visibilitychange', onVisible);
  const cleanup = () => {
    timers.forEach(clearInterval);
    document.removeEventListener('visibilitychange', onVisible);
  };
  // Lo principal ya está pintado; los módulos de la Fase 3 se cargan después (el router espera a que termine
  // para restaurar el scroll).
  await Promise.all([fillExtra(extra, today, active), cycleSlot ? fillCycle(cycleSlot, today) : null]);
  return cleanup;
}

// ---------------------------------------------------------------------------
// Fase 3: check-in de hoy, resumen del panel semanal y objetivos
// ---------------------------------------------------------------------------
let extraModules = null;
let focusModule = null;
let cycleModule = null;
/** «Lo importante esta semana» (usa el análisis) se carga aparte: si falla, el check-in y los objetivos siguen. */
function loadFocusModule() {
  if (!focusModule) focusModule = import('./focus.js').catch((err) => { focusModule = null; throw err; });
  return focusModule;
}
/** Tarjeta del ciclo (views/cycle.js), solo en modo mujer con seguimiento. Aislada: Hoy nunca se rompe por ella. */
function loadCycleModule() {
  if (!cycleModule) cycleModule = import('./cycle.js').catch((err) => { cycleModule = null; throw err; });
  return cycleModule;
}
async function fillCycle(slot, today) {
  try {
    const mod = await loadCycleModule();
    if (!slot.isConnected || typeof mod.cycleTodayCard !== 'function') return;
    const el = mod.cycleTodayCard({ today });
    if (el) slot.replaceWith(el);
    else slot.remove();
  } catch (err) {
    console.error('[hoy] ciclo', err);
    slot.remove();
  }
}
/** Se importan al usarse (no retrasan la primera pintura de Hoy) y una sola vez. */
function loadExtraModules() {
  if (!extraModules) {
    extraModules = Promise.all([import('../checkin.js'), import('./weekly.js'), import('./goals.js')])
      .catch((err) => { extraModules = null; throw err; });
  }
  return extraModules;
}

/** Un fallo en una tarjeta de la Fase 3 no puede dejar Hoy sin su botón «Empezar»: se aísla cada una. */
function safely(label, fn) {
  try {
    return fn();
  } catch (err) {
    console.error(`[hoy] ${label}`, err);
    return null;
  }
}

/** Cede el hilo: la pantalla se pinta y atiende toques entre tarjeta y tarjeta. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Rellena el hueco y lo marca con data-ready="1" al terminar (haya tarjetas o no). Cada tarjeta se calcula en su
 * propia tarea (con meses de datos, todas juntas bloqueaban la pantalla casi un segundo al abrir la app).
 */
async function fillExtra(slot, today, active) {
  const [mods, focus] = await Promise.all([
    loadExtraModules().catch((err) => { console.error('[hoy] módulos de la Fase 3', err); return null; }),
    loadFocusModule().catch((err) => { console.error('[hoy] módulo de «Lo importante»', err); return null; }),
  ]);
  await nextTask(); // lo principal de Hoy se pinta antes de calcular nada
  if (mods && slot.isConnected) { // si se cambió de pantalla mientras cargaban, no se calcula nada
    const [ci, weekly, goals] = mods;
    const data = safely('datos', () => weekly.weeklyData(today)); // un único `data` para todas las tarjetas
    // Una sola tarjeta de lectura («Lo importante esta semana» junta el panel semanal y el analista)
    // «Lo importante» junta dos cálculos (panel semanal y analista): cada uno en su tarea, como cuando eran dos
    // tarjetas (juntos, con años de datos, bloqueaban la pantalla medio segundo)
    let weeklyR = null;
    const cards = [
      () => todayCheckin(ci, today, active),
      data && focus ? () => { weeklyR = focus.focusWeekly(data); return null; } : null,
      data && focus ? () => focus.focusCard({ data, today, weekly: weeklyR }) : null,
      data ? () => goals.goalsSummaryCard({ data }) : null,
    ];
    const labels = ['check-in', 'panel semanal', 'lo importante', 'objetivos'];
    for (let i = 0; i < cards.length; i++) {
      if (!slot.isConnected) break;
      if (!cards[i]) continue;
      const el = safely(labels[i], cards[i]);
      if (el) slot.append(el);
      if (i < cards.length - 1) await nextTask();
    }
  }
  slot.dataset.ready = '1';
}

/**
 * Check-in de hoy (antes de entrenar), con las tres filas a la vista (3 toques). Solo si hoy no se ha hecho
 * ninguno (ni antes ni después) ni se ha omitido, y si hoy no hay ya una sesión de fuerza terminada (su
 * pantalla ya lo ofreció antes y después). Con una sesión de fuerza de hoy en curso, se enlaza a ella.
 */
function todayCheckin(ci, today, active) {
  const all = store.all('checkins');
  if (ci.TIMINGS.some((t) => ci.hasValues(ci.checkinFor(all, today, t)))) return null;
  const sessionId = active && active.date === today ? active.id : null;
  if (ci.TIMINGS.some((t) => ci.isDismissed({ date: today, timing: t, sessionId }))) return null;
  const trained = store.all('sessions').some((s) => s.kind === 'strength' && s.status === 'done' && s.date === today);
  if (trained) return null;
  const el = ci.checkinCard({ date: today, timing: 'pre', sessionId, compact: true });
  if (el) el.classList.add('card', 'today-checkin');
  return el;
}

/**
 * «Completa tu perfil (30 s)» → la bienvenida (#/welcome) con el perfil vacío, o #/settings/profile si ya hay algo;
 * «Ahora no» la descarta para siempre (profile.promptDismissed).
 */
function profilePrompt(isNew = false) {
  const card = h('section.card.today-profile.an-prompt', { dataset: { card: 'profile' } },
    h('div.an-prompt-top',
      h('span.an-card-icon', { 'aria-hidden': 'true' }, icon('sliders', 20)),
      h('div.an-prompt-texts',
        h('h2.an-prompt-title', 'Completa tu perfil (30 s)'),
        h('p.an-prompt-text', 'Sexo, objetivo y experiencia: tu análisis usará tus rangos y te hablará a tu medida.'))),
    h('div.an-prompt-actions',
      h('button.btn.btn-secondary.an-prompt-go', { type: 'button', onClick: () => navigate(isNew ? '#/welcome' : '#/settings/profile') }, 'Completar'),
      h('button.btn.btn-ghost.an-prompt-later', {
        type: 'button',
        onClick: () => {
          const s = store.settings();
          s.profile = { ...getProfile(s), promptDismissed: true };
          store.save('meta', s);
          card.remove();
        },
      }, 'Ahora no')));
  return card;
}

/** Próximo evento deportivo (races-logic.nextRelevant) → su ficha. Una línea, como «Ahora: …». */
function raceLine(race, today) {
  const line = todayLine(race, today);
  return h('button.cal-link-btn.today-race', {
    type: 'button',
    dataset: { race: race.id },
    'aria-label': `Próximo evento: ${raceTitle(race)}, ${fmtDate(race.date, 'long')}. ${line}`,
    onClick: () => navigate(`#/races/${encodeURIComponent(race.id)}`),
  }, h('span.today-race-text', h('span.today-race-emoji', { 'aria-hidden': 'true' }, '🏁 '), line), icon('chevron-right', 18));
}

/** Aviso de copia de seguridad pendiente → Ajustes › Datos. Compacto: no debe empujar «Empezar». */
function backupBanner() {
  const last = store.settings()?.lastBackupAt;
  const days = last ? Math.max(0, Math.floor((Date.now() - last) / 86400000)) : null;
  const title = days == null
    ? 'Sin copia de seguridad'
    : `Última copia: hace ${days} ${days === 1 ? 'día' : 'días'}`;
  return h('button.banner.banner-warn.today-backup', {
    type: 'button',
    'aria-label': `${title}. Tus datos solo están en este iPhone. Toca para exportar una copia.`,
    onClick: () => navigate('#/settings/data'),
  },
  icon('alert', 20, 'warn'),
  h('span.banner-main',
    h('span.banner-title', title),
    h('span.banner-text', 'Toca para exportar una copia')),
  icon('chevron-right', 20, 'chev'));
}

/**
 * Tarjeta de la sesión en curso: manda en Hoy. Nombre, cronómetro, cuántas series llevas y, si cuenta para hoy en
 * lugar de lo planificado, qué sustituye. `plan`: el plan de hoy si la sesión cuenta para hoy (si no, null).
 */
function activeCard(s, timers, plan = null) {
  const clock = h('span.today-clock.tnum');
  const tick = () => { clock.textContent = s.startedAt ? fmtDuration((Date.now() - s.startedAt) / 1000) : fmtDate(s.date); };
  tick();
  if (s.startedAt) timers.push(setInterval(tick, 1000));
  const { done, total } = setProgress(s); // la misma cuenta que la barra de la sesión
  const progress = total ? `${done} de ${total} series` : null;
  const instead = plan && plan.kind !== 'rest' && plan.label && (plan.kind !== 'template' || plan.templateId !== s.templateId) ? `En lugar de ${plan.label}` : null;
  const when = (s.planDate ?? s.date) !== todayStr() ? `Del ${fmtDate(s.planDate ?? s.date)}` : null;
  const sub = [progress, instead, when].filter(Boolean).join(' · ');
  return h('button.card.card-accent.today-active', { type: 'button', dataset: { live: plan ? '1' : '' }, onClick: () => navigate(`#/session/${s.id}`) },
    h('span.today-active-top', h('span.today-kicker', 'Sesión en curso'), clock),
    h('span.today-active-name', s.templateName || 'Sesión'),
    sub ? h('span.today-active-sub', sub) : null,
    h('span.btn.btn-primary.btn-lg.btn-block', icon('play', 20), 'Continuar'));
}

/** Próximo evento en las próximas 2 semanas: una tarjeta (cuanto más cerca, más visible). Más lejos, raceLine. */
function raceCard(race, today) {
  const n = diffDays(today, race.date);
  const when = n === 0 ? 'Hoy' : n === 1 ? 'Mañana' : `En ${n} días`;
  const tgt = targetText(race);
  return h('button.card.today-race-card', {
    type: 'button',
    dataset: { race: race.id },
    'aria-label': `Próximo evento: ${raceTitle(race)}, ${fmtDate(race.date, 'long')}. ${when}${tgt ? `, objetivo ${tgt}` : ''}`,
    onClick: () => navigate(`#/races/${encodeURIComponent(race.id)}`),
  },
  h('span.today-race-flag', { 'aria-hidden': 'true' }, '🏁'),
  h('span.today-race-main',
    h('span.today-kicker', 'Próximo evento'),
    h('span.today-race-title', `${raceShortLabel(race)} · ${when}`),
    h('span.today-race-sub', [cap(fmtDate(race.date, 'long')), tgt ? `objetivo ${tgt}` : null].filter(Boolean).join(' · '))),
  icon('chevron-right', 20, 'chev'));
}

/**
 * «Te toca hoy»: plan efectivo con su acción principal (o lo ya hecho). Con una sesión en curso que cuenta para hoy
 * no se pinta: la tarjeta de la sesión (arriba) ya dice qué es y lleva «Continuar».
 */
function planCard(today, ctx, active, st = dayStatus(today, ctx)) {
  if (unplanned(ctx, st)) return freeCard(today, active, st);
  const eff = st.plan;
  const liveToday = !!active && (active.planDate ?? active.date) === today;
  let pill = statusPill(st.status, { manual: st.manual });
  // En un descanso normal la píldora «Descanso» repetiría el título.
  if (eff.kind === 'rest' && st.status === 'rest' && !st.manual) pill = null;
  const card = h('section.card.today-plan', { dataset: { kind: eff.kind, status: st.status } },
    h('div.today-plan-top', h('span.today-kicker', 'Te toca hoy'), pill),
    h('div.today-plan-title',
      h('span.today-plan-emoji', { 'aria-hidden': 'true' }, planEmoji(eff)),
      h('h2.today-plan-name', eff.label)),
    eff.substituted
      ? h('div.cal-changed', h('span.badge.badge-info', 'Cambiado'), ` Semana tipo: ${planLabel(eff.patternDay, ctx.templates)}`)
      : null);

  const startBtn = (label, onClick, withIcon = true) => h('button.btn.btn-primary.btn-lg.btn-block.today-start', { type: 'button', onClick },
    withIcon ? icon('play', 20) : null, label);
  // Con una sesión en curso de otro día no se puede empezar otra: se dice, sin repetir «Continuar».
  const busy = () => h('p.small.text-2.today-busy', 'Termina la sesión en curso (arriba) para empezar otra.');
  const canStartPlan = eff.kind === 'template' && !eff.missing;
  const startPlan = () => startStrength({ templateId: eff.templateId, date: today, planDate: today });

  // Ya hay sesiones que cuentan para hoy: estado + resumen + «Otra sesión».
  if (st.sessions.length) {
    const opts = summaryOpts();
    // Parcial solo con actividades sueltas (la carrera del Día 3): la rutina aún se puede empezar.
    const ownDone = st.sessions.some((s) => s.kind === 'strength' && s.templateId === eff.templateId);
    const offerStart = canStartPlan && st.status === 'partial' && !st.manual && !ownDone && !liveToday;
    // Element.append(null) escribiría el texto «null»: se filtran los huecos vacíos.
    card.append(...[
      st.status === 'done' && !st.extra ? null : h('p.small.text-2', st.reason),
      h('div.list.today-sessions', st.sessions.map((s) => sessionRow(s, opts))),
      offerStart ? (active ? busy() : startBtn('Empezar la rutina', startPlan)) : null,
      h('button.btn.btn-secondary.btn-lg.btn-block', { type: 'button', onClick: () => otherSessionMenu({ date: today }) }, icon('plus', 20), 'Otra sesión'),
    ].filter(Boolean));
    card.append(dayLink(today));
    return card;
  }

  if (canStartPlan) {
    // «Empezar» justo debajo del título (a la vista aunque haya aviso de copia); después, la vista previa.
    // En pantallas bajas (iPhone SE) la vista previa es más corta.
    const short = typeof matchMedia === 'function' && matchMedia('(max-height: 700px)').matches;
    card.append(
      active ? busy() : startBtn('Empezar', startPlan),
      templatePreview(eff.template, { max: short ? 3 : 6 }));
  } else if (eff.kind === 'template') {
    card.append(
      h('p.text-2', 'La rutina de este día ya no existe. Elige otra para hoy o cambia tu semana tipo.'),
      active ? busy() : startBtn('Elegir rutina', () => pickAndStart({ date: today }), false),
      h('button.btn.btn-ghost.btn-block', { type: 'button', onClick: () => navigate('#/settings/week') }, 'Editar semana tipo'));
  } else if (eff.kind === 'free') {
    if (eff.activityKind === 'strength') {
      card.append(active ? busy() : startBtn('Empezar fuerza libre', () => startStrength({ templateId: null, date: today, planDate: today })));
    } else {
      card.append(startBtn(freeActionLabel(eff.label), () => navigate(activityHref(eff.activityKind, today, today, freeSubtype(eff))), false));
    }
  } else {
    card.append(
      h('p.text-2', 'Hoy toca descansar. Si entrenas, contará como entreno extra.'),
      h('div.stack-sm.today-rest-actions',
        active ? busy() : h('button.btn.btn-secondary.btn-block', { type: 'button', onClick: () => pickAndStart({ date: today, title: '¿Qué vas a entrenar?' }) }, icon('dumbbell', 20), 'Entrenar igualmente'),
        h('button.btn.btn-secondary.btn-block', { type: 'button', onClick: () => activityMenu({ date: today }) }, icon('plus', 20), 'Registrar actividad')));
  }
  card.append(dayLink(today));
  return card;
}

/**
 * ¿Hoy no hay nada planificado porque no hay semana tipo? (perfil nuevo que saltó «Tu semana», ronda 8 B2). Un
 * cambio de ese día en el calendario o un estado marcado a mano sí cuentan como plan.
 */
function unplanned(ctx, st) {
  return !hasWeekPattern(ctx.settings) && st.plan.source === 'pattern' && !st.manual;
}

/**
 * Hoy sin semana planificada: en lugar de «Te toca hoy» (que diría «Descanso» sin que nadie lo haya decidido),
 * «Empezar sesión libre» (la acción principal), elegir una rutina y el acceso para planificar la semana.
 */
function freeCard(today, active, st) {
  const done = st.sessions.length > 0;
  const card = h('section.card.today-plan.today-free', { dataset: { kind: 'none', status: st.status } },
    h('div.today-plan-top', h('span.today-kicker', 'Sin semana planificada')),
    h('div.today-plan-title', h('h2.today-plan-name', done ? 'Hoy has entrenado' : '¿Qué entrenas hoy?')));
  const busy = h('p.small.text-2.today-busy', 'Termina la sesión en curso (arriba) para empezar otra.');
  if (done) {
    card.append(
      h('div.list.today-sessions', st.sessions.map((s) => sessionRow(s, summaryOpts()))),
      h('button.btn.btn-secondary.btn-lg.btn-block', { type: 'button', onClick: () => otherSessionMenu({ date: today }) }, icon('plus', 20), 'Otra sesión'));
  } else {
    card.append(...[
      active ? busy : h('button.btn.btn-primary.btn-lg.btn-block.today-start', { type: 'button', onClick: () => startStrength({ templateId: null, date: today }) },
        icon('play', 20), 'Empezar sesión libre'),
      !active && store.templatesList().length
        ? h('button.btn.btn-secondary.btn-block.today-pick', { type: 'button', onClick: () => pickAndStart({ date: today, title: '¿Qué rutina vas a hacer?' }) }, icon('dumbbell', 20), 'Elegir una rutina')
        : null,
    ].filter(Boolean));
  }
  card.append(h('button.cal-link-btn.today-plan-week', { type: 'button', onClick: () => navigate('#/settings/week') },
    'Planificar tu semana', icon('chevron-right', 18)));
  return card;
}

function dayLink(date) {
  return h('button.cal-link-btn', { type: 'button', onClick: () => navigate(`#/day/${date}`) },
    'Cambiar, mover o marcar este día', icon('chevron-right', 18));
}

/**
 * Accesos rápidos: actividades de hoy y fuerza libre. Son seis: van en 3 × 2 (.act-quick-grid, en
 * css/activity.css) para que cada botón sea ancho y «Senderismo» quepa entero.
 */
function quickGrid(today) {
  return h('div.today-quick.act-quick-grid', QUICK.map((q) => h('button.today-quick-btn', {
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
  // Sin semana planificada, «Mañana: 😴 Descanso» sería un plan que nadie ha decidido (salvo un cambio de ese día).
  const showTomorrow = hasWeekPattern(ctx.settings) || t.source === 'override';
  return h('section.card.today-weekcard',
    h('div.card-head',
      h('div.card-title', 'Esta semana'),
      h('button.cal-link-btn', { type: 'button', onClick: () => navigate(`#/calendar?week=${ws}`) }, 'Calendario', icon('chevron-right', 18))),
    strip,
    h('p.small.text-2.today-adherence', adherenceText(adherence(ws, ctx))),
    showTomorrow ? h('button.list-item.today-tomorrow', { type: 'button', onClick: () => navigate(`#/day/${tomorrow}`) },
      h('span.list-item-main',
        h('span.list-item-sub', 'Mañana'),
        h('span.list-item-title', `${planEmoji(t)} ${t.label}`)),
      icon('chevron-right', 20, 'chev')) : null);
}
