// celebrate.js — animación de fin de sesión (css/celebrate.css; qué se dice y las funciones de forma: celebrate-logic.js;
// las siluetas: celebrate-data.js).
// Nace del botón que se acaba de pulsar («Terminar sesión», «Listo»): UNA sola masa del color del botón que parte de su
// silueta exacta, sube por el lado derecho como un dedo redondeado, se curva hacia arriba-izquierda y barre hasta cubrir
// la pantalla (≈0,55 s). Con la pantalla ya tapada se hace el trabajo de pasar al destino (onCovered) y el verde se funde
// a negro. En el negro: un cúmulo de símbolos blancos que salen del centro y se dispersan, el mensaje con el emoji de la
// actividad encima, y dos cintas que entran (arriba y abajo); los símbolos se desvanecen mientras entra la cinta. Se
// mantiene (las cintas siguen asentándose, nunca queda quieta) y pasa al destino a los 3,2 s (sin segunda cortina). La masa se mueve por
// fotogramas reales (celebrate-data.js; la cima del dedo se redondea) y las cintas son formas fijas que solo se descubren con una cabeza redondeada, todo con requestAnimationFrame durante ≈2,25 s; lo demás es CSS.
// Con movimiento reducido, solo un fundido. Nada de lo de debajo depende de ella: se guarda antes; si se omite (toque o
// tecla) o falla, onCovered se ejecuta igualmente y la pantalla de debajo es la correcta.
import { h, icon } from './ui.js';
import { pickMessage, frameAt, rowsPath, pillFrame, withPill, smooth, axisOf, tubePath, revealBand, roundTop } from './celebrate-logic.js';
import { MASS, TOP_AXIS, BOT } from './celebrate-data.js';
import { ACTIVITY_EMOJI } from './seed.js';

