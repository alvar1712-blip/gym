// context.js — «Tu contexto» (ronda 6, docs/MEJORAS6.md): línea temporal de fases (periodos) y hechos (puntuales),
// también de antes de usar la app y con fecha aproximada, para que el análisis interprete bien los datos.
//   #/context        lista: lo vigente arriba y el historial (lo más reciente primero)
//   #/context/new    nuevo (?kind=phase|event&type=…)
//   #/context/:id    editar / borrar (con deshacer)
// La lógica (tipos, fechas aproximadas, validación) está en ../context-logic.js.
import * as store from '../store.js';
import { navigate, screenToken, backFrom } from '../router.js';
import { h, icon, screen, segmented, chips, textInput, numInput, durationInput, confirmDialog, undoToast, emptyState } from '../ui.js';
import { uid, todayStr, fmtNum, parseNum } from '../util.js';
import * as C from '../context-logic.js';
import { paceWarning } from '../activity-logic.js';
import { approxInput } from '../approx-input.js';
import { SPORTS } from '../profile.js';

const FALLBACK = '#/settings';
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ===========================================================================
// #/context
// ===========================================================================

export function mountContext(root) {
  const c = screen(root, {
    title: 'Tu contexto',
    subtitle: 'Fases y hechos que explican tus datos',
    back: FALLBACK,
    actions: [{ icon: 'plus', label: 'Añadir', onClick: () => navigate('#/context/new?kind=phase') }],
  });
  c.classList.add('ctx');
  render();
  // Se vuelve a pintar si cambia el almacén (p. ej. «Deshacer» tras borrar devuelve el registro a la lista al momento)
  let queued = false;
  return store.on('change', (e) => {
    if (e.store !== 'context' || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  });

  function render() {
    const today = todayStr();
    const list = C.timeline(store.all('context'));
    const parts = [h('p.ctx-intro', 'Lo que está pasando (o pasó antes de usar la app) para que el análisis no interprete igual un cambio de peso en una vuelta tras un parón que en una fase estable. Solo está en este iPhone.')];
    const now = C.contextOn(list, today).phases;
    parts.push(h('section.card.ctx-now', { dataset: { block: 'now' } },
      h('h2.card-title', 'Ahora'),
      now.length
        ? h('div.list.ctx-list', now.map((e) => entryRow(e, today)))
        : h('p.ctx-none', 'Sin ninguna fase marcada ahora (p. ej. «Vuelta tras un parón», «Déficit», «Preparación 10K»).'),
      h('div.ctx-add',
        h('button.btn.btn-secondary.ctx-add-phase', { type: 'button', onClick: () => navigate('#/context/new?kind=phase') }, icon('plus', 20), 'Añadir fase'),
        h('button.btn.btn-secondary.ctx-add-event', { type: 'button', onClick: () => navigate('#/context/new?kind=event') }, icon('plus', 20), 'Añadir hecho'))));
    if (!list.length) {
      parts.push(h('section.card.ctx-empty', emptyState({
        emoji: '🧭',
        title: 'Aún no hay nada en tu línea temporal',
        text: 'Por ejemplo: «Peso habitual: 75 kg», «Verano 2026: entrenamiento irregular», «Agosto 2026: bajé a 72,7 kg», «Septiembre 2026: vuelta al gimnasio», «Empiezo creatina», «Mayo 2026: 10 km en 1:00:00». Vale con fecha aproximada (mes, estación o año).',
      })));
    } else {
      parts.push(h('h2.section-title', 'Historial'), h('div.list.ctx-list.ctx-timeline', list.map((e) => entryRow(e, today))));
    }
    c.replaceChildren(...parts);
  }
}

function entryRow(e, today) {
  const live = C.phaseActiveOn(e, today);
  return h('button.list-item.ctx-row', {
    type: 'button',
    dataset: { id: e.id, kind: e.kind, type: e.type },
    onClick: () => navigate(`#/context/${encodeURIComponent(e.id)}`),
  },
  h('span.list-item-main',
    h('span.ctx-when-line',
      h('span.ctx-when', cap(C.entryWhen(e))),
      h(live ? 'span.badge.badge-accent.ctx-badge' : 'span.badge.ctx-badge', live ? 'Ahora' : e.kind === 'phase' ? 'Fase' : 'Hecho')),
    h('span.list-item-title.wrap', C.entryLine(e)),
    C.isRaceResult(e) && resultDetails(e) ? h('span.list-item-sub.wrap.ctx-result-sub', resultDetails(e)) : null,
    e.notes ? h('span.list-item-sub.wrap.ctx-notes', e.notes) : null),
  icon('chevron-right', 20, 'chev'));
}

/** «6:00/km · Carrera oficial · Trail · +350 m» de un resultado de carrera. */
function resultDetails(e) {
  const r = e.result;
  if (!r) return '';
  const bits = [C.resultPace(r)];
  if (r.effort) bits.push(C.RESULT_EFFORTS.find((x) => x.id === r.effort)?.label);
  if (r.surface) bits.push(C.RESULT_SURFACES.find((x) => x.id === r.surface)?.label);
  if (r.elevationM != null) bits.push(`+${fmtNum(r.elevationM, 0)} m`);
  return bits.filter(Boolean).join(' · ');
}

// ===========================================================================
// #/context/new · #/context/:id
// ===========================================================================

export function mountContextEdit(root, params = {}) {
  const today = todayStr();
  const editing = params.id ? C.normalizeEntry(store.get('context', params.id)) : null;
  if (params.id && !editing) {
    const c = screen(root, { title: 'Contexto', back: '#/context' });
    c.appendChild(emptyState({ emoji: '🔍', title: 'No encontrado', text: 'Puede que se haya borrado.', action: { label: 'Ver tu contexto', onClick: () => navigate('#/context', { replace: true }) } }));
    return undefined;
  }
  const kind0 = editing?.kind || (params.kind === 'event' ? 'event' : 'phase');
  const draft = editing ? { ...editing } : {
    kind: kind0,
    type: (kind0 === 'event' ? C.eventType(params.type) : C.phaseType(params.type))?.id || null,
    start: { date: today.slice(0, 8) + '01', precision: 'month' },
    end: null,
    date: { date: today, precision: 'day' },
    text: '', notes: '', kg: null, sports: [], goalIds: [],
  };
  if (draft.kind === 'event' && !draft.date) draft.date = { date: today, precision: 'day' };
  // Resultado de carrera: los números en draft.result (distancia, tiempo y detalles opcionales)
  draft.result = { km: null, sec: null, effort: null, elevationM: null, surface: null, ...(draft.result || {}) };
  let distChoice = C.RESULT_DISTANCES.find((x) => Math.abs(x.km - draft.result.km) < 0.001)?.id ?? (draft.result.km != null ? 'custom' : null);
  let moreOpen = !!(draft.result.effort || draft.result.surface || draft.result.elevationM != null);

  const c = screen(root, { title: editing ? 'Editar contexto' : 'Añadir contexto', back: '#/context' });
  c.classList.add('ctx', 'ctx-edit');
  const form = h('div.ctx-form');
  c.appendChild(form);
  const errEls = {};
  const errEl = (key) => (errEls[key] = h('p.form-error', { hidden: true, role: 'alert', dataset: { err: key } }));

  function paint() {
    Object.keys(errEls).forEach((k) => delete errEls[k]);
    const isPhase = draft.kind === 'phase';
    const blocks = [];
    if (!editing) {
      blocks.push(h('section.card.ctx-block', { dataset: { block: 'kind' } },
        segmented({
          options: [{ value: 'phase', label: 'Fase' }, { value: 'event', label: 'Hecho' }],
          value: draft.kind, ariaLabel: 'Clase',
          onChange: (v) => { if (v !== draft.kind) { draft.kind = v; draft.type = null; paint(); } },
        }),
        h('p.cfg-why', isPhase
          ? 'Un periodo con inicio y, si ya terminó, fin: «Verano 2026: parón», «Desde septiembre: vuelta al gimnasio».'
          : 'Algo puntual: «Empiezo creatina», «Peso habitual: 75 kg», «28 ago: 72,7 kg», «Mayo 2026: 10 km en 1:00:00».')));
    }
    const types = isPhase ? C.PHASE_TYPES : C.EVENT_TYPES;
    blocks.push(h('section.card.ctx-block', { dataset: { block: 'type' } },
      h('h2.card-title', isPhase ? 'Tipo de fase' : '¿Qué pasó?'),
      chips({
        options: types.map((t) => ({ value: t.id, label: t.label })), value: draft.type, className: 'ctx-types',
        onChange: (v) => { draft.type = v; paint(); },
      }),
      errEl('type')));

    if (isPhase) {
      const ongoing = draft.end == null;
      blocks.push(h('section.card.ctx-block', { dataset: { block: 'dates' } },
        h('h2.card-title', 'Cuándo'),
        approxInput({ label: 'Desde', value: draft.start, today, key: 'start', onChange: (v) => { draft.start = v; } }),
        errEl('start'),
        h('label.switch-row.ctx-switch', { dataset: { switch: 'ongoing' } },
          h('span.cfg-switch-texts', h('span.cfg-switch-title', 'Sigue ahora'), h('span.cfg-switch-sub', 'Apágalo si ya terminó')),
          h('span.switch', h('input', {
            type: 'checkbox', checked: ongoing, 'aria-label': 'Sigue ahora',
            onChange: (ev) => { draft.end = ev.target.checked ? null : { ...(draft.start || { date: today, precision: 'month' }) }; paint(); },
          }), h('span'))),
        ongoing ? null : approxInput({ label: 'Hasta', value: draft.end, today, key: 'end', onChange: (v) => { draft.end = v; } }),
        errEl('end')));
    } else {
      if (C.isRaceResult(draft)) blocks.push(resultBlock());
      blocks.push(h('section.card.ctx-block', { dataset: { block: 'dates' } },
        h('h2.card-title', 'Cuándo'),
        approxInput({ label: 'Fecha', value: draft.date, today, key: 'date', onChange: (v) => { draft.date = v; } }),
        errEl('date')));
      if (C.eventType(draft.type)?.kg) {
        const kg = numInput({ value: draft.kg, decimals: 1, suffix: 'kg', ariaLabel: 'Peso', onInput: (v) => { draft.kg = v; } });
        blocks.push(h('section.card.ctx-block', { dataset: { block: 'kg' } },
          h('h2.card-title', 'Peso'), kg, errEl('kg'),
          h('p.cfg-why', draft.type === 'usual_weight'
            ? 'Tu peso de referencia antes de este periodo (aproximado vale).'
            : 'Lo que pesabas en esa fecha.')));
      }
    }

    const needsText = draft.type === 'custom' || draft.type === 'other';
    const race = C.isRaceResult(draft);
    blocks.push(h('section.card.ctx-block', { dataset: { block: 'text' } },
      race
        ? h('label.field', h('span.field-label', 'Nombre de la carrera (opcional)'),
          textInput({ value: draft.text, maxlength: 200, placeholder: 'p. ej. San Silvestre', ariaLabel: 'Nombre de la carrera', onInput: (v) => { draft.text = v; } }))
        : h('label.field', h('span.field-label', needsText ? 'Descripción' : 'Descripción (opcional)'),
          textInput({ value: draft.text, maxlength: 200, placeholder: isPhase ? 'p. ej. Entrenamiento irregular y pérdida de peso' : 'p. ej. 3 g al día', ariaLabel: 'Descripción', onInput: (v) => { draft.text = v; } })),
      errEl('text'),
      isPhase ? h('div.field', h('span.field-label', 'Deportes prioritarios (opcional)'),
        chips({ options: SPORTS.map((s) => ({ value: s.id, label: s.label })), value: draft.sports, multi: true, className: 'ctx-sports', onChange: (v) => { draft.sports = v; } })) : null,
      isPhase ? goalsField() : null,
      h('label.field', h('span.field-label', race ? 'Nota (opcional)' : 'Observaciones (opcional)'),
        textInput({ value: draft.notes, multiline: true, rows: 3, maxlength: 2000, ariaLabel: race ? 'Nota' : 'Observaciones', onInput: (v) => { draft.notes = v; } }))));
    if (race) blocks.push(moreBlock());

    blocks.push(h('div.ctx-actions',
      h('button.btn.btn-primary.btn-lg.btn-block.ctx-save', { type: 'button', onClick: onSave }, editing ? 'Guardar cambios' : 'Guardar'),
      editing ? h('button.btn.btn-danger-ghost.btn-block.ctx-delete', { type: 'button', onClick: onDelete }, icon('trash', 20), 'Borrar') : null));
    form.replaceChildren(...blocks);
  }

  /** Distancia (rápida u otra en km), tiempo (el mismo control de duración de toda la app) y el ritmo en vivo. */
  function resultBlock() {
    const r = draft.result;
    const paceHint = h('span.field-hint.ctx-result-pace', { 'aria-live': 'polite' });
    const updatePace = () => {
      const warn = paceWarning({ kind: 'run', movingSec: r.sec, distanceKm: r.km });
      const pace = r.km > 0 && r.sec > 0 ? C.resultPace(r) : null;
      paceHint.textContent = warn || (pace ? `Ritmo: ${pace}` : '');
      paceHint.hidden = !paceHint.textContent;
      paceHint.classList.toggle('warn', !!warn);
    };
    const custom = numInput({ value: distChoice === 'custom' ? r.km : null, decimals: 2, suffix: 'km', placeholder: 'p. ej. 7,5', ariaLabel: 'Distancia (km)', onInput: (v) => { r.km = v; updatePace(); } });
    const customWrap = h('div.ctx-result-custom', { hidden: distChoice !== 'custom' }, custom);
    const dist = chips({
      options: [...C.RESULT_DISTANCES.map((x) => ({ value: x.id, label: x.label })), { value: 'custom', label: 'Otra' }],
      value: distChoice, className: 'ctx-result-dist',
      onChange: (v) => {
        distChoice = v;
        customWrap.hidden = v !== 'custom';
        r.km = v === 'custom' ? parseNum(custom.input.value) : C.RESULT_DISTANCES.find((x) => x.id === v)?.km ?? null;
        if (v === 'custom') setTimeout(() => custom.input.focus(), 0);
        updatePace();
      },
    });
    const time = durationInput({ seconds: r.sec, showHours: true, showSeconds: true, ariaLabel: 'Tiempo', onChange: (sec) => { r.sec = sec; updatePace(); } });
    updatePace();
    return h('section.card.ctx-block.ctx-result', { dataset: { block: 'result' } },
      h('h2.card-title', 'Carrera'),
      h('div.field', h('span.field-label', 'Distancia'), dist, customWrap),
      errEl('km'),
      h('div.field', h('span.field-label', 'Tiempo'), time, paceHint),
      errEl('sec'),
      h('p.cfg-why', 'Algo que ya corriste (para una carrera futura, «Eventos deportivos»). Los tiempos previstos lo usan como referencia: tu historial importa, pero tu estado reciente importa más.'));
  }

  /** Detalles opcionales del resultado, plegados para que apuntar una marca sea rápido. */
  function moreBlock() {
    const r = draft.result;
    const body = h('div.ctx-more-body', { hidden: !moreOpen, id: 'ctx-more-body' },
      h('div.field', h('span.field-label', 'Tipo'),
        chips({ options: C.RESULT_EFFORTS.map((x) => ({ value: x.id, label: x.label })), value: r.effort, allowNone: true, className: 'ctx-result-effort', onChange: (v) => { r.effort = v; } })),
      h('label.field', h('span.field-label', 'Desnivel positivo'),
        numInput({ value: r.elevationM, decimals: 0, inputmode: 'numeric', suffix: 'm', placeholder: 'p. ej. 120', ariaLabel: 'Desnivel positivo (m)', onInput: (v) => { r.elevationM = v; } })),
      errEl('elevationM'),
      h('div.field', h('span.field-label', 'Superficie'),
        chips({ options: C.RESULT_SURFACES.map((x) => ({ value: x.id, label: x.label })), value: r.surface, allowNone: true, className: 'ctx-result-surface', onChange: (v) => { r.surface = v; } })));
    const btn = h('button.why-btn.ctx-more-btn', {
      type: 'button', 'aria-expanded': String(moreOpen), 'aria-controls': 'ctx-more-body',
      onClick: () => { moreOpen = !moreOpen; body.hidden = !moreOpen; btn.setAttribute('aria-expanded', String(moreOpen)); },
    }, icon('chevron-down', 16), h('span', 'Más detalles (opcional)'));
    return h('section.card.ctx-block', { dataset: { block: 'more' } }, btn, body);
  }

  function goalsField() {
    const goals = store.all('goals').filter((g) => !g.archived);
    if (!goals.length) return null;
    return h('div.field', h('span.field-label', 'Objetivos relacionados (opcional)'),
      chips({ options: goals.map((g) => ({ value: g.id, label: g.title || 'Objetivo' })), value: draft.goalIds, multi: true, className: 'ctx-goals', onChange: (v) => { draft.goalIds = v; } }));
  }

  async function onSave() {
    const err = C.validateEntry(draft);
    for (const [k, el] of Object.entries(errEls)) {
      el.hidden = !err[k];
      el.textContent = err[k] || '';
    }
    if (Object.keys(err).length) {
      form.querySelector('.form-error:not([hidden])')?.scrollIntoView({ block: 'center' });
      return;
    }
    const rec = C.entryRecord(draft, { id: editing?.id || uid('ctx_') });
    const tok = screenToken();
    await store.save('context', rec);
    backFrom(tok, '#/context');
  }

  async function onDelete() {
    const ok = await confirmDialog({ title: '¿Borrar de tu contexto?', message: `«${C.entryLine(editing)}» (${C.entryWhen(editing)}).`, confirmText: 'Borrar', danger: true });
    if (!ok) return;
    const tok = screenToken();
    const removed = await store.remove('context', editing.id);
    backFrom(tok, '#/context');
    undoToast('Borrado de tu contexto', () => { if (removed) store.restore('context', removed); });
  }

  paint();
  return undefined;
}
