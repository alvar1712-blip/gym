// ui.js — utilidades DOM y componentes comunes (tema oscuro, pensado para una mano).
import { back as routerBack } from './router.js';
import { numToInput, parseNum, clamp, round } from './util.js';

// ---------------------------------------------------------------------------
// h(): creación de elementos.
//   h('div.card.row', { onClick, dataset:{id:1}, style:{...}, hidden:true }, 'texto', otroNodo, [más])
// ---------------------------------------------------------------------------
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'readOnly', 'multiple', 'indeterminate']);

export function h(tag, attrs, ...children) {
  let [name, ...classes] = String(tag).split('.');
  let id = null;
  if (name.includes('#')) [name, id] = name.split('#');
  const isSvg = name === 'svg' || name === 'path' || name === 'circle' || name === 'line' || name === 'rect' || name === 'g' || name === 'polyline' || name === 'text';
  const el = isSvg ? document.createElementNS('http://www.w3.org/2000/svg', name) : document.createElement(name || 'div');
  if (id) el.id = id;
  if (classes.length) el.setAttribute('class', classes.join(' '));
  if (attrs && (attrs instanceof Node || Array.isArray(attrs) || typeof attrs !== 'object')) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) {
        if (PROPS.has(k)) el[k] = false;
        continue;
      }
      if (k === 'class' || k === 'className') {
        const cur = el.getAttribute('class');
        el.setAttribute('class', cur ? `${cur} ${v}` : v);
      } else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'html') {
        el.innerHTML = v;
      } else if (k === 'text') {
        el.textContent = v;
      } else if (k === 'on' && typeof v === 'object') {
        for (const [evt, fn] of Object.entries(v)) el.addEventListener(evt, fn);
      } else if (/^on[A-Z]/.test(k) && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (PROPS.has(k)) {
        el[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : v);
      }
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  el.replaceChildren();
  return el;
}

// ---------------------------------------------------------------------------
// Iconos (trazos 24×24, estilo lineal)
// ---------------------------------------------------------------------------
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18M6 6l12 12',
  'chevron-left': 'm15 18-6-6 6-6',
  'chevron-right': 'm9 18 6-6-6-6',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-up': 'm18 15-6-6-6 6',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  edit: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  upload: 'M12 21V9M7 14l5-5 5 5M5 3h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  dumbbell: 'M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  bolt: 'M13 2 3 14h9l-1 8 10-12h-9l1-8Z',
  swap: 'M7 16V4M3 8l4-4 4 4M17 8v12M13 16l4 4 4-4',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4M12 17h.01',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  note: 'M4 4h16v11l-5 5H4ZM15 20v-5h5',
  play: 'M7 4v16l13-8Z',
  flag: 'M4 22V4M4 4h13l-2 4 2 4H4',
  target: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12ZM12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  scale: 'M4 4h16v16H4ZM8.5 9.5a5 5 0 0 1 7 0L13 12h-2Z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  home: 'M3 11 12 3l9 8M5 9.5V21h14V9.5',
};

