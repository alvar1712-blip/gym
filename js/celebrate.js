// celebrate.js — animación de fin de sesión (css/celebrate.css; qué se dice y las funciones de forma: celebrate-logic.js;
// las siluetas: celebrate-data.js).
// Una sola secuencia, en una sola dirección: idle → launching → celebration → exiting → completed (nunca retrocede ni se
// solapan dos). Nace del botón que se acaba de pulsar («Terminar sesión», «Listo»): el botón responde al toque (≈0,12 s), de
// su silueta exacta parte UNA masa del color del botón que sube por el lado derecho como un dedo redondeado y barre hasta
// cubrir la pantalla (≈1 s). Con la pantalla tapada (onCovered, una sola vez) se pasa al destino y el verde se funde a
// negro. En el negro: el emoji y el mensaje, y una única curva verde (un solo path de Béziers, se dibuja con
// stroke-dashoffset) que lo rodea; ya compuesta, todo queda quieto ≈1 s. La salida (≈0,4 s) espera a que el destino esté
// montado y es un fundido sobre él: nunca asoma otra pantalla. La masa se mueve por fotogramas reales (celebrate-data.js; la
// cima del dedo se redondea) con requestAnimationFrame; lo demás es CSS.
// Con movimiento reducido, solo un fundido. Nada de lo de debajo depende de ella: se guarda antes; si se omite (toque o
// tecla, ya cubierta la pantalla) o falla, onCovered se ejecuta igualmente y la pantalla de debajo es la correcta.
import { h, icon } from './ui.js';
import { pickMessage, frameAt, rowsPath, pillFrame, withPill, smoothPath, roundTop } from './celebrate-logic.js';
import { MASS } from './celebrate-data.js';
import { ACTIVITY_EMOJI } from './seed.js';

// Tiempos en ms desde que se monta (css/celebrate.css los recibe como variables: --cover, --draw-at, --draw).
const PRESS_MS = 120; // el botón «cede» antes de que nazca la masa
const EXPAND_MS = 1000; // de la silueta del botón a la pantalla completa (los datos duran MASS_END_MS: se estiran)
const MASS_END_MS = MASS.t.at(-1);
const COVER_MS = PRESS_MS + EXPAND_MS + 40; // cubierta del todo: el negro entra (160 ms) y se pasa al destino
const MASS_GONE_MS = COVER_MS + 200; // el negro ya es opaco: la masa se retira
const DRAW_AT_MS = COVER_MS + 60; // empieza a dibujarse la curva
const DRAW_MS = 750;
const HOLD_MS = 950; // composición completa, quieta
const HOLD_RECORD_MS = 1600; // con récord se alarga 0,6 s
const HOLD_REDUCED_MS = 1200;
const READY_MAX_MS = 1200; // lo máximo que la salida espera a que el destino esté montado
const OUT_MS = 400; // fundido de salida (coincide con .cele-out en celebrate.css)
const OUT_SKIP_MS = 160;
const PHASES = ['idle', 'launching', 'celebration', 'exiting', 'completed'];
// La curva: puntos [x, y] como fracción del ancho y del alto. Entra por la esquina superior derecha, barre hasta salir por
// la izquierda, da la vuelta fuera de pantalla y vuelve por abajo hasta terminar, con la punta redondeada, a la derecha.
const RIBBON = [[0.97, -0.13], [0.93, 0.05], [0.66, 0.225], [0.25, 0.335], [-0.2, 0.43], [-0.42, 0.66], [-0.2, 0.9], [0.3, 0.96], [0.68, 0.925], [0.93, 0.835]];
const RIBBON_W = 0.2; // grosor constante, fracción del ancho
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Pictogramas de trazo (24×24, como los de ui.js) para los símbolos que se dispersan. La fuerza y «otra» reutilizan los de
// la app (mancuerna, rayo).
const SPORT = {
  run: 'M15.5 3.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM13 8.5l-3.2 2.6 2.7 2.4-1.6 5.5M9.8 11.1 6 11.8M13 8.5l2.6 3.2 3.2.6M12.5 13.5l3.6 2.2.6 4.6',
  bike: 'M5.5 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 15.5 9.5 8h5l4 7.5M9.5 8l2.6 7.5H5.5M14.5 8l-1.2-2.5h-2.3',
  swim: 'M16.5 4.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM4 13.5l4-3.4 4.5 1.4 3.2 2.3M2 17.2c1.6 1.3 3.2 1.3 4.8 0s3.2-1.3 4.8 0 3.2 1.3 4.8 0 3.2-1.3 4.8 0M2 21c1.6 1.3 3.2 1.3 4.8 0s3.2-1.3 4.8 0 3.2 1.3 4.8 0 3.2-1.3 4.8 0',
  hike: 'M2 20 9 7.5l4 6.5 2.6-4.2L22 20ZM9 7.5 7.4 10.3 9 9.5l1.6 1.2',
};

