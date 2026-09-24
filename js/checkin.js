// checkin.js — check-in opcional: sueño, energía y agujetas, cada uno Bajo · Normal · Alto (1/2/3).
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
//     Al contestar las tres preguntas se pliega sola mostrando el resumen.
//   - compact:true → las tres filas a la vista (para una hoja, p. ej. «Terminar sesión»): 3 toques.
//   Opciones extra: open (empieza desplegada), title (otro título), ignoreDismissed (mostrar aunque se
//   omitiera), skippable (false = sin «Omitir»), onChange(record|null) tras cada guardado.
// checkinSummary({ date, sessionId }) → HTMLElement | null — bloque de solo lectura (antes / después) con
//   «Editar check-in»; null si ese día no hay ninguno.
// moveSessionCheckins(sessionId, from, to) — al cambiar la fecha de una sesión, sus check-ins van con ella.
import * as store from './store.js';
import { h, icon, segmented, toast, sheet } from './ui.js';
import { todayStr, addDays, isDateStr } from './util.js';
import {
  TIMINGS, FIELDS, LEVEL_OPTIONS, TIMING_LABEL, TIMING_SHORT, level, checkinFor, hasValues, isComplete, checkinText,
  applyValue, dismissKey, valueWord,
} from './checkin-logic.js';

export * from './checkin-logic.js';

/** La línea que explica para qué sirve (se muestra en la tarjeta y en el resumen). */
export const CHECKIN_HINT = 'Solo se usa como contexto en el panel semanal y en la sugerencia de descarga.';

/** Un segundo toque sobre el mismo botón en este margen es un doble toque accidental: no quita el valor. */
const DOUBLE_TAP_MS = 450;
/** Tras contestar la tercera pregunta, la tarjeta se pliega sola (se ve un instante lo elegido). */
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
  const { record, empty } = applyValue(store.all('checkins'), key, field, value);
  if (!record) return null;
  if (empty) {
    // Sin ningún valor no aporta nada: se elimina (lo único que se pierde es lo que se acaba de quitar).
    if (store.get('checkins', record.id)) store.remove('checkins', record.id).catch(() => {});
    return null;
  }
  store.save('checkins', record).catch(() => {});
  return record;
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
      hint);
  } else {
    stateEl = h('span.ci-state', { 'aria-hidden': 'true' });
    toggle = h('button.ci-toggle', { type: 'button', onClick: () => setOpen(!isOpen) },
      h('span.ci-title', ttl),
      icon('check', 16, 'ci-ok'),
      stateEl,
      icon('chevron-down', 20, 'ci-chev'));
    body = h('div.ci-body', { hidden: !isOpen }, rowsEl, hint);
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
  function render() {
    const all = store.all('checkins');
    const items = TIMINGS.map((t) => ({ t, c: checkinFor(all, date, t) })).filter((x) => hasValues(x.c));
    el.hidden = !items.length;
    el.replaceChildren(...(items.length ? [
      h('h2.section-title', 'Check-in'),
      h('div.card.ci-sum',
        h('div.ci-sum-grid', { role: 'table', 'aria-label': 'Check-in de este día' },
          h('div.ci-sum-row', { role: 'row' }, h('span', { role: 'columnheader' }),
            FIELDS.map((f) => h('span.ci-sum-k', { role: 'columnheader' }, f.label))),
          items.map(({ t, c }) => h('div.ci-sum-row', { role: 'row', dataset: { timing: t }, title: checkinText(c) },
            h('span.ci-sum-when', { role: 'rowheader' }, TIMING_SHORT[t]),
            FIELDS.map((f) => h('span.ci-sum-v', { role: 'cell', dataset: { field: f.key } }, valueWord(f.key, c[f.key]) || '—'))))),
        h('p.ci-hint', CHECKIN_HINT),
        h('button.btn.btn-ghost.btn-block.ci-sum-edit', { type: 'button', onClick: edit }, icon('edit', 18), 'Editar check-in')),
    ] : []));
  }
  function edit() {
    sheet({
      title: 'Check-in',
      className: 'ci-sheet',
      body: h('div.stack.ci-sheet-body', TIMINGS.map((t) => checkinCard({
        date, timing: t, sessionId, compact: true, title: TIMING_LABEL[t], ignoreDismissed: true, skippable: false,
      }))),
      actions: [{ label: 'Listo', kind: 'primary' }],
      onClose: render,
    });
  }
  render();
  return el.hidden ? null : el;
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
