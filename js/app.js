// app.js — arranque, rutas, barra de pestañas, service worker y avisos globales.
import * as store from './store.js';
import { defineRoutes, start, navigate, currentRoute, refresh } from './router.js';
import { h, icon, toast, closeAllSheets, closeStaleToasts, closeStaleSheets } from './ui.js';

const v = (name) => () => import(`./views/${name}.js`);

// Tabla de rutas. `tab` = pestaña resaltada. `inherit: true` = pantalla compartida entre pestañas
// (sesión, actividad): se queda resaltada la pestaña desde la que se abrió (ver tabFor).
export const ROUTES = [
  { pattern: '/today', tab: 'today', load: v('today'), fn: 'mountToday' },
  { pattern: '/calendar', tab: 'calendar', load: v('calendar'), fn: 'mountCalendar' },
  { pattern: '/day/:date', tab: 'calendar', load: v('calendar'), fn: 'mountDay' },
  { pattern: '/history', tab: 'calendar', load: v('history'), fn: 'mountHistory' },
  { pattern: '/session/:id', tab: 'today', inherit: true, load: v('session'), fn: 'mountSession' },
  { pattern: '/session/:id/summary', tab: 'today', inherit: true, load: v('session'), fn: 'mountSessionSummary' },
  { pattern: '/activity/new', tab: 'today', inherit: true, load: v('activity'), fn: 'mountActivity' },
  { pattern: '/activity/:id', tab: 'today', inherit: true, load: v('activity'), fn: 'mountActivity' },
  { pattern: '/bodyweight', tab: 'progress', load: v('bodyweight'), fn: 'mountBodyweight' },
  { pattern: '/exercises', tab: 'exercises', load: v('exercises'), fn: 'mountExercises' },
  { pattern: '/exercise/new', tab: 'exercises', load: v('exercises'), fn: 'mountExerciseEdit' },
  { pattern: '/exercise/:id', tab: 'exercises', load: v('exercises'), fn: 'mountExerciseDetail' },
  { pattern: '/exercise/:id/edit', tab: 'exercises', load: v('exercises'), fn: 'mountExerciseEdit' },
  { pattern: '/templates', tab: 'exercises', load: v('templates'), fn: 'mountTemplates' },
  { pattern: '/template/:id', tab: 'exercises', load: v('templates'), fn: 'mountTemplateEdit' },
  { pattern: '/settings', tab: 'settings', load: v('settings'), fn: 'mountSettings' },
  { pattern: '/settings/week', tab: 'settings', load: v('settings'), fn: 'mountWeekPattern' },
  { pattern: '/settings/thresholds', tab: 'settings', load: v('settings'), fn: 'mountThresholds' },
  { pattern: '/settings/data', tab: 'settings', load: v('settings'), fn: 'mountData' },
  { pattern: '/progress', tab: 'progress', load: v('progress'), fn: 'mountProgress' },
  { pattern: '/progress/exercise/:id', tab: 'progress', load: v('progress'), fn: 'mountExerciseProgress' },
  { pattern: '/records', tab: 'progress', load: v('progress'), fn: 'mountRecords' },
  { pattern: '/records/past', tab: 'progress', load: v('past-records'), fn: 'mountPastRecords' },
  { pattern: '/records/past/new', tab: 'progress', load: v('past-records'), fn: 'mountPastRecordEdit' },
  { pattern: '/records/past/:id', tab: 'progress', load: v('past-records'), fn: 'mountPastRecordEdit' },
  { pattern: '/races', tab: 'progress', load: v('races'), fn: 'mountRaces' },
  { pattern: '/races/new', tab: 'progress', load: v('races'), fn: 'mountRaceEdit' },
  { pattern: '/races/:id', tab: 'progress', load: v('races'), fn: 'mountRaceEdit' },
  { pattern: '/weekly', tab: 'progress', load: v('weekly'), fn: 'mountWeekly' },
  { pattern: '/goals', tab: 'progress', load: v('goals'), fn: 'mountGoals' },
  { pattern: '/goal/new', tab: 'progress', load: v('goals'), fn: 'mountGoalEdit' },
  { pattern: '/goal/:id', tab: 'progress', load: v('goals'), fn: 'mountGoalEdit' },
  { pattern: '/import', tab: 'today', load: v('import'), fn: 'mountImport' },
  { pattern: '/predictions', tab: 'progress', load: v('predictions'), fn: 'mountPredictions' },
  { pattern: '/summary', tab: 'progress', load: v('summary'), fn: 'mountSummary' },
  { pattern: '/analysis', tab: 'progress', load: v('analysis'), fn: 'mountAnalysis' },
  { pattern: '/recovery', tab: 'progress', load: v('recovery'), fn: 'mountRecovery' },
  { pattern: '/cycle', tab: 'today', load: v('cycle'), fn: 'mountCycle' },
  { pattern: '/settings/profile', tab: 'settings', load: v('settings'), fn: 'mountProfile' },
  // Ronda 6 (docs/MEJORAS6.md): contexto del usuario y bienvenida
  { pattern: '/context', tab: 'settings', inherit: true, load: v('context'), fn: 'mountContext' },
  { pattern: '/context/new', tab: 'settings', inherit: true, load: v('context'), fn: 'mountContextEdit' },
  { pattern: '/context/:id', tab: 'settings', inherit: true, load: v('context'), fn: 'mountContextEdit' },
  { pattern: '/welcome', tab: 'today', load: v('welcome'), fn: 'mountWelcome' },
];

