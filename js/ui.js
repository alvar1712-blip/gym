// ui.js — utilidades DOM y componentes comunes (tema oscuro, pensado para una mano).
import { back as routerBack, navigate, routeEpoch, pushOverlay, onMount, refresh as routerRefresh } from './router.js';
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
//
// Título grande → pequeño (como Ajustes de iOS): arriba del todo el título va grande y alineado a la izquierda;
// al desplazar la pantalla (IntersectionObserver sobre un testigo al principio de la página) la cabecera pasa a
// .is-compact y el título (y el subtítulo) se encogen y se centran en la barra con transform (no cambia la
// altura de la cabecera ni se mueve el contenido; ningún texto se corta más que antes). El <h1> sigue siendo
// el único título (.topbar h1).
// ---------------------------------------------------------------------------
const COMPACT_AT = 12; // px de scroll a partir de los cuales la cabecera es compacta
const COMPACT_TITLE_PX = 17;
const COMPACT_SUB_PX = 12;
let compact = false;
let titleIO = null;

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
  const titles = h('div.topbar-titles',
    h('h1', title),
    subtitle ? h('div.topbar-sub', subtitle) : null);
  const bar = h(`header.topbar${back ? '' : '.topbar-root'}`,
    left,
    titles,
    acts.length ? h('div.topbar-actions', acts) : null,
  );
  watchTitles();
  // Las vistas cambian el título o el subtítulo (actividad, rutina, reloj de la sesión): se recoloca.
  if (typeof MutationObserver === 'function') {
    let queued = false;
    new MutationObserver(() => {
      if (queued || !bar.classList.contains('is-compact')) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; if (bar.classList.contains('is-compact')) layoutCompact(bar); });
    }).observe(titles, { subtree: true, childList: true, characterData: true });
  }
  // Una cabecera nueva en una pantalla ya desplazada (p. ej. la sesión la rehace) nace compacta, sin animar.
  if (compact) {
    bar.classList.add('is-compact', 'tb-instant');
    requestAnimationFrame(() => {
      if (bar.isConnected) layoutCompact(bar);
      requestAnimationFrame(() => bar.classList.remove('tb-instant'));
    });
  }
  return bar;
}

/** Testigo de COMPACT_AT px al principio de la página: cuando sale de la vista, las cabeceras se compactan. */
function watchTitles() {
  if (titleIO || typeof document === 'undefined' || typeof IntersectionObserver !== 'function') return;
  const probe = document.createElement('div');
  probe.className = 'topbar-probe';
  probe.setAttribute('aria-hidden', 'true');
  probe.style.height = `${COMPACT_AT}px`;
  document.body.prepend(probe);
  titleIO = new IntersectionObserver((entries) => {
    const e = entries[entries.length - 1];
    setCompact(!e.isIntersecting, false);
  });
  titleIO.observe(probe);
  // Si el contenido o el ancho cambian (giro, título nuevo), se recoloca el título compacto.
  window.addEventListener('resize', () => { if (compact) document.querySelectorAll('.topbar.is-compact').forEach(layoutCompact); });
}

function setCompact(on, instant) {
  compact = on;
  for (const bar of document.querySelectorAll('#view .topbar')) {
    if (instant) bar.classList.add('tb-instant');
    if (on) layoutCompact(bar);
    bar.classList.toggle('is-compact', on);
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('tb-instant')));
  }
}