function glyph(kind, size) {
  if (SPORT[kind]) {
    const svg = icon('info', size); // el mismo contenedor y trazo que los iconos de la app, con otro dibujo
    svg.querySelector('path').setAttribute('d', SPORT[kind]);
    return svg;
  }
  return icon(kind === 'other' ? 'bolt' : 'dumbbell', size);
}

// Símbolos: [x, y, tamaño] (fracciones del ancho/alto de pantalla; tamaño en fracción del ancho). Repartidos por las franjas
// libres alrededor del mensaje (nunca encima de él); salen del cúmulo central a la vez y se desvanecen en orden.
const AMBIENT = [
  [0.12, 0.09, 0.10], [0.58, 0.11, 0.12], [0.84, 0.06, 0.09], [0.08, 0.24, 0.13], [0.30, 0.20, 0.09], [0.74, 0.22, 0.11], [0.92, 0.32, 0.10],
  [0.07, 0.43, 0.09], [0.93, 0.44, 0.11],
  [0.12, 0.64, 0.11], [0.32, 0.70, 0.09], [0.78, 0.69, 0.12], [0.92, 0.62, 0.09], [0.20, 0.85, 0.12], [0.50, 0.82, 0.10], [0.84, 0.84, 0.11],
];
const BURST_ORIGIN = [0.45, 0.47]; // el cúmulo del que salen

let current = null; // { el, done: Promise } — solo hay una celebración a la vez

/** Rectángulo de origen: el del botón (Element o DOMRect) si es válido y se ve; si no, un botón ficticio abajo. */
function originRect(origin, W, H) {
  const r = origin?.getBoundingClientRect ? origin.getBoundingClientRect() : origin;
  if (r && r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 && r.left < W && r.top < H) return r;
  const w = Math.min(W - 32, 320);
  return { left: (W - w) / 2, right: (W + w) / 2, top: H - 96, bottom: H - 40, width: w, height: 56 };
}

/**
 * Pantalla completa de felicitación. Devuelve una promesa que se resuelve cuando ya no está (al terminar o al omitirla
 * con un toque / Enter / Espacio / Escape, una vez cubierta la pantalla: un segundo toque sobre «Terminar» no la omite).
 * Si ya hay una en marcha no empieza otra: devuelve la misma promesa. `kind`: strength|run|bike|swim|hike|other (elige el
 * emoji y los símbolos). `record`: texto de un récord en un ejercicio principal (opcional, secundario al mensaje). `origin`:
 * el botón del que nace (Element o DOMRect). `onCovered`: se llama UNA vez cuando la pantalla de debajo ya está tapada: ahí
 * se cierra la hoja y se navega al destino sin que se vea; si devuelve una promesa (p. ej. router.settled()), la salida
 * espera a que se cumpla (como mucho READY_MAX_MS).
 */
