// checkin.js — check-in opcional: sueño, energía, estrés y agujetas, cada uno Bajo · Normal · Alto (1/2/3), y agujetas o
// molestias por zona (0–10, opcional; ronda 6, docs/MEJORAS6.md).
// PROPIETARIO: módulo de check-in. Lógica pura en ./checkin-logic.js (reexportada aquí).
//
// CONTRATO: checkinCard({ date, timing: 'pre'|'post', sessionId, compact }) → HTMLElement | null
//   - Guardado al instante en la store 'checkins' (uno por día y momento: si ya existe, se edita el mismo).
//     Tocar el valor elegido lo quita; si no queda ninguno, el registro vacío se elimina (no guarda nada).
//   - «Omitir» lo oculta para esa sesión/día SIN guardar ningún check-in: se recuerda en la sesión
//     (session.checkinDismissed = { pre?: true, post?: true }) y en localStorage para ese día y momento
//     (así tampoco vuelve a salir en Hoy). Devuelve null si está omitido y no hay nada guardado.
//   - compact:false (por defecto) → tarjeta plegable de una línea (44 px) que se despliega al tocarla: no añade
//     ningún toque obligatorio a la pantalla donde va (p. ej. arriba de la sesión, sobre «Registrar serie»).
//     Al contestar las cuatro preguntas se pliega sola mostrando el resumen.
//   - compact:true → las cuatro filas a la vista (para una hoja, p. ej. «Terminar sesión»): 4 toques.
//   - Debajo de las filas, «Agujetas o molestias por zona» (opcional): fichas con lo apuntado y «Añadir zona», que abre
//     una hoja (mapa corporal o articulación, lado, 0–10 y nota).
//   Opciones extra: open (empieza desplegada), title (otro título), ignoreDismissed (mostrar aunque se
//   omitiera), skippable (false = sin «Omitir»), onChange(record|null) tras cada guardado.
// checkinSummary({ date, sessionId }) → HTMLElement | null — bloque de solo lectura (antes / después; sin sesión,
//   «Ese día») con «Editar check-in»; null si ese día no hay ninguno.
// moveSessionCheckins(sessionId, from, to) — al cambiar la fecha de una sesión, sus check-ins van con ella.
import * as store from './store.js';
import { h, icon, segmented, chips, textInput, toast, sheet, undoToast } from './ui.js';
import { todayStr, addDays, isDateStr, deepClone } from './util.js';
import {
  TIMINGS, FIELDS, LEVEL_OPTIONS, TIMING_LABEL, TIMING_SHORT, level, checkinFor, hasValues, isComplete, checkinText,
  applyValue, dismissKey, valueWord, AREA_KINDS, JOINTS, SIDES, AREA_MIN, AREA_MAX, areasOf, areaText, areaShort, areaName,
  levelBand, validateArea, upsertArea, removeArea,
} from './checkin-logic.js';

export * from './checkin-logic.js';

/** La línea que explica para qué sirve (se muestra en la tarjeta y en el resumen). */
export const CHECKIN_HINT = 'Solo lo ves tú. Sirve para tu análisis de recuperación y el panel semanal.';

/** Un segundo toque sobre el mismo botón en este margen es un doble toque accidental: no quita el valor. */
const DOUBLE_TAP_MS = 450;
/** Tras contestar la última pregunta, la tarjeta se pliega sola (se ve un instante lo elegido). */
const AUTO_COLLAPSE_MS = 600;

function titleFor(date, timing) {
  const isToday = date === todayStr();
  if (timing === 'post') return isToday ? '¿Cómo ha ido?' : '¿Cómo fue?';
  return isToday ? '¿Cómo llegas hoy?' : '¿Cómo llegaste?';
}

// ---------------------------------------------------------------------------
// «Omitir» (no guarda ningún check-in)
// ---------------------------------------------------------------------------
function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, on) {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch { /* modo privado o almacenamiento bloqueado: basta con la sesión */ }
}
/** Olvida los «Omitir» de hace más de una semana (no crecen sin límite). */
function pruneDismissed(date) {
  try {
    const limit = addDays(isDateStr(date) ? date : todayStr(), -7);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const m = /^entreno:checkin-omitido:(\d{4}-\d{2}-\d{2}):/.exec(localStorage.key(i) || '');
      if (m && m[1] < limit) localStorage.removeItem(localStorage.key(i));
    }
  } catch { /* sin almacenamiento */ }
}

