// welcome.js — bienvenida para perfiles nuevos (ronda 6, docs/MEJORAS6.md): pasos cortos y saltables.
//   1 · Tú: sexo y fecha de nacimiento
//   2 · Tu entrenamiento: objetivo, experiencia, deportes, días por semana y (opcional) otros objetivos
//   3 · Tu semana (ronda 8, B2; solo si aún no hay semana tipo): qué días entrenas y, si quieres, qué rutina o
//       sesión libre cada día. Se guarda al pulsar «Siguiente»; «Saltar» deja la app sin planificación.
//   4 · Ahora mismo: la fase actual (crea una fase en «Tu contexto») y molestias o limitaciones
// Cada respuesta del perfil se guarda al momento; «Listo» o «Saltar» en el último paso marcan profile.onboardedAt.
// Nunca se obliga: se llega desde la tarjeta «Completa tu perfil» de Hoy (solo con el perfil vacío).
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, screen, segmented, chips, textInput, toast } from '../ui.js';
import { uid, todayStr, DAY_LONG, DAY_SHORT } from '../util.js';
import { cap } from '../plan-ui.js';
import {
  getProfile, SEXES, GOALS, EXPERIENCES, SECONDARY_GOALS, SPORTS, ageOn, validBirthDate, isFemale,
} from '../profile.js';
import { entryRecord, phaseType } from '../context-logic.js';
import { hasWeekPattern, setWeekPattern } from '../plan.js';
import { FREE_PLANS } from '../pickers.js';

const TITLES = { you: 'Sobre ti', training: 'Tu entrenamiento', week: 'Tu semana', now: 'Ahora mismo' };
/** Fases que se ofrecen en el paso 3 (la lista completa está en «Tu contexto»). */
const NOW_PHASES = ['gain', 'deficit', 'maintain', 'recomp', 'return', 'prep_5k', 'prep_10k', 'prep_half', 'prep_marathon', 'hybrid', 'injury'];

function saveProfile(patch, { soon = false } = {}) {
  const s = store.settings();
  s.profile = { ...getProfile(s), ...patch };
  return soon ? store.saveSoon('meta', s) : store.save('meta', s);
}

