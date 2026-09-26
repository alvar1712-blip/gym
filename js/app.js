// app.js — arranque, rutas, barra de pestañas, service worker y avisos globales.
import * as store from './store.js';
import { defineRoutes, start, navigate, currentRoute, refresh } from './router.js';
import { h, icon, toast, closeAllSheets, closeStaleToasts } from './ui.js';

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
  { pattern: '/weekly', tab: 'progress', load: v('weekly'), fn: 'mountWeekly' },
  { pattern: '/goals', tab: 'progress', load: v('goals'), fn: 'mountGoals' },
  { pattern: '/goal/new', tab: 'progress', load: v('goals'), fn: 'mountGoalEdit' },
  { pattern: '/goal/:id', tab: 'progress', load: v('goals'), fn: 'mountGoalEdit' },
  { pattern: '/import', tab: 'today', load: v('import'), fn: 'mountImport' },
  { pattern: '/predictions', tab: 'progress', load: v('predictions'), fn: 'mountPredictions' },
  { pattern: '/summary', tab: 'progress', load: v('summary'), fn: 'mountSummary' },
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
        navigate(t.href);
      }
    });
    tabButtons[t.id] = b;
    return b;
  }));
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
  for (const [id, b] of Object.entries(tabButtons)) b.classList.toggle('active', id === activeTab);
  document.body.dataset.route = route.route.pattern;
  closeStaleToasts();
  paintUpdateBar();
}

function updateBadges() {
  const dot = tabButtons.settings?.querySelector('.tab-dot');
  if (dot) dot.hidden = !store.backupOverdue();
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
  store.on('reset', () => { updateBadges(); navigate('#/today', { replace: true }); refresh({ keepScroll: false }); });

  renderTabbar();
  defineRoutes(ROUTES);

  // Si hay una sesión de fuerza en curso, se reabre directamente.
  const active = store.activeSession();
  if (active) {
    history.replaceState(null, '', `#/session/${active.id}`);
  } else if (!location.hash || location.hash === '#' || location.hash === '#/') {
    history.replaceState(null, '', '#/today');
  }
  await start(viewEl, onRouteChange);
  document.documentElement.classList.add('ready');
}

boot();

// Exposición mínima para pruebas automáticas y depuración.
window.__app = { store, navigate, refresh };
