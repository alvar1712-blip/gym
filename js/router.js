// router.js — enrutado por hash (#/ruta/:param?query). Sin dependencias de vistas.
//
// Transiciones entre pantallas (estilo iOS). Cada cambio de pantalla tiene un tipo:
//   push — navigate('#/x'): la nueva entra desde la derecha y la anterior se desplaza un poco a la izquierda
//          y se atenúa.
//   pop  — back() o «atrás» del historial: la actual sale hacia la derecha y aparece la anterior.
//   tab  — navigate(href, { transition: 'tab' }) desde la barra de pestañas: fundido corto.
//   none — replace, arranque y refresh(): sin animación.
// Con View Transitions API (Safari 18+, Chromium) el navegador anima una IMAGEN de la pantalla anterior: en el
// DOM solo existe la vista nueva (nunca dos copias vivas). Sin la API solo se anima la entrada de la vista nueva
// (clase .view-enter-<tipo>). El tipo va en <html data-nav="…"> mientras dura la transición; los estilos (y
// «reducir movimiento», que deja solo fundidos cortos) están en css/app.css («Transiciones entre pantallas»).
// Si llega otra navegación con una transición en curso, esta se salta (skipTransition) y se monta la nueva.
//
// Gesto de «atrás» del sistema (iPhone: deslizar desde el borde izquierdo). iOS ya anima el gesto con una foto
// de la pantalla anterior; si la app animase otra vez se vería doble. Se detecta (uaGesture) y esa vuelta se
// monta SIN animación y con el scroll que tenía la pantalla (coincide con la foto):
//   · `hasUAVisualTransition` del popstate/hashchange (si el navegador lo tiene);
//   · un toque que empezó a ≤ 24 px del borde izquierdo y se movió hacia la derecha (o lo canceló el sistema) y
//     terminó hace ≤ 1 s;
//   · en la app instalada de iOS (navigator.standalone) no hay botón «atrás» del navegador: un recorrido del
//     historial que la app no ha pedido solo puede ser el gesto.
//
// Scroll por entrada del historial: mapa en memoria __idx → scrollY (copia en sessionStorage), actualizado con un
// oyente de scroll pasivo + rAF (nunca replaceState en cada scroll: Safari lo limita). Al volver (atrás/adelante)
// se restaura; si el montaje es asíncrono o el contenido crece después, se vuelve a aplicar hasta ~1,2 s o hasta
// que el usuario toque la pantalla. history.scrollRestoration = 'manual' (el navegador no mueve la vista vieja).
//
// Hojas y «atrás» (pushOverlay): cada hoja abierta tiene su propia entrada de historial (misma URL, estado con
// __ov). «Atrás» (gesto o botón) llega como popstate sin cambio de URL y cierra la hoja de arriba; cerrar la hoja
// desde la interfaz hace history.back() y esa popstate se ignora. Mientras esas vueltas están en camino, las
// navegaciones (navigate/back/replaceUrl) esperan a que lleguen; y una navegación con hojas abiertas primero
// quita sus entradas: nunca quedan entradas muertas ni se descuadran `depth`/`histIdx`.

let routes = [];
let viewEl = null;
let cleanup = null;
let current = null;
let mountToken = 0;
let depth = 0; // nº de navegaciones internas apiladas (para «atrás»)
let onRouteChange = () => {};
let pendingScroll = null;
let seq = 0; // nº de cambios de pantalla (hashchange); refresh() y replaceUrl() no cuentan
let navPending = false; // se pidió navegar (navigate/back) y aún no ha llegado el hashchange
let pendingNav = null; // { kind, replace } de la navegación pedida, hasta su hashchange
let histIdx = 0; // posición en el historial (history.state.__idx): distingue atrás/adelante del navegador
let activeVT = null; // ViewTransition en curso
let entering = null; // { el, timer } animación de entrada sin View Transitions
let staggerTimer = null;
let rendering = 0; // montajes en curso (para settled())
let started = false;
let lastNav = { kind: 'none', mode: 'none', path: null, transition: null, ua: false };
const mountHooks = [];