export function mountWelcome(root) {
  const today = todayStr();
  // «Tu semana» solo si aún no hay semana tipo: quien ya la tiene (datos antiguos, una copia restaurada o la que se
  // puso en Ajustes) no la ve y su semana no cambia.
  const steps = ['you', 'training', ...(hasWeekPattern(store.settings()) ? [] : ['week']), 'now'];
  const STEPS = steps.length;
  const c = screen(root, { title: 'Bienvenida', subtitle: `${STEPS === 4 ? 'Cuatro' : 'Tres'} pasos cortos · todo es opcional`, back: '#/today' });
  c.classList.add('wel');
  const body = h('div.wel-body');
  c.appendChild(body);
  let step = 1;
  let phase = null; // fase elegida en el paso 3 (se crea al terminar)
  let limitations = getProfile(store.settings()).limitations;
  // «Tu semana»: plan de cada día (índice 0 = lunes) o null = descanso. Se guarda al pulsar «Siguiente».
  const week = Array(7).fill(null);

  function finish() {
    const s = store.settings();
    s.profile = { ...getProfile(s), limitations: limitations.trim(), onboardedAt: Date.now() };
    store.save('meta', s);
    if (phase) {
      const rec = entryRecord({ kind: 'phase', type: phase, start: { date: `${today.slice(0, 8)}01`, precision: 'month' }, end: null }, { id: uid('ctx_') });
      store.save('context', rec);
    }
    toast('Perfil guardado. Puedes cambiarlo cuando quieras en Ajustes.', { kind: 'success' });
    navigate('#/today', { transition: 'pop' });
  }

  function go(n) {
    step = n;
    paint();
    window.scrollTo(0, 0);
  }

  /** Guarda la semana elegida (desde esta semana); sin ningún día, la deja sin planificar. */
  async function saveWeek() {
    if (week.some(Boolean)) await setWeekPattern(week.map((d) => d || { kind: 'rest' }));
    else if (hasWeekPattern(store.settings())) await store.saveSettings({ weekPatterns: [] });
  }

  let moving = false; // un doble toque mientras se guarda la semana no salta dos pasos
  async function next() {
    if (moving) return;
    moving = true;
    try {
      if (steps[step - 1] === 'week') await saveWeek();
      if (step === STEPS) finish(); else go(step + 1);
    } finally {
      moving = false;
    }
  }

  function nav() {
    const last = step === STEPS;
    return h('div.wel-nav',
      h('button.btn.btn-primary.btn-lg.btn-block.wel-next', { type: 'button', onClick: next },
        last ? 'Listo' : 'Siguiente', last ? null : icon('chevron-right', 20)),
      h('div.wel-nav-row',
        step > 1 ? h('button.btn.btn-ghost.wel-prev', { type: 'button', onClick: () => go(step - 1) }, 'Atrás') : h('span'),
        h('button.btn.btn-ghost.wel-skip', { type: 'button', onClick: () => (last ? finish() : go(step + 1)) }, last ? 'Saltar y terminar' : 'Saltar')));
  }

  function stepYou(p) {
    const age = ageOn(p.birthDate, today);
    const ageTxt = h('p.cfg-why.wel-age', age != null ? `Tienes ${age} años.` : 'Opcional. Sirve para adaptar los consejos a tu edad (por ejemplo, sin déficits agresivos en menores).');
    const err = h('p.form-error', { hidden: true, role: 'alert' });
    const date = h('input.input.wel-birth', { type: 'date', value: p.birthDate || '', max: today, 'aria-label': 'Fecha de nacimiento' });
    date.addEventListener('change', () => {
      const v = date.value || null;
      if (v && !validBirthDate(v, today)) { err.hidden = false; err.textContent = 'Revisa la fecha.'; return; }
      err.hidden = true;
      saveProfile({ birthDate: v });
      const a = ageOn(v, today);
      ageTxt.textContent = a != null ? `Tienes ${a} años.` : 'Opcional.';
    });
    return [
      h('section.card.wel-block', { dataset: { block: 'sex' } },
        h('h2.card-title', 'Sexo'),
        segmented({ options: SEXES.map((x) => ({ value: x.id, label: x.label })), value: p.sex, ariaLabel: 'Sexo', onChange: (v) => saveProfile({ sex: v }) }),
        h('p.cfg-why', 'Ajusta rangos y textos. Con «Mujer» se activa el seguimiento del ciclo (se puede apagar).')),
      h('section.card.wel-block', { dataset: { block: 'birth' } },
        h('h2.card-title', 'Fecha de nacimiento'), date, err, ageTxt),
    ];
  }

  function stepTraining(p) {
    const one = (name, list, value, key) => chips({
      options: list.map((x) => ({ value: x.id, label: x.label })), value, allowNone: true, className: `wel-${name}`,
      // El objetivo principal no se ofrece también como secundario: se repinta el paso.
      onChange: (v) => { saveProfile({ [key]: v }); if (key === 'goal') paint(); },
    });
    return [
      h('section.card.wel-block', { dataset: { block: 'goal' } }, h('h2.card-title', 'Objetivo principal'), one('goal', GOALS, p.goal, 'goal')),
      h('section.card.wel-block', { dataset: { block: 'experience' } },
        h('h2.card-title', 'Experiencia en fuerza'),
        one('experience', EXPERIENCES.map((x) => ({ id: x.id, label: isFemale(p) && x.id !== 'beginner' ? x.label.replace(/o$/, 'a') : x.label })), p.experience, 'experience')),
      h('section.card.wel-block', { dataset: { block: 'sports' } },
        h('h2.card-title', 'Qué practicas'),
        chips({ options: SPORTS.map((x) => ({ value: x.id, label: x.label })), value: p.sports, multi: true, className: 'wel-sports', onChange: (v) => saveProfile({ sports: v }) })),
      h('section.card.wel-block', { dataset: { block: 'frequency' } },
        h('h2.card-title', 'Días de entreno por semana'),
        chips({
          options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: String(n), className: 'chip-num' })), value: p.weeklyFrequency, allowNone: true, className: 'wel-frequency',
          onChange: (v) => saveProfile({ weeklyFrequency: v }),
        })),
      h('section.card.wel-block', { dataset: { block: 'secondary' } },
        h('h2.card-title', 'También quiero (opcional)'),
        chips({
          options: SECONDARY_GOALS.filter((x) => x.id !== p.goal).map((x) => ({ value: x.id, label: x.label })),
          value: p.secondaryGoals.filter((x) => x !== p.goal), multi: true, className: 'wel-secondary',
          onChange: (v) => saveProfile({ secondaryGoals: v }),
        })),
    ];
  }

  /** Sesión libre por defecto para un día nuevo: la del primer deporte que practica (Fuerza si no dijo ninguno). */
  function defaultFree(p) {
    const kind = (p.sports || []).find((k) => FREE_PLANS.some((f) => f.activityKind === k)) || 'strength';
    const f = FREE_PLANS.find((x) => x.activityKind === kind);
    return { kind: 'free', label: f.label, activityKind: f.activityKind };
  }
  const planKey = (d) => (d.kind === 'template' ? `tpl:${d.templateId}` : `free:${d.activityKind}`);
  function planFromKey(key) {
    const [k, id] = key.split(':');
    if (k === 'tpl') return { kind: 'template', templateId: id };
    const f = FREE_PLANS.find((x) => x.activityKind === id) || FREE_PLANS.find((x) => x.activityKind === 'strength');
    return { kind: 'free', label: f.label, activityKind: f.activityKind };
  }

  function stepWeek(p) {
    const templates = store.templatesList();
    const perDay = h('section.card.wel-block', { dataset: { block: 'week-plan' } });
    // Un selector por día de entreno: una rutina tuya o una sesión libre (como en Ajustes › Semana tipo).
    function paintDays() {
      const idx = week.map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
      perDay.hidden = !idx.length;
      perDay.replaceChildren(
        h('h2.card-title', 'Qué haces cada día (opcional)'),
        ...idx.map((i) => {
          const sel = h('select.input.wel-day-select', { 'aria-label': `${cap(DAY_LONG[i])}: qué entrenas`, dataset: { day: String(i) } },
            templates.length ? h('optgroup', { label: 'Tus rutinas' }, templates.map((t) => h('option', { value: `tpl:${t.id}` }, t.name))) : null,
            h('optgroup', { label: 'Sesión libre' }, FREE_PLANS.map((f) => h('option', { value: `free:${f.activityKind}` }, `${f.emoji} ${f.label}`))));
          sel.value = planKey(week[i]);
          sel.addEventListener('change', () => { week[i] = planFromKey(sel.value); });
          return h('label.wel-day-row', h('span.wel-day-name', cap(DAY_LONG[i])), sel);
        }),
        h('p.cfg-why', 'Puedes cambiarlo cuando quieras en Ajustes › Semana tipo o mover un día concreto en el Calendario.'));
    }
    paintDays();
    const freq = p.weeklyFrequency ? `Has dicho ${p.weeklyFrequency} ${p.weeklyFrequency === 1 ? 'día' : 'días'} por semana. ` : '';
    return [
      h('section.card.wel-block', { dataset: { block: 'week-days' } },
        h('h2.card-title', '¿Qué días sueles entrenar?'),
        chips({
          options: DAY_SHORT.map((d, i) => ({ value: i, label: cap(d) })),
          value: week.map((d, i) => (d ? i : -1)).filter((i) => i >= 0), multi: true, className: 'wel-days', ariaLabel: 'Días de entreno',
          onChange: (v) => {
            for (let i = 0; i < 7; i++) week[i] = v.includes(i) ? week[i] || defaultFree(getProfile(store.settings())) : null;
            paintDays();
          },
        }),
        h('p.cfg-why', `${freq}Los demás días quedan como descanso. Si prefieres no planificar, pulsa «Saltar»: Hoy te dejará empezar una sesión libre.`)),
      perDay,
    ];
  }

  function stepNow() {
    const lim = textInput({ value: limitations, multiline: true, rows: 3, maxlength: 500, placeholder: 'p. ej. Molestia en el hombro derecho al hacer press', ariaLabel: 'Molestias o limitaciones', onInput: (v) => { limitations = v; } });
    return [
      h('section.card.wel-block', { dataset: { block: 'phase' } },
        h('h2.card-title', '¿En qué momento estás?'),
        chips({
          options: [{ value: 'none', label: 'Nada en especial' }, ...NOW_PHASES.map((id) => ({ value: id, label: phaseType(id).label }))],
          value: phase || 'none', className: 'wel-phase',
          onChange: (v) => { phase = v === 'none' ? null : v; },
        }),
        h('p.cfg-why', 'Se guarda como fase actual en «Tu contexto», donde también puedes añadir lo de antes (un parón, el peso habitual, la creatina…), aunque sea con fecha aproximada.')),
      h('section.card.wel-block', { dataset: { block: 'limitations' } },
        h('h2.card-title', 'Molestias o limitaciones (opcional)'), lim),
    ];
  }

  function paint() {
    const p = getProfile(store.settings());
    const id = steps[step - 1];
    const title = TITLES[id];
    const content = id === 'you' ? stepYou(p) : id === 'training' ? stepTraining(p) : id === 'week' ? stepWeek(p) : stepNow();
    body.replaceChildren(
      h('div.wel-progress', { role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(STEPS), 'aria-valuenow': String(step), 'aria-label': `Paso ${step} de ${STEPS}` },
        Array.from({ length: STEPS }, (_, i) => h(`span.wel-dot${i < step ? '.on' : ''}`))),
      h('h2.wel-title', { dataset: { step: String(step), id } }, `${step}. ${title}`),
      ...content,
      nav());
  }

  paint();
  return () => store.flush();
}
