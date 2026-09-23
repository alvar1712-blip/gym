// router.js — enrutado por hash (#/ruta/:param?query). Sin dependencias de vistas.

let routes = [];
let viewEl = null;
let cleanup = null;
let current = null;
let mountToken = 0;
let depth = 0; // nº de navegaciones internas apiladas (para «atrás»)
let onRouteChange = () => {};
let pendingScroll = null;

/**
 * @param {Array<{pattern:string, tab:string, load:()=>Promise<object>, fn:string}>} list
 */
export function defineRoutes(list) {
  routes = list.map((r) => ({ ...r, keys: [], re: compile(r.pattern, r) }));
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
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route: r, params };
    }
  }
  return null;
}

export function currentRoute() {
  return current;
}

/** Navega a '#/…'. replace=true no crea entrada de historial. */
export function navigate(hash, { replace = false } = {}) {
  if (!hash.startsWith('#')) hash = '#' + hash;
  if (hash === location.hash) { refresh({ keepScroll: false }); return; }
  if (replace) {
    location.replace(hash);
  } else {
    depth++;
    location.hash = hash;
  }
}

/** Vuelve atrás dentro de la app; si no hay historial interno, va a `fallback`. */
export function back(fallback = '#/today') {
  if (depth > 0) {
    depth--;
    history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

/** Vuelve a montar la vista actual (por defecto conservando el scroll). */
export function refresh({ keepScroll = true } = {}) {
  pendingScroll = keepScroll ? window.scrollY : 0;
  return render();
}

export function start(el, onChange) {
  viewEl = el;
  if (onChange) onRouteChange = onChange;
  window.addEventListener('hashchange', () => { pendingScroll = 0; render(); });
  return render();
}

async function render() {
  const token = ++mountToken;
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
  onRouteChange(current);
  let mod;
  try {
    mod = await route.load();
  } catch (err) {
    if (token !== mountToken) return;
    showError(err);
    return;
  }
  if (token !== mountToken) return;
  const container = document.createElement('div');
  container.className = 'view-inner';
  viewEl.replaceChildren(container);
  try {
    const fn = mod[route.fn];
    if (typeof fn !== 'function') throw new Error(`La vista ${route.pattern} no exporta ${route.fn}()`);
    const res = await fn(container, current.params);
    if (token !== mountToken) {
      if (typeof res === 'function') res();
      return;
    }
    cleanup = typeof res === 'function' ? res : null;
  } catch (err) {
    if (token !== mountToken) return;
    showError(err);
  }
  const y = pendingScroll ?? 0;
  pendingScroll = null;
  requestAnimationFrame(() => window.scrollTo(0, y));
}

function showError(err) {
  console.error('[router]', err);
  const box = document.createElement('div');
  box.className = 'content';
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
