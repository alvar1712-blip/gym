// races.js — eventos deportivos (ronda 6, fase E; docs/MEJORAS6.md): carreras, marchas, rutas y triatlones apuntados.
//   #/races          próximos (y pasados, plegados), con el tiempo previsto de las carreras
//   #/races/new      nuevo
//   #/races/:id      editar / borrar (con deshacer), con «Cómo vas» (tiempo previsto y objetivo enlazado)
// La lógica (tipos, validación, el evento de Hoy, contexto del analista) está en ../races-logic.js y «Cómo vas» en
// ../races-progress.js. Sin planificador:
// apuntar un evento no cambia tu semana tipo.
import * as store from '../store.js';
import { navigate, back } from '../router.js';
import { h, icon, screen, segmented, chips, textInput, numInput, durationInput, confirmDialog, undoToast, emptyState, whyBox } from '../ui.js';
import { uid, todayStr, fmtDate, addDays } from '../util.js';
import * as R from '../races-logic.js';
import { racePrediction, linkedGoalProgress } from '../races-progress.js';
import { dataFromStore } from '../progress-ui.js';
import { fmtTimeWords } from '../goals-logic.js';

const LIST = '#/races';
const RACE_STORES = new Set(['races', 'sessions', 'goals']);
const VERDICT_CLASS = { probable: 'ok', ajustado: 'warn', hoy_no: 'danger', insuficiente: 'info', prevision: 'info' };

/** Línea del tiempo previsto bajo el evento (solo carreras a pie): «Objetivo <50:00 · previsto 48:30–51:10 · Ajustado». */
function predictionLine(p, race) {
  if (!p) return null;
  const tgt = R.targetText(race);
  const bits = [tgt ? `Objetivo ${tgt}` : null, p.range ? `previsto ${p.range}` : null].filter(Boolean);
  return h('span.list-item-sub.rc-row-pred', { dataset: { verdict: p.verdict } },
    bits.join(' · '), bits.length ? ' · ' : '', h(`b.rc-verdict.rc-verdict-${VERDICT_CLASS[p.verdict] || 'info'}`, p.label));
}

function raceRow(race, data, today) {
  const p = race.date >= today ? racePrediction(data, race, { today }) : null;
  return h('button.list-item.rc-row', { type: 'button', dataset: { id: race.id, type: race.type, priority: race.priority }, onClick: () => navigate(`${LIST}/${encodeURIComponent(race.id)}`) },
    h('span.rc-prio', { 'aria-label': `Prioridad ${race.priority}` }, race.priority),
    h('span.list-item-main',
      h('span.list-item-title.rc-row-title', R.raceTitle(race), race.name && R.fixedKm(race.type) != null ? h('span.rc-row-type', ` · ${R.typeInfo(race.type).label}`) : null),
      h('span.list-item-sub.rc-row-meta', R.rowMeta(race, today)),
      p ? predictionLine(p, race) : (!p && race.targetSec ? h('span.list-item-sub', `Objetivo ${R.targetText(race)}`) : null)),
    icon('chevron-right', 20, 'chev'));
}

// ===========================================================================
// #/races
// ===========================================================================