/** Posición del hijo dentro de la cabecera sin transform (offsetLeft/Top acumulados hasta la barra). */
function boxIn(el, bar) {
  let x = 0;
  let y = 0;
  for (let n = el; n && n !== bar; n = n.offsetParent) {
    x += n.offsetLeft;
    y += n.offsetTop;
    if (!n.offsetParent || !bar.contains(n.offsetParent)) break;
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

/**
 * Calcula dónde van el título y el subtítulo en la barra compacta (centrados entre el botón atrás y las
 * acciones, a la altura del botón) y lo deja en variables CSS (--tb-x, --tb-y, --tb-s).
 */
function layoutCompact(bar) {
  const titles = bar.querySelector('.topbar-titles');
  const h1 = titles && titles.querySelector('h1');
  if (!h1 || !bar.isConnected) return;
  const sub = titles.querySelector('.topbar-sub');
  const W = bar.clientWidth;
  const csBar = getComputedStyle(bar);
  const top = parseFloat(csBar.paddingTop) || 0;
  const bottom = bar.clientHeight - (parseFloat(csBar.paddingBottom) || 0);
  const backBtn = bar.querySelector(':scope > .back-btn');
  // Hueco del título (entre el botón atrás y las acciones): el compacto nunca sale de él.
  const left = titles.offsetLeft;
  const right = titles.offsetLeft + titles.offsetWidth;
  const items = [[h1, COMPACT_TITLE_PX]];
  if (sub && sub.offsetHeight) items.push([sub, COMPACT_SUB_PX]);
  const boxes = items.map(([el, px]) => {
    const b = boxIn(el, bar);
    const fs = parseFloat(getComputedStyle(el).fontSize) || px;
    const s = Math.min(1, px / fs);
    // Más pequeño cabe más texto: el ancho crece hasta el texto entero o hasta llenar el hueco.
    el.style.width = 'max-content';
    el.style.maxWidth = 'none';
    const textW = el.offsetWidth + 2; // + margen: offsetWidth redondea y un subpíxel de menos ya pone «…»
    el.style.width = '';
    el.style.maxWidth = '';
    const w = Math.max(1, Math.min(textW, Math.floor((right - left) / s)));
    return { el, b: { ...b, w }, s };
  });
  const total = boxes.reduce((t, o) => t + o.b.h * o.s, 0);
  const midY = backBtn ? backBtn.offsetTop + backBtn.offsetHeight / 2 : (top + bottom) / 2;
  let y = midY - total / 2;
  for (const { el, b, s } of boxes) {
    const half = (b.w * s) / 2;
    const cx = left + half > right - half ? (left + right) / 2 : Math.min(Math.max(W / 2, left + half), right - half);
    const cy = y + (b.h * s) / 2;
    y += b.h * s;
    el.style.setProperty('--tb-w', `${b.w}px`);
    el.style.setProperty('--tb-x', `${Math.round(cx - (b.x + b.w / 2))}px`);
    el.style.setProperty('--tb-y', `${Math.round(cy - (b.y + b.h / 2))}px`);
    el.style.setProperty('--tb-s', s.toFixed(3));
  }
}

/** Estructura estándar de pantalla: cabecera + <div.content>. Devuelve el contenedor de contenido. */
export function screen(root, headerOpts) {
  const content = h('div.content');
  const top = header(headerOpts);
  root.replaceChildren(top, content);
  fitTitle(top);
  watchTopbar(top);
  return content;
}

/**
 * Título largo de una pantalla de detalle (una rutina, una carrera): en vez de cortarse con «…», pasa a 18 px y hasta
 * dos líneas (como el de la sesión). Dos líneas de 18 px caben en el alto del botón «atrás»: la cabecera mide lo
 * mismo con el título grande y con el compacto (sin saltos al desplazar). Exportada para las vistas que montan su
 * cabecera sin screen() y cambian el título después (actividad: «Nuevo senderismo» a 150 % no cabía y se cortaba).
 */
export function fitTitle(bar) {
  const h1 = bar && bar.querySelector('h1');
  if (!h1 || !bar.querySelector('.back-btn') || !h1.isConnected) return;
  // Se vuelve a medir con el tamaño normal: una vista que cambia el título (la actividad al cambiar de tipo) lo
  // llama otra vez, y un título que ya cabe vuelve a su tamaño
  bar.classList.remove('topbar-long');
  if (h1.scrollWidth > h1.clientWidth + 1) bar.classList.add('topbar-long');
}

let topbarRO = null;
/**
 * Alto real de la cabecera de la pantalla actual en --topbar-h (con la zona segura; un título largo en dos líneas la
 * hace más alta): los scroll-margin-top lo usan para que lo que se desplaza a la vista no quede bajo la cabecera.
 */
function watchTopbar(el) {
  if (typeof ResizeObserver !== 'function' || !el) return;
  if (!topbarRO) {
    topbarRO = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target.isConnected) document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(e.target.getBoundingClientRect().height)}px`);
      }
    });
  }
  topbarRO.disconnect();
  topbarRO.observe(el);
}

// ---------------------------------------------------------------------------
// Bloqueo de scroll (para hojas modales en iOS)
// ---------------------------------------------------------------------------
let lockCount = 0;
let lockedY = 0;
function lockScroll() {
  if (lockCount++ > 0) return;
  lockedY = window.scrollY;
  // Centro de la parte visible de la vista (efecto tarjeta de las hojas, css/app.css).
  document.documentElement.style.setProperty('--lock-y', `${lockedY}px`);
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

// ---------------------------------------------------------------------------
// Respuesta al toque sin falsos positivos: .is-pressed (css/app.css) en vez de :active. Se pone tras
// PRESS_DELAY ms sin moverse más de PRESS_SLOP px y se quita al mover, soltar, cancelar o desplazar; un toque
// rápido deja un destello breve. Así, empezar a desplazar la página o deslizar desde el borde no «pulsa» nada.
// (El oyente de touchstart también hace que Safari aplique :active en los estilos de módulo que aún lo usan.)
// ---------------------------------------------------------------------------
const PRESSABLE = 'button, a[href], [role="button"], .list-item, label.chip';
const PRESS_DELAY = 50;
const PRESS_SLOP = 8;
const PRESS_FLASH_MS = 110;
let press = null; // { el, id, x, y, on, timer }
let lastScrollAt = -1e9;

function clearPress() {
  const p = press;
  press = null;
  if (!p) return;
  clearTimeout(p.timer);
  p.el.classList.remove('is-pressed');
}

export function clearPressed() {
  clearPress();
  if (typeof document !== 'undefined') document.querySelectorAll('.is-pressed').forEach((el) => el.classList.remove('is-pressed'));
}

if (typeof document !== 'undefined') {
  document.addEventListener('touchstart', () => {}, { passive: true });
  const opts = { passive: true, capture: true };
  document.addEventListener('pointerdown', (e) => {
    clearPress();
    if (!e.isPrimary || e.button > 0) return;
    // Un toque para frenar el desplazamiento no es una pulsación.
    if (e.timeStamp - lastScrollAt < 120 && e.pointerType !== 'mouse') return;
    const el = e.target instanceof Element ? e.target.closest(PRESSABLE) : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('.closing, [inert]')) return;
    const p = { el, id: e.pointerId, x: e.clientX, y: e.clientY, on: false, timer: 0, mouse: e.pointerType === 'mouse' };
    p.timer = setTimeout(() => { if (press === p) { p.on = true; el.classList.add('is-pressed'); } }, PRESS_DELAY);
    press = p;
  }, opts);
  document.addEventListener('pointermove', (e) => {
    if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP) clearPress();
  }, opts);
  document.addEventListener('pointerup', (e) => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    clearTimeout(p.timer);
    if (p.on) { p.el.classList.remove('is-pressed'); return; }
    if (p.mouse) return; // con ratón el clic ya se nota; el destello es para el dedo
    p.el.classList.add('is-pressed');
    setTimeout(() => p.el.classList.remove('is-pressed'), PRESS_FLASH_MS);
  }, opts);
  document.addEventListener('pointercancel', clearPress, opts);
  document.addEventListener('scroll', () => { lastScrollAt = performance.now(); clearPress(); }, opts);
  document.addEventListener('dragstart', clearPress, opts);
  document.addEventListener('contextmenu', clearPress, opts);
  document.addEventListener('visibilitychange', clearPressed);
  window.addEventListener('pagehide', clearPressed);
  window.addEventListener('blur', clearPressed);
  // Pantalla nueva: sin pulsaciones pegadas y con la cabecera en su estado (sin animar).
  onMount(({ y }) => {
    clearPressed();
    setCompact(y >= COMPACT_AT, true);
  });
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
const closingSheets = new Set(); // hojas que se están cerrando (animación de salida)
let sheetSeq = 0;

/** 'auto' con «reducir movimiento»; si no, 'smooth' (para scrollTo / scrollIntoView). */
export function scrollBehavior() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'; } catch { return 'smooth'; }
}
const reducedMotion = () => scrollBehavior() === 'auto';

/**
 * Último control pulsado: iOS no da el foco a un <button> al tocarlo, así que document.activeElement suele ser
 * <body>. Con esto la hoja sabe a qué botón devolver el foco al cerrarse (VoiceOver).
 */
let lastPressed = null;
if (typeof document !== 'undefined') {
  const track = (e) => {
    const t = e.target instanceof Element ? e.target.closest('button, [role="button"], a, [tabindex], input, select, textarea') : null;
    if (t) lastPressed = t;
  };
  document.addEventListener('pointerdown', track, true);
  document.addEventListener('click', track, true);
}

/** Con una hoja abierta, la pantalla de detrás y la barra de pestañas quedan fuera del foco y de VoiceOver. */
function setBackgroundInert(on) {
  for (const id of ['view', 'tabbar']) {
    const el = document.getElementById(id);
    if (el) el.inert = on;
  }
}

/**
 * Modo foco (docs/PULIDO.md §18): en la pantalla de una sesión de fuerza en curso, la cápsula de la barra de
 * pestañas (#tabbar) muestra `node` (la barra de la sesión) en lugar de las pestañas; focusBar(null) las devuelve.
 * Es el mismo elemento: mismo sitio, mismas áreas seguras y el mismo hueco abajo (--tb-h; html.focus-mode lo
 * ajusta), así que el contenido, los avisos y el código que esquiva la barra siguen valiendo.
 */
export function focusBar(node, label = 'Sesión en curso') {
  const bar = typeof document !== 'undefined' && document.getElementById('tabbar');
  if (!bar) return;
  const on = !!node;
  for (const el of bar.querySelectorAll(':scope > .focusbar')) if (el !== node) el.remove();
  for (const t of bar.querySelectorAll(':scope > .tab')) t.hidden = on;
  if (on && node.parentNode !== bar) bar.append(node);
  bar.classList.toggle('tabbar-focus', on);
  bar.setAttribute('aria-label', on ? label : 'Secciones');
  document.documentElement.classList.toggle('focus-mode', on);
}

/** Lleva el foco al título de la pantalla visible (tabindex=-1), p. ej. cuando desaparece el control enfocado. */
function focusMain() {
  const t = document.querySelector('#view .topbar h1') || document.querySelector('.topbar h1');
  if (!t) return;
  if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
  try { t.focus({ preventScroll: true }); } catch { /* sin foco */ }
}
/** Duración de abrir/cerrar hojas (igual que --dur-sheet en css/app.css). */
const SHEET_MS = 350;

/**
 * Llama a fn cuando termina la transición de transform/opacity de `el` (o a los ms + margen si no llega
 * transitionend: pestaña oculta, «reducir movimiento», elemento sin transición). Solo una vez.
 * Solo cuenta el final de una transición que EMPEZÓ después de llamar (transitionrun): WebKit, si la anterior (la de
 * abrir) aún no había terminado, dispara su transitionend justo después del cambio, y la hoja se quitaba sin animar.
 */
function afterTransition(el, ms, fn) {
  let done = false;
  const started = new Set();
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionrun', onRun);
    el.removeEventListener('transitionend', onEnd);
    clearTimeout(timer);
    fn();
  };
  const watched = (e) => e.target === el && (e.propertyName === 'transform' || e.propertyName === 'opacity');
  // Si la transición arranca tarde (hilo principal ocupado), el plazo de reserva cuenta desde que arranca: así no se
  // corta a medias. Sin transición (reducir movimiento, pestaña oculta), el plazo de siempre.
  const onRun = (e) => {
    if (!watched(e)) return;
    started.add(e.propertyName);
    clearTimeout(timer);
    timer = setTimeout(finish, ms + 60);
  };
  const onEnd = (e) => { if (watched(e) && started.has(e.propertyName)) finish(); };
  el.addEventListener('transitionrun', onRun);
  el.addEventListener('transitionend', onEnd);
  let timer = setTimeout(finish, ms + 60);
}

function isTextField(el) {
  return el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/i.test(el.type));
}

export function sheet({ title = '', body = null, actions = [], onClose = null, dismissible = true, className = '', tall = false } = {}) {
  let closed = false;
  const bodyEl = h('div.sheet-body');
  const footer = actions.length ? h('div.sheet-actions') : null;
  const tid = title ? `sheet-title-${++sheetSeq}` : null;
  const panel = h(`div.sheet-panel${tall ? '.sheet-tall' : ''}`, {
    role: 'dialog', 'aria-modal': 'true', tabindex: '-1', class: className,
    'aria-labelledby': tid, 'aria-label': tid ? null : 'Diálogo',
  },
    h('div.sheet-grabber'),
    title || dismissible
      ? h('div.sheet-head',
          h('h2.sheet-title', { id: tid, tabindex: tid ? '-1' : null }, title),
          dismissible ? h('button.icon-btn', { type: 'button', 'aria-label': 'Cerrar', onClick: () => close() }, icon('x', 22)) : null)
      : null,
    bodyEl,
    footer,
  );
  const overlay = h('div.sheet-overlay', { onClick: (e) => { if (e.target === overlay && dismissible) close(); } }, panel);
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const opener = active && active !== document.body ? active : (lastPressed && lastPressed.isConnected ? lastPressed : null);
  let releaseEntry = null; // quita la entrada de historial de la hoja (router.pushOverlay)

  /**
   * Cierre animado: la hoja baja con la curva de iOS y el fondo se aclara; mientras, ya no recibe toques
   * (.closing) y la página vuelve a desplazarse. Se quita del DOM al terminar la animación.
   * how.fromHistory: la cerró «atrás» (su entrada ya no está); how.instant: sin animación (el gesto del
   * sistema ya la ha animado).
   */
  function close(result, how = {}) {
    if (closed) return;
    closed = true;
    const fromHistory = !!(how && how.fromHistory);
    const instant = !!(how && how.instant);
    const focusInside = panel.contains(document.activeElement);
    if (focusInside) document.activeElement.blur(); // cierra el teclado de iOS ya, no al final
    overlay.classList.remove('open');
    // Mientras baja ya no cuenta: sin toques, fuera del árbol de accesibilidad y del foco.
    overlay.classList.add('closing');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.inert = true;
    const i = openSheets.indexOf(api);
    if (i >= 0) openSheets.splice(i, 1);
    if (!openSheets.length) setBackgroundInert(false);
    unlockScroll();
    if (releaseEntry && !fromHistory) releaseEntry();
    releaseEntry = null;
    if (instant) {
      overlay.remove();
      cardEffect(false, true);
    } else {
      closingSheets.add(overlay);
      cardEffect(false, false);
      afterTransition(panel, SHEET_MS, () => { closingSheets.delete(overlay); overlay.remove(); });
    }
    // El foco vuelve al botón que abrió la hoja (teclado y lectores de pantalla); a un campo de texto no,
    // para no volver a abrir el teclado.
    // (También si el foco se había perdido en <body>: nunca se quita de otro sitio.)
    const lost = !document.activeElement || document.activeElement === document.body;
    if ((focusInside || lost) && opener && opener.isConnected && opener !== document.body && !isTextField(opener)
      && !opener.closest('[inert]')) {
      try { opener.focus({ preventScroll: true }); } catch { /* sin foco */ }
    }
    if (onClose) onClose(result);
  }
  const api = { el: panel, body: bodyEl, close, overlay, dismissible, epoch: routeEpoch() };

  const content = typeof body === 'function' ? body(close) : body;
  if (content) append(bodyEl, [content]);
  for (const a of actions) {
    footer.appendChild(h(`button.btn.btn-${a.kind || 'secondary'}${a.block === false ? '' : '.btn-block'}`, {
      type: 'button',
      onClick: () => (a.onClick ? a.onClick(close) : close()),
    }, a.label));
  }
  // Una hoja que aún se está cerrando se quita ya: nunca hay dos menús iguales en la página.
  for (const o of closingSheets) o.remove();
  closingSheets.clear();
  document.body.appendChild(overlay);
  lockScroll();
  openSheets.push(api);
  setBackgroundInert(true);
  cardEffect(true, false);
  dragToDismiss(panel, overlay, bodyEl, () => dismissible, (v) => close(undefined, { velocity: v }));
  // «Atrás» (gesto del borde o botón) con la hoja abierta la cierra sin cambiar de pantalla.
  // (También las no descartables: el «atrás» del sistema no se puede impedir y la pantalla ya ha cambiado.)
  releaseEntry = pushOverlay(({ ua } = {}) => close(undefined, { fromHistory: true, instant: !!ua }));
  requestAnimationFrame(() => {
    if (closed) return;
    overlay.classList.add('open');
    // El foco entra en la hoja (el título; si no hay, el panel) para que VoiceOver la anuncie. Un campo que
    // se enfoca después (promptDialog) lo sustituye.
    if (!panel.contains(document.activeElement)) {
      try { (panel.querySelector('.sheet-title[tabindex]') || panel).focus({ preventScroll: true }); } catch { /* sin foco */ }
    }
  });
  return api;
}

/**
 * Efecto tarjeta: con una hoja abierta la pantalla de detrás se encoge un poco y redondea las esquinas
 * (css/app.css: html.sheet-card #view). Al cerrarse la última hoja vuelve con la misma curva.
 */
let cardTimer = null;
function cardEffect(open, instant) {
  const root = document.documentElement;
  clearTimeout(cardTimer);
  if (open) {
    root.classList.remove('sheet-card-out');
    root.classList.add('sheet-card');
    return;
  }
  if (openSheets.length) return;
  root.classList.remove('sheet-card', 'sheet-dragging');
  root.style.removeProperty('--sheet-drag');
  if (instant) {
    root.classList.remove('sheet-card-out');
    root.classList.add('sheet-instant');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('sheet-instant')));
    return;
  }
  root.classList.add('sheet-card-out');
  cardTimer = setTimeout(() => root.classList.remove('sheet-card-out'), SHEET_MS + 40);
}

/**
 * Arrastrar hacia abajo para cerrar: sigue al dedo desde el asa y la cabecera (touch-action:none) o desde el
 * contenido si está arriba del todo (el primer touchmove se cancela para que no empiece el desplazamiento).
 * Al soltar: se cierra si baja más de ~30 % de la hoja o con un gesto rápido; si no, vuelve con un rebote.
 */
const DRAG_CLOSE_FRACTION = 0.3;
const DRAG_CLOSE_VELOCITY = 0.5; // px/ms
function dragToDismiss(panel, overlay, bodyEl, canClose, doClose) {
  const root = document.documentElement;
  let st = null; // { id, x0, y0, mode:'pending'|'drag'|'off', fromBody, off, samples, h }
  let suppressClick = false;
  const NO_DRAG = 'input, textarea, select, [contenteditable="true"], .no-sheet-drag, .chips-scroll, .seg';

  const decide = (x, y) => {
    const dx = x - st.x0;
    const dy = y - st.y0;
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dx) > Math.abs(dy)) { st.mode = 'off'; return; }
    if (st.fromBody && (dy < 0 || bodyEl.scrollTop > 0)) { st.mode = 'off'; return; }
    st.mode = 'drag';
    st.h = panel.getBoundingClientRect().height || 1;
    st.y0 = y; // sin salto: empieza a seguir al dedo desde aquí
    panel.style.transition = 'none';
    root.classList.add('sheet-dragging');
  };
  const follow = (y, t) => {
    const dy = y - st.y0;
    const closable = canClose();
    // Hacia arriba (o si no se puede cerrar) cuesta: resistencia tipo goma.
    const off = dy >= 0 ? (closable ? dy : dy * 0.35) : -Math.min(28, (-dy) * 0.22);
    st.off = off;
    st.samples.push([t, y]);
    while (st.samples.length > 2 && t - st.samples[0][0] > 90) st.samples.shift();
    panel.style.transform = `translateY(${off.toFixed(1)}px)`;
    root.style.setProperty('--sheet-drag', Math.max(0, Math.min(1, off / st.h)).toFixed(3));
  };
  const end = (cancelled, tEnd) => {
    const s = st;
    st = null;
    if (!s || s.mode !== 'drag') return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 60);
    root.classList.remove('sheet-dragging');
    const [t0, y0] = s.samples[0] || [0, 0];
    const [t1, y1] = s.samples[s.samples.length - 1] || [0, 0];
    // Si el dedo se quedó quieto antes de soltar, no hay «lanzamiento».
    const v = t1 > t0 && !(tEnd - t1 > 80) ? (y1 - y0) / (t1 - t0) : 0;
    const off = s.off || 0;
    if (canClose() && !overlay.classList.contains('closing') && (off > s.h * DRAG_CLOSE_FRACTION || (!cancelled && v > DRAG_CLOSE_VELOCITY && off > 12))) {
      // Sigue bajando desde donde está, más rápido cuanto más rápido iba el dedo.
      // Con «reducir movimiento» se queda donde la soltó y solo se desvanece (sin volver arriba de golpe).
      if (!reducedMotion()) {
        const ms = Math.round(Math.max(160, Math.min(SHEET_MS, (s.h - off) / Math.max(v, 0.9))));
        panel.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.75, 0.3, 1)`;
        panel.style.transform = '';
      }
      root.style.removeProperty('--sheet-drag');
      doClose(v);
      return;
    }
    // Vuelve arriba con un pequeño rebote.
    panel.style.transition = 'transform 460ms var(--spring-bounce)';
    panel.style.transform = '';
    root.style.removeProperty('--sheet-drag');
    afterTransition(panel, 460, () => { if (!st) panel.style.transition = ''; });
  };

  panel.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || e.button > 0 || overlay.classList.contains('closing')) return;
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const fromBody = bodyEl.contains(t) || !!t.closest('.sheet-actions');
    if (fromBody && (t.closest(NO_DRAG) || bodyEl.scrollTop > 0)) return;
    st = { id: e.pointerId, x0: e.clientX, y0: e.clientY, mode: 'pending', fromBody, off: 0, samples: [[e.timeStamp, e.clientY]], h: 1 };
  });
  panel.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    if (st.mode === 'pending') {
      decide(e.clientX, e.clientY);
      if (st.mode === 'drag') { try { panel.setPointerCapture(e.pointerId); } catch { /* sin captura */ } }
    }
    if (st && st.mode === 'drag') follow(e.clientY, e.timeStamp);
  });
  panel.addEventListener('pointerup', (e) => { if (st && e.pointerId === st.id) end(false, e.timeStamp); });
  panel.addEventListener('pointercancel', (e) => { if (st && e.pointerId === st.id) end(true, e.timeStamp); });
  // (Al capturar en el panel, el elemento tocado pierde la captura implícita: solo cuenta perder la del panel.)
  panel.addEventListener('lostpointercapture', (e) => { if (e.target === panel && st && e.pointerId === st.id && st.mode === 'drag') end(true, e.timeStamp); });
  // Tocar y arrastrar el contenido que ya está arriba: se cancela el desplazamiento nativo (si no, el
  // navegador se queda el gesto y cancela los eventos de puntero).
  panel.addEventListener('touchmove', (e) => {
    if (!st || e.touches.length !== 1) return;
    if (st.mode === 'pending') decide(e.touches[0].clientX, e.touches[0].clientY);
    if (st && st.mode === 'drag' && e.cancelable) e.preventDefault();
  }, { passive: false });
  panel.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); e.stopPropagation(); }
  }, true);
}

