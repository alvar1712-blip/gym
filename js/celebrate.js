// celebrate.js — animación de fin de sesión (css/celebrate.css; qué se dice: celebrate-logic.js).
// Nace del botón que se acaba de pulsar («Terminar sesión», «Listo»): una superficie verde con su mismo color, radio y
// etiqueta crece desde su posición real y, a la vez, sale de ella una S gruesa; juntas cubren la pantalla (≈0,7 s). Con
// la pantalla de debajo ya tapada se hace el trabajo de pasar al destino (onCovered) y desde el centro se abre un iris
// negro con la gran cinta verde, el icono de la actividad (su emoji de siempre) y el mensaje. Al final una cortina
// ondulada vuelve a pasar y deja a la vista el destino. Solo CSS, un morfado SVG (SMIL) y temporizadores de un disparo
// (sin librerías); con movimiento reducido, solo un fundido. Nada de lo que hay debajo depende de ella: se guarda antes;
// si se omite (toque o tecla) o falla, onCovered se ejecuta igualmente y la pantalla de debajo es la correcta.
import { h, icon } from './ui.js';
import { pickMessage } from './celebrate-logic.js';
import { ACTIVITY_EMOJI } from './seed.js';

const COVER_MS = 620; // la expansión del botón + la S cubren la pantalla (coincide con cele-grow en celebrate.css)
const HOLD_MS = 3700; // desde el toque hasta empezar a salir (mensaje completo a ≈1,3 s: se lee ≈2,4 s)
const HOLD_RECORD_MS = 4300; // con récord se alarga 0,6 s
const HOLD_REDUCED_MS = 1200;
const SWEEP_MS = 820; // duración de la cortina de salida; coincide con --sweep en celebrate.css
const OUT_SKIP_MS = 160;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Símbolos pequeños (el emoji de la actividad) que aparecen y se separan un poco: posición final respecto al centro
// (vw, vh), giro y retardo. Solo en las franjas libres entre las curvas y el mensaje; con récord, solo los de arriba.
const AMBIENT = [
  [-31, -19, -14, 1130], [31, -17, 18, 1210],
  [-30, 18, 12, 1290], [31, 17, -16, 1370],
];

let current = null; // { el, finish }

/** Rectángulo de origen: el del botón (Element o DOMRect) si es válido y se ve; si no, un botón ficticio abajo. */
function originRect(origin, W, H) {
  const r = origin?.getBoundingClientRect ? origin.getBoundingClientRect() : origin;
  if (r && r.width > 8 && r.height > 8 && r.bottom > 0 && r.right > 0 && r.left < W && r.top < H) return r;
  const w = Math.min(W - 32, 320);
  return { left: (W - w) / 2, right: (W + w) / 2, top: H - 96, bottom: H - 40, width: w, height: 56 };
}

/**
 * Pantalla completa de felicitación. Devuelve una promesa que se resuelve cuando ya no está (al terminar o al omitirla
 * con un toque / Enter / Espacio / Escape). `kind`: strength|run|bike|swim|hike|other (elige el emoji). `record`: texto
 * de un récord en un ejercicio principal (opcional, secundario al mensaje). `origin`: el botón del que nace (Element o
 * DOMRect). `onCovered`: se llama UNA vez cuando la pantalla de debajo ya está tapada (o al omitir): ahí se cierra la
 * hoja y se navega al destino sin que se vea.
 */