export function mountRaces(root) {
  const c = screen(root, {
    title: 'Eventos deportivos',
    subtitle: 'Carreras, marchas y rutas apuntadas',
    back: '#/goals',
    actions: [{ icon: 'plus', label: 'Añadir evento', onClick: () => navigate(`${LIST}/new`) }],
  });
  c.classList.add('rc');
  let showPast = false;
  render();
  let queued = false;
  const off = store.on('change', (e) => {
    if (!RACE_STORES.has(e.store) || queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; render(); });
  });
  return off;

  function render() {
    const today = todayStr();
    const { upcoming, past } = R.splitRaces(store.all('races'), today);
    if (!upcoming.length && !past.length) {
      c.replaceChildren(h('section.card.rc-empty', emptyState({
        emoji: '🏁',
        title: 'Sin eventos apuntados',
        text: 'Apunta tu próxima carrera, marcha o ruta: «10K el 13 de diciembre, objetivo menos de 50 min». Hoy te recordará cuánto falta y tu análisis lo tendrá en cuenta. No cambia tu plan.',
        action: { label: 'Añadir evento', onClick: () => navigate(`${LIST}/new`) },
      })));
      return;
    }
    const data = dataFromStore(today);
    const nodes = [h('p.rc-intro', 'Hoy muestra el próximo evento importante (A o B) y tu análisis los tiene en cuenta. No cambian tu plan: solo se apuntan.')];
    nodes.push(h('section.card.rc-group', { dataset: { group: 'upcoming' } },
      h('h2.card-title', 'Próximos'),
      upcoming.length ? h('div.list.rc-list', upcoming.map((r) => raceRow(r, data, today))) : h('p.muted.rc-none', 'Ninguno por ahora.')));
    if (past.length) {
      nodes.push(h('section.card.rc-group', { dataset: { group: 'past' } },
        h('button.rc-fold', { type: 'button', 'aria-expanded': String(showPast), onClick: () => { showPast = !showPast; render(); } },
          h('span.card-title', `Pasados (${past.length})`), icon(showPast ? 'chevron-up' : 'chevron-down', 18)),
        showPast ? h('div.list.rc-list', past.map((r) => raceRow(r, data, today))) : null));
    }
    nodes.push(h('button.btn.btn-primary.btn-lg.btn-block.rc-new', { type: 'button', onClick: () => navigate(`${LIST}/new`) }, icon('plus', 22), 'Añadir evento'));
    c.replaceChildren(...nodes);
  }
}

/** Fila que lleva a los eventos (Objetivos y Predicciones), con el próximo si lo hay. */
export function racesLink() {
  const today = todayStr();
  const next = R.nextRelevant(store.all('races'), today);
  const n = R.splitRaces(store.all('races'), today).upcoming.length;
  return h('button.list-item.prg-link-row.rc-link', { type: 'button', dataset: { link: 'races' }, onClick: () => navigate(LIST) },
    h('span.rc-link-emoji', { 'aria-hidden': 'true' }, '🏁'),
    h('span.list-item-main',
      h('span.list-item-title', 'Eventos deportivos'),
      h('span.list-item-sub.wrap', next ? R.todayLine(next, today) : n ? `${n} ${n === 1 ? 'evento próximo' : 'eventos próximos'}` : 'Apunta tu próxima carrera, marcha o ruta')),
    icon('chevron-right', 20, 'chev'));
}

// ===========================================================================
// #/races/new · #/races/:id
// ===========================================================================