export function closeAllSheets() {
  for (const s of [...openSheets].reverse()) s.close();
}

/** Cierra las hojas de una pantalla anterior (app.js lo llama en cada cambio de ruta). */
export function closeStaleSheets() {
  const now = routeEpoch();
  for (const s of [...openSheets].reverse()) if (s.epoch < now) s.close();
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
const TOAST_OUT_MS = 200; // salida del aviso (css/app.css .toast)
let toastCur = null; // { close, closeOnNavigate, epoch }
const TOAST_REFOCUS_MS = 3000; // al salir el foco del aviso, se cierra a los pocos segundos

/**
 * Regiones vivas fijas (ocultas a la vista, .sr-only) para anunciar los avisos: VoiceOver no suele leer una
 * región viva que se inserta ya con texto. status (cortés) y alert (urgente, para errores); se crean una vez.
 */
const liveRegions = {};
function announce(text, urgent = false) {
  const key = urgent ? 'alert' : 'status';
  let r = liveRegions[key];
  if (!r || !r.isConnected) {
    r = liveRegions[key] = h('div.sr-only', { role: key, 'aria-live': urgent ? 'assertive' : 'polite', 'aria-atomic': 'true' });
    document.body.appendChild(r);
  }
  r.textContent = '';
  clearTimeout(r._t);
  r._t = setTimeout(() => { r.textContent = text; }, 50); // un rAF a veces es poco para VoiceOver
}

/**
 * closeOnNavigate (por defecto: sí si lleva acción): el aviso se cierra al cambiar de pantalla, para que
 * «Deshacer» no actúe sin contexto desde otra pantalla ni tape sus botones. Un aviso mostrado justo
 * después de navigate()/back() pertenece a la pantalla de destino y sigue visible allí.
 */
export function toast(message, { actionLabel = null, onAction = null, duration = 3500, kind = 'info', closeOnNavigate = !!actionLabel } = {}) {
  if (toastEl) {
    if (toastEl.contains(document.activeElement)) focusMain(); // el foco no cae a <body> con el aviso viejo
    toastEl.remove(); toastEl = null;
  }
  for (const old of document.querySelectorAll('.toast')) old.remove(); // uno que se estaba ocultando
  clearTimeout(toastTimer);
  // El aviso visible ya no es región viva (se anunciaría dos veces): lo anuncian las regiones fijas.
  const el = h(`div.toast.toast-${kind}`,
    h('span.toast-msg', message),
    actionLabel ? h('button.toast-action', {
      type: 'button',
      onClick: () => { close(); onAction && onAction(); },
    }, actionLabel) : null);
  function close() {
    if (toastEl === el) clearTimeout(toastTimer);
    // Si el foco estaba en el aviso (p. ej. en «Deshacer»), pasa al título de la pantalla: nunca cae a <body>.
    if (el.contains(document.activeElement)) focusMain();
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
    afterTransition(el, TOAST_OUT_MS, () => el.remove());
    if (toastEl === el) { toastEl = null; toastCur = null; }
  }
  document.body.appendChild(el);
  toastEl = el;
  toastCur = { close, closeOnNavigate, epoch: routeEpoch() };
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(close, duration);
  // Con el foco dentro (VoiceOver o teclado en «Deshacer») no se cierra solo; al salir, se cierra en un rato.
  el.addEventListener('focusin', () => { if (toastEl === el) clearTimeout(toastTimer); });
  el.addEventListener('focusout', (e) => {
    if (toastEl !== el || el.contains(e.relatedTarget)) return;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(close, TOAST_REFOCUS_MS);
  });
  announce(String(message) + (actionLabel ? `, ${actionLabel} disponible` : ''), kind === 'error');
  return { close };
}

/**
 * «Vaciar» un borrador recuperado (localStorage[key]) con «Deshacer»: se vuelve a montar `hash` en blanco y, si se
 * deshace, el borrador vuelve (salvo que ya se haya empezado otro) y la pantalla se repinta con él.
 */
export function discardDraftUndo(key, hash) {
  let snap = null;
  try { snap = localStorage.getItem(key); localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
  navigate(hash, { replace: true });
  if (!snap) return;
  // Después de navigate(): el aviso cuenta ya con la pantalla nueva y no se cierra al montarla
  undoToast('Borrador vaciado', () => {
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, snap); } catch { /* sin almacenamiento */ }
    // undoToast repinta la pantalla (ya se montó otra vez desde el aviso): vuelve el banner con el borrador
  });
}

