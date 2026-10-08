// templates.js — Rutinas (plantillas): lista reutilizable y editor.
// PROPIETARIO: módulo de biblioteca. La lógica pura (grupos, orden, objetivo…) está en library-logic.js.
import * as store from '../store.js';
import { navigate, back, replaceUrl } from '../router.js';
import { h, icon, screen, stepper, sheet, actionSheet, confirmDialog, undoToast, toast, emptyState, field, textInput, scrollBehavior } from '../ui.js';
import { pickExercise } from '../pickers.js';
import { createStrengthSession } from '../session-logic.js';
import { uid, todayStr, deepClone, DAY_LONG, DAY_SHORT, plural } from '../util.js';
import { MISSING_TEMPLATE_LABEL as MISSING } from '../plan.js';
import * as L from '../library-logic.js';

const LIST_HREF = '#/exercises?seg=templates';
const NEW_NAME = 'Nueva rutina';

const exName = (id) => store.exercise(id)?.name || null;
const joinY = (arr) => (arr.length > 1 ? `${arr.slice(0, -1).join(', ')} y ${arr[arr.length - 1]}` : arr.join(''));

/** Escucha cambios de una store y ejecuta `fn` una sola vez por tanda (se desuscribe al desmontarse `el`). */
function onStoreChange(storeName, el, fn) {
  let queued = false;
  const off = store.on('change', (d) => {
    if (d.store !== storeName || queued) return;
    queued = true;
    setTimeout(() => {
      queued = false;
      if (!el.isConnected) { off(); return; }
      fn();
    }, 0);
  });
  return off;
}

// ===========================================================================
// Acciones sobre plantillas (se usan en la lista y en el editor)
// ===========================================================================

/** Crea una rutina vacía y abre su editor. */
export async function createTemplate() {
  const all = store.templatesList({ includeArchived: true });
  const order = all.reduce((m, t) => Math.max(m, t.order ?? 0), -1) + 1;
  const t = { id: uid('tpl_'), name: L.uniqueName(NEW_NAME, all.map((x) => x.name)), order, notes: '', archived: false, items: [] };
  await store.save('templates', t);
  navigate(`#/template/${t.id}?new=1`);
  return t;
}

function saveOrder(list) {
  return Promise.all(L.renumber(list).map(({ id, order }) => {
    const t = store.get('templates', id);
    t.order = order;
    return store.save('templates', t);
  }));
}

/** Sube (−1) o baja (+1) una rutina en la lista. */
export async function moveTemplateBy(id, dir) {
  const list = L.moveTemplate(store.templatesList(), id, dir);
  if (list) await saveOrder(list);
}

/** Duplica una rutina («X (copia)», ids nuevos) justo debajo de la original. */
export async function duplicateTemplateAction(t) {
  const names = store.templatesList({ includeArchived: true }).map((x) => x.name);
  const copy = L.duplicateTemplate(t, { name: L.copyName(t.name, names) });
  const list = L.insertAfter(store.templatesList(), copy, t.id);
  copy.order = list.indexOf(copy);
  await store.save('templates', copy);
  await saveOrder(list);
  toast(`Creada «${copy.name}»`, { kind: 'success', actionLabel: 'Abrir', onAction: () => navigate(`#/template/${copy.id}`) });
  return copy;
}

/** Empieza una sesión con la rutina; si ya hay una en curso, ofrece continuarla. */
export async function startTemplateNow(t) {
  const active = store.activeSession();
  if (active) {
    const ok = await confirmDialog({
      title: 'Ya hay una sesión en curso',
      message: `«${active.templateName || 'Sesión'}» sigue abierta. Solo puede haber una sesión de fuerza en curso: termínala antes de empezar otra.`,
      confirmText: 'Continuar la sesión en curso',
    });
    if (ok) navigate(`#/session/${active.id}`);
    return null;
  }
  const s = await createStrengthSession({ templateId: t.id });
  navigate(`#/session/${s.id}`);
  return s;
}

