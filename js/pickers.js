// pickers.js — selectores reutilizables basados en datos (ejercicio, plantilla).
import * as store from './store.js';
import { h, sheet, icon, chips, segmented } from './ui.js';
import { normalize, uid } from './util.js';
import { MUSCLES, MUSCLE_LABEL, LOG_TYPES, PATTERN_LABEL } from './seed.js';

/**
 * Selector de ejercicio con búsqueda (sin tildes, por nombre y alias).
 * @returns {Promise<string|null>} id del ejercicio elegido
 * opts: { title, excludeIds:[], filter:(ex)=>bool, allowCreate:true, preferIds:[] (se muestran arriba) }
 */
export function pickExercise({ title = 'Elegir ejercicio', excludeIds = [], filter = null, allowCreate = true, preferIds = [] } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    let muscle = null;
    const search = h('input.input.search-input', {
      type: 'search', placeholder: 'Buscar ejercicio…', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false',
      'aria-label': 'Buscar ejercicio',
    });
    const list = h('div.pick-list');
    const muscleChips = chips({
      options: MUSCLES.map((m) => ({ value: m.id, label: m.label })),
      value: null,
      allowNone: true,
      className: 'chips-scroll',
      onChange: (v) => { muscle = v; paint(); },
    });

    function paint() {
      const q = normalize(search.value);
      const excl = new Set(excludeIds);
      let items = store.exercisesList().filter((e) => !excl.has(e.id) && (!filter || filter(e)));
      if (muscle) items = items.filter((e) => (e.primary || []).includes(muscle) || (e.secondary || []).includes(muscle));
      if (q) {
        items = items.filter((e) => [e.name, ...(e.aliases || [])].some((n) => normalize(n).includes(q)));
        items.sort((a, b) => (normalize(a.name).startsWith(q) ? 0 : 1) - (normalize(b.name).startsWith(q) ? 0 : 1));
      }
      const prefer = preferIds.map((id) => items.find((e) => e.id === id)).filter(Boolean);
      const rest = items.filter((e) => !preferIds.includes(e.id));
      const rows = [];
      if (prefer.length && !q) {
        rows.push(h('div.pick-section', 'Sugeridos'));
        prefer.forEach((e) => rows.push(row(e)));
        rows.push(h('div.pick-section', 'Todos'));
      }
      rest.forEach((e) => rows.push(row(e)));
      if (!items.length) rows.push(h('div.pick-empty.muted', 'Sin resultados.'));
      if (allowCreate) {
        rows.push(h('button.pick-create', { type: 'button', onClick: () => createQuick(search.value.trim()) },
          icon('plus', 20), search.value.trim() ? `Crear «${search.value.trim()}»` : 'Crear ejercicio nuevo'));
      }
      list.replaceChildren(...rows);
    }

    function row(e) {
      const muscles = (e.primary || []).map((m) => MUSCLE_LABEL[m] || m).join(', ');
      return h('button.pick-row', { type: 'button', onClick: () => { chosen = e.id; s.close(); } },
        h('span.pick-name', e.name),
        h('span.pick-meta', [muscles, PATTERN_LABEL[e.pattern]].filter(Boolean).join(' · ')));
    }

    async function createQuick(name) {
      const id = await quickCreateExercise(name);
      if (id) { chosen = id; s.close(); }
    }

    search.addEventListener('input', paint);
    const s = sheet({
      title,
      tall: true,
      className: 'pick-sheet',
      onClose: () => resolve(chosen),
      body: h('div.pick', search, muscleChips, list),
    });
    paint();
  });
}

