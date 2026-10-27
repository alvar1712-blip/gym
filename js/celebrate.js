// celebrate.js — animaciones de inicio y fin de sesión (css/celebrate.css; qué se dice: celebrate-logic.js).
// Solo CSS y un par de temporizadores de un disparo (sin bucles ni librerías); con movimiento reducido, solo un
// fundido. Nada de lo que hay debajo depende de ellas: se navega y se guarda antes o a la vez; si se omiten (toque o
// tecla) o fallan, la pantalla de debajo ya es la correcta.
import { h, icon } from './ui.js';

const HOLD_MS = 1900; // tiempo hasta empezar a salir (todo el movimiento de entrada ocurre en ~1 s)
const HOLD_REDUCED_MS = 1200;
const OUT_MS = 300;
const OUT_SKIP_MS = 160;
const START_MS = 480;
const reduced = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// Iconos que salen disparados del centro: dirección (vw, vh), giro y tamaño final; posiciones fijas, sin azar.
const BURST = [
  ['dumbbell', -38, -30, -28, 2.4], ['bolt', 34, -36, 22, 2.1], ['trophy', 40, 10, 16, 2.6], ['check', -34, 26, -18, 2.2],
  ['target', 6, -44, 12, 1.9], ['flag', -44, -4, -34, 2.3], ['dumbbell', 30, 34, 30, 2.0], ['bolt', -14, 42, -22, 2.5],
  ['check', 22, -14, 40, 1.7], ['trophy', -26, -12, -12, 1.8], ['target', 46, -22, 20, 2.2], ['flag', 14, 22, -26, 1.6],
];

let current = null; // { el, finish }

/**
 * Pantalla completa de felicitación: barrido verde, fondo negro, iconos que salen del centro, mensaje grande y cintas.
 * Devuelve una promesa que se resuelve cuando ya no está (al terminar o al omitirla con un toque / Enter / Espacio /
 * Escape). `record`: texto de un récord en un ejercicio principal (opcional, secundario al mensaje).
 */
export function celebrate({ message, record = null }) {
  current?.finish(true);
  const calm = reduced();
  const el = h('div.cele', { role: 'status', 'aria-label': `${message}${record ? ` ${record}` : ''}` },
    h('div.cele-bg'),
    h('div.cele-wipe'),
    h('div.cele-burst', { 'aria-hidden': 'true' }, BURST.map(([name, x, y, r, s], i) => h('span.cele-bit', {
      style: `--x:${x}vw;--y:${y}vh;--r:${r}deg;--s:${s};--d:${300 + i * 25}ms`, // custom properties: solo vale como texto
    }, icon(name, 40)))),
    ribbons(),
    h('div.cele-center',
      h('div.cele-mark', icon('dumbbell', 56)),
      h('div.cele-msg', message),
      record ? h('div.cele-pr', icon('trophy', 22), h('span', record)) : null));
  document.body.appendChild(el);

  return new Promise((resolve) => {
    let hold = null;
    let done = false;
    const finish = (skip = false) => {
      if (done) return;
      done = true;
      clearTimeout(hold);
      document.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onTap);
      el.classList.add(skip ? 'cele-skip' : 'cele-out');
      setTimeout(() => { el.remove(); if (current?.el === el) current = null; resolve(); }, calm ? 120 : skip ? OUT_SKIP_MS : OUT_MS);
    };
    const onTap = () => finish(true);
    const onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Escape') return;
      e.preventDefault();
      finish(true);
    };
    el.addEventListener('pointerdown', onTap);
    document.addEventListener('keydown', onKey, true);
    hold = setTimeout(() => finish(false), calm ? HOLD_REDUCED_MS : HOLD_MS);
    current = { el, finish };
  });
}

function ribbons() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'cele-ribbons');
  svg.setAttribute('viewBox', '0 0 390 844');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('aria-hidden', 'true');
  for (const [d, delay] of [['M 470 -30 C 330 120 190 190 -20 290', '460ms'], ['M -40 790 C 110 720 280 720 440 810', '680ms']]) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('pathLength', '1');
    p.setAttribute('class', 'cele-ribbon');
    p.style.setProperty('--d', delay);
    svg.appendChild(p);
  }
  return svg;
}

/** Transición breve y discreta al empezar una sesión (~0,5 s). No bloquea: no recoge toques ni espera a nada. */
export function playStart() {
  if (reduced()) return;
  const el = h('div.cele-start', { 'aria-hidden': 'true' }, h('span.cele-start-mark', icon('dumbbell', 72)));
  document.body.appendChild(el);
  setTimeout(() => el.remove(), START_MS + 40);
}