const NAV_KINDS = new Set(['push', 'pop', 'tab', 'none']);
/** Duración de la entrada sin View Transitions (igual que --dur-enter / --dur-tab en css/app.css). */
const ENTER_MS = { push: 300, pop: 300, tab: 200 };
/** Lo máximo que se espera a un montaje asíncrono antes de animar (mientras, la pantalla está congelada). */
const UPDATE_MAX_MS = 120;
/** Aparición escalonada del contenido al entrar (push): lo que dura la clase .view-stagger (css/app.css). */
const STAGGER_MS = 320;
/** Gesto del borde: dónde empieza el toque y cuánto antes del popstate puede haber terminado. */
const EDGE_PX = 24;
const EDGE_WINDOW_MS = 1000;
/** Restauración del scroll: hasta cuándo se reintenta si el contenido aún no llega. */
const RESTORE_MS = 1200;
const SCROLL_KEY = 'entreno:scroll';

/**
 * Identificador de la pantalla que el usuario está viendo (o la que va a ver, si hay una navegación
 * pedida y aún no montada). Sirve para cerrar avisos y hojas al cambiar de pantalla (ui.toast, ui.sheet).
 */
export function routeEpoch() {
  return navPending || queued.length ? seq + 1 : seq;
}

/**
 * Última transición entre pantallas: { kind:'push'|'pop'|'tab'|'none', mode:'vt'|'css'|'none', path,
 * transition (ViewTransition, solo con mode 'vt'), ua (vuelta por el gesto del sistema), active (sigue
 * animándose) }. Para pruebas y depuración.
 */
export function navInfo() {
  return { ...lastNav, active: !!(activeVT || entering) };
}

/**
 * Promesa que se resuelve cuando la pantalla está quieta: sin navegación pedida pendiente, sin montaje en
 * curso, sin vueltas del historial en camino y sin transición animándose (como mucho ~3 s). Para pruebas.
 */
export async function settled() {
  for (let i = 0; i < 150 && (navPending || rendering > 0 || activeVT || entering || awaitingPops > 0 || queued.length || backInFlight || afterBack); i++) {
    if (activeVT && !navPending && !rendering) await activeVT.finished.catch(ignore);
    else await new Promise((r) => setTimeout(r, 20));
  }
}

/**
 * Registra fn({ kind, ua, y, path }) que se llama justo después de montar cada pantalla (con el scroll ya
 * colocado, antes de pintar). ui.js lo usa para el título compacto y la respuesta al toque.
 */
export function onMount(fn) {
  mountHooks.push(fn);
}

/**
 * @param {Array<{pattern:string, tab:string, load:()=>Promise<object>, fn:string}>} list
 */
export function defineRoutes(list) {
  routes = list.map((r) => {
    const o = { ...r, keys: [] };
    o.re = compile(o.pattern, o);
    return o;
  });
}

function compile(pattern, r) {
  const keys = [];
  const src = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  r.keys = keys;
  return new RegExp(`^${src}/?$`);
}

export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '') || '/today';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: path || '/today', query, raw };
}

function match(path) {
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = safeDecode(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

/** decodeURIComponent sin excepciones: con una codificación % inválida (#/day/%ZZ) se usa el texto tal cual. */
function safeDecode(v) {
  try { return decodeURIComponent(v); } catch { return v; }
}

export function currentRoute() {
  return current;
}

/**
 * Navega a '#/…'. replace=true no crea entrada de historial.
 * transition: 'push' (por defecto) | 'pop' | 'tab' | 'none' (por defecto con replace).
 * Con hojas abiertas, primero se quitan sus entradas del historial (y se cierran) y luego se navega.
 */
export function navigate(hash, { replace = false, transition = null } = {}) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (deferForOverlays(() => navigate(hash, { replace, transition }))) return;
  // Un «atrás» de back() aún en camino (history.back() es asíncrono): si se navegara ya, ese paso atrás llegaría
  // después y desharía esta navegación (pulsar «atrás» y enseguida una pestaña acababa en otra pantalla). Se espera
  // a que llegue; si se pide más de una, vale la última.
  if (backInFlight) { afterBack = () => navigate(hash, { replace, transition }); return; }
  if (hash === location.hash) { refresh({ keepScroll: false }); return; }
  navPending = true;
  pendingNav = { kind: NAV_KINDS.has(transition) ? transition : (replace ? 'none' : 'push'), replace };
  if (replace) {
    location.replace(hash);
  } else {
    depth++;
    location.hash = hash;
  }
}

/**
 * Cambia la URL actual SIN volver a montar la vista (p. ej. de #/activity/new a #/activity/:id
 * tras crear el registro). Actualiza currentRoute() y la pestaña activa.
 */
export function replaceUrl(hash) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  pendingReplace = hash;
  applyPendingReplace();
  const { path, query, raw } = parseHash(hash);
  const found = match(path);
  if (!found) return;
  current = { path, raw, params: { ...query, ...found.params }, route: found.route };
  onRouteChange(current);
}

