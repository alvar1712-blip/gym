// celebrate.js — animaciones de inicio y fin de sesión (css/celebrate.css; qué se dice: celebrate-logic.js).
// Una sola coreografía: una cortina verde de bordes curvos cruza la pantalla de abajo arriba, deja un fondo negro con el
// mensaje, el icono del deporte y una gran cinta verde que entra por arriba, da la vuelta fuera de la pantalla y vuelve
// a entrar por abajo (enmarca el texto sin cruzarlo, y se transforma despacio); al final la cortina vuelve a pasar y deja
// a la vista la pantalla de destino. Solo CSS, un morfado SVG (SMIL) y temporizadores de un disparo (sin librerías); con
// movimiento reducido, solo un fundido. Nada de lo que hay debajo depende de ella: se navega y se guarda antes o a la
// vez; si se omite (toque o tecla) o falla, la pantalla de debajo ya es la correcta.
import { h, icon } from './ui.js';
import { pickMessage } from './celebrate-logic.js';

const HOLD_MS = 3300; // desde que empieza a entrar hasta que empieza a salir (entrada ≈0,95 s + mensaje legible ≈2,5 s)
const HOLD_RECORD_MS = 3900; // con récord se alarga 0,6 s
const HOLD_REDUCED_MS = 1200;
const SWEEP_MS = 820; // duración de cada pasada de la cortina; coincide con --sweep en celebrate.css
const OUT_SKIP_MS = 160;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Iconos del deporte (trazos 24×24, como los de ui.js). La fuerza y «otra» reutilizan los de la app.
const SPORT = {
  run: 'M15.5 3.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM13 8.5l-3.2 2.6 2.7 2.4-1.6 5.5M9.8 11.1 6 11.8M13 8.5l2.6 3.2 3.2.6M12.5 13.5l3.6 2.2.6 4.6',
  bike: 'M5.5 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM18.5 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM5.5 15.5 9.5 8h5l4 7.5M9.5 8l2.6 7.5H5.5M14.5 8l-1.2-2.5h-2.3',
  swim: 'M16.5 4.2a1.7 1.7 0 1 1 0 3.4 1.7 1.7 0 0 1 0-3.4ZM4 13.5l4-3.4 4.5 1.4 3.2 2.3M2 17.2c1.6 1.3 3.2 1.3 4.8 0s3.2-1.3 4.8 0 3.2 1.3 4.8 0 3.2-1.3 4.8 0M2 21c1.6 1.3 3.2 1.3 4.8 0s3.2-1.3 4.8 0 3.2 1.3 4.8 0 3.2-1.3 4.8 0',
  hike: 'M2 20 9 7.5l4 6.5 2.6-4.2L22 20ZM9 7.5 7.4 10.3 9 9.5l1.6 1.2',
};

function sportIcon(kind, size) {
  if (!SPORT[kind]) return icon(kind === 'other' ? 'bolt' : 'dumbbell', size);
  const svg = icon('info', size); // se reutiliza el contenedor (mismo trazo y caps) y se cambia el dibujo
  svg.querySelector('path').setAttribute('d', SPORT[kind]);
  return svg;
}

// Símbolos pequeños de trazo blanco que aparecen y se separan un poco: posición final respecto al centro (vw, vh), giro
// y retardo. Solo en las franjas libres entre las curvas y el mensaje: nunca cruzan el texto. Con récord solo los tres\n// de arriba (los de abajo chocarían con la línea del récord).
const AMBIENT = [
  [-31, -19, -14, 760], [3, -20, 10, 840], [31, -17, 18, 920],
  [-30, 18, 12, 1000], [2, 19, -8, 1080], [31, 17, -16, 1160],
];

let current = null; // { el, finish }

/**
 * Pantalla completa de felicitación. Devuelve una promesa que se resuelve cuando ya no está (al terminar o al omitirla
 * con un toque / Enter / Espacio / Escape). `kind`: strength|run|bike|swim|hike|other (elige el icono). `record`: texto
 * de un récord en un ejercicio principal (opcional, secundario al mensaje).
 */
export function celebrate({ message, record = null, kind = 'strength' }) {
  current?.finish(true);
  const calm = reduced();
  const msg = h('div.cele-msg', message);
  const el = h('div.cele', { role: 'status', 'aria-label': `${message}${record ? ` ${record}` : ''}` },
    h('div.cele-scene',
      ribbon(),
      h('div.cele-amb', { 'aria-hidden': 'true' }, AMBIENT.slice(0, record ? 3 : 6).map(([x, y, r, d], i) => h('span', {
        style: `--x:${x}vw;--y:${y}vh;--r:${r}deg;--d:${d}ms`, // custom properties: solo valen como texto
      }, i % 2 ? icon('check', 34) : sportIcon(kind, 34)))),
      h('div.cele-center',
        h('div.cele-mark', { 'aria-hidden': 'true' }, sportIcon(kind, 88)),
        h('div.cele-text', msg, record ? h('div.cele-pr', icon('trophy', 22), h('span', record)) : null))),
    h('div.cele-sweep.cele-sweep-a', { 'aria-hidden': 'true' }, sweepShape()),
    h('div.cele-sweep.cele-sweep-b', { 'aria-hidden': 'true' }, sweepShape()));
  document.body.appendChild(el);
  fit(msg);

  return new Promise((resolve) => {
    let hold = null;
    let done = false;
    const end = () => { el.remove(); if (current?.el === el) current = null; resolve(); };
    const finish = (skip = false) => {
      if (done) return;
      done = true;
      clearTimeout(hold);
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
 */
export function congratulate(record = null, kind = 'strength') {
  let last = null;
  try { last = localStorage.getItem(MSG_KEY); } catch { /* almacenamiento bloqueado */ }
  const message = pickMessage(Math.random, last);
  try { localStorage.setItem(MSG_KEY, message); } catch { /* almacenamiento bloqueado */ }
  return celebrate({ message, record, kind });
}

const NS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
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
    attributeName: 'd', dur: '3.8s', begin: '1.7s', repeatCount: 'indefinite', calcMode: 'spline',
    keyTimes: '0;0.5;1', keySplines: '0.45 0 0.55 1;0.45 0 0.55 1', values: `${RIBBON_A};${RIBBON_B};${RIBBON_A}`,
  }));
  svg.appendChild(p);
  return svg;
}

/** Cortina: más alta que la pantalla, con el borde de ataque y el de salida ondulados (se estira a la pantalla). */
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