/** ¿Se pulsó «Omitir» para esa sesión (o ese día y momento)? */
export function isDismissed({ date, timing = 'pre', sessionId = null } = {}) {
  const s = sessionId ? store.get('sessions', sessionId) : null;
  if (s?.checkinDismissed?.[timing]) return true;
  return lsGet(dismissKey(date, timing)) === '1';
}

/** Marca o desmarca «Omitir» (en la sesión, si la hay, y para ese día). */
export function setDismissed({ date, timing = 'pre', sessionId = null } = {}, on = true) {
  const s = sessionId ? store.get('sessions', sessionId) : null;
  if (s) {
    const d = { ...(s.checkinDismissed || {}) };
    if (on) d[timing] = true;
    else delete d[timing];
    if (Object.keys(d).length) s.checkinDismissed = d;
    else delete s.checkinDismissed;
    store.save('sessions', s).catch(() => {}); // el error de guardado ya lo avisa app.js
  }
  lsSet(dismissKey(date, timing), on);
  if (on) pruneDismissed(date);
}

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------
function current(date, timing) {
  return checkinFor(store.all('checkins'), date, timing);
}

/** Aplica un toque y lo guarda ya. → el registro guardado, o null si ya no queda ninguno. */
function saveValue(key, field, value) {
  return persist(applyValue(store.all('checkins'), key, field, value));
}

/** Guarda el resultado de un cambio; sin ningún valor no aporta nada y se elimina. → el registro o null. */
function persist({ record, empty }) {
  if (!record) return null;
  if (empty) {
    if (store.get('checkins', record.id)) store.remove('checkins', record.id).catch(() => {});
    return null;
  }
  store.save('checkins', record).catch(() => {});
  return record;
}

// ---------------------------------------------------------------------------
// Agujetas o molestias por zona (hoja)
// ---------------------------------------------------------------------------
/**
 * Hoja para añadir o editar una zona: agujetas (músculo, en el mapa corporal) o molestia (articulación), lado
 * (opcional), intensidad 0–10 y nota. onDone(record|null) tras guardar o quitar.
 */
