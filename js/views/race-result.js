// race-result.js — tarjeta «Resultado» / «¿Cómo te fue?» del detalle de un evento pasado (ronda 8, D;
// docs/MEJORAS.md §8). La lógica (qué se puede vincular, qué tiempo cuenta, comparación, predicción previa y récord)
// está en ../races-result.js; aquí solo se pinta y se guarda.
//
// Una sola fuente: el evento guarda una REFERENCIA (outcome.activityId / outcome.contextId) y solo el tiempo de un
// deporte que no es correr (outcome.manual). Cada acción guarda el evento como estaba y ofrece «Deshacer» (vuelve a
// ponerlo y quita la marca de contexto que se haya creado). La marca de contexto se escribe ANTES que el evento: si
// lo segundo fallara, queda una marca válida y visible en tu contexto (no se pierde nada).
import * as store from '../store.js';
import { navigate } from '../router.js';
import { h, icon, numInput, durationInput, textInput, undoToast, stateTag } from '../ui.js';
import { uid, fmtDate, fmtNum, fmtRaceTime } from '../util.js';
import * as R from '../races-logic.js';
import { outcomeView, resultCandidates, raceKm, POSITION_TEXT } from '../races-result.js';
import { dataFromStore } from '../progress-ui.js';
import { validateEntry, entryRecord, normalizeEntry } from '../context-logic.js';

/** Entrada 'race_result' de tu contexto para el resultado a mano de una carrera a pie (la forma de siempre). */
export function contextDraftFor(race, { sec, km }, base = null) {
  return {
    ...(base || {}),
    kind: 'event', type: 'race_result', date: base?.date || { date: race.date, precision: 'day' },
    text: base ? base.text : (race.name || R.typeInfo(race.type).label), notes: base ? base.notes : '',
    result: { ...(base?.result || {}), km, sec, effort: base?.result?.effort ?? 'race', elevationM: base?.result?.elevationM ?? null, surface: base?.result?.surface ?? null },
  };
}

/**
 * Tarjeta del resultado de un evento (por id: siempre lee el evento del almacén, nunca de un borrador).
 * @returns {{ el: HTMLElement, paint: (opts?:{external?:boolean}) => void }}
 */