export function celebrate({ message, record = null, kind = 'strength', origin = null, onCovered = null }) {
  current?.finish(true);
  const calm = reduced();
  const W = document.documentElement.clientWidth;
  const H = window.innerHeight;
  const r = originRect(origin, W, H);
  const st = origin?.nodeType === 1 ? getComputedStyle(origin) : null;
  const bg = st && st.backgroundColor && st.backgroundColor !== 'rgba(0, 0, 0, 0)' ? st.backgroundColor : null;
  const rad = Math.min(parseFloat(st?.borderTopLeftRadius) || 14, r.height / 2);
  const emoji = ACTIVITY_EMOJI[kind] || '⚡';
  const msg = h('div.cele-msg', message);
  const label = origin?.nodeType === 1 ? origin.textContent.trim() : '';
  const el = h('div.cele', {
    role: 'status', 'aria-label': `${message}${record ? ` ${record}` : ''}`,
    style: `--it:${r.top}px;--ir:${W - r.right}px;--ib:${H - r.bottom}px;--il:${r.left}px;--rad:${rad}px${bg ? `;--gc:${bg}` : ''}`, // custom properties: solo valen como texto
  },
    h('div.cele-grow', { 'aria-hidden': 'true' }, label ? h('span.cele-grow-label', {
      style: `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;${st ? `color:${st.color};font:${st.font}` : ''}`,
    }, label) : null),
    tendril(r, W, H),
    h('div.cele-scene',
      ribbon(),
      h('div.cele-amb', { 'aria-hidden': 'true' }, AMBIENT.filter((_, i) => !record || i < 2).map(([x, y, a, d]) => h('span', {
        style: `--x:${x}vw;--y:${y}vh;--r:${a}deg;--d:${d}ms`,
      }, emoji))),
      h('div.cele-center',
        h('div.cele-mark', { 'aria-hidden': 'true' }, emoji),
        h('div.cele-text', msg, record ? h('div.cele-pr', icon('trophy', 22), h('span', record)) : null))),
    h('div.cele-sweep.cele-sweep-a', { 'aria-hidden': 'true' }, sweepShape()),
    h('div.cele-sweep.cele-sweep-b', { 'aria-hidden': 'true' }, sweepShape()));
  document.body.appendChild(el);
  fit(msg);

  return new Promise((resolve) => {
    let hold = null;
    let done = false;
    let covered = false;
    const cover = () => {
      if (covered) return;
      covered = true;
      clearTimeout(coverT);
      try { onCovered?.(); } catch (err) { console.error('[celebrar] onCovered', err); }
    };
    const coverT = setTimeout(cover, calm ? 0 : COVER_MS);
    const end = () => { el.remove(); if (current?.el === el) current = null; resolve(); };
    const finish = (skip = false) => {
      if (done) return;
      done = true;
      clearTimeout(hold);
      cover(); // si se omite antes de tiempo, el destino se monta igualmente
      document.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onTap);
      el.classList.add(skip || calm ? 'cele-skip' : 'cele-out');
      setTimeout(end, calm ? 120 : skip ? OUT_SKIP_MS : SWEEP_MS + 40);
    };
    const onTap = () => finish(true);
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      e.preventDefault();
      finish(true);
    };
    el.addEventListener('pointerdown', onTap);
    document.addEventListener('keydown', onKey, true);
    hold = setTimeout(() => finish(false), calm ? HOLD_REDUCED_MS : record ? HOLD_RECORD_MS : HOLD_MS);
    current = { el, finish };
  });
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
function svgEl(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** La S que sale del botón: una banda gruesa que se dibuja desde su centro hacia arriba, mientras el botón crece. */
function tendril(r, W, H) {
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  const svg = svgEl('svg', { class: 'cele-tendril', viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' });
  svg.appendChild(svgEl('path', {
    d: `M ${cx} ${cy} C ${W * 1.1} ${cy - H * 0.04} ${W * 0.98} ${H * 0.5} ${W * 0.5} ${H * 0.46} S ${-W * 0.1} ${H * 0.3} ${W * 0.66} ${-H * 0.14}`,
    pathLength: '1', 'stroke-width': String(Math.round(W * 0.36)),
  }));
  return svg;
}

// La cinta: un solo trazo. Baja por la derecha, cruza la parte alta hacia la izquierda, da la vuelta FUERA de la pantalla
// (x < 0) y vuelve a entrar por la izquierda abajo, para salir por la derecha. Arriba y abajo son la misma curva.
// RIBBON_B tiene la misma estructura con los puntos de control movidos: el morfado A→B→A la hace respirar en el centro.
const RIBBON_A = 'M 340 -80 C 346 60 300 138 200 162 C 110 184 36 170 -70 232 C -170 292 -170 590 -70 650 C 40 712 150 704 230 664 C 305 628 350 636 460 706';
const RIBBON_B = 'M 318 -80 C 330 84 326 156 214 182 C 122 204 28 198 -70 252 C -190 322 -190 570 -70 628 C 42 692 142 734 242 694 C 322 660 364 650 460 726';

function ribbon() {
  const svg = svgEl('svg', { class: 'cele-ribbon', viewBox: '0 0 390 844', preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' });
  const p = svgEl('path', { d: RIBBON_A, pathLength: '1' });
  p.appendChild(svgEl('animate', {
    attributeName: 'd', dur: '3.8s', begin: '2.2s', repeatCount: 'indefinite', calcMode: 'spline',
    keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1', values: `${RIBBON_A};${RIBBON_B};${RIBBON_A}`,
  }));
  svg.appendChild(p);
  return svg;
}

/** Cortina de salida: más alta que la pantalla, con el borde de ataque y el de salida ondulados (se estira a la pantalla). */
function sweepShape() {
  const svg = svgEl('svg', { viewBox: '0 0 390 1860', preserveAspectRatio: 'none' });
  svg.appendChild(svgEl('path', {
    d: 'M0 340 C 40 330 90 200 160 120 C 230 40 320 20 390 60 L390 1500 C 330 1450 240 1520 180 1690 C 130 1830 60 1850 0 1860 Z',
  }));
  return svg;
}

/** El mensaje ocupa siempre una línea y todo el ancho útil: se mide a un tamaño de referencia y se escala (tope 76 px). */
function fit(msg) {
  const room = document.documentElement.clientWidth - 48;
  if (room <= 0) return;
  msg.style.fontSize = '100px';
  const w = msg.scrollWidth;
  msg.style.fontSize = `${Math.max(20, Math.floor(Math.min(76, (100 * room) / (w || room))))}px`;
}
