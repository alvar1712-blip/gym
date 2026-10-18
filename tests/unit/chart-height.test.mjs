// Ronda 10 (docs/PULIDO.md §34.1): chartHeight() de js/progress-ui.js no lee window.innerHeight en cada tarjeta.
// Leerlo obliga al navegador a maquetar lo pendiente, y Progreso lo pedía al crear cada una de sus gráficas mientras
// montaba (una maquetación forzada por gráfica). Ahora se lee una vez y otra tras cada 'resize'; la altura no cambia.
import test from 'node:test';
import assert from 'node:assert/strict';

// Ventana falsa que cuenta las lecturas de innerHeight (antes de importar el módulo: escucha 'resize' al cargar).
let vh = 664; // iPhone 13 con la barra de Safari: pantalla «baja» (< 700)
let reads = 0;
const listeners = {};
globalThis.window = {
  get innerHeight() { reads++; return vh; },
  addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  removeEventListener() {},
};
const resize = (h) => { vh = h; for (const fn of listeners.resize || []) fn({ type: 'resize' }); };
const { chartHeight } = await import('../../js/progress-ui.js');

test('chartHeight: 8 tarjetas seguidas leen el alto de la ventana una sola vez, con la misma altura de siempre', () => {
  reads = 0;
  const hs = [];
  for (let i = 0; i < 8; i++) hs.push(chartHeight(190));
  assert.deepEqual(hs, Array(8).fill(Math.round(190 * 0.82)), 'pantalla baja: 82 % del alto');
  assert.ok(reads <= 1, `lecturas de innerHeight: ${reads} (una por tarjeta fuerza una maquetación cada vez)`);
});

test('chartHeight: tras «resize» vuelve a leer el alto (girar el móvil, abrir la barra de Safari)', () => {
  chartHeight(190);
  reads = 0;
  resize(844);
  assert.equal(chartHeight(190), 190, 'pantalla alta: altura completa');
  assert.equal(chartHeight(150), 150);
  assert.equal(reads, 1, 'una lectura nueva tras el resize');
  resize(600);
  assert.equal(chartHeight(200), Math.round(200 * 0.82));
});