export function resultCard(raceId, { today }) {
  const el = h('section.card.rc-block.rc-result', { dataset: { block: 'result' } });
  let mode = null; // null · 'options' (Cambiar) · 'link' · 'manual'
  let form = null; // borrador del formulario a mano: { sec, km, place, note }
  let errs = {};

  const raw = () => store.get('races', raceId);

  /** Guarda el resultado (o lo quita) con «Deshacer». `entry` = marca de contexto a guardar antes (nueva o editada). */
  async function apply(outcome, { entry = null, entryBefore = null, msg }) {
    const before = raw();
    if (!before) return;
    // Primero se cierra lo abierto: el repintado que provoca el guardado (store 'change') ya es el definitivo
    mode = null; form = null; errs = {};
    if (entry) await store.save('context', entry);
    await store.save('races', R.withOutcome(before, outcome));
    paint();
    undoToast(msg, async () => {
      await store.restore('races', before);
      if (entry && entryBefore) await store.restore('context', entryBefore);
      else if (entry) await store.remove('context', entry.id);
    });
  }

  const optRow = (opt, emoji, title, sub, onClick, open = false) => h('button.list-item.rc-opt', { type: 'button', dataset: { opt }, 'aria-expanded': open ? 'true' : null, onClick },
    h('span.rc-opt-emoji', { 'aria-hidden': 'true' }, emoji),
    h('span.list-item-main', h('span.list-item-title', title), sub ? h('span.list-item-sub.wrap', sub) : null),
    icon(open ? 'chevron-up' : 'chevron-right', 20, 'chev'));

  function linkPanel(race, data) {
    const { activities, results } = resultCandidates(data, race, store.all('races'));
    const rows = [
      ...activities.map((a) => h('button.list-item.rc-cand', { type: 'button', dataset: { cand: a.id, kind: a.kind, close: a.close ? '1' : '' }, onClick: () => apply({ status: 'done', activityId: a.id }, { msg: 'Actividad vinculada' }) },
        h('span.list-item-main', h('span.list-item-title', a.label), h('span.list-item-sub.wrap', a.sub)), icon('chevron-right', 20, 'chev'))),
      ...results.map((x) => h('button.list-item.rc-cand', { type: 'button', dataset: { candEntry: x.id }, onClick: () => apply({ status: 'done', contextId: x.id }, { msg: 'Resultado vinculado' }) },
        h('span.list-item-main', h('span.list-item-title', `🏁 ${x.label}`), h('span.list-item-sub.wrap', x.sub)), icon('chevron-right', 20, 'chev'))),
    ];
    const kind = R.sportOf(race) || 'run';
    return h('div.rc-panel.rc-link-panel',
      rows.length
        ? h('div.list.rc-cands', rows)
        : h('p.muted.rc-no-cands', 'No hay actividades de ese día (ni del anterior o el siguiente). Regístrala o impórtala y vuelve aquí a vincularla.'),
      rows.length ? null : h('div.rc-cand-links',
        h('button.cal-link-btn', { type: 'button', dataset: { link: 'new-activity' }, onClick: () => navigate(`#/activity/new?kind=${['run', 'bike', 'hike'].includes(kind) ? kind : 'run'}&date=${race.date}`) }, 'Registrar actividad', icon('chevron-right', 18)),
        h('button.cal-link-btn', { type: 'button', dataset: { link: 'import' }, onClick: () => navigate('#/import') }, 'Importar desde un archivo', icon('chevron-right', 18))));
  }

  function manualPanel(race, v) {
    const run = R.sportOf(race) === 'run';
    const errEl = (k) => (errs[k] ? h('p.form-error', { role: 'alert', dataset: { err: k } }, errs[k]) : null);
    return h('div.rc-panel.rc-manual',
      h('div.field.rc-field', { dataset: { field: 'res-time' } },
        h('span.field-label', 'Tiempo'),
        durationInput({ seconds: form.sec, ariaLabel: 'Tiempo del resultado', onChange: (s) => { form.sec = s > 0 ? s : null; } })),
      errEl('sec'),
      h('label.field.rc-field', { dataset: { field: 'res-km' } },
        h('span.field-label', run ? 'Distancia' : 'Distancia (opcional)'),
        numInput({ value: form.km, decimals: 2, suffix: 'km', ariaLabel: 'Distancia del resultado en km', onInput: (x) => { form.km = x; } })),
      errEl('km'),
      h('label.field.rc-field', { dataset: { field: 'res-place' } },
        h('span.field-label', 'Puesto (opcional)'),
        numInput({ value: form.place, decimals: 0, inputmode: 'numeric', ariaLabel: 'Puesto', onInput: (x) => { form.place = x; } })),
      errEl('place'),
      h('label.field.rc-field', { dataset: { field: 'res-note' } },
        h('span.field-label', 'Nota (opcional)'),
        textInput({ value: form.note, multiline: true, rows: 2, maxlength: R.NOTE_MAX, placeholder: 'p. ej. calor, salida rápida', ariaLabel: 'Nota del resultado', onInput: (x) => { form.note = x; } })),
      errEl('note'),
      run ? h('p.field-hint', 'Se guarda como un resultado de carrera en tu contexto: cuenta en Récords y en tus tiempos previstos.') : null,
      h('div.rc-res-actions',
        h('button.btn.btn-primary.btn-block.rc-res-save', { type: 'button', onClick: () => saveManual(race, v) }, 'Guardar resultado'),
        // (con un resultado ya guardado, el «Cancelar» de la tarjeta cierra todo)
        ['pending', 'missing'].includes(v.state) ? h('button.btn.btn-ghost.btn-block.rc-res-cancel', { type: 'button', onClick: () => { mode = null; form = null; errs = {}; paint(); } }, 'Cancelar') : null));
  }

  async function saveManual(race, v) {
    const today0 = today;
    const d = { sec: form.sec, km: form.km, place: form.place == null ? null : form.place, note: form.note || '' };
    errs = R.validateOutcome(d, race);
    const run = R.sportOf(race) === 'run';
    // Carrera a pie: la marca va a tu contexto (la misma entrada si ya la había: «Editar resultado»)
    const prevEntry = run && v.result.source === 'context' && v.state === 'done' ? normalizeEntry(store.get('context', v.result.contextId)) : null;
    let entry = null;
    if (run && !Object.keys(errs).length) {
      const draft = contextDraftFor(race, { sec: d.sec, km: d.km }, prevEntry);
      const ce = validateEntry(draft, today0);
      if (ce.date) errs.sec = ce.date;
      else if (ce.km || ce.sec) Object.assign(errs, ce.km ? { km: ce.km } : {}, ce.sec ? { sec: ce.sec } : {});
      else entry = entryRecord(draft, { id: prevEntry?.id || uid('ctx_') });
    }
    if (Object.keys(errs).length) { paint(); el.querySelector('.form-error')?.scrollIntoView({ block: 'center' }); return; }
    const common = { status: 'done', place: Number.isInteger(d.place) ? d.place : null, note: d.note };
    const outcome = run ? { ...common, contextId: entry.id } : { ...common, manual: { sec: d.sec, km: d.km ?? null } };
    await apply(outcome, { entry, entryBefore: prevEntry ? store.get('context', prevEntry.id) : null, msg: 'Resultado guardado' });
  }

  function options(race, v, data) {
    const kids = [];
    if (v.state === 'missing') {
      kids.push(h('div.rc-res-missing', { dataset: { missing: v.result.missing } },
        stateTag('warn', 'El resultado ya no existe'),
        h('p.rc-res-text', v.result.missing === 'activity' ? 'Se borró la actividad vinculada. Vincula otra o escribe tu tiempo.' : 'Se borró la marca de tu contexto. Vincula otra o escribe tu tiempo.')));
    } else if (v.state === 'pending') {
      kids.push(h('p.rc-res-text', 'Apunta cómo fue: vincula la actividad de ese día o escribe tu tiempo. Así sabrás cómo te fue frente al objetivo y a la predicción.'));
    }
    kids.push(h('div.list.rc-opts',
      optRow('link', '🔗', 'Vincular una actividad', 'La de ese día, sin copiarla', () => { mode = mode === 'link' ? (v.state === 'pending' || v.state === 'missing' ? null : 'options') : 'link'; paint(); }, mode === 'link'),
      mode === 'link' ? linkPanel(race, data) : null,
      optRow('manual', '⏱️', 'Introducir resultado', 'Tiempo, distancia y puesto', () => {
        if (mode === 'manual') { mode = v.state === 'pending' || v.state === 'missing' ? null : 'options'; form = null; } else { mode = 'manual'; form = { sec: null, km: raceKm(race), place: null, note: '' }; }
        errs = {}; paint();
      }, mode === 'manual'),
      mode === 'manual' ? manualPanel(race, v) : null,
      v.state !== 'dns' ? optRow('dns', '🚫', 'No participé', null, () => apply({ status: 'dns' }, { msg: 'Marcado como «no participé»' })) : null,
      v.state !== 'skipped' && v.state !== 'missing' ? optRow('skip', '⏭️', 'Omitir', 'No volver a preguntar', () => apply({ status: 'skipped' }, { msg: 'Omitido' })) : null));
    if (v.state === 'missing') kids.push(h('button.btn.btn-ghost.btn-block.rc-res-remove', { type: 'button', onClick: () => apply(null, { msg: 'Resultado quitado' }) }, 'Quitar el resultado'));
    if (mode && !['pending', 'missing'].includes(v.state)) kids.push(h('button.btn.btn-ghost.btn-block.rc-res-cancel', { type: 'button', onClick: () => { mode = null; form = null; errs = {}; paint(); } }, 'Cancelar'));
    return kids;
  }

  const row = (key, label, value, sub = null, extra = {}) => h('div.rc-res-row', { dataset: { row: key, ...extra } },
    h('span.rc-res-label', label),
    h('span.rc-res-value', value, sub ? h('span.rc-res-sub', sub) : null));

  function done(race, v) {
    const res = v.result;
    const rows = [];
    if (v.target) rows.push(row('target', 'Objetivo', v.target.text));
    const subRes = [
      res.how === 'partial' ? res.partialText : res.km != null && (!res.comparable || raceKm(race) == null) ? `${fmtNum(res.km, 2)} km` : null,
      res.place ? `Puesto ${fmtNum(res.place, 0)}` : null,
    ].filter(Boolean).join(' · ');
    rows.push(row('result', 'Resultado', fmtRaceTime(res.sec) ?? '—', subRes || null, { sec: String(res.sec) }));
    if (v.diff) rows.push(row('diff', 'Diferencia', v.diff.text, null, { kind: v.diff.kind, diff: String(v.diff.diffSec) }));
    else if (v.target && !res.comparable) rows.push(row('diff', 'Diferencia', 'Sin comparar: la distancia no es la del evento'));
    if (v.prior) {
      const p = v.prior;
      rows.push(p.ok
        ? row('prior', 'Predicción previa', p.range, [v.position ? POSITION_TEXT[v.position] : null, `con tus datos hasta el ${fmtDate(p.asOf)}`].filter(Boolean).join(' · '), { inside: v.position || '', low: String(p.low), high: String(p.high), mid: String(p.mid) })
        : row('prior', 'Predicción previa', p.text, null, { reason: p.reason }));
    }
    const rec = v.record;
    const recLabel = rec ? rec.current?.label || rec.atTheTime?.label || rec.longest : null;
    const actions = [];
    if (res.source === 'activity') actions.push(h('button.cal-link-btn.rc-res-act', { type: 'button', dataset: { act: 'view' }, onClick: () => navigate(`#/activity/${encodeURIComponent(res.activityId)}`) }, 'Ver actividad', icon('chevron-right', 18)));
    else {
      actions.push(h('button.cal-link-btn.rc-res-act', {
        type: 'button', dataset: { act: 'edit' },
        onClick: () => { mode = 'manual'; form = { sec: res.sec, km: res.km, place: res.place, note: res.note || '' }; errs = {}; paint(); },
      }, 'Editar resultado', icon('chevron-right', 18)));
    }
    actions.push(h('button.cal-link-btn.rc-res-act', { type: 'button', dataset: { act: 'change' }, onClick: () => { mode = 'options'; paint(); } }, 'Cambiar', icon('chevron-right', 18)));
    actions.push(h('button.cal-link-btn.rc-res-act', {
      type: 'button', dataset: { act: 'remove' },
      onClick: () => apply(null, { msg: res.source === 'context' ? 'Resultado quitado del evento; la marca sigue en tu contexto' : 'Resultado quitado' }),
    }, 'Quitar'));
    return [
      h('div.rc-res-rows', rows),
      recLabel ? h('button.rc-res-pr', { type: 'button', dataset: { pr: rec.current ? 'current' : rec.atTheTime ? 'then' : 'longest' }, onClick: () => navigate(rec.href) }, stateTag('pr', recLabel), icon('chevron-right', 18, 'chev')) : null,
      res.note ? h('p.rc-res-note', res.note) : null,
      h('div.rc-res-links', actions),
    ];
  }

  function paint() {
    const r0 = raw();
    const race = R.normalizeRace(r0);
    if (!race) { el.replaceChildren(); return; }
    const data = dataFromStore(today);
    const v = outcomeView(data, race);
    el.dataset.state = v.state;
    const answering = mode || v.state === 'pending' || v.state === 'missing';
    let body;
    if (answering) body = options(race, v, data);
    else if (v.state === 'done') body = done(race, v);
    else if (v.state === 'dns') {
      body = [h('p.rc-res-text.rc-res-dns', 'No participaste.'), v.result.note ? h('p.rc-res-note', v.result.note) : null,
        h('div.rc-res-links',
          h('button.cal-link-btn.rc-res-act', { type: 'button', dataset: { act: 'change' }, onClick: () => { mode = 'options'; paint(); } }, 'Cambiar', icon('chevron-right', 18)),
          h('button.cal-link-btn.rc-res-act', { type: 'button', dataset: { act: 'remove' }, onClick: () => apply(null, { msg: 'Respuesta quitada' }) }, 'Quitar'))];
    } else {
      body = [h('p.rc-res-text.rc-res-skipped', 'Omitido: no se te volverá a preguntar.'),
        h('div.rc-res-links', h('button.cal-link-btn.rc-res-act', { type: 'button', dataset: { act: 'change' }, onClick: () => { mode = 'options'; paint(); } }, 'Responder ahora', icon('chevron-right', 18)))];
    }
    el.replaceChildren(h('h2.card-title', answering && v.state !== 'done' && v.state !== 'dns' ? '¿Cómo te fue?' : 'Resultado'), ...body.filter(Boolean));
  }

  paint();
  return {
    el,
    /** Repinta (cambios del almacén). Con el formulario a mano abierto no se toca: perdería lo escrito. */
    paint: ({ external = false } = {}) => { if (external && mode === 'manual') return; paint(); },
  };
}