export function mountRaceEdit(root, params = {}) {
  const today = todayStr();
  const editing = params.id ? R.normalizeRace(store.get('races', params.id)) : null;
  if (params.id && !editing) {
    const c = screen(root, { title: 'Evento', back: LIST });
    c.appendChild(emptyState({ emoji: '🔍', title: 'No encontrado', text: 'Puede que se haya borrado.', action: { label: 'Ver eventos', onClick: () => navigate(LIST, { replace: true }) } }));
    return undefined;
  }
  const draft = editing ? { ...editing } : {
    name: '', type: '10k', date: addDays(today, 56), distanceKm: null, targetSec: null, priority: 'A', note: '', goalId: null,
  };
  const goals = store.all('goals');
  const data = dataFromStore(today); // los registros no cambian mientras se edita
  const c = screen(root, { title: editing ? 'Editar evento' : 'Añadir evento', back: LIST });
  c.classList.add('rc', 'rc-edit');
  const form = h('div.rc-form');
  c.appendChild(form);
  const errEls = {};
  const errEl = (key) => (errEls[key] = h('p.form-error', { hidden: true, role: 'alert', dataset: { err: key } }));
  const how = h('div.rc-how-slot');

  function paintHow() {
    const race = R.normalizeRace({ ...draft, id: editing?.id || 'draft' });
    const blocks = [];
    const p = race ? racePrediction(data, race, { today }) : null;
    if (p) {
      blocks.push(h('div.rc-how-pred', { dataset: { verdict: p.verdict } },
        h('p.rc-how-line', h(`b.rc-verdict.rc-verdict-${VERDICT_CLASS[p.verdict] || 'info'}`, p.label), p.range ? ` · previsto ${p.range}` : ''),
        h('p.rc-how-text', p.text),
        p.why ? whyBox(h('div.wk-why', h('p.wk-why-rule', p.why.rule), h('ul.wk-why-data', (p.why.data || []).map((d) => h('li.wk-why-row', h('span.wk-why-label', d.label), h('span.wk-why-value', d.value)))))) : null));
    }
    const lg = race ? linkedGoalProgress(data, race, goals) : null;
    if (lg) {
      const gp = lg.progress;
      blocks.push(h('div.rc-how-goal', { dataset: { status: gp.status } },
        h('p.rc-how-line', h('b', lg.goal.title), ` · ${gp.statusLabel}`),
        gp.etaText ? h('p.rc-how-text', gp.etaText) : null,
        h('button.cal-link-btn', { type: 'button', onClick: () => navigate('#/goals') }, 'Ver objetivo', icon('chevron-right', 18))));
    }
    how.replaceChildren(...(blocks.length ? [h('section.card.rc-block.rc-how', { dataset: { block: 'how' } }, h('h2.card-title', 'Cómo vas'), ...blocks)] : []));
  }

  function paint() {
    Object.keys(errEls).forEach((k) => delete errEls[k]);
    const t = R.typeInfo(draft.type);
    const fixed = R.fixedKm(draft.type);
    const linkable = R.linkableGoals(goals, draft);
    if (draft.goalId && !linkable.some((g) => g.id === draft.goalId)) {
      // El objetivo enlazado ya no encaja (otro deporte, archivado…): se muestra para poder quitarlo.
      const g = goals.find((x) => x.id === draft.goalId);
      if (g) linkable.push(g);
    }
    const blocks = [];
    blocks.push(h('section.card.rc-block', { dataset: { block: 'type' } },
      h('h2.card-title', 'Evento'),
      chips({
        options: R.RACE_TYPES.map((x) => ({ value: x.value, label: x.label })), value: draft.type, className: 'rc-types',
        onChange: (v) => { if (!v) return; draft.type = v; if (R.fixedKm(v) != null) draft.distanceKm = null; paint(); },
      }),
      errEl('type'),
      h('label.field.rc-field', { dataset: { field: 'name' } },
        h('span.field-label', draft.type === 'custom' ? 'Nombre' : 'Nombre (opcional)'),
        textInput({ value: draft.name, maxlength: R.NAME_MAX, placeholder: draft.type === 'custom' ? 'p. ej. Carrera de montaña' : 'p. ej. San Silvestre', ariaLabel: 'Nombre del evento', onInput: (v) => { draft.name = v; } })),
      errEl('name'),
      h('label.field.rc-field', { dataset: { field: 'date' } },
        h('span.field-label', 'Fecha'),
        h('input.input.rc-date', { type: 'date', value: draft.date || '', 'aria-label': 'Fecha del evento', onChange: (ev) => { draft.date = ev.target.value || null; paintHow(); } })),
      errEl('date'),
      fixed != null
        ? h('p.rc-fixed-km', { dataset: { field: 'distance' } }, `Distancia: ${R.distanceText({ distanceKm: fixed })}`)
        : h('div.field.rc-field', { dataset: { field: 'distance' } },
          h('span.field-label', R.distanceRequired(draft.type) ? 'Distancia' : 'Distancia total (opcional)'),
          numInput({ value: draft.distanceKm, decimals: 2, suffix: 'km', ariaLabel: 'Distancia en km', onInput: (v) => { draft.distanceKm = v; } })),
      errEl('distanceKm')));

    blocks.push(h('section.card.rc-block', { dataset: { block: 'target' } },
      h('h2.card-title', 'Objetivo'),
      h('div.field.rc-field', { dataset: { field: 'target' } },
        h('span.field-label', 'Tiempo objetivo (opcional)'),
        durationInput({ seconds: draft.targetSec, ariaLabel: 'Tiempo objetivo', onChange: (sec) => { draft.targetSec = sec > 0 ? sec : null; paintHow(); } }),
        h('span.field-hint', t.sport === 'run' ? 'Con un tiempo objetivo verás si es probable, ajustado o aún no, con tus carreras recientes.' : 'Solo para recordarlo: el tiempo previsto se calcula para carreras a pie.')),
      errEl('targetSec'),
      h('div.field.rc-field', { dataset: { field: 'priority' } },
        h('span.field-label', 'Prioridad'),
        segmented({ options: R.PRIORITIES.map((p) => ({ value: p.value, label: p.short })), value: draft.priority, size: 'sm', ariaLabel: 'Prioridad', onChange: (v) => { draft.priority = v; paint(); } }),
        h('span.field-hint', R.PRIORITIES.find((p) => p.value === draft.priority)?.label || '')),
      errEl('priority'),
      h('div.field.rc-field', { dataset: { field: 'goal' } },
        h('span.field-label', 'Objetivo enlazado (opcional)'),
        linkable.length
          ? chips({ options: linkable.map((g) => ({ value: g.id, label: g.title || fmtTimeWords(g.timeSec) })), value: draft.goalId, allowNone: true, className: 'rc-goals', onChange: (v) => { draft.goalId = v || null; paintHow(); } })
          : h('p.field-hint.rc-no-goals', t.sport ? 'No tienes objetivos de resistencia activos de este deporte.' : 'Este tipo de evento no se enlaza con un objetivo.'),
        t.sport ? h('button.cal-link-btn.rc-new-goal', { type: 'button', onClick: () => navigate('#/goal/new?kind=endurance') }, 'Nuevo objetivo de resistencia', icon('chevron-right', 18)) : null),
      errEl('goalId')));

    blocks.push(how);

    blocks.push(h('section.card.rc-block', { dataset: { block: 'note' } },
      h('label.field', h('span.field-label', 'Nota (opcional)'),
        textInput({ value: draft.note, multiline: true, rows: 2, maxlength: R.NOTE_MAX, placeholder: 'p. ej. circuito con cuestas, salida a las 9:00', ariaLabel: 'Nota', onInput: (v) => { draft.note = v; } }))));

    blocks.push(h('div.rc-actions',
      h('button.btn.btn-primary.btn-lg.btn-block.rc-save', { type: 'button', onClick: onSave }, editing ? 'Guardar cambios' : 'Guardar'),
      editing ? h('button.btn.btn-danger-ghost.btn-block.rc-delete', { type: 'button', onClick: onDelete }, icon('trash', 20), 'Borrar') : null));
    form.replaceChildren(...blocks);
    paintHow();
  }

  async function onSave() {
    const err = R.validateRace(draft, { goals });
    for (const [k, el] of Object.entries(errEls)) {
      el.hidden = !err[k];
      el.textContent = err[k] || '';
    }
    if (Object.keys(err).length) {
      form.querySelector('.form-error:not([hidden])')?.scrollIntoView({ block: 'center' });
      return;
    }
    const rec = R.raceRecord(draft, { id: editing?.id || uid('race_'), createdAt: editing?.createdAt ?? null });
    await store.save('races', rec);
    back(LIST);
  }

  async function onDelete() {
    const ok = await confirmDialog({
      title: '¿Borrar este evento?', message: `${R.raceTitle(editing)} · ${fmtDate(editing.date, 'long')}.`, confirmText: 'Borrar', danger: true,
    });
    if (!ok) return;
    const removed = await store.remove('races', editing.id);
    back(LIST);
    undoToast('Evento borrado', () => { if (removed) store.restore('races', removed); });
  }

  paint();
  return undefined;
}