const TABS = [
  { id: 'today', label: 'Hoy', icon: 'bolt', href: '#/today' },
  { id: 'calendar', label: 'Calendario', icon: 'calendar', href: '#/calendar' },
  { id: 'progress', label: 'Progreso', icon: 'chart', href: '#/progress' },
  { id: 'exercises', label: 'Ejercicios', icon: 'dumbbell', href: '#/exercises' },
  { id: 'settings', label: 'Ajustes', icon: 'sliders', href: '#/settings' },
];

let tabButtons = {};
let activeTab = null;
const ROOT_ROUTES = new Set(TABS.map((t) => t.href.slice(1)));

function renderTabbar() {
  const bar = document.getElementById('tabbar');
  tabButtons = {};
  bar.replaceChildren(...TABS.map((t) => {
    const b = h('a.tab', { href: t.href, 'aria-label': t.label, dataset: { tab: t.id } },
      h('span.tab-icon', icon(t.icon, 24), h('span.tab-dot', { hidden: true })),
      h('span.tab-label', t.label));
    b.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllSheets();
      const cur = currentRoute();
      if (cur && cur.path === t.href.slice(1)) {
        refresh({ keepScroll: false });
      } else {
        // Otra pestaña: fundido corto. La misma pestaña desde una pantalla interior: vuelve a su raíz («atrás»).
        navigate(t.href, { transition: t.id === activeTab ? 'pop' : 'tab' });
      }
    });
    tabButtons[t.id] = b;
    return b;
  }));
  bar.style.setProperty('--tab-n', TABS.length);
  updateBadges();
}

/** Pestaña que se resalta: la de la ruta; en sesión/actividad, la de origen (una sesión en curso es de «Hoy»). */
function tabFor(route) {
  const r = route.route;
  if (!r.inherit) return r.tab;
  if (r.pattern.startsWith('/session/') && store.get('sessions', route.params.id)?.status === 'active') return 'today';
  return activeTab || r.tab;
}