// Pantallas montadas desde que arrancó la app: «Deshacer» sabe si la pantalla visible ya no es la que borró.
let mounts = 0;
onMount(() => { mounts++; });

/**
 * Toast de «Eliminado · Deshacer». Se deshace una sola vez. Si al tocar «Deshacer» la pantalla visible no es la
 * que hizo el cambio (p. ej. se borró un evento y se volvió a Hoy), se vuelve a pintar después de restaurar:
 * así nunca queda una pantalla con datos viejos (docs/PULIDO.md §16).
 */
export function undoToast(message, onUndo, duration = 7000) {
  const at = mounts;
  let used = false;
  return toast(message, {
    actionLabel: 'Deshacer', duration, kind: 'undo',
    onAction: async () => {
      if (used) return;
      used = true;
      try { await onUndo?.(); } finally {
        if (mounts !== at) routerRefresh();
      }
    },
  });
}

/** Cierra el aviso si es de una pantalla anterior (app.js lo llama en cada cambio de ruta). */
export function closeStaleToasts() {
  if (toastCur && toastCur.closeOnNavigate && toastCur.epoch < routeEpoch()) toastCur.close();
}

// ---------------------------------------------------------------------------
// Controles
// ---------------------------------------------------------------------------

/**
 * Campo numérico con botones −/+ grandes.
 * stepper({ value, step, min, max, decimals, inputmode, suffix, label, placeholder, showStep, onChange(v, {final}) })
 * Devuelve el elemento con .getValue(), .setValue(v) y .setAriaLabel(nombre).
 */