/** Vuelve atrás dentro de la app; si no hay historial interno, va a `fallback` (animado como «atrás»). */
export function back(fallback = '#/today') {
  if (deferForOverlays(() => back(fallback))) return;
  if (depth > 0) {
    depth--;
    navPending = true;
    pendingNav = { kind: 'pop', replace: false };
    backInFlight = true;
    clearTimeout(backTimer);
    // Red de seguridad por si el navegador no llegara a recorrer el historial. Lo normal es aterrizar con la popstate
    // y el hashchange de esa vuelta (con la máquina cargada pueden tardar más de un segundo: no se adelanta).
    backTimer = setTimeout(landBack, 4000);
    history.back();
  } else {
    navigate(fallback, { replace: true, transition: 'pop' });
  }
}

/** El «atrás» de back() ya llegó (o no llegará): la navegación que esperaba, si la hay, sigue. */
function landBack() {
  clearTimeout(backTimer);
  if (!backInFlight) return;
  backInFlight = false;
  const fn = afterBack;
  afterBack = null;
  if (fn) setTimeout(fn, 0);
}

/** Vuelve a montar la vista actual (por defecto conservando el scroll). Sin animación. */
export function refresh({ keepScroll = true } = {}) {
  pendingScroll = keepScroll ? currentY() : 0;
  return render('none');
}