/** Formulario rápido para crear un ejercicio. Devuelve id o null. */
export function quickCreateExercise(name = '') {
  return new Promise((resolve) => {
    let created = null;
    const data = { name, logType: 'weight_reps', sport: 'run', primary: [], secondary: [] };
    const nameInp = h('input.input', { type: 'text', value: name, placeholder: 'Nombre del ejercicio', autocomplete: 'off', onInput: (e) => { data.name = e.target.value; } });
    // Cardio: el deporte decide qué formulario de actividad abre en la sesión (carrera, bici o natación).
    const sportSeg = segmented({
      options: [{ value: 'run', label: 'Carrera' }, { value: 'bike', label: 'Bici' }, { value: 'swim', label: 'Natación' }],
      value: data.sport,
      ariaLabel: 'Deporte',
      onChange: (v) => { data.sport = v; },
    });
    const sportField = h('div.field', { hidden: true }, h('span.field-label', 'Deporte'), sportSeg,
      h('span.field-hint', 'En una sesión abre el formulario de esa actividad.'));
    const typeChips = chips({ options: LOG_TYPES.map((t) => ({ value: t.id, label: t.label })), value: data.logType, onChange: (v) => { data.logType = v; sportField.hidden = v !== 'cardio'; } });
    const primChips = chips({ options: MUSCLES.map((m) => ({ value: m.id, label: m.label })), value: [], multi: true, onChange: (v) => { data.primary = v; } });
    const secChips = chips({ options: MUSCLES.map((m) => ({ value: m.id, label: m.label })), value: [], multi: true, onChange: (v) => { data.secondary = v; } });
    const err = h('p.form-error', { hidden: true });
    const s = sheet({
      title: 'Nuevo ejercicio',
      tall: true,
      onClose: () => resolve(created),
      body: h('div.stack',
        h('label.field', h('span.field-label', 'Nombre'), nameInp),
        h('div.field', h('span.field-label', 'Tipo de registro'), typeChips),
        sportField,
        h('div.field', h('span.field-label', 'Músculos principales'), primChips),
        h('div.field', h('span.field-label', 'Músculos secundarios'), secChips),
        h('p.field-hint', 'Podrás completar el patrón de movimiento y demás datos en Ejercicios.'),
        err),
      actions: [{
        label: 'Crear ejercicio',
        kind: 'primary',
        onClick: async (close) => {
          const nm = data.name.trim();
          if (!nm) { err.textContent = 'Pon un nombre.'; err.hidden = false; return; }
          if (store.exercisesList({ includeArchived: true }).some((e) => normalize(e.name) === normalize(nm))) {
            err.textContent = 'Ya existe un ejercicio con ese nombre.'; err.hidden = false; return;
          }
          const cardio = data.logType === 'cardio';
          const ex = {
            id: uid('ex_'), name: nm, aliases: [], primary: data.primary, secondary: data.secondary.filter((m) => !data.primary.includes(m)),
            pattern: cardio ? 'cardio' : 'isolation', logType: data.logType, category: 'isolation', region: 'upper',
            ...(cardio ? { sport: data.sport || 'run' } : {}),
            custom: true, archived: false, notes: '',
          };
          await store.save('exercises', ex);
          created = ex.id;
          close();
        },
      }],
    });
    setTimeout(() => nameInp.focus(), 250);
  });
}

/**
 * Selector de plan para un día: plantilla, descanso o sesión libre.
 * @returns {Promise<null | {kind:'template', templateId} | {kind:'rest'} | {kind:'free', label, activityKind}>}
 * opts: { title, includeRest, includeFree }
 */
export function pickTemplate({ title = 'Elegir rutina', includeRest = false, includeFree = false } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const rows = store.templatesList().map((t) => h('button.pick-row', { type: 'button', onClick: () => { chosen = { kind: 'template', templateId: t.id }; s.close(); } },
      h('span.pick-name', t.name),
      h('span.pick-meta', `${(t.items || []).length} ejercicios`)));
    if (includeRest) {
      rows.push(h('button.pick-row', { type: 'button', onClick: () => { chosen = { kind: 'rest' }; s.close(); } },
        h('span.pick-name', '😴 Descanso'), h('span.pick-meta', 'Día sin entrenamiento planificado')));
    }
    if (includeFree) {
      const FREE = [
        { activityKind: 'bike', label: 'Ruta en bici', emoji: '🚴' },
        { activityKind: 'run', label: 'Carrera', emoji: '🏃' },
        { activityKind: 'swim', label: 'Natación', emoji: '🏊' },
        { activityKind: 'other', label: 'Otra actividad', emoji: '⚡' },
        { activityKind: 'strength', label: 'Fuerza libre', emoji: '🏋️' },
      ];
      rows.push(h('div.pick-section', 'Sesión libre'));
      for (const f of FREE) {
        rows.push(h('button.pick-row', { type: 'button', onClick: () => { chosen = { kind: 'free', label: f.label, activityKind: f.activityKind }; s.close(); } },
          h('span.pick-name', `${f.emoji} ${f.label}`)));
      }
    }
    const s = sheet({ title, onClose: () => resolve(chosen), body: h('div.pick-list', rows) });
  });
}
