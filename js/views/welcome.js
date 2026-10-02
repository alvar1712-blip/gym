// welcome.js — bienvenida para perfiles nuevos (ronda 6, docs/MEJORAS6.md): 3 pasos cortos y saltables.
//   1 · Tú: sexo y fecha de nacimiento
//   2 · Tu entrenamiento: objetivo, experiencia, deportes, días por semana y (opcional) otros objetivos
//   3 · Ahora mismo: la fase actual (crea una fase en «Tu contexto») y molestias o limitaciones
// Cada respuesta se guarda al momento en el perfil; «Listo» o «Saltar» en el último paso marcan profile.onboardedAt.
// Nunca se obliga: se llega desde la tarjeta «Completa tu perfil» de Hoy (solo con el perfil vacío).
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, screen, segmented, chips, textInput, toast } from '../ui.js';
import { uid, todayStr } from '../util.js';
import {
  getProfile, SEXES, GOALS, EXPERIENCES, SECONDARY_GOALS, SPORTS, ageOn, validBirthDate, isFemale,
} from '../profile.js';
import { entryRecord, phaseType } from '../context-logic.js';

const STEPS = 3;
/** Fases que se ofrecen en el paso 3 (la lista completa está en «Tu contexto»). */
const NOW_PHASES = ['gain', 'deficit', 'maintain', 'recomp', 'return', 'prep_5k', 'prep_10k', 'prep_half', 'prep_marathon', 'hybrid', 'injury'];

function saveProfile(patch, { soon = false } = {}) {
  const s = store.settings();
  s.profile = { ...getProfile(s), ...patch };
  return soon ? store.saveSoon('meta', s) : store.save('meta', s);
}

export function mountWelcome(root) {
  const today = todayStr();
  const c = screen(root, { title: 'Bienvenida', subtitle: 'Tres pasos cortos · todo es opcional', back: '#/today' });
  c.classList.add('wel');
  const body = h('div.wel-body');
  c.appendChild(body);
  let step = 1;
  let phase = null; // fase elegida en el paso 3 (se crea al terminar)
  let limitations = getProfile(store.settings()).limitations;

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

  function nav() {
    const last = step === STEPS;
    return h('div.wel-nav',
      h('button.btn.btn-primary.btn-lg.btn-block.wel-next', { type: 'button', onClick: () => (last ? finish() : go(step + 1)) },
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
    const title = ['Sobre ti', 'Tu entrenamiento', 'Ahora mismo'][step - 1];
    const content = step === 1 ? stepYou(p) : step === 2 ? stepTraining(p) : stepNow();
    body.replaceChildren(
      h('div.wel-progress', { role: 'progressbar', 'aria-valuemin': '1', 'aria-valuemax': String(STEPS), 'aria-valuenow': String(step), 'aria-label': `Paso ${step} de ${STEPS}` },
        Array.from({ length: STEPS }, (_, i) => h(`span.wel-dot${i < step ? '.on' : ''}`))),
      h('h2.wel-title', { dataset: { step: String(step) } }, `${step}. ${title}`),
      ...content,
      nav());
  }

  paint();
  return () => store.flush();
}