/** Borra una rutina con confirmación (avisa si está en el calendario) y ofrece deshacer. */
export async function deleteTemplateAction(t, { after = null } = {}) {
  const use = L.templateCalendarUse(t.id, { settings: store.settings(), plan: store.all('plan'), today: todayStr() });
  const parts = [];
  if (use.weekDays.length) {
    parts.push(`Está en tu semana tipo (${joinY(use.weekDays.map((d) => DAY_LONG[d]))}). Esos días aparecerán en el calendario como «${MISSING}» hasta que cambies la semana tipo en Ajustes.`);
  }
  if (use.overrides.length) {
    parts.push(`También está asignada a ${plural(use.overrides.length, 'día concreto', 'días concretos')} del calendario, que quedarán como «${MISSING}».`);
  }
  parts.push('Las sesiones ya registradas con esta rutina no se borran.');
  const ok = await confirmDialog({ title: `¿Borrar «${t.name}»?`, message: parts.join('\n\n'), confirmText: 'Borrar rutina', danger: true });
  if (!ok) return false;
  const removed = await store.remove('templates', t.id);
  if (after) after();
  undoToast(`Rutina «${t.name}» borrada`, () => { if (removed) store.restore('templates', removed); });
  return true;
}

// ===========================================================================
// Lista de rutinas (embebible)
// ===========================================================================

/**
 * Pinta la lista de rutinas (por `order`) con su menú ⋯ y el botón «Nueva rutina» dentro de `container`.
 * Se repinta sola cuando cambian las plantillas. Devuelve { el, repaint, destroy }.
 */
export function renderTemplatesList(container) {
  const el = h('div.lib-tpls');

  function row(t, i, n, weekDays) {
    const count = (t.items || []).length;
    const days = weekDays.map((d, k) => (d && d.kind === 'template' && d.templateId === t.id ? DAY_SHORT[k] : null)).filter(Boolean);
    const meta = [plural(count, 'ejercicio', 'ejercicios'), days.length ? `semana tipo: ${days.join(', ')}` : null].filter(Boolean).join(' · ');
    return h('div.lib-tpl', { dataset: { id: t.id } },
      h('button.lib-tpl-main', { type: 'button', onClick: () => navigate(`#/template/${t.id}`) },
        h('span.lib-tpl-name', t.name || 'Rutina sin nombre'),
        h('span.lib-tpl-meta', meta),
        h('span.lib-tpl-ex', L.templatePreviewText(t, exName, 3))),
      h('button.icon-btn.lib-more', { type: 'button', 'aria-label': `Opciones de ${t.name}`, onClick: () => menu(t, i, n) }, icon('more', 24)));
  }

  function menu(t, i, n) {
    actionSheet({
      title: t.name,
      actions: [
        { label: 'Editar', icon: 'edit', onClick: () => navigate(`#/template/${t.id}`) },
        { label: 'Empezar ahora', icon: 'play', onClick: () => startTemplateNow(t) },
        { label: 'Duplicar', icon: 'copy', onClick: () => duplicateTemplateAction(t) },
        { label: 'Subir', icon: 'arrow-up', disabled: i === 0, onClick: () => moveTemplateBy(t.id, -1) },
        { label: 'Bajar', icon: 'arrow-down', disabled: i === n - 1, onClick: () => moveTemplateBy(t.id, 1) },
        { label: 'Borrar', icon: 'trash', danger: true, onClick: () => deleteTemplateAction(t) },
      ],
    });
  }

  function repaint() {
    const tpls = store.templatesList();
    const weekDays = L.patternDaysFor(store.settings()?.weekPatterns, todayStr());
    el.replaceChildren(
      tpls.length
        ? h('div.list.lib-tpl-list', tpls.map((t, i) => row(t, i, tpls.length, weekDays)))
        : emptyState({ emoji: '📋', title: 'Sin rutinas', text: 'Crea una rutina con los ejercicios y objetivos de cada día de entreno.' }),
      h('button.btn.btn-lg.btn-block.lib-add', { type: 'button', onClick: createTemplate }, icon('plus', 22), 'Nueva rutina'));
  }

  repaint();
  container.appendChild(el);
  const off = onStoreChange('templates', el, repaint);
  return { el, repaint, destroy: off };
}