const COVER_MS = 580; // la masa ya cubre todo (≈0,55 s) y el negro está entrando (coincide con .cele-bg en celebrate.css)
const MASS_GONE_MS = 700; // el negro ya es opaco: la masa se retira del árbol
const SHAPES_END_MS = 2250; // fin del trazo de las cintas (después siguen asentándose con la deriva de css/celebrate.css)
const TOP_T0 = 1000; // la cinta superior baja desde la esquina entre TOP_T0 y TOP_T0 + TOP_MS (frena al final)
const TOP_MS = 720;
const BOT_T0 = 1800; // la cinta inferior entra de izquierda a derecha entre BOT_T0 y SHAPES_END_MS
const HOLD_MS = 3200; // desde el toque hasta pasar al destino (mensaje legible ≈2,6 s)
const HOLD_RECORD_MS = 3800; // con récord se alarga 0,6 s
const HOLD_REDUCED_MS = 1200;
const OUT_MS = 160; // paso directo al destino: un fundido corto, sin cortina
const OUT_SKIP_MS = 160;
// Las dos cintas son una forma fija que solo se va descubriendo con una cabeza redondeada (el trazado fotograma a fotograma
// llevaba puntas, pliegues y un avance a saltos): la superior, un tubo sobre su eje; la inferior, su forma final por columnas.
const BOT_A = smooth(BOT.a.at(-1));
const BOT_B = smooth(BOT.b.at(-1));
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
 * con un toque / Enter / Espacio / Escape). `kind`: strength|run|bike|swim|hike|other (elige el emoji y los símbolos).
 * `record`: texto de un récord en un ejercicio principal (opcional, secundario al mensaje). `origin`: el botón del que
 * nace (Element o DOMRect). `onCovered`: se llama UNA vez cuando la pantalla de debajo ya está tapada (o al omitir): ahí
 * se cierra la hoja y se navega al destino sin que se vea.
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
  const ts = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ts')) || 1;
  const symbols = AMBIENT.filter(([, y]) => !record || y < 0.5 || y > 0.66); // con récord, libre la franja de su línea
  const el = h('div.cele', {
    role: 'status', 'aria-label': `${message}${record ? ` ${record}` : ''}`,
    // custom properties: solo valen como texto. --tail: la deriva de las cintas dura hasta después de la salida (nunca se queda quieta)
    style: `--gc:${bg || 'var(--accent)'};--mk:${Math.round(Math.min(56, W * 0.115))}px;--tail:${(record ? HOLD_RECORD_MS : HOLD_MS) - 400}ms`,
  },
    svg('cele-mass', W, H, [shape('M0 0')]),
    h('div.cele-bg'),
    bands(W, H),
    h('div.cele-amb', { 'aria-hidden': 'true' }, symbols.map(([x, y, s], i) => {
      const size = Math.round(W * s);
      const ox = (BURST_ORIGIN[0] - x) * 100;
      const oy = (BURST_ORIGIN[1] - y) * 100;
      return h('span', {
        style: `left:${x * 100}%;top:${y * 100}%;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;--ox:${ox}vw;--oy:${oy}vh;--r:${(i * 47) % 40 - 20}deg;`
          + `--d:${430 + i * 5}ms;--o:${1050 + ((i * 7) % 16) * 25}ms;--dx:${((i * 13) % 17) - 8}px;--dy:${((i * 5) % 15) - 7}px`,
      }, h('i', i % 3 === 2 ? icon(i % 2 ? 'check' : 'flag', size) : glyph(kind, size)));
    })),
    h('div.cele-center',
      h('div.cele-text', h('div.cele-mark', { 'aria-hidden': 'true' }, emoji), msg, record ? h('div.cele-pr', icon('trophy', 22), h('span', record)) : null)));
  document.body.appendChild(el);
  fit(msg, W, ts);

  return new Promise((resolve) => {
    let hold = null;
    let done = false;
    let covered = false;
    const stopShapes = calm ? () => {} : drive(el, W, H, r, rad);
    const cover = () => {
      if (covered) return;
      covered = true;
      clearTimeout(coverT);
      try { onCovered?.(); } catch (err) { console.error('[celebrar] onCovered', err); }
    };
    const coverT = setTimeout(cover, calm ? 0 : COVER_MS);
    const end = () => { stopShapes(); el.remove(); if (current?.el === el) current = null; resolve(); };
    const finish = (skip = false) => {
      if (done) return;
      done = true;
      clearTimeout(hold);
      cover(); // si se omite antes de tiempo, el destino se monta igualmente
      document.removeEventListener('keydown', onKey, true);
      el.removeEventListener('pointerdown', onTap);
      el.classList.add(skip || calm ? 'cele-skip' : 'cele-out');
      setTimeout(end, calm ? 120 : skip ? OUT_SKIP_MS : OUT_MS + 30);
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

/** Las dos cintas (arriba y abajo), con un degradado suave del verde de la app. Sus formas las mueve drive(). */
function bands(W, H) {
  const grad = svgEl('linearGradient', { id: 'cele-grad', gradientUnits: 'userSpaceOnUse', x1: W, y1: 0, x2: 0, y2: H * 0.5 });
  grad.appendChild(svgEl('stop', { offset: '0', style: 'stop-color:#8fd02f' }));
  grad.appendChild(svgEl('stop', { offset: '1', style: 'stop-color:var(--accent)' }));
  const defs = svgEl('defs');
  defs.appendChild(grad);
  const top = shape('M0 0');
  top.setAttribute('class', 'cele-top');
  const bot = shape('M0 0');
  bot.setAttribute('class', 'cele-bot');
  return svg('cele-bands', W, H, [defs, top, bot]);
}

/**
 * Mueve las formas: la masa (del botón a pantalla completa, 0–0,6 s), la cinta superior (1,0–1,72 s, un tubo sobre su eje) y
 * la inferior (1,8–2,25 s, su forma final descubierta de izquierda a derecha), en cada fotograma de pantalla. Devuelve la
 * función que lo detiene.
 */
function drive(el, W, H, rect, rad) {
  const massData = withPill(MASS, pillFrame(rect, rad, W, H, MASS.a[0].length));
  const mass = el.querySelector('.cele-mass path');
  const top = el.querySelector('.cele-top');
  const bot = el.querySelector('.cele-bot');
  const topAxis = axisOf(TOP_AXIS.p.map(([x, y]) => [x * W, y * H]));
  const p0 = frameAt(massData, 0);
  mass.setAttribute('d', rowsPath(p0.a, p0.b, W, H, { edges: true })); // ya en el primer fotograma: es el botón
  const t0 = performance.now();
  let raf = 0;
  let massGone = false;
  const tick = (now) => {
    const t = now - t0;
    if (t <= MASS_GONE_MS) {
      const f = frameAt(massData, t);
      const m = roundTop(f.a, f.b, W, H);
      mass.setAttribute('d', rowsPath(m.a, m.b, W, H, { edges: true }));
    } else if (!massGone) {
      massGone = true;
      mass.parentNode.style.display = 'none';
    }
    if (t >= TOP_T0 - 30) {
      const u = Math.min(1, Math.max(0, (t - TOP_T0) / TOP_MS));
      top.setAttribute('d', tubePath(topAxis, W * TOP_AXIS.r, (1 - (1 - u) ** 2) * topAxis.len.at(-1)));
    }
    if (t >= BOT_T0 - 30) {
      const u = Math.min(1, Math.max(0, (t - BOT_T0) / (SHAPES_END_MS - BOT_T0)));
      bot.setAttribute('d', revealBand(BOT_A, BOT_B, W, H, (1 - (1 - u) ** 2) * (W + H * 0.06)));
    }
    if (t < SHAPES_END_MS) raf = requestAnimationFrame(tick);
    else bot.setAttribute('d', revealBand(BOT_A, BOT_B, W, H, W + H * 0.06)); // forma completa exacta
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

/** El mensaje ocupa una sola línea, ≈70 % del ancho (la proporción de la referencia; más con texto grande), tope 56 px. */
function fit(msg, W, ts) {
  const target = Math.min(W - 48, W * 0.7 * Math.min(ts, 1.2));
  if (target <= 0) return;
  msg.style.fontSize = '100px';
  const w = msg.scrollWidth;
  msg.style.fontSize = `${Math.max(20, Math.floor(Math.min(56, (100 * target) / (w || target))))}px`;
}
