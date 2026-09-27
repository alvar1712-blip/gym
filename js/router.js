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
let rendering = 0; // montajes en curso (para settled())
let lastNav = { kind: 'none', mode: 'none', path: null, transition: null };

const NAV_KINDS = new Set(['push', 'pop', 'tab', 'none']);
/** Duración de la entrada sin View Transitions (igual que --dur-enter / --dur-tab en css/app.css). */
const ENTER_MS = { push: 300, pop: 300, tab: 200 };
/** Lo máximo que se espera a un montaje asíncrono antes de animar (mientras, la pantalla está congelada). */
const UPDATE_MAX_MS = 120;

/**
 * Identificador de la pantalla que el usuario está viendo (o la que va a ver, si hay una navegación
 * pedida y aún no montada). Sirve para cerrar avisos al cambiar de pantalla (ui.toast).
 */
export function routeEpoch() {
  return navPending ? seq + 1 : seq;
}

/**
 * Última transición entre pantallas: { kind:'push'|'pop'|'tab'|'none', mode:'vt'|'css'|'none', path,
 * transition (ViewTransition, solo con mode 'vt'), active (sigue animándose) }. Para pruebas y depuración.
 */
export function navInfo() {
  return { ...lastNav, active: !!(activeVT || entering) };
}

/**
 * Promesa que se resuelve cuando la pantalla está quieta: sin navegación pedida pendiente, sin montaje en
 * curso y sin transición animándose (como mucho ~3 s). Para pruebas.
 */
export async function settled() {
  for (let i = 0; i < 150 && (navPending || rendering > 0 || activeVT || entering); i++) {
    if (activeVT && !navPending && !rendering) await activeVT.finished.catch(ignore);
    else await new Promise((r) => setTimeout(r, 20));
  }
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
 */
export function navigate(hash, { replace = false, transition = null } = {}) {
  if (!hash.startsWith('#')) hash = '#' + hash;
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
  history.replaceState(history.state, '', hash);
  const { path, query, raw } = parseHash(hash);
  const found = match(path);
  if (!found) return;
  current = { path, raw, params: { ...query, ...found.params }, route: found.route };
  onRouteChange(current);
}

/** Vuelve atrás dentro de la app; si no hay historial interno, va a `fallback` (animado como «atrás»). */
export function back(fallback = '#/today') {
  if (depth > 0) {
    depth--;
    navPending = true;
    pendingNav = { kind: 'pop', replace: false };
    history.back();
  } else {
    navigate(fallback, { replace: true, transition: 'pop' });
  }
}

/** Vuelve a montar la vista actual (por defecto conservando el scroll). Sin animación. */
export function refresh({ keepScroll = true } = {}) {
  pendingScroll = keepScroll ? window.scrollY : 0;
  return render('none');
}

export function start(el, onChange) {
  viewEl = el;
  if (onChange) onRouteChange = onChange;
  const st = history.state;
  if (st && typeof st.__idx === 'number') histIdx = st.__idx;
  else tagEntry(histIdx);
  window.addEventListener('hashchange', (e) => {
    seq++;
    const requested = navPending ? pendingNav : null;
    navPending = false;
    pendingNav = null;
    pendingScroll = 0;
    const kind = historyKind(requested);
    // Si el navegador ya animó el gesto de atrás/adelante (Safari al deslizar), no se anima otra vez.
    render(e && e.hasUAVisualTransition ? 'none' : kind);
  });
  return render('none');
}

/** Marca la entrada actual del historial con su posición (conserva el estado que tuviera). */
function tagEntry(idx) {
  try {
    const st = history.state && typeof history.state === 'object' ? history.state : {};
    history.replaceState({ ...st, __idx: idx }, '');
  } catch { /* sin historial utilizable */ }
}

/**
 * Tipo de transición del hashchange actual y posición en el historial. Una entrada ya marcada es un
 * recorrido del historial (atrás si su posición es menor); una sin marcar es nueva (navigate, enlace o URL).
 */
function historyKind(requested) {
  const st = history.state;
  if (st && typeof st.__idx === 'number') {
    const idx = st.__idx;
    const kind = requested ? requested.kind : idx < histIdx ? 'pop' : idx > histIdx ? 'push' : 'none';
    histIdx = idx;
    return kind;
  }
  if (!(requested && requested.replace)) histIdx++;
  tagEntry(histIdx);
  return requested ? requested.kind : 'push';
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

async function render(kind = 'none') {
  rendering++;
  try {
    return await renderRoute(kind);
  } finally {
    rendering--;
  }
}

async function renderRoute(kind) {
  const token = ++mountToken;
  // Otra navegación animada: la transición en curso se salta. Un montaje sin animación (refresh(), una
  // redirección con replace) la deja seguir: la imagen nueva de la transición es la vista en vivo.
  if (kind !== 'none') skipActiveTransition();
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
  lastNav = { kind, mode, path, transition: null };
  if (mode === 'vt') return mountWithViewTransition(token, mod, route, kind);
  return mountView(token, mod, route, mode === 'css' ? kind : null);
}

/**
 * View Transitions: el navegador captura la pantalla actual como imagen y llama a update(), que monta la
 * nueva (sustituyendo a la anterior). update() no espera montajes lentos (como mucho UPDATE_MAX_MS): lo que
 * se pinte después aparece ya dentro de la animación (la imagen nueva es «en vivo»).
 */
async function mountWithViewTransition(token, mod, route, kind) {
  const root = document.documentElement;
  let mounted = null;
  const update = () => {
    if (token !== mountToken) return undefined; // llegó otra navegación antes de empezar: la monta ella
    mounted = mountView(token, mod, route, null);
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
    return mountView(token, mod, route, null);
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
async function mountView(token, mod, route, enterKind) {
  const container = document.createElement('div');
  container.className = 'view-inner';
  if (enterKind) startEnter(container, enterKind);
  viewEl.replaceChildren(container);
  const y = pendingScroll ?? 0;
  try {
    const fn = mod[route.fn];
    if (typeof fn !== 'function') throw new Error(`La vista ${route.pattern} no exporta ${route.fn}()`);
    const res = fn(container, current.params);
    // Montaje asíncrono: lo ya pintado se coloca arriba ya (así lo captura la transición, sin salto al final).
    if (res && typeof res.then === 'function' && y === 0) window.scrollTo(0, 0);
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
  pendingScroll = null;
  if (y === 0) window.scrollTo(0, 0);
  requestAnimationFrame(() => window.scrollTo(0, y));
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