export function areaSheet({ date, timing = 'pre', sessionId = null, area = null, onDone = null } = {}) {
  const key = { date, timing, sessionId };
  const draft = area ? { ...area } : { kind: 'muscle', zone: null, side: null, level: null, note: '' };
  const err = h('p.form-error.ci-area-err', { hidden: true, role: 'alert' });
  const zoneSlot = h('div.ci-area-zone');
  const marksNow = () => Object.fromEntries(areasOf(current(date, timing)).filter((a) => a.kind === 'muscle')
    .map((a) => [a.zone, levelBand(a.level)]));

  async function paintZone() {
    if (draft.kind === 'joint') {
      zoneSlot.replaceChildren(chips({
        options: JOINTS.map((j) => ({ value: j.id, label: j.label })), value: draft.zone && JOINTS.some((j) => j.id === draft.zone) ? draft.zone : null,
        className: 'ci-area-joints', onChange: (v) => { draft.zone = v; },
      }));
      return;
    }
    // El mapa corporal se carga al abrir la hoja (no retrasa Hoy).
    zoneSlot.replaceChildren(h('p.ci-hint', 'Cargando el mapa…'));
    const { bodyMap } = await import('./bodymap.js');
    if (draft.kind !== 'muscle') return;
    const map = bodyMap({
      legend: false, compact: true, marks: marksNow(), selected: draft.zone,
      label: 'Mapa corporal: toca el músculo con agujetas',
      emptyHint: 'Toca el músculo con agujetas.',
      describe: (id) => areaName({ kind: 'muscle', zone: id }),
      onSelect: (id) => { draft.zone = id; },
    });
    zoneSlot.replaceChildren(map);
  }

  const kindSeg = segmented({
    options: AREA_KINDS.map((k) => ({ value: k.id, label: k.label })), value: draft.kind, ariaLabel: 'Qué es',
    onChange: (v) => { if (v !== draft.kind) { draft.kind = v; draft.zone = null; paintZone(); } },
  });
  kindSeg.classList.add('ci-area-kind');
  const body = h('div.stack.ci-area-body',
    kindSeg,
    zoneSlot,
    h('div.field', h('span.field-label', 'Lado (opcional)'),
      chips({ options: SIDES.map((x) => ({ value: x.id, label: x.label })), value: draft.side, allowNone: true, className: 'ci-area-side', onChange: (v) => { draft.side = v; } })),
    h('div.field', h('span.field-label', 'Intensidad'),
      chips({
        options: Array.from({ length: AREA_MAX - AREA_MIN + 1 }, (_, i) => ({ value: AREA_MIN + i, label: String(AREA_MIN + i), className: 'chip-num' })),
        value: draft.level, className: 'ci-area-level', onChange: (v) => { draft.level = v; },
      }),
      h('span.field-hint', '0 nada · 10 lo máximo que has tenido')),
    h('label.field', h('span.field-label', 'Nota (opcional)'),
      textInput({ value: draft.note, maxlength: 200, placeholder: 'p. ej. tras el peso muerto rumano', ariaLabel: 'Nota', onInput: (v) => { draft.note = v; } })),
    err);
  paintZone();

  const actions = [{
    label: area ? 'Guardar' : 'Añadir', kind: 'primary',
    onClick: (close) => {
      const e = validateArea(draft);
      const msg = e.kind || e.zone || e.level;
      if (msg) { err.hidden = false; err.textContent = msg; return; }
      // La misma zona y lado ya apuntada (con otra intensidad o nota) se sustituye: con «Deshacer»
      const prev = checkinFor(store.all('checkins'), date, timing);
      const clash = areasOf(prev).find((x) => x.id !== draft.id && x.kind === draft.kind && x.zone === draft.zone && (x.side || null) === (draft.side || null));
      const snap = clash ? deepClone(prev) : null;
      const rec = persist(upsertArea(store.all('checkins'), key, draft));
      close();
      if (onDone) onDone(rec);
      if (snap) undoCheckin(snap, `Zona sustituida (antes: ${areaShort(clash)})`, onDone);
    },
  }];
  if (area) {
    actions.push({
      label: 'Quitar', kind: 'danger',
      onClick: (close) => {
        const prev = checkinFor(store.all('checkins'), date, timing);
        const snap = prev ? deepClone(prev) : null;
        const rec = persist(removeArea(store.all('checkins'), key, area.id));
        close();
        if (onDone) onDone(rec);
        if (snap) undoCheckin(snap, 'Zona quitada', onDone);
      },
    });
  }
  return sheet({ title: area ? 'Editar zona' : 'Agujetas o molestia', className: 'ci-area-sheet', body, actions, tall: true });
}

/** «Deshacer» de un cambio de zonas: deja el check-in exactamente como estaba (también si se había borrado). */
function undoCheckin(snap, message, onDone) {
  undoToast(message, () => {
    const rec = deepClone(snap);
    store.restore('checkins', rec);
    if (onDone) onDone(rec);
  });
}

/** Bloque de zonas de un check-in: fichas (tocar = editar) y «Añadir zona». */
function zonesBlock({ date, timing, sessionId, onChange }) {
  const el = h('div.ci-zones');
  function paint() {
    const list = areasOf(current(date, timing));
    el.dataset.count = String(list.length);
    // replaceChildren nativo escribiría «null» como texto: solo los nodos que existen
    el.replaceChildren(...[
      h('div.ci-zones-head', h('span.ci-zones-title', 'Agujetas o molestias por zona'), h('span.ci-copt', 'Opcional')),
      list.length ? h('div.ci-zone-list', list.map((a) => h(`button.ci-zone.ci-band-${levelBand(a.level)}`, {
        type: 'button', dataset: { zone: a.zone, kind: a.kind }, 'aria-label': `Editar ${areaText(a)}`,
        onClick: () => areaSheet({ date, timing, sessionId, area: a, onDone: done }),
      }, areaShort(a)))) : null,
      h('button.btn.btn-ghost.btn-sm.ci-zone-add', { type: 'button', onClick: () => areaSheet({ date, timing, sessionId, onDone: done }) },
        icon('plus', 18), list.length ? 'Otra zona' : 'Añadir zona'),
    ].filter(Boolean));
  }
  function done(rec) {
    paint();
    if (onChange) onChange(rec);
  }
  el.repaint = paint;
  paint();
  return el;
}

