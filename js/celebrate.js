// celebrate.js — animaciones de inicio y fin de sesión (css/celebrate.css; qué se dice: celebrate-logic.js).
// Una sola coreografía: una cortina verde cruza la pantalla de abajo arriba, deja un fondo negro con el icono del
// deporte, el mensaje y dos curvas verdes que enmarcan el texto, y al final la misma cortina vuelve a pasar y deja a la
// vista la pantalla de destino. Solo CSS y temporizadores de un disparo (sin bucles ni librerías); con movimiento
// reducido, solo un fundido. Nada de lo que hay debajo depende de ella: se navega y se guarda antes o a la vez; si se
// omite (toque o tecla) o falla, la pantalla de debajo ya es la correcta.
import { h, icon } from './ui.js';
import { pickMessage } from './celebrate-logic.js';

const HOLD_MS = 3000; // desde que empieza a entrar hasta que empieza a salir (entrada ≈0,9 s + mensaje legible ≈2 s)
const HOLD_RECORD_MS = 3500; // con récord se alarga medio segundo
const HOLD_REDUCED_MS = 1200;
const SWEEP_MS = 820; // duración de cada pasada de la cortina; coincide con --sweep en celebrate.css
const OUT_SKIP_MS = 160;
const START_MS = 480;
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
      band('cele-band-top', '0 0 390 300', 'xMidYMin slice', 'M 450 -30 C 350 10 300 100 210 128 C 130 152 50 150 -50 214'),
      band('cele-band-bot', '0 0 390 260', 'xMidYMax slice', 'M -50 226 C 40 150 170 138 262 178 C 330 208 390 214 450 186'),
      h('div.cele-center',
        h('div.cele-mark', { 'aria-hidden': 'true' }, ring(), sportIcon(kind, 44),
          Array.from({ length: 10 }, (_, i) => h('i', { style: `--a:${i * 36}deg` }))),
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

/** Una curva verde gruesa que se dibuja de un extremo al otro (pathLength=1 para animar el trazo). */
function band(cls, viewBox, aspect, d) {
  const svg = svgEl('svg', { class: `cele-band ${cls}`, viewBox, preserveAspectRatio: aspect, 'aria-hidden': 'true' });
  svg.appendChild(svgEl('path', { d, pathLength: '1', class: 'cele-band-path' }));
  return svg;
}

/** Cortina: más alta que la pantalla, con el borde de ataque y el de salida curvos (se estira a la pantalla). */
function sweepShape() {
  const svg = svgEl('svg', { viewBox: '0 0 390 1860', preserveAspectRatio: 'none' });
  svg.appendChild(svgEl('path', { d: 'M0 300 C 130 290 250 170 390 0 L390 1560 C 260 1690 130 1790 0 1860 Z' }));
  return svg;
}

/** Aro que se dibuja alrededor del icono del deporte. */
function ring() {
  const svg = svgEl('svg', { class: 'cele-ring', viewBox: '0 0 100 100' });
  svg.appendChild(svgEl('circle', { cx: 50, cy: 50, r: 46, pathLength: '1' }));
  return svg;
}

/** El mensaje cabe siempre en una línea: si con el tamaño de texto o de pantalla se saldría, se reduce. */
function fit(msg) {
  const room = document.documentElement.clientWidth - 48;
  const w = msg.scrollWidth;
  if (w > room && room > 0) msg.style.fontSize = `${Math.floor(parseFloat(getComputedStyle(msg).fontSize) * room / w)}px`;
}

/** Transición breve y discreta al empezar una sesión (~0,5 s). No bloquea: no recoge toques ni espera a nada. */
export function playStart() {
  if (reduced()) return;
  const el = h('div.cele-start', { 'aria-hidden': 'true' }, h('span.cele-start-mark', icon('dumbbell', 72)));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), START_MS + 40);
}