export function start(el, onChange) {
  viewEl = el;
  if (onChange) onRouteChange = onChange;
  started = true;
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch { /* sin soporte */ }
  loadScrollMap();
  const st = history.state;
  if (st && typeof st.__idx === 'number') histIdx = st.__idx;
  else tagEntry(histIdx);
  // Recarga con una hoja abierta: su entrada ya no tiene hoja; se vuelve a la de la pantalla sin hacer nada.
  if (st && st.__ov) goBack(1);
  window.addEventListener('popstate', onPopState);
  window.addEventListener('hashchange', onHashChange);
  window.addEventListener('scroll', onScroll, { passive: true });
  const persist = () => saveScrollMap();
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
  watchEdgeGesture();
  // Un enlace (#/…) pulsado dentro de una hoja pasa por navigate(): así se quitan antes las entradas de las hojas.
  document.addEventListener('click', (e) => {
    if (!overlays.length || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest('a[href^="#/"]') : null;
    if (!a || a.target) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  return render('none');
}

function onHashChange(e) {
  // replaceUrl() aplicado al volver de una hoja: la URL ya es la de la pantalla actual; no se vuelve a montar.
  if (fixedHash && location.hash === fixedHash && current && parseHash().raw === current.raw) {
    fixedHash = null;
    return;
  }
  fixedHash = null;
  seq++;
  if (backInFlight) landBack();
  const requested = navPending ? pendingNav : null;
  navPending = false;
  pendingNav = null;
  // Scroll de la pantalla que se deja (su entrada aún es histIdx).
  if (!restoring) scrollMap.set(histIdx, currentY());
  const kind = historyKind(requested);
  const traversal = isTraversal;
  isTraversal = false;
  // Recorrido del historial (atrás/adelante): la pantalla vuelve donde estaba. Entrada nueva: arriba.
  pendingScroll = traversal ? scrollMap.get(histIdx) ?? 0 : 0;
  if (!traversal) forgetFrom(histIdx);
  saveScrollMap();
  // Si el navegador ya animó el gesto de atrás/adelante (Safari al deslizar), no se anima otra vez.
  const ua = !requested && traversal && (lastPopUA || uaGesture(e));
  lastPopUA = false;
  // Las hojas que siguieran abiertas eran de la pantalla anterior. (Una llegada a la entrada de una hoja que
  // ya no existe la salta onPopState, que va siempre antes.)
  dropOverlays((o) => o.committed, { ua, nav: true });
  render(ua ? 'none' : kind, { ua });
  commitOverlays();
}

/** Marca la entrada actual del historial con su posición (conserva el estado que tuviera). */
function tagEntry(idx) {
  try {
    const st = history.state && typeof history.state === 'object' ? history.state : {};
    history.replaceState({ ...st, __idx: idx }, '');
  } catch { /* sin historial utilizable */ }
}

let isTraversal = false;

/**
 * Tipo de transición del hashchange actual y posición en el historial. Una entrada ya marcada es un
 * recorrido del historial (atrás si su posición es menor); una sin marcar es nueva (navigate, enlace o URL).
 */
function historyKind(requested) {
  const st = history.state;
  if (st && typeof st.__idx === 'number') {
    const idx = st.__idx;
    const kind = requested ? requested.kind : idx < histIdx ? 'pop' : idx > histIdx ? 'push' : 'none';
    isTraversal = true;
    histIdx = idx;
    return kind;
  }
  if (!(requested && requested.replace)) histIdx++;
  tagEntry(histIdx);
  return requested ? requested.kind : 'push';
}

// ---------------------------------------------------------------------------
// Gesto del sistema
// ---------------------------------------------------------------------------

let edge = null; // { x, y, t, moved, end, cancelled } toque que empezó junto al borde izquierdo
let lastPopUA = false;

/** Sigue los toques que empiezan junto al borde izquierdo (pasivo: nunca bloquea el gesto del sistema). */
function watchEdgeGesture() {
  const opts = { passive: true, capture: true };
  const begin = (x, y) => {
    edge = x <= EDGE_PX ? { x, y, t: now(), moved: false, end: 0, cancelled: false } : null;
  };
  const move = (x, y) => {
    if (edge && !edge.end && x - edge.x > 10 && x - edge.x > Math.abs(y - edge.y)) edge.moved = true;
  };
  const finish = (cancelled) => {
    if (edge && !edge.end) { edge.end = now(); edge.cancelled = cancelled; }
  };
  window.addEventListener('touchstart', (e) => { if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY); else edge = null; }, opts);
  window.addEventListener('touchmove', (e) => { if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY); }, opts);
  window.addEventListener('touchend', () => finish(false), opts);
  window.addEventListener('touchcancel', () => finish(true), opts);
  // Navegadores que solo dan eventos de puntero (o los dan además): mismo estado, sin duplicar.
  window.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse' && e.isPrimary && (!edge || edge.end)) begin(e.clientX, e.clientY); }, opts);
  window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse' && e.isPrimary) move(e.clientX, e.clientY); }, opts);
  window.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse' && e.isPrimary) finish(false); }, opts);
  window.addEventListener('pointercancel', (e) => { if (e.pointerType !== 'mouse' && e.isPrimary) finish(true); }, opts);
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** ¿Este recorrido del historial lo ha animado ya el sistema (gesto de deslizar)? */
function uaGesture(e) {
  if (e && e.hasUAVisualTransition) return true;
  if (edge && (edge.moved || edge.cancelled)) {
    const t = now();
    const recent = edge.end ? t - edge.end <= EDGE_WINDOW_MS : t - edge.t <= 3000;
    if (recent) return true;
  }
  return typeof navigator !== 'undefined' && navigator.standalone === true;
}

// ---------------------------------------------------------------------------
// Entradas de historial de las hojas
// ---------------------------------------------------------------------------

let overlays = []; // [{ id, onPop, committed, released }] de abajo arriba
let ovSeq = 0;
const ovBase = Date.now(); // ids distintos de los de antes de una recarga
let awaitingPops = 0; // history.back()/go() pedidos por la app cuya popstate aún no ha llegado
let backInFlight = false; // history.back() de back() cuyo cambio de pantalla aún no ha llegado
let backTimer = null;
let afterBack = null; // navegación pedida mientras tanto (la última)
let popTimer = null;
let queued = []; // navegaciones que esperan a esas popstate
let pendingReplace = null; // replaceUrl() pendiente de aplicar a la entrada de la pantalla
let fixedHash = null;

/**
 * Da a una hoja su propia entrada de historial. onPop({ ua }) se llama si el usuario vuelve atrás por encima
 * de ella (gesto o botón) o si se cambia de pantalla: la hoja debe cerrarse SIN llamar a la función devuelta.
 * La función devuelta la llama la hoja al cerrarse por la interfaz: quita su entrada (history.back()).
 */
export function pushOverlay(onPop) {
  const ov = { id: 0, onPop, committed: false, released: false };
  overlays.push(ov);
  commitOverlays();
  return () => releaseOverlay(ov);
}

/** ¿Tiene la hoja de arriba ya su entrada de historial? (para pruebas) */
export function overlayDepth() {
  return overlays.filter((o) => o.committed && !o.released).length;
}

/** Crea las entradas de las hojas que aún no la tienen (espera si hay una navegación o una vuelta en camino). */
function commitOverlays() {
  if (!started || navPending || awaitingPops > 0 || queued.length) return;
  for (const ov of overlays) {
    if (ov.committed || ov.released) continue;
    try {
      const st = history.state && typeof history.state === 'object' ? history.state : {};
      ov.id = ovBase + ++ovSeq;
      history.pushState({ ...st, __idx: histIdx, __ov: ov.id }, '', location.href);
      ov.committed = true;
    } catch {
      ov.released = true; // sin historial utilizable (o límite de Safari): la hoja funciona sin entrada
    }
  }
  overlays = overlays.filter((o) => !(o.released && !o.committed));
}

function releaseOverlay(ov) {
  if (ov.released) return;
  ov.released = true;
  if (!ov.committed) { overlays = overlays.filter((o) => o !== ov); return; }
  // Se quitan del historial las entradas liberadas que están arriba del todo (una hoja de debajo que se
  // cierra antes que la de encima espera a que esta se cierre).
  let n = 0;
  const committed = overlays.filter((o) => o.committed);
  for (let i = committed.length - 1; i >= 0 && committed[i].released; i--) n++;
  if (!n) return;
  const gone = new Set(committed.slice(committed.length - n));
  overlays = overlays.filter((o) => !gone.has(o));
  goBack(n);
}

/** Cierra (onPop) y olvida las hojas que cumplen `which`, de arriba abajo. */
function dropOverlays(which, info) {
  const drop = overlays.filter(which);
  if (!drop.length) return;
  overlays = overlays.filter((o) => !drop.includes(o));
  for (const o of drop.reverse()) {
    if (!o.released) {
      o.released = true;
      try { o.onPop(info); } catch (err) { console.error('[router] hoja', err); }
    }
  }
}

/** history.go(-n) cuya popstate se espera (y se ignora). */
function goBack(n) {
  awaitingPops++;
  clearTimeout(popTimer);
  // Si la popstate no llega (historial raro), no se deja nada bloqueado.
  popTimer = setTimeout(() => { if (awaitingPops) { awaitingPops = 0; flushQueued(); } }, 1500);
  try { history.go(-n); } catch { awaitingPops = Math.max(0, awaitingPops - 1); }
}

/**
 * Con vueltas del historial en camino o con hojas con entrada propia, la navegación espera: primero se cierran
 * las hojas y se quitan sus entradas; al llegar la popstate se ejecuta `fn`. Devuelve true si la ha aplazado.
 */
function deferForOverlays(fn) {
  const live = overlays.filter((o) => o.committed);
  if (awaitingPops === 0 && !live.length && !queued.length) return false;
  queued.push(fn);
  if (live.length) {
    dropOverlays(() => true, { ua: false, nav: true });
    goBack(live.length);
  } else if (awaitingPops === 0) {
    setTimeout(flushQueued, 0);
  }
  return true;
}

function flushQueued() {
  clearTimeout(popTimer);
  applyPendingReplace();
  const fns = queued;
  queued = [];
  for (const fn of fns) fn();
  commitOverlays();
}

/** replaceUrl() se aplica a la entrada de la PANTALLA (no a la de una hoja), cuando está arriba. */
function applyPendingReplace() {
  if (!pendingReplace) return;
  try {
    history.replaceState(history.state, '', pendingReplace); // la de arriba (así una recarga abre la buena)
  } catch { /* sin historial */ }
  const st = history.state;
  if (awaitingPops === 0 && !(st && st.__ov)) pendingReplace = null;
}

function onPopState(e) {
  // La vuelta de back() ya llegó: su hashchange va justo detrás (lo normal es aterrizar ahí); si no llegara, poco después.
  if (backInFlight) { clearTimeout(backTimer); backTimer = setTimeout(landBack, 250); }
  const st = history.state;
  const onOverlay = st && st.__ov;
  // Vuelta a la entrada de la pantalla con un replaceUrl() pendiente: se aplica ya (sin volver a montar).
  if (pendingReplace && !onOverlay) {
    const want = pendingReplace;
    pendingReplace = null;
    if (location.hash !== want) {
      try { history.replaceState(st, '', want); fixedHash = want; } catch { /* sin historial */ }
      setTimeout(() => { if (fixedHash === want) fixedHash = null; }, 150);
    }
  }
  if (awaitingPops > 0) {
    awaitingPops--;
    if (awaitingPops === 0) setTimeout(flushQueued, 0);
    return;
  }
  // Recorrido pedido por el usuario (gesto, botón del navegador).
  const ua = uaGesture(e);
  lastPopUA = ua;
  setTimeout(() => { lastPopUA = false; }, 300);
  if (edge && edge.end) edge = null;
  const i = onOverlay ? overlays.findIndex((o) => o.committed && o.id === st.__ov) : -1;
  if (onOverlay && i < 0) {
    // Entrada de una hoja que ya no está (p. ej. «adelante» tras cerrarla): se vuelve a la de la pantalla.
    dropOverlays((o) => o.committed, { ua, nav: false });
    setTimeout(() => goBack(1), 0);
    return;
  }
  dropOverlays((o, k) => k > i, { ua, nav: false });
}

// ---------------------------------------------------------------------------
// Scroll por entrada del historial
// ---------------------------------------------------------------------------

const scrollMap = new Map();
let scrollRaf = 0;
let restoring = null; // { y, token, until, stop } restauración en curso

/** Scroll de la página (con una hoja abierta el body está fijo en top:-y: ese es el scroll real). */
function currentY() {
  const b = typeof document !== 'undefined' && document.body;
  if (b && b.style.position === 'fixed') return Math.max(0, -parseFloat(b.style.top || '0') || 0);
  return window.scrollY || 0;
}

function onScroll() {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    if (navPending || rendering > 0 || restoring || queued.length) return;
    if (document.body.style.position === 'fixed') return; // hoja abierta: no cambia el de la pantalla
    scrollMap.set(histIdx, window.scrollY || 0);
  });
}