/** #/templates — lista de rutinas a pantalla completa. */
export function mountTemplates(root) {
  const c = screen(root, { title: 'Rutinas', back: LIST_HREF });
  const api = renderTemplatesList(c);
  return api.destroy;
}

// ===========================================================================
// Editor de rutina (#/template/:id)
// ===========================================================================

let expandedId = null; // ítem desplegado (se conserva al volver del selector o al remontar)

/** Hoja para elegir superserie o circuito. Devuelve 'superset' | 'circuit' | null. */
function chooseGroupType() {
  return new Promise((resolve) => {
    let res = null;
    sheet({
      title: 'Agrupar con el siguiente',
      onClose: () => resolve(res),
      body: (close) => h('div.action-list',
        h('button.action-item', { type: 'button', onClick: () => { res = 'superset'; close(); } },
          h('span', 'Superserie'), h('span.action-hint', 'alternar 2–3 ejercicios')),
        h('button.action-item', { type: 'button', onClick: () => { res = 'circuit'; close(); } },
          h('span', 'Circuito'), h('span.action-hint', 'varios seguidos'))),
    });
  });
}

/** Asigna o borra (null) un campo opcional del objetivo. */
function setKey(obj, k, v) {
  if (v == null) delete obj[k];
  else obj[k] = v;
}