export function icon(name, size = 22, extraClass = '') {
  const d = ICONS[name] || ICONS.info;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', name === 'more' || name === 'grip' ? '3' : '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${extraClass}`.trim());
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}
export const ICON_NAMES = Object.keys(ICONS);

// ---------------------------------------------------------------------------
// Cabecera de pantalla
//   header({ title, subtitle, back: '#/fallback' | true, actions: [{icon, label, onClick}] | Node })
// ---------------------------------------------------------------------------
export function header({ title, subtitle = null, back = null, actions = [] } = {}) {
  const left = back
    ? h('button.icon-btn.back-btn', {
        type: 'button',
        'aria-label': 'Atrás',
        onClick: () => routerBack(typeof back === 'string' ? back : '#/today'),
      }, icon('chevron-left', 26))
    : null;
  const acts = (Array.isArray(actions) ? actions : [actions]).filter(Boolean).map((a) =>
    a instanceof Node
      ? a
      : h('button.icon-btn', { type: 'button', 'aria-label': a.label, title: a.label, onClick: a.onClick, class: a.className || '' },
          a.icon ? icon(a.icon, 24) : null, a.text ? h('span.icon-btn-text', a.text) : null),
  );
  return h('header.topbar',
    left,
    h('div.topbar-titles',
      h('h1', title),
      subtitle ? h('div.topbar-sub', subtitle) : null),
    acts.length ? h('div.topbar-actions', acts) : null,
  );
}

/** Estructura estándar de pantalla: cabecera + <div.content>. Devuelve el contenedor de contenido. */
export function screen(root, headerOpts) {
  const content = h('div.content');
  root.replaceChildren(header(headerOpts), content);
  return content;
}

// ---------------------------------------------------------------------------
// Bloqueo de scroll (para hojas modales en iOS)
// ---------------------------------------------------------------------------
let lockCount = 0;
let lockedY = 0;
function lockScroll() {
  if (lockCount++ > 0) return;
  lockedY = window.scrollY;
  const b = document.body.style;
  b.position = 'fixed';
  b.top = `-${lockedY}px`;
  b.left = '0';
  b.right = '0';
  b.overflow = 'hidden';
}
function unlockScroll() {
  if (--lockCount > 0) return;
  lockCount = 0;
  const b = document.body.style;
  b.position = '';
  b.top = '';
  b.left = '';
  b.right = '';
  b.overflow = '';
  window.scrollTo(0, lockedY);
}

// Altura del teclado de iOS → variable CSS --kb (las hojas se colocan encima).
if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const upd = () => {
    const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
  };
  vv.addEventListener('resize', upd);
  vv.addEventListener('scroll', upd);
}

// ---------------------------------------------------------------------------
// Hoja inferior (bottom sheet)
//   sheet({ title, body: Node | (close) => Node, actions: [{label, kind, onClick(close)}], onClose, dismissible })
//   → { el, body, close }
// ---------------------------------------------------------------------------
const openSheets = [];

export function sheet({ title = '', body = null, actions = [], onClose = null, dismissible = true, className = '', tall = false } = {}) {
  let closed = false;
  const bodyEl = h('div.sheet-body');
  const footer = actions.length ? h('div.sheet-actions') : null;
  const panel = h(`div.sheet-panel${tall ? '.sheet-tall' : ''}`, { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Diálogo', class: className },
    h('div.sheet-grabber'),
    title || dismissible
      ? h('div.sheet-head',
          h('h2.sheet-title', title),
          dismissible ? h('button.icon-btn', { type: 'button', 'aria-label': 'Cerrar', onClick: () => close() }, icon('x', 22)) : null)
      : null,
    bodyEl,
    footer,
  );
  const overlay = h('div.sheet-overlay', { onClick: (e) => { if (e.target === overlay && dismissible) close(); } }, panel);

  function close(result) {
    if (closed) return;
    closed = true;
    overlay.classList.remove('open');
    const i = openSheets.indexOf(api);
    if (i >= 0) openSheets.splice(i, 1);
    unlockScroll();
    setTimeout(() => overlay.remove(), 200);
    if (onClose) onClose(result);
  }
  const api = { el: panel, body: bodyEl, close, overlay, dismissible };

  const content = typeof body === 'function' ? body(close) : body;
  if (content) append(bodyEl, [content]);
  for (const a of actions) {
    footer.appendChild(h(`button.btn.btn-${a.kind || 'secondary'}${a.block === false ? '' : '.btn-block'}`, {
      type: 'button',
      onClick: () => (a.onClick ? a.onClick(close) : close()),
    }, a.label));
  }
  document.body.appendChild(overlay);
  lockScroll();
  openSheets.push(api);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return api;
}

export function closeAllSheets() {
  for (const s of [...openSheets]) s.close();
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openSheets.length) {
      const top = openSheets[openSheets.length - 1];
      if (top.dismissible) top.close();
    }
  });
}

/** Confirmación. requireText: texto que hay que escribir para confirmar (doble confirmación). */
export function confirmDialog({ title = '¿Seguro?', message = '', confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false, requireText = null } = {}) {
  return new Promise((resolve) => {
    let input = null;
    let okBtn = null;
    const s = sheet({
      title,
      onClose: (r) => resolve(r === true),
      body: () => {
        const box = h('div.stack');
        if (message) {
          for (const para of String(message).split('\n\n')) box.appendChild(h('p.sheet-msg', para));
        }
        if (requireText) {
          input = h('input.input', {
            type: 'text', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false',
            placeholder: requireText,
            onInput: () => { okBtn.disabled = input.value.trim().toUpperCase() !== requireText.toUpperCase(); },
          });
          box.appendChild(h('label.field', h('span.field-label', `Escribe ${requireText} para confirmar`), input));
        }
        okBtn = h(`button.btn.btn-block.${danger ? 'btn-danger' : 'btn-primary'}`, { type: 'button', disabled: !!requireText, onClick: () => s.close(true) }, confirmText);
        box.appendChild(h('div.sheet-actions.sheet-actions-inline',
          okBtn,
          h('button.btn.btn-block.btn-secondary', { type: 'button', onClick: () => s.close(false) }, cancelText)));
        return box;
      },
    });
  });
}

/** Pide un texto o número. Devuelve string o null si se cancela. */
export function promptDialog({ title = '', label = '', value = '', placeholder = '', inputmode = 'text', confirmText = 'Guardar', multiline = false } = {}) {
  return new Promise((resolve) => {
    let input;
    const done = (s) => s.close(input.value);
    const s = sheet({
      title,
      onClose: (r) => resolve(typeof r === 'string' ? r : null),
      body: () => {
        input = multiline
          ? h('textarea.input', { rows: 4, placeholder }, value)
          : h('input.input', { type: 'text', inputmode, value, placeholder, onKeydown: (e) => { if (e.key === 'Enter') done(s); } });
        return h('div.stack',
          h('label.field', label ? h('span.field-label', label) : null, input),
          h('button.btn.btn-primary.btn-block', { type: 'button', onClick: () => done(s) }, confirmText));
      },
    });
    setTimeout(() => input && input.focus(), 250);
  });
}

/** Menú de acciones. actions: [{label, icon?, danger?, disabled?, onClick}] */
export function actionSheet({ title = '', actions = [] } = {}) {
  const s = sheet({
    title,
    body: (close) => h('div.action-list',
      actions.filter(Boolean).map((a) => h(`button.action-item${a.danger ? '.danger' : ''}`, {
        type: 'button',
        disabled: a.disabled,
        onClick: () => { close(); setTimeout(() => a.onClick && a.onClick(), 10); },
      }, a.icon ? icon(a.icon, 22) : null, h('span', a.label), a.hint ? h('span.action-hint', a.hint) : null))),
  });
  return s;
}

// ---------------------------------------------------------------------------
// Toast (con acción opcional, p. ej. «Deshacer»)
// ---------------------------------------------------------------------------
let toastEl = null;
let toastTimer = null;

export function toast(message, { actionLabel = null, onAction = null, duration = 3500, kind = 'info' } = {}) {
  if (toastEl) { toastEl.remove(); toastEl = null; }
  clearTimeout(toastTimer);
  const el = h(`div.toast.toast-${kind}`, { role: 'status', 'aria-live': 'polite' },
    h('span.toast-msg', message),
    actionLabel ? h('button.toast-action', {
      type: 'button',
      onClick: () => { close(); onAction && onAction(); },
    }, actionLabel) : null);
  function close() {
    clearTimeout(toastTimer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
    if (toastEl === el) toastEl = null;
  }
  document.body.appendChild(el);
  toastEl = el;
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(close, duration);
  return { close };
}

/** Toast de «Eliminado · Deshacer». */
export function undoToast(message, onUndo, duration = 7000) {
  return toast(message, { actionLabel: 'Deshacer', onAction: onUndo, duration, kind: 'undo' });
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

/**
 * Campo numérico con botones −/+ grandes.
 * stepper({ value, step, min, max, decimals, inputmode, suffix, label, placeholder, showStep, onChange(v, {final}) })
 * Devuelve el elemento con .getValue() y .setValue(v).
 */
export function stepper({ value = null, step = 1, min = -Infinity, max = Infinity, decimals = 2, inputmode = 'decimal', suffix = '', label = '', placeholder = '', showStep = false, size = 'lg', onChange = () => {}, ariaLabel = '' } = {}) {
  let cur = value;
  const input = h('input.stepper-input', {
    type: 'text', inputmode, enterkeyhint: 'done', autocomplete: 'off', placeholder,
    value: numToInput(value, decimals),
    'aria-label': ariaLabel || label || 'valor',
  });
  const stepTxt = numToInput(step, 2);
  const mkBtn = (dir) => {
    const b = h('button.stepper-btn', { type: 'button', 'aria-label': `${dir > 0 ? 'Sumar' : 'Restar'} ${stepTxt}` },
      showStep ? h('span.stepper-step', `${dir > 0 ? '+' : '−'}${stepTxt}`) : icon(dir > 0 ? 'plus' : 'minus', 22));
    let holdTimer = null;
    let repeatTimer = null;
    let held = false;
    const stop = () => { clearTimeout(holdTimer); clearInterval(repeatTimer); holdTimer = repeatTimer = null; };
    b.addEventListener('pointerdown', () => {
      held = false;
      holdTimer = setTimeout(() => {
        held = true;
        repeatTimer = setInterval(() => bump(dir, false), 110);
      }, 500);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => b.addEventListener(ev, () => {
      const wasHeld = held;
      stop();
      if (wasHeld) onChange(cur, { final: true });
    }));
    b.addEventListener('click', () => {
      if (held) { held = false; return; }
      bump(dir, true);
    });
    return b;
  };
  function bump(dir, final) {
    const base = cur == null ? (Number.isFinite(min) && min > 0 ? min : 0) : cur;
    let next = round(base + dir * step, 10 ** -Math.max(decimals, 2));
    next = clamp(next, min, max);
    set(next);
    onChange(cur, { final });
  }
  function set(v) {
    cur = v;
    input.value = numToInput(v, decimals);
  }
  input.addEventListener('focus', () => setTimeout(() => { try { input.select(); } catch { /* iOS */ } }, 0));
  input.addEventListener('input', () => {
    cur = parseNum(input.value);
    onChange(cur, { final: false });
  });
  input.addEventListener('change', () => {
    let v = parseNum(input.value);
    if (v != null) v = clamp(v, min, max);
    set(v);
    onChange(cur, { final: true });
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  const el = h(`div.stepper.stepper-${size}`,
    label ? h('span.stepper-label', label) : null,
    h('div.stepper-row',
      mkBtn(-1),
      h('div.stepper-field', input, suffix ? h('span.stepper-suffix', suffix) : null),
      mkBtn(+1)));
  el.getValue = () => cur;
  el.setValue = (v) => set(v);
  el.input = input;
  return el;
}

/** Control segmentado. options: [{value, label}] */
export function segmented({ options, value, onChange = () => {}, size = '', ariaLabel = '' }) {
  let cur = value;
  const btns = options.map((o) => h('button.seg-btn', {
    type: 'button',
    'aria-pressed': String(o.value === cur),
    class: o.value === cur ? 'active' : '',
    onClick: () => { set(o.value); onChange(o.value); },
  }, o.label));
  function set(v) {
    cur = v;
    btns.forEach((b, i) => {
      const on = options[i].value === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  const el = h(`div.seg${size ? '.seg-' + size : ''}`, { role: 'group', 'aria-label': ariaLabel }, btns);
  el.getValue = () => cur;
  el.setValue = set;
  return el;
}

/**
 * Chips seleccionables. multi=true → value es array.
 * allowNone=true permite deseleccionar (value null).
 */
export function chips({ options, value = null, multi = false, allowNone = false, onChange = () => {}, className = '' }) {
  let cur = multi ? [...(value || [])] : value;
  const btns = options.map((o) => h('button.chip', {
    type: 'button',
    class: o.className || '',
    onClick: () => {
      if (multi) {
        cur = cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value];
      } else {
        cur = allowNone && cur === o.value ? null : o.value;
      }
      paint();
      onChange(cur);
    },
  }, o.label));
  function paint() {
    btns.forEach((b, i) => {
      const on = multi ? cur.includes(options[i].value) : cur === options[i].value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  paint();
  const el = h('div.chips', { class: className }, btns);
  el.getValue = () => cur;
  el.setValue = (v) => { cur = multi ? [...(v || [])] : v; paint(); };
  return el;
}

export const RPE_HINTS = {
  1: 'Muy muy suave', 2: 'Muy suave', 3: 'Suave', 4: 'Moderado', 5: 'Algo duro',
  6: 'Duro', 7: 'Muy duro', 8: 'Muy muy duro', 9: 'Casi máximo', 10: 'Máximo',
};

/** Selector de esfuerzo percibido 1–10. */
export function rpePicker({ value = null, onChange = () => {} } = {}) {
  const hint = h('div.rpe-hint.muted', value ? `${value} · ${RPE_HINTS[value]}` : 'Toca un valor (1 = muy suave, 10 = máximo)');
  const c = chips({
    options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1), className: 'chip-num' })),
    value,
    allowNone: true,
    className: 'rpe-chips',
    onChange: (v) => {
      hint.textContent = v ? `${v} · ${RPE_HINTS[v]}` : 'Sin valor';
      onChange(v);
    },
  });
  const el = h('div.rpe-picker', c, hint);
  el.getValue = c.getValue;
  el.setValue = (v) => { c.setValue(v); hint.textContent = v ? `${v} · ${RPE_HINTS[v]}` : 'Sin valor'; };
  return el;
}

/**
 * Entrada de duración con campos h / min / s.
 * durationInput({ seconds, onChange(totalSec|null), showHours, showSeconds })
 */
export function durationInput({ seconds = null, onChange = () => {}, showHours = true, showSeconds = true, ariaLabel = 'Duración' } = {}) {
  const parts = { h: null, m: null, s: null };
  if (seconds != null) {
    parts.h = showHours ? Math.floor(seconds / 3600) : 0;
    parts.m = showHours ? Math.floor((seconds % 3600) / 60) : Math.floor(seconds / 60);
    parts.s = Math.round(seconds % 60);
  }
  const mk = (key, lbl, max) => {
    const inp = h('input.dur-input', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: key === 'h' ? 3 : 2,
      value: seconds != null ? String(key === 'h' ? parts.h : String(parts[key]).padStart(key === 'h' ? 1 : 2, '0')) : '',
      placeholder: key === 'h' ? '0' : '00',
      'aria-label': `${ariaLabel}: ${lbl}`,
    });
    inp.addEventListener('focus', () => setTimeout(() => { try { inp.select(); } catch { /* iOS */ } }, 0));
    inp.addEventListener('input', () => {
      const v = inp.value.replace(/\D/g, '');
      if (v !== inp.value) inp.value = v;
      parts[key] = v === '' ? null : Math.min(Number(v), max);
      emit();
    });
    return h('label.dur-part', inp, h('span.dur-unit', lbl));
  };
  function total() {
    if (parts.h == null && parts.m == null && parts.s == null) return null;
    return (parts.h || 0) * 3600 + (parts.m || 0) * 60 + (showSeconds ? parts.s || 0 : 0);
  }
  function emit() { onChange(total()); }
  const el = h('div.dur', { role: 'group', 'aria-label': ariaLabel },
    showHours ? mk('h', 'h', 999) : null,
    mk('m', 'min', showHours ? 59 : 999),
    showSeconds ? mk('s', 's', 59) : null);
  el.getValue = total;
  return el;
}

/** Campo con etiqueta. */
export function field(label, control, hint = null) {
  return h('label.field', label ? h('span.field-label', label) : null, control, hint ? h('span.field-hint', hint) : null);
}

/** Campo de texto simple. onInput(value) en cada pulsación. */
export function textInput({ value = '', placeholder = '', inputmode = 'text', onInput = () => {}, multiline = false, rows = 3, maxlength = null, ariaLabel = '' } = {}) {
  const el = multiline
    ? h('textarea.input', { rows, placeholder, maxlength, 'aria-label': ariaLabel || placeholder }, value || '')
    : h('input.input', { type: 'text', inputmode, value: value || '', placeholder, maxlength, autocomplete: 'off', 'aria-label': ariaLabel || placeholder });
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

/** Campo numérico sin botones (teclado decimal). onInput(numero|null). */
export function numInput({ value = null, placeholder = '', decimals = 2, inputmode = 'decimal', onInput = () => {}, suffix = '', ariaLabel = '' } = {}) {
  const inp = h('input.input.input-num', { type: 'text', inputmode, value: numToInput(value, decimals), placeholder, autocomplete: 'off', 'aria-label': ariaLabel || placeholder });
  inp.addEventListener('input', () => onInput(parseNum(inp.value)));
  inp.addEventListener('focus', () => setTimeout(() => { try { inp.select(); } catch { /* iOS */ } }, 0));
  if (!suffix) return inp;
  const wrap = h('div.input-suffix-wrap', inp, h('span.input-suffix', suffix));
  wrap.input = inp;
  return wrap;
}

/** Estado vacío. */
export function emptyState({ emoji = '', title = '', text = '', action = null } = {}) {
  return h('div.empty',
    emoji ? h('div.empty-emoji', emoji) : null,
    title ? h('div.empty-title', title) : null,
    text ? h('p.empty-text', text) : null,
    action ? h('button.btn.btn-primary', { type: 'button', onClick: action.onClick }, action.label) : null);
}

/** Bloque desplegable «¿Por qué?» */
export function whyBox(content, label = '¿Por qué?') {
  const body = h('div.why-body', { hidden: true }, content);
  const btn = h('button.why-btn', {
    type: 'button',
    'aria-expanded': 'false',
    onClick: () => {
      body.hidden = !body.hidden;
      btn.setAttribute('aria-expanded', String(!body.hidden));
      btn.classList.toggle('open', !body.hidden);
    },
  }, icon('info', 16), label);
  return h('div.why', btn, body);
}

// ---------------------------------------------------------------------------
// Archivos: compartir (hoja de iOS) o descargar; elegir archivo.
// ---------------------------------------------------------------------------

/**
 * Comparte un archivo con la hoja de compartir de iOS (Guardar en Archivos, Drive…).
 * Si no es posible, lo descarga. Devuelve 'shared' | 'downloaded' | 'cancelled'.
 */
export async function shareFile(file, { title = '', text = '' } = {}) {
  try {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: title || file.name, text });
      return 'shared';
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return 'cancelled';
    console.warn('[share] fallo, se descarga', err);
  }
  downloadFile(file);
  return 'downloaded';
}

export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

/** Abre el selector de archivos. Devuelve File o null. */
export function pickFile({ accept = '' } = {}) {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: 'position:fixed;left:-9999px;opacity:0' });
    let done = false;
    const finish = (f) => { if (done) return; done = true; inp.remove(); resolve(f); };
    inp.addEventListener('change', () => finish(inp.files && inp.files[0] ? inp.files[0] : null));
    inp.addEventListener('cancel', () => finish(null));
    document.body.appendChild(inp);
    inp.click();
  });
}

// ---------------------------------------------------------------------------
// Varios
// ---------------------------------------------------------------------------

/** Vibración corta si existe (Android; en iOS no hace nada). */
export function haptic(ms = 10) {
  try { navigator.vibrate && navigator.vibrate(ms); } catch { /* sin soporte */ }
}

export function isStandalone() {
  return (typeof navigator !== 'undefined' && navigator.standalone === true)
    || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
}