/** Al crear una entrada nueva, lo que hubiera «adelante» en el historial ya no existe. */
function forgetFrom(idx) {
  for (const k of [...scrollMap.keys()]) if (k >= idx) scrollMap.delete(k);
}

function loadScrollMap() {
  try {
    const o = JSON.parse(sessionStorage.getItem(SCROLL_KEY) || '{}');
    for (const [k, v] of Object.entries(o)) if (Number.isFinite(+k) && Number.isFinite(v)) scrollMap.set(+k, v);
  } catch { /* sin sessionStorage */ }
}

function saveScrollMap() {
  try {
    const o = {};
    for (const [k, v] of scrollMap) if (Math.abs(k - histIdx) <= 200) o[k] = Math.round(v);
    sessionStorage.setItem(SCROLL_KEY, JSON.stringify(o));
  } catch { /* sin sessionStorage o lleno */ }
}

/** Coloca el scroll en y (lo que permita el contenido ya pintado). */
function scrollNow(y) {
  if (Math.abs((window.scrollY || 0) - y) >= 1) window.scrollTo(0, y);
}

/**
 * Restaura y aunque el contenido llegue más tarde (montaje asíncrono, gráficas): se reaplica al crecer la
 * página, hasta alcanzarlo, RESTORE_MS o el primer toque/rueda/tecla del usuario.
 */