function onRouteChange(route) {
  activeTab = tabFor(route);
  for (const [id, b] of Object.entries(tabButtons)) {
    const on = id === activeTab;
    b.classList.toggle('active', on);
    // VoiceOver: «página actual» en la pestaña activa (el color solo no se oye).
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  moveTabPill(TABS.findIndex((t) => t.id === activeTab));
  document.body.dataset.route = route.route.pattern;
  // Hojas y avisos con acción de la pantalla anterior no se quedan abiertos sobre la nueva.
  closeStaleSheets();
  closeStaleToasts();
  paintUpdateBar();
}

/**
 * Cápsula «líquida» de la pestaña activa (css/app.css .tabbar::before): se desliza hasta la pestaña con un
 * muelle y, mientras va, se estira hacia donde se mueve (más cuanto más lejos) y se recoge. data-pill alterna
 * entre dos animaciones iguales para que se repita en cada cambio.
 */
let pillIndex = null;
function moveTabPill(i) {
  const bar = document.getElementById('tabbar');
  if (!bar || i < 0) return;
  bar.style.setProperty('--tab-i', i);
  const prev = pillIndex;
  pillIndex = i;
  if (prev == null || prev === i || !document.documentElement.classList.contains('ready')) return;
  const dist = Math.abs(i - prev);
  bar.style.setProperty('--pill-stretch', String(Math.min(1.55, 1.16 + 0.1 * dist)));
  bar.style.setProperty('--pill-origin', i > prev ? '0% 50%' : '100% 50%');
  bar.dataset.pill = bar.dataset.pill === 'a' ? 'b' : 'a';
}

function updateBadges() {
  const dot = tabButtons.settings?.querySelector('.tab-dot');
  if (dot) dot.hidden = !store.backupOverdue();
}

// ---------------------------------------------------------------------------
// Tamaño de texto (Dynamic Type de iOS)
// ---------------------------------------------------------------------------

/**
 * --ts en <html>: factor por el que se multiplican los font-size del CSS (calc(Npx * var(--ts))). En Safari
 * se mide el tamaño del texto del sistema (font: -apple-system-body, 17px por defecto) y se escala entre
 * 1 y 1,5. localStorage 'entreno.textScale' lo fuerza (pruebas; sin interfaz). Si no, se queda en 1.
 */
function applyTextScale() {
  const root = document.documentElement;
  let scale = null;
  try {
    const forced = parseFloat(localStorage.getItem('entreno.textScale'));
    if (Number.isFinite(forced) && forced > 0) scale = forced;
  } catch { /* almacenamiento bloqueado */ }
  if (scale == null && typeof CSS !== 'undefined' && CSS.supports && CSS.supports('font', '-apple-system-body')) {
    const probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;font:-apple-system-body';
    probe.textContent = 'A';
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (px > 0) scale = Math.round(Math.min(1.5, Math.max(1, px / 17)) * 100) / 100;
  }
  if (scale != null) root.style.setProperty('--ts', String(scale));
  // Con el texto grande, las filas que a 100 % se cortan con «…» pasan a ocupar más líneas (css/app.css)
  root.classList.toggle('text-large', (scale ?? 1) > 1);
}

// ---------------------------------------------------------------------------
// Service worker y actualizaciones
// ---------------------------------------------------------------------------
let updateBar = null; // { el, worker }

/**
 * Aviso fijo «Hay una versión nueva» (no es un toast: ningún otro aviso lo sustituye). Se muestra en las
 * pantallas raíz de las pestañas (no interrumpe una sesión ni un formulario) hasta que se pulsa;
 * «×» lo oculta hasta la próxima vez que la app vuelve a primer plano.
 */
function showUpdateBar(worker, onUpdate) {
  if (updateBar && updateBar.worker === worker) return;
  hideUpdateBar();
  const el = h('div.update-bar', { role: 'status', 'aria-live': 'polite' },
    h('span.update-bar-msg', 'Hay una versión nueva de la app.'),
    h('button.btn.btn-primary.btn-sm.update-bar-btn', { type: 'button', onClick: () => { hideUpdateBar(); onUpdate(); } }, 'Actualizar'),
    h('button.icon-btn.update-bar-close', { type: 'button', 'aria-label': 'Ahora no', onClick: hideUpdateBar }, icon('x', 20)));
  document.body.appendChild(el);
  updateBar = { el, worker };
  paintUpdateBar();
}
function hideUpdateBar() {
  if (updateBar) updateBar.el.remove();
  updateBar = null;
}
function paintUpdateBar() {
  if (updateBar) updateBar.el.hidden = !ROOT_ROUTES.has(document.body.dataset.route);
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
  // Solo se recarga al cambiar de versión si el usuario pulsó «Actualizar» o si ya había una versión
  // controlando la página (actualizada desde otra pestaña). En la primera instalación clients.claim()
  // también dispara 'controllerchange' y no hay nada que recargar (se perdería lo que se esté tecleando).
  const hadController = !!navigator.serviceWorker.controller;
  let userAsked = false;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || (!userAsked && !hadController)) return;
    reloading = true;
    store.flush().finally(() => location.reload());
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker = reg.waiting) => {
      if (!worker || worker.state === 'redundant' || !navigator.serviceWorker.controller) return;
      showUpdateBar(worker, () => {
        userAsked = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      });
    };
    offer();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // Al volver a primer plano (iOS suele suspender la app en vez de cerrarla): buscar versión nueva y
    // volver a ofrecer la que ya esté esperando.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      offer();
      reg.update().then(() => offer(), () => {});
    });
  }).catch((err) => console.warn('[sw] registro fallido', err));
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
async function boot() {
  const viewEl = document.getElementById('view');
  applyTextScale();
  // El usuario puede cambiar el tamaño de texto en Ajustes con la app en segundo plano.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') applyTextScale(); });
  registerSW();
  try {
    await store.init();
  } catch (err) {
    console.error(err);
    viewEl.replaceChildren(h('div.content.content-safe',
      h('div.card.card-danger',
        h('h2', 'No se pudo abrir el almacenamiento'),
        h('p', 'La app necesita IndexedDB. Si estás en modo privado de Safari, ábrela en modo normal o desde la pantalla de inicio.'),
        h('pre.err-pre', String(err && (err.message || err))),
        h('button.btn.btn-primary', { type: 'button', onClick: () => location.reload() }, 'Reintentar'))));
    document.getElementById('splash')?.remove();
    document.getElementById('app')?.removeAttribute('inert');
    return;
  }
  store.requestPersist();

  // Guardar todo lo pendiente al salir o pasar a segundo plano (iOS).
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') store.flush(); });
  window.addEventListener('pagehide', () => { store.flush(); });
  window.addEventListener('beforeunload', () => { store.flush(); });

  store.on('error', ({ error }) => {
    toast(`No se pudo guardar: ${error?.message || error}. Vuelve a intentarlo.`, { kind: 'error', duration: 6000 });
  });
  store.on('change', (d) => { if (d.store === 'meta' || d.store === 'sessions' || d.store === 'bodyweight') updateBadges(); });
  // Tras sustituir o borrar todo, a Hoy con UN solo montaje: si la URL ya es #/today, navigate() la vuelve a montar
  // (refresh, arriba del todo); si no, la monta su hashchange. (Con navigate + refresh, Hoy se montaba dos veces:
  // ~600 ms más al restaurar una copia de años; M20.)
  store.on('reset', () => { updateBadges(); navigate('#/today', { replace: true }); });

  renderTabbar();
  defineRoutes(ROUTES);

  // Si hay una sesión de fuerza en curso, se reabre directamente.
  const active = store.activeSession();
  if (active) {
    history.replaceState(null, '', `#/session/${active.id}`);
  } else if (!location.hash || location.hash === '#' || location.hash === '#/') {
    history.replaceState(null, '', '#/today');
  }
  window.__boot.storeReady = performance.now() - window.__boot.t0;
  await start(viewEl, onRouteChange);
  window.__boot.mounted = performance.now() - window.__boot.t0;
  document.documentElement.classList.add('ready');
  await hideSplash(viewEl);
}