export function celebrate({ message, record = null, kind = 'strength', origin = null, onCovered = null }) {
  if (current) return current.done;
  const calm = reduced();
  const W = document.documentElement.clientWidth;
  const H = window.innerHeight;
  const r = originRect(origin, W, H);
  const st = origin?.nodeType === 1 ? getComputedStyle(origin) : null;
  const bg = st && st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)' ? st.backgroundColor : null;
  const rad = Math.min(parseFloat(st?.borderTopLeftRadius) || 14, r.height / 2);
  const emoji = ACTIVITY_EMOJI[kind] || '⚡';
  const msg = h('div.cele-msg', message);
  const ts = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts')) || 1;
  const symbols = AMBIENT.filter(([, y]) => !record || y < 0.5 || y > 0.66); // con récord, libre la franja de su línea
  const holdAfterCover = DRAW_AT_MS - COVER_MS + DRAW_MS + (record ? HOLD_RECORD_MS : HOLD_MS);
  const el = h('div.cele', {
    role: 'status', 'aria-label': `${message}${record ? ` ${record}` : ''}`, 'data-phase': 'idle',
    // custom properties: solo valen como texto
    style: `--gc:${bg || 'var(--accent)'};--mk:${Math.round(Math.min(56, W * 0.115))}px;--px:${(r.left + r.right) / 2}px;--py:${(r.top + r.bottom) / 2}px;--press:${PRESS_MS}ms;--cover:${COVER_MS}ms;--draw-at:${DRAW_AT_MS}ms;--draw:${DRAW_MS}ms`,
  },
    svg('cele-mass', W, H, [shape('M0 0')]),
    h('div.cele-bg'),
    ribbon(W, H),
    h('div.cele-amb', { 'aria-hidden': 'true' }, symbols.map(([x, y, s], i) => {
      const size = Math.round(W * s);
      const ox = (BURST_ORIGIN[0] - x) * 100;
      const oy = (BURST_ORIGIN[1] - y) * 100;
      return h('span', {
        style: `left:${x * 100}%;top:${y * 100}%;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;--ox:${ox}vw;--oy:${oy}vh;--r:${(i * 47) % 40 - 20}deg;`
          + `--d:${COVER_MS - 150 + i * 5}ms;--o:${COVER_MS + 250 + ((i * 7) % 16) * 25}ms;--dx:${((i * 13) % 17) - 8}px;--dy:${((i * 5) % 15) - 7}px`,
      }, h('i', i % 3 === 2 ? icon(i % 2 ? 'check' : 'flag', size) : glyph(kind, size)));
    })),
    h('div.cele-center',
      h('div.cele-text', h('div.cele-mark', { 'aria-hidden': 'true' }, emoji), msg, record ? h('div.cele-pr', icon('trophy', 22), h('span', record)) : null)));
  document.body.appendChild(el);
  fit(msg, W, ts);

  const done = new Promise((resolve) => {
    let phase = 'idle';
    let ready = Promise.resolve();
    let leaving = false;
    const timers = new Set();
    const later = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
    /** Solo hacia delante: devuelve false (y no hace nada) si ya se está en esa fase o en una posterior. */
    const to = (next) => {
      if (PHASES.indexOf(next) <= PHASES.indexOf(phase)) return false;
      phase = next;
      el.dataset.phase = next;
      return true;
    };
    const stopMass = calm ? () => {} : drive(el, W, H, r, rad);
    const end = () => {
      if (!to('completed')) return;
      timers.forEach(clearTimeout);
      timers.clear();
      stopMass();
      document.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onTap);
      el.remove();
      current = null;
      resolve();
    };
    const covered = () => {
      if (!to('celebration')) return;
      // Una sola vez: el trabajo de pasar al destino (cerrar la hoja y navegar) ocurre con la pantalla ya tapada.
      ready = new Promise((ok) => ok(onCovered?.())).catch((err) => console.error('[celebrar] onCovered', err));
      later(() => exit(false), holdAfterCover);
      later(stopMass, MASS_GONE_MS - COVER_MS);
    };
    /** La salida espera a que el destino esté montado: el fundido siempre deja ver el resumen, nunca otra pantalla. */
    const exit = (skip) => {
      if (leaving || phase !== 'celebration') return;
      leaving = true;
      Promise.race([ready, new Promise((ok) => later(ok, READY_MAX_MS))]).then(() => {
        if (!to('exiting')) return;
        el.classList.add(skip || calm ? 'cele-skip' : 'cele-out');
        later(end, calm ? 120 : skip ? OUT_SKIP_MS : OUT_MS + 30);
      });
    };
    const onTap = () => exit(true);
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      e.preventDefault();
      exit(true);
    };
    el.addEventListener('pointerdown', onTap);
    document.addEventListener('keydown', onKey, true);
    to('launching');
    later(covered, calm ? 0 : COVER_MS);
  });
  current = { el, done };
  done.then(() => { if (current?.el === el) current = null; });
  return done;
}