function keepRestoring(y, token) {
  stopRestoring();
  if (y <= 0 || (window.scrollY || 0) >= y - 1) return;
  const r = { y, token, stop: null };
  const target = document.documentElement;
  let ro = null;
  const check = () => {
    if (restoring !== r || token !== mountToken) return stopRestoring();
    scrollNow(y);
    if ((window.scrollY || 0) >= y - 1) stopRestoring();
  };
  const user = () => stopRestoring();
  const timer = setTimeout(() => stopRestoring(), RESTORE_MS);
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(check);
    ro.observe(viewEl || target);
  }
  const evs = ['touchstart', 'wheel', 'keydown', 'pointerdown'];
  evs.forEach((ev) => window.addEventListener(ev, user, { passive: true, capture: true }));
  r.stop = () => {
    clearTimeout(timer);
    if (ro) ro.disconnect();
    evs.forEach((ev) => window.removeEventListener(ev, user, { capture: true }));
  };
  restoring = r;
}

function stopRestoring() {
  const r = restoring;
  restoring = null;
  if (r && r.stop) r.stop();
  if (r && started && !navPending && !rendering) scrollMap.set(histIdx, window.scrollY || 0);
}

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

const ignore = () => {};

/** 'vt' (View Transitions), 'css' (solo entrada de la vista nueva) o 'none'. */
function transitionMode(kind) {
  if (kind === 'none' || !NAV_KINDS.has(kind)) return 'none';
  if (typeof document === 'undefined' || document.visibilityState === 'hidden') return 'none';
  if (!viewEl || !viewEl.isConnected) return 'none';
  return typeof document.startViewTransition === 'function' ? 'vt' : 'css';
}