// ---------------------------------------------------------------------------
// Pantalla de arranque (index.html #splash; docs/PULIDO.md §27)
// ---------------------------------------------------------------------------
/** Mínimo visible desde que se ve el logo: una entrada con ritmo de app nativa, nunca un retraso artificial largo. */
export const SPLASH_MIN_MS = 800;
/** Lo que se espera a las tarjetas de Hoy tras montar; si tardan más, se entra igual (no se esconde una lentitud). */
const SPLASH_CARDS_CAP_MS = 1500;
const SPLASH_FADE_MS = 220;

/** Hoy completo bajo el logo: el hueco de las tarjetas marca data-ready cuando ha terminado (o el tope). */
function todayCardsReady(viewEl) {
  const done = () => !viewEl.querySelector('.today') || !!viewEl.querySelector('.today-extra[data-ready]');
  if (done()) return Promise.resolve(true);
  return new Promise((resolve) => {
    const obs = new MutationObserver(() => { if (done()) { obs.disconnect(); clearTimeout(timer); resolve(true); } });
    const timer = setTimeout(() => { obs.disconnect(); resolve(false); }, SPLASH_CARDS_CAP_MS);
    obs.observe(viewEl, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-ready'] });
  });
}

/**
 * Retira la pantalla de arranque cuando la app está lista DEBAJO y ha pasado el mínimo:
 * duración = máx(SPLASH_MIN_MS, tiempo real hasta Hoy listo). Funde 220 ms y sale del DOM (sin capas invisibles).
 * Mientras está, la app es inerte (no se toca nada de debajo). Deja los tiempos en window.__boot.
 */
async function hideSplash(viewEl) {
  const splash = document.getElementById('splash');
  const app = document.getElementById('app');
  const b = window.__boot;
  if (!splash) { app?.removeAttribute('inert'); return; }
  b.cardsInTime = await todayCardsReady(viewEl);
  b.appReady = performance.now() - b.t0;
  const wait = SPLASH_MIN_MS - (performance.now() - b.t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  // Hoy ya está montado debajo de un splash opaco: el fundido puede empezar ya (esperar un fotograma más solo
  // añadía tiempo; en WebKit con la página cargada, hasta ~300 ms)
  b.fadeStart = performance.now() - b.t0;
  app.removeAttribute('inert');
  splash.classList.add('splash-out');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  await new Promise((r) => setTimeout(r, reduce ? 60 : SPLASH_FADE_MS));
  splash.remove();
  b.interactive = performance.now() - b.t0;
  document.documentElement.classList.add('splash-done');
}

boot();

// Exposición mínima para pruebas automáticas y depuración. `__app.navigate` salta a la ruta SIN transición
// (como abrir la URL; las pruebas hacen capturas justo después). La navegación de la app sí se anima.
window.__app = { store, navigate: (hash, opts = {}) => navigate(hash, { transition: 'none', ...opts }), refresh };
