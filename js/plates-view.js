// plates-view.js — hoja «Discos»: la barra completa con los discos de cada lado para el peso de la serie (Fase 7).
// Solo orientación (plates.js explica los supuestos): no guarda nada ni cambia la serie.
import { h, sheet, chips } from './ui.js';
import { fmtNum } from './util.js';
import { platesPerSide, plateRects, groupPlates, BARS } from './plates.js';

const BAR_KEY = 'entreno:barra';
const SVG = 'http://www.w3.org/2000/svg';
// Lienzo 360 × 132: la barra ocupa todo el ancho (extremos a la vista) y los discos se reparten simétricos
// a ambos lados del centro; el alto máximo (25 kg = 100) deja margen arriba y abajo: nada se recorta.
const W = 360;
const H = 132;
const CX = W / 2;
const CY = H / 2;
const SLEEVE_START = 58; // distancia del centro al primer disco (junto al collarín)
const SLEEVE_END = 344; // fin del manguito (a la derecha; a la izquierda, simétrico)

function barPref() {
  try { const v = Number(localStorage.getItem(BAR_KEY)); return BARS.includes(v) ? v : 20; } catch { return 20; }
}
const saveBar = (v) => { try { localStorage.setItem(BAR_KEY, String(v)); } catch { /* solo esta vez */ } };
const el = (tag, attrs = {}, text = null) => {
  const n = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
};
const rect = (x, y, width, height, cls, rx = 2) => el('rect', { x, y, width, height, rx, class: cls });

/**
 * Dibujo de la barra completa con los discos de un lado repetidos, en espejo, en el otro (la carga es simétrica).
 * Del centro hacia fuera: empuñadura, collarín y discos de mayor a menor; con muchos discos el grosor se ajusta.
 */
export function platesSvg(perSide, bar = 20) {
  const names = groupPlates(perSide, (n) => fmtNum(n, 2));
  const svg = el('svg', {
    viewBox: `0 0 ${W} ${H}`, class: 'pl-svg', role: 'img', preserveAspectRatio: 'xMidYMid meet',
    'aria-label': perSide.length ? `Barra de ${fmtNum(bar, 2)} kilos con, en cada lado, ${names} kilos` : `Barra de ${fmtNum(bar, 2)} kilos sin discos`,
  });
  // Barra: eje, empuñadura central y topes de los extremos
  svg.append(
    rect(6, CY - 4, W - 12, 8, 'pl-bar', 4),
    rect(CX - 46, CY - 5, 92, 10, 'pl-grip', 3),
    rect(2, CY - 8, 6, 16, 'pl-collar', 3), rect(W - 8, CY - 8, 6, 16, 'pl-collar', 3),
  );
  // Collarines interiores (donde empiezan los discos)
  svg.append(rect(CX - SLEEVE_START + 2, CY - 16, 6, 32, 'pl-collar', 2), rect(CX + SLEEVE_START - 8, CY - 16, 6, 32, 'pl-collar', 2));
  let off = 0;
  for (const r of plateRects(perSide, { avail: SLEEVE_END - (CX + SLEEVE_START) })) {
    const hh = 100 * r.k;
    const cls = `pl-disc pl-${String(r.p).replace('.', '_')}`;
    const xr = CX + SLEEVE_START + off; // derecha: hacia fuera
    const xl = CX - SLEEVE_START - off - r.w; // izquierda: espejo
    for (const x of [xl, xr]) {
      svg.appendChild(rect(x, CY - hh / 2, r.w, hh, cls, 3));
      if (r.w >= 12) svg.appendChild(el('text', { x: x + r.w / 2, y: CY, class: 'pl-txt', transform: `rotate(-90 ${x + r.w / 2} ${CY})` }, fmtNum(r.p, 2)));
    }
    off += r.w + 2;
  }
  svg.appendChild(el('text', { x: CX, y: CY + 26, class: 'pl-barlabel' }, `Barra ${fmtNum(bar, 2)} kg`));
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
        const side = r.perSide.reduce((s, p) => s + p, 0);
        const txt = r.reason === 'below-bar'
          ? h('p.pl-line', `${fmtNum(weight ?? 0, 2)} kg es menos que la barra vacía (${fmtNum(bar, 2)} kg).`)
          : r.perSide.length
            ? h('p.pl-line.tnum', h('strong', 'Por lado: '), groupPlates(r.perSide, (n) => fmtNum(n, 2)), ' kg')
            : h('p.pl-line', 'Solo la barra.');
        view.replaceChildren(...[
          h('p.pl-total.tnum', `${fmtNum(weight ?? 0, 2)} kg`),
          platesSvg(r.reason === 'below-bar' ? [] : r.perSide, bar),
          txt,
          r.perSide.length ? h('p.pl-sub.tnum', `${fmtNum(side, 2)} kg por lado · barra ${fmtNum(bar, 2)} kg · ${fmtNum(r.loaded, 2)} kg montados`) : null,
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