/** Termina ya la transición en curso (la vista que haya queda tal cual, sin animación; nada se rompe). */
function skipActiveTransition() {
  if (activeVT) {
    const vt = activeVT;
    activeVT = null;
    try { vt.skipTransition(); } catch { /* ya terminada */ }
    delete document.documentElement.dataset.nav;
  }
  endEnter();
}

async function render(kind = 'none', opts = {}) {
  rendering++;
  try {
    return await renderRoute(kind, opts);
  } finally {
    rendering--;
  }
}

async function renderRoute(kind, { ua = false } = {}) {
  const token = ++mountToken;
  // Otra navegación animada (o la vuelta del gesto): la transición en curso se salta. Un montaje sin
  // animación (refresh(), una redirección con replace) la deja seguir: la imagen nueva es la vista en vivo.
  if (kind !== 'none' || ua) skipActiveTransition();
  const { path, query, raw } = parseHash();
  const found = match(path);
  if (!found) {
    location.replace('#/today');
    return;
  }
  const { route, params } = found;
  if (cleanup) {
    try { cleanup(); } catch (err) { console.error('[router] cleanup', err); }
    cleanup = null;
  }
  current = { path, raw, params: { ...query, ...params }, route };
  try { onRouteChange(current); } catch (err) { console.error('[router] onRouteChange', err); }
  const y = pendingScroll ?? 0;
  pendingScroll = null;
  let mod;
  try {
    mod = await route.load();
  } catch (err) {
    if (token !== mountToken) return;
    showError(err);
    return;
  }
  if (token !== mountToken) return;

  const mode = transitionMode(kind);
  lastNav = { kind, mode, path, transition: null, ua };
  const ctx = { kind, mode, ua, y, path };
  if (mode === 'vt') return mountWithViewTransition(token, mod, route, ctx);
  return mountView(token, mod, route, mode === 'css' ? kind : null, ctx);
}

/**
 * View Transitions: el navegador captura la pantalla actual como imagen y llama a update(), que monta la
 * nueva (sustituyendo a la anterior). update() no espera montajes lentos (como mucho UPDATE_MAX_MS): lo que
 * se pinte después aparece ya dentro de la animación (la imagen nueva es «en vivo»).
 */
async function mountWithViewTransition(token, mod, route, ctx) {
  const root = document.documentElement;
  const { kind } = ctx;
  let mounted = null;
  const update = () => {
    if (token !== mountToken) return undefined; // llegó otra navegación antes de empezar: la monta ella
    mounted = mountView(token, mod, route, null, ctx);
    return Promise.race([mounted, new Promise((r) => setTimeout(r, UPDATE_MAX_MS))]);
  };
  root.dataset.nav = kind;
  let vt = null;
  try {
    vt = document.startViewTransition(update);
  } catch {
    vt = null;
  }
  if (!vt) {
    delete root.dataset.nav;
    lastNav.mode = 'none';
    return mountView(token, mod, route, null, { ...ctx, mode: 'none' });
  }
  activeVT = vt;
  lastNav.transition = vt;
  const done = () => {
    if (activeVT !== vt) return; // se saltó o ya hay otra (con su propio data-nav)
    activeVT = null;
    delete root.dataset.nav;
  };
  vt.ready.catch(ignore); // AbortError/InvalidStateError si se salta (otra navegación, pestaña oculta…)
  vt.finished.then(done, done);
  await vt.updateCallbackDone.catch(ignore);
  if (mounted) await mounted;
}

