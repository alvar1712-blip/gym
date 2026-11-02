// plates-view.js — hoja «Discos»: la barra con los discos de un lado para el peso de la serie (Fase 7).
// Solo orientación (plates.js explica los supuestos): no guarda nada ni cambia la serie.
import { h, sheet, chips } from './ui.js';
import { fmtNum } from './util.js';
import { platesPerSide, BARS } from './plates.js';

const BAR_KEY = 'entreno:barra';
const SVG = 'http://www.w3.org/2000/svg';
// Alto relativo y grosor (px) de cada disco: se lee de un vistazo cuál es cuál
const LOOK = { 25: [1, 20], 20: [0.9, 18], 15: [0.78, 15], 10: [0.64, 12], 5: [0.5, 10], 2.5: [0.4, 8], 1.25: [0.32, 6] };

function barPref() {
  try { const v = Number(localStorage.getItem(BAR_KEY)); return BARS.includes(v) ? v : 20; } catch { return 20; }
}
const saveBar = (v) => { try { localStorage.setItem(BAR_KEY, String(v)); } catch { /* solo esta vez */ } };
const el = (tag, attrs = {}) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** Dibujo de la barra (manguito a la derecha del tope) con los discos de un lado, del mayor (junto al tope) al menor. */
export function platesSvg(perSide) {
  const H = 112;
  const svg = el('svg', { viewBox: '0 0 320 112', class: 'pl-svg', role: 'img', 'aria-label': perSide.length ? `Discos por lado: ${perSide.map((p) => fmtNum(p, 2)).join(', ')} kilos` : 'Barra sin discos' });
  svg.appendChild(el('rect', { x: 0, y: H / 2 - 5, width: 320, height: 10, rx: 3, class: 'pl-bar' }));
  svg.appendChild(el('rect', { x: 26, y: H / 2 - 16, width: 8, height: 32, rx: 2, class: 'pl-collar' }));
  let x = 38;
  for (const p of perSide) {
    const [k, w] = LOOK[p] || [0.4, 7];
    const hh = H * k;
    svg.appendChild(el('rect', { x, y: (H - hh) / 2, width: w, height: hh, rx: 3, class: `pl-disc pl-${String(p).replace('.', '_')}` }));
    x += w + 2;
  }
  return svg;
}

/** Abre la hoja con los discos para `weight` kg. */
export function openPlates(weight) {
  let bar = barPref();
  sheet({
    title: 'Discos',
    body: () => {
      const view = h('div.pl-view');
      const paint = () => {
        const r = platesPerSide(weight, { bar });
        const txt = r.reason === 'below-bar'
          ? h('p.pl-line', `${fmtNum(weight ?? 0, 2)} kg es menos que la barra vacía (${fmtNum(bar, 2)} kg).`)
          : r.perSide.length
            ? h('p.pl-line.tnum', h('strong', 'Por lado: '), r.perSide.map((p) => fmtNum(p, 2)).join(' + '), ' kg')
            : h('p.pl-line', 'Solo la barra.');
        view.replaceChildren(...[
          h('p.pl-total.tnum', `${fmtNum(weight ?? 0, 2)} kg`),
          platesSvg(r.perSide),
          txt,
          r.reason === 'inexact' ? h('p.pl-warn', `Con estos discos se montan ${fmtNum(r.loaded, 2)} kg; faltan ${fmtNum(r.missing, 2)} kg.`) : null,
          h('p.field-hint', `Barra de ${fmtNum(bar, 2)} kg y discos de 25, 20, 15, 10, 5, 2,5 y 1,25 kg. Es orientativo: ajusta la barra si la tuya pesa otra cosa.`)].filter(Boolean));
      };
      paint();
      const barChips = chips({
        options: BARS.map((b) => ({ value: b, label: `Barra ${b} kg` })), value: bar, ariaLabel: 'Peso de la barra',
        onChange: (v) => { if (v) { bar = v; saveBar(v); paint(); } },
      });
      return h('div.stack.pl-sheet', barChips, view);
    },
  });
}