// ---------------------------------------------------------------------------
// Tarjeta
// ---------------------------------------------------------------------------
export function checkinCard({
  date = todayStr(), timing = 'pre', sessionId = null, compact = false,
  open = false, title = null, ignoreDismissed = false, skippable = true, onChange = null,
} = {}) {
  if (!isDateStr(date)) return null;
  if (!TIMINGS.includes(timing)) timing = 'pre';
  const key = { date, timing, sessionId };
  if (!ignoreDismissed && !hasValues(current(date, timing)) && isDismissed(key)) return null;

  const ttl = title || titleFor(date, timing);
  const segs = new Map();
  const lastTap = new Map();
  let isOpen = compact || !!open;
  let completeAtOpen = isComplete(current(date, timing));
  let collapseTimer = null;

  function pick(field, v) {
    const now = performance.now();
    const prev = level(current(date, timing)?.[field.key]);
    const seg = segs.get(field.key);
    let next = v;
    if (v === prev) {
      // Tocar el valor elegido lo quita… salvo en un doble toque accidental.
      if (now - (lastTap.get(field.key) ?? -Infinity) < DOUBLE_TAP_MS) { lastTap.set(field.key, now); return; }
      next = null;
      seg.setValue(null);
    }
    lastTap.set(field.key, now);
    const rec = saveValue(key, field.key, next);
    paint();
    if (onChange) onChange(rec);
    if (!compact && isOpen && !completeAtOpen && isComplete(rec)) {
      clearTimeout(collapseTimer);
      collapseTimer = setTimeout(() => { if (el.isConnected && isOpen) setOpen(false); }, AUTO_COLLAPSE_MS);
    }
  }

  const rows = FIELDS.map((f) => {
    const seg = segmented({
      options: LEVEL_OPTIONS,
      value: level(current(date, timing)?.[f.key]),
      ariaLabel: f.label,
      onChange: (v) => pick(f, v),
    });
    seg.classList.add('ci-seg');
    segs.set(f.key, seg);
    return h('div.ci-row', { dataset: { field: f.key } }, h('span.ci-label', f.label), seg);
  });
  const rowsEl = h('div.ci-rows', rows);
  const zones = zonesBlock({ date, timing, sessionId, onChange: (rec) => { paint(); if (onChange) onChange(rec); } });
  const hint = h('p.ci-hint', CHECKIN_HINT);

  const skipBtn = skippable ? h('button.ci-skip', { type: 'button', onClick: () => skip() }, 'Omitir') : null;
  let el;
  let toggle = null;
  let stateEl = null;
  let body = null;

  if (compact) {
    el = h('div.ci-compact', { dataset: { checkin: timing }, role: 'group', 'aria-label': `${ttl} Check-in ${TIMING_LABEL[timing].toLowerCase()}` },
      h('div.ci-chead',
        h('div.ci-chead-main', h('span.field-label.ci-ctitle', ttl), h('span.ci-copt', 'Opcional')),
        skipBtn),
      rowsEl,
      zones,
      hint);
  } else {
    stateEl = h('span.ci-state', { 'aria-hidden': 'true' });
    toggle = h('button.ci-toggle', { type: 'button', onClick: () => setOpen(!isOpen) },
      h('span.ci-title', ttl),
      icon('check', 16, 'ci-ok'),
      stateEl,
      icon('chevron-down', 20, 'ci-chev'));
    body = h('div.ci-body', { hidden: !isOpen }, rowsEl, zones, hint);
    el = h('section.ci-card', { dataset: { checkin: timing }, 'aria-label': `Check-in ${TIMING_LABEL[timing].toLowerCase()}` },
      h('div.ci-bar', toggle, skipBtn),
      body);
  }

  function setOpen(v) {
    clearTimeout(collapseTimer);
    isOpen = v;
    if (v) completeAtOpen = isComplete(current(date, timing));
    paint();
  }

  function paint() {
    const rec = current(date, timing);
    const has = hasValues(rec);
    el.classList.toggle('ci-has', has);
    el.classList.toggle('ci-open', isOpen);
    el.dataset.state = has ? (isComplete(rec) ? 'complete' : 'partial') : 'empty';
    if (skipBtn) skipBtn.hidden = has;
    if (!compact) {
      body.hidden = !isOpen;
      toggle.setAttribute('aria-expanded', String(isOpen));
      // Plegada y contestada: «Sueño / Normal · Energía / Alta · Agujetas / Bajas» en la misma franja de 44 px.
      stateEl.replaceChildren(...(has && !isOpen ? FIELDS.map((f) => h('span.ci-mini', { dataset: { field: f.key } },
        h('span.ci-mini-k', f.label), h('span.ci-mini-v', valueWord(f.key, rec[f.key]) || '—'))) : []));
      toggle.setAttribute('aria-label', `${ttl} ${has ? `${checkinText(rec)}.` : 'Check-in opcional.'} ${isOpen ? 'Plegar' : 'Desplegar'}`);
    }
  }

  function skip() {
    setDismissed(key, true);
    el.hidden = true;
    toast('Check-in omitido: no se guarda nada.', {
      actionLabel: 'Deshacer',
      duration: 5000,
      onAction: () => { setDismissed(key, false); el.hidden = false; },
    });
  }

  paint();
  return el;
}