/** Monta la vista de la ruta en un contenedor nuevo (sustituye al anterior: nunca hay dos copias vivas). */
async function mountView(token, mod, route, enterKind, ctx) {
  const { y } = ctx;
  stopRestoring();
  const container = document.createElement('div');
  container.className = 'view-inner';
  if (enterKind) startEnter(container, enterKind);
  viewEl.replaceChildren(container);
  const runHooks = () => {
    for (const fn of mountHooks) {
      try { fn({ ...ctx, y: window.scrollY || 0 }); } catch (err) { console.error('[router] onMount', err); }
    }
  };
  try {
    const fn = mod[route.fn];
    if (typeof fn !== 'function') throw new Error(`La vista ${route.pattern} no exporta ${route.fn}()`);
    const res = fn(container, current.params);
    // Aparición escalonada (solo push animado): la clase va antes de la primera pintura.
    if (ctx.kind === 'push' && ctx.mode === 'vt') startStagger(container);
    if (res && typeof res.then === 'function') {
      // Montaje asíncrono: lo ya pintado se coloca ya (así lo captura la transición, o coincide con la foto
      // del gesto), sin esperar al final.
      if (y > 0) scrollNow(y); else window.scrollTo(0, 0);
      runHooks();
    }
    const out = await res;
    if (token !== mountToken) {
      if (typeof out === 'function') out();
      return;
    }
    cleanup = typeof out === 'function' ? out : null;
  } catch (err) {
    if (token !== mountToken) return;
    showError(err);
  }
  if (token !== mountToken) return;
  if (y > 0) {
    scrollNow(y);
    keepRestoring(y, token);
  } else {
    window.scrollTo(0, 0);
    requestAnimationFrame(() => { if (token === mountToken && !restoring) window.scrollTo(0, 0); });
  }
  runHooks();
}

/** Aparición suave y escalonada de los primeros bloques de la pantalla nueva (css: .view-stagger). */
function startStagger(container) {
  clearTimeout(staggerTimer);
  document.querySelectorAll('.view-stagger').forEach((el) => el.classList.remove('view-stagger'));
  container.classList.add('view-stagger');
  staggerTimer = setTimeout(() => container.classList.remove('view-stagger'), STAGGER_MS);
}

/** Entrada sin View Transitions: clase .view-enter-<tipo> hasta que termina la animación CSS. */
function startEnter(container, kind) {
  endEnter();
  container.classList.add('view-enter', `view-enter-${kind}`);
  const end = () => { if (entering && entering.el === container) endEnter(); };
  container.addEventListener('animationend', (e) => { if (e.target.parentElement === container) end(); });
  entering = { el: container, timer: setTimeout(end, (ENTER_MS[kind] || 300) + 80) };
}

function endEnter() {
  if (!entering) return;
  clearTimeout(entering.timer);
  entering.el.classList.remove('view-enter', 'view-enter-push', 'view-enter-pop', 'view-enter-tab');
  entering = null;
}

function showError(err) {
  console.error('[router]', err);
  const box = document.createElement('div');
  box.className = 'content content-safe'; // sin cabecera: deja sitio a la barra de estado (black-translucent)
  box.innerHTML = `
    <div class="card card-danger">
      <h2>Algo ha fallado al abrir esta pantalla</h2>
      <p class="muted">Tus datos están a salvo. Detalle técnico:</p>
      <pre class="err-pre"></pre>
      <button class="btn btn-primary" type="button">Ir a Hoy</button>
    </div>`;
  box.querySelector('pre').textContent = String(err && (err.stack || err.message || err));
  box.querySelector('button').addEventListener('click', () => navigate('#/today', { replace: true }));
  viewEl.replaceChildren(box);
}