export function mountTemplateEdit(root, params = {}) {
  const tpl = store.get('templates', params.id);
  if (!tpl) {
    const c = screen(root, { title: 'Rutina', back: LIST_HREF });
    c.appendChild(emptyState({ emoji: '🤷', title: 'Rutina no encontrada', text: 'Puede que se haya borrado.', action: { label: 'Ver rutinas', onClick: () => navigate(LIST_HREF, { replace: true }) } }));
    return undefined;
  }
  if (!Array.isArray(tpl.items)) tpl.items = [];
  const isNew = params.new === '1';
  const initialName = tpl.name;
  if (isNew) {
    expandedId = null;
    // Se quita «?new=1» de la URL sin volver a montar (al recargar ya no es «nueva»).
    replaceUrl(`#/template/${tpl.id}`);
  }

  const content = screen(root, {
    title: tpl.name || 'Rutina sin nombre',
    subtitle: 'Los cambios se guardan solos',
    back: LIST_HREF,
    actions: [{ icon: 'more', label: 'Opciones de la rutina', onClick: openMenu }],
  });
  content.classList.add('lib-editor');
  const titleEl = root.querySelector('.topbar h1');

  // --- nombre y notas ---
  let goodName = tpl.name;
  const nameInp = textInput({
    value: tpl.name, placeholder: 'p. ej. Día 1 — Upper pesado', ariaLabel: 'Nombre de la rutina', maxlength: 80,
    onInput: (v) => {
      const nm = v.trim();
      titleEl.textContent = nm || 'Rutina sin nombre';
      if (!nm) return;
      tpl.name = nm;
      goodName = nm;
      store.saveSoon('templates', tpl);
    },
  });
  nameInp.addEventListener('change', () => {
    if (!nameInp.value.trim()) { nameInp.value = goodName; titleEl.textContent = goodName; }
  });
  const notesInp = textInput({
    multiline: true, rows: 2, value: tpl.notes || '', placeholder: 'Notas de la rutina (opcional)', ariaLabel: 'Notas de la rutina',
    onInput: (v) => { tpl.notes = v; store.saveSoon('templates', tpl); },
  });
  const countEl = h('span.muted.small');
  const listEl = h('div.lib-items');
  content.append(
    h('div.card.lib-tpl-form', field('Nombre', nameInp), field('Notas', notesInp)),
    h('div.row-between.lib-items-head', h('h2.section-title', 'Ejercicios'), countEl),
    listEl,
    h('button.btn.btn-lg.btn-block.lib-add', { type: 'button', onClick: addExercise }, icon('plus', 22), 'Añadir ejercicio'),
    h('p.small.muted.lib-foot', 'Toca un ejercicio para cambiar su objetivo, notas, alternativas o agruparlo en superserie o circuito.'));
  if (isNew) setTimeout(() => { try { nameInp.focus(); nameInp.select(); } catch { /* iOS */ } }, 300);

  // --- utilidades ---
  const indexOf = (id) => tpl.items.findIndex((x) => x.id === id);
  const itemById = (id) => tpl.items.find((x) => x.id === id) || null;

  /** Sustituye los ítems (cambio estructural), guarda y repinta la lista. */
  function commit(items) {
    tpl.items = items;
    store.save('templates', tpl);
    renderList();
  }

  function scrollToItem(id) {
    requestAnimationFrame(() => {
      const el = listEl.querySelector(`[data-item="${id}"]`);
      if (!el || !el.scrollIntoView) return;
      // Con la cabecera tapando su principio, se alinea arriba (bajo la cabecera, con su scroll-margin); si no, lo
      // mínimo («nearest» no mueve un ítem desplegado más alto que la pantalla aunque su cabecera quede tapada)
      const hidden = el.getBoundingClientRect().top < (parseFloat(getComputedStyle(el).scrollMarginTop) || 0);
      el.scrollIntoView({ block: hidden ? 'start' : 'nearest', behavior: scrollBehavior() });
    });
  }

  // --- lista ---
  function renderList() {
    const items = tpl.items;
    const labels = L.groupLabels(items);
    const out = [];
    for (const b of L.blocks(items)) {
      const first = items[b.start];
      const sec = first.section || '';
      const prevSec = b.start > 0 ? items[b.start - 1].section || '' : '';
      if (b.start === 0 ? !!sec : sec !== prevSec) out.push(h('h3.section-title.lib-section', sec || 'Sin sección'));
      const cards = [];
      for (let k = b.start; k < b.end; k++) cards.push(itemCard(items[k], labels[items[k].id]));
      if (b.groupId) {
        const type = first.groupType === 'circuit' ? 'circuit' : 'superset';
        const other = type === 'circuit' ? 'superset' : 'circuit';
        out.push(h('div.lib-group', { dataset: { group: b.groupId, type } },
          h('div.lib-group-head',
            h('div.lib-group-titles',
              h('span.lib-group-kind', L.GROUP_LABEL[type]),
              h('span.lib-group-sub', `Grupo ${labels[first.id][0]} · ${plural(b.end - b.start, 'ejercicio', 'ejercicios')}`)),
            h('button.lib-group-btn', { type: 'button', onClick: () => commit(L.setGroupType(tpl.items, b.groupId, other)) },
              `Pasar a ${L.GROUP_LABEL[other].toLowerCase()}`)),
          cards));
      } else {
        out.push(...cards);
      }
    }
    if (!items.length) out.push(emptyState({ emoji: '🏋️', title: 'Rutina vacía', text: 'Añade el primer ejercicio con el botón de abajo.' }));
    listEl.replaceChildren(...out);
    countEl.textContent = items.length ? plural(items.length, 'ejercicio', 'ejercicios') : '';
  }

  /** Vuelve a pintar solo la tarjeta de un ítem (p. ej. al desplegarla). */
  function refreshCard(id) {
    const old = listEl.querySelector(`[data-item="${id}"]`);
    const it = itemById(id);
    if (!old || !it) { renderList(); return; }
    old.replaceWith(itemCard(it, L.groupLabels(tpl.items)[id]));
  }

  function toggle(id) {
    const prev = expandedId;
    expandedId = prev === id ? null : id;
    if (prev && prev !== id) refreshCard(prev);
    refreshCard(id);
    if (expandedId) scrollToItem(id);
  }

  function itemCard(item, label) {
    const ex = store.exercise(item.exerciseId);
    const lt = ex?.logType || 'weight_reps';
    const open = expandedId === item.id;
    const targetEl = h('span.lib-item-target.tnum', L.targetText(item, lt) || '—');
    const alts = (item.alternatives || []).map((a) => exName(a) || 'Ejercicio eliminado');
    return h(`div.lib-item${open ? '.open' : ''}`, { dataset: { item: item.id } },
      h('button.lib-item-head', { type: 'button', 'aria-expanded': String(open), onClick: () => toggle(item.id) },
        label ? h('span.lib-item-label', label) : null,
        h('span.lib-item-main',
          h('span.lib-item-name', ex ? ex.name : 'Ejercicio eliminado', ex?.archived ? h('span.badge.lib-badge-inline', 'Archivado') : null),
          alts.length ? h('span.lib-item-alt', `o ${alts.join(' / ')}`) : null,
          !open && item.notes ? h('span.lib-item-note', item.notes) : null),
        targetEl,
        icon(open ? 'chevron-up' : 'chevron-down', 20, 'lib-item-chev')),
      open ? itemBody(item, ex, lt, targetEl) : null);
  }

  // --- cuerpo desplegado de un ítem ---
  function itemBody(item, ex, lt, targetEl) {
    const fam = L.targetFamily(lt);
    const id = item.id;
    const paintTarget = () => { targetEl.textContent = L.targetText(item, lt) || '—'; };
    const persist = (final) => {
      paintTarget();
      if (final) store.save('templates', tpl);
      else store.saveSoon('templates', tpl);
    };
    const body = h('div.lib-item-body');

    // Ejercicio (tocar → cambiarlo)
    body.appendChild(h('button.lib-ex-btn', { type: 'button', onClick: () => changeExercise(id) },
      h('span.lib-ex-btn-main', h('span.lib-ex-btn-k', 'Ejercicio'), h('span.lib-ex-btn-v', ex ? ex.name : 'Ejercicio eliminado')),
      h('span.lib-ex-btn-hint', icon('swap', 18), 'Cambiar')));

    // Objetivo
    const tgt = h('div.lib-target');
    if (fam !== 'cardio') {
      let maxTyped = false;
      const maxSt = stepper({
        label: 'Hasta (opcional)', value: item.setsMax > item.sets ? item.setsMax : null, placeholder: '—', min: 1, max: 20, step: 1,
        decimals: 0, inputmode: 'numeric', size: 'md', ariaLabel: 'Series máximas',
        onChange: (v, { final }) => {
          if (!final) {
            if (v != null && v > item.sets) { item.setsMax = Math.round(v); persist(false); }
            return;
          }
          const nv = L.stepSetsMax(item.sets, item.setsMax > item.sets ? item.setsMax : null, v == null ? null : Math.round(v), { typed: maxTyped });
          maxTyped = false;
          setKey(item, 'setsMax', nv);
          maxSt.setValue(nv);
          persist(true);
        },
      });
      maxSt.input.addEventListener('input', () => { maxTyped = true; });
      const setsSt = stepper({
        label: 'Series', value: item.sets ?? 1, min: 1, max: 20, step: 1, decimals: 0, inputmode: 'numeric', size: 'md', ariaLabel: 'Series',
        onChange: (v, { final }) => {
          if (v == null) { if (final) setsSt.setValue(item.sets); return; }
          item.sets = Math.round(v);
          if (item.setsMax != null && item.setsMax <= item.sets) { delete item.setsMax; maxSt.setValue(null); }
          persist(final);
        },
      });
      tgt.appendChild(h('div.grid-2.lib-pair', setsSt, maxSt));
    }
    if (fam === 'reps') {
      const uni = lt === 'unilateral';
      tgt.appendChild(rangePair(item, { kMin: 'repMin', kMax: 'repMax', lMin: uni ? 'Reps mín. /lado' : 'Reps mín.', lMax: uni ? 'Reps máx. /lado' : 'Reps máx.', step: 1, min: 1, max: 100, persist }));
    } else if (fam === 'time') {
      tgt.appendChild(rangePair(item, { kMin: 'timeMin', kMax: 'timeMax', lMin: 'Segundos mín.', lMax: 'Segundos máx.', aMin: 'Tiempo mín. (s)', aMax: 'Tiempo máx. (s)', step: 5, min: 5, max: 3600, persist }));
    } else if (fam === 'cardio') {
      tgt.appendChild(rangePair(item, { kMin: 'timeMin', kMax: 'timeMax', lMin: 'Minutos mín.', lMax: 'Minutos máx.', aMin: 'Duración mín. (min)', aMax: 'Duración máx. (min)', step: 5, min: 5, max: 600, scale: 60, persist }));
      tgt.appendChild(h('p.small.muted', 'En la sesión se registra como actividad (distancia, tiempo, FC…).'));
    } else if (fam === 'distance') {
      const dSt = stepper({
        label: 'Distancia (m)', value: item.distance ?? null, placeholder: '—', min: 1, max: 10000, step: 5, decimals: 0, inputmode: 'numeric', size: 'md', ariaLabel: 'Distancia en metros',
        onChange: (v, { final }) => { setKey(item, 'distance', v == null ? null : Math.round(v)); persist(final); },
      });
      tgt.appendChild(h('div.grid-2.lib-pair', dSt, h('div')));
    }
    body.appendChild(h('div.field', h('span.field-label', 'Objetivo'), tgt));

    // Alternativas
    const altWrap = h('div.lib-alts');
    const paintAlts = () => {
      altWrap.replaceChildren(
        ...(item.alternatives || []).map((aid) => h('button.chip.lib-alt', {
          type: 'button', 'aria-label': `Quitar alternativa ${exName(aid) || ''}`.trim(), onClick: () => removeAlt(id, aid),
        }, h('span', exName(aid) || 'Ejercicio eliminado'), icon('x', 16))),
        h('button.chip.lib-alt-add', { type: 'button', onClick: () => addAlt(id) }, icon('plus', 16), 'Añadir alternativa'));
    };
    paintAlts();
    body.appendChild(h('div.field', h('span.field-label', 'Alternativas'), altWrap,
      h('span.field-hint', 'En la sesión podrás elegir cuál hiciste.')));

    // Notas
    body.appendChild(field('Notas', textInput({
      multiline: true, rows: 2, value: item.notes || '', placeholder: 'p. ej. pausa abajo, agarre neutro…', ariaLabel: 'Notas del ejercicio',
      onInput: (v) => { const it = itemById(id); if (it) { it.notes = v; store.saveSoon('templates', tpl); } },
    })));

    // Sección
    const secInp = textInput({
      value: item.section || '', placeholder: 'Sin sección (p. ej. Bloque potencia)', ariaLabel: 'Sección', maxlength: 40,
      onInput: (v) => { const it = itemById(id); if (it) { it.section = v; store.saveSoon('templates', tpl); } },
    });
    secInp.addEventListener('change', () => commit(L.setSection(tpl.items, indexOf(id), secInp.value)));
    const others = L.sectionsOf(tpl.items).filter((s) => s !== (item.section || '').trim());
    body.appendChild(h('div.field', h('span.field-label', 'Sección'), secInp,
      others.length ? h('div.chips.lib-sec-chips', others.map((s) => h('button.chip', { type: 'button', onClick: () => commit(L.setSection(tpl.items, indexOf(id), s)) }, s))) : null,
      item.groupId ? h('span.field-hint', 'Se aplica a todo el grupo.') : null));

    // Agrupación
    const idx = indexOf(id);
    const next = tpl.items[idx + 1];
    const grp = h('div.lib-grp-actions');
    if (next && (!item.groupId || next.groupId !== item.groupId)) {
      grp.appendChild(h('button.btn.btn-secondary.lib-grp-btn', { type: 'button', onClick: () => groupNext(id) }, icon('link', 18),
        item.groupId ? 'Añadir el siguiente al grupo' : 'Agrupar con el siguiente'));
    }
    if (item.groupId) {
      grp.appendChild(h('button.btn.btn-ghost.lib-grp-btn', { type: 'button', onClick: () => commit(L.ungroupItem(tpl.items, indexOf(id))) }, icon('x', 18), 'Sacar del grupo'));
    }
    if (grp.childElementCount) body.appendChild(h('div.field', h('span.field-label', 'Superserie / circuito'), grp));

    // Mover, duplicar, quitar
    const act = (ic, label, disabled, fn, cls = '') => h(`button.lib-act${cls}`, { type: 'button', disabled, 'aria-label': label, onClick: fn }, icon(ic, 20), h('span', label));
    body.appendChild(h('div.lib-item-actions',
      act('arrow-up', 'Subir', !L.canMove(tpl.items, idx, -1), () => moveBy(id, -1)),
      act('arrow-down', 'Bajar', !L.canMove(tpl.items, idx, 1), () => moveBy(id, 1)),
      act('copy', 'Duplicar', false, () => duplicateItem(id)),
      act('trash', 'Quitar', false, () => removeItem(id), '.danger')));
    return body;
  }

  /**
   * Par de steppers mín–máx (reps, segundos o minutos). `scale` convierte la unidad mostrada a la guardada.
   * lMin/lMax: etiquetas visibles (cortas, caben en una línea); aMin/aMax: etiquetas accesibles (por defecto, las mismas).
   */
  function rangePair(item, { kMin, kMax, lMin, lMax, aMin = lMin, aMax = lMax, step, min, max, scale = 1, persist }) {
    const view = (v) => (v == null ? null : Math.round((v / scale) * 100) / 100);
    const steps = {};
    const start = {}; // valor antes de empezar a tocar (para saber si se partió de vacío)
    const typed = {};
    const handle = (which) => (v, { final }) => {
      const key = which === 'min' ? kMin : kMax;
      if (start[which] === undefined) start[which] = item[key] ?? null;
      const val = v == null ? null : Math.round(v * scale);
      if (!final) { setKey(item, key, val); persist(false); return; }
      const fromEmpty = start[which] == null && !typed[which];
      start[which] = undefined;
      typed[which] = false;
      const [a, b] = L.rangeChange(item[kMin] ?? null, item[kMax] ?? null, which, val, { fromEmpty });
      setKey(item, kMin, a);
      setKey(item, kMax, b);
      steps.min.setValue(view(a));
      steps.max.setValue(view(b));
      persist(true);
    };
    const mk = (which, label, ariaLabel) => stepper({
      label, value: view(item[which === 'min' ? kMin : kMax]), placeholder: '—', step, min, max, decimals: 0,
      inputmode: 'numeric', size: 'md', ariaLabel, onChange: handle(which),
    });
    steps.min = mk('min', lMin, aMin);
    steps.max = mk('max', lMax, aMax);
    for (const w of ['min', 'max']) steps[w].input.addEventListener('input', () => { typed[w] = true; });
    return h('div.grid-2.lib-pair', steps.min, steps.max);
  }

  // --- acciones sobre ítems ---
  async function addExercise() {
    const eid = await pickExercise({ title: 'Añadir ejercicio' });
    if (!eid || !content.isConnected) return;
    const last = tpl.items[tpl.items.length - 1];
    const it = L.newItem(eid, store.exercise(eid)?.logType, { section: last?.section || '' });
    expandedId = it.id;
    commit([...tpl.items, it]);
    scrollToItem(it.id);
  }

  async function changeExercise(id) {
    const cur = itemById(id);
    if (!cur) return;
    const eid = await pickExercise({ title: 'Cambiar ejercicio', excludeIds: [cur.exerciseId], preferIds: cur.alternatives || [] });
    const it = itemById(id);
    if (!eid || !it || !content.isConnected) return;
    const before = deepClone(it);
    const items = [...tpl.items];
    items[indexOf(id)] = L.changeItemExercise(it, eid, store.exercise(it.exerciseId)?.logType, store.exercise(eid)?.logType);
    commit(items);
    // Cambiar de tipo (p. ej. a una plancha o a cardio) quita el objetivo de series y reps: se puede deshacer.
    undoToast(`Cambiado a «${exName(eid) || 'Ejercicio'}»`, () => {
      const t = store.get('templates', tpl.id);
      const i = t ? t.items.findIndex((x) => x.id === id) : -1;
      if (i < 0) return;
      t.items = t.items.map((x, k) => (k === i ? before : x));
      store.save('templates', t);
      if (listEl.isConnected) renderList();
    });
  }

  async function addAlt(id) {
    const it = itemById(id);
    if (!it) return;
    const eid = await pickExercise({ title: 'Añadir alternativa', excludeIds: [it.exerciseId, ...(it.alternatives || [])] });
    const cur = itemById(id);
    if (!eid || !cur || !content.isConnected) return;
    cur.alternatives = [...(cur.alternatives || []), eid];
    store.save('templates', tpl);
    refreshCard(id);
  }

  function removeAlt(id, aid) {
    const it = itemById(id);
    if (!it) return;
    const before = [...(it.alternatives || [])];
    it.alternatives = before.filter((a) => a !== aid);
    store.save('templates', tpl);
    refreshCard(id);
    undoToast(`Alternativa «${exName(aid) || ''}» quitada`, () => {
      const t = store.get('templates', tpl.id);
      const x = t && t.items.find((y) => y.id === id);
      if (!x) return;
      x.alternatives = before;
      store.save('templates', t);
      if (listEl.isConnected) refreshCard(id);
    });
  }

  async function groupNext(id) {
    const idx = indexOf(id);
    const it = tpl.items[idx];
    const next = tpl.items[idx + 1];
    if (!it || !next) return;
    let type = it.groupType || next.groupType;
    if (!it.groupId && !next.groupId) type = await chooseGroupType();
    if (!type || !content.isConnected) return;
    commit(L.groupWithNext(tpl.items, indexOf(id), type));
  }

  function moveBy(id, dir) {
    const next = L.moveItem(tpl.items, indexOf(id), dir);
    if (next === tpl.items) return;
    commit(next);
    scrollToItem(id);
  }

  function duplicateItem(id) {
    const copyId = uid('ti_');
    expandedId = copyId;
    commit(L.duplicateItem(tpl.items, indexOf(id), () => copyId));
    scrollToItem(copyId);
    toast('Ejercicio duplicado', { kind: 'success', duration: 2000 });
  }

  function removeItem(id) {
    const before = deepClone(tpl.items);
    const name = exName(itemById(id)?.exerciseId) || 'Ejercicio';
    commit(L.removeItem(tpl.items, indexOf(id)));
    undoToast(`«${name}» quitado de la rutina`, () => {
      const t = store.get('templates', tpl.id);
      if (!t) return;
      t.items = L.undoRemove(t.items, before, id);
      store.save('templates', t);
      if (listEl.isConnected) renderList();
    });
  }

  // --- menú de la rutina ---
  function openMenu() {
    actionSheet({
      title: tpl.name,
      actions: [
        { label: 'Empezar ahora', icon: 'play', onClick: () => startTemplateNow(tpl) },
        { label: 'Duplicar rutina', icon: 'copy', onClick: () => duplicateTemplateAction(tpl) },
        { label: 'Borrar rutina', icon: 'trash', danger: true, onClick: () => deleteTemplateAction(tpl, { after: () => back(LIST_HREF) }) },
      ],
    });
  }

  renderList();

  // Al salir: una rutina recién creada y sin tocar se descarta (no contiene nada).
  return () => {
    if (!isNew || !store.get('templates', tpl.id)) return;
    if (location.hash.startsWith(`#/template/${tpl.id}`)) return;
    const pristine = !tpl.items.length && !(tpl.notes || '').trim() && tpl.name === initialName;
    if (pristine) {
      store.remove('templates', tpl.id);
      toast('Rutina vacía descartada', { duration: 2500 });
    }
  };
}