// ---------------------------------------------------------------------------
// Resumen de una sesión (solo lectura, con «Editar check-in»)
// ---------------------------------------------------------------------------
export function checkinSummary({ date, sessionId = null } = {}) {
  if (!isDateStr(date)) return null;
  const el = h('div.ci-sum-wrap');
  let single = false;
  function render() {
    const all = store.all('checkins');
    const items = TIMINGS.map((t) => ({ t, c: checkinFor(all, date, t) })).filter((x) => hasValues(x.c));
    // Sin sesión de fuerza (p. ej. desde Hoy o el calendario) no hay «antes» ni «después»: es el de ese día.
    single = !sessionId && items.every((x) => x.t === 'pre');
    const when = (t) => (single ? 'Ese día' : TIMING_SHORT[t]);
    el.hidden = !items.length;
    el.replaceChildren(...(items.length ? [
      h('h2.section-title', 'Check-in'),
      h('div.card.ci-sum',
        h('div.ci-sum-grid', { role: 'table', 'aria-label': 'Check-in de este día' },
          h('div.ci-sum-row', { role: 'row' }, h('span', { role: 'columnheader' }),
            FIELDS.map((f) => h('span.ci-sum-k', { role: 'columnheader' }, f.label))),
          items.map(({ t, c }) => h('div.ci-sum-row', { role: 'row', dataset: { timing: t }, title: checkinText(c) },
            h('span.ci-sum-when', { role: 'rowheader' }, when(t)),
            FIELDS.map((f) => h('span.ci-sum-v', { role: 'cell', dataset: { field: f.key, label: f.label } }, valueWord(f.key, c[f.key]) || '—'))))),
        ...items.filter(({ c }) => areasOf(c).length).map(({ t, c }) => h('p.ci-sum-zones', { dataset: { timing: t } },
          items.length > 1 ? h('span.ci-sum-zones-when', `${when(t)}: `) : null, areasOf(c).map(areaText).join(' · '))),
        h('p.ci-hint', CHECKIN_HINT),
        h('button.btn.btn-ghost.btn-block.ci-sum-edit', { type: 'button', onClick: edit }, icon('edit', 18), 'Editar check-in')),
    ] : []));
  }
  function edit() {
    checkinEditSheet({ date, sessionId, timings: single ? ['pre'] : TIMINGS, onClose: render });
  }
  render();
  return el.hidden ? null : el;
}

/**
 * Hoja para editar (o crear) el check-in de un día: «Antes» y «Después» con sesión; sin sesión, uno solo («Ese día»,
 * guardado como 'pre'). Sin «Omitir». onClose al cerrarla.
 */
export function checkinEditSheet({ date, sessionId = null, timings = TIMINGS, onClose = null } = {}) {
  const single = timings.length === 1;
  return sheet({
    title: 'Check-in',
    className: 'ci-sheet',
    body: h('div.stack.ci-sheet-body', timings.map((t) => checkinCard({
      date, timing: t, sessionId, compact: true, title: single ? 'Ese día' : TIMING_LABEL[t], ignoreDismissed: true, skippable: false,
    }))),
    actions: [{ label: 'Listo', kind: 'primary' }],
    onClose,
  });
}

// ---------------------------------------------------------------------------
// Cambio de fecha de una sesión
// ---------------------------------------------------------------------------
/** Los check-ins de esa sesión en `from` pasan a `to` (sin pisar uno que ya exista ese día y momento). */
export function moveSessionCheckins(sessionId, from, to) {
  if (!sessionId || !isDateStr(from) || !isDateStr(to) || from === to) return 0;
  let moved = 0;
  for (const c of store.all('checkins')) {
    if (c.sessionId !== sessionId || c.date !== from) continue;
    if (checkinFor(store.all('checkins'), to, c.timing)) continue;
    c.date = to;
    store.save('checkins', c).catch(() => {});
    moved++;
  }
  return moved;
}