const MSG_KEY = 'entreno.lastCongrats';

/**
 * Felicitación al terminar cualquier tipo de sesión (fuerza o actividad): elige un mensaje que no sea el último que se
 * mostró (se recuerda en localStorage; si no se puede, da igual) y lo celebra. `record`: texto de récord (opcional).
 * `opts`: { origin, onCovered } (ver celebrate). Si algo fallara al montarla, onCovered se llama igual.
 */
export function congratulate(record = null, kind = 'strength', opts = {}) {
  let last = null;
  try { last = localStorage.getItem(MSG_KEY); } catch { /* almacenamiento bloqueado */ }
  const message = pickMessage(Math.random, last);
  try { localStorage.setItem(MSG_KEY, message); } catch { /* almacenamiento bloqueado */ }
  try {
    return celebrate({ message, record, kind, ...opts });
  } catch (err) {
    console.error('[celebrar]', err);
    try { opts.onCovered?.(); } catch (e) { console.error('[celebrar] onCovered', e); }
    return Promise.resolve();
  }
}

const NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs = {}) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}
const shape = (d) => svgEl('path', { d });
function svg(cls, W, H, children) {
  const s = svgEl('svg', { class: cls, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  for (const c of children) s.appendChild(c);
  return s;
}

/** La curva verde: UN path (Béziers cúbicas), trazo de grosor constante con extremos y uniones redondos; css/celebrate.css la dibuja. */
function ribbon(W, H) {
  const grad = svgEl('linearGradient', { id: 'cele-grad', gradientUnits: 'userSpaceOnUse', x1: W, y1: 0, x2: 0, y2: H * 0.5 });
  grad.appendChild(svgEl('stop', { offset: '0', style: 'stop-color:#8fd02f' }));
  grad.appendChild(svgEl('stop', { offset: '1', style: 'stop-color:var(--accent)' }));
  const defs = svgEl('defs');
  defs.appendChild(grad);
  const path = svgEl('path', { d: smoothPath(RIBBON.map(([x, y]) => [x * W, y * H])), pathLength: '1', 'stroke-width': W * RIBBON_W });
  path.setAttribute('class', 'cele-ribbon');
  return svg('cele-bands', W, H, [defs, path]);
}

/**
 * Mueve la masa (del botón a pantalla completa) en cada fotograma de pantalla: quieta mientras el botón cede (PRESS_MS) y
 * después los fotogramas reales de MASS, estirados a EXPAND_MS. Devuelve la función que lo detiene (y retira la masa).
 */
function drive(el, W, H, rect, rad) {
  const massData = withPill(MASS, pillFrame(rect, rad, W, H, MASS.a[0].length));
  const mass = el.querySelector('.cele-mass path');
  const p0 = frameAt(massData, 0);
  mass.setAttribute('d', rowsPath(p0.a, p0.b, W, H, { edges: true })); // ya en el primer fotograma: es el botón
  const t0 = performance.now();
  let raf = 0;
  const tick = (now) => {
    const t = (now - t0 - PRESS_MS) * (MASS_END_MS / EXPAND_MS);
    if (t > 0) {
      const f = frameAt(massData, Math.min(t, MASS_END_MS));
      const m = roundTop(f.a, f.b, W, H);
      mass.setAttribute('d', rowsPath(m.a, m.b, W, H, { edges: true }));
    }
    if (t < MASS_END_MS) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    mass.parentNode.style.display = 'none';
  };
}

/** El mensaje ocupa una sola línea, ≈70 % del ancho (la proporción de la referencia; más con texto grande), tope 56 px. */
function fit(msg, W, ts) {
  const target = Math.min(W - 48, W * 0.7 * Math.min(ts, 1.2));
  if (target <= 0) return;
  msg.style.fontSize = '100px';
  const w = msg.scrollWidth;
  msg.style.fontSize = `${Math.max(20, Math.floor(Math.min(56, (100 * target) / (w || target))))}px`;
}