export function stepper({ value = null, step = 1, min = -Infinity, max = Infinity, decimals = 2, inputmode = 'decimal', suffix = '', label = '', placeholder = '', showStep = false, size = 'lg', onChange = () => {}, ariaLabel = '' } = {}) {
  let cur = value;
  const input = h('input.stepper-input', {
    type: 'text', inputmode, enterkeyhint: 'done', autocomplete: 'off', placeholder,
    value: numToInput(value, decimals),
    'aria-label': ariaLabel || label || 'valor',
  });
  const stepTxt = numToInput(step, 2);
  // «Sumar 2,5 a Peso»: con varios steppers juntos (Reps izq. / Reps der.) se sabe cuál cambia cada botón.
  const btnName = (dir, name) => `${dir > 0 ? 'Sumar' : 'Restar'} ${stepTxt}${name ? ` a ${name}` : ''}`;
  const fieldName = ariaLabel || label;
  const mkBtn = (dir) => {
    const b = h('button.stepper-btn', { type: 'button', 'aria-label': btnName(dir, fieldName) },
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
  selectOnFocus(input);
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
  const minusBtn = mkBtn(-1);
  const plusBtn = mkBtn(+1);
  const el = h(`div.stepper.stepper-${size}`,
    label ? h('span.stepper-label', label) : null,
    h('div.stepper-row',
      minusBtn,
      h('div.stepper-field', input, suffix ? h('span.stepper-suffix', suffix) : null),
      plusBtn));
  el.getValue = () => cur;
  /** Cambia el nombre del campo (y de sus botones −/+), p. ej. Lastre ↔ Asistencia. */
  el.setAriaLabel = (name) => {
    input.setAttribute('aria-label', name);
    minusBtn.setAttribute('aria-label', btnName(-1, name));
    plusBtn.setAttribute('aria-label', btnName(1, name));
  };
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
export function chips({ options, value = null, multi = false, allowNone = false, onChange = () => {}, className = '', ariaLabel = '', describedBy = '' }) {
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
  // Con nombre, VoiceOver dice de qué es cada chip («RIR… grupo»); sin él, el contenedor queda como antes.
  const el = h('div.chips', {
    class: className,
    role: ariaLabel ? 'group' : null,
    'aria-label': ariaLabel || null,
    'aria-describedby': describedBy || null,
  }, btns);
  el.getValue = () => cur;
  el.setValue = (v) => { cur = multi ? [...(v || [])] : v; paint(); };
  return el;
}

export const RPE_HINTS = {
  1: 'Muy muy suave', 2: 'Muy suave', 3: 'Suave', 4: 'Moderado', 5: 'Algo duro',
  6: 'Duro', 7: 'Muy duro', 8: 'Muy muy duro', 9: 'Casi máximo', 10: 'Máximo',
};

/** Selector de esfuerzo percibido 1–10. */
let rpeSeq = 0;
export function rpePicker({ value = null, onChange = () => {}, ariaLabel = 'Esfuerzo percibido de 1 a 10' } = {}) {
  const hid = `rpe-hint-${++rpeSeq}`;
  const hint = h('div.rpe-hint.muted', { id: hid, 'aria-live': 'polite' }, value ? `${value} · ${RPE_HINTS[value]}` : 'Toca un valor (1 = muy suave, 10 = máximo)');
  const c = chips({
    options: Array.from({ length: 10 }, (_, i) => ({ value: i + 1, label: String(i + 1), className: 'chip-num' })),
    value,
    allowNone: true,
    className: 'rpe-chips',
    ariaLabel,
    describedBy: hid,
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
 * Lo escrito se respeta tal cual (75 min = 4500 s, nunca se recorta en silencio). Al salir del campo se
 * normaliza lo que desborda (75 min → 1 h 15 min; 90 s → 1 min 30 s) reescribiendo los campos: lo que se ve
 * es siempre lo que se guarda.
 */
export function durationInput({ seconds = null, onChange = () => {}, showHours = true, showSeconds = true, ariaLabel = 'Duración' } = {}) {
  const parts = { h: null, m: null, s: null };
  const inputs = {};
  if (seconds != null) {
    const sec = Math.max(0, Math.round(seconds));
    parts.h = showHours ? Math.floor(sec / 3600) : 0;
    parts.m = showHours ? Math.floor((sec % 3600) / 60) : Math.floor(sec / 60);
    parts.s = sec % 60;
  }
  const shown = (key) => (parts[key] == null ? '' : key === 'h' ? String(parts[key]) : String(parts[key]).padStart(2, '0'));
  const mk = (key, lbl) => {
    const inp = h('input.dur-input', {
      type: 'text', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: key === 's' ? 2 : 3,
      value: shown(key),
      placeholder: key === 'h' ? '0' : '00',
      'aria-label': `${ariaLabel}: ${lbl}`,
    });
    selectOnFocus(inp);
    inp.addEventListener('input', () => {
      const v = inp.value.replace(/\D/g, '');
      if (v !== inp.value) inp.value = v;
      parts[key] = v === '' ? null : Number(v);
      emit();
    });
    inp.addEventListener('change', normalize);
    inputs[key] = inp;
    return h('label.dur-part', inp, h('span.dur-unit', lbl));
  };
  function total() {
    if (parts.h == null && parts.m == null && parts.s == null) return null;
    return (parts.h || 0) * 3600 + (parts.m || 0) * 60 + (showSeconds ? parts.s || 0 : 0);
  }
  /** Pasa el desbordamiento a la unidad superior (el total no cambia) y reescribe los campos. */
  function normalize() {
    let changed = false;
    if (showSeconds && parts.s > 59) {
      parts.m = (parts.m || 0) + Math.floor(parts.s / 60);
      parts.s %= 60;
      changed = true;
    }
    if (showHours && parts.m > 59) {
      parts.h = (parts.h || 0) + Math.floor(parts.m / 60);
      parts.m %= 60;
      changed = true;
    }
    if (!changed) return;
    for (const [key, inp] of Object.entries(inputs)) inp.value = shown(key);
  }
  function emit() { onChange(total()); }
  const el = h('div.dur', { role: 'group', 'aria-label': ariaLabel },
    showHours ? mk('h', 'h') : null,
    mk('m', 'min'),
    showSeconds ? mk('s', 's') : null);
  el.getValue = total;
  return el;
}

/**
 * Al enfocar un campo numérico se selecciona su texto, para que lo escrito lo sustituya (en iOS hay que hacerlo tras el
 * evento focus). Solo si el campo SIGUE enfocado y aún no se ha escrito en él, y sin select(): un select() tardío sobre
 * un campo ya abandonado le devuelve el foco (lo escrito iría al campo anterior; con dos campos así, el foco salta
 * entre ellos sin parar), y seleccionar después de la primera tecla haría que la segunda la borrase.
 */
export function selectOnFocus(inp) {
  inp.addEventListener('focus', () => {
    let typed = false;
    const onInput = () => { typed = true; };
    inp.addEventListener('input', onInput);
    setTimeout(() => {
      inp.removeEventListener('input', onInput);
      if (typed || inp.ownerDocument.activeElement !== inp) return;
      try { inp.setSelectionRange(0, inp.value.length); } catch { /* tipo de campo sin selección */ }
    }, 0);
  });
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
  selectOnFocus(inp);
  if (!suffix) return inp;
  const wrap = h('div.input-suffix-wrap', inp, h('span.input-suffix', suffix));
  wrap.input = inp;
  return wrap;
}

/**
 * Cifra de una casilla (KPI) con las unidades pequeñas: «1 h 10 min», «+0,03 kg», «64–69 kg» → los números grandes
 * y «h», «min», «kg»… en .kpi-unit. El texto es el mismo (textContent no cambia). Sin cifras, tal cual.
 */
export function kpiValue(value, tag = 'div.kpi-value') {
  const txt = value == null ? '—' : String(value);
  if (!/\d/.test(txt)) return h(tag, txt);
  const parts = txt.split(/([+−-]?\d[\d.,:]*)/).filter((p) => p !== '');
  return h(tag, parts.map((p) => (/^[+−-]?\d/.test(p) ? p : h('span.kpi-unit', p))));
}

/** Estado vacío. */
export function emptyState({ emoji = '', title = '', text = '', action = null } = {}) {
  return h('div.empty',
    emoji ? h('div.empty-emoji', emoji) : null,
    title ? h('div.empty-title', title) : null,
    text ? h('p.empty-text', text) : null,
    action ? h('button.btn.btn-primary', { type: 'button', onClick: action.onClick }, action.label) : null);
}

/**
 * Estados (docs/PULIDO.md §5): el MISMO componente en toda la app, siempre icono + texto (nunca solo color).
 *   ok · warn · info · neutral · insufficient · progress · stalled · pr · error
 * Confianza: stateTag('conf-high' | 'conf-medium' | 'conf-low' | 'conf-insufficient', «Confianza media»): contorno.
 */
export const STATE_ICON = {
  ok: 'check', warn: 'alert', info: 'info', neutral: 'info', insufficient: 'clock', progress: 'arrow-up', stalled: 'minus',
  pr: 'trophy', error: 'x',
};
export function stateTag(kind, label, { small = false, className = '', title = null } = {}) {
  const conf = kind.startsWith('conf-');
  const ic = conf ? null : icon(STATE_ICON[kind] || 'info', small ? 13 : 14);
  return h(`span.state.state-${kind}${small ? '.state-sm' : ''}${className ? `.${className.trim().split(/\s+/).join('.')}` : ''}`,
    title ? { title } : {}, ic, label);
}

/**
 * Valores muy raros (js/sanity.js): «¿Seguro?» con lo que se ha puesto. true si no hay nada raro o se confirma.
 * @param {{ message: string }[]} rare
 */
export async function confirmRare(rare, { confirmText = 'Sí, guardar', cancelText = 'Corregir' } = {}) {
  if (!rare || !rare.length) return true;
  return confirmDialog({ title: '¿Seguro?', message: `${rare.map((i) => i.message).join(' ')} ¿Es correcto?`, confirmText, cancelText });
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

let sharing = false;

/**
 * Comparte un archivo con la hoja de compartir de iOS (Guardar en Archivos, Drive…).
 * Si el navegador no puede compartir archivos, lo descarga. Devuelve 'shared' | 'downloaded' | 'cancelled'.
 * 'cancelled' también cuando la hoja ya está abierta (doble toque) o el sistema no deja abrirla
 * (NotAllowedError, con aviso): en esos casos NO se descarga nada ni se da la copia por hecha.
 */
export async function shareFile(file, { title = '', text = '' } = {}) {
  if (sharing) return 'cancelled'; // doble toque: manda la primera hoja
  let canShareFiles = false;
  try {
    canShareFiles = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
  } catch { canShareFiles = false; }
  if (canShareFiles) {
    sharing = true;
    try {
      await navigator.share({ files: [file], title: title || file.name, text });
      return 'shared';
    } catch (err) {
      const name = err && err.name;
      if (name === 'AbortError' || name === 'InvalidStateError') return 'cancelled';
      if (name === 'NotAllowedError') {
        toast('No se pudo abrir la hoja de compartir. Vuelve a pulsar el botón.', { kind: 'error', duration: 5000 });
        return 'cancelled';
      }
      console.warn('[share] fallo, se descarga', err);
    } finally {
      sharing = false;
    }
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
